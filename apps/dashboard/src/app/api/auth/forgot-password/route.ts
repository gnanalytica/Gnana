import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createDatabase, users, passwordResetTokens, eq } from "@gnana/db";
import { sendPasswordResetEmail } from "@/lib/email";

const db = createDatabase(process.env.DATABASE_URL!);

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

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

    // Always return success to avoid leaking whether the email exists
    return NextResponse.json({
      message: "If an account exists with that email, we've sent a reset link.",
    });
  } catch {
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
