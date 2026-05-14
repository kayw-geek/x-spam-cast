import type { HideStyle } from "./constants";

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  // Optional pricing in USD per 1M tokens. Used by the popup to render an
  // estimated cost stat. Defaults are auto-suggested from the model name.
  pricePerMillionInput?: number;
  pricePerMillionOutput?: number;
}

export interface Config {
  llm: LLMConfig;
  batchThreshold: number;
  hideStyle: HideStyle;
  customPrompt?: string;
  subscriptionUrl?: string;
  subscriptionLastFetchedAt?: number;
}

export type ReasonSource = "llm-batch" | "llm-marked" | "manual" | "pack";

export interface LearnedKeyword {
  phrase: string;
  addedAt: number;
  hits: number;
  reason?: string;
  source?: ReasonSource;
}

export interface LearnedUser {
  handle: string;
  displayName?: string;
  reason: string;
  addedAt: number;
  source?: ReasonSource;
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
  source?: ReasonSource;
}

export interface Stats {
  totalAnalyzed: number;
  totalLLMCalls: number;
  totalLocalHits: number;
  last7DaysLLMCallRate: number;
  lastBatchAt: number;
  // YYYY-MM-DD → tweets hidden that day. Pruned to last 30 days on every read.
  dailyHits: Record<string, number>;
  // Cumulative token usage across all LLM calls; nonexistent on old states.
  totalPromptTokens: number;
  totalCompletionTokens: number;
  // YYYY-MM-DD → { p: prompt tokens, c: completion tokens } for that day.
  // Same 30-day pruning as dailyHits.
  dailyTokens: Record<string, { p: number; c: number }>;
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
