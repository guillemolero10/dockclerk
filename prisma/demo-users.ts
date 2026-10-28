// Demo accounts for the judges (5-8 November). Used by the seed and by `npm run users:reset`.
//
// The seed never deletes User or Session: the passwords handed out in the submission form must survive a reseed.
// It only creates the accounts that are missing, each with a random password that is written ONCE to
// ../USUARIOS-DEMO.md (outside this repo, which is public). Passwords are never printed and never in the repo.

import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import type { PrismaClient, UserRole } from "@prisma/client";
import { hashPassword, randomPassword } from "../src/lib/auth/password";

export const DEMO_URL = "https://dockclerk.vercel.app";
/** meta-hackathon/USUARIOS-DEMO.md, next to the planning notes. USERS_FILE overrides it (tests). */
export const CREDENTIALS_FILE = process.env.USERS_FILE?.trim() || path.resolve(__dirname, "..", "..", "USUARIOS-DEMO.md");

export type DemoUser = { username: string; name: string; role: UserRole; /** Stable code of the customer, never its database id. */ clientCode?: string; sees: string };

export const DEMO_USERS: DemoUser[] = [
  { username: "oficina", name: "Oficina · Office", role: "office", sees: "Bandeja con IA, almacén 3D, muelle, alertas, analista, trazabilidad, clientes" },
  { username: "operario", name: "Operario · Operator", role: "operator", sees: "PDA en el móvil: recibir, ubicar, recoger, nota de voz" },
  { username: "juguetes-levante", name: "Juguetes Levante, S.L.", role: "customer", clientCode: "C001", sees: "Portal de Juguetes Levante (juguetes)" },
  { username: "serra-mariola", name: "Polímeros Serra Mariola, S.L.", role: "customer", clientCode: "C002", sees: "Portal de Polímeros Serra Mariola (granza de plástico)" },
  { username: "calzados-vinalopo", name: "Calzados Vinalopó Sur, S.L.", role: "customer", clientCode: "C003", sees: "Portal de Calzados Vinalopó Sur (calzado)" },
  { username: "bebidas-montgo", name: "Bebidas Montgó, S.A.", role: "customer", clientCode: "C004", sees: "Portal de Bebidas Montgó (bebidas)" },
  { username: "textil-biar", name: "Textil Biar, S.L.", role: "customer", clientCode: "C005", sees: "Portal de Textil Biar (textil)" },
  { username: "granzas-mediterraneo", name: "Granzas del Mediterráneo, S.L.", role: "customer", clientCode: "C006", sees: "Portal de Granzas del Mediterráneo (compuestos plásticos)" },
  { username: "cosmetica-aitana", name: "Cosmética Aitana, S.L.", role: "customer", clientCode: "C007", sees: "Portal de Cosmética Aitana (cosmética)" },
  { username: "dulces-carrascal", name: "Dulces Carrascal, S.L.", role: "customer", clientCode: "C008", sees: "Portal de Dulces Carrascal (dulces)" },
];

const ROLE_LABEL: Record<UserRole, string> = { office: "Oficina", operator: "Operario", customer: "Cliente" };

// ---------- the credentials file ----------

const HEADER = `# Cuentas de demostración de DockClerk

**Web:** ${DEMO_URL}

Este archivo vive fuera del repositorio (que es público). Las contraseñas son estables: \`npm run db:seed\` NO las cambia, solo crea las cuentas que falten.
Para cambiar una: \`npm run users:reset -- <usuario>\` (la nueva contraseña se apunta aquí).
El conductor no tiene cuenta: su enlace sale de la pantalla Dock de la oficina.

| Usuario | Contraseña | Rol | Qué ve |
|---|---|---|---|
`;

const ROW = /^\| `([^`]+)` \|/;

function readRows() {
  const rows = new Map<string, string>();
  if (!existsSync(CREDENTIALS_FILE)) return rows;
  for (const line of readFileSync(CREDENTIALS_FILE, "utf8").split("\n")) {
    const match = ROW.exec(line);
    if (match) rows.set(match[1], line);
  }
  return rows;
}

/** Writes (or replaces) the row of one account. The only place a password is ever written down. */
function saveCredential(user: { username: string; role: UserRole }, password: string) {
  const rows = readRows();
  const demo = DEMO_USERS.find((d) => d.username === user.username);
  rows.set(user.username, `| \`${user.username}\` | \`${password}\` | ${ROLE_LABEL[user.role]} | ${demo?.sees ?? "—"} |`);
  const order = [...DEMO_USERS.map((d) => d.username), ...[...rows.keys()].filter((u) => !DEMO_USERS.some((d) => d.username === u))];
  const body = order.filter((u) => rows.has(u)).map((u) => rows.get(u)!).join("\n");
  writeFileSync(CREDENTIALS_FILE, `${HEADER}${body}\n`, { mode: 0o600 });
  chmodSync(CREDENTIALS_FILE, 0o600);
}

// ---------- accounts ----------

/**
 * Creates the demo accounts that do not exist yet (random password, written to the credentials file) and re-links
 * each customer account to its company by the company's stable code. Existing accounts keep their password.
 */
export async function ensureDemoUsers(db: PrismaClient) {
  const clients = await db.client.findMany({ select: { id: true, code: true } });
  const idOfCode = new Map(clients.map((c) => [c.code, c.id]));
  const inFile = readRows();
  const created: string[] = [];
  const relinked: string[] = [];
  const notInFile: string[] = [];

  for (const demo of DEMO_USERS) {
    const clientId = demo.clientCode ? idOfCode.get(demo.clientCode) : undefined;
    if (demo.clientCode && !clientId) throw new Error(`Demo user ${demo.username}: there is no customer with code ${demo.clientCode}. Create the customers before the users.`);

    const existing = await db.user.findUnique({ where: { username: demo.username } });
    if (!existing) {
      const password = randomPassword();
      await db.user.create({
        data: { username: demo.username, name: demo.name, role: demo.role, clientId: clientId ?? null, passwordHash: await hashPassword(password) },
      });
      saveCredential(demo, password);
      created.push(demo.username);
      continue;
    }
    if (existing.clientId !== (clientId ?? null)) {
      await db.user.update({ where: { id: existing.id }, data: { clientId: clientId ?? null } });
      relinked.push(demo.username);
    }
    if (!inFile.has(demo.username)) notInFile.push(demo.username);
  }
  return { created, relinked, notInFile };
}

/** A new random password for one account: closes its sessions, clears its login lock and writes the new one to the credentials file. */
export async function resetPassword(db: PrismaClient, username: string) {
  const name = username.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { username: name } });
  if (!user) return null;
  const password = randomPassword();
  await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } }),
    db.session.deleteMany({ where: { userId: user.id } }),
    db.rateLimit.deleteMany({ where: { key: { startsWith: `login:${name}:` } } }),
  ]);
  saveCredential(user, password);
  return user;
}
