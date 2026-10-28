// Changes the password of one account and writes the new one to ../USUARIOS-DEMO.md.
//
//   npm run users:reset -- oficina
//
// The password is random (12 letters and digits) and is never printed or accepted on the command line
// (that would leave it in the shell history). Closes the account's open sessions and clears its login lock.
// Needs the database (mobile data on the UMH wifi).

import { PrismaClient } from "@prisma/client";
import { CREDENTIALS_FILE, DEMO_USERS, resetPassword } from "../prisma/demo-users";

const db = new PrismaClient();

async function main() {
  const username = process.argv[2];
  if (!username || username.startsWith("-")) {
    console.error(`Usage: npm run users:reset -- <user>\nDemo users: ${DEMO_USERS.map((u) => u.username).join(", ")}`);
    process.exit(1);
  }
  const user = await resetPassword(db, username);
  if (!user) {
    console.error(`There is no user "${username}".`);
    process.exit(1);
  }
  console.log(`New password for "${user.username}" written to ${CREDENTIALS_FILE} (sessions of that user closed).`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
