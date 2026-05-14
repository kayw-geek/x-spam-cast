import { describe, it, expect } from "vitest";
import { candidateToLearned } from "@/worker/batchAnalyzer";
import type { Candidate } from "@/core/types";

describe("candidateToLearned", () => {
  it("converts a keyword candidate to LearnedKeyword with reason + source", () => {
    const c: Candidate = {
      type: "keyword",
      value: "airdrop scam",
      evidence: ["1", "2"],
      suggestedAt: 1000,
      llmReasoning: "crypto giveaway lure",
      source: "llm-batch",
    };
    const result = candidateToLearned(c, 5000);
    expect(result).toEqual({
      kind: "keyword",
      entry: {
        phrase: "airdrop scam",
        addedAt: 5000,
        hits: 0,
        reason: "crypto giveaway lure",
        source: "llm-batch",
      },
    });
  });

  it("converts a user candidate to LearnedUser with reason + source", () => {
    const c: Candidate = {
      type: "user",
      value: "spammer123",
      evidence: ["3"],
      suggestedAt: 1000,
      llmReasoning: "follow-train shill",
      source: "llm-marked",
    };
    const result = candidateToLearned(c, 5000);
    expect(result).toEqual({
      kind: "user",
      entry: {
        handle: "spammer123",
        reason: "follow-train shill",
        addedAt: 5000,
        source: "llm-marked",
      },
    });
  });

  it("falls back to llm-batch source when missing (back-compat for in-flight Candidates)", () => {
    const c: Candidate = {
      type: "keyword",
      value: "x",
      evidence: [],
      suggestedAt: 0,
      llmReasoning: "y",
    };
    const result = candidateToLearned(c, 0);
    expect(result.entry).toMatchObject({ source: "llm-batch" });
  });

  it("omits reason on keyword when llmReasoning is empty (no fake reason)", () => {
    const c: Candidate = {
      type: "keyword", value: "x", evidence: [], suggestedAt: 0, llmReasoning: "", source: "llm-batch",
    };
    const result = candidateToLearned(c, 0);
    expect(result.entry).not.toHaveProperty("reason");
  });
});
