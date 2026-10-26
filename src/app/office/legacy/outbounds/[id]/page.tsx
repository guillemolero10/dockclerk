import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { fmtDate, fmtNumber, fmtTime } from "@/lib/format";
import { OUTBOUND_STATUS, UNIT_LABEL } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function OutboundDetail({ params }: PageProps<"/office/legacy/outbounds/[id]">) {
  const { id } = await params;
  const o = await db.outbound.findUnique({
    where: { id },
    include: { client: true, consignee: true, carrier: true, lines: { include: { item: true } } },
  });
  if (!o) notFound();

  const field = (label: string, value: string | null | undefined) => (
    <label className="flex items-center gap-2">
      <span className="w-28 text-right">{label}:</span>
      <span className="legacy-input min-w-48 flex-1">{value || " "}</span>
    </label>
  );

  return (
    <div className="space-y-3 bg-[#d4d0c8] p-3">
      <div className="flex items-center justify-between">
        <strong>Ficha de salida Nº {o.number}</strong>
        <Link href="/office/legacy/outbounds" className="legacy-btn">Volver</Link>
      </div>
      <fieldset className="grid gap-1.5 border border-[#808080] p-3 sm:grid-cols-2">
        <legend className="px-1">Datos generales</legend>
        {field("Fecha", fmtDate(o.date))}
        {field("Estado", OUTBOUND_STATUS[o.status].label)}
        {field("Cliente", `${o.client.code} · ${o.client.name}`)}
        {field("S/Referencia", o.clientDocRef)}
        {field("Destino", o.consignee ? `${o.consignee.code} · ${o.consignee.name}` : "")}
        {field("Dirección", o.consignee ? `${o.consignee.address}, ${o.consignee.city}` : "")}
        {field("Hora límite", o.deadline ? `${fmtDate(o.deadline)} ${fmtTime(o.deadline)}` : "")}
        {field("Transportista", o.carrier?.name)}
        {field("Observaciones", o.notes)}
      </fieldset>
      <table className="legacy-grid legacy-panel">
        <thead>
          <tr><th>Artículo</th><th>Descripción</th><th className="text-right">Palés</th><th className="text-right">Bultos</th></tr>
        </thead>
        <tbody>
          {o.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.item.sku}</td>
              <td>{l.item.description}</td>
              <td className="text-right">{fmtNumber(l.pallets)}</td>
              <td className="text-right">{fmtNumber(l.units)} {UNIT_LABEL[l.item.unit]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
