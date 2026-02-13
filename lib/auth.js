/**
 * Auth client for HeroCapture Chrome extension.
 * Uses magic link flow via Resend (no Supabase Auth).
 * Sessions persisted in chrome.storage.local.
 */

import { CONFIG } from "./config.js";

const AUTH_STORAGE_KEY = "herocapture_auth_session";

// --- Session storage ---

async function getSession() {
  const result = await chrome.storage.local.get(AUTH_STORAGE_KEY);
  return result[AUTH_STORAGE_KEY] || null;
}

async function setSession(session) {
  await chrome.storage.local.set({ [AUTH_STORAGE_KEY]: session });
}

async function clearSession() {
  await chrome.storage.local.remove(AUTH_STORAGE_KEY);
}

// --- Auth API calls ---

/**
 * Request a magic link email for the given address.
 * Returns { session_id } for polling.
 */
export async function sendMagicLink(email) {
  const res = await fetch(`${CONFIG.API_BASE}/auth/send-magic-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to send magic link");
  }

  return res.json();
}

/**
 * Poll the server to check if the magic link has been clicked.
 * Returns { status: "pending" } or { status: "verified", access_token, refresh_token, user }.
 */
export async function checkAuthStatus(sessionId) {
  const res = await fetch(
    `${CONFIG.API_BASE}/auth/check-status?session_id=${encodeURIComponent(sessionId)}`
  );

  if (!res.ok) {
    return { status: "pending" };
  }

  const data = await res.json();

  if (data.status === "verified" && data.access_token) {
    // Store session
    const session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
      user: data.user,
    };
    await setSession(session);
    return { status: "verified", session };
  }

  return { status: "pending" };
}

/**
 * Refresh the access token using the refresh token.
 */
export async function refreshSession() {
  const session = await getSession();
  if (!session?.refresh_token) {
    await clearSession();
    return null;
  }

  const res = await fetch(`${CONFIG.API_BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });

  if (!res.ok) {
    await clearSession();
    return null;
  }

  const data = await res.json();
  const newSession = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    user: data.user,
  };
  await setSession(newSession);

  return newSession;
}

/**
 * Get current valid session, auto-refreshing if needed.
 */
export async function getCurrentSession() {
  const session = await getSession();
  if (!session) return null;

  // Check if token is about to expire (within 60 seconds)
  const expiresAt = session.expires_at;
  if (expiresAt) {
    const expiresMs = typeof expiresAt === "number"
      ? expiresAt * 1000
      : new Date(expiresAt).getTime();
    const now = Date.now();
    if (now > expiresMs - 60000) {
      // Token expired or about to expire, try refresh
      const refreshed = await refreshSession();
      return refreshed;
    }
  }

  return session;
}

/**
 * Get the access token for API calls.
 */
export async function getAccessToken() {
  const session = await getCurrentSession();
  return session?.access_token || null;
}

/**
 * Get the current user.
 */
export async function getUser() {
  const session = await getCurrentSession();
  return session?.user || null;
}

/**
 * Sign out the current user.
 */
export async function signOut() {
  await clearSession();
}

/**
 * Listen for session changes.
 */
export function onSessionChange(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[AUTH_STORAGE_KEY]) {
      callback(changes[AUTH_STORAGE_KEY].newValue || null);
    }
  });
}
