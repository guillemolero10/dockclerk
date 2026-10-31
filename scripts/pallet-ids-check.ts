// Pallet IDs and mixed pallets against the real database, outside Next: receive pallet by pallet, put away a mixed pallet,
// pick one item off the seeded mixed pallet OBR-JIJ-0042, ship, and "Replay the morning" puts it back as it was.
// WRITES to the database (a test delivery, a test outbound, a replay that also clears drafts): it ships part of the seeded mixed pallet, so run `npm run db:seed` before each run and afterwards.
//
//   npx tsx --env-file=.env scripts/pallet-ids-check.ts
//
// Needs mobile data on the UMH wifi. Exit code 1 if any step fails.

import { createHash, randomBytes } from "node:crypto";
import Module from "node:module";

const token = randomBytes(32).toString("base64url");
const fakes: Record<string, unknown> = {
  "next/headers": { cookies: async () => ({ get: (name: string) => (name === "dockclerk_session" ? { value: token } : undefined), set() {}, delete() {} }) },
  "next/cache": { revalidatePath() {} },
  "next/navigation": { redirect: (to: string) => { throw new Error(`redirect:${to}`); } },
};
const M = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const realLoad = M._load;
M._load = function (request: string, ...rest: unknown[]) {
  return request in fakes ? fakes[request] : realLoad.call(this, request, ...rest);
};

const made = { inbounds: [] as string[], outbounds: [] as string[] };
const results: { name: string; miss: string | null }[] = [];
const check = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  results.push({ name, miss: g === w ? null : `got ${g}, expected ${w}` });
};

