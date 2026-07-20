// server/newebpay.ts — NewebPay (藍新金流) MPG checkout for credit purchases.
// Replaces the Stripe flow: the frontend fetches signed form fields here, then
// foreground-form-posts them to the MPG gateway (iframe/背景 post is forbidden
// by NewebPay — error MPG02005). Spec: 線上交易-幕前支付技術串接手冊 NDNF-1.2.3.

import express from "express";
import crypto from "crypto";
import { getAuth } from "firebase-admin/auth";
import { db } from "./db";

const router = express.Router();

// ── Config (fill these in .env once the merchant account is approved) ──────
const MERCHANT_ID = process.env.NEWEBPAY_MERCHANT_ID ?? "";
const HASH_KEY = process.env.NEWEBPAY_HASH_KEY ?? "";
const HASH_IV = process.env.NEWEBPAY_HASH_IV ?? "";
// Test: https://ccore.newebpay.com  ·  Production: https://core.newebpay.com
const GATEWAY_BASE = process.env.NEWEBPAY_GATEWAY ?? "https://ccore.newebpay.com";
const CLIENT_URL = process.env.CLIENT_URL ?? "";
// 1 credit = 1 upload. NT$1,000 ≈ USD 30 — must match the /product page.
const TWD_PER_CREDIT = Number(process.env.TWD_PER_CREDIT ?? 1000);

// Same package ids as the frontend BuyCredits component.
const VALID_PACKAGES: Record<string, number> = {
  starter: 1,
  pro: 5,
  power: 10,
  enterprise: 25,
};

db.exec(`
  CREATE TABLE IF NOT EXISTS newebpay_orders (
    orderNo   TEXT PRIMARY KEY,          -- MerchantOrderNo sent to NewebPay
    uid       TEXT NOT NULL,             -- Firebase uid to credit on success
    credits   INTEGER NOT NULL,
    amt       INTEGER NOT NULL,          -- charged amount in TWD
    status    TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','paid','failed')),
    tradeNo   TEXT,                      -- NewebPay trade number (on success)
    createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
`);

const insertOrder = db.prepare(
  "INSERT INTO newebpay_orders (orderNo, uid, credits, amt) VALUES (?, ?, ?, ?)"
);
const findOrder = db.prepare("SELECT * FROM newebpay_orders WHERE orderNo = ?");
// Atomic pending→paid transition makes the notify handler idempotent.
const markPaid = db.prepare(
  "UPDATE newebpay_orders SET status = 'paid', tradeNo = ? WHERE orderNo = ? AND status = 'pending'"
);

interface OrderRow {
  orderNo: string;
  uid: string;
  credits: number;
  amt: number;
  status: string;
}

// ── Crypto helpers (manual §4.1) ────────────────────────────────────────────
function aesEncrypt(plain: string): string {
  const cipher = crypto.createCipheriv("aes-256-cbc", HASH_KEY, HASH_IV);
  return cipher.update(plain, "utf8", "hex") + cipher.final("hex");
}

function aesDecrypt(hex: string): string {
  const decipher = crypto.createDecipheriv("aes-256-cbc", HASH_KEY, HASH_IV);
  return decipher.update(hex, "hex", "utf8") + decipher.final("utf8");
}

function tradeSha(encryptedTradeInfo: string): string {
  return crypto
    .createHash("sha256")
    .update(`HashKey=${HASH_KEY}&${encryptedTradeInfo}&HashIV=${HASH_IV}`)
    .digest("hex")
    .toUpperCase();
}

// Decrypted TradeInfo is JSON when RespondType=JSON, querystring otherwise.
function parseTradeInfo(plain: string): any {
  try {
    return JSON.parse(plain);
  } catch {
    return Object.fromEntries(new URLSearchParams(plain));
  }
}

