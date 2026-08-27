// Central Firebase bootstrap. Every other module imports { auth, db } from here.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-analytics.js";
import { firebaseConfig } from "./firebase-config.js";

const isPlaceholder = Object.values(firebaseConfig).some(
  (v) => typeof v === "string" && v.startsWith("PASTE_YOUR_")
);

if (isPlaceholder) {
  // Surface a clear, in-page error instead of a cryptic Firebase exception.
  document.addEventListener("DOMContentLoaded", () => {
    document.body.innerHTML = `
      <div style="font-family: system-ui, sans-serif; max-width: 560px; margin: 80px auto; padding: 24px; line-height: 1.5;">
        <h2>Firebase isn't configured yet</h2>
        <p>Open <code>js/firebase-config.js</code> and paste in your Firebase project's config
        object (from Project Settings → General → Your apps), including the
        <code>databaseURL</code> for Realtime Database.</p>
      </div>`;
  });
  throw new Error("firebase-config.js still has placeholder values.");
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

// Analytics is optional and only works in supporting browser contexts
// (e.g. not in some in-app webviews) — guarded so it never breaks auth/chat.
export let analytics = null;
isSupported()
  .then((ok) => { if (ok) analytics = getAnalytics(app); })
  .catch(() => { /* analytics unsupported in this environment, ignore */ });
