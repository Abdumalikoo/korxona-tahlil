// Soliq hisoboti (JShDS 4 va 5-ilova) — to'g'ridan-to'g'ri o'qish: faqat «hisobot davrida» ustunlari (o'sib boruvchi
// «jami» emas), ikkala ilova PINFL bo'yicha qo'shiladi, to'g'rilangan PINFL, umumiy vedomost va bo'limlarga taqsimot.
// TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { PayrollService } = require('../dist/modules/payroll/payroll.service');
const { PayrollPlanService } = require('../dist/modules/payroll/payroll-plan.service');
const { UnitPayrollService } = require('../dist/modules/unit-payroll/unit-payroll.service');
const { parseNdfl, isNdflWorkbook, periodFromName } = require('../dist/modules/payroll/ndfl.parser');

const P = { A: '41111111111111', B: '42222222222222', C: '43333333333333', D: '44444444444444', X: '49999999999999', W: '40000000000001' };

/** Haqiqiy hisobot tuzilishi: sarlavha 10–11 qator (birlashtirilgan), 12 — ЖАМИ, 13 — ustun raqamlari, 14 — izoh, 15+ — xodimlar */
function sheet01(wb, rows) {
  const ws = wb.addWorksheet('list01');
  ws.getCell('AS3').value = 'Жисмоний шахслардан олинадиган даромад солиғи ва ижтимоий солиқ Ҳисоб-китобига 4-илова';
  const h = { B: 'Т/р', C: 'Жисмоний шахснинг Ф.И.Ш.', D: 'Лавозими', E: 'ЖШ ШИР', G: 'Жисмоний шахс тури', J: 'Иш вақти', L: 'Жами ҳисобланган меҳнатга ҳақ тўлаш тарзидаги даромадлар', M: 'шундан, ҳисобот даврида ҳисобланган меҳнатга ҳақ тўлаш тарзидаги даромадлар', N: 'Жисмоний шахслардан олинадиган даромад солиғи', P: 'Имтиёз рақами \nЖисмоний шахсларнинг солиқ солишдан озод этилган даромадлари', AT: 'Текст ошибки', AW: 'Правильный ПИНФЛ' };
  for (const [c, v] of Object.entries(h)) ws.getCell(`${c}10`).value = v;
  for (const c of ['B', 'C', 'D', 'E', 'G', 'J', 'L', 'M']) ws.mergeCells(`${c}10:${c}11`);
  ws.mergeCells('N10:O10');
  ws.mergeCells('P10:AS10');
  ws.getCell('N11').value = 'Жами ҳисобланган солиқ \nсуммаси';
  ws.getCell('O11').value = 'шундан, ҳисобот \nдаврида  \nҳисобланган солиқ \nсуммаси';
  ws.getCell('Q11').value = 'Жами солиққа тортилмайдиган меҳнатга ҳақ тўлаш тарзидаги даромадлар';
  ws.getCell('R11').value = 'шундан, ҳисобот даврида солиққа тортилмайдиган меҳнатга ҳақ тўлаш тарзидаги даромадлар';
  ws.getCell('K12').value = 'ЖАМИ';
  ws.getCell('M12').value = { formula: 'SUM(M15:M60000)' };
  for (let i = 2; i <= 17; i++) ws.getCell(13, i).value = i - 1;
  ws.mergeCells('C14:AV14');
  ws.getCell('C14').value = "Izoh qatori (birlashtirilgan)";
  let r = 15;
  for (const x of rows) {
    ws.getCell(`B${r}`).value = r - 14;
    ws.getCell(`C${r}`).value = x.name;
    ws.getCell(`E${r}`).value = x.pinfl;
    ws.getCell(`L${r}`).value = x.cum;
    ws.getCell(`M${r}`).value = x.month;
    ws.getCell(`N${r}`).value = Math.round(x.cum * 0.12);
    ws.getCell(`O${r}`).value = Math.round(x.month * 0.12);
    ws.getCell(`Q${r}`).value = 777; // solig'dan ozod — olinmaydi
    if (x.fixed) ws.getCell(`AW${r}`).value = x.fixed;
    r++;
  }
  return ws;
}
function sheet02(wb, rows) {
  const ws = wb.addWorksheet('list02');
  const h = { B: 'Т/р', C: 'Жисмоний шахснинг Ф.И.Ш.', D: 'ЖШ ШИР', E: 'Жисмоний шахс тури', F: 'Жами ҳисобланган даромадлар', G: 'шундан, ҳисобот даврида ҳисобланган даромадлар', H: 'Даромад тури \n(1-мулкий,\n5-бошқа)', I: 'Жисмоний шахслардан олинадиган даромад солиғи' };
  for (const [c, v] of Object.entries(h)) ws.getCell(`${c}10`).value = v;
  for (const c of ['B', 'C', 'D', 'E', 'F', 'G', 'H']) ws.mergeCells(`${c}10:${c}11`);
  ws.mergeCells('I10:J10');
  ws.getCell('I11').value = 'Жами ҳисобланган солиқ суммаси';
  ws.getCell('J11').value = 'шундан, ҳисобот даврида ҳисобланган солиқ суммаси';
  ws.mergeCells('B12:D12');
  ws.getCell('B12').value = 'ЖАМИ';
  for (let i = 2; i <= 13; i++) ws.getCell(13, i).value = i - 1;
  let r = 15;
  for (const x of rows) {
    ws.getCell(`C${r}`).value = x.name;
    ws.getCell(`D${r}`).value = x.pinfl;
    ws.getCell(`F${r}`).value = x.cum;
    ws.getCell(`G${r}`).value = x.month;
    ws.getCell(`H${r}`).value = x.type;
    ws.getCell(`J${r}`).value = Math.round(x.month * 0.12);
    r++;
  }
}

