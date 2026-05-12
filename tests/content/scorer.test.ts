import { describe, it, expect } from "vitest";
import { LocalScorer } from "@/content/scorer";

describe("LocalScorer", () => {
  it("matches keyword substring", () => {
    const s = new LocalScorer({ keywords: ["加我vx"], users: [] });
    expect(s.score({ tweetId: "1", authorHandle: "alice", text: "你好 加我vx 12345", isReply: false }))
      .toMatchObject({ spam: true, reason: { type: "keyword", match: "加我vx" } });
  });

  it("matches user handle case-insensitively", () => {
    const s = new LocalScorer({ keywords: [], users: ["SpammerBot"] });
    expect(s.score({ tweetId: "1", authorHandle: "spammerbot", text: "hi", isReply: false }))
      .toMatchObject({ spam: true, reason: { type: "user", match: "SpammerBot" } });
  });

  it("returns spam:false when no match", () => {
    const s = new LocalScorer({ keywords: ["加我vx"], users: [] });
    expect(s.score({ tweetId: "1", authorHandle: "alice", text: "今天天气不错", isReply: false }))
      .toEqual({ spam: false });
  });

  it("update() rebuilds index", () => {
    const s = new LocalScorer({ keywords: [], users: [] });
    s.update({ keywords: ["新词"], users: [] });
    expect(s.score({ tweetId: "1", authorHandle: "x", text: "包含新词", isReply: false }).spam).toBe(true);
  });

  it("empty keyword/user lists never match", () => {
    const s = new LocalScorer({ keywords: [], users: [] });
    expect(s.score({ tweetId: "1", authorHandle: "x", text: "anything", isReply: false }).spam).toBe(false);
  });

  it("matches keyword in display name (not just text)", () => {
    const s = new LocalScorer({ keywords: ["加vx"], users: [] });
    expect(s.score({ tweetId: "1", authorHandle: "innocent", displayName: "🔥兼职 加vx", text: "今天好开心", isReply: false }))
      .toMatchObject({ spam: true, reason: { type: "keyword", match: "加vx" } });
  });
});
