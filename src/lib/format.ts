// Spanish formats, as the legacy software shows them.
export const fmtDate = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Madrid" }) : "";

export const fmtTime = (d: Date | null | undefined) =>
  d ? d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" }) : "";

export const fmtNumber = (n: number | null | undefined) => (n == null ? "" : n.toLocaleString("es-ES"));

// The warehouse runs on Spanish time, but servers (Vercel) run on UTC.
// Returns the UTC instants where today starts and ends in Madrid.
export function madridDayRange(date = new Date()) {
  const ymd = date.toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" }); // 2026-10-26
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", timeZoneName: "shortOffset" })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName")!.value; // "GMT+1"
  const hours = Number(offset.replace("GMT", "") || 0);
  const start = new Date(new Date(`${ymd}T00:00:00Z`).getTime() - hours * 60 * 60 * 1000);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** "2026-10-27": the Madrid calendar day of an instant. */
export const madridYmd = (date = new Date()) => date.toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });

/** Range of a Madrid calendar day given as "2026-10-27". */
export const madridDay = (ymd: string) => madridDayRange(new Date(`${ymd}T12:00:00Z`));

/** "09:30" in Madrid. */
export const madridHm = (date: Date) =>
  date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Madrid" });

/** First name to greet a contact by, only when the contact is a person ("Marta Pérez"), not a department ("Compras Serra Mariola"). */
export function firstName(contact: string | null | undefined) {
  const words = contact?.trim().split(/\s+/) ?? [];
  return words.length === 2 && /^[A-ZÁÉÍÓÚÑ]/.test(words[1]) ? words[0] : "";
}
