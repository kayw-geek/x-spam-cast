import React from "react";

export function Onboarding({ onOpenSettings }: { onOpenSettings: () => void }): React.JSX.Element {
  return (
    <div className="space-y-3 text-sm">
      <div className="bg-gradient-to-br from-blue-900/40 to-emerald-900/30 border border-blue-700/40 rounded p-4 space-y-3">
        <div className="text-base font-semibold">👋 Get started in 60 seconds</div>
        <ol className="space-y-2 text-neutral-300 list-decimal list-inside leading-relaxed">
          <li>
            Open <b>Settings</b> below and paste an LLM endpoint + API key
            <div className="text-xs text-neutral-500 ml-5">DeepSeek (¥1/M tokens) is the cheapest sane default for Chinese feeds; <code>gpt-4o-mini</code> works for English.</div>
          </li>
          <li>
            Click <b>Test connection</b> — the model picker auto-fills if the endpoint exposes <code>/models</code>
          </li>
          <li>
            Browse x.com normally. The extension batches at 50 unfamiliar tweets, asks the LLM once, applies verdicts.
          </li>
        </ol>
        <button
          onClick={onOpenSettings}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded text-sm font-medium"
        >
          Open Settings →
        </button>
      </div>
      <div className="bg-neutral-900 border border-neutral-800 rounded p-3 text-xs text-neutral-400 leading-relaxed">
        <b className="text-neutral-300">Already have a trained pack?</b> Skip the cold start — paste a community
        spamlist URL into <b>Sync → Subscription</b> for an instant 100+ pre-curated patterns.
      </div>
    </div>
  );
}
