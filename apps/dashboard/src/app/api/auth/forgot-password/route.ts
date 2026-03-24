import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createDatabase, users, passwordResetTokens, eq } from "@gnana/db";
import { sendPasswordResetEmail } from "@/lib/email";
import { createRateLimiter } from "@/lib/rate-limit";

const db = createDatabase(process.env.DATABASE_URL!);

// 3 forgot-password attempts per email per hour
const forgotPasswordLimiter = createRateLimiter({ maxAttempts: 3, windowMs: 60 * 60 * 1000 });

/**
 * Add a random delay between minMs and maxMs to prevent timing attacks.
 * This ensures the response time is consistent regardless of whether the
 * email exists in the database or not.
 */
function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    // Rate limit by email (normalized to lowercase)
    const normalizedEmail = (email as string).toLowerCase().trim();
    const { allowed, retryAfterMs } = forgotPasswordLimiter.check(
      `forgot-password:${normalizedEmail}`,
    );

    if (!allowed) {
      return NextResponse.json(
        { error: "Too many password reset requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
        },
      );
    }

    // Record the start time to ensure consistent response timing
    const startTime = Date.now();

    // Look up user — only proceed for credential-based accounts (has passwordHash)
    const result = await db.select().from(users).where(eq(users.email, email)).limit(1);

    const user = result[0];

    if (user?.passwordHash) {
      // Delete any existing reset tokens for this user
      await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));

      // Create a new reset token (64 hex chars, expires in 1 hour)
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await db.insert(passwordResetTokens).values({
        userId: user.id,
        token,
        expiresAt,
      });

      // Send reset email
      await sendPasswordResetEmail(email, token, user.name);
    }

    // Ensure consistent response time (200-400ms total) to prevent timing attacks.
    // If the real work took less than the minimum, pad to a random value in the range.
    const elapsed = Date.now() - startTime;
    const minResponseTime = 200;
    const maxResponseTime = 400;
    if (elapsed < maxResponseTime) {
      const remaining = Math.max(minResponseTime - elapsed, 0);
      const maxRemaining = Math.max(maxResponseTime - elapsed, remaining + 1);
      await randomDelay(remaining, maxRemaining);
    }

    // Always return success to avoid leaking whether the email exists
    return NextResponse.json({
      message: "If an account exists with that email, we've sent a reset link.",
    });
  } catch {
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
