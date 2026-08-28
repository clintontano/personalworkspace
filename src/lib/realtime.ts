"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

// One shared channel per topic for the lifetime of the tab. Channels carry
// broadcast events only (no postgres replication config needed).
const channels = new Map<string, RealtimeChannel>();

function channel(topic: string, self: boolean): RealtimeChannel {
  let ch = channels.get(topic);
  if (!ch) {
    ch = createClient().channel(topic, { config: { broadcast: { self } } });
    ch.subscribe();
    channels.set(topic, ch);
  }
  return ch;
}

/** Workspace-wide events (sidebar page tree). Echoes to the sender so the
 * sending tab's own sidebar refreshes through the same path. */
export function workspaceChannel(workspaceId: string) {
  return channel(`ws-${workspaceId}`, true);
}

/** Per-page block events. Does not echo: the sender already has the edit. */
export function pageChannel(pageId: string) {
  return channel(`page-${pageId}`, false);
}

export function notifyPagesChanged(workspaceId: string) {
  void workspaceChannel(workspaceId).send({
    type: "broadcast",
    event: "pages",
    payload: {},
  });
}
