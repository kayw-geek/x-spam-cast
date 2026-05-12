import type { SpamCategory, HideStyle } from "./constants";

export interface LLMConfig { baseUrl: string; apiKey: string; model: string; }

export interface Config {
  llm: LLMConfig;
  batchThreshold: number;
  hideStyle: HideStyle;
  enabledCategories: SpamCategory[];
  syncToTwitterMute: boolean;
  customPrompt?: string;
  subscriptionUrl?: string;
  subscriptionLastFetchedAt?: number;
  backupGistId?: string;
  backupGitHubToken?: string;
  backupAutoSync?: boolean;
  backupLastPushedAt?: number;
}

export interface LearnedKeyword {
  phrase: string;
  category: SpamCategory;
  addedAt: number;
  hits: number;
  syncedToTwitter: boolean;
}

export interface LearnedUser {
  handle: string;
  displayName?: string;
  restId?: string;
  reason: string;
  addedAt: number;
  syncedToTwitter: boolean;
}

export interface QueuedTweet {
  tweetId: string;
  author: string;
  displayName?: string;
  text: string;
  restId?: string;
  observedAt: number;
}

export interface Candidate {
  type: "keyword" | "user";
  value: string;
  category?: SpamCategory;
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
}

export interface ExtensionState {
  config: Config;
  learned: { keywords: LearnedKeyword[]; users: LearnedUser[] };
  whitelist: { keywords: string[]; users: string[] };
  pending: { queue: QueuedTweet[]; candidates: Candidate[]; userMarked: { tweetId: string; markedAt: number }[] };
  cache: { handleToRestId: Record<string, string>; handleToDisplayName: Record<string, string> };
  stats: Stats;
}

export interface ExtractedTweet {
  tweetId: string;
  authorHandle: string;
  displayName?: string;
  text: string;
  isReply: boolean;
  parentTweetId?: string;
  restId?: string;
}
