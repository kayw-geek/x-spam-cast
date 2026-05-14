import { describe, it, expect } from "vitest";
import { ConfigSchema, LearnedKeywordSchema, LearnedUserSchema, StateSchema, defaultState } from "@/core/schemas";

describe("schemas", () => {
  it("validates default config", () => {
    const result = ConfigSchema.safeParse(defaultState().config);
    expect(result.success).toBe(true);
  });

  it("rejects invalid hideStyle", () => {
    const result = ConfigSchema.safeParse({
      llm: { baseUrl: "https://api.deepseek.com/v1", apiKey: "x", model: "deepseek-chat" },
      batchThreshold: 50,
      hideStyle: "explode",
      enabledCategories: ["spam"],
      syncToTwitterMute: true,
    });
    expect(result.success).toBe(false);
  });

  it("validates LearnedKeyword", () => {
    const result = LearnedKeywordSchema.safeParse({
      phrase: "加我vx",
      category: "spam",
      addedAt: 1234567,
      hits: 0,
      syncedToTwitter: false,
    });
    expect(result.success).toBe(true);
  });

  it("default state passes full StateSchema", () => {
    const result = StateSchema.safeParse(defaultState());
    expect(result.success).toBe(true);
  });

  it("LearnedKeyword parses old payload (no reason / source)", () => {
    const r = LearnedKeywordSchema.safeParse({
      phrase: "airdrop scam",
      addedAt: 1234567,
      hits: 3,
    });
    expect(r.success).toBe(true);
  });

  it("LearnedKeyword round-trips with reason + source", () => {
    const input = {
      phrase: "airdrop scam",
      addedAt: 1234567,
      hits: 3,
      reason: "typical crypto giveaway scam pattern",
      source: "llm-batch" as const,
    };
    const r = LearnedKeywordSchema.safeParse(input);
    expect(r.success).toBe(true);
    expect(r.data).toEqual(input);
  });

  it("LearnedUser parses old payload (no source)", () => {
    const r = LearnedUserSchema.safeParse({
      handle: "spammer123",
      reason: "manually added",
      addedAt: 1234567,
    });
    expect(r.success).toBe(true);
  });

  it("LearnedUser round-trips with source", () => {
    const r = LearnedUserSchema.safeParse({
      handle: "spammer123",
      reason: "follow-train shill",
      addedAt: 1234567,
      source: "llm-marked" as const,
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown source enum value", () => {
    const r = LearnedKeywordSchema.safeParse({
      phrase: "x", addedAt: 1, hits: 0, source: "voodoo",
    });
    expect(r.success).toBe(false);
  });
});
