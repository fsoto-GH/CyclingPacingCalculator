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
 */

const TOKEN_KEY = "rwgps_access_token";
const USER_ID_KEY = "rwgps_user_id";

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
    // Pass the opener's origin through the OAuth state parameter so the
    // backend callback can postMessage back to the correct origin.
    const state = encodeURIComponent(window.location.origin);
    const url = `/v1/cycling/rwgps/oauth/start?state=${state}`;

    const popup = window.open(
      url,
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

    let settled = false;

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

    // Detect if the user closes the popup without completing auth.
    const closedTimer = setInterval(() => {
      if (popup.closed && !settled) {
        settled = true;
        clearInterval(closedTimer);
        window.removeEventListener("message", onMessage);
        reject(new Error("Authorization cancelled."));
      }
    }, 500);
  });
}
