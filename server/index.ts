import { initializeApp, cert, ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import serviceAccount from "./serviceAccountKey.json";
import { User } from "./models/User";
import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import mongoose from "mongoose";
import fs from "fs";
import os from "os";
import cors from "cors";
import { FileMeta } from "./models/FileMeta";
import { putFile, putJson, getJson } from "./s3";
import { analyzeIOSStatic, analyzeAndroidStatic, analyzeAndroidDynamic} from "./dispatch";
import guestRoutes from "./guest_routes";
import checkoutRouter from "./checkout";

const PDF_GENERATOR_URL = "http://pdf-generator:15148/api/report";

initializeApp({
  credential: cert(serviceAccount as ServiceAccount),
});

// Firestore is the single source of truth for credit balances (users/{uid}.credits).
const db = getFirestore();

interface AuthRequest extends Request {
  user?: { uid: string; email?: string };
}

const verifyToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization || "";
  console.log("Incoming Authorization header:", authHeader ? `${authHeader.slice(0,20)}...` : "(none)");
  const token = authHeader.split(" ")[1]; // Bearer <token>

  if (!token) {
    console.log("No token extracted from Authorization header");
    return res.status(401).json({ error: "Missing token" });
  }

  try {
    const decoded = await getAuth().verifyIdToken(token);
    console.log("Token verified for uid:", decoded.uid);
    if (!decoded.email_verified) {
      console.log("Rejected: email not verified for uid:", decoded.uid);
      return res.status(403).json({ error: "email_not_verified" });
    }
    req.user = { uid: decoded.uid, email: decoded.email };
    next();
  } catch (err) {
    console.error("Token verification failed:", err);
    res.status(401).json({ error: "Unauthorized" });
  }
};

// Read the current credit balance from Firestore (0 if the user doc is missing).
async function getUserCredits(uid: string): Promise<number> {
  const snap = await db.collection("users").doc(uid).get();
  return snap.exists ? Number(snap.data()?.credits ?? 0) : 0;
}

// Atomically decrement one credit, only if the balance is > 0.
// Runs in a Firestore transaction so concurrent uploads can't double-spend.
async function consumeCredit(uid: string) {
  const ref = db.collection("users").doc(uid);
  const remaining = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? Number(snap.data()?.credits ?? 0) : 0;
    if (current <= 0) return null; // signal insufficient credits
    tx.update(ref, { credits: current - 1 });
    return current - 1;
  });

  if (remaining === null) {
    return { success: false, error: "no_credits_or_user_not_found" };
  }
  return { success: true, remainingCredits: remaining };
}

const app = express();
// Restrict browser CORS to the configured client origin (falls back to "*" if unset).
const allowedOrigin = process.env.CLIENT_URL || "*";
app.use(cors({
  origin: allowedOrigin,
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.options("*", cors());

// Webhook must receive raw body — register before express.json()
app.use("/api/stripeWebhook", express.raw({ type: "application/json" }));
app.use(express.json());

app.use("/guest", guestRoutes);
app.use("/api", checkoutRouter);

mongoose.connect("mongodb://cloud-mongodb:27018/local_system")
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error(err));

// Multer buffers the incoming upload to a local temp file; we then stream it to S3
// and delete the temp file. S3 is the durable store — no local uploads/reports dirs.
const upload = multer({ dest: os.tmpdir(), defParamCharset: "utf8" } as any);

// S3 key schemes. These strings are stored in FileMeta.filePath / .reportPath.
const uploadKey = (uid: string, hash: string, filename: string) =>
  `uploads/${uid}/${hash}/${filename}`;
const reportKey = (uid: string, hash: string, analysisType: string) =>
  `reports/${uid}/${hash}/${analysisType}.json`;

// Upload file
app.post("/upload", verifyToken, upload.single("file"), async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ message: "Unauthorized" });

  const file = req.file;
  const { type, hash } = req.body;
  if (!file || !type || !hash) return res.status(400).json({ message: "Missing fields" });

  // Find user document
  const user = await User.findOne({ _id: req.user.uid });
  if (!user) return res.status(401).json({ message: "User not found" });

  // Generate unique S3 keys per user + hash
  const sanitizedFilename = file.originalname.replace(/\s+/g, "_"); // optional: sanitize spaces
  const filePath = uploadKey(String(user._id), hash, sanitizedFilename);
  const reportPath = reportKey(String(user._id), hash, type);

  // Stream the temp upload to S3, then remove the local temp file.
  await putFile(filePath, file.path);
  await fs.promises.unlink(file.path).catch(() => {});
  await putJson(reportPath, { status: "pending" });

  const meta = await FileMeta.create({
    user: user._id, // <-- associate file with user
    filename: file.originalname,
    analysisType: type,
    filePath,
    reportPath,
    hash,
    status: "pending",
  });

  const remainingCredits = await getUserCredits(req.user.uid);
  res.json({ message: "File uploaded", meta, remainingCredits });
});

