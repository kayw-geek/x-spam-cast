import type { ExtractedTweet } from "@/core/types";

export interface ScorerInput { keywords: string[]; users: string[]; }

export type ScoreReason =
  | { type: "keyword"; match: string }
  | { type: "user"; match: string };

export type ScoreResult = { spam: true; reason: ScoreReason } | { spam: false };

export class LocalScorer {
  private keywords: string[] = [];
  private userSet = new Set<string>();
  private userOriginal = new Map<string, string>();

  constructor(input: ScorerInput) { this.update(input); }

  update(input: ScorerInput): void {
    this.keywords = [...input.keywords];
    this.userSet.clear();
    this.userOriginal.clear();
    for (const u of input.users) {
      const lower = u.toLowerCase();
      this.userSet.add(lower);
      this.userOriginal.set(lower, u);
    }
  }

  score(t: Pick<ExtractedTweet, "tweetId" | "authorHandle" | "text" | "isReply"> & { displayName?: string }): ScoreResult {
    const handleLower = t.authorHandle.toLowerCase();
    if (this.userSet.has(handleLower)) {
      return { spam: true, reason: { type: "user", match: this.userOriginal.get(handleLower)! } };
    }
    const haystack = `${t.displayName ?? ""}\n${t.text}`;
    for (const kw of this.keywords) {
      if (haystack.includes(kw)) {
        return { spam: true, reason: { type: "keyword", match: kw } };
      }
    }
    return { spam: false };
  }
}
