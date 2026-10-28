"use client";

import { useState, useTransition } from "react";
import { setPartialPallets } from "@/app/office/billing/actions";
import { RULE_HELP, RULE_LABEL } from "@/lib/billing/view";

type Rule = "FRACTION" | "FULL";

/** Two-button switch for how a customer's loose pallets are charged. */
export function PartialRule({ clientId, value, compact = false }: { clientId: string; value: Rule; compact?: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const choose = (mode: Rule) => {
    if (mode === value || pending) return;
    start(async () => {
      setError(null);
      try {
        await setPartialPallets(clientId, mode);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not change it.");
      }
    });
  };

  return (
    <div className="inline-flex flex-col gap-1">
      <div role="group" aria-label="How loose pallets are charged" className={`flex border-[1.5px] border-dock-ink bg-white ${pending ? "opacity-60" : ""}`}>
        {(["FRACTION", "FULL"] as Rule[]).map((mode) => (
          <button
            key={mode}
            type="button"
            disabled={pending}
            aria-pressed={value === mode}
            title={RULE_HELP[mode]}
            onClick={() => choose(mode)}
            className={`cond whitespace-nowrap ${compact ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs"} ${value === mode ? "bg-dock-ink text-dock-yellow" : "text-dock-ink/60 hover:bg-dock-concrete"}`}
          >
            {RULE_LABEL[mode]}
          </button>
        ))}
      </div>
      {error && <span role="alert" className="text-xs text-dock-red">{error}</span>}
    </div>
  );
}