// List uploads for each user
app.get("/uploads", verifyToken, async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  console.log("User UID from request:", req.user.uid); // Log UID from the request

  const user = await User.findOne({ _id: req.user.uid }); // Find the user based on the Firebase UID
  if (!user) {
    console.error("User not found for UID:", req.user.uid); // Log if user is not found
    return res.status(401).json({ error: "User not found" });
  }

  console.log("User found:", user);

  const uploads = await FileMeta.find({ user: user._id }).sort({ uploadTime: -1 }); // Use ObjectId reference to find files
  const sanitized = uploads.map(u => ({
    id: u._id.toString(),
    filename: u.filename,
    hash: u.hash,
    analysisType: u.analysisType,
    filePath: u.filePath,
    status: u.status,
    uploadTime: u.uploadTime,
  }));

  res.json(sanitized);
});

// Check for duplicate file
app.post("/check-hash", verifyToken, async (req: AuthRequest, res: Response) => {
  console.log("Received request at /check-hash"); // Add this log for debugging

  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { hash, analysisType } = req.body;
  if (!hash || !analysisType) {
    return res.status(400).json({ error: "Missing hash or analysis type field" });
  }

  try {
    const user = await User.findOne({ _id: req.user.uid });
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    console.log("Checking for user ID:", user._id); // Log the user ID being checked
    const file = await FileMeta.findOne({ hash, user: user._id });
    if (!file) {
      return res.json({ status: "new "});
    }

    if (file.analysisType === analysisType) {
      return res.json({
        status: "duplicate",
        message: "File with same hash and analysis type already exists",
      });
    } else {
      const reportPath = reportKey(String(user._id), hash, analysisType);
      // Create a new entry in db with different analysis type. Reuses the same
      // uploaded binary (file.filePath) — only the report artifact differs.
      const meta = await FileMeta.create({
        user: user._id, // <-- associate file with user
        filename: file.filename,
        analysisType,
        filePath: file.filePath,
        reportPath,
        hash,
        status: "pending",
      });
      await putJson(reportPath, { status: "pending" });

      return res.json({
        status: "reuse",
        message: "File with same hash but different analysis type exists",
      });
    }

  } catch (err) {
    console.error("Check-hash error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/ios-static-analyze", verifyToken, async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  const { hash } = req.body;
  if (!hash) return res.status(400).json({ error: "Missing hash" });

    // Find the current user
  const user = await User.findOne({ _id: req.user.uid });
  if (!user) return res.status(401).json({ error: "User not found" });

  const upload = await FileMeta.findOne({ user:user._id, hash, analysisType: "static" });
  if (!upload) return res.status(404).json({ error: "Upload not found" });
  if (!(upload.filename.endsWith(".ipa") && upload.analysisType === "static"))
    return res.status(400).json({ error: "Not eligible for analysis" });
  if (upload.status !== "pending")
    return res.status(400).json({ error: "File already analyzing or done" });

  analyzeIOSStatic(hash)
    .then(() => console.log("iOS Static Analysis completed"))
    .catch(err => {
      console.error("iOS Static Analysis Error:", err);
      FileMeta.findOne({ user: user._id, hash }).then(doc => {
        if (doc) {
          doc.status = "error";
          doc.save();
        }
      });
    });

  upload.status = "analyzing";
  await upload.save();

  res.json({ message: "Analysis triggered" });
});

app.post("/android-static-analyze", verifyToken, async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  const { hash } = req.body;
  if (!hash) return res.status(400).json({ error: "Missing hash" });

    // Find the current user
  const user = await User.findOne({ _id: req.user.uid });
  if (!user) return res.status(401).json({ error: "User not found" });

  const upload = await FileMeta.findOne({ user: user._id, hash, analysisType: "static" });
  if (!upload) return res.status(404).json({ error: "Upload not found" });
  if (!(upload.filename.endsWith(".apk") && upload.analysisType === "static"))
    return res.status(400).json({ error: "Not eligible for analysis" });
  if (upload.status !== "pending")
    return res.status(400).json({ error: "File already analyzing or done" });

  analyzeAndroidStatic(hash)
    .then(() => console.log("Android Static Analysis completed"))
    .catch(err => {
      console.error("Android Static Analysis Error:", err);
      FileMeta.findOne({ user: user._id, hash }).then(doc => {
        if (doc) {
          doc.status = "error";
          doc.save();
        }
      });
    });

  upload.status = "analyzing";
  await upload.save();

  res.json({ message: "Analysis triggered" });
});


app.post("/android-dynamic-analyze", verifyToken, async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  const { hash } = req.body;
  if (!hash) return res.status(400).json({ error: "Missing hash" });

    // Find the current user
  const user = await User.findOne({ _id: req.user.uid });
  if (!user) return res.status(401).json({ error: "User not found" });

  const upload = await FileMeta.findOne({ user:user._id, hash, analysisType: "dynamic" });
  if (!upload) return res.status(404).json({ error: "Upload not found" });
  if (!(upload.filename.endsWith(".apk") && upload.analysisType === "dynamic"))
    return res.status(400).json({ error: "Not eligible for analysis" });
  if (upload.status !== "pending")
    return res.status(400).json({ error: "File already analyzing or done" });

  analyzeAndroidDynamic(hash)
    .then(() => console.log("Android Dynamic Analysis completed"))
    .catch(err => {
      console.error("Android Dynamic Analysis Error:", err);
      FileMeta.findOne({ user:user._id, hash }).then(doc => {
        if (doc) {
          doc.status = "error";
          doc.save();
        }
      });
    });

  upload.status = "analyzing";
  await upload.save();

  res.json({ message: "Analysis triggered" });
});


