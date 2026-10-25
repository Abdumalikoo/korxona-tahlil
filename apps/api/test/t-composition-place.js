// Ish haqi tarkibi › «Tarkibdagi bo'limlar»: bo'lim nomini o'qish («Hududi»), bizdagi bo'limga moslash (taklif, eslab
// qolish), «miya» bilan farq; belgilanganlarning joyi FAQAT SHU OY tarkibdagidek (yo'nalish — ko'chish + keyingi oydan
// qaytish; Markaz ichida — shu oy bo'limi), umumiy vedomost qayta taqsimlanadi; bekor qilish. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { PayrollService } = require('../dist/modules/payroll/payroll.service');
const { PayrollPlanService } = require('../dist/modules/payroll/payroll-plan.service');
const { UnitPayrollService } = require('../dist/modules/unit-payroll/unit-payroll.service');
const { SalaryCompositionService } = require('../dist/modules/salary-composition/salary-composition.service');
const { CompositionPlaceService, deptScore, matchDepartment, deptKey } = require('../dist/modules/salary-composition/salary-composition.place');

// ── Nomlarni moslash (bo'lim nomlari — tashkilot ma'lumotnomasi, shaxsiy emas) ──
const DEPS = ['AUP', 'Strategiya', 'Korporativ boshqaruv', 'Kompleans', 'Yurist', 'Kadrlar', 'Ichki audit', 'Buxgalteriya hisobi bo‘limi', 'Soliq to‘lovchilarga buxgalteriya xizmatlarini ko‘rsatish bo‘limi', 'Soliq to‘lovchilarga xizmat ko‘rsatish markazi', 'Fermer xo‘jaliklariga xizmat ko‘rsatish', 'Fermer xo‘jaliklariga xizmat ko‘rsatishni muvofiqlashtirish (hudud)', 'Hududlarni muvofiqlashtirish', 'Dasturiy mahsulotlar', 'Dasturiy mahsulotlarni muvofiqlashtirish bo‘yicha loyiha menejerlari sho‘basi', 'Raqamli texnologiyalar xalqaro markazi', 'Axborot xizmati', 'To‘lov tizimi va marketing', 'Bozor narxi', 'Marksheyder', 'Tax free', 'Call markaz', 'Murojaatlar bilan ishlash va ijro nazorati', 'Xaridlar va xo‘jalik ishlari bo‘yicha', 'Texnik xodimlar'].map((name, i) => ({ id: `x${i}`, name }));
const pick = (n) => DEPS.find((d) => d.id === matchDepartment(n, DEPS)?.id)?.name ?? null;
assert.strictEqual(pick('AUP'), 'AUP');
assert.strictEqual(pick('Call markaz'), 'Call markaz');
assert.strictEqual(pick('Kadr'), 'Kadrlar', 'qisqartirilgan');
assert.strictEqual(pick('Dasturiy mahsullar'), 'Dasturiy mahsulotlar');
assert.strictEqual(pick('Дастурий мах.ни мувоф-риш бўйича лойиха мен-лари ш'), 'Dasturiy mahsulotlarni muvofiqlashtirish bo‘yicha loyiha menejerlari sho‘basi', 'kirill, qisqartma');
assert.strictEqual(pick('Xududlarni muvofiqlashtirish'), 'Hududlarni muvofiqlashtirish', 'x = h');
assert.strictEqual(pick("Soliq to'lovchilarga buxgalteriya xizmatlarini ko'"), 'Soliq to‘lovchilarga buxgalteriya xizmatlarini ko‘rsatish bo‘limi', 'kesilgan');
assert.strictEqual(pick("Fermer xo'jaliklariga xizmat ko'rsatishni muvofiql"), 'Fermer xo‘jaliklariga xizmat ko‘rsatishni muvofiqlashtirish (hudud)');
assert.strictEqual(pick("Fermer xo'jaliklariga xizmat ko'rsatish"), 'Fermer xo‘jaliklariga xizmat ko‘rsatish');
assert.strictEqual(pick("Buxgalteriya hisobi bo'limi"), 'Buxgalteriya hisobi bo‘limi');
assert.strictEqual(pick('Moliya-iqtisod'), null, "o'xshashi yo'q");
assert.strictEqual(deptKey("Buxgalteriya hisobi bo'limi"), deptKey('Buxgalteriya hisobi'));
assert.ok(deptScore('Tax free', 'Tax free') === 1);

