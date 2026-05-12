import React from "react";
import type { ExtensionState } from "@/core/types";

export function Stats({ state }: { state: ExtensionState }): React.JSX.Element {
  const { stats } = state;
  const rawRate = stats.totalAnalyzed > 0 ? stats.totalLLMCalls / stats.totalAnalyzed : 0;
  const callRate = stats.totalAnalyzed > 0 ? (rawRate * 100).toFixed(1) : "—";
  const lastBatch = stats.lastBatchAt ? new Date(stats.lastBatchAt).toLocaleString() : "never";
  const ready = stats.totalAnalyzed > 500 && rawRate < 0.05;

  return (
    <div className="space-y-2 text-sm">
      <div className="bg-neutral-800 rounded p-3">
        <div className="text-neutral-400">Tweets analyzed</div>
        <div className="text-2xl font-mono">{stats.totalAnalyzed}</div>
      </div>
      <div className="bg-neutral-800 rounded p-3">
        <div className="text-neutral-400">LLM calls</div>
        <div className="text-2xl font-mono">{stats.totalLLMCalls} ({callRate}%)</div>
      </div>
      <div className="bg-neutral-800 rounded p-3">
        <div className="text-neutral-400">Local hits</div>
        <div className="text-2xl font-mono">{stats.totalLocalHits}</div>
      </div>
      <div className="bg-neutral-800 rounded p-3">
        <div className="text-neutral-400">Last batch</div>
        <div className="font-mono text-xs">{lastBatch}</div>
      </div>
      {ready && (
        <div className="bg-emerald-900/40 border border-emerald-700 rounded p-3 text-xs">
          🎓 Convergence detected — LLM call rate &lt; 5% over 7 days. Safe to disable extension and rely on Twitter native mute.
        </div>
      )}
    </div>
  );
}
