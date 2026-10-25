// Umumiy vedomost bo'limlar bilan birga: bo'limga yuklanganlar olinmaydi (ogohlantirish), bo'lim xodimlari o'z bo'limiga
// avtomatik yoziladi, bo'limni o'zgartirish / olib tashlash, bekor qilish va almashtirish. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { PayrollService } = require('../dist/modules/payroll/payroll.service');
const { PayrollPlanService } = require('../dist/modules/payroll/payroll-plan.service');
const { UnitPayrollService } = require('../dist/modules/unit-payroll/unit-payroll.service');

const db = fakeDb();
const T = db.tables;
const P = { A: '31111111111111', B: '32222222222222', C: '33333333333333', D: '34444444444444', E: '35555555555555', F: '36666666666666' };
T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
T.region.push({ code: 0, name: 'Markaz', isActive: true }, { code: 3, name: 'Andijon viloyati', isActive: true });
T.department.push({ id: 'dB', name: 'Buxgalteriya', index: 1 }, { id: 'dT', name: '"Tax free" filiali', index: 2 });
T.category.push({ code: 'PAYROLL_BASE', label: 'Ish haqi', parentCode: null, isLeaf: true, isActive: true });
const emp = (pinfl, fullName, regionCode, departmentId) =>
  T.employee.push({ pinfl, fullName, lastName: fullName.split(' ')[0], firstName: 'X', regionCode, departmentId, districtId: null, position: null, employmentType: 'SHTAT', isActive: true, hiredAt: null, firedAt: null });
emp(P.A, 'Aliyev Ali', 0, 'dB'); // Markaz — umumiy
emp(P.B, 'Botirov Bobur', 0, 'dT'); // Tax free bo'limida (Xodimlar bazasi)
emp(P.C, 'Comilova Charos', 3, null); // hudud — umumiy
emp(P.F, 'Fayzullayev Farrux', 0, 'dT'); // Tax free — bo'limga allaqachon yuklangan
// D — reestrda yo'q, Fermer bo'limining o'z ro'yxatida; E — hech qayerda yo'q
T.setting.push({ key: 'unit.staff', value: { FERMER: [{ pinfl: P.D, fullName: 'Dilshodov Doston', position: 'Buxgalter', active: true, addedAt: '2026-01-01T00:00:00Z', source: 'MANUAL', leftAt: null }] } });

const audit = new AuditService(db.client);
const up = new UnitPayrollService(db.client, audit);
const pay = new PayrollService(db.client, undefined, up);
const plans = new PayrollPlanService(db.client, pay, up, audit);
const PER = '2026-03';
const som = (n) => String(n * 100);

async function file(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Ish haqi');
  ws.addRow(['PINFL', 'Summa']);
  for (const [p, s] of rows) ws.addRow([p, s]);
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), originalname: 'umumiy.xlsx' };
}
const live = (where) => T.expense.filter((e) => !e.deletedAt && Object.entries(where).every(([k, v]) => e[k] === v));
const unitBatches = (unit) => T.setting.find((s) => s.key === `unit.payroll.${unit}.${PER}`)?.value?.batches ?? [];

