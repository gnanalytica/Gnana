import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createDatabase, users, workspaces, workspaceMembers, plans, eq } from "@gnana/db";

const db = createDatabase(process.env.DATABASE_URL!);

export async function POST(request: Request) {
  try {
    const { name, email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 },
      );
    }

    // Check if user already exists
    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 },
      );
    }

    // Hash password and create user
    const passwordHash = await bcrypt.hash(password, 12);

    const newUsers = await db
      .insert(users)
      .values({
        name: name || null,
        email,
        passwordHash,
      })
      .returning();

    const newUser = newUsers[0]!;

    // Create personal workspace
    const slug = (email as string)
      .split("@")[0]!
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-");
    const workspaceName = name ? `${name}'s Workspace` : "Personal Workspace";

    const ws = await db
      .insert(workspaces)
      .values({
        name: workspaceName,
        slug,
        type: "personal",
        ownerId: newUser.id,
      })
      .returning();

    const workspace = ws[0]!;

    // Create workspace membership
    await db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: newUser.id,
      role: "owner",
      acceptedAt: new Date(),
    });

    // Assign free plan if it exists
    const freePlan = await db.select().from(plans).where(eq(plans.name, "free")).limit(1);

    if (freePlan[0]) {
      await db
        .update(workspaces)
        .set({ planId: freePlan[0].id })
        .where(eq(workspaces.id, workspace.id));
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
