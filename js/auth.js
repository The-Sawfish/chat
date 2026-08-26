import { auth, db } from "./firebase-init.js";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  ref,
  get,
  set,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

const provider = new GoogleAuthProvider();

// Generates a random 5-digit string and atomically reserves it in
// /usernames so two people can never collide. Retries on collision.
// This "number" is never written to localStorage/sessionStorage — it
// lives only in the Realtime Database and is read fresh each session.
async function generateAndReserveNumber(uid) {
  const MAX_TRIES = 25;
  for (let i = 0; i < MAX_TRIES; i++) {
    const candidate = String(Math.floor(10000 + Math.random() * 90000));
    const numberRef = ref(db, `usernames/${candidate}`);
    const result = await runTransaction(numberRef, (current) => {
      if (current === null) return uid; // claim it
      return; // abort, already taken
    });
    if (result.committed) return candidate;
  }
  throw new Error("Could not allocate a unique number, please try again.");
}

// Creates the users/{uid} profile (with a freshly reserved 5-digit number)
// the first time someone signs in with Google. No-op on later logins.
async function ensureProfile(user) {
  const profileRef = ref(db, `users/${user.uid}`);
  const snap = await get(profileRef);
  if (snap.exists()) return snap.val();

  const number = await generateAndReserveNumber(user.uid);
  const profile = {
    displayName: user.displayName || "New user",
    email: user.email || "",
    number,
    online: true,
    lastSeen: serverTimestamp(),
    createdAt: serverTimestamp(),
  };
  await set(profileRef, profile);
  return profile;
}

export async function signInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, provider);
    await ensureProfile(result.user);
    return result.user;
  } catch (err) {
    // Some browsers (or ad/popup blockers) refuse the popup — fall back
    // to a full-page redirect flow instead of just failing.
    if (err.code === "auth/popup-blocked" || err.code === "auth/cancelled-popup-request") {
      await signInWithRedirect(auth, provider);
      return null; // page will navigate away; caller doesn't need a return value
    }
    throw err;
  }
}

// Call this once on page load of login.html to finish a redirect-based
// sign-in (the fallback path above). Resolves to null if the page wasn't
// loaded as a result of a redirect.
export async function completeRedirectSignIn() {
  const result = await getRedirectResult(auth);
  if (!result) return null;
  await ensureProfile(result.user);
  return result.user;
}

export function logOut() {
  return signOut(auth);
}

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export function friendlyAuthError(err) {
  const code = err?.code || "";
  const map = {
    "auth/popup-closed-by-user": "Sign-in was cancelled.",
    "auth/cancelled-popup-request": "Sign-in was cancelled.",
    "auth/unauthorized-domain": "This site's domain isn't authorized for sign-in yet — add it under Authentication → Settings → Authorized domains in the Firebase console.",
    "auth/network-request-failed": "Network error — check your connection and try again.",
    "auth/internal-error": "Google sign-in isn't enabled on this project yet — enable it under Authentication → Sign-in method.",
  };
  return map[code] || err?.message || "Something went wrong. Please try again.";
}
