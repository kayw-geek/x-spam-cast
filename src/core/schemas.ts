import { z } from "zod";
import { HIDE_STYLES, DEFAULT_BATCH_THRESHOLD } from "./constants";
import type { ExtensionState } from "./types";

export const HideStyleEnum = z.enum(HIDE_STYLES);

export const LLMConfigSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string(),
  model: z.string().min(1),
  pricePerMillionInput: z.number().nonnegative().optional(),
  pricePerMillionOutput: z.number().nonnegative().optional(),
});

export const ConfigSchema = z.object({
  llm: LLMConfigSchema,
  batchThreshold: z.number().int().positive(),
  hideStyle: HideStyleEnum,
  customPrompt: z.string().optional(),
  subscriptionUrl: z.string().optional(),
  subscriptionLastFetchedAt: z.number().optional(),
});

export const WhitelistSchema = z.object({
  keywords: z.array(z.string()).default([]),
  users: z.array(z.string()).default([]),
});

export const LearnedKeywordSchema = z.object({
  phrase: z.string().min(1),
  addedAt: z.number(),
  hits: z.number().int().nonnegative(),
});

export const LearnedUserSchema = z.object({
  handle: z.string().min(1),
  displayName: z.string().optional(),
  reason: z.string(),
  addedAt: z.number(),
});

export const QueuedTweetSchema = z.object({
  tweetId: z.string(),
  author: z.string(),
  displayName: z.string().optional(),
  text: z.string(),
  observedAt: z.number(),
});

export const CandidateSchema = z.object({
  type: z.enum(["keyword", "user"]),
  value: z.string(),
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
  dailyHits: z.record(z.string(), z.number().int().nonnegative()).default({}),
  totalPromptTokens: z.number().int().nonnegative().default(0),
  totalCompletionTokens: z.number().int().nonnegative().default(0),
  dailyTokens: z.record(z.string(), z.object({
    p: z.number().int().nonnegative(),
    c: z.number().int().nonnegative(),
  })).default({}),
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
    handleToDisplayName: z.record(z.string(), z.string()).default({}),
  }),
  stats: StatsSchema,
});

export const defaultState = (): ExtensionState => ({
  config: {
    llm: { baseUrl: "https://api.deepseek.com/v1", apiKey: "", model: "deepseek-chat" },
    batchThreshold: DEFAULT_BATCH_THRESHOLD,
    hideStyle: "collapse",
  },
  learned: { keywords: [], users: [] },
  whitelist: { keywords: [], users: [] },
  pending: { queue: [], candidates: [], userMarked: [] },
  cache: { handleToDisplayName: {} },
  stats: {
    totalAnalyzed: 0, totalLLMCalls: 0, totalLocalHits: 0, last7DaysLLMCallRate: 0, lastBatchAt: 0,
    dailyHits: {}, totalPromptTokens: 0, totalCompletionTokens: 0, dailyTokens: {},
  },
});
