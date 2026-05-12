import { z } from "zod";
import { SPAM_CATEGORIES, HIDE_STYLES, DEFAULT_BATCH_THRESHOLD } from "./constants";
import type { ExtensionState } from "./types";

export const SpamCategoryEnum = z.enum(SPAM_CATEGORIES);
export const HideStyleEnum = z.enum(HIDE_STYLES);

export const LLMConfigSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string(),
  model: z.string().min(1),
});

export const ConfigSchema = z.object({
  llm: LLMConfigSchema,
  batchThreshold: z.number().int().positive(),
  hideStyle: HideStyleEnum,
  enabledCategories: z.array(SpamCategoryEnum),
  syncToTwitterMute: z.boolean(),
  customPrompt: z.string().optional(),
  subscriptionUrl: z.string().optional(),
  subscriptionLastFetchedAt: z.number().optional(),
  backupGistId: z.string().optional(),
  backupGitHubToken: z.string().optional(),
  backupAutoSync: z.boolean().optional(),
  backupLastPushedAt: z.number().optional(),
});

export const WhitelistSchema = z.object({
  keywords: z.array(z.string()).default([]),
  users: z.array(z.string()).default([]),
});

export const LearnedKeywordSchema = z.object({
  phrase: z.string().min(1),
  category: SpamCategoryEnum,
  addedAt: z.number(),
  hits: z.number().int().nonnegative(),
  syncedToTwitter: z.boolean(),
});

export const LearnedUserSchema = z.object({
  handle: z.string().min(1),
  displayName: z.string().optional(),
  restId: z.string().optional(),
  reason: z.string(),
  addedAt: z.number(),
  syncedToTwitter: z.boolean(),
});

export const QueuedTweetSchema = z.object({
  tweetId: z.string(),
  author: z.string(),
  displayName: z.string().optional(),
  text: z.string(),
  restId: z.string().optional(),
  observedAt: z.number(),
});

export const CandidateSchema = z.object({
  type: z.enum(["keyword", "user"]),
  value: z.string(),
  category: SpamCategoryEnum.optional(),
  evidence: z.array(z.string()),
  suggestedAt: z.number(),
  llmReasoning: z.string(),
});

export const StatsSchema = z.object({
  totalAnalyzed: z.number().int().nonnegative(),
  totalLLMCalls: z.number().int().nonnegative(),
  totalLocalHits: z.number().int().nonnegative(),
  last7DaysLLMCallRate: z.number().min(0).max(1),
  lastBatchAt: z.number(),
});

export const StateSchema = z.object({
  config: ConfigSchema,
  learned: z.object({
    keywords: z.array(LearnedKeywordSchema),
    users: z.array(LearnedUserSchema),
  }),
  whitelist: WhitelistSchema.default({ keywords: [], users: [] }),
  pending: z.object({
    queue: z.array(QueuedTweetSchema),
    candidates: z.array(CandidateSchema),
    userMarked: z.array(z.object({ tweetId: z.string(), markedAt: z.number() })),
  }),
  cache: z.object({
    handleToRestId: z.record(z.string(), z.string()),
    handleToDisplayName: z.record(z.string(), z.string()).default({}),
  }),
  stats: StatsSchema,
});

export const defaultState = (): ExtensionState => ({
  config: {
    llm: { baseUrl: "https://api.deepseek.com/v1", apiKey: "", model: "deepseek-chat" },
    batchThreshold: DEFAULT_BATCH_THRESHOLD,
    hideStyle: "collapse",
    enabledCategories: [...SPAM_CATEGORIES],
    syncToTwitterMute: true,
  },
  learned: { keywords: [], users: [] },
  whitelist: { keywords: [], users: [] },
  pending: { queue: [], candidates: [], userMarked: [] },
  cache: { handleToRestId: {}, handleToDisplayName: {} },
  stats: { totalAnalyzed: 0, totalLLMCalls: 0, totalLocalHits: 0, last7DaysLLMCallRate: 0, lastBatchAt: 0 },
});
