// Hisobotlar › Bo'limlar bo'yicha: Markaz bo'limi, hudud (tuman bilan), yo'nalish; oyma-oy o'sish, o'zini qoplash,
// daromad / xarajat tarkibi, ish haqi, ismlar faqat administratorga, o'zgarishlar, Excel va PDF.
// TEST MA'LUMOTLARI SUN'IY (ismlar, JShShIR, summalar — o'ylab topilgan).
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { UnitsReport } = require('../dist/modules/reports/report.units');
const { renderExcel } = require('../dist/modules/reports/render.excel');
const { renderPdf } = require('../dist/modules/reports/render.pdf');

const db = fakeDb();
const T = db.tables;
const S = (som) => BigInt(som * 100);
T.department.push({ id: 'dK', name: 'Kadrlar', code: 'K', index: 5, isActive: true, order: 1 }, { id: 'dS', name: 'Savdo', code: 'S', index: 6, isActive: true, order: 2 });
T.region.push({ code: 3, name: 'Andijon viloyati', isActive: true });
T.district.push({ id: '3-1', regionCode: 3, name: 'Asaka tumani' });
T.category.push({ code: 'PAY', label: 'Ish haqi fondi', parentCode: null }, { code: 'PAY_BASE', label: 'Asosiy ish haqi', parentCode: 'PAY' }, { code: 'OFIS', label: 'Ofis', parentCode: null });
T.incomeCategory.push({ code: 'XIZ', label: 'Xizmat' });
let n = 0;
const ex = (period, som, o) => T.expense.push({ id: `e${++n}`, period, amountTiyin: S(som), categoryCode: o.cat ?? 'PAY_BASE', counterparty: o.cp ?? null, source: 'MANUAL', departmentId: o.dep ?? null, regionCode: o.reg ?? null, districtId: o.dist ?? null, segment: o.seg ?? null, deletedAt: null });
const inc = (period, som, o) => T.income.push({ id: `i${++n}`, period, amountTiyin: S(som), categoryCode: 'XIZ', clientName: o.client ?? null, departmentId: o.dep ?? null, regionCode: o.reg ?? null, districtId: o.dist ?? null, segment: o.seg ?? null, deletedAt: null });
// Kadrlar: daromadsiz; dekabr (davrdan oldingi oy) 1 mln, yanvar 1 mln, fevral 1,5 mln + ofis 0,5 mln
ex('2025-12', 1000000, { dep: 'dK' });
ex('2026-01', 1000000, { dep: 'dK' });
ex('2026-02', 1500000, { dep: 'dK' });
ex('2026-02', 500000, { dep: 'dK', cat: 'OFIS', cp: 'Ofis Savdo MCHJ' });
// Savdo: daromadli
inc('2026-01', 4000000, { dep: 'dS', client: 'Mijoz A' });
inc('2026-02', 6000000, { dep: 'dS', client: 'Mijoz B' });
ex('2026-01', 2000000, { dep: 'dS' });
ex('2026-02', 2000000, { dep: 'dS' });
// Hudud va tuman
inc('2026-01', 3000000, { reg: 3, dist: '3-1' });
ex('2026-01', 1000000, { reg: 3, dist: '3-1' });
ex('2026-01', 700000, { reg: 3 });
// Yo'nalish
ex('2026-01', 900000, { seg: 'TAX_FREE' });
// Xodimlar va ish haqi
T.employee.push(
  { pinfl: '30000000000001', fullName: 'Aliyev Sardor', departmentId: 'dK', regionCode: 0, districtId: null, isActive: true, hiredAt: new Date('2025-05-01'), firedAt: null },
  { pinfl: '30000000000002', fullName: 'Karimova Madina', departmentId: 'dK', regionCode: 0, districtId: null, isActive: true, hiredAt: new Date('2026-02-03'), firedAt: null },
  { pinfl: '30000000000003', fullName: 'Hududov Bekzod', departmentId: null, regionCode: 3, districtId: '3-1', isActive: true, hiredAt: null, firedAt: null },
);
T.payrollEntry.push(
  { id: 'p1', employeePinfl: '30000000000001', period: '2026-01', totalTiyin: S(1000000), deletedAt: null },
  { id: 'p2', employeePinfl: '30000000000001', period: '2026-02', totalTiyin: S(1000000), deletedAt: null },
  { id: 'p3', employeePinfl: '30000000000002', period: '2026-02', totalTiyin: S(500000), deletedAt: null },
);
T.setting.push({ key: 'unit.moves', value: { moves: [{ id: 'm1', pinfl: '30000000000009', fullName: 'Ko‘chgan Odam', unit: 'TAX_FREE', from: '2026-02', note: null, source: 'MANUAL', createdAt: '2026-02-01', createdBy: 'a' }] } });
const transfers = {
  async list() {
    return {
      transfers: [
        { pinfl: '30000000000003', fullName: 'Hududov Bekzod', period: '2026-02', previousPeriod: '2026-01', kinds: ['district'], from: { regionCode: 3, regionName: 'Andijon viloyati', districtId: '3-2', districtName: 'Boshqa tuman' }, to: { regionCode: 3, regionName: 'Andijon viloyati', districtId: '3-1', districtName: 'Asaka tumani' } },
        { pinfl: '30000000000004', fullName: 'Begona Odam', period: '2026-02', previousPeriod: '2026-01', kinds: ['region'], from: { regionCode: 5, regionName: 'Boshqa viloyat' }, to: { regionCode: 6, regionName: 'Yana boshqa' } },
      ],
    };
  },
};
const u = new UnitsReport(db.client, undefined, transfers);
const sec = (d, t) => d.sections.find((s) => s.title === (t === 'Xulosa' ? "Asosiy ko'rsatkichlar" : t));
const table = (d, t, i = 0) => sec(d, t).blocks.filter((b) => b.type === 'table')[i];

