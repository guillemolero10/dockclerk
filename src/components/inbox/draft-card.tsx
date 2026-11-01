"use client";

import { useFormStatus } from "react-dom";
import { AlertTriangle, Check, Mail, MessageCircle, Mic, UserRound, X } from "lucide-react";
import type { Channel, DraftKind } from "@prisma/client";
import { approveDraft, discardDraft } from "@/app/office/inbox/actions";
import { useT } from "@/lib/i18n/client";
import { LOCALE, type Lang } from "@/lib/i18n/core";
import { describeUnits } from "@/lib/pallets/quantity";
import type { Doubt, HumanPayload, OutboundPayload, ReplyPayload, Step } from "@/lib/agent/types";

export type DraftView = {
  id: string;
  kind: DraftKind;
  payload: unknown;
  doubts: Doubt[];
  steps: Step[];
  reply: string | null;
  message: { channel: Channel; fromName: string; clientName: string | null; body: string; receivedAt: Date } | null;
};

const TONE: Record<DraftKind, string> = {
  CREATE_OUTBOUND: "bg-dock-yellow text-dock-ink",
  CREATE_INBOUND: "bg-dock-yellow text-dock-ink",
  REPLY_ONLY: "bg-dock-ink text-white",
  NEEDS_HUMAN: "bg-dock-red text-white",
};

const CHANNEL_ICON: Record<Channel, typeof Mail> = { EMAIL: Mail, WHATSAPP: MessageCircle, PORTAL: UserRound, FLOOR: Mic };

function when(iso: string | null, lang: Lang) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(LOCALE[lang], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });
}

