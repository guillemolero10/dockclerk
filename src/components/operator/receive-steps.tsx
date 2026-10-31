"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Minus, Plus, Truck, X } from "lucide-react";
import { loadPhoto, notePallets, notePhoto, receive, truckHere } from "@/app/operator/actions";
import { expandPallets } from "@/lib/pallets/breakdown";
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

type Line = { itemId: string; lot: string; pallets: number };

export function ReceiveForm({
  inboundId,
  items,
  start,
  expected,
  damagedFound,
  warehouse,
}: {
  inboundId: string;
  items: { id: string; sku: string; description: string; unitsPerPallet: number; tracksLot: boolean }[];
  start: Line[];
  expected: number | null;
  damagedFound: number;
  warehouse: string;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>(start);
  const [damaged, setDamaged] = useState(damagedFound);
  const [incident, setIncident] = useState("");
  const [pending, begin] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const total = lines.reduce((sum, l) => sum + l.pallets, 0);
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="space-y-3">
      {lines.map((line, i) => {
        const item = items.find((x) => x.id === line.itemId);
        return (
          <div key={i} className="space-y-2 border-[1.5px] border-dock-line p-2.5">
            <div className="flex gap-2">
              <select value={line.itemId} onChange={(e) => set(i, { itemId: e.target.value })} aria-label="Item" className="dock-input flex-1 text-sm">
                {items.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.sku} · {x.description}
                  </option>
                ))}
              </select>
              {lines.length > 1 && (
                <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="px-1 text-dock-ink/40" aria-label="Remove line">
                  <X size={16} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {item?.tracksLot && <input value={line.lot} onChange={(e) => set(i, { lot: e.target.value })} placeholder="Lot" aria-label="Lot" className="dock-input mono w-28 text-sm" />}
              <div className="ml-auto flex items-center">
                <button type="button" onClick={() => set(i, { pallets: Math.max(0, line.pallets - 1) })} aria-label={`One pallet less${item ? ` of ${item.sku}` : ""}`} className="grid h-10 w-10 place-items-center border-[1.5px] border-dock-ink bg-white">
                  <Minus size={16} aria-hidden />
                </button>
                <span className="mono w-12 text-center text-xl font-semibold">{line.pallets}</span>
                <button type="button" onClick={() => set(i, { pallets: line.pallets + 1 })} aria-label={`One pallet more${item ? ` of ${item.sku}` : ""}`} className="grid h-10 w-10 place-items-center border-[1.5px] border-dock-ink bg-dock-yellow">
                  <Plus size={16} aria-hidden />
                </button>
              </div>
            </div>
            {item && <p className="mono text-[11px] text-dock-ink/45">{line.pallets * item.unitsPerPallet} units</p>}
          </div>
        );
      })}
      <button type="button" onClick={() => setLines((ls) => [...ls, { itemId: items[0]?.id ?? "", lot: "", pallets: 1 }])} className="cond text-xs text-dock-ink/60 underline">
        + Another item
      </button>

      <div className="flex items-center justify-between border-t border-dock-line pt-3 text-sm">
        <span>Damaged boxes</span>
        <span className="flex items-center">
          <button type="button" onClick={() => setDamaged((d) => Math.max(0, d - 1))} aria-label="One damaged box less" className="grid h-9 w-9 place-items-center border-[1.5px] border-dock-ink bg-white">
            <Minus size={14} aria-hidden />
          </button>
          <span className={`mono w-10 text-center text-lg font-semibold ${damaged ? "text-dock-red" : ""}`}>{damaged}</span>
          <button type="button" onClick={() => setDamaged((d) => d + 1)} aria-label="One damaged box more" className="grid h-9 w-9 place-items-center border-[1.5px] border-dock-ink bg-white">
            <Plus size={14} aria-hidden />
          </button>
        </span>
      </div>
      <input value={incident} onChange={(e) => setIncident(e.target.value)} placeholder="Anything else? (optional)" aria-label="Anything else" className="dock-input text-sm" />

      {expected !== null && expected !== total && (
        <p className="bg-dock-yellow px-3 py-2 text-sm ring-[1.5px] ring-dock-ink">
          The note says {expected} pallets, you are receiving {total}. It will go on the receipt.
        </p>
      )}
      {error && <p className="text-sm text-dock-red">{error}</p>}
      <button
        disabled={pending || total === 0}
        onClick={() =>
          begin(async () => {
            try {
              const result = await receive(
                inboundId,
                // Until the pallet-by-pallet form: every pallet of a line is a full pallet with no ID (the warehouse labels it).
                lines.filter((l) => l.pallets > 0).flatMap((l) => expandPallets({ itemId: l.itemId, lot: l.lot.trim() || null, expiresAt: null, units: items.find((x) => x.id === l.itemId)?.unitsPerPallet ?? 1 }, l.pallets)),
                damaged,
                incident,
              );
              setError(result.error ?? null);
              if (!result.error) router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not save it.");
            }
          })
        }
        className="cond w-full bg-dock-ink px-4 py-4 text-base font-semibold text-dock-yellow disabled:opacity-50"
      >
        {pending ? "Saving…" : `Confirm ${total} pallets into receiving`}
      </button>
      <p className="text-center text-[11px] text-dock-ink/45">They land in the receiving lane by the door of {warehouse}. The driver then signs on their phone.</p>
    </div>
  );
}
