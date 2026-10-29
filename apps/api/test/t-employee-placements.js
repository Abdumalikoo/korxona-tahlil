// Xodimning joylashuv davrlari: «shu oydan shu oygacha shu joyda, shu lavozimda» — oylik joy (ish haqi, solishtirma),
// Markaz bo'limlari va «Bo'limga biriktirilmagan» ro'yxati shu bo'yicha. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { EmployeePlacementsService } = require('../dist/modules/employees/employee-placements.service');
const { loadLocationRefs } = require('../dist/modules/payroll/payroll.service');
const { CenterService } = require('../dist/modules/structure/center.service');
const P = require('../dist/common/placements/placements');

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'a1', role: 'ADMIN', fullName: 'Admin' });
  T.region.push({ code: 0, name: 'Markaz' }, { code: 26, name: 'Namuna shahri' }, { code: 27, name: 'Namuna viloyati' }, { code: 99, name: 'Hududlar umumiy' });
  T.district.push({ id: '27-1', regionCode: 27, code: 1, name: 'Namuna tumani' }, { id: '26-1', regionCode: 26, code: 1, name: 'Boshqa tuman' });
  T.department.push({ id: 'd1', name: 'Murojaatlar', index: 1, isActive: true }, { id: 'd2', name: 'Muvofiqlashtirish', index: 2, isActive: true });
  const emp = (pinfl, fullName) => ({ pinfl, fullName, regionCode: 0, departmentId: null, districtId: null, position: 'Reestrdagi lavozim', employmentType: 'SHTAT', hiredAt: null, firedAt: null, isActive: true });
  const A = '20000000000001';
  const B = '20000000000002';
  const C = '20000000000003';
  T.employee.push(emp(A, 'Namuna A'), emp(B, 'Namuna B'), emp(C, 'Namuna C'));
  T.employeeLocation = [];

  // ── Yordamchilar ──
  assert.strictEqual(P.covers({ from: '2026-01', to: '2026-06' }, '2026-06'), true, 'tugash oyi ham kiradi');
  assert.strictEqual(P.covers({ from: '2026-07', to: null }, '2027-03'), true, 'tugashi yo‘q — hozirgacha');
  assert.strictEqual(P.overlaps({ from: '2026-01', to: '2026-06' }, { from: '2026-07', to: null }), false);
  assert.strictEqual(P.overlaps({ from: '2026-01', to: '2026-06' }, { from: '2026-06', to: null }), true);

  const svc = new EmployeePlacementsService(db.client, new AuditService(db.client));
  // A: iyungacha Markaz › Murojaatlar, iyuldan — Namuna viloyati (bo'lim boshlig'i)
  await svc.add(A, { from: '2026-01', to: '2026-06', unit: 'CENTER', departmentId: 'd1', position: 'Murojaatlar bilan ishlash xodimi' }, 'a1');
  const a2 = await svc.add(A, { from: '2026-07', unit: 'REGION', regionCode: 27, position: "Bo'lim boshlig'i" }, 'a1');
  assert.deepStrictEqual([a2.to, a2.placeLabel], [null, 'Namuna viloyati']);
  // B: martgacha Markaz › Muvofiqlashtirish, apreldan — Namuna shahri
  await svc.add(B, { from: '2026-01', to: '2026-03', unit: 'CENTER', departmentId: 'd2', position: 'Hududlarni muvofiqlashtirish' }, 'a1');
  await svc.add(B, { from: '2026-04', unit: 'REGION', regionCode: 26, districtId: '26-1', position: "Bo'lim boshlig'i" }, 'a1');

  // Rad etiladi: ustma-ust, tugash boshlanishdan oldin, Markazda bo'limsiz, tuman boshqa viloyatniki, noma'lum xodim
  await assert.rejects(svc.add(A, { from: '2026-05', to: '2026-08', unit: 'CENTER', departmentId: 'd1' }, 'a1'), /ustma-ust/);
  await assert.rejects(svc.add(C, { from: '2026-05', to: '2026-04', unit: 'CENTER', departmentId: 'd1' }, 'a1'), /oldin/);
  await assert.rejects(svc.add(C, { from: '2026-05', unit: 'CENTER' }, 'a1'), /bo'limini tanlang/);
  await assert.rejects(svc.add(C, { from: '2026-05', unit: 'REGION', regionCode: 27, districtId: '26-1' }, 'a1'), /tegishli emas/);
  await assert.rejects(svc.add(C, { from: '2026-05', unit: 'REGION', regionCode: 99 }, 'a1'), /Viloyatni tanlang/, 'Hududlar › Umumiy — xodim joyi emas');
  await assert.rejects(svc.add('29999999999999', { from: '2026-05', unit: 'REGION', regionCode: 27 }, 'a1'), /topilmadi/);

  const listA = (await svc.list(A)).items;
  assert.deepStrictEqual(listA.map((p) => [p.from, p.to, p.placeLabel]), [['2026-01', '2026-06', 'Markaz › Murojaatlar'], ['2026-07', null, 'Namuna viloyati']]);
  assert.strictEqual(T.auditLog.filter((l) => l.entityType === 'employee_placement').length, 4);

  // ── Oylik joy (ish haqi, solishtirma — hamma modul shuni ishlatadi) ──
  const at = async (period, pinfl) => (await loadLocationRefs(db.client, period, [pinfl])).get(pinfl);
  const jun = await at('2026-06', A);
  assert.deepStrictEqual([jun.regionCode, jun.department.id, jun.position], [0, 'd1', 'Murojaatlar bilan ishlash xodimi'], 'iyun — Markazda');
  const jul = await at('2026-07', A);
  assert.deepStrictEqual([jul.regionCode, jul.region.name, jul.department, jul.position], [27, 'Namuna viloyati', null, "Bo'lim boshlig'i"], 'iyuldan — hududda');
  const bApr = await at('2026-04', B);
  assert.deepStrictEqual([bApr.regionCode, bApr.districtId, bApr.district.name], [26, '26-1', 'Boshqa tuman']);
  assert.strictEqual(await at('2026-04', C), undefined, 'davri yo‘q — o‘zgarmaydi');
  // Shu oy qo'lda joy o'zgarishi (ish haqi tarkibi) — davrdan ham ustun
  T.setting.push({ key: 'salary.composition.place.2026-08', value: { fixes: { [A]: { departmentId: 'd2', unit: 'CENTER' } } } });
  const aug = await at('2026-08', A);
  assert.deepStrictEqual([aug.regionCode, aug.department.id], [0, 'd2']);

  // ── Markaz bo'limlari: davr oxiridagi joy bo'yicha ──
  const center = new CenterService(db.client);
  const unassigned = async (from, to) => (await center.department('-', { from, to })).employees.map((e) => e.fullName).sort();
  assert.deepStrictEqual(await unassigned('2026-09-01', '2026-09-30'), ['Namuna C'], 'A va B hududda — biriktirilmaganlarda yo‘q');
  const d1Mar = await center.department('d1', { from: '2026-03-01', to: '2026-03-31' });
  const aRow = d1Mar.employees.find((e) => e.fullName === 'Namuna A');
  assert.deepStrictEqual([Boolean(aRow), aRow && aRow.position], [true, 'Murojaatlar bilan ishlash xodimi'], 'martda A — Murojaatlar bo‘limida');
  assert.ok(!d1Mar.employees.some((e) => e.fullName === 'Namuna B'));
  assert.deepStrictEqual(await unassigned('2026-03-01', '2026-03-31'), ['Namuna C']);

  // ── Reestrda hududda, davr bo'yicha Markazda ish haqi olgan: keyingi oylarda «biriktirilmagan»ga tushmasin ──
  const D = '20000000000004';
  T.employee.push({ ...emp(D, 'Namuna D'), regionCode: 27 });
  await svc.add(D, { from: '2026-01', to: '2026-06', unit: 'CENTER', departmentId: 'd1' }, 'a1');
  await svc.add(D, { from: '2026-07', unit: 'REGION', regionCode: 27 }, 'a1');
  T.payrollBatch.push({ id: 'pb3', period: '2026-03', status: 'COMMITTED' });
  T.payrollEntry.push({ id: 'peD', batchId: 'pb3', employeePinfl: D, period: '2026-03', totalTiyin: 500n, deletedAt: null });
  T.expense.push({ id: 'xD', date: new Date('2026-03-31T07:00:00Z'), period: '2026-03', amountTiyin: 500n, categoryCode: 'PAYROLL_BASE', regionCode: 0, departmentId: 'd1', segment: null, source: 'PAYROLL', payrollBatchId: 'pb3', deletedAt: null, section: 'DOIMIY' });
  assert.ok(!(await unassigned('2026-09-01', '2026-09-30')).includes('Namuna D'), 'sentyabrda hududda — biriktirilmaganlarda yo‘q');
  const d1MarD = (await center.department('d1', { from: '2026-03-01', to: '2026-03-31' })).employees.find((e) => e.fullName === 'Namuna D');
  assert.deepStrictEqual(d1MarD && d1MarD.salaryTiyin, '500', 'martda — o‘z bo‘limida, ish haqi bilan');
  assert.ok(!(await unassigned('2026-03-01', '2026-03-31')).includes('Namuna D'));

  // ── O'chirish — reestrdagi joyga qaytadi ──
  for (const p of (await svc.list(B)).items) await svc.remove(B, p.id, 'a1');
  assert.deepStrictEqual((await svc.list(B)).items, []);
  assert.deepStrictEqual(await unassigned('2026-09-01', '2026-09-30'), ['Namuna B', 'Namuna C']);
  await assert.rejects(svc.remove(B, 'yoq', 'a1'), /topilmadi/);

  console.log('t-employee-placements: OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
