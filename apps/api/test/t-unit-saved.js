// Saqlangan ish haqi — xodimlar bo'yicha: ko'rish, o'chirish, boshqa bo'limga o'tkazish (summasi va «miya» bilan). TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { UnitPayrollService, membership } = require('../dist/modules/unit-payroll/unit-payroll.service');
const db = fakeDb();
const T = db.tables;
T.category.push({ code: 'PAYROLL_BASE', label: 'Ish haqi', parentCode: null, isLeaf: true, isActive: true });
T.user.push({ id: 'u1', fullName: 'Admin' });
T.region.push({ code: 0, name: 'Markaz', isActive: true }, { code: 3, name: 'Andijon', isActive: true }, { code: 18, name: 'Samarqand', isActive: true });
T.department.push({ id: 'd1', code: 'BUX', name: 'Buxgalteriya', index: 1, isActive: true }, { id: 'd2', code: 'IT', name: "IT bo'limi", index: 2, isActive: true }, { id: 'd9', code: 'OLD', name: 'Yopilgan', index: 9, isActive: false });
T.district.push({ id: '3-1', regionCode: 3, code: 1, name: 'Asaka', isActive: true }, { id: '18-2', regionCode: 18, code: 2, name: 'Urgut', isActive: true });
const E = (pinfl, fullName, regionCode, departmentId = null) => T.employee.push({ pinfl, fullName, isActive: true, regionCode, departmentId, position: null });
E('11111111111111', 'Aliyev Ali', 0, 'd1'); E('22222222222222', 'Botirova Barno', 3); E('33333333333333', 'Karimov Kamol', null); E('44444444444444', 'Doniyorov Doniyor', 0);
E('55555555555555', 'Ergasheva Eldora', 3); E('66666666666666', 'Fozilov Farrux', 0, 'd1'); E('77777777777777', 'G\'aniyev G\'ayrat', null);
const audit = { logs: [], async log(x) { this.logs.push(x); } };
const svc = new UnitPayrollService(db.client, audit);
const P = '2026-01';
const live = (pred) => T.expense.filter((e) => !e.deletedAt && pred(e));
const sum = (list) => list.reduce((s, e) => s + e.amountTiyin, 0n);
(async () => {
  const S = (n) => String(BigInt(n) * 100n);
  await svc.commit('TAX_FREE', P, { rows: [{ pinfl: '11111111111111', amountTiyin: S(5000000) }, { pinfl: '22222222222222', amountTiyin: S(4000000) }, { pinfl: '33333333333333', amountTiyin: S(3000000) }, { pinfl: '44444444444444', amountTiyin: S(1000000) }, { pinfl: '55555555555555', amountTiyin: S(2000000) }, { pinfl: '66666666666666', amountTiyin: S(1500000) }, { pinfl: '77777777777777', amountTiyin: S(2500000) }], fileName: 'yan.xlsx' }, false, 'u1');
  let v = await svc.saved('TAX_FREE', P);
  assert.deepStrictEqual([v.count, v.totalTiyin], [7, S(19000000)]);
  assert.strictEqual(sum(live((e) => e.segment === 'TAX_FREE')), BigInt(S(19000000)));

  // ── Aniq joy: Markaz bo'limi, viloyat va tuman ──
  await assert.rejects(svc.moveRows('TAX_FREE', P, { pinfls: ['66666666666666'], target: 'QOMITA' }, 'u1'), /Qo'mita pullariga ish haqi o'tkazilmaydi/);
  await assert.rejects(svc.moveRows('TAX_FREE', P, { pinfls: ['66666666666666'], target: 'CENTER', place: { departmentId: 'd9' } }, 'u1'), /bo'limi topilmadi/);
  await assert.rejects(svc.moveRows('TAX_FREE', P, { pinfls: ['55555555555555'], target: 'REGION', place: { regionCode: 3, districtId: '18-2' } }, 'u1'), /Tuman Andijon tarkibida topilmadi/);
  const m6 = await svc.moveRows('TAX_FREE', P, { pinfls: ['66666666666666'], target: 'CENTER', place: { departmentId: 'd2' } }, 'u1');
  assert.strictEqual(m6.targetLabel, "Markaz › IT bo'limi");
  const e6 = live((e) => e.documentNo === '66666666666666');
  assert.deepStrictEqual([e6.length, e6[0].regionCode, e6[0].departmentId, e6[0].amountTiyin], [1, 0, 'd2', BigInt(S(1500000))], "bazadagi bo'limi (d1) emas — tanlangani (d2)");
  const m5 = await svc.moveRows('TAX_FREE', P, { pinfls: ['55555555555555'], target: 'REGION', place: { regionCode: 18, districtId: '18-2' } }, 'u1');
  assert.strictEqual(m5.targetLabel, 'Hududlar › Samarqand › Urgut');
  const e5 = live((e) => e.documentNo === '55555555555555');
  assert.deepStrictEqual([e5[0].regionCode, e5[0].districtId, e5[0].departmentId], [18, '18-2', null], 'bazadagi hududi (Andijon) emas — tanlangani');
  // Hududi noma'lum xodim ham — viloyat tanlansa o'tadi (tumansiz)
  const m7 = await svc.moveRows('TAX_FREE', P, { pinfls: ['77777777777777'], target: 'REGION', place: { regionCode: '3' } }, 'u1');
  assert.strictEqual(m7.targetLabel, 'Hududlar › Andijon');
  const e7 = live((e) => e.documentNo === '77777777777777');
  assert.deepStrictEqual([e7[0].regionCode, e7[0].districtId], [3, null]);
  assert.strictEqual(sum(live((e) => e.segment === 'TAX_FREE')), BigInt(S(13000000)));
  v = await svc.saved('TAX_FREE', P);
  assert.deepStrictEqual(v.rows.map((r) => r.fullName), ['Aliyev Ali', 'Botirova Barno', 'Doniyorov Doniyor', 'Karimov Kamol']);

  // ── O'chirish ──
  await assert.rejects(svc.removeRows('TAX_FREE', P, { pinfls: [] }, 'u1'), /belgilanmagan/);
  const rm = await svc.removeRows('TAX_FREE', P, { pinfls: ['44444444444444'] }, 'u1');
  assert.deepStrictEqual([rm.removed, rm.totalTiyin], [1, S(1000000)]);
  assert.strictEqual(sum(live((e) => e.segment === 'TAX_FREE')), BigInt(S(12000000)));
  assert.strictEqual((await svc.saved('TAX_FREE', P)).count, 3);

  // ── Aliyev yanvarda Markazda ishlagan: summasi bilan, faqat shu oy ──
  const mv = await svc.moveRows('TAX_FREE', P, { pinfls: ['11111111111111'], target: 'CENTER' }, 'u1');
  assert.deepStrictEqual([mv.moved, mv.target], [1, 'CENTER']);
  assert.strictEqual(sum(live((e) => e.segment === 'TAX_FREE')), BigInt(S(7000000)));
  const c = live((e) => e.regionCode === 0 && e.categoryCode === 'PAYROLL_BASE' && e.documentNo === '11111111111111');
  assert.deepStrictEqual([c.length, c[0].amountTiyin, c[0].departmentId], [1, BigInt(S(5000000)), 'd1']);
  const at = membership(await svc.allMoves());
  assert.deepStrictEqual([at('11111111111111', '2026-01'), at('11111111111111', '2026-02')], ['CENTER', 'TAX_FREE']);
  // ── Botirova — Fermer xo'jaligiga (yo'nalish) — uning vedomostiga ──
  await svc.moveRows('TAX_FREE', P, { pinfls: ['22222222222222'], target: 'FERMER', onlyThisMonth: false }, 'u1');
  assert.strictEqual(sum(live((e) => e.segment === 'FERMER')), BigInt(S(4000000)));
  assert.deepStrictEqual((await svc.saved('FERMER', P)).rows.map((r) => r.pinfl), ['22222222222222']);
  const at2 = membership(await svc.allMoves());
  assert.deepStrictEqual([at2('22222222222222', '2026-01'), at2('22222222222222', '2026-05')], ['FERMER', 'FERMER']);
  // ── Karimov — Hududlarga: hududi noma'lum ──
  await assert.rejects(svc.moveRows('TAX_FREE', P, { pinfls: ['33333333333333'], target: 'REGION' }, 'u1'), /Hududi noma'lum/);
  // summasiz — mumkin
  await svc.moveRows('TAX_FREE', P, { pinfls: ['33333333333333'], target: 'REGION', withAmount: false }, 'u1');
  v = await svc.saved('TAX_FREE', P);
  assert.deepStrictEqual([v.count, v.totalTiyin], [0, '0']);
  assert.strictEqual(live((e) => e.segment === 'TAX_FREE').length, 0, "bo'sh vedomost xarajati o'chadi");
  console.log('OK t-unit-saved');
})().catch((e) => { console.error(e); process.exit(1); });