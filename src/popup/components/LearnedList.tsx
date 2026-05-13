import React, { useEffect, useState } from "react";
import type { ExtensionState, LearnedKeyword, LearnedUser } from "@/core/types";
import { send } from "@/core/messaging";
import { mutateState } from "@/core/storage";
import { Stats } from "./Stats";

type BatchStatus =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; analyzed: number; applied: number; whitelistRejected: number }
  | { kind: "err"; detail: string };
interface BatchResponse { ok: boolean; analyzed?: number; applied?: number; whitelistRejected?: number; error?: string; }

type Undoable =
  | { type: "keyword"; item: LearnedKeyword }
  | { type: "user"; item: LearnedUser };

const MOSAIC_KEY = "tsf_mosaic";
const UNDO_TIMEOUT_MS = 6000;

export function LearnedList({ state }: { state: ExtensionState }): React.JSX.Element {
  const [batch, setBatch] = useState<BatchStatus>({ kind: "idle" });
  const [mosaic, setMosaic] = useState<boolean>(() => localStorage.getItem(MOSAIC_KEY) === "1");
  const [showStats, setShowStats] = useState(false);
  const [undoable, setUndoable] = useState<Undoable | null>(null);

  // Newest first — addedAt is a timestamp; subscription-imported items share a fetchedAt so
  // they cluster, but anything LLM-mined or manually-marked surfaces above older bulk imports.
  const sortedKeywords = [...state.learned.keywords].sort((a, b) => b.addedAt - a.addedAt);
  const sortedUsers = [...state.learned.users].sort((a, b) => b.addedAt - a.addedAt);

  // Lightweight counts for the always-visible peek; the expanded Stats view does the rest.
  const dailyHits = state.stats.dailyHits ?? {};
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const todayCount = dailyHits[todayKey] ?? 0;
  let weekCount = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    weekCount += dailyHits[k] ?? 0;
  }

  const toggleMosaic = () => {
    setMosaic((m) => {
      const next = !m;
      localStorage.setItem(MOSAIC_KEY, next ? "1" : "0");
      return next;
    });
  };
  const maskCls = mosaic ? "blur-sm hover:blur-none transition-[filter] cursor-help select-none" : "";

  useEffect(() => {
    if (!undoable) return;
    const id = setTimeout(() => setUndoable(null), UNDO_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [undoable]);

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

  const deleteKeyword = async (k: LearnedKeyword) => {
    setUndoable({ type: "keyword", item: k });
    await send({ kind: "learned/delete", payload: { type: "keyword", value: k.phrase } });
  };
  const deleteUser = async (u: LearnedUser) => {
    setUndoable({ type: "user", item: u });
    await send({ kind: "learned/delete", payload: { type: "user", value: u.handle } });
  };

  const performUndo = async () => {
    if (!undoable) return;
    const u = undoable;
    setUndoable(null);
    await mutateState((s) => {
      if (u.type === "keyword") {
        if (!s.learned.keywords.some((x) => x.phrase === u.item.phrase)) {
          s.learned.keywords.push(u.item);
        }
        s.whitelist.keywords = s.whitelist.keywords.filter((k) => k !== u.item.phrase);
      } else {
        const lower = u.item.handle.toLowerCase();
        if (!s.learned.users.some((x) => x.handle.toLowerCase() === lower)) {
          s.learned.users.push(u.item);
        }
        s.whitelist.users = s.whitelist.users.filter((h) => h.toLowerCase() !== lower);
      }
    });
  };

  return (
    <div className="space-y-3 text-sm">
      {/* Compact stats peek — today + week, expand for full sparkline */}
      <div className="bg-neutral-900 border border-neutral-800 rounded">
        <button
          onClick={() => setShowStats((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs text-neutral-400 hover:bg-neutral-800/50"
        >
          <span>
            <span className="text-emerald-400">{todayCount}</span> hidden today
            <span className="text-neutral-600 mx-1">·</span>
            <span className="text-neutral-300">{weekCount}</span> this week
          </span>
          <span>{showStats ? "▾" : "▸"} stats</span>
        </button>
        {showStats && (
          <div className="px-3 pb-3 border-t border-neutral-800 pt-3">
            <Stats state={state} />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-neutral-400">
        <span className="flex-1">
          Queue: {state.pending.queue.length} / {state.config.batchThreshold}
          <span className="text-neutral-600 ml-2">auto-reviews when threshold hit</span>
        </span>
        {state.pending.queue.length > 0 && (
          <button
            onClick={trainNow}
            disabled={batch.kind === "running"}
            className="text-neutral-600 hover:text-emerald-400 disabled:opacity-30 underline text-[11px]"
            title="Force LLM review now (debug — normally auto-fires at threshold)"
          >
            {batch.kind === "running" ? "reviewing…" : "force now"}
          </button>
        )}
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
        </div>
      )}
      {batch.kind === "err" && (
        <div className="text-xs bg-red-900/40 border border-red-700 rounded p-2 break-words">
          ✗ {batch.detail}
        </div>
      )}

      {/* View options row (no sync legend — local filtering only) */}
      <div className="flex items-center justify-end text-[11px] text-neutral-500 pt-1">
        <button
          onClick={toggleMosaic}
          title={mosaic ? "Show contents" : "Mosaic — hide spam phrases (work-safe)"}
          className={`px-1.5 py-0.5 rounded text-[11px] ${mosaic ? "bg-amber-700/70 hover:bg-amber-600 text-white" : "text-neutral-500 hover:text-neutral-300"}`}
        >
          {mosaic ? "🫥 mosaic on" : "🫥 mosaic"}
        </button>
      </div>

      <details className="group border border-neutral-800 rounded">
        <summary className="cursor-pointer select-none px-2 py-1.5 text-sm font-semibold flex items-center justify-between hover:bg-neutral-900">
          <span>Keywords ({state.learned.keywords.length})</span>
          <span className="text-neutral-500 text-xs group-open:rotate-90 transition-transform">▶</span>
        </summary>
        <ul className="space-y-1 px-2 pb-2 pt-1">
          {sortedKeywords.map((k) => (
            <li key={k.phrase} className="flex items-center justify-between bg-neutral-800 rounded px-2 py-1">
              <span className="font-mono text-xs">
                <span className={maskCls}>{k.phrase}</span>
              </span>
              <button onClick={() => deleteKeyword(k)}
                className="text-red-400 hover:text-red-300 text-xs">delete</button>
            </li>
          ))}
        </ul>
      </details>

      <details className="group border border-neutral-800 rounded">
        <summary className="cursor-pointer select-none px-2 py-1.5 text-sm font-semibold flex items-center justify-between hover:bg-neutral-900">
          <span>Users ({state.learned.users.length})</span>
          <span className="text-neutral-500 text-xs group-open:rotate-90 transition-transform">▶</span>
        </summary>
        <ul className="space-y-1 px-2 pb-2 pt-1">
          {sortedUsers.map((u) => (
            <li key={u.handle} className="flex items-center justify-between bg-neutral-800 rounded px-2 py-1">
              <span className="text-xs min-w-0 truncate">
                {u.displayName && <span className={`text-neutral-200 ${maskCls}`}>{u.displayName} </span>}
                <span className={`font-mono text-neutral-500 ${maskCls}`}>@{u.handle}</span>
              </span>
              <button onClick={() => deleteUser(u)}
                className="text-red-400 hover:text-red-300 text-xs ml-2 shrink-0">delete</button>
            </li>
          ))}
        </ul>
      </details>

      {(state.whitelist.keywords.length + state.whitelist.users.length) > 0 && (
        <details className="group border border-neutral-800 rounded">
          <summary className="cursor-pointer select-none px-2 py-1.5 text-sm font-semibold flex items-center justify-between hover:bg-neutral-900">
            <span>
              Whitelist ({state.whitelist.keywords.length + state.whitelist.users.length})
              <span className="text-neutral-500 font-normal text-xs ml-2">auto-added on delete</span>
            </span>
            <span className="text-neutral-500 text-xs group-open:rotate-90 transition-transform">▶</span>
          </summary>
          <ul className="space-y-1 px-2 pb-2 pt-1">
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
        </details>
      )}

      {undoable && (
        <div className="fixed bottom-3 left-3 right-3 bg-neutral-900 border border-neutral-700 rounded shadow-lg p-2 text-xs flex items-center gap-2">
          <span className="flex-1 truncate">
            Removed <span className="font-mono text-neutral-400">
              {undoable.type === "keyword" ? undoable.item.phrase : `@${undoable.item.handle}`}
            </span> · auto-whitelisted
          </span>
          <button
            onClick={performUndo}
            className="bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded text-[11px] font-semibold"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
