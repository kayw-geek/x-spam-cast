import React, { useEffect, useState } from "react";
import type { ExtensionState } from "@/core/types";
import { send } from "@/core/messaging";
import { useSyncProgress } from "@/popup/useStore";

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

type RetryStatus = { kind: "idle" } | { kind: "running" } | { kind: "done"; report: RetryReport };

type BatchStatus =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; analyzed: number; applied: number; whitelistRejected: number }
  | { kind: "err"; detail: string };

interface BatchResponse {
  ok: boolean;
  analyzed?: number;
  applied?: number;
  whitelistRejected?: number;
  error?: string;
}

const MOSAIC_KEY = "tsf_mosaic";

export function LearnedList({ state }: { state: ExtensionState }): React.JSX.Element {
  const [retry, setRetry] = useState<RetryStatus>({ kind: "idle" });
  const [batch, setBatch] = useState<BatchStatus>({ kind: "idle" });
  const [mosaic, setMosaic] = useState<boolean>(() => localStorage.getItem(MOSAIC_KEY) === "1");
  const progress = useSyncProgress();
  const toggleMosaic = () => {
    setMosaic((m) => {
      const next = !m;
      localStorage.setItem(MOSAIC_KEY, next ? "1" : "0");
      return next;
    });
  };
  // hover to peek; click toggles globally
  const maskCls = mosaic ? "blur-sm hover:blur-none transition-[filter] cursor-help select-none" : "";

  // Restore last sync result on mount so user sees it after closing/reopening popup
  useEffect(() => {
    void chrome.storage.local.get("tsf_last_sync").then((r) => {
      const last = r.tsf_last_sync as RetryReport | undefined;
      if (last) setRetry({ kind: "done", report: last });
    });
  }, []);

  const unsynced = [
    ...state.learned.keywords.filter((k) => !k.syncedToTwitter).map((k) => `kw: ${k.phrase}`),
    ...state.learned.users.filter((u) => !u.syncedToTwitter).map((u) => `user: @${u.handle}`),
  ];

  const doRetry = async () => {
    setRetry({ kind: "running" });
    const r = (await send({ kind: "muteSync/retry" })) as RetryReport;
    setRetry({ kind: "done", report: r });
  };

  const trainNow = async () => {
    setBatch({ kind: "running" });
    try {
      const resp = (await send({ kind: "batch/trigger" })) as BatchResponse | undefined;
      if (resp?.ok) {
        setBatch({
          kind: "ok",
          analyzed: resp.analyzed ?? 0,
          applied: resp.applied ?? 0,
          whitelistRejected: resp.whitelistRejected ?? 0,
        });
      } else {
        setBatch({ kind: "err", detail: resp?.error ?? "unknown failure" });
      }
    } catch (e) {
      setBatch({ kind: "err", detail: String(e) });
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <span className="flex-1">
            Queue: {state.pending.queue.length} / {state.config.batchThreshold}
            <span className="text-neutral-600 ml-2">
              auto-reviews when threshold hit
            </span>
          </span>
          <button
            onClick={trainNow}
            disabled={batch.kind === "running" || state.pending.queue.length === 0}
            className="text-neutral-500 hover:text-emerald-400 disabled:opacity-30 disabled:hover:text-neutral-500 underline"
            title="Force LLM review now (debug — normally auto-fires at threshold)"
          >
            {batch.kind === "running" ? "reviewing…" : "force now"}
          </button>
          <button
            onClick={toggleMosaic}
            title={mosaic ? "Show contents" : "Mosaic — hide spam phrases (work-safe)"}
            className={`px-2 py-0.5 rounded text-xs ${mosaic ? "bg-amber-700 hover:bg-amber-600 text-white" : "bg-neutral-800 hover:bg-neutral-700 text-neutral-400"}`}
          >
            {mosaic ? "🫥" : "👁"}
          </button>
        </div>
        {batch.kind === "ok" && (
          <div className="text-xs bg-emerald-900/40 border border-emerald-700 rounded p-2">
            ✓ Analyzed {batch.analyzed} · {batch.applied} new auto-blocked
            {batch.whitelistRejected > 0 && <span className="text-neutral-400"> · {batch.whitelistRejected} dropped (whitelist)</span>}
            {batch.applied === 0 && batch.analyzed > 0 && (
              <span className="text-neutral-400"> · LLM judged none worth blocking</span>
            )}
            {batch.analyzed === 0 && (
              <span className="text-neutral-400"> · queue empty — browse x.com first</span>
            )}
            {batch.applied > 0 && (
              <div className="text-neutral-400 mt-0.5">
                Twitter mute syncing in background — items below flip ● green as they sync.
              </div>
            )}
          </div>
        )}
        {batch.kind === "err" && (
          <div className="text-xs bg-red-900/40 border border-red-700 rounded p-2 break-words">
            ✗ {batch.detail}
          </div>
        )}
      </div>

      {unsynced.length > 0 && (
        <div className="bg-amber-900/40 border border-amber-700 rounded p-2 text-xs space-y-2">
          <div className="font-semibold">
            ⚠️ {unsynced.length} items not synced to Twitter
          </div>
          <div>
            <button onClick={doRetry} disabled={retry.kind === "running" || progress !== null}
              className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white px-2 py-1 rounded text-xs">
              {(retry.kind === "running" || progress !== null) ? "Syncing…" : "Sync to Twitter now"}
            </button>
            {progress !== null && (
              <div className="mt-1 text-emerald-300">
                Syncing {progress.phase}: {progress.completed}/{progress.total}
                {progress.current && <> · <span className={maskCls}>{progress.current}</span></>}
                <div className="text-neutral-500">Runs in background — safe to close popup.</div>
              </div>
            )}
            {retry.kind === "done" && retry.report.noAuth && (
              <div className="text-red-300 mt-1">
                ✗ No Twitter auth captured — open a x.com tab and scroll briefly, then retry.
              </div>
            )}
            {retry.kind === "done" && !retry.report.noAuth && (
              <div className={retry.report.ok ? "text-emerald-300 mt-1" : "text-amber-200 mt-1"}>
                {retry.report.ok ? "✓" : retry.report.rateLimited ? "🛑" : "⚠"}{" "}
                {retry.report.succeeded}/{retry.report.attempted} synced
                {retry.report.removed && retry.report.removed.length > 0 && (
                  <span className="text-neutral-400"> · {retry.report.removed.length} removed (likely suspended/deleted)</span>
                )}
                {retry.report.rateLimited && (
                  <div className="text-red-300 mt-1">
                    Twitter rate-limited (HTTP 429). Stopped to avoid making it worse — wait ~15 min then click Sync again.
                  </div>
                )}
                {!retry.report.rateLimited && retry.report.failed.length > 0 && (
                  <ul className="ml-3 mt-1 list-disc space-y-0.5">
                    {retry.report.failed.slice(0, 3).map((f, i) => (
                      <li key={i} className="break-words"><span className={maskCls}>{f.value}</span>: {f.reason}</li>
                    ))}
                    {retry.report.failed.length > 3 && <li>…+{retry.report.failed.length - 3} more</li>}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <section>
        <h3 className="font-semibold mb-1">Keywords ({state.learned.keywords.length})</h3>
        <ul className="space-y-1">
          {state.learned.keywords.map((k) => (
            <li key={k.phrase} className="flex items-center justify-between bg-neutral-800 rounded px-2 py-1">
              <span className="font-mono text-xs">
                <span title={k.syncedToTwitter ? "synced to Twitter mute" : "local DOM hide only — Twitter not synced"}
                  className={k.syncedToTwitter ? "text-emerald-400 mr-1" : "text-amber-400 mr-1"}>
                  {k.syncedToTwitter ? "●" : "○"}
                </span>
                <span className={maskCls}>{k.phrase}</span> <span className="text-neutral-500">[{k.category}]</span>
              </span>
              <button onClick={() => send({ kind: "learned/delete", payload: { type: "keyword", value: k.phrase } })}
                className="text-red-400 hover:text-red-300 text-xs">delete</button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="font-semibold mb-1">Users ({state.learned.users.length})</h3>
        <ul className="space-y-1">
          {state.learned.users.map((u) => (
            <li key={u.handle} className="flex items-center justify-between bg-neutral-800 rounded px-2 py-1">
              <span className="text-xs min-w-0 truncate">
                <span title={u.syncedToTwitter ? "synced to Twitter block/mute" : "local DOM hide only — not synced to Twitter"}
                  className={u.syncedToTwitter ? "text-emerald-400 mr-1" : "text-amber-400 mr-1"}>
                  {u.syncedToTwitter ? "●" : "○"}
                </span>
                {u.displayName && <span className={`text-neutral-200 ${maskCls}`}>{u.displayName} </span>}
                <span className={`font-mono text-neutral-500 ${maskCls}`}>@{u.handle}</span>
              </span>
              <button onClick={() => send({ kind: "learned/delete", payload: { type: "user", value: u.handle } })}
                className="text-red-400 hover:text-red-300 text-xs ml-2 shrink-0">delete</button>
            </li>
          ))}
        </ul>
      </section>

      {(state.whitelist.keywords.length + state.whitelist.users.length) > 0 && (
        <section>
          <h3 className="font-semibold mb-1">
            Whitelist ({state.whitelist.keywords.length + state.whitelist.users.length})
            <span className="text-neutral-500 font-normal text-xs ml-2">auto-added when you delete from Library — LLM won't propose these again</span>
          </h3>
          <ul className="space-y-1">
            {state.whitelist.keywords.map((k) => (
              <li key={`wlk-${k}`} className="flex items-center justify-between bg-neutral-900 border border-neutral-800 rounded px-2 py-1">
                <span className="font-mono text-xs text-neutral-300">
                  <span className="text-neutral-600 mr-1">kw</span><span className={maskCls}>{k}</span>
                </span>
                <button onClick={() => send({ kind: "whitelist/remove", payload: { type: "keyword", value: k } })}
                  className="text-neutral-400 hover:text-red-300 text-xs">remove</button>
              </li>
            ))}
            {state.whitelist.users.map((h) => (
              <li key={`wlu-${h}`} className="flex items-center justify-between bg-neutral-900 border border-neutral-800 rounded px-2 py-1">
                <span className="font-mono text-xs text-neutral-300">
                  <span className="text-neutral-600 mr-1">user</span><span className={maskCls}>@{h}</span>
                </span>
                <button onClick={() => send({ kind: "whitelist/remove", payload: { type: "user", value: h } })}
                  className="text-neutral-400 hover:text-red-300 text-xs">remove</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
