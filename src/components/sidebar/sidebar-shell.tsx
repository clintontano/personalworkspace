"use client";

import { Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { readStoredCollapsed, writeStoredCollapsed } from "@/lib/sidebar";
import { cn } from "@/lib/utils";

// localStorage is an external store, so the collapse preference is read
// through useSyncExternalStore rather than mirrored into state by an effect
// (same reasoning as ThemeProvider): the server and the pre-hydration render
// must agree on "expanded", and this hook is what lets the real, possibly
// different, client value take over right after without a hydration warning.
const listeners = new Set<() => void>();

// Set on every change so the toggle still works when localStorage is blocked
// (private windows), where the stored value would otherwise never update.
let sessionCollapsed: boolean | null = null;

function getCollapsed(): boolean {
  return sessionCollapsed ?? readStoredCollapsed();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Another tab collapsing/expanding the sidebar fires "storage" here.
  const onStorage = () => {
    sessionCollapsed = null;
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * The sidebar as a permanent column on wide screens and a dismissible drawer
 * on narrow ones. On wide screens that permanent column can also be
 * collapsed, a separate, persisted preference from the drawer's open/closed
 * state.
 *
 * Rendered as a client wrapper around the server-rendered sidebar contents,
 * so the page tree and workspace query stay on the server; only the
 * open/closed and collapsed state lives here.
 */
export function SidebarShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const collapsed = useSyncExternalStore(subscribe, getCollapsed, () => false);

  const setCollapsed = useCallback((next: boolean) => {
    sessionCollapsed = next;
    writeStoredCollapsed(next);
    for (const listener of listeners) listener();
  }, []);

  // The visual collapse is driven entirely by the `data-sidebar-collapsed`
  // attribute (globals.css), not by a conditional class here — this keeps the
  // sidebar's own className identical between server and client, so there is
  // nothing for React to warn about. This effect just keeps that attribute in
  // step with the real value once hydration has run, the way ThemeProvider's
  // `applyTheme` keeps the `dark` class in step with the resolved theme.
  //
  // set/removeAttribute, not toggleAttribute: toggleAttribute's "present"
  // state is an empty string, not the literal "true" the CSS selector (and
  // sidebarInitScript, pre-hydration) match on.
  useEffect(() => {
    if (collapsed) {
      document.documentElement.setAttribute("data-sidebar-collapsed", "true");
    } else {
      document.documentElement.removeAttribute("data-sidebar-collapsed");
    }
  }, [collapsed]);

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

      {/* Re-expands the collapsed desktop column; only ever shown at md and
          up, and only while collapsed — the drawer button above covers
          mobile, and they never need to be visible at the same time. */}
      {collapsed && (
        <button
          type="button"
          aria-label="Expand sidebar"
          onClick={() => setCollapsed(false)}
          className="fixed top-3 left-3 z-30 hidden h-9 w-9 items-center justify-center rounded-md border bg-background shadow-sm md:flex"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      )}

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
          // Drawer below md, ordinary column at md and up. The collapsed
          // width itself is applied by globals.css off the <html> attribute,
          // not here — see the comment on the effect above.
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

        {/* Desktop-only counterpart to the mobile X above: collapses the
            permanent column instead of closing an overlay. */}
        <button
          type="button"
          aria-label="Collapse sidebar"
          onClick={() => setCollapsed(true)}
          className="absolute top-3 right-3 hidden h-8 w-8 items-center justify-center rounded-md hover:bg-accent md:inline-flex"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>

        {children}
      </aside>
    </>
  );
}
