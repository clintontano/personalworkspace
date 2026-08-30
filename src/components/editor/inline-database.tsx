"use client";

import { Database as DatabaseIcon } from "lucide-react";
import { Suspense, use, useMemo } from "react";
import { DatabaseScreen } from "@/components/database/database-screen";
import type { DatabaseBundleData } from "@/lib/db/bundle";
import { fetchDatabaseBundle, type DatabaseBundle } from "@/lib/db/data";

// Promises are cached per database id so re-renders of the editor (which are
// frequent while typing) do not refetch, and so `use()` gets a stable promise.
const bundleCache = new Map<string, Promise<DatabaseBundle | null>>();

function loadBundle(databaseId: string): Promise<DatabaseBundle | null> {
  let promise = bundleCache.get(databaseId);
  if (!promise) {
    promise = fetchDatabaseBundle(databaseId);
    bundleCache.set(databaseId, promise);
  }
  return promise;
}

/** Drop a database's cached data so the next render refetches it. */
export function invalidateInlineDatabase(databaseId: string) {
  bundleCache.delete(databaseId);
}

/**
 * Seed the cache with bundles fetched on the server, so an inline database
 * paints with the page rather than after a second round trip. Already-resolved
 * promises mean `use()` never suspends for these.
 */
export function seedInlineDatabases(bundles: DatabaseBundleData[]) {
  for (const bundle of bundles) {
    if (!bundleCache.has(bundle.pageId)) {
      bundleCache.set(
        bundle.pageId,
        Promise.resolve(bundle as unknown as DatabaseBundle),
      );
    }
  }
}

function Loaded({ databaseId, workspaceId }: { databaseId: string; workspaceId: string }) {
  const bundle = use(useMemo(() => loadBundle(databaseId), [databaseId]));

  if (!bundle) {
    return (
      <p className="px-3 py-4 text-sm text-muted-foreground">
        This database was deleted. Remove the block to tidy up.
      </p>
    );
  }

  return (
    <DatabaseScreen
      key={bundle.pageId}
      inline
      databasePageId={bundle.pageId}
      workspaceId={workspaceId}
      initialTitle={bundle.title}
      initialProperties={bundle.properties}
      initialViews={bundle.views}
      initialRows={bundle.rows}
    />
  );
}

function Skeleton() {
  return (
    <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
      <DatabaseIcon className="h-4 w-4" />
      Loading database…
    </div>
  );
}

/**
 * A database rendered inside another page's editor. Data is fetched through
 * `use()` with a cached promise rather than an effect: React Compiler's lint
 * rejects synchronous setState in effects, and a suspending read is the
 * better fit here anyway.
 */
export function InlineDatabase({
  databaseId,
  workspaceId,
}: {
  databaseId: string;
  workspaceId: string;
}) {
  if (!databaseId) {
    return (
      <p className="px-3 py-4 text-sm text-muted-foreground">
        Empty database block.
      </p>
    );
  }

  return (
    <div
      // contentEditable={false}: this is a widget, not editor text — without
      // it typing inside the database would be captured by the editor.
      contentEditable={false}
      data-testid="inline-database"
      className="group/inline-db my-3 w-full"
    >
      <Suspense fallback={<Skeleton />}>
        <Loaded databaseId={databaseId} workspaceId={workspaceId} />
      </Suspense>
    </div>
  );
}
