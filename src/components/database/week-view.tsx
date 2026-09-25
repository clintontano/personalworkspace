"use client";

import { ArrowUpRight, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  placementsFor,
  todayIso,
  weekLabel,
  weekRange,
  weekSpan,
} from "@/lib/calendar/week";
import { formatDateDisplay } from "@/lib/db/date-value";
import type { Property, PropertyValue, Row } from "@/lib/db/model";
import { cn } from "@/lib/utils";
import { optionColorClass } from "./option-colors";

type Placed = { row: Row; isStart: boolean };

export function WeekView({
  rows,
  properties,
  startProperty,
  endProperty,
  anchor,
  onAddRow,
}: {
  rows: Row[];
  properties: Property[];
  startProperty: Property | undefined;
  /** optional: rows spanning to a later date appear in every week they cover */
  endProperty: Property | undefined;
  /** yyyy-mm-dd inside the week that counts as Week 1 */
  anchor: string;
  onAddRow: (presets?: Record<string, PropertyValue>) => void;
}) {
  const today = todayIso();

  const chipProperties = properties
    .filter(
      (p) =>
        p.type === "select" && p.id !== startProperty?.id && p.id !== endProperty?.id,
    )
    .slice(0, 2);

  const { byWeek, undated } = useMemo(() => {
    const byWeek = new Map<number, Placed[]>();
    const undated: Row[] = [];
    if (!startProperty) return { byWeek, undated };

    for (const row of rows) {
      const placements = placementsFor(
        row.properties[startProperty.id],
        endProperty ? row.properties[endProperty.id] : null,
        anchor,
      );
      if (placements.length === 0) {
        undated.push(row);
        continue;
      }
      for (const { index, isStart } of placements) {
        const list = byWeek.get(index) ?? [];
        list.push({ row, isStart });
        byWeek.set(index, list);
      }
    }
    return { byWeek, undated };
  }, [rows, startProperty, endProperty, anchor]);

  if (!startProperty) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Week views place rows by a date property. Add one, then pick it under
        “Weeks”.
      </p>
    );
  }

  const weeks = weekRange([...byWeek.keys()], anchor, today);

  return (
    <div data-testid="week-view" className="flex flex-col gap-4">
      {weeks.map((index) => {
        const span = weekSpan(index, anchor, today);
        const items = byWeek.get(index) ?? [];
        return (
          <section key={index} className="flex flex-col">
            <div
              className={cn(
                "flex items-baseline gap-2 border-b pb-1",
                span.isCurrent && "border-foreground/40",
              )}
            >
              <h3
                className={cn(
                  "text-sm font-semibold",
                  span.isCurrent ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {index > 0 ? `Week ${index}` : "Before Week 1"}
              </h3>
              <span className="text-xs text-muted-foreground">
                {weekLabel(span)}
              </span>
              {span.isCurrent ? (
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                  This week
                </Badge>
              ) : null}
              <span className="ml-auto text-xs text-muted-foreground">
                {items.length || ""}
              </span>
            </div>

            <div className="flex flex-col divide-y">
              {items.map(({ row, isStart }) => (
                <div
                  key={`${row.pageId}-${index}`}
                  className={cn(
                    "group flex items-start justify-between gap-2 py-2 pl-2 text-sm",
                    !isStart && "border-l-2 border-muted-foreground/30 opacity-70",
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="truncate font-medium">
                        {row.title || "Untitled"}
                      </span>
                      {!isStart ? (
                        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                          cont.
                        </span>
                      ) : null}
                      <Link
                        href={`/app/p/${row.pageId}`}
                        aria-label="Open row"
                        className="hidden shrink-0 rounded p-0.5 hover:bg-muted group-hover:block"
                      >
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatDateDisplay(row.properties[startProperty.id])}
                      {endProperty && row.properties[endProperty.id]
                        ? ` to ${formatDateDisplay(row.properties[endProperty.id])}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    {chipProperties.map((p) => {
                      const option = p.config.options?.find(
                        (o) => o.id === row.properties[p.id],
                      );
                      return option ? (
                        <Badge
                          key={p.id}
                          variant="secondary"
                          className={optionColorClass(option.color)}
                        >
                          {option.name}
                        </Badge>
                      ) : null;
                    })}
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => onAddRow({ [startProperty.id]: span.start })}
              className="mt-1 flex items-center gap-1 self-start rounded px-1 py-1 text-xs text-muted-foreground hover:bg-muted"
            >
              <Plus className="h-3 w-3" /> New
            </button>
          </section>
        );
      })}

      {undated.length > 0 ? (
        <section className="flex flex-col">
          <div className="flex items-baseline gap-2 border-b pb-1">
            <h3 className="text-sm font-semibold text-muted-foreground">
              No date
            </h3>
            <span className="ml-auto text-xs text-muted-foreground">
              {undated.length}
            </span>
          </div>
          <div className="flex flex-col divide-y">
            {undated.map((row) => (
              <Link
                key={row.pageId}
                href={`/app/p/${row.pageId}`}
                className="py-2 pl-2 text-sm font-medium hover:bg-muted/40"
              >
                {row.title || "Untitled"}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
