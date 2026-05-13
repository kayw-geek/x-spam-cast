import { StateSchema, defaultState } from "./schemas";
import type { ExtensionState, LearnedKeyword, LearnedUser } from "./types";
import { STORAGE_KEY } from "./constants";

// Strip dead fields from old state shapes:
// - Twitter-mute-sync era: syncedToTwitter, restId, syncToTwitterMute, handleToRestId
// - Categories era: enabledCategories config field, category on each LearnedKeyword
// - Gist-backup era: backupGistId / backupGitHubToken / backupAutoSync / backupLastPushedAt
function migrate(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object") return raw;
  const r = raw as Record<string, unknown>;
  const learned = (r.learned ?? {}) as Record<string, unknown>;
  if (Array.isArray(learned.keywords)) {
    for (const k of learned.keywords as Record<string, unknown>[]) {
      if (k && typeof k === "object") {
        delete k.category;
        delete k.syncedToTwitter;
      }
    }
  }
  if (Array.isArray(learned.users)) {
    for (const u of learned.users as Record<string, unknown>[]) {
      if (u && typeof u === "object") {
        delete u.syncedToTwitter;
        delete u.restId;
      }
    }
  }
  const config = (r.config ?? {}) as Record<string, unknown>;
  delete config.enabledCategories;
  delete config.syncToTwitterMute;
  delete config.backupGistId;
  delete config.backupGitHubToken;
  delete config.backupAutoSync;
  delete config.backupLastPushedAt;
  // Migrate dim → collapse (we dropped dim hide style)
  if (config.hideStyle === "dim") config.hideStyle = "collapse";
  const cache = (r.cache ?? {}) as Record<string, unknown>;
  delete cache.handleToRestId;
  const pending = (r.pending ?? {}) as Record<string, unknown>;
  if (Array.isArray(pending.queue)) {
    for (const q of pending.queue as Record<string, unknown>[]) {
      if (q && typeof q === "object") delete q.restId;
    }
  }
  if (Array.isArray(pending.candidates)) {
    for (const c of pending.candidates as Record<string, unknown>[]) {
      if (c && typeof c === "object") delete c.category;
    }
  }
  return r;
}

function dedupKeywords(arr: LearnedKeyword[]): LearnedKeyword[] {
  const seen = new Set<string>();
  const out: LearnedKeyword[] = [];
  for (const k of arr) {
    if (seen.has(k.phrase)) continue;
    seen.add(k.phrase);
    out.push(k);
  }
  return out;
}

function dedupUsers(arr: LearnedUser[]): LearnedUser[] {
  const seen = new Set<string>();
  const out: LearnedUser[] = [];
  for (const u of arr) {
    const key = u.handle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

export async function loadState(): Promise<ExtensionState> {
  const raw = await chrome.storage.local.get(STORAGE_KEY);
  const parsed = StateSchema.safeParse(migrate(raw[STORAGE_KEY]));
  if (!parsed.success) return defaultState();
  const s = parsed.data as ExtensionState;
  s.learned.keywords = dedupKeywords(s.learned.keywords);
  s.learned.users = dedupUsers(s.learned.users);
  return s;
}

export async function saveState(state: ExtensionState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

export async function mutateState(fn: (s: ExtensionState) => void): Promise<ExtensionState> {
  const state = await loadState();
  fn(state);
  await saveState(state);
  return state;
}

export function subscribeState(cb: (s: ExtensionState) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && changes[STORAGE_KEY]) {
      const parsed = StateSchema.safeParse(changes[STORAGE_KEY]!.newValue);
      if (parsed.success) cb(parsed.data as ExtensionState);
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
