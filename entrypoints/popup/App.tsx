import React, { useState } from "react";
import { useStore } from "@/popup/useStore";
import { Settings } from "@/popup/components/Settings";
import { LearnedList } from "@/popup/components/LearnedList";
import { Sync } from "@/popup/components/Sync";
import { Onboarding } from "@/popup/components/Onboarding";

type Tab = "learned" | "sync" | "settings";

export function App(): React.JSX.Element {
  const state = useStore();
  const [tab, setTab] = useState<Tab>("learned");
  if (!state) return <div className="p-4">Loading…</div>;

  // No LLM key configured → the Library tab is meaningless. Show onboarding instead;
  // the user shouldn't have to discover the Settings tab on their own.
  const needsSetup = !state.config.llm.apiKey;

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "learned", label: "Library", badge: state.learned.keywords.length + state.learned.users.length },
    { id: "sync", label: "Sync" },
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
        {tab === "learned" && (needsSetup
          ? <Onboarding onOpenSettings={() => setTab("settings")} />
          : <LearnedList state={state} />)}
        {tab === "sync" && <Sync state={state} />}
        {tab === "settings" && <Settings state={state} />}
      </main>
    </div>
  );
}
