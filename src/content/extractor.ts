import type { ExtractedTweet } from "@/core/types";

export class TweetExtractor {
  extract(el: HTMLElement): ExtractedTweet | null {
    try {
      const userNameBlock = el.querySelector('[data-testid="User-Name"]');
      if (!userNameBlock) return null;

      const links = userNameBlock.querySelectorAll<HTMLAnchorElement>('a[role="link"]');
      let handle: string | null = null;
      let tweetId: string | null = null;
      let displayName: string | undefined;
      for (const a of links) {
        const href = a.getAttribute("href") ?? "";
        const statusMatch = href.match(/^\/([^/]+)\/status\/(\d+)/);
        if (statusMatch) { handle = statusMatch[1]!; tweetId = statusMatch[2]!; continue; }
        const profMatch = href.match(/^\/([^/]+)$/);
        if (profMatch && !handle) {
          handle = profMatch[1]!;
          // Display name is the visible text inside the profile link (first one in User-Name block)
          const txt = (a.textContent ?? "").replace(/\s+/g, " ").trim();
          if (txt && !displayName) displayName = txt;
        }
      }
      if (!handle || !tweetId) return null;

      const textNode = el.querySelector('[data-testid="tweetText"]');
      const text = textNode ? this.collectText(textNode) : "";

      const replyHeader = Array.from(el.querySelectorAll("div"))
        .some((d) => /^Replying to/i.test(d.textContent ?? ""));
      let parentTweetId: string | undefined;
      if (replyHeader) {
        const parentLinks = el.querySelectorAll<HTMLAnchorElement>('a[role="link"][href*="/status/"]');
        for (const a of parentLinks) {
          const m = a.getAttribute("href")?.match(/^\/[^/]+\/status\/(\d+)/);
          if (m && m[1] !== tweetId) { parentTweetId = m[1]; break; }
        }
      }

      const tweet: ExtractedTweet = {
        tweetId,
        authorHandle: handle,
        text,
        isReply: replyHeader,
      };
      if (displayName !== undefined) tweet.displayName = displayName;
      if (parentTweetId !== undefined) tweet.parentTweetId = parentTweetId;
      return tweet;
    } catch {
      return null;
    }
  }

  private collectText(node: Element): string {
    return (node.textContent ?? "").replace(/\s+/g, " ").trim();
  }
}
