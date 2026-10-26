// 2-bosqich: bir xodim — hamma sahifada bir xil javob (soliq summasi, tarkibi, joyi, 23106 oyi).
// Ish haqi tarkibi, uchlik nazorat, solishtirma, 23106 nazorati, bo'lim sahifasi va ijtimoiy soliq bitta qoidani
// ishlatadi (PayrollFactsService). TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { PayrollService } = require('../dist/modules/payroll/payroll.service');
const { PayrollPlanService } = require('../dist/modules/payroll/payroll-plan.service');
const { UnitPayrollService } = require('../dist/modules/unit-payroll/unit-payroll.service');
const { SalaryCompositionService } = require('../dist/modules/salary-composition/salary-composition.service');
const { CompositionReconcileService } = require('../dist/modules/salary-composition/salary-composition.reconcile');
const { CompositionPlaceService } = require('../dist/modules/salary-composition/salary-composition.place');
const { PayrollSolishtirmaService } = require('../dist/modules/payroll-solishtirma/payroll-solishtirma.service');
const { PayrollFactsService } = require('../dist/modules/payroll-facts/payroll-facts.service');
const { accrualMonth, bankMonthOf } = require('../dist/modules/acc-23106/acc23106.purpose');

const P = { A: '51111111111111', T: '53333333333333', L: '54444444444444', N: '55555555555555' };
const PER = '2026-03';
const so = (n) => BigInt(Math.round(n * 100));
const s = (n) => String(so(n));
const crow = (pinfl, items) => ({ pinfl, fullName: null, workedDays: null, rate: null, items: new Map(Object.entries(items).map(([k, v]) => [k, so(v)])) });

