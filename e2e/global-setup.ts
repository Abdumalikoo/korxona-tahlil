import { createHmac } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// ═══════════════════════════════════════════════════════════
// Brauzer testi uchun kirish — parolsiz:
//  • lokal .env dan DATABASE_URL va JWT_SECRET o'qiladi (hech qayerga chiqarilmaydi);
//  • baza faqat LOKAL bo'lsa (localhost / 127.0.0.1) va faqat O'QISH rejimida — faol administrator topiladi;
//  • 1 soatlik HS256 token yasaladi va brauzer holatiga (localStorage «korxona_token») yoziladi — e2e/.auth (git'da yo'q).
// ═══════════════════════════════════════════════════════════

const root = path.resolve(__dirname, '..');

function env(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
  return out;
}

const b64 = (v: object | Buffer) => (Buffer.isBuffer(v) ? v : Buffer.from(JSON.stringify(v))).toString('base64url');

export default async function globalSetup() {
  const e = { ...env(), ...process.env } as Record<string, string>;
  const url = e.DATABASE_URL ?? '';
  const secret = e.JWT_SECRET ?? '';
  if (!secret) throw new Error('JWT_SECRET .env da yo‘q');
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error('E2E faqat lokal baza bilan ishlaydi');
  // Prisma — API paketidan; ulanish faqat o'qish uchun
  const req = createRequire(path.join(root, 'apps/api/package.json'));
  const { PrismaClient } = req('@prisma/client') as typeof import('@prisma/client');
  const ro = `${url}${url.includes('?') ? '&' : '?'}options=-c%20default_transaction_read_only%3Don`;
  const prisma = new PrismaClient({ datasources: { db: { url: ro } } });
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', isActive: true }, select: { id: true, username: true, role: true, tokenVersion: true }, orderBy: { createdAt: 'asc' } });
  await prisma.$disconnect();
  if (!admin) throw new Error('Faol administrator topilmadi');

  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub: admin.id, username: admin.username, role: admin.role, tv: admin.tokenVersion, iat: now, exp: now + 3600 });
  const sig = b64(createHmac('sha256', secret).update(`${head}.${body}`).digest());
  const token = `${head}.${body}.${sig}`;

  const base = e.E2E_BASE_URL ?? 'http://localhost:3000';
  mkdirSync(path.join(__dirname, '.auth'), { recursive: true });
  writeFileSync(
    path.join(__dirname, '.auth/state.json'),
    JSON.stringify({
      cookies: [],
      // Yuqori panel ko'rinib tursin (oldingi tanlov eslab qolinmasin)
      origins: [{ origin: new URL(base).origin, localStorage: [{ name: 'korxona_token', value: token }, { name: 'topbar-hidden', value: '0' }] }],
    }),
  );
}
