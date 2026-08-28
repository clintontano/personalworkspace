"use client";

import { Check, Copy, Globe } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fetchSite, publishSite, unpublishSite, type SiteRecord } from "@/lib/publish";

/** Publish this page (and its children) to a public URL. */
export function ShareMenu({
  pageId,
  workspaceId,
  title,
}: {
  pageId: string;
  workspaceId: string;
  title: string;
}) {
  const [site, setSite] = useState<SiteRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    if (loaded) return;
    setSite(await fetchSite(pageId));
    setLoaded(true);
  };

  const url = site?.published_at
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/s/${site.slug}`
    : null;

  return (
    <Popover onOpenChange={(open) => open && void load()}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
          <Globe className="h-4 w-4" />
          Share
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex flex-col gap-3 text-sm">
          <div>
            <p className="font-medium">Publish to web</p>
            <p className="text-xs text-muted-foreground">
              Anyone with the link can read this page and its sub-pages.
            </p>
          </div>

          {!loaded ? (
            <p data-testid="share-loading" className="text-xs text-muted-foreground">
              Loading…
            </p>
          ) : url ? (
            <>
              <div className="flex items-center gap-1">
                <input
                  readOnly
                  data-testid="site-url"
                  value={url}
                  className="h-8 flex-1 rounded-md border bg-muted px-2 text-xs"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Copy link"
                  onClick={() => {
                    void navigator.clipboard.writeText(url);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button asChild variant="outline" size="sm">
                  <a href={url} target="_blank" rel="noreferrer">Visit</a>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await unpublishSite(site!.id);
                    setSite({ ...site!, published_at: null });
                    setBusy(false);
                  }}
                >
                  Unpublish
                </Button>
              </div>
            </>
          ) : (
            <Button
              size="sm"
              disabled={busy}
              data-testid="publish-button"
              onClick={async () => {
                setBusy(true);
                setSite(await publishSite(pageId, workspaceId, title || "page"));
                setBusy(false);
              }}
            >
              {busy ? "Publishing…" : "Publish"}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