(async () => {
  // ── 23106 oyi: bitta qoida ──
  assert.strictEqual(accrualMonth('2026 йил март ойи учун иш ҳақи', '2026-04-05', null), '2026-03');
  assert.strictEqual(accrualMonth('2024 йил январ ойи учун', '2026-03-10', null), '2026-03', 'juda eski oy nomi — to‘lov oyi');
  assert.strictEqual(accrualMonth('mukofot', '2026-03-10', '2026-02-20'), '2026-02', 'buyruq oyi');
  assert.strictEqual(bankMonthOf({ purpose: 'mart oyi uchun', docDate: '2026-04-05' }, 'PAID'), '2026-04');

  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  T.region.push({ code: 0, name: 'Markaz', isActive: true }, { code: 7, name: 'Viloyat-7', isActive: true });
  T.category.push({ code: 'PAYROLL_BASE', label: 'Ish haqi', parentCode: null, isLeaf: true, isActive: true });
  T.department.push({ id: 'dA', name: 'AUP', index: 1, isActive: true }, { id: 'dT', name: 'Tax free', index: 2, isActive: true });
  const emp = (pinfl, fullName, departmentId, employmentType = 'SHTAT') => T.employee.push({ pinfl, fullName, lastName: fullName.split(' ')[0], firstName: 'S', regionCode: 0, departmentId, districtId: null, position: null, employmentType, isActive: true, hiredAt: null, firedAt: null });
  emp(P.A, 'Alfa Markaz', 'dA');
  emp(P.T, 'Tango Taksfri', 'dT');
  emp(P.N, 'November Markaz', 'dA');

  const audit = new AuditService(db.client);
  const units = new UnitPayrollService(db.client, audit);
  const pay = new PayrollService(db.client, undefined, units);
  const plan = new PayrollPlanService(db.client, pay, units, audit);
  const comp = new SalaryCompositionService(db.client, pay, units);
  await comp.onModuleInit();
  T.salaryComponent.forEach((x) => (x.isActive = true));
  const rec = new CompositionReconcileService(db.client, comp, pay, audit, units);
  const places = new CompositionPlaceService(db.client, audit, units, pay, plan);
  const sol = new PayrollSolishtirmaService(db.client, audit, units, rec);
  const facts = new PayrollFactsService(db.client, units);

  // Soliq hisoboti: A, N — Markaz; T — Tax free (miya bo'yicha bo'limga)
  await plan.commit(PER, { rows: [{ pinfl: P.A, amountTiyin: s(10_000_000), fullName: 'Alfa Markaz' }, { pinfl: P.T, amountTiyin: s(3_000_000), fullName: 'Tango Taksfri' }, { pinfl: P.N, amountTiyin: s(4_000_000), fullName: 'November Markaz' }], fileName: 'soliq.xlsx' }, true, 'adm');
  // Tarkib: umumiy (Markaz fayli) — A, T, N; Tax free'ning o'z tarkibi — T
  await comp.commit({ period: PER, fileName: 'markaz.xlsx', userId: 'adm', rows: [crow(P.A, { OKLAD: 10_000_000 }), crow(P.T, { OKLAD: 3_000_000 }), crow(P.N, { OKLAD: 4_000_000 })] });
  await comp.commit({ period: PER, fileName: 'tf.xlsx', userId: 'adm', unit: 'TAX_FREE', rows: [crow(P.T, { OKLAD: 3_000_000 })] });

  // ── Soliq summasi: bo'limga yozilgani ham soliq hisoboti ──
  let f = await facts.soliq(PER);
  assert.deepStrictEqual([f.get(P.T).tiyin, f.get(P.T).source, f.get(P.T).unit], [so(3_000_000), 'UNIT_GENERAL', 'TAX_FREE']);

  // ── Tarkib: ikkalasida bo'lgan T — Tax free'da ishlaydi → o'z tarkibi (qo'shilmaydi) ──
  const t = await facts.tarkib(PER);
  assert.deepStrictEqual([t.map.get(P.T).source, t.map.get(P.T).tiyin, t.map.get(P.T).alsoIn], ['TAX_FREE', so(3_000_000), 'GENERAL']);
  // Umumiy tarkib tekshiruvida T yo'q (o'z tarkibida solishtiriladi), Tax free tekshiruvida — bor va mos
  const gc = await comp.check(PER);
  assert.ok(![...gc.missingInComposition, ...gc.notInPayroll].some((x) => x.pinfl === P.T));
  const uc = await comp.check(PER, 'TAX_FREE');
  assert.strictEqual(uc.mismatchCount, 0, 'Tax free: tarkib = soliq hisoboti');
  // Solishtirma: T — bitta tarkib (3 mln, 6 mln emas)
  let v = await sol.view(PER, 'ACCRUAL', 'CENTER');
  const r = (p) => v.rows.find((x) => x.pinfl === p);
  assert.deepStrictEqual([r(P.T).group, r(P.T).tarkibTiyin, r(P.T).soliqTiyin], ['UNIT', s(3_000_000), s(3_000_000)]);

  // ── Ikki marta sanalgan (eski xato): T qo'lda ham yuklangan — soliq summasi umumiy hisobotdan, belgisi bilan ──
  const key = `unit.payroll.TAX_FREE.${PER}`;
  T.setting.find((x) => x.key === key).value.batches.push({ id: 'qolda', period: PER, fileName: 'qolda.xlsx', fileHash: 'h', status: 'COMMITTED', createdAt: new Date().toISOString(), cancelledAt: null, uploadedById: 'adm', uploadedBy: 'Admin', totalTiyin: s(3_000_000), count: 1, zeroCount: 0, newStaff: 0, expenseId: null, rows: [{ pinfl: P.T, fullName: 'Tango Taksfri', amountTiyin: s(3_000_000) }] });
  f = await facts.soliq(PER);
  assert.deepStrictEqual([f.get(P.T).tiyin, f.get(P.T).duplicate], [so(3_000_000), true], "6 mln emas — ikki marta deb belgilangan");
  v = await sol.view(PER, 'ACCRUAL', 'CENTER');
  assert.deepStrictEqual([r(P.T).soliqTiyin, r(P.T).soliqDuplicate], [s(3_000_000), true]);
  T.setting.find((x) => x.key === key).value.batches.pop();

  // ── Eski yozuv (baseTiyin = 0): to'liq summa hamma joyda bir xil ──
  const eN = T.payrollEntry.find((e) => e.employeePinfl === P.N && !e.deletedAt);
  const keep = { b: eN.baseTiyin, t: eN.totalTiyin, bo: eN.bonusTiyin };
  Object.assign(eN, { baseTiyin: 0n, totalTiyin: so(3_500_000), bonusTiyin: so(500_000) });
  f = await facts.soliq(PER);
  assert.strictEqual(f.get(P.N).tiyin, so(4_000_000));
  v = await sol.view(PER, 'ACCRUAL', 'CENTER');
  assert.strictEqual(r(P.N).fotTiyin, s(4_000_000), 'solishtirmada 0 emas');
  assert.ok(!(await comp.check(PER)).notInPayroll.some((x) => x.pinfl === P.N));
  Object.assign(eN, { baseTiyin: keep.b, totalTiyin: keep.t, bonusTiyin: keep.bo });

  // ── Joy: shu oy hududga o'tkazilgan A — tarkib tekshiruvi, solishtirma va joy bir xil ──
  await places.setPlace(PER, { pinfls: [P.A], target: 'REGION', place: { regionCode: 7 } }, 'adm');
  const loc = (await facts.location(PER, [P.A])).get(P.A);
  assert.deepStrictEqual([loc.unit, loc.regionCode, loc.fixed], ['REGION', 7, true]);
  v = await sol.view(PER, 'ACCRUAL', 'REGION');
  assert.ok(v.rows.some((x) => x.pinfl === P.A && x.group === 'REGION_SHTAT'), 'solishtirmada — Hududlar tablosida');
  const gc2 = await comp.check(PER);
  assert.ok(!gc2.missingInComposition.some((x) => x.pinfl === P.A), "Markaz tarkibida yo'q deb chiqmaydi");
  await places.revert(PER, [P.A], 'adm');

  // ── Shartnoma turi — shu oy joylashuvidan, hamma joyda ──
  T.employeeLocation.push({ id: 'l1', employeePinfl: P.N, period: PER, regionCode: 0, districtId: null, employmentType: 'SHARTNOMA', source: 'RESULTS' });
  v = await sol.view(PER, 'ACCRUAL', 'CENTER');
  assert.deepStrictEqual([r(P.N).employmentType, r(P.N).group, r(P.N).unionTiyin], ['SHARTNOMA', 'CENTER_SHARTNOMA', '0']);
  assert.strictEqual((await facts.location(PER, [P.N])).get(P.N).employmentType, 'SHARTNOMA');

  // ── Bazada yo'q, bo'lim ro'yxatida (Tax free) — joyi ma'lum ──
  T.setting.find((x) => x.key === 'unit.staff') ?? T.setting.push({ key: 'unit.staff', value: {} });
  T.setting.find((x) => x.key === 'unit.staff').value.TAX_FREE = [{ pinfl: P.L, fullName: 'Lima Royxat', position: null, active: true, addedAt: '2026-01-01T00:00:00Z', source: 'MANUAL', leftAt: null }];
  const lL = (await facts.location(PER, [P.L])).get(P.L);
  assert.deepStrictEqual([lL.unit, lL.known, lL.inRegistry], ['TAX_FREE', true, false]);

  console.log('OK t-phase2-consistency');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
