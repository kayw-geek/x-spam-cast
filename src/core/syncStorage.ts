import type { ExtensionState, LearnedKeyword, LearnedUser } from "./types";

// chrome.storage.sync caps:
//   - 8192 BYTES per item (key name + JSON-encoded value, UTF-8 bytes)
//   - 102400 bytes total
//   - 512 keys
//   - 120 writes/min, 1800 writes/hr
//
// We chunk learned + whitelist into ~6 KB UTF-8 byte slices (well under 8 KB cap
// after the key name and JSON quoting overhead). Earlier version chunked by JS
// string length, which silently broke on CJK/emoji content (3-4 bytes per char).

const COUNT_KEY = "tsf_sync_count";
const CHUNK_PREFIX = "tsf_sync_chunk_";
// Per-chunk UTF-8 byte budget. 8192 - ~24 bytes of `{"tsf_sync_chunk_NN":"..."}`
// scaffolding leaves ~8160; we cap at 6000 to keep generous headroom for chars
// that need JSON escaping (\", \\, control characters).
const CHUNK_BUDGET_BYTES = 6000;
const MAX_CHUNKS = 16; // ~96 KB worst-case payload, fits the 100 KB total cap

export interface SyncPayload {
  v: 1;
  learned: { keywords: LearnedKeyword[]; users: LearnedUser[] };
  whitelist: { keywords: string[]; users: string[] };
  exportedAt: number;
}

export interface PushSyncResult { ok: boolean; error?: string; chunks?: number; bytes?: number; pushedAt: number; }
export interface PullSyncResult { ok: boolean; error?: string; payload?: SyncPayload; pulledAt: number; }

// Walk a JS string by Unicode code point and emit chunks whose UTF-8 byte size
// stays under `maxBytes`. Surrogate pairs are kept together so we never produce
// a lone surrogate that would explode JSON encoding.
function chunkByUtf8Bytes(s: string, maxBytes: number): string[] {
  const out: string[] = [];
  let chunkStart = 0;
  let chunkBytes = 0;
  let i = 0;
  while (i < s.length) {
    const code = s.charCodeAt(i);
    let charBytes: number;
    let advance = 1;
    if (code < 0x80) charBytes = 1;
    else if (code < 0x800) charBytes = 2;
    else if (code >= 0xD800 && code <= 0xDBFF) {
      charBytes = 4;
      advance = 2; // consume low surrogate alongside its high partner
    } else charBytes = 3;

    if (chunkBytes + charBytes > maxBytes && chunkBytes > 0) {
      out.push(s.slice(chunkStart, i));
      chunkStart = i;
      chunkBytes = 0;
    }
    chunkBytes += charBytes;
    i += advance;
  }
  if (chunkStart < s.length) out.push(s.slice(chunkStart));
  return out;
}

function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

export async function pushSync(state: ExtensionState): Promise<PushSyncResult> {
  const pushedAt = Date.now();
  const payload: SyncPayload = {
    v: 1,
    learned: state.learned,
    whitelist: state.whitelist,
    exportedAt: pushedAt,
  };
  const json = JSON.stringify(payload);
  const totalBytes = utf8Bytes(json);
  const chunks = chunkByUtf8Bytes(json, CHUNK_BUDGET_BYTES);

  if (chunks.length > MAX_CHUNKS) {
    return {
      ok: false,
      error: `library is ${(totalBytes / 1024).toFixed(1)} KB — exceeds chrome.storage.sync ~96 KB cap. Use Export to file instead.`,
      pushedAt,
    };
  }

  // Strip orphan chunks from any earlier (possibly larger) payload before writing
  try {
    const all = await chrome.storage.sync.get(null);
    const orphans = Object.keys(all).filter((k) => k.startsWith(CHUNK_PREFIX));
    if (orphans.length > 0) await chrome.storage.sync.remove(orphans);
  } catch (e) {
    return { ok: false, error: `sync read failed: ${String(e).slice(0, 100)}`, pushedAt };
  }

  // Write count + chunks. Set as one operation so concurrent reads see a
  // consistent snapshot (chrome.storage.set is atomic across the keys passed in).
  const set: Record<string, unknown> = { [COUNT_KEY]: chunks.length };
  chunks.forEach((c, i) => { set[`${CHUNK_PREFIX}${i}`] = c; });
  try {
    await chrome.storage.sync.set(set);
    return { ok: true, chunks: chunks.length, bytes: totalBytes, pushedAt };
  } catch (e) {
    return { ok: false, error: `sync write failed: ${String(e).slice(0, 120)}`, pushedAt };
  }
}

export async function pullSync(): Promise<PullSyncResult> {
  const pulledAt = Date.now();
  try {
    const meta = await chrome.storage.sync.get(COUNT_KEY);
    const count = meta[COUNT_KEY] as number | undefined;
    if (typeof count !== "number" || count <= 0) {
      return { ok: false, error: "no sync snapshot found", pulledAt };
    }
    const keys = Array.from({ length: count }, (_, i) => `${CHUNK_PREFIX}${i}`);
    const got = await chrome.storage.sync.get(keys);
    const json = keys.map((k) => (got[k] as string | undefined) ?? "").join("");
    let payload: SyncPayload;
    try { payload = JSON.parse(json) as SyncPayload; }
    catch (e) { return { ok: false, error: `invalid sync JSON: ${String(e).slice(0, 80)}`, pulledAt }; }
    if (!payload.learned || !payload.whitelist) {
      return { ok: false, error: "sync payload missing learned/whitelist", pulledAt };
    }
    return { ok: true, payload, pulledAt };
  } catch (e) {
    return { ok: false, error: `sync error: ${String(e).slice(0, 120)}`, pulledAt };
  }
}
