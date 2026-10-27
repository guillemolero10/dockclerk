"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Bot, Send } from "lucide-react";
import { askClerk, type AskResult } from "@/app/portal/actions";

type Turn = { question: string; result: AskResult | null; error?: string };

/** Chat with the clerk, limited to this customer's own data. */
export function AskClerk({ examples }: { examples: string[] }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [turns]);

  const ask = (question: string) => {
    if (!question.trim()) return;
    setText("");
    setTurns((t) => [...t, { question, result: null }]);
    start(async () => {
      try {
        const result = await askClerk(question);
        setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, result } : x)));
      } catch (err) {
        setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: err instanceof Error ? err.message : "Something went wrong." } : x)));
      }
    });
  };

  return (
    <div className="dock-card flex min-h-[460px] flex-col overflow-hidden bg-white">
      <div className="flex-1 space-y-4 p-5">
        {turns.length === 0 && (
          <div className="space-y-2">
            <p className="cond text-[11px] text-dock-ink/50">Try</p>
            {examples.map((e) => (
              <button key={e} onClick={() => ask(e)} className="block w-full border-[1.5px] border-dock-line px-3 py-2 text-left text-sm hover:border-dock-ink hover:bg-dock-concrete-2">
                {e}
              </button>
            ))}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <p className="ml-auto w-fit max-w-[80%] bg-dock-ink px-3 py-2 text-sm text-white">{t.question}</p>
            {t.error ? (
              <p className="text-sm text-dock-red">{t.error}</p>
            ) : t.result ? (
              <div className="max-w-[85%] space-y-1.5">
                <p className={`px-3 py-2 text-sm ${t.result.kind === "forwarded" ? "bg-dock-yellow ring-[1.5px] ring-dock-ink" : "bg-dock-concrete-2"}`}>
                  <span className="cond mb-0.5 flex items-center gap-1 text-[10px] text-dock-ink/50">
                    <Bot size={11} /> {t.result.kind === "forwarded" ? "Passed to the office" : "From the live software"}
                  </span>
                  {t.result.text}
                </p>
                <details className="dock-console px-3 py-1.5">
                  <summary className="cond cursor-pointer text-[10px] text-white/50">How the clerk got here</summary>
                  <div className="mono mt-1 space-y-0.5 text-[11px]">
                    {t.result.steps.map((s, j) => (
                      <div key={j} className={s.kind === "ok" ? "ok" : s.kind === "ask" ? "ask" : s.kind === "tool" ? "tool" : "text-white/50"}>
                        → {s.text}
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-dock-ink/50">
                <span className="dock-live h-2 w-2 rounded-full bg-dock-yellow" /> Checking the software…
              </p>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(text);
        }}
        className="flex gap-2 border-t-[1.5px] border-dock-ink p-3"
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask about your stock, or request a shipment…" className="dock-input flex-1" />
        <button disabled={pending || !text.trim()} className="cond flex items-center gap-1.5 bg-dock-ink px-4 text-sm text-dock-yellow disabled:opacity-50">
          <Send size={14} /> Send
        </button>
      </form>
    </div>
  );
}
