// Ish haqi nazorati: xarajat = soliq hisoboti. Ortiqchalar (bekor qilingan yuklashdan qolgan, ikki marta sanalgan,
// bog'lanmagan bo'lim yuklashi, demo) topiladi va faqat tasdiqlansa tozalanadi; bo'lim sahifasida umumiy hisobotdagi
// xodim qayta olinmaydi. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { PayrollService } = require('../dist/modules/payroll/payroll.service');
const { PayrollPlanService } = require('../dist/modules/payroll/payroll-plan.service');
const { PayrollControlService } = require('../dist/modules/payroll/payroll-control.service');
const { UnitPayrollService } = require('../dist/modules/unit-payroll/unit-payroll.service');

const P = { A: '71111111111111', B: '72222222222222', T: '73333333333333', U: '74444444444444' };
const PER = '2026-02';
const so = (n) => BigInt(Math.round(n * 100));

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  T.region.push({ code: 0, name: 'Markaz', isActive: true });
  T.category.push({ code: 'PAYROLL_BASE', label: 'Ish haqi', parentCode: null, isLeaf: true, isActive: true }, { code: 'OFIS', label: 'Ofis', parentCode: null, isLeaf: true, isActive: true });
  T.department.push({ id: 'dA', name: 'AUP', index: 1, isActive: true }, { id: 'dT', name: 'Tax free', index: 2, isActive: true });
  const emp = (pinfl, fullName, departmentId) => T.employee.push({ pinfl, fullName, lastName: fullName.split(' ')[0], firstName: 'S', regionCode: 0, departmentId, districtId: null, position: null, employmentType: 'SHTAT', isActive: true, hiredAt: null, firedAt: null });
  emp(P.A, 'Alfa Markaz', 'dA');
  emp(P.B, 'Beta Markaz', 'dA');
  emp(P.T, 'Tango Taksfri', 'dT');
  emp(P.U, 'Uniform Taksfri', 'dT');

  const audit = new AuditService(db.client);
  const units = new UnitPayrollService(db.client, audit);
  const pay = new PayrollService(db.client, undefined, units);
  const plan = new PayrollPlanService(db.client, pay, units, audit);
  const ctl = new PayrollControlService(db.client, audit, units);
  const live = () => T.expense.filter((e) => !e.deletedAt && e.period === PER);
  const sum = (l) => l.reduce((s, e) => s + e.amountTiyin, 0n);

  // ── Soliq hisoboti (umumiy): A, B — Markaz; T, U — Tax free (miya bo'yicha o'sha bo'limga) ──
  const rows = [[P.A, 10_000_000], [P.B, 5_000_000], [P.T, 3_000_000], [P.U, 2_000_000]].map(([p, s]) => ({ pinfl: p, amountTiyin: String(so(s)), fullName: T.employee.find((e) => e.pinfl === p).fullName }));
  await plan.commit(PER, { rows, fileName: 'soliq-fevral.xlsx' }, true, 'adm');
  // Ish haqiga aloqasi yo'q xarajat — hisobga olinmaydi
  T.expense.push({ id: 'ofis', period: PER, amountTiyin: so(999_999), categoryCode: 'OFIS', deletedAt: null, payrollBatchId: null, description: 'Ofis' });

  let c = await ctl.control(PER);
  assert.strictEqual(c.soliq.totalTiyin, String(so(20_000_000)), 'yuklangan fayl jami — bo‘limlarga yozilgani bilan');
  assert.deepStrictEqual([c.expenseTotal, c.diffTiyin, c.ok, c.duplicateCount], [String(so(20_000_000)), '0', true, 0], 'xarajat = soliq hisoboti');
  assert.deepStrictEqual(c.byKind.map((k) => k.kind).sort(), ['GENERAL', 'UNIT_GENERAL']);

  // ── Bo'lim sahifasida qayta yuklash: umumiy hisobotdagi T olinmaydi (ikki marta sanalmasin) ──
  const up = await units.commit('TAX_FREE', PER, { rows: [{ pinfl: P.T, amountTiyin: String(so(3_000_000)), fullName: 'Tango Taksfri' }, { pinfl: '75555555555555', amountTiyin: String(so(1_000_000)), fullName: 'Viktor Yangi' }], fileName: 'taxfree.xlsx' }, false, 'adm');
  assert.strictEqual(up.skippedInGeneral, 1, "T — umumiy hisobotda bor, olinmadi");
  c = await ctl.control(PER);
  assert.deepStrictEqual([c.duplicateCount, c.diffTiyin, c.soliq.manualTiyin], [0, '0', String(so(1_000_000))]);

  // ── Eski xato holatlar (oldingi versiyadan qolgan): ──
  // 1) T ikki marta: umumiy hisobotdan va qo'lda yuklangan (eski tekshiruv payrollEntry'ni ko'rardi xolos)
  const key = `unit.payroll.TAX_FREE.${PER}`;
  const st = T.setting.find((s) => s.key === key);
  st.value.batches.push({ id: 'old-manual', period: PER, fileName: 'eski.xlsx', fileHash: 'h1', status: 'COMMITTED', createdAt: new Date().toISOString(), cancelledAt: null, uploadedById: 'adm', uploadedBy: 'Admin', totalTiyin: String(so(3_000_000)), count: 1, zeroCount: 0, newStaff: 0, expenseId: 'e-old', rows: [{ pinfl: P.T, fullName: 'Tango Taksfri', amountTiyin: String(so(3_000_000)) }] });
  T.expense.push({ id: 'e-old', period: PER, amountTiyin: so(3_000_000), categoryCode: 'PAYROLL_BASE', segment: 'TAX_FREE', deletedAt: null, payrollBatchId: null, description: 'Ish haqi — Tax free (1 xodim)', source: 'IMPORT' });
  // 2) Bekor qilingan umumiy yuklashdan qolib ketgan xarajat
  T.payrollBatch.push({ id: 'pb-old', period: PER, status: 'CANCELLED', scope: 'ALL', fileName: 'eski-soliq.xlsx', totalTiyin: so(7_000_000) });
  T.expense.push({ id: 'e-orphan', period: PER, amountTiyin: so(7_000_000), categoryCode: 'PAYROLL_BASE', regionCode: 0, deletedAt: null, payrollBatchId: 'pb-old', description: 'AUP (2 xodim)', source: 'PAYROLL' });
  // 3) Umumiy yuklashga bog'lanmagan bo'lim yuklashi (umumiy vedomostdan, eski)
  st.value.batches.push({ id: 'stray', period: PER, fileName: 'soliq (umumiy vedomostdan)', fileHash: 'h2', status: 'COMMITTED', createdAt: new Date().toISOString(), cancelledAt: null, uploadedById: 'adm', uploadedBy: 'Admin', totalTiyin: String(so(2_000_000)), count: 1, zeroCount: 0, newStaff: 0, expenseId: 'e-stray', rows: [{ pinfl: P.U, fullName: 'Uniform Taksfri', amountTiyin: String(so(2_000_000)) }], origin: 'GENERAL', generalBatchId: 'pb-old' });
  T.expense.push({ id: 'e-stray', period: PER, amountTiyin: so(2_000_000), categoryCode: 'PAYROLL_BASE', segment: 'TAX_FREE', deletedAt: null, payrollBatchId: null, description: 'Ish haqi — Tax free', source: 'IMPORT' });
  // 4) Demo
  T.expense.push({ id: 'e-demo', period: PER, amountTiyin: so(50_000_000), categoryCode: 'PAYROLL_BASE', regionCode: 0, deletedAt: null, payrollBatchId: null, description: '[DEMO] Ish haqi (vedomost)', source: 'PAYROLL' });
  // 5) Bo'limdan o'tkazilgan, lekin xodim yana yuklangan
  T.expense.push({ id: 'e-moved', period: PER, amountTiyin: so(5_000_000), categoryCode: 'PAYROLL_BASE', regionCode: 0, deletedAt: null, payrollBatchId: null, description: "Ish haqi — Beta Markaz (Tax freedan o'tkazildi, Fevral)", documentNo: P.B, source: 'IMPORT' });

  c = await ctl.control(PER);
  const k = (kind) => c.byKind.find((x) => x.kind === kind);
  assert.strictEqual(k('ORPHAN').tiyin, String(so(7_000_000)));
  assert.strictEqual(k('DEMO').tiyin, String(so(50_000_000)));
  assert.strictEqual(k('MOVED_DUP').tiyin, String(so(5_000_000)));
  assert.match(c.issues.find((i) => i.id === 'e-moved').note, /Umumiy soliq hisoboti/);
  assert.deepStrictEqual(c.soliq.stray.map((s) => s.batchId), ['stray']);
  assert.strictEqual(c.duplicateCount, 2, 'T (umumiy + qo‘lda) va U (umumiy + bog‘lanmagan)');
  const dT = c.duplicates.find((d) => d.pinfl === P.T);
  assert.deepStrictEqual([dT.extraTiyin, dT.removeFrom], [String(so(3_000_000)), ['TAX_FREE']], "ortiqchasi — qo'lda yuklangani");
  // Jami farq: hammasi ko'rinadi
  const expenseTotal = sum(live().filter((e) => e.categoryCode === 'PAYROLL_BASE'));
  assert.strictEqual(c.expenseTotal, String(expenseTotal));
  assert.ok(!c.ok);
  // Farq to'liq tushuntiriladi: ortiqcha 62 mln + ikki marta (qo'lda) 3 mln + bog'lanmagan 2 mln
  assert.deepStrictEqual([c.diffTiyin, c.explain.cleanableTiyin, c.explain.duplicateManualTiyin, c.explain.strayTiyin], [String(so(67_000_000)), String(so(62_000_000)), String(so(3_000_000)), String(so(2_000_000))]);

  // ── Tozalash — faqat tozalanadiganlar; boshqasi rad ──
  await assert.rejects(ctl.clean(PER, [], 'adm'), /tanlang/);
  await assert.rejects(ctl.clean(PER, ['ofis'], 'adm'), /yo'q/);
  const cl = await ctl.clean(PER, ['e-orphan', 'e-demo', 'e-moved', 'ofis'], 'adm');
  assert.deepStrictEqual([cl.removed, cl.totalTiyin], [3, String(so(62_000_000))]);
  assert.ok(T.expense.find((e) => e.id === 'ofis').deletedAt === null, "tegishli bo'lmagani — tegilmadi");
  assert.ok(T.expense.find((e) => e.id === 'e-demo').deletedAt, 'Savatga');
  // Bog'lanmagan bo'lim yuklashi — bekor qilinadi; ikki marta sanalgan T — bo'lim sahifasidan olib tashlanadi
  await ctl.cancelStray(PER, ['stray'], 'adm');
  await assert.rejects(ctl.dedupe(PER, [P.A], 'adm'), /yo'q/);
  const dd = await ctl.dedupe(PER, [P.T], 'adm');
  assert.deepStrictEqual([dd.removed, dd.totalTiyin], [1, String(so(3_000_000))]);
  assert.ok((await units.saved('TAX_FREE', PER)).rows.find((r) => r.pinfl === P.T)?.fromGeneral, 'umumiy hisobotdan kelgani qoldi');
  c = await ctl.control(PER);
  assert.deepStrictEqual([c.duplicateCount, c.soliq.stray.length], [0, 0]);
  assert.strictEqual(c.diffTiyin, '0', 'xarajat = soliq hisoboti (+ bo‘limda yuklangan yangi xodim)');
  assert.strictEqual(c.expected, String(so(20_000_000 + 1_000_000)));
  assert.ok(T.auditLog.some((l) => l.entityType === 'payroll_control'));

  // Bir necha oy
  const rg = await ctl.controlRange('2026-01', '2026-02');
  assert.deepStrictEqual([rg.months.length, rg.months[1].diffTiyin, rg.months[0].expenseTotal], [2, '0', '0']);
  console.log('OK t-payroll-control');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
