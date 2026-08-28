import { describe, expect, it } from "vitest";
import { isThemePreference, resolveTheme, THEME_STORAGE_KEY, themeInitScript } from "./theme";

describe("isThemePreference", () => {
  it("accepts the three valid settings", () => {
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("system")).toBe(true);
  });

  it("rejects anything else, including stale stored values", () => {
    expect(isThemePreference("Dark")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
    expect(isThemePreference("")).toBe(false);
  });
});

describe("resolveTheme", () => {
  it("passes explicit settings through untouched", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("resolves system to a concrete theme", () => {
    // jsdom is absent here, so systemTheme() takes its light fallback
    expect(["light", "dark"]).toContain(resolveTheme("system"));
  });
});

describe("themeInitScript", () => {
  it("references the same storage key the app reads", () => {
    expect(themeInitScript).toContain(THEME_STORAGE_KEY);
  });

  it("is self-contained and swallows storage errors", () => {
    expect(themeInitScript).toContain("catch");
    expect(themeInitScript.startsWith("(function()")).toBe(true);
  });
});
