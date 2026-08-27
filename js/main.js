import { auth, db } from "./firebase-init.js";
import { watchAuth, logOut } from "./auth.js";
import { setupPushNotifications } from "./notifications.js";
import {
  ref, get, set, update, push, onValue, off,
  query, orderByKey, serverTimestamp, onDisconnect,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

const MAX_MESSAGES_PER_CHAT = 20;

// ---------------------------------------------------------------
// State (all in-memory only — the user's 5-digit number and every
// chat/message live in Firebase and are re-read each session; none
// of it is ever written to localStorage/sessionStorage).
// ---------------------------------------------------------------
let me = null; // { uid, displayName, number, email }
let currentChatId = null;
let currentChatMeta = null;
let chatUnsubs = {}; // chatId -> unsubscribe fn for meta listener
let messagesUnsub = null;
let contactsCache = {}; // uid -> {displayName, number}
let chatsCache = {}; // chatId -> meta
let lastSeenAt = {}; // chatId -> timestamp of last time we viewed it (in-memory)

// ---------------------------------------------------------------
// Bootstrapping
// ---------------------------------------------------------------
watchAuth(async (user) => {
  if (!user) { window.location.href = "login.html"; return; }
  const snap = await get(ref(db, `users/${user.uid}`));
  if (!snap.exists()) { window.location.href = "login.html"; return; }
  const profile = snap.val();
  me = { uid: user.uid, displayName: profile.displayName, number: profile.number, email: profile.email };
  document.getElementById("myAvatar").textContent = initials(me.displayName);
  document.getElementById("myNumberBadge").textContent = "#" + me.number;
  setupPresence();
  listenToContacts();
  listenToUserChats();

  // Real push notifications — delivered by the Cloud Function even when
  // this tab is backgrounded or the browser/app is fully closed. See
  // js/notifications.js and functions/index.js.
  setupPushNotifications(me, {
    isChatActive: (chatId) => currentChatId === chatId,
    onOpenChat: (chatId) => {
      const meta = chatsCache[chatId];
      if (!meta) return;
      navChats.click();
      openChat(chatId, meta);
    },
  });
});

function setupPresence() {
  const myRef = ref(db, `users/${me.uid}`);
  update(myRef, { online: true, lastSeen: serverTimestamp() });
  onDisconnect(myRef).update({ online: false, lastSeen: serverTimestamp() });
}

function initials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join("");
}

// ---------------------------------------------------------------
// Navigation between Chats / Contacts panes
// ---------------------------------------------------------------
const navChats = document.getElementById("navChats");
const navContacts = document.getElementById("navContacts");
const chatsPane = document.getElementById("chatsPane");
const contactsPane = document.getElementById("contactsPane");

navChats.addEventListener("click", () => {
  navChats.classList.add("active"); navContacts.classList.remove("active");
  chatsPane.style.display = "flex"; contactsPane.style.display = "none";
});

navContacts.addEventListener("click", () => {
  navContacts.classList.add("active"); navChats.classList.remove("active");
  contactsPane.style.display = "flex"; chatsPane.style.display = "none";
});

document.getElementById("navLogout").addEventListener("click", async () => {
  await update(ref(db, `users/${me.uid}`), { online: false, lastSeen: serverTimestamp() });
  await logOut();
  window.location.href = "login.html";
});

// ---------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------
function listenToContacts() {
  onValue(ref(db, `contacts/${me.uid}`), (snap) => {
    contactsCache = snap.val() || {};
    renderContacts();
    renderGroupPickList();
  });
}

