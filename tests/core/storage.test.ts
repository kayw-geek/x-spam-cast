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
});
