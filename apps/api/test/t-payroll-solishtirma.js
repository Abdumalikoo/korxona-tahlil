// Xarajatlar › Ish haqi solishtirma: FOT − soliq (12%) − kasaba (2%, faqat asosiy shtat) = 23106.
// Shartnoma: 10 000 000 − 1 200 000 = 8 800 000; shtat: 10 000 000 − 1 200 000 − 200 000 = 8 600 000.
// Bank oyi: izohdagi «… oyi uchun» (avans shu oyda, qoldiq keyingi oyda to'lansa ham — bitta oy). TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { UnitPayrollService } = require('../dist/modules/unit-payroll/unit-payroll.service');
const { Acc23106Service } = require('../dist/modules/acc-23106/acc23106.service');
const { PayrollSolishtirmaService } = require('../dist/modules/payroll-solishtirma/payroll-solishtirma.service');

const P = { A: '91111111111111', B: '92222222222222', C: '93333333333333', D: '94444444444444', X: '90000000000001', T: '96666666666666' };
const so = (n) => BigInt(Math.round(n * 100));

async function statement(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Page 1');
  ['№\nпп', 'Дата\nдокумента', 'Дата\nобработки', '№ док', 'Наименование счёта', 'ИНН', '№ счёта', 'МФО', 'Обороты по\nдебету', 'Обороты по\nкредиту', 'Назначение платежа'].forEach((h, i) => (ws.getCell(11, i + 1).value = h));
  rows.forEach((r, i) => [i + 1, r.date, r.date, String(700 + i), 'UZCARD', r.inn, '22618000900000000009', '01158', r.debit, 0, r.purpose].forEach((v, j) => (ws.getCell(12 + i, j + 1).value = v)));
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), originalname: '23106.xlsx' };
}

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  T.region.push({ code: 0, name: 'Markaz', isActive: true }, { code: 10, name: 'Namuna viloyati', isActive: true });
  const emp = (pinfl, fullName, regionCode, employmentType) => T.employee.push({ pinfl, fullName, lastName: fullName.split(' ')[0], firstName: 'S', regionCode, departmentId: null, districtId: null, position: null, employmentType, isActive: true, hiredAt: null, firedAt: null });
  emp(P.A, 'Alfa Shtatov', 0, 'SHTAT'); // Markaz, shtat
  emp(P.B, 'Beta Shartnomov', 10, 'SHTAT'); // bazada shtat, lekin shu oy joylashuvi — shartnoma (ustun)
  emp(P.C, 'Gamma Hududov', 10, 'SHTAT'); // hudud, shtat — kasaba ushlanmagan
  emp(P.D, 'Delta Markazov', 0, 'SHTAT'); // bankda yo'q
  emp(P.T, 'Taksfri Bir', 0, 'SHTAT');
  T.employeeLocation.push({ id: 'l1', employeePinfl: P.B, period: '2026-01', regionCode: 10, districtId: null, employmentType: 'SHARTNOMA', source: 'RESULTS' });

  // FOT: tarkib (A, D), soliq hisoboti (A, B, C, D)
  T.salaryCompositionBatch.push({ id: 'cb', period: '2026-01', cancelledAt: null, createdAt: new Date() });
  T.salaryCompositionRow.push({ id: 'r1', batchId: 'cb', period: '2026-01', employeePinfl: P.A, totalTiyin: so(10_000_000) }, { id: 'r2', batchId: 'cb', period: '2026-01', employeePinfl: P.D, totalTiyin: so(5_000_000) });
  T.payrollBatch.push({ id: 'pb', period: '2026-01', status: 'COMMITTED', scope: 'ALL' });
  for (const [p, v] of [[P.A, 9_999_000], [P.B, 10_000_000], [P.C, 10_000_000], [P.D, 5_000_000]]) T.payrollEntry.push({ id: `e${p}`, employeePinfl: p, period: '2026-01', batchId: 'pb', baseTiyin: so(v), totalTiyin: so(v), bonusTiyin: 0n, deletedAt: null });

  const audit = new AuditService(db.client);
  // Tax free ish haqi vedomosti — soxta
  const unitPayroll = { payrollMap: async (u) => (u === 'TAX_FREE' ? new Map([[P.T, so(2_000_000)]]) : null), staffOf: async () => [], unitsAt: async () => new Map() };
  const acc = new Acc23106Service(db.client, audit, new UnitPayrollService(db.client, audit));
  const svc = new PayrollSolishtirmaService(db.client, audit, unitPayroll);

  // 23106: A — yanvar avansi (yanvarda) + yanvar qoldig'i (fevralda), xizmat safari (olinmaydi);
  // B — 8 800 000; C — 8 800 000 (kasaba ushlanmagan); X — bazada yo'q; T — Tax free
  const f = await statement([
    { date: '15.01.2026', inn: P.A, debit: 4_000_000, purpose: "yanvar oyi uchun avans сотруднику ALFA SHTATOV" },
    { date: '05.02.2026', inn: P.A, debit: 4_600_000, purpose: '2026 йил январ ойи учун иш ҳақи сотруднику ALFA SHTATOV' },
    { date: '20.01.2026', inn: P.A, debit: 777_000, purpose: "хизмат сафари учун бунак сотруднику ALFA SHTATOV" },
    { date: '05.02.2026', inn: P.B, debit: 8_800_000, purpose: 'январ ойи учун иш ҳақи сотруднику BETA SHARTNOMOV' },
    { date: '05.02.2026', inn: P.C, debit: 8_800_000, purpose: 'январ ойи учун иш ҳақи сотруднику GAMMA HUDUDOV' },
    { date: '05.02.2026', inn: P.X, debit: 1_000_000, purpose: 'январ ойи учун иш ҳақи' },
    { date: '05.02.2026', inn: P.T, debit: 1_720_000, purpose: 'январ ойи учун иш ҳақи сотруднику TAKSFRI BIR' },
  ]);
  const a = await acc.analyze(f);
  assert.deepStrictEqual(a.rows.map((r) => r.accrual), ['2026-01', '2026-01', '2026-01', '2026-01', '2026-01', '2026-01', '2026-01'], "izohdagi oy nomi — hisoblangan oy");
  await acc.commit({ fileName: a.fileName, months: ['2026-01', '2026-02'], rows: a.rows }, 'adm');

  // ── Hisoblangan oy bo'yicha ──
  let v = await svc.view('2026-01');
  const r = (p) => v.rows.find((x) => x.pinfl === p);
  assert.deepStrictEqual(v.settings, { taxPct: 12, unionPct: 2, toleranceSum: 1000 });
  assert.deepStrictEqual(v.sources, { tarkib: true, soliq: true, bank: true });
  assert.deepStrictEqual([r(P.A).fotSource, r(P.A).fotTiyin, r(P.A).taxTiyin, r(P.A).unionTiyin, r(P.A).expectedTiyin, r(P.A).bankTiyin, r(P.A).state, r(P.A).group], ['TARKIB', String(so(10_000_000)), String(so(1_200_000)), String(so(200_000)), String(so(8_600_000)), String(so(8_600_000)), 'OK', 'CENTER_SHTAT'], 'shtat: FOT − 12% − 2%; safar olinmadi');
  assert.deepStrictEqual(r(P.A).bank.map((b) => [b.kind, b.count]), [['ISH_HAQI', 2]], 'avans + qoldiq');
  assert.deepStrictEqual([r(P.B).fotSource, r(P.B).employmentType, r(P.B).unionTiyin, r(P.B).expectedTiyin, r(P.B).state, r(P.B).group, r(P.B).regionName], ['SOLIQ', 'SHARTNOMA', '0', String(so(8_800_000)), 'OK', 'REGION_SHARTNOMA', 'Namuna viloyati'], 'shartnoma: FOT − 12%');
  assert.deepStrictEqual([r(P.C).state, r(P.C).diffTiyin], ['MORE', String(so(200_000))]);
  assert.ok(r(P.C).hint.includes('kasaba'), 'sabab: kasaba ushlanmagan');
  assert.deepStrictEqual([r(P.D).state, r(P.D).bankTiyin], ['NO_BANK', '0']);
  assert.deepStrictEqual([r(P.X).state, r(P.X).fullName, r(P.X).group], ['NO_FOT', '—', 'UNKNOWN']);
  assert.deepStrictEqual([r(P.T).group, r(P.T).unitLabel, r(P.T).expectedTiyin, r(P.T).state], ['UNIT', 'Tax free', String(so(1_720_000)), 'OK']);
  assert.deepStrictEqual([v.summary.ok, v.summary.more, v.summary.noBank, v.summary.noFot, v.summary.less], [3, 1, 1, 1, 0]);
  assert.deepStrictEqual(v.groups.map((g) => g.key), ['CENTER_SHTAT', 'REGION_SHTAT', 'REGION_SHARTNOMA', 'UNIT', 'UNKNOWN']);
  const cg = v.groups.find((g) => g.key === 'CENTER_SHTAT');
  assert.deepStrictEqual([cg.employees, cg.problems, cg.expectedTiyin, cg.bankTiyin], [2, 1, String(so(8_600_000 + 4_300_000)), String(so(8_600_000))]);
  assert.deepStrictEqual(v.regions.map((x) => [x.name, x.employees, x.problems]), [['Namuna viloyati', 2, 1]]);
  assert.strictEqual(v.rows[0].state, 'MORE', 'muammolilar yuqorida');

  // ── To'langan oy bo'yicha: yanvarda faqat avans ──
  v = await svc.view('2026-01', 'PAID');
  assert.deepStrictEqual([r(P.A).bankTiyin, r(P.A).state], [String(so(4_000_000)), 'LESS']);
  assert.strictEqual(r(P.B).state, 'NO_BANK');

  // ── Sozlamalar ──
  await assert.rejects(svc.saveSettings({ taxPct: 'abc', unionPct: 2, toleranceSum: 1000 }, 'adm'), /noto'g'ri/);
  await assert.rejects(svc.saveSettings({ taxPct: 12, unionPct: 150, toleranceSum: 1000 }, 'adm'), /noto'g'ri/);
  await svc.saveSettings({ taxPct: 12, unionPct: '1', toleranceSum: 1000 }, 'adm');
  v = await svc.view('2026-01');
  assert.deepStrictEqual([r(P.A).unionTiyin, r(P.A).expectedTiyin, r(P.A).state, r(P.A).diffTiyin], [String(so(100_000)), String(so(8_700_000)), 'LESS', String(-so(100_000))]);
  assert.ok(T.auditLog.some((l) => l.entityType === 'payroll_solishtirma'));
  await assert.rejects(svc.view('2026-13'), /Davr/);

  console.log('OK t-payroll-solishtirma');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
