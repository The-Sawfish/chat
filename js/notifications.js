import { app, db } from "./firebase-init.js";
import {
  getMessaging, getToken, onMessage, isSupported,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging.js";
import { ref, set } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

// Get this from Firebase console → Project settings → Cloud Messaging →
// Web configuration → Web Push certificates → generate/copy the key pair.
const VAPID_KEY = "PASTE_YOUR_VAPID_KEY";

// Sets up real push notifications: works even if the tab is backgrounded
// or the browser is fully closed, because the Cloud Function (see
// functions/index.js) sends the push independently of whether the page
// is open. `isChatActive(chatId)` lets main.js suppress a redundant OS
// notification when the user is already looking at that exact chat.
export async function setupPushNotifications(me, { isChatActive, onOpenChat } = {}) {
  if (!("serviceWorker" in navigator)) return;
  if (!(await isSupported().catch(() => false))) return;
  if (VAPID_KEY.startsWith("PASTE_YOUR_")) {
    console.warn("Push notifications: VAPID_KEY not set in js/notifications.js yet.");
    return;
  }

  const registration = await navigator.serviceWorker.register("firebase-messaging-sw.js");

  // Ask once, quietly, after the UI has loaded — same courteous timing
  // as the old permission prompt.
  await new Promise((r) => setTimeout(r, 800));
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return;

  const messaging = getMessaging(app);

  try {
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (token) {
      // Keyed by token (not overwritten) so a user can have several
      // devices/browsers registered for push at once.
      await set(ref(db, `users/${me.uid}/fcmTokens/${token}`), true);
    }
  } catch (err) {
    console.warn("Push notifications: couldn't get FCM token.", err);
    return;
  }

  // Fires when a push arrives while this tab IS in the foreground.
  // Background/closed cases are handled entirely by the service worker.
  onMessage(messaging, (payload) => {
    const chatId = payload.data?.chatId;
    if (chatId && isChatActive && isChatActive(chatId) && document.hasFocus()) return;
    const title = payload.notification?.title || "New message";
    const body = payload.notification?.body || "";
    try {
      const n = new Notification(title, { body, icon: "icons/icon-192.png", tag: chatId });
      n.onclick = () => { window.focus(); if (chatId && onOpenChat) onOpenChat(chatId); };
    } catch (_) { /* some browsers restrict this; fail silently */ }
  });

  // Clicking a notification the service worker showed (background case)
  // posts back here so we can jump to the right chat.
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "open-chat" && event.data.chatId && onOpenChat) {
      onOpenChat(event.data.chatId);
    }
  });
}
