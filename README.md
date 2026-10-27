# DockClerk

**Don't replace your warehouse software. Hire an AI clerk that works inside it.**

DockClerk is an AI back-office clerk for small and mid-size logistics warehouses (3PLs), the companies that store and move goods for other businesses. It reads what customers send (emails, WhatsApp messages, voice notes, portal requests) and prepares the work inside the warehouse's existing software. A person approves each piece of work with one click. At the dock, it reads the delivery note and counts the boxes from a photo, so nobody retypes anything.

Built for the **Meta Global AI Developer Hackathon** (Oct 26 – Nov 4, 2026), Indie track, theme *Build for Your World*.

**Live demo:** https://dockclerk.vercel.app. Pick a role on the landing page; there is no sign-up.

---

## Why

I'm from Elche, in the south-east of Spain. Footwear, toy and food makers here rely on small regional 3PLs run by a handful of office staff. Those warehouses run on old desktop software that works, and they won't replace it. Each order still costs a person minutes of reading and retyping:

- a customer emails "send 3 pallets of the red ones to the Valencia platform on Friday morning";
- someone looks up the item, checks the stock, finds which "Valencia platform" they mean and types the outbound;
- a driver hands over a paper delivery note, someone counts the pallets and types it in, and nobody can find the photo of the damaged box a week later.

DockClerk takes the reading and the retyping. It never takes the decision: every record it prepares waits for one click from a person, with the fields it's unsure about marked in yellow.

## Try it (3 minutes)

| Role | Where | What to do |
|---|---|---|
| **Office** | *Enter as office* | **AI inbox**: press *Let the clerk handle it* and watch it read each message, call its tools and draft the outbound. Approve one, then *Light up the pick*: the 3D warehouse shows which pallets to take and the route. |
| | **Dock** | Day timeline for each door. *Let the clerk schedule them* books every waiting truck without overlaps. |
| | **Alerts** | Late trucks, orders short of stock, lots about to expire and full buildings. Each alert links to the right screen and comes with a ready-to-send notice for the customer. |
| | **Analyst** | The weekly report of the second agent: who runs out of stock and when, when a building fills up, which carrier is late on which weekday, which supplier's notes don't match. Each finding comes with its chart, its method and a button that acts on it. Try *30 days* against *6 months* to see why history matters. |
| | **Lot trace** | Type a lot to see the truck that brought it, the rack it sits in and every customer it went to. This is the answer owed to a customer during a recall. |
| **Operator** | *Enter as operator* (phone size) | Today's tasks: unload, put away (the app suggests the slot), pick along a route, voice note to the office. |
| **Driver** | *Driver link* | No app and no account. Photo of the delivery note, *I'm at the gate*, sign with a finger, download the dock receipt. |
| **Customer** | *Enter as customer* | Stock by lot with expiry dates, movements with signed receipts, and an assistant that answers from the live data. Orders go to the office queue. |

All companies, people and goods in the demo are invented.

## Where Meta's models do the work

| Model | Job in DockClerk | Code |
|---|---|---|
| **Muse Spark Open** (open weights, served on Baseten) | The inbox clerk. It reads a message, decides what it is and calls tools against the warehouse database (`find_item`, `check_stock`, `find_consignee`, `last_shipment`, `parse_date`…) in a loop until it can draft the record. | `src/lib/agent/muse.ts` |
| **Muse Spark Open** (the analyst) | Reads the week's statistical findings, decides what matters most and writes the report. A guard checks that every figure it writes is in the data. | `src/lib/analyst/narrate.ts` |
| **Muse Spark** (Meta Model API, vision) | Reads the supplier's delivery note from a phone photo (supplier, note number, lines, lots, pallets) and spots visible damage on the load. | `src/lib/ai/vision.ts` |
| **SAM 3.1** (Meta Model API) | Segments every box in the photo of the load. The count and numbered outlines go on the dock receipt, so the receipt shows why it says "24". | `src/lib/ai/vision.ts` |
| **Muse Voice Transcribe** (Meta Model API) | Turns operators' voice notes from the floor into text for the office inbox. | `src/lib/ai/voice.ts` |

