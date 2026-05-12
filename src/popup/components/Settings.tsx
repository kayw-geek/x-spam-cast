import React, { useEffect, useState } from "react";
import type { ExtensionState } from "@/core/types";
import { mutateState } from "@/core/storage";
import { send } from "@/core/messaging";
import { SPAM_CATEGORIES, HIDE_STYLES, type SpamCategory } from "@/core/constants";

type TestResult =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; detail: string }
  | { kind: "err"; detail: string };

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

interface PushReport {
  ok: boolean;
  error?: string;
  gistId?: string;
  htmlUrl?: string;
  createdNew?: boolean;
  pushedAt: number;
}
interface PullReport {
  ok: boolean;
  error?: string;
  learnedKeywords?: number;
  learnedUsers?: number;
  whitelistKeywords?: number;
  whitelistUsers?: number;
  exportedAt?: number;
  pulledAt: number;
}
type BackupStatus = { kind: "idle" } | { kind: "running" } | { kind: "push"; report: PushReport } | { kind: "pull"; report: PullReport };

export function Settings({ state }: { state: ExtensionState }): React.JSX.Element {
  const [config, setConfig] = useState(state.config);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<TestResult>({ kind: "idle" });
  const [models, setModels] = useState<string[]>([]);
  const [sub, setSub] = useState<SubStatus>({ kind: "idle" });
  const [backup, setBackup] = useState<BackupStatus>({ kind: "idle" });

  useEffect(() => {
    void chrome.storage.local.get(["tsf_last_subscription", "tsf_last_backup_push", "tsf_last_backup_pull"]).then((r) => {
      const sub = r.tsf_last_subscription as SubReport | undefined;
      if (sub) setSub({ kind: "done", report: sub });
      // Show whichever backup op happened most recently
      const lastPush = r.tsf_last_backup_push as PushReport | undefined;
      const lastPull = r.tsf_last_backup_pull as PullReport | undefined;
      const pushAt = lastPush?.pushedAt ?? 0;
      const pullAt = lastPull?.pulledAt ?? 0;
      if (pushAt >= pullAt && lastPush) setBackup({ kind: "push", report: lastPush });
      else if (lastPull) setBackup({ kind: "pull", report: lastPull });
    });
  }, []);

  const ensureGitHubPermission = async (): Promise<boolean> => {
    const has = await chrome.permissions.contains({ origins: ["https://api.github.com/*"] });
    if (has) return true;
    return await chrome.permissions.request({ origins: ["https://api.github.com/*"] });
  };

  const doBackupPush = async () => {
    if (!(await ensureGitHubPermission())) {
      setBackup({ kind: "push", report: { ok: false, error: "permission denied for api.github.com", pushedAt: Date.now() } });
      return;
    }
    await mutateState((s) => { s.config = config; }); // ensure latest token saved before background reads it
    setBackup({ kind: "running" });
    const r = (await send({ kind: "backup/push" })) as PushReport;
    setBackup({ kind: "push", report: r });
    if (r.ok && r.gistId && r.gistId !== config.backupGistId) {
      // Mirror the gist id into local form so the field shows the freshly-created id
      const id = r.gistId;
      setConfig((c) => ({ ...c, backupGistId: id }));
    }
  };
  const doBackupPull = async () => {
    if (!(await ensureGitHubPermission())) {
      setBackup({ kind: "pull", report: { ok: false, error: "permission denied for api.github.com", pulledAt: Date.now() } });
      return;
    }
    if (!confirm("Replace local Library + Whitelist with backup contents from gist? (Cache merges, not replaces.)")) return;
    await mutateState((s) => { s.config = config; });
    setBackup({ kind: "running" });
    const r = (await send({ kind: "backup/pull" })) as PullReport;
    setBackup({ kind: "pull", report: r });
  };

  const refreshSub = async () => {
    // Save URL first so background reads the latest value
    await mutateState((s) => { s.config = config; });
    setSub({ kind: "running" });
    const r = (await send({ kind: "subscription/refresh" })) as SubReport;
    setSub({ kind: "done", report: r });
  };

  const ensureSubPermission = async (): Promise<boolean> => {
    const url = config.subscriptionUrl;
    if (!url) return false;
    try {
      const origin = new URL(url).origin;
      const has = await chrome.permissions.contains({ origins: [`${origin}/*`] });
      if (has) return true;
      return await chrome.permissions.request({ origins: [`${origin}/*`] });
    } catch { return false; }
  };

  const save = async () => {
    await mutateState((s) => { s.config = config; });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const ensureHostPermission = async (urlStr: string): Promise<{ ok: true } | { ok: false; reason: string }> => {
    let origin: string;
    try { origin = new URL(urlStr).origin; }
    catch { return { ok: false, reason: "invalid baseUrl" }; }
    const pattern = `${origin}/*`;
    const has = await chrome.permissions.contains({ origins: [pattern] });
    if (has) return { ok: true };
    try {
      const granted = await chrome.permissions.request({ origins: [pattern] });
      return granted ? { ok: true } : { ok: false, reason: `permission denied for ${origin}` };
    } catch (e) {
      return { ok: false, reason: `permission request failed: ${String(e)}` };
    }
  };

  const testConnection = async () => {
    setTest({ kind: "testing" });
    const base = config.llm.baseUrl.replace(/\/$/, "");
    const perm = await ensureHostPermission(base);
    if (!perm.ok) { setTest({ kind: "err", detail: perm.reason }); return; }
    try {
      // Try GET /models first (cheap, no token usage)
      const modelsResp = await fetch(`${base}/models`, {
        headers: { authorization: `Bearer ${config.llm.apiKey}` },
      });
      if (modelsResp.ok) {
        const data = await modelsResp.json().catch(() => ({}));
        const ids: string[] = Array.isArray(data?.data)
          ? data.data.map((m: { id?: string }) => m?.id).filter((x: unknown): x is string => typeof x === "string").sort()
          : [];
        setModels(ids);
        const found = ids.includes(config.llm.model);
        setTest({
          kind: "ok",
          detail: ids.length > 0
            ? `${ids.length} models available${found ? ` · "${config.llm.model}" ✓` : ` · "${config.llm.model}" not in list (may still work)`}`
            : "endpoint reachable",
        });
        return;
      }
      // Some relays don't expose /models — fall back to a 1-token chat completion ping
      if (modelsResp.status === 404) {
        const pingResp = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${config.llm.apiKey}` },
          body: JSON.stringify({ model: config.llm.model, messages: [{ role: "user", content: "1" }], max_tokens: 1 }),
        });
        if (pingResp.ok) {
          setTest({ kind: "ok", detail: `chat completions reachable · model "${config.llm.model}" accepted` });
          return;
        }
        const body = await pingResp.text().catch(() => "");
        setTest({ kind: "err", detail: `chat ${pingResp.status}: ${body.slice(0, 120)}` });
        return;
      }
      const body = await modelsResp.text().catch(() => "");
      setTest({ kind: "err", detail: `${modelsResp.status}: ${body.slice(0, 120)}` });
    } catch (e) {
      setTest({ kind: "err", detail: `network: ${String(e).slice(0, 120)}` });
    }
  };

  return (
    <div className="space-y-4 text-sm">
      <section>
        <h3 className="font-semibold mb-2">LLM (OpenAI-compatible)</h3>
        <label className="block">
          <span className="text-neutral-400">Base URL</span>
          <input className="w-full mt-1 bg-neutral-800 px-2 py-1 rounded"
            value={config.llm.baseUrl}
            onChange={(e) => setConfig({ ...config, llm: { ...config.llm, baseUrl: e.target.value } })} />
        </label>
        <label className="block mt-2">
          <span className="text-neutral-400">API Key (stored locally in plaintext)</span>
          <input type="password" className="w-full mt-1 bg-neutral-800 px-2 py-1 rounded"
            value={config.llm.apiKey}
            onChange={(e) => setConfig({ ...config, llm: { ...config.llm, apiKey: e.target.value } })} />
        </label>
        <label className="block mt-2">
          <span className="text-neutral-400">
            Model {models.length > 0 && <span className="text-neutral-600">· {models.length} fetched</span>}
          </span>
          <input
            className="w-full mt-1 bg-neutral-800 px-2 py-1 rounded"
            list="tsf-model-options"
            placeholder={models.length === 0 ? "Click Test connection to fetch list" : "Pick or type a model id"}
            value={config.llm.model}
            onChange={(e) => setConfig({ ...config, llm: { ...config.llm, model: e.target.value } })}
          />
          <datalist id="tsf-model-options">
            {models.map((m) => <option key={m} value={m} />)}
          </datalist>
        </label>
        <button onClick={testConnection}
          disabled={test.kind === "testing"}
          className="mt-2 w-full bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50 text-white py-1.5 rounded text-xs">
          {test.kind === "testing" ? "Testing…" : "Test connection"}
        </button>
        {test.kind === "ok" && (
          <div className="mt-1 text-xs text-emerald-400 break-words">✓ {test.detail}</div>
        )}
        {test.kind === "err" && (
          <div className="mt-1 text-xs text-red-400 break-words">✗ {test.detail}</div>
        )}
      </section>

      <section>
        <h3 className="font-semibold mb-2">Behavior</h3>
        <label className="block">
          <span className="text-neutral-400">Batch threshold (tweets)</span>
          <input type="number" min={10} className="w-full mt-1 bg-neutral-800 px-2 py-1 rounded"
            value={config.batchThreshold}
            onChange={(e) => setConfig({ ...config, batchThreshold: Number(e.target.value) || 50 })} />
        </label>
        <label className="block mt-2">
          <span className="text-neutral-400">Hide style</span>
          <select className="w-full mt-1 bg-neutral-800 px-2 py-1 rounded"
            value={config.hideStyle}
            onChange={(e) => setConfig({ ...config, hideStyle: e.target.value as typeof HIDE_STYLES[number] })}>
            {HIDE_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 mt-2">
          <input type="checkbox" checked={config.syncToTwitterMute}
            onChange={(e) => setConfig({ ...config, syncToTwitterMute: e.target.checked })} />
          <span>Sync to Twitter native mute</span>
        </label>
        <div className="mt-2 text-xs text-neutral-500 bg-neutral-900 border border-neutral-800 rounded p-2">
          <b className="text-neutral-300">Fully automatic (always on)</b> — LLM verdicts go straight to Library and sync to Twitter mute, no manual approval. To rollback a false positive, delete the item in the Library tab — it's auto-added to the whitelist so the LLM won't propose it again.
        </div>
      </section>

      <section>
        <h3 className="font-semibold mb-2">Categories</h3>
        <div className="grid grid-cols-2 gap-1">
          {SPAM_CATEGORIES.map((cat) => (
            <label key={cat} className="flex items-center gap-2">
              <input type="checkbox" checked={config.enabledCategories.includes(cat)}
                onChange={(e) => {
                  const set = new Set(config.enabledCategories);
                  if (e.target.checked) set.add(cat); else set.delete(cat);
                  setConfig({ ...config, enabledCategories: [...set] as SpamCategory[] });
                }} />
              <span>{cat}</span>
            </label>
          ))}
        </div>
      </section>

      <section>
        <h3 className="font-semibold mb-2">
          Custom prompt <span className="text-neutral-500 font-normal text-xs">appended to the system prompt</span>
        </h3>
        <textarea
          rows={5}
          className="w-full bg-neutral-800 px-2 py-1 rounded text-xs font-mono leading-relaxed"
          placeholder={`e.g.\n- I follow stock analysis — don't flag tweets about stocks/futures/options as spam\n- Treat any mention of "meme coin" or "crypto airdrop" as scam (category=scam)\n- Never mute @nytimes or @WSJ regardless of content\n- "VPN tutorial" is fine — I write tech content, not spam`}
          value={config.customPrompt ?? ""}
          onChange={(e) => {
            const { customPrompt: _drop, ...rest } = config;
            const v = e.target.value;
            setConfig(v ? { ...rest, customPrompt: v } : rest);
          }}
        />
        <div className="mt-1 text-xs text-neutral-500 leading-relaxed">
          Free-form rules in any language. Marked as <b>highest priority</b> in the prompt — overrides built-in heuristics. Use to teach the LLM your domain (whitelist topics, force-block patterns, exempt accounts).
        </div>
      </section>

      <section>
        <h3 className="font-semibold mb-2">
          Subscription <span className="text-neutral-500 font-normal text-xs">community spamlist (gist URL)</span>
        </h3>
        <label className="block">
          <span className="text-neutral-400">Pack URL</span>
          <input className="w-full mt-1 bg-neutral-800 px-2 py-1 rounded text-xs"
            placeholder="https://gist.githubusercontent.com/.../raw/spam.json"
            value={config.subscriptionUrl ?? ""}
            onChange={(e) => {
              const { subscriptionUrl: _drop, ...rest } = config;
              const v = e.target.value;
              setConfig(v ? { ...rest, subscriptionUrl: v } : rest);
            }} />
        </label>
        <button
          onClick={async () => {
            if (!(await ensureSubPermission())) {
              setSub({ kind: "done", report: { ok: false, error: "permission denied for host", newKeywords: 0, newUsers: 0, skippedWhitelist: 0, skippedDuplicate: 0, fetchedAt: Date.now() } });
              return;
            }
            await refreshSub();
          }}
          disabled={sub.kind === "running" || !config.subscriptionUrl}
          className="mt-2 w-full bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50 text-white py-1.5 rounded text-xs">
          {sub.kind === "running" ? "Fetching…" : "Refresh subscription now"}
        </button>
        {sub.kind === "done" && (
          sub.report.ok ? (
            <div className="mt-1 text-xs text-emerald-400 space-y-0.5">
              <div>
                ✓ {sub.report.packName ? `"${sub.report.packName}" — ` : ""}
                +{sub.report.newKeywords} kw, +{sub.report.newUsers} users
              </div>
              {(sub.report.skippedDuplicate + sub.report.skippedWhitelist) > 0 && (
                <div className="text-neutral-500">
                  skipped: {sub.report.skippedDuplicate} already known, {sub.report.skippedWhitelist} whitelisted
                </div>
              )}
              <div className="text-neutral-600">
                fetched {new Date(sub.report.fetchedAt).toLocaleString()} · auto-refreshes every 24h
              </div>
            </div>
          ) : (
            <div className="mt-1 text-xs text-red-400 break-words">✗ {sub.report.error}</div>
          )
        )}
        <div className="mt-2 text-xs text-neutral-500">
          Format: <code>{"{ keywords: [{phrase, category}], users: [{handle, reason}] }"}</code>.
          Items already in Library or Whitelist are skipped. Twitter mute syncs in background.
        </div>
      </section>

      <section>
        <h3 className="font-semibold mb-2">
          Backup <span className="text-neutral-500 font-normal text-xs">private gist · auto-sync every 10min</span>
        </h3>
        <label className="block">
          <span className="text-neutral-400">GitHub token (gist scope)</span>
          <input type="password" className="w-full mt-1 bg-neutral-800 px-2 py-1 rounded text-xs"
            placeholder="ghp_..."
            value={config.backupGitHubToken ?? ""}
            onChange={(e) => {
              const { backupGitHubToken: _drop, ...rest } = config;
              const v = e.target.value;
              setConfig(v ? { ...rest, backupGitHubToken: v } : rest);
            }} />
          <span className="text-neutral-600 text-xs">
            Create at <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noreferrer" className="underline">github.com/settings/tokens</a> · only need <code>gist</code> permission
          </span>
        </label>
        <label className="block mt-2">
          <span className="text-neutral-400">Gist ID <span className="text-neutral-600">(auto-filled after first push)</span></span>
          <input className="w-full mt-1 bg-neutral-800 px-2 py-1 rounded text-xs font-mono"
            placeholder="leave empty to create a new private gist on first push"
            value={config.backupGistId ?? ""}
            onChange={(e) => {
              const { backupGistId: _drop, ...rest } = config;
              const v = e.target.value.trim();
              setConfig(v ? { ...rest, backupGistId: v } : rest);
            }} />
        </label>
        <label className="flex items-center gap-2 mt-2 text-xs">
          <input type="checkbox" checked={config.backupAutoSync ?? false}
            onChange={(e) => setConfig({ ...config, backupAutoSync: e.target.checked })} />
          <span>Auto-push every 10min when Library or Whitelist changes</span>
        </label>
        <div className="flex gap-2 mt-2">
          <button onClick={doBackupPush}
            disabled={backup.kind === "running" || !config.backupGitHubToken}
            className="flex-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white py-1.5 rounded text-xs">
            {backup.kind === "running" ? "…" : "Push backup now"}
          </button>
          <button onClick={doBackupPull}
            disabled={backup.kind === "running" || !config.backupGitHubToken || !config.backupGistId}
            className="flex-1 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white py-1.5 rounded text-xs"
            title="REPLACES local Library + Whitelist with backup contents (cache merges)">
            Pull restore
          </button>
        </div>
        {backup.kind === "push" && (
          backup.report.ok ? (
            <div className="mt-1 text-xs text-emerald-400 space-y-0.5">
              <div>✓ {backup.report.createdNew ? "Created new gist" : "Updated"} at {new Date(backup.report.pushedAt).toLocaleString()}</div>
              {backup.report.htmlUrl && (
                <a href={backup.report.htmlUrl} target="_blank" rel="noreferrer" className="text-neutral-400 underline break-all">
                  {backup.report.htmlUrl}
                </a>
              )}
            </div>
          ) : (
            <div className="mt-1 text-xs text-red-400 break-words">✗ {backup.report.error}</div>
          )
        )}
        {backup.kind === "pull" && (
          backup.report.ok ? (
            <div className="mt-1 text-xs text-emerald-400 space-y-0.5">
              <div>
                ✓ Restored {backup.report.learnedKeywords} kw · {backup.report.learnedUsers} users
                · whitelist {(backup.report.whitelistKeywords ?? 0) + (backup.report.whitelistUsers ?? 0)}
              </div>
              {backup.report.exportedAt && (
                <div className="text-neutral-600">
                  backup taken {new Date(backup.report.exportedAt).toLocaleString()}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-1 text-xs text-red-400 break-words">✗ {backup.report.error}</div>
          )
        )}
        <div className="mt-2 text-xs text-neutral-500 leading-relaxed">
          Backs up <b className="text-neutral-300">learned + whitelist + handle cache</b> (no API key, no config).
          Token stored in <code>chrome.storage.local</code> as plaintext — generate a fine-grained token with only <code>gist</code> scope.
          <br />
          <b className="text-neutral-300">New browser?</b> Paste same token + gist ID → click <b>Pull restore</b>.
          Auto-pull also runs at startup if local Library is empty.
        </div>
      </section>

      <button onClick={save} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded">
        {saved ? "Saved ✓" : "Save"}
      </button>
    </div>
  );
}