function renderContacts(filter = "") {
  const list = document.getElementById("contactList");
  const entries = Object.entries(contactsCache).filter(([, c]) =>
    !filter || c.displayName.toLowerCase().includes(filter.toLowerCase()) || c.number.includes(filter)
  );

  if (entries.length === 0) {
    list.innerHTML = `<div class="empty-hint">No contacts yet. Tap + and enter someone's 5-digit number to add them.</div>`;
    return;
  }

  list.innerHTML = "";
  entries
    .sort((a, b) => a[1].displayName.localeCompare(b[1].displayName))
    .forEach(([uid, c]) => {
      const row = document.createElement("div");
      row.className = "chat-row";
      row.innerHTML = `
        <div class="avatar">${initials(c.displayName)}<span class="presence-dot" data-presence="${uid}"></span></div>
        <div class="chat-row-body">
          <div class="chat-row-top"><div class="chat-row-name">${escapeHtml(c.displayName)}</div></div>
          <div class="chat-row-preview">#${c.number}</div>
        </div>
        <button class="contact-row-action">Message</button>
      `;
      row.querySelector(".contact-row-action").addEventListener("click", () => openDirectChat(uid, c));
      row.addEventListener("dblclick", () => openDirectChat(uid, c));
      list.appendChild(row);
      watchPresenceDot(uid, row.querySelector(`[data-presence="${uid}"]`));
    });
}

function watchPresenceDot(uid, dotEl) {
  onValue(ref(db, `users/${uid}/online`), (snap) => {
    if (!dotEl) return;
    dotEl.classList.toggle("on", snap.val() === true);
  });
}

document.getElementById("contactSearch").addEventListener("input", (e) => renderContacts(e.target.value.trim()));

// Add contact modal
const addContactModal = document.getElementById("addContactModal");
document.getElementById("addContactBtn").addEventListener("click", () => {
  document.getElementById("contactNumberInput").value = "";
  document.getElementById("addContactError").classList.remove("show");
  addContactModal.classList.add("show");
});
document.getElementById("cancelAddContact").addEventListener("click", () => addContactModal.classList.remove("show"));

document.getElementById("confirmAddContact").addEventListener("click", async () => {
  const errBox = document.getElementById("addContactError");
  errBox.classList.remove("show");
  const number = document.getElementById("contactNumberInput").value.trim();

  if (!/^\d{5}$/.test(number)) {
    errBox.textContent = "Enter a valid 5-digit number.";
    errBox.classList.add("show");
    return;
  }
  if (number === me.number) {
    errBox.textContent = "That's your own number.";
    errBox.classList.add("show");
    return;
  }

  try {
    const idxSnap = await get(ref(db, `usernames/${number}`));
    if (!idxSnap.exists()) {
      errBox.textContent = "No user found with that number.";
      errBox.classList.add("show");
      return;
    }
    const theirUid = idxSnap.val();
    const theirSnap = await get(ref(db, `users/${theirUid}`));
    if (!theirSnap.exists()) {
      errBox.textContent = "That user no longer exists.";
      errBox.classList.add("show");
      return;
    }
    const theirProfile = theirSnap.val();

    await Promise.all([
      set(ref(db, `contacts/${me.uid}/${theirUid}`), {
        displayName: theirProfile.displayName, number: theirProfile.number, addedAt: serverTimestamp(),
      }),
      set(ref(db, `contacts/${theirUid}/${me.uid}`), {
        displayName: me.displayName, number: me.number, addedAt: serverTimestamp(),
      }),
    ]);

    addContactModal.classList.remove("show");
    showToast(`Added ${theirProfile.displayName}`);
    openDirectChat(theirUid, { displayName: theirProfile.displayName, number: theirProfile.number });
  } catch (err) {
    errBox.textContent = err.message || "Something went wrong.";
    errBox.classList.add("show");
  }
});

