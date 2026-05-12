import { defineContentScript } from "wxt/utils/define-content-script";
import { TweetExtractor } from "@/content/extractor";
import { LocalScorer } from "@/content/scorer";
import { Hider } from "@/content/hider";
import { MarkButton } from "@/content/markButton";
import { TSF_BRIDGE_TAG, type BridgeMessage } from "@/content/restIdSniffer";
import { loadState, subscribeState } from "@/core/storage";
import { send, tweetSignature } from "@/core/messaging";

export default defineContentScript({
  matches: ["https://x.com/*", "https://twitter.com/*"],
  runAt: "document_start",
  async main() {
    const state = await loadState();
    const scorer = new LocalScorer({
      keywords: state.learned.keywords.map((k) => k.phrase),
      users: state.learned.users.map((u) => u.handle),
    });
    const hider = new Hider(state.config.hideStyle);
    const extractor = new TweetExtractor();
    const markBtn = new MarkButton();

    subscribeState((s) => {
      scorer.update({
        keywords: s.learned.keywords.map((k) => k.phrase),
        users: s.learned.users.map((u) => u.handle),
      });
      hider.setStyle(s.config.hideStyle);
    });

    // Bridge: receive messages from MAIN-world sniffer via window.postMessage
    window.addEventListener("message", (ev) => {
      const data = ev.data as BridgeMessage | undefined;
      if (!data || data.tag !== TSF_BRIDGE_TAG) return;
      if (!chrome.runtime?.id) return; // extension reloaded — drop silently
      if (data.kind === "restId") {
        chrome.runtime.sendMessage({ kind: "restId/update", payload: { handle: data.handle, restId: data.restId } }).catch(() => {});
      } else if (data.kind === "auth") {
        chrome.runtime.sendMessage({ kind: "auth/captured", payload: { bearer: data.bearer, csrf: data.csrf } }).catch(() => {});
      }
    });

    // Detect extension reload — old content script keeps running on the page but its
    // chrome.* connection is dead. Short-circuit instead of throwing.
    const extensionAlive = (): boolean => Boolean(chrome.runtime?.id);

    const seen = new Set<string>();
    const processArticle = (article: HTMLElement): void => {
      const tweet = extractor.extract(article);
      if (!tweet) return;
      if (seen.has(tweet.tweetId)) return;
      seen.add(tweet.tweetId);
      const result = scorer.score(tweet);
      if (result.spam) {
        hider.hide(article, result.reason);
        if (extensionAlive()) chrome.runtime.sendMessage({ kind: "stats/localHit" }).catch(() => {});
        return;
      }
      markBtn.inject(article, tweet);
      if (extensionAlive()) send({ kind: "tweet/observed", payload: tweetSignature(tweet) }).catch(() => {});
    };

    const observer = new MutationObserver((muts) => {
      if (!extensionAlive()) { observer.disconnect(); return; }
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.matches?.('article[role="article"]')) processArticle(node);
          for (const a of node.querySelectorAll?.('article[role="article"]') ?? []) {
            processArticle(a as HTMLElement);
          }
        }
      }
    });

    const start = () => {
      observer.observe(document.body, { childList: true, subtree: true });
      for (const a of document.querySelectorAll<HTMLElement>('article[role="article"]')) {
        processArticle(a);
      }
    };
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
  },
});
