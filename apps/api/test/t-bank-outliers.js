// Bank ko'chirmasi › Ajralib turgan to'lovlar: bir martalik, odatdan tashqari summa, izohi butunlay boshqacha; servis —
// ro'yxat, oyma-oy, «oddiy» belgisi, yo'naltirilgani.
// TEST MA'LUMOTLARI SUN'IY (kontragentlar, INN, summalar — o'ylab topilgan).
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { findOutliers, words, similarity } = require('../dist/modules/bank-analysis/bank-outliers');
const { BankAnalysisService } = require('../dist/modules/bank-analysis/bank-analysis.service');

const S = (som) => BigInt(som * 100);
let n = 0;
const R = (o) => ({ key: `k${++n}`, dir: 'OUT', amountTiyin: S(1000000), purpose: 'Ish haqi oylik to‘lovi xodimlar plastik kartasiga', counterparty: 'inn:200000001', group: 'g1', kind: 'PAYROLL', ...o });

// ── So'zlar va o'xshashlik ──
assert.deepStrictEqual(words('Оплата 15.09.2026 по счету №12 за услуги связи'), ['оплата', 'счету', 'услуги', 'связи']);
assert.strictEqual(similarity(['a1x', 'b2y'], ['a1x', 'b2y']), 1);
assert.strictEqual(similarity(['abc'], ['xyz']), 0);

// ── Izohi butunlay boshqacha (tur ichida) ──
const pay = [
  ...Array.from({ length: 9 }, (_, i) => R({ purpose: `Ish haqi oylik to‘lovi ${i + 1}-oy uchun xodimlar plastik kartasiga` })),
  R({ key: 'odd', purpose: 'Server uskunasi va kompyuter jihozlari uchun avans' }),
];
let h = findOutliers(pay, { months: 1, kindLabel: () => 'Ish haqi' });
assert.deepStrictEqual(h.map((x) => x.key), ['odd'], "10 ta ish haqi ichidagi butunlay boshqa to'lov");
assert.strictEqual(h[0].reasons[0].code, 'TEXT');
assert.match(h[0].reasons[0].text, /Ish haqi.*9 ta.*hech biriga/);
// Har xil yozilgan, lekin mazmuni bir — ajralmaydi
h = findOutliers([R({ purpose: 'Ish haqi sentabr oyi uchun' }), R({ purpose: 'Ish haqi oktabr' }), R({ purpose: 'Ish haqi avans to‘lovi' }), R({ purpose: 'Ish haqi qolgan qismi' }), R({ purpose: 'Ish haqi xodimlarga' })], { months: 1 });
assert.strictEqual(h.length, 0, "«ish haqi» so'zlari umumiy");
// 5 tadan kam — solishtirilmaydi
assert.strictEqual(findOutliers(pay.slice(6), { months: 1 }).length, 0);

// ── Odatdan tashqari summa (guruh ichida) ──
const rent = [10, 10, 11, 10, 9, 10].map((m) => R({ group: 'rent', kind: 'RENT', amountTiyin: S(m * 1000000), purpose: 'Ijara haqi ofis binosi' }));
rent.push(R({ key: 'big', group: 'rent', kind: 'RENT', amountTiyin: S(45000000), purpose: 'Ijara haqi ofis binosi' }));
rent.push(R({ key: 'small', group: 'rent', kind: 'RENT', amountTiyin: S(2000000), purpose: 'Ijara haqi ofis binosi' }));
h = findOutliers(rent, { months: 1 });
assert.deepStrictEqual(h.map((x) => x.key).sort(), ['big', 'small']);
assert.match(h.find((x) => x.key === 'big').reasons[0].text, /4,5 baravar katta/);
assert.match(h.find((x) => x.key === 'small').reasons[0].text, /baravar kichik/);
// Kirim — 5 baravar (4,5 baravar — oddiy)
assert.strictEqual(findOutliers(rent.map((r) => ({ ...r, dir: 'IN' })), { months: 1 }).filter((x) => x.key === 'big').length, 0);

