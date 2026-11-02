"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Printer, Route } from "lucide-react";
import { pick } from "@/app/operator/actions";
import { ScanField, type ScanResult } from "@/components/operator/scan-field";
import { parseSlotScan, sameCode } from "@/lib/pallets/scan";
import { useT } from "@/lib/i18n/client";

type Content = { sku: string; lot: string | null; units: number; word: string };
type Step = {
  key: string;
  kind: "pallet" | "boxes";
  /** Row to send to the server (the first row of a whole pallet). */
  stockId: string;
  location: string;
  level: number | null;
  code: string | null;
  mixed: boolean;
  /** Boxes to take (boxes steps). */
  take: number | null;
  /** Boxes on the row they come from (boxes steps). */
  rowUnits: number;
  contents: Content[];
};

/** Walk the route: one big location at a time, the same order the office sees lit up in 3D. A step is one physical pallet. */
export function PickStep({ outboundId, warehouse, lane, done, total, shortText, metres, steps }: { outboundId: string; warehouse: string; lane: number; done: number; total: number; shortText: string | null; metres: number; steps: Step[] }) {
  const { t } = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState<{ code: string; finished: boolean; base: number } | null>(null);
  const current = steps[0];

  const leaves = current?.kind === "boxes" && current.take !== null ? current.rowUnits - current.take : 0;
  const what = current?.contents[0];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="h-2.5 flex-1 border-[1.5px] border-dock-ink bg-white" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total} aria-label={t("pk.progress")}>
          <div className="h-full bg-dock-ink" style={{ width: `${(done / Math.max(1, total)) * 100}%` }} />
        </div>
        <span className="mono text-sm font-semibold">{label ? `${Math.max(done, label.base + 1)}/${total}` : !current ? `${done}/${total}` : t("pk.step", { a: done + 1, b: total })}</span>
      </div>
      {shortText && <p className="bg-dock-red/10 px-3 py-2 text-sm text-dock-red">{t("pk.missing", { text: shortText })}</p>}

      {label ? (
        <>
          <div className="dock-card overflow-hidden bg-white">
            <div className="bg-dock-yellow px-4 py-5 text-center">
              <p className="cond flex items-center justify-center gap-1.5 text-xs font-semibold">
                <Printer size={13} aria-hidden /> {t("pk.labelNew")}
              </p>
              <p className="mono text-3xl font-bold tracking-wide">{label.code}</p>
              <p className="mt-1 text-sm">{t("pk.goesTo", { n: lane })}</p>
            </div>
          </div>
          <button
            onClick={() => {
              setLabel(null);
              router.refresh();
            }}
            className="cond flex min-h-16 w-full items-center justify-center gap-3 bg-dock-ink px-4 py-4 text-xl font-bold text-dock-yellow"
          >
            {label.finished ? t("pk.finish") : t("pk.labelledNext")}
          </button>
        </>
      ) : (
        current && (
          <>
            <div className="dock-card overflow-hidden bg-white">
              <div className="bg-dock-ink px-4 py-5 text-center">
                <p className="cond text-[11px] text-white/50">{t("pk.goTo")}</p>
                <p className="cond text-6xl font-bold tracking-wide text-dock-yellow">{current.location}</p>
                {current.level && <p className="cond text-sm text-white/60">{t("pk.level", { n: current.level })}</p>}
              </div>
              {current.kind === "pallet" ? (
                <div className="border-t-[1.5px] border-dock-ink px-4 py-3 text-center">
                  <p className="text-sm font-medium">{current.code ? <>{t("pk.takePallet")} <span className="mono font-bold">{current.code}</span></> : t("pk.takeWhole")} {current.mixed && <span className="cond bg-dock-ink px-1.5 py-0.5 text-[10px] text-dock-yellow">{t("rcs.mixed")}</span>}</p>
                  <ul className="mono mt-1 space-y-0.5 text-sm">
                    {current.contents.map((c, i) => (
                      <li key={i} className="font-semibold">
                        {c.sku} {c.lot && <span className="font-normal text-dock-ink/50">{t("pk.lot", { lot: c.lot })}</span>} <span className="font-normal text-dock-ink/60">· {c.units} {c.word}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="border-t-[1.5px] border-dock-ink bg-dock-yellow px-4 py-3 text-center">
                  <p className="cond text-xs font-semibold">{t("pk.takeOnly")}</p>
                  <p className="cond text-5xl font-bold leading-none">
                    {what?.units} <span className="text-3xl">{what?.word}</span>
                  </p>
                  <p className="mono mt-1 text-base font-bold">
                    {t("pk.of")} {what?.sku} {what?.lot && <span className="font-normal">{t("pk.lot", { lot: what.lot })}</span>}
                  </p>
                  <p className="mt-1 text-sm font-medium">
                    {current.code ? <span>{t(current.mixed ? "pk.fromMixed" : "pk.fromPallet", { code: "" }).trimEnd()} <span className="mono font-bold">{current.code}</span></span> : t("pk.fromThis")}
                    {" · "}
                    {leaves > 0 ? t("pk.leaves", { n: leaves }) : t("pk.restStays")}
                  </p>
                  <p className="mt-1 text-sm font-semibold">{t("pk.newPallet")}</p>
                </div>
              )}
              <p className="mono px-4 py-2 text-center text-xs text-dock-ink/55">{t("pk.thenExp", { n: lane })}</p>
            </div>
            <ScanPick
              key={current.key}
              step={current}
              warehouse={warehouse}
              pending={pending}
              what={what}
              onConfirm={(scanned) =>
                start(async () => {
                  setError(null);
                  try {
                    const result = await pick(outboundId, current.stockId, current.take ?? undefined, scanned);
                    if (result.error) return setError(result.error);
                    if (result.newCode) setLabel({ code: result.newCode, finished: !!result.done, base: done });
                    else router.refresh();
                  } catch {
                    setError(t("pk.couldNot"));
                  }
                })
              }
            />
            {error && <p role="alert" className="text-sm text-dock-red">{error}</p>}
          </>
        )
      )}

      {!label && steps.length > 1 && (
        <div className="dock-console px-4 py-3 text-[12.5px]">
          <p className="cond mb-1.5 flex items-center gap-1.5 text-[11px] text-white/50">
            <Route size={12} /> {t("pk.route", { m: metres })}
          </p>
          <ol className="mono space-y-0.5">
            {steps.map((s, i) => (
              <li key={s.key} className={i === 0 ? "text-dock-yellow" : "text-white/70"}>
                {String(done + i + 1).padStart(2, " ")} {s.location}{" "}
                <span className="text-white/40">
                  {s.kind === "boxes" ? `${s.take} ${s.contents[0].sku}` : s.code ?? s.contents[0].sku}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/**
 * A pallet with an ID: scan the pallet only (its ID already says which slot it is in). A pallet with no ID: scan the slot, then confirm.
 * Boxes steps then confirm the number. A label that will not scan: "confirm by hand".
 */
function ScanPick({ step, warehouse, pending, what, onConfirm }: { step: Step; warehouse: string; pending: boolean; what: Content | undefined; onConfirm: (scanned: string | null) => void }) {
  const { t } = useT();
  const needsPallet = !!step.code;
  const [slotOk, setSlotOk] = useState(needsPallet);
  const [scanned, setScanned] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const atConfirm = slotOk && (!needsPallet || scanned !== null);

  const onScan = (code: string): ScanResult => {
    if (needsPallet && sameCode(code, step.code)) {
      setScanned(code);
      // a whole pallet: scanning it is the confirmation; boxes: the person confirms the number next
      if (step.kind === "pallet") onConfirm(code);
      return { ok: true, message: t("pk.palletOk", { code }) };
    }
    const asSlot = parseSlotScan(code, warehouse);
    if (asSlot && needsPallet) return { ok: false, message: t("pk.slotNotPallet", { code: step.code ?? "" }) };
    if (asSlot) {
      if (asSlot.warehouse && asSlot.warehouse !== warehouse) return { ok: false, message: t("pk.slotOther", { other: asSlot.warehouse, mine: warehouse }) };
      if (asSlot.slot !== step.location) return { ok: false, message: t("pk.slotWrong", { got: asSlot.slot, slot: step.location }) };
      setSlotOk(true);
      return { ok: true, message: t("pk.noIdScan") };
    }
    if (!needsPallet) return { ok: false, message: t("pk.noIdScan") };
    return { ok: false, message: t("pk.palletWrong", { got: code.slice(0, 30), code: step.code ?? "" }) };
  };

  const label = !slotOk ? t("pk.scanSlot") : needsPallet && scanned === null ? t("pk.scanPalletCode", { code: step.code ?? "" }) : t("pk.palletOk", { code: step.code ?? "" });
  const confirmLabel = pending
    ? "…"
    : step.kind === "boxes"
      ? t("pk.pickedBoxes", { n: step.take ?? 0, word: what?.word ?? "" })
      : step.code
        ? t("pk.pickedCode", { code: step.code })
        : t("pk.pickedPallet");

  return (
    <div className="space-y-3">
      {!manual && <ScanField label={label} onScan={onScan} disabled={pending} />}
      {!manual && !slotOk && <p className="cond text-center text-sm font-semibold">{t("pk.scanSlot")}: {step.location}</p>}
      {!manual && needsPallet && scanned === null && (
        <p className="cond text-center text-sm font-semibold">
          {step.location} · {t("pk.scanPalletCode", { code: step.code ?? "" })}
        </p>
      )}
      {(manual || (atConfirm && (step.kind === "boxes" || !needsPallet)) || (slotOk && !needsPallet)) && (
        <button
          disabled={pending}
          onClick={() => onConfirm(manual ? null : scanned)}
          className="cond flex min-h-16 w-full items-center justify-center gap-3 bg-dock-yellow px-4 py-4 text-xl font-bold ring-[1.5px] ring-dock-ink active:brightness-90 disabled:opacity-60"
        >
          <Check size={24} aria-hidden /> {confirmLabel}
        </button>
      )}
      {!manual && (
        <button type="button" onClick={() => setManual(true)} className="w-full text-center text-xs text-dock-ink/50 underline">
          {t("pk.manual")}
        </button>
      )}
    </div>
  );
}
