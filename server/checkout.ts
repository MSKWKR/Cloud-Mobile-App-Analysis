// backend/routes/checkout.ts
// Required packages: stripe, firebase-admin
// npm install stripe firebase-admin

import express from "express";
import Stripe from "stripe";
import { getAuth } from "firebase-admin/auth";

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Middleware: verify Firebase ID token
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

// POST /api/createCheckoutSession
router.post("/createCheckoutSession", requireAuth, async (req, res) => {
  const { packageId } = req.body;
  const uid = (req as any).uid as string;
  const email = (req as any).email as string;

  // Basic validation — always re-validate server-side, never trust client price
  const VALID_PACKAGES: Record<string, { credits: number; price: number }> = {
    starter:    { credits: 100,  price: 500 },
    pro:        { credits: 500,  price: 2000 },
    power:      { credits: 1500, price: 5000 },
    enterprise: { credits: 5000, price: 15000 },
  };

  const pkg = VALID_PACKAGES[packageId];
  if (!pkg) return res.status(400).json({ error: "Invalid package" });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${pkg.credits.toLocaleString()} Credits`,
              description: `Add ${pkg.credits.toLocaleString()} credits to your account`,
            },
            unit_amount: pkg.price, // in cents
          },
          quantity: 1,
        },
      ],
      metadata: {
        uid,          // Firebase UID — used in webhook to credit the right user
        packageId,
        credits: String(pkg.credits),
      },
      success_url: `${process.env.CLIENT_URL}/dashboard?credits=success`,
      cancel_url:  `${process.env.CLIENT_URL}/dashboard?credits=cancelled`,
    });

    return res.json({ url: session.url });
  } catch (err: any) {
    console.error("Stripe error:", err);
    return res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// POST /api/stripeWebhook
// Stripe sends this after successful payment — add credits to Firestore here.
// Must be registered BEFORE express.json() middleware (needs raw body).
router.post(
  "/stripeWebhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"] as string;
    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET!
      );
    } catch (err: any) {
      console.error("Webhook signature error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const { uid, credits } = session.metadata ?? {};

      if (!uid || !credits) {
        console.error("Missing metadata on session", session.id);
        return res.sendStatus(400);
      }

      // Atomically increment credits in Firestore (source of truth).
      // set+merge so it still works if the user doc doesn't exist yet.
      const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
      const db = getFirestore();
      await db.collection("users").doc(uid).set(
        { credits: FieldValue.increment(Number(credits)) },
        { merge: true }
      );

      console.log(`Credited ${credits} to user ${uid}`);
    }

    return res.sendStatus(200);
  }
);

export default router;