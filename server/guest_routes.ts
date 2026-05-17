/**
 * guest_routes.ts
 *
 * All anonymous guest job routes. No Firebase auth required.
 *
 * Mount in index.ts:
 *   app.post("/guest/stripe-webhook", express.raw({ type: "application/json" }), stripeWebhookHandler);
 *   app.use("/guest", guestRoutes);
 *
 * MongoDB model: GuestJob (see bottom of file)
 *
 * Required packages:
 *   npm install mongoose multer stripe uuid
 *   npm install -D @types/multer @types/uuid
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";

import express, { Request, Response, Router } from "express";
import multer, { FileFilterCallback, StorageEngine } from "multer";
import Stripe from "stripe";
import { v4 as uuidv4 } from "uuid";
import mongoose, { Document, Schema } from "mongoose";

// ─── Stripe ───────────────────────────────────────────────────────────────────

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

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
  paymentStatus: "pending" | "paid";
  status: JobStatus;
  downloadToken: string | null;
  downloadsRemaining: number;
  stripeSessionId: string | null;
  createdAt: Date;
  expiresAt: Date;
}

const GuestJobSchema = new Schema<IGuestJob>({
  jobId:              { type: String, required: true, unique: true },
  analysisType:       { type: String, enum: ["static", "dynamic"], required: true },
  fileHash:           { type: String, required: true },
  fileType:           { type: String, enum: ["apk", "ipa"], default: null },
  filename:           { type: String, default: null },
  uploadPath:         { type: String, default: null },
  reportPath:         { type: String, default: null },
  paymentStatus:      { type: String, enum: ["pending", "paid"], default: "pending" },
  status:             { type: String, enum: ["pending", "uploaded", "analyzing", "done", "error", "expired"], default: "pending" },
  downloadToken:      { type: String, default: null, unique: true, sparse: true },
  downloadsRemaining: { type: Number, default: 3 },
  stripeSessionId:    { type: String, default: null },
  expiresAt:          { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
}, { timestamps: true });

export const GuestJob = mongoose.model<IGuestJob>("GuestJob", GuestJobSchema);

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
interface PayBody       { jobId: string; }

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
        paymentStatus: "pending",
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
      const ext        = fileType === "ipa" ? ".ipa" : ".apk";
      const finalPath  = path.join(uploadsDir, `${uuidv4()}${ext}`);
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
// Polled by the frontend every 3 s. Returns status and download token once done.

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
        // Only expose the token once analysis is complete
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

// ─── POST /guest/pay ──────────────────────────────────────────────────────────
// Creates a Stripe Checkout Session and returns the hosted URL.

router.post(
  "/pay",
  async (req: Request<{}, {}, PayBody>, res: Response): Promise<void> => {
    try {
      const { jobId } = req.body;

      const job = await GuestJob.findOne({ jobId });
      if (!job) {
        res.status(404).json({ message: "Job not found." });
        return;
      }

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `App Security Analysis (${job.analysisType})`,
                description: "One-time security analysis report for your mobile app.",
              },
              unit_amount: 2900, // $29.00 — adjust as needed
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        success_url: `${process.env.FRONTEND_URL}/guest/success?jobId=${jobId}`,
        cancel_url:  `${process.env.FRONTEND_URL}/guest/cancel?jobId=${jobId}`,
        metadata: { jobId },
      });

      job.stripeSessionId = session.id;
      await job.save();

      res.json({ checkoutUrl: session.url });
    } catch (err) {
      console.error("pay error:", err);
      res.status(500).json({ message: "Internal server error." });
    }
  }
);

// ─── GET /guest/report/:token ─────────────────────────────────────────────────
// Streams the PDF. Validates token, expiry, and download count.

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

// ─── Stripe webhook handler (exported — mounted in index.ts BEFORE express.json()) ──

export const stripeWebhookHandler = async (req: Request, res: Response): Promise<void> => {
  const sig = req.headers["stripe-signature"];

  if (!sig) {
    res.status(400).send("Missing Stripe signature.");
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body as Buffer,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Webhook verification failed:", msg);
    res.status(400).send(`Webhook Error: ${msg}`);
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const jobId   = session.metadata?.jobId;

    if (jobId) {
      const downloadToken = crypto.randomBytes(32).toString("hex");

      await GuestJob.findOneAndUpdate(
        { jobId },
        {
          paymentStatus: "paid",
          status:        "paid",
          downloadToken,
        }
      );

      // TODO: enqueue analysis job here, e.g.:
      // await analysisQueue.add({ jobId });
    }
  }

  res.json({ received: true });
};

export default router;