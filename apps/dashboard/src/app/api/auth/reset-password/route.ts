import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createDatabase, users, passwordResetTokens, eq } from "@gnana/db";
import { createRateLimiter } from "@/lib/rate-limit";

const db = createDatabase(process.env.DATABASE_URL!);

// 5 reset attempts per token per hour
const resetPasswordLimiter = createRateLimiter({ maxAttempts: 5, windowMs: 60 * 60 * 1000 });

export async function POST(request: Request) {
  try {
    const { token, password } = await request.json();

    if (!token || !password) {
      return NextResponse.json({ error: "Token and password are required" }, { status: 400 });
    }

    // Rate limit by token to prevent brute-force attempts
    const { allowed, retryAfterMs } = resetPasswordLimiter.check(
      `reset-password:${token as string}`,
    );

    if (!allowed) {
      return NextResponse.json(
        { error: "Too many reset attempts. Please request a new reset link." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
        },
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 },
      );
    }

    // Look up the token and verify it hasn't expired
    const result = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.token, token))
      .limit(1);

    const resetToken = result[0];

    if (!resetToken || resetToken.expiresAt < new Date()) {
      return NextResponse.json({ error: "Invalid or expired reset link" }, { status: 400 });
    }

    // Hash the new password
    const passwordHash = await bcrypt.hash(password, 12);

    // Update the user's password
    await db.update(users).set({ passwordHash }).where(eq(users.id, resetToken.userId));

    // Delete the used token
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.id, resetToken.id));

    return NextResponse.json({ message: "Password reset successfully" });
  } catch {
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
