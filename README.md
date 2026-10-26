# DockClerk

**Don't replace your warehouse software. Hire an AI clerk that works inside it.**

DockClerk is an AI back-office agent for small and mid-size logistics warehouses (3PLs) that store and move goods for other companies. It reads what customers send (emails, WhatsApp texts and voice notes, portal requests), prepares the work inside the warehouse's existing software, and lets a human approve it with one click. At the dock, it reads the delivery note and counts the boxes on a pallet with **SAM 3.1**, so nobody types anything.

Built for the **Meta Global AI Developer Hackathon** (Oct 26 - Nov 4, 2026), Indie track, theme *Build for Your World*.

> 🚧 Work in progress. Everything in this repository was built during the hackathon.

## Who uses it
| Role | What they get |
|---|---|
| Office | Inbox handled by the AI clerk, approval queue, the legacy software |
| Warehouse operator | Today's tasks and dock receiving from the phone |
| Truck driver | A link (no app, no account) to send the delivery note and sign the receipt |
| Customer | Portal with stock, movements, receipts and an assistant limited to their own data |

## Real vs. simulated
- **Real:** the agent and every model call (Muse Spark, Muse Spark Open, SAM 3.1, Muse Voice Transcribe).
- **Simulated:** the "legacy warehouse software" is a replica built during the hackathon with invented companies and data. The inbox is simulated; no real email or WhatsApp is sent.

## Run locally
```bash
cp .env.example .env.local   # fill in your keys
npm install
npx prisma db push && npm run dev
```
