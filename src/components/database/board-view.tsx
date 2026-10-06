"use client";

import { ArrowUpRight, Check, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { formatDateDisplay } from "@/lib/db/date-value";
import { groupRows } from "@/lib/db/group";
import type { Property, PropertyValue, Row } from "@/lib/db/model";
import { cn } from "@/lib/utils";
import { optionColorClass } from "./option-colors";

export function BoardView({
  rows,
  properties,
  groupBy,
  hideEmptyGroups,
  onValueChange,
  onAddRow,
}: {
  rows: Row[];
  properties: Property[];
  groupBy: Property | undefined;
  hideEmptyGroups?: boolean;
  onValueChange: (pageId: string, propertyId: string, value: PropertyValue) => void;
  onAddRow: (presets?: Record<string, PropertyValue>) => void;
}) {
  const [dragOver, setDragOver] = useState<string | null>(null);

  if (!groupBy || groupBy.type !== "select") {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Board views group by a select property. Add one, then pick it under
        “Group”.
      </p>
    );
  }

  const groups = groupRows(rows, groupBy).filter(
    (group) => !hideEmptyGroups || group.rows.length > 0,
  );
  // Every property the view's visibility menu leaves on, except the one the
  // columns already show. This used to keep only the first two selects or
  // dates, ignoring the menu entirely. Relations are left off: they hold page
  // ids, which mean nothing on a card.
  const cardProperties = properties.filter(
    (p) => p.id !== groupBy.id && p.type !== "relation",
  );

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {groups.map((group) => (
        <div
          key={group.key ?? "__none__"}
          className={cn(
            "flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-muted/40 p-2",
            dragOver === (group.key ?? "__none__") && "ring-2 ring-ring",
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(group.key ?? "__none__");
          }}
          onDragLeave={() => setDragOver(null)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(null);
            const pageId = e.dataTransfer.getData("text/row-id");
            if (pageId) onValueChange(pageId, groupBy.id, group.key);
          }}
        >
          <div className="flex items-center gap-2 px-1">
            <Badge variant="secondary" className={optionColorClass(group.color)}>
              {group.label}
            </Badge>
            <span className="text-xs text-muted-foreground">{group.rows.length}</span>
          </div>
          {group.rows.map((row) => (
            <div
              key={row.pageId}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("text/row-id", row.pageId)}
              className="group cursor-grab rounded-md border bg-background p-2 shadow-sm active:cursor-grabbing"
            >
              <div className="flex items-start justify-between gap-1">
                <p className="text-sm font-medium">{row.title || "Untitled"}</p>
                <Link
                  href={`/app/p/${row.pageId}`}
                  aria-label="Open row"
                  className="hidden shrink-0 rounded p-0.5 hover:bg-muted group-hover:block"
                >
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              {/* one property per line, as Notion lays out its cards */}
              <div className="mt-1.5 flex flex-col items-start gap-1.5">
                {cardProperties.map((p) => (
                  <CardValue key={p.id} property={p} value={row.properties[p.id]} />
                ))}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              onAddRow(group.key !== null ? { [groupBy.id]: group.key } : undefined)
            }
            className="flex items-center gap-1 rounded px-1 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            <Plus className="h-3 w-3" /> New
          </button>
        </div>
      ))}
    </div>
  );
}

/** One property on a card; empty values take no space. */
function CardValue({ property, value }: { property: Property; value: PropertyValue }) {
  if (value === undefined || value === null || value === "") return null;

  switch (property.type) {
    case "select": {
      const option = property.config.options?.find((o) => o.id === value);
      return option ? (
        <Badge variant="secondary" className={optionColorClass(option.color)}>
          {option.name}
        </Badge>
      ) : null;
    }
    case "multi_select": {
      const options = (Array.isArray(value) ? value : [])
        .map((id) => property.config.options?.find((o) => o.id === id))
        .filter((o) => o !== undefined);
      if (options.length === 0) return null;
      return (
        <div className="flex flex-wrap gap-1">
          {options.map((o) => (
            <Badge key={o.id} variant="secondary" className={optionColorClass(o.color)}>
              {o.name}
            </Badge>
          ))}
        </div>
      );
    }
    case "date":
      return <span className="text-xs">{formatDateDisplay(value)}</span>;
    case "checkbox":
      return value === true ? (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Check className="h-3 w-3" /> {property.name}
        </span>
      ) : null;
    default:
      return (
        <span className="line-clamp-2 text-xs text-muted-foreground">{String(value)}</span>
      );
  }
}
