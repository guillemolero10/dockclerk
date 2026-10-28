/* eslint-disable @next/next/no-img-element -- photos come from our own upload route */
import Link from "next/link";
import { Bot, FileText, Truck } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { ArriveButton, NoteStep, SignStep, StepDot } from "@/components/driver/driver-steps";
import { db } from "@/lib/db";
import { madridHm, madridYmd } from "@/lib/format";

export const dynamic = "force-dynamic";

type NoteLine = { sku: string | null; description: string; lot: string | null; pallets: number | null; units: number | null };

export default async function DriverPage({ params }: PageProps<"/driver/[token]">) {
  const { token } = await params;
  const inbound = await db.inbound.findUnique({
    where: { driverToken: token },
    include: { client: true, warehouse: true, carrier: true, appointment: true, receipt: true, lines: { include: { item: true } } },
  });

  if (!inbound) {
    return (
      <Shell>
        <p className="mt-10 text-center text-dock-ink/60">This delivery link is not valid any more. Call the warehouse office.</p>
      </Shell>
    );
  }

  const slot = inbound.appointment;
  const receipt = inbound.receipt;
  const received = inbound.status === "RECEIVED" || inbound.status === "CLOSED";
  const stage = receipt?.signedAt ? "done" : received ? "sign" : slot?.status === "ARRIVED" || inbound.status === "RECEIVING" ? "unloading" : "coming";
  const noteDone = !!receipt?.notePallets;
  const noteLines = (receipt?.noteData as NoteLine[] | null) ?? [];
  const day = slot ? (madridYmd(slot.startsAt) === madridYmd() ? "Today" : slot.startsAt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Madrid" })) : null;

  return (
    <Shell>
      {stage === "unloading" && <AutoRefresh seconds={8} />}

      {/* Where and when */}
      <section className="dock-card overflow-hidden bg-white">
        <div className="flex items-stretch">
          <div className="flex flex-col items-center justify-center bg-dock-ink px-5 py-4 text-dock-yellow">
            <span className="cond text-[11px] text-white/50">Dock</span>
            <span className="cond text-5xl font-bold leading-none">{slot?.dock ?? "–"}</span>
          </div>
          <div className="flex-1 px-4 py-3">
            <p className="cond text-[11px] text-dock-ink/50">{day ?? "No slot yet"}</p>
            <p className="mono text-2xl font-semibold">{slot ? `${madridHm(slot.startsAt)}–${madridHm(slot.endsAt)}` : "Call the office"}</p>
            <p className="mt-1 text-sm">{inbound.warehouse ? `${inbound.warehouse.name}, ${inbound.warehouse.city}` : "Almacenes del Vinalopó"}</p>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t-[1.5px] border-dock-ink px-4 py-3 text-sm">
          <dt className="cond text-[11px] text-dock-ink/50">Delivery</dt>
          <dd>
            Nº {inbound.number} · {inbound.client.name}
          </dd>
          <dt className="cond text-[11px] text-dock-ink/50">From</dt>
          <dd>{inbound.supplier ?? "—"}</dd>
          <dt className="cond text-[11px] text-dock-ink/50">Truck</dt>
          <dd className="mono">
            {inbound.plate ?? "—"} · {inbound.carrier?.name ?? ""}
          </dd>
        </dl>
      </section>

      <div className="mt-5 flex">
        <StepDot label="Note" done={noteDone} active={stage === "coming" && !noteDone} />
        <StepDot label="Gate" done={stage !== "coming"} active={stage === "coming" && noteDone} />
        <StepDot label="Unloading" done={stage === "sign" || stage === "done"} active={stage === "unloading"} />
        <StepDot label="Sign" done={stage === "done"} active={stage === "sign"} />
      </div>

      {stage === "coming" && (
        <section className="mt-5 space-y-4">
          {noteDone ? (
            <NoteSummary readBy={receipt?.readBy ?? null} pallets={receipt?.notePallets ?? null} lines={noteLines} image={receipt?.noteImageUrl ? `${receipt.noteImageUrl}?t=${encodeURIComponent(token)}` : null} />
          ) : (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Before you arrive</h2>
              <p className="text-sm text-dock-ink/60">Send a photo of the delivery note. The warehouse prepares the dock and the space for your pallets before you get here.</p>
              <NoteStep token={token} askTyped={!!receipt?.noteImageUrl && !receipt.notePallets} />
            </div>
          )}
          <ArriveButton token={token} />
        </section>
      )}

      {stage === "unloading" && (
        <section className="mt-5 space-y-4">
          <div className="hazard p-1">
            <div className="bg-dock-ink px-5 py-6 text-center text-white">
              <Truck className="mx-auto text-dock-yellow" size={28} />
              <p className="cond mt-2 text-sm text-white/60">Go to</p>
              <p className="cond text-5xl font-bold text-dock-yellow">DOCK {slot?.dock ?? ""}</p>
              <p className="mt-2 text-sm text-white/70">The operator is unloading and counting. You will sign here when it is done.</p>
            </div>
          </div>
          {!noteDone && (
            <div className="space-y-2">
              <p className="text-sm text-dock-ink/60">Still no delivery note? Send it now.</p>
              <NoteStep token={token} askTyped={!!receipt?.noteImageUrl} />
            </div>
          )}
        </section>
      )}

      {stage === "sign" && (
        <section className="mt-5 space-y-4">
          <h2 className="text-lg font-semibold">Check and sign</h2>
          <ReceivedSummary
            notePallets={receipt?.notePallets ?? inbound.expectedPallets}
            received={inbound.receivedPallets ?? 0}
            lines={inbound.lines.map((l) => ({ sku: l.item.sku, lot: l.lot, pallets: l.pallets, units: l.units }))}
            incident={inbound.incident}
          />
          <SignStep token={token} />
        </section>
      )}

      {stage === "done" && (
        <section className="mt-5 space-y-4 text-center">
          <p className="text-lg font-semibold">Signed. Safe trip!</p>
          <p className="text-sm text-dock-ink/60">
            {inbound.receivedPallets} pallets received at {madridHm(receipt!.signedAt!)}, signed by {receipt!.signedBy}.
          </p>
          <Link href={`/driver/${token}/receipt`} className="cond inline-flex items-center gap-2 bg-dock-ink px-5 py-3 text-sm font-semibold text-dock-yellow">
            <FileText size={16} /> Dock receipt
          </Link>
        </section>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="dock-app min-h-screen">
      <div className="hazard h-2" />
      <header className="flex items-center gap-2.5 bg-dock-ink px-5 py-3">
        <span className="cond grid h-7 w-7 place-items-center bg-dock-yellow text-xs font-bold text-dock-ink">DC</span>
        <span className="text-sm font-semibold text-white">Almacenes del Vinalopó</span>
        <span className="cond ml-auto text-[11px] text-white/40">Driver · no app needed</span>
      </header>
      <main className="mx-auto w-full max-w-md px-4 py-5">{children}</main>
    </div>
  );
}

function NoteSummary({ readBy, pallets, lines, image }: { readBy: string | null; pallets: number | null; lines: NoteLine[]; image: string | null }) {
  return (
    <div className="dock-card bg-white p-4">
      <p className="cond flex items-center gap-1.5 text-[11px] text-dock-ink/50">
        {readBy === "muse-spark" ? (
          <>
            <Bot size={13} /> Read by Muse Spark
          </>
        ) : (
          "Delivery note sent"
        )}
      </p>
      <div className="mt-2 flex gap-3">
        {image && <img src={image} alt="Delivery note" className="h-20 w-16 shrink-0 border border-dock-line object-cover" />}
        <div className="min-w-0 flex-1 text-sm">
          <p className="mono text-xl font-semibold">{pallets} pallets</p>
          {lines
            .filter((l) => l.description || l.sku)
            .map((l, i) => (
              <p key={i} className="truncate text-xs text-dock-ink/60">
                {l.pallets ?? "?"} × {l.sku ?? l.description} {l.lot ? `· lot ${l.lot}` : ""}
              </p>
            ))}
        </div>
      </div>
    </div>
  );
}

function ReceivedSummary({
  notePallets,
  received,
  lines,
  incident,
}: {
  notePallets: number | null;
  received: number;
  lines: { sku: string; lot: string | null; pallets: number; units: number }[];
  incident: string | null;
}) {
  const match = notePallets === null || notePallets === received;
  return (
    <div className="dock-card bg-white">
      <div className="grid grid-cols-2 border-b-[1.5px] border-dock-ink text-center">
        <div className="border-r-[1.5px] border-dock-ink px-3 py-2">
          <p className="cond text-[11px] text-dock-ink/50">Delivery note</p>
          <p className="mono text-2xl font-semibold">{notePallets ?? "—"}</p>
        </div>
        <div className={`px-3 py-2 ${match ? "" : "bg-dock-yellow"}`}>
          <p className="cond text-[11px] text-dock-ink/50">Received</p>
          <p className="mono text-2xl font-semibold">{received}</p>
        </div>
      </div>
      <ul className="divide-y divide-dock-line px-4 text-sm">
        {lines.map((l, i) => (
          <li key={i} className="flex justify-between py-2">
            <span className="mono">
              {l.sku} {l.lot ? <span className="text-dock-ink/50">· {l.lot}</span> : null}
            </span>
            <span className="mono">
              {l.pallets} plt · {l.units}
            </span>
          </li>
        ))}
      </ul>
      {incident && <p className="border-t border-dock-line bg-dock-red/10 px-4 py-2 text-sm text-dock-red">{incident}</p>}
    </div>
  );
}
