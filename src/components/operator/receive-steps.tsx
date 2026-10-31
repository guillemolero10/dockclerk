"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronDown, ChevronUp, Minus, Plus, Trash2, Truck, X } from "lucide-react";
import { loadPhoto, notePallets, notePhoto, receive, truckHere } from "@/app/operator/actions";
import { checkBreakdown, expandPallets, MAX_LINES, MAX_PALLETS, type PalletDraft } from "@/lib/pallets/breakdown";
import { PhotoButton } from "@/components/media/photo-button";

export function TruckHereButton({ inboundId }: { inboundId: string }) {
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
      <Truck size={18} /> {pending ? "…" : "The truck is at the dock"}
    </button>
  );
}

export function NoteStepOperator({ inboundId, aiReady, items }: { inboundId: string; aiReady: boolean; items: { sku: string; description: string }[] }) {
  const router = useRouter();
  const [typing, setTyping] = useState(!aiReady);
  const [pallets, setPallets] = useState("");
  const [sku, setSku] = useState(items[0]?.sku ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <PhotoButton
        label="Photo of the delivery note"
        busyLabel="Muse Spark is reading it…"
        onPhoto={async (photo) => {
          const result = await notePhoto(inboundId, photo);
          if (!result.read) setTyping(true);
          router.refresh();
        }}
      />
      {!aiReady && <p className="text-xs text-dock-ink/50">Reading needs an AI key; the photo is kept and you type the pallets.</p>}
      {typing && (
        <form
          className="grid grid-cols-[1fr_88px_auto] gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(pallets);
            if (!Number.isInteger(n) || n < 1 || n > 66) return setError("Type the number of pallets (1 to 66).");
            start(async () => {
              try {
                const result = await notePallets(inboundId, n, sku || null);
                setError(result.error ?? null);
                if (!result.error) router.refresh();
              } catch {
                setError("Could not save it. Try again.");
              }
            });
          }}
        >
          <select value={sku} onChange={(e) => setSku(e.target.value)} aria-label="Item" className="dock-input text-sm">
            {items.map((i) => (
              <option key={i.sku} value={i.sku}>
                {i.sku}
              </option>
            ))}
          </select>
          <input inputMode="numeric" value={pallets} onChange={(e) => setPallets(e.target.value.replace(/\D/g, ""))} placeholder="Pallets" className="dock-input mono" />
          <button disabled={pending || !pallets} className="cond bg-dock-ink px-3 text-sm text-dock-yellow disabled:opacity-50">
            OK
          </button>
        </form>
      )}
      {error && <p className="text-sm text-dock-red">{error}</p>}
    </div>
  );
}

