import prismaPkg from '@prisma/client';
const { PrismaClient } = prismaPkg;
const prisma = new PrismaClient();
const TZ = 5 * 3600_000;
const start = new Date(Date.parse('2026-01-01') - TZ);
const end = new Date(Date.parse('2026-09-29') + 86400_000 - TZ);
const mlrd = (t) => (Number(t ?? 0) / 100 / 1e9).toFixed(3).replace('.', ',');
for (const [name, model] of [['XARAJAT', prisma.expense], ['DAROMAD', prisma.income]]) {
  const rows = await model.groupBy({ by: ['source', 'section'], where: { deletedAt: null, date: { gte: start, lt: end } }, _sum: { amountTiyin: true } });
  console.log(`\n${name} (sana bo'yicha, 01.01 — 29.09):`);
  for (const r of rows) console.log(`  ${r.source.padEnd(8)} ${r.section.padEnd(7)} ${mlrd(r._sum.amountTiyin).padStart(10)} mlrd`);
}
await prisma.$disconnect();