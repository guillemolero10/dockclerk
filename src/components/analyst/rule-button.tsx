"use client";

import { useTransition } from "react";
import { Check, Gauge } from "lucide-react";
import { setPutawayRule } from "@/app/office/analyst/actions";

/** Switches a warehouse's put-away suggestions to the velocity rule (or back). */
export function RuleButton({ warehouseId, label, active }: { warehouseId: string; label: string; active: boolean }) {
  const [pending, start] = useTransition();
  if (active) {
    return (
      <span className="cond flex items-center gap-1.5 bg-dock-ink px-3 py-1.5 text-xs text-dock-yellow">
        <Check size={13} /> Velocity rule on: the PDA now suggests slots by speed
        <button onClick={() => start(() => setPutawayRule(warehouseId, "customer"))} disabled={pending} className="ml-2 text-white/60 underline">
          undo
        </button>
      </span>
    );
  }
  return (
    <button
      onClick={() => start(() => setPutawayRule(warehouseId, "velocity"))}
      disabled={pending}
      className="cond flex items-center gap-1.5 bg-dock-yellow px-3 py-1.5 text-xs font-semibold text-dock-ink ring-[1.5px] ring-dock-ink disabled:opacity-60"
    >
      <Gauge size={13} /> {pending ? "Switching…" : label}
    </button>
  );
}