// ---------------------------------------------------------------
// Chats list
// ---------------------------------------------------------------
function listenToUserChats() {
  onValue(ref(db, `userChats/${me.uid}`), (snap) => {
    const chatIds = Object.keys(snap.val() || {});

    // stop watching chats we no longer belong to
    Object.keys(chatUnsubs).forEach((id) => {
      if (!chatIds.includes(id)) { chatUnsubs[id](); delete chatUnsubs[id]; delete chatsCache[id]; }
    });

    chatIds.forEach((chatId) => {
      if (chatUnsubs[chatId]) return; // already watching
      const metaRef = ref(db, `chats/${chatId}/meta`);
      const handler = (metaSnap) => {
        const meta = metaSnap.val();
        if (!meta) return;
        chatsCache[chatId] = meta;
        renderChatList();
        if (currentChatId === chatId) updateChatHeader(meta);
        // Incoming-message notifications are now handled by real push
        // (js/notifications.js + functions/index.js) instead of here.
      };
      onValue(metaRef, handler);
      chatUnsubs[chatId] = () => off(metaRef, "value", handler);
    });

    if (chatIds.length === 0) renderChatList();
  });
}

function chatDisplayName(meta) {
  if (meta.type === "group") return meta.groupName || "Group";
  const otherUid = Object.keys(meta.members).find((u) => u !== me.uid);
  return contactsCache[otherUid]?.displayName || meta.memberNames?.[otherUid] || "Direct chat";
}

function renderChatList(filter = "") {
  const list = document.getElementById("chatList");
  const entries = Object.entries(chatsCache).filter(([, m]) =>
    !filter || chatDisplayName(m).toLowerCase().includes(filter.toLowerCase())
  );

  if (entries.length === 0) {
    list.innerHTML = `<div class="empty-hint">No chats yet. Add a contact by their 5-digit number to start one.</div>`;
    return;
  }

  entries.sort((a, b) => (b[1].lastMessage?.timestamp || b[1].createdAt || 0) - (a[1].lastMessage?.timestamp || a[1].createdAt || 0));

  list.innerHTML = "";
  entries.forEach(([chatId, meta]) => {
    const name = chatDisplayName(meta);
    const preview = meta.lastMessage
      ? (meta.lastMessage.senderId === me.uid ? "You: " : "") + meta.lastMessage.text
      : "No messages yet";
    const time = meta.lastMessage?.timestamp ? formatTime(meta.lastMessage.timestamp) : "";
    const unread = isUnread(chatId, meta);

    const row = document.createElement("div");
    row.className = "chat-row" + (chatId === currentChatId ? " active" : "");
    const otherUid = meta.type === "direct" ? Object.keys(meta.members).find(u => u !== me.uid) : null;

    row.innerHTML = `
      <div class="avatar ${meta.type === "group" ? "group" : ""}">
        ${meta.type === "group" ? groupGlyph() : initials(name)}
        ${otherUid ? `<span class="presence-dot" data-presence-row="${otherUid}"></span>` : ""}
      </div>
      <div class="chat-row-body">
        <div class="chat-row-top">
          <div class="chat-row-name">${escapeHtml(name)}</div>
          <div class="chat-row-time">${time}</div>
        </div>
        <div class="chat-row-preview">${escapeHtml(preview)}</div>
      </div>
      ${unread ? `<div class="unread-badge">•</div>` : ""}
    `;
    row.addEventListener("click", () => openChat(chatId, meta));
    list.appendChild(row);
    if (otherUid) watchPresenceDot(otherUid, row.querySelector(`[data-presence-row="${otherUid}"]`));
  });
}

function groupGlyph() { return "GC"; }

document.getElementById("chatSearch").addEventListener("input", (e) => renderChatList(e.target.value.trim()));

function isUnread(chatId, meta) {
  if (!meta.lastMessage || meta.lastMessage.senderId === me.uid) return false;
  const seen = lastSeenAt[chatId] || 0;
  return (meta.lastMessage.timestamp || 0) > seen && currentChatId !== chatId;
}

