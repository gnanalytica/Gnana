import { auth } from "./auth";
import { NextResponse } from "next/server";
import type { NextMiddleware } from "next/server";

const middleware: NextMiddleware = auth((req) => {
  const { pathname } = req.nextUrl;

  // Public routes that don't require authentication
  const isPublicRoute =
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/auth";

  if (isPublicRoute) {
    return NextResponse.next();
  }

  // Redirect unauthenticated users to sign-in for all protected routes
  if (!req.auth?.user) {
    const signInUrl = new URL("/auth/signin", req.nextUrl.origin);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

export default middleware;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