const P = { A: '41111111111111', B: '42222222222222', C: '43333333333333', D: '44444444444444' };
const PER = '2026-02';
const so = (n) => BigInt(Math.round(n * 100));

async function tarkib(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Fevral');
  ws.addRow(['№', 'ПИНФЛ', 'ФИО', 'Hududi', 'Oklad', 'Jami']);
  rows.forEach((r, i) => ws.addRow([i + 1, r.pinfl, r.name, r.dept, r.sum, r.sum]));
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), originalname: 'tarkib-fevral.xlsx' };
}

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  T.region.push({ code: 0, name: 'Markaz', isActive: true });
  T.category.push({ code: 'PAYROLL_BASE', label: 'Ish haqi', parentCode: null, isLeaf: true, isActive: true });
  T.department.push({ id: 'dA', name: 'AUP', index: 1, isActive: true }, { id: 'dC', name: 'Call markaz', index: 2, isActive: true }, { id: 'dT', name: 'Tax free', index: 3, isActive: true }, { id: 'dK', name: 'Kadrlar', index: 4, isActive: true });
  const emp = (pinfl, fullName, departmentId) => T.employee.push({ pinfl, fullName, lastName: fullName.split(' ')[0], firstName: 'S', regionCode: 0, departmentId, districtId: null, position: null, employmentType: 'SHTAT', isActive: true, hiredAt: null, firedAt: null });
  emp(P.A, 'Alfa Kochgan', 'dT'); // miyada — Tax free (bo'limi orqali); fevralda Call markazda ishlagan
  emp(P.B, 'Beta Kadrov', 'dA'); // miyada — AUP; fevralda Kadrlarda
  emp(P.C, 'Gamma Joyida', 'dC'); // mos
  emp(P.D, 'Delta Moliyachi', 'dA'); // tarkibda «Moliya-iqtisod» — tanilmagan

  const audit = new AuditService(db.client);
  const units = new UnitPayrollService(db.client, audit);
  const pay = new PayrollService(db.client, undefined, units);
  const plan = new PayrollPlanService(db.client, pay, units, audit);
  const comp = new SalaryCompositionService(db.client, pay, units);
  await comp.onModuleInit();
  T.salaryComponent.forEach((x) => (x.isActive = true));
  const places = new CompositionPlaceService(db.client, audit, units, pay, plan);

  // Umumiy vedomost (soliq hisoboti) fevral — A Tax free'ga (miya bo'yicha) tushadi
  const fileRows = [[P.A, 1_000_000], [P.B, 2_000_000], [P.C, 3_000_000], [P.D, 4_000_000]];
  const payRows = fileRows.map(([p, s]) => ({ pinfl: p, amountTiyin: String(so(s)), fullName: T.employee.find((e) => e.pinfl === p).fullName }));
  await plan.commit(PER, { rows: payRows, fileName: 'soliq-fevral.xlsx' }, true, 'adm');
  const live = (w) => T.expense.filter((e) => !e.deletedAt && e.period === PER && Object.entries(w).every(([k, v]) => e[k] === v));
  assert.strictEqual(live({ segment: 'TAX_FREE' }).reduce((s, e) => s + e.amountTiyin, 0n), so(1_000_000), 'avval — A Tax free ish haqida');
  assert.ok(!live({ departmentId: 'dC' }).some((e) => e.amountTiyin === so(1_000_000) + so(3_000_000)));

  // ── Tahlil ──
  const f = await tarkib([
    { pinfl: P.A, name: 'Alfa Kochgan', dept: 'Call markaz', sum: 1_000_000 },
    { pinfl: P.B, name: 'Beta Kadrov', dept: 'Kadr', sum: 2_000_000 },
    { pinfl: P.C, name: 'Gamma Joyida', dept: 'Call markaz', sum: 3_000_000 },
    { pinfl: P.D, name: 'Delta Moliyachi', dept: 'Moliya-iqtisod', sum: 4_000_000 },
  ]);
  const a = await comp.analyze(PER, f);
  assert.deepStrictEqual(a.deptColumn, { letter: 'D', label: 'Hududi' });
  assert.deepStrictEqual(a.rows.map((r) => r.deptName), ['Call markaz', 'Kadr', 'Call markaz', 'Moliya-iqtisod']);
  const pa = await places.analyze(PER, a.rows.map((r) => ({ pinfl: r.pinfl, fullName: r.fullName, deptName: r.deptName })), a.deptColumn);
  const dep = (n) => pa.departments.find((d) => d.name === n);
  assert.deepStrictEqual([dep('Call markaz').count, dep('Call markaz').departmentId, dep('Call markaz').source, dep('Call markaz').exact], [2, 'dC', 'MATCH', true]);
  assert.deepStrictEqual([dep('Kadr').departmentId, dep('Kadr').exact], ['dK', false]);
  assert.deepStrictEqual([dep('Moliya-iqtisod').departmentId, dep('Moliya-iqtisod').source], [null, 'NONE']);
  assert.strictEqual(pa.options.find((o) => o.id === 'dT').unit, 'TAX_FREE', "Tax free bo'limi — Tax free yo'nalishi");
  assert.strictEqual(pa.options.find((o) => o.id === 'dC').unit, 'CENTER');
  const mr = (p) => pa.rows.find((r) => r.pinfl === p).miya;
  assert.deepStrictEqual([mr(P.A).unit, mr(P.A).departmentId, mr(P.B).unit, mr(P.B).departmentId], ['TAX_FREE', 'dT', 'CENTER', 'dA']);

  // ── Saqlash: A — Call markaz (yo'nalish o'zgaradi), B — Kadrlar (Markaz ichida), C — farq yo'q, D — tanlanmagan ──
  const c = await comp.commit({ period: PER, fileName: 'tarkib-fevral.xlsx', userId: 'adm', rows: a.rows.map((r) => ({ pinfl: r.pinfl, fullName: r.fullName, workedDays: null, rate: null, items: new Map(Object.entries(r.items).map(([k, v]) => [k, BigInt(v)])) })) });
  const ap = await places.apply(PER, c.batchId, a.rows.map((r) => ({ pinfl: r.pinfl, fullName: r.fullName, dept: r.deptName })), { map: { 'Call markaz': 'dC', Kadr: 'dK', 'Moliya-iqtisod': 'SKIP' }, apply: [P.A, P.B, P.C, P.D] }, 'adm');
  assert.deepStrictEqual([ap.departments, ap.fixed, ap.moved, ap.redistributed], [3, 2, 1, true]);
  // «Miya»: A fevralda — Markaz, martdan — yana Tax free
  assert.strictEqual((await units.unitsAt([P.A], PER)).get(P.A), 'CENTER');
  assert.strictEqual((await units.unitsAt([P.A], '2026-03')).get(P.A), 'TAX_FREE', 'faqat shu oy');
  assert.strictEqual((await units.unitsAt([P.A], '2026-01')).get(P.A), 'TAX_FREE');
  // Xarajatlar: A — Markaz › Call markaz (C bilan birga), B — Markaz › Kadrlar; Tax free'da hech narsa qolmadi
  assert.strictEqual(live({ segment: 'TAX_FREE' }).reduce((s, e) => s + e.amountTiyin, 0n), 0n, "Tax free'dan chiqdi");
  assert.strictEqual(live({ departmentId: 'dC', categoryCode: 'PAYROLL_BASE' }).reduce((s, e) => s + e.amountTiyin, 0n), so(4_000_000));
  assert.strictEqual(live({ departmentId: 'dK', categoryCode: 'PAYROLL_BASE' }).reduce((s, e) => s + e.amountTiyin, 0n), so(2_000_000), 'B — shu oy Kadrlarda');
  assert.strictEqual(live({ departmentId: 'dA', categoryCode: 'PAYROLL_BASE' }).reduce((s, e) => s + e.amountTiyin, 0n), so(4_000_000), 'AUP — faqat D');
  assert.strictEqual(live({}).reduce((s, e) => s + e.amountTiyin, 0n), so(10_000_000), "jami o'zgarmadi");

  // Eslab qolindi: keyingi tahlilda «Kadr» — o'rgatilgan
  const pa2 = await places.analyze(PER, a.rows.map((r) => ({ pinfl: r.pinfl, fullName: r.fullName, deptName: r.deptName })), a.deptColumn);
  assert.deepStrictEqual([pa2.departments.find((d) => d.name === 'Kadr').source, pa2.departments.find((d) => d.name === 'Moliya-iqtisod').source], ['LEARNED', 'SKIPPED']);
  assert.deepStrictEqual([pa2.rows.find((r) => r.pinfl === P.B).miya.departmentId, pa2.rows.find((r) => r.pinfl === P.B).miya.fixed], ['dK', true]);

  // Ko'rish
  let v = await places.view(PER);
  assert.deepStrictEqual(v.departments.find((d) => d.name === 'Call markaz').count, 2);
  assert.deepStrictEqual(v.fixes.map((x) => [x.pinfl, x.fromUnit, x.unit, x.fromDepartmentName, x.departmentName]).sort(), [[P.A, 'TAX_FREE', 'CENTER', 'Tax free', 'Call markaz'], [P.B, 'CENTER', 'CENTER', 'AUP', 'Kadrlar']].sort());

  // ── Bitta xodimni qaytarish: A — yana Tax free ──
  const rv = await places.revert(PER, [P.A], 'adm');
  assert.deepStrictEqual([rv.reverted, rv.redistributed], [1, true]);
  assert.strictEqual((await units.unitsAt([P.A], PER)).get(P.A), 'TAX_FREE');
  assert.strictEqual(live({ segment: 'TAX_FREE' }).reduce((s, e) => s + e.amountTiyin, 0n), so(1_000_000));
  assert.strictEqual(live({ departmentId: 'dK', categoryCode: 'PAYROLL_BASE' }).reduce((s, e) => s + e.amountTiyin, 0n), so(2_000_000), 'B hali Kadrlarda');

  // ── Bo'lim sahifasi: «Manbada» va «Ish haqi tarkibida» ──
  let cmp = await places.compare(PER, 'TAX_FREE');
  let ra = cmp.rows.find((r) => r.pinfl === P.A);
  assert.ok(cmp.hasTarkib);
  assert.deepStrictEqual([ra.group, ra.status, ra.manba.unit, ra.tarkib.unit, ra.tarkib.departmentName], ['HERE', 'FARQ', 'TAX_FREE', 'CENTER', 'Call markaz']);
  assert.ok(!cmp.rows.some((r) => r.pinfl === P.C), "Tax free'ga aloqasi yo'q");
  const fx = await places.fixStored(PER, [P.A], 'adm');
  assert.deepStrictEqual([fx.fixed, fx.moved, fx.redistributed], [1, 1, true]);
  assert.strictEqual(live({ segment: 'TAX_FREE' }).reduce((s, e) => s + e.amountTiyin, 0n), 0n, "bo'lim sahifasidan o'tkazildi");
  cmp = await places.compare(PER, 'TAX_FREE');
  ra = cmp.rows.find((r) => r.pinfl === P.A);
  assert.deepStrictEqual([ra.group, ra.status, ra.manba.unit, ra.fix.unit], ['HERE', 'FIXED', 'TAX_FREE', 'CENTER'], 'manbada — asl joyi');
  const cc = await places.compare(PER, 'CENTER');
  const st = (p) => cc.rows.find((r) => r.pinfl === p);
  assert.deepStrictEqual([st(P.A).group, st(P.B).status, st(P.B).manba.departmentName, st(P.C).status, st(P.D).status, st(P.D).tarkib.skipped], ['TARKIB_HERE', 'FIXED', 'AUP', 'MOS', 'UNKNOWN', true]);
  await assert.rejects(places.fixStored(PER, [P.D], 'adm'), /belgilanmagan/);
  await assert.rejects(places.fixStored(PER, ['49999999999999'], 'adm'), /tarkibida yo'q/);
  await places.revert(PER, [P.A], 'adm');

  // ── Tarkib bekor qilindi → hamma o'zgarishlar bekor ──
  await comp.cancel(c.batchId);
  const oc = await places.onCancel(PER, 'adm');
  assert.strictEqual(oc.reverted, 1);
  assert.strictEqual(live({ departmentId: 'dK' }).length, 0);
  assert.strictEqual(live({ departmentId: 'dA', categoryCode: 'PAYROLL_BASE' }).reduce((s, e) => s + e.amountTiyin, 0n), so(6_000_000), 'B — yana AUP');
  v = await places.view(PER);
  assert.deepStrictEqual([v.fixes.length, v.departments.length], [0, 0]);
  assert.ok(!JSON.stringify(T.unitMoves ?? []).includes(P.A));
  assert.ok(T.auditLog.some((l) => l.entityType === 'composition_place'));

  // Moslik noto'g'ri bo'lim — rad
  await assert.rejects(places.apply(PER, null, [{ pinfl: P.A, fullName: 'x', dept: 'Call markaz' }], { map: { 'Call markaz': 'YOQ' }, apply: [P.A] }, 'adm'), /topilmadi/);

  console.log('OK t-composition-place');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
