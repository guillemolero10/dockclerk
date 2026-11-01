"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronDown, ChevronUp, Minus, Plus, Trash2, Truck, X } from "lucide-react";
import { loadPhoto, notePallets, notePhoto, receive, truckHere } from "@/app/operator/actions";
import { checkBreakdown, expandPallets, MAX_LINES, MAX_PALLETS, type PalletDraft } from "@/lib/pallets/breakdown";
import { PhotoButton } from "@/components/media/photo-button";
import { ScanField, type ScanResult } from "@/components/operator/scan-field";
import { parseCode } from "@/lib/pallets/codes";
import { sameCode } from "@/lib/pallets/scan";
import { LOCALE } from "@/lib/i18n/core";
import { useT } from "@/lib/i18n/client";

export function TruckHereButton({ inboundId }: { inboundId: string }) {
  const { t } = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() =>
        start(async () => {
          await truckHere(inboundId);
          router.refresh();
        })
      }
      className="cond flex w-full items-center justify-center gap-2 bg-dock-yellow px-4 py-4 text-base font-semibold ring-[1.5px] ring-dock-ink"
    >
      <Truck size={18} /> {pending ? "…" : t("rcs.truckHere")}
    </button>
  );
}

export function NoteStepOperator({ inboundId, aiReady, items }: { inboundId: string; aiReady: boolean; items: { sku: string; description: string }[] }) {
  const { t } = useT();
  const router = useRouter();
  const [typing, setTyping] = useState(!aiReady);
  const [pallets, setPallets] = useState("");
  const [sku, setSku] = useState(items[0]?.sku ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <PhotoButton
        label={t("rcs.notePhoto")}
        busyLabel={t("rcs.reading")}
        onPhoto={async (photo) => {
          const result = await notePhoto(inboundId, photo);
          if (!result.read) setTyping(true);
          router.refresh();
        }}
      />
      {!aiReady && <p className="text-xs text-dock-ink/50">{t("rcs.noKeyRead")}</p>}
      {typing && (
        <form
          className="grid grid-cols-[1fr_88px_auto] gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(pallets);
            if (!Number.isInteger(n) || n < 1 || n > 66) return setError(t("rcs.typeCount"));
            start(async () => {
              try {
                const result = await notePallets(inboundId, n, sku || null);
                setError(result.error ?? null);
                if (!result.error) router.refresh();
              } catch {
                setError(t("rcs.couldNotSave"));
              }
            });
          }}
        >
          <select value={sku} onChange={(e) => setSku(e.target.value)} aria-label={t("rcs.item")} className="dock-input text-sm">
            {items.map((i) => (
              <option key={i.sku} value={i.sku}>
                {i.sku}
              </option>
            ))}
          </select>
          <input inputMode="numeric" value={pallets} onChange={(e) => setPallets(e.target.value.replace(/\D/g, ""))} placeholder={t("rcs.palletsPh")} aria-label={t("rcs.palletsPh")} className="dock-input mono" />
          <button disabled={pending || !pallets} className="cond bg-dock-ink px-3 text-sm text-dock-yellow disabled:opacity-50">
            {t("rcs.ok")}
          </button>
        </form>
      )}
      {error && <p className="text-sm text-dock-red">{error}</p>}
    </div>
  );
}

export function LoadStep({ inboundId, aiReady, counter, again }: { inboundId: string; aiReady: boolean; counter: string; again: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="space-y-1.5">
      <PhotoButton
        label={again ? t("rcs.again") : t("rcs.loadPhoto")}
        busyLabel={t("rcs.counting", { who: counter })}
        className={again ? "border-[1.5px] border-dock-ink bg-white text-dock-ink" : ""}
        onPhoto={async (photo) => {
          const result = await loadPhoto(inboundId, photo);
          setNote(result ? null : aiReady ? t("rcs.noCountAi") : t("rcs.noCount"));
          router.refresh();
        }}
      />
      {!aiReady && !note && <p className="text-xs text-dock-ink/50">{t("rcs.noKeyCount")}</p>}
      {note && <p className="text-xs text-dock-ink/60">{note}</p>}
    </div>
  );
}

type ItemInfo = { id: string; sku: string; description: string; unitsPerPallet: number; tracksLot: boolean };
type LineState = { itemId: string; lot: string; expiresAt: string; units: string };
type PalletState = { key: number; code: string; lines: LineState[] };

