"use client";

import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The sidebar as a permanent column on wide screens and a dismissible drawer
 * on narrow ones.
 *
 * Rendered as a client wrapper around the server-rendered sidebar contents,
 * so the page tree and workspace query stay on the server; only the open/closed
 * state lives here.
 */
export function SidebarShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  // Escape closes the drawer, matching every other overlay on the platform.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* Opens the drawer; hidden once the sidebar is permanent. */}
      <button
        type="button"
        aria-label="Open menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={cn(
          "fixed top-3 left-3 z-30 flex h-9 w-9 items-center justify-center rounded-md",
          "border bg-background shadow-sm md:hidden",
          open && "hidden",
        )}
      >
        <Menu className="h-4 w-4" />
      </button>

      {open ? (
        <button
          type="button"
          aria-label="Close menu"
          tabIndex={-1}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
        />
      ) : null}

      <aside
        data-testid="sidebar"
        data-open={open}
        // Tapping a link should reveal the page, not leave the drawer over it.
        // Handled on the click rather than by watching the pathname: React
        // Compiler forbids setting state synchronously inside an effect.
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) setOpen(false);
        }}
        className={cn(
          // opaque as an overlay drawer; the translucent tint is only right
          // when it sits beside the content as a column
          "flex w-64 shrink-0 flex-col border-r bg-background md:bg-muted/30",
          // Drawer below md, ordinary column at md and up.
          "fixed inset-y-0 left-0 z-40 transition-transform duration-200 md:static md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent md:hidden"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </aside>
    </>
  );
}
