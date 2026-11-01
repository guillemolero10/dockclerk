"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowLeft, Lock, Trash2 } from "lucide-react";
import { deleteWarehouse, saveWarehouse } from "@/app/office/warehouse/actions";
import { useT } from "@/lib/i18n/client";
import { LOCALE } from "@/lib/i18n/core";
import { FORKLIFTS, LIMITS, makeLayout, type WarehouseDims } from "@/lib/warehouse/layout";
import type { WarehouseScene } from "./scene";

type Existing = { code: string; name: string; city: string; dims: WarehouseDims; pallets: number; hasHistory: boolean };

const DEFAULT: WarehouseDims = { length: 40, width: 30, height: 9, aisleWidth: 3.0, docks: 4 };

function valid(d: WarehouseDims) {
  return (["length", "width", "height", "docks"] as const).every((k) => d[k] >= LIMITS[k].min && d[k] <= LIMITS[k].max);
}

/** Type the measurements of the building; the racking is laid out live. */
export function WarehouseSetup({ existing }: { existing: Existing | null }) {
  const { t, lang } = useT();
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
    import("./scene")
      .then(({ WarehouseScene }) => {
        if (disposed || !mount.current) return;
        instance = new WarehouseScene(mount.current, layout, { dock: t("w.sign.dock"), aisle: t("w.sign.aisle"), clear: t("w.sign.clear") });
      })
      // No WebGL on this machine: the form still works, only the 3D preview is missing.
      .catch(() => {});
    return () => {
      disposed = true;
      instance?.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt when the building or the language changes
  }, [layout, lang]);

  const set = (key: keyof WarehouseDims) => (e: React.ChangeEvent<HTMLInputElement>) => setDims((d) => ({ ...d, [key]: Number(e.target.value) }));

  return (
    <div className="grid h-screen grid-cols-[400px_1fr]">
      <form action={saveWarehouse} className="flex flex-col overflow-y-auto border-r-[1.5px] border-dock-ink bg-white">
        <div className="hazard h-2" />
        <div className="flex-1 space-y-5 px-6 py-5">
          <Link href={existing ? `/office/warehouse?w=${existing.code}` : "/office/warehouse"} className="cond flex items-center gap-1.5 text-xs text-dock-ink/50 hover:text-dock-ink">
            <ArrowLeft size={13} /> {t("ws.back")}
          </Link>
          <div>
            <p className="cond text-sm text-dock-ink/50">{existing ? existing.code : t("ws.newBuilding")}</p>
            <h1 className="text-2xl font-semibold tracking-tight">{existing ? t("ws.measurementsTitle") : t("ws.addTitle")}</h1>
            <p className="mt-1 text-sm text-dock-ink/60">{t("ws.intro")}</p>
          </div>

          <input type="hidden" name="code" value={existing?.code ?? ""} />
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("ws.name")}>
              <input name="name" required defaultValue={existing?.name ?? ""} placeholder="Nave 3 · Frío" className="dock-input" />
            </Field>
            <Field label={t("ws.city")}>
              <input name="city" required defaultValue={existing?.city ?? ""} placeholder="Elche" className="dock-input" />
            </Field>
          </div>

          {locked && (
            <p className="flex items-start gap-2 bg-dock-concrete-2 px-3 py-2 text-xs text-dock-ink/70">
              <Lock size={14} className="mt-0.5 shrink-0" /> {t("ws.locked", { n: existing!.pallets })}
            </p>
          )}

          <fieldset disabled={locked} className="space-y-3 disabled:opacity-60">
            <div className="grid grid-cols-3 gap-3">
              <Field label={t("ws.length")} unit="m">
                <input name="length" type="number" step="0.5" min={LIMITS.length.min} max={LIMITS.length.max} value={dims.length} onChange={set("length")} className="dock-input mono" />
              </Field>
              <Field label={t("ws.width")} unit="m">
                <input name="width" type="number" step="0.5" min={LIMITS.width.min} max={LIMITS.width.max} value={dims.width} onChange={set("width")} className="dock-input mono" />
              </Field>
              <Field label={t("ws.height")} unit="m">
                <input name="height" type="number" step="0.5" min={LIMITS.height.min} max={LIMITS.height.max} value={dims.height} onChange={set("height")} className="dock-input mono" />
              </Field>
            </div>

            <Field label={t("ws.forklifts")}>
              <div className="grid gap-1.5">
                {FORKLIFTS.map((f) => (
                  <label key={f.label} className={`flex cursor-pointer items-center gap-2 border-[1.5px] px-3 py-2 text-sm ${dims.aisleWidth === f.aisle ? "border-dock-ink bg-dock-yellow" : "border-dock-line"}`}>
                    <input type="radio" name="aisleWidth" value={f.aisle} checked={dims.aisleWidth === f.aisle} onChange={() => setDims((d) => ({ ...d, aisleWidth: f.aisle }))} className="accent-dock-ink" />
                    <span className="flex-1">{t(`w.forklift.${f.aisle}` as "w.forklift.3")}</span>
                    <span className="mono text-xs text-dock-ink/60">{t("w.aislesN", { n: f.aisle })}</span>
                  </label>
                ))}
              </div>
            </Field>

            <Field label={t("ws.docks")} unit={t("ws.docksUnit")}>
              <input name="docks" type="number" min={LIMITS.docks.min} max={LIMITS.docks.max} value={dims.docks} onChange={set("docks")} className="dock-input mono" />
            </Field>
          </fieldset>
          {/* A disabled fieldset does not submit; send the locked measurements as they are. */}
          {locked &&
            (["length", "width", "height", "aisleWidth", "docks"] as const).map((k) => <input key={k} type="hidden" name={k} value={existing!.dims[k]} />)}

          <div className="dock-console px-4 py-3 text-[12.5px]">
            <p className="cond mb-1.5 text-[11px] text-white/50">{t("ws.fits")}</p>
            {live ? (
              <div className="mono space-y-0.5">
                <p>
                  {t("ws.fitsLine", { rows: live.rows.length, pos: live.positions, lev: live.levels })}
                </p>
                <p className="ok">{t("ws.slots", { n: live.capacity.toLocaleString(LOCALE[lang]) })}</p>
                <p className="text-white/50">
                  {t("ws.aislesLanes", { aisles: live.aisleXs.length, rec: live.laneCount.REC, exp: live.laneCount.EXP })}
                </p>
              </div>
            ) : (
              <p className="ask">
                {t("ws.limits", { l1: LIMITS.length.min, l2: LIMITS.length.max, w1: LIMITS.width.min, w2: LIMITS.width.max, h1: LIMITS.height.min, h2: LIMITS.height.max, d1: LIMITS.docks.min, d2: LIMITS.docks.max })}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2 border-t-[1.5px] border-dock-ink px-6 py-4">
          <SaveButton label={existing ? t("ws.save") : t("ws.create")} disabled={!live} />
          {existing && !existing.hasHistory && (
            <button formAction={deleteWarehouse} className="cond flex items-center gap-1.5 border-[1.5px] border-dock-ink px-3 py-2 text-sm hover:bg-dock-red hover:text-white">
              <Trash2 size={14} /> {t("ws.delete")}
            </button>
          )}
        </div>
      </form>

      <div className="relative">
        <div ref={mount} className="absolute inset-0" />
        <p className="cond pointer-events-none absolute left-5 top-5 bg-dock-ink px-2 py-1 text-[11px] text-dock-yellow">{t("ws.preview")}</p>
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
  const { t } = useT();
  const { pending } = useFormStatus();
  return (
    <button disabled={disabled || pending} className="cond flex-1 bg-dock-ink px-4 py-2 text-sm font-semibold text-dock-yellow disabled:opacity-50">
      {pending ? t("ws.saving") : label}
    </button>
  );
}
