// Xarajatlar › 23106 — xodimlarga to'lovlar ko'chirmasi: xodim (PINFL yoki izohdagi F.I.Sh.), sana, nima uchun,
// buyruq va hisoblangan oy; ish haqi tarkibi va soliq hisoboti bilan nazorat; saqlash, ko'rish, bekor qilish.
// TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { UnitPayrollService } = require('../dist/modules/unit-payroll/unit-payroll.service');
const { Acc23106Service } = require('../dist/modules/acc-23106/acc23106.service');
const { purposeKind, purposeOrder, purposeName, nameKey } = require('../dist/modules/acc-23106/acc23106.purpose');

const P = { A: '71111111111111', B: '72222222222222', C: '73333333333333', D: '74444444444444', X: '79999999999999' };

/** Ko'chirma: 9-qator qoldiq, 11-qator sarlavha, keyin to'lovlar (bank shakli) */
async function statement(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Page 1');
  ws.getCell('B9').value = 'Остаток:';
  ws.getCell('D9').value = 'Начало дня';
  ws.getCell('E9').value = '0,00';
  ['№\nпп', 'Дата\nдокумента', 'Дата\nобработки', '№ док', 'Наименование счёта', 'ИНН', '№ счёта', 'МФО', 'Обороты по\nдебету', 'Обороты по\nкредиту', 'Назначение платежа'].forEach((h, i) => (ws.getCell(11, i + 1).value = h));
  rows.forEach((r, i) => {
    const vals = [i + 1, r.date, r.date, String(181327700 + i), r.acc, r.inn, '22618000900000000001', '01158', r.debit, r.credit ?? 0, r.purpose];
    vals.forEach((v, j) => (ws.getCell(12 + i, j + 1).value = v));
  });
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), originalname: '23106-yanvar.xlsx' };
}

