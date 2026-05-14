import { describe, it, expect, vi, beforeEach } from "vitest";
import { LLMClient } from "@/worker/llmClient";

const cfg = { baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-test", model: "deepseek-chat" };

describe("LLMClient", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("posts to /chat/completions and returns parsed JSON + usage", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"spam_tweets":[],"candidate_keywords":[],"candidate_users":[]}' } }],
        usage: { prompt_tokens: 1234, completion_tokens: 56 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const c = new LLMClient(cfg);
    const result = await c.analyze({ system: "sys", user: "u" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.deepseek.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer sk-test" }),
      }),
    );
    expect(result.spam_tweets).toEqual([]);
    expect(result.usage).toEqual({ promptTokens: 1234, completionTokens: 56 });
  });

  it("returns 0 token counts when usage block is missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"spam_tweets":[],"candidate_keywords":[],"candidate_users":[]}' } }] }),
    }));
    const result = await new LLMClient(cfg).analyze({ system: "s", user: "u" });
    expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0 });
  });

  it("throws on non-200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "unauthorized" }));
    await expect(new LLMClient(cfg).analyze({ system: "s", user: "u" })).rejects.toThrow(/401/);
  });

  it("strips markdown fences from response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '```json\n{"spam_tweets":[],"candidate_keywords":[],"candidate_users":[]}\n```' } }] }),
    }));
    const result = await new LLMClient(cfg).analyze({ system: "s", user: "u" });
    expect(result.candidate_keywords).toEqual([]);
  });

  it("parses reason field on candidate_keywords", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          spam_tweets: [],
          candidate_keywords: [
            { phrase: "airdrop scam", evidence_tweet_ids: ["1", "2"], reason: "crypto giveaway lure" },
          ],
          candidate_users: [],
        }) } }],
      }),
    }));
    const result = await new LLMClient(cfg).analyze({ system: "s", user: "u" });
    expect(result.candidate_keywords).toEqual([
      { phrase: "airdrop scam", evidence_tweet_ids: ["1", "2"], reason: "crypto giveaway lure" },
    ]);
  });

  it("accepts candidate_keywords without reason field (back-compat)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          spam_tweets: [],
          candidate_keywords: [{ phrase: "airdrop scam", evidence_tweet_ids: ["1"] }],
          candidate_users: [],
        }) } }],
      }),
    }));
    const result = await new LLMClient(cfg).analyze({ system: "s", user: "u" });
    expect(result.candidate_keywords).toHaveLength(1);
    expect(result.candidate_keywords[0]).toEqual({ phrase: "airdrop scam", evidence_tweet_ids: ["1"] });
  });

  it("throws if response not parseable JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "not json at all" } }] }),
    }));
    await expect(new LLMClient(cfg).analyze({ system: "s", user: "u" })).rejects.toThrow();
  });
});
