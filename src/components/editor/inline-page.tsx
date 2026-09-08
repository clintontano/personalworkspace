"use client";

import { Database, FileText } from "lucide-react";
import Link from "next/link";
import { Suspense, use, useMemo } from "react";
import type { PageRef } from "@/lib/db/bundle";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * A sub-page linked from inside a page, the way Notion nests pages.
 *
 * The block stores only the page id: the page itself is an ordinary row in
 * `pages`, so it appears in the sidebar tree, opens as its own page, and is
 * reachable from the MCP server and export with no special casing — the same
 * arrangement inline databases use.
 */
const refCache = new Map<string, Promise<PageRef | null>>();

function loadRef(pageId: string): Promise<PageRef | null> {
  const cached = refCache.get(pageId);
  if (cached) return cached;

  const promise = (async (): Promise<PageRef | null> => {
    const supabase = createClient();
    const { data } = await supabase
      .from("pages")
      .select("id, title, icon, databases(page_id)")
      .eq("id", pageId)
      .is("archived_at", null)
      .maybeSingle();
    if (!data) return null;
    return {
      pageId: data.id,
      title: data.title,
      icon: data.icon,
      isDatabase: data.databases !== null,
    };
  })();

  refCache.set(pageId, promise);
  return promise;
}

/**
 * Seed titles fetched server-side so the link paints with the page instead of
 * after a client round trip. Idempotent, and never overwrites a live fetch.
 */
export function seedPageRefs(refs: PageRef[]) {
  for (const ref of refs) {
    if (!refCache.has(ref.pageId)) {
      refCache.set(ref.pageId, Promise.resolve(ref));
    }
  }
}

export function InlinePage({ pageId }: { pageId: string }) {
  if (!pageId) {
    return (
      <p className="my-1 text-sm text-muted-foreground">
        This page link has no target.
      </p>
    );
  }
  // The title is fetched, so the first render suspends. Without a boundary
  // here that suspension has nowhere to land inside the editor and the block
  // renders nothing at all.
  return (
    <Suspense fallback={<LinkSkeleton />}>
      <Loaded pageId={pageId} />
    </Suspense>
  );
}

function LinkSkeleton() {
  return (
    <span className="my-0.5 flex items-center gap-2 px-1.5 py-1">
      <span className="h-4 w-4 shrink-0 animate-pulse rounded bg-muted" />
      <span className="h-4 w-40 animate-pulse rounded bg-muted" />
    </span>
  );
}

function Loaded({ pageId }: { pageId: string }) {
  const ref = use(useMemo(() => loadRef(pageId), [pageId]));

  if (!ref) {
    return (
      <p
        data-testid="inline-page-missing"
        className="my-1 text-sm text-muted-foreground"
      >
        This linked page no longer exists.
      </p>
    );
  }

  return (
    <Link
      href={`/app/p/${ref.pageId}`}
      data-testid="inline-page"
      data-page-id={ref.pageId}
      // BlockNote blocks are draggable; an anchor would drag its URL instead
      draggable={false}
      className={cn(
        "my-0.5 flex items-center gap-2 rounded-md px-1.5 py-1 no-underline",
        "hover:bg-accent",
      )}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-sm">
        {ref.icon ??
          (ref.isDatabase ? (
            <Database className="h-4 w-4 text-muted-foreground" />
          ) : (
            <FileText className="h-4 w-4 text-muted-foreground" />
          ))}
      </span>
      <span className="truncate font-medium underline decoration-muted-foreground/40 underline-offset-4">
        {ref.title || "Untitled"}
      </span>
    </Link>
  );
}
