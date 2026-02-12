import admin from "firebase-admin";

function initAdmin() {
  if (admin.apps.length) return;

  const b64 = process.env.firebase_service_account_b64;
  if (!b64) throw new Error("Missing env var: firebase_service_account_b64");

  const json = Buffer.from(b64, "base64").toString("utf8");
  const serviceAccount = JSON.parse(json);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    initAdmin();

    // ✅ Secure: verify the caller is logged in
    const authHeader = req.headers.authorization || "";
    const match = authHeader.match(/^Bearer (.+)$/);
    if (!match) return res.status(401).json({ error: "Missing Authorization Bearer token" });

    const decoded = await admin.auth().verifyIdToken(match[1]);
    const uid = decoded.uid;

    const { title, body, url } = req.body || {};
    if (!title || !body) return res.status(400).json({ error: "title, body required" });

    const db = admin.firestore();
    const snap = await db.collection("users").doc(uid).collection("fcmTokens").get();

    const tokens = snap.docs.map((d) => d.id).filter(Boolean);
    if (!tokens.length) return res.status(200).json({ ok: true, sent: 0 });

    const message = {
      notification: { title, body },
      data: { click_action: url || "/user-dashboard.html" },
      tokens,
    };

    const resp = await admin.messaging().sendEachForMulticast(message);

    return res.status(200).json({
      ok: true,
      sent: resp.successCount,
      failed: resp.failureCount,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "send failed" });
  }
}
