import { describe, it, expect, beforeEach } from "vitest";
import { Queue } from "@/worker/queue";
import { loadState } from "@/core/storage";
import { __resetStorage } from "../setup";

const t = (id: string) => ({ tweetId: id, author: "a", text: "hi", observedAt: 1 });

describe("Queue", () => {
  beforeEach(() => __resetStorage());

  it("starts empty", async () => {
    const q = new Queue();
    await q.hydrate();
    expect(q.size()).toBe(0);
  });

  it("enqueue persists to storage", async () => {
    const q = new Queue();
    await q.hydrate();
    await q.enqueue(t("1"));
    const s = await loadState();
    expect(s.pending.queue).toHaveLength(1);
  });

  it("ring buffer drops oldest beyond cap", async () => {
    const q = new Queue();
    await q.hydrate();
    for (let i = 0; i < 205; i++) await q.enqueue(t(String(i)));
    expect(q.size()).toBe(200);
    expect(q.snapshot()[0]!.tweetId).toBe("5");
  });

  it("drainAll empties queue", async () => {
    const q = new Queue();
    await q.hydrate();
    await q.enqueue(t("1"));
    await q.enqueue(t("2"));
    const drained = await q.drainAll();
    expect(drained).toHaveLength(2);
    expect(q.size()).toBe(0);
    const s = await loadState();
    expect(s.pending.queue).toHaveLength(0);
  });

  it("dedupes by tweetId", async () => {
    const q = new Queue();
    await q.hydrate();
    await q.enqueue(t("1"));
    await q.enqueue(t("1"));
    expect(q.size()).toBe(1);
  });
});
