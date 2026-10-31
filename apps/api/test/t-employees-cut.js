// Bosh sahifa › Xodimlar kesimida: birlik daromadi xodimlarga ish haqi ulushiga qarab (tiyin aniq, jami o'zgarmaydi),
// ijtimoiy soliq — soliq turlaridagi foiz, safar (23106) xodimga; hudud xodimi — joyi bo'yicha; joyi noma'lum — alohida;
// ish haqisiz oy daromadi — «bo'linmagan». TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { EmployeesCutService, allocate } = require('../dist/modules/structure/employees-cut.service');

assert.deepStrictEqual(allocate(1000n, [3n, 1n]), [750n, 250n]);
assert.deepStrictEqual(allocate(1001n, [1n, 1n, 1n]).reduce((s, x) => s + x, 0n), 1001n);
assert.deepStrictEqual(allocate(500n, [0n, 0n]), [0n, 0n], 'ish haqi yo‘q — bo‘linmaydi');

const P = { A: '61111111111111', B: '62222222222222', C: '63333333333333', D: '64444444444444' };

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.setting.push({ key: 'tax.types', value: [{ code: 'IJTIMOIY', method: 'PAYROLL_PERCENT', rate: 12, active: true }] });
  T.setting.push({ key: 'acc23106.safar', value: { posts: [{ id: 's1', status: 'POSTED', items: [{ pinfl: P.C, period: '2026-02', amountTiyin: '5000' }] }, { id: 's2', status: 'CANCELLED', items: [{ pinfl: P.C, period: '2026-02', amountTiyin: '9999' }] }] } });
  T.employee.push({ pinfl: P.C, fullName: 'Gamma Hududov', position: 'Mutaxassis' }, { pinfl: P.D, fullName: 'Delta Nomalum', position: null });
  T.payrollBatch.push({ id: 'b', status: 'COMMITTED' });
  const pe = (pinfl, period, total) => T.payrollEntry.push({ id: `${pinfl}${period}`, employeePinfl: pinfl, period, batchId: 'b', totalTiyin: BigInt(total), deletedAt: null });
  pe(P.C, '2026-01', 20000);
  pe(P.C, '2026-02', 20000);
  pe(P.D, '2026-02', 10000);

  // Markaz: Call markaz — A (30 000) va B (10 000), daromad 1 001 tiyin; fevralda ish haqi yo'q, daromad 400
  const center = {
    full: async ({ from }) => {
      const jan = from.startsWith('2026-01');
      return {
        details: [
          {
            department: { id: 'dC', name: 'Call markaz', unassigned: false },
            summary: { incomeTiyin: jan ? '1001' : '400' },
            employees: jan
              ? [
                  { pinfl: P.A, fullName: 'Alfa Markaz', position: 'Operator', salaryTiyin: '30000' },
                  { pinfl: P.B, fullName: 'Beta Markaz', position: 'Operator', salaryTiyin: '10000' },
                ]
              : [],
          },
        ],
      };
    },
  };
  const regions = { compare: async () => ({ units: [{ kind: 'region', code: 5, name: 'Namuna viloyati', incomeTiyin: '3000' }, { kind: 'center', code: 0, name: 'Markaz', incomeTiyin: '0' }, { kind: 'segment', code: null, segment: 'TAX_FREE', name: 'Tax free', incomeTiyin: '800' }] }) };
  const chain = { effectivePlaces: async () => new Map([[`${P.C}|2026-01`, { key: 'R:5:-', unit: 'R:5', label: 'Namuna viloyati' }], [`${P.C}|2026-02`, { key: 'R:5:-', unit: 'R:5', label: 'Namuna viloyati' }]]) };
  const svc = new EmployeesCutService(db.client, center, regions, chain, { payrollMap: async (u) => (u === 'TAX_FREE' ? new Map([['65555555555555', 8000n]]) : null) });

  const r = await svc.view({ from: '2026-01-01', to: '2026-02-28' });
  assert.deepStrictEqual(r.months, ['2026-01', '2026-02']);
  assert.strictEqual(r.taxRate, 12);
  const unit = (k) => r.units.find((u) => u.key === k);
  const emp = (u, p) => unit(u).employees.find((e) => e.pinfl === p);

  // Call markaz: yanvar 1 001 — A 3/4, B 1/4 (qoldiq kattasiga); fevral 400 — ish haqi yo'q, bo'linmagan
  assert.deepStrictEqual([emp('dep:dC', P.A).incomeTiyin, emp('dep:dC', P.B).incomeTiyin], ['751', '250']);
  assert.strictEqual(unit('dep:dC').unitIncomeTiyin, '1401');
  assert.strictEqual(unit('dep:dC').unallocatedTiyin, '400');
  assert.strictEqual(emp('dep:dC', P.A).taxTiyin, '3600', 'ijtimoiy soliq 12%');
  assert.strictEqual(emp('dep:dC', P.A).costTiyin, '33600');
  assert.strictEqual(emp('dep:dC', P.A).fullName, 'Alfa Markaz');

  // Hudud: C — ikki oy, viloyat daromadi 3 000 har oy (yolg'iz xodim — hammasi), fevral safar 5 000 (bekor qilingani yo'q)
  const c = emp('r:5', P.C);
  assert.deepStrictEqual([c.salaryTiyin, c.taxTiyin, c.safarTiyin, c.incomeTiyin], ['40000', '4800', '5000', '6000']);
  assert.deepStrictEqual(c.months.map((m) => m.safarTiyin), ['0', '5000']);
  assert.strictEqual(c.resultTiyin, String(6000 - 49800));

  // Yo'nalish: o'z vedomosti xodimi — daromad har oy 800 (yolg'iz xodim), ish haqi 2 × 8 000
  const tf = emp('s:TAX_FREE', '65555555555555');
  assert.deepStrictEqual([tf.salaryTiyin, tf.incomeTiyin, unit('s:TAX_FREE').group], ['16000', '1600', 'segment']);

  // Joyi noma'lum — alohida birlik, daromadsiz
  assert.strictEqual(unit('none').employees[0].pinfl, P.D);
  assert.strictEqual(unit('none').incomeTiyin, '0');
  assert.ok(r.notes.some((n) => /bo'linmadi/.test(n)) && r.notes.some((n) => /Joyi aniqlanmagan/.test(n)));

  // Jami: birlik daromadlari = xodimlarga bo'lingani + bo'linmagani
  assert.strictEqual(BigInt(r.total.unitIncomeTiyin), BigInt(r.total.incomeTiyin) + BigInt(r.total.unallocatedTiyin));
  assert.strictEqual(r.total.headcount, 5);
  console.log('OK t-employees-cut');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
