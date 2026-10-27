"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { processMessage } from "@/app/office/inbox/actions";
import type { StepKind } from "@/lib/agent/types";

type Pending = { id: string; from: string };
type Line = { kind: StepKind | "head"; text: string };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs the clerk message by message and prints its reasoning as it goes. */
export function ClerkRunner({ pending }: { pending: Pending[] }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  async function run() {
    setRunning(true);
    setError(null);
    setLines([]);
    try {
      for (const [i, m] of pending.entries()) {
        setLines((l) => [...l, { kind: "head", text: `[${i + 1}/${pending.length}] ${m.from}` }]);
        const result = await processMessage(m.id);
        // Steps are already computed; pace them so a person can follow the reasoning.
        // The header line already names the sender, so skip the "read" step here.
        for (const step of result.steps.filter((s) => s.kind !== "read")) {
          await wait(140);
          setLines((l) => [...l, step]);
        }
        setDone(i + 1);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  if (pending.length === 0 && lines.length === 0) return null;

  return (
    <div className="dock-console overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-3">
        <div className="flex items-center gap-2 text-sm">
          <span className={`h-2 w-2 rounded-full ${running ? "dock-live bg-dock-yellow" : "bg-white/30"}`} />
          <span className="cond text-white/70">
            {running ? `AI clerk working · ${done}/${pending.length}` : lines.length ? "AI clerk · finished" : `${pending.length} messages waiting`}
          </span>
        </div>
        {!running && pending.length > 0 && (
          <button onClick={run} className="cond flex items-center gap-2 bg-dock-yellow px-4 py-2 text-sm font-semibold text-dock-ink transition hover:brightness-95">
            <Sparkles size={15} /> Let the clerk handle {pending.length} messages
          </button>
        )}
      </div>
      {lines.length > 0 && (
        <div ref={logRef} className="mono max-h-72 overflow-y-auto px-5 py-3 text-[12.5px] leading-relaxed">
          {lines.map((l, i) =>
            l.kind === "head" ? (
              <div key={i} className="mt-2 text-white first:mt-0">{l.text}</div>
            ) : (
              <div key={i} className={l.kind === "ok" ? "ok" : l.kind === "ask" ? "ask" : l.kind === "tool" ? "tool" : "text-white/50"}>
                <span className="t">{l.kind === "ok" ? "  ✓ " : l.kind === "ask" ? "  ⚠ " : "  → "}</span>
                {l.text}
              </div>
            ),
          )}
          {running && <span className="dock-live inline-block h-3.5 w-2 translate-y-0.5 bg-dock-yellow" />}
        </div>
      )}
      {error && <p className="px-5 pb-3 text-sm text-red-300">{error}</p>}
    </div>
  );
}
