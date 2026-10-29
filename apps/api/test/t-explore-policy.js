// Daromad / Xarajat tahlili (explore): Xarajatlar siyosati Solishtirma kabi qo'llanadi — modda boshqa birlik hisobidan bo'lsa,
// jadvalda ham, yozuvlar ro'yxatida ham o'sha birlikka o'tadi; jami o'zgarmaydi; bazadagi yozuvlar o'zgarmaydi. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { ExploreService } = require('../dist/modules/explore/explore.service');

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.region.push({ code: 0, name: 'Markaz' }, { code: 5, name: 'Namuna' });
  T.category.push(
    { code: 'IJ', label: 'Sinov ijarasi', parentCode: null, order: 1 },
    { code: 'MA', label: 'Kanselyariya', parentCode: null, order: 2 },
  );
  // Siyosat: «Sinov ijarasi» qayerda yozilgan bo'lsa ham — Markaz hisobidan
  T.setting.push({ key: 'expense.policy', value: { centerCategories: ['IJ'] } });
  const ex = (amount, categoryCode, regionCode) =>
    T.expense.push({ id: `e${T.expense.length}`, date: new Date('2026-09-15T07:00:00Z'), period: '2026-09', amountTiyin: BigInt(amount), categoryCode, source: 'MANUAL', regionCode, departmentId: null, segment: null, counterparty: null, paymentStatus: 'PAID', deletedAt: null });
  ex(300, 'IJ', 5); // hududda yozilgan — siyosat bo'yicha Markazga o'tadi
  ex(200, 'MA', 5);
  ex(100, 'MA', 0);
  ex(50, 'IJ', 0); // Markazda yozilgan — joyida qoladi

  const svc = new ExploreService(db.client);
  const d = await svc.expense('2026-09-01', '2026-09-30');
  assert.strictEqual(d.totals.cur, 650, 'jami o‘zgarmadi');
  assert.strictEqual(d.totals.center.cur, 450, 'Markaz: 100 + 50 + siyosat bo‘yicha 300');
  assert.strictEqual(d.totals.regions.cur, 200, 'Hududlar: faqat Kanselyariya');
  assert.strictEqual(d.totals.policy.cur, 300, 'siyosat bo‘yicha o‘tkazilgani');
  assert.strictEqual(d.totals.policy.count, 1);

  // Yozuvlar ro'yxati jadvaldagi summa bilan bir xil
  const rec = (unit, extra = {}) => svc.records('expense', '2026-09-01', '2026-09-30', ExploreService.parseFilter({ unit, ...extra }));
  const center = await rec('center');
  assert.deepStrictEqual([center.total, center.count], [450, 3], 'Markaz yozuvlari');
  const moved = center.rows.find((x) => x.amount === 300);
  assert.ok(moved && moved.unit === 'center' && moved.placeLabel === 'Namuna', 'o‘tkazilgan yozuv: birligi Markaz, yozilgan joyi ko‘rinadi');
  assert.strictEqual(center.rows.find((x) => x.amount === 100).placeLabel, null, 'joyida qolgan yozuvda belgi yo‘q');
  const regions = await rec('regions');
  assert.deepStrictEqual([regions.total, regions.count], [200, 1], 'Hududlar yozuvlari');
  const r5 = await rec('r:5');
  assert.deepStrictEqual([r5.total, r5.count], [200, 1], 'viloyat yozuvlari');
  const ij = await rec('center', { cats: 'IJ' });
  assert.deepStrictEqual([ij.total, ij.count], [350, 2], 'Markaz › Sinov ijarasi');

  assert.strictEqual(T.expense.length, 4, 'bazaga hech narsa yozilmadi');
  console.log('OK t-explore-policy');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
