import { describe, it, expect } from "vitest";
import { buildPrompt } from "@/worker/promptBuilder";

describe("promptBuilder", () => {
  it("includes all category names in system prompt", () => {
    const { system, user } = buildPrompt([], ["spam", "nsfw", "scam"]);
    expect(system).toContain("marketing");
    expect(system).toContain("sexual");
    expect(system).toContain("scams");
    expect(user).toBe("[]");
  });

  it("serializes tweets with handle, name, text fields", () => {
    const tweets = [
      { tweetId: "1", author: "a", displayName: "Alice 🔥", text: "x", observedAt: 0 },
      { tweetId: "2", author: "b", text: "y", observedAt: 0 },
    ];
    const { user } = buildPrompt(tweets, ["spam"]);
    const parsed = JSON.parse(user);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ id: "1", handle: "a", name: "Alice 🔥", text: "x" });
    expect(parsed[1]).toEqual({ id: "2", handle: "b", name: "", text: "y" });
  });

  it("only mentions enabled categories", () => {
    const { system } = buildPrompt([], ["nsfw"]);
    expect(system).toContain("sexual");
    expect(system).not.toContain("scams");
  });

  it("appends custom prompt when provided", () => {
    const { system } = buildPrompt([], ["spam"], "Never mute @nytimes");
    expect(system).toContain("User custom rules");
    expect(system).toContain("Never mute @nytimes");
  });

  it("omits custom block when not provided", () => {
    const { system } = buildPrompt([], ["spam"]);
    expect(system).not.toContain("User custom rules");
  });
});
