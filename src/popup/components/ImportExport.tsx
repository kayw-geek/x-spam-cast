import React, { useRef } from "react";
import { loadState, saveState } from "@/core/storage";
import { StateSchema } from "@/core/schemas";
import type { ExtensionState } from "@/core/types";

export function ImportExport(): React.JSX.Element {
  const fileRef = useRef<HTMLInputElement>(null);

  const downloadJson = (data: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Full state dump — contains LLM API key + config. PERSONAL BACKUP only.
  const exportFullBackup = async () => {
    const state = await loadState();
    downloadJson(state, `xspamcast-backup-${new Date().toISOString().slice(0, 10)}.json`);
  };

  // Shareable pack — only learned keywords + users, no config/keys/stats.
  // Same format as subscription consumes. Upload to a gist, share the raw URL.
  const exportSharePack = async () => {
    const state = await loadState();
    const pack = {
      version: 1,
      name: `pack-${new Date().toISOString().slice(0, 10)}`,
      keywords: state.learned.keywords.map((k) => ({ phrase: k.phrase, category: k.category })),
      users: state.learned.users.map((u) => ({ handle: u.handle, reason: u.reason })),
    };
    downloadJson(pack, `xspamcast-pack-${new Date().toISOString().slice(0, 10)}.json`);
  };

  const importJson = async (file: File) => {
    const text = await file.text();
    const parsed = StateSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      alert(`Invalid backup file: ${parsed.error.issues[0]?.message ?? "schema mismatch"}\n\nFor a shareable pack URL, paste it in Settings → Subscription instead.`);
      return;
    }
    if (!confirm("Replace current state with imported data?")) return;
    await saveState(parsed.data as ExtensionState);
  };

  return (
    <div className="mt-4 space-y-2">
      <div className="flex gap-2">
        <button onClick={exportSharePack} className="flex-1 bg-emerald-700 hover:bg-emerald-600 py-1 rounded text-xs text-white"
          title="Shareable spam pack (no API key/config) — upload as gist, share raw URL">
          Export share pack
        </button>
        <button onClick={exportFullBackup} className="flex-1 bg-neutral-700 hover:bg-neutral-600 py-1 rounded text-xs"
          title="Personal backup — includes LLM API key, do not share">
          Export full backup
        </button>
        <button onClick={() => fileRef.current?.click()} className="flex-1 bg-neutral-700 hover:bg-neutral-600 py-1 rounded text-xs">
          Import backup
        </button>
        <input ref={fileRef} type="file" accept="application/json" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importJson(f); }} />
      </div>
      <div className="text-xs text-neutral-500 leading-relaxed">
        <b className="text-emerald-400">Share pack</b>: only keywords + users, safe to publish.
        Upload to <a href="https://gist.github.com" target="_blank" rel="noreferrer" className="underline">gist.github.com</a>,
        click the file's <b>Raw</b> button, copy URL, paste into Settings → Subscription.
        <br />
        <b className="text-neutral-300">Full backup</b>: includes API key + config — for moving between devices, never share.
      </div>
    </div>
  );
}
