import React from "react";
import type { ExtensionState } from "@/core/types";
import { Subscription } from "./Subscription";
import { CloudSync } from "./CloudSync";
import { ImportExport } from "./ImportExport";

export function Sync({ state }: { state: ExtensionState }): React.JSX.Element {
  return (
    <div className="space-y-5 text-sm">
      <Subscription state={state} />
      <hr className="border-neutral-800" />
      <CloudSync />
      <hr className="border-neutral-800" />
      <section className="space-y-2">
        <h3 className="font-semibold">
          Import / Export <span className="text-neutral-500 font-normal text-xs">file-based · bulletproof</span>
        </h3>
        <ImportExport />
      </section>
    </div>
  );
}
