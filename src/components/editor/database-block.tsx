"use client";

import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { InlineDatabase } from "./inline-database";

/**
 * A database embedded in a page.
 *
 * The block stores only the database's page id; the rows, properties and
 * views live in their own tables exactly as they do for a full-page database.
 * That means an inline database IS a real database — it appears in the
 * sidebar tree, can be opened as its own page, and is reachable from the MCP
 * server and automations without any special casing.
 *
 * `workspaceId` is passed through the editor's block options rather than
 * stored on the block, since it is a property of where the block lives.
 */
export const databaseBlockSpec = createReactBlockSpec(
  {
    type: "database",
    content: "none",
    propSchema: {
      databaseId: { default: "" },
    },
  },
  (options: { workspaceId?: string }) => ({
    // The options-creator overload widens the render props, so the only part
    // this block reads is annotated explicitly.
    render: ({ block }: { block: { props: { databaseId: string } } }) => (
      <InlineDatabase
        databaseId={block.props.databaseId}
        workspaceId={options.workspaceId ?? ""}
      />
    ),
  }),
);

export function createEditorSchema(workspaceId: string) {
  return BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      database: databaseBlockSpec({ workspaceId }),
    },
  });
}
