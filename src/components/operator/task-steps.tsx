import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

export type StepState = "done" | "now" | "next";

/** The short path of a task: done (ink, tick) / now (yellow) / later (grey). Labels are one or two words so four fit in 360 px. */
export function Stepper({ steps, label }: { steps: { label: string; state: StepState; optional?: string }[]; label: string }) {
  return (
    <ol aria-label={label} className="flex items-start">
      {steps.map((s, i) => (
        <li key={i} aria-current={s.state === "now" ? "step" : undefined} className="relative flex min-w-0 flex-1 flex-col items-center text-center">
          {i > 0 && <span aria-hidden className={`absolute left-[-50%] right-[50%] top-3.5 h-[3px] ${s.state === "next" ? "bg-dock-line" : "bg-dock-ink"}`} />}
          <span
            className={`cond relative z-10 grid h-7 w-7 place-items-center text-sm font-bold ${
              s.state === "done" ? "bg-dock-ink text-dock-yellow" : s.state === "now" ? "bg-dock-yellow ring-2 ring-dock-ink" : "border-2 border-dock-line bg-white text-dock-ink/45"
            }`}
          >
            {s.state === "done" ? <Check size={15} aria-hidden /> : i + 1}
          </span>
          <span className={`cond mt-1 w-full break-words px-0.5 text-[11px] leading-tight ${s.state === "next" ? "text-dock-ink/45" : "font-semibold"}`}>{s.label}</span>
          {s.optional && <span className="text-[10px] leading-tight text-dock-ink/45">{s.optional}</span>}
        </li>
      ))}
    </ol>
  );
}

/** The one sentence that says what to do now, with a verb. */
export function NowLine({ tag, children }: { tag: string; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 border-[1.5px] border-dock-ink bg-dock-yellow px-3 py-2.5 text-base font-semibold leading-snug">
      <span className="cond mt-0.5 shrink-0 bg-dock-ink px-1.5 py-0.5 text-[11px] text-dock-yellow">{tag}</span>
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

/** Heading of a numbered block inside a task. */
export function StepHead({ n, title, done, optional }: { n: number; title: string; done?: boolean; optional?: string }) {
  return (
    <h2 className="flex items-center gap-2 font-semibold">
      <span className={`cond grid h-6 w-6 shrink-0 place-items-center text-xs ${done ? "bg-dock-ink text-dock-yellow" : "border-[1.5px] border-dock-ink"}`}>{done ? <Check size={13} aria-hidden /> : n}</span>
      {title}
      {optional && <span className="cond ml-auto text-[11px] font-normal text-dock-ink/50">{optional}</span>}
    </h2>
  );
}

/** A task is finished: say so, and put the next logical step under the thumb. */
export function DoneBand({ title, sub, href, cta }: { title: string; sub?: string; href: string; cta: string }) {
  return (
    <div className="space-y-3">
      <div className="hazard p-1">
        <div className="bg-dock-ink px-5 py-5 text-center text-white">
          <Check className="mx-auto text-dock-yellow" size={30} aria-hidden />
          <p className="mt-1 text-xl font-semibold">{title}</p>
          {sub && <p className="text-sm text-white/65">{sub}</p>}
        </div>
      </div>
      <Link href={href} className="cond flex min-h-16 w-full items-center justify-center gap-3 bg-dock-yellow px-4 py-4 text-xl font-bold ring-[1.5px] ring-dock-ink active:brightness-90">
        {cta} <ArrowRight size={22} aria-hidden />
      </Link>
    </div>
  );
}
