import type { HideStyle } from "./constants";

export interface LLMConfig { baseUrl: string; apiKey: string; model: string; }

export interface Config {
  llm: LLMConfig;
  batchThreshold: number;
  hideStyle: HideStyle;
  customPrompt?: string;
  subscriptionUrl?: string;
  subscriptionLastFetchedAt?: number;
}

export interface LearnedKeyword {
  phrase: string;
  addedAt: number;
  hits: number;
}

export interface LearnedUser {
  handle: string;
  displayName?: string;
  reason: string;
  addedAt: number;
}

export interface QueuedTweet {
  tweetId: string;
  author: string;
  displayName?: string;
  text: string;
  observedAt: number;
}

export interface Candidate {
  type: "keyword" | "user";
  value: string;
  evidence: string[];
  suggestedAt: number;
  llmReasoning: string;
}

export interface Stats {
  totalAnalyzed: number;
  totalLLMCalls: number;
  totalLocalHits: number;
  last7DaysLLMCallRate: number;
  lastBatchAt: number;
  // YYYY-MM-DD → tweets hidden that day. Pruned to last 30 days on every read.
  dailyHits: Record<string, number>;
}

export interface ExtensionState {
  config: Config;
  learned: { keywords: LearnedKeyword[]; users: LearnedUser[] };
  whitelist: { keywords: string[]; users: string[] };
  pending: { queue: QueuedTweet[]; candidates: Candidate[]; userMarked: { tweetId: string; markedAt: number }[] };
  cache: { handleToDisplayName: Record<string, string> };
  stats: Stats;
}

export interface ExtractedTweet {
  tweetId: string;
  authorHandle: string;
  displayName?: string;
  text: string;
  isReply: boolean;
  parentTweetId?: string;
}
