"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";

import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { useEffect, useMemo, useRef } from "react";
import {
  diffBlocks,
  rowsToDocument,
  type BlockRowLike,
  type EditorBlockLike,
} from "@/lib/blocks/sync";
import type { Json } from "@/lib/database.types";
import { broadcast, onBroadcast, pageTopic } from "@/lib/realtime";
import { createClient } from "@/lib/supabase/client";

export type SaveState = "saved" | "saving" | "error";

// Identifies this tab as the origin of broadcast events. Module scope: one id
// per tab for the lifetime of the page load.
const tabClientId =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tab-${Date.now()}`;

export function BlockEditor({
  pageId,
  workspaceId,
  initialRows,
  onSaveStateChange,
}: {
  pageId: string;
  workspaceId: string;
  initialRows: BlockRowLike[];
  onSaveStateChange?: (state: SaveState) => void;
}) {
  // Mirror of what the database currently holds for this page.
  const dbRows = useRef(new Map(initialRows.map((r) => [r.id, r])));
  const flow = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    saving: boolean;
    dirty: boolean;
  }>({ timer: null, saving: false, dirty: false });
  const saveRef = useRef<() => Promise<void>>(async () => {});

  const initialContent = useMemo(() => {
    const doc = rowsToDocument(initialRows);
    return doc.length > 0 ? doc : undefined;
  }, [initialRows]);

  const editor = useCreateBlockNote({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initialContent: initialContent as any,
  });

  useEffect(() => {
    saveRef.current = async () => {
      const f = flow.current;
      if (f.saving) {
        f.dirty = true;
        return;
      }
      f.saving = true;
      f.dirty = false;
      try {
        const doc = editor.document as unknown as EditorBlockLike[];
        const ops = diffBlocks([...dbRows.current.values()], doc);
        if (ops.upserts.length === 0 && ops.deleteIds.length === 0) {
          onSaveStateChange?.("saved");
          return;
        }
        onSaveStateChange?.("saving");
        const supabase = createClient();
        if (ops.upserts.length > 0) {
          const { error } = await supabase.from("blocks").upsert(
            ops.upserts.map((u) => ({
              ...u,
              content: u.content as unknown as Json,
              page_id: pageId,
              workspace_id: workspaceId,
            })),
          );
          if (error) throw error;
        }
        if (ops.deleteIds.length > 0) {
          const { error } = await supabase
            .from("blocks")
            .delete()
            .in("id", ops.deleteIds);
          if (error) throw error;
        }
        for (const u of ops.upserts) dbRows.current.set(u.id, { ...u });
        for (const id of ops.deleteIds) dbRows.current.delete(id);
        void broadcast(pageTopic(pageId), "blocks", { origin: tabClientId });
        onSaveStateChange?.("saved");
      } catch (err) {
        console.error("block save failed", err);
        onSaveStateChange?.("error");
      } finally {
        flow.current.saving = false;
        if (flow.current.dirty) void saveRef.current();
      }
    };
  });

  const scheduleSave = () => {
    onSaveStateChange?.("saving");
    if (flow.current.timer) clearTimeout(flow.current.timer);
    flow.current.timer = setTimeout(() => void saveRef.current(), 500);
  };

  // Remote edits from other tabs: refetch and replace the document.
  useEffect(() => {
    return onBroadcast(pageTopic(pageId), "blocks", (payload) => {
      if (payload.origin === tabClientId) return;
      void (async () => {
        const supabase = createClient();
        const { data } = await supabase
          .from("blocks")
          .select("id, parent_block_id, type, content, order_key")
          .eq("page_id", pageId);
        if (!data) return;
        dbRows.current = new Map(data.map((r) => [r.id, r as BlockRowLike]));
        const doc = rowsToDocument(data as BlockRowLike[]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        editor.replaceBlocks(editor.document, doc as any);
      })();
    });
  }, [pageId, editor]);

  // Flush pending edits when unmounting (navigation away).
  useEffect(() => {
    const f = flow.current;
    return () => {
      if (f.timer) {
        clearTimeout(f.timer);
        void saveRef.current();
      }
    };
  }, []);

  return <BlockNoteView editor={editor} theme="light" onChange={scheduleSave} />;
}
