"use client";

import { ChevronRight, Database, FileText, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createDatabase } from "@/lib/db/data";
import {
  archivePage,
  createPage,
  fetchPages,
  movePage,
  type PageMeta,
} from "@/lib/pages";
import { notifyPagesChanged, onBroadcast, pagesTopic } from "@/lib/realtime";
import {
  dropZone,
  isWithinSubtree,
  keyForAppend,
  keyForMove,
  type DropPosition,
} from "@/lib/reorder";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function PageTree({
  workspaceId,
  initialPages,
}: {
  workspaceId: string;
  initialPages: PageMeta[];
}) {
  const [pages, setPages] = useState(initialPages);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The dragged id is kept in a ref as well as state: dragover fires before
  // a state update from dragstart has flushed, and it must call
  // preventDefault() synchronously or the browser never treats the row as a
  // drop target.
  const draggingRef = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{
    id: string;
    zone: DropPosition | "inside";
  } | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  // Guards against overlapping refetches resolving out of order: only the
  // most recently started fetch is allowed to set state.
  const fetchSeq = useRef(0);

  const refetch = useCallback(async () => {
    const seq = ++fetchSeq.current;
    const fresh = await fetchPages(workspaceId);
    if (seq === fetchSeq.current) setPages(fresh);
  }, [workspaceId]);

  useEffect(
    () => onBroadcast(pagesTopic(workspaceId), "pages", () => void refetch()),
    [workspaceId, refetch],
  );

  const byParent = useMemo(() => {
    const map = new Map<string | null, PageMeta[]>();
    for (const p of pages) {
      const list = map.get(p.parent_page_id) ?? [];
      list.push(p);
      map.set(p.parent_page_id, list);
    }
    return map;
  }, [pages]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const addPage = async (parentId: string | null) => {
    const id = await createPage(workspaceId, parentId);
    notifyPagesChanged(workspaceId);
    if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
    router.push(`/app/p/${id}`);
  };

  const addDatabase = async () => {
    const id = await createDatabase(workspaceId, null);
    notifyPagesChanged(workspaceId);
    router.push(`/app/p/${id}`);
  };

  /**
   * Apply a drop: reposition the dragged page as a sibling of the target, or
   * nest it inside when the pointer is over the row's middle band.
   */
  const handleDrop = (
    targetId: string,
    zone: DropPosition | "inside",
    draggedId: string | null,
  ) => {
    draggingRef.current = null;
    setDragging(null);
    setDropHint(null);
    if (!draggedId || draggedId === targetId) return;

    // Moving a page into its own subtree would detach that branch entirely.
    if (isWithinSubtree(pages, draggedId, targetId)) return;

    const target = pages.find((p) => p.id === targetId);
    if (!target) return;

    const parentId = zone === "inside" ? targetId : target.parent_page_id;
    const siblings = pages.filter(
      (p) => p.parent_page_id === parentId && p.id !== draggedId,
    );
    const orderKey =
      zone === "inside"
        ? keyForAppend(siblings)
        : keyForMove(
            pages.filter((p) => p.parent_page_id === target.parent_page_id),
            draggedId,
            targetId,
            zone,
          );
    if (!orderKey) return;

    // Optimistic: the tree reorders under the pointer, then persists.
    setPages((prev) =>
      prev.map((p) =>
        p.id === draggedId
          ? { ...p, parent_page_id: parentId, order_key: orderKey }
          : p,
      ),
    );
    if (zone === "inside") setExpanded((prev) => new Set(prev).add(targetId));

    void (async () => {
      try {
        await movePage(draggedId, parentId, orderKey);
        notifyPagesChanged(workspaceId);
      } catch (error) {
        console.error("page move failed", error);
        void refetch();
      }
    })();
  };

  const remove = async (id: string) => {
    await archivePage(id);
    notifyPagesChanged(workspaceId);
    if (pathname === `/app/p/${id}`) router.push("/app");
  };

  const renderLevel = (parentId: string | null, depth: number) => {
    const children = byParent.get(parentId) ?? [];
    return children.map((page) => {
      const hasChildren = (byParent.get(page.id) ?? []).length > 0;
      const isOpen = expanded.has(page.id);
      const active = pathname === `/app/p/${page.id}`;
      const hint = dropHint?.id === page.id ? dropHint.zone : null;
      return (
        <div key={page.id}>
          <div
            data-tree-page={page.title}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/page-id", page.id);
              draggingRef.current = page.id;
              setDragging(page.id);
            }}
            onDragEnd={() => {
              draggingRef.current = null;
              setDragging(null);
              setDropHint(null);
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes("text/page-id")) return;
              const draggedId = draggingRef.current;
              if (draggedId === page.id) return;
              // never offer a drop that would detach the dragged subtree
              if (draggedId && isWithinSubtree(pages, draggedId, page.id)) return;
              // must happen synchronously for the drop to be accepted
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const rect = e.currentTarget.getBoundingClientRect();
              setDropHint({
                id: page.id,
                zone: dropZone(e.clientY - rect.top, rect.height, true),
              });
            }}
            onDragLeave={(e) => {
              // ignore moves onto this row's own children
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setDropHint((prev) => (prev?.id === page.id ? null : prev));
            }}
            onDrop={(e) => {
              e.preventDefault();
              // the payload is authoritative; state may lag a fast drag
              const draggedId =
                e.dataTransfer.getData("text/page-id") || draggingRef.current;
              const rect = e.currentTarget.getBoundingClientRect();
              const zone =
                dropHint?.id === page.id
                  ? dropHint.zone
                  : dropZone(e.clientY - rect.top, rect.height, true);
              handleDrop(page.id, zone, draggedId);
            }}
            className={cn(
              "group relative flex items-center gap-1 rounded-md px-1 py-1 text-sm hover:bg-accent",
              active && "bg-accent font-medium",
              dragging === page.id && "opacity-40",
              hint === "inside" && "ring-1 ring-primary ring-inset",
            )}
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
          >
            {hint === "before" || hint === "after" ? (
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-primary",
                  hint === "before" ? "top-0" : "bottom-0",
                )}
              />
            ) : null}
            <button
              type="button"
              aria-label={isOpen ? "Collapse" : "Expand"}
              onClick={() => toggle(page.id)}
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-muted-foreground/20",
                !hasChildren && "invisible",
              )}
            >
              <ChevronRight
                className={cn("h-3 w-3 transition-transform", isOpen && "rotate-90")}
              />
            </button>
            <Link
              href={`/app/p/${page.id}`}
              // anchors drag natively and would carry a URL payload instead
              // of starting the row drag
              draggable={false}
              className="flex min-w-0 flex-1 items-center gap-1.5"
            >
              <span className="shrink-0 text-sm">
                {page.icon ??
                  (page.isDatabase ? (
                    <Database className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  ))}
              </span>
              <span className="truncate">{page.title || "Untitled"}</span>
            </Link>
            <button
              type="button"
              aria-label="Add sub-page"
              onClick={() => void addPage(page.id)}
              className="hidden h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-muted-foreground/20 group-hover:flex"
            >
              <Plus className="h-3 w-3" />
            </button>
            <button
              type="button"
              aria-label="Delete page"
              onClick={() => void remove(page.id)}
              className="hidden h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-muted-foreground/20 group-hover:flex"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          {isOpen && renderLevel(page.id, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div className="flex flex-col gap-0.5">
      {renderLevel(null, 0)}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-1 justify-start gap-1.5 text-muted-foreground"
        onClick={() => void addPage(null)}
      >
        <Plus className="h-4 w-4" /> New page
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="justify-start gap-1.5 text-muted-foreground"
        onClick={() => void addDatabase()}
      >
        <Database className="h-4 w-4" /> New database
      </Button>
    </div>
  );
}
