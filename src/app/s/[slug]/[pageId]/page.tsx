import { SitePage } from "../site-page";

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; pageId: string }>;
}) {
  const { slug, pageId } = await params;
  return <SitePage slug={slug} pageId={pageId} />;
}
