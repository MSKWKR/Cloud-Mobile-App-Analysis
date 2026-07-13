import fs from "fs";
import os from "os";
import path from "path";

import express, { Request, Response, Router } from "express";
import multer, { FileFilterCallback, StorageEngine } from "multer";
import { v4 as uuidv4 } from "uuid";
import { db } from "./db";
import { putFile, getStream } from "./s3";

// ─── GuestJob repository (SQLite) ─────────────────────────────────────────────

type AnalysisType = "static" | "dynamic";
type FileType     = "apk" | "ipa";
type JobStatus    = "pending" | "uploaded" | "analyzing" | "done" | "error" | "expired";

export interface GuestJobRow {
  jobId: string;
  analysisType: AnalysisType;
  fileHash: string;
  fileType: FileType | null;
  filename: string | null;
  uploadPath: string | null;
  reportPath: string | null;
  status: JobStatus;
  downloadToken: string | null;
  downloadsRemaining: number;
  createdAt: string; // ISO 8601
  expiresAt: string; // ISO 8601
}

const GUEST_JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const insertStmt = db.prepare(`
  INSERT INTO guest_jobs (jobId, analysisType, fileHash, filename, status, expiresAt)
  VALUES (@jobId, @analysisType, @fileHash, @filename, @status, @expiresAt)
`);
const findByJobIdStmt = db.prepare("SELECT * FROM guest_jobs WHERE jobId = ?");
const findByTokenStmt = db.prepare("SELECT * FROM guest_jobs WHERE downloadToken = ?");

export const GuestJob = {
  create(data: {
    jobId: string;
    analysisType: AnalysisType;
    fileHash: string;
    filename: string | null;
    status: JobStatus;
  }): void {
    insertStmt.run({
      ...data,
      expiresAt: new Date(Date.now() + GUEST_JOB_TTL_MS).toISOString(),
    });
  },

  findByJobId(jobId: string): GuestJobRow | undefined {
    return findByJobIdStmt.get(jobId) as GuestJobRow | undefined;
  },

  findByToken(token: string): GuestJobRow | undefined {
    return findByTokenStmt.get(token) as GuestJobRow | undefined;
  },

  update(
    jobId: string,
    patch: Partial<Pick<GuestJobRow, "fileType" | "uploadPath" | "reportPath" | "status" | "downloadToken" | "downloadsRemaining">>
  ): void {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (keys.length === 0) return;
    db.prepare(`UPDATE guest_jobs SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE jobId = ?`)
      .run(...keys.map((k) => patch[k]), jobId);
  },
};

// ─── Multer — buffer uploads to a temp dir, then stream to S3 ──────────────────

const storage: StorageEngine = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, os.tmpdir()),
  filename:    (_req, _file, cb) => cb(null, uuidv4()),
});

// S3 key schemes for the guest flow.
const guestUploadKey = (jobId: string, ext: string) => `guest/uploads/${jobId}${ext}`;
const guestReportKey = (jobId: string) => `guest/reports/${jobId}.pdf`;

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  defParamCharset: "utf8",
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const allowed = [".apk", ".ipa"];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
} as any);

// ─── Request body types ───────────────────────────────────────────────────────

interface CreateJobBody { analysisType: AnalysisType; hash: string; fileName: string; }
interface UploadBody    { jobId: string; analysisType: AnalysisType; fileType: FileType; hash: string; }

// ─── Router ───────────────────────────────────────────────────────────────────

const router: Router = express.Router();

// ─── POST /guest/create-job ───────────────────────────────────────────────────

router.post(
  "/create-job",
  async (req: Request<{}, {}, CreateJobBody>, res: Response): Promise<void> => {
    try {
      const { analysisType, hash, fileName } = req.body;

      if (!["static", "dynamic"].includes(analysisType)) {
        res.status(400).json({ message: "Invalid analysisType." });
        return;
      }

      const jobId = uuidv4();

      GuestJob.create({
        jobId,
        analysisType,
        fileHash: hash,
        filename: fileName,
        status: "pending",
      });

      res.json({ jobId });
    } catch (err) {
      console.error("create-job error:", err);
      res.status(500).json({ message: "Internal server error." });
    }
  }
);

// ─── POST /guest/upload ───────────────────────────────────────────────────────

router.post(
  "/upload",
  upload.single("file"),
  async (req: Request<{}, {}, UploadBody>, res: Response): Promise<void> => {
    try {
      const { jobId, fileType } = req.body;
      const file = req.file;

      if (!file || !jobId) {
        res.status(400).json({ message: "Missing file or jobId." });
        return;
      }

      const job = GuestJob.findByJobId(jobId);
      if (!job || job.status !== "pending") {
        res.status(404).json({ message: "Job not found or already processed." });
        return;
      }

      // Include original extension in the key so analysis tools can identify it
      const ext = fileType === "ipa" ? ".ipa" : ".apk";
      const key = guestUploadKey(job.jobId, ext);
      await putFile(key, file.path);
      await fs.promises.unlink(file.path).catch(() => {});

      GuestJob.update(job.jobId, {
        uploadPath: key,
        fileType,
        status: "uploaded",
      });

      res.json({ success: true });
    } catch (err) {
      console.error("upload error:", err);
      res.status(500).json({ message: "Internal server error." });
    }
  }
);

// ─── GET /guest/job-status/:jobId ─────────────────────────────────────────────

router.get(
  "/job-status/:jobId",
  async (req: Request<{ jobId: string }>, res: Response): Promise<void> => {
    try {
      const job = GuestJob.findByJobId(req.params.jobId);

      if (!job) {
        res.status(404).json({ message: "Job not found." });
        return;
      }

      res.json({
        status: job.status,
        ...(job.status === "done" && job.downloadToken
          ? { downloadToken: job.downloadToken }
          : {}),
      });
    } catch (err) {
      console.error("job-status error:", err);
      res.status(500).json({ message: "Internal server error." });
    }
  }
);

// ─── GET /guest/report/:token ─────────────────────────────────────────────────

router.get(
  "/report/:token",
  async (req: Request<{ token: string }>, res: Response): Promise<void> => {
    try {
      const job = GuestJob.findByToken(req.params.token);

      if (!job) {
        res.status(404).json({ message: "Report not found." });
        return;
      }

      if (new Date(job.expiresAt) < new Date()) {
        res.status(410).json({ message: "This report link has expired." });
        return;
      }

      if (job.status !== "done") {
        res.status(202).json({ message: "Report is not ready yet. Check back soon." });
        return;
      }

      if (job.downloadsRemaining <= 0) {
        res.status(403).json({ message: "Download limit reached." });
        return;
      }

      if (!job.reportPath) {
        res.status(500).json({ message: "Report file missing." });
        return;
      }

      // Fetch from S3 first so a missing object doesn't consume a download.
      let stream;
      try {
        stream = await getStream(job.reportPath);
      } catch (e) {
        console.error("guest report fetch error:", e);
        res.status(500).json({ message: "Report file missing." });
        return;
      }

      GuestJob.update(job.jobId, { downloadsRemaining: job.downloadsRemaining - 1 });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="security-report-${job.jobId}.pdf"`);
      stream.on("error", (err) => {
        console.error("guest report stream error:", err);
        if (!res.headersSent) res.status(500).json({ message: "Report file missing." });
      });
      stream.pipe(res);
    } catch (err) {
      console.error("report download error:", err);
      res.status(500).json({ message: "Internal server error." });
    }
  }
);

export default router;
