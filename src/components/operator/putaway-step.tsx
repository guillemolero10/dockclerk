"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { ArrowDown, Bot } from "lucide-react";
import { checkSlotFor, putAwayAll, putAwayPallet } from "@/app/operator/actions";
import { ScanField, type ScanHandle, type ScanResult } from "@/components/operator/scan-field";
import { parseSlotScan, sameCode } from "@/lib/pallets/scan";
import { useT } from "@/lib/i18n/client";

/** One pallet at a time: from the receiving lane to the slot the clerk suggests (or another one). */
export function PutAwayStep({
  warehouse,
  left,
  pallet,
  suggestion,
  why,
  waitingCodes,
}: {
  warehouse: string;
  left: number;
  pallet: { id: string; from: string; code: string | null; client: string; contents: { sku: string; lot: string | null; units: number }[] };
  suggestion: string | null;
  why: string;
  /** IDs of every pallet waiting in the receiving lanes of this building (scanning another one switches to it). */
  waitingCodes: string[];
}) {
  const { t } = useT();
  const router = useRouter();
  const [slot, setSlot] = useState(suggestion ?? "");
  const [editing, setEditing] = useState(!suggestion);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Scan the pallet, leave it in the slot and tap the button (racks have no labels to scan). A slot label scanned anyway still works;
  // a free slot that is not the suggested one asks "leave it here?".
  const [stage, setStage] = useState<"pallet" | "slot">(pallet.code ? "pallet" : "slot");
  const [leaveIn, setLeaveIn] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const scanner = useRef<ScanHandle>(null);

  const run = (job: () => Promise<unknown>) =>
    start(async () => {
      setError(null);
      try {
        const result = (await job()) as { error?: string } | undefined;
        if (result?.error) return setError(result.error);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("pa.couldNot"));
      }
    });

  // A typed slot may be copied from a printed label ("N1-C-07-3"): read it like a scan.
  const placeTyped = () => {
    const typed = parseSlotScan(slot, warehouse);
    if (typed?.warehouse && typed.warehouse !== warehouse) return setError(t("pa.slotOther", { other: typed.warehouse, mine: warehouse }));
    run(() => putAwayPallet(pallet.id, typed?.slot ?? slot));
  };

  const onScan = async (code: string): Promise<ScanResult> => {
    setLeaveIn(null);
    setError(null);
    const asSlot = parseSlotScan(code, warehouse);
    if (!asSlot) {
      // a pallet ID: this one, or another that is waiting (then we switch to it)
      if (sameCode(code, pallet.code)) {
        setStage("slot");
        return { ok: true, message: suggestion ? t("pa.palletOk", { code, slot: suggestion }) : t("pa.palletOkNoSlot", { code }) };
      }
      if (waitingCodes.some((c) => sameCode(c, code))) {
        router.replace(`/operator/putaway?w=${warehouse}&code=${encodeURIComponent(code)}`);
        return { ok: true, message: code };
      }
      return { ok: false, message: t("pa.notWaiting", { code }) };
    }
    if (stage === "pallet") return { ok: false, message: t("pa.scanPalletFirst") };
    if (asSlot.warehouse && asSlot.warehouse !== warehouse) return { ok: false, message: t("pa.slotOther", { other: asSlot.warehouse, mine: warehouse }) };
    if (asSlot.slot === suggestion) {
      const result = await putAwayPallet(pallet.id, asSlot.slot);
      if (result.error) return { ok: false, message: result.error };
      router.refresh();
      return { ok: true, message: t("pa.placed", { slot: asSlot.slot }) };
    }
    const check = await checkSlotFor(pallet.id, asSlot.slot);
    if (check.error) return { ok: false, message: check.error };
    setLeaveIn(asSlot.slot);
    return { ok: true, message: t("pa.leaveHere", { slot: asSlot.slot }) };
  };

  return (
    <div className="space-y-4">
      <p className="mono text-xs text-dock-ink/50">{t("pa.waiting_p", { n: left })}</p>
      <div className="dock-card overflow-hidden bg-white">
        <div className="px-4 py-3">
          <p className="cond text-[11px] text-dock-ink/50">{t("pa.from", { lane: pallet.from.replace("-", " ") })}</p>
          <p className="mono flex items-center gap-2 text-lg font-bold">
            {pallet.code ?? t("pa.noId")}
            {pallet.contents.length > 1 && <span className="cond bg-dock-ink px-1.5 py-0.5 text-[10px] font-normal text-dock-yellow">{t("rcs.mixed")}</span>}
          </p>
          <ul className="mono mt-0.5 space-y-0.5 text-sm">
            {pallet.contents.map((c, i) => (
              <li key={i} className="font-semibold">
                {c.sku} {c.lot && <span className="font-normal text-dock-ink/50">· {c.lot}</span>} <span className="font-normal text-dock-ink/60">· {t("rcs.boxes_p", { n: c.units })}</span>
              </li>
            ))}
          </ul>
          <p className="truncate text-xs text-dock-ink/55">{pallet.client}</p>
        </div>
        <div className="flex justify-center bg-dock-concrete-2 py-1 text-dock-ink/40">
          <ArrowDown size={18} />
        </div>
        <div className="bg-dock-ink px-4 py-5 text-center">
          <p className="cond flex items-center justify-center gap-1 text-[11px] text-white/50">
            {suggestion && !editing ? (
              <>
                <Bot size={12} /> {t("pa.suggested", { why })}
              </>
            ) : (
              t("pa.slot")
            )}
          </p>
          {editing ? (
            <input
              value={slot}
              autoFocus={!!suggestion}
              onChange={(e) => setSlot(e.target.value.toUpperCase())}
              placeholder="C-07-3"
              aria-label={t("pa.slot")}
              className="mono mx-auto mt-1 block w-40 bg-white px-2 py-1 text-center text-3xl font-bold text-dock-ink"
            />
          ) : (
            <p className="cond mt-1 text-6xl font-bold tracking-wide text-dock-yellow">{slot}</p>
          )}
        </div>
      </div>

      <ScanField
        handle={scanner}
        label={stage === "pallet" ? t("pa.scanPallet") : t("pa.scanSlot")}
        onScan={onScan}
        disabled={pending}
      />
      {leaveIn && (
        <div role="group" aria-label={t("pa.leaveHere", { slot: leaveIn })} className="space-y-2 border-[1.5px] border-dock-ink bg-white p-3">
          <p className="font-semibold">{t("pa.leaveHere", { slot: leaveIn })}</p>
          {suggestion && <p className="text-xs text-dock-ink/60">{t("pa.leaveHint", { sug: suggestion })}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button disabled={pending} onClick={() => run(() => putAwayPallet(pallet.id, leaveIn))} className="cond min-h-14 bg-dock-yellow px-3 text-base font-semibold ring-[1.5px] ring-dock-ink disabled:opacity-50">
              {t("pa.yesLeave")}
            </button>
            <button disabled={pending} onClick={() => setLeaveIn(null)} className="cond min-h-14 border-[1.5px] border-dock-ink bg-white px-3 text-base">
              {t("pa.no")}
            </button>
          </div>
        </div>
      )}
      {!pallet.code && <p className="text-xs text-dock-ink/60">{t("pa.noIdPallet")}</p>}

      {leaveIn ? null : manual || stage === "slot" ? (
        <div className="space-y-3 border-t border-dock-line pt-3">
          <button disabled={pending || !slot} onClick={placeTyped} className="cond min-h-16 w-full bg-dock-yellow px-4 py-4 text-xl font-bold ring-[1.5px] ring-dock-ink disabled:opacity-50">
            {pending ? "…" : t("pa.placed", { slot: slot || "…" })}
          </button>
          {!editing && (
            <button onClick={() => setEditing(true)} className="w-full text-center text-xs text-dock-ink/50 underline">
              {t("pa.elsewhere")}
            </button>
          )}
        </div>
      ) : (
        <button onClick={() => setManual(true)} className="w-full text-center text-xs text-dock-ink/50 underline">
          {t("scan.manual")}
        </button>
      )}
      {error && <p className="text-sm text-dock-red">{error}</p>}

      {left > 1 && (
        <button disabled={pending} onClick={() => run(() => putAwayAll(warehouse))} className="cond w-full border-[1.5px] border-dock-ink bg-white px-4 py-3 text-sm">
          {t("pa.putAll", { n: left })}
        </button>
      )}
    </div>
  );
}
