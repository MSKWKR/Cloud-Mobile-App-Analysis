import { db } from "../db";
import { seal, unseal, sealingAvailable } from "../secretbox";

/**
 * Test-account credentials for one dynamic analysis run.
 *
 * A dynamic run only sees what an anonymous user sees; hand it an account and it
 * can enumerate everything behind the login screen instead. The engine has to
 * replay these, so they are stored sealed rather than hashed (see
 * ../secretbox.ts), keyed on the `file_meta` row — one dynamic analysis, one
 * account — and they only ever travel *inward*: to the analysis wrapper, never
 * back to a browser. The username is readable again (it is shown to its owner so
 * they can tell which account is stored); the password is not read by anything
 * except dispatch.ts.
 */

/** Days a stored account survives if its analysis never runs. 0 disables the sweep. */
const TTL_DAYS = Number(process.env.DYNAMIC_CRED_TTL_DAYS ?? 30);

const MAX_USERNAME = 256;
const MAX_PASSWORD = 512;

export interface Credentials {
  username: string;
  password: string;
}

interface CredentialRow {
  fileId: number;
  username: string; // sealed
  password: string; // sealed
  updatedAt: string;
}

const upsertStmt = db.prepare(`
  INSERT INTO dynamic_credentials (fileId, username, password, updatedAt)
  VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ON CONFLICT(fileId) DO UPDATE SET
    username  = excluded.username,
    password  = excluded.password,
    updatedAt = excluded.updatedAt
`);
const findStmt = db.prepare("SELECT * FROM dynamic_credentials WHERE fileId = ?");
const deleteStmt = db.prepare("DELETE FROM dynamic_credentials WHERE fileId = ?");
const sweepStmt = db.prepare("DELETE FROM dynamic_credentials WHERE updatedAt < ?");

/**
 * Reject what should never reach the database. Returns a message to hand back to
 * the caller, or null when the pair is fine. The username is trimmed (a stray
 * space pasted with an email address is never intended); the password is not —
 * trimming a password silently changes it, and some are meant to end in a space.
 */
export function validateCredentials(username: unknown, password: unknown): string | null {
  if (typeof username !== "string" || typeof password !== "string")
    return "Username and password must be strings";
  if (!username.trim()) return "Username is required";
  if (!password) return "Password is required";
  if (username.trim().length > MAX_USERNAME) return `Username must be ${MAX_USERNAME} characters or fewer`;
  if (password.length > MAX_PASSWORD) return `Password must be ${MAX_PASSWORD} characters or fewer`;
  return null;
}

export const DynamicCredentials = {
  /** False when no DYNAMIC_CRED_KEY is configured — nothing can be stored at all. */
  supported: sealingAvailable,

  /** Store (or replace) the account for a dynamic `file_meta` row. */
  set(fileId: number, { username, password }: Credentials): { username: string; updatedAt: string } {
    const trimmed = username.trim();
    upsertStmt.run(fileId, seal(trimmed), seal(password));
    return { username: trimmed, updatedAt: (findStmt.get(fileId) as CredentialRow).updatedAt };
  },

  /**
   * The plaintext account for the analysis engine. Null when none was given —
   * credentials are optional, and a run without them is a valid, if shallower,
   * analysis. Throws when the stored value cannot be opened (see unseal): that
   * is a run which would silently do less than the user paid for, so it fails
   * instead, and the retry costs nothing.
   */
  reveal(fileId: number): Credentials | null {
    const row = findStmt.get(fileId) as CredentialRow | undefined;
    if (!row) return null;
    try {
      return { username: unseal(row.username), password: unseal(row.password) };
    } catch (err) {
      throw new Error(
        `Stored test-account credentials for file ${fileId} could not be decrypted ` +
          `(has DYNAMIC_CRED_KEY changed?) — re-enter them and retry: ${(err as Error).message}`
      );
    }
  },

  /**
   * What the owner may see: which account is stored, and since when. `username`
   * is null when the value cannot be opened — the row is still reported as
   * present, because it is, and because deleting it is the fix.
   */
  listFor(fileIds: number[]): Map<number, { username: string | null; updatedAt: string }> {
    const found = new Map<number, { username: string | null; updatedAt: string }>();
    if (fileIds.length === 0) return found;
    const rows = db
      .prepare(
        `SELECT * FROM dynamic_credentials WHERE fileId IN (${fileIds.map(() => "?").join(",")})`
      )
      .all(...fileIds) as CredentialRow[];
    for (const row of rows) {
      let username: string | null = null;
      try {
        username = unseal(row.username);
      } catch {
        // Unreadable, not absent. Saying so here would mean decrypting on every
        // history listing; dispatch.ts is where it matters and it does say so.
      }
      found.set(row.fileId, { username, updatedAt: row.updatedAt });
    }
    return found;
  },

  remove(fileId: number): void {
    deleteStmt.run(fileId);
  },

  /** Drop accounts left behind by analyses that were never run. Returns how many. */
  sweep(ttlDays = TTL_DAYS): number {
    if (ttlDays <= 0) return 0;
    const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000).toISOString();
    return sweepStmt.run(cutoff).changes;
  },
};

/**
 * A stored password is a liability for exactly as long as it is stored. A run
 * that completes drops its own credentials (dispatch.ts); this is for the rest —
 * uploads that were never analysed, and rows abandoned in `error`.
 */
export function startCredentialSweep(): void {
  if (TTL_DAYS <= 0) {
    console.log("dynamic-credentials: retention sweep disabled (DYNAMIC_CRED_TTL_DAYS=0)");
    return;
  }
  const run = () => {
    try {
      const removed = DynamicCredentials.sweep();
      if (removed > 0) console.log(`dynamic-credentials: swept ${removed} expired (> ${TTL_DAYS}d)`);
    } catch (err) {
      console.error("dynamic-credentials: sweep failed:", err);
    }
  };
  run();
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}
