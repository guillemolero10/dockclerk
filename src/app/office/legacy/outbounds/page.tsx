import Link from "next/link";
import type { OutboundStatus, Prisma } from "@prisma/client";
import { LegacyFilters } from "@/components/legacy-filters";
import { db } from "@/lib/db";
import { fmtDate, fmtNumber, fmtTime } from "@/lib/format";
import { OUTBOUND_STATUS } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function OutboundsPage({ searchParams }: PageProps<"/office/legacy/outbounds">) {
  const { client, status } = await searchParams;
  const where: Prisma.OutboundWhereInput = {};
  if (typeof client === "string" && client) where.clientId = client;
  if (typeof status === "string" && status in OUTBOUND_STATUS) where.status = status as OutboundStatus;

  const [outbounds, clients] = await Promise.all([
    db.outbound.findMany({
      where,
      orderBy: [{ date: "desc" }, { number: "desc" }],
      include: { client: true, consignee: true, carrier: true, lines: { include: { item: true } } },
    }),
    db.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <LegacyFilters
        clients={clients}
        clientId={typeof client === "string" ? client : undefined}
        statuses={Object.entries(OUTBOUND_STATUS).map(([value, s]) => ({ value, label: s.label }))}
        status={typeof status === "string" ? status : undefined}
      />
      <table className="legacy-grid">
        <thead>
          <tr>
            <th>Nº</th><th>Fecha</th><th>Cliente</th><th>S/Ref.</th><th>Destino</th><th>Artículo</th>
            <th style={{ textAlign: "right" }}>Palés</th><th style={{ textAlign: "right" }}>Bultos</th><th>Hora lím.</th><th>Transportista</th><th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {outbounds.map((o) => {
            const line = o.lines[0];
            return (
              <tr key={o.id} style={{ background: OUTBOUND_STATUS[o.status].row }}>
                <td><Link href={`/office/legacy/outbounds/${o.id}`} className="underline">{o.number}</Link></td>
                <td>{fmtDate(o.date)}</td>
                <td>{o.client.name}</td>
                <td>{o.clientDocRef}</td>
                <td>{o.consignee?.name}</td>
                <td>{line ? `${line.item.sku} ${o.lines.length > 1 ? `(+${o.lines.length - 1})` : ""}` : ""}</td>
                <td className="text-right">{fmtNumber(o.lines.reduce((s, l) => s + l.pallets, 0))}</td>
                <td className="text-right">{fmtNumber(o.lines.reduce((s, l) => s + l.units, 0))}</td>
                <td>{fmtTime(o.deadline)}</td>
                <td>{o.carrier?.name}</td>
                <td>{OUTBOUND_STATUS[o.status].label}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="border-t border-[#808080] bg-[#d4d0c8] px-2 py-1">{outbounds.length} registros</div>
    </>
  );
}
