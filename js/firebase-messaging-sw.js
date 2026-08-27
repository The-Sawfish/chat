// This file MUST live at the repo root (same level as index.html), not in
// /js — its scope covers whatever folder it's served from, and it needs to
// cover the whole site to receive pushes no matter which page is open.
//
// Classic (non-module) service worker — Firebase's messaging SDK is loaded
// here via importScripts rather than an ES import, so this can't reuse
// js/firebase-config.js directly. Paste the SAME config values from
// js/firebase-config.js into firebaseConfig below. These values are public
// client identifiers (not secrets) — this is the normal, documented way to
// set up FCM in a service worker.

importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js");

const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "PASTE_YOUR_AUTH_DOMAIN",
  databaseURL: "PASTE_YOUR_DATABASE_URL",
  projectId: "PASTE_YOUR_PROJECT_ID",
  storageBucket: "PASTE_YOUR_STORAGE_BUCKET",
  messagingSenderId: "PASTE_YOUR_MESSAGING_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID",
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// Fires when a push arrives and the app is NOT in the foreground
// (tab backgrounded, or the browser/app is closed entirely).
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "New message";
  const body = payload.notification?.body || "";
  const chatId = payload.data?.chatId || "";

  self.registration.showNotification(title, {
    body,
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: chatId || undefined, // groups/replaces notifications from the same chat
    data: { chatId },
  });
});

// Clicking the notification focuses an already-open tab, or opens a new one,
// and hands off the chat id so the app can jump straight to that chat.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const chatId = event.notification.data?.chatId;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.postMessage({ type: "open-chat", chatId });
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow("./index.html");
    })
  );
});
