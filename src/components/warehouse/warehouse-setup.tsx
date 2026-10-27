"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowLeft, Lock, Trash2 } from "lucide-react";
import { deleteWarehouse, saveWarehouse } from "@/app/office/warehouse/actions";
import { FORKLIFTS, LIMITS, makeLayout, type WarehouseDims } from "@/lib/warehouse/layout";
import type { WarehouseScene } from "./scene";

type Existing = { code: string; name: string; city: string; dims: WarehouseDims; pallets: number; hasHistory: boolean };

const DEFAULT: WarehouseDims = { length: 40, width: 30, height: 9, aisleWidth: 3.0, docks: 4 };

function valid(d: WarehouseDims) {
  return (["length", "width", "height", "docks"] as const).every((k) => d[k] >= LIMITS[k].min && d[k] <= LIMITS[k].max);
}

/** Type the measurements of the building; the racking is laid out live. */
export function WarehouseSetup({ existing }: { existing: Existing | null }) {
  const locked = !!existing && existing.pallets > 0;
  const [dims, setDims] = useState<WarehouseDims>(existing?.dims ?? DEFAULT);
  const [shown, setShown] = useState<WarehouseDims>(existing?.dims ?? DEFAULT);
  const mount = useRef<HTMLDivElement>(null);

  // Redraw shortly after typing stops, and only with measurements that make sense.
  useEffect(() => {
    if (!valid(dims)) return;
    const timer = setTimeout(() => setShown(dims), 300);
    return () => clearTimeout(timer);
  }, [dims]);

  const layout = useMemo(() => makeLayout(shown), [shown]);
  const live = valid(dims) ? makeLayout(dims) : null;

  useEffect(() => {
    let disposed = false;
    let instance: WarehouseScene | null = null;
    import("./scene").then(({ WarehouseScene }) => {
      if (disposed || !mount.current) return;
      instance = new WarehouseScene(mount.current, layout);
    });
    return () => {
      disposed = true;
      instance?.dispose();
    };
  }, [layout]);

  const set = (key: keyof WarehouseDims) => (e: React.ChangeEvent<HTMLInputElement>) => setDims((d) => ({ ...d, [key]: Number(e.target.value) }));

  return (
    <div className="grid h-screen grid-cols-[400px_1fr]">
      <form action={saveWarehouse} className="flex flex-col overflow-y-auto border-r-[1.5px] border-dock-ink bg-white">
        <div className="hazard h-2" />
        <div className="flex-1 space-y-5 px-6 py-5">
          <Link href={existing ? `/office/warehouse?w=${existing.code}` : "/office/warehouse"} className="cond flex items-center gap-1.5 text-xs text-dock-ink/50 hover:text-dock-ink">
            <ArrowLeft size={13} /> Warehouse 3D
          </Link>
          <div>
            <p className="cond text-sm text-dock-ink/50">{existing ? existing.code : "New building"}</p>
            <h1 className="text-2xl font-semibold tracking-tight">{existing ? "Measurements" : "Add a warehouse"}</h1>
            <p className="mt-1 text-sm text-dock-ink/60">Type the inside measurements of the building. DockClerk lays out the racking and works out how many pallets fit.</p>
          </div>

          <input type="hidden" name="code" value={existing?.code ?? ""} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <input name="name" required defaultValue={existing?.name ?? ""} placeholder="Nave 3 · Frío" className="dock-input" />
            </Field>
            <Field label="City">
              <input name="city" required defaultValue={existing?.city ?? ""} placeholder="Elche" className="dock-input" />
            </Field>
          </div>

          {locked && (
            <p className="flex items-start gap-2 bg-dock-concrete-2 px-3 py-2 text-xs text-dock-ink/70">
              <Lock size={14} className="mt-0.5 shrink-0" /> It holds {existing!.pallets} pallets, so the measurements are locked. You can still rename it.
            </p>
          )}

          <fieldset disabled={locked} className="space-y-3 disabled:opacity-60">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Length" unit="m">
                <input name="length" type="number" step="0.5" min={LIMITS.length.min} max={LIMITS.length.max} value={dims.length} onChange={set("length")} className="dock-input mono" />
              </Field>
              <Field label="Width" unit="m">
                <input name="width" type="number" step="0.5" min={LIMITS.width.min} max={LIMITS.width.max} value={dims.width} onChange={set("width")} className="dock-input mono" />
              </Field>
              <Field label="Clear height" unit="m">
                <input name="height" type="number" step="0.5" min={LIMITS.height.min} max={LIMITS.height.max} value={dims.height} onChange={set("height")} className="dock-input mono" />
              </Field>
            </div>

            <Field label="Forklifts (sets the aisle width)">
              <div className="grid gap-1.5">
                {FORKLIFTS.map((f) => (
                  <label key={f.label} className={`flex cursor-pointer items-center gap-2 border-[1.5px] px-3 py-2 text-sm ${dims.aisleWidth === f.aisle ? "border-dock-ink bg-dock-yellow" : "border-dock-line"}`}>
                    <input type="radio" name="aisleWidth" value={f.aisle} checked={dims.aisleWidth === f.aisle} onChange={() => setDims((d) => ({ ...d, aisleWidth: f.aisle }))} className="accent-dock-ink" />
                    <span className="flex-1">{f.label}</span>
                    <span className="mono text-xs text-dock-ink/60">{f.aisle} m aisles</span>
                  </label>
                ))}
              </div>
            </Field>

            <Field label="Dock doors" unit="half in, half out">
              <input name="docks" type="number" min={LIMITS.docks.min} max={LIMITS.docks.max} value={dims.docks} onChange={set("docks")} className="dock-input mono" />
            </Field>
          </fieldset>
          {/* A disabled fieldset does not submit; send the locked measurements as they are. */}
          {locked &&
            (["length", "width", "height", "aisleWidth", "docks"] as const).map((k) => <input key={k} type="hidden" name={k} value={existing!.dims[k]} />)}

          <div className="dock-console px-4 py-3 text-[12.5px]">
            <p className="cond mb-1.5 text-[11px] text-white/50">What fits</p>
            {live ? (
              <div className="mono space-y-0.5">
                <p>
                  <span className="text-white">{live.rows.length}</span> rows × <span className="text-white">{live.positions}</span> positions × <span className="text-white">{live.levels}</span> levels
                </p>
                <p className="ok">= {live.capacity.toLocaleString("en-GB")} pallet slots</p>
                <p className="text-white/50">
                  {live.aisleXs.length} aisles · {live.laneCount.REC} receiving + {live.laneCount.EXP} dispatch lanes
                </p>
              </div>
            ) : (
              <p className="ask">
                Length {LIMITS.length.min}–{LIMITS.length.max} m, width {LIMITS.width.min}–{LIMITS.width.max} m, height {LIMITS.height.min}–{LIMITS.height.max} m, {LIMITS.docks.min}–{LIMITS.docks.max} docks.
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2 border-t-[1.5px] border-dock-ink px-6 py-4">
          <SaveButton label={existing ? "Save" : "Create warehouse"} disabled={!live} />
          {existing && !existing.hasHistory && (
            <button formAction={deleteWarehouse} className="cond flex items-center gap-1.5 border-[1.5px] border-dock-ink px-3 py-2 text-sm hover:bg-dock-red hover:text-white">
              <Trash2 size={14} /> Delete
            </button>
          )}
        </div>
      </form>

      <div className="relative">
        <div ref={mount} className="absolute inset-0" />
        <p className="cond pointer-events-none absolute left-5 top-5 bg-dock-ink px-2 py-1 text-[11px] text-dock-yellow">Live preview</p>
      </div>
    </div>
  );
}

function Field({ label, unit, children }: { label: string; unit?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="cond flex justify-between text-[11px] text-dock-ink/50">
        {label} {unit && <span className="normal-case tracking-normal">{unit}</span>}
      </span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

function SaveButton({ label, disabled }: { label: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={disabled || pending} className="cond flex-1 bg-dock-ink px-4 py-2 text-sm font-semibold text-dock-yellow disabled:opacity-50">
      {pending ? "Saving…" : label}
    </button>
  );
}
