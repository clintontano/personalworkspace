import { NextResponse } from "next/server";
import type { Json } from "@/lib/database.types";
import {
  eventBody,
  eventDuration,
  planPull,
  planPush,
  type GcalEvent,
  type SyncRow,
} from "@/lib/google/calendar-sync";
import { refreshAccessToken } from "@/lib/google/oauth";
import { keyAfter } from "@/lib/order";
import { createClient } from "@/lib/supabase/server";

const GCAL = "https://www.googleapis.com/calendar/v3";

type ConnectionConfig = {
  calendarId?: string;
  databaseId?: string;
  datePropertyId?: string;
  syncToken?: string;
  lastSyncAt?: string;
};

/** POST /api/google/sync — run one pull+push cycle for the user's calendar
 * connection. Body: { databaseId?, datePropertyId? } to (re)target. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: connection } = await supabase
    .from("google_connections")
    .select("*")
    .eq("user_id", user.id)
    .eq("kind", "calendar")
    .maybeSingle();
  if (!connection) {
    return NextResponse.json({ error: "no calendar connection" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    databaseId?: string;
    datePropertyId?: string;
  };
  const config = { ...((connection.config ?? {}) as ConnectionConfig) };
  if (body.databaseId) config.databaseId = body.databaseId;
  if (body.datePropertyId) config.datePropertyId = body.datePropertyId;
  config.calendarId = config.calendarId ?? "primary";
  if (!config.databaseId || !config.datePropertyId) {
    return NextResponse.json(
      { error: "sync target not configured (databaseId, datePropertyId)" },
      { status: 400 },
    );
  }

  // Fresh access token when the stored one is near expiry.
  let accessToken = connection.access_token;
  if (new Date(connection.token_expires_at).getTime() < Date.now() + 60_000) {
    const refreshed = await refreshAccessToken(connection.refresh_token);
    accessToken = refreshed.access_token;
    await supabase
      .from("google_connections")
      .update({
        access_token: accessToken,
        token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      })
      .eq("id", connection.id);
  }

  const gcal = async (path: string, init?: RequestInit): Promise<Response> =>
    fetch(`${GCAL}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        ...init?.headers,
      },
    });

  // ---- pull ----------------------------------------------------------------
  const events: GcalEvent[] = [];
  let syncToken = config.syncToken;
  let pageToken: string | undefined;
  let fullResync = false;
  do {
    const params = new URLSearchParams({ maxResults: "250", singleEvents: "false" });
    if (pageToken) params.set("pageToken", pageToken);
    else if (syncToken) params.set("syncToken", syncToken);
    else {
      const timeMin = new Date();
      timeMin.setDate(timeMin.getDate() - 90);
      params.set("timeMin", timeMin.toISOString());
      params.set("showDeleted", "true");
    }
    const response = await gcal(
      `/calendars/${encodeURIComponent(config.calendarId)}/events?${params}`,
    );
    if (response.status === 410) {
      // sync token expired: full resync next call
      syncToken = undefined;
      fullResync = true;
      break;
    }
    if (!response.ok) {
      return NextResponse.json(
        { error: `google events list failed: ${await response.text()}` },
        { status: 502 },
      );
    }
    const data = (await response.json()) as {
      items?: GcalEvent[];
      nextPageToken?: string;
      nextSyncToken?: string;
    };
    events.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
    if (data.nextSyncToken) syncToken = data.nextSyncToken;
  } while (pageToken);

  if (fullResync) {
    await supabase
      .from("google_connections")
      .update({ config: { ...config, syncToken: null } as Json })
      .eq("id", connection.id);
    return NextResponse.json({ resync: true, message: "sync token expired; run sync again" });
  }

  // Load current rows of the target database.
  const { data: rawRows } = await supabase
    .from("database_rows")
    .select("page_id, properties, updated_at, pages!inner(title, archived_at)")
    .eq("database_id", config.databaseId);

  const dateProp = config.datePropertyId;
  const rows: SyncRow[] = (rawRows ?? []).map((r) => {
    const props = (r.properties ?? {}) as Record<string, unknown>;
    const gcalMark = props._gcal as { id: string; updated?: string } | undefined;
    const pages = r.pages as unknown as { title: string; archived_at: string | null };
    return {
      pageId: r.page_id,
      title: pages.title,
      date: typeof props[dateProp] === "string" ? (props[dateProp] as string) : null,
      updatedAt: r.updated_at,
      gcal: gcalMark ?? null,
      archived: pages.archived_at !== null,
    };
  });

  const workspaceId = connection.workspace_id;
  const pulled = new Set<string>();
  const pullActions = planPull(events, rows);

  for (const action of pullActions) {
    if (action.kind === "archive") {
      await supabase
        .from("pages")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", action.pageId);
      pulled.add(action.pageId);
    } else if (action.kind === "create") {
      const { data: page, error } = await supabase
        .from("pages")
        .insert({
          workspace_id: workspaceId,
          parent_page_id: config.databaseId,
          title: action.title,
          order_key: keyAfter(null),
        })
        .select("id")
        .single();
      if (error) continue;
      const properties: Record<string, unknown> = {
        _gcal: { id: action.event.id, updated: action.event.updated },
      };
      if (action.date) properties[dateProp] = action.date;
      await supabase.from("database_rows").insert({
        page_id: page.id,
        database_id: config.databaseId,
        workspace_id: workspaceId,
        properties: properties as Json,
        order_key: keyAfter(null),
      });
      pulled.add(page.id);
    } else {
      // merge onto the stored properties
      const { data: current } = await supabase
        .from("database_rows")
        .select("properties")
        .eq("page_id", action.pageId)
        .single();
      const merged = { ...((current?.properties ?? {}) as Record<string, unknown>) };
      merged._gcal = action.gcal;
      if (action.date) merged[dateProp] = action.date;
      else delete merged[dateProp];
      await supabase
        .from("database_rows")
        .update({ properties: merged as Json })
        .eq("page_id", action.pageId);
      await supabase.from("pages").update({ title: action.title }).eq("id", action.pageId);
      pulled.add(action.pageId);
    }
  }

  // ---- push ----------------------------------------------------------------
  const pushActions = planPush(rows, config.lastSyncAt ?? null, pulled);
  let pushed = 0;
  for (const action of pushActions) {
    if (action.kind === "insert") {
      const response = await gcal(
        `/calendars/${encodeURIComponent(config.calendarId)}/events`,
        { method: "POST", body: JSON.stringify(eventBody(action.title, action.date)) },
      );
      if (!response.ok) continue;
      const created = (await response.json()) as GcalEvent;
      const { data: current } = await supabase
        .from("database_rows")
        .select("properties")
        .eq("page_id", action.pageId)
        .single();
      const merged = { ...((current?.properties ?? {}) as Record<string, unknown>) };
      merged._gcal = { id: created.id, updated: created.updated };
      await supabase
        .from("database_rows")
        .update({ properties: merged as Json })
        .eq("page_id", action.pageId);
      pushed++;
    } else {
      // Fetch first so a timed event keeps its own length instead of being
      // reset to the default hour.
      let durationMs: number | null = null;
      if (action.date && action.date.includes("T")) {
        const current = await gcal(
          `/calendars/${encodeURIComponent(config.calendarId)}/events/${action.eventId}`,
        );
        if (current.ok) durationMs = eventDuration((await current.json()) as GcalEvent);
      }
      const response = await gcal(
        `/calendars/${encodeURIComponent(config.calendarId)}/events/${action.eventId}`,
        {
          method: "PATCH",
          body: JSON.stringify(eventBody(action.title, action.date, durationMs)),
        },
      );
      if (response.ok) pushed++;
    }
  }

  const newConfig: ConnectionConfig = {
    ...config,
    syncToken,
    lastSyncAt: new Date().toISOString(),
  };
  await supabase
    .from("google_connections")
    .update({ config: newConfig as Json })
    .eq("id", connection.id);

  return NextResponse.json({
    pulled: pullActions.length,
    pushed,
    events: events.length,
  });
}
