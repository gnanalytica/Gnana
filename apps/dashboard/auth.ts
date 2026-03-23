import NextAuth from "next-auth";
import type { NextAuthResult } from "next-auth";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import bcrypt from "bcryptjs";
import * as jose from "jose";
import {
  createDatabase,
  users,
  accounts,
  sessions,
  verificationTokens,
  workspaces,
  workspaceMembers,
  plans,
  eq,
} from "@gnana/db";

const db = createDatabase(process.env.DATABASE_URL!);

const nextAuth: NextAuthResult = NextAuth({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: DrizzleAdapter(db as any, {
    usersTable: users as any,
    accountsTable: accounts as any,
    sessionsTable: sessions as any,
    verificationTokensTable: verificationTokens as any,
  }),
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    }),
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const result = await db
          .select()
          .from(users)
          .where(eq(users.email, credentials.email as string))
          .limit(1);

        const user = result[0];
        if (!user?.passwordHash) return null;

        const isValid = await bcrypt.compare(credentials.password as string, user.passwordHash);
        if (!isValid) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        };
      },
    }),
  ],
  events: {
    async createUser({ user }) {
      if (!user.id) return;

      const slug = user.email
        ? user.email
            .split("@")[0]!
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, "-")
        : `user-${user.id.slice(0, 8)}`;

      const workspaceName = user.name ? `${user.name}'s Workspace` : "Personal Workspace";

      // Create personal workspace
      const ws = await db
        .insert(workspaces)
        .values({
          name: workspaceName,
          slug,
          type: "personal",
          ownerId: user.id,
        })
        .returning();

      const workspace = ws[0]!;

      // Create workspace membership
      await db.insert(workspaceMembers).values({
        workspaceId: workspace.id,
        userId: user.id,
        role: "owner",
        acceptedAt: new Date(),
      });

      // Assign free plan if it exists
      const freePlan = await db.select().from(plans).where(eq(plans.name, "free")).limit(1);

      if (freePlan[0]) {
        await db
          .update(workspaces)
          .set({ planId: freePlan[0].id })
          .where(eq(workspaces.id, workspace!.id));
      }
    },
  },
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.id) {
        session.user.id = token.id as string;
      }

      // Mint an access token the API server can verify with AUTH_SECRET.
      // This is a compact JWT containing the user id and email, signed with
      // the same secret the Gnana API server uses to validate tokens.
      const secret = process.env.AUTH_SECRET;
      if (secret && token?.id) {
        const jwt = await new jose.SignJWT({
          sub: token.id as string,
          email: (token.email as string) ?? "",
        })
          .setProtectedHeader({ alg: "HS256" })
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(new TextEncoder().encode(secret));

        (session as unknown as Record<string, unknown>).accessToken = jwt;
      }

      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
});

export const handlers: NextAuthResult["handlers"] = nextAuth.handlers;
export const signIn: NextAuthResult["signIn"] = nextAuth.signIn;
export const signOut: NextAuthResult["signOut"] = nextAuth.signOut;
export const auth: NextAuthResult["auth"] = nextAuth.auth;
