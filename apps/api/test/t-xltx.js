// .xltx (Excel shabloni) ham o'qiladi: soliq hisoboti, umumiy ish haqi, bo'lim ish haqi, ish haqi tarkibi.
// .xltx — .xlsx bilan bir xil tuzilma, faqat [Content_Types].xml da «template.main». TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { PayrollService } = require('../dist/modules/payroll/payroll.service');
const { PayrollPlanService } = require('../dist/modules/payroll/payroll-plan.service');
const { UnitPayrollService } = require('../dist/modules/unit-payroll/unit-payroll.service');
const { SalaryCompositionService } = require('../dist/modules/salary-composition/salary-composition.service');
const { assertSafeXlsx } = require('../dist/common/files/xlsx-guard');

const A = '61111111111111';
const B = '62222222222222';

/** Ish kitobini .xltx ga aylantiradi */
async function asXltx(wb, name) {
  const zip = await JSZip.loadAsync(await wb.xlsx.writeBuffer());
  const ct = await zip.file('[Content_Types].xml').async('string');
  assert.ok(ct.includes('spreadsheetml.sheet.main+xml'));
  zip.file('[Content_Types].xml', ct.replace('spreadsheetml.sheet.main+xml', 'spreadsheetml.template.main+xml'));
  return { buffer: await zip.generateAsync({ type: 'nodebuffer' }), originalname: name };
}

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  T.region.push({ code: 0, name: 'Markaz', isActive: true });
  T.department.push({ id: 'd1', name: 'AUP', index: 1, isActive: true });
  T.category.push({ code: 'PAYROLL_BASE', label: 'Ish haqi', parentCode: null, isLeaf: true, isActive: true });
  for (const [p, n] of [[A, 'Sinov Bir'], [B, 'Sinov Ikki']]) T.employee.push({ pinfl: p, fullName: n, lastName: n.split(' ')[1], firstName: 'S', regionCode: 0, departmentId: 'd1', districtId: null, position: null, employmentType: 'SHTAT', isActive: true, hiredAt: null, firedAt: null });
  const audit = new AuditService(db.client);
  const up = new UnitPayrollService(db.client, audit);
  const pay = new PayrollService(db.client, undefined, up);
  const plans = new PayrollPlanService(db.client, pay, up, audit);

  // ── 1. Oddiy vedomost (PINFL, Summa) .xltx ──
  const v = new ExcelJS.Workbook();
  const vs = v.addWorksheet('Ish haqi');
  vs.addRow(['PINFL', 'Summa']);
  vs.addRow([A, 1_000_000]);
  vs.addRow([B, 2_000_000]);
  const vf = await asXltx(v, 'ish-haqi.xltx');
  await assertSafeXlsx(vf.buffer);
  const a = await plans.analyze('2026-03', vf);
  assert.strictEqual(a.summary.totalTiyin, String(300_000_000));

  // ── 2. Soliq hisoboti (4-ilova) .xltx ──
  const n = new ExcelJS.Workbook();
  const ns = n.addWorksheet('list01');
  ns.getCell('C10').value = 'Жисмоний шахснинг Ф.И.Ш.';
  ns.getCell('E10').value = 'ЖШ ШИР';
  ns.getCell('L10').value = 'Жами ҳисобланган меҳнатга ҳақ тўлаш тарзидаги даромадлар';
  ns.getCell('M10').value = 'шундан, ҳисобот даврида ҳисобланган меҳнатга ҳақ тўлаш тарзидаги даромадлар';
  [[A, 'Sinov Bir', 3_000_000, 1_100_000], [B, 'Sinov Ikki', 6_000_000, 2_200_000]].forEach(([p, nm, cum, m], i) => {
    ns.getCell(`C${15 + i}`).value = nm;
    ns.getCell(`E${15 + i}`).value = p;
    ns.getCell(`L${15 + i}`).value = cum;
    ns.getCell(`M${15 + i}`).value = m;
  });
  const nf = await asXltx(n, 'NDFL_mart_2026.xltx');
  const b = await plans.analyze('2026-03', nf, 'ndfl');
  assert.ok(b.ndfl, 'soliq hisoboti tanildi');
  assert.strictEqual(b.summary.totalTiyin, String(330_000_000), 'faqat hisobot davri summasi');

  // ── 3. Bo'lim ish haqi (Tax free) .xltx ──
  T.setting.push({ key: 'unit.staff', value: { TAX_FREE: [{ pinfl: A, fullName: 'Sinov Bir', position: null, active: true, addedAt: '2026-01-01T00:00:00Z', source: 'MANUAL', leftAt: null }] } });
  const u = await up.analyzeMany('TAX_FREE', '2026-03', vf);
  assert.strictEqual(u.months[0].rows.length, 2);
  const un = await up.analyzeMany('TAX_FREE', '2026-03', nf, 'ndfl');
  assert.strictEqual(un.format, 'NDFL');

  // ── 4. Ish haqi tarkibi (notanish shakl) .xltx ──
  const c = new ExcelJS.Workbook();
  const cs = c.addWorksheet('Tarkib');
  cs.addRow(['F.I.Sh.', 'PINFL', 'Oklad', "Ta'til puli", 'Jami']);
  cs.addRow(['Sinov Bir', A, 800_000, 200_000, 1_000_000]);
  cs.addRow(['Sinov Ikki', B, 2_000_000, 0, 2_000_000]);
  const svc = new SalaryCompositionService(db.client, { regroup: async () => null });
  await svc.onModuleInit();
  T.salaryComponent.forEach((x) => (x.isActive = true));
  const comp = await svc.analyze('2026-03', await asXltx(c, 'tarkib.xltx'));
  assert.strictEqual(comp.validRows, 2);
  assert.strictEqual(comp.rows.find((r) => r.pinfl === A).totalTiyin, String(100_000_000));

  console.log('OK t-xltx');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});