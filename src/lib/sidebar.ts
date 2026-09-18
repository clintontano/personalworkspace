/**
 * Desktop sidebar collapse preference, mirroring theme.ts.
 *
 * Mobile's open/closed drawer state is ephemeral and lives entirely in
 * SidebarShell — this is the persisted, desktop-only "keep it collapsed"
 * choice, applied as a `data-sidebar-collapsed` attribute on <html> rather
 * than a React class. CSS reacting to that attribute (globals.css) means the
 * head script below can apply it before first paint, the same way
 * `themeInitScript` avoids a flash of the wrong theme.
 */

export const SIDEBAR_COLLAPSED_KEY = "workspace-sidebar-collapsed";

export function readStoredCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    // Private mode / blocked storage: default to expanded.
    return false;
  }
}

export function writeStoredCollapsed(collapsed: boolean) {
  try {
    if (collapsed) {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "true");
    } else {
      window.localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);
    }
  } catch {
    // Storage unavailable: the choice still holds for this tab.
  }
}

/**
 * Runs before first paint (inlined into <head>, next to themeInitScript) so
 * a collapsed sidebar does not flash open and then jump shut once React
 * hydrates and applies the same attribute via SidebarShell.
 */
export const sidebarInitScript = `(function(){try{if(localStorage.getItem('${SIDEBAR_COLLAPSED_KEY}')==='true'){document.documentElement.setAttribute('data-sidebar-collapsed','true');}}catch(e){}})();`;
