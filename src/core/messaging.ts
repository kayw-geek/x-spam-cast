import type { QueuedTweet, ExtractedTweet } from "./types";

export type Message =
  | { kind: "tweet/observed"; payload: QueuedTweet }
  | { kind: "tweet/markSpam"; payload: { tweetId: string; tweet: QueuedTweet } }
  | { kind: "batch/trigger"; payload?: undefined }
  | { kind: "learned/delete"; payload: { type: "keyword" | "user"; value: string } }
  | { kind: "whitelist/remove"; payload: { type: "keyword" | "user"; value: string } }
  | { kind: "muteSync/retry"; payload?: undefined }
  | { kind: "subscription/refresh"; payload?: undefined }
  | { kind: "backup/push"; payload?: undefined }
  | { kind: "backup/pull"; payload?: undefined }
  | { kind: "auth/captured"; payload: { bearer: string; csrf: string } }
  | { kind: "restId/update"; payload: { handle: string; restId: string } }
  | { kind: "stats/localHit"; payload?: undefined };

export async function send<M extends Message>(msg: M): Promise<unknown> {
  return chrome.runtime.sendMessage(msg);
}

export function onMessage(handler: (msg: Message, sender: chrome.runtime.MessageSender) => Promise<unknown> | unknown): void {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const result = handler(msg as Message, sender);
    if (result instanceof Promise) {
      result.then(sendResponse).catch((e) => sendResponse({ error: String(e) }));
      return true;
    }
    sendResponse(result);
    return false;
  });
}

export function tweetSignature(t: ExtractedTweet): QueuedTweet {
  const sig: QueuedTweet = {
    tweetId: t.tweetId,
    author: t.authorHandle,
    text: t.text,
    observedAt: Date.now(),
  };
  if (t.restId !== undefined) sig.restId = t.restId;
  if (t.displayName !== undefined) sig.displayName = t.displayName;
  return sig;
}
