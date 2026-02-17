// /api/stripe-webhook.js
import Stripe from "stripe";
import admin from "firebase-admin";

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

function initFirebaseAdmin() {
  if (admin.apps.length) return;

  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_B64 env var");

  const json = Buffer.from(b64, "base64").toString("utf8");
  const serviceAccount = JSON.parse(json);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

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
    const txt = await resp.text();
    throw new Error(`Resend failed: ${resp.status} ${txt}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    initFirebaseAdmin();

    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!stripeSecret) throw new Error("Missing STRIPE_SECRET_KEY env var");
    if (!webhookSecret) throw new Error("Missing STRIPE_WEBHOOK_SECRET env var");

    const stripe = new Stripe(stripeSecret, { apiVersion: "2024-06-20" });

    const sig = req.headers["stripe-signature"];
    if (!sig) return res.status(400).send("Missing stripe-signature header");

    const rawBody = await readRawBody(req);

    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err) {
      return res.status(400).send(`Webhook signature error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

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

      // Create or fetch Firebase Auth user
      let userRecord;
      try {
        userRecord = await admin.auth().getUserByEmail(email);
      } catch {
        userRecord = await admin.auth().createUser({ email });
      }

      // ✅ NEW: pull subscription status from Stripe (real gating source of truth)
      const stripeCustomerId = session.customer || null;
      const stripeSubscriptionId = session.subscription || null;

      let subscriptionStatus = null;
      let subscriptionActive = false;
      let currentPeriodEnd = null;

      if (stripeSubscriptionId) {
        const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);

        subscriptionStatus = sub.status; // active, trialing, past_due, canceled, unpaid...
        subscriptionActive = subscriptionStatus === "active" || subscriptionStatus === "trialing";

        if (sub.current_period_end) {
          currentPeriodEnd = admin.firestore.Timestamp.fromMillis(sub.current_period_end * 1000);
        }
      } else {
        // Fallback if Stripe didn’t attach a subscription (should not happen for subscription mode)
        subscriptionActive = true;
        subscriptionStatus = "unknown";
      }

      // Generate password setup link (password reset link)
      const link = await admin.auth().generatePasswordResetLink(email);

      // ✅ UPDATED: Store subscription info (real status)
      await admin.firestore().collection("users").doc(userRecord.uid).set(
        {
          email,
          uid: userRecord.uid,

          // ✅ Subscription gate fields (top-level)
          subscriptionActive,
          subscriptionStatus,
          currentPeriodEnd,

          // ✅ Stripe identifiers (top-level for easy updates)
          stripeCustomerId,
          stripeSubscriptionId,

          stripe: {
            checkoutSessionId: session.id,
            customerId: stripeCustomerId,
            subscriptionId: stripeSubscriptionId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        { merge: true }
      );

      // Email link
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
    return res.status(500).send(e?.message || "Server error");
  }
}
