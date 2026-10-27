// Solishtirma ichma-ich: xarajat qismi → ichki moddalar → kontragentlar; siyosat qismi → qayerda yozilgani.
// TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { PartDetailService } = require('../dist/modules/structure/part-detail.service');

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.region.push({ code: 0, name: 'Markaz' }, { code: 5, name: 'Namuna' });
  T.department.push({ id: 'd1', name: 'AUP' });
  T.category.push(
    { code: 'MA', label: "Ma'muriy", parentCode: null },
    { code: 'MA_K', label: 'Kanselyariya', parentCode: 'MA' },
    { code: 'MA_A', label: 'Aloqa', parentCode: 'MA' },
    { code: 'TR', label: 'Transport', parentCode: null },
    { code: 'HM', label: 'Hududlar uchun', parentCode: null },
  );
  const ex = (date, amount, categoryCode, place, extra = {}) =>
    T.expense.push({ id: `e${T.expense.length}`, date: new Date(`${date}T07:00:00Z`), amountTiyin: BigInt(amount), categoryCode, regionCode: 5, departmentId: null, districtId: null, segment: null, source: 'MANUAL', counterparty: null, description: null, deletedAt: null, section: 'BOSHQA', ...place, ...extra });
  ex('2026-09-02', 100, 'MA_K', {}, { counterparty: 'Qog‘oz MChJ', description: 'A4 qog‘oz' });
  ex('2026-09-03', 50, 'MA_K', {}, { counterparty: 'Qog‘oz MChJ', description: 'Ruchka' });
  ex('2026-09-04', 30, 'MA_A', {}, { counterparty: 'Aloqa AJ' });
  ex('2026-08-04', 20, 'MA_A', {}, { counterparty: 'Aloqa AJ' }); // o'tgan oy
  ex('2026-09-05', 70, 'TR', {}, { counterparty: null });
  ex('2026-09-06', 999, 'MA_K', { regionCode: 0, departmentId: 'd1' }); // Markaz — hududga kirmaydi
  ex('2026-09-07', 40, 'HM', {}); // siyosat bo'yicha Markazga
  T.setting.push({ key: 'expense.policy', value: { centerCategories: ['HM'] } });

  const svc = new PartDetailService(db.client);
  const q = (unit, key) => svc.detail({ unit, key, from: '2026-09-01', to: '2026-09-30' });
  let d = await q('r:5', 'c:MA');
  assert.deepStrictEqual([d.level, d.items.map((i) => [i.key, i.label, i.amountTiyin, i.previousTiyin])], ['cats', [['cat:MA_K', 'Kanselyariya', '150', '0'], ['cat:MA_A', 'Aloqa', '30', '20']]]);
  d = await q('r:5', 'cat:MA_K');
  assert.deepStrictEqual([d.level, d.items[0].label, d.items[0].count, d.items[0].sub, d.items[0].key], ['party', 'Qog‘oz MChJ', 2, 'Ruchka', null], 'kontragent, oxirgi izoh');
  d = await q('r:5', 'c:TR');
  assert.deepStrictEqual([d.level, d.items[0].label], ['party', 'Kontragent ko‘rsatilmagan'], "ichki moddasiz — darhol kontragentlar");
  d = await q('center', 'c:MA');
  assert.strictEqual(d.totalTiyin, '999');
  d = await q('center:regional', 'HM');
  assert.deepStrictEqual([d.level, d.items[0].label, d.totalTiyin], ['place', 'Namuna', '40'], 'hududlar uchun — qayerda yozilgani');
  assert.strictEqual((await q('r:5', 'c:HM')).totalTiyin, '0', 'siyosat qismi oddiy moddaga kirmaydi');
  await assert.rejects(q('r:5', 'PAYROLL'), /ochilmaydi/);
  console.log('OK t-part-detail');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
