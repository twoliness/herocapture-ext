/**
 * Lightweight Supabase Auth client for Chrome extension.
 * Uses chrome.storage.local for session persistence.
 * No full Supabase JS SDK needed — we only use auth + REST endpoints.
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
 * Send a one-time password (OTP) to the user's email.
 */
export async function signInWithOtp(email) {
  const res = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/otp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: CONFIG.SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      email,
      create_user: true,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.msg || err.error_description || "Failed to send OTP");
  }

  return { success: true };
}

/**
 * Verify the OTP code the user entered.
 * Returns the session (access_token, refresh_token, user, etc.)
 */
export async function verifyOtp(email, token) {
  const res = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: CONFIG.SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      email,
      token,
      type: "email",
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.msg || err.error_description || "Invalid code");
  }

  const data = await res.json();

  // Store session
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    user: data.user,
  };
  await setSession(session);

  return session;
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

  const res = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: CONFIG.SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      refresh_token: session.refresh_token,
    }),
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
  const session = await getSession();
  if (session?.access_token) {
    // Best-effort sign out on server
    await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: CONFIG.SUPABASE_ANON_KEY,
      },
    }).catch(() => {});
  }
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
