// ═══════════════════════════════════════════════════════════
// Haqiqiy PostgreSQL bilan testlar uchun umumiy qism.
//
// XAVFSIZLIK: faqat alohida TEST bazasida ishlaydi.
//  • TEST_DATABASE_URL majburiy (DATABASE_URL ishlatilmaydi — ishlab chiqarish bazasiga tegmaslik uchun);
//  • baza nomida «test» so'zi bo'lishi shart, aks holda test darhol to'xtaydi;
//  • har test boshida hamma jadvallar tozalanadi (TRUNCATE) — shuning uchun boshqa bazaga ulanmaydi.
// Bazani tayyorlash: TEST_DATABASE_URL=... pnpm --filter @korxona/db exec prisma db push --skip-generate
// ═══════════════════════════════════════════════════════════
require('reflect-metadata');
const fs = require('fs');
const path = require('path');

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.log('SKIP: TEST_DATABASE_URL berilmagan — PostgreSQL testlari o\'tkazib yuborildi');
  process.exit(0);
}
let dbName = '';
try {
  dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
} catch {
  dbName = '';
}
if (!/test/i.test(dbName)) {
  console.error(`TO'XTATILDI: baza nomida «test» yo'q (${dbName ? 'nomi: ' + dbName.replace(/./g, (c, i) => (i < 2 ? c : '*')) : 'nomi aniqlanmadi'}). Faqat alohida test bazasida ishlang.`);
  process.exit(1);
}

/** dist joylashuvi: dist/modules yoki dist/src/modules */
const root = path.join(__dirname, '..', '..', 'dist');
const base = fs.existsSync(path.join(root, 'modules')) ? root : path.join(root, 'src');
const D = (p) => require(path.join(base, p));

function makeClient() {
  // Sandbox: engine'siz mijoz (PRISMA_TEST_CLIENT — generatsiya qilingan papka, driver adapter bilan)
  if (process.env.PRISMA_TEST_CLIENT) {
    const gen = require(process.env.PRISMA_TEST_CLIENT);
    const { PrismaClient } = gen;
    // Ilova kodi «instanceof Prisma.PrismaClientKnownRequestError» tekshiradi — boshqa generatsiyadagi xato ham tanilsin
    const app = require('@prisma/client').Prisma;
    for (const k of ['PrismaClientKnownRequestError', 'PrismaClientValidationError']) {
      const mine = app[k];
      const other = gen.Prisma[k];
      if (mine && other && mine !== other) Object.defineProperty(mine, Symbol.hasInstance, { value: (e) => Function.prototype[Symbol.hasInstance].call(mine, e) || Function.prototype[Symbol.hasInstance].call(other, e) });
    }
    const { PrismaPg } = require(process.env.PRISMA_TEST_ADAPTER || '@prisma/adapter-pg');
    return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  }
  const { PrismaClient } = require('@prisma/client');
  return new PrismaClient({ datasourceUrl: url });
}

/** Hamma jadvallarni tozalash (test bazasi ekanligi yuqorida tekshirilgan) */
async function reset(prisma) {
  const rows = await prisma.$queryRawUnsafe(`SELECT tablename::text AS tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`);
  if (!rows.length) throw new Error('Test bazasida jadval yo\'q — avval «prisma db push» qiling');
  await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

/** Sun'iy ma'lumot: foydalanuvchi, hududlar, bo'lim, moddalar */
async function seedBase(prisma) {
  const bcrypt = require('bcryptjs');
  await prisma.user.create({ data: { id: 'adm', username: 'admin', passwordHash: bcrypt.hashSync('Sinov-Parol-1', 4), fullName: 'Sinov Admin', role: 'ADMIN' } });
  await prisma.region.createMany({ data: [{ code: 0, name: 'Markaz' }, { code: 3, name: 'Andijon viloyati' }, { code: 8, name: 'Samarqand viloyati' }] });
  await prisma.department.create({ data: { id: 'd1', code: 'D1', name: 'Buxgalteriya', index: 1 } });
  await prisma.category.createMany({
    data: [
      { code: 'IJARA', label: 'Ijara' },
      { code: 'INTERNET', label: 'Internet' },
    ],
  });
  await prisma.incomeCategory.create({ data: { code: 'DAROMAD', label: 'Xizmat daromadi' } });
}

const expectErr = async (p, re) => {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (e) {
    const m = e.response?.message ?? e.message;
    if (!re.test(String(m))) throw e;
    return e;
  }
  throw new Error(`xato kutilgan edi: ${re}`);
};

function run(name, fn) {
  const prisma = makeClient();
  (async () => {
    await reset(prisma);
    await fn(prisma);
    console.log(`OK ${name}`);
  })()
    .catch((e) => {
      // Prisma xatosi juda uzun bo'ladi — faqat mazmuni va qayerdaligi
      const msg = String(e?.message ?? e).split('\n').filter((l) => l.trim() && l.length < 400).slice(-6).join('\n');
      const at = String(e?.stack ?? '').split('\n').find((l) => /test[\\/]pg|dist[\\/]/.test(l)) ?? '';
      console.error(`FAIL ${name}: ${e?.code ? `[${e.code}] ` : ''}${msg}\n${at.trim()}`);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect().catch(() => null));
}

module.exports = { D, makeClient, reset, seedBase, expectErr, run };