const toState = (d: PalletDraft, key: number): PalletState => ({
  key,
  code: d.code ?? "",
  lines: d.lines.map((l) => ({ itemId: l.itemId, lot: l.lot ?? "", expiresAt: l.expiresAt ?? "", units: String(l.units) })),
});
const toDraft = (p: PalletState): PalletDraft => ({
  code: p.code.trim() || null,
  lines: p.lines.map((l) => ({ itemId: l.itemId, lot: l.lot.trim() || null, expiresAt: l.expiresAt || null, units: l.units.trim() === "" ? NaN : Number(l.units) })),
});

/** What came off the truck, pallet by pallet: each pallet has its own ID (scanned, typed or given by the warehouse) and its own boxes. */
export function ReceiveForm({
  inboundId,
  items,
  start,
  expected,
  damagedFound,
  warehouse,
  liveCodes,
}: {
  inboundId: string;
  items: ItemInfo[];
  start: PalletDraft[];
  expected: number | null;
  damagedFound: number;
  warehouse: string;
  /** IDs of the pallets already inside the warehouse (a scan of one of them is red at once). */
  liveCodes: string[];
}) {
  const { t, lang } = useT();
  const router = useRouter();
  const [pallets, setPallets] = useState<PalletState[]>(() => start.map((d, i) => toState(d, i)));
  const [openKey, setOpenKey] = useState<number | null>(null);
  const focusKey = useRef<number | null>(null); // the pallet whose ID field gets the cursor once it is open (scanner: Enter moves on)
  const [damaged, setDamaged] = useState(damagedFound);
  const [incident, setIncident] = useState("");
  const [pending, begin] = useTransition();
  const [errors, setErrors] = useState<string[]>([]);
  const [scanned, setScanned] = useState<string[]>([]);
  // The reader can send two codes before React draws again: the scan logic works on these, and the state follows.
  const palletsRef = useRef(pallets);
  const scannedRef = useRef(scanned);
  useEffect(() => {
    palletsRef.current = pallets;
    scannedRef.current = scanned;
  }, [pallets, scanned]);

  // quick add: "38 pallets of AGUA-15"
  const [qItem, setQItem] = useState(items[0]?.id ?? "");
  const [qCount, setQCount] = useState("1");
  const [qUnits, setQUnits] = useState("");
  const [qLot, setQLot] = useState("");
  const [qDate, setQDate] = useState("");
  const qInfo = items.find((i) => i.id === qItem);

  useEffect(() => {
    if (focusKey.current === null || focusKey.current !== openKey) return;
    document.getElementById(`pid-${focusKey.current}`)?.focus();
    focusKey.current = null;
  }, [openKey]);

  const lineCount = pallets.reduce((n, p) => n + p.lines.length, 0);
  const mixed = pallets.filter((p) => p.lines.length > 1).length;
  const boxes = pallets.reduce((n, p) => n + p.lines.reduce((m, l) => m + (Number(l.units) || 0), 0), 0);
  const setPallet = (key: number, fn: (p: PalletState) => PalletState) => setPallets((ps) => ps.map((p) => (p.key === key ? fn(p) : p)));
  const setLine = (key: number, li: number, patch: Partial<LineState>) => setPallet(key, (p) => ({ ...p, lines: p.lines.map((l, j) => (j === li ? { ...l, ...patch } : l)) }));
  const itemOf = (id: string) => items.find((i) => i.id === id);

  const add = () => {
    const room = MAX_PALLETS - pallets.length;
    const n = Math.min(Math.max(1, Number(qCount) || 0), room);
    if (!qInfo || room < 1) return setErrors([t("rcs.maxPallets", { max: MAX_PALLETS })]);
    const per = qUnits.trim() === "" ? qInfo.unitsPerPallet : Number(qUnits);
    const made = expandPallets({ itemId: qInfo.id, lot: qLot.trim() || null, expiresAt: qDate || null, units: per }, n);
    setPallets((ps) => {
      let k = ps.reduce((m, p) => Math.max(m, p.key), -1) + 1;
      return [...ps, ...made.map((d) => toState(d, k++))];
    });
    setErrors([]);
  };

  /** One scan = one pallet. Its ID goes on the pallet the note announced (same ID, or the next without one) or on a new pallet like the last one. */
  const onScan = (raw: string): ScanResult => {
    const parsed = parseCode(raw, t);
    if (!parsed.ok) return { ok: false, message: parsed.error };
    const code = parsed.code;
    if (!code) return;
    if (scannedRef.current.includes(code)) return { ok: false, message: t("rcs.scanDup", { code }) };
    if (liveCodes.includes(code)) return { ok: false, message: t("rcs.scanInside", { code }) };
    const list = palletsRef.current;
    const mark = () => {
      scannedRef.current = [...scannedRef.current, code];
      setScanned(scannedRef.current);
    };
    const save = (next: PalletState[]) => {
      palletsRef.current = next;
      setPallets(next);
      setErrors([]);
    };
    const matched = list.findIndex((p) => sameCode(p.code, code));
    if (matched >= 0) {
      mark();
      return { ok: true, message: t("rcs.scanMatched", { code, n: matched + 1 }) };
    }
    const blank = list.findIndex((p) => !p.code.trim());
    if (blank >= 0) {
      mark();
      save(list.map((p, i) => (i === blank ? { ...p, code } : p)));
      return { ok: true, message: t("rcs.scanFilled", { code, n: blank + 1 }) };
    }
    if (list.length >= MAX_PALLETS) return { ok: false, message: t("rcs.scanFull", { max: MAX_PALLETS }) };
    const last = list[list.length - 1]?.lines[0];
    const first = start[0]?.lines[0];
    const line: LineState = last
      ? { itemId: last.itemId, lot: last.lot, expiresAt: last.expiresAt, units: last.units }
      : first
        ? { itemId: first.itemId, lot: first.lot ?? "", expiresAt: first.expiresAt ?? "", units: String(first.units) }
        : { itemId: items[0]?.id ?? "", lot: "", expiresAt: "", units: String(items[0]?.unitsPerPallet ?? "") };
    if (!line.itemId) return { ok: false, message: t("rcs.scanNoItems") };
    const key = list.reduce((m, p) => Math.max(m, p.key), -1) + 1;
    mark();
    save([...list, { key, code, lines: [line] }]);
    const sku = items.find((i) => i.id === line.itemId)?.sku ?? "?";
    return { ok: true, message: t("rcs.scanAdded", { code, n: list.length + 1, sku }) };
  };

  const confirm = () => {
    const drafts = pallets.map(toDraft);
    const { errors: found } = checkBreakdown(drafts, items, new Map(liveCodes.map((c) => [c, ""])), t);
    if (found.length) return setErrors(found.slice(0, 3));
    setErrors([]);
    begin(async () => {
      try {
        const result = await receive(inboundId, drafts, damaged, incident);
        if (result.error) setErrors([result.error]);
        else router.refresh();
      } catch (err) {
        setErrors([err instanceof Error ? err.message : t("rcs.couldNotSaveShort")]);
      }
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-dock-ink/60">{t("rcs.intro")}</p>
      <section aria-label={t("rcs.scanLabel")} className="space-y-1">
        <ScanField label={t("rcs.scanLabel")} onScan={onScan} disabled={pending} />
        <p className="mono text-sm font-semibold" aria-live="polite">
          {expected !== null ? t("rcs.scanCount", { a: scanned.length, b: expected }) : t("rcs.scanCountOnly", { a: scanned.length })}
        </p>
      </section>

      {pallets.length === 0 ? (
        <p className="border-[1.5px] border-dashed border-dock-line px-3 py-6 text-center text-sm text-dock-ink/55">{t("rcs.empty")}</p>
      ) : (
        <ol className="space-y-1.5">
          {pallets.map((p, idx) => {
            const open = openKey === p.key;
            const isMixed = p.lines.length > 1;
            const summary = p.lines.map((l) => `${itemOf(l.itemId)?.sku ?? "?"}${l.lot ? ` ${l.lot}` : ""}`).join(" + ");
            const total = p.lines.reduce((n, l) => n + (Number(l.units) || 0), 0);
            return (
              <li key={p.key} className={`border-[1.5px] ${open ? "border-dock-ink bg-white" : "border-dock-line bg-white"}`}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenKey(open ? null : p.key)}
                  className="flex min-h-12 w-full items-center gap-2 px-2.5 py-1.5 text-left"
                >
                  <span className="mono w-7 shrink-0 text-xs text-dock-ink/50">#{idx + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="mono block truncate text-sm font-semibold">{p.code.trim() ? p.code.trim().toUpperCase() : <span className="font-normal text-dock-ink/40">{t("rcs.idOnSave")}</span>}</span>
                    <span className="mono block truncate text-[11px] text-dock-ink/60">{summary} · {t("rcs.boxes_p", { n: total })}</span>
                  </span>
                  {isMixed && <span className="cond shrink-0 bg-dock-ink px-1.5 py-0.5 text-[10px] text-dock-yellow">{t("rcs.mixed")}</span>}
                  {open ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
                </button>
                {open && (
                  <div className="space-y-2 border-t border-dock-line px-2.5 pb-2.5 pt-2">
                    <label className="block text-[11px] text-dock-ink/55">
                      {t("rcs.palletId")}
                      <input
                        id={`pid-${p.key}`}
                        value={p.code}
                        onChange={(e) => setPallet(p.key, (q) => ({ ...q, code: e.target.value.toUpperCase() }))}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          e.preventDefault(); // the scanner ends the code with Enter: on to the next pallet
                          const next = pallets[idx + 1];
                          if (next) { focusKey.current = next.key; setOpenKey(next.key); }
                        }}
                        autoComplete="off"
                        autoCapitalize="characters"
                        placeholder={t("rcs.idPh", { wh: warehouse })}
                        className="dock-input mono mt-0.5 text-sm"
                      />
                    </label>
                    {p.lines.map((l, li) => {
                      const item = itemOf(l.itemId);
                      return (
                        <div key={li} className="space-y-1.5 border border-dock-line p-2">
                          <div className="flex gap-1.5">
                            <select value={l.itemId} onChange={(e) => setLine(p.key, li, { itemId: e.target.value })} aria-label={t("rcs.palletItem", { n: idx + 1 })} className="dock-input min-w-0 flex-1 text-sm">
                              {items.map((x) => (
                                <option key={x.id} value={x.id}>{x.sku} · {x.description}</option>
                              ))}
                            </select>
                            {p.lines.length > 1 && (
                              <button type="button" onClick={() => setPallet(p.key, (q) => ({ ...q, lines: q.lines.filter((_, j) => j !== li) }))} aria-label={t("rcs.removeItem", { sku: item?.sku ?? "?", n: idx + 1 })} className="grid h-12 w-12 shrink-0 place-items-center border-[1.5px] border-dock-line">
                                <X size={16} aria-hidden />
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button type="button" onClick={() => setLine(p.key, li, { units: String(Math.max(0, (Number(l.units) || 0) - 1)) })} aria-label={t("rcs.boxLess", { sku: item?.sku ?? "?", n: idx + 1 })} className="grid h-12 w-12 shrink-0 place-items-center border-[1.5px] border-dock-ink bg-white">
                              <Minus size={16} aria-hidden />
                            </button>
                            <input inputMode="numeric" value={l.units} onChange={(e) => setLine(p.key, li, { units: e.target.value.replace(/\D/g, "") })} aria-label={t("rcs.boxesOf", { sku: item?.sku ?? "?", n: idx + 1 })} className="dock-input mono h-12 min-w-0 flex-1 text-center text-lg font-semibold" />
                            <button type="button" onClick={() => setLine(p.key, li, { units: String((Number(l.units) || 0) + 1) })} aria-label={t("rcs.boxMore", { sku: item?.sku ?? "?", n: idx + 1 })} className="grid h-12 w-12 shrink-0 place-items-center border-[1.5px] border-dock-ink bg-dock-yellow">
                              <Plus size={16} aria-hidden />
                            </button>
                          </div>
                          {item && <p className="mono text-[11px] text-dock-ink/45">{t("rcs.fullPallet", { n: item.unitsPerPallet })}</p>}
                          {item?.tracksLot && (
                            <div className="grid grid-cols-2 gap-1.5">
                              <input value={l.lot} onChange={(e) => setLine(p.key, li, { lot: e.target.value })} placeholder={t("rcs.lot")} aria-label={t("rcs.lotPallet", { n: idx + 1 })} className="dock-input mono min-w-0 text-sm" />
                              <input type="date" value={l.expiresAt} onChange={(e) => setLine(p.key, li, { expiresAt: e.target.value })} aria-label={t("rcs.bbPallet", { n: idx + 1 })} className="dock-input mono min-w-0 text-sm" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <div className="flex gap-2">
                      {p.lines.length < MAX_LINES && (
                        <button
                          type="button"
                          onClick={() => setPallet(p.key, (q) => ({ ...q, lines: [...q.lines, { itemId: items.find((x) => !q.lines.some((l) => l.itemId === x.id))?.id ?? items[0]?.id ?? "", lot: "", expiresAt: "", units: "" }] }))}
                          className="cond min-h-12 flex-1 border-[1.5px] border-dock-ink bg-white px-2 text-sm"
                        >
                          {t("rcs.another")}
                        </button>
                      )}
                      <button type="button" onClick={() => { setPallets((ps) => ps.filter((q) => q.key !== p.key)); setOpenKey(null); }} aria-label={t("rcs.removePallet", { n: idx + 1 })} className="cond flex min-h-12 items-center justify-center gap-1 border-[1.5px] border-dock-red px-3 text-sm text-dock-red">
                        <Trash2 size={14} aria-hidden /> {t("rcs.remove")}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <p className="cond text-[11px] text-dock-ink/60">{t("rcs.typeInstead")}</p>
      <fieldset className="space-y-2 border-[1.5px] border-dock-ink bg-dock-concrete-2 p-2.5">
        <legend className="cond px-1 text-[11px] text-dock-ink/60">{t("rcs.addInOne")}</legend>
        <div className="grid grid-cols-[72px_1fr] gap-2">
          <input inputMode="numeric" value={qCount} onChange={(e) => setQCount(e.target.value.replace(/\D/g, "").slice(0, 2))} aria-label={t("rcs.howMany")} className="dock-input mono text-center text-lg" />
          <select value={qItem} onChange={(e) => { setQItem(e.target.value); setQUnits(""); }} aria-label={t("rcs.item")} className="dock-input min-w-0 text-sm">
            {items.map((x) => (
              <option key={x.id} value={x.id}>{x.sku} · {x.description}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-dock-ink/55">
            {t("rcs.boxesEach")}
            <input inputMode="numeric" value={qUnits} onChange={(e) => setQUnits(e.target.value.replace(/\D/g, ""))} placeholder={String(qInfo?.unitsPerPallet ?? "")} className="dock-input mono mt-0.5 text-sm" />
          </label>
          {qInfo?.tracksLot && (
            <label className="text-[11px] text-dock-ink/55">
              {t("rcs.lot")}
              <input value={qLot} onChange={(e) => setQLot(e.target.value)} className="dock-input mono mt-0.5 text-sm" />
            </label>
          )}
          {qInfo?.tracksLot && (
            <label className="col-span-2 text-[11px] text-dock-ink/55">
              {t("rcs.bestBefore")}
              <input type="date" value={qDate} onChange={(e) => setQDate(e.target.value)} className="dock-input mono mt-0.5 text-sm" />
            </label>
          )}
        </div>
        <button type="button" onClick={add} className="cond min-h-12 w-full bg-dock-yellow px-4 text-base font-semibold ring-[1.5px] ring-dock-ink active:brightness-90">
          {t("rcs.add_p", { n: Math.max(1, Number(qCount) || 1) })}
        </button>
      </fieldset>

      <div className="flex items-center justify-between border-t border-dock-line pt-3 text-sm">
        <span>{t("rcs.damagedBoxes")}</span>
        <span className="flex items-center">
          <button type="button" onClick={() => setDamaged((d) => Math.max(0, d - 1))} aria-label={t("rcs.damagedLess")} className="grid h-12 w-12 place-items-center border-[1.5px] border-dock-ink bg-white">
            <Minus size={14} aria-hidden />
          </button>
          <span className={`mono w-10 text-center text-lg font-semibold ${damaged ? "text-dock-red" : ""}`}>{damaged}</span>
          <button type="button" onClick={() => setDamaged((d) => d + 1)} aria-label={t("rcs.damagedMore")} className="grid h-12 w-12 place-items-center border-[1.5px] border-dock-ink bg-white">
            <Plus size={14} aria-hidden />
          </button>
        </span>
      </div>
      <input value={incident} onChange={(e) => setIncident(e.target.value)} placeholder={t("rcs.anything")} aria-label={t("rcs.anythingAria")} className="dock-input text-sm" />

      <div className="sticky bottom-0 -mx-4 space-y-2 border-t-[1.5px] border-dock-ink bg-white px-4 pb-3 pt-2">
        <p className="mono text-xs" aria-live="polite">
          {t("rcs.lines_p", { n: lineCount })} · {t("op.pallets_p", { n: pallets.length })}
          {mixed > 0 && ` · ${t("rcs.mixedN_p", { n: mixed })}`} · {t("rcs.boxes_p", { n: boxes.toLocaleString(LOCALE[lang]) })}
          {expected !== null && (expected === pallets.length ? <span className="text-dock-ink/60"> · {t("rcs.noteSays", { n: expected })} ✓</span> : <span className="font-semibold text-dock-red"> · {t("rcs.noteSays", { n: expected })}</span>)}
        </p>
        {errors.length > 0 && (
          <div role="alert" className="space-y-0.5 bg-dock-red/10 px-3 py-2 text-sm text-dock-red">
            {errors.map((e, i) => (
              <p key={i}>{e}</p>
            ))}
          </div>
        )}
        <button disabled={pending || pallets.length === 0} onClick={confirm} className="cond min-h-14 w-full bg-dock-ink px-4 py-3 text-base font-semibold text-dock-yellow disabled:opacity-50">
          {pending ? t("rcs.saving") : t("rcs.confirm_p", { n: pallets.length })}
        </button>
        <p className="text-center text-[11px] text-dock-ink/45">{t("rcs.footer", { wh: warehouse || t("rcs.theWarehouse") })}</p>
      </div>
    </div>
  );
}