// ---------------------------------------------------------------
// Opening a direct chat (create if needed)
// ---------------------------------------------------------------
async function openDirectChat(otherUid, otherProfile) {
  const chatId = [me.uid, otherUid].sort().join("_");
  const existing = await get(ref(db, `chats/${chatId}/meta`));

  if (!existing.exists()) {
    const meta = {
      type: "direct",
      members: { [me.uid]: true, [otherUid]: true },
      memberNames: { [me.uid]: me.displayName, [otherUid]: otherProfile.displayName },
      createdAt: Date.now(),
      createdBy: me.uid,
    };
    await set(ref(db, `chats/${chatId}/meta`), meta);
    await Promise.all([
      set(ref(db, `userChats/${me.uid}/${chatId}`), true),
      set(ref(db, `userChats/${otherUid}/${chatId}`), true),
    ]);
  }

  navChats.click();
  openChat(chatId, (await get(ref(db, `chats/${chatId}/meta`))).val());
}

// ---------------------------------------------------------------
// Group chats
// ---------------------------------------------------------------
const newGroupModal = document.getElementById("newGroupModal");
document.getElementById("newGroupBtn").addEventListener("click", () => {
  document.getElementById("groupNameInput").value = "";
  document.getElementById("newGroupError").classList.remove("show");
  renderGroupPickList();
  newGroupModal.classList.add("show");
});
document.getElementById("cancelNewGroup").addEventListener("click", () => newGroupModal.classList.remove("show"));

function renderGroupPickList() {
  const list = document.getElementById("groupPickList");
  const entries = Object.entries(contactsCache);

  if (entries.length === 0) {
    list.innerHTML = `<div class="empty-hint" style="padding:12px 0;">Add some contacts first.</div>`;
    return;
  }

  list.innerHTML = "";
  entries
    .sort((a, b) => a[1].displayName.localeCompare(b[1].displayName))
    .forEach(([uid, c]) => {
      const row = document.createElement("label");
      row.className = "pick-row";
      row.innerHTML = `<input type="checkbox" value="${uid}" /> <span>${escapeHtml(c.displayName)} <span style="color:var(--ink-500);font-size:12px;">#${c.number}</span></span>`;
      list.appendChild(row);
    });
}

document.getElementById("confirmNewGroup").addEventListener("click", async () => {
  const errBox = document.getElementById("newGroupError");
  errBox.classList.remove("show");
  const name = document.getElementById("groupNameInput").value.trim();
  const checked = Array.from(document.querySelectorAll('#groupPickList input[type=checkbox]:checked')).map(i => i.value);

  if (!name) { errBox.textContent = "Give the group a name."; errBox.classList.add("show"); return; }
  if (checked.length < 2) { errBox.textContent = "Pick at least 2 people."; errBox.classList.add("show"); return; }

  const members = { [me.uid]: true };
  const memberNames = { [me.uid]: me.displayName };
  checked.forEach((uid) => { members[uid] = true; memberNames[uid] = contactsCache[uid]?.displayName || "Member"; });

  const chatId = push(ref(db, "chats")).key;
  await set(ref(db, `chats/${chatId}/meta`), {
    type: "group", groupName: name, members, memberNames,
    createdAt: Date.now(), createdBy: me.uid,
  });

  const updates = {};
  Object.keys(members).forEach((uid) => { updates[`userChats/${uid}/${chatId}`] = true; });
  await update(ref(db), updates);

  newGroupModal.classList.remove("show");
  navChats.click();
  openChat(chatId, (await get(ref(db, `chats/${chatId}/meta`))).val());
});

// ---------------------------------------------------------------
// Chat pane: opening, rendering, sending
// ---------------------------------------------------------------
function openChat(chatId, meta) {
  currentChatId = chatId;
  currentChatMeta = meta;
  lastSeenAt[chatId] = Date.now();
  document.getElementById("app").classList.add("chat-open");
  renderChatList();
  renderChatPane(meta);

  if (messagesUnsub) messagesUnsub();
  const msgsRef = ref(db, `chats/${chatId}/messages`);
  const q = query(msgsRef, orderByKey());
  const handler = (snap) => renderMessages(snap.val() || {});
  onValue(q, handler);
  messagesUnsub = () => off(q, "value", handler);
}

