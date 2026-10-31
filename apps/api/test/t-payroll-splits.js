// Xarajatlar tarkibiy tuzilishi › xodim xarajatini foiz bilan bo'limlarga bo'lish: ish haqi qayta guruhlanganda bo'limlarga
// foizlar bo'yicha yoziladi (jami o'zgarmaydi, tiyin aniq), tanlangan oydan boshlab; tekshiruvlar; bekor qilish — joyiga
// qaytadi. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { PayrollService } = require('../dist/modules/payroll/payroll.service');
const { PayrollPlanService } = require('../dist/modules/payroll/payroll-plan.service');
const { UnitPayrollService } = require('../dist/modules/unit-payroll/unit-payroll.service');
const { FixedAssetsService } = require('../dist/modules/fixed-assets/fixed-assets.service');
const { ExpensesService } = require('../dist/modules/expenses/expenses.service');
const { CostStructureService } = require('../dist/modules/cost-structure/cost-structure.service');
const { splitAmount, splitAt } = require('../dist/modules/payroll/payroll-splits');

const P = { A: '51111111111111', B: '52222222222222' };
const so = (n) => BigInt(Math.round(n * 100));

// splitAmount — tiyin aniq, yig'indi o'zgarmaydi
assert.deepStrictEqual(splitAmount(1000n, [{ departmentId: 'x', pct: 60 }, { departmentId: 'y', pct: 40 }]), [600n, 400n]);
const odd = splitAmount(1001n, [{ departmentId: 'x', pct: 33.33 }, { departmentId: 'y', pct: 33.33 }, { departmentId: 'z', pct: 33.34 }]);
assert.strictEqual(odd.reduce((s, x) => s + x, 0n), 1001n, 'qoldiq yo‘qolmaydi');
// splitAt — eng kech boshlangani, tugash oyi hisobga olinadi
const L = [
  { pinfl: P.A, from: '2026-01', to: null, parts: [] },
  { pinfl: P.A, from: '2026-03', to: '2026-04', parts: [] },
];
assert.strictEqual(splitAt(L, P.A, '2025-12'), null);
assert.strictEqual(splitAt(L, P.A, '2026-02').from, '2026-01');
assert.strictEqual(splitAt(L, P.A, '2026-04').from, '2026-03');
assert.strictEqual(splitAt(L, P.A, '2026-05').from, '2026-01');
assert.strictEqual(splitAt(L, P.B, '2026-02'), null);

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  T.region.push({ code: 0, name: 'Markaz', isActive: true });
  T.category.push({ code: 'PAYROLL_BASE', label: 'Ish haqi', parentCode: null, isLeaf: true, isActive: true });
  T.department.push({ id: 'dC', name: 'Call markaz', index: 1, isActive: true }, { id: 'dM', name: 'Marketing', index: 2, isActive: true });
  const emp = (pinfl, fullName, departmentId) => T.employee.push({ pinfl, fullName, lastName: fullName.split(' ')[0], firstName: 'S', regionCode: 0, departmentId, districtId: null, position: null, employmentType: 'SHTAT', isActive: true, hiredAt: null, firedAt: null });
  emp(P.A, 'Alfa Ikkiyoqlama', 'dC'); // Call markaz + Marketing
  emp(P.B, 'Beta Joyida', 'dC');

  const audit = new AuditService(db.client);
  const units = new UnitPayrollService(db.client, audit);
  const pay = new PayrollService(db.client, undefined, units);
  const plan = new PayrollPlanService(db.client, pay, units, audit);
  const exps = new ExpensesService(db.client, audit, new FixedAssetsService(db.client, audit));
  const svc = new CostStructureService(db.client, audit, exps, { year: async () => ({ rows: [] }) }, pay);

  const fileRows = [[P.A, 1_000_000], [P.B, 3_000_000]];
  for (const per of ['2026-01', '2026-02']) {
    const rows = fileRows.map(([p, s]) => ({ pinfl: p, amountTiyin: String(so(s)), fullName: T.employee.find((e) => e.pinfl === p).fullName }));
    await plan.commit(per, { rows, fileName: `soliq-${per}.xlsx` }, true, 'adm');
  }
  const sumOf = (per, w) => T.expense.filter((e) => !e.deletedAt && e.period === per && e.source === 'PAYROLL' && Object.entries(w).every(([k, v]) => e[k] === v)).reduce((s, e) => s + e.amountTiyin, 0n);
  const totalOf = (per) => sumOf(per, {});
  const before = { j: totalOf('2026-01'), f: totalOf('2026-02') };
  assert.strictEqual(sumOf('2026-02', { departmentId: 'dC' }), so(4_000_000), 'avval — hammasi Call markazda');
  assert.strictEqual(sumOf('2026-02', { departmentId: 'dM' }), 0n);

  // Tekshiruvlar
  await assert.rejects(svc.saveSplit({ pinfl: '123', from: '2026-02', parts: [] }, 'adm'), /PINFL/);
  await assert.rejects(svc.saveSplit({ pinfl: P.A, from: '2026-13', parts: [] }, 'adm'), /YYYY-MM/);
  await assert.rejects(svc.saveSplit({ pinfl: P.A, from: '2026-02', parts: [{ departmentId: 'dC', pct: 100 }] }, 'adm'), /ikki/);
  await assert.rejects(svc.saveSplit({ pinfl: P.A, from: '2026-02', parts: [{ departmentId: 'dC', pct: 50 }, { departmentId: 'dC', pct: 50 }] }, 'adm'), /ikki marta/);
  await assert.rejects(svc.saveSplit({ pinfl: P.A, from: '2026-02', parts: [{ departmentId: 'dC', pct: 60 }, { departmentId: 'dM', pct: 30 }] }, 'adm'), /100/);
  await assert.rejects(svc.saveSplit({ pinfl: P.A, from: '2026-02', parts: [{ departmentId: 'dC', pct: 60 }, { departmentId: 'yoq', pct: 40 }] }, 'adm'), /topilmadi/);
  await assert.rejects(svc.saveSplit({ pinfl: '59999999999999', from: '2026-02', parts: [{ departmentId: 'dC', pct: 60 }, { departmentId: 'dM', pct: 40 }] }, 'adm'), /Xodim topilmadi/);

  // Fevraldan: A — Call markaz 60%, Marketing 40%
  const r = await svc.saveSplit({ pinfl: P.A, from: '2026-02', parts: [{ departmentId: 'dC', pct: 60 }, { departmentId: 'dM', pct: 40 }] }, 'adm');
  assert.strictEqual(r.regrouped, 1, 'faqat fevral qayta guruhlandi');
  assert.strictEqual(sumOf('2026-02', { departmentId: 'dM' }), so(400_000), 'Marketing — 40%');
  assert.strictEqual(sumOf('2026-02', { departmentId: 'dC' }), so(3_600_000), 'Call markaz — B + 60%');
  assert.strictEqual(totalOf('2026-02'), before.f, 'jami o‘zgarmaydi');
  assert.strictEqual(sumOf('2026-01', { departmentId: 'dM' }), 0n, 'yanvar — tegilmagan');
  assert.strictEqual(totalOf('2026-01'), before.j);

  const list = await svc.splits('dM');
  assert.strictEqual(list.length, 1);
  assert.deepStrictEqual(list[0].parts.map((p) => [p.departmentName, p.pct]), [['Call markaz', 60], ['Marketing', 40]]);
  assert.strictEqual((await svc.splits('yoq')).length, 0);

  // Shu oydan qayta saqlash — almashtiriladi (ikkitasi emas)
  await svc.saveSplit({ pinfl: P.A, from: '2026-02', parts: [{ departmentId: 'dC', pct: 50 }, { departmentId: 'dM', pct: 50 }] }, 'adm');
  assert.strictEqual((await svc.splits()).length, 1);
  assert.strictEqual(sumOf('2026-02', { departmentId: 'dM' }), so(500_000));

  // Bekor qilish — hammasi joyiga
  const del = await svc.removeSplit((await svc.splits())[0].id, 'adm');
  assert.strictEqual(del.regrouped, 1);
  assert.strictEqual(sumOf('2026-02', { departmentId: 'dM' }), 0n);
  assert.strictEqual(sumOf('2026-02', { departmentId: 'dC' }), so(4_000_000));
  await assert.rejects(svc.removeSplit('yoq', 'adm'), /topilmadi/);
  assert.ok(T.auditLog.some((a) => /bo'linish/.test(a.changes?.summary ?? '')), 'auditga yozildi');
  console.log('OK t-payroll-splits');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
