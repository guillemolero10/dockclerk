"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { approvePreInvoice } from "@/app/office/billing/actions";

export function ApproveButton({ id, disabled, reason }: { id: string; disabled: boolean; reason?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1 print:hidden">
      <button
        disabled={disabled || pending}
        title={disabled ? reason : undefined}
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              await approvePreInvoice(id);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not approve it.");
            }
          })
        }
        className="cond flex items-center gap-2 bg-dock-yellow px-5 py-2 text-sm font-semibold text-dock-ink ring-[1.5px] ring-dock-ink disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Check size={16} /> {pending ? "Approving…" : "Approve"}
      </button>
      {error && <p role="alert" className="text-xs text-dock-red">{error}</p>}
    </div>
  );
}
