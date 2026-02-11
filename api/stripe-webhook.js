// /api/stripe-webhook.js
import Stripe from "stripe";
import admin from "firebase-admin";

// ---------- Helpers: raw body ----------
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    try {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    } catch (e) {
      reject(e);
    }
  });
}

// ---------- Firebase Admin init ----------
function initFirebaseAdmin() {
  if (admin.apps.length) return;

  // Recommended: store base64 JSON in env var FIREBASE_SERVICE_ACCOUNT_B64
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_B64 env var");

  const json = Buffer.from(b64, "base64").toString("utf8");
  const serviceAccount = JSON.parse(json);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

// ---------- Email sender (Resend) ----------
async function sendEmailViaResend({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM; // e.g. "Metrix HardLine <noreply@metrixsub.com>"

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
    const txt = await resp.text();
    throw new Error(`Resend failed: ${resp.status} ${txt}`);
  }
}

export default async function handler(req, res) {
  // Stripe will POST
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    initFirebaseAdmin();

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-06-20",
    });

    const sig = req.headers["stripe-signature"];
    if (!sig) return res.status(400).send("Missing stripe-signature header");

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

    // We only care about successful checkouts
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      // Strong safety check
      if (session.payment_status && session.payment_status !== "paid") {
        return res.status(200).json({ received: true, ignored: "not_paid" });
      }

      const email =
        session.customer_details?.email ||
        session.customer_email ||
        session.metadata?.email;

      if (!email) {
        return res.status(200).json({ received: true, ignored: "no_email" });
      }

      // 1) Create or find Firebase Auth user by email
      let userRecord;
      try {
        userRecord = await admin.auth().getUserByEmail(email);
      } catch {
        userRecord = await admin.auth().createUser({ email });
      }

      // 2) Create a password setup link (password reset link works perfectly)
      const link = await admin.auth().generatePasswordResetLink(email);

      // 3) Store subscription + link in Firestore (optional but useful)
      await admin.firestore().collection("users").doc(userRecord.uid).set(
        {
          email,
          uid: userRecord.uid,
          stripe: {
            checkoutSessionId: session.id,
            customerId: session.customer || null,
            subscriptionId: session.subscription || null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          subscriptionActive: true,
        },
        { merge: true }
      );

      await admin.firestore().collection("passwordSetupLinks").add({
        email,
        uid: userRecord.uid,
        link,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        used: false,
      });

      // 4) Email the user the link
      const subject = "Set your Metrix HardLine password";
      const html = `
        <div style="font-family:Arial,sans-serif;line-height:1.5">
          <h2>Metrix HardLine</h2>
          <p>Your subscription is active. Set your password using the button below:</p>
          <p>
            <a href="${link}" style="display:inline-block;padding:12px 16px;background:#401d65;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">
              Set Password
            </a>
          </p>
          <p style="color:#666;font-size:12px">If you didn’t purchase Metrix HardLine, ignore this email.</p>
        </div>
      `;

      await sendEmailViaResend({ to: email, subject, html });
    }

    return res.status(200).json({ received: true });
  } catch (e) {
    console.error(e);
    return res.status(500).send("Server error");
  }
}

