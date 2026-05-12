import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { TweetExtractor } from "@/content/extractor";

describe("TweetExtractor", () => {
  beforeEach(() => {
    document.body.innerHTML = readFileSync(
      path.resolve(__dirname, "../fixtures/tweet.html"),
      "utf-8",
    );
  });

  it("extracts top-level tweet with display name", () => {
    const e = new TweetExtractor();
    const articles = document.querySelectorAll('article[role="article"]');
    const tweet = e.extract(articles[0] as HTMLElement);
    expect(tweet).toMatchObject({
      tweetId: "1234567890",
      authorHandle: "spammer123",
      displayName: "SpammyMcSpamFace",
      text: "找情侣 加我vx123456",
      isReply: false,
    });
  });

  it("extracts reply with parent", () => {
    const e = new TweetExtractor();
    const articles = document.querySelectorAll('article[role="article"]');
    const tweet = e.extract(articles[1] as HTMLElement);
    expect(tweet).toMatchObject({
      tweetId: "9876543210",
      authorHandle: "replier",
      isReply: true,
    });
  });

  it("returns null for unparseable element", () => {
    const div = document.createElement("div");
    expect(new TweetExtractor().extract(div)).toBeNull();
  });
});