app.post("/generate-report", verifyToken, async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  const { hash, type } = req.body;
  if (!hash || !type) return res.status(400).json({ error: "Missing fields" });

  // Find the current user
  const user = await User.findOne({ _id: req.user.uid });
  if (!user) return res.status(401).json({ error: "User not found" });

  try {
    const reportMeta = await FileMeta.findOne({ hash, analysisType: type, user: user._id });
    if (!reportMeta) return res.status(404).json({ error: "Report not found" });

    let reportData;
    try {
      reportData = await getJson(reportMeta.reportPath);
    } catch (e) {
      console.error("Report fetch from S3 failed:", e);
      return res.status(404).json({ error: "Report file missing" });
    }

    const pdfRes = await fetch(PDF_GENERATOR_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reportData),
    });
    
    if (!pdfRes.ok) {
      throw new Error(`PDF generation failed with ${pdfRes.status}`);
    }

    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    res.setHeader("Content-Disposition", `attachment; filename="${reportMeta.filename}.pdf"`);
    res.setHeader("Content-Type", "application/pdf");
    res.send(pdfBuffer);
  } catch (err) {
    console.error("Report generation error:", err);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

app.patch("/retry", async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  const { hash, type } = req.body;
  if (!hash || !type) return res.status(400).json({ error: "Missing fields" });

    // Find the current user
  const user = await User.findOne({ _id: req.user.uid });
  if (!user) return res.status(401).json({ error: "User not found" });

  try {
    const fileDoc = await FileMeta.findOne({ hash, analysisType: type, user: user._id });
    if (!fileDoc) return res.status(404).json({ error: "File not found" });

    fileDoc.status = "pending";
    await fileDoc.save();

    res.json({ message: "File reset to pending" });
  } catch (err) {
    console.error("Retry error:", err);
    res.status(500).json({ error: "Failed to reset file status" });
  }
});

app.post("/api/initUser", verifyToken, async (req: any, res) => {
  const uid = req.user.uid;
  const email = req.user.email;

  try {
    // Mongo user record — used for file ownership / email lookups (no credits here).
    let user = await User.findOne({ _id: uid });
    if (!user) {
      user = await User.create({ _id: uid, email });
    }

    // Firestore holds the credit balance. Seed new users with 10, once.
    const ref = db.collection("users").doc(uid);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({ email, credits: 10, createdAt: FieldValue.serverTimestamp() });
    }
    const credits = snap.exists ? Number(snap.data()?.credits ?? 0) : 10;

    res.json({ uid, email, credits });
  } catch (err) {
    console.error("Init user error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/me", verifyToken, async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  try {
    const user = await User.findOne({ _id: req.user.uid });
    if (!user) return res.status(404).json({ error: "User not found" });
    const credits = await getUserCredits(req.user.uid);
    res.json({ uid: user._id, email: user.email, credits });
  } catch (err) {
    console.error("Get user error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/getCredits", verifyToken, async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const credits = await getUserCredits(req.user.uid);
    return res.json({ credits });
  } catch (err) {
    console.error("Get credits error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/consumeCredit", verifyToken, async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const result = await consumeCredit(req.user.uid);
    if (!result.success) return res.status(400).json({ error: "No credits left" });

    return res.json({ remainingCredits: result.remainingCredits });
  } catch (err) {
    console.error("Consume credit error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.listen(3000, "0.0.0.0", () => {
  console.log("Backend running on http://localhost:3000");
});
