import { auth, db } from "./firebase-init.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  ref,
  runTransaction,
  set,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

// Generates a random 5-digit string ("00000"-"99999" excluding leading-zero
// awkwardness is fine, we just want a fixed-width 5-digit id) and atomically
// reserves it in /usernames so two people can never collide. Retries on
// collision. This "number" is never written to localStorage/sessionStorage —
// it lives only in the Realtime Database and is read fresh each session.
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

export async function signUp(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;
  await updateProfile(cred.user, { displayName });

  const number = await generateAndReserveNumber(uid);

  await set(ref(db, `users/${uid}`), {
    displayName,
    email,
    number,
    online: true,
    lastSeen: serverTimestamp(),
    createdAt: serverTimestamp(),
  });

  return { uid, number };
}

export function logIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
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
    "auth/email-already-in-use": "That email is already registered — try logging in instead.",
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/too-many-requests": "Too many attempts — please wait a moment and try again.",
  };
  return map[code] || err?.message || "Something went wrong. Please try again.";
}
