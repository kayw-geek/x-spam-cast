import { mutateState, loadState } from "@/core/storage";
import type { QueuedTweet } from "@/core/types";
import { QUEUE_MAX } from "@/core/constants";

export class Queue {
  private items: QueuedTweet[] = [];
  private ids = new Set<string>();

  async hydrate(): Promise<void> {
    const s = await loadState();
    this.items = [...s.pending.queue];
    this.ids = new Set(this.items.map((i) => i.tweetId));
  }

  size(): number { return this.items.length; }
  snapshot(): QueuedTweet[] { return [...this.items]; }

  async enqueue(t: QueuedTweet): Promise<void> {
    if (this.ids.has(t.tweetId)) return;
    this.ids.add(t.tweetId);
    this.items.push(t);
    while (this.items.length > QUEUE_MAX) {
      const removed = this.items.shift();
      if (removed) this.ids.delete(removed.tweetId);
    }
    await mutateState((s) => { s.pending.queue = [...this.items]; });
  }

  async drainAll(): Promise<QueuedTweet[]> {
    const drained = [...this.items];
    this.items = [];
    this.ids.clear();
    await mutateState((s) => { s.pending.queue = []; });
    return drained;
  }
}
