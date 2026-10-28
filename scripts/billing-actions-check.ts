// Runs the real server actions prepareMonth and approvePreInvoice against the database, outside Next.
// WRITES to the database: it creates pre-invoices for last month and one temporary office session, and removes
// both at the end. It refuses to start if that month already has pre-invoices. Needs mobile data on the UMH wifi.
//
//   npx tsx --env-file=.env scripts/billing-actions-check.ts
//
// next/headers (cookies) and next/cache are replaced with small stand-ins, so the real session code runs: it reads the
// cookie, looks the session up in the database and checks the role.

import { createHash, randomBytes } from "node:crypto";
import Module from "node:module";

const token = randomBytes(32).toString("base64url");
let cookieValue: string | undefined = token;
const fakes: Record<string, unknown> = {
  "next/headers": { cookies: async () => ({ get: (name: string) => (name === "dockclerk_session" && cookieValue ? { value: cookieValue } : undefined), set() {}, delete() {} }) },
  "next/cache": { revalidatePath() {} },
  "next/navigation": { redirect: (to: string) => { throw new Error(`redirect:${to}`); } },
};
const M = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const realLoad = M._load;
M._load = function (request: string, ...rest: unknown[]) {
  return request in fakes ? fakes[request] : realLoad.call(this, request, ...rest);
};

type Case = { name: string; run: () => Promise<string | null> };

