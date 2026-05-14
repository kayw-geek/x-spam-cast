import { z } from "zod";
import { mutateState } from "@/core/storage";
import type { LearnedKeyword, LearnedUser } from "@/core/types";

// Lenient pack schema — `category` is accepted (and ignored) for back-compat with old packs.
export const SpamPackSchema = z.object({
  version: z.number().optional(),
  name: z.string().optional(),
  keywords: z.array(z.object({
    phrase: z.string().min(1),
    category: z.string().optional(),
  })).default([]),
  users: z.array(z.object({
    handle: z.string().min(1),
    reason: z.string().optional(),
  })).default([]),
});
export type SpamPack = z.infer<typeof SpamPackSchema>;

export interface MergeStats {
  newKeywords: number;
  newUsers: number;
  skippedWhitelist: number;
  skippedDuplicate: number;
}

export interface RefreshReport {
  ok: boolean;
  error?: string;
  source?: string;
  packName?: string;
  newKeywords: number;
  newUsers: number;
  skippedWhitelist: number;
  skippedDuplicate: number;
  fetchedAt: number;
}

export interface ImportPackReport {
  ok: boolean;
  error?: string;
  packName?: string;
  newKeywords: number;
  newUsers: number;
  skippedWhitelist: number;
  skippedDuplicate: number;
  importedAt: number;
}

// Merge a parsed SpamPack into the user's learned + whitelist state.
// Shared between subscription URL refresh and local file import.
// - whitelist hits are skipped (the user previously rejected those phrases/users)
// - already-learned items are skipped (no overwrite)
// - returns counts so the caller can render a "+X kw, +Y users" message
export async function applyPack(
  pack: SpamPack,
  source: string,
  appliedAt: number = Date.now(),
): Promise<MergeStats> {
  let newKeywords = 0, newUsers = 0, skippedWhitelist = 0, skippedDuplicate = 0;

  await mutateState((s) => {
    const wlKw = new Set(s.whitelist.keywords);
    const wlUser = new Set(s.whitelist.users.map((u) => u.toLowerCase()));
    const learnedKw = new Set(s.learned.keywords.map((k) => k.phrase));
    const learnedUser = new Set(s.learned.users.map((u) => u.handle.toLowerCase()));

    for (const k of pack.keywords) {
      if (wlKw.has(k.phrase)) { skippedWhitelist++; continue; }
      if (learnedKw.has(k.phrase)) { skippedDuplicate++; continue; }
      const entry: LearnedKeyword = {
        phrase: k.phrase,
        addedAt: appliedAt,
        hits: 0,
        reason: `from ${source}`,
        source: "pack",
      };
      s.learned.keywords.push(entry);
      learnedKw.add(k.phrase);
      newKeywords++;
    }
    for (const u of pack.users) {
      const lower = u.handle.toLowerCase();
      if (wlUser.has(lower)) { skippedWhitelist++; continue; }
      if (learnedUser.has(lower)) { skippedDuplicate++; continue; }
      const entry: LearnedUser = {
        handle: u.handle,
        reason: u.reason ?? `from ${source}`,
        addedAt: appliedAt,
        source: "pack",
      };
      s.learned.users.push(entry);
      learnedUser.add(lower);
      newUsers++;
    }
  });

  return { newKeywords, newUsers, skippedWhitelist, skippedDuplicate };
}

export async function refreshSubscription(url: string): Promise<RefreshReport> {
  const fetchedAt = Date.now();
  let resp: Response;
  try {
    resp = await fetch(url, { cache: "no-store" });
  } catch (e) {
    return {
      ok: false, error: `network: ${String(e).slice(0, 120)}`,
      newKeywords: 0, newUsers: 0, skippedWhitelist: 0, skippedDuplicate: 0, fetchedAt,
    };
  }
  if (!resp.ok) {
    return {
      ok: false, error: `HTTP ${resp.status}`,
      newKeywords: 0, newUsers: 0, skippedWhitelist: 0, skippedDuplicate: 0, fetchedAt,
    };
  }
  let raw: unknown;
  try { raw = await resp.json(); } catch (e) {
    return {
      ok: false, error: `invalid JSON: ${String(e).slice(0, 80)}`,
      newKeywords: 0, newUsers: 0, skippedWhitelist: 0, skippedDuplicate: 0, fetchedAt,
    };
  }
  const parsed = SpamPackSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false, error: `schema: ${parsed.error.issues[0]?.message ?? "invalid"}`,
      newKeywords: 0, newUsers: 0, skippedWhitelist: 0, skippedDuplicate: 0, fetchedAt,
    };
  }
  const pack = parsed.data;

  const stats = await applyPack(pack, `subscription ${pack.name ?? url}`, fetchedAt);

  // Track when we last pulled from the URL so the 24h auto-refresh stays paced.
  await mutateState((s) => { s.config.subscriptionLastFetchedAt = fetchedAt; });

  return {
    ok: true,
    source: url,
    ...(pack.name !== undefined && { packName: pack.name }),
    ...stats,
    fetchedAt,
  };
}

// Local-file import — caller has already parsed JSON and validated against SpamPackSchema.
// Background handler validates + calls this so the merge logic stays in one place.
export async function importPack(pack: SpamPack, sourceLabel = "imported file"): Promise<ImportPackReport> {
  const importedAt = Date.now();
  const stats = await applyPack(pack, sourceLabel, importedAt);
  return {
    ok: true,
    ...(pack.name !== undefined && { packName: pack.name }),
    ...stats,
    importedAt,
  };
}
