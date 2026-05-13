import React, { useEffect, useRef, useState } from "react";
import { loadState, saveState } from "@/core/storage";
import { StateSchema } from "@/core/schemas";
import { SpamPackSchema } from "@/worker/subscription";
import { send } from "@/core/messaging";
import type { ExtensionState } from "@/core/types";

interface ImportPackReport {
  ok: boolean;
  error?: string;
  packName?: string;
  newKeywords: number;
  newUsers: number;
  skippedWhitelist: number;
  skippedDuplicate: number;
  importedAt: number;
}

type ImportStatus =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "pack"; report: ImportPackReport }
  | { kind: "backup"; ok: true; at: number }
  | { kind: "err"; detail: string };

export function ImportExport(): React.JSX.Element {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<ImportStatus>({ kind: "idle" });

  useEffect(() => {
    void chrome.storage.local.get("tsf_last_import_pack").then((r) => {
      const last = r.tsf_last_import_pack as ImportPackReport | undefined;
      if (last) setStatus({ kind: "pack", report: last });
    });
  }, []);

  const downloadJson = (data: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportFullBackup = async () => {
    const state = await loadState();
    downloadJson(state, `xspamcast-backup-${new Date().toISOString().slice(0, 10)}.json`);
  };

  const exportSharePack = async () => {
    const state = await loadState();
    const pack = {
      version: 1,
      name: `pack-${new Date().toISOString().slice(0, 10)}`,
      keywords: state.learned.keywords.map((k) => ({ phrase: k.phrase })),
      users: state.learned.users.map((u) => ({ handle: u.handle, reason: u.reason })),
    };
    downloadJson(pack, `xspamcast-pack-${new Date().toISOString().slice(0, 10)}.json`);
  };

  // Smart import: detect whether the file is a full backup or a share pack and route accordingly.
  // Backups REPLACE state (they're meant for device migration). Packs MERGE (skip whitelist hits +
  // already-learned items) so users can stack subscribe-style packs from multiple sources.
  const importJson = async (file: File) => {
    setStatus({ kind: "running" });
    let raw: unknown;
    try { raw = JSON.parse(await file.text()); }
    catch (e) {
      setStatus({ kind: "err", detail: `invalid JSON: ${String(e).slice(0, 80)}` });
      return;
    }

    // Try full backup first — it's the more authoritative format and a wrong-routing
    // here would silently merge a state file's `config` into nothing.
    const asState = StateSchema.safeParse(raw);
    if (asState.success) {
      if (!confirm("This is a full backup file. REPLACE current Library, Whitelist, AND Settings (incl. API key)?")) {
        setStatus({ kind: "idle" });
        return;
      }
      await saveState(asState.data as ExtensionState);
      setStatus({ kind: "backup", ok: true, at: Date.now() });
      return;
    }

    const asPack = SpamPackSchema.safeParse(raw);
    if (asPack.success) {
      const report = (await send({ kind: "pack/import", payload: { json: JSON.stringify(raw), filename: file.name } })) as ImportPackReport;
      setStatus({ kind: "pack", report });
      return;
    }

    // Neither schema matched — surface the first error from each so the user can tell what shape was expected
    setStatus({
      kind: "err",
      detail: `not a recognised file. Expected a full backup OR a share pack. Backup error: ${asState.error.issues[0]?.message ?? "?"}; pack error: ${asPack.error.issues[0]?.message ?? "?"}`,
    });
  };

  return (
    <div className="mt-2 space-y-2">
      <div className="flex gap-2 flex-wrap">
        <button onClick={exportSharePack}
          className="flex-1 min-w-[100px] bg-emerald-700 hover:bg-emerald-600 py-1.5 rounded text-xs text-white"
          title="Shareable pack — only keywords + users, no API key. Safe to publish.">
          Export share pack
        </button>
        <button onClick={exportFullBackup}
          className="flex-1 min-w-[100px] bg-neutral-700 hover:bg-neutral-600 py-1.5 rounded text-xs"
          title="Full backup — includes API key + all settings. Never share.">
          Export full backup
        </button>
        <button onClick={() => fileRef.current?.click()}
          disabled={status.kind === "running"}
          className="flex-1 min-w-[100px] bg-blue-700 hover:bg-blue-600 disabled:opacity-50 py-1.5 rounded text-xs text-white"
          title="Reads share pack OR full backup JSON. Auto-detects format.">
          {status.kind === "running" ? "Importing…" : "Import file"}
        </button>
        <input ref={fileRef} type="file" accept="application/json" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importJson(f); if (fileRef.current) fileRef.current.value = ""; }} />
      </div>

      {status.kind === "pack" && (
        status.report.ok ? (
          <div className="text-xs text-emerald-400 space-y-0.5 bg-emerald-900/20 border border-emerald-800/40 rounded p-2">
            <div>
              ✓ Imported {status.report.packName ? <b>"{status.report.packName}"</b> : "pack"}
              {" — "}+{status.report.newKeywords} kw, +{status.report.newUsers} users
            </div>
            {(status.report.skippedDuplicate + status.report.skippedWhitelist) > 0 && (
              <div className="text-neutral-500">
                skipped: {status.report.skippedDuplicate} already known, {status.report.skippedWhitelist} whitelisted
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-red-400 break-words bg-red-900/20 border border-red-800/40 rounded p-2">
            ✗ {status.report.error}
          </div>
        )
      )}
      {status.kind === "backup" && (
        <div className="text-xs text-emerald-400 bg-emerald-900/20 border border-emerald-800/40 rounded p-2">
          ✓ Full backup restored at {new Date(status.at).toLocaleString()}
        </div>
      )}
      {status.kind === "err" && (
        <div className="text-xs text-red-400 break-words bg-red-900/20 border border-red-800/40 rounded p-2">
          ✗ {status.detail}
        </div>
      )}

      <div className="text-xs text-neutral-500 leading-relaxed">
        <b className="text-emerald-400">Share pack</b> · only keywords + users, safe to publish.
        Upload to <a href="https://gist.github.com" target="_blank" rel="noreferrer" className="underline">gist.github.com</a> →
        click <b>Raw</b> → paste URL into Sync → Subscription, OR send the file directly and import here.
        <br />
        <b className="text-neutral-300">Full backup</b> · includes API key + all settings. Use to move between devices, never share publicly.
        <br />
        <b className="text-blue-400">Import file</b> auto-detects the format. Share packs <b>merge</b>; full backups <b>replace</b>.
      </div>
    </div>
  );
}