async function ndflFile(name, s1, s2) {
  const wb = new ExcelJS.Workbook();
  sheet01(wb, s1);
  if (s2) sheet02(wb, s2);
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), originalname: name };
}
const load = async (f) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(f.buffer);
  return wb;
};

(async () => {
  assert.strictEqual(periodFromName('NDFL_yanvar_2026_2.xlsx'), '2026-01');
  assert.strictEqual(periodFromName('ndfl-mart-2026.xlsx'), '2026-03');
  assert.strictEqual(periodFromName('hisobot.xlsx'), null);

  // Mart hisoboti: «jami» — yanvar–mart yig'indisi, olinmaydi; faqat mart (hisobot davri)
  const f = await ndflFile(
    'NDFL_mart_2026.xlsx',
    [
      { name: 'Aliyev Ali', pinfl: P.A, cum: 3_000_000.5, month: 1_000_000.25 },
      { name: 'Botirov Bobur', pinfl: P.B, cum: 4_500_000, month: 1_500_000 },
      { name: 'Comilova Charos', pinfl: Number(P.C), cum: 1_200_000, month: 0 }, // shu oy hisoblanmagan; PINFL son ko'rinishida
      { name: "Xato PINFLli", pinfl: P.X, cum: 600_000, month: 200_000, fixed: P.D }, // soliq idorasi to'g'rilagan
    ],
    [
      { name: 'Aliyev Ali', pinfl: P.A, cum: 900_000, month: 300_000, type: 1 }, // ham oylik, ham boshqa
      { name: 'Aliyev Ali', pinfl: P.A, cum: 100_000, month: 50_000, type: 5 }, // ikkinchi daromad — alohida qator
      { name: 'Vohidov Vali', pinfl: P.W, cum: 80_000, month: 80_000, type: 5 }, // faqat 5-ilovada
    ],
  );
  const wb = await load(f);
  assert.ok(isNdflWorkbook(wb));
  const r = parseNdfl(wb, f.originalname);
  assert.strictEqual(r.periodHint, '2026-03');
  assert.deepStrictEqual(r.invalid, [], "ЖАМИ, ustun raqamlari va izoh qatori — o'tkaziladi");
  const s1 = r.sheets.find((s) => s.name === 'list01');
  const s2 = r.sheets.find((s) => s.name === 'list02');
  assert.deepStrictEqual([s1.kind, s1.rows, s1.people, s1.monthTiyin, s1.zeroMonth, s1.corrected], ['SALARY', 4, 4, 270000025n, 1, 1]);
  assert.strictEqual(s1.cumulativeTiyin, 930000050n, "o'sib boruvchi jami — alohida (ma'lumot uchun)");
  assert.deepStrictEqual([s2.kind, s2.rows, s2.people, s2.monthTiyin], ['OTHER', 3, 2, 43000000n]);
  assert.deepStrictEqual(s2.types.map((t) => [t.code, t.rows, t.monthTiyin]), [['1', 1, 30000000n], ['5', 2, 13000000n]]);
  assert.strictEqual(r.inBoth, 1);
  const A = r.people.find((p) => p.pinfl === P.A);
  assert.deepStrictEqual([A.salaryTiyin, A.otherTiyin, A.fullName], [100000025n, 35000000n, 'Aliyev Ali'], 'oylik + boshqa daromad PINFL bo\'yicha');
  assert.ok(r.people.find((p) => p.pinfl === P.D) && !r.people.find((p) => p.pinfl === P.X), "to'g'rilangan PINFL olinadi");
  assert.strictEqual(r.people.length, 5);

  // ── Umumiy vedomost: reja va saqlash ──
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  T.region.push({ code: 0, name: 'Markaz', isActive: true }, { code: 3, name: 'Andijon viloyati', isActive: true });
  T.department.push({ id: 'dB', name: 'Buxgalteriya', index: 1 });
  T.category.push({ code: 'PAYROLL_BASE', label: 'Ish haqi', parentCode: null, isLeaf: true, isActive: true });
  const emp = (pinfl, fullName, regionCode, departmentId) =>
    T.employee.push({ pinfl, fullName, lastName: fullName.split(' ')[0], firstName: 'X', regionCode, departmentId, districtId: null, position: null, employmentType: 'SHTAT', isActive: true, hiredAt: null, firedAt: null });
  emp(P.A, 'Aliyev Ali', 0, 'dB');
  emp(P.B, 'Botirov Bobur', 3, null);
  emp(P.C, 'Comilova Charos', 3, null);
  emp(P.D, 'Dilshodov Doston', 0, 'dB');
  // W — reestrda yo'q, Fermer bo'limi ro'yxatida (ismi soliq hisobotidan olinadi)
  T.setting.push({ key: 'unit.staff', value: { FERMER: [{ pinfl: P.W, fullName: 'Vohidov Vali', position: null, active: true, addedAt: '2026-01-01T00:00:00Z', source: 'MANUAL', leftAt: null }] } });
  const audit = new AuditService(db.client);
  const up = new UnitPayrollService(db.client, audit);
  const pay = new PayrollService(db.client, undefined, up);
  const plans = new PayrollPlanService(db.client, pay, up, audit);

  // Oddiy shablon «faqat soliq hisoboti» rejimida — rad
  const plain = new ExcelJS.Workbook();
  plain.addWorksheet('Ish haqi').addRow(['PINFL', 'Summa']);
  plain.getWorksheet('Ish haqi').addRow([P.A, 100]);
  await assert.rejects(plans.analyze('2026-03', { buffer: Buffer.from(await plain.xlsx.writeBuffer()), originalname: 'x.xlsx' }, 'ndfl'), /soliq hisoboti emas/);

  const a = await plans.analyze('2026-03', f, 'ndfl');
  assert.ok(a.ndfl && !a.ndfl.periodMismatch);
  assert.deepStrictEqual([a.ndfl.people, a.ndfl.inBoth, a.ndfl.salaryTiyin, a.ndfl.otherTiyin], [5, 1, 270000025n, 43000000n]);
  const row = (p) => a.rows.find((x) => x.pinfl === p);
  assert.strictEqual(row(P.A).amountTiyin, '135000025', 'oylik 1 000 000,25 + boshqa 350 000');
  assert.deepStrictEqual(row(P.A).parts, { salaryTiyin: '100000025', otherTiyin: '35000000' });
  assert.strictEqual(row(P.C).amountTiyin, '0');
  assert.deepStrictEqual([row(P.W).target, row(P.W).fullName], ['FERMER', 'Vohidov Vali'], "reestrda yo'q bo'lim xodimi — ismi hisobotdan");
  assert.strictEqual(a.summary.blocking, 0);
  // Boshqa oy tanlangan — ogohlantirish
  assert.ok((await plans.analyze('2026-04', f, 'ndfl')).ndfl.periodMismatch);

  const c = await plans.commit('2026-03', { rows: a.rows, fileName: a.fileName }, false, 'adm');
  assert.strictEqual(c.general.employees, 4);
  assert.strictEqual(c.general.totalTiyin, String(135000025n + 150000000n + 0n + 20000000n));
  assert.deepStrictEqual(c.units.map((u) => [u.unit, u.employees, u.totalTiyin]), [['FERMER', 1, '8000000']]);
  const exp = T.expense.filter((e) => !e.deletedAt && e.categoryCode === 'PAYROLL_BASE' && e.payrollBatchId);
  assert.strictEqual(exp.reduce((s, e) => s + e.amountTiyin, 0n), 305000025n, 'umumiy vedomost xarajatlari = shu oy jami (o\'sib boruvchi emas)');

  // ── Bo'lim sahifasida (Tax free): faqat shu bo'lim xodimlari olinadi ──
  const db2 = fakeDb();
  const T2 = db2.tables;
  T2.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  T2.region.push({ code: 0, name: 'Markaz', isActive: true });
  T2.category.push({ code: 'PAYROLL_BASE', label: 'Ish haqi', parentCode: null, isLeaf: true, isActive: true });
  T2.employee.push({ pinfl: P.A, fullName: 'Aliyev Ali', lastName: 'Aliyev', firstName: 'Ali', regionCode: 0, departmentId: null, districtId: null, position: null, employmentType: 'SHTAT', isActive: true, hiredAt: null, firedAt: null });
  T2.setting.push({ key: 'unit.staff', value: {
    TAX_FREE: [{ pinfl: P.B, fullName: 'Botirov Bobur', position: null, active: true, addedAt: '2026-01-01T00:00:00Z', source: 'MANUAL', leftAt: null }],
    FERMER: [{ pinfl: P.W, fullName: 'Vohidov Vali', position: null, active: true, addedAt: '2026-01-01T00:00:00Z', source: 'MANUAL', leftAt: null }],
  } });
  const up2 = new UnitPayrollService(db2.client, new AuditService(db2.client));
  const plainU = new ExcelJS.Workbook();
  plainU.addWorksheet('Ish haqi').addRow(['PINFL', 'Summa']);
  await assert.rejects(up2.analyzeMany('TAX_FREE', '2026-03', { buffer: Buffer.from(await plainU.xlsx.writeBuffer()), originalname: 'x.xlsx' }, 'ndfl'), /soliq hisoboti emas/);
  const u = await up2.analyzeMany('TAX_FREE', '2026-03', f);
  assert.strictEqual(u.format, 'NDFL', "oddiy yuklashda ham taniladi");
  const m = u.months[0];
  assert.strictEqual(m.period, '2026-03');
  // B — bo'lim xodimi; C, D — reestrda ham, boshqa bo'limda ham yo'q (yangi); A — reestrda (Markaz), W — Fermer — olinmaydi
  assert.deepStrictEqual(m.rows.map((r) => r.pinfl).sort(), [P.B, P.C, P.D].sort());
  assert.deepStrictEqual([u.ndfl.outside, u.ndfl.outsideTiyin], [2, String(135000025n + 8000000n)]);
  assert.strictEqual(m.rows.find((r) => r.pinfl === P.D).fullName, 'Xato PINFLli', 'ismi hisobotdan');
  const c2 = await up2.commit('TAX_FREE', '2026-03', { rows: m.rows.map((r) => ({ pinfl: r.pinfl, amountTiyin: r.amountTiyin, fullName: r.fullName })), fileName: u.fileName }, false, 'adm');
  assert.strictEqual(c2.totalTiyin, String(150000000n + 0n + 20000000n));
  console.log('OK t-ndfl');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});