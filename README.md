# DockClerk

**Don't replace your warehouse software. Hire an AI clerk that works inside it.**

DockClerk is an AI back-office clerk for small and mid-size logistics warehouses (3PLs), the companies that store and move goods for other businesses. It reads what customers send (emails, WhatsApp messages, portal requests) and prepares the work inside the warehouse's existing software. A person approves each piece of work with one click. At the dock, it reads the delivery note and counts the boxes from a photo, so nobody retypes anything.

Built for the **Meta Global AI Developer Hackathon** (Oct 26 – Nov 4, 2026), Indie track, theme *Build for Your World*.

**Live demo:** https://dockclerk.vercel.app. Sign in with one of the demo accounts (the user names and passwords come with the hackathon submission form). The app speaks English and Spanish (switch with **ES | EN**).

**Video (3:00):** _link added with the submission_

---

## Why

I'm from Elche, in the south-east of Spain, and I worked as a forklift driver in a logistics warehouse. Footwear, toy and food makers here rely on small regional 3PLs run by a handful of office staff. Those warehouses run on old desktop software that works, and they won't replace it. Each order still costs a person minutes of reading and retyping:

- a customer emails "send 3 pallets of the red ones to the Valencia platform on Friday morning";
- someone looks up the item, checks the stock, finds which "Valencia platform" they mean and types the outbound;
- a driver hands over a paper delivery note, someone counts the pallets and types it in, and nobody can find the photo of the damaged box a week later;
- at month end, someone works out by hand how many pallet-days each customer owes.

DockClerk takes the reading and the retyping. It never takes the decision: every record it prepares waits for one click from a person, with the fields it's unsure about marked in yellow.

## Try it (3 minutes)

There are demo accounts: `oficina` (office), `operario` (warehouse operator) and one per customer (`juguetes-levante`, `bebidas-montgo`…). The passwords are in the submission form, not in this repo. The driver has no account.

| Role | Where | What to do |
|---|---|---|
| **Office** | Sign in as `oficina` | **AI inbox**: press *Let the clerk handle N messages* and watch it read each message, call its tools and draft the outbound. The order for "Hipermercados Turia" has a yellow field (the chain has two hubs): choose one, approve, then *Light up the pick*: the 3D warehouse shows which pallets to take and the route. *Replay the morning* starts the demo again. |
| | **Dock** | Day timeline for each door. *Let the clerk schedule them* books every waiting truck without overlaps. The driver's link for each truck is here. |
| | **Billing** | *Prepare pre-invoices* for last month: storage pallet by pallet, handling in and out, with a check that the detail adds up to the summary. A person approves each one. Pre-invoices only, not legal invoices. |
| | **Alerts** | Late trucks, orders short of stock, lots about to expire and full buildings, each with a ready-to-send notice for the customer. |
| | **Analyst** | The weekly report of the second agent: who runs out of stock and when, when a building fills up, which carrier is late on which weekday. Each finding comes with its chart, its method and, where it applies, a button that acts on it. |
| | **Lot trace** | Type a lot to see the truck that brought it, the pallet IDs, the rack it sits in and every customer it went to. |
| **Operator** | Sign in as `operario` (phone size) | The handheld: unload, put away, pick, all by scanning the pallet label (camera button next to each field, or type it). *Report damage* takes a photo of the load and SAM 3.1 numbers the boxes. Voice note to the office for incidents. |
| **Driver** | Link from the office's **Dock** screen | No app and no account. Photo of the delivery note, *I'm at the gate*, sign with a finger, download the dock receipt. |
| **Customer** | Sign in as a customer (e.g. `juguetes-levante`) | Stock by lot and pallet with expiry dates, movements with signed receipts, and an assistant that answers from the live data ("how much have I spent on storage this month?"). Orders go to the office queue already drafted. |

All companies, people, goods and photos in the demo are invented or made by me.

## Where Meta's models do the work

