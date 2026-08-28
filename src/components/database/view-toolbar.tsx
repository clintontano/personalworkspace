"use client";

import { ArrowUpDown, Eye, ListFilter, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ViewConfig } from "@/lib/db/data";
import type { FilterCondition, FilterGroup, FilterOp } from "@/lib/db/filters";
import { isGroup } from "@/lib/db/filters";
import type { Property } from "@/lib/db/model";
import type { Sort } from "@/lib/db/sorts";

const OPS_BY_TYPE: Record<string, { op: FilterOp; label: string; needsValue: boolean }[]> = {
  text: [
    { op: "contains", label: "contains", needsValue: true },
    { op: "not_contains", label: "does not contain", needsValue: true },
    { op: "eq", label: "is", needsValue: true },
    { op: "ne", label: "is not", needsValue: true },
    { op: "is_empty", label: "is empty", needsValue: false },
    { op: "is_not_empty", label: "is not empty", needsValue: false },
  ],
  number: [
    { op: "eq", label: "=", needsValue: true },
    { op: "ne", label: "≠", needsValue: true },
    { op: "gt", label: ">", needsValue: true },
    { op: "gte", label: "≥", needsValue: true },
    { op: "lt", label: "<", needsValue: true },
    { op: "lte", label: "≤", needsValue: true },
    { op: "is_empty", label: "is empty", needsValue: false },
    { op: "is_not_empty", label: "is not empty", needsValue: false },
  ],
  date: [
    { op: "on", label: "is on", needsValue: true },
    { op: "before", label: "is before", needsValue: true },
    { op: "after", label: "is after", needsValue: true },
    { op: "is_empty", label: "is empty", needsValue: false },
    { op: "is_not_empty", label: "is not empty", needsValue: false },
  ],
  checkbox: [
    { op: "eq", label: "is checked", needsValue: false },
    { op: "ne", label: "is unchecked", needsValue: false },
  ],
  select: [
    { op: "eq", label: "is", needsValue: true },
    { op: "ne", label: "is not", needsValue: true },
    { op: "is_empty", label: "is empty", needsValue: false },
    { op: "is_not_empty", label: "is not empty", needsValue: false },
  ],
  multi_select: [
    { op: "contains", label: "contains", needsValue: true },
    { op: "not_contains", label: "does not contain", needsValue: true },
    { op: "is_empty", label: "is empty", needsValue: false },
    { op: "is_not_empty", label: "is not empty", needsValue: false },
  ],
};
OPS_BY_TYPE.url = OPS_BY_TYPE.text;
OPS_BY_TYPE.relation = OPS_BY_TYPE.multi_select;

function typeOf(propertyId: string, properties: Property[]): string {
  if (propertyId === "title") return "text";
  return properties.find((p) => p.id === propertyId)?.type ?? "text";
}