**The model decides, the code checks.** The model never writes to the database. It returns a decision; code checks every item, quantity and destination against the database, then builds the draft. The model can't invent a SKU, ship stock that isn't there or touch another customer's data. In the customer portal, the customer id comes from the session, not from the prompt.

**Plan B is built in.** Every model sits behind a key in `.env`. Without a key, or if a call fails during the demo, the inbox runs on a rules engine with the same contract. At the dock the operator types what the model would have read. The trace in the UI always says which path ran.

## How it is built

- **Next.js 16** (App Router, server actions) + **React 19** + **Tailwind 4**, deployed on **Vercel**.
- **PostgreSQL** (Supabase) with **Prisma 6**. The "legacy warehouse software" is a replica of a typical 3PL schema (clients, items, stock by location and lot, inbounds, outbounds, consignees, carriers). DockClerk only adds tables around it: messages, drafts, dock appointments, receipts and uploads.
- **three.js** 3D warehouse generated from the building's real measurements (length, width, clear height, forklift aisle width, dock doors). It works out the rows, bays and levels, places one mesh instance per pallet, and colours them by customer, age or expiry. An X-ray mode shows the pick and the route.
- **Picking:** each outbound leaves from the building that can fill most of it. Lots go out first-expiring-first, everything else first-in-first-out, and the pick route is ordered along the aisles (`src/lib/warehouse/`).
- **Dock:** 15-minute slots from 06:00 to 20:00 per door, with no overlaps. Inbound doors and outbound doors are kept apart (`src/lib/dock/`).
- **Analyst:** code does the maths and the model does the judgement.
  - Stock-out forecasts: weekly damped Holt against a 4-week average, picked per item by a rolling-origin back-test.
  - Occupancy trends: least squares with an interval on the slope.
  - ABC slotting, priced in seconds of forklift travel and lift.
  - Carrier lateness and delivery quality: Fisher exact tests with Benjamini–Hochberg correction and Wilson intervals.
  - It says what it cannot conclude yet, and why (`src/lib/analyst/`).
  - Runs every Monday at 07:00 through Vercel Cron (the route needs `CRON_SECRET`).
- **Floor loop:** the truck arrives, the driver checks in, the operator receives the goods into a lane by the door, the driver signs, the pallets are put away into suggested slots, picked to a dispatch lane and shipped. Every shipped pallet keeps its lot for traceability (`src/lib/ops/floor.ts`).

```
src/
  app/            office/ operator/ driver/ portal/ receipts/ (one folder per role)
  lib/agent/      the clerk: Muse Spark Open loop, rules engine (plan B), tools, contract
  lib/ai/         Meta Model API clients: vision, SAM 3.1, voice
  lib/warehouse/  layout from measurements, picking, lanes, route, 3D snapshot
  lib/dock/       slots and the day plan
  lib/ops/        floor operations shared by every role
  lib/alerts.ts   lib/trace.ts   lib/clients.ts
  lib/analyst/    the analyst: data, analyses, statistics, report
prisma/           schema, seed and six months of simulated history (invented data, two buildings, ~750 pallets)
```

## Real vs. simulated

- **Real:** the agent loop, the warehouse logic, the 3D, photos and signatures (stored in Postgres), the PDF-ready dock receipt. The model calls (Muse Spark, SAM 3.1, Voice) are wired to the Meta and Baseten APIs; without keys the rules engine stands in.
- **Simulated:** the legacy software is a replica built during the hackathon and filled with invented data. No real email or WhatsApp is sent: the inbox is seeded with sample messages. The six months of history are simulated (seasons, weekdays, min/max replenishment, FIFO lots), with a few patterns planted on purpose so the analyst always has something to find. They are listed in `prisma/history.ts`.

## Run locally

```bash
cp .env.example .env      # database URL, plus model keys if you have them
npm install
npx prisma db push
npm run db:seed           # wipes and recreates the demo data
npm run dev
```

The app runs without any model key, using the rules engine and manual entry. Add `BASETEN_API_KEY` to switch the inbox to Muse Spark Open, and `META_API_KEY` to turn on Muse Spark, SAM 3.1 and Voice Transcribe.

---

Built by Guillermo Molero ([@guillemolero10](https://github.com/guillemolero10)), Data Science & AI student at UMH, Elche.
