// src/lib/auth.ts
//
// Session handling + role extraction, built on NextAuth v5 (Auth.js) with
// email/password Credentials auth and a JWT session strategy (no separate
// Session table needed — the role and user id are embedded in the signed
// JWT so every request can authorize without an extra DB round trip).
//
// NOTE ON SWAPPING TO LUCIA: nothing outside this file imports from
// "next-auth" directly. Every other module (permissions.ts, the services,
// route handlers) only ever imports the `SessionUser` type and the
// `getCurrentUser()` / `requireUser()` functions below. If you swap to
// Lucia instead, you only need to reimplement those three exports — the
// rest of the codebase (RBAC, services) is auth-library-agnostic.

import NextAuth, { type DefaultSession, type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { UnauthorizedError } from "./errors";
import type { Role } from "@prisma/client";

/**
 * The normalized shape every other module in the app depends on.
 * Deliberately NOT the raw NextAuth `Session["user"]` type, so the rest of
 * the codebase doesn't couple to NextAuth's shape.
 */
export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role; // "ORGANIZER" | "CHECK_IN_STAFF"
};

// Augment NextAuth's built-in types so `session.user.role` / `.id` are typed
// end-to-end instead of falling back to `any`.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSession["user"];
  }
  interface User {
    role: Role;
  }
}
import type {} from "next-auth/jwt";
declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
  }
}

const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.isActive) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        // Shape returned here becomes `user` in the jwt() callback below.
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    // Runs on sign-in and on every subsequent JWT refresh.
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role: Role }).role;
      }
      return token;
    },
    // Runs whenever session data is read (e.g. via `auth()` below).
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

/**
 * Reads the current request's session and normalizes it into a
 * `SessionUser`, or `null` if nobody is signed in. Safe to call from Server
 * Components, Server Actions, and Route Handlers.
 *
 * Returning `null` (rather than throwing) is intentional: some flows —
 * public self-service registration — are legitimately anonymous. Anything
 * that actually *requires* a signed-in user should call `requireUser()`
 * instead.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user) return null;
  return {
    id: session.user.id,
    name: session.user.name ?? "",
    email: session.user.email ?? "",
    role: session.user.role,
  };
}

/**
 * Same as `getCurrentUser()` but throws `UnauthorizedError` (401) instead of
 * returning null. Use this at the top of any Server Action / route handler
 * that has no anonymous/public path.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new UnauthorizedError();
  }
  return user;
}
