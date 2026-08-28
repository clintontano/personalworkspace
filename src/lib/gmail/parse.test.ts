import { describe, expect, it } from "vitest";
import {
  extractBody,
  header,
  parseAddress,
  parseMessage,
  summarizeThread,
  threadToMarkdown,
  type GmailMessage,
} from "./parse";

const b64 = (s: string) =>
  Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");

const message = (overrides: Partial<GmailMessage> = {}): GmailMessage => ({
  id: "m1",
  threadId: "t1",
  labelIds: ["INBOX"],
  snippet: "hello there",
  internalDate: "1787952000000",
  payload: {
    mimeType: "text/plain",
    headers: [
      { name: "From", value: "Ada Lovelace <ada@example.com>" },
      { name: "To", value: "me@example.com" },
      { name: "Subject", value: "Lunch?" },
    ],
    body: { data: b64("Are you free on Thursday?") },
  },
  ...overrides,
});

describe("header", () => {
  it("is case-insensitive and defaults to empty", () => {
    const part = message().payload!;
    expect(header(part, "subject")).toBe("Lunch?");
    expect(header(part, "Bogus")).toBe("");
  });
});

describe("parseAddress", () => {
  it("splits a display name from the address", () => {
    expect(parseAddress("Ada Lovelace <ada@example.com>")).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });

  it("handles quoted names", () => {
    expect(parseAddress('"Lovelace, Ada" <ada@example.com>')).toEqual({
      name: "Lovelace, Ada",
      email: "ada@example.com",
    });
  });

  it("handles a bare address", () => {
    expect(parseAddress("ada@example.com")).toEqual({
      name: "ada",
      email: "ada@example.com",
    });
  });
});

describe("extractBody", () => {
  it("decodes a base64url plain body", () => {
    expect(extractBody(message().payload)).toBe("Are you free on Thursday?");
  });

  it("prefers text/plain from a multipart message", () => {
    const body = extractBody({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/html", body: { data: b64("<p>html version</p>") } },
        { mimeType: "text/plain", body: { data: b64("plain version") } },
      ],
    });
    expect(body).toBe("plain version");
  });

  it("falls back to stripped html", () => {
    const body = extractBody({
      mimeType: "multipart/alternative",
      parts: [
        {
          mimeType: "text/html",
          body: { data: b64("<div>Hi <b>there</b></div><p>Second &amp; last</p>") },
        },
      ],
    });
    expect(body).toBe("Hi there\nSecond & last");
  });

  it("finds bodies nested in sub-parts and skips attachments", () => {
    const body = extractBody({
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "application/pdf",
          filename: "invoice.pdf",
          body: { attachmentId: "a1", data: b64("not the body") },
        },
        {
          mimeType: "multipart/alternative",
          parts: [{ mimeType: "text/plain", body: { data: b64("actual body") } }],
        },
      ],
    });
    expect(body).toBe("actual body");
  });

  it("returns empty for a missing payload", () => {
    expect(extractBody(undefined)).toBe("");
  });
});

describe("parseMessage", () => {
  it("pulls out the fields the inbox shows", () => {
    const parsed = parseMessage(message());
    expect(parsed.subject).toBe("Lunch?");
    expect(parsed.fromName).toBe("Ada Lovelace");
    expect(parsed.from).toBe("ada@example.com");
    expect(parsed.body).toBe("Are you free on Thursday?");
    expect(parsed.unread).toBe(false);
    expect(parsed.date).toBe(new Date(1787952000000).toISOString());
  });

  it("marks unread from labels and defaults the subject", () => {
    const parsed = parseMessage(
      message({
        labelIds: ["INBOX", "UNREAD"],
        payload: { headers: [{ name: "From", value: "x@y.z" }] },
      }),
    );
    expect(parsed.unread).toBe(true);
    expect(parsed.subject).toBe("(no subject)");
  });
});

describe("summarizeThread", () => {
  it("takes the subject from the first message and the sender from the last", () => {
    const summary = summarizeThread("t1", [
      message({ id: "m1" }),
      message({
        id: "m2",
        labelIds: ["INBOX", "UNREAD"],
        snippet: "sure, thursday works",
        payload: {
          headers: [
            { name: "From", value: "Me <me@example.com>" },
            { name: "Subject", value: "Re: Lunch?" },
          ],
          body: { data: b64("Thursday works") },
        },
      }),
    ]);
    expect(summary.subject).toBe("Lunch?");
    expect(summary.fromName).toBe("Me");
    expect(summary.messageCount).toBe(2);
    expect(summary.unread).toBe(true);
    expect(summary.snippet).toBe("sure, thursday works");
  });
});

describe("threadToMarkdown", () => {
  it("renders each message and drops quoted replies", () => {
    const markdown = threadToMarkdown([
      parseMessage(message()),
      parseMessage(
        message({
          id: "m2",
          payload: {
            headers: [{ name: "From", value: "Me <me@example.com>" }],
            body: { data: b64("Thursday works\n> Are you free on Thursday?") },
          },
        }),
      ),
    ]);
    expect(markdown).toContain("**Ada Lovelace**");
    expect(markdown).toContain("Are you free on Thursday?");
    expect(markdown).toContain("---");
    expect(markdown).toContain("Thursday works");
    expect(markdown).not.toContain("> Are you free");
  });
});
