/**
 * RideWithGPS OAuth helpers.
 *
 * Flow:
 *  1. Call startRwgpsOAuth() — opens a popup to /v1/cycling/rwgps/oauth/start.
 *  2. The backend redirects the popup to the RideWithGPS consent page.
 *  3. After the user approves, RWGPS redirects to /v1/cycling/rwgps/oauth/callback.
 *  4. The backend exchanges the code for an access_token and returns a tiny HTML
 *     page that calls window.opener.postMessage({type:'rwgps-token', ...}).
 *  5. startRwgpsOAuth() resolves and the token is stored in localStorage.
 *
 * The stored token is used by frontend RWGPS API calls via
 * Authorization: Bearer <token>.
 *
 * NOTE: The /start endpoint accepts an optional Supabase access token for
 * additional verification when the user is signed in.  When the user is not
 * signed in (self-hosted / SERVER_FUNCTIONS_ENABLED=false), the token is
 * omitted and the backend still allows the RWGPS OAuth flow to proceed.
 */

import { supabase } from "./supabaseClient";

const TOKEN_KEY = "rwgps_access_token";
const USER_ID_KEY = "rwgps_user_id";
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)
  ?.trim()
  .replace(/\/+$/, "");

// ── Storage helpers ───────────────────────────────────────────────────────────

export function getRwgpsToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRwgpsUserId(): number | null {
  const v = localStorage.getItem(USER_ID_KEY);
  return v !== null ? Number(v) : null;
}

export function clearRwgpsAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_ID_KEY);
}

function saveRwgpsAuth(token: string, userId: number): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_ID_KEY, String(userId));
}

// ── OAuth popup ───────────────────────────────────────────────────────────────

interface RwgpsAuthResult {
  token: string;
  userId: number;
}

/**
 * Open a popup window to the RideWithGPS OAuth consent page.
 * Returns a promise that resolves with the access token once the user
 * authorizes, or rejects if the popup is blocked or the user closes it.
 */
export function startRwgpsOAuth(): Promise<RwgpsAuthResult> {
  return new Promise((resolve, reject) => {
    // Open immediately in the user-click call stack. If we await before
    // window.open(), browsers may treat this as a non-user-initiated popup
    // and block it.
    const popup = window.open(
      "about:blank",
      "rwgps-oauth",
      "width=560,height=680,resizable=yes,scrollbars=yes",
    );

    if (!popup) {
      reject(
        new Error(
          "Popup was blocked. Please allow popups for this site and try again.",
        ),
      );
      return;
    }
    const popupWindow = popup;

    let settled = false;

    function fail(err: Error) {
      if (settled) return;
      settled = true;
      clearInterval(closedTimer);
      window.removeEventListener("message", onMessage);
      try {
        popupWindow.close();
      } catch {
        // ignore close errors
      }
      reject(err);
    }

    function onMessage(event: MessageEvent) {
      if (event.data?.type !== "rwgps-token") return;
      settled = true;
      clearInterval(closedTimer);
      window.removeEventListener("message", onMessage);

      const { token, userId } = event.data as RwgpsAuthResult & {
        type: string;
      };
      saveRwgpsAuth(token, userId);
      resolve({ token, userId });
    }

    window.addEventListener("message", onMessage);

    // Resolve Supabase session after opening popup, then navigate popup to
    // the backend start endpoint. The access token is optional — if the user
    // is not signed into Supabase the backend will still allow the RWGPS flow.
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        const accessToken = data.session?.access_token ?? "";

        const state = encodeURIComponent(window.location.origin);
        const base = API_BASE ?? "";
        const url = accessToken
          ? `${base}/v1/cycling/rwgps/oauth/start?state=${state}&access_token=${encodeURIComponent(accessToken)}`
          : `${base}/v1/cycling/rwgps/oauth/start?state=${state}`;
        try {
          popupWindow.location.href = url;
        } catch {
          fail(new Error("Failed to launch authorization popup."));
        }
      })
      .catch(() => {
        // Even if we can't read the session, proceed without a token.
        const state = encodeURIComponent(window.location.origin);
        const base = API_BASE ?? "";
        try {
          popupWindow.location.href = `${base}/v1/cycling/rwgps/oauth/start?state=${state}`;
        } catch {
          fail(new Error("Failed to launch authorization popup."));
        }
      });

    // Detect if the user closes the popup without completing auth.
    const closedTimer = setInterval(() => {
      if (popupWindow.closed && !settled) {
        fail(new Error("Authorization cancelled."));
      }
    }, 500);
  });
}
