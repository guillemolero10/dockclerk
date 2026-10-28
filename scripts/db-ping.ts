// Quick "is the database reachable?" check: one SELECT 1 with a short timeout.
//   npx tsx --env-file=.env scripts/db-ping.ts
// Exit 0 = answers, 1 = no answer (typical on the UMH wifi: connect with the phone's data first).
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const limit = new Promise<never>((_, no) => setTimeout(() => no(new Error("no answer in 12 s")), 12_000));

Promise.race([db.$queryRaw`SELECT 1`, limit])
  .then(() => {
    console.log("database: ok");
    process.exit(0);
  })
  .catch((err) => {
    console.log(`database: NOT reachable (${err instanceof Error ? err.message.split("\n").pop() : String(err)})`);
    process.exit(1);
  });