export function LoadStep({ inboundId, aiReady, counter, again }: { inboundId: string; aiReady: boolean; counter: string; again: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="space-y-1.5">
      <PhotoButton
        label={again ? "Take it again" : "Photo of the load"}
        busyLabel={`${counter} is counting…`}
        className={again ? "border-[1.5px] border-dock-ink bg-white text-dock-ink" : ""}
        onPhoto={async (photo) => {
          const result = await loadPhoto(inboundId, photo);
          setNote(result ? null : aiReady ? "Photo kept for the receipt. The count did not come back this time: count below." : "Photo kept for the receipt. Count below.");
          router.refresh();
        }}
      />
      {!aiReady && !note && <p className="text-xs text-dock-ink/50">Counting boxes needs an AI key; the photo still goes on the receipt.</p>}
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
}: {
  inboundId: string;
  items: ItemInfo[];
  start: PalletDraft[];
  expected: number | null;
  damagedFound: number;
  warehouse: string;
}) {
  const router = useRouter();
  const [pallets, setPallets] = useState<PalletState[]>(() => start.map((d, i) => toState(d, i)));
  const [openKey, setOpenKey] = useState<number | null>(null);
  const focusKey = useRef<number | null>(null); // the pallet whose ID field gets the cursor once it is open (scanner: Enter moves on)
  const [damaged, setDamaged] = useState(damagedFound);
  const [incident, setIncident] = useState("");
  const [pending, begin] = useTransition();
  const [errors, setErrors] = useState<string[]>([]);

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
    if (!qInfo || room < 1) return setErrors([`A delivery has at most ${MAX_PALLETS} pallets here.`]);
    const per = qUnits.trim() === "" ? qInfo.unitsPerPallet : Number(qUnits);
    const made = expandPallets({ itemId: qInfo.id, lot: qLot.trim() || null, expiresAt: qDate || null, units: per }, n);
    setPallets((ps) => {
      let k = ps.reduce((m, p) => Math.max(m, p.key), -1) + 1;
      return [...ps, ...made.map((d) => toState(d, k++))];
    });
    setErrors([]);
  };

  const confirm = () => {
    const drafts = pallets.map(toDraft);
    const { errors: found } = checkBreakdown(drafts, items, new Map());
    if (found.length) return setErrors(found.slice(0, 3));
    setErrors([]);
    begin(async () => {
      try {
        const result = await receive(inboundId, drafts, damaged, incident);
        if (result.error) setErrors([result.error]);
        else router.refresh();
      } catch (err) {
        setErrors([err instanceof Error ? err.message : "Could not save it."]);
      }
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-dock-ink/60">Pallet by pallet. Each one gets its ID: scan or type it, or leave it blank and we label it.</p>

      <fieldset className="space-y-2 border-[1.5px] border-dock-ink bg-dock-concrete-2 p-2.5">
        <legend className="cond px-1 text-[11px] text-dock-ink/60">Add pallets in one go</legend>
        <div className="grid grid-cols-[72px_1fr] gap-2">
          <input inputMode="numeric" value={qCount} onChange={(e) => setQCount(e.target.value.replace(/\D/g, "").slice(0, 2))} aria-label="How many pallets" className="dock-input mono text-center text-lg" />
          <select value={qItem} onChange={(e) => { setQItem(e.target.value); setQUnits(""); }} aria-label="Item" className="dock-input min-w-0 text-sm">
            {items.map((x) => (
              <option key={x.id} value={x.id}>{x.sku} · {x.description}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-dock-ink/55">
            Boxes each
            <input inputMode="numeric" value={qUnits} onChange={(e) => setQUnits(e.target.value.replace(/\D/g, ""))} placeholder={String(qInfo?.unitsPerPallet ?? "")} className="dock-input mono mt-0.5 text-sm" />
          </label>
          {qInfo?.tracksLot && (
            <label className="text-[11px] text-dock-ink/55">
              Lot
              <input value={qLot} onChange={(e) => setQLot(e.target.value)} className="dock-input mono mt-0.5 text-sm" />
            </label>
          )}
          {qInfo?.tracksLot && (
            <label className="col-span-2 text-[11px] text-dock-ink/55">
              Best before
              <input type="date" value={qDate} onChange={(e) => setQDate(e.target.value)} className="dock-input mono mt-0.5 text-sm" />
            </label>
          )}
        </div>
        <button type="button" onClick={add} className="cond min-h-12 w-full bg-dock-yellow px-4 text-base font-semibold ring-[1.5px] ring-dock-ink active:brightness-90">
          Add {Math.max(1, Number(qCount) || 1)} {Number(qCount) === 1 || !qCount ? "pallet" : "pallets"}
        </button>
      </fieldset>

      {pallets.length === 0 ? (
        <p className="border-[1.5px] border-dashed border-dock-line px-3 py-6 text-center text-sm text-dock-ink/55">Add the pallets that came off the truck.</p>
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
                    <span className="mono block truncate text-sm font-semibold">{p.code.trim() ? p.code.trim().toUpperCase() : <span className="font-normal text-dock-ink/40">ID on save</span>}</span>
                    <span className="mono block truncate text-[11px] text-dock-ink/60">{summary} · {total} boxes</span>
                  </span>
                  {isMixed && <span className="cond shrink-0 bg-dock-ink px-1.5 py-0.5 text-[10px] text-dock-yellow">MIXED</span>}
                  {open ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
                </button>
                {open && (
                  <div className="space-y-2 border-t border-dock-line px-2.5 pb-2.5 pt-2">
                    <label className="block text-[11px] text-dock-ink/55">
                      Pallet ID
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
                        placeholder={`Scan or type · blank = we label it ${warehouse}-…`}
                        className="dock-input mono mt-0.5 text-sm"
                      />
                    </label>
                    {p.lines.map((l, li) => {
                      const item = itemOf(l.itemId);
                      return (
                        <div key={li} className="space-y-1.5 border border-dock-line p-2">
                          <div className="flex gap-1.5">
                            <select value={l.itemId} onChange={(e) => setLine(p.key, li, { itemId: e.target.value })} aria-label={`Pallet ${idx + 1}, item`} className="dock-input min-w-0 flex-1 text-sm">
                              {items.map((x) => (
                                <option key={x.id} value={x.id}>{x.sku} · {x.description}</option>
                              ))}
                            </select>
                            {p.lines.length > 1 && (
                              <button type="button" onClick={() => setPallet(p.key, (q) => ({ ...q, lines: q.lines.filter((_, j) => j !== li) }))} aria-label={`Remove ${item?.sku ?? "item"} from pallet ${idx + 1}`} className="grid h-12 w-12 shrink-0 place-items-center border-[1.5px] border-dock-line">
                                <X size={16} aria-hidden />
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button type="button" onClick={() => setLine(p.key, li, { units: String(Math.max(0, (Number(l.units) || 0) - 1)) })} aria-label={`One box less of ${item?.sku ?? "item"}, pallet ${idx + 1}`} className="grid h-12 w-12 shrink-0 place-items-center border-[1.5px] border-dock-ink bg-white">
                              <Minus size={16} aria-hidden />
                            </button>
                            <input inputMode="numeric" value={l.units} onChange={(e) => setLine(p.key, li, { units: e.target.value.replace(/\D/g, "") })} aria-label={`Boxes of ${item?.sku ?? "item"}, pallet ${idx + 1}`} className="dock-input mono h-12 min-w-0 flex-1 text-center text-lg font-semibold" />
                            <button type="button" onClick={() => setLine(p.key, li, { units: String((Number(l.units) || 0) + 1) })} aria-label={`One box more of ${item?.sku ?? "item"}, pallet ${idx + 1}`} className="grid h-12 w-12 shrink-0 place-items-center border-[1.5px] border-dock-ink bg-dock-yellow">
                              <Plus size={16} aria-hidden />
                            </button>
                          </div>
                          {item && <p className="mono text-[11px] text-dock-ink/45">{item.unitsPerPallet} boxes make a full pallet</p>}
                          {item?.tracksLot && (
                            <div className="grid grid-cols-2 gap-1.5">
                              <input value={l.lot} onChange={(e) => setLine(p.key, li, { lot: e.target.value })} placeholder="Lot" aria-label={`Lot, pallet ${idx + 1}`} className="dock-input mono min-w-0 text-sm" />
                              <input type="date" value={l.expiresAt} onChange={(e) => setLine(p.key, li, { expiresAt: e.target.value })} aria-label={`Best before, pallet ${idx + 1}`} className="dock-input mono min-w-0 text-sm" />
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
                          + Another item on this pallet
                        </button>
                      )}
                      <button type="button" onClick={() => { setPallets((ps) => ps.filter((q) => q.key !== p.key)); setOpenKey(null); }} aria-label={`Remove pallet ${idx + 1}`} className="cond flex min-h-12 items-center justify-center gap-1 border-[1.5px] border-dock-red px-3 text-sm text-dock-red">
                        <Trash2 size={14} aria-hidden /> Remove
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex items-center justify-between border-t border-dock-line pt-3 text-sm">
        <span>Damaged boxes</span>
        <span className="flex items-center">
          <button type="button" onClick={() => setDamaged((d) => Math.max(0, d - 1))} aria-label="One damaged box less" className="grid h-12 w-12 place-items-center border-[1.5px] border-dock-ink bg-white">
            <Minus size={14} aria-hidden />
          </button>
          <span className={`mono w-10 text-center text-lg font-semibold ${damaged ? "text-dock-red" : ""}`}>{damaged}</span>
          <button type="button" onClick={() => setDamaged((d) => d + 1)} aria-label="One damaged box more" className="grid h-12 w-12 place-items-center border-[1.5px] border-dock-ink bg-white">
            <Plus size={14} aria-hidden />
          </button>
        </span>
      </div>
      <input value={incident} onChange={(e) => setIncident(e.target.value)} placeholder="Anything else? (optional)" aria-label="Anything else" className="dock-input text-sm" />

      <div className="sticky bottom-0 -mx-4 space-y-2 border-t-[1.5px] border-dock-ink bg-white px-4 pb-3 pt-2">
        <p className="mono text-xs" aria-live="polite">
          {lineCount} {lineCount === 1 ? "line" : "lines"} · {pallets.length} {pallets.length === 1 ? "pallet" : "pallets"}
          {mixed > 0 && ` · ${mixed} mixed`} · {boxes.toLocaleString("es-ES")} boxes
          {expected !== null && (expected === pallets.length ? <span className="text-dock-ink/60"> · note says {expected} ✓</span> : <span className="font-semibold text-dock-red"> · note says {expected}</span>)}
        </p>
        {errors.length > 0 && (
          <div role="alert" className="space-y-0.5 bg-dock-red/10 px-3 py-2 text-sm text-dock-red">
            {errors.map((e, i) => (
              <p key={i}>{e}</p>
            ))}
          </div>
        )}
        <button disabled={pending || pallets.length === 0} onClick={confirm} className="cond min-h-14 w-full bg-dock-ink px-4 py-3 text-base font-semibold text-dock-yellow disabled:opacity-50">
          {pending ? "Saving…" : `Confirm ${pallets.length} ${pallets.length === 1 ? "pallet" : "pallets"} into receiving`}
        </button>
        <p className="text-center text-[11px] text-dock-ink/45">They land in the receiving lane by the door of {warehouse || "the warehouse"}. The driver then signs on their phone.</p>
      </div>
    </div>
  );
}
