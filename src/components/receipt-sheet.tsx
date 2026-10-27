/* eslint-disable @next/next/no-img-element -- photos come from our own upload route */
import { Bot } from "lucide-react";
import { LoadPhoto } from "@/components/load-photo";
import { PrintButton } from "@/components/print-button";
import { db } from "@/lib/db";
import { fmtDate, madridHm } from "@/lib/format";

type Box = { x: number; y: number; w: number; h: number; damaged: boolean };

const BY: Record<string, string> = { "muse-spark": "Muse Spark", "sam-3.1": "SAM 3.1", driver: "the driver", operator: "the operator" };

/** The dock receipt (acta de descarga): what the note said, what was counted, photos and signature. */
export async function ReceiptSheet({ inboundId }: { inboundId: string }) {
  const inbound = await db.inbound.findUnique({
    where: { id: inboundId },
    include: { client: true, warehouse: true, carrier: true, appointment: true, receipt: true, lines: { include: { item: true } } },
  });
  if (!inbound) return <p className="p-8 text-dock-ink/60">Receipt not found.</p>;
  const r = inbound.receipt;
  const damages = (r?.damages as { box: number; note: string }[] | null) ?? [];

  return (
    <div className="dock-app min-h-screen py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-3 flex max-w-3xl justify-end px-4 print:hidden">
        <PrintButton />
      </div>
      <article className="mx-auto max-w-3xl border-[1.5px] border-dock-ink bg-white print:border-0">
        <div className="hazard h-2 print:hidden" />
        <header className="flex flex-wrap items-start justify-between gap-4 border-b-[1.5px] border-dock-ink px-8 py-6">
          <div>
            <p className="cond text-xs text-dock-ink/50">Almacenes del Vinalopó · {inbound.warehouse?.name ?? ""}</p>
            <h1 className="text-2xl font-semibold tracking-tight">Dock receipt</h1>
            <p className="text-sm text-dock-ink/50">Acta de descarga</p>
          </div>
          <div className="text-right">
            <p className="mono text-2xl font-semibold">Nº {inbound.number}</p>
            <p className="mono text-sm text-dock-ink/60">
              {fmtDate(inbound.appointment?.startsAt ?? inbound.date)} {inbound.appointment ? `· dock ${inbound.appointment.dock} · ${madridHm(inbound.appointment.startsAt)}` : ""}
            </p>
          </div>
        </header>

        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 border-b border-dock-line px-8 py-5 text-sm sm:grid-cols-4">
          <Field label="Customer" value={inbound.client.name} />
          <Field label="Supplier" value={inbound.supplier ?? "—"} />
          <Field label="Carrier" value={inbound.carrier?.name ?? "—"} />
          <Field label="Plate" value={inbound.plate ?? "—"} mono />
          <Field label="Delivery note" value={inbound.clientDocRef ?? "—"} mono />
          <Field label="Note says" value={r?.notePallets ? `${r.notePallets} pallets` : "—"} mono />
          <Field label="Received" value={inbound.receivedPallets !== null ? `${inbound.receivedPallets} pallets` : "Not yet"} mono />
          <Field label="Units" value={inbound.receivedUnits?.toLocaleString("es-ES") ?? "—"} mono />
        </dl>

        <div className="flex flex-wrap gap-2 px-8 pt-4">
          {r?.readBy && <Badge text={r.readBy === "muse-spark" ? "Note read by Muse Spark" : `Note typed by ${BY[r.readBy] ?? r.readBy}`} ai={r.readBy === "muse-spark"} />}
          {r?.countedBy && <Badge text={`Boxes found by ${BY[r.countedBy] ?? r.countedBy}`} ai />}
        </div>

        <table className="mx-8 mt-4 w-[calc(100%-4rem)] text-sm">
          <thead>
            <tr className="cond border-b-[1.5px] border-dock-ink text-left text-[11px] text-dock-ink/50">
              <th className="py-1.5">Item</th>
              <th>Description</th>
              <th>Lot</th>
              <th className="text-right">Pallets</th>
              <th className="text-right">Units</th>
            </tr>
          </thead>
          <tbody>
            {inbound.lines.map((l) => (
              <tr key={l.id} className="border-b border-dock-line">
                <td className="mono py-1.5 font-semibold">{l.item.sku}</td>
                <td className="text-dock-ink/70">{l.item.description}</td>
                <td className="mono">{l.lot ?? "—"}</td>
                <td className="mono text-right">{l.pallets}</td>
                <td className="mono text-right">{l.units.toLocaleString("es-ES")}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {(inbound.incident || damages.length > 0) && (
          <div className="mx-8 mt-4 border-[1.5px] border-dock-red bg-dock-red/5 px-4 py-3 text-sm">
            <p className="cond text-[11px] text-dock-red">Incidents</p>
            {inbound.incident && <p>{inbound.incident}</p>}
            {damages.map((d) => (
              <p key={d.box} className="text-dock-ink/70">
                Box {d.box}: {d.note}
              </p>
            ))}
          </div>
        )}

        {(r?.noteImageUrl || r?.palletImageUrl) && (
          <div className="grid gap-4 px-8 pt-5 sm:grid-cols-2">
            {r?.noteImageUrl && (
              <figure>
                <img src={r.noteImageUrl} alt="Delivery note" className="w-full border-[1.5px] border-dock-ink" />
                <figcaption className="cond mt-1 text-[11px] text-dock-ink/50">Delivery note</figcaption>
              </figure>
            )}
            {r?.palletImageUrl && (
              <figure>
                <LoadPhoto src={r.palletImageUrl} boxes={(r.boxes as Box[] | null) ?? null} />
                <figcaption className="cond mt-1 text-[11px] text-dock-ink/50">Load at the dock</figcaption>
              </figure>
            )}
          </div>
        )}

        <footer className="mt-6 grid grid-cols-2 gap-8 border-t-[1.5px] border-dock-ink px-8 py-5 text-sm">
          <div>
            <p className="cond text-[11px] text-dock-ink/50">Driver</p>
            {r?.signatureUrl ? <img src={r.signatureUrl} alt="Signature" className="h-20" /> : <div className="h-20" />}
            <p>{r?.signedBy ?? "Not signed yet"}</p>
            {r?.signedAt && <p className="mono text-xs text-dock-ink/50">{fmtDate(r.signedAt)} {madridHm(r.signedAt)}</p>}
          </div>
          <div>
            <p className="cond text-[11px] text-dock-ink/50">Warehouse</p>
            <div className="h-20" />
            <p>{inbound.warehouse?.name ?? "Almacenes del Vinalopó"}</p>
          </div>
        </footer>
      </article>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="cond text-[11px] text-dock-ink/50">{label}</dt>
      <dd className={mono ? "mono" : ""}>{value}</dd>
    </div>
  );
}

function Badge({ text, ai }: { text: string; ai?: boolean }) {
  return (
    <span className={`cond flex items-center gap-1 px-2 py-0.5 text-[11px] ${ai ? "bg-dock-ink text-dock-yellow" : "border border-dock-line text-dock-ink/60"}`}>
      {ai && <Bot size={12} />} {text}
    </span>
  );
}