export function ViewToolbar({
  properties,
  config,
  onConfigChange,
  showGroupBy,
}: {
  properties: Property[];
  config: ViewConfig;
  onConfigChange: (config: ViewConfig) => void;
  showGroupBy?: boolean;
}) {
  const flatConditions = (config.filter?.conditions ?? []).filter(
    (c): c is FilterCondition => !isGroup(c),
  );
  const sorts = config.sorts ?? [];
  const hidden = new Set(config.hidden ?? []);

  const setConditions = (conditions: FilterCondition[]) => {
    const filter: FilterGroup = {
      combinator: config.filter?.combinator ?? "and",
      conditions,
    };
    onConfigChange({ ...config, filter });
  };

  const updateCondition = (index: number, patch: Partial<FilterCondition>) => {
    const next = [...flatConditions];
    next[index] = { ...next[index], ...patch };
    setConditions(next);
  };

  const setSorts = (next: Sort[]) => onConfigChange({ ...config, sorts: next });

  const groupable = properties.filter((p) => p.type === "select" || p.type === "checkbox");

  return (
    <div className="flex items-center gap-1">
      {showGroupBy ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
              Group{config.groupBy ? ": " + (properties.find((p) => p.id === config.groupBy)?.name ?? "?") : ""}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuCheckboxItem
              checked={!config.groupBy}
              onCheckedChange={() => onConfigChange({ ...config, groupBy: undefined })}
            >
              None
            </DropdownMenuCheckboxItem>
            {groupable.map((p) => (
              <DropdownMenuCheckboxItem
                key={p.id}
                checked={config.groupBy === p.id}
                onCheckedChange={() => onConfigChange({ ...config, groupBy: p.id })}
              >
                {p.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
            <ListFilter className="h-4 w-4" />
            Filter{flatConditions.length > 0 ? ` (${flatConditions.length})` : ""}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[420px] p-3">
          <div className="flex flex-col gap-2">
            {flatConditions.map((condition, i) => {
              const type = typeOf(condition.property, properties);
              const ops = OPS_BY_TYPE[type] ?? OPS_BY_TYPE.text;
              const opMeta = ops.find((o) => o.op === condition.op) ?? ops[0];
              const property = properties.find((p) => p.id === condition.property);
              return (
                <div key={i} className="flex items-center gap-1">
                  <select
                    className="h-8 rounded-md border bg-transparent px-1 text-sm"
                    value={condition.property}
                    onChange={(e) =>
                      updateCondition(i, {
                        property: e.target.value,
                        op: (OPS_BY_TYPE[typeOf(e.target.value, properties)] ?? OPS_BY_TYPE.text)[0].op,
                        value: undefined,
                      })
                    }
                  >
                    <option value="title">Title</option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <select
                    className="h-8 rounded-md border bg-transparent px-1 text-sm"
                    value={condition.op}
                    onChange={(e) => updateCondition(i, { op: e.target.value as FilterOp })}
                  >
                    {ops.map((o) => (
                      <option key={o.op} value={o.op}>{o.label}</option>
                    ))}
                  </select>
                  {opMeta.needsValue ? (
                    type === "select" || type === "multi_select" ? (
                      <select
                        className="h-8 flex-1 rounded-md border bg-transparent px-1 text-sm"
                        value={typeof condition.value === "string" ? condition.value : ""}
                        onChange={(e) => updateCondition(i, { value: e.target.value })}
                      >
                        <option value="">—</option>
                        {(property?.config.options ?? []).map((o) => (
                          <option key={o.id} value={o.id}>{o.name}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={type === "number" ? "number" : type === "date" ? "date" : "text"}
                        className="h-8 flex-1 rounded-md border bg-transparent px-2 text-sm"
                        value={
                          typeof condition.value === "string" || typeof condition.value === "number"
                            ? String(condition.value)
                            : ""
                        }
                        onChange={(e) =>
                          updateCondition(i, {
                            value: type === "number" ? Number(e.target.value) : e.target.value,
                          })
                        }
                      />
                    )
                  ) : (
                    <div className="flex-1" />
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setConditions(flatConditions.filter((_, j) => j !== i))}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              );
            })}
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground"
                onClick={() =>
                  setConditions([
                    ...flatConditions,
                    { property: "title", op: "contains", value: "" },
                  ])
                }
              >
                <Plus className="h-3 w-3" /> Add filter
              </Button>
              {flatConditions.length > 1 ? (
                <select
                  className="h-7 rounded-md border bg-transparent px-1 text-xs"
                  value={config.filter?.combinator ?? "and"}
                  onChange={(e) =>
                    onConfigChange({
                      ...config,
                      filter: {
                        combinator: e.target.value as "and" | "or",
                        conditions: flatConditions,
                      },
                    })
                  }
                >
                  <option value="and">Match all (and)</option>
                  <option value="or">Match any (or)</option>
                </select>
              ) : null}
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
            <ArrowUpDown className="h-4 w-4" />
            Sort{sorts.length > 0 ? ` (${sorts.length})` : ""}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-3">
          <div className="flex flex-col gap-2">
            {sorts.map((sort, i) => (
              <div key={i} className="flex items-center gap-1">
                <select
                  className="h-8 flex-1 rounded-md border bg-transparent px-1 text-sm"
                  value={sort.property}
                  onChange={(e) => {
                    const next = [...sorts];
                    next[i] = { ...sort, property: e.target.value };
                    setSorts(next);
                  }}
                >
                  <option value="title">Title</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <select
                  className="h-8 rounded-md border bg-transparent px-1 text-sm"
                  value={sort.direction}
                  onChange={(e) => {
                    const next = [...sorts];
                    next[i] = { ...sort, direction: e.target.value as "asc" | "desc" };
                    setSorts(next);
                  }}
                >
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setSorts(sorts.filter((_, j) => j !== i))}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 self-start text-muted-foreground"
              onClick={() => setSorts([...sorts, { property: "title", direction: "asc" }])}
            >
              <Plus className="h-3 w-3" /> Add sort
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
            <Eye className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {properties.map((p) => (
            <DropdownMenuCheckboxItem
              key={p.id}
              checked={!hidden.has(p.id)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(checked) => {
                const next = new Set(hidden);
                if (checked) next.delete(p.id);
                else next.add(p.id);
                onConfigChange({ ...config, hidden: [...next] });
              }}
            >
              {p.name}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