// ── Auth middleware (same contract as checkout.ts) ──────────────────────────
async function requireAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const token = req.headers.authorization?.split("Bearer ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded = await getAuth().verifyIdToken(token);
    if (!decoded.email_verified) {
      return res.status(403).json({ error: "email_not_verified" });
    }
    (req as any).uid = decoded.uid;
    (req as any).email = decoded.email;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ── POST /api/newebpay/checkout ─────────────────────────────────────────────
// Returns the signed fields the frontend form-posts to the MPG gateway.
router.post("/checkout", requireAuth, async (req, res) => {
  if (!MERCHANT_ID || !HASH_KEY || !HASH_IV) {
    return res.status(503).json({ error: "NewebPay is not configured" });
  }

  const { packageId } = req.body;
  const credits = VALID_PACKAGES[packageId];
  if (!credits) return res.status(400).json({ error: "Invalid package" });

  const uid = (req as any).uid as string;
  const email = (req as any).email as string;
  const amt = credits * TWD_PER_CREDIT;

  // MerchantOrderNo: unique, ≤30 chars, [A-Za-z0-9_] only.
  const orderNo = `CMAA${Date.now()}${Math.floor(Math.random() * 9000 + 1000)}`;
  insertOrder.run(orderNo, uid, credits, amt);

  const tradeInfoPlain = new URLSearchParams({
    MerchantID: MERCHANT_ID,
    RespondType: "JSON",
    TimeStamp: String(Math.floor(Date.now() / 1000)),
    Version: "2.0",
    LangType: "en",
    MerchantOrderNo: orderNo,
    Amt: String(amt),
    ItemDesc: `${credits} Analysis Credits`,
    Email: email ?? "",
    NotifyURL: `${CLIENT_URL}/api/newebpay/notify`,
    ReturnURL: `${CLIENT_URL}/api/newebpay/return`,
    ClientBackURL: `${CLIENT_URL}/app`,
    CREDIT: "1",
  }).toString();

  const encrypted = aesEncrypt(tradeInfoPlain);

  return res.json({
    gateway: `${GATEWAY_BASE}/MPG/mpg_gateway`,
    merchantID: MERCHANT_ID,
    tradeInfo: encrypted,
    tradeSha: tradeSha(encrypted),
    version: "2.0",
  });
});

// Shared verify+decrypt for notify/return payloads. Returns null if invalid.
function verifyPayload(body: any): any | null {
  const { TradeInfo, TradeSha } = body ?? {};
  if (!TradeInfo || !TradeSha) return null;
  if (tradeSha(TradeInfo) !== TradeSha) {
    console.error("NewebPay: TradeSha mismatch");
    return null;
  }
  try {
    return parseTradeInfo(aesDecrypt(TradeInfo));
  } catch (err) {
    console.error("NewebPay: TradeInfo decrypt failed", err);
    return null;
  }
}

// ── POST /api/newebpay/notify ───────────────────────────────────────────────
// Background payment notification. NewebPay retries unless we answer HTTP 200.
router.post("/notify", async (req, res) => {
  const info = verifyPayload(req.body);
  if (!info) return res.status(400).send("invalid payload");

  const result = info.Result ?? info;
  const orderNo = result.MerchantOrderNo;
  const order = findOrder.get(orderNo) as OrderRow | undefined;

  if (!order) {
    console.error("NewebPay notify: unknown order", orderNo);
    return res.status(400).send("unknown order");
  }

  if (info.Status !== "SUCCESS") {
    console.warn(`NewebPay notify: order ${orderNo} failed (${info.Status})`);
    return res.status(200).send("ok");
  }

  if (Number(result.Amt) !== order.amt) {
    console.error(
      `NewebPay notify: amount mismatch on ${orderNo} (got ${result.Amt}, expected ${order.amt})`
    );
    return res.status(400).send("amount mismatch");
  }

  // Idempotent: only the first successful notify credits the user.
  const updated = markPaid.run(result.TradeNo ?? null, orderNo);
  if (updated.changes === 1) {
    const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
    await getFirestore()
      .collection("users")
      .doc(order.uid)
      .set({ credits: FieldValue.increment(order.credits) }, { merge: true });
    console.log(`NewebPay: credited ${order.credits} to ${order.uid} (${orderNo})`);
  }

  return res.status(200).send("ok");
});

// ── POST /api/newebpay/return ───────────────────────────────────────────────
// Browser lands here after payment; credits are granted by /notify, this only
// routes the user back to the app with a status flag.
router.post("/return", (req, res) => {
  const info = verifyPayload(req.body);
  const ok = info?.Status === "SUCCESS";
  return res.redirect(`${CLIENT_URL}/app?credits=${ok ? "success" : "failed"}`);
});

export default router;
