// Xodim harakati zanjiri: har oy amaldagi joy (tarkib tuzatishi → joylashuv davri → natijalar fayli → reestr),
// uzluksiz davrlar va harakatlar; nazorat: manbalar zid, joyi ko'rsatilmagan, ish davridan tashqari, reestr eskirgan;
// «ko'rib chiqildi» belgisi. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { EmployeeChainService } = require('../dist/modules/employees/employee-chain.service');

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  T.region.push({ code: 0, name: 'Markaz' }, { code: 10, name: 'Namuna viloyati' }, { code: 11, name: 'Sinov viloyati' });
  T.department.push({ id: 'dA', name: 'Sinov bo‘limi', index: 1, isActive: true });
  const emp = (pinfl, extra) => T.employee.push({ pinfl, fullName: `Namuna ${pinfl}`, regionCode: 10, districtId: null, departmentId: null, position: 'Mutaxassis', hiredAt: null, firedAt: null, isActive: true, employmentType: 'SHTAT', ...extra });
  emp('p1', { regionCode: 0, departmentId: 'dA' }); // Markazdan viloyatga o'tgan; reestr eskirgan
  emp('p2', {}); // natijalar fayli va davr zid
  emp('p3', { hiredAt: new Date('2026-03-01T00:00:00Z') }); // ishga kirishdan oldin ish haqi
  emp('p4', {}); // joyi ko'rsatilmagan
  const loc = (pinfl, period, regionCode) => T.employeeLocation.push({ id: `${pinfl}-${period}`, employeePinfl: pinfl, period, regionCode, districtId: null, employmentType: 'SHTAT' });
  loc('p1', '2026-01', 0);
  loc('p1', '2026-02', 0);
  loc('p1', '2026-03', 10);
  loc('p2', '2026-01', 10);
  loc('p2', '2026-02', 10);
  loc('p3', '2026-02', 10);
  T.setting.push({
    key: 'employee.placements',
    value: { items: [
      { id: 'pl1', pinfl: 'p1', from: '2026-01', to: '2026-02', unit: 'CENTER', departmentId: 'dA', regionCode: null, districtId: null, position: null, note: null, createdAt: '', createdBy: '' },
      { id: 'pl2', pinfl: 'p2', from: '2026-02', to: null, unit: 'REGION', departmentId: null, regionCode: 11, districtId: null, position: null, note: null, createdAt: '', createdBy: '' },
    ] },
  });
  T.salaryCompositionBatch.push({ id: 'b1', period: '2026-02', cancelledAt: null, createdAt: new Date('2026-03-05T00:00:00Z') });
  for (const p of ['p1', 'p2', 'p3', 'p4']) T.salaryCompositionRow.push({ id: `r-${p}`, batchId: 'b1', period: '2026-02', employeePinfl: p, totalTiyin: 100n });

  const svc = new EmployeeChainService(db.client, { log: async () => {} });
  const d = await svc.report('2026-01', '2026-03');
  const is = (pinfl, type) => d.issues.filter((x) => x.pinfl === pinfl && x.type === type).map((x) => x.period);

  // p1: Markaz › Sinov bo'limi (davr) → Namuna viloyati (natijalar fayli) — bitta harakat; reestr eskirgan
  const m1 = d.moves.filter((x) => x.pinfl === 'p1');
  assert.deepStrictEqual(m1.map((x) => [x.period, x.from, x.to]), [['2026-03', 'Markaz › Sinov bo‘limi', 'Namuna viloyati']]);
  assert.deepStrictEqual(is('p1', 'REGISTRY_STALE'), ['2026-03']);
  assert.deepStrictEqual(is('p1', 'CONFLICT'), [], 'davr va fayl bir xil birlik (Markaz) — zid emas');
  // p2: fayl — Namuna, davr — Sinov viloyati (2026-02 dan): zid; amaldagi — davr (ustun)
  assert.deepStrictEqual(is('p2', 'CONFLICT'), ['2026-02']);
  // p3: ishga 2026-03 da kirgan, 2026-02 da ish haqi bor
  assert.deepStrictEqual(is('p3', 'OUT_OF_RANGE'), ['2026-02']);
  // p4: ish haqi bor, joyi hech qayerda yo'q — reestr olinadi
  assert.deepStrictEqual(is('p4', 'NO_PLACE'), ['2026-02']);
  assert.strictEqual(d.summary.CONFLICT.open, 1);

  // Vaqt chizig'i: uzluksiz davrlar
  const t = await svc.timeline('p1', '2026-01', '2026-03');
  assert.deepStrictEqual(t.segments.map((s) => [s.from, s.to, s.place, s.months]), [['2026-01', '2026-02', 'Markaz › Sinov bo‘limi', 2], ['2026-03', '2026-03', 'Namuna viloyati', 1]]);
  assert.deepStrictEqual(t.rows.map((r) => r.source), ['PLACEMENT', 'PLACEMENT', 'RESULTS'], 'ustunlik: davr → fayl');
  const t2 = await svc.timeline('p2', '2026-01', '2026-02');
  assert.strictEqual(t2.rows[1].effective, 'Sinov viloyati', 'davr fayldan ustun');

  // Ko'rib chiqildi — ochiq ro'yxatdan chiqadi, qayta ochish mumkin
  await svc.review({ pinfl: 'p2', period: '2026-02', type: 'CONFLICT', note: 'buyruq bor' }, 'adm');
  let r = await svc.report('2026-01', '2026-03');
  assert.deepStrictEqual([r.summary.CONFLICT.open, r.summary.CONFLICT.reviewed], [0, 1]);
  assert.strictEqual(r.issues.find((x) => x.pinfl === 'p2' && x.type === 'CONFLICT').reviewed.note, 'buyruq bor');
  await svc.review({ pinfl: 'p2', period: '2026-02', type: 'CONFLICT', undo: true }, 'adm');
  r = await svc.report('2026-01', '2026-03');
  assert.strictEqual(r.summary.CONFLICT.open, 1);
  await assert.rejects(() => svc.review({ pinfl: 'p2', period: '2026-02', type: 'YOQ' }, 'adm'), /muammo turi/);
  await assert.rejects(() => svc.timeline('yoq', '2026-01', '2026-02'), /topilmadi/);

  console.log('OK t-employee-chain');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
