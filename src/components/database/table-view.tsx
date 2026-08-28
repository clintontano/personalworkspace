"use client";

import { ArrowUpRight, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Property, PropertyType, PropertyValue, Row } from "@/lib/db/model";
import { groupRows } from "@/lib/db/group";
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

export function TableView({
  rows,
  properties,
  groupBy,
  onTitleChange,
  onValueChange,
  onAddRow,
  onDeleteRow,
  onAddProperty,
}: {
  rows: Row[];
  properties: Property[];
  groupBy?: Property;
  onTitleChange: (pageId: string, title: string) => void;
  onValueChange: (pageId: string, propertyId: string, value: PropertyValue) => void;
  onAddRow: (presets?: Record<string, PropertyValue>) => void;
  onDeleteRow: (pageId: string) => void;
  onAddProperty: (name: string, type: PropertyType) => void;
}) {
  const sections = groupBy
    ? groupRows(rows, groupBy)
    : [{ key: null, label: "", rows }];

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="w-[280px] px-2 py-2 font-medium">Title</th>
            {properties.map((p) => (
              <th key={p.id} className="min-w-[130px] px-2 py-2 font-medium">
                {p.name}
              </th>
            ))}
            <th className="w-16 px-2 py-2">
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
