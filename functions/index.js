const { onValueWritten } = require("firebase-functions/v2/database");
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();

// Fires whenever chats/{chatId}/meta/lastMessage changes — i.e. every time
// someone sends a message (see js/main.js: sendMessage() writes this after
// every send). This is the one piece that has to run on a server rather
// than in the browser: it's what actually delivers the push even when the
// recipient's browser/app is completely closed.
exports.sendMessageNotification = onValueWritten(
  "/chats/{chatId}/meta/lastMessage",
  async (event) => {
    const chatId = event.params.chatId;
    const after = event.data.after.val();
    if (!after) return; // field was cleared, not a new message

    const db = getDatabase();
    const metaSnap = await db.ref(`chats/${chatId}/meta`).get();
    const meta = metaSnap.val();
    if (!meta || !meta.members) return;

    const senderId = after.senderId;
    const recipients = Object.keys(meta.members).filter((uid) => uid !== senderId);
    if (recipients.length === 0) return;

    const senderName = meta.memberNames?.[senderId] || "Someone";
    const title = meta.type === "group" ? (meta.groupName || "Group") : senderName;
    const body = meta.type === "group" ? `${senderName}: ${after.text}` : after.text;

    // Gather every device token for every recipient.
    const tokenOwners = {}; // token -> uid, so we can clean up dead tokens later
    await Promise.all(recipients.map(async (uid) => {
      const snap = await db.ref(`users/${uid}/fcmTokens`).get();
      const val = snap.val();
      if (val) Object.keys(val).forEach((t) => { tokenOwners[t] = uid; });
    }));

    const tokens = Object.keys(tokenOwners);
    if (tokens.length === 0) return;

    const response = await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: { chatId },
      webpush: {
        fcmOptions: { link: "/" },
        notification: { icon: "/icons/icon-192.png" },
      },
    });

    // Prune tokens that are no longer valid (uninstalled, permission
    // revoked, etc.) so the recipient list doesn't grow stale forever.
    const cleanup = [];
    response.responses.forEach((r, i) => {
      if (!r.success && r.error?.code === "messaging/registration-token-not-registered") {
        const token = tokens[i];
        const uid = tokenOwners[token];
        cleanup.push(db.ref(`users/${uid}/fcmTokens/${token}`).remove());
      }
    });
    await Promise.all(cleanup);
  }
);
