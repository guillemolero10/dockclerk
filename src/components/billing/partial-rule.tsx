"use client";

import { useState, useTransition } from "react";
import { setPartialPallets } from "@/app/office/billing/actions";
import { useT } from "@/lib/i18n/client";

type Rule = "FRACTION" | "FULL";

/** Two-button switch for how a customer's loose pallets are charged. */
export function PartialRule({ clientId, value, compact = false }: { clientId: string; value: Rule; compact?: boolean }) {
  const { t } = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const choose = (mode: Rule) => {
    if (mode === value || pending) return;
    start(async () => {
      setError(null);
      try {
        await setPartialPallets(clientId, mode);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("bi.ruleError"));
      }
    });
  };

  return (
    <div className="inline-flex flex-col gap-1">
      <div role="group" aria-label={t("bi.ruleGroup")} className={`flex border-[1.5px] border-dock-ink bg-white ${pending ? "opacity-60" : ""}`}>
        {(["FRACTION", "FULL"] as Rule[]).map((mode) => (
          <button
            key={mode}
            type="button"
            disabled={pending}
            aria-pressed={value === mode}
            title={t(`bi.help.${mode}` as "bi.help.FULL")}
            onClick={() => choose(mode)}
            className={`cond whitespace-nowrap ${compact ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs"} ${value === mode ? "bg-dock-ink text-dock-yellow" : "text-dock-ink/60 hover:bg-dock-concrete"}`}
          >
            {t(`bi.rule.${mode}` as "bi.rule.FULL")}
          </button>
        ))}
      </div>
      {error && <span role="alert" className="text-xs text-dock-red">{error}</span>}
    </div>
  );
}
