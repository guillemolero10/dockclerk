import Link from "next/link";
import { ArrowUpRight, Boxes, RotateCcw } from "lucide-react";
import type { DraftKind } from "@prisma/client";
import { ClerkRunner } from "@/components/inbox/clerk-runner";
import { DraftCard, type DraftView } from "@/components/inbox/draft-card";
import type { Doubt, Step } from "@/lib/agent/types";
import { db } from "@/lib/db";
import { resetInbox } from "./actions";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";
// The clerk's server action runs under this page: room for the model (25 s budget in agent/muse.ts) plus the rules fallback.
export const maxDuration = 60;

// Orders first: they are the ones that create work in the warehouse.
const ORDER: Record<DraftKind, number> = { CREATE_OUTBOUND: 0, CREATE_INBOUND: 1, REPLY_ONLY: 2, NEEDS_HUMAN: 3 };

export default async function InboxPage() {
  await requireRole("office");
  const [newMessages, drafts] = await Promise.all([
    db.message.findMany({ where: { status: "NEW" }, orderBy: { receivedAt: "asc" }, include: { client: true } }),
    db.draft.findMany({ orderBy: { createdAt: "desc" }, include: { message: { include: { client: true } } } }),
  ]);

  const toView = (d: (typeof drafts)[number]): DraftView => ({
    id: d.id,
    kind: d.kind,
    payload: d.payload,
    doubts: d.doubts as unknown as Doubt[],
    steps: d.steps as unknown as Step[],
    reply: d.reply,
    message: d.message
      ? { channel: d.message.channel, fromName: d.message.fromName, clientName: d.message.client?.name ?? null, body: d.message.body ?? "", receivedAt: d.message.receivedAt }
      : null,
  });

  const pending = drafts
    .filter((d) => d.status === "PENDING")
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || (a.message?.receivedAt.getTime() ?? 0) - (b.message?.receivedAt.getTime() ?? 0));
  const done = drafts.filter((d) => d.status !== "PENDING");

  return (
    <main className="mx-auto max-w-6xl px-8 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="cond text-sm text-dock-ink/50">Email · WhatsApp · customer portal</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">AI inbox</h1>
          <p className="mt-1 max-w-2xl text-sm text-dock-ink/60">
            The clerk reads every message, checks the software and prepares the work. Nothing is written or sent until you approve it.
          </p>
        </div>
        <form action={resetInbox}>
          <button className="cond flex items-center gap-1.5 text-xs text-dock-ink/40 hover:text-dock-ink" title="Demo: put all messages back and undo what was approved">
            <RotateCcw size={13} /> Replay the morning
          </button>
        </form>
      </header>

      <section className="mt-6">
        <ClerkRunner pending={newMessages.map((m) => ({ id: m.id, from: `${m.channel.toLowerCase()} · ${m.client?.name ?? m.fromName}` }))} />
      </section>

      <section className="mt-8">
        <h2 className="cond flex items-center gap-2 text-sm">
          To approve <span className="mono bg-dock-ink px-1.5 text-[11px] text-dock-yellow">{pending.length}</span>
        </h2>
        {pending.length === 0 ? (
          <p className="mt-3 text-sm text-dock-ink/50">
            {newMessages.length ? "Let the clerk handle the inbox to see its drafts here." : "All caught up."}
          </p>
        ) : (
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            {pending.map((d) => (
              <DraftCard key={d.id} draft={toView(d)} />
            ))}
          </div>
        )}
      </section>

      {done.length > 0 && (
        <section className="mt-10">
          <h2 className="cond text-sm text-dock-ink/50">Done</h2>
          <ul className="dock-card mt-3 divide-y divide-dock-line bg-white">
            {done.map((d) => {
              const created = d.payload as { outboundId?: string; outboundNumber?: number };
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <span className={`cond w-20 text-[11px] ${d.status === "APPROVED" ? "text-green-700" : "text-dock-ink/40 line-through"}`}>
                    {d.status === "APPROVED" ? "Approved" : "Discarded"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {d.message?.client?.name ?? d.message?.fromName}
                    <span className="text-dock-ink/50"> — {d.message?.body}</span>
                  </span>
                  {created.outboundId && (
                    <>
                      <Link href={`/office/warehouse?pick=${created.outboundId}`} className="cond flex items-center gap-1 bg-dock-ink px-2 py-0.5 text-[11px] font-semibold text-dock-yellow">
                        <Boxes size={12} /> Light up the pick
                      </Link>
                      <Link href={`/office/legacy/outbounds/${created.outboundId}`} className="cond flex items-center gap-1 bg-dock-yellow px-2 py-0.5 text-[11px] font-semibold">
                        Outbound Nº {created.outboundNumber} in your software <ArrowUpRight size={12} />
                      </Link>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
