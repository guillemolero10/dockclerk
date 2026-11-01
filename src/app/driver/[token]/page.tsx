/* eslint-disable @next/next/no-img-element -- photos come from our own upload route */
import Link from "next/link";
import { Bot, FileText, Truck } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { ArriveButton, NoteStep, SignStep, StepDot } from "@/components/driver/driver-steps";
import { db } from "@/lib/db";
import { madridHm, madridYmd } from "@/lib/format";
import { LOCALE, type Translate } from "@/lib/i18n/core";
import { LangSwitch } from "@/lib/i18n/lang-switch";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type NoteLine = { sku: string | null; description: string; lot: string | null; pallets: number | null; units: number | null };

export default async function DriverPage({ params }: PageProps<"/driver/[token]">) {
  const { token } = await params;
  const { t, lang } = await getT();
  const inbound = await db.inbound.findUnique({
    where: { driverToken: token },
    include: { client: true, warehouse: true, carrier: true, appointment: true, receipt: true, lines: { include: { item: true } } },
  });

  if (!inbound) {
    return (
      <Shell t={t}>
        <p className="mt-10 text-center text-dock-ink/60">{t("dr.invalid")}</p>
      </Shell>
    );
  }

  const slot = inbound.appointment;
  const receipt = inbound.receipt;
  const received = inbound.status === "RECEIVED" || inbound.status === "CLOSED";
  const stage = receipt?.signedAt ? "done" : received ? "sign" : slot?.status === "ARRIVED" || inbound.status === "RECEIVING" ? "unloading" : "coming";
  const noteDone = !!receipt?.notePallets;
  const noteLines = (receipt?.noteData as NoteLine[] | null) ?? [];
  const day = slot ? (madridYmd(slot.startsAt) === madridYmd() ? t("dr.today") : slot.startsAt.toLocaleDateString(LOCALE[lang], { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Madrid" })) : null;

  return (
    <Shell t={t}>
      {stage === "unloading" && <AutoRefresh seconds={8} />}

      {/* Where and when */}
      <section className="dock-card overflow-hidden bg-white">
        <div className="flex items-stretch">
          <div className="flex flex-col items-center justify-center bg-dock-ink px-5 py-4 text-dock-yellow">
            <span className="cond text-[11px] text-white/50">{t("dr.dock")}</span>
            <span className="cond text-5xl font-bold leading-none">{slot?.dock ?? "–"}</span>
          </div>
          <div className="flex-1 px-4 py-3">
            <p className="cond text-[11px] text-dock-ink/50">{day ?? t("dr.noSlot")}</p>
            <p className="mono text-2xl font-semibold">{slot ? `${madridHm(slot.startsAt)}–${madridHm(slot.endsAt)}` : t("dr.callOffice")}</p>
            <p className="mt-1 text-sm">{inbound.warehouse ? `${inbound.warehouse.name}, ${inbound.warehouse.city}` : "Almacenes del Vinalopó"}</p>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t-[1.5px] border-dock-ink px-4 py-3 text-sm">
          <dt className="cond text-[11px] text-dock-ink/50">{t("dr.delivery")}</dt>
          <dd>
            Nº {inbound.number} · {inbound.client.name}
          </dd>
          <dt className="cond text-[11px] text-dock-ink/50">{t("dr.from")}</dt>
          <dd>{inbound.supplier ?? "—"}</dd>
          <dt className="cond text-[11px] text-dock-ink/50">{t("dr.truck")}</dt>
          <dd className="mono">
            {inbound.plate ?? "—"} · {inbound.carrier?.name ?? ""}
          </dd>
        </dl>
      </section>

      <div className="mt-5 flex">
        <StepDot label={t("dr.stepNote")} done={noteDone} active={stage === "coming" && !noteDone} />
        <StepDot label={t("dr.stepGate")} done={stage !== "coming"} active={stage === "coming" && noteDone} />
        <StepDot label={t("dr.stepUnloading")} done={stage === "sign" || stage === "done"} active={stage === "unloading"} />
        <StepDot label={t("dr.stepSign")} done={stage === "done"} active={stage === "sign"} />
      </div>

      {stage === "coming" && (
        <section className="mt-5 space-y-4">
          {noteDone ? (
            <NoteSummary t={t} readBy={receipt?.readBy ?? null} pallets={receipt?.notePallets ?? null} lines={noteLines} image={receipt?.noteImageUrl ? `${receipt.noteImageUrl}?t=${encodeURIComponent(token)}` : null} />
          ) : (
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">{t("dr.before")}</h2>
              <p className="text-sm text-dock-ink/60">{t("dr.beforeText")}</p>
              <NoteStep token={token} askTyped={!!receipt?.noteImageUrl && !receipt.notePallets} />
            </div>
          )}
          <ArriveButton token={token} />
        </section>
      )}

      {stage === "unloading" && (
        <section className="mt-5 space-y-4">
          <div className="hazard p-1">
            <div className="bg-dock-ink px-5 py-6 text-center text-white">
              <Truck className="mx-auto text-dock-yellow" size={28} />
              <p className="cond mt-2 text-sm text-white/60">{t("dr.goTo")}</p>
              <p className="cond text-5xl font-bold text-dock-yellow">{t("dr.dockUpper", { n: slot?.dock ?? "" })}</p>
              <p className="mt-2 text-sm text-white/70">{t("dr.unloadingText")}</p>
            </div>
          </div>
          {!noteDone && (
            <div className="space-y-2">
              <p className="text-sm text-dock-ink/60">{t("dr.noNoteYet")}</p>
              <NoteStep token={token} askTyped={!!receipt?.noteImageUrl} />
            </div>
          )}
        </section>
      )}

      {stage === "sign" && (
        <section className="mt-5 space-y-4">
          <h2 className="text-lg font-semibold">{t("dr.checkSign")}</h2>
          <ReceivedSummary t={t}
            notePallets={receipt?.notePallets ?? inbound.expectedPallets}
            received={inbound.receivedPallets ?? 0}
            lines={inbound.lines.map((l) => ({ sku: l.item.sku, lot: l.lot, pallets: l.pallets, units: l.units }))}
            incident={inbound.incident}
          />
          <SignStep token={token} />
        </section>
      )}

      {stage === "done" && (
        <section className="mt-5 space-y-4 text-center">
          <p className="text-lg font-semibold">{t("dr.signed")}</p>
          <p className="text-sm text-dock-ink/60">
            {t("dr.signedText_p", { n: inbound.receivedPallets ?? 0, time: madridHm(receipt!.signedAt!), name: receipt!.signedBy ?? "" })}
          </p>
          <Link href={`/driver/${token}/receipt`} className="cond inline-flex items-center gap-2 bg-dock-ink px-5 py-3 text-sm font-semibold text-dock-yellow">
            <FileText size={16} /> {t("dr.receipt")}
          </Link>
        </section>
      )}
    </Shell>
  );
}

function Shell({ children, t }: { children: React.ReactNode; t: Translate }) {
  return (
    <div className="dock-app min-h-screen">
      <div className="hazard h-2" />
      <header className="flex items-center gap-2.5 bg-dock-ink px-5 py-3">
        <span className="cond grid h-7 w-7 place-items-center bg-dock-yellow text-xs font-bold text-dock-ink">DC</span>
        <span className="text-sm font-semibold text-white">Almacenes del Vinalopó</span>
        <span className="cond ml-auto text-[11px] text-white/40">{t("dr.header")}</span>
        <LangSwitch big />
      </header>
      <main className="mx-auto w-full max-w-md px-4 py-5">{children}</main>
    </div>
  );
}

function NoteSummary({ t, readBy, pallets, lines, image }: { t: Translate; readBy: string | null; pallets: number | null; lines: NoteLine[]; image: string | null }) {
  return (
    <div className="dock-card bg-white p-4">
      <p className="cond flex items-center gap-1.5 text-[11px] text-dock-ink/50">
        {readBy === "muse-spark" ? (
          <>
            <Bot size={13} /> {t("dr.readBy")}
          </>
        ) : (
          t("dr.noteSent")
        )}
      </p>
      <div className="mt-2 flex gap-3">
        {image && <img src={image} alt={t("dr.noteAlt")} className="h-20 w-16 shrink-0 border border-dock-line object-cover" />}
        <div className="min-w-0 flex-1 text-sm">
          <p className="mono text-xl font-semibold">{t("dr.palletsN_p", { n: pallets ?? 0 })}</p>
          {lines
            .filter((l) => l.description || l.sku)
            .map((l, i) => (
              <p key={i} className="truncate text-xs text-dock-ink/60">
                {l.pallets ?? "?"} × {l.sku ?? l.description} {l.lot ? t("dr.lot", { lot: l.lot }) : ""}
              </p>
            ))}
        </div>
      </div>
    </div>
  );
}

function ReceivedSummary({
  t,
  notePallets,
  received,
  lines,
  incident,
}: {
  t: Translate;
  notePallets: number | null;
  received: number;
  lines: { sku: string; lot: string | null; pallets: number; units: number }[];
  incident: string | null;
}) {
  const match = notePallets === null || notePallets === received;
  return (
    <div className="dock-card bg-white">
      <div className="grid grid-cols-2 border-b-[1.5px] border-dock-ink text-center">
        <div className="border-r-[1.5px] border-dock-ink px-3 py-2">
          <p className="cond text-[11px] text-dock-ink/50">{t("dr.stepNote")}</p>
          <p className="mono text-2xl font-semibold">{notePallets ?? "—"}</p>
        </div>
        <div className={`px-3 py-2 ${match ? "" : "bg-dock-yellow"}`}>
          <p className="cond text-[11px] text-dock-ink/50">{t("dr.received")}</p>
          <p className="mono text-2xl font-semibold">{received}</p>
        </div>
      </div>
      <ul className="divide-y divide-dock-line px-4 text-sm">
        {lines.map((l, i) => (
          <li key={i} className="flex justify-between py-2">
            <span className="mono">
              {l.sku} {l.lot ? <span className="text-dock-ink/50">· {l.lot}</span> : null}
            </span>
            <span className="mono">
              {t("dr.plt", { p: l.pallets, u: l.units })}
            </span>
          </li>
        ))}
      </ul>
      {incident && <p className="border-t border-dock-line bg-dock-red/10 px-4 py-2 text-sm text-dock-red">{incident}</p>}
    </div>
  );
}
