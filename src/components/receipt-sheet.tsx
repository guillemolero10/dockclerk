/* eslint-disable @next/next/no-img-element -- photos come from our own upload route */
import { Bot } from "lucide-react";
import { LoadPhoto } from "@/components/load-photo";
import { PrintButton } from "@/components/print-button";
import { db } from "@/lib/db";
import { fmtDate, madridHm } from "@/lib/format";
import { LOCALE } from "@/lib/i18n/core";
import { LangSwitch } from "@/lib/i18n/lang-switch";
import { getT } from "@/lib/i18n/server";

type ReceivedPallet = { code: string; generated: boolean; lines: { sku: string; lot: string | null; expiresAt: string | null; units: number }[] };
type Box = { x: number; y: number; w: number; h: number; damaged: boolean };

const BY: Record<string, string> = { "muse-spark": "Muse Spark", "sam-3.1": "SAM 3.1", "sam-3": "SAM 3" };

/** The dock receipt (acta de descarga): what the note said, what was counted, photos and signature. */
export async function ReceiptSheet({ inboundId, driverToken }: { inboundId: string; driverToken?: string }) {
  // The driver has no session: his files are opened with the secret of his link.
  const { t, lang } = await getT();
  const num = (n: number) => n.toLocaleString(LOCALE[lang]);
  const who = (key: string) => BY[key] ?? (key === "driver" ? t("rs.by.driver") : key === "operator" ? t("rs.by.operator") : key);
  const file = (url: string) => (driverToken ? `${url}?t=${encodeURIComponent(driverToken)}` : url);
  const inbound = await db.inbound.findUnique({
    where: { id: inboundId },
    include: { client: true, warehouse: true, carrier: true, appointment: true, receipt: true, lines: { include: { item: true } } },
  });
  if (!inbound) return <p className="p-8 text-dock-ink/60">{t("rs.notFound")}</p>;
  const r = inbound.receipt;
  const pallets = (r?.pallets as ReceivedPallet[] | null) ?? [];
  const damages = (r?.damages as { box: number; note: string }[] | null) ?? [];

  return (
    <div className="dock-app min-h-screen py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-3 flex max-w-3xl items-center justify-end gap-2 px-4 print:hidden">
        <LangSwitch tone="light" />
        <PrintButton />
      </div>
      <article className="mx-auto max-w-3xl border-[1.5px] border-dock-ink bg-white print:border-0">
        <div className="hazard h-2 print:hidden" />
        <header className="flex flex-wrap items-start justify-between gap-4 border-b-[1.5px] border-dock-ink px-8 py-6">
          <div>
            <p className="cond text-xs text-dock-ink/50">Almacenes del Vinalopó · {inbound.warehouse?.name ?? ""}</p>
            <h1 className="text-2xl font-semibold tracking-tight">{t("rs.title")}</h1>
            <p className="text-sm text-dock-ink/50">{t("rs.subtitle")}</p>
          </div>
          <div className="text-right">
            <p className="mono text-2xl font-semibold">Nº {inbound.number}</p>
            <p className="mono text-sm text-dock-ink/60">
              {fmtDate(inbound.appointment?.startsAt ?? inbound.date)} {inbound.appointment ? t("rs.dockAt", { dock: inbound.appointment.dock, time: madridHm(inbound.appointment.startsAt) }) : ""}
            </p>
          </div>
        </header>

        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 border-b border-dock-line px-8 py-5 text-sm sm:grid-cols-4">
          <Field label={t("rs.customer")} value={inbound.client.name} />
          <Field label={t("rs.supplier")} value={inbound.supplier ?? "—"} />
          <Field label={t("rs.carrier")} value={inbound.carrier?.name ?? "—"} />
          <Field label={t("rs.plate")} value={inbound.plate ?? "—"} mono />
          <Field label={t("rs.note")} value={inbound.clientDocRef ?? "—"} mono />
          <Field label={t("rs.noteSays")} value={r?.notePallets ? t("rs.pallets_p", { n: r.notePallets }) : "—"} mono />
          <Field label={t("rs.received")} value={inbound.receivedPallets !== null ? t("rs.pallets_p", { n: inbound.receivedPallets }) : t("rs.notYet")} mono />
          <Field label={t("rs.units")} value={inbound.receivedUnits !== null ? num(inbound.receivedUnits) : "—"} mono />
        </dl>

        <div className="flex flex-wrap gap-2 px-8 pt-4">
          {r?.readBy && <Badge text={r.readBy === "muse-spark" ? t("rs.byMuse") : t("rs.typedBy", { who: who(r.readBy) })} ai={r.readBy === "muse-spark"} />}
          {r?.countedBy && <Badge text={t("rs.found", { who: who(r.countedBy) })} ai />}
        </div>

        <table className="mx-8 mt-4 w-[calc(100%-4rem)] text-sm">
          <thead>
            <tr className="cond border-b-[1.5px] border-dock-ink text-left text-[11px] text-dock-ink/50">
              <th className="py-1.5">{t("rs.item")}</th>
              <th>{t("rs.description")}</th>
              <th>{t("rs.lot")}</th>
              <th className="text-right">{t("rs.palletsCol")}</th>
              <th className="text-right">{t("rs.unitsCol")}</th>
            </tr>
          </thead>
          <tbody>
            {inbound.lines.map((l) => (
              <tr key={l.id} className="border-b border-dock-line">
                <td className="mono py-1.5 font-semibold">{l.item.sku}</td>
                <td className="text-dock-ink/70">{l.item.description}</td>
                <td className="mono">{l.lot ?? "—"}</td>
                <td className="mono text-right">{l.pallets}</td>
                <td className="mono text-right">{num(l.units)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {pallets.length > 0 && (
          <section className="mx-8 mt-6 print:break-inside-avoid-page" aria-label={t("rs.palletsAria")}>
            <h2 className="cond border-b-[1.5px] border-dock-ink pb-1 text-[11px] text-dock-ink/50">
              {t("rs.palletsHead", { n: pallets.length })}
              {pallets.some((p) => p.lines.length > 1) && t("rs.mixedN", { n: pallets.filter((p) => p.lines.length > 1).length })}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[460px] text-sm">
                <thead>
                  <tr className="cond border-b border-dock-line text-left text-[11px] text-dock-ink/50">
                    <th className="py-1.5">{t("rs.palletId")}</th>
                    <th>{t("rs.item")}</th>
                    <th>{t("rs.lot")}</th>
                    <th>{t("rs.bestBefore")}</th>
                    <th className="text-right">{t("rs.boxes")}</th>
                  </tr>
                </thead>
                {pallets.map((p) => (
                  <tbody key={p.code} className="border-b border-dock-line print:break-inside-avoid">
                    {p.lines.map((l, i) => (
                      <tr key={i}>
                        <td className="mono py-1 align-top font-semibold">
                          {i === 0 && (
                            <>
                              {p.code}
                              {p.generated && <span className="block text-[10px] font-normal text-dock-ink/45">{t("rs.label")}</span>}
                              {p.lines.length > 1 && <span className="cond mt-0.5 inline-block bg-dock-ink px-1.5 py-0.5 text-[10px] font-normal text-dock-yellow print:border print:border-dock-ink print:bg-white print:text-dock-ink">{t("rs.mixed")}</span>}
                            </>
                          )}
                        </td>
                        <td className="mono py-1 align-top">{l.sku}</td>
                        <td className="mono py-1 align-top">{l.lot ?? "—"}</td>
                        <td className="mono py-1 align-top">{l.expiresAt ? fmtDate(new Date(`${l.expiresAt}T12:00:00Z`)) : "—"}</td>
                        <td className="mono py-1 text-right align-top">{num(l.units)}</td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          </section>
        )}

        {(inbound.incident || damages.length > 0) && (
          <div className="mx-8 mt-4 border-[1.5px] border-dock-red bg-dock-red/5 px-4 py-3 text-sm">
            <p className="cond text-[11px] text-dock-red">{t("rs.incidents")}</p>
            {inbound.incident && <p>{inbound.incident}</p>}
            {damages.map((d) => (
              <p key={d.box} className="text-dock-ink/70">
                {t("rs.box", { n: d.box, note: d.note })}
              </p>
            ))}
          </div>
        )}

        {(r?.noteImageUrl || r?.palletImageUrl) && (
          <div className="grid gap-4 px-8 pt-5 sm:grid-cols-2">
            {r?.noteImageUrl && (
              <figure>
                <img src={file(r.noteImageUrl)} alt={t("rs.noteAlt")} className="w-full border-[1.5px] border-dock-ink" />
                <figcaption className="cond mt-1 text-[11px] text-dock-ink/50">{t("rs.note")}</figcaption>
              </figure>
            )}
            {r?.palletImageUrl && (
              <figure>
                <LoadPhoto src={file(r.palletImageUrl)} boxes={(r.boxes as Box[] | null) ?? null} alt={t("rs.loadAlt")} />
                <figcaption className="cond mt-1 text-[11px] text-dock-ink/50">{t("rs.loadCaption")}</figcaption>
              </figure>
            )}
          </div>
        )}

        <footer className="mt-6 grid grid-cols-2 gap-8 border-t-[1.5px] border-dock-ink px-8 py-5 text-sm">
          <div>
            <p className="cond text-[11px] text-dock-ink/50">{t("rs.driver")}</p>
            {r?.signatureUrl ? <img src={file(r.signatureUrl)} alt={t("rs.signatureAlt")} className="h-20" /> : <div className="h-20" />}
            <p>{r?.signedBy ?? t("rs.notSigned")}</p>
            {r?.signedAt && <p className="mono text-xs text-dock-ink/50">{fmtDate(r.signedAt)} {madridHm(r.signedAt)}</p>}
          </div>
          <div>
            <p className="cond text-[11px] text-dock-ink/50">{t("rs.warehouse")}</p>
            <div className="h-20" />
            <p>{inbound.warehouse?.name ?? "Almacenes del Vinalopó"}</p>
          </div>
        </footer>
      </article>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="cond text-[11px] text-dock-ink/50">{label}</dt>
      <dd className={mono ? "mono" : ""}>{value}</dd>
    </div>
  );
}

function Badge({ text, ai }: { text: string; ai?: boolean }) {
  return (
    <span className={`cond flex items-center gap-1 px-2 py-0.5 text-[11px] ${ai ? "bg-dock-ink text-dock-yellow" : "border border-dock-line text-dock-ink/60"}`}>
      {ai && <Bot size={12} />} {text}
    </span>
  );
}
