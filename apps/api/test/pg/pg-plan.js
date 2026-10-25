// Haqiqiy PostgreSQL: umumiy vedomost bo'limlar bilan birga (taqsimot, saqlash, bekor qilish). TEST MA'LUMOTLARI SUN'IY.
const assert = require('assert');
const { D, seedBase, run } = require('./harness');

const { AuditService } = D('modules/audit/audit.service');
const { PayrollService } = D('modules/payroll/payroll.service');
const { PayrollPlanService } = D('modules/payroll/payroll-plan.service');
const { UnitPayrollService } = D('modules/unit-payroll/unit-payroll.service');

run('pg-plan', async (prisma) => {
  await seedBase(prisma);
  await prisma.category.create({ data: { code: 'PAYROLL_BASE', label: 'Ish haqi' } });
  await prisma.department.create({ data: { id: 'dT', code: 'DT', name: '"Tax free" filiali', index: 2 } });
  const P = { A: '31111111111111', B: '32222222222222', F: '36666666666666' };
  const e = (pinfl, fullName, departmentId) => ({ pinfl, fullName, lastName: fullName.split(' ')[0], firstName: 'X', employmentType: 'SHTAT', regionCode: 0, departmentId });
  await prisma.employee.createMany({ data: [e(P.A, 'Aliyev Ali', 'd1'), e(P.B, 'Botirov Bobur', 'dT'), e(P.F, 'Fayzullayev Farrux', 'dT')] });
  const audit = new AuditService(prisma);
  const up = new UnitPayrollService(prisma, audit);
  const pay = new PayrollService(prisma, undefined, up);
  const plans = new PayrollPlanService(prisma, pay, up, audit);
  const PER = '2026-03';
  await up.commit('TAX_FREE', PER, { rows: [{ pinfl: P.F, amountTiyin: '50000' }] }, false, 'adm');

  const p = await plans.plan(PER, [P.A, P.B, P.F].map((pinfl, i) => ({ pinfl, amountTiyin: String((i + 1) * 10000) })));
  assert.deepStrictEqual(p.rows.map((r) => [r.pinfl, r.target, Boolean(r.locked)]), [[P.A, 'GENERAL', false], [P.B, 'TAX_FREE', false], [P.F, 'SKIP', true]]);
  const r = await plans.commit(PER, { rows: p.rows, fileName: 'umumiy.xlsx' }, false, 'adm');
  assert.deepStrictEqual([r.general.employees, r.units.map((u) => u.unit), r.locked], [1, ['TAX_FREE'], 1]);
  const live = await prisma.expense.findMany({ where: { deletedAt: null }, select: { source: true, segment: true, amountTiyin: true } });
  assert.deepStrictEqual(live.map((x) => [x.source, x.segment, x.amountTiyin]).sort(), [['IMPORT', 'TAX_FREE', 20000n], ['IMPORT', 'TAX_FREE', 50000n], ['PAYROLL', null, 10000n]].sort());
  // Bo'limga keyin umumiyda bor xodim yuklansa — olinmaydi (haqiqiy bazada payrollEntry → batch filtri)
  const m = await up.commit('TAX_FREE', PER, { rows: [{ pinfl: P.A, amountTiyin: '7000' }, { pinfl: P.F, amountTiyin: '100' }] }, false, 'adm');
  assert.strictEqual(m.skippedInGeneral, 1);
  const c = await pay.cancel(r.general.batchId);
  assert.strictEqual(c.unitBatchesCancelled, 1);
  const left = await prisma.expense.findMany({ where: { deletedAt: null }, select: { amountTiyin: true } });
  assert.deepStrictEqual(left.map((x) => x.amountTiyin).sort(), [100n, 50000n].sort());
  console.log('  ✓ umumiy vedomost: bo\'limga avtomatik, avval yuklangan olinmaydi, bekor qilish birga — haqiqiy bazada');
});