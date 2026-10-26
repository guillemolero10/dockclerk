import type { Prisma } from "@prisma/client";
import { LegacyFilters } from "@/components/legacy-filters";
import { db } from "@/lib/db";
import { fmtNumber } from "@/lib/format";
import { UNIT_LABEL } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function StockPage({ searchParams }: PageProps<"/office/stock">) {
  const { client } = await searchParams;
  const where: Prisma.StockWhereInput = {};
  if (typeof client === "string" && client) where.clientId = client;

  const [rows, clients] = await Promise.all([
    db.stock.findMany({
      where,
      orderBy: [{ client: { name: "asc" } }, { item: { sku: "asc" } }],
      include: { client: true, item: true },
    }),
    db.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const totalPallets = rows.reduce((s, r) => s + r.pallets, 0);

  return (
    <>
      <LegacyFilters clients={clients} clientId={typeof client === "string" ? client : undefined} />
      <table className="legacy-grid">
        <thead>
          <tr>
            <th>Cliente</th><th>Artículo</th><th>Descripción</th><th>Lote</th>
            <th className="text-right">Palés</th><th className="text-right">Cantidad</th><th>Ubicación</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.client.name}</td>
              <td>{r.item.sku}</td>
              <td>{r.item.description}</td>
              <td>{r.lot}</td>
              <td className="text-right">{fmtNumber(r.pallets)}</td>
              <td className="text-right">{fmtNumber(r.units)} {UNIT_LABEL[r.item.unit]}</td>
              <td>{r.location}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-[#808080] bg-[#d4d0c8] px-2 py-1">
        {rows.length} registros · {fmtNumber(totalPallets)} palés en almacén
      </div>
    </>
  );
}
