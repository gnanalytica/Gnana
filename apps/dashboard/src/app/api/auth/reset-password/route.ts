import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createDatabase, users, passwordResetTokens, eq, gt } from "@gnana/db";

const db = createDatabase(process.env.DATABASE_URL!);

export async function POST(request: Request) {
  try {
    const { token, password } = await request.json();

    if (!token || !password) {
      return NextResponse.json({ error: "Token and password are required" }, { status: 400 });
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
