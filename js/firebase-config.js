// ============================================================
// FIREBASE CONFIG
// ============================================================
// Paste the config object from:
// Firebase Console -> Project Settings -> General -> "Your apps" -> SDK setup and configuration
//
// It looks like this (just an example — replace with your real values):
// {
//   apiKey: "AIzaSy...",
//   authDomain: "your-project.firebaseapp.com",
//   databaseURL: "https://your-project-default-rtdb.firebaseio.com",
//   projectId: "your-project",
//   storageBucket: "your-project.appspot.com",
//   messagingSenderId: "123456789",
//   appId: "1:123456789:web:abcdef123456"
// }
//
// IMPORTANT: you must be using "Realtime Database" (not Firestore) for this
// app, and the databaseURL field is required — Realtime Database projects
// don't always show it by default, so double-check it's in the object you copy.
// ============================================================

export const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY_HERE",
  authDomain: "PASTE_YOUR_AUTH_DOMAIN_HERE",
  databaseURL: "PASTE_YOUR_DATABASE_URL_HERE",
  projectId: "PASTE_YOUR_PROJECT_ID_HERE",
  storageBucket: "PASTE_YOUR_STORAGE_BUCKET_HERE",
  messagingSenderId: "PASTE_YOUR_SENDER_ID_HERE",
  appId: "PASTE_YOUR_APP_ID_HERE"
};
