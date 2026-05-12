import { useEffect, useState } from "react";
import { loadState, subscribeState } from "@/core/storage";
import type { ExtensionState } from "@/core/types";

export function useStore(): ExtensionState | null {
  const [state, setState] = useState<ExtensionState | null>(null);
  useEffect(() => {
    void loadState().then(setState);
    return subscribeState(setState);
  }, []);
  return state;
}

export interface SyncProgress { phase: string; total: number; completed: number; current?: string; }

export function useSyncProgress(): SyncProgress | null {
  const [p, setP] = useState<SyncProgress | null>(null);
  useEffect(() => {
    const KEY = "tsf_progress";
    void chrome.storage.local.get(KEY).then((r) => {
      setP((r[KEY] as SyncProgress | undefined) ?? null);
    });
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && KEY in changes) {
        setP((changes[KEY]!.newValue as SyncProgress | undefined) ?? null);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);
  return p;
}
