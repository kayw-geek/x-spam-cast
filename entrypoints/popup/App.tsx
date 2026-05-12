import React, { useState } from "react";
import { useStore } from "@/popup/useStore";
import { Settings } from "@/popup/components/Settings";
import { LearnedList } from "@/popup/components/LearnedList";
import { Stats } from "@/popup/components/Stats";
import { ImportExport } from "@/popup/components/ImportExport";

type Tab = "learned" | "settings" | "stats";

export function App(): React.JSX.Element {
  const state = useStore();
  const [tab, setTab] = useState<Tab>("learned");
  if (!state) return <div className="p-4">Loading…</div>;

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "learned", label: "Library", badge: state.learned.keywords.length + state.learned.users.length },
    { id: "stats", label: "Stats" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <div className="flex flex-col h-full">
      <nav className="flex border-b border-neutral-700">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 px-3 py-2 text-sm ${tab === t.id ? "bg-neutral-800 text-white" : "text-neutral-400"}`}
          >
            {t.label}{t.badge ? ` (${t.badge})` : ""}
          </button>
        ))}
      </nav>
      <main className="flex-1 overflow-y-auto p-3">
        {tab === "learned" && <LearnedList state={state} />}
        {tab === "stats" && (<><Stats state={state} /><ImportExport /></>)}
        {tab === "settings" && <Settings state={state} />}
      </main>
    </div>
  );
}
