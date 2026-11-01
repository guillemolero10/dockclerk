// Pallet by pallet: what came off the truck, one draft per physical pallet. Pure.
// A pallet has an ID (or none yet: the warehouse labels it) and one to four lines (item, lot, expiry, boxes).
// Lines of one pallet are one customer's: the form only offers that customer's items and the server checks it.

import type { Translate } from "@/lib/i18n/core";
import { tEn } from "@/lib/i18n/en";
import { parseCode } from "./codes";
import { splitUnits } from "./quantity";

export const MAX_PALLETS = 66;
export const MAX_LINES = 4;

export type DraftLine = { itemId: string; lot: string | null; /** YYYY-MM-DD */ expiresAt: string | null; units: number };
export type PalletDraft = { code: string | null; lines: DraftLine[] };
export type ItemLite = { id: string; sku: string; unitsPerPallet: number };
/** What the delivery note says, line by line (the reader's output; `palletCodes` are the IDs printed on the note, if any). */
export type NoteLineLite = { sku: string | null; lot: string | null; pallets: number | null; units: number | null; palletCodes?: string[] | null };

/** "38 pallets of AGUA-15": `count` single-line pallets with no ID, each with the line's boxes. */
export function expandPallets(line: DraftLine, count: number): PalletDraft[] {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, () => ({ code: null, lines: [{ ...line }] }));
}

/**
 * The pallets a delivery note announces. A line of N pallets and U boxes makes N pallets with U shared out as evenly as possible
 * (a whole number each: the first ones get one more); without boxes, full pallets. A code printed under two lines is one mixed pallet.
 * Lines without a known item are left out (the person adds them).
 */
export function fromNote(lines: NoteLineLite[], items: ItemLite[]): PalletDraft[] {
  const out: PalletDraft[] = [];
  const byCode = new Map<string, PalletDraft>();
  for (const l of lines) {
    const item = items.find((i) => i.sku === l.sku);
    const count = l.pallets ?? 0;
    // A line with boxes but no pallets, under an ID already read: the second line of that mixed pallet.
    if (item && !count && l.units && l.units > 0) {
      const first = parseCode(l.palletCodes?.[0] ?? "");
      const mixedWith = first.ok && first.code ? byCode.get(first.code) : undefined;
      if (mixedWith) mixedWith.lines.push({ itemId: item.id, lot: l.lot?.trim() || null, expiresAt: null, units: l.units });
      continue;
    }
    if (!item || !Number.isInteger(count) || count < 1) continue;
    const total = l.units && l.units > 0 ? l.units : count * item.unitsPerPallet;
    const base = Math.floor(total / count);
    const extra = total - base * count;
    const codes = (l.palletCodes ?? []).map((c) => { const p = parseCode(c); return p.ok ? p.code : null; });
    for (let k = 0; k < count; k++) {
      const draftLine: DraftLine = { itemId: item.id, lot: l.lot?.trim() || null, expiresAt: null, units: base + (k < extra ? 1 : 0) };
      const code = codes[k] ?? null;
      const mixedWith = code ? byCode.get(code) : undefined;
      if (mixedWith) { mixedWith.lines.push(draftLine); continue; }
      const draft: PalletDraft = { code, lines: [draftLine] };
      if (code) byCode.set(code, draft);
      out.push(draft);
    }
  }
  return out;
}

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const pct = (x: number) => `${Math.round(x * 100)} %`;

/** Share of its physical pallet each line takes: null for a pallet of one line; otherwise they add up to 1. */
export function sharesOf(lines: DraftLine[], items: ItemLite[]): (number | null)[] {
  if (lines.length < 2) return lines.map(() => null);
  const part = lines.map((l) => l.units / (items.find((i) => i.id === l.itemId)?.unitsPerPallet ?? 1));
  const sum = part.reduce((a, b) => a + b, 0);
  return part.map((p) => p / sum);
}

/** Index of the head line (the one that counts as the physical pallet): the biggest share, the first on a tie. */
export function leadIndex(shares: (number | null)[]): number {
  let best = 0;
  shares.forEach((s, i) => { if ((s ?? 0) > (shares[best] ?? 0) + 1e-9) best = i; });
  return best;
}

/**
 * Everything wrong with a breakdown, in words the operator can act on (pallets are numbered from 1).
 * @param live pallet IDs already inside the buildings, with where they are
 */