(async () => {
  const o = await u.options();
  assert.deepStrictEqual(o.departments.map((d) => d.name), ['Kadrlar', 'Savdo']);
  assert.deepStrictEqual(o.regions[0].districts.map((d) => d.name), ['Asaka tumani']);
  assert.ok(o.segments.some((s) => s.code === 'TAX_FREE') && !o.segments.some((s) => s.code === 'QOMITA'));

  // ── Daromadsiz Markaz bo'limi ──
  const k = await u.build({ kind: 'DEPT', id: 'dK', from: '2026-01', to: '2026-02' }, true);
  assert.strictEqual(k.title, 'Kadrlar');
  assert.ok(!sec(k, 'Daromad qayerdan keldi'), "daromadsiz — daromad bo'limi yo'q");
  assert.ok(!sec(k, 'Xulosa').blocks[0].items.some((x) => x.label === "O'zini qoplash"));
  const km = table(k, 'Oyma-oy');
  assert.deepStrictEqual(km.rows.map((r) => [r[1], r[2]]), [[1000000, 0], [2000000, 100]], "xarajat va o'sish (dekabrga nisbatan 0%, keyin +100%)");
  const kx = table(k, 'Xarajat nimaga ketdi');
  assert.deepStrictEqual(kx.rows.map((r) => r[0].trim()), ['Ish haqi fondi', 'Asosiy ish haqi', 'Ofis'], 'modda → ichki modda');
  assert.deepStrictEqual(kx.levels, [0, 1, 0]);
  assert.strictEqual(table(k, 'Xarajat nimaga ketdi', 1).rows[0][0], 'Ofis Savdo MCHJ');
  // Ish haqi: soni va fond; ismlar — administratorga
  const kp = table(k, 'Ish haqi');
  assert.deepStrictEqual(kp.rows.map((r) => [r[1], r[2]]), [[1, 1000000], [2, 1500000]]);
  assert.deepStrictEqual(table(k, 'Ish haqi', 1).rows.map((r) => r[0]), ['Aliyev Sardor', 'Karimova Madina']);
  const kv = await u.build({ kind: 'DEPT', id: 'dK', from: '2026-01', to: '2026-02' }, false);
  assert.strictEqual(sec(kv, 'Ish haqi').blocks.filter((b) => b.type === 'table').length, 1, "kuzatuvchiga — ro'yxatsiz");
  assert.ok(!JSON.stringify(kv).includes('Aliyev'), 'kuzatuvchi hisobotida ism yo‘q');
  // O'zgarishlar: ishga kirgan
  assert.deepStrictEqual(table(k, "O'zgarishlar").rows.map((r) => [r[0], r[1], r[2]]), [['fevral 2026', 'Karimova Madina', 'ishga kirgan']]);
  assert.ok(table(kv, "O'zgarishlar").rows.every((r) => r[1] === '•'));

  // Yuklanmagan oy (mart): o'sish foizi chiqmaydi (−100% emas), solishtirish — ma'lumoti bor oxirgi oy bo'yicha
  const k3 = await u.build({ kind: 'DEPT', id: 'dK', from: '2026-01', to: '2026-03' }, true);
  assert.strictEqual(table(k3, 'Oyma-oy').rows[2][2], null);
  assert.match(sec(k3, 'Oyma-oy').intro, /Yozuv yo'q oylar .*: mart 2026/);
  assert.ok(k3.highlights.some((h) => /fevral 2026da xarajat yanvar 2026ga nisbatan \+100,0%/.test(h)), k3.highlights.join(' | '));

  // ── Daromadli bo'lim: o'zini qoplash, mijozlar ──
  const sd = await u.build({ kind: 'DEPT', id: 'dS', from: '2026-01', to: '2026-02' }, false);
  const sx = sec(sd, 'Xulosa').blocks[0].items;
  assert.strictEqual(sx.find((x) => x.label === "O'zini qoplash").value, '250,0%');
  const sm = table(sd, 'Oyma-oy');
  assert.deepStrictEqual(sm.rows.map((r) => [r[1], r[2], r[3], r[5], r[7]]), [[4000000, 2000000, 2000000, null, 2000000], [6000000, 2000000, 4000000, 50, 6000000]], "natija, daromad o'sishi, yig'ma");
  assert.deepStrictEqual(table(sd, 'Daromad qayerdan keldi', 1).rows.map((r) => r[0]), ['Mijoz B', 'Mijoz A']);

  // ── Hudud va tuman ──
  const r = await u.build({ kind: 'REGION', id: '3', from: '2026-01', to: '2026-02' }, true);
  assert.strictEqual(sec(r, 'Xulosa').blocks[0].items.find((x) => x.label === 'Xarajat').value, '1,7 mln so\'m');
  const rt = table(r, "O'zgarishlar");
  assert.deepStrictEqual(rt.rows.map((x) => [x[1], x[2]]), [['Hududov Bekzod', "ichida ko'chgan"]], 'faqat shu hudud');
  const d = await u.build({ kind: 'REGION', id: '3', district: '3-1', from: '2026-01', to: '2026-02' }, true);
  assert.strictEqual(d.title, 'Andijon viloyati · Asaka tumani');
  assert.strictEqual(sec(d, 'Xulosa').blocks[0].items.find((x) => x.label === 'Xarajat').value, '1,0 mln so\'m', 'faqat tuman yozuvlari');
  assert.deepStrictEqual(table(d, "O'zgarishlar").rows.map((x) => x[2]), ['kelgan']);
  await assert.rejects(() => u.build({ kind: 'REGION', id: '3', district: 'yoq', from: '2026-01', to: '2026-02' }, true), /Tuman topilmadi/);

  // ── Yo'nalish: ko'chishlar ──
  const t = await u.build({ kind: 'SEGMENT', id: 'TAX_FREE', from: '2026-01', to: '2026-02' }, true);
  assert.deepStrictEqual(table(t, "O'zgarishlar").rows.map((x) => [x[1], x[2], x[4]]), [['Ko‘chgan Odam', 'kelgan', 'Tax free']]);

  // ── Xatolar va fayllar ──
  await assert.rejects(() => u.build({ kind: 'DEPT', id: 'yoq', from: '2026-01', to: '2026-02' }, true), /topilmadi/);
  await assert.rejects(() => u.build({ kind: 'X', id: 'dK', from: '2026-01', to: '2026-02' }, true), /turini/);
  await assert.rejects(() => u.build({ kind: 'DEPT', id: 'dK', from: '2026-03', to: '2026-01' }, true), /keyin/);
  const x = await renderExcel(k);
  const p = await renderPdf(k);
  assert.ok(x.subarray(0, 2).toString() === 'PK' && p.subarray(0, 4).toString() === '%PDF');
  console.log('OK t-units-report');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
