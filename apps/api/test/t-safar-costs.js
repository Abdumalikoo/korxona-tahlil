// Solishtirma › «Xizmat safari» ichi: kimga qancha, oyma-oy; to'lovchi (Markaz / hudud o'zi) — o'zgartirish.
// TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { SafarCostsService } = require('../dist/modules/structure/safar-costs.service');
const { ExpensePolicyService } = require('../dist/modules/expense-policy/expense-policy.service');
const { safarExpenseMeta } = require('../dist/modules/acc-23106/acc23106.safar-ids');

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  T.category.push({ code: 'HM_HUDUD', label: 'Hudud xodimlari uchun', parentCode: null, isLeaf: false, isActive: true }, { code: 'HM_SAFAR', label: 'Xizmat safari', parentCode: 'HM_HUDUD', isLeaf: true, isActive: true });
  const ex = (id, date, amount, place) => T.expense.push({ id, date: new Date(`${date}T07:00:00Z`), period: date.slice(0, 7), amountTiyin: BigInt(amount), categoryCode: 'HM_SAFAR', deletedAt: null, section: 'BOSHQA', segment: null, regionCode: null, departmentId: null, districtId: null, ...place });
  ex('e1', '2026-07-10', 100, { regionCode: 5, districtId: '5-1' });
  ex('e2', '2026-08-10', 50, { regionCode: 0, departmentId: 'd1' });
  ex('e3', '2026-08-12', 30, { regionCode: 5, districtId: '5-1' });
  ex('e4', '2026-08-15', 70, { regionCode: 5 }); // qo'lda yozilgan — 23106 safari emas
  ex('e5', '2026-07-20', 40, { regionCode: 5, districtId: '5-1' });
  const item = (expenseId, fullName, pinfl, label) => ({ expenseId, fullName, pinfl, place: { label } });
  T.setting.push({
    key: 'acc23106.safar',
    value: {
      posts: [
        { id: 'p1', status: 'POSTED', items: [item('e1', 'Sinov Bir', '71000000000001', 'Hududlar › Namuna › Birinchi'), item('e2', 'Sinov Ikki', '71000000000002', 'Markaz › AUP'), item('e3', 'Sinov Bir', '71000000000001', 'Hududlar › Namuna › Birinchi')] },
        { id: 'p2', status: 'CANCELLED', items: [item('e5', 'Bekor', null, '')] },
      ],
    },
  });
  const meta = await safarExpenseMeta(db.client);
  assert.deepStrictEqual([...meta.keys()].sort(), ['e1', 'e2', 'e3'], 'bekor qilingani kirmaydi');

  const svc = new SafarCostsService(db.client);
  const q = (unit) => svc.costs({ unit, from: '2026-07-01', to: '2026-08-31' });
  let r = await q('r:5');
  assert.deepStrictEqual([r.totalTiyin, r.items.length, r.items[0].fullName, r.items[0].count, r.items[0].months], ['130', 1, 'Sinov Bir', 2, { '2026-07': '100', '2026-08': '30' }], 'xodim → oylar');
  assert.strictEqual((await q('dist:5-1')).totalTiyin, '130');
  assert.strictEqual((await q('center')).totalTiyin, '50');
  assert.strictEqual((await q('dep:d1')).items[0].fullName, 'Sinov Ikki');
  assert.strictEqual((await q('center:regional')).totalTiyin, '0');

  // ── To'lovchi: hududlarning xizmat safarini Markaz to'laydi ──
  const pol = new ExpensePolicyService(db.client, new AuditService(db.client), {});
  await assert.rejects(pol.setPayer('HM_SAFAR', 'kimdir', 'adm'), /noto'g'ri/);
  const g = await pol.setPayer('HM_SAFAR', 'center', 'adm');
  assert.strictEqual(g.categories.find((c) => c.code === 'HM_SAFAR').payer, 'center');
  assert.strictEqual((await q('r:5')).totalTiyin, '0', 'hududda endi yo‘q');
  r = await q('center:regional');
  assert.deepStrictEqual([r.totalTiyin, r.items[0].placeLabel], ['180', 'Hududlar › Namuna › Birinchi'], 'Markaz hisobidan — xodim joyi bilan (Solishtirma «Hududlar uchun to‘langan» bilan bir xil)');
  assert.strictEqual((await q('center')).totalTiyin, '0', "Markazning o'z safari ham Markaz hisobidan — lekin «hududlar uchun»");
  // Yo'nalish hisobidan va qaytarish
  await pol.setPayer('HM_SAFAR', 'TAX_FREE', 'adm');
  assert.strictEqual((await q('s:TAX_FREE')).totalTiyin, '180');
  const back = await pol.setPayer('HM_SAFAR', 'region', 'adm');
  assert.strictEqual(back.categories.find((c) => c.code === 'HM_SAFAR').payer, 'region');
  assert.strictEqual((await q('r:5')).totalTiyin, '130', 'yana hudud o‘zi');
  // Ota modda siyosatda bo'lsa — ichki modda istisno qilinadi
  await pol.save(['HM_HUDUD'], 'adm', [], {});
  assert.strictEqual((await q('r:5')).totalTiyin, '0');
  await pol.setPayer('HM_SAFAR', 'region', 'adm');
  assert.strictEqual((await q('r:5')).totalTiyin, '130', "ota Markazda, safar — istisno (hudud o'zi)");

  console.log('OK t-safar-costs');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
