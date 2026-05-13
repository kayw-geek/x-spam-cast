import React from "react";
import type { ExtensionState } from "@/core/types";
import { estimateCostUSD, fmtTokens, fmtUSD } from "@/core/pricing";

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

function Sparkline({ values, color = "emerald" }: { values: number[]; color?: "emerald" | "blue" }): React.JSX.Element {
  const max = Math.max(1, ...values);
  const fill = color === "blue" ? "bg-blue-500/70" : "bg-emerald-500/70";
  return (
    <div className="flex items-end gap-1 h-12">
      {values.map((v, i) => {
        const h = Math.max(2, Math.round((v / max) * 44));
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
            <div
              className={v > 0 ? `w-full ${fill} rounded-sm` : "w-full bg-neutral-800 rounded-sm"}
              style={{ height: `${h}px` }}
              title={`${v}`}
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
  const dailyTokens = stats.dailyTokens ?? {};
  const today = dayKey(new Date());
  const todayCount = dailyHits[today] ?? 0;
  const week = last7DayKeys();
  const weekValues = week.map((k) => dailyHits[k] ?? 0);
  const weekTotal = weekValues.reduce((a, b) => a + b, 0);
  const lastBatch = stats.lastBatchAt
    ? new Date(stats.lastBatchAt).toLocaleString()
    : "never";

  // Convergence — fraction of seen feed tweets that still need an LLM call.
  const totalSeen = stats.totalAnalyzed + stats.totalLocalHits;
  const llmTouchedRate = totalSeen > 0 ? stats.totalAnalyzed / totalSeen : 0;
  const ready = totalSeen > 500 && llmTouchedRate < 0.05;

  // Tokens + cost — the "convergence pays off" half of the story.
  const totalP = stats.totalPromptTokens ?? 0;
  const totalC = stats.totalCompletionTokens ?? 0;
  const todayP = dailyTokens[today]?.p ?? 0;
  const todayC = dailyTokens[today]?.c ?? 0;
  const weekP = week.reduce((a, k) => a + (dailyTokens[k]?.p ?? 0), 0);
  const weekC = week.reduce((a, k) => a + (dailyTokens[k]?.c ?? 0), 0);

  const { pricePerMillionInput, pricePerMillionOutput } = state.config.llm;
  const costToday = estimateCostUSD(todayP, todayC, pricePerMillionInput, pricePerMillionOutput);
  const costWeek = estimateCostUSD(weekP, weekC, pricePerMillionInput, pricePerMillionOutput);
  const costAll = estimateCostUSD(totalP, totalC, pricePerMillionInput, pricePerMillionOutput);
  // Per-day cost values for sparkline (in cents to give the bar chart non-trivial integers)
  const dailyCostCents = week.map((k) => {
    const d = dailyTokens[k];
    if (!d) return 0;
    const c = estimateCostUSD(d.p, d.c, pricePerMillionInput, pricePerMillionOutput);
    return c === null ? 0 : Math.round(c * 100);
  });
  const hasCost = costToday !== null;

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

      {/* Token + cost section. Cost only renders when user has set pricing in Settings. */}
      <div className="bg-neutral-800 rounded p-3 text-xs text-neutral-400 space-y-1">
        <div className="text-[10px] text-neutral-400 uppercase tracking-wide mb-1">LLM usage</div>
        <div className="flex justify-between">
          <span>Tokens (today)</span>
          <span className="font-mono text-neutral-200">{fmtTokens(todayP)} in · {fmtTokens(todayC)} out</span>
        </div>
        <div className="flex justify-between">
          <span>Tokens (week)</span>
          <span className="font-mono text-neutral-200">{fmtTokens(weekP)} in · {fmtTokens(weekC)} out</span>
        </div>
        <div className="flex justify-between">
          <span>Tokens (all time)</span>
          <span className="font-mono text-neutral-200">{fmtTokens(totalP)} in · {fmtTokens(totalC)} out</span>
        </div>
        {hasCost && (
          <>
            <div className="border-t border-neutral-700 mt-2 pt-2 flex justify-between">
              <span>Cost (today)</span>
              <span className="font-mono text-emerald-400">{fmtUSD(costToday!)}</span>
            </div>
            <div className="flex justify-between">
              <span>Cost (week)</span>
              <span className="font-mono text-neutral-200">{fmtUSD(costWeek!)}</span>
            </div>
            <div className="flex justify-between">
              <span>Cost (all time)</span>
              <span className="font-mono text-neutral-200">{fmtUSD(costAll!)}</span>
            </div>
          </>
        )}
        {!hasCost && (totalP > 0 || totalC > 0) && (
          <div className="text-[11px] text-neutral-500 mt-1 leading-relaxed">
            Set <b>$ / 1M tokens</b> in Settings → LLM to see cost estimates here.
          </div>
        )}
      </div>

      {hasCost && dailyCostCents.some((v) => v > 0) && (
        <div className="bg-neutral-800 rounded p-3">
          <div className="text-[10px] text-neutral-400 uppercase tracking-wide mb-2">Daily cost (¢) · last 7 days</div>
          <Sparkline values={dailyCostCents} color="blue" />
        </div>
      )}

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
