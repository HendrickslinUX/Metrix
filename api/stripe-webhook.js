// /api/stripe-webhook.js

import Stripe from "stripe";
import admin from "firebase-admin";

// ---------- Helpers: read raw body ----------
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ---------- Firebase Admin Init ----------
function initFirebaseAdmin() {
  if (admin.apps.length) return;

  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_B64");

  const json = Buffer.from(b64, "base64").toString("utf8");
  const serviceAccount = JSON.parse(json);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

// ---------- Email Sender (Resend) ----------
async function sendEmailViaResend({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;

  if (!key) throw new Error("Missing RESEND_API_KEY");
  if (!from) throw new Error("Missing RESEND_FROM");

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Resend error: ${resp.status} ${text}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    initFirebaseAdmin();

    // 🔐 NEVER hardcode this
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20",
    });

    const sig = req.headers["stripe-signature"];
    if (!sig) {
      return res.status(400).send("Missing stripe-signature header");
    }

    const rawBody = await readRawBody(req);

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      return res.status(400).send(`Webhook signature error: ${err.message}`);
    }

    // ✅ Only handle successful checkout
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      if (session.payment_status !== "paid") {
        return res.status(200).json({ ignored: "not_paid" });
      }

      const email =
        session.customer_details?.email ||
        session.customer_email ||
        session.metadata?.email;

      if (!email) {
        return res.status(200).json({ ignored: "no_email" });
      }

      // 1️⃣ Create or fetch Firebase user
      let userRecord;
      try {
        userRecord = await admin.auth().getUserByEmail(email);
      } catch {
        userRecord = await admin.auth().createUser({ email });
      }

      // 2️⃣ Generate password setup link
      const link = await admin.auth().generatePasswordResetLink(email);

      // 3️⃣ Save user subscription info
      await admin
        .firestore()
        .collection("users")
        .doc(userRecord.uid)
        .set(
          {
            email,
            subscriptionActive: true,
            stripeCustomerId: session.customer || null,
            subscriptionId: session.subscription || null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

      // 4️⃣ Send password setup email
      const html = `
        <div style="font-family:Arial,sans-serif">
          <h2>Metrix HardLine</h2>
          <p>Your payment was successful.</p>
          <p>Click below to create your password:</p>
          <a href="${link}"
             style="display:inline-block;padding:12px 16px;background:#401d65;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold">
             Set Your Password
          </a>
          <p style="font-size:12px;color:#666">
            If you did not purchase Metrix HardLine, ignore this email.
          </p>
        </div>
      `;

      await sendEmailViaResend({
        to: email,
        subject: "Set your Metrix HardLine password",
        html,
      });
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).send("Server error");
  }
}
