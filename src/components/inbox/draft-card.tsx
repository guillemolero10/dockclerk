"use client";

import { useFormStatus } from "react-dom";
import { AlertTriangle, Check, Mail, MessageCircle, UserRound, X } from "lucide-react";
import type { Channel, DraftKind } from "@prisma/client";
import { approveDraft, discardDraft } from "@/app/office/inbox/actions";
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

const KIND: Record<DraftKind, { label: string; tone: string; action: string }> = {
  CREATE_OUTBOUND: { label: "New outbound", tone: "bg-dock-yellow text-dock-ink", action: "Approve & write to software" },
  CREATE_INBOUND: { label: "New inbound", tone: "bg-dock-yellow text-dock-ink", action: "Approve & write to software" },
  REPLY_ONLY: { label: "Answer", tone: "bg-dock-ink text-white", action: "Approve & send reply" },
  NEEDS_HUMAN: { label: "Needs you", tone: "bg-dock-red text-white", action: "Mark as handled" },
};

const CHANNEL_ICON: Record<Channel, typeof Mail> = { EMAIL: Mail, WHATSAPP: MessageCircle, PORTAL: UserRound };

function when(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });
}

export function DraftCard({ draft }: { draft: DraftView }) {
  const kind = KIND[draft.kind];
  const Icon = draft.message ? CHANNEL_ICON[draft.message.channel] : Mail;
  const order = draft.kind === "CREATE_OUTBOUND" ? (draft.payload as OutboundPayload) : null;

  return (
    <article className="dock-card flex flex-col overflow-hidden bg-white">
      <header className="flex items-center gap-3 border-b-[1.5px] border-dock-ink px-4 py-2.5">
        <span className={`cond px-2 py-0.5 text-[11px] font-semibold ${kind.tone}`}>{kind.label}</span>
        <Icon size={14} className="text-dock-ink/50" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{draft.message?.clientName ?? draft.message?.fromName}</span>
        {draft.message && (
          <span className="mono shrink-0 text-[11px] text-dock-ink/40">
            {draft.message.receivedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" })}
          </span>
        )}
      </header>

      <form action={approveDraft} className="flex flex-1 flex-col gap-3 p-4">
        <input type="hidden" name="draftId" value={draft.id} />
        {draft.message && <blockquote className="border-l-4 border-dock-line pl-3 text-sm italic text-dock-ink/60">“{draft.message.body}”</blockquote>}

        {order && (
          <div className="border-[1.5px] border-dock-ink bg-dock-concrete-2">
            <table className="w-full text-sm">
              <tbody>
                {order.lines.map((l) => (
                  <tr key={l.sku} className="border-b border-dock-line last:border-0">
                    <td className="mono px-3 py-1.5 font-semibold">{l.sku}</td>
                    <td className="px-1 py-1.5 text-dock-ink/60">{l.description}</td>
                    <td className="mono px-3 py-1.5 text-right">
                      {l.requested} plt
                      <span className={`ml-2 text-[11px] ${l.available < l.requested ? "font-semibold text-dock-red" : "text-dock-ink/40"}`}>
                        {l.available} in stock
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t-[1.5px] border-dock-ink px-3 py-2 text-sm">
              <dt className="cond text-[11px] text-dock-ink/50">Deliver to</dt>
              <dd>{order.consigneeName ?? "—"}</dd>
              <dt className="cond text-[11px] text-dock-ink/50">By</dt>
              <dd className="mono text-[13px]">{when(order.deliverBy)}</dd>
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
            <span className="flex-1 font-medium">{d.question}</span>
            <select
              name={d.field}
              defaultValue={d.field === "consigneeId" ? order?.consigneeId ?? d.options[0].value : String(order?.lines.find((l) => `pallets:${l.sku}` === d.field)?.pallets ?? d.options[0].value)}
              className="border-[1.5px] border-dock-ink bg-white px-2 py-1 text-sm"
            >
              {d.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        ))}

        {draft.reply && (
          <div>
            <p className="cond text-[11px] text-dock-ink/50">Reply to the customer</p>
            <p className="mt-1 text-sm text-dock-ink/80">{draft.reply}</p>
          </div>
        )}

        <details className="dock-console px-3 py-2" open={draft.doubts.length > 0 || draft.kind === "NEEDS_HUMAN"}>
          <summary className="cond cursor-pointer text-[11px] text-white/50">How the clerk got here</summary>
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
          <ApproveButton label={kind.action} />
          <button formAction={discardDraft} className="cond flex items-center gap-1.5 border-[1.5px] border-dock-ink px-3 py-2 text-sm hover:bg-dock-concrete">
            <X size={15} /> Discard
          </button>
        </div>
      </form>
    </article>
  );
}

function ApproveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="cond flex flex-1 items-center justify-center gap-1.5 bg-dock-ink px-3 py-2 text-sm font-semibold text-dock-yellow transition hover:brightness-125 disabled:opacity-60">
      <Check size={15} /> {pending ? "Writing…" : label}
    </button>
  );
}
