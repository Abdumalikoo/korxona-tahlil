// Foyda keltirmaydigan bo'limlar (Markaz bo'limlari): moddalar oyma-oy va bo'lim siyosati —
// shu bo'lim / Markaz (bo'limsiz) / boshqa bo'lim / yo'nalish hisobidan. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { DepPolicyService } = require('../dist/modules/expense-policy/dep-policy.service');
const { policyRouting, readPolicy } = require('../dist/modules/expense-policy/policy.util');

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  T.department.push({ id: 'd1', name: 'AUP', isActive: true, index: 1 }, { id: 'd2', name: 'IT', isActive: true, index: 2 });
  T.category.push(
    { code: 'G', label: "Ma'muriy", parentCode: null, isLeaf: false, isActive: true, order: 1 },
    { code: 'G1', label: 'Kanselyariya', parentCode: 'G', isLeaf: true, isActive: true, order: 2 },
    { code: 'G2', label: 'Aloqa', parentCode: 'G', isLeaf: true, isActive: true, order: 3 },
    { code: 'T', label: 'Transport', parentCode: null, isLeaf: true, isActive: true, order: 4 },
  );
  const ex = (date, amount, categoryCode, departmentId, extra = {}) =>
    T.expense.push({ id: `e${T.expense.length}`, date: new Date(`${date}T07:00:00Z`), amountTiyin: BigInt(amount), categoryCode, regionCode: 0, departmentId, segment: null, deletedAt: null, ...extra });
  ex('2026-01-10', 100, 'G1', 'd1');
  ex('2026-02-10', 50, 'G2', 'd1');
  ex('2026-02-11', 30, 'G1', 'd2');
  ex('2026-02-12', 20, 'T', null);
  ex('2026-02-13', 999, 'T', null, { regionCode: 5 }); // hudud — Markaz emas

  const svc = new DepPolicyService(db.client, new AuditService(db.client));
  let list = await svc.list('2026-01', '2026-02');
  const L = (id) => list.find((d) => d.id === id);
  assert.deepStrictEqual([L('d1').writtenTiyin, L('d1').staysTiyin, L('d1').categories, L('d2').writtenTiyin], ['150', '150', 2, '30']);

  let v = await svc.view('d1', '2026-01', '2026-02');
  const C = (code) => v.categories.find((c) => c.code === code);
  assert.deepStrictEqual([C('G').totalTiyin, C('G').months, C('G1').totalTiyin, C('G1').effective.label, C('G1').effective.origin], ['150', { '2026-01': '100', '2026-02': '50' }, '100', "Shu bo'lim", 'none'], 'guruh = ichkilar yig‘indisi, oyma-oy');
  assert.ok(v.targets.some((t) => t.code === 'dep:d2') && !v.targets.some((t) => t.code === 'dep:d1'), "maqsadlar: boshqa bo'limlar");
  assert.ok(v.targets.some((t) => t.code === 'TAX_FREE'));

  // ── Siyosat: AUP ning «Ma'muriy» xarajatlari IT hisobiga, «Aloqa» — Tax free hisobiga ──
  await assert.rejects(svc.save('d1', { rules: { G: 'dep:d1' } }, 'adm'), /maqsad noto'g'ri/);
  await assert.rejects(svc.save('d1', { rules: { YOQ: 'SELF' } }, 'adm'), /topilmadi/);
  await svc.save('d1', { rules: { G: 'dep:d2', G2: 'TAX_FREE' } }, 'adm');
  v = await svc.view('d1', '2026-01', '2026-02');
  assert.deepStrictEqual([C('G1').effective.label, C('G1').effective.origin, C('G2').effective.label, C('G2').effective.origin], ['IT', 'parent', 'Tax free', 'dep']);
  assert.deepStrictEqual([v.totals.staysTiyin, v.totals.movedOutTiyin], ['0', '150']);
  const v2 = await svc.view('d2', '2026-01', '2026-02');
  assert.deepStrictEqual([v2.totals.incomingTiyin, v2.totals.resultTiyin, v2.incoming[0].fromLabel], ['100', '130', 'AUP'], "IT ga AUP dan kelgani (Aloqa — Tax free'ga)");
  // Routing: hisobotlarda ham
  const routing = policyRouting(await readPolicy(db.client), T.category);
  assert.strictEqual(routing.depOf({ categoryCode: 'G1', departmentId: 'd1' }), 'd2');
  assert.deepStrictEqual(routing.route({ categoryCode: 'G2', regionCode: 0, departmentId: 'd1', segment: null }), { key: 's:TAX_FREE', origin: 'unit' });
  assert.strictEqual(routing.route({ categoryCode: 'G1', regionCode: 0, departmentId: 'd1', segment: null }), null, 'Markazda qoladi');
  // Markaz (bo'limsiz) va qaytarish
  await svc.save('d1', { rules: { G1: 'CENTER' } }, 'adm');
  assert.strictEqual(policyRouting(await readPolicy(db.client), T.category).depOf({ categoryCode: 'G1', departmentId: 'd1' }), null);
  await svc.save('d1', { rules: {} }, 'adm');
  list = await svc.list('2026-01', '2026-02');
  assert.deepStrictEqual([L('d1').staysTiyin, L('d1').rules], ['150', 0], 'qoidasiz — hammasi joyida');

  // Yo'nalish bo'limlari (Tax free …) — ro'yxatga kirmaydi
  T.department.push({ id: 'd9', name: 'Tax free bo‘limi', isActive: true, index: 9 });
  const svc2 = new DepPolicyService(db.client, new AuditService(db.client), { segmentDepartmentIds: async () => new Set(['d9']) });
  const l2 = await svc2.list('2026-01', '2026-02');
  assert.ok(!l2.some((d) => d.id === 'd9') && l2.some((d) => d.id === 'd1'), 'yo‘nalish bo‘limi chiqarildi');
  assert.ok(!(await svc2.view('d1', '2026-01', '2026-02')).targets.some((t) => t.code === 'dep:d9'));

  console.log('OK t-dep-policy');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
