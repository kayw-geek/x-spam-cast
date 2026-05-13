import { Queue } from "./queue";
import { LLMClient, type LLMAnalysisResult } from "./llmClient";
import { buildPrompt } from "./promptBuilder";
import { mutateState } from "@/core/storage";
import type { ExtensionState, Candidate, QueuedTweet } from "@/core/types";

export interface AnalyzeResult {
  newCandidates: Candidate[];
  analyzed: number;
  whitelistRejected: number; // candidates LLM proposed that were dropped by whitelist (post-filter)
}

export class BatchAnalyzer {
  constructor(private queue: Queue) {}

  shouldTrigger(state: ExtensionState): boolean {
    return this.queue.size() >= state.config.batchThreshold;
  }

  async analyze(state: ExtensionState): Promise<AnalyzeResult> {
    const tweets = await this.queue.drainAll();
    if (tweets.length === 0) return { newCandidates: [], analyzed: 0, whitelistRejected: 0 };

    if (!state.config.llm.apiKey) {
      // Re-enqueue and bail; user must configure
      for (const t of tweets) await this.queue.enqueue(t);
      throw new Error("LLM API key not configured");
    }

    const client = new LLMClient(state.config.llm);
    const prompt = buildPrompt(tweets, state.config.customPrompt);
    let result: LLMAnalysisResult;
    try {
      result = await client.analyze(prompt);
    } catch (e) {
      // Network/timeout/parse failure — re-enqueue so the batch isn't lost
      for (const t of tweets) await this.queue.enqueue(t);
      throw e;
    }

    const collected = collectCandidates(result, state, "batch");

    await mutateState((s) => {
      s.stats.totalAnalyzed += tweets.length;
      s.stats.totalLLMCalls += 1;
      s.stats.lastBatchAt = Date.now();
    });

    return { newCandidates: collected.newCandidates, analyzed: tweets.length, whitelistRejected: collected.whitelistRejected };
  }

  // Single high-signal tweet (user explicitly marked as spam via 🚮). Run a focused LLM
  // pass to extract patterns even when the tweet alone doesn't meet batch threshold.
  async analyzeMarkedTweet(tweet: QueuedTweet, state: ExtensionState): Promise<AnalyzeResult> {
    if (!state.config.llm.apiKey) throw new Error("LLM API key not configured");
    const client = new LLMClient(state.config.llm);
    const prompt = buildPrompt([tweet], state.config.customPrompt);
    const result = await client.analyze(prompt);

    const collected = collectCandidates(result, state, `marked-tweet ${tweet.tweetId}`);

    await mutateState((s) => {
      s.pending.userMarked.push({ tweetId: tweet.tweetId, markedAt: Date.now() });
      s.stats.totalLLMCalls += 1;
    });

    return { newCandidates: collected.newCandidates, analyzed: 1, whitelistRejected: collected.whitelistRejected };
  }
}

function collectCandidates(
  result: LLMAnalysisResult,
  state: ExtensionState,
  source: string,
): { newCandidates: Candidate[]; whitelistRejected: number } {
  // Post-filter: exact-match whitelist on LLM-proposed phrases / handles.
  // Pre-filter dropped on purpose — substring whitelist on tweet text was an evasion vector
  // (spammer can sneak whitelisted phrase into their bait to bypass detection).
  const wlKeywords = new Set(state.whitelist.keywords);
  const wlUsers = new Set(state.whitelist.users.map((u) => u.toLowerCase()));
  const learnedKeywords = new Set(state.learned.keywords.map((k) => k.phrase));
  const learnedUsers = new Set(state.learned.users.map((u) => u.handle.toLowerCase()));

  const newCandidates: Candidate[] = [];
  let whitelistRejected = 0;

  for (const k of result.candidate_keywords) {
    if (learnedKeywords.has(k.phrase)) continue;
    if (wlKeywords.has(k.phrase)) { whitelistRejected++; continue; }
    newCandidates.push({
      type: "keyword", value: k.phrase,
      evidence: k.evidence_tweet_ids, suggestedAt: Date.now(),
      llmReasoning: source === "batch" ? "spam pattern" : `from ${source}`,
    });
  }
  for (const u of result.candidate_users) {
    const lower = u.handle.toLowerCase();
    if (learnedUsers.has(lower)) continue;
    if (wlUsers.has(lower)) { whitelistRejected++; continue; }
    newCandidates.push({
      type: "user", value: u.handle,
      evidence: u.evidence_tweet_ids, suggestedAt: Date.now(),
      llmReasoning: source === "batch" ? u.reason : `${u.reason} (from ${source})`,
    });
  }

  return { newCandidates, whitelistRejected };
}
