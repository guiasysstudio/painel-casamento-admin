import {
  db,
  currentUser,
  currentAdmin,
  emailId
} from "./admin-core.js?v=3.2.0";

import {
  collection,
  doc,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const MAX_STRING_LENGTH = 600;
const MAX_ARRAY_ITEMS = 30;
const MAX_OBJECT_KEYS = 40;
const MAX_DEPTH = 4;

function safeString(value, limit = MAX_STRING_LENGTH) {
  return String(value ?? "")
    .trim()
    .slice(0, limit);
}

function sanitizeValue(value, depth = 0) {
  if (depth > MAX_DEPTH) {
    return "[Limite de profundidade]";
  }

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }

  if (typeof value === "string") {
    return safeString(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map(item => sanitizeValue(item, depth + 1));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, MAX_OBJECT_KEYS)
        .map(([key, item]) => [
          safeString(key, 80),
          sanitizeValue(item, depth + 1)
        ])
    );
  }

  return safeString(value);
}

function sessionId() {
  const storageKey =
    "casamento.admin.audit.session";

  let value = sessionStorage.getItem(
    storageKey
  );

  if (!value) {
    value = crypto.randomUUID();
    sessionStorage.setItem(
      storageKey,
      value
    );
  }

  return value;
}

export async function recordAdminLog({
  module,
  action,
  recordId = "",
  summary,
  details = {}
}) {
  const user = currentUser;
  const admin = currentAdmin;

  if (
    !user ||
    !admin ||
    admin.active !== true
  ) {
    return null;
  }

  const reference = doc(
    collection(db, "logs")
  );

  await setDoc(reference, {
    module: safeString(module, 60),
    action: safeString(action, 80),
    recordId: safeString(recordId, 220),
    summary: safeString(summary, 600),
    details: sanitizeValue(details),

    adminEmail: emailId(user.email),
    adminName: safeString(
      user.displayName ||
      admin.name ||
      "Administrador",
      120
    ),
    adminRole: safeString(
      admin.role || "admin",
      30
    ),

    page: safeString(
      document.body?.dataset?.page ||
      location.pathname.split("/").pop() ||
      "",
      80
    ),

    sessionId: sessionId(),
    userAgent: safeString(
      navigator.userAgent,
      300
    ),

    createdAt: serverTimestamp(),
    clientCreatedAt:
      new Date().toISOString()
  });

  return reference.id;
}

export async function tryRecordAdminLog(data) {
  try {
    return await recordAdminLog(data);
  } catch (error) {
    console.error(
      "Não foi possível registrar o log administrativo.",
      error
    );

    return null;
  }
}
