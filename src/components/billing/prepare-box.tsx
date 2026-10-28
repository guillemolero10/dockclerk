"use client";

import { useEffect, useState, useTransition } from "react";
import { FilePlus2 } from "lucide-react";
import { prepareMonth } from "@/app/office/billing/actions";

type Line = { kind: "tool" | "ok" | "ask" | "plain"; text: string };

const kindOf = (text: string): Line["kind"] => (text.startsWith("bill_period") ? "ok" : text.startsWith("load_records") ? "tool" : "plain");

/** The "Prepare pre-invoices" button and the console that shows what the clerk did, step by step. */
export function PrepareBox({ month, label, steps, hasApproved }: { month: string; label: string; steps: string[]; hasApproved: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ prepared: number; skipped: { client: string; reason: string }[] } | null>(null);
  // null = show everything; a number = the lines revealed so far (after pressing the button).
  const [shown, setShown] = useState<number | null>(null);

  const lines: Line[] = [{ kind: "ask", text: `prepare_month(${month})` }, ...steps.map((text) => ({ kind: kindOf(text), text }))];
  for (const s of outcome?.skipped ?? []) lines.push({ kind: "ask", text: `skip ${s.client} → ${s.reason}` });
  if (outcome) lines.push({ kind: "ok", text: `${outcome.prepared} pre-invoice${outcome.prepared === 1 ? "" : "s"} drafted · a person approves each one` });

  useEffect(() => {
    if (shown === null || shown >= lines.length) return;
    const t = setTimeout(() => setShown(shown + 1), 160);
    return () => clearTimeout(t);
  }, [shown, lines.length]);

  const visible = pending ? lines.slice(0, 1) : shown === null ? lines : lines.slice(0, shown);
  const empty = outcome !== null && outcome.prepared === 0 && outcome.skipped.length === 0 && steps.length === 0;
  const hasSomething = steps.length > 0 || outcome !== null || pending;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              setOutcome(null);
              try {
                const result = await prepareMonth(month);
                setOutcome(result);
                setShown(0);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not prepare the pre-invoices.");
              }
            })
          }
          className="cond flex items-center gap-2 bg-dock-yellow px-5 py-3 text-sm font-semibold text-dock-ink ring-[1.5px] ring-dock-ink disabled:opacity-60"
        >
          <FilePlus2 size={16} /> {pending ? "Preparing…" : "Prepare pre-invoices"}
        </button>
        <p className="min-w-0 flex-1 text-xs text-dock-ink/60">
          Reads the warehouse records of {label} and drafts one pre-invoice per customer.
          {hasApproved && " Approved ones are never touched."}
        </p>
      </div>
      {error && <p role="alert" className="bg-dock-red/10 px-3 py-2 text-sm text-dock-red">{error}</p>}

      {empty ? (
        <p className="dock-card bg-white p-6 text-center text-sm font-semibold">No movements in {label.split(" ")[0]}.</p>
      ) : (
        hasSomething && (
          <div className="dock-console p-4" aria-live="polite">
            <p className="cond text-[11px] text-white/50">Clerk · how the month was priced</p>
            <ul className="mono mt-2 space-y-1 text-[12.5px] leading-relaxed">
              {visible.map((l, i) => (
                <li key={i} className={`break-words ${l.kind === "plain" ? "text-white/60" : l.kind}`}>
                  <span className="t">{l.kind === "ok" ? "✓ " : l.kind === "ask" ? "⚠ " : "→ "}</span>
                  {l.text}
                </li>
              ))}
              {pending && <li className="text-white/50">→ reading warehouse records…</li>}
            </ul>
          </div>
        )
      )}
    </section>
  );
}
