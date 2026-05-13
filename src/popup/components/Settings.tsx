import React, { useState } from "react";
import type { ExtensionState } from "@/core/types";
import { mutateState } from "@/core/storage";
import { HIDE_STYLES } from "@/core/constants";
import { suggestPriceForModel } from "@/core/pricing";

type TestResult =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; detail: string }
  | { kind: "err"; detail: string };

function Section({ title, defaultOpen = false, children }: { title: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <details open={defaultOpen} className="group border border-neutral-800 rounded">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold flex items-center justify-between hover:bg-neutral-900">
        <span>{title}</span>
        <span className="text-neutral-500 text-xs group-open:rotate-90 transition-transform">▶</span>
      </summary>
      <div className="px-3 py-3 border-t border-neutral-800 space-y-2">{children}</div>
    </details>
  );
}

export function Settings({ state }: { state: ExtensionState }): React.JSX.Element {
  const [config, setConfig] = useState(state.config);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<TestResult>({ kind: "idle" });
  const [models, setModels] = useState<string[]>([]);

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
    <div className="space-y-3 text-sm">
      <Section title="LLM (OpenAI-compatible)" defaultOpen>
        <label className="block">
          <span className="text-neutral-400 text-xs">Base URL</span>
          <input className="w-full mt-1 bg-neutral-800 px-2 py-1 rounded"
            value={config.llm.baseUrl}
            onChange={(e) => setConfig({ ...config, llm: { ...config.llm, baseUrl: e.target.value } })} />
        </label>
        <label className="block">
          <span className="text-neutral-400 text-xs">API Key (stored locally in plaintext)</span>
          <input type="password" className="w-full mt-1 bg-neutral-800 px-2 py-1 rounded"
            value={config.llm.apiKey}
            onChange={(e) => setConfig({ ...config, llm: { ...config.llm, apiKey: e.target.value } })} />
        </label>
        <label className="block">
          <span className="text-neutral-400 text-xs">
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
          className="mt-1 w-full bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50 text-white py-1.5 rounded text-xs">
          {test.kind === "testing" ? "Testing…" : "Test connection"}
        </button>
        {test.kind === "ok" && (
          <div className="text-xs text-emerald-400 break-words">✓ {test.detail}</div>
        )}
        {test.kind === "err" && (
          <div className="text-xs text-red-400 break-words">✗ {test.detail}</div>
        )}

        {/* Pricing — optional. When set, Stats shows estimated cost per day/week/all-time. */}
        <div className="border-t border-neutral-800 pt-3 mt-3 space-y-2">
          <div className="text-xs text-neutral-400 flex items-center justify-between">
            <span>Pricing <span className="text-neutral-600">(USD per 1M tokens, optional)</span></span>
            <button
              type="button"
              onClick={() => {
                const p = suggestPriceForModel(config.llm.model);
                if (!p) { alert(`No default price for "${config.llm.model}". Enter manually.`); return; }
                setConfig({
                  ...config,
                  llm: { ...config.llm, pricePerMillionInput: p.pricePerMillionInput, pricePerMillionOutput: p.pricePerMillionOutput },
                });
              }}
              className="text-[11px] text-blue-400 hover:text-blue-300 underline"
            >
              Auto-fill from model
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-neutral-500 text-[11px]">Input $/1M</span>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 0.27"
                className="w-full mt-1 bg-neutral-800 px-2 py-1 rounded text-xs"
                value={config.llm.pricePerMillionInput ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  const llm = { ...config.llm };
                  if (v === "") delete llm.pricePerMillionInput;
                  else llm.pricePerMillionInput = Number(v);
                  setConfig({ ...config, llm });
                }}
              />
            </label>
            <label className="block">
              <span className="text-neutral-500 text-[11px]">Output $/1M</span>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 1.10"
                className="w-full mt-1 bg-neutral-800 px-2 py-1 rounded text-xs"
                value={config.llm.pricePerMillionOutput ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  const llm = { ...config.llm };
                  if (v === "") delete llm.pricePerMillionOutput;
                  else llm.pricePerMillionOutput = Number(v);
                  setConfig({ ...config, llm });
                }}
              />
            </label>
          </div>
          <div className="text-[11px] text-neutral-500 leading-relaxed">
            Default values are public list prices and may not match your relay / promotional rates.
            Leave empty to skip cost estimates (Stats will still show token counts).
          </div>
        </div>
      </Section>

      <Section title="Behavior">
        <label className="block">
          <span className="text-neutral-400 text-xs">Hide style</span>
          <select className="w-full mt-1 bg-neutral-800 px-2 py-1 rounded"
            value={config.hideStyle}
            onChange={(e) => setConfig({ ...config, hideStyle: e.target.value as typeof HIDE_STYLES[number] })}>
            <option value="collapse">collapse — show a clickable banner</option>
            <option value="nuke">nuke — remove the tweet entirely</option>
          </select>
        </label>
        <div className="text-xs text-neutral-500 bg-neutral-900 border border-neutral-800 rounded p-2">
          <b className="text-neutral-300">Fully automatic, local-only</b> — LLM verdicts go straight to Library and the content script hides matching tweets instantly. No Twitter API calls. To rollback a false positive, delete the item in the Library tab — it's auto-added to the whitelist so the LLM won't propose it again.
        </div>
      </Section>

      <Section title={<>Custom prompt <span className="text-neutral-500 font-normal text-xs ml-1">appended to system prompt</span></>}>
        <textarea
          rows={5}
          className="w-full bg-neutral-800 px-2 py-1 rounded text-xs font-mono leading-relaxed"
          placeholder={`e.g.\n- I follow stock analysis — don't flag tweets about stocks/futures/options as spam\n- Treat any mention of 'meme coin' or 'crypto airdrop' as a scam pattern\n- Never block @nytimes or @WSJ regardless of content\n- 'VPN tutorial' is fine — I write tech content, not spam`}
          value={config.customPrompt ?? ""}
          onChange={(e) => {
            const { customPrompt: _drop, ...rest } = config;
            const v = e.target.value;
            setConfig(v ? { ...rest, customPrompt: v } : rest);
          }}
        />
        <div className="text-xs text-neutral-500 leading-relaxed">
          Free-form domain notes in any language — describe what spam looks like in <i>your</i> feed
          (vocabulary, accounts to whitelist, scam topics to flag). The LLM uses these to inform classification on top of the built-in heuristics. The output JSON schema is fixed and cannot be changed from here.
        </div>
      </Section>

      <button onClick={save} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded">
        {saved ? "Saved ✓" : "Save"}
      </button>
    </div>
  );
}