function updateChatHeader(meta) {
  document.getElementById("chatHeaderName").textContent = chatDisplayName(meta);
  document.getElementById("chatHeaderSub").textContent = meta.type === "group"
    ? `${Object.keys(meta.members).length} members`
    : "";
}

function renderChatPane(meta) {
  const pane = document.getElementById("chatPane");
  pane.classList.remove("empty");
  pane.innerHTML = `
    <div class="chat-header">
      <button class="icon-btn back-btn" id="backBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <div class="avatar ${meta.type === "group" ? "group" : ""}">${meta.type === "group" ? groupGlyph() : initials(chatDisplayName(meta))}</div>
      <div>
        <div class="chat-header-name" id="chatHeaderName">${escapeHtml(chatDisplayName(meta))}</div>
        <div class="chat-header-sub" id="chatHeaderSub"></div>
      </div>
      <div class="chat-header-spacer"></div>
    </div>
    <div class="messages-scroll" id="messagesScroll"></div>
    <div class="composer">
      <textarea id="msgInput" placeholder="Message" rows="1"></textarea>
      <button class="send-btn" id="sendBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
  `;
  updateChatHeader(meta);

  document.getElementById("backBtn").addEventListener("click", () => {
    document.getElementById("app").classList.remove("chat-open");
    currentChatId = null;
    if (messagesUnsub) { messagesUnsub(); messagesUnsub = null; }
  });

  const input = document.getElementById("msgInput");
  const send = () => sendMessage(input);
  document.getElementById("sendBtn").addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });
  input.focus();
}

function renderMessages(messages) {
  const scroll = document.getElementById("messagesScroll");
  if (!scroll) return;
  const entries = Object.entries(messages).sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0));
  const nearBottom = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 60;

  scroll.innerHTML = "";
  entries.forEach(([id, m]) => {
    const mine = m.senderId === me.uid;
    const row = document.createElement("div");
    row.className = "msg-row" + (mine ? " mine" : "");
    const senderName = !mine && currentChatMeta?.type === "group"
      ? `<div class="msg-sender">${escapeHtml(currentChatMeta.memberNames?.[m.senderId] || "")}</div>` : "";
    row.innerHTML = `<div class="bubble">${senderName}${escapeHtml(m.text)}<div class="msg-time">${formatTime(m.timestamp)}</div></div>`;
    scroll.appendChild(row);
  });

  if (nearBottom || entries.length <= 1) scroll.scrollTop = scroll.scrollHeight;
}

async function sendMessage(input) {
  const text = input.value.trim();
  if (!text || !currentChatId) return;
  input.value = "";
  input.style.height = "auto";

  const msgsRef = ref(db, `chats/${currentChatId}/messages`);
  const newRef = push(msgsRef);
  const timestamp = Date.now();
  await set(newRef, { senderId: me.uid, text, timestamp });
  await update(ref(db, `chats/${currentChatId}/meta`), {
    lastMessage: { text, senderId: me.uid, timestamp },
  });

  pruneOldMessages(currentChatId);
}

// Keeps only the most recent MAX_MESSAGES_PER_CHAT messages so the
// database doesn't grow without bound. Push keys sort chronologically,
// so ordering by key gives us oldest-first without needing a numeric
// timestamp round-trip.
async function pruneOldMessages(chatId) {
  const msgsRef = ref(db, `chats/${chatId}/messages`);
  const snap = await get(query(msgsRef, orderByKey()));
  const keys = [];
  snap.forEach((child) => { keys.push(child.key); });
  if (keys.length <= MAX_MESSAGES_PER_CHAT) return;
  const toRemove = keys.slice(0, keys.length - MAX_MESSAGES_PER_CHAT);
  const updates = {};
  toRemove.forEach((k) => { updates[k] = null; });
  await update(msgsRef, updates);
}

// ---------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

let toastTimer;
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}