export function checkBreakdown(drafts: PalletDraft[], items: ItemLite[], live: Map<string, string>, t: Translate = tEn): { errors: string[] } {
  const errors: string[] = [];
  if (!drafts.length) errors.push(t("bd.addOne"));
  if (drafts.length > MAX_PALLETS) errors.push(t("bd.tooMany", { max: MAX_PALLETS, n: drafts.length }));
  const seen = new Set<string>();
  drafts.forEach((d, idx) => {
    const n = idx + 1;
    if (d.code !== null) {
      const parsed = parseCode(d.code, t);
      if (!parsed.ok) errors.push(t("bd.pallet", { n, text: parsed.error }));
      else if (parsed.code !== d.code) errors.push(t("bd.notClean", { n, code: d.code, clean: parsed.code ?? t("bd.blank") }));
      else if (parsed.code) {
        if (live.has(parsed.code)) errors.push(t("bd.live", { code: parsed.code, where: live.get(parsed.code)! }));
        else if (seen.has(parsed.code)) errors.push(t("bd.twice", { code: parsed.code }));
        seen.add(parsed.code);
      }
    }
    if (!d.lines.length) { errors.push(t("bd.empty", { n })); return; }
    if (d.lines.length > MAX_LINES) errors.push(t("bd.maxLines", { n, max: MAX_LINES }));
    let full = 0;
    const keys = new Set<string>();
    const parts: string[] = [];
    for (const l of d.lines) {
      const item = items.find((i) => i.id === l.itemId);
      if (!item) { errors.push(t("bd.notTheirs", { n })); continue; }
      if (!Number.isInteger(l.units) || l.units < 1) { errors.push(t("bd.typeBoxes", { n, sku: item.sku })); continue; }
      if (l.units > item.unitsPerPallet) { errors.push(t("bd.noFit", { n, units: l.units, sku: item.sku, max: item.unitsPerPallet })); continue; }
      if (l.expiresAt !== null && !isDay(l.expiresAt)) errors.push(t("bd.badDate", { n, sku: item.sku }));
      const key = `${l.itemId}|${l.lot ?? ""}|${l.expiresAt ?? ""}`;
      if (keys.has(key)) errors.push(t("bd.dupLine", { n, sku: item.sku }));
      keys.add(key);
      full += splitUnits(l.units, item.unitsPerPallet).equivalent;
      parts.push(pct(l.units / item.unitsPerPallet));
    }
    if (d.lines.length > 1 && full > 1 + 1e-9) errors.push(t("bd.over", { n, parts: parts.join(" + ") }));
  });
  return { errors };
}

/** The receipt's summary by item and lot: how many pallets carry it and how many boxes. */
export function summarize(drafts: PalletDraft[]): { itemId: string; lot: string | null; pallets: number; units: number }[] {
  const out = new Map<string, { itemId: string; lot: string | null; pallets: number; units: number }>();
  for (const d of drafts) {
    const here = new Set<string>();
    for (const l of d.lines) {
      const key = `${l.itemId}|${l.lot ?? ""}`;
      const row = out.get(key) ?? { itemId: l.itemId, lot: l.lot, pallets: 0, units: 0 };
      row.units += l.units;
      if (!here.has(key)) row.pallets++;
      here.add(key);
      out.set(key, row);
    }
  }
  return [...out.values()];
}

/**
 * What the browser sent, made safe: the right shapes, IDs cleaned with `parseCode` ("" = no ID), lots trimmed.
 * Anything that is not a list of pallets of lines is an error; the numbers are judged later by `checkBreakdown`.
 */
export function cleanDrafts(raw: unknown, t: Translate = tEn): { ok: true; drafts: PalletDraft[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: t("bd.listUnreadable") };
  const drafts: PalletDraft[] = [];
  for (const [idx, p] of raw.entries()) {
    const n = idx + 1;
    if (typeof p !== "object" || p === null || !Array.isArray((p as PalletDraft).lines)) return { ok: false, error: t("bd.palletUnreadable", { n }) };
    const rawCode = (p as PalletDraft).code;
    if (rawCode !== null && rawCode !== undefined && typeof rawCode !== "string") return { ok: false, error: t("bd.idUnreadable", { n }) };
    const code = parseCode(rawCode ?? "", t);
    if (!code.ok) return { ok: false, error: t("bd.pallet", { n, text: code.error }) };
    const lines: DraftLine[] = [];
    for (const l of (p as PalletDraft).lines as unknown[]) {
      const o = l as Partial<DraftLine> | null;
      if (!o || typeof o.itemId !== "string" || typeof o.units !== "number") return { ok: false, error: t("bd.lineUnreadable", { n }) };
      if (o.lot != null && typeof o.lot !== "string") return { ok: false, error: t("bd.lotUnreadable", { n }) };
      if (o.expiresAt != null && typeof o.expiresAt !== "string") return { ok: false, error: t("bd.dateUnreadable", { n }) };
      lines.push({ itemId: o.itemId, lot: o.lot?.trim().slice(0, 40) || null, expiresAt: o.expiresAt?.trim() || null, units: o.units });
    }
    drafts.push({ code: code.code, lines });
  }
  return { ok: true, drafts };
}