async function main() {
  const { db } = await import("../src/lib/db");
  const { period, dateOfDay, ymdOfDay } = await import("../src/lib/billing/calendar");
  const { todayDay, prepareClients } = await import("../src/lib/billing/load");
  const { prepareMonth, approvePreInvoice } = await import("../src/app/office/billing/actions");

  const thisMonth = ymdOfDay(todayDay()).slice(0, 7);
  const p = period(thisMonth);
  const month = ymdOfDay(p.start - 1).slice(0, 7);
  const pm = period(month);
  const range = { from: dateOfDay(pm.start), to: dateOfDay(pm.end - 1) };
  const futureMonth = ymdOfDay(p.end).slice(0, 7);

  if ((await db.preInvoice.count({ where: range })) > 0) throw new Error(`${month} already has pre-invoices; resow first (npm run db:seed)`);
  const office = await db.user.findFirstOrThrow({ where: { role: "office" }, select: { id: true } });
  const sessionId = createHash("sha256").update(token).digest("hex");
  const setSession = async (role: "office" | "operator" | "customer" | null) => {
    await db.session.deleteMany({ where: { id: sessionId } });
    if (!role) { cookieValue = undefined; return; }
    cookieValue = token;
    const user = role === "office" ? office : await db.user.findFirstOrThrow({ where: { role }, select: { id: true } });
    await db.session.create({ data: { id: sessionId, userId: user.id, expiresAt: new Date(Date.now() + 3600_000) } });
  };
  const fails = async (f: () => Promise<unknown>) => { try { await f(); return null; } catch (e) { return (e as Error).message; } };

  // The expected figures, from the engine without writing.
  const dry = await prepareClients(pm, { dryRun: true });
  const expected = new Map(dry.bills.map((b) => [b.clientCode, b.result.totalCents]));
  const totals = async () => {
    const rows = await db.preInvoice.findMany({ where: range, select: { id: true, number: true, status: true, totalCents: true, baseCents: true, vatCents: true, approvedAt: true, approvedBy: true, partialPallets: true, client: { select: { code: true } } } });
    return rows;
  };
  let draftId = "";
  let approvedSnapshot = "";
  let draftNumbers: string[] = [];

  const CASES: Case[] = [
    {
      name: "no session: both actions refuse",
      async run() {
        await setSession(null);
        const a = await fails(() => prepareMonth(month));
        const b = await fails(() => approvePreInvoice("x"));
        return a && b && (await db.preInvoice.count({ where: range })) === 0 ? null : `prepare: ${a}, approve: ${b}`;
      },
    },
    {
      name: "operator and customer sessions: both actions refuse (403 equivalent)",
      async run() {
        const bad: string[] = [];
        for (const role of ["operator", "customer"] as const) {
          await setSession(role);
          if (!(await fails(() => prepareMonth(month)))) bad.push(`${role} could prepare`);
          if (!(await fails(() => approvePreInvoice("x")))) bad.push(`${role} could approve`);
        }
        await setSession("office");
        return bad.length || (await db.preInvoice.count({ where: range })) > 0 ? `${bad.join("; ")} (rows: ${await db.preInvoice.count({ where: range })})` : null;
      },
    },
    {
      name: "future month: Error \"That month has not started.\"; bad months rejected",
      async run() {
        const msg = await fails(() => prepareMonth(futureMonth));
        const bad = [
          msg !== "That month has not started." ? `future: ${msg}` : "",
          ...(await Promise.all(["2026-13", "26-10", "", "2026-1", "2026-10-01", "'; drop"].map(async (m) => ((await fails(() => prepareMonth(m))) ? "" : `accepted "${m}"`)))),
          (await fails(() => prepareMonth(undefined as unknown as string))) ? "" : "accepted undefined",
        ].filter(Boolean);
        return bad.length ? bad.join("; ") : null;
      },
    },
    {
      name: `prepareMonth(${month}): one DRAFT per customer, same totals as the engine`,
      async run() {
        const r = await prepareMonth(month);
        const rows = await totals();
        const bad = [
          r.prepared !== expected.size ? `prepared ${r.prepared}, expected ${expected.size}` : "",
          r.skipped.length ? `skipped ${JSON.stringify(r.skipped)}` : "",
          rows.length !== expected.size ? `${rows.length} rows` : "",
          rows.some((x) => x.status !== "DRAFT" || x.approvedAt || x.approvedBy) ? "not all DRAFT" : "",
          ...rows.map((x) => (expected.get(x.client.code) !== x.totalCents ? `${x.client.code}: ${x.totalCents} vs ${expected.get(x.client.code)}` : "")),
          ...rows.map((x) => (x.baseCents + x.vatCents !== x.totalCents ? `${x.client.code}: base+vat` : "")),
          ...rows.map((x) => ((x.client.code === "C005") !== (x.partialPallets === "FULL") ? `${x.client.code}: rule ${x.partialPallets}` : "")),
        ].filter(Boolean);
        draftId = rows.find((x) => x.client.code === "C001")?.id ?? "";
        draftNumbers = rows.map((x) => `${x.client.code}:${x.number}`).sort();
        return bad.length ? bad.join("; ") : null;
      },
    },
    {
      name: "approve one: APPROVED with approvedBy and approvedAt, the others stay DRAFT",
      async run() {
        await approvePreInvoice(draftId);
        const rows = await totals();
        const mine = rows.find((x) => x.id === draftId);
        approvedSnapshot = JSON.stringify(mine);
        const bad = [
          mine?.status !== "APPROVED" ? `status ${mine?.status}` : "",
          !mine?.approvedAt ? "no approvedAt" : "",
          mine?.approvedBy !== "oficina" ? `approvedBy ${mine?.approvedBy}` : "",
          rows.filter((x) => x.status === "APPROVED").length !== 1 ? "more than one approved" : "",
        ].filter(Boolean);
        return bad.length ? bad.join("; ") : null;
      },
    },
    {
      name: "approve twice: nothing changes (same approvedAt and approvedBy), no error",
      async run() {
        await new Promise((r) => setTimeout(r, 30));
        const e = await fails(() => approvePreInvoice(draftId));
        const mine = (await totals()).find((x) => x.id === draftId);
        return e ? `threw ${e}` : JSON.stringify(mine) === approvedSnapshot ? null : "the approved row changed";
      },
    },
    {
      name: "approve an unknown id or junk: Error, nothing written",
      async run() {
        const bad = [];
        for (const id of ["nope", "", undefined as unknown as string, null as unknown as string]) if (!(await fails(() => approvePreInvoice(id)))) bad.push(`accepted ${JSON.stringify(id)}`);
        return bad.length ? bad.join("; ") : null;
      },
    },
    {
      name: "prepare again: the approved one is untouched (same cents, same number); the drafts are rebuilt",
      async run() {
        // Tamper with a draft: it must be rebuilt to the right figures.
        const other = (await totals()).find((x) => x.status === "DRAFT")!;
        await db.preInvoice.update({ where: { id: other.id }, data: { totalCents: 1 } });
        // Tamper with the approved one: a rebuild must not fix it (it is frozen).
        await db.preInvoice.update({ where: { id: draftId }, data: { totalCents: 999 } });
        const before = (await totals()).find((x) => x.id === draftId);
        const r = await prepareMonth(month);
        const rows = await totals();
        const mine = rows.find((x) => x.id === draftId);
        const fixed = rows.find((x) => x.id === other.id);
        const bad = [
          JSON.stringify(mine) !== JSON.stringify(before) ? "approved row changed" : "",
          fixed?.totalCents !== expected.get(fixed?.client.code ?? "") ? `draft not rebuilt (${fixed?.totalCents})` : "",
          fixed?.number !== other.number ? "draft number changed" : "",
          r.prepared !== expected.size - 1 ? `prepared ${r.prepared}` : "",
          r.skipped.length !== 1 || r.skipped[0].client !== "C001" || r.skipped[0].reason !== "Already approved." ? `skipped ${JSON.stringify(r.skipped)}` : "",
          rows.length !== expected.size ? `${rows.length} rows (duplicates?)` : "",
          JSON.stringify(rows.map((x) => `${x.client.code}:${x.number}`).sort()) !== JSON.stringify(draftNumbers) ? "numbers changed" : "",
        ].filter(Boolean);
        await db.preInvoice.update({ where: { id: draftId }, data: { totalCents: before!.totalCents } });
        return bad.length ? bad.join("; ") : null;
      },
    },
    {
      name: "prepare twice in parallel: no duplicates, no crash",
      async run() {
        const settled = await Promise.allSettled([prepareMonth(month), prepareMonth(month)]);
        const rows = await totals();
        const bad = [
          rows.length !== expected.size ? `${rows.length} rows` : "",
          ...settled.map((s, i) => (s.status === "rejected" ? `call ${i}: ${(s.reason as Error).message.split("\n").pop()}` : "")),
        ].filter(Boolean);
        return bad.length ? bad.join("; ") : null;
      },
    },
  ];

  let failed = 0;
  try {
    await setSession("office");
    for (const c of CASES) {
      let problem: string | null;
      try { problem = await c.run(); } catch (error) { problem = `threw: ${(error as Error).message.split("\n").pop()}`; }
      if (problem) failed++;
      console.log(`${problem ? "FAIL" : "ok  "}  ${c.name}${problem ? `\n      -> ${problem}` : ""}`);
    }
  } finally {
    await db.session.deleteMany({ where: { id: sessionId } });
    await db.preInvoice.deleteMany({ where: range });
    console.log(`(cleaned up: temporary session and the pre-invoices of ${month})`);
  }
  console.log(`\n${CASES.length - failed}/${CASES.length} pass`);
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message.split("\n").pop() : e);
  process.exit(1);
});
