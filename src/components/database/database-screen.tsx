"use client";

import { Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  addProperty,
  createRow,
  createView,
  saveViewConfig,
  type ViewConfig,
  type ViewRecord,
  type ViewType,
} from "@/lib/db/data";
import { evaluateFilter } from "@/lib/db/filters";
import type { Property, PropertyType, PropertyValue, Row } from "@/lib/db/model";
import { sortRows } from "@/lib/db/sorts";
import { archivePage, renamePage } from "@/lib/pages";
import { notifyPagesChanged } from "@/lib/realtime";
import { updateRowProperties } from "@/lib/db/data";
import { cn } from "@/lib/utils";
import { BoardView } from "./board-view";
import { ListView } from "./list-view";
import { TableView } from "./table-view";
import { ViewToolbar } from "./view-toolbar";

const SELECT_DEFAULT_OPTIONS = [
  { id: "opt-1", name: "Option 1", color: "blue" },
  { id: "opt-2", name: "Option 2", color: "green" },
  { id: "opt-3", name: "Option 3", color: "orange" },
];

export function DatabaseScreen({
  databasePageId,
  workspaceId,
  initialTitle,
  initialProperties,
  initialViews,
  initialRows,
}: {
  databasePageId: string;
  workspaceId: string;
  initialTitle: string;
  initialProperties: Property[];
  initialViews: ViewRecord[];
  initialRows: Row[];
}) {
  const [title, setTitle] = useState(initialTitle);
  const [properties, setProperties] = useState(initialProperties);
  const [views, setViews] = useState(initialViews);
  const [rows, setRows] = useState(initialRows);
  const [activeViewId, setActiveViewId] = useState(initialViews[0]?.id ?? null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const activeView = views.find((v) => v.id === activeViewId) ?? views[0];
  const propertiesById = useMemo(
    () => new Map(properties.map((p) => [p.id, p])),
    [properties],
  );

  const visibleRows = useMemo(() => {
    if (!activeView) return rows;
    const filtered = rows.filter((r) =>
      evaluateFilter(r, activeView.config.filter, propertiesById),
    );
    return sortRows(filtered, activeView.config.sorts ?? [], propertiesById);
  }, [rows, activeView, propertiesById]);

  const visibleProperties = useMemo(() => {
    const hidden = new Set(activeView?.config.hidden ?? []);
    return properties.filter((p) => !hidden.has(p.id));
  }, [properties, activeView]);

  const onTitleChange = (value: string) => {
    setTitle(value);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      void renamePage(databasePageId, value).then(() => notifyPagesChanged(workspaceId));
    }, 400);
  };

  const onRowTitleChange = (pageId: string, rowTitle: string) => {
    setRows((prev) =>
      prev.map((r) => (r.pageId === pageId ? { ...r, title: rowTitle } : r)),
    );
    void renamePage(pageId, rowTitle);
  };

  const onValueChange = (pageId: string, propertyId: string, value: PropertyValue) => {
    let merged: Record<string, PropertyValue> = {};
    setRows((prev) =>
      prev.map((r) => {
        if (r.pageId !== pageId) return r;
        merged = { ...r.properties, [propertyId]: value };
        return { ...r, properties: merged };
      }),
    );
    void updateRowProperties(pageId, merged);
  };

  const onAddRow = async (presets?: Record<string, PropertyValue>) => {
    const pageId = await createRow(databasePageId, workspaceId, presets ?? {});
    setRows((prev) => [
      ...prev,
      {
        pageId,
        title: "",
        icon: null,
        properties: presets ?? {},
        orderKey: "z" + prev.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
  };

  const onDeleteRow = (pageId: string) => {
    setRows((prev) => prev.filter((r) => r.pageId !== pageId));
    void archivePage(pageId);
  };

  const onAddProperty = async (name: string, type: PropertyType) => {
    const config =
      type === "select" || type === "multi_select"
        ? { options: SELECT_DEFAULT_OPTIONS }
        : {};
    const property = await addProperty(databasePageId, workspaceId, name, type, config);
    setProperties((prev) => [...prev, property]);
  };

  const onConfigChange = (config: ViewConfig) => {
    if (!activeView) return;
    setViews((prev) =>
      prev.map((v) => (v.id === activeView.id ? { ...v, config } : v)),
    );
    const timers = configTimers.current;
    const existing = timers.get(activeView.id);
    if (existing) clearTimeout(existing);
    timers.set(
      activeView.id,
      setTimeout(() => void saveViewConfig(activeView.id, config), 500),
    );
  };

  const onAddView = async (type: ViewType) => {
    const name = type.charAt(0).toUpperCase() + type.slice(1);
    const config: ViewConfig =
      type === "board" || type === "calendar"
        ? type === "board"
          ? { groupBy: properties.find((p) => p.type === "select")?.id }
          : { dateProperty: properties.find((p) => p.type === "date")?.id }
        : {};
    const view = await createView(databasePageId, workspaceId, type, name, config);
    setViews((prev) => [...prev, view]);
    setActiveViewId(view.id);
  };

  const groupByProperty = activeView?.config.groupBy
    ? propertiesById.get(activeView.config.groupBy)
    : undefined;

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col px-8 py-10">
      <input
        data-testid="page-title"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="Untitled database"
        className="mb-4 w-full bg-transparent text-4xl font-bold outline-none placeholder:text-muted-foreground/40"
      />

      <div className="mb-2 flex items-center justify-between border-b pb-1">
        <div className="flex items-center gap-1">
          {views.map((view) => (
            <button
              key={view.id}
              type="button"
              onClick={() => setActiveViewId(view.id)}
              className={cn(
                "rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted",
                view.id === activeView?.id && "bg-muted font-medium text-foreground",
              )}
            >
              {view.name}
            </button>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
                <Plus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {(["table", "board", "list", "calendar"] as ViewType[]).map((t) => (
                <DropdownMenuItem key={t} onClick={() => void onAddView(t)}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-center gap-1">
          {activeView ? (
            <ViewToolbar
              properties={properties}
              config={activeView.config}
              onConfigChange={onConfigChange}
              showGroupBy={activeView.type === "table" || activeView.type === "board"}
            />
          ) : null}
          <Button data-testid="add-row" size="sm" onClick={() => void onAddRow()}>
            New row
          </Button>
        </div>
      </div>

      {!activeView ? (
        <p className="text-sm text-muted-foreground">No views yet.</p>
      ) : activeView.type === "board" ? (
        <BoardView
          rows={visibleRows}
          properties={visibleProperties}
          groupBy={groupByProperty}
          onValueChange={onValueChange}
          onAddRow={(presets) => void onAddRow(presets)}
        />
      ) : activeView.type === "list" ? (
        <ListView rows={visibleRows} properties={visibleProperties} />
      ) : activeView.type === "calendar" ? (
        <p className="p-4 text-sm text-muted-foreground">
          Calendar views arrive in Phase 3.
        </p>
      ) : (
        <TableView
          rows={visibleRows}
          properties={visibleProperties}
          groupBy={activeView.type === "table" ? groupByProperty : undefined}
          onTitleChange={onRowTitleChange}
          onValueChange={onValueChange}
          onAddRow={(presets) => void onAddRow(presets)}
          onDeleteRow={onDeleteRow}
          onAddProperty={(name, type) => void onAddProperty(name, type)}
        />
      )}
    </div>
  );
}
