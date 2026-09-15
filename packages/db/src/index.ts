import { PrismaClient } from '@prisma/client';

/**
 * Prisma klientning yagona nusxasi.
 *
 * Ishlab chiqish rejimida Next.js/NestJS kodni qayta yuklaganda
 * har safar yangi klient yaratilib, ulanishlar tugab qoladi.
 * `globalThis` da saqlash buni oldini oladi.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export * from '@prisma/client';
export { PrismaClient };

