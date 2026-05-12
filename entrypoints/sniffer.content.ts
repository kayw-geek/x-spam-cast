import { defineContentScript } from "wxt/utils/define-content-script";
import { RestIdSniffer } from "@/content/restIdSniffer";

export default defineContentScript({
  matches: ["https://x.com/*", "https://twitter.com/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    new RestIdSniffer().install();
  },
});
