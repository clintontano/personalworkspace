"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Clock } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fetchRelationOptions } from "@/lib/db/data";
import {
  datePart,
  formatDateDisplay,
  fromLocalInput,
  hasTime,
  toLocalInput,
} from "@/lib/db/date-value";
import type { Property, PropertyValue } from "@/lib/db/model";
import { cn } from "@/lib/utils";
import { optionColorClass } from "./option-colors";

export function PropertyCell({
  property,
  value,
  onChange,
  className,
}: {
  property: Property;
  value: PropertyValue;
  onChange: (value: PropertyValue) => void;
  className?: string;
}) {
  switch (property.type) {
    case "text":
    case "url":
      return (
        <TextCell
          value={typeof value === "string" ? value : ""}
          onCommit={(v) => onChange(v === "" ? null : v)}
          isUrl={property.type === "url"}
          className={className}
        />
      );
    case "number":
      return (
        <TextCell
          value={typeof value === "number" ? String(value) : ""}
          onCommit={(v) => {
            const n = Number(v);
            onChange(v === "" || Number.isNaN(n) ? null : n);
          }}
          align="right"
          className={className}
        />
      );
    case "checkbox":
      return (
        <div className={cn("flex items-center px-2 py-1", className)}>
          <Checkbox
            checked={value === true}
            onCheckedChange={(checked) => onChange(checked === true)}
          />
        </div>
      );
    case "date":
      return <DateCell value={value} onChange={onChange} className={className} />;
    case "select":
      return <SelectCell property={property} value={value} onChange={onChange} className={className} />;
    case "multi_select":
      return <MultiSelectCell property={property} value={value} onChange={onChange} className={className} />;
    case "relation":
      return <RelationCell property={property} value={value} onChange={onChange} className={className} />;
    default:
      return null;
  }
}

/**
 * A date value is all-day ("2026-08-29") or timed (full ISO). The clock
 * button switches between the two; the input type follows the value.
 */
/**
 * Dates read as "Jan 1 2026" rather than 01/01/2026.
 *
 * A native date input always renders in the browser's numeric locale format
 * and cannot be restyled, so the cell shows formatted text at rest and swaps
 * to the native input while editing — which keeps the built-in calendar
 * picker instead of hand-rolling one.
 */
