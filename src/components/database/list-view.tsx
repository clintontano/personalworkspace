"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatDateDisplay } from "@/lib/db/date-value";
import type { Property, Row } from "@/lib/db/model";
import { optionColorClass } from "./option-colors";

export function ListView({
  rows,
  properties,
}: {
  rows: Row[];
  properties: Property[];
}) {
  const chipProperties = properties.filter(
    (p) => p.type === "select" || p.type === "date" || p.type === "checkbox",
  );
  return (
    <div className="flex flex-col">
      {rows.map((row) => (
        <Link
          key={row.pageId}
          href={`/app/p/${row.pageId}`}
          className="flex items-center justify-between gap-2 border-b px-2 py-2 text-sm hover:bg-muted/40"
        >
          <span className="font-medium">{row.title || "Untitled"}</span>
          <span className="flex items-center gap-2">
            {chipProperties.map((p) => {
              const value = row.properties[p.id];
              if (p.type === "select" && typeof value === "string") {
                const option = p.config.options?.find((o) => o.id === value);
                return option ? (
                  <Badge key={p.id} variant="secondary" className={optionColorClass(option.color)}>
                    {option.name}
                  </Badge>
                ) : null;
              }
              if (p.type === "date" && typeof value === "string") {
                return (
                  <span key={p.id} className="text-xs text-muted-foreground">
                    {formatDateDisplay(value)}
                  </span>
                );
              }
              if (p.type === "checkbox" && value === true) {
                return (
                  <Badge key={p.id} variant="secondary">
                    {p.name}
                  </Badge>
                );
              }
              return null;
            })}
          </span>
        </Link>
      ))}
      {rows.length === 0 ? (
        <p className="px-2 py-4 text-sm text-muted-foreground">No rows match.</p>
      ) : null}
    </div>
  );
}
