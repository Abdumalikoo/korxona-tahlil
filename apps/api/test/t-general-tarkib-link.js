// Umumiy ish haqi tarkibi → o'z tarkibi yo'q bo'limlarga bog'lanadi (qayta yuklashsiz), har xodim bir joydan
// (ikki marta sanalmaydi). TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { PayrollService } = require('../dist/modules/payroll/payroll.service');
const { PayrollPlanService } = require('../dist/modules/payroll/payroll-plan.service');
const { UnitPayrollService } = require('../dist/modules/unit-payroll/unit-payroll.service');
const { SalaryCompositionService } = require('../dist/modules/salary-composition/salary-composition.service');
const { CompositionReconcileService } = require('../dist/modules/salary-composition/salary-composition.reconcile');

const P = { A: '61111111111111', T: '63333333333333', U: '64444444444444' };
const PER = '2026-03';
const so = (n) => BigInt(Math.round(n * 100));
const s = (n) => String(so(n));
const crow = (pinfl, items) => ({ pinfl, fullName: null, workedDays: null, rate: null, items: new Map(Object.entries(items).map(([k, v]) => [k, so(v)])) });

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  T.region.push({ code: 0, name: 'Markaz', isActive: true });
  T.category.push({ code: 'PAYROLL_BASE', label: 'Ish haqi', parentCode: null, isLeaf: true, isActive: true });
  T.department.push({ id: 'dA', name: 'AUP', index: 1, isActive: true }, { id: 'dT', name: 'Tax free', index: 2, isActive: true });
  const emp = (pinfl, fullName, departmentId) => T.employee.push({ pinfl, fullName, lastName: fullName.split(' ')[0], firstName: 'S', regionCode: 0, departmentId, districtId: null, position: null, employmentType: 'SHTAT', isActive: true, hiredAt: null, firedAt: null });
  emp(P.A, 'Alfa Markaz', 'dA');
  emp(P.T, 'Tango Taksfri', 'dT');
  emp(P.U, 'Uniform Taksfri', 'dT');

  const audit = new AuditService(db.client);
  const units = new UnitPayrollService(db.client, audit);
  const pay = new PayrollService(db.client, undefined, units);
  const plan = new PayrollPlanService(db.client, pay, units, audit);
  const comp = new SalaryCompositionService(db.client, pay, units);
  await comp.onModuleInit();
  T.salaryComponent.forEach((x) => (x.isActive = true));
  const rec = new CompositionReconcileService(db.client, comp, pay, audit, units);

  // Soliq hisoboti: A — Markaz; T, U — Tax free
  await plan.commit(PER, { rows: [{ pinfl: P.A, amountTiyin: s(10_000_000), fullName: 'Alfa Markaz' }, { pinfl: P.T, amountTiyin: s(3_000_000), fullName: 'Tango Taksfri' }, { pinfl: P.U, amountTiyin: s(2_000_000), fullName: 'Uniform Taksfri' }], fileName: 'soliq.xlsx' }, true, 'adm');
  const tfKey = `unit.payroll.TAX_FREE.${PER}`;
  const tfPeople = (T.setting.find((x) => x.key === tfKey)?.value?.batches ?? []).filter((b) => b.status === 'COMMITTED').flatMap((b) => b.rows.map((r) => r.pinfl));
  assert.deepStrictEqual(tfPeople.sort(), [P.T, P.U].sort(), 'T, U — Tax free vedomostida');

  // Faqat UMUMIY tarkib yuklandi (Tax free'ning o'z tarkibi yo'q): T — 2.5 mln oklad + 0.5 mln KPI
  // Siyosat: Tax free KPI — Markaz hisobiga
  T.setting.push({ key: 'expense.policy', value: { unitPayroll: { TAX_FREE: { KPI: 'CENTER' } } } });
  await comp.commit({ period: PER, fileName: 'markaz.xlsx', userId: 'adm', rows: [crow(P.A, { OKLAD: 10_000_000 }), crow(P.T, { OKLAD: 2_500_000, KPI: 500_000 }), crow(P.U, { OKLAD: 2_000_000 })] });

  // ── Bo'lim tarkibi sahifasi: umumiydan bog'langan ──
  let v = await comp.view(PER, 'TAX_FREE');
  assert.ok(v.batch && v.batch.fromGeneral, 'o‘z tarkibi yo‘q — umumiy tarkib bog‘landi');
  assert.strictEqual(v.linkedGeneral.count, 2);
  assert.deepStrictEqual(v.rows.map((r) => r.pinfl).sort(), [P.T, P.U].sort(), 'faqat Tax free xodimlari (A yo‘q)');
  assert.ok(v.rows.every((r) => r.fromGeneral));
  assert.strictEqual(v.check.mismatchCount, 0, 'tarkib = soliq hisoboti');
  assert.strictEqual(v.check.compositionTiyin, s(5_000_000));
  const uc = await comp.check(PER, 'TAX_FREE');
  assert.strictEqual(uc.compositionUploaded ?? true, true);

  // ── Xarajat zanjiri: KPI Tax free ish haqidan Markazga — BIR marta ──
  const splitOf = () => T.setting.find((x) => x.key === `unit.payroll.split.TAX_FREE.${PER}`)?.value;
  assert.deepStrictEqual(splitOf().parts, { KPI: s(500_000) }, 'umumiy tarkibdagi KPI ajratildi');
  await comp.resplitUnits(PER);
  await units.splitComponents('TAX_FREE', PER);
  const live = T.expense.filter((e) => !e.deletedAt && e.segment === 'TAX_FREE' && String(e.categoryCode).includes('KPI'));
  assert.strictEqual(live.length, 1, 'qayta hisoblansa ham bitta yozuv');
  assert.strictEqual(String(live[0].amountTiyin), s(500_000));
  const tfTotal = T.expense.filter((e) => !e.deletedAt && e.segment === 'TAX_FREE').reduce((a, e) => a + BigInt(e.amountTiyin), 0n);
  assert.strictEqual(tfTotal, so(5_000_000), 'Tax free jami o‘zgarmadi (5 mln) — faqat ichida ajratildi');

  // ── Tax free o'z tarkibini yuklasa: T — o'z tarkibidan, U — hamon umumiydan (ikkalasidan emas) ──
  await comp.commit({ period: PER, fileName: 'tf.xlsx', userId: 'adm', unit: 'TAX_FREE', rows: [crow(P.T, { OKLAD: 3_000_000 })] });
  v = await comp.view(PER, 'TAX_FREE');
  assert.ok(!v.batch.fromGeneral);
  assert.strictEqual(v.rows.length, 2);
  assert.ok(!v.rows.find((r) => r.pinfl === P.T).fromGeneral && v.rows.find((r) => r.pinfl === P.U).fromGeneral);
  assert.strictEqual(v.check.compositionTiyin, s(5_000_000), 'T ikki marta sanalmadi');
  assert.strictEqual(splitOf().parts.KPI, undefined, 'T o‘z tarkibida KPI yo‘q — ajratma qaytdi');

  // ── Farqni o'tkazish: umumiydan bog'langan xodim — umumiy tarkibga yoziladi, bo'lim tarixida ko'rinadi ──
  const r1 = await rec.allocate(PER, 'TAX_FREE', { items: [{ pinfl: P.U, componentCode: 'KPI', amountTiyin: s(100_000) }] }, 'adm');
  assert.strictEqual(r1.count, 1);
  const uRow = T.salaryCompositionRow.find((x) => x.employeePinfl === P.U && !T.salaryCompositionBatch.find((b) => b.id === x.batchId).cancelledAt);
  assert.strictEqual(String(uRow.totalTiyin), s(2_100_000), 'umumiy tarkibga yozildi');
  const own = T.setting.find((x) => x.key === `unit.composition.TAX_FREE.${PER}`).value.batches.find((b) => !b.cancelledAt);
  assert.ok(!own.rows.some((r) => r.pinfl === P.U), 'bo‘limning o‘z tarkibiga qator qo‘shilmadi');
  const rv = await rec.view(PER, 'TAX_FREE');
  assert.ok(rv.history.some((a) => a.pinfl === P.U && a.current), 'bo‘lim tarixida');
  // Aralash tanlov — rad
  await assert.rejects(rec.allocate(PER, 'TAX_FREE', { items: [{ pinfl: P.U, componentCode: 'KPI', amountTiyin: s(1) }, { pinfl: P.T, componentCode: 'KPI', amountTiyin: s(1) }] }, 'adm'), /alohida/);
  await rec.undo(r1.ids[0], 'adm');
  assert.strictEqual(String(T.salaryCompositionRow.find((x) => x.id === uRow.id).totalTiyin), s(2_000_000));

  // ── Umumiy tarkib bekor qilinsa — bog'lanish ham yo'qoladi ──
  const gb = T.salaryCompositionBatch.find((b) => !b.cancelledAt);
  await comp.cancel(gb.id);
  v = await comp.view(PER, 'TAX_FREE');
  assert.deepStrictEqual(v.rows.map((r) => r.pinfl), [P.T]);
  assert.ok(!v.linkedGeneral);

  console.log('t-general-tarkib-link: OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
