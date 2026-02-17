import admin from "firebase-admin";

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

function getOrigin(req) {
  // Works on Vercel + locally
  const proto =
    (req.headers["x-forwarded-proto"] || "https").toString().split(",")[0].trim();
  const host =
    (req.headers["x-forwarded-host"] || req.headers["host"] || "").toString().split(",")[0].trim();

  if (!host) return "https://metrixsub.com";
  return `${proto}://${host}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    initFirebaseAdmin();

    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email required" });

    // Find Firebase user (if not found, return generic ok to avoid account enumeration)
    let user;
    try {
      user = await admin.auth().getUserByEmail(email);
    } catch {
      return res.status(200).json({ ok: true });
    }

    // Enforce subscription (as you wanted)
    const userDoc = await admin.firestore().collection("users").doc(user.uid).get();
    if (!userDoc.exists || !userDoc.data()?.subscriptionActive) {
      return res.status(403).json({ error: "Subscription inactive" });
    }

    // ✅ Mobile-safe: send user back to YOUR login.html to finish setting password
    const origin = getOrigin(req);
    const continueUrl = `${origin}/login.html`;

    const actionCodeSettings = {
      url: continueUrl,        // where Firebase sends them after the action
      handleCodeInApp: true,   // ensures the code stays in the link for web handling
    };

    const link = await admin.auth().generatePasswordResetLink(email, actionCodeSettings);

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.5">
        <h2>Metrix HardLine</h2>
        <p>Here is your password setup link (works on mobile + desktop):</p>
        <p>
          <a href="${link}" style="display:inline-block;padding:12px 16px;background:#401d65;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">
            Set Password
          </a>
        </p>
        <p style="color:#666;font-size:12px">If you did not request this, ignore this email.</p>
      </div>
    `;

    await sendEmailViaResend({
      to: email,
      subject: "Metrix HardLine – Set/Reset Your Password",
      html,
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
