"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { addMonths, monthGrid, monthLabel } from "@/lib/calendar/month";
import { datePart, formatTime, toInstant } from "@/lib/db/date-value";
import type { Property, PropertyValue, Row } from "@/lib/db/model";
import { cn } from "@/lib/utils";
import { optionColorClass } from "./option-colors";

export function CalendarView({
  rows,
  properties,
  dateProperty,
  onAddRow,
}: {
  rows: Row[];
  properties: Property[];
  dateProperty: Property | undefined;
  onAddRow: (presets?: Record<string, PropertyValue>) => void;
}) {
  const now = new Date();
  const [cursor, setCursor] = useState({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  });

  const chipProperty = properties.find(
    (p) => p.type === "select" && p.id !== dateProperty?.id,
  );

  const byDate = useMemo(() => {
    const map = new Map<string, Row[]>();
    if (!dateProperty) return map;
    for (const row of rows) {
      const key = datePart(row.properties[dateProperty.id]);
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    // Within a day, timed events run in clock order; all-day events lead.
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          (toInstant(a.properties[dateProperty.id]) ?? 0) -
          (toInstant(b.properties[dateProperty.id]) ?? 0),
      );
    }
    return map;
  }, [rows, dateProperty]);

  if (!dateProperty) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Calendar views place rows by a date property. Add one, then pick it in
        the view settings.
      </p>
    );
  }

  const weeks = monthGrid(cursor.year, cursor.month);

  return (
    <div data-testid="calendar-view" className="flex flex-col">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-semibold">
          {monthLabel(cursor.year, cursor.month)}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Previous month"
            onClick={() => setCursor(addMonths(cursor.year, cursor.month, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={() =>
              setCursor({ year: now.getFullYear(), month: now.getMonth() + 1 })
            }
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Next month"
            onClick={() => setCursor(addMonths(cursor.year, cursor.month, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-l border-t text-xs">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="border-b border-r px-2 py-1 text-muted-foreground">
            {d}
          </div>
        ))}
        {weeks.flat().map((day) => {
          const items = byDate.get(day.date) ?? [];
          return (
            <div
              key={day.date}
              onClick={() => onAddRow({ [dateProperty.id]: day.date })}
              className={cn(
                "group min-h-24 cursor-pointer border-b border-r p-1 align-top hover:bg-muted/40",
                !day.inMonth && "bg-muted/20 text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px]",
                  day.isToday && "bg-primary font-semibold text-primary-foreground",
                )}
              >
                {Number(day.date.slice(8, 10))}
              </span>
              <div className="mt-0.5 flex flex-col gap-0.5">
                {items.map((row) => {
                  const chipValue = chipProperty
                    ? row.properties[chipProperty.id]
                    : undefined;
                  const option = chipProperty?.config.options?.find(
                    (o) => o.id === chipValue,
                  );
                  return (
                    <Link
                      key={row.pageId}
                      href={`/app/p/${row.pageId}`}
                      onClick={(e) => e.stopPropagation()}
                      className={cn(
                        "truncate rounded px-1 py-0.5 text-[11px] hover:opacity-80",
                        option ? optionColorClass(option.color) : "bg-secondary",
                      )}
                    >
                      {formatTime(row.properties[dateProperty.id]) ? (
                        <span className="mr-1 opacity-70">
                          {formatTime(row.properties[dateProperty.id])}
                        </span>
                      ) : null}
                      {row.title || "Untitled"}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
