"use client";

import { ChevronRight, FileText, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { archivePage, createPage, fetchPages, type PageMeta } from "@/lib/pages";
import { workspaceChannel } from "@/lib/realtime";
import { notifyPagesChanged } from "@/lib/realtime";
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
  const router = useRouter();
  const pathname = usePathname();

  const refetch = useCallback(async () => {
    setPages(await fetchPages(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    const ch = workspaceChannel(workspaceId);
    ch.on("broadcast", { event: "pages" }, () => void refetch());
    // The channel object is shared for the tab's lifetime; listeners pile up
    // only if this component remounts, which it does not in the app shell.
  }, [workspaceId, refetch]);

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
      return (
        <div key={page.id}>
          <div
            className={cn(
              "group flex items-center gap-1 rounded-md px-1 py-1 text-sm hover:bg-accent",
              active && "bg-accent font-medium",
            )}
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
          >
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
              className="flex min-w-0 flex-1 items-center gap-1.5"
            >
              <span className="shrink-0 text-sm">
                {page.icon ?? <FileText className="h-3.5 w-3.5 text-muted-foreground" />}
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
    </div>
  );
}
