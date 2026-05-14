import { describe, it, expect, beforeEach } from "vitest";
import { applyPack } from "@/worker/subscription";
import { loadState, saveState } from "@/core/storage";
import { defaultState } from "@/core/schemas";
import { __resetStorage } from "../setup";

describe("applyPack", () => {
  beforeEach(async () => {
    __resetStorage();
    await saveState(defaultState());
  });

  it("writes source: 'pack' on imported keyword and user entries", async () => {
    await applyPack(
      {
        version: 1,
        name: "test-pack",
        keywords: [{ phrase: "airdrop scam" }],
        users: [{ handle: "spammer1", reason: "shill" }],
      },
      "test source",
      9999,
    );
    const s = await loadState();
    const kw = s.learned.keywords.find((k) => k.phrase === "airdrop scam");
    const usr = s.learned.users.find((u) => u.handle === "spammer1");
    expect(kw).toBeDefined();
    expect(kw!.source).toBe("pack");
    expect(kw!.reason).toBe("from test source");
    expect(usr).toBeDefined();
    expect(usr!.source).toBe("pack");
    expect(usr!.reason).toBe("shill");
  });

  it("user without pack-supplied reason falls back to 'from <source>'", async () => {
    await applyPack(
      { version: 1, keywords: [], users: [{ handle: "spammer2" }] },
      "starter pack",
      0,
    );
    const s = await loadState();
    const usr = s.learned.users.find((u) => u.handle === "spammer2");
    expect(usr!.reason).toBe("from starter pack");
    expect(usr!.source).toBe("pack");
  });
});
