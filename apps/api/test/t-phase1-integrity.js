// 1-bosqich: pul yo'qolmasin va ikki marta sanalmasin — qayta yuklash, qayta taqsimlash, bo'lim almashtirish,
// eski yuklash yo'li, yuklash yozgan ko'chishlar, ustidan yozilgan ko'chishni tiklash, «Bo'lim»dan o'tkazish
// (bir butun amal, manba bekor qilinsa — o'tkazilgani ham), tarkib yo'naltirishini ikki marta bekor qilish.
// TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { PayrollService } = require('../dist/modules/payroll/payroll.service');
const { PayrollPlanService } = require('../dist/modules/payroll/payroll-plan.service');
const { UnitPayrollService } = require('../dist/modules/unit-payroll/unit-payroll.service');
const { CompositionPlaceService } = require('../dist/modules/salary-composition/salary-composition.place');

const P = { A: '61111111111111', B: '62222222222222', T: '63333333333333', U: '64444444444444', M: '65555555555555' };
const PER = '2026-03';
const so = (n) => BigInt(Math.round(n * 100));
const s = (n) => String(so(n));

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  T.region.push({ code: 0, name: 'Markaz', isActive: true });
  T.category.push({ code: 'PAYROLL_BASE', label: 'Ish haqi', parentCode: null, isLeaf: true, isActive: true });
  T.department.push({ id: 'dA', name: 'AUP', index: 1, isActive: true }, { id: 'dK', name: 'Kadrlar', index: 2, isActive: true }, { id: 'dT', name: 'Tax free', index: 3, isActive: true });
  const emp = (pinfl, fullName, departmentId) => T.employee.push({ pinfl, fullName, lastName: fullName.split(' ')[0], firstName: 'S', regionCode: 0, departmentId, districtId: null, position: null, employmentType: 'SHTAT', isActive: true, hiredAt: null, firedAt: null });
  emp(P.A, 'Alfa Markaz', 'dA');
  emp(P.B, 'Beta Markaz', 'dA');
  emp(P.T, 'Tango Taksfri', 'dT');
  emp(P.U, 'Uniform Taksfri', 'dT');
  emp(P.M, 'Mike Markaz', 'dA');

  const audit = new AuditService(db.client);
  const units = new UnitPayrollService(db.client, audit);
  const pay = new PayrollService(db.client, undefined, units);
  const plan = new PayrollPlanService(db.client, pay, units, audit);
  const places = new CompositionPlaceService(db.client, audit, units, pay, plan);
  const live = (w = {}) => T.expense.filter((e) => !e.deletedAt && e.period === PER && Object.entries(w).every(([k, v]) => e[k] === v));
  const sum = (l) => l.reduce((x, e) => x + e.amountTiyin, 0n);
  const row = (p, n) => ({ pinfl: p, amountTiyin: s(n), fullName: T.employee.find((e) => e.pinfl === p)?.fullName });
  const batchesOf = (u) => T.setting.find((x) => x.key === `unit.payroll.${u}.${PER}`)?.value?.batches ?? [];

  // Boshlang'ich: soliq hisoboti — A, B (Markaz), T (Tax free)
  await plan.commit(PER, { rows: [row(P.A, 10_000_000), row(P.B, 5_000_000), row(P.T, 3_000_000)], fileName: 'soliq-1.xlsx' }, true, 'adm');
  assert.strictEqual(sum(live()), so(18_000_000));

  // ── 1) Qayta yuklash o'rtada xato bersa — eski joyida qoladi (oy ish haqisiz qolmaydi) ──
  const realCommit = units.commit.bind(units);
  units.commit = async () => {
    throw new Error('sinov: bo‘lim yozuvi xatosi');
  };
  await assert.rejects(plan.commit(PER, { rows: [row(P.A, 11_000_000), row(P.T, 3_500_000)], fileName: 'soliq-2.xlsx' }, true, 'adm'), /sinov/);
  units.commit = realCommit;
  assert.strictEqual(sum(live()), so(18_000_000), 'eski soliq hisoboti joyida');
  assert.strictEqual(T.payrollBatch.filter((b) => b.period === PER && b.status === 'COMMITTED').length, 1);
  assert.strictEqual(batchesOf('TAX_FREE').filter((b) => b.status === 'COMMITTED').length, 1);

  // ── 2) Qayta taqsimlash — shu oy HAMMA umumiy yuklashlar olinadi ──
  // Ikkinchi fayl (almashtirmasdan): M
  await plan.commit(PER, { rows: [row(P.M, 2_000_000)], fileName: 'soliq-qoshimcha.xlsx' }, false, 'adm');
  assert.strictEqual(sum(live()), so(20_000_000));
  await plan.redistribute(PER, 'adm');
  assert.strictEqual(sum(live()), so(20_000_000), "qayta taqsimlashdan keyin ham — ikkala fayl");
  assert.ok(T.payrollEntry.some((e) => e.employeePinfl === P.M && !e.deletedAt), "M yo'qolmadi");

  // ── 3) Bo'lim sahifasida «almashtirish» — umumiy hisobotdan kelganlarga tegmaydi ──
  await units.commit('TAX_FREE', PER, { rows: [{ pinfl: '66666666666666', amountTiyin: s(700_000), fullName: 'Yangi Qolda' }], fileName: 'tf-1.xlsx' }, false, 'adm');
  await units.commit('TAX_FREE', PER, { rows: [{ pinfl: '66666666666666', amountTiyin: s(800_000), fullName: 'Yangi Qolda' }], fileName: 'tf-2.xlsx' }, true, 'adm');
  assert.ok(batchesOf('TAX_FREE').some((b) => b.status === 'COMMITTED' && b.origin === 'GENERAL' && b.rows.some((r) => r.pinfl === P.T)), 'T (umumiy hisobotdan) joyida');
  assert.strictEqual(sum(live()), so(20_800_000), 'umumiy 20 mln + qo‘lda 0,8 mln');

  // ── 4) Eski yuklash yo'li (/payroll/commit) bilan almashtirish — eski bo'lim qatorlari ham bekor ──
  const before = batchesOf('TAX_FREE').filter((b) => b.status === 'COMMITTED' && b.origin === 'GENERAL').length;
  assert.strictEqual(before, 1);
  await pay.commit({ period: PER, rows: [{ pinfl: P.A, amountTiyin: so(10_000_000) }, { pinfl: P.B, amountTiyin: so(5_000_000) }, { pinfl: P.M, amountTiyin: so(2_000_000) }], userId: 'adm', replacePrevious: true, fileName: 'eski-yol.xlsx', missing: [] });
  assert.strictEqual(batchesOf('TAX_FREE').filter((b) => b.status === 'COMMITTED' && b.origin === 'GENERAL').length, 0, 'T ikki marta sanalmaydi');
  // Holatni tiklash: umumiy hisobot yana (T bilan)
  await plan.commit(PER, { rows: [row(P.A, 10_000_000), row(P.B, 5_000_000), row(P.T, 3_000_000), row(P.M, 2_000_000)], fileName: 'soliq-3.xlsx' }, true, 'adm');
  assert.strictEqual(sum(live()), so(20_800_000));

  // ── 5) Bo'lim yuklashi yozgan ko'chish — yuklash bekor qilinsa, olib tashlanadi ──
  await units.addMove({ pinfl: P.U, unit: 'TAX_FREE', from: '2026-01', fullName: 'Uniform Taksfri' }, 'adm');
  const u1 = await units.commit('MARKSHEYDER', PER, { rows: [{ pinfl: '67777777777777', amountTiyin: s(100_000), fullName: 'Oscar Yangi' }, { pinfl: P.U, amountTiyin: s(400_000), fullName: 'Uniform Taksfri' }], fileName: 'mk.xlsx' }, false, 'adm');
  assert.strictEqual((await units.unitsAt([P.U], PER)).get(P.U), 'MARKSHEYDER', 'U shu oy Marksheyderda (vedomostida)');
  await units.cancel('MARKSHEYDER', PER, u1.batchId, 'adm');
  assert.strictEqual((await units.unitsAt([P.U], PER)).get(P.U), 'TAX_FREE', "bekor qilindi — U yana o'z joyida");

  // ── 6) Shu oy joy o'zgarishi avvalgi ko'chishni o'chirmaydi: qaytarilganda tiklanadi ──
  await units.addMove({ pinfl: P.M, unit: 'MARKSHEYDER', from: PER, fullName: 'Mike Markaz', note: 'qo‘lda' }, 'adm');
  await places.setPlace(PER, { pinfls: [P.M], target: 'TAX_FREE' }, 'adm');
  assert.strictEqual((await units.unitsAt([P.M], PER)).get(P.M), 'TAX_FREE');
  await places.revert(PER, [P.M], 'adm');
  assert.strictEqual((await units.unitsAt([P.M], PER)).get(P.M), 'MARKSHEYDER', "avvalgi ko'chish tiklandi");
  assert.strictEqual((await units.unitsAt([P.M], '2026-06')).get(P.M), 'MARKSHEYDER');
  await units.removeMove((await units.allMoves()).find((m) => m.pinfl === P.M).id, 'adm');
  await plan.redistribute(PER, 'adm');

  // ── 7) «Bo'lim»dan o'tkazish: bir butun amal va manba bekor qilinsa — o'tkazilgani ham ──
  const q = await units.commit('TAX_FREE', PER, { rows: [{ pinfl: '68888888888888', amountTiyin: s(900_000), fullName: 'Papa Qolda' }], fileName: 'tf-3.xlsx' }, false, 'adm');
  const total0 = sum(live());
  // a) maqsadga yozish xato bersa — hech narsa o'zgarmaydi
  const realCommit2 = units.commit.bind(units);
  units.commit = async (u, ...rest) => (u === 'FERMER' ? Promise.reject(new Error('sinov: maqsad xatosi')) : realCommit2(u, ...rest));
  await assert.rejects(units.moveRows('TAX_FREE', PER, { pinfls: ['68888888888888'], target: 'FERMER' }, 'adm'), /sinov/);
  units.commit = realCommit2;
  assert.strictEqual(sum(live()), total0, "summa yo'qolmadi");
  assert.ok((await units.saved('TAX_FREE', PER)).rows.some((r) => r.pinfl === '68888888888888'), 'qatori joyida');
  assert.ok(!(await units.allMoves()).some((m) => m.pinfl === '68888888888888' && m.unit === 'FERMER'), "ko'chish orqaga qaytdi");
  // b) Markazga summasi bilan → manba bekor → o'tkazilgani ham bekor
  await units.moveRows('TAX_FREE', PER, { pinfls: ['68888888888888'], target: 'CENTER', place: { departmentId: 'dK' } }, 'adm');
  assert.strictEqual(sum(live()), total0, "o'tkazishda jami o'zgarmaydi");
  assert.ok(live({ documentNo: '68888888888888' }).length === 1);
  await units.cancel('TAX_FREE', PER, q.batchId, 'adm').catch(() => null); // qator olingan — yuklash bo'shab bekor bo'lgan bo'lishi mumkin
  const tf = batchesOf('TAX_FREE').find((b) => b.id === q.batchId);
  assert.strictEqual(tf.status, 'CANCELLED');
  // Qo'lda yuklash almashtirilsa — o'tkazilgan summa ham bekor (manbasi yo'q)
  await units.commit('TAX_FREE', PER, { rows: [{ pinfl: '66666666666666', amountTiyin: s(800_000), fullName: 'Yangi Qolda' }], fileName: 'tf-4.xlsx' }, true, 'adm');
  assert.strictEqual(live({ documentNo: '68888888888888' }).length, 0, "o'tkazilgan xarajat ham bekor");
  assert.ok(!(await units.allMoves()).some((m) => m.pinfl === '68888888888888'), "uning ko'chishlari ham");
  assert.strictEqual(sum(live()), so(20_800_000), 'xarajat = soliq hisoboti + qo‘lda yuklangan');

  // ── 8) Umumiy yuklash yozgan ko'chish (bo'limi o'zgartirilgan) — yuklash bekor qilinsa, olib tashlanadi ──
  const r8 = await plan.commit(PER, { rows: [row(P.A, 10_000_000), { ...row(P.B, 5_000_000), target: 'MARKSHEYDER' }, row(P.T, 3_000_000), row(P.M, 2_000_000)], fileName: 'soliq-4.xlsx' }, true, 'adm');
  assert.strictEqual(r8.moved, 1);
  assert.strictEqual((await units.unitsAt([P.B], PER)).get(P.B), 'MARKSHEYDER');
  await pay.cancel(r8.general.batchId, { userId: 'adm' });
  assert.notStrictEqual((await units.unitsAt([P.B], PER)).get(P.B), 'MARKSHEYDER', "yuklash bekor — B ko'chishi ham");

  console.log('OK t-phase1-integrity');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
