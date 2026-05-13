import React, { useEffect, useState } from "react";
import { send } from "@/core/messaging";

interface PushResult { ok: boolean; error?: string; chunks?: number; bytes?: number; pushedAt: number; }
interface PullResult { ok: boolean; error?: string; payload?: { learned: { keywords: unknown[]; users: unknown[] } ; whitelist: { keywords: unknown[]; users: unknown[] }; exportedAt: number; }; pulledAt: number; }
type Status = { kind: "idle" } | { kind: "running" } | { kind: "push"; r: PushResult } | { kind: "pull"; r: PullResult };

const fmtBytes = (n: number): string => n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
const fmtDate = (ms: number): string => new Date(ms).toLocaleString();

export function CloudSync(): React.JSX.Element {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    void chrome.storage.local.get(["tsf_last_sync_push", "tsf_last_sync_pull"]).then((r) => {
      const lastPush = r.tsf_last_sync_push as PushResult | undefined;
      const lastPull = r.tsf_last_sync_pull as PullResult | undefined;
      const pushAt = lastPush?.pushedAt ?? 0;
      const pullAt = lastPull?.pulledAt ?? 0;
      if (pushAt >= pullAt && lastPush) setStatus({ kind: "push", r: lastPush });
      else if (lastPull) setStatus({ kind: "pull", r: lastPull });
    });
  }, []);

  const doPush = async () => {
    setStatus({ kind: "running" });
    const r = (await send({ kind: "sync/push" })) as PushResult;
    setStatus({ kind: "push", r });
  };
  const doPull = async () => {
    if (!confirm("Replace local Library + Whitelist with the cloud snapshot?")) return;
    setStatus({ kind: "running" });
    const r = (await send({ kind: "sync/pull" })) as PullResult;
    setStatus({ kind: "pull", r });
  };

  return (
    <section className="space-y-2">
      <h3 className="font-semibold">
        Cloud sync <span className="text-neutral-500 font-normal text-xs">via your Chrome account · auto every 5 min</span>
      </h3>
      <div className="text-xs text-neutral-500 leading-relaxed">
        Library + Whitelist are auto-pushed to <code>chrome.storage.sync</code>, which Chrome syncs across all devices
        you're signed into. ~91 KB cap (≈ 3000 short keywords). No tokens, no third-party services.
        On a new browser, sign into Chrome and the extension auto-pulls on first install.
      </div>
      <div className="flex gap-2">
        <button onClick={doPush}
          disabled={status.kind === "running"}
          className="flex-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white py-1.5 rounded text-xs">
          {status.kind === "running" ? "…" : "Push now"}
        </button>
        <button onClick={doPull}
          disabled={status.kind === "running"}
          className="flex-1 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white py-1.5 rounded text-xs"
          title="REPLACES local Library + Whitelist with cloud snapshot">
          Restore
        </button>
      </div>
      {status.kind === "push" && (
        status.r.ok ? (
          <div className="text-xs text-emerald-400 space-y-0.5">
            <div>✓ Pushed {fmtBytes(status.r.bytes ?? 0)} in {status.r.chunks} chunk{status.r.chunks === 1 ? "" : "s"} at {fmtDate(status.r.pushedAt)}</div>
          </div>
        ) : (
          <div className="text-xs text-red-400 break-words">✗ {status.r.error}</div>
        )
      )}
      {status.kind === "pull" && (
        status.r.ok && status.r.payload ? (
          <div className="text-xs text-emerald-400 space-y-0.5">
            <div>
              ✓ Restored {status.r.payload.learned.keywords.length} kw · {status.r.payload.learned.users.length} users
              · whitelist {status.r.payload.whitelist.keywords.length + status.r.payload.whitelist.users.length}
            </div>
            <div className="text-neutral-600">
              snapshot from {fmtDate(status.r.payload.exportedAt)}
            </div>
          </div>
        ) : (
          <div className="text-xs text-red-400 break-words">✗ {status.r.error}</div>
        )
      )}
    </section>
  );
}
