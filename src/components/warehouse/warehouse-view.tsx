"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Bot, Crosshair, Plus, Route, Ruler, X } from "lucide-react";
import { FORKLIFTS, makeLayout, parseLocation } from "@/lib/warehouse/layout";
import { AGE_BUCKETS, EXPIRY_BUCKETS, GHOST, NO_EXPIRY, PICK, ageColor, clientColor, expiryColor } from "@/lib/warehouse/palette";
import { pickRoute } from "@/lib/warehouse/route";
import type { SnapshotOrder, WarehouseSnapshot } from "@/lib/warehouse/snapshot";
import type { ScenePallet, WarehouseScene } from "./scene";

export type Mode = "customer" | "age" | "expiry";
const MODES: { id: Mode; label: string }[] = [
  { id: "customer", label: "Customer" },
  { id: "age", label: "Days in storage" },
  { id: "expiry", label: "Expiry" },
];
const UNIT: Record<string, string> = { BOX: "boxes", BAG: "bags", PALLET: "units" };
const OCCUPANCY_ALERT = 0.85;
const PANEL_INSET = 360; // left panels: 330 px wide + margin

function when(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });
}

export function WarehouseView({ snapshot, initialPick, initialMode = "customer" }: { snapshot: WarehouseSnapshot; initialPick: string | null; initialMode?: Mode }) {
  const router = useRouter();
  const mount = useRef<HTMLDivElement>(null);
  const scene = useRef<WarehouseScene | null>(null);
  // Bumped each time a scene is built, so the effects below feed the new one.
  const [sceneVersion, setSceneVersion] = useState(0);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [pickId, setPickId] = useState<string | null>(initialPick);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);

  const { warehouses, clients, items, pallets, orders, prepared } = snapshot;
  const here = warehouses.find((w) => w.code === snapshot.current)!;
  const dimsKey = JSON.stringify(here.dims);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt only when the measurements change
  const layout = useMemo(() => makeLayout(here.dims), [dimsKey]);

  const order = orders.find((o) => o.id === pickId && o.warehouse === here.code) ?? null;
  const palletById = useMemo(() => new Map(pallets.map((p) => [p.id, p])), [pallets]);
  const reservedBy = useMemo(() => {
    const map = new Map<string, SnapshotOrder>();
    for (const o of orders) for (const id of o.picks) map.set(id, o);
    return map;
  }, [orders]);

  // Picked outbounds waiting in the dispatch lanes for their truck.
  const preparedById = useMemo(() => new Map(prepared.map((o) => [o.id, o])), [prepared]);
  const dispatchLane = order?.lane ?? 1;
  const route = useMemo(
    () =>
      order
        ? pickRoute(
            layout,
            order.picks.filter((id) => !order.picked.includes(id)).map((id) => ({ id, loc: palletById.get(id)?.loc ?? "" })),
            dispatchLane,
          )
        : null,
    [layout, order, palletById, dispatchLane],
  );

  const scenePallets = useMemo<ScenePallet[]>(() => {
    const picking = new Set(order?.picks ?? []);
    const colorOf = (p: (typeof pallets)[number]) => {
      if (order) return picking.has(p.id) ? PICK : GHOST;
      if (mode === "age") return ageColor(p.days);
      if (mode === "expiry") return expiryColor(p.expiresIn);
      return clientColor(items[p.item].client);
    };
    return pallets.map((p) => ({ id: p.id, loc: p.loc, color: colorOf(p) }));
  }, [pallets, items, mode, order]);

  // Scene lifecycle: one scene per building shape.
  useEffect(() => {
    let disposed = false;
    let instance: WarehouseScene | null = null;
    import("./scene")
      .then(({ WarehouseScene }) => {
        if (disposed || !mount.current) return;
        instance = new WarehouseScene(mount.current, layout);
        instance.onHover = (id, x, y) => setHover(id ? { id, x, y } : null);
        instance.onPick = (id) => setSelectedId(id);
        instance.setLeftInset(PANEL_INSET);
        scene.current = instance;
        setSceneVersion((v) => v + 1);
      })
      .catch(() => setFailed(true));
    return () => {
      disposed = true;
      instance?.dispose();
      scene.current = null;
    };
  }, [layout]);

  useEffect(() => {
    if (sceneVersion) scene.current?.setPallets(scenePallets);
  }, [sceneVersion, scenePallets]);

  const routeKey = route ? route.order.join(",") : "";
  useEffect(() => {
    if (sceneVersion) scene.current?.setPicks(route?.order ?? [], route?.path ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the route itself changes
  }, [sceneVersion, routeKey]);

  const busyKey = snapshot.busyDocks.join(",");
  useEffect(() => {
    if (sceneVersion) scene.current?.setBusyDocks(busyKey ? busyKey.split(",").map(Number) : []);
  }, [sceneVersion, busyKey]);

  useEffect(() => {
    if (sceneVersion) scene.current?.setSelected(selectedId);
  }, [sceneVersion, selectedId]);

  // Live: pick up what the office approves and the floor moves.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, [router]);

  function choose(o: SnapshotOrder | null) {
    if (o?.warehouse && o.warehouse !== here.code) {
      router.push(`/office/warehouse?w=${o.warehouse}&pick=${o.id}`);
      return;
    }
    setPickId(o?.id ?? null);
    setSelectedId(null);
    const url = new URL(window.location.href);
    url.searchParams.set("w", here.code);
    if (o) url.searchParams.set("pick", o.id);
    else url.searchParams.delete("pick");
    window.history.replaceState(null, "", url);
  }

  const occupancy = here.inRacks / here.capacity;
  const hot = occupancy >= OCCUPANCY_ALERT;
  const forklift = FORKLIFTS.find((f) => f.aisle === here.dims.aisleWidth)?.label ?? `${here.dims.aisleWidth} m aisles`;

  const hovered = hover ? describe(hover.id) : null;
  const selected = selectedId ? describe(selectedId) : null;

  function describe(id: string) {
    const shipping = palletById.get(id)?.outbound ? preparedById.get(palletById.get(id)!.outbound!) : undefined;
    if (shipping) {
      return { kind: "staged" as const, loc: palletById.get(id)!.loc, order: shipping, client: clients[shipping.client] };
    }
    const p = palletById.get(id);
    if (!p) return null;
    const item = items[p.item];
    return { kind: "stock" as const, loc: p.loc, pallet: p, item, client: clients[item.client], reserved: reservedBy.get(id) ?? null };
  }

  return (
    <div className="relative h-screen overflow-hidden">
      <div ref={mount} className="absolute inset-0" />

      {failed && (
        <div className="absolute inset-0 grid place-items-center text-sm text-dock-ink/60">The 3D view needs WebGL, which this browser does not offer.</div>
      )}

      <div className="pointer-events-none absolute left-5 top-5 flex w-[330px] flex-col gap-3">
        {/* One tab per building */}
        <nav className="pointer-events-auto flex gap-1.5">
          {warehouses.map((w) => {
            const active = w.code === here.code;
            const full = w.inRacks / w.capacity;
            return (
              <Link
                key={w.code}
                href={`/office/warehouse?w=${w.code}`}
                className={`cond flex flex-1 items-center justify-between gap-2 border-[1.5px] border-dock-ink px-2.5 py-1.5 text-xs ${active ? "bg-dock-ink text-dock-yellow" : "bg-white hover:bg-dock-concrete-2"}`}
              >
                {w.code}
                <span className={`mono text-[11px] ${full >= OCCUPANCY_ALERT ? (active ? "text-red-300" : "text-dock-red") : active ? "text-white/60" : "text-dock-ink/50"}`}>
                  {Math.round(full * 100)}%
                </span>
              </Link>
            );
          })}
          <Link href="/office/warehouse/setup" className="grid w-9 place-items-center border-[1.5px] border-dashed border-dock-ink bg-white hover:bg-dock-yellow" title="Add a warehouse">
            <Plus size={15} />
          </Link>
        </nav>

        {/* Header: building and live occupancy */}
        <section className="dock-card pointer-events-auto overflow-hidden bg-white">
          <div className="flex items-center gap-2 border-b-[1.5px] border-dock-ink px-4 py-2.5">
            <span className="dock-live h-2 w-2 rounded-full bg-dock-red" />
            <span className="cond text-[11px] text-dock-ink/60">Live · {here.city}</span>
            <Link href={`/office/warehouse/setup?code=${here.code}`} className="cond ml-auto flex items-center gap-1 text-[11px] text-dock-ink/50 hover:text-dock-ink">
              <Ruler size={12} /> Measurements
            </Link>
          </div>
          <div className="px-4 pb-3 pt-2.5">
            <h1 className="text-xl font-semibold leading-tight tracking-tight">{here.name}</h1>
            <p className="mono mt-1 text-[11px] text-dock-ink/50">
              {here.dims.length} × {here.dims.width} m · {here.dims.height} m clear · {here.dims.docks} docks · {forklift}
            </p>
            <div className="mt-2.5 flex items-baseline justify-between">
              <span className="cond text-[11px] text-dock-ink/50">Occupancy · {here.capacity} slots</span>
              <span className={`mono text-lg font-semibold ${hot ? "text-dock-red" : ""}`}>{Math.round(occupancy * 100)}%</span>
            </div>
            <div className="relative mt-1 h-2.5 border-[1.5px] border-dock-ink bg-dock-concrete-2">
              <div className={`h-full ${hot ? "bg-dock-red" : "bg-dock-ink"}`} style={{ width: `${Math.min(1, occupancy) * 100}%` }} />
              <div className="absolute -top-1 h-4 w-0.5 bg-dock-ink" style={{ left: `${OCCUPANCY_ALERT * 100}%` }} title="Alert threshold" />
            </div>
            {hot && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-dock-red">
                <AlertTriangle size={13} /> Above {OCCUPANCY_ALERT * 100}%: {here.capacity - here.inRacks} free slots left
              </p>
            )}
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Stat label="In racks" value={here.inRacks} />
              <Stat label="Receiving" value={here.receiving} />
              <Stat label="To ship" value={here.toShip} />
            </div>
          </div>
        </section>

        {/* Outbounds waiting to be picked, in every building */}
        <section className="dock-card pointer-events-auto flex max-h-[calc(100vh-390px)] flex-col overflow-hidden bg-white">
          <h2 className="cond flex items-center gap-2 border-b-[1.5px] border-dock-ink px-4 py-2 text-xs">
            To pick <span className="mono bg-dock-ink px-1.5 text-[11px] text-dock-yellow">{orders.length}</span>
            <span className="ml-auto normal-case tracking-normal text-dock-ink/40">tap one to light it up</span>
          </h2>
          <ul className="overflow-y-auto">
            {orders.map((o) => {
              const active = o.id === order?.id;
              const elsewhere = o.warehouse !== here.code;
              return (
                <li key={o.id} className="border-b border-dock-line last:border-0">
                  <button
                    onClick={() => choose(active ? null : o)}
                    className={`w-full px-4 py-2 text-left text-sm transition-colors ${active ? "bg-dock-yellow" : "hover:bg-dock-concrete-2"} ${elsewhere ? "opacity-60" : ""}`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0" style={{ background: clientColor(o.client) }} />
                      <span className="mono text-xs font-semibold">Nº {o.number}</span>
                      {o.byClerk && (
                        <span className="cond flex items-center gap-1 bg-dock-ink px-1.5 text-[10px] text-dock-yellow">
                          <Bot size={11} /> AI
                        </span>
                      )}
                      <span className="mono border border-dock-ink/30 px-1 text-[10px]">{o.warehouse ?? "—"}</span>
                      <span className="mono ml-auto text-xs">{o.pallets} plt</span>
                    </span>
                    <span className="mt-0.5 block truncate font-medium">{clients[o.client].name}</span>
                    <span className="block truncate text-xs text-dock-ink/55">
                      → {o.consignee ?? "—"} · {when(o.deadline)}
                    </span>
                    {o.short > 0 && <span className="mt-0.5 block text-xs font-semibold text-dock-red">{o.short} pallets short</span>}
                  </button>
                  {active && route && (
                    <div className="dock-console m-2 px-3 py-2 text-[12px]">
                      <p className="cond mb-1 flex items-center gap-1.5 text-[11px] text-white/50">
                        <Route size={12} /> Pick route · ≈{route.metres} m · ends at EXP {dispatchLane}
                        {order.picked.length > 0 && ` · ${order.picked.length}/${order.picks.length} picked`}
                      </p>
                      <ol className="mono space-y-0.5">
                        {route.order.map((id, i) => {
                          const p = palletById.get(id);
                          return (
                            <li key={id} className="flex gap-2">
                              <span className="w-5 text-right text-dock-yellow">{i + 1}</span>
                              <button onClick={() => setSelectedId(id)} className="text-white hover:underline">
                                {p?.loc}
                              </button>
                              <span className="truncate text-white/50">
                                {p ? items[p.item].sku : ""} {p?.lot ? `· ${p.lot}` : ""}
                              </span>
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {/* Colour mode */}
      <div className="absolute right-5 top-5 flex items-center gap-2">
        <div className="dock-card flex overflow-hidden bg-white p-0.5">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setMode(m.id);
                choose(null);
              }}
              className={`cond rounded-md px-3 py-1.5 text-xs transition-colors ${mode === m.id && !order ? "bg-dock-ink text-dock-yellow" : "text-dock-ink/60 hover:text-dock-ink"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button onClick={() => scene.current?.resetView()} className="dock-card grid h-9 w-9 place-items-center bg-white" title="Reset view">
          <Crosshair size={16} />
        </button>
      </div>

      {/* Legend */}
      <div className={`dock-card absolute bottom-5 right-5 max-w-[420px] bg-white px-4 py-2.5 text-xs ${pallets.length ? "" : "hidden"}`}>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {order ? (
            <>
              <Swatch color={PICK} label={`To pick for Nº ${order.number}`} />
              <Swatch color={GHOST} label="Everything else" />
            </>
          ) : mode === "customer" ? (
            clients
              .map((c, i) => ({ c, i }))
              .filter(({ i }) => pallets.some((p) => items[p.item].client === i))
              .map(({ c, i }) => <Swatch key={c.code} color={clientColor(i)} label={c.name.replace(/,? S\.[AL]\.$/, "")} />)
          ) : mode === "age" ? (
            AGE_BUCKETS.map((b) => <Swatch key={b.label} color={b.color} label={b.label} />)
          ) : (
            <>
              {EXPIRY_BUCKETS.map((b) => <Swatch key={b.label} color={b.color} label={b.label} />)}
              <Swatch color={NO_EXPIRY} label="No expiry" />
            </>
          )}
        </div>
      </div>

      {/* Pallet card */}
      {selected && (
        <section className="dock-card absolute bottom-20 right-5 w-[300px] overflow-hidden bg-white">
          <header className="flex items-center justify-between bg-dock-yellow px-4 py-2">
            <span className="cond text-2xl font-bold leading-none">{selected.loc}</span>
            <button onClick={() => setSelectedId(null)} aria-label="Close">
              <X size={16} />
            </button>
          </header>
          <div className="space-y-2 px-4 py-3 text-sm">
            <p className="font-semibold">{selected.client.name}</p>
            {selected.kind === "stock" ? (
              <>
                <p>
                  <span className="mono font-semibold">{selected.item.sku}</span>
                  <span className="text-dock-ink/60"> · {selected.item.description}</span>
                </p>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="cond text-dock-ink/50">Lot</dt>
                  <dd className="mono">
                    {selected.pallet.lot ? (
                      <Link href={`/office/trace?lot=${encodeURIComponent(selected.pallet.lot)}`} className="underline" title="Trace this lot">
                        {selected.pallet.lot}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </dd>
                  <dt className="cond text-dock-ink/50">Quantity</dt>
                  <dd className="mono">
                    {selected.pallet.units} {UNIT[selected.item.unit]}
                  </dd>
                  <dt className="cond text-dock-ink/50">In storage</dt>
                  <dd className="mono">{selected.pallet.days} days</dd>
                  <dt className="cond text-dock-ink/50">Expires</dt>
                  <dd className={`mono ${selected.pallet.expiresIn !== null && selected.pallet.expiresIn < 30 ? "font-semibold text-dock-red" : ""}`}>
                    {selected.pallet.expiresIn === null ? "—" : `in ${selected.pallet.expiresIn} days`}
                  </dd>
                </dl>
                {parseLocation(selected.loc)?.kind === "floor" && <p className="text-xs text-dock-ink/60">On the receiving floor, waiting for a rack slot.</p>}
                {selected.reserved && (
                  <button onClick={() => choose(selected.reserved)} className="cond w-full bg-dock-ink px-3 py-1.5 text-left text-xs text-dock-yellow">
                    Reserved for outbound Nº {selected.reserved.number} → {selected.reserved.consignee}
                  </button>
                )}
              </>
            ) : (
              <p className="text-xs text-dock-ink/70">
                Picked for outbound <span className="mono font-semibold">Nº {selected.order.number}</span> → {selected.order.consignee}. Truck due {when(selected.order.deadline)}.
              </p>
            )}
          </div>
        </section>
      )}

      {/* Hover tooltip */}
      {hover && hovered && (
        <div className="pointer-events-none absolute z-10 bg-dock-ink px-2 py-1 text-xs text-white" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <span className="mono font-semibold text-dock-yellow">{hovered.loc}</span>{" "}
          {hovered.kind === "stock" ? `${hovered.item.sku} · ${hovered.client.name}` : `Nº ${hovered.order.number} · ready to ship`}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-dock-concrete-2 px-1 py-1.5">
      <p className="mono text-base font-semibold">{value}</p>
      <p className="cond text-[10px] text-dock-ink/50">{label}</p>
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-3 w-3 border border-dock-ink/30" style={{ background: color }} />
      {label}
    </span>
  );
}
