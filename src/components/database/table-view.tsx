"use client";

import { ArrowUpRight, GripVertical, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Property, PropertyType, PropertyValue, Row } from "@/lib/db/model";
import { groupRows } from "@/lib/db/group";
import { dropZone, type DropPosition } from "@/lib/reorder";
import { cn } from "@/lib/utils";
import { optionColorClass } from "./option-colors";
import { PropertyCell } from "./cell";

const PROPERTY_TYPES: { type: PropertyType; label: string }[] = [
  { type: "text", label: "Text" },
  { type: "number", label: "Number" },
  { type: "select", label: "Select" },
  { type: "multi_select", label: "Multi-select" },
  { type: "date", label: "Date" },
  { type: "checkbox", label: "Checkbox" },
  { type: "url", label: "URL" },
];

export const TITLE_COLUMN = "title";
const DEFAULT_TITLE_WIDTH = 280;
const DEFAULT_COLUMN_WIDTH = 160;
const MIN_COLUMN_WIDTH = 80;
const ACTIONS_WIDTH = 52;

export function TableView({
  rows,
  properties,
  groupBy,
  columnWidths,
  onTitleChange,
  onValueChange,
  onAddRow,
  onDeleteRow,
  onAddProperty,
  onResizeColumn,
  onReorderColumn,
}: {
  rows: Row[];
  properties: Property[];
  groupBy?: Property;
  columnWidths?: Record<string, number>;
  onTitleChange: (pageId: string, title: string) => void;
  onValueChange: (pageId: string, propertyId: string, value: PropertyValue) => void;
  onAddRow: (presets?: Record<string, PropertyValue>) => void;
  onDeleteRow: (pageId: string) => void;
  onAddProperty: (name: string, type: PropertyType) => void;
  onResizeColumn?: (columnId: string, width: number) => void;
  onReorderColumn?: (draggedId: string, targetId: string, position: DropPosition) => void;
}) {
  const sections = groupBy
    ? groupRows(rows, groupBy)
    : [{ key: null, label: "", rows }];

  // Live width while a resize is in flight; committed on pointer-up so the
  // drag stays at pointer speed instead of waiting on the network.
  const [draftWidth, setDraftWidth] = useState<{ id: string; width: number } | null>(null);
  // Same reason as the sidebar: dragover must preventDefault synchronously,
  // before a dragstart state update has flushed.
  const draggingRef = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: DropPosition } | null>(
    null,
  );

  const widthOf = (columnId: string) => {
    if (draftWidth?.id === columnId) return draftWidth.width;
    return (
      columnWidths?.[columnId] ??
      (columnId === TITLE_COLUMN ? DEFAULT_TITLE_WIDTH : DEFAULT_COLUMN_WIDTH)
    );
  };

  const totalWidth =
    widthOf(TITLE_COLUMN) +
    properties.reduce((sum, p) => sum + widthOf(p.id), 0) +
    ACTIONS_WIDTH;

  const handleReorderDrop = (
    targetId: string,
    position: DropPosition,
    draggedId: string | null,
  ) => {
    if (draggedId && draggedId !== targetId) {
      onReorderColumn?.(draggedId, targetId, position);
    }
    draggingRef.current = null;
    setDragging(null);
    setDropTarget(null);
  };

  return (
    <div className="overflow-x-auto">
      <table
        className="border-collapse text-sm"
        style={{ tableLayout: "fixed", width: totalWidth }}
      >
        <colgroup>
          <col style={{ width: widthOf(TITLE_COLUMN) }} />
          {properties.map((p) => (
            <col key={p.id} style={{ width: widthOf(p.id) }} />
          ))}
          <col style={{ width: ACTIONS_WIDTH }} />
        </colgroup>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <HeaderCell
              label="Title"
              columnId={TITLE_COLUMN}
              // the title column is pinned first, as in Notion
              reorderable={false}
              resizable={Boolean(onResizeColumn)}
              width={widthOf(TITLE_COLUMN)}
              onResize={(width) => setDraftWidth({ id: TITLE_COLUMN, width })}
              onResizeEnd={(width) => {
                setDraftWidth(null);
                onResizeColumn?.(TITLE_COLUMN, width);
              }}
            />
            {properties.map((p) => (
              <HeaderCell
                key={p.id}
                label={p.name}
                columnId={p.id}
                reorderable={Boolean(onReorderColumn)}
                resizable={Boolean(onResizeColumn)}
                width={widthOf(p.id)}
                isDragging={dragging === p.id}
                dropPosition={dropTarget?.id === p.id ? dropTarget.position : null}
                onDragStart={() => {
                  draggingRef.current = p.id;
                  setDragging(p.id);
                }}
                onDragEnd={() => {
                  draggingRef.current = null;
                  setDragging(null);
                  setDropTarget(null);
                }}
                onDragOverColumn={(position) => setDropTarget({ id: p.id, position })}
                onDropColumn={(position, draggedId) =>
                  handleReorderDrop(p.id, position, draggedId ?? draggingRef.current)
                }
                onResize={(width) => setDraftWidth({ id: p.id, width })}
                onResizeEnd={(width) => {
                  setDraftWidth(null);
                  onResizeColumn?.(p.id, width);
                }}
              />
            ))}
            <th className="px-2 py-2">
              <AddPropertyMenu onAdd={onAddProperty} />
            </th>
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <SectionRows
              key={section.key ?? "__all__"}
              label={groupBy ? section.label : null}
              color={"color" in section ? (section as { color?: string }).color : undefined}
              rows={section.rows}
              colSpan={properties.length + 2}
              properties={properties}
              onTitleChange={onTitleChange}
              onValueChange={onValueChange}
              onDeleteRow={onDeleteRow}
              onAddRow={() =>
                onAddRow(
                  groupBy && section.key !== null && groupBy.type === "select"
                    ? { [groupBy.id]: section.key }
                    : undefined,
                )
              }
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A header cell that can be dragged to reorder and has a resize grip on its
 * trailing edge. Resizing uses pointer capture so the drag keeps tracking
 * even when the cursor leaves the 4px handle.
 */
function HeaderCell({
  label,
  columnId,
  width,
  reorderable,
  resizable,
  isDragging,
  dropPosition,
  onDragStart,
  onDragEnd,
  onDragOverColumn,
  onDropColumn,
  onResize,
  onResizeEnd,
}: {
  label: string;
  columnId: string;
  width: number;
  reorderable: boolean;
  resizable: boolean;
  isDragging?: boolean;
  dropPosition?: DropPosition | null;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDragOverColumn?: (position: DropPosition) => void;
  onDropColumn?: (position: DropPosition, draggedId: string | null) => void;
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const latest = useRef(width);

  return (
    <th
      data-column-id={columnId}
      draggable={reorderable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/column-id", columnId);
        onDragStart?.();
      }}
      onDragEnd={() => onDragEnd?.()}
      onDragOver={(e) => {
        if (!onDragOverColumn) return;
        if (!e.dataTransfer.types.includes("text/column-id")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const rect = e.currentTarget.getBoundingClientRect();
        onDragOverColumn(
          dropZone(e.clientX - rect.left, rect.width, false) as DropPosition,
        );
      }}
      onDrop={(e) => {
        if (!onDropColumn) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        onDropColumn(
          dropZone(e.clientX - rect.left, rect.width, false) as DropPosition,
          e.dataTransfer.getData("text/column-id") || null,
        );
      }}
      className={cn(
        "group/header relative px-2 py-2 font-medium select-none",
        reorderable && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40",
        dropPosition === "before" && "border-l-2 border-l-primary",
        dropPosition === "after" && "border-r-2 border-r-primary",
      )}
    >
      <span className="flex items-center gap-1 truncate">
        {reorderable ? (
          <GripVertical className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/header:opacity-60" />
        ) : null}
        <span className="truncate">{label}</span>
      </span>

      {resizable ? (
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${label} column`}
          // keeps the header's own drag from starting on the grip
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            start.current = { x: e.clientX, width };
            latest.current = width;
          }}
          onPointerMove={(e) => {
            if (!start.current) return;
            const next = Math.max(
              MIN_COLUMN_WIDTH,
              Math.round(start.current.width + (e.clientX - start.current.x)),
            );
            latest.current = next;
            onResize(next);
          }}
          onPointerUp={(e) => {
            if (!start.current) return;
            e.currentTarget.releasePointerCapture(e.pointerId);
            start.current = null;
            onResizeEnd(latest.current);
          }}
          className="absolute top-0 right-0 z-10 h-full w-1.5 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-primary/40"
        />
      ) : null}
    </th>
  );
}

function SectionRows({
  label,
  color,
  rows,
  colSpan,
  properties,
  onTitleChange,
  onValueChange,
  onDeleteRow,
  onAddRow,
}: {
  label: string | null;
  color?: string;
  rows: Row[];
  colSpan: number;
  properties: Property[];
  onTitleChange: (pageId: string, title: string) => void;
  onValueChange: (pageId: string, propertyId: string, value: PropertyValue) => void;
  onDeleteRow: (pageId: string) => void;
  onAddRow: () => void;
}) {
  return (
    <>
      {label !== null ? (
        <tr>
          <td colSpan={colSpan} className="px-2 pb-1 pt-4">
            <Badge variant="secondary" className={optionColorClass(color)}>
              {label}
            </Badge>
            <span className="ml-2 text-xs text-muted-foreground">{rows.length}</span>
          </td>
        </tr>
      ) : null}
      {rows.map((row) => (
        <tr key={row.pageId} className="group border-b hover:bg-muted/40">
          <td className="px-0 py-0">
            <div className="flex items-center">
              <TitleCell
                value={row.title}
                onCommit={(v) => onTitleChange(row.pageId, v)}
              />
              <Link
                href={`/app/p/${row.pageId}`}
                aria-label="Open row"
                className="mr-1 hidden rounded p-1 hover:bg-muted-foreground/20 group-hover:block"
              >
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </td>
          {properties.map((p) => (
            <td key={p.id} className="border-l px-0 py-0">
              <PropertyCell
                property={p}
                value={row.properties[p.id]}
                onChange={(value) => onValueChange(row.pageId, p.id, value)}
              />
            </td>
          ))}
          <td className="border-l px-1">
            <button
              type="button"
              aria-label="Delete row"
              onClick={() => onDeleteRow(row.pageId)}
              className="hidden rounded p-1 hover:bg-muted-foreground/20 group-hover:block"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </td>
        </tr>
      ))}
      <tr>
        <td colSpan={colSpan} className="px-2 py-1">
          <button
            type="button"
            onClick={onAddRow}
            className="flex items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground hover:bg-muted"
          >
            <Plus className="h-3 w-3" /> New row
          </button>
        </td>
      </tr>
    </>
  );
}

function TitleCell({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      data-row-title={value}
      value={draft}
      placeholder="Untitled"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="w-full bg-transparent px-2 py-1.5 text-sm font-medium outline-none placeholder:text-muted-foreground/50"
    />
  );
}

function AddPropertyMenu({ onAdd }: { onAdd: (name: string, type: PropertyType) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Add property"
          className="rounded p-1 hover:bg-muted"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {PROPERTY_TYPES.map((t) => (
          <DropdownMenuItem key={t.type} onClick={() => onAdd(t.label, t.type)}>
            {t.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
