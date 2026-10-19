import prismaPkg from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
for (const file of [resolve(here, '../.env'), resolve(here, '../prisma/.env')]) {
  if (process.env.DATABASE_URL || !existsSync(file)) continue;
  const m = /^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?\s*$/m.exec(readFileSync(file, 'utf8'));
  if (m) process.env.DATABASE_URL = m[1];
}

const { PrismaClient } = prismaPkg;
const prisma = new PrismaClient();
const json = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2);
const log = (title, value) => console.log(`\n##### ${title} #####\n${typeof value === 'string' ? value : json(value)}`);
const safe = async (title, fn) => { try { log(title, await fn()); } catch (e) { log(title, 'XATO: ' + e.message.split('\n').slice(-3).join(' ')); } };

await safe('Jadvallar va yozuvlar soni', async () => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT relname AS table, n_live_tup AS rows FROM pg_stat_user_tables ORDER BY relname`);
  return rows.map((r) => `${r.table}: ${r.rows}`).join('\n');
});
await safe('Xarajat kategoriyalari (daraxt)', async () =>
  (await prisma.category.findMany({ orderBy: [{ parentCode: 'asc' }, { order: 'asc' }] }))
    .map((c) => `${c.parentCode ?? '-'} > ${c.code} | ${c.label} | leaf=${c.isLeaf} | active=${c.isActive}`).join('\n'));
await safe('Daromad turlari', async () =>
  (await prisma.incomeCategory.findMany()).map((c) => `${c.code} | ${c.label}`).join('\n'));
await safe('Hududlar', async () => (await prisma.region.findMany({ orderBy: { code: 'asc' } })).map((r) => `${r.code} ${r.name}`).join('\n'));
await safe('Bo\'limlar', async () => (await prisma.department.findMany()).map((d) => `${d.id} | ${d.name}`).join('\n'));
await safe('Xodimlar: turi va hudud bo\'yicha', async () =>
  prisma.employee.groupBy({ by: ['employmentType', 'regionCode'], _count: { _all: true } }));
await safe('Xodim namunasi', async () => prisma.employee.findFirst());
await safe('Ish haqi yuklamalari (batch)', async () =>
  prisma.payrollBatch.findMany({ orderBy: { period: 'asc' } }));
await safe('Ish haqi yozuvi namunasi', async () => prisma.payrollEntry.findFirst({ where: { deletedAt: null } }));
await safe('Ish haqi: oy bo\'yicha', async () =>
  prisma.payrollEntry.groupBy({ by: ['period'], where: { deletedAt: null }, _count: { _all: true }, _sum: { totalTiyin: true } }));
await safe('PAYROLL xarajat namunalari', async () =>
  prisma.expense.findMany({ where: { source: 'PAYROLL' }, take: 3 }));
await safe('PAYROLL xarajat: oy × kategoriya', async () =>
  prisma.expense.groupBy({ by: ['period', 'categoryCode'], where: { source: 'PAYROLL', deletedAt: null }, _count: { _all: true }, _sum: { amountTiyin: true } }));
await safe('Ish haqi tarkibi: komponentlar', async () => prisma.salaryComponent.findMany());
await safe('Ish haqi tarkibi: yuklamalar', async () => prisma.salaryCompositionBatch.findMany({ take: 5 }));
await safe('Ish haqi tarkibi: qator va element namunasi', async () => ({
  row: await prisma.salaryCompositionRow.findFirst(),
  item: await prisma.salaryCompositionItem.findFirst(),
}));
await safe('Hududlar tushumi: namuna', async () =>
  prisma.income.findMany({ where: { source: 'IMPORT', regionCode: { not: null }, NOT: { description: { startsWith: '[DEMO]' } } }, take: 3 }));
await safe('Ijara: namuna', async () => ({
  lease: await prisma.lease.findFirst({ include: { terms: true } }),
  close: await prisma.leaseMonthClose.findFirst(),
  leases: await prisma.lease.count(),
}));
await safe('Xodim natijalari: model nomlari', async () =>
  Object.keys(prisma).filter((k) => !k.startsWith('$') && !k.startsWith('_')).join(', '));
await prisma.$disconnect();