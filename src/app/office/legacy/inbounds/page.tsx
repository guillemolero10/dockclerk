import type { InboundStatus, Prisma } from "@prisma/client";
import { LegacyFilters } from "@/components/legacy-filters";
import { db } from "@/lib/db";
import { fmtDate, fmtNumber } from "@/lib/format";
import { INBOUND_STATUS } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function InboundsPage({ searchParams }: PageProps<"/office/legacy/inbounds">) {
  const { client, status } = await searchParams;
  const where: Prisma.InboundWhereInput = {};
  if (typeof client === "string" && client) where.clientId = client;
  if (typeof status === "string" && status in INBOUND_STATUS) where.status = status as InboundStatus;

  const [inbounds, clients] = await Promise.all([
    db.inbound.findMany({
      where,
      orderBy: [{ date: "desc" }, { number: "desc" }],
      include: { client: true, carrier: true, lines: { include: { item: true } } },
    }),
    db.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <LegacyFilters
        clients={clients}
        clientId={typeof client === "string" ? client : undefined}
        statuses={Object.entries(INBOUND_STATUS).map(([value, s]) => ({ value, label: s.label }))}
        status={typeof status === "string" ? status : undefined}
      />
      <table className="legacy-grid">
        <thead>
          <tr>
            <th>Nº</th><th>Fecha</th><th>Cliente</th><th>Albarán</th><th>Artículo</th><th>Lote</th>
            <th className="text-right">Palés prev.</th><th className="text-right">Palés rec.</th>
            <th>Transportista</th><th>Matrícula</th><th>Incidencia</th><th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {inbounds.map((i) => {
            const line = i.lines[0];
            const mismatch = i.expectedPallets != null && i.receivedPallets != null && i.expectedPallets !== i.receivedPallets;
            return (
              <tr key={i.id} style={{ background: INBOUND_STATUS[i.status].row }}>
                <td>{i.number}</td>
                <td>{fmtDate(i.date)}</td>
                <td>{i.client.name}</td>
                <td>{i.clientDocRef}</td>
                <td>{line?.item.sku}</td>
                <td>{line?.lot}</td>
                <td className="text-right">{fmtNumber(i.expectedPallets)}</td>
                <td className={`text-right ${mismatch ? "font-bold text-red-700" : ""}`}>{fmtNumber(i.receivedPallets)}</td>
                <td>{i.carrier?.name}</td>
                <td>{i.plate}</td>
                <td className="text-red-700">{i.incident}</td>
                <td>{INBOUND_STATUS[i.status].label}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="border-t border-[#808080] bg-[#d4d0c8] px-2 py-1">{inbounds.length} registros</div>
    </>
  );
}