// ── Bir martalik (kontragent bo'yicha; jismoniy shaxslar emas; davr > 1 oy) ──
const once = [R({ key: 'new', counterparty: 'inn:300000009', group: 'g9', kind: 'SERVICE', purpose: 'Konsalting xizmati' }), R({ key: 'p1', counterparty: 'person', group: 'gp', kind: 'PAYROLL' })];
assert.deepStrictEqual(findOutliers(once, { months: 3 }).map((x) => x.key), ['new']);
assert.strictEqual(findOutliers(once, { months: 1 }).length, 0, 'bir oylik davrda — bir martalik deyilmaydi');
// Bir nechta sabab — yuqorida
const both = findOutliers([...pay, R({ key: 'odd2', counterparty: 'inn:300000010', group: 'gx', purpose: 'Avtomobil sotib olish shartnoma' })], { months: 3 });
assert.strictEqual(both[0].key, 'odd2');
assert.deepStrictEqual(both[0].reasons.map((x) => x.code).sort(), ['ONCE', 'TEXT']);

// ── Servis ──
(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'u1', fullName: 'Admin Test' });
  const rows = [];
  let i = 0;
  const row = (docDate, inn, accountName, som, purpose) => rows.push({ id: `r${++i}`, docDate, procDate: null, docNo: String(i), accountName, inn, mfo: '00014', dir: 'OUT', amountTiyin: String(som * 100), purpose });
  for (const m of ['01', '02', '03', '04', '05', '06']) row(`2026-${m}-10`, '200000001', 'Ijara MCHJ', 10000000, 'Ijara haqi ofis binosi uchun');
  row('2026-04-12', '200000001', 'Ijara MCHJ', 50000000, 'Ijara haqi ofis binosi uchun');
  row('2026-05-20', '300000009', 'Yangi Konsalting MCHJ', 7000000, 'Konsalting xizmati bir martalik');
  T.setting.push({
    key: 'bank.analysis.store',
    value: {
      accounts: { a1: { key: 'a1', label: '23106', months: Object.fromEntries(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'].map((p) => [p, { batchId: 'b1', fileName: 'k.xlsx', savedAt: '2026-07-01', rows: rows.filter((r) => r.docDate.startsWith(p)) }])) } },
      batches: [],
      notes: {},
      posts: [],
      groups: {},
    },
  });
  const svc = new BankAnalysisService(db.client, { async log() {} });
  const o = await svc.outliers('2026-01', '2026-06');
  const keys = o.items.map((x) => x.rowId);
  assert.ok(keys.includes('r7'), "50 mln ijara — odatdan tashqari");
  assert.ok(keys.includes('r8'), 'yangi kontragent — bir martalik');
  assert.ok(!keys.includes('r1'));
  const big = o.items.find((x) => x.rowId === 'r7');
  assert.strictEqual(big.period, '2026-04');
  assert.strictEqual(big.reasons[0].code, 'AMOUNT');
  assert.strictEqual(big.ok, null);
  assert.strictEqual(o.byMonth.find((m) => m.period === '2026-04').out, 1);
  // «Oddiy» — oyma-oy jamidan chiqadi, ro'yxatda belgisi bilan qoladi
  await svc.markOutliers({ items: [{ account: 'a1', rowId: 'r7' }] }, 'u1');
  const o2 = await svc.outliers('2026-01', '2026-06');
  assert.strictEqual(o2.items.find((x) => x.rowId === 'r7').ok.by, 'Admin Test');
  assert.strictEqual(o2.byMonth.find((m) => m.period === '2026-04').out, 0);
  await svc.markOutliers({ items: [{ account: 'a1', rowId: 'r7' }], ok: false }, 'u1');
  assert.strictEqual((await svc.outliers('2026-01', '2026-06')).items.find((x) => x.rowId === 'r7').ok, null);
  await assert.rejects(() => svc.markOutliers({ items: [] }, 'u1'), /tanlanmagan/);
  assert.ok(T.setting.some((s) => s.key === 'bank.analysis.store.outlier-ok'), 'alohida kalit');
  console.log('OK t-bank-outliers');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
