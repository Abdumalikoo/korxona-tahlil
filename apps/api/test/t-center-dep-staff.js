// Markaz bo'limi: xodimlar ro'yxati ish haqi xarajati qanday guruhlangan bo'lsa shunday (joy o'zgarishi bilan) —
// bo'lim ish haqi = ro'yxatdagilar jami. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { CenterService } = require('../dist/modules/structure/center.service');

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.region.push({ code: 0, name: 'Markaz' }, { code: 5, name: 'Namuna viloyati' });
  T.department.push({ id: 'd1', name: 'Call markaz', index: 1, isActive: true }, { id: 'd2', name: 'AUP', index: 2, isActive: true });
  const emp = (pinfl, fullName, regionCode, departmentId) => ({ pinfl, fullName, regionCode, departmentId, position: null, employmentType: 'SHTAT', hiredAt: null, firedAt: null, isActive: true });
  T.employee.push(emp('10000000000001', 'Namuna A', 0, 'd1'), emp('10000000000002', 'Namuna B', 0, 'd2'), emp('10000000000003', 'Namuna C', 5, null), emp('10000000000004', 'Namuna D', 0, 'd1'));
  T.employeeLocation = [];
  // B (reestrda AUP) va C (reestrda hududda) — shu oy Call markazda ishlagan (ish haqi tarkibi bo'yicha joy)
  T.setting.push({ key: 'salary.composition.place.2026-09', value: { fixes: { '10000000000002': { departmentId: 'd1', unit: 'CENTER' }, '10000000000003': { departmentId: 'd1', unit: 'CENTER' }, '10000000000004': { unit: 'REGION', regionCode: 5 } } } });
  T.payrollBatch.push({ id: 'b1', period: '2026-09', status: 'COMMITTED' });
  const en = (pinfl, amount) => T.payrollEntry.push({ id: `pe${pinfl}`, batchId: 'b1', employeePinfl: pinfl, period: '2026-09', totalTiyin: BigInt(amount), deletedAt: null });
  en('10000000000001', 100);
  en('10000000000002', 200);
  en('10000000000003', 300);
  en('10000000000004', 50); // D — shu oy hududda: Call markaz ro'yxatida summasiz
  const date = new Date('2026-09-30T07:00:00Z');
  T.expense.push({ id: 'x1', date, period: '2026-09', amountTiyin: 600n, categoryCode: 'PAYROLL_BASE', regionCode: 0, departmentId: 'd1', segment: null, source: 'PAYROLL', payrollBatchId: 'b1', deletedAt: null, section: 'DOIMIY' });
  T.expense.push({ id: 'x2', date, period: '2026-09', amountTiyin: 50n, categoryCode: 'PAYROLL_BASE', regionCode: 5, departmentId: null, segment: null, source: 'PAYROLL', payrollBatchId: 'b1', deletedAt: null, section: 'DOIMIY' });

  const svc = new CenterService(db.client);
  const d = await svc.department('d1', { from: '2026-09-01', to: '2026-09-30' });
  const sal = Object.fromEntries(d.employees.map((e) => [e.fullName, e.salaryTiyin]));
  assert.deepStrictEqual(sal, { 'Namuna C': '300', 'Namuna B': '200', 'Namuna A': '100', 'Namuna D': '0' });
  assert.deepStrictEqual([d.payrollTiyin, d.listedPayrollTiyin], ['600', '600'], "bo'lim ish haqi = ro'yxatdagilar jami");
  assert.ok(!d.notes.some((n) => n.includes("bog'lanmagan")));
  const aup = await svc.department('d2', { from: '2026-09-01', to: '2026-09-30' });
  assert.ok(!aup.employees.some((e) => e.fullName === 'Namuna B' && e.salaryTiyin !== '0'), 'B — AUPda summasiz');
  // Xodimga bog'lanmagan qism bo'lsa — izohda
  T.expense.push({ id: 'x3', date, period: '2026-09', amountTiyin: 40n, categoryCode: 'PAYROLL_BASE', regionCode: 0, departmentId: 'd1', segment: null, source: 'PAYROLL', payrollBatchId: null, deletedAt: null, section: 'DOIMIY' });
  const d2 = await svc.department('d1', { from: '2026-09-01', to: '2026-09-30' });
  assert.deepStrictEqual([d2.payrollTiyin, d2.listedPayrollTiyin], ['640', '600']);
  assert.ok(d2.notes.some((n) => n.includes("bog'lanmagan")));
  console.log('OK t-center-dep-staff');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
