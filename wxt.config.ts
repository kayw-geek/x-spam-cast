import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  entrypointsDir: "../entrypoints",
  outDir: "dist",
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "XSpamCast",
    description: "LLM-powered X/Twitter spam filter with subscribable community packs",
    permissions: ["storage", "scripting", "alarms"],
    host_permissions: ["https://x.com/*", "https://twitter.com/*"],
    optional_host_permissions: ["<all_urls>"],
    action: { default_popup: "popup/index.html", default_title: "XSpamCast" },
  },
});
