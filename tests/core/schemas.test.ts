import { describe, it, expect } from "vitest";
import { ConfigSchema, LearnedKeywordSchema, StateSchema, defaultState } from "@/core/schemas";

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
});
