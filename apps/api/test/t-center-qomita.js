// Kunlik tushum ↔ Qo'mita mablag'lari: 1.11 (3802 — Call markaz), 1.14 + 1.15 (Marksheyder) — Qo'mita yozuvlari bilan BITTA pul.
// Daromad — kassa summasi: Qo'mita yozuvlari bor bo'lsa, faqat farq (kassa ko'p bo'lsa) yoziladi; ikki marta sanalmaydi.
// TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { CenterIncomeService } = require('../dist/modules/cashbook/center-income.service');

const acc = (id, key, code, name) => ({ id, key, code, name, number: null, parentId: 'root', rollupId: null, sortOrder: 10, inputs: ['daily', 'mtd', 'ytd'], sums: [], balanceRule: 'ADD', isHeader: false, isActive: true, level: 1 });
const ACCOUNTS = [
  { ...acc('root', 'I', null, 'I. Markaz hisobraqamlari'), parentId: null, isHeader: true, inputs: [], level: 0 },
  acc('ehf', 'I.1', '1.1', 'EHF'),
  acc('q11', 'I.11', '1.11', "3802-Haq evaziga xizmat ko'rsatish-2026/1"),
  acc('q14', 'I.14', '1.14', 'Marksheyderlik xizmati uchun (2026/2-son shartnoma)'),
  acc('q15', 'I.15', '1.15', "Qo'mita tomonidan marksheyder tushumi"),
];
const cashbook = { accounts: async () => ACCOUNTS };
const som = (n) => BigInt(n) * 100n;

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.region.push({ code: 0, name: 'Markaz' });
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  T.incomeCategory.push({ code: 'QOMITA_20', label: "Qo'mita ajratmasi: Marksheyder", order: 1 }, { code: 'QOMITA_22', label: "Qo'mita ajratmasi: Call markaz", order: 2 });
  T.cashReport.push({ id: 'r5', date: new Date('2026-05-31T00:00:00Z') }, { id: 'r7', date: new Date('2026-07-31T00:00:00Z') });
  // «Oy boshidan» har oy noldan («Yil boshidan» boshqacha) — oy daromadi = shu oy qiymati
  const line = (reportId, accountId, mtd) => T.cashReportLine.push({ id: `${reportId}-${accountId}`, reportId, accountId, mtdTiyin: som(mtd), ytdTiyin: som(mtd) + som(1) });
  // May: kassa = Qo'mita yozuvlari (yaxlitlash farqi 29 so'm); July: kassada ko'p
  line('r5', 'ehf', 1000);
  line('r5', 'q11', 2182605500);
  line('r5', 'q14', 1076431400);
  line('r7', 'ehf', 500);
  line('r7', 'q11', 5092746300);
  const qomita = (period, categoryCode, amount) =>
    T.income.push({ id: `q-${period}-${categoryCode}`, date: new Date(`${period}-20T07:00:00Z`), period, amountTiyin: som(amount), paidTiyin: som(amount), categoryCode, segment: 'QOMITA', regionCode: null, departmentId: null, source: 'MANUAL', section: 'DOIMIY', importBatchId: null, deletedAt: null });
  qomita('2026-05', 'QOMITA_22', 2182605529);
  qomita('2026-05', 'QOMITA_20', 1076431402);
  qomita('2026-07', 'QOMITA_22', 3880187606);

  const svc = new CenterIncomeService(db.client, cashbook, { log: async () => {} });
  const live = (period) => T.income.filter((x) => x.period === period && !x.deletedAt);
  const total = (list) => list.reduce((s, x) => s + x.amountTiyin, 0n);

  // May: Qo'mita qatorlari kassadan yozilmaydi — faqat EHF; daromad = 1000 + Qo'mita yozuvlari (ikki marta emas)
  await svc.syncPeriod('2026-05', 'adm');
  const may = live('2026-05');
  assert.deepStrictEqual(may.filter((x) => x.importBatchId === 'kassa:2026-05').map((x) => x.categoryCode), ['KASSA-I.1'], 'kassadan faqat EHF');
  assert.strictEqual(total(may), som(1000) + som(2182605529) + som(1076431402), 'Qo‘mita puli bir marta');

  // July: kassa 5 092 746 300 > Qo'mita 3 880 187 606 — farq Qo'mita moddasiga (Call markaz) yoziladi
  await svc.syncPeriod('2026-07', 'adm');
  const jul = live('2026-07');
  const extra = jul.filter((x) => x.importBatchId === 'kassa:2026-07' && x.categoryCode === 'QOMITA_22');
  assert.strictEqual(extra.length, 1);
  assert.strictEqual(extra[0].amountTiyin, som(5092746300 - 3880187606), 'farq');
  assert.strictEqual(extra[0].segment, 'QOMITA');
  assert.strictEqual(total(jul.filter((x) => x.categoryCode === 'QOMITA_22')), som(5092746300), 'Call markaz jami = kassa');
  assert.strictEqual(total(jul), som(500) + som(5092746300), 'daromad — kassa summasi');

  // Ko'rinish: solishtiruv va bog'lanish
  const y = await svc.year(2026);
  const m5 = y.months.find((m) => m.period === '2026-05');
  assert.strictEqual(m5.markazTiyin, String(som(1000)), 'Markaz daromadi — Qo‘mita qatorlarisiz');
  assert.strictEqual(m5.qomitaKassaTiyin, String(som(2182605500 + 1076431400)));
  assert.ok(m5.inSync, 'May — sinxron');
  assert.deepStrictEqual(m5.qomita.map((x) => [x.code, x.extraTiyin]), [['QOMITA_20', '0'], ['QOMITA_22', '0']], 'yaxlitlash farqi — yozilmaydi');
  const m7 = y.months.find((m) => m.period === '2026-07');
  assert.ok(m7.inSync, 'July — sinxron');
  assert.strictEqual(m7.qomita[0].extraTiyin, String(som(5092746300 - 3880187606)));
  assert.strictEqual(y.rows.find((r) => r.id === 'q14').qomitaCode, 'QOMITA_20');
  assert.strictEqual(y.rows.find((r) => r.id === 'q11').qomitaCode, 'QOMITA_22');
  assert.strictEqual(y.rows.find((r) => r.id === 'ehf').qomitaCode, null);

  // Qo'lda: 1.11 ni Qo'mitadan ajratish — yana oddiy kassa daromadi (Markaz)
  await svc.setModes({ year: 2026, qomita: { q11: '' } }, 'adm');
  const jul2 = live('2026-07');
  assert.ok(jul2.some((x) => x.categoryCode === 'KASSA-I.11' && x.importBatchId === 'kassa:2026-07'), '1.11 — kassa daromadi');
  assert.ok(!jul2.some((x) => x.importBatchId === 'kassa:2026-07' && x.categoryCode === 'QOMITA_22'), 'farq qatori olib tashlandi');
  await assert.rejects(() => svc.setModes({ year: 2026, qomita: { q11: 'YOQ' } }, 'adm'), /Qo'mita moddasi topilmadi/);

  console.log('t-center-qomita OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
