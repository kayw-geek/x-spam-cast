import { mutateState } from "@/core/storage";
import type { ExtensionState } from "@/core/types";

const GIST_API = "https://api.github.com/gists";
const FILE_NAME = "tsf-backup.json";
const DESCRIPTION = "XSpamCast backup (private)";

export interface BackupSnapshot {
  version: number;
  exportedAt: number;
  learned: ExtensionState["learned"];
  whitelist: ExtensionState["whitelist"];
  cache: ExtensionState["cache"];
}

export interface PushResult {
  ok: boolean;
  error?: string;
  gistId?: string;
  htmlUrl?: string;
  createdNew?: boolean;
  pushedAt: number;
}

export interface PullResult {
  ok: boolean;
  error?: string;
  learnedKeywords?: number;
  learnedUsers?: number;
  whitelistKeywords?: number;
  whitelistUsers?: number;
  exportedAt?: number;
  pulledAt: number;
}

const snapshot = (s: ExtensionState): BackupSnapshot => ({
  version: 1,
  exportedAt: Date.now(),
  learned: s.learned,
  whitelist: s.whitelist,
  cache: s.cache,
});

const ghHeaders = (token: string): HeadersInit => ({
  "authorization": `Bearer ${token}`,
  "accept": "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
});

// Push: PATCH existing gist or POST new one. Returns gistId so caller can persist.
export async function pushBackup(
  state: ExtensionState,
  token: string,
  existingGistId: string | undefined,
): Promise<PushResult> {
  const pushedAt = Date.now();
  if (!token) return { ok: false, error: "missing GitHub token", pushedAt };

  const body = JSON.stringify({
    description: DESCRIPTION,
    public: false,
    files: { [FILE_NAME]: { content: JSON.stringify(snapshot(state), null, 2) } },
  });

  try {
    const url = existingGistId ? `${GIST_API}/${existingGistId}` : GIST_API;
    const method = existingGistId ? "PATCH" : "POST";
    const resp = await fetch(url, {
      method,
      headers: { ...ghHeaders(token), "content-type": "application/json" },
      body,
    });
    if (!resp.ok) {
      // 404 on PATCH means gist was deleted upstream — caller should reset id and retry
      if (existingGistId && resp.status === 404) {
        return { ok: false, error: "gist not found (deleted upstream)", pushedAt };
      }
      const detail = await resp.text().catch(() => "");
      return { ok: false, error: `HTTP ${resp.status}: ${detail.slice(0, 120)}`, pushedAt };
    }
    const data = await resp.json() as { id: string; html_url: string };
    return {
      ok: true, gistId: data.id, htmlUrl: data.html_url,
      createdNew: !existingGistId, pushedAt,
    };
  } catch (e) {
    return { ok: false, error: `network: ${String(e).slice(0, 120)}`, pushedAt };
  }
}

// Pull: fetch gist, parse, REPLACE local learned+whitelist+cache. Caller decides when to call.
export async function pullBackup(token: string, gistId: string): Promise<PullResult> {
  const pulledAt = Date.now();
  if (!token || !gistId) return { ok: false, error: "missing token or gist id", pulledAt };

  try {
    const resp = await fetch(`${GIST_API}/${gistId}`, { headers: ghHeaders(token), cache: "no-store" });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}`, pulledAt };
    const data = await resp.json() as { files?: Record<string, { content?: string }> };
    const file = data.files?.[FILE_NAME];
    if (!file?.content) return { ok: false, error: `${FILE_NAME} not found in gist`, pulledAt };

    let snap: BackupSnapshot;
    try { snap = JSON.parse(file.content) as BackupSnapshot; }
    catch (e) { return { ok: false, error: `invalid backup JSON: ${String(e).slice(0, 80)}`, pulledAt }; }

    if (!snap.learned || !snap.whitelist) {
      return { ok: false, error: "backup missing learned/whitelist fields", pulledAt };
    }

    await mutateState((s) => {
      s.learned = snap.learned;
      s.whitelist = snap.whitelist;
      // Cache merge (don't lose locally-resolved restIds if backup is older)
      s.cache.handleToRestId = { ...snap.cache?.handleToRestId, ...s.cache.handleToRestId };
      s.cache.handleToDisplayName = { ...snap.cache?.handleToDisplayName, ...s.cache.handleToDisplayName };
    });

    return {
      ok: true,
      learnedKeywords: snap.learned.keywords.length,
      learnedUsers: snap.learned.users.length,
      whitelistKeywords: snap.whitelist.keywords.length,
      whitelistUsers: snap.whitelist.users.length,
      exportedAt: snap.exportedAt,
      pulledAt,
    };
  } catch (e) {
    return { ok: false, error: `network: ${String(e).slice(0, 120)}`, pulledAt };
  }
}