| Model | Job in DockClerk | Code |
|---|---|---|
| **Muse Spark Open** (open weights, `meta-models/muse-spark-open-1026` on Baseten) | The inbox clerk and the customer assistant. It reads a message, decides what it is and calls tools against the warehouse database (`find_item`, `check_stock`, `find_consignee`, `convert_quantity`, `bill_so_far`, `explain_charge`…) in a loop until it can draft the record or the answer. | `src/lib/agent/muse.ts`, `tools.ts` |
| **Muse Spark Open** (the analyst) | Reads the week's statistical findings, decides what matters most and writes the report. | `src/lib/analyst/narrate.ts` |
| **Muse Spark** (`muse-spark-1.3`, Meta Model API, vision) | Reads the supplier's delivery note from a phone photo: supplier, note number, lines, lots, pallets and pallet IDs. Then looks at the numbered boxes and says which one is damaged. If the Meta API fails, Muse Spark Open on Baseten takes over within the same time limit. | `src/lib/ai/vision.ts` |
| **SAM 3.1** (open weights, my own GPU endpoint on Modal) | Segments every box and pallet in the photo of the load. The numbered outlines go on the dock receipt, so the receipt shows why it says "12" and which box is damaged. | `modal/sam_service.py`, `src/lib/ai/vision.ts` |
| **Muse Voice Transcribe** (`muse-voice-transcribe-1.0`, Meta Model API) | Turns the operator's voice notes from the floor into text for the office, with customer names as hints. The browser converts the recording to 16 kHz WAV first. | `src/lib/ai/voice.ts`, `src/lib/audio/` |

**The model decides, the code checks.** The model never writes to the database. It returns a decision; code checks every item, quantity and destination against the database, then builds the draft.
- It can't invent a SKU, ship stock that isn't there or touch another customer's data. In the customer portal, the customer id comes from the session, never from the prompt.
- A guard checks every figure the model writes: a quantity only stands if the customer's message says it, or if it comes out of `convert_quantity` from what the customer wrote ("2 and a half pallets of horchata" → 2 pallets + 50 boxes). Otherwise the field turns yellow.
- Money is computed by code. The assistant explains a charge from the same numbers; a figure that isn't in the data is rejected.

**Plan B is built in.** Every model sits behind a key. Without a key, or if a call fails or runs past its time limit, the inbox runs on a rules engine with the same contract and the operator types what the model would have read. The log in the UI always says which path ran. A daily budget (`AI_DAILY_BUDGET_USD`, default $3) caps spending; past it, the rules engine and the analyst's template answer.

## How it is built

