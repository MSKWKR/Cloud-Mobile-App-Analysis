import fs from "fs";
import path from "path";

import express, { Request, Response, Router } from "express";
import multer, { FileFilterCallback, StorageEngine } from "multer";
import { v4 as uuidv4 } from "uuid";
import mongoose, { Document, Schema } from "mongoose";

// ─── Mongoose model ───────────────────────────────────────────────────────────

type AnalysisType = "static" | "dynamic";
type FileType     = "apk" | "ipa";
type JobStatus    = "pending" | "uploaded" | "analyzing" | "done" | "error" | "expired";

interface IGuestJob extends Document {
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
  createdAt: Date;
  expiresAt: Date;
}

const GuestJobSchema = new Schema<IGuestJob>({
  jobId:              { type: String, required: true, unique: true },
  analysisType:       { type: String, enum: ["static", "dynamic"], required: true },
  fileHash:           { type: String, required: true },
  fileType:           { type: String, enum: ["apk", "ipa", null], default: null },
  filename:           { type: String, default: null },
  uploadPath:         { type: String, default: null },
  reportPath:         { type: String, default: null },
  status:             { type: String, enum: ["pending", "uploaded", "analyzing", "done", "error", "expired"], default: "pending" },
  downloadToken:      { type: String, default: null },
  downloadsRemaining: { type: Number, default: 3 },
  expiresAt:          { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
}, { timestamps: true });

// Unique only across real tokens — jobs awaiting a token (null) are not indexed
GuestJobSchema.index(
  { downloadToken: 1 },
  { unique: true, partialFilterExpression: { downloadToken: { $type: "string" } } }
);

export const GuestJob = mongoose.model<IGuestJob>("GuestJob", GuestJobSchema);

// Reconcile indexes on startup — drops the stale plain-unique downloadToken index
// from earlier schema versions so the partial index above replaces it.
GuestJob.syncIndexes().catch((err) => console.error("GuestJob syncIndexes failed:", err));

// ─── Multer — store uploads outside public folder ─────────────────────────────

const uploadsDir = path.join(__dirname, "guest-uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage: StorageEngine = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename:    (_req, _file, cb) => cb(null, uuidv4()),
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb: FileFilterCallback) => {
    const allowed = [".apk", ".ipa"];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

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

      await GuestJob.create({
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

      const job = await GuestJob.findOne({ jobId, status: "pending" });
      if (!job) {
        res.status(404).json({ message: "Job not found or already processed." });
        return;
      }

      // Rename to include original extension so analysis tools can identify it
      const ext       = fileType === "ipa" ? ".ipa" : ".apk";
      const finalPath = path.join(uploadsDir, `${uuidv4()}${ext}`);
      fs.renameSync(file.path, finalPath);

      job.uploadPath = finalPath;
      job.fileType   = fileType;
      job.status     = "uploaded";
      await job.save();

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
      const job = await GuestJob.findOne({ jobId: req.params.jobId });

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
      const job = await GuestJob.findOne({ downloadToken: req.params.token });

      if (!job) {
        res.status(404).json({ message: "Report not found." });
        return;
      }

      if (job.expiresAt < new Date()) {
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

      if (!job.reportPath || !fs.existsSync(job.reportPath)) {
        res.status(500).json({ message: "Report file missing." });
        return;
      }

      job.downloadsRemaining -= 1;
      await job.save();

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="security-report-${job.jobId}.pdf"`);
      fs.createReadStream(job.reportPath).pipe(res);
    } catch (err) {
      console.error("report download error:", err);
      res.status(500).json({ message: "Internal server error." });
    }
  }
);

export default router;
