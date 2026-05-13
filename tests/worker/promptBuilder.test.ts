import { describe, it, expect } from "vitest";
import { buildPrompt } from "@/worker/promptBuilder";

describe("promptBuilder", () => {
  it("includes spam analyzer role + cluster heuristic in system prompt", () => {
    const { system, user } = buildPrompt([]);
    expect(system).toContain("Twitter/X spam analyzer");
    expect(system).toContain("coordinated shill cluster");
    expect(user).toBe("[]");
  });

  it("serializes tweets with handle, name, text fields", () => {
    const tweets = [
      { tweetId: "1", author: "a", displayName: "Alice 🔥", text: "x", observedAt: 0 },
      { tweetId: "2", author: "b", text: "y", observedAt: 0 },
    ];
    const { user } = buildPrompt(tweets);
    const parsed = JSON.parse(user);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ id: "1", handle: "a", name: "Alice 🔥", text: "x" });
    expect(parsed[1]).toEqual({ id: "2", handle: "b", name: "", text: "y" });
  });

  it("appends custom prompt as domain notes when provided", () => {
    const { system } = buildPrompt([], "Never mute @nytimes");
    expect(system).toContain("User-provided domain notes");
    expect(system).toContain("Never mute @nytimes");
  });

  it("appends a final format reminder after the custom block to lock JSON output", () => {
    const { system } = buildPrompt([], "Never mute @nytimes");
    const customIdx = system.indexOf("Never mute @nytimes");
    const reminderIdx = system.indexOf("Final reminder");
    expect(customIdx).toBeGreaterThan(0);
    expect(reminderIdx).toBeGreaterThan(customIdx);
  });

  it("omits custom block when not provided", () => {
    const { system } = buildPrompt([]);
    expect(system).not.toContain("User-provided domain notes");
    expect(system).not.toContain("Final reminder");
  });
});
