import admin from "firebase-admin";

function initAdmin() {
  if (admin.apps.length) return;

  // You must set FIREBASE_SERVICE_ACCOUNT in Vercel env as JSON string
  // Example: {"type":"service_account", ...}
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    initAdmin();

    const { uid, title, body, url } = req.body || {};
    if (!uid || !title || !body) return res.status(400).json({ error: "uid, title, body required" });

    const db = admin.firestore();
    const snap = await db.collection("users").doc(uid).collection("fcmTokens").get();

    const tokens = snap.docs.map(d => d.id).filter(Boolean);
    if (!tokens.length) return res.status(200).json({ ok: true, sent: 0 });

    const message = {
      notification: { title, body },
      data: { click_action: url || "/user-dashboard.html" },
      tokens
    };

    const resp = await admin.messaging().sendEachForMulticast(message);

    return res.status(200).json({ ok: true, sent: resp.successCount, failed: resp.failureCount });
  } catch (e) {
    return res.status(500).json({ error: e.message || "send failed" });
  }
}
