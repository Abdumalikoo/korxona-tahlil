// Tahlil jadvallari: daromad solig'i (JShDS) ish haqi ICHIDA — alohida xarajat qatori bo'lib yozilmaydi (ikki marta
// sanalmasin); ish haqi — to'liq; «Soliqlar»da faqat ijtimoiy soliq; jami o'zgarmaydi. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { ExploreService } = require('../dist/modules/explore/explore.service');

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.region.push({ code: 0, name: 'Markaz' }, { code: 5, name: 'Namuna' });
  T.category.push(
    { code: 'ISH', label: 'Ish haqi fondi', parentCode: null, order: 1 },
    { code: 'PAYROLL_BASE', label: 'Asosiy ish haqi', parentCode: 'ISH', order: 2 },
    { code: 'SOLIQLAR', label: 'Soliqlar', parentCode: null, order: 3 },
    { code: 'SOLIQ_IJTIMOIY', label: 'Ijtimoiy soliq', parentCode: 'SOLIQLAR', order: 4 },
    { code: 'MA', label: 'Kanselyariya', parentCode: null, order: 5 },
  );
  const ex = (amount, categoryCode, source, regionCode = 0) => T.expense.push({ id: `e${T.expense.length}`, date: new Date('2026-09-15T07:00:00Z'), period: '2026-09', amountTiyin: BigInt(amount), categoryCode, source, regionCode, departmentId: null, segment: null, counterparty: null, paymentStatus: 'PAID', deletedAt: null });
  ex(1_000_000_00, 'PAYROLL_BASE', 'PAYROLL');
  ex(500_000_00, 'PAYROLL_BASE', 'PAYROLL', 5);
  ex(180_000_00, 'SOLIQ_IJTIMOIY', 'TAX');
  ex(20_000_00, 'MA', 'MANUAL');
  const svc = new ExploreService(db.client);
  const d = await svc.expense('2026-09-01', '2026-09-30');
  const find = (nodes, label) => nodes.find((n) => n.label === label);
  const cur = (n) => n.cur ?? n.v?.cur ?? n.vals?.cur;
  const ish = find(d.tree, 'Ish haqi fondi');
  const sol = find(d.tree, 'Soliqlar');
  assert.ok(ish && sol, 'guruhlar bor');
  assert.ok(!(sol.children ?? []).some((n) => /daromad solig/i.test(n.label)), 'Soliqlarda daromad solig‘i alohida qator emas');
  const total = d.totals.cur;
  assert.strictEqual(total, 1_700_000_00, 'jami o‘zgarmadi');
  assert.strictEqual(cur(ish), 1_500_000_00, 'ish haqi — to‘liq (daromad solig‘i ichida)');
  assert.strictEqual(cur(sol), 180_000_00, 'Soliqlar — faqat ijtimoiy soliq');
  assert.strictEqual(T.expense.length, 4, 'bazaga hech narsa yozilmadi');
  console.log('OK t-explore-jshds');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
