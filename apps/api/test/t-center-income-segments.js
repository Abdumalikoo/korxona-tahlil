// Kunlik tushum → Markaz daromadi: «Tax free (10 %)» qatori Tax free yo'nalishiga, «marksheyder» qatorlari —
// Marksheyderga (segment bilan, hudud/bo'limsiz); qolgani — Markaz. Egasi qo'lda o'zgartiriladi. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { CenterIncomeService } = require('../dist/modules/cashbook/center-income.service');

const acc = (id, key, name, extra = {}) => ({ id, key, code: null, name, number: null, parentId: 'root', rollupId: null, sortOrder: 10, inputs: ['daily', 'mtd', 'ytd'], sums: [], balanceRule: 'ADD', isHeader: false, isActive: true, level: 1, ...extra });
const ACCOUNTS = [
  { ...acc('root', 'I', "I. Markaz hisobraqamlari", { parentId: null, isHeader: true, inputs: [], level: 0 }) },
  acc('a1', 'I.1', 'EHF'),
  acc('a2', 'I.2', 'Tax free (10 %)'),
  acc('a3', 'I.3', "Qo'mita tomonidan marksheyder tushumi"),
  acc('a4', 'I.4', 'Marksheyderlik xizmati uchun (2026/2-son shartnoma)'),
];
const cashbook = { accounts: async () => ACCOUNTS };

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.region.push({ code: 0, name: 'Markaz' });
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  T.cashReport.push({ id: 'r1', date: new Date('2026-03-31T00:00:00Z') });
  const line = (accountId, mtd) => T.cashReportLine.push({ id: `l${accountId}`, reportId: 'r1', accountId, mtdTiyin: BigInt(mtd) * 100n, ytdTiyin: null });
  line('a1', 1000);
  line('a2', 300);
  line('a3', 200);
  line('a4', 100);
  const audit = { log: async () => {} };
  const svc = new CenterIncomeService(db.client, cashbook, audit);

  const r = await svc.syncPeriod('2026-03', 'adm');
  assert.strictEqual(r.created, 4);
  const by = (cat) => T.income.find((x) => x.categoryCode === `KASSA-${cat}`);
  assert.strictEqual(by('I.1').segment ?? null, null);
  assert.strictEqual(by('I.1').regionCode, 0, 'EHF — Markaz');
  assert.strictEqual(by('I.2').segment, 'TAX_FREE');
  assert.strictEqual(by('I.2').regionCode, null, "yo'nalish — hududsiz");
  assert.strictEqual(by('I.3').segment, 'MARKSHEYDER');
  assert.strictEqual(by('I.4').segment, 'MARKSHEYDER');

  let y = await svc.year(2026);
  const row = (id) => y.rows.find((x) => x.id === id);
  assert.strictEqual(row('a2').owner, 'TAX_FREE');
  assert.strictEqual(row('a1').owner, 'CENTER');
  const mar = y.months.find((m) => m.period === '2026-03');
  assert.strictEqual(mar.segmentsTiyin, String(600n * 100n), "yo'nalishlarga: 300 + 200 + 100");

  // Qo'lda: Qo'mita marksheyder tushumini Markazga qaytarish
  y = await svc.setModes({ year: 2026, owners: { a3: 'CENTER' } }, 'adm');
  assert.strictEqual(y.rows.find((x) => x.id === 'a3').owner, 'CENTER');
  assert.strictEqual(by('I.3').segment ?? null, null, 'qayta yozildi — Markaz');
  assert.strictEqual(by('I.3').regionCode, 0);
  assert.strictEqual(T.income.filter((x) => x.importBatchId === 'kassa:2026-03').length, 4, 'ikki marta yozilmaydi');

  await assert.rejects(() => svc.setModes({ year: 2026, owners: { a1: 'XYZ' } }, 'adm'), /noto'g'ri/);

  // Markaz qatorining bo'limi: daromad doim shu bo'limga (qayta yozilganda ham); yo'nalish qatorida — bo'lim yo'q
  T.department.push({ id: 'dPay', name: "To'lov tizimi va marketing", index: 18, isActive: true });
  y = await svc.setModes({ year: 2026, departments: { a1: 'dPay' } }, 'adm');
  assert.strictEqual(y.rows.find((x) => x.id === 'a1').departmentId, 'dPay');
  assert.deepStrictEqual([by('I.1').regionCode, by('I.1').departmentId], [0, 'dPay'], 'EHF — Markaz › To‘lov tizimi');
  assert.strictEqual(by('I.2').departmentId ?? null, null, 'Tax free — yo‘nalish, bo‘limsiz');
  await svc.syncPeriod('2026-03', 'adm');
  assert.strictEqual(by('I.1').departmentId, 'dPay', 'qayta sinxronlashda ham — doim shu bo‘lim');
  await assert.rejects(() => svc.setModes({ year: 2026, departments: { a1: 'yoq' } }, 'adm'), /bo'limi topilmadi/);
  y = await svc.setModes({ year: 2026, departments: { a1: null } }, 'adm');
  assert.strictEqual(by('I.1').departmentId ?? null, null, 'olib tashlansa — Markaz › Umumiy');

  console.log('t-center-income-segments OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
