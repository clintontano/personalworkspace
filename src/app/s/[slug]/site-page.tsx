import Link from "next/link";
import { notFound } from "next/navigation";
import { RenderBlocks } from "@/components/public/render-blocks";
import type { BlockRowLike } from "@/lib/blocks/sync";
import { createPublicClient } from "@/lib/public-client";

type SitePageData = {
  siteSlug: string;
  rootPageId: string;
  page: { id: string; title: string; icon: string | null };
  blocks: BlockRowLike[];
  children: { id: string; title: string; icon: string | null }[];
};

export async function SitePage({ slug, pageId }: { slug: string; pageId?: string }) {
  const supabase = createPublicClient();
  const { data } = await supabase.rpc("get_public_site_page", {
    p_slug: slug,
    p_page_id: pageId ?? undefined,
  });

  if (!data) notFound();
  const site = data as unknown as SitePageData;
  const isRoot = site.page.id === site.rootPageId;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      {!isRoot ? (
        <Link
          href={`/s/${site.siteSlug}`}
          className="mb-6 inline-block text-sm text-muted-foreground hover:underline"
        >
          ← Back
        </Link>
      ) : null}

      <h1 className="mb-6 text-4xl font-bold">
        {site.page.icon ? `${site.page.icon} ` : ""}
        {site.page.title || "Untitled"}
      </h1>

      <article className="text-[15px]">
        <RenderBlocks rows={site.blocks} />
      </article>

      {site.children.length > 0 ? (
        <nav className="mt-12 border-t pt-6">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Pages</h2>
          <ul className="flex flex-col gap-1">
            {site.children.map((child) => (
              <li key={child.id}>
                <Link
                  href={`/s/${site.siteSlug}/${child.id}`}
                  className="text-sm hover:underline"
                >
                  {child.icon ? `${child.icon} ` : ""}
                  {child.title || "Untitled"}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </main>
  );
}
