"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export const pagesTopic = (workspaceId: string) => `ws-${workspaceId}`;
export const pageTopic = (pageId: string) => `page-${pageId}`;

// One channel per topic, shared by senders and receivers: a topic can only be
// joined once per socket, so send and receive must go through the same
// channel. It subscribes once with a wildcard binding and dispatches to local
// handlers; `self: true` lets a tab react to its own sends (payloads carry an
// origin id where that must be filtered).
type Handler = { event: string; fn: (payload: Record<string, unknown>) => void };
type Hub = { ready: Promise<RealtimeChannel>; handlers: Set<Handler> };

const hubs = new Map<string, Hub>();

function hub(topic: string): Hub {
  let existing = hubs.get(topic);
  if (!existing) {
    const handlers = new Set<Handler>();
    const channel = createClient().channel(topic, {
      config: { broadcast: { self: true } },
    });
    channel.on("broadcast", { event: "*" }, (message) => {
      const payload = (message.payload ?? {}) as Record<string, unknown>;
      for (const handler of handlers) {
        if (handler.event === message.event) handler.fn(payload);
      }
    });
    const ready = new Promise<RealtimeChannel>((resolve) => {
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve(channel);
      });
    });
    existing = { ready, handlers };
    hubs.set(topic, existing);
  }
  return existing;
}

/** Listen for a broadcast event. Returns an unsubscribe function. */
export function onBroadcast(
  topic: string,
  event: string,
  fn: (payload: Record<string, unknown>) => void,
): () => void {
  const h = hub(topic);
  const handler: Handler = { event, fn };
  h.handlers.add(handler);
  return () => {
    h.handlers.delete(handler);
  };
}

export async function broadcast(
  topic: string,
  event: string,
  payload: Record<string, unknown> = {},
) {
  const channel = await hub(topic).ready;
  await channel.send({ type: "broadcast", event, payload });
}

export function notifyPagesChanged(workspaceId: string) {
  void broadcast(pagesTopic(workspaceId), "pages");
}
