/**
 * API client for HeroCapture extension endpoints.
 * All calls go through the authenticated /api/ext/* routes.
 */

import { CONFIG } from "./config.js";
import { getAccessToken, refreshSession, signOut } from "./auth.js";

async function authFetch(path, options = {}) {
  const url = `${CONFIG.API_BASE}${path}`;
  const makeRequest = async (accessToken) =>
    fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(options.headers || {}),
      },
    });

  let token = await getAccessToken();
  if (!token) throw new Error("Not authenticated");

  let res = await makeRequest(token);
  if (res.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed?.access_token) {
      token = refreshed.access_token;
      res = await makeRequest(token);
    }
    if (res.status === 401) {
      await signOut();
      throw new Error("Session expired. Please sign in again.");
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `Request failed (${res.status})`);
  }

  return res.json();
}

/**
 * Submit a capture with pre-extracted fingerprint.
 * Returns the full hero card data.
 */
export async function captureHero(url, fingerprint) {
  return authFetch("/capture", {
    method: "POST",
    body: JSON.stringify({ url, fingerprint }),
  });
}

/**
 * List the user's captures.
 */
export async function listCaptures({ limit = 20, offset = 0 } = {}) {
  return authFetch(`/captures?limit=${limit}&offset=${offset}`);
}

/**
 * Get the user's profile and usage info.
 */
export async function getMe() {
  return authFetch("/me");
}

/**
 * Fetch the latest public hero cards (no auth required).
 * Uses the public /api/hero-cards endpoint.
 */
export async function fetchPublicHeroCards() {
  // Prefer explicit app base (web app) for public cards.
  const appBase = (CONFIG.APP_BASE || CONFIG.API_BASE.replace(/\/api\/ext\/?$/, "")).replace(/\/$/, "");
  const url = `${appBase}/api/hero-cards`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch hero cards (${res.status})`);
  }
  return res.json();
}
