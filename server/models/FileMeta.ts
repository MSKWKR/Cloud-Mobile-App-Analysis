import { db } from "../db";

export type FileStatus = "pending" | "analyzing" | "done" | "error";

export interface FileMetaRow {
  id: number;
  user: string; // users.id (Firebase uid)
  filename: string;
  analysisType: string;
  filePath: string;
  reportPath: string;
  hash: string;
  status: FileStatus;
  taskId: string | null;
  uploadTime: string; // ISO 8601
}

type Filter = Partial<Pick<FileMetaRow, "user" | "hash" | "analysisType">>;

function where(filter: Filter): { sql: string; values: unknown[] } {
  const keys = Object.keys(filter) as (keyof Filter)[];
  return {
    sql: keys.map((k) => `${k} = ?`).join(" AND "),
    values: keys.map((k) => filter[k]),
  };
}

const insertStmt = db.prepare(`
  INSERT INTO file_meta (user, filename, analysisType, filePath, reportPath, hash, status)
  VALUES (@user, @filename, @analysisType, @filePath, @reportPath, @hash, @status)
`);
const findByIdStmt = db.prepare("SELECT * FROM file_meta WHERE id = ?");

export const FileMeta = {
  create(data: {
    user: string;
    filename: string;
    analysisType: string;
    filePath: string;
    reportPath: string;
    hash: string;
    status?: FileStatus;
  }): FileMetaRow {
    const info = insertStmt.run({ status: "pending", ...data });
    return findByIdStmt.get(info.lastInsertRowid) as FileMetaRow;
  },

  findOne(filter: Filter): FileMetaRow | undefined {
    const { sql, values } = where(filter);
    return db
      .prepare(`SELECT * FROM file_meta WHERE ${sql} LIMIT 1`)
      .get(...values) as FileMetaRow | undefined;
  },

  find(filter: Filter): FileMetaRow[] {
    const { sql, values } = where(filter);
    return db
      .prepare(`SELECT * FROM file_meta WHERE ${sql} ORDER BY uploadTime DESC, id DESC`)
      .all(...values) as FileMetaRow[];
  },

  update(id: number, patch: Partial<Pick<FileMetaRow, "status" | "taskId">>): void {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (keys.length === 0) return;
    db.prepare(`UPDATE file_meta SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
      .run(...keys.map((k) => patch[k]), id);
  },
};
