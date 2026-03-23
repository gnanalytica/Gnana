import { GnanaClient } from "@gnana/client";
import { getSession } from "next-auth/react";

/**
 * Shared API client that automatically attaches the user's JWT session token
 * to every request via the dynamic `getToken` callback.
 *
 * For client-side hooks, `getSession()` from next-auth/react resolves the
 * current session and returns the encoded JWT. The Auth.js JWT strategy stores
 * the token in the `__Secure-authjs.session-token` cookie, and `getSession()`
 * exchanges it for the decoded session object — but the server-side auth
 * middleware actually needs the raw JWT. Auth.js v5 exposes the session token
 * directly when using the JWT strategy via `session.sessionToken`, but the
 * standard mechanism is to call the `/api/auth/session` endpoint, which is
 * what `getSession()` does.
 *
 * Approach: we create a dedicated `/api/auth/token` Next.js route that returns
 * a signed JWT the server can verify with AUTH_SECRET. However, the simplest
 * approach is to sign a JWT on the client. Since Auth.js with JWT strategy
 * already signs a JWT and stores it in the session cookie, we can fetch the
 * raw cookie value. But cookies are httpOnly.
 *
 * Simplest working approach: expose the JWT via the Auth.js `session` callback
 * so `getSession()` returns it, then pass it as the bearer token.
 */
export const api = new GnanaClient({
  url: process.env.NEXT_PUBLIC_GNANA_API_URL ?? "http://localhost:4000",
  apiKey: process.env.NEXT_PUBLIC_GNANA_API_KEY,
  getToken: async () => {
    // On the server side (SSR / RSC), getSession won't work — fall back to apiKey
    if (typeof window === "undefined") return undefined;
    try {
      const session = await getSession();
      return (session as SessionWithToken | null)?.accessToken ?? undefined;
    } catch {
      return undefined;
    }
  },
});

/** Extended session type that includes the JWT access token */
interface SessionWithToken {
  accessToken?: string;
  user?: { id?: string; name?: string; email?: string; image?: string };
  expires?: string;
}
