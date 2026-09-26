/**
 * Access-token bookkeeping for Drive sync, kept pure so it's unit tested.
 *
 * GIS's browser token flow has no refresh token (that needs a backend), and
 * asking for a new token opens a popup, which browsers block unless it comes
 * from a click. So an expired token can't be renewed from the background
 * sync timer. Instead the sync stops before using a stale token, and the UI
 * asks the user to sign in again. Their edits stay in the app meanwhile.
 */

export interface AccessToken {
  value: string;
  /** Epoch ms. */
  expiresAt: number;
}

/** Treat a token as expired this long before Google does, so a sync never starts with one about to lapse. */
export const EXPIRY_MARGIN_MS = 60_000;

const DEFAULT_LIFETIME_S = 3600;

/** The token's value if it's still safe to use at `now`, else null. */
export function usableToken(token: AccessToken | null, now: number): string | null {
  if (!token || now >= token.expiresAt - EXPIRY_MARGIN_MS) return null;
  return token.value;
}

/** A GIS token response to an AccessToken. `expires_in` is in seconds and may arrive as a string. */
export function tokenFromResponse(
  response: { access_token: string; expires_in?: number | string },
  now: number,
): AccessToken {
  const seconds = Number(response.expires_in);
  const lifetime = Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_LIFETIME_S;
  return { value: response.access_token, expiresAt: now + lifetime * 1000 };
}
