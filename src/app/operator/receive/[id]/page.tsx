/* eslint-disable @next/next/no-img-element -- photos come from our own upload route */
import Link from "next/link";
import { ArrowLeft, Bot, Check } from "lucide-react";
import { LoadPhoto } from "@/components/load-photo";
import { LoadStep, NoteStepOperator, ReceiveForm, TruckHereButton } from "@/components/operator/receive-steps";
import { aiStatus } from "@/lib/ai/client";
import { db } from "@/lib/db";
import { fromNote, type NoteLineLite, type PalletDraft } from "@/lib/pallets/breakdown";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // load photo: SAM (cold start up to 60 s) + Muse Spark damage check

type NoteLine = NoteLineLite & { description: string };
type ReceivedPallet = { code: string; generated: boolean; lines: { sku: string; lot: string | null; units: number }[] };
type Box = { x: number; y: number; w: number; h: number; damaged: boolean };

export default async function ReceivePage({ params }: PageProps<"/operator/receive/[id]">) {
  await requireRole("operator");
  const { id } = await params;
  const inbound = await db.inbound.findUnique({
    where: { id },
    include: { client: { include: { items: { orderBy: { sku: "asc" } } } }, warehouse: true, appointment: true, receipt: true, lines: { orderBy: { id: "asc" } } },
  });
  if (!inbound) return <p className="p-6">Not found.</p>;
  const r = inbound.receipt;
  const ai = aiStatus();
  const arrived = inbound.appointment?.status === "ARRIVED" || inbound.status !== "EXPECTED";
  const received = inbound.status === "RECEIVED" || inbound.status === "CLOSED";
  const noteLines = ((r?.noteData as NoteLine[] | null) ?? []).filter((l) => l.sku);
  const boxes = (r?.boxes as Box[] | null) ?? null;

  // Start from what the note (or the office) expected, one draft per pallet. IDs printed on the note come with it.
  const itemLites = inbound.client.items.map((i) => ({ id: i.id, sku: i.sku, unitsPerPallet: i.unitsPerPallet }));
  const fromLines = inbound.lines.flatMap((l) => {
    const item = inbound.client.items.find((i) => i.id === l.itemId);
    return item ? fromNote([{ sku: item.sku, lot: l.lot, pallets: l.pallets, units: l.units }], itemLites) : [];
  });
  const noteHasCodes = noteLines.some((l) => l.palletCodes?.length);
  const start: PalletDraft[] = noteHasCodes || !inbound.lines.length ? fromNote(noteLines, itemLites) : fromLines;
  const generated = ((r?.pallets as ReceivedPallet[] | null) ?? []).filter((p) => p.generated);

  return (
    <main className="space-y-4 px-4 py-4">
      <Link href={`/operator?w=${inbound.warehouse?.code ?? ""}`} className="cond flex items-center gap-1 text-xs text-dock-ink/50">
        <ArrowLeft size={13} /> Tasks
      </Link>
      <header className="dock-card flex items-stretch overflow-hidden bg-white">
        <div className="flex flex-col items-center justify-center bg-dock-ink px-4 text-dock-yellow">
          <span className="cond text-[10px] text-white/50">Dock</span>
          <span className="cond text-4xl font-bold leading-none">{inbound.appointment?.dock ?? "–"}</span>
        </div>
        <div className="min-w-0 px-3 py-2.5">
          <p className="cond text-[11px] text-dock-ink/50">Unload · Nº {inbound.number}</p>
          <p className="truncate font-semibold">{inbound.client.name}</p>
          <p className="truncate text-xs text-dock-ink/55">
            {inbound.supplier} · {inbound.plate}
          </p>
        </div>
      </header>

      {received ? (
        <div className="space-y-3">
          <p className="flex items-center gap-2 bg-dock-ink px-4 py-3 text-sm text-white">
            <Check size={16} className="text-dock-yellow" /> {inbound.receivedPallets} pallets received. {r?.signedAt ? `Signed by ${r.signedBy}.` : "Waiting for the driver's signature on their phone."}
          </p>
          {generated.length > 0 && (
            <section className="dock-card bg-white p-3" aria-label="Pallets to label">
              <h2 className="cond text-[11px] text-dock-ink/55">Label these {generated.length} pallets (they came without an ID)</h2>
              <ul className="mono mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm font-semibold">
                {generated.map((g) => (
                  <li key={g.code}>{g.code}</li>
                ))}
              </ul>
            </section>
          )}
          <Link href={`/operator/putaway?w=${inbound.warehouse?.code ?? ""}`} className="cond block bg-dock-yellow px-4 py-3 text-center font-semibold ring-[1.5px] ring-dock-ink">
            Put them away now
          </Link>
          <Link href={`/receipts/${inbound.id}`} className="cond block text-center text-xs text-dock-ink/50 underline">
            Dock receipt
          </Link>
        </div>
      ) : !arrived ? (
        <TruckHereButton inboundId={inbound.id} />
      ) : (
        <>
          <Step n={1} title="Delivery note" done={!!r?.notePallets}>
            {r?.notePallets ? (
              <div className="flex gap-3 text-sm">
                {r.noteImageUrl && <img src={r.noteImageUrl} alt="Delivery note" className="h-16 w-12 border border-dock-line object-cover" />}
                <div>
                  <p className="mono text-lg font-semibold">{r.notePallets} pallets</p>
                  <p className="cond flex items-center gap-1 text-[11px] text-dock-ink/50">
                    {r.readBy === "muse-spark" ? (
                      <>
                        <Bot size={12} /> Read by Muse Spark
                      </>
                    ) : (
                      `Typed by the ${r.readBy}`
                    )}
                  </p>
                </div>
              </div>
            ) : (
              <NoteStepOperator inboundId={inbound.id} aiReady={!!ai.vision} items={inbound.client.items.map((i) => ({ sku: i.sku, description: i.description }))} />
            )}
          </Step>

          <Step n={2} title="Photo of the load" done={!!r?.palletImageUrl}>
            {r?.palletImageUrl && <LoadPhoto src={r.palletImageUrl} boxes={boxes} />}
            {r?.countedBy && boxes && (
              <p className="cond mt-2 flex items-center gap-1.5 text-xs">
                <Bot size={13} /> {r.countedBy === "sam-3.1" ? "SAM 3.1" : r.countedBy === "sam-3" ? "SAM 3" : "Muse Spark"} found {boxes.length} boxes
                {boxes.some((b) => b.damaged) && <span className="text-dock-red"> · {boxes.filter((b) => b.damaged).length} damaged</span>}
              </p>
            )}
            <LoadStep inboundId={inbound.id} aiReady={!!(ai.segment || ai.vision)} counter={ai.segment ? "SAM 3.1" : "Muse Spark"} again={!!r?.palletImageUrl} />
          </Step>

          <Step n={3} title="What came off the truck" done={false}>
            <ReceiveForm
              // starts again from what the photos just read (its lines live in useState)
              key={JSON.stringify([start, r?.notePallets, boxes?.length, boxes?.filter((b) => b.damaged).length])}
              inboundId={inbound.id}
              items={inbound.client.items.map((i) => ({ id: i.id, sku: i.sku, description: i.description, unitsPerPallet: i.unitsPerPallet, tracksLot: i.tracksLot }))}
              start={start}
              expected={r?.notePallets ?? inbound.expectedPallets}
              damagedFound={boxes?.filter((b) => b.damaged).length ?? 0}
              warehouse={inbound.warehouse?.code ?? ""}
            />
          </Step>
        </>
      )}
    </main>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section className="dock-card space-y-3 bg-white p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <span className={`cond grid h-6 w-6 place-items-center text-xs ${done ? "bg-dock-ink text-dock-yellow" : "border-[1.5px] border-dock-ink"}`}>{done ? <Check size={13} /> : n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}
