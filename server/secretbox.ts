// server/secretbox.ts — authenticated encryption for the few user secrets that
// have to be *stored* rather than hashed.
//
// Today that is the test account a dynamic analysis signs into the app with
// (server/models/DynamicCredentials.ts). A login password we would hash and
// never see again; these have to be replayed by the analysis engine, so they
// must come back out. What they can be is sealed, so that a copy of cmaa.db — a
// backup, a snapshot of the sqlite-data volume, a stolen disk — is not by itself
// a list of other people's passwords. The key lives in the environment
// (DYNAMIC_CRED_KEY), which is the one place the database file is not.
//
// AES-256-GCM rather than CBC: the auth tag turns a tampered-with ciphertext
// into a decryption *failure* instead of a silently different plaintext, and the
// same tag is what makes a wrong key fail loudly (see unseal()).

import crypto from "crypto";

const ENV_KEY = "DYNAMIC_CRED_KEY";
/** Prefix on every sealed value, so a future scheme can be told apart from this one. */
const VERSION = "v1";

function loadKey(): Buffer | null {
  const raw = (process.env[ENV_KEY] ?? "").trim();
  if (!raw) return null;

  const key = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");

  // Refuse to boot rather than quietly accept a short key: Buffer.from() happily
  // accepts a typo'd or truncated value, and a key that "works" while
  // protecting less than it claims is discovered on the worst possible day.
  if (key.length !== 32) {
    throw new Error(
      `${ENV_KEY} must be 32 bytes — 64 hex chars or base64 (got ${key.length} bytes). ` +
        `Generate one with: openssl rand -hex 32`
    );
  }
  return key;
}

const KEY = loadKey();

if (!KEY) {
  console.warn(
    `[secretbox] ${ENV_KEY} is not set — dynamic analysis test accounts cannot be ` +
      `stored (they are refused, never written in the clear)`
  );
}

/**
 * Whether secrets can be stored at all. Callers check this and say so out loud;
 * nothing here ever falls back to writing a secret unencrypted.
 */
export function sealingAvailable(): boolean {
  return KEY !== null;
}

export function seal(plaintext: string): string {
  if (!KEY) throw new Error(`${ENV_KEY} is not set — refusing to store a secret in the clear`);
  const iv = crypto.randomBytes(12); // 96-bit nonce, fresh per value, as GCM wants
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    VERSION,
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
}

/**
 * Reverse of seal(). Throws if the key has changed, the value was truncated, or
 * anyone edited the ciphertext in the database — all of which are the same thing
 * from here: this value cannot be trusted to be what was stored.
 */
export function unseal(sealed: string): string {
  if (!KEY) throw new Error(`${ENV_KEY} is not set — cannot read stored secrets`);
  const [version, iv, tag, ciphertext] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error("sealed value is malformed");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