(async () => {
  // ── Izoh tahlili ──
  const t1 = "13.01.2026 даги 00003-son буйрукка асосан мукофот пули туланди от 'SOLIQ-SERVIS' AKSIYADORLIK JAMIYATI сотруднику SINOV BIRINCHI SINOVOVICH";
  assert.strictEqual(purposeKind(t1), 'MUKOFOT');
  assert.deepStrictEqual(purposeOrder(t1), { date: '2026-01-13', no: '00003' });
  assert.strictEqual(purposeName(t1), 'SINOV BIRINCHI SINOVOVICH');
  const t2 = "07.01.2026 йилдаги 00001-xs-son буйрукка асосан хизмат сафари учун бунак тўланмоқда от 'SOLIQ-SERVIS' AKSIYADORLIK JAMIYATI сотруднику NAMUNA UCHINCHI NAMUNOVICH";
  assert.strictEqual(purposeKind(t2), 'SAFAR');
  assert.deepStrictEqual(purposeOrder(t2), { date: '2026-01-07', no: '00001-xs' });
  const t3 = "29.12.2025 даги 358-if-sonli buyruqqa asosan mukofot puli hisoblandi от 'SOLIQ-SERVIS' AKSIYADORLIK JAMIYATI сотруднику TESTOVA IKKINCHI TESTOVNA";
  assert.deepStrictEqual(purposeOrder(t3), { date: '2025-12-29', no: '358-if' });
  assert.strictEqual(purposeKind("Bayram puli (8-mart) to'landi сотруднику X Y"), 'BAYRAM');
  assert.strictEqual(purposeName('сотруднику кичик harflar bilan matn'), null, 'F.I.Sh. emas');
  assert.strictEqual(nameKey('ТЕСТОВА ИККИНЧИ ТЕСТОВНА'), nameKey('Testova Ikkinchi Testovna'), 'kirill = lotin');

  // ── Baza ──
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  const emp = (pinfl, fullName) => T.employee.push({ pinfl, fullName, lastName: fullName.split(' ')[0], firstName: 'X', regionCode: 0, departmentId: null, districtId: null, position: null, employmentType: 'SHTAT', isActive: true, hiredAt: null, firedAt: null });
  emp(P.A, 'Sinov Birinchi Sinovovich');
  emp(P.B, 'Тестова Иккинчи Тестовна'); // reestrda kirillda
  emp(P.C, 'Namuna Uchinchi Namunovich');
  emp(P.D, 'Doniyorov Doniyor');
  // Ish haqi tarkibi: yanvar (A — mukofot 3 mln, D — bayram 1 mln), dekabr yuklanmagan
  for (const [code, name, category] of [['KPI', 'KPI premiyasi', 'PREMIYA'], ['BAYRAM', 'Bayram premiyasi', 'PREMIYA'], ['OKLAD', 'Oklad', 'ASOSIY']]) T.salaryComponent.push({ code, name, category, group: 'HOJALIK', sign: 1, sortOrder: 1, isActive: true });
  T.salaryCompositionBatch.push({ id: 'cb1', period: '2026-01', cancelledAt: null, createdAt: new Date() });
  T.salaryCompositionRow.push({ id: 'r1', batchId: 'cb1', period: '2026-01', employeePinfl: P.A }, { id: 'r2', batchId: 'cb1', period: '2026-01', employeePinfl: P.D }, { id: 'r3', batchId: 'cb1', period: '2026-01', employeePinfl: P.C });
  T.salaryCompositionItem.push(
    { id: 'i1', batchId: 'cb1', rowId: 'r1', componentCode: 'KPI', amountTiyin: 300000000n },
    { id: 'i2', batchId: 'cb1', rowId: 'r2', componentCode: 'BAYRAM', amountTiyin: 100000000n },
    { id: 'i3', batchId: 'cb1', rowId: 'r3', componentCode: 'OKLAD', amountTiyin: 500000000n },
  );
  // Soliq hisoboti: yanvar — A, D
  T.payrollBatch.push({ id: 'pb', period: '2026-01', status: 'COMMITTED', scope: 'ALL' });
  for (const p of [P.A, P.D]) T.payrollEntry.push({ id: `e${p}`, employeePinfl: p, period: '2026-01', batchId: 'pb', baseTiyin: 1n, totalTiyin: 1n, bonusTiyin: 0n, deletedAt: null });

  const audit = new AuditService(db.client);
  const svc = new Acc23106Service(db.client, audit, new UnitPayrollService(db.client, audit));

  const f = await statement([
    { date: '13.01.2026', acc: 'SINOV B. S.', inn: P.A, debit: 2_627_182, purpose: t1 }, // PINFL, mukofot, tarkibda 3 mln — OK
    { date: '08.01.2026', acc: 'UZCARD DUO', inn: '39999999990001', debit: 1_731_133, purpose: t3 }, // PINFL reestrda yo'q → ism bo'yicha B; dekabr — tarkib yo'q
    { date: '08.01.2026', acc: 'UZCARD DUO', inn: '39999999990002', debit: 2_000_000, purpose: t2 }, // ism bo'yicha C, safar — nazorat yo'q
    { date: '20.01.2026', acc: 'DONIYOROV D.', inn: P.D, debit: 1_200_000, purpose: "15.01.2026 даги 00007-son буйрукка асосан байрам пули туланди сотруднику DONIYOROV DONIYOR" }, // bayram 1,2 mln > tarkib 1 mln — OVER
    { date: '21.01.2026', acc: 'NAMUNA U.', inn: P.C, debit: 500_000, purpose: "16.01.2026 даги 00008-son буйрукка асосан мукофот пули туланди сотруднику NAMUNA UCHINCHI NAMUNOVICH" }, // C tarkibda mukofot yo'q
    { date: '22.01.2026', acc: 'NOMA\'LUM', inn: P.X, debit: 100_000, purpose: 'mukofot puli' }, // reestrda yo'q
    { date: '23.01.2026', acc: 'KIRIM', inn: '123456789', debit: 0, credit: 9_000_000, purpose: 'Qaytarildi' }, // kirim
  ]);
  const a = await svc.analyze(f);
  assert.strictEqual(a.rows.length, 6);
  assert.deepStrictEqual(a.inflow, { count: 1, totalTiyin: '900000000' });
  const row = (i) => a.rows[i];
  assert.deepStrictEqual([row(0).pinfl, row(0).matchBy, row(0).kind, row(0).orderNo, row(0).accrual, row(0).control, row(0).inSoliq], [P.A, 'PINFL', 'MUKOFOT', '00003', '2026-01', 'OK', true]);
  assert.deepStrictEqual([row(1).pinfl, row(1).matchBy, row(1).accrual, row(1).control], [P.B, 'NAME', '2025-12', 'NO_TARKIB'], "izohdagi ism (lotin) = reestrdagi (kirill); dekabr buyrug'i");
  assert.deepStrictEqual([row(2).pinfl, row(2).matchBy, row(2).kind, row(2).control], [P.C, 'NAME', 'SAFAR', 'NA']);
  assert.deepStrictEqual([row(3).kind, row(3).control, row(3).tarkibTiyin], ['BAYRAM', 'OVER', '100000000']);
  assert.strictEqual(row(4).control, 'NOT_IN_TARKIB');
  assert.deepStrictEqual([row(5).pinfl, row(5).fullName, row(5).matchBy, row(5).control], [P.X, null, null, 'NOT_IN_TARKIB']);
  assert.deepStrictEqual(a.summary.matched, { pinfl: 3, name: 2, none: 1 });
  assert.deepStrictEqual(a.summary.control, { ok: 1, over: 1, notInTarkib: 2, noTarkib: 1, na: 1 });
  assert.ok(!JSON.stringify(a.rows).includes('22618000900000000001'), 'hisob raqami saqlanmaydi');

  // ── Saqlash, ko'rish, bekor qilish ──
  const c = await svc.commit({ fileName: a.fileName, months: ['2026-01'], rows: a.rows }, 'adm');
  assert.deepStrictEqual([c.saved, c.totalTiyin], [6, String((2_627_182 + 1_731_133 + 2_000_000 + 1_200_000 + 500_000 + 100_000) * 100)]);
  const v = await svc.view('2026-01', '2026-01');
  assert.strictEqual(v.rows.length, 6);
  assert.strictEqual(v.summary.byKind[0].kind, 'MUKOFOT');
  assert.ok(!JSON.stringify(T.setting).includes('22618000900000000001'), 'bazada ham hisob raqami yo\'q');
  // X reestrga qo'shildi — ko'rishda o'zi topiladi
  emp(P.X, 'Xolmatov Xolmat');
  assert.strictEqual((await svc.view('2026-01', '2026-01')).rows.find((r) => r.pinfl === P.X).matchBy, 'PINFL');
  const b = (await svc.batches())[0];
  await svc.cancel(b.id, 'adm');
  assert.strictEqual((await svc.view('2026-01', '2026-01')).rows.length, 0);
  await assert.rejects(svc.cancel(b.id, 'adm'), /allaqachon/);
  assert.ok(!T.expense.length, 'xarajat yozuvi yaratilmaydi');

  // Shablon
  const tpl = await svc.template();
  const twb = new ExcelJS.Workbook();
  await twb.xlsx.load(tpl.buffer);
  assert.strictEqual(String(twb.worksheets[0].getCell(11, 11).value), 'Назначение платежа');

  console.log('OK t-acc23106');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});