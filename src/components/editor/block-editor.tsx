"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";

import { filterSuggestionItems } from "@blocknote/core";
import {
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { Table2 } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { createEditorSchema } from "@/components/editor/database-block";
import { seedInlineDatabases } from "@/components/editor/inline-database";
import type { DatabaseBundleData } from "@/lib/db/bundle";
import { createDatabase } from "@/lib/db/data";
import { useTheme } from "@/components/theme-provider";
import {
  diffBlocks,
  rowsToDocument,
  type BlockRowLike,
  type EditorBlockLike,
} from "@/lib/blocks/sync";
import type { Json } from "@/lib/database.types";
import { broadcast, notifyPagesChanged, onBroadcast, pageTopic } from "@/lib/realtime";
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
  inlineDatabases = [],
  onSaveStateChange,
}: {
  pageId: string;
  workspaceId: string;
  initialRows: BlockRowLike[];
  /** Bundles for `database` blocks on this page, fetched server-side. */
  inlineDatabases?: DatabaseBundleData[];
  onSaveStateChange?: (state: SaveState) => void;
}) {
  // Runs before the editor renders its blocks, so embedded databases have
  // their data ready on first paint. Idempotent: seeding never overwrites.
  useMemo(() => seedInlineDatabases(inlineDatabases), [inlineDatabases]);

  // Mirror of what the database currently holds for this page.
  const dbRows = useRef(new Map(initialRows.map((r) => [r.id, r])));
  const flow = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    saving: boolean;
    dirty: boolean;
  }>({ timer: null, saving: false, dirty: false });
  const saveRef = useRef<() => Promise<void>>(async () => {});

  const { resolved: theme } = useTheme();

  const initialContent = useMemo(() => {
    const doc = rowsToDocument(initialRows);
    return doc.length > 0 ? doc : undefined;
  }, [initialRows]);

  const schema = useMemo(() => createEditorSchema(workspaceId), [workspaceId]);

  const editor = useCreateBlockNote(
    {
      schema,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      initialContent: initialContent as any,
    },
    [schema],
  );

  // Slash menu: the defaults plus "Database", which creates a real database
  // page nested under this one and embeds it.
  const getSlashItems = async (query: string) => {
    const insertDatabase: DefaultReactSuggestionItem = {
      title: "Database",
      subtext: "A table, board, list or calendar inside this page",
      aliases: ["database", "table", "board", "grid"],
      group: "Basic blocks",
      icon: <Table2 className="h-4 w-4" />,
      onItemClick: () => {
        void (async () => {
          const databaseId = await createDatabase(workspaceId, pageId);
          editor.insertBlocks(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            [{ type: "database", props: { databaseId } } as any],
            editor.getTextCursorPosition().block,
            "after",
          );
          // The sidebar tree gains the new database page.
          notifyPagesChanged(workspaceId);
        })();
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const defaults = getDefaultReactSlashMenuItems(editor as any);

    // The menu renders one section per run of same-group items, keyed by
    // group name. Appending to the end would make "Basic blocks" appear
    // twice and collide on that key, so the item goes next to its group.
    const lastOfGroup = defaults.reduce(
      (found, item, index) => (item.group === insertDatabase.group ? index : found),
      -1,
    );
    const items =
      lastOfGroup === -1
        ? [...defaults, insertDatabase]
        : [
            ...defaults.slice(0, lastOfGroup + 1),
            insertDatabase,
            ...defaults.slice(lastOfGroup + 1),
          ];

    return filterSuggestionItems(items, query);
  };

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

  return (
    <BlockNoteView editor={editor} theme={theme} onChange={scheduleSave} slashMenu={false}>
      <SuggestionMenuController triggerCharacter="/" getItems={getSlashItems} />
    </BlockNoteView>
  );
}
