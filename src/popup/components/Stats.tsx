import React from "react";
import type { ExtensionState } from "@/core/types";

const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function last7DayKeys(): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(dayKey(d));
  }
  return out;
}

function Sparkline({ values }: { values: number[] }): React.JSX.Element {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-1 h-12">
      {values.map((v, i) => {
        const h = Math.max(2, Math.round((v / max) * 44));
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
            <div
              className={v > 0 ? "w-full bg-emerald-500/70 rounded-sm" : "w-full bg-neutral-800 rounded-sm"}
              style={{ height: `${h}px` }}
              title={`${v} hidden`}
            />
            <div className="text-[9px] text-neutral-600">{v}</div>
          </div>
        );
      })}
    </div>
  );
}

export function Stats({ state }: { state: ExtensionState }): React.JSX.Element {
  const { stats } = state;
  const dailyHits = stats.dailyHits ?? {};
  const today = dayKey(new Date());
  const todayCount = dailyHits[today] ?? 0;
  const week = last7DayKeys();
  const weekValues = week.map((k) => dailyHits[k] ?? 0);
  const weekTotal = weekValues.reduce((a, b) => a + b, 0);
  const lastBatch = stats.lastBatchAt
    ? new Date(stats.lastBatchAt).toLocaleString()
    : "never";

  // Convergence — fraction of seen feed tweets that still need an LLM call.
  // Drops as the local library grows, which is what "graduated" actually means.
  const totalSeen = stats.totalAnalyzed + stats.totalLocalHits;
  const llmTouchedRate = totalSeen > 0 ? stats.totalAnalyzed / totalSeen : 0;
  const ready = totalSeen > 500 && llmTouchedRate < 0.05;

  return (
    <div className="space-y-2 text-sm">
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-neutral-800 rounded p-2 text-center">
          <div className="text-[10px] text-neutral-400 uppercase tracking-wide">Today</div>
          <div className="text-2xl font-mono text-emerald-400">{todayCount}</div>
        </div>
        <div className="bg-neutral-800 rounded p-2 text-center">
          <div className="text-[10px] text-neutral-400 uppercase tracking-wide">This week</div>
          <div className="text-2xl font-mono">{weekTotal}</div>
        </div>
        <div className="bg-neutral-800 rounded p-2 text-center">
          <div className="text-[10px] text-neutral-400 uppercase tracking-wide">All time</div>
          <div className="text-2xl font-mono">{stats.totalLocalHits}</div>
        </div>
      </div>

      <div className="bg-neutral-800 rounded p-3">
        <div className="text-[10px] text-neutral-400 uppercase tracking-wide mb-2">Tweets hidden · last 7 days</div>
        <Sparkline values={weekValues} />
      </div>

      <div className="bg-neutral-800 rounded p-3 text-xs text-neutral-400 space-y-1">
        <div className="flex justify-between">
          <span>LLM batches</span>
          <span className="font-mono text-neutral-200">{stats.totalLLMCalls}</span>
        </div>
        <div className="flex justify-between">
          <span>Tweets sent to LLM</span>
          <span className="font-mono text-neutral-200">{stats.totalAnalyzed}</span>
        </div>
        <div className="flex justify-between">
          <span>Last batch</span>
          <span className="font-mono text-neutral-300 text-[11px]">{lastBatch}</span>
        </div>
      </div>

      {ready && (
        <div className="bg-emerald-900/40 border border-emerald-700 rounded p-3 text-xs">
          🎓 <b>Convergence detected.</b> Less than 5% of feed tweets still need the LLM.
          You can clear the API key in <b>Settings → LLM</b> to stop calling it — local matching
          will keep filtering everything in your Library.
        </div>
      )}
    </div>
  );
}
