self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", () => {
  self.clients.claim();
});

/* =========================
   ✅ FCM BACKGROUND PUSH
   =========================
   This lets your users receive notifications even when the app/tab is closed.
*/

// Use compat in Service Worker (simplest + reliable for background messages)
importScripts("https://www.gstatic.com/firebasejs/12.9.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.9.0/firebase-messaging-compat.js");

// Your same Firebase config from user-dashboard.html
firebase.initializeApp({
  apiKey: "AIzaSyBqQF1Tijz_wctD0Z7kSCB80DeiWY1ZPyw",
  authDomain: "metrix-hardline.firebaseapp.com",
  projectId: "metrix-hardline",
  storageBucket: "metrix-hardline.firebasestorage.app",
  messagingSenderId: "899994703104",
  appId: "1:899994703104:web:2979fe39d1c3c169ee4fe5"
});

const messaging = firebase.messaging();

// When a push arrives and the user is NOT on the page/app (background)
messaging.onBackgroundMessage((payload) => {
  const title =
    (payload && payload.notification && payload.notification.title) ||
    (payload && payload.data && payload.data.title) ||
    "Metrix Coach";

  const body =
    (payload && payload.notification && payload.notification.body) ||
    (payload && payload.data && payload.data.body) ||
    "You have a task reminder.";

  const options = {
    body,
    icon: "/icons/icon-192.png", // change if your icon path differs
    badge: "/icons/icon-192.png",
    data: {
      // Where to open when user clicks the notification
      click_action: (payload && payload.data && payload.data.click_action) || "/user-dashboard.html"
    }
  };

  self.registration.showNotification(title, options);
});

// Click notification => focus/open your dashboard
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification && event.notification.data && event.notification.data.click_action) || "/user-dashboard.html";

  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });

      // If dashboard already open, focus it
      for (const client of allClients) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }

      // Otherwise open new tab/window
      if (clients.openWindow) return clients.openWindow(url);
    })()
  );
});
