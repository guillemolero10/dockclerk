import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { customerOverview, ROTATION_DAYS } from "@/lib/clients";
import { fmtDate } from "@/lib/format";
import { clientColor } from "@/lib/warehouse/palette";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  await requireRole("office");
  const clients = await customerOverview();

  return (
    <main className="mx-auto max-w-6xl px-8 py-8">
      <header>
        <p className="cond text-sm text-dock-ink/50">Who stores what, and how fast it moves</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Customers</h1>
      </header>

      <ul className="mt-6 grid gap-4 md:grid-cols-2">
        {clients.map((c, i) => (
          <li key={c.code}>
            <Link href={`/office/clients/${c.code}`} className="dock-card group flex overflow-hidden bg-white hover:bg-dock-concrete-2">
              <span className="w-2 shrink-0" style={{ background: clientColor(i) }} />
              <div className="min-w-0 flex-1 p-4">
                <div className="flex items-baseline gap-2">
                  <span className="mono text-xs text-dock-ink/50">{c.code}</span>
                  <span className="truncate font-semibold">{c.name}</span>
                  <ArrowRight size={15} className="ml-auto shrink-0 text-dock-ink/30 transition group-hover:translate-x-0.5 group-hover:text-dock-ink" />
                </div>
                <p className="text-xs text-dock-ink/55">
                  {c.contact ?? "—"} · {c.type === "RAW_MATERIAL" ? "Raw material" : "Finished goods"} · {c.items} items · {c.warehouses.join(", ") || "no stock"}
                </p>
                <div className="mt-3 flex items-end gap-5">
                  <Figure value={c.fullPallets} label={c.picos > 0 ? `pallets + ${c.picos} pico${c.picos === 1 ? "" : "s"}` : "pallets"} />
                  <Figure value={`${Math.round(c.share * 100)}%`} label="of stock" />
                  <Figure value={`+${c.in30}`} label={`in · ${ROTATION_DAYS} d`} />
                  <Figure value={`−${c.out30}`} label={`out · ${ROTATION_DAYS} d`} />
                  <Figure value={c.open} label="open orders" />
                </div>
                <div className="mt-3 h-1.5 bg-dock-concrete">
                  <div className="h-full" style={{ width: `${Math.max(2, c.share * 100)}%`, background: clientColor(i) }} />
                </div>
                {c.nextExpiry && <p className="mt-2 text-xs text-dock-ink/55">First lot to expire: {fmtDate(c.nextExpiry)}</p>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

function Figure({ value, label }: { value: number | string; label: string }) {
  return (
    <span>
      <span className="mono block text-xl font-semibold leading-none">{value}</span>
      <span className="cond block text-[10px] text-dock-ink/50">{label}</span>
    </span>
  );
}