function DateCell({
  value,
  onChange,
  className,
}: {
  value: PropertyValue;
  onChange: (value: PropertyValue) => void;
  className?: string;
}) {
  const timed = hasTime(value);
  const [editing, setEditing] = useState(false);

  return (
    <div className={cn("group/date flex items-center gap-1 px-2 py-1", className)}>
      {editing ? (
        timed ? (
          <input
            type="datetime-local"
            aria-label="Date and time"
            autoFocus
            value={toLocalInput(value)}
            onChange={(e) => onChange(fromLocalInput(e.target.value))}
            onBlur={() => setEditing(false)}
            className="w-full bg-transparent text-sm outline-none"
          />
        ) : (
          <input
            type="date"
            aria-label="Date"
            autoFocus
            value={datePart(value) ?? ""}
            onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
            onBlur={() => setEditing(false)}
            className="w-full bg-transparent text-sm outline-none"
          />
        )
      ) : (
        <button
          type="button"
          aria-label={value ? `Change date, currently ${formatDateDisplay(value)}` : "Set date"}
          data-date-value={value ? String(value) : ""}
          onClick={() => setEditing(true)}
          className={cn(
            "w-full truncate bg-transparent text-left text-sm outline-none",
            !value && "text-muted-foreground/50",
          )}
        >
          {value ? formatDateDisplay(value) : "Empty"}
        </button>
      )}
      {value ? (
        <button
          type="button"
          aria-label={timed ? "Remove time" : "Add time"}
          title={timed ? "Remove time" : "Add time"}
          onClick={() => {
            onChange(timed ? datePart(value) : fromLocalInput(toLocalInput(value)));
            // adding a time should let you set it straight away rather than
            // leaving a default sitting there
            if (!timed) setEditing(true);
          }}
          className={cn(
            "shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted-foreground/20",
            !timed && "opacity-0 group-hover/date:opacity-100",
          )}
        >
          <Clock className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

function TextCell({
  value,
  onCommit,
  isUrl,
  align,
  className,
}: {
  value: string;
  onCommit: (value: string) => void;
  isUrl?: boolean;
  align?: "right";
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);
  return (
    <input
      value={draft}
      onFocus={() => (editing.current = true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        editing.current = false;
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={cn(
        "w-full bg-transparent px-2 py-1 text-sm outline-none",
        isUrl && "text-blue-600 underline-offset-2 focus:no-underline dark:text-blue-400",
        align === "right" && "text-right",
        className,
      )}
    />
  );
}

function SelectCell({
  property,
  value,
  onChange,
  className,
}: {
  property: Property;
  value: PropertyValue;
  onChange: (value: PropertyValue) => void;
  className?: string;
}) {
  const options = property.config.options ?? [];
  const current = options.find((o) => o.id === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn("flex w-full items-center px-2 py-1 text-left", className)}
        >
          {current ? (
            <Badge variant="secondary" className={optionColorClass(current.color)}>
              {current.name}
            </Badge>
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((o) => (
          <DropdownMenuItem key={o.id} onClick={() => onChange(o.id)}>
            <Badge variant="secondary" className={optionColorClass(o.color)}>
              {o.name}
            </Badge>
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onClick={() => onChange(null)}>Clear</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MultiSelectCell({
  property,
  value,
  onChange,
  className,
}: {
  property: Property;
  value: PropertyValue;
  onChange: (value: PropertyValue) => void;
  className?: string;
}) {
  const options = property.config.options ?? [];
  const selected = Array.isArray(value) ? value : [];
  const toggle = (id: string) =>
    onChange(
      selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id],
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn("flex w-full flex-wrap items-center gap-1 px-2 py-1 text-left", className)}
        >
          {selected.length === 0 ? (
            <span className="text-sm text-muted-foreground">—</span>
          ) : (
            selected.map((id) => {
              const o = options.find((opt) => opt.id === id);
              return o ? (
                <Badge key={id} variant="secondary" className={optionColorClass(o.color)}>
                  {o.name}
                </Badge>
              ) : null;
            })
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.id}
            checked={selected.includes(o.id)}
            onCheckedChange={() => toggle(o.id)}
            onSelect={(e) => e.preventDefault()}
          >
            <Badge variant="secondary" className={optionColorClass(o.color)}>
              {o.name}
            </Badge>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RelationCell({
  property,
  value,
  onChange,
  className,
}: {
  property: Property;
  value: PropertyValue;
  onChange: (value: PropertyValue) => void;
  className?: string;
}) {
  const [options, setOptions] = useState<{ pageId: string; title: string }[] | null>(null);
  const selected = Array.isArray(value) ? value : [];
  const load = async () => {
    if (options === null && property.config.databaseId) {
      setOptions(await fetchRelationOptions(property.config.databaseId));
    }
  };
  const toggle = (id: string) =>
    onChange(
      selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id],
    );
  return (
    <DropdownMenu onOpenChange={(open) => open && void load()}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn("flex w-full items-center px-2 py-1 text-left text-sm", className)}
        >
          {selected.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span>{selected.length} linked</span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
        {options === null ? (
          <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
        ) : options.length === 0 ? (
          <DropdownMenuItem disabled>No rows in target database</DropdownMenuItem>
        ) : (
          options.map((o) => (
            <DropdownMenuCheckboxItem
              key={o.pageId}
              checked={selected.includes(o.pageId)}
              onCheckedChange={() => toggle(o.pageId)}
              onSelect={(e) => e.preventDefault()}
            >
              {o.title}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