export function DraftCard({ draft }: { draft: DraftView }) {
  const { t, lang } = useT();
  const Icon = draft.message ? CHANNEL_ICON[draft.message.channel] : Mail;
  const order = draft.kind === "CREATE_OUTBOUND" ? (draft.payload as OutboundPayload) : null;
  const hubDoubt = draft.doubts.some((d) => d.field === "consigneeId");

  return (
    <article className="dock-card flex flex-col overflow-hidden bg-white">
      <header className="flex items-center gap-3 border-b-[1.5px] border-dock-ink px-4 py-2.5">
        <span className={`cond px-2 py-0.5 text-[11px] font-semibold ${TONE[draft.kind]}`}>{t(`ib.kind.${draft.kind}` as "ib.kind.NEEDS_HUMAN")}</span>
        <Icon size={14} className="text-dock-ink/50" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{draft.message?.clientName ?? draft.message?.fromName}</span>
        {draft.message && (
          <span className="mono shrink-0 text-[11px] text-dock-ink/40">
            {draft.message.receivedAt.toLocaleTimeString(LOCALE[lang], { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" })}
          </span>
        )}
      </header>

      <form action={approveDraft} className="flex flex-1 flex-col gap-3 p-4">
        <input type="hidden" name="draftId" value={draft.id} />
        {draft.message && <blockquote className="border-l-4 border-dock-line pl-3 text-sm italic text-dock-ink/60">“{draft.message.body}”</blockquote>}

        {order && (
          <div className="border-[1.5px] border-dock-ink bg-dock-concrete-2">
            <ul>
              {order.lines.map((l) => {
                const loose = l.unitsPerPallet > 0 && l.units % l.unitsPerPallet !== 0;
                const short = l.availableUnits < l.requestedUnits;
                return (
                  <li key={l.sku} className="border-b border-dock-line px-3 py-2 last:border-0">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <span className="mono font-semibold">{l.sku}</span>
                      <span className="min-w-0 flex-1 basis-32 text-sm text-dock-ink/60">{l.description}</span>
                      <span className="mono text-right text-[15px]">
                        <b>{l.text}</b>
                        {loose && <span className="ml-1.5 text-[11px] text-dock-ink/50">({(l.units / l.unitsPerPallet).toLocaleString(LOCALE[lang], { maximumFractionDigits: 2 })})</span>}
                      </span>
                    </div>
                    <p className={`mono mt-0.5 text-right text-[11px] ${short ? "font-semibold text-dock-red" : "text-dock-ink/45"}`}>
                      {t("ib.inStock", { text: describeUnits(l.availableUnits, l.unitsPerPallet, l.unitWord) })}
                    </p>
                  </li>
                );
              })}
            </ul>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t-[1.5px] border-dock-ink px-3 py-2 text-sm">
              <dt className="cond text-[11px] text-dock-ink/50">{t("ib.deliverTo")}</dt>
              <dd>{hubDoubt ? <span className="font-medium">{order.consigneeName?.split("–")[0].trim()} · {t("ib.whichHub")}</span> : order.consigneeName ?? "—"}</dd>
              <dt className="cond text-[11px] text-dock-ink/50">{t("ib.by")}</dt>
              <dd className="mono text-[13px]">{when(order.deliverBy, lang)}</dd>
            </dl>
          </div>
        )}

        {draft.kind === "REPLY_ONLY" && <p className="mono bg-dock-concrete-2 px-3 py-2 text-[13px]">{(draft.payload as ReplyPayload).answer}</p>}

        {draft.kind === "NEEDS_HUMAN" && (
          <p className="flex items-start gap-2 bg-dock-red/10 px-3 py-2 text-sm text-dock-red">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            {(draft.payload as HumanPayload).reason}
          </p>
        )}

        {draft.doubts.map((d) => (
          <label key={d.field} className="flex flex-wrap items-center gap-2 border-[1.5px] border-dock-ink bg-dock-yellow px-3 py-2 text-sm">
            <AlertTriangle size={15} className="shrink-0" />
            <span className="min-w-0 flex-1 basis-48 font-medium">{d.question}</span>
            {/* Nothing chosen for the person: a yellow field is theirs to decide, so Approve waits until they pick. */}
            <select
              name={d.field}
              defaultValue=""
              required
              className="w-full min-w-0 border-[1.5px] border-dock-ink bg-white px-2 py-1 text-sm sm:w-auto"
            >
              <option value="" disabled>
                {t("ib.choose")}
              </option>
              {d.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        ))}

        {draft.reply && (
          <div>
            <p className="cond text-[11px] text-dock-ink/50">{t("ib.replyTo")}</p>
            <p className="mt-1 text-sm text-dock-ink/80">{draft.reply}</p>
          </div>
        )}

        <details className="dock-console px-3 py-2" open={draft.doubts.length > 0 || draft.kind === "NEEDS_HUMAN"}>
          <summary className="cond cursor-pointer text-[11px] text-white/50">{t("ib.how")}</summary>
          <div className="mono mt-2 space-y-0.5 text-[12px]">
            {draft.steps.map((s, i) => (
              <div key={i} className={s.kind === "ok" ? "ok" : s.kind === "ask" ? "ask" : s.kind === "tool" ? "tool" : "text-white/50"}>
                <span className="t">{s.kind === "ok" ? "✓ " : s.kind === "ask" ? "⚠ " : "→ "}</span>
                {s.text}
              </div>
            ))}
          </div>
        </details>

        <div className="mt-auto flex gap-2 pt-1">
          <ApproveButton label={t(`ib.action.${draft.kind}` as "ib.action.NEEDS_HUMAN")} />
          <button formAction={discardDraft} formNoValidate className="cond flex items-center gap-1.5 border-[1.5px] border-dock-ink px-3 py-2 text-sm hover:bg-dock-concrete">
            <X size={15} /> {t("ib.discard")}
          </button>
        </div>
      </form>
    </article>
  );
}

function ApproveButton({ label }: { label: string }) {
  const { t } = useT();
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="cond flex flex-1 items-center justify-center gap-1.5 bg-dock-ink px-3 py-2 text-sm font-semibold text-dock-yellow transition hover:brightness-125 disabled:opacity-60">
      <Check size={15} /> {pending ? t("ib.writing") : label}
    </button>
  );
}
