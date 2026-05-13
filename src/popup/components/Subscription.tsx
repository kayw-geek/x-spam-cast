import React, { useEffect, useState } from "react";
import type { ExtensionState } from "@/core/types";
import { mutateState } from "@/core/storage";
import { send } from "@/core/messaging";

interface SubReport {
  ok: boolean;
  error?: string;
  packName?: string;
  newKeywords: number;
  newUsers: number;
  skippedWhitelist: number;
  skippedDuplicate: number;
  fetchedAt: number;
}
type SubStatus = { kind: "idle" } | { kind: "running" } | { kind: "done"; report: SubReport };

export function Subscription({ state }: { state: ExtensionState }): React.JSX.Element {
  const [url, setUrl] = useState(state.config.subscriptionUrl ?? "");
  const [status, setStatus] = useState<SubStatus>({ kind: "idle" });

  useEffect(() => {
    void chrome.storage.local.get("tsf_last_subscription").then((r) => {
      const last = r.tsf_last_subscription as SubReport | undefined;
      if (last) setStatus({ kind: "done", report: last });
    });
  }, []);

  const ensurePermission = async (): Promise<boolean> => {
    if (!url) return false;
    try {
      const origin = new URL(url).origin;
      const has = await chrome.permissions.contains({ origins: [`${origin}/*`] });
      if (has) return true;
      return await chrome.permissions.request({ origins: [`${origin}/*`] });
    } catch { return false; }
  };

  const refresh = async () => {
    if (!(await ensurePermission())) {
      setStatus({ kind: "done", report: { ok: false, error: "permission denied for host", newKeywords: 0, newUsers: 0, skippedWhitelist: 0, skippedDuplicate: 0, fetchedAt: Date.now() } });
      return;
    }
    // Persist URL before background reads it
    await mutateState((s) => {
      if (url) s.config.subscriptionUrl = url;
      else delete s.config.subscriptionUrl;
    });
    setStatus({ kind: "running" });
    const r = (await send({ kind: "subscription/refresh" })) as SubReport;
    setStatus({ kind: "done", report: r });
  };

  return (
    <section className="space-y-2">
      <h3 className="font-semibold">
        Subscription <span className="text-neutral-500 font-normal text-xs">community spamlist (gist URL)</span>
      </h3>
      <label className="block">
        <span className="text-neutral-400 text-xs">Pack URL</span>
        <input className="w-full mt-1 bg-neutral-800 px-2 py-1 rounded text-xs"
          placeholder="https://gist.githubusercontent.com/.../raw/spam.json"
          value={url}
          onChange={(e) => setUrl(e.target.value)} />
      </label>
      <button
        onClick={refresh}
        disabled={status.kind === "running" || !url}
        className="w-full bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50 text-white py-1.5 rounded text-xs">
        {status.kind === "running" ? "Fetching…" : "Refresh subscription now"}
      </button>
      {status.kind === "done" && (
        status.report.ok ? (
          <div className="text-xs text-emerald-400 space-y-0.5">
            <div>
              ✓ {status.report.packName ? `"${status.report.packName}" — ` : ""}
              +{status.report.newKeywords} kw, +{status.report.newUsers} users
            </div>
            {(status.report.skippedDuplicate + status.report.skippedWhitelist) > 0 && (
              <div className="text-neutral-500">
                skipped: {status.report.skippedDuplicate} already known, {status.report.skippedWhitelist} whitelisted
              </div>
            )}
            <div className="text-neutral-600">
              fetched {new Date(status.report.fetchedAt).toLocaleString()} · auto-refreshes every 24h
            </div>
          </div>
        ) : (
          <div className="text-xs text-red-400 break-words">✗ {status.report.error}</div>
        )
      )}
      <div className="text-xs text-neutral-500">
        Format: <code>{"{ keywords: [{phrase, category}], users: [{handle, reason}] }"}</code>.
        Items already in Library or Whitelist are skipped.
      </div>
    </section>
  );
}
