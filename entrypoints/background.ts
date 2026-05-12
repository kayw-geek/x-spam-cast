import { defineBackground } from "wxt/utils/define-background";
import { Queue } from "@/worker/queue";
import { BatchAnalyzer } from "@/worker/batchAnalyzer";
import { MuteSync, RateLimitError, type AuthTokens, type Transport, type TransportResponse } from "@/worker/muteSync";
import { refreshSubscription, type RefreshReport } from "@/worker/subscription";
import { pushBackup, pullBackup, type PushResult, type PullResult } from "@/worker/gistBackup";
import { loadState, mutateState } from "@/core/storage";
import { onMessage, type Message } from "@/core/messaging";
import { MUTE_RATE_LIMIT_MS } from "@/core/constants";
import type { Candidate, ExtensionState, LearnedUser } from "@/core/types";

const AUTH_STORAGE_KEY = "tsf_auth";

export default defineBackground(() => {
  const queue = new Queue();
  const analyzer = new BatchAnalyzer(queue);
  let auth: AuthTokens | null = null;
  let muteSync: MuteSync | null = null;

  void queue.hydrate();
  // Restore auth across SW restarts — MV3 kills idle workers, in-memory state is lost
  void chrome.storage.local.get([AUTH_STORAGE_KEY]).then((r) => {
    const storedAuth = r[AUTH_STORAGE_KEY] as AuthTokens | undefined;
    if (storedAuth?.bearer && storedAuth?.csrf) auth = storedAuth;
  });

  // Subscription auto-refresh on startup if subscriptionUrl set and last fetch > 24h ago.
  // Uses a runtime alarm guarded by lastFetchedAt to avoid hammering on every SW wakeup.
  const SUBSCRIPTION_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
  void loadState().then((s) => {
    const url = s.config.subscriptionUrl;
    const last = s.config.subscriptionLastFetchedAt ?? 0;
    if (url && Date.now() - last > SUBSCRIPTION_REFRESH_INTERVAL_MS) {
      refreshSubscription(url)
        .then((r) => {
          void chrome.storage.local.set({ tsf_last_subscription: r });
          if (r.ok && (r.newKeywords + r.newUsers) > 0) {
            return retrySync().then((sr) => chrome.storage.local.set({ tsf_last_sync: sr }));
          }
          return undefined;
        })
        .catch((e) => console.warn("[tsf] startup subscription refresh failed", e));
    }
  });

  // Gist backup — auto push every 10min if dirty (learned/whitelist changed),
  // startup pull if backup configured and local is empty (new browser recovery).
  const BACKUP_PUSH_INTERVAL_MS = 10 * 60 * 1000;
  let backupDirty = false;
  const doBackupPush = async (force = false): Promise<void> => {
    if (!force && !backupDirty) return;
    const s = await loadState();
    const token = s.config.backupGitHubToken;
    if (!token || !s.config.backupAutoSync) return;
    const result = await pushBackup(s, token, s.config.backupGistId);
    void chrome.storage.local.set({ tsf_last_backup_push: result });
    if (result.ok) {
      backupDirty = false;
      await mutateState((m) => {
        if (result.gistId) m.config.backupGistId = result.gistId;
        m.config.backupLastPushedAt = result.pushedAt;
      });
    }
  };

  // Mark dirty on any state change touching learned or whitelist.
  // Run with a small debounce-by-flag — periodic interval handles the actual push.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.tsf_state) return;
    const before = changes.tsf_state.oldValue as { learned?: unknown; whitelist?: unknown } | undefined;
    const after = changes.tsf_state.newValue as { learned?: unknown; whitelist?: unknown } | undefined;
    if (!before || !after) return;
    if (JSON.stringify(before.learned) !== JSON.stringify(after.learned) ||
        JSON.stringify(before.whitelist) !== JSON.stringify(after.whitelist)) {
      backupDirty = true;
    }
  });

  setInterval(() => { void doBackupPush(); }, BACKUP_PUSH_INTERVAL_MS);

  // Startup recovery: if backup configured AND local has no learned items, pull.
  // Don't auto-pull when local has data — would clobber user's session.
  void loadState().then(async (s) => {
    const { backupGitHubToken: token, backupGistId: gistId } = s.config;
    const localEmpty = s.learned.keywords.length === 0 && s.learned.users.length === 0;
    if (token && gistId && localEmpty) {
      const r = await pullBackup(token, gistId);
      void chrome.storage.local.set({ tsf_last_backup_pull: r });
      console.log("[tsf] startup pull", r.ok ? `restored ${r.learnedKeywords} kw / ${r.learnedUsers} users` : r.error);
    }
  });

  const persistAuth = (a: AuthTokens) => {
    auth = a;
    void chrome.storage.local.set({ [AUTH_STORAGE_KEY]: a });
  };

  // Capture bearer + csrf from x.com requests via webRequest. Robust to
  // extension reload (no need for fresh page-script injection on existing tabs).
  chrome.webRequest.onSendHeaders.addListener(
    (details) => {
      const headers = details.requestHeaders ?? [];
      let bearer: string | undefined;
      let csrf: string | undefined;
      for (const h of headers) {
        const name = h.name.toLowerCase();
        if (name === "authorization" && typeof h.value === "string") bearer = h.value;
        else if (name === "x-csrf-token" && typeof h.value === "string") csrf = h.value;
      }
      if (bearer && csrf) {
        const same = auth && auth.bearer === bearer && auth.csrf === csrf;
        if (!same) persistAuth({ bearer, csrf });
      }
    },
    { urls: ["https://x.com/i/api/*", "https://twitter.com/i/api/*"] },
    ["requestHeaders", "extraHeaders"],
  );

  // Twitter's API rejects requests where Origin/Referer don't match x.com.
  // Solution: dispatch the actual fetch from inside an open x.com tab via
  // chrome.scripting (MAIN world). The browser then sets all the right
  // same-origin headers automatically.
  const xcomTabTransport: Transport = async (url, init) => {
    const tabs = await chrome.tabs.query({ url: ["https://x.com/*", "https://twitter.com/*"] });
    const tab = tabs.find((t) => typeof t.id === "number");
    if (!tab?.id) {
      throw new Error("No x.com tab open — please open https://x.com to enable mute sync");
    }
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: async (u: string, method: string, headers: Record<string, string>, body: string): Promise<TransportResponse> => {
        const r = await fetch(u, { method, credentials: "include", headers, body });
        const text = await r.text().catch(() => "");
        return { ok: r.ok, status: r.status, bodyText: text };
      },
      args: [url, init.method, init.headers, init.body],
    });
    if (!result?.result) throw new Error("scripting executeScript returned no result");
    return result.result as TransportResponse;
  };

  const ensureMuteSync = (): MuteSync | null => {
    if (!auth) return null;
    if (!muteSync) muteSync = new MuteSync(auth, xcomTabTransport);
    else { muteSync.setAuth(auth); muteSync.setTransport(xcomTabTransport); }
    return muteSync;
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // X's API requires x-client-transaction-id (anti-bot fingerprint generated by their JS).
  // We can't replicate that, so for keyword mute we drive X's own UI: open settings tab,
  // type each keyword, click Save, repeat. X's JS handles transaction-id naturally.
  const PROGRESS_KEY = "tsf_progress";
  const setProgress = (p: { phase: string; total: number; completed: number; current?: string } | null) => {
    if (p === null) void chrome.storage.local.remove(PROGRESS_KEY);
    else void chrome.storage.local.set({ [PROGRESS_KEY]: p });
  };

  const bulkAddKeywordsViaUI = async (keywords: string[]): Promise<{ succeeded: string[]; failed: { keyword: string; reason: string }[] }> => {
    if (keywords.length === 0) return { succeeded: [], failed: [] };
    setProgress({ phase: "keywords", total: keywords.length, completed: 0 });
    const tab = await chrome.tabs.create({ url: "https://x.com/settings/muted_keywords", active: false });
    if (typeof tab.id !== "number") throw new Error("failed to create tab");
    const tabId = tab.id;

    const waitForLoad = (): Promise<void> => new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error("tab load timeout")); }, 20000);
      const listener = (changedId: number, info: chrome.tabs.OnUpdatedInfo) => {
        if (changedId === tabId && info.status === "complete") {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });

    await waitForLoad();
    await sleep(2000); // hydrate

    // Scrape existing muted to dedupe
    const [scrapeRes] = await chrome.scripting.executeScript({
      target: { tabId }, world: "MAIN",
      func: () => {
        const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-testid='cellInnerDiv'] span"));
        const existing: string[] = [];
        for (const r of rows) {
          const t = (r.textContent ?? "").trim();
          if (t && t.length < 80 && !/(notifications|home timeline|tweet replies|forever|until|added|delete|added on|exclude|do not notify|add muted)/i.test(t)) {
            existing.push(t);
          }
        }
        return existing;
      },
    });
    const existingMuted = new Set<string>((scrapeRes?.result as string[] | undefined) ?? []);

    const succeeded: string[] = [];
    const failed: { keyword: string; reason: string }[] = [];
    const toAdd: string[] = [];
    for (const k of keywords) {
      if (existingMuted.has(k)) succeeded.push(k);
      else toAdd.push(k);
    }
    // Flip syncedToTwitter for the already-existing ones immediately
    if (succeeded.length > 0) {
      await mutateState((s) => {
        for (const k of s.learned.keywords) if (succeeded.includes(k.phrase)) k.syncedToTwitter = true;
      });
    }
    setProgress({ phase: "keywords", total: keywords.length, completed: succeeded.length });

    const addOne = async (keyword: string): Promise<{ ok: boolean; reason?: string }> => {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN",
        func: async (kw: string): Promise<{ ok: boolean; reason?: string }> => {
          const sleepMs = (ms: number) => new Promise((res) => setTimeout(res, ms));
          const $ = <T extends Element = Element>(s: string) => document.querySelector(s) as T | null;
          const $$ = <T extends Element = Element>(s: string) => Array.from(document.querySelectorAll<T>(s));
          const waitFor = async <T>(fn: () => T | null | undefined, timeout = 12000): Promise<T> => {
            const start = Date.now();
            while (Date.now() - start < timeout) { const v = fn(); if (v) return v; await sleepMs(50); }
            throw new Error("wait timeout");
          };
          try {
            const findInput = (): HTMLInputElement | null =>
              ($("input[name='keyword'], input[name='Keyword']") as HTMLInputElement | null) ??
              ($$<HTMLInputElement>("input[type='text']").find((i) => (i as HTMLElement).offsetParent !== null) ?? null);
            const findSave = (): HTMLButtonElement | null =>
              ($("[data-testid='settingsDetailSave']") as HTMLButtonElement | null) ??
              ($$<HTMLButtonElement>("button").find((b) => /^\s*(save|add|done|保存|添加)\s*$/i.test(b.textContent ?? "")) ?? null);

            const input = await waitFor(findInput, 12000);
            input.focus();
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
            setter.call(input, kw);
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
            await sleepMs(30);
            const saveBtn = await waitFor(findSave, 4000);
            // If still disabled after a beat, re-fire events (React sometimes drops the first one before hydration).
            if (saveBtn.disabled) {
              input.dispatchEvent(new Event("input", { bubbles: true }));
              input.dispatchEvent(new Event("change", { bubbles: true }));
              await waitFor(() => (saveBtn.disabled ? null : true), 1200).catch(() => {});
            }
            if (saveBtn.disabled) return { ok: false, reason: "save button stayed disabled" };
            saveBtn.click();
            // Don't wait for X to navigate to the list page — the API request fires synchronously
            // from the click, outer loop's tabs.update will pre-empt the redirect. Just give the
            // network call a beat to leave the tab.
            await sleepMs(180);
            return { ok: true };
          } catch (e) {
            return { ok: false, reason: String(e instanceof Error ? e.message : e).slice(0, 100) };
          }
        },
        args: [keyword],
      });
      return (r?.result ?? { ok: false, reason: "no script result" }) as { ok: boolean; reason?: string };
    };

    for (let i = 0; i < toAdd.length; i++) {
      const kw = toAdd[i]!;
      setProgress({ phase: "keywords", total: keywords.length, completed: succeeded.length, current: kw });
      try {
        await chrome.tabs.update(tabId, { url: "https://x.com/settings/add_muted_keyword" });
        await waitForLoad();
        await sleep(180); // React hydration — re-fire fallback in addOne handles slow mounts
        const r = await addOne(kw);
        if (r.ok) {
          succeeded.push(kw);
          // Flip status immediately so popup ● updates live
          await mutateState((s) => {
            const x = s.learned.keywords.find((k) => k.phrase === kw);
            if (x) x.syncedToTwitter = true;
          });
        } else {
          failed.push({ keyword: kw, reason: r.reason ?? "unknown" });
        }
      } catch (e) {
        failed.push({ keyword: kw, reason: String(e instanceof Error ? e.message : e).slice(0, 100) });
      }
    }

    setProgress({ phase: "keywords", total: keywords.length, completed: succeeded.length });
    try { await chrome.tabs.remove(tabId); } catch { /* */ }
    return { succeeded, failed };
  };

  // Block users by driving X UI: navigate to each profile, open More menu, click Block, confirm.
  // Per-user executeScript orchestrated from background — within-script navigation tears down
  // the script context (location.href triggers full nav even in SPA), so each iteration must be
  // a fresh script invocation after we navigate the tab.
  const bulkBlockUsersViaUI = async (handles: string[]): Promise<{ succeeded: string[]; failed: { handle: string; reason: string }[] }> => {
    if (handles.length === 0) return { succeeded: [], failed: [] };
    setProgress({ phase: "users", total: handles.length, completed: 0 });

    const tab = await chrome.tabs.create({ url: `https://x.com/${handles[0]}`, active: false });
    if (typeof tab.id !== "number") throw new Error("failed to create tab");
    const tabId = tab.id;

    const waitForLoad = (): Promise<void> => new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error("tab load timeout")); }, 20000);
      const listener = (changedId: number, info: chrome.tabs.OnUpdatedInfo) => {
        if (changedId === tabId && info.status === "complete") {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });

    const blockOne = async (handle: string): Promise<{ ok: boolean; reason?: string }> => {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: async (h: string): Promise<{ ok: boolean; reason?: string }> => {
          const sleepMs = (ms: number) => new Promise((res) => setTimeout(res, ms));
          const $ = <T extends Element = Element>(s: string): T | null => document.querySelector(s);
          const $$ = <T extends Element = Element>(s: string): T[] => Array.from(document.querySelectorAll(s));
          const waitFor = async <T>(fn: () => T | null | undefined, timeout = 8000): Promise<T> => {
            const start = Date.now();
            while (Date.now() - start < timeout) {
              const v = fn(); if (v) return v;
              await sleepMs(150);
            }
            throw new Error("wait timeout");
          };
          // React only listens to real pointer/mouse events, not synthetic .click() in some menus
          const realClick = (el: HTMLElement) => {
            const rect = el.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
            el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerType: "mouse" }));
            el.dispatchEvent(new MouseEvent("mousedown", opts));
            el.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerType: "mouse" }));
            el.dispatchEvent(new MouseEvent("mouseup", opts));
            el.dispatchEvent(new MouseEvent("click", opts));
          };
          const findMenuItem = (re: RegExp): HTMLElement | null =>
            ($$<HTMLElement>("[role='menuitem']").find((m) => re.test((m.textContent ?? "").trim())) ?? null);
          try {
            // Sanity: profile loaded?
            const notFound = $$("span").some((s) => /(account doesn't exist|page is not available|hasn't been activated|此账号不存在)/i.test(s.textContent ?? ""));
            if (notFound) return { ok: false, reason: "account not found" };

            // Find the "More" button — prefer aria-label exact match (more reliable than testid which X reuses)
            const findMoreBtn = (): HTMLElement | null => {
              const byAria = $$("button").find((b) => {
                const al = (b.getAttribute("aria-label") ?? "").trim();
                return /^(more|更多|更多操作|更多選項)$/i.test(al);
              });
              if (byAria) return byAria as HTMLElement;
              // Fallback: testid (may be hijacked by promo on some accounts)
              return $("[data-testid='userActions']") as HTMLElement | null;
            };
            const moreBtn = await waitFor<HTMLElement>(findMoreBtn, 15000);

            // Detect & dismiss any X promo modal that may pop up instead of the menu
            const dismissPromoIfPresent = (): boolean => {
              const dialog = $("[role='dialog']");
              if (!dialog) return false;
              const txt = (dialog.textContent ?? "").toLowerCase();
              const isPromo = /(下载.*x|x premium|business|企业版|get the app|get the x app|premium for|订阅|subscribe)/i.test(txt);
              if (!isPromo) return false;
              // Find close/dismiss button
              const closeBtn = dialog.querySelector("[data-testid='app-bar-close']") ??
                dialog.querySelector("[aria-label='Close']") ??
                dialog.querySelector("[aria-label='关闭']") ??
                dialog.querySelector("button[aria-label*='lose']");
              if (closeBtn) realClick(closeBtn as HTMLElement);
              else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
              return true;
            };

            // Open menu reliably: click + wait for menuitems; retry up to 3 times with real pointer events
            let menuOpen = false;
            for (let attempt = 0; attempt < 3 && !menuOpen; attempt++) {
              if (attempt > 0) await sleepMs(500);
              realClick(moreBtn);
              await sleepMs(300);
              if (dismissPromoIfPresent()) {
                await sleepMs(400);
                continue; // retry — promo blocked the menu
              }
              try {
                await waitFor(() => $$<HTMLElement>("[role='menuitem']").length > 0 ? true : null, 2500);
                menuOpen = true;
              } catch { /* retry */ }
            }
            if (!menuOpen) return { ok: false, reason: "menu did not open after 3 click attempts" };

            const muteRe = /^mute @|^隐藏 @|^靜音 @|^静音 @/i;
            const unmuteRe = /^unmute @|^取消隐藏 @|^取消靜音 @|^取消静音 @/i;

            if (findMenuItem(unmuteRe)) {
              document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
              return { ok: true };
            }

            const muteItem = await waitFor<HTMLElement>(() => findMenuItem(muteRe), 5000);
            realClick(muteItem);
            // Mute applies immediately, no confirm sheet
            await sleepMs(800);
            return { ok: true };
          } catch (e) {
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            return { ok: false, reason: String(e instanceof Error ? e.message : e).slice(0, 100) };
          }
        },
        args: [handle],
      });
      return (r?.result ?? { ok: false, reason: "no script result" }) as { ok: boolean; reason?: string };
    };

    const succeeded: string[] = [];
    const failed: { handle: string; reason: string }[] = [];

    for (let i = 0; i < handles.length; i++) {
      const handle = handles[i]!;
      setProgress({ phase: "users", total: handles.length, completed: i, current: `@${handle}` });
      try {
        if (i === 0) {
          await waitForLoad();
        } else {
          await chrome.tabs.update(tabId, { url: `https://x.com/${handle}` });
          await waitForLoad();
        }
        // No fixed hydration sleep — blockOne uses waitFor with longer timeouts to handle hydration
        const r = await blockOne(handle);
        if (r.ok) {
          succeeded.push(handle);
          await mutateState((s) => {
            const x = s.learned.users.find((u) => u.handle.toLowerCase() === handle.toLowerCase());
            if (x) x.syncedToTwitter = true;
          });
        } else {
          failed.push({ handle, reason: r.reason ?? "unknown" });
        }
      } catch (e) {
        failed.push({ handle, reason: String(e instanceof Error ? e.message : e).slice(0, 100) });
      }
    }

    setProgress({ phase: "users", total: handles.length, completed: handles.length });
    try { await chrome.tabs.remove(tabId); } catch { /* user may have closed it */ }
    return { succeeded, failed };
  };

  const applyCandidate = async (candidate: Candidate, state: ExtensionState): Promise<void> => {
    await mutateState((s) => {
      if (candidate.type === "keyword") {
        if (s.learned.keywords.some((k) => k.phrase === candidate.value)) return; // already learned
        s.learned.keywords.push({
          phrase: candidate.value,
          category: candidate.category ?? "spam",
          addedAt: Date.now(),
          hits: 0,
          syncedToTwitter: false,
        });
      } else {
        const lower = candidate.value.toLowerCase();
        if (s.learned.users.some((u) => u.handle.toLowerCase() === lower)) return; // already learned
        const newUser: LearnedUser = {
          handle: candidate.value,
          reason: candidate.llmReasoning,
          addedAt: Date.now(),
          syncedToTwitter: false,
        };
        const cachedRest = s.cache.handleToRestId[candidate.value];
        if (cachedRest !== undefined) newUser.restId = cachedRest;
        const cachedDn = s.cache.handleToDisplayName[candidate.value];
        if (cachedDn !== undefined) newUser.displayName = cachedDn;
        s.learned.users.push(newUser);
      }
    });

    if (state.config.syncToTwitterMute) {
      const sync = ensureMuteSync();
      if (sync) {
        try {
          if (candidate.type === "keyword") {
            await sync.muteKeyword(candidate.value);
            await mutateState((s) => {
              const k = s.learned.keywords.find((x) => x.phrase === candidate.value);
              if (k) k.syncedToTwitter = true;
            });
          } else {
            const restId = state.cache.handleToRestId[candidate.value];
            if (restId) {
              await sync.muteUser(restId);
              await mutateState((s) => {
                const u = s.learned.users.find((x) => x.handle === candidate.value);
                if (u) u.syncedToTwitter = true;
              });
            }
          }
        } catch (e) {
          console.warn("[tsf] mute sync failed", e);
        }
      }
    }
  };

  interface RetryReport {
    ok: boolean;
    noAuth?: boolean;
    rateLimited?: boolean;
    attempted: number;
    succeeded: number;
    failed: { value: string; reason: string }[];
    removed: string[];
    usersSkippedNoRestId: number;
  }

  const retrySync = async (): Promise<RetryReport> => {
    const sync = ensureMuteSync();
    if (!sync) {
      return { ok: false, noAuth: true, attempted: 0, succeeded: 0, failed: [], removed: [], usersSkippedNoRestId: 0 };
    }
    const state = await loadState();
    const failed: { value: string; reason: string }[] = [];
    const removed: string[] = [];
    let attempted = 0, succeeded = 0, usersSkippedNoRestId = 0;
    let rateLimited = false;

    // Keywords go via UI automation (X's API requires anti-bot transaction-id we can't generate)
    const unsyncedKeywords = state.learned.keywords.filter((k) => !k.syncedToTwitter).map((k) => k.phrase);
    if (unsyncedKeywords.length > 0) {
      attempted += unsyncedKeywords.length;
      try {
        const r = await bulkAddKeywordsViaUI(unsyncedKeywords);
        succeeded += r.succeeded.length;
        await mutateState((s) => {
          for (const k of s.learned.keywords) {
            if (r.succeeded.includes(k.phrase)) k.syncedToTwitter = true;
          }
        });
        for (const f of r.failed) failed.push({ value: `kw:${f.keyword}`, reason: f.reason });
      } catch (e) {
        for (const k of unsyncedKeywords) {
          failed.push({ value: `kw:${k}`, reason: String(e instanceof Error ? e.message : e).slice(0, 100) });
        }
      }
    }
    if (rateLimited) {
      return { ok: false, rateLimited: true, attempted, succeeded, failed, removed, usersSkippedNoRestId };
    }
    // Users go via UI automation too — block via API also requires anti-bot transaction-id.
    // No rest_id needed since we navigate by handle URL directly.
    const unsyncedUsers = state.learned.users.filter((u) => !u.syncedToTwitter).map((u) => u.handle);
    if (unsyncedUsers.length > 0) {
      attempted += unsyncedUsers.length;
      try {
        const r = await bulkBlockUsersViaUI(unsyncedUsers);
        succeeded += r.succeeded.length;
        // Auto-remove failed users — likely suspended/deleted accounts; no point keeping them.
        // Filter out only obvious infra failures so we don't drop legit users.
        const isInfraError = (reason: string) => /no script result|chrome\.|tab.*timeout|denied/i.test(reason);
        const removableHandles = r.failed.filter((f) => !isInfraError(f.reason)).map((f) => f.handle.toLowerCase());
        await mutateState((s) => {
          for (const u of s.learned.users) {
            if (r.succeeded.some((h) => h.toLowerCase() === u.handle.toLowerCase())) u.syncedToTwitter = true;
          }
          if (removableHandles.length > 0) {
            s.learned.users = s.learned.users.filter((u) => !removableHandles.includes(u.handle.toLowerCase()));
          }
        });
        for (const f of r.failed) {
          if (isInfraError(f.reason)) {
            failed.push({ value: `user:@${f.handle}`, reason: f.reason });
          } else {
            removed.push(f.handle);
          }
        }
      } catch (e) {
        for (const h of unsyncedUsers) {
          failed.push({ value: `user:@${h}`, reason: String(e instanceof Error ? e.message : e).slice(0, 100) });
        }
      }
    }
    setProgress(null);
    return { ok: failed.length === 0, rateLimited, attempted, succeeded, failed, removed, usersSkippedNoRestId: 0 };
  };

  const removeLearned = async (type: "keyword" | "user", value: string): Promise<void> => {
    const sync = ensureMuteSync();
    const state = await loadState();
    let restId: string | undefined;
    await mutateState((s) => {
      if (type === "keyword") {
        s.learned.keywords = s.learned.keywords.filter((k) => k.phrase !== value);
        if (!s.whitelist.keywords.includes(value)) s.whitelist.keywords.push(value);
      } else {
        const u = s.learned.users.find((x) => x.handle === value);
        restId = u?.restId;
        s.learned.users = s.learned.users.filter((x) => x.handle !== value);
        const lower = value.toLowerCase();
        if (!s.whitelist.users.some((h) => h.toLowerCase() === lower)) s.whitelist.users.push(value);
      }
    });
    if (sync) {
      try {
        if (type === "keyword") await sync.destroyKeyword(value);
        else if (restId) {
          await sync.unmuteUser(restId);
        }
      } catch (e) {
        console.warn("[tsf] destroy failed", e);
      }
    }
  };

  onMessage(async (msg: Message) => {
    switch (msg.kind) {
      case "tweet/observed": {
        await queue.enqueue(msg.payload);
        // Cache display name when seen so we can show it later in Learned list
        if (msg.payload.displayName) {
          await mutateState((s) => { s.cache.handleToDisplayName[msg.payload.author] = msg.payload.displayName!; });
        }
        const state = await loadState();
        if (analyzer.shouldTrigger(state)) {
          analyzer.analyze(state).then(async ({ newCandidates }) => {
            for (const c of newCandidates) await applyCandidate(c, await loadState());
            const r = await retrySync();
            void chrome.storage.local.set({ tsf_last_sync: r });
          }).catch((e) => console.warn("[tsf] auto-batch failed", e));
        }
        return { ok: true };
      }
      case "tweet/markSpam": {
        // Direct action: immediately blacklist the author handle, sync to Twitter mute.
        // No LLM call, no candidate review — user explicitly said this is spam.
        const handle = msg.payload.tweet.author;
        const restId = msg.payload.tweet.restId;
        console.log("[tsf] markSpam received", { handle, tweetId: msg.payload.tweetId });
        const state = await loadState();
        const already = state.learned.users.some((u) => u.handle.toLowerCase() === handle.toLowerCase());
        console.log("[tsf] markSpam already-known?", already, "current learned users:", state.learned.users.length);
        if (!already) {
          await mutateState((s) => {
            const newUser: LearnedUser = {
              handle,
              reason: `manually marked from tweet ${msg.payload.tweetId}`,
              addedAt: Date.now(),
              syncedToTwitter: false,
            };
            const cachedRest = restId ?? s.cache.handleToRestId[handle];
            if (cachedRest !== undefined) newUser.restId = cachedRest;
            const dn = msg.payload.tweet.displayName ?? s.cache.handleToDisplayName[handle];
            if (dn !== undefined) newUser.displayName = dn;
            s.learned.users.push(newUser);
            s.pending.userMarked.push({ tweetId: msg.payload.tweetId, markedAt: Date.now() });
          });
        }
        if (state.config.syncToTwitterMute) {
          const sync = ensureMuteSync();
          const targetRestId = restId ?? state.cache.handleToRestId[handle];
          if (sync && targetRestId) {
            try {
              await sync.muteUser(targetRestId);
              await mutateState((s) => {
                const u = s.learned.users.find((x) => x.handle.toLowerCase() === handle.toLowerCase());
                if (u) u.syncedToTwitter = true;
              });
            } catch (e) { console.warn("[tsf] mark-spam sync failed", e); }
          }
        }
        // High-signal training: ALSO ask LLM to extract patterns from this single tweet.
        // User-marked = ground truth, so any keyword the LLM mines here is gold-tier.
        // Run async, don't block the mark response.
        if (state.config.llm.apiKey) {
          analyzer.analyzeMarkedTweet(msg.payload.tweet, state)
            .then(async ({ newCandidates }) => {
              for (const c of newCandidates) await applyCandidate(c, await loadState());
              if (newCandidates.length > 0) {
                const r = await retrySync();
                void chrome.storage.local.set({ tsf_last_sync: r });
              }
            })
            .catch((e) => console.warn("[tsf] markSpam LLM extraction failed", e));
        }
        return { ok: true, alreadyBlocked: already };
      }
      case "batch/trigger": {
        const state = await loadState();
        try {
          const { newCandidates, analyzed, whitelistRejected } = await analyzer.analyze(state);
          for (const c of newCandidates) await applyCandidate(c, await loadState());
          // Per-item API path is dead (X anti-bot); chain bulk UI sync
          retrySync().then((r) => {
            void chrome.storage.local.set({ tsf_last_sync: r });
          }).catch((e) => console.warn("[tsf] auto-sync after batch failed", e));
          return { ok: true, analyzed, whitelistRejected, applied: newCandidates.length };
        } catch (e) {
          return { ok: false, error: String(e instanceof Error ? e.message : e) };
        }
      }
      case "whitelist/remove": {
        const { type, value } = msg.payload;
        await mutateState((s) => {
          if (type === "keyword") {
            s.whitelist.keywords = s.whitelist.keywords.filter((k) => k !== value);
          } else {
            const lower = value.toLowerCase();
            s.whitelist.users = s.whitelist.users.filter((u) => u.toLowerCase() !== lower);
          }
        });
        return { ok: true };
      }
      case "learned/delete": {
        await removeLearned(msg.payload.type, msg.payload.value);
        return { ok: true };
      }
      case "muteSync/retry": {
        const report = await retrySync();
        void chrome.storage.local.set({ tsf_last_sync: report });
        return report;
      }
      case "subscription/refresh": {
        const s = await loadState();
        const url = s.config.subscriptionUrl;
        if (!url) {
          const report: RefreshReport = {
            ok: false, error: "no subscription URL configured",
            newKeywords: 0, newUsers: 0, skippedWhitelist: 0, skippedDuplicate: 0, fetchedAt: Date.now(),
          };
          void chrome.storage.local.set({ tsf_last_subscription: report });
          return report;
        }
        const report = await refreshSubscription(url);
        void chrome.storage.local.set({ tsf_last_subscription: report });
        // Auto-sync newly added items to Twitter mute (background)
        if (report.ok && (report.newKeywords + report.newUsers) > 0) {
          retrySync().then((r) => {
            void chrome.storage.local.set({ tsf_last_sync: r });
          }).catch((e) => console.warn("[tsf] post-subscription sync failed", e));
        }
        return report;
      }
      case "backup/push": {
        const s = await loadState();
        const token = s.config.backupGitHubToken;
        if (!token) {
          const r: PushResult = { ok: false, error: "no GitHub token configured", pushedAt: Date.now() };
          void chrome.storage.local.set({ tsf_last_backup_push: r });
          return r;
        }
        const result = await pushBackup(s, token, s.config.backupGistId);
        void chrome.storage.local.set({ tsf_last_backup_push: result });
        if (result.ok) {
          backupDirty = false;
          await mutateState((m) => {
            if (result.gistId) m.config.backupGistId = result.gistId;
            m.config.backupLastPushedAt = result.pushedAt;
          });
        }
        return result;
      }
      case "backup/pull": {
        const s = await loadState();
        const token = s.config.backupGitHubToken;
        const gistId = s.config.backupGistId;
        if (!token || !gistId) {
          const r: PullResult = { ok: false, error: "missing token or gist id", pulledAt: Date.now() };
          void chrome.storage.local.set({ tsf_last_backup_pull: r });
          return r;
        }
        const result = await pullBackup(token, gistId);
        void chrome.storage.local.set({ tsf_last_backup_pull: result });
        // After successful pull, push to twitter mute for any new restored items
        if (result.ok && ((result.learnedKeywords ?? 0) + (result.learnedUsers ?? 0)) > 0) {
          retrySync().then((r) => chrome.storage.local.set({ tsf_last_sync: r }))
            .catch((e) => console.warn("[tsf] post-pull sync failed", e));
        }
        return result;
      }
      case "auth/captured": {
        if (msg.payload.bearer && msg.payload.csrf) {
          persistAuth({ bearer: msg.payload.bearer, csrf: msg.payload.csrf });
        }
        return { ok: true };
      }
      case "restId/update": {
        await mutateState((s) => {
          s.cache.handleToRestId[msg.payload.handle] = msg.payload.restId;
        });
        return { ok: true };
      }
      case "stats/localHit": {
        await mutateState((s) => {
          s.stats.totalLocalHits += 1;
        });
        return { ok: true };
      }
    }
  });
});
