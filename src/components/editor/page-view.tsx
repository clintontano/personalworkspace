"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import type { BlockRowLike } from "@/lib/blocks/sync";
import { PropertiesPanel } from "@/components/database/properties-panel";
import type { Property, PropertyValue } from "@/lib/db/model";
import { renamePage } from "@/lib/pages";
import { notifyPagesChanged } from "@/lib/realtime";
import type { SaveState } from "./block-editor";

const BlockEditor = dynamic(
  () => import("./block-editor").then((m) => m.BlockEditor),
  { ssr: false },
);

export function PageView({
  pageId,
  workspaceId,
  initialTitle,
  initialRows,
  rowProperties,
  rowValues,
}: {
  pageId: string;
  workspaceId: string;
  initialTitle: string;
  initialRows: BlockRowLike[];
  rowProperties?: Property[] | null;
  rowValues?: Record<string, PropertyValue> | null;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onTitleChange = useCallback(
    (value: string) => {
      setTitle(value);
      if (titleTimer.current) clearTimeout(titleTimer.current);
      titleTimer.current = setTimeout(() => {
        void renamePage(pageId, value).then(() => notifyPagesChanged(workspaceId));
      }, 400);
    },
    [pageId, workspaceId],
  );

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-8 py-10">
      <div className="mb-1 flex items-center justify-end">
        <span
          data-testid="save-state"
          className="text-xs text-muted-foreground"
        >
          {saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving…" : "Save failed"}
        </span>
      </div>
      <input
        data-testid="page-title"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="Untitled"
        className="mb-4 w-full bg-transparent text-4xl font-bold outline-none placeholder:text-muted-foreground/40"
      />
      {rowProperties && rowProperties.length > 0 ? (
        <PropertiesPanel
          pageId={pageId}
          properties={rowProperties}
          initialValues={rowValues ?? {}}
        />
      ) : null}
      <div className="-mx-[54px] flex-1">
        <BlockEditor
          pageId={pageId}
          workspaceId={workspaceId}
          initialRows={initialRows}
          onSaveStateChange={setSaveState}
        />
      </div>
    </div>
  );
}