- **Next.js 16** (App Router, server actions) + **React 19** + **Tailwind 4**, deployed on **Vercel** (functions in Dublin, next to the database).
- **PostgreSQL** (Supabase, EU) with **Prisma 6**. The "legacy warehouse software" is a replica of a typical 3PL schema (clients, items, stock by location and lot, inbounds, outbounds, consignees, carriers). DockClerk adds tables around it (messages, drafts, dock appointments, receipts, uploads, tariffs, pre-invoices, users and sessions) and a few columns such as pallet IDs.
- **Pallets as the warehouse counts them:**
  - Every pallet has an ID (the supplier's, if the note has one, or a generated `N1-000123`), unique while it's in the building.
  - Mixed pallets (one ID, several items or lots) count as one pallet.
  - Orders can be in pallets, boxes or fractions ("2.5 pallets"); picking takes whole pallets first and splits one pallet if needed. The split leaves a new labelled pallet in the dispatch lane and a loose pallet on the rack.
- **Scanning:** Code 128 labels for pallets (`/labels`). The handheld reads them with a keyboard-wedge scanner or with the phone camera (`BarcodeDetector`), and when a pallet is scanned the server checks that it is the one to pick. Racks need no labels: only the pallet is scanned.
- **3D warehouse** (three.js) generated from the building's real measurements (length, width, clear height, forklift aisle width, dock doors). It works out the rows, bays and levels, draws one pallet per pallet ID and colours them by customer, age or expiry. An X-ray mode shows the pick and the route.
- **Picking:** each outbound leaves from the building that can fill most of it. Lots go out first-expiring-first, everything else first-in-first-out, and the pick route is ordered along the aisles (`src/lib/warehouse/`).
- **Dock:** 15-minute slots from 06:00 to 20:00 per door, with no overlaps. Inbound doors and outbound doors are kept apart (`src/lib/dock/`).
- **Billing** (`src/lib/billing/`): storage by pallet-day (last day included), handling per pallet in and out, and loose pallets charged by fraction or as a full pallet, per customer. The rules are the ones of the warehouse where I worked one summer. Approved pre-invoices are frozen.
- **Analyst:** code does the maths and the model does the judgement.
  - Stock-out forecasts: weekly damped Holt against a 4-week average, picked per item by a rolling-origin back-test.
  - Occupancy trends: least squares with an interval on the slope.
  - ABC slotting, priced in seconds of forklift travel and lift.
  - Carrier lateness and delivery quality: Fisher exact tests with Benjamini–Hochberg correction and Wilson intervals.
  - It says what it cannot conclude yet, and why (`src/lib/analyst/`). Runs every Monday at 07:00 Spanish time through Vercel Cron.
- **Floor loop:** the truck arrives, the driver checks in, the operator receives the goods into a lane by the door, the driver signs, the pallets are put away into suggested slots, picked to a dispatch lane and shipped. Every shipped pallet keeps its ID and lot for traceability (`src/lib/ops/floor.ts`).
- **Accounts and permissions:** real users in the database (office, operator, customer), not a role picker.
  - Passwords are hashed with Node's `scrypt` (random salt per user, constant-time comparison).
  - Sessions live in the database; the cookie holds only 32 random bytes and the table keeps their SHA-256. There is no signing secret to leak.
  - Every page, server action and route checks the role on the server (`src/lib/session.ts`). A customer only opens the receipts and files of their own deliveries; the driver's link opens one delivery and nothing else.
  - Ten failed logins lock that user, from that address, for 15 minutes. Voice notes, customer questions and the driver's photos are rate-limited.
- **Tests:** pure checks with no database (`scripts/pallets-check.ts`, `billing-check.ts`, `agent-tools-check.ts`, `seed-days-check.ts`, `vision-check.ts`, `audio-check.ts`), checks against the database (`npm run db:checks`, including the clerk's evaluation sets with and without the model) and an end-to-end run in a real browser (`npm run e2e`, Playwright).

```
src/
  app/            office/ operator/ driver/ portal/ receipts/ labels/ (one folder per role)
  lib/agent/      the clerk: Muse Spark Open loop, tools, figure guard, rules engine (plan B)
  lib/ai/         model clients: vision, SAM 3.1, voice, daily budget
  lib/pallets/    quantities, pallet IDs, breakdown of a delivery, scanning
  lib/warehouse/  layout from measurements, picking, lanes, route, 3D snapshot
  lib/billing/    calendar, stays, charges, pre-invoices
  lib/dock/       slots and the day plan
  lib/ops/        floor operations shared by every role
  lib/analyst/    the analyst: data, analyses, statistics, report
  lib/i18n/       English and Spanish
modal/            SAM 3.1 service (GPU on Modal, behind Modal's proxy auth)
prisma/           schema, seed and six months of simulated history (invented data, two buildings, ~750 pallets)
```

## Real vs. simulated

- **Real:** the agent loop, the model calls (Muse Spark, Muse Spark Open, SAM 3.1, Voice Transcribe), the warehouse logic, billing, the 3D, scanning, photos and signatures (stored in Postgres) and the dock receipt.
- **Simulated:** the legacy software is a replica built during the hackathon and filled with invented data. No real email or WhatsApp is received or sent: the inbox is seeded with sample messages and replies are drafted, not sent. The six months of history are simulated (seasons, weekdays, min/max replenishment, FIFO lots), with a few patterns planted on purpose so the analyst always has something to find; they are listed in `prisma/history.ts`. The box photo and the delivery note used in the video are illustrations made for the demo, with invented data; the models read them live on the deployed site.

## Built during the hackathon

Everything in this repository was written between Oct 26 and Nov 4, 2026, starting from an empty repo (first commit: Oct 26). The commit history is the record. No code was reused from earlier projects.

## Run locally

```bash
cp .env.example .env      # database URL, plus model keys if you have them
npm install
npx prisma db push
npm run db:seed           # wipes and recreates the demo data, keeps the accounts
npm run dev
```

The seed creates the demo accounts that are missing, each with a random password that it writes **once** to a file outside the repository; it never prints them and never changes the password of an account that exists. To change one: `npm run users:reset -- <user>`.

The app runs without any model key, using the rules engine and manual entry. Add `BASETEN_API_KEY` to switch the inbox, the customer assistant, the analyst and photo reading to Muse Spark Open; `META_API_KEY` moves photo reading to Muse Spark and turns on Voice Transcribe; `SAM_API_KEY` + `META_SAM_URL` (commented in `.env.example`) turn on SAM 3.1 (deploy it with `modal deploy modal/sam_service.py`, see `modal/README.md`). Sessions need no secret.

---

Built by Guillermo Molero ([@guillemolero10](https://github.com/guillemolero10)), Data Science & AI student at UMH, Elche.
