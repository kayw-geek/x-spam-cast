import { describe, it, expect, beforeEach } from "vitest";
import { loadState, saveState, mutateState } from "@/core/storage";
import { defaultState } from "@/core/schemas";
import { __resetStorage } from "../setup";

describe("storage", () => {
  beforeEach(() => __resetStorage());

  it("returns default state when storage empty", async () => {
    const state = await loadState();
    expect(state).toEqual(defaultState());
  });

  it("round-trips state", async () => {
    const s = defaultState();
    s.stats.totalAnalyzed = 42;
    await saveState(s);
    const loaded = await loadState();
    expect(loaded.stats.totalAnalyzed).toBe(42);
  });

  it("mutateState applies and persists", async () => {
    await mutateState((s) => { s.stats.totalLLMCalls += 1; });
    const loaded = await loadState();
    expect(loaded.stats.totalLLMCalls).toBe(1);
  });

  it("loadState repairs corrupt schema by returning defaults", async () => {
    await chrome.storage.local.set({ tsf_state: { garbage: true } });
    const loaded = await loadState();
    expect(loaded).toEqual(defaultState());
  });

  it("round-trips llm pricing fields", async () => {
    const s = defaultState();
    s.config.llm.pricePerMillionInput = 0.27;
    s.config.llm.pricePerMillionOutput = 1.10;
    await saveState(s);
    const loaded = await loadState();
    expect(loaded.config.llm.pricePerMillionInput).toBe(0.27);
    expect(loaded.config.llm.pricePerMillionOutput).toBe(1.10);
  });

  it("mutateState round-trips price assignment via Settings save pattern", async () => {
    // Simulates Settings.save() — replace whole config (the local React copy)
    const localConfig = {
      ...defaultState().config,
      llm: {
        baseUrl: "https://gateway.rightcapital.ai/api/v1",
        apiKey: "sk-rc-ai-fake",
        model: "anthropic/claude-opus-4.6",
        pricePerMillionInput: 15,
        pricePerMillionOutput: 75,
      },
    };
    await mutateState((s) => { s.config = localConfig; });
    const loaded = await loadState();
    expect(loaded.config.llm.pricePerMillionInput).toBe(15);
    expect(loaded.config.llm.pricePerMillionOutput).toBe(75);
    expect(loaded.config.llm.model).toBe("anthropic/claude-opus-4.6");
  });
});