async function main() {
  const { db } = await import("../src/lib/db");
  const { confirmReceipt, putAway, openPickPlans, pickPallet, shipOutbound } = await import("../src/lib/ops/floor");
  const { receive, putAwayAll } = await import("../src/app/operator/actions");
  const { resetInbox } = await import("../src/app/office/inbox/actions");

  const sessionId = createHash("sha256").update(token).digest("hex");
  const user = async (role: "office" | "operator") => (await db.user.findFirstOrThrow({ where: { role }, select: { id: true } })).id;
  const login = async (role: "office" | "operator") => {
    await db.session.deleteMany({ where: { id: sessionId } });
    await db.session.create({ data: { id: sessionId, userId: await user(role), expiresAt: new Date(Date.now() + 3600_000) } });
  };

  const client = await db.client.findUniqueOrThrow({ where: { code: "C008" } });
  const wh = await db.warehouse.findFirstOrThrow({ where: { stock: { some: { palletCode: "OBR-JIJ-0042" } } } });
  const item = async (sku: string) => db.item.findFirstOrThrow({ where: { clientId: client.id, sku } });
  const [turron, polvoron] = [await item("TURRON-BLA"), await item("POLVORON")];
  const mixedRows = async () => (await db.stock.findMany({ where: { palletCode: "OBR-JIJ-0042" }, orderBy: { id: "asc" }, select: { id: true, units: true, pallets: true, palletShare: true, location: true, outboundId: true, splitFrom: true, itemId: true } }));
  const before = await mixedRows();
  if (before.length !== 2) throw new Error("OBR-JIJ-0042 is not intact (a previous run shipped part of it): run npm run db:seed first");
  const mk = async () => { const i = await db.inbound.create({ data: { date: new Date(), clientId: client.id, warehouseId: wh.id, status: "RECEIVING" } }); made.inbounds.push(i.id); return i; };

  // ---- receiving ----
  const startNo = (await db.warehouse.findUniqueOrThrow({ where: { id: wh.id } })).nextPalletNo;
  const inb = await mk();
  const line = (itemId: string, units: number, lot = "T-L1") => ({ itemId, lot, expiresAt: "2027-09-01", units });
  await login("operator");
  const out = await receive(inb.id, [
    { code: "tst 0001", lines: [line(turron.id, turron.unitsPerPallet)] },
    { code: null, lines: [line(turron.id, turron.unitsPerPallet)] },
    { code: null, lines: [line(turron.id, 20), line(polvoron.id, 30, "P-L1")] },
  ], 0, "");
  const gen = [`${wh.code}-${String(startNo).padStart(6, "0")}`, `${wh.code}-${String(startNo + 1).padStart(6, "0")}`];
  check("receive: only the pallets without an ID get a generated one, in order", out, { codes: gen });
  const got = await db.stock.findMany({ where: { inboundId: inb.id }, orderBy: { id: "asc" } });
  check("receive: 4 rows for 3 pallets, Σ pallets = 3, the supplier's ID cleaned", { rows: got.length, pallets: got.reduce((a, r) => a + r.pallets, 0), codes: [...new Set(got.map((r) => r.palletCode))] }, { rows: 4, pallets: 3, codes: ["TST0001", gen[0], gen[1]] });
  const mixed = got.filter((r) => r.palletCode === gen[1]);
  check("receive: the mixed pallet shares 20/70 + 30/80 = 1, head is the bigger share", mixed.map((r) => [r.pallets, r.palletShare !== null && Math.abs(r.palletShare - (r.itemId === turron.id ? 0.2857142857 / 0.6607142857 : 0.375 / 0.6607142857)) < 1e-6]).sort(), [[0, true], [1, true]].sort());
  const rec = await db.dockReceipt.findUnique({ where: { inboundId: inb.id } });
  const inbDone = await db.inbound.findUniqueOrThrow({ where: { id: inb.id }, include: { lines: true } });
  check("receive: receipt keeps the breakdown; inbound totals are pallets, not rows", { pallets: (rec?.pallets as unknown[] | null)?.length, rp: inbDone.receivedPallets, lines: inbDone.lines.length }, { pallets: 3, rp: 3, lines: 2 });
  check("receive: the counter moved by the 2 generated IDs", (await db.warehouse.findUniqueOrThrow({ where: { id: wh.id } })).nextPalletNo, startNo + 2);
  check("receive again (double click): nothing written, no codes", await confirmReceipt(inb.id, [{ code: null, lines: [line(turron.id, 5)] }], [], null), { codes: [] });
  const inb2 = await mk();
  const dup = await receive(inb2.id, [{ code: "TST0001", lines: [line(turron.id, 5)] }], 0, "");
  check("receive: an ID that is inside already → fixable error naming the slot", dup, { error: `Pallet ID TST0001 is already in the building (REC-${got[0].location.slice(4)}).` });
  check("receive: a failed receive leaves the delivery open", (await db.inbound.findUniqueOrThrow({ where: { id: inb2.id } })).status, "RECEIVING");
  const dup2 = await receive(inb2.id, [{ code: null, lines: [line(turron.id, 100)] }], 0, "");
  check("receive: too many boxes for a pallet → fixable error", dup2, { error: `Pallet 1: 100 boxes of TURRON-BLA do not fit on one pallet (${turron.unitsPerPallet} max).` });

  // ---- put away: the mixed pallet moves as one ----
  const slot = (await db.stock.findMany({ where: { warehouseId: wh.id }, select: { location: true } })).map((s) => s.location);
  const { makeLayout } = await import("../src/lib/warehouse/layout");
  const free = makeLayout(wh).rackSlotsInFillOrder().find((c) => !slot.includes(c))!;
  await putAway(mixed[0].id, free);
  check("put away: both rows of the mixed pallet land in the same slot", (await db.stock.findMany({ where: { palletCode: gen[1] } })).map((r) => r.location), [free, free]);
  let err = "";
  try { await putAway(got[0].id, free); } catch (e) { err = (e as Error).message; }
  check("put away: a taken slot is refused", err, `${free} is taken.`);
  await login("operator");
  const waitingBefore = await db.stock.count({ where: { inboundId: inb.id, location: { startsWith: "REC-" } } });
  const movedPallets = await putAwayAll(wh.code);
  check("put away all: counts pallets (not rows) and leaves nothing waiting from this delivery", { waitingBefore, ok: movedPallets >= 2, left: await db.stock.count({ where: { inboundId: inb.id, location: { startsWith: "REC-" } } }) }, { waitingBefore: 2, ok: true, left: 0 });

  // ---- pick one item off the mixed pallet ----
  const order = await db.outbound.create({ data: { date: new Date(), clientId: client.id, status: "REQUESTED", lines: { create: [{ itemId: polvoron.id, pallets: 1, units: 40 }] } } });
  made.outbounds.push(order.id);
  const plan = (await openPickPlans()).plans.get(order.id)!;
  const mixedStep = plan.steps[0];
  check("plan: 40 boxes of POLVORON → one `boxes` step on the mixed pallet (FEFO picks the sooner-expiring lot)", { kind: mixedStep?.kind, code: mixedStep && "palletCode" in mixedStep ? mixedStep.palletCode : null, steps: plan.steps.length }, { kind: "boxes", code: "OBR-JIJ-0042", steps: 1 });
  const rowId = mixedStep.kind === "boxes" ? mixedStep.stockId : "";
  let wrong = "";
  try { await pickPallet(order.id, rowId, 7); } catch (e) { wrong = (e as Error).message; }
  check("pick: wrong box count is refused", wrong.startsWith("Take 40 boxes"), true);
  const picked = await pickPallet(order.id, rowId);
  const lane = await db.stock.findMany({ where: { outboundId: order.id } });
  const left = await mixedRows();
  check("pick: the item goes to a NEW pallet in EXP with a generated ID and splitFrom", { n: lane.length, loc: lane[0]?.location.startsWith("EXP-"), code: lane[0]?.palletCode === picked.newCode && !!picked.newCode, from: lane[0]?.splitFrom, share: lane[0]?.palletShare, pallets: lane[0]?.pallets, done: picked.done }, { n: 1, loc: true, code: true, from: "OBR-JIJ-0042", share: null, pallets: 1, done: true });
  check("pick: the pallet left behind has one row, is its own pallet again (head, no share)", left.map((r) => [r.pallets, r.palletShare, r.outboundId]), [[1, null, null]]);
  check("pick: the outbound is prepared", (await db.outbound.findUniqueOrThrow({ where: { id: order.id } })).status, "PREPARED");

  // ---- ship ----
  await shipOutbound(order.id);
  const shipped = (await db.outbound.findUniqueOrThrow({ where: { id: order.id } })).shipped as { palletCode: string; splitFrom: string; palletShare: number | null }[];
  check("ship: `shipped` carries palletCode and splitFrom", shipped.map((s) => [s.palletCode === picked.newCode, s.splitFrom, s.palletShare]), [[true, "OBR-JIJ-0042", null]]);

  // ---- replay: a fresh outbound taken and put back ----
  const order2 = await db.outbound.create({ data: { date: new Date(), clientId: client.id, status: "REQUESTED", lines: { create: [{ itemId: turron.id, pallets: 1, units: 35 }] } } });
  made.outbounds.push(order2.id);
  const stockBefore = await mixedRows();
  const plan2 = (await openPickPlans()).plans.get(order2.id)!;
  const s2 = plan2.steps[0];
  await pickPallet(order2.id, s2.kind === "boxes" ? s2.stockId : s2.stockIds[0], s2.kind === "boxes" && s2.units < 70 ? s2.units : undefined);
  await db.draft.create({ data: { kind: "CREATE_OUTBOUND", status: "APPROVED", payload: { outboundId: order2.id } } });
  await login("office");
  await resetInbox();
  const after = await mixedRows();
  check("replay: nothing of order2 stays in a lane and its outbound is gone", { lane: await db.stock.count({ where: { outboundId: order2.id } }), ob: await db.outbound.count({ where: { id: order2.id } }) }, { lane: 0, ob: 0 });
  check("replay: the mixed pallet has the same rows, units, location, ID and head as before the pick", after.map((r) => [r.id, r.units, r.pallets, r.location, r.palletShare]), stockBefore.map((r) => [r.id, r.units, r.pallets, r.location, r.palletShare]));
  check("audit: rows with an ID in a lane without an owner", await db.stock.count({ where: { location: { startsWith: "EXP-" }, outboundId: null } }), 0);

  void before;
}

async function cleanUp() {
  const { db } = await import("../src/lib/db");
  await db.stock.deleteMany({ where: { OR: [{ inboundId: { in: made.inbounds } }, { outboundId: { in: made.outbounds } }] } });
  await db.outbound.deleteMany({ where: { id: { in: made.outbounds } } });
  await db.inbound.deleteMany({ where: { id: { in: made.inbounds } } });
  await db.session.deleteMany({ where: { id: createHash("sha256").update(token).digest("hex") } });
}

main()
  .catch((e) => { results.push({ name: "script", miss: `threw ${e instanceof Error ? e.stack : String(e)}` }); })
  .finally(async () => {
    await cleanUp().catch((e) => console.log(`clean-up failed: ${e}`));
    let failed = 0;
    for (const r of results) { if (r.miss) failed++; console.log(`${r.miss ? "FAIL" : "pass"}  ${r.name}${r.miss ? `\n      ${r.miss}` : ""}`); }
    console.log(`\n${results.length - failed}/${results.length} pass (now run: npm run db:seed)`);
    process.exit(failed ? 1 : 0);
  });
