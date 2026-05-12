import type { ExtractedTweet } from "@/core/types";
import { send, tweetSignature } from "@/core/messaging";

const BTN_ATTR = "data-tsf-mark-btn";

export class MarkButton {
  inject(articleEl: HTMLElement, tweet: ExtractedTweet): void {
    if (articleEl.querySelector(`[${BTN_ATTR}]`)) return;
    const actionBar = articleEl.querySelector('[role="group"]');
    if (!actionBar) return;

    const btn = document.createElement("button");
    btn.setAttribute(BTN_ATTR, "1");
    btn.title = "Mark as spam";
    btn.textContent = "🚮";
    btn.style.cssText = "background:none;border:none;cursor:pointer;font-size:18px;padding:4px 8px;color:#888;";
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      btn.disabled = true;
      btn.textContent = "✓";
      // Optimistic DOM hide — user took decisive action, don't wait for round-trip
      articleEl.style.display = "none";
      console.log("[tsf] markSpam click", { handle: tweet.authorHandle, tweetId: tweet.tweetId });
      try {
        const r = await send({ kind: "tweet/markSpam", payload: { tweetId: tweet.tweetId, tweet: tweetSignature(tweet) } });
        console.log("[tsf] markSpam response", r);
      } catch (e) {
        console.warn("[tsf] markSpam failed (extension reloaded? refresh x.com tab)", e);
      }
    });
    actionBar.appendChild(btn);
  }
}
