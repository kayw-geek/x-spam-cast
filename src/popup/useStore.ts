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
