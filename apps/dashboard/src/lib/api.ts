import { GnanaClient, GnanaError } from "@gnana/client";
import { getSession } from "next-auth/react";

/** Extended session type that includes the JWT access token */
interface SessionWithToken {
  accessToken?: string;
  user?: { id?: string; name?: string; email?: string; image?: string };
  expires?: string;
}

/**
 * Fetches a fresh access token from the current Auth.js session.
 *
 * `getSession()` calls the `/api/auth/session` endpoint which triggers the
 * Auth.js session callback, minting a fresh 1-hour JWT each time. This means
 * calling `getSession()` again after a 401 will yield a new, valid token as
 * long as the user's underlying session (cookie) hasn't expired.
 *
 * Returns `undefined` on the server side (SSR/RSC) or if no session exists.
 */
async function fetchAccessToken(): Promise<string | undefined> {
  if (typeof window === "undefined") return undefined;
  try {
    const session = await getSession();
    return (session as SessionWithToken | null)?.accessToken ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Dashboard-specific API client that extends GnanaClient with automatic
 * JWT refresh on 401 responses.
 *
 * When the API returns 401 (expired JWT), the client re-fetches the session
 * to obtain a fresh access token and retries the request once. This avoids
 * forcing users to re-authenticate when their 1-hour JWT expires mid-session.
 */
class DashboardClient extends GnanaClient {
  async fetch(path: string, init?: RequestInit): Promise<Response> {
    try {
      return await super.fetch(path, init);
    } catch (err) {
      // Only attempt refresh on client-side 401 errors
      if (
        err instanceof GnanaError &&
        err.status === 401 &&
        typeof window !== "undefined"
      ) {
        // Re-fetch the session to get a freshly-minted JWT
        const freshToken = await fetchAccessToken();
        if (freshToken) {
          // Retry the request with the fresh token injected directly via headers
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${freshToken}`,
            ...(init?.headers as Record<string, string>),
          };

          const response = await globalThis.fetch(
            `${this.baseUrl}${path}`,
            { ...init, headers },
          );

          if (!response.ok) {
            const body = await response.text().catch(() => "");
            throw new GnanaError(response.status, body);
          }

          return response;
        }
      }
      throw err;
    }
  }
}

export const api = new DashboardClient({
  url: process.env.NEXT_PUBLIC_GNANA_API_URL ?? "http://localhost:4000",
  apiKey: process.env.NEXT_PUBLIC_GNANA_API_KEY,
  getToken: fetchAccessToken,
});
