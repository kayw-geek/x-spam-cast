import type { HideStyle } from "@/core/constants";
import type { ScoreReason } from "./scorer";

const HIDE_ATTR = "data-tsf-hidden";

export class Hider {
  constructor(private style: HideStyle) {}
  setStyle(s: HideStyle): void { this.style = s; }

  hide(el: HTMLElement, reason: ScoreReason): void {
    if (el.hasAttribute(HIDE_ATTR)) return;
    el.setAttribute(HIDE_ATTR, this.style);
    switch (this.style) {
      case "nuke":   el.style.display = "none"; break;
      case "collapse": this.collapseEl(el, reason); break;
    }
  }

  private collapseEl(el: HTMLElement, reason: ScoreReason): void {
    const banner = document.createElement("div");
    banner.style.cssText = "padding:8px 16px;color:#888;font-size:13px;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer;";
    const reasonText = reason.type === "keyword" ? `keyword "${reason.match}"` : `user @${reason.match}`;
    banner.textContent = `🚫 spam (${reasonText}) — click to expand`;
    banner.addEventListener("click", () => {
      banner.remove();
      el.style.display = "";
      el.removeAttribute(HIDE_ATTR);
    });
    el.style.display = "none";
    el.parentElement?.insertBefore(banner, el);
  }
}