(async () => {
  // ── 0. Tax free bo'limiga avval qo'lda yuklangan: F ──
  await up.commit('TAX_FREE', PER, { rows: [{ pinfl: P.F, amountTiyin: som(500) }], fileName: 'taxfree.xlsx' }, false, 'adm');
  assert.strictEqual(live({ segment: 'TAX_FREE' }).length, 1);

  // ── 1. Umumiy vedomost tahlili ──
  const a = await plans.analyze(PER, await file([[P.A, 100], [P.B, 200], [P.C, 300], [P.D, 400], [P.E, 50], [P.F, 600]]));
  const row = (p) => a.rows.find((r) => r.pinfl === p);
  assert.deepStrictEqual(
    [P.A, P.B, P.C, P.D, P.E, P.F].map((p) => row(p).target),
    ['GENERAL', 'TAX_FREE', 'GENERAL', 'FERMER', 'SKIP', 'SKIP'],
    'taklif: umumiy, bo\'limlarga avtomatik, topilmagan va avval yuklangan — olinmaydi',
  );
  assert.deepStrictEqual(row(P.F).locked, { unit: 'TAX_FREE', label: 'Tax free', amountTiyin: som(500) });
  assert.match(row(P.F).problem, /Tax free bo'limiga shu oy yuklangan/);
  assert.match(row(P.E).problem, /Miyada ham, katta jadvallarda .* ham yo'q/);
  assert.strictEqual(row(P.D).fullName, 'Dilshodov Doston', "F.I.Sh. bo'lim ro'yxatidan");
  assert.strictEqual(row(P.B).unitNow, 'TAX_FREE');
  const S = a.summary;
  assert.deepStrictEqual([S.general.count, S.general.totalTiyin], [2, som(400)]);
  assert.deepStrictEqual(S.units.filter((u) => u.count).map((u) => [u.unit, u.count, u.totalTiyin]), [['TAX_FREE', 1, som(200)], ['FERMER', 1, som(400)]]);
  assert.deepStrictEqual(S.locked.byUnit, [{ unit: 'TAX_FREE', label: 'Tax free', count: 1, fileTiyin: som(600), uploadedTiyin: som(500) }], 'ogohlantirish: qaysi bo\'limda, nechta, qancha');
  assert.deepStrictEqual([S.skipped.count, S.changed, S.blocking], [1, 0, 0]);

  // ── 2. O'zgartirish: B → umumiyga, A — olib tashlash, C → Marksheyder; F ni majburlab bo'lmaydi ──
  const edited = a.rows.map((r) => ({ pinfl: r.pinfl, amountTiyin: r.amountTiyin, target: { [P.A]: 'SKIP', [P.B]: 'GENERAL', [P.C]: 'MARKSHEYDER', [P.F]: 'GENERAL' }[r.pinfl] ?? r.target, fullName: r.fullName }));
  const pv = await plans.plan(PER, edited);
  assert.strictEqual(pv.rows.find((r) => r.pinfl === P.F).target, 'SKIP', 'avval yuklangan — umumiyga o\'tkazib bo\'lmaydi');
  assert.deepStrictEqual([pv.summary.general.count, pv.summary.general.totalTiyin, pv.summary.changed], [1, som(200), 3]);
  // E ni bo'limga — F.I.Sh. kerak
  const withE = edited.map((r) => (r.pinfl === P.E ? { ...r, target: 'FERMER' } : r));
  assert.strictEqual((await plans.plan(PER, withE)).summary.blocking, 1);
  await assert.rejects(plans.commit(PER, { rows: withE, fileName: 'umumiy.xlsx' }, false, 'adm'), /F\.I\.Sh\. noma'lum/);

  // ── 3. Saqlash ──
  const res = await plans.commit(PER, { rows: edited, fileName: 'umumiy.xlsx' }, false, 'adm');
  assert.ok(res.general && res.general.employees === 1, 'umumiyga faqat B');
  assert.deepStrictEqual(res.units.map((u) => [u.unit, u.employees, u.totalTiyin]).sort(), [['FERMER', 1, som(400)], ['MARKSHEYDER', 1, som(300)]]);
  assert.deepStrictEqual([res.skipped, res.locked, res.moved], [2, 1, 2]);
  // Xarajatlar: umumiy — faqat B (Markaz, Tax free filiali bo'limi); bo'limlar — o'z yo'nalishida
  const gen = T.expense.filter((e) => !e.deletedAt && e.source === 'PAYROLL');
  assert.strictEqual(gen.reduce((s, e) => s + e.amountTiyin, 0n), 20000n);
  assert.strictEqual(live({ segment: 'FERMER' })[0].amountTiyin, 40000n);
  assert.strictEqual(live({ segment: 'MARKSHEYDER' })[0].amountTiyin, 30000n);
  assert.strictEqual(live({ segment: 'TAX_FREE' }).length, 1, "Tax free'ga faqat avvalgi qo'lda yuklash");
  const fb = unitBatches('FERMER').find((b) => b.status === 'COMMITTED');
  assert.deepStrictEqual([fb.origin, fb.generalBatchId], ['GENERAL', res.general.batchId]);
  assert.match(fb.fileName, /umumiy vedomostdan/);
  // «Miya»: B shu oydan Markazda, C — Marksheyderda
  const moves = (await up.moves()).items ?? (await up.moves());
  const mv = (Array.isArray(moves) ? moves : moves.items).map((m) => [m.pinfl, m.unit, m.from]).sort();
  assert.deepStrictEqual(mv, [[P.B, 'CENTER', PER], [P.C, 'MARKSHEYDER', PER]].sort());
  // Umumiy vedomostdan yozilgan bo'lim yuklashlari «bo'limga yuklangan» hisoblanmaydi
  assert.ok(!(await up.uploadedIn(PER)).has(P.D));

  // ── 4. Keyin Tax free sahifasiga B bilan yuklansa — B umumiyda bor, olinmaydi ──
  const ua = await up.analyze('TAX_FREE', PER, await file([[P.B, 999]]).then((f) => ({ ...f, originalname: 'tf.xlsx' })));
  assert.strictEqual(ua.inGeneralRows, 1);
  assert.strictEqual(ua.totalTiyin, '0');
  await assert.rejects(up.commit('TAX_FREE', PER, { rows: [{ pinfl: P.B, amountTiyin: som(999) }] }, false, 'adm'), /hamma xodimlar \(1\) shu oy umumiy vedomostda bor/);
  const mix = await up.commit('TAX_FREE', PER, { rows: [{ pinfl: P.B, amountTiyin: som(999) }, { pinfl: P.F, amountTiyin: som(10) }] }, false, 'adm');
  assert.strictEqual(mix.skippedInGeneral, 1);
  // To'g'ridan-to'g'ri umumiy vedomostga F — rad (bo'limda bor)
  await assert.rejects(pay.commit({ period: PER, rows: [{ pinfl: P.F, amountTiyin: 100n }], userId: 'adm', replacePrevious: false, fileName: 'x.xlsx', missing: [] }), /bo'limlarda .* allaqachon yuklangan/);

  // ── 5. Almashtirish: avvalgi umumiy va undan bo'limlarga yozilganlar bekor, yangisi yoziladi ──
  const a2 = await plans.analyze(PER, await file([[P.B, 250], [P.C, 350], [P.D, 450]]));
  assert.strictEqual(a2.rows.find((r) => r.pinfl === P.C).target, 'MARKSHEYDER', "ko'chish eslab qolindi");
  assert.strictEqual(a2.rows.find((r) => r.pinfl === P.B).target, 'GENERAL');
  const r2 = await plans.commit(PER, { rows: a2.rows, fileName: 'umumiy-2.xlsx' }, true, 'adm');
  assert.ok(r2.general.replacedPrevious);
  assert.deepStrictEqual(live({ segment: 'FERMER' }).map((e) => e.amountTiyin), [45000n], 'eski Fermer yozuvi bekor, yangisi');
  assert.deepStrictEqual(live({ segment: 'MARKSHEYDER' }).map((e) => e.amountTiyin), [35000n]);
  assert.strictEqual(T.expense.filter((e) => !e.deletedAt && e.source === 'PAYROLL').reduce((s, e) => s + e.amountTiyin, 0n), 25000n);

  // ── 6. Umumiy yuklash bekor qilinsa — bo'limlarga yozilganlar ham ──
  const c = await pay.cancel(r2.general.batchId);
  assert.strictEqual(c.unitBatchesCancelled, 2);
  assert.strictEqual(live({ segment: 'FERMER' }).length + live({ segment: 'MARKSHEYDER' }).length, 0);
  assert.strictEqual(live({ segment: 'TAX_FREE' }).length, 2, "qo'lda yuklanganlar o'z joyida");

  // ── 7. Hammasi bo'limlarga tushsa — umumiy yuklash yaratilmaydi ──
  const a3 = await plans.analyze(PER, await file([[P.D, 70]]));
  const r3 = await plans.commit(PER, { rows: a3.rows, fileName: 'faqat-fermer.xlsx' }, false, 'adm');
  assert.strictEqual(r3.general, null);
  assert.deepStrictEqual(live({ segment: 'FERMER' }).map((e) => e.amountTiyin), [7000n]);
  await assert.rejects(plans.commit(PER, { rows: a3.rows.map((r) => ({ ...r, target: 'SKIP' })) }, false, 'adm'), /Saqlanadigan xodim yo'q/);
  console.log('OK t-payroll-plan');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});