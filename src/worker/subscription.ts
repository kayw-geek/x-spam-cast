import { z } from "zod";
import { SpamCategoryEnum } from "@/core/schemas";
import { LEGACY_CATEGORY_MAP, type SpamCategory } from "@/core/constants";
import { mutateState } from "@/core/storage";
import type { LearnedKeyword, LearnedUser } from "@/core/types";

// Lenient pack schema — accepts category strings from old vocab too (auto-remapped).
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

const remapCategory = (c: string | undefined): SpamCategory => {
  if (!c) return "spam";
  return LEGACY_CATEGORY_MAP[c] ?? "spam";
};

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

  let newKeywords = 0, newUsers = 0, skippedWhitelist = 0, skippedDuplicate = 0;
  const result: { source: string; packName: string | undefined } = { source: url, packName: pack.name };

  await mutateState((s) => {
    const wlKw = new Set(s.whitelist.keywords);
    const wlUser = new Set(s.whitelist.users.map((u) => u.toLowerCase()));
    const learnedKw = new Set(s.learned.keywords.map((k) => k.phrase));
    const learnedUser = new Set(s.learned.users.map((u) => u.handle.toLowerCase()));

    for (const k of pack.keywords) {
      if (wlKw.has(k.phrase)) { skippedWhitelist++; continue; }
      if (learnedKw.has(k.phrase)) { skippedDuplicate++; continue; }
      const cat = SpamCategoryEnum.safeParse(k.category).success ? (k.category as SpamCategory) : remapCategory(k.category);
      const entry: LearnedKeyword = {
        phrase: k.phrase,
        category: cat,
        addedAt: fetchedAt,
        hits: 0,
        syncedToTwitter: false,
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
        reason: u.reason ?? `from subscription ${pack.name ?? url}`,
        addedAt: fetchedAt,
        syncedToTwitter: false,
      };
      const cachedRest = s.cache.handleToRestId[u.handle];
      if (cachedRest !== undefined) entry.restId = cachedRest;
      s.learned.users.push(entry);
      learnedUser.add(lower);
      newUsers++;
    }

    s.config.subscriptionLastFetchedAt = fetchedAt;
  });

  return {
    ok: true, source: result.source, ...(result.packName !== undefined && { packName: result.packName }),
    newKeywords, newUsers, skippedWhitelist, skippedDuplicate, fetchedAt,
  };
}
