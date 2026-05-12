import { describe, it, expect, vi, beforeEach } from "vitest";
import { LLMClient } from "@/worker/llmClient";

const cfg = { baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-test", model: "deepseek-chat" };

describe("LLMClient", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("posts to /chat/completions and returns parsed JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"spam_tweets":[],"candidate_keywords":[],"candidate_users":[]}' } }] }),
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

  it("throws if response not parseable JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "not json at all" } }] }),
    }));
    await expect(new LLMClient(cfg).analyze({ system: "s", user: "u" })).rejects.toThrow();
  });
});
