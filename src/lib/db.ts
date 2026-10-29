import { PrismaClient } from "@prisma/client";

// One client per server instance (avoids exhausting connections during hot reload).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/**
 * For interactive transactions (`db.$transaction(async (tx) => ...)`): Prisma stops them after 5 s by default, and with the
 * database in Ireland and several queries one after another that is too tight. Batches (`$transaction([...])`) do not need it.
 */
export const longTransaction = { timeout: 20_000, maxWait: 10_000 } as const;
