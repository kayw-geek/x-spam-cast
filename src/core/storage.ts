import { StateSchema, defaultState } from "./schemas";
import type { ExtensionState, LearnedKeyword, LearnedUser } from "./types";
import { LEGACY_CATEGORY_MAP, SPAM_CATEGORIES, STORAGE_KEY } from "./constants";

// Walk raw stored object and remap legacy category strings (ad/promo/marketing/lure/rumor)
// so the strict z.enum doesn't reject the whole snapshot. v1 → v2 migration.
function migrate(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object") return raw;
  const r = raw as Record<string, unknown>;
  const learned = (r.learned ?? {}) as Record<string, unknown>;
  const remapCategory = (c: unknown): string => {
    const s = typeof c === "string" ? c : "";
    return LEGACY_CATEGORY_MAP[s] ?? "spam";
  };
  if (Array.isArray(learned.keywords)) {
    for (const k of learned.keywords as Record<string, unknown>[]) {
      if (k && typeof k === "object") k.category = remapCategory(k.category);
    }
  }
  const config = (r.config ?? {}) as Record<string, unknown>;
  if (Array.isArray(config.enabledCategories)) {
    const remapped = (config.enabledCategories as unknown[]).map(remapCategory);
    config.enabledCategories = Array.from(new Set(remapped)).filter((c): c is string =>
      (SPAM_CATEGORIES as readonly string[]).includes(c),
    );
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
  // Cleanup any historical duplicates
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
