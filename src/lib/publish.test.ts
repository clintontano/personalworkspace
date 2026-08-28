import { describe, expect, it } from "vitest";
import { slugify } from "./publish";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("My Great Page")).toMatch(/^my-great-page-[a-z0-9]{4}$/);
  });

  it("strips punctuation and collapses separators", () => {
    expect(slugify("Hello, World!! -- again")).toMatch(/^hello-world-again-[a-z0-9]{4}$/);
  });

  it("falls back when nothing usable remains", () => {
    expect(slugify("!!!", "form")).toMatch(/^form-[a-z0-9]{4}$/);
  });

  it("truncates long titles", () => {
    const slug = slugify("a".repeat(100));
    expect(slug.split("-")[0]).toHaveLength(40);
  });

  it("produces distinct slugs for the same title", () => {
    expect(slugify("Same")).not.toBe(slugify("Same"));
  });
});
