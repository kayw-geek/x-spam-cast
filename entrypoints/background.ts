import { defineBackground } from "wxt/utils/define-background";
import { Queue } from "@/worker/queue";
import { BatchAnalyzer } from "@/worker/batchAnalyzer";
import { refreshSubscription, importPack, SpamPackSchema, type RefreshReport, type ImportPackReport } from "@/worker/subscription";
import { loadState, mutateState, saveState } from "@/core/storage";
import { onMessage, type Message } from "@/core/messaging";
import { pushSync, pullSync, type PushSyncResult, type PullSyncResult } from "@/core/syncStorage";
import { DEFAULT_PACK } from "@/data/defaultPack";
import type { Candidate, LearnedUser, LearnedKeyword } from "@/core/types";

// Local-only filtering — no Twitter native mute, no GitHub PAT, no UI automation.
// Backup is via chrome.storage.sync (signs in with the user's Chrome account, ~91 KB).
export default defineBackground(() => {
  const queue = new Queue();
  const analyzer = new BatchAnalyzer(queue);

  void queue.hydrate();

  // First-run experience: seed the Library with the bundled starter pack so the
  // user gets immediate filtering value without configuring anything (no LLM key,
  // no subscription URL). Only fires on a true install — updates and reinstalls
  // with existing data are left alone.
  chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason !== "install") return;
    const s = await loadState();
    if (s.learned.keywords.length > 0 || s.learned.users.length > 0) return;
    await mutateState((m) => {
      const now = Date.now();
      for (const k of DEFAULT_PACK.keywords) {
        if (m.learned.keywords.some((x) => x.phrase === k.phrase)) continue;
        const entry: LearnedKeyword = { phrase: k.phrase, addedAt: now, hits: 0 };
        m.learned.keywords.push(entry);
      }
      for (const u of DEFAULT_PACK.users) {
        const lower = u.handle.toLowerCase();
        if (m.learned.users.some((x) => x.handle.toLowerCase() === lower)) continue;
        m.learned.users.push({ handle: u.handle, reason: u.reason, addedAt: now });
      }
    });
    console.log("[tsf] first-run: seeded", DEFAULT_PACK.keywords.length, "keywords from", DEFAULT_PACK.name);
  });

  // ── Subscription auto-refresh ────────────────────────────────────────────
  const SUBSCRIPTION_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
  void loadState().then((s) => {
    const url = s.config.subscriptionUrl;
    const last = s.config.subscriptionLastFetchedAt ?? 0;
    if (url && Date.now() - last > SUBSCRIPTION_REFRESH_INTERVAL_MS) {
      refreshSubscription(url)
        .then((r) => { void chrome.storage.local.set({ tsf_last_subscription: r }); })
        .catch((e) => console.warn("[tsf] startup subscription refresh failed", e));
    }
  });

  // ── chrome.storage.sync backup (replaces gist+PAT) ───────────────────────
  const SYNC_ALARM_NAME = "tsf-sync-push";
  const SYNC_PUSH_PERIOD_MIN = 5;
  let syncDirty = false;

  const doSyncPush = async (force = false): Promise<PushSyncResult | undefined> => {
    if (!force && !syncDirty) return;
    const s = await loadState();
    const r = await pushSync(s);
    void chrome.storage.local.set({ tsf_last_sync_push: r });
    if (r.ok) syncDirty = false;
    else console.warn("[tsf] sync push failed", r.error);
    return r;
  };

  // Cheap signature-based dirty detection — counts catch add/remove without
  // serializing the entire learned/whitelist on every storage write.
  type BackupShape = {
    learned?: { keywords?: { phrase?: string }[]; users?: { handle?: string }[] };
    whitelist?: { keywords?: string[]; users?: string[] };
  };
  const backupSig = (s: BackupShape | undefined): string => {
    if (!s) return "";
    return `${s.learned?.keywords?.length ?? 0}|${s.learned?.users?.length ?? 0}|${s.whitelist?.keywords?.length ?? 0}|${s.whitelist?.users?.length ?? 0}`;
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.tsf_state) return;
    const before = changes.tsf_state.oldValue as BackupShape | undefined;
    const after = changes.tsf_state.newValue as BackupShape | undefined;
    if (backupSig(before) !== backupSig(after)) syncDirty = true;
  });

  chrome.alarms.create(SYNC_ALARM_NAME, { periodInMinutes: SYNC_PUSH_PERIOD_MIN });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM_NAME) void doSyncPush();
  });

  // Startup recovery: if local Library is empty, try to pull from sync.
  void loadState().then(async (s) => {
    const localEmpty = s.learned.keywords.length === 0 && s.learned.users.length === 0;
    if (!localEmpty) return;
    const r = await pullSync();
    if (!r.ok || !r.payload) {
      console.log("[tsf] startup pull skipped:", r.error);
      return;
    }
    await mutateState((m) => {
      m.learned = r.payload!.learned;
      m.whitelist = r.payload!.whitelist;
    });
    console.log("[tsf] startup pull restored", r.payload.learned.keywords.length, "kw /", r.payload.learned.users.length, "users");
  });

  // ── Candidate apply / remove ─────────────────────────────────────────────
  const applyCandidate = async (candidate: Candidate): Promise<void> => {
    await mutateState((s) => {
      if (candidate.type === "keyword") {
        if (s.learned.keywords.some((k) => k.phrase === candidate.value)) return;
        s.learned.keywords.push({
          phrase: candidate.value,
          addedAt: Date.now(),
          hits: 0,
        });
      } else {
        const lower = candidate.value.toLowerCase();
        if (s.learned.users.some((u) => u.handle.toLowerCase() === lower)) return;
        const newUser: LearnedUser = {
          handle: candidate.value,
          reason: candidate.llmReasoning,
          addedAt: Date.now(),
        };
        const cachedDn = s.cache.handleToDisplayName[candidate.value];
        if (cachedDn !== undefined) newUser.displayName = cachedDn;
        s.learned.users.push(newUser);
      }
    });
  };

  const removeLearned = async (type: "keyword" | "user", value: string): Promise<void> => {
    await mutateState((s) => {
      if (type === "keyword") {
        s.learned.keywords = s.learned.keywords.filter((k) => k.phrase !== value);
        if (!s.whitelist.keywords.includes(value)) s.whitelist.keywords.push(value);
      } else {
        s.learned.users = s.learned.users.filter((x) => x.handle !== value);
        const lower = value.toLowerCase();
        if (!s.whitelist.users.some((h) => h.toLowerCase() === lower)) s.whitelist.users.push(value);
      }
    });
  };

  onMessage(async (msg: Message) => {
    switch (msg.kind) {
      case "tweet/observed": {
        await queue.enqueue(msg.payload);
        if (msg.payload.displayName) {
          await mutateState((s) => { s.cache.handleToDisplayName[msg.payload.author] = msg.payload.displayName!; });
        }
        const state = await loadState();
        if (analyzer.shouldTrigger(state)) {
          analyzer.analyze(state).then(async ({ newCandidates }) => {
            for (const c of newCandidates) await applyCandidate(c);
          }).catch((e) => console.warn("[tsf] auto-batch failed", e));
        }
        return { ok: true };
      }
      case "tweet/markSpam": {
        const handle = msg.payload.tweet.author;
        const state = await loadState();
        const already = state.learned.users.some((u) => u.handle.toLowerCase() === handle.toLowerCase());
        if (!already) {
          await mutateState((s) => {
            const newUser: LearnedUser = {
              handle,
              reason: `manually marked from tweet ${msg.payload.tweetId}`,
              addedAt: Date.now(),
            };
            const dn = msg.payload.tweet.displayName ?? s.cache.handleToDisplayName[handle];
            if (dn !== undefined) newUser.displayName = dn;
            s.learned.users.push(newUser);
            s.pending.userMarked.push({ tweetId: msg.payload.tweetId, markedAt: Date.now() });
          });
        }
        if (state.config.llm.apiKey) {
          analyzer.analyzeMarkedTweet(msg.payload.tweet, state)
            .then(async ({ newCandidates }) => {
              for (const c of newCandidates) await applyCandidate(c);
            })
            .catch((e) => console.warn("[tsf] markSpam LLM extraction failed", e));
        }
        return { ok: true, alreadyBlocked: already };
      }
      case "batch/trigger": {
        const state = await loadState();
        try {
          const { newCandidates, analyzed, whitelistRejected } = await analyzer.analyze(state);
          for (const c of newCandidates) await applyCandidate(c);
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
        return report;
      }
      case "pack/import": {
        let raw: unknown;
        try { raw = JSON.parse(msg.payload.json); }
        catch (e) {
          const err: ImportPackReport = {
            ok: false, error: `invalid JSON: ${String(e).slice(0, 80)}`,
            newKeywords: 0, newUsers: 0, skippedWhitelist: 0, skippedDuplicate: 0, importedAt: Date.now(),
          };
          void chrome.storage.local.set({ tsf_last_import_pack: err });
          return err;
        }
        const parsed = SpamPackSchema.safeParse(raw);
        if (!parsed.success) {
          const err: ImportPackReport = {
            ok: false, error: `schema: ${parsed.error.issues[0]?.message ?? "invalid pack format"}`,
            newKeywords: 0, newUsers: 0, skippedWhitelist: 0, skippedDuplicate: 0, importedAt: Date.now(),
          };
          void chrome.storage.local.set({ tsf_last_import_pack: err });
          return err;
        }
        const sourceLabel = msg.payload.filename ? `file ${msg.payload.filename}` : "imported file";
        const report = await importPack(parsed.data, sourceLabel);
        void chrome.storage.local.set({ tsf_last_import_pack: report });
        return report;
      }
      case "sync/push": {
        const r = await doSyncPush(true);
        return r ?? { ok: false, error: "no result", pushedAt: Date.now() };
      }
      case "sync/pull": {
        const r = await pullSync();
        void chrome.storage.local.set({ tsf_last_sync_pull: r });
        if (r.ok && r.payload) {
          // Replace learned + whitelist; keep config + stats + cache local
          const s = await loadState();
          s.learned = r.payload.learned;
          s.whitelist = r.payload.whitelist;
          await saveState(s);
        }
        return r as PullSyncResult;
      }
      case "stats/localHit": {
        await mutateState((s) => {
          s.stats.totalLocalHits += 1;
          const today = new Date();
          const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
          s.stats.dailyHits = s.stats.dailyHits ?? {};
          s.stats.dailyHits[key] = (s.stats.dailyHits[key] ?? 0) + 1;
          // Prune anything older than 30 days to bound storage growth
          const cutoff = Date.now() - 30 * 86400_000;
          for (const k of Object.keys(s.stats.dailyHits)) {
            const ts = Date.parse(k);
            if (!Number.isNaN(ts) && ts < cutoff) delete s.stats.dailyHits[k];
          }
        });
        return { ok: true };
      }
    }
  });
});
