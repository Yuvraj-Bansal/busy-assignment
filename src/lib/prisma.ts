// src/lib/prisma.ts
//
// Standard Next.js-safe Prisma singleton: in dev, Next.js hot-reloads modules
// on every save, which would otherwise spin up a fresh PrismaClient (and a
// fresh connection pool) per reload. Stashing the instance on `globalThis`
// avoids exhausting Postgres connections during local development.
// [APP] — purely a connection-management concern, not a business rule.

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
