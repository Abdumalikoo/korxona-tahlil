// Xarajatlar › Ish haqi solishtirma: FOT (FAQAT soliq hisoboti) − soliq 12% − kasaba 2% (faqat asosiy shtat) = 23106.
// Shartnoma: 10 000 000 − 1 200 000 = 8 800 000; shtat: 10 000 000 − 1 200 000 − 200 000 = 8 600 000.
// Ikki tablo (Markaz / Hududlar); Markazda tarkib farqini komponentga yo'naltirish; mos kelganlar kategoriyalar bo'yicha
// va «to'g'ri» deb tasdiqlash (keyin o'zgarsa — «o'zgargan»). Bank oyi — izohdagi «… oyi uchun». TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { UnitPayrollService } = require('../dist/modules/unit-payroll/unit-payroll.service');
const { Acc23106Service } = require('../dist/modules/acc-23106/acc23106.service');
const { SalaryCompositionService } = require('../dist/modules/salary-composition/salary-composition.service');
const { CompositionReconcileService } = require('../dist/modules/salary-composition/salary-composition.reconcile');
const { PayrollSolishtirmaService } = require('../dist/modules/payroll-solishtirma/payroll-solishtirma.service');

const P = { A: '91111111111111', B: '92222222222222', C: '93333333333333', D: '94444444444444', E: '95555555555555', X: '90000000000001', T: '96666666666666' };
const so = (n) => BigInt(Math.round(n * 100));
const crow = (pinfl, items) => ({ pinfl, fullName: null, workedDays: null, rate: null, items: new Map(Object.entries(items).map(([k, v]) => [k, so(v)])) });

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
  emp(P.A, 'Alfa Shtatov', 0, 'SHTAT'); // Markaz: tarkibda bayram yo'q (1 mln kam)
  emp(P.B, 'Beta Shartnomov', 10, 'SHTAT'); // shu oy joylashuvi — shartnoma (ustun)
  emp(P.C, 'Gamma Hududov', 10, 'SHTAT'); // hudud, shtat — kasaba ushlanmagan
  emp(P.D, 'Delta Markazov', 0, 'SHTAT'); // tarkib = soliq, bankda yo'q
  emp(P.E, 'Epsilon Mosov', 0, 'SHTAT'); // hammasi mos
  emp(P.T, 'Taksfri Bir', 0, 'SHTAT');
  T.employeeLocation.push({ id: 'l1', employeePinfl: P.B, period: '2026-01', regionCode: 10, districtId: null, employmentType: 'SHARTNOMA', source: 'RESULTS' });

  // Soliq hisoboti (asosiy)
  T.payrollBatch.push({ id: 'pb', period: '2026-01', status: 'COMMITTED', scope: 'ALL' });
  for (const [p, v] of [[P.A, 10_000_000], [P.B, 10_000_000], [P.C, 10_000_000], [P.D, 5_000_000], [P.E, 4_000_000]]) T.payrollEntry.push({ id: `e${p}`, employeePinfl: p, period: '2026-01', batchId: 'pb', baseTiyin: so(v), totalTiyin: so(v), bonusTiyin: 0n, deletedAt: null });

  const audit = new AuditService(db.client);
  const unitPayroll = { payrollMap: async (u) => (u === 'TAX_FREE' ? new Map([[P.T, so(2_000_000)]]) : null), staffOf: async () => [], unitsAt: async () => new Map(), splitComponents: async () => null };
  const payrollSvc = { regroup: async () => null };
  const comp = new SalaryCompositionService(db.client, payrollSvc, unitPayroll);
  await comp.onModuleInit();
  T.salaryComponent.forEach((x) => (x.isActive = true));
  const rec = new CompositionReconcileService(db.client, comp, payrollSvc, audit, unitPayroll);
  const svc = new PayrollSolishtirmaService(db.client, audit, unitPayroll, rec);
  const acc = new Acc23106Service(db.client, audit, new UnitPayrollService(db.client, audit));

  // Tarkib: A — 9 mln (bayram yo'q), D — mos, E — mos (oklad + KPI); Tax free: T — 1,9 mln (vedomost 2 mln)
  await comp.commit({ period: '2026-01', fileName: 'tarkib.xlsx', userId: 'adm', rows: [crow(P.A, { OKLAD: 9_000_000 }), crow(P.D, { OKLAD: 5_000_000 }), crow(P.E, { OKLAD: 3_000_000, KPI: 1_000_000 })] });
  await comp.commit({ period: '2026-01', fileName: 'tf.xlsx', userId: 'adm', unit: 'TAX_FREE', rows: [crow(P.T, { OKLAD: 1_900_000 })] });

  // 23106: A — avans (yanvar) + bayram (yanvar) + qoldiq (fevralda, «январ ойи учун»), xizmat safari (olinmaydi)
  const f = await statement([
    { date: '15.01.2026', inn: P.A, debit: 4_000_000, purpose: 'yanvar oyi uchun avans сотруднику ALFA SHTATOV' },
    { date: '20.01.2026', inn: P.A, debit: 880_000, purpose: 'январ ойи учун байрам пули сотруднику ALFA SHTATOV' },
    { date: '05.02.2026', inn: P.A, debit: 3_720_000, purpose: '2026 йил январ ойи учун иш ҳақи сотруднику ALFA SHTATOV' },
    { date: '20.01.2026', inn: P.A, debit: 777_000, purpose: 'хизмат сафари учун бунак сотруднику ALFA SHTATOV' },
    { date: '05.02.2026', inn: P.B, debit: 8_800_000, purpose: 'январ ойи учун иш ҳақи сотруднику BETA SHARTNOMOV' },
    { date: '05.02.2026', inn: P.C, debit: 8_800_000, purpose: 'январ ойи учун иш ҳақи сотруднику GAMMA HUDUDOV' },
    { date: '05.02.2026', inn: P.E, debit: 3_440_000, purpose: 'январ ойи учун иш ҳақи сотруднику EPSILON MOSOV' },
    { date: '05.02.2026', inn: P.X, debit: 1_000_000, purpose: 'январ ойи учун иш ҳақи' },
    { date: '05.02.2026', inn: P.T, debit: 1_720_000, purpose: 'январ ойи учун иш ҳақи сотруднику TAKSFRI BIR' },
  ]);
  const a = await acc.analyze(f);
  assert.ok(a.rows.every((x) => x.accrual === '2026-01'), 'izohdagi oy nomi — hisoblangan oy');
  await acc.commit({ fileName: a.fileName, months: ['2026-01', '2026-02'], rows: a.rows }, 'adm');

  // ── Markaz tablosi ──
  let v = await svc.view('2026-01');
  const r = (p) => v.rows.find((x) => x.pinfl === p);
  assert.strictEqual(v.tab, 'CENTER');
  assert.deepStrictEqual(v.rows.map((x) => x.pinfl).sort(), [P.A, P.D, P.E, P.T, P.X].sort(), "hudud xodimlari Markaz tablosida yo'q");
  assert.deepStrictEqual([v.tabs.CENTER.employees, v.tabs.REGION.employees, v.tabs.REGION.problems], [5, 2, 1]);
  // FOT — faqat soliq hisoboti (tarkib 9 mln bo'lsa ham)
  assert.deepStrictEqual([r(P.A).fotTiyin, r(P.A).fotSource, r(P.A).tarkibTiyin, r(P.A).expectedTiyin, r(P.A).bankTiyin, r(P.A).state], [String(so(10_000_000)), 'SOLIQ', String(so(9_000_000)), String(so(8_600_000)), String(so(8_600_000)), 'OK'], 'safar olinmadi');
  assert.deepStrictEqual([r(P.A).tarkibSoliqDiffTiyin, r(P.A).tarkibFix.canAllocate, r(P.A).tarkibFix.suggestion.componentCode, r(P.A).tarkibFix.suggestion.confidence, r(P.A).confirmable], [String(so(1_000_000)), true, 'BAYRAM', 'STRONG', false]);
  assert.deepStrictEqual([r(P.T).tarkibFix.unit, r(P.T).tarkibFix.diffTiyin, r(P.T).tarkibFix.canAllocate, r(P.T).group], ['TAX_FREE', String(so(100_000)), true, 'UNIT']);
  assert.deepStrictEqual([r(P.D).confirmable, r(P.D).state, r(P.D).tarkibFix], [true, 'NO_BANK', null], 'tarkib = soliq — tasdiqlash mumkin');
  assert.deepStrictEqual([r(P.E).confirmable, r(P.E).state], [true, 'OK']);
  assert.deepStrictEqual(r(P.E).categories.map((c) => [c.category, c.tiyin]), [['ASOSIY', String(so(3_000_000))], ['PREMIYA', String(so(1_000_000))]]);
  assert.deepStrictEqual([r(P.X).state, r(P.X).fotTiyin], ['NO_FOT', null]);
  assert.deepStrictEqual([v.matched.count, v.matched.bankOk, v.matched.categories.map((c) => [c.category, c.tiyin])], [2, 1, [['ASOSIY', String(so(8_000_000))], ['PREMIYA', String(so(1_000_000))]]]);
  assert.ok(v.components.some((c) => c.code === 'BAYRAM'));

  // ── Tarkib farqini yo'naltirish (tavsiya bo'yicha) ──
  await rec.allocate('2026-01', undefined, { items: [{ pinfl: P.A, componentCode: 'BAYRAM', amountTiyin: r(P.A).tarkibFix.diffTiyin, source: 'SUGGESTION' }] }, 'adm');
  await rec.allocate('2026-01', 'TAX_FREE', { items: [{ pinfl: P.T, componentCode: 'KPI', amountTiyin: r(P.T).tarkibFix.diffTiyin }] }, 'adm');
  v = await svc.view('2026-01');
  assert.deepStrictEqual([r(P.A).tarkibTiyin, r(P.A).tarkibFix.canAllocate, r(P.A).tarkibFix.adjustments.length, r(P.A).confirmable], [String(so(10_000_000)), false, 1, true]);
  assert.deepStrictEqual(r(P.A).categories.map((c) => c.category), ['ASOSIY', 'PREMIYA']);
  assert.deepStrictEqual([r(P.T).confirmable, v.matched.count], [true, 4]);

  // ── «To'g'ri» deb tasdiqlash ──
  await assert.rejects(svc.confirm('2026-01', 'CENTER', 'ACCRUAL', { pinfls: [P.X] }, 'adm'), /mos emas/);
  const c1 = await svc.confirm('2026-01', 'CENTER', 'ACCRUAL', {}, 'adm');
  assert.deepStrictEqual([c1.confirmed, c1.total], [4, 4]);
  v = await svc.view('2026-01');
  assert.deepStrictEqual([r(P.E).confirm, r(P.X).confirm, v.matched.unconfirmed, v.matched.confirmed.count, v.matched.confirmed.changed], ['CONFIRMED', null, 0, 4, 0]);
  // Tasdiqlanganlar umumiy hisobdan chiqdi
  assert.deepStrictEqual([v.summary.confirmed, v.summary.employees, v.tabs.CENTER.confirmed, v.tabs.CENTER.problems], [4, 1, 4, 1], 'faqat X qoldi');
  assert.deepStrictEqual(v.groups.map((g) => g.key), ['UNKNOWN']);
  // Soliq hisoboti keyin o'zgardi → «o'zgargan»
  T.payrollEntry.find((x) => x.employeePinfl === P.E).baseTiyin = so(4_100_000);
  v = await svc.view('2026-01');
  assert.deepStrictEqual([r(P.E).confirm, r(P.E).confirmable, v.matched.confirmed.changed], ['CHANGED', false, 1]);
  assert.deepStrictEqual([v.summary.confirmed, v.summary.employees], [3, 2], "o'zgargan — umumiy ro'yxatga qaytdi");

  // ── Hududlar tablosi ──
  let h = await svc.view('2026-01', 'ACCRUAL', 'REGION');
  const hr = (p) => h.rows.find((x) => x.pinfl === p);
  assert.deepStrictEqual(h.rows.map((x) => x.pinfl).sort(), [P.B, P.C].sort());
  assert.deepStrictEqual([hr(P.B).employmentType, hr(P.B).unionTiyin, hr(P.B).expectedTiyin, hr(P.B).state, hr(P.B).confirmable, hr(P.B).tarkibFix], ['SHARTNOMA', '0', String(so(8_800_000)), 'OK', true, null]);
  assert.deepStrictEqual([hr(P.C).state, hr(P.C).diffTiyin, hr(P.C).confirmable], ['MORE', String(so(200_000)), false]);
  assert.ok(hr(P.C).hint.includes('kasaba'));
  assert.deepStrictEqual(h.regions.map((x) => [x.name, x.employees, x.problems]), [['Namuna viloyati', 2, 1]]);
  assert.deepStrictEqual(h.matched.byGroup.map((g) => [g.key, g.count]), [['REGION_SHARTNOMA', 1]]);
  assert.strictEqual((await svc.confirm('2026-01', 'REGION', 'ACCRUAL', {}, 'adm')).confirmed, 1);
  h = await svc.view('2026-01', 'ACCRUAL', 'REGION');
  assert.strictEqual(hr(P.B).confirm, 'CONFIRMED');

  // ── Tasdiqni bekor qilish ──
  assert.strictEqual((await svc.cancelConfirm('2026-01', 'CENTER', 'adm')).removed, 4);
  await assert.rejects(svc.cancelConfirm('2026-01', 'CENTER', 'adm'), /tasdiq yo'q/);
  assert.strictEqual((await svc.view('2026-01', 'ACCRUAL', 'REGION')).matched.confirmed.count, 1, "Hududlar tasdig'i qoldi");

  // ── To'langan oy bo'yicha: yanvarda avans + bayram ──
  v = await svc.view('2026-01', 'PAID');
  assert.deepStrictEqual([r(P.A).bankTiyin, r(P.A).state], [String(so(4_880_000)), 'LESS']);

  // ── Bitta xodim: manbadagi hamma narsa (faqat uniki) ──
  const pa = await svc.person('2026-01', P.A, 'ACCRUAL');
  assert.deepStrictEqual([pa.fullName, pa.row.pinfl, pa.soliq.length, pa.soliq[0].tiyin, pa.soliq[0].counted], ['Alfa Shtatov', P.A, 1, String(so(10_000_000)), true]);
  assert.deepStrictEqual([pa.tarkib.length, pa.tarkib[0].items.map((i) => [i.code, i.tiyin])], [1, [['OKLAD', String(so(9_000_000))], ['BAYRAM', String(so(1_000_000))]]]);
  assert.ok(pa.adjustments.some((x) => x.tiyin === String(so(1_000_000))), "yo'naltirilgan bayram puli ham ko'rinadi");
  assert.ok(pa.bank.length >= 3, "23106 dagi hamma to'lovi");
  assert.ok(pa.bank.every((b) => b.docDate && b.docNo && b.purpose !== undefined));
  assert.ok(pa.bank.some((b) => b.kind === 'SAFAR' && !b.counted && /safari/.test(b.reason)), 'xizmat safari — olinmagani va nega');
  assert.strictEqual(pa.bankCountedTiyin, pa.row.bankTiyin, 'shu oyga olinganlar jami = qatordagi bank');
  assert.ok(!JSON.stringify(pa).includes(P.B), 'boshqa xodim ma’lumoti yo‘q');
  const pt = await svc.person('2026-01', P.T, 'ACCRUAL');
  assert.deepStrictEqual([pt.tarkib[0].where, pt.tarkib[0].totalTiyin], ['Tax free ish haqi tarkibi', String(so(2_000_000))], "(oldin 200 ming yo'naltirilgan)");
  await assert.rejects(svc.person('2026-01', '123'), /PINFL/);

  // ── Sozlamalar ──
  await assert.rejects(svc.saveSettings({ taxPct: 'abc', unionPct: 2, toleranceSum: 1000 }, 'adm'), /noto'g'ri/);
  await svc.saveSettings({ taxPct: 12, unionPct: '1', toleranceSum: 1000 }, 'adm');
  v = await svc.view('2026-01');
  assert.deepStrictEqual([r(P.A).expectedTiyin, r(P.A).state, r(P.A).diffTiyin], [String(so(8_700_000)), 'LESS', String(-so(100_000))]);
  assert.ok(T.auditLog.some((l) => l.entityType === 'payroll_solishtirma'));
  await assert.rejects(svc.view('2026-13'), /Davr/);

  console.log('OK t-payroll-solishtirma');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
