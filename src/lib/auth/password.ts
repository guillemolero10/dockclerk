// Passwords with Node's own scrypt: no dependency to install, no native module to break on Vercel.
// A password is never stored; only "scrypt$N$r$p$salt$hash" (parameters travel with the hash, so they can be raised later).

import { randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// N = 2^16, r = 8, p = 2 is one of the combinations OWASP lists as equivalent for scrypt: about 64 MiB and a quarter of a second.
const N = 1 << 16;
const R = 8;
const P = 2;
const KEY_BYTES = 64;
const SALT_BYTES = 16;
// Node refuses to allocate more than 32 MiB for scrypt unless told to.
const MAX_MEMORY = 256 * 1024 * 1024;

function derive(password: string, salt: Buffer, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_BYTES, { ...options, maxmem: MAX_MEMORY }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** Constant-time comparison of the derived keys. Returns false (never throws) for a malformed hash. */
export async function verifyPassword(password: string, stored: string) {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  // A corrupt row must not be able to ask for gigabytes of memory.
  if (!Number.isInteger(Math.log2(params.N)) || params.N > 1 << 18 || params.r > 16 || params.p > 8) return false;
  try {
    const expected = Buffer.from(hash, "base64url");
    const actual = await derive(password, Buffer.from(salt, "base64url"), params);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** A valid hash of a password nobody knows. Checking an unknown user against it costs the same time as a real check. */
let decoy: Promise<string> | undefined;
export const decoyHash = () => (decoy ??= hashPassword(randomBytes(16).toString("hex")));

// Letters and digits that cannot be confused when read aloud or typed from a printout: no 0/o, 1/l/i.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** 12 characters from a 31-symbol alphabet: about 59 bits, from the OS random generator. */
export function randomPassword(length = 12) {
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}
