import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PrintButton } from "@/components/print-button";
import { barsPath, code128Modules } from "@/lib/barcode";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { requireRole } from "@/lib/session";
import { makeLayout, rackCode } from "@/lib/warehouse/layout";
import { slotLabel } from "@/lib/pallets/scan";

export const dynamic = "force-dynamic";

const QUIET = 10; // modules of white on each side of the bars (the reader needs them)

/** One Code 128 label: bars as a single SVG path, the text under it readable by a person. */
function Label({ text, big, caption }: { text: string; big?: boolean; caption?: string }) {
  const modules = code128Modules(text);
  const width = modules.length + 2 * QUIET;
  return (
    <figure className="break-inside-avoid border border-dock-ink bg-white p-2 text-center">
      <svg role="img" aria-label={text} viewBox={`0 0 ${width} 40`} preserveAspectRatio="none" className={`mx-auto w-full ${big ? "h-20" : "h-12"}`} shapeRendering="crispEdges">
        <rect width={width} height="40" fill="#fff" />
        <path transform={`translate(${QUIET} 0)`} d={barsPath(modules, 40)} fill="#000" />
      </svg>
      <figcaption className={`mono mt-1 font-bold tracking-wider ${big ? "text-xl" : "text-sm"}`}>{text}</figcaption>
      {caption && <p className="mono truncate text-[10px] text-dock-ink/60">{caption}</p>}
    </figure>
  );
}

export default async function LabelsPage({ searchParams }: PageProps<"/labels">) {
  // The operator reaches it from "label these pallets" after unloading.
  const session = await requireRole("office", "operator");
  const { t } = await getT();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

  const warehouses = await db.warehouse.findMany({ orderBy: { code: "asc" } });
  const warehouse = warehouses.find((w) => w.code === one(sp.w)) ?? warehouses[0];
  if (!warehouse) return <p className="p-6">{t("op.noWarehouseShort")}</p>;
  const kind = one(sp.kind) === "pallets" ? "pallets" : "slots";
  const only = (one(sp.codes) ?? "").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean).slice(0, 100);
  const layout = makeLayout(warehouse);
  const row = layout.rows.find((r) => r === one(sp.row));

  const href = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams({ w: warehouse.code, kind, ...(row ? { row } : {}), ...extra });
    for (const [k, v] of [...q]) if (!v) q.delete(k);
    return `/labels?${q}`;
  };

  let labels: { text: string; caption?: string }[] = [];
  if (kind === "slots") {
    const rows = row ? [row] : layout.rows;
    for (const r of rows) {
      for (let p = 1; p <= layout.positions; p++) {
        for (let l = 1; l <= layout.levels; l++) labels.push({ text: slotLabel(warehouse.code, rackCode(r, p, l)) });
      }
    }
  } else {
    const stock = await db.stock.findMany({
      where: { warehouseId: warehouse.id, palletCode: { not: null }, ...(only.length ? { palletCode: { in: only } } : {}) },
      include: { item: { select: { sku: true } }, client: { select: { name: true } } },
      orderBy: [{ palletCode: "asc" }, { id: "asc" }],
    });
    const byCode = new Map<string, typeof stock>();
    for (const s of stock) byCode.set(s.palletCode!, [...(byCode.get(s.palletCode!) ?? []), s]);
    labels = [...byCode.entries()].map(([code, rows]) => ({
      text: code,
      caption: `${rows[0].client.name.replace(/,?\s+S\.?[AL]\.?$/i, "")} · ${rows.map((r) => r.item.sku).join(" + ")}${rows.length > 1 ? ` · ${t("lb.mixed")}` : ""}`,
    }));
  }

  const tab = (active: boolean) => `cond px-3 py-1.5 text-sm ${active ? "bg-dock-ink text-dock-yellow" : "border-[1.5px] border-dock-ink bg-white"}`;

  return (
    <div className="dock-app min-h-screen">
    <main className="mx-auto max-w-5xl px-4 py-6 md:px-8">
      <header className="space-y-3 print:hidden">
        <Link href={session.role === "office" ? "/office" : `/operator?w=${warehouse.code}`} className="cond flex items-center gap-1 text-xs text-dock-ink/50">
          <ArrowLeft size={13} /> {t("lb.back")}
        </Link>
        <div>
          <p className="cond text-sm text-dock-ink/50">{t("lb.kicker")}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{t("lb.title")}</h1>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label={t("lb.building")}>
          {warehouses.map((w) => (
            <Link key={w.code} href={`/labels?w=${w.code}&kind=${kind}`} className={tab(w.code === warehouse.code)}>
              {w.code}
            </Link>
          ))}
          <span className="w-4" />
          <Link href={href({ kind: "slots", codes: undefined })} className={tab(kind === "slots")}>{t("lb.slots")}</Link>
          <Link href={href({ kind: "pallets", row: undefined })} className={tab(kind === "pallets")}>{t("lb.pallets")}</Link>
        </nav>
        {kind === "slots" && (
          <nav className="flex flex-wrap gap-1.5 text-xs" aria-label={t("lb.slots")}>
            <Link href={href({ row: undefined })} className={tab(!row)}>{t("lb.showAll")}</Link>
            {layout.rows.map((r) => (
              <Link key={r} href={href({ row: r })} className={tab(r === row)}>{r}</Link>
            ))}
          </nav>
        )}
        {kind === "pallets" && only.length > 0 && (
          <p className="text-sm">
            {t("lb.only", { codes: only.slice(0, 4).join(", ") + (only.length > 4 ? "…" : "") })} <Link href={href({ codes: undefined })} className="underline">{t("lb.showAll")}</Link>
          </p>
        )}
        <div className="flex items-center gap-4">
          <PrintButton />
          <span className="mono text-sm text-dock-ink/60">{t("lb.count_p", { n: labels.length })}</span>
        </div>
        <p className="max-w-2xl text-xs text-dock-ink/60">{t("lb.help")}</p>
      </header>

      {labels.length === 0 ? (
        <p className="dock-card mt-6 bg-white p-5 text-sm text-dock-ink/60">{kind === "slots" ? t("lb.noSlots") : t("lb.noPallets")}</p>
      ) : (
        <section aria-label={t("lb.title")} className={`mt-6 grid gap-2 print:mt-0 ${kind === "slots" ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4" : "grid-cols-1 sm:grid-cols-2"}`}>
          {labels.map((l) => (
            <Label key={l.text} text={l.text} caption={l.caption} big={kind === "pallets"} />
          ))}
        </section>
      )}
    </main>
    </div>
  );
}
