import { db } from "../db";

export interface UserRow {
  id: string; // Firebase uid
  email: string;
  // Credit balance lives in Firestore (users/{uid}.credits) — not stored here.
}

const findByIdStmt = db.prepare("SELECT * FROM users WHERE id = ?");
const insertStmt = db.prepare("INSERT INTO users (id, email) VALUES (?, ?)");

export const User = {
  findById(id: string): UserRow | undefined {
    return findByIdStmt.get(id) as UserRow | undefined;
  },

  create(id: string, email: string): UserRow {
    insertStmt.run(id, email);
    return { id, email };
  },
};
