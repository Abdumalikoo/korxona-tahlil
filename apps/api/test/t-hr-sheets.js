// Xodimlar › Ma'lumotnomalar (10, 16, 37, 51-jadval) va «Miya»: shablon, o'qish, saqlash, qaytarish, xodim kartasi,
// bo'lim ish haqi ro'yxatini oziqlash. TEST MA'LUMOTLARI SUN'IY (ismlar, PINFL, pasport — o'ylab topilgan).
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const fakeDb = require('./fakedb');
const { HrSheetsService } = require('../dist/modules/hr-sheets/hr-sheets.service');
const { UnitPayrollService } = require('../dist/modules/unit-payroll/unit-payroll.service');
const { hrPeople, clearHrCache } = require('../dist/modules/hr-sheets/hr-sheets.store');

const db = fakeDb();
const T = db.tables;
T.user.push({ id: 'u1', fullName: 'Admin Test' });
T.region.push({ code: 0, name: 'Markaz', isActive: true });
T.employee.push({ pinfl: '30000000000003', fullName: 'UCHINCHI SINOV', position: 'Bosh mutaxassis', regionCode: 0, isActive: true, employmentType: 'SHTAT', hiredAt: null, firedAt: null, districtId: null, departmentId: null });
const audit = { logs: [], async log(x) { this.logs.push(x); } };
const up = new UnitPayrollService(db.client, audit);
const svc = new HrSheetsService(db.client, audit, up);

const P = { a: '30000000000001', b: '30000000000002', c: '30000000000003', d: '30000000000004' };
async function fill(code, rows, mutate) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await svc.template(code)).buffer);
  const ws = wb.worksheets[0];
  if (mutate) mutate(ws);
  rows.forEach((r, i) => r.forEach((v, j) => (ws.getCell(10 + i, j + 1).value = v)));
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), originalname: `${code}.xlsx` };
}

(async () => {
  assert.throws(() => svc.sheetOf('J99'), /Jadval/);

  // ── Shablon: asl shakl (9-qator sarlavha, 1-qatorda jadval raqami) ──
  let wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await svc.template('J10')).buffer);
  let ws = wb.worksheets[0];
  assert.strictEqual(ws.getCell(9, 1).value, 'Т.р');
  assert.strictEqual(ws.getCell(9, 16).value, 'ЖШШИР');
  assert.strictEqual(ws.getCell(1, 16).value, '10-jadval');
  assert.strictEqual(wb.worksheets[1].name, "Ko'rsatma");

  // ── 10-jadval: 3 xodim + xato PINFL + takror ──
  const j10 = (n, fio, pinfl, tuzilma, holat = 'ishlayapti') => [n, 100 + n, fio, '01.02.1990', 'Toshkent', holat, '"Soliq-servis" AJ', tuzilma, 'Buxgalteri', '01.07.2026', '01.07.2026', 'oliy', 'Sinov manzil 1', 36, null, pinfl];
  let f = await fill('J10', [
    j10(1, 'BIRINCHI SINOV', P.a, "Qibray tumani Fermer xoʻjaliklarida buxgalteriya hisobi"),
    j10(2, 'IKKINCHI SINOV', P.b, "Chet el fuqarolariga qoʻshilgan qiymat soligʻini qaytarish boʻyicha filial"),
    j10(3, 'UCHINCHI SINOV', P.c, 'Rahbariyat'),
    j10(4, 'XATO SINOV', '123', 'Rahbariyat'),
    j10(5, 'BIRINCHI SINOV', P.a, 'Takror'),
  ]);
  let a = await svc.analyze('J10', f, 'u1');
  assert.strictEqual(a.headerRow, 9);
  assert.strictEqual(a.total, 3);
  assert.strictEqual(a.invalidCount, 1);
  assert.match(a.invalid[0].reason, /JShShIR/);
  assert.strictEqual(a.duplicateCount, 1);
  assert.strictEqual(a.diff, null);
  assert.deepStrictEqual(a.people, { identified: 3, inRegistry: 1, notInRegistry: 2, alsoInOtherSheets: 0, unmatchedNames: 0, ambiguousNames: 0 });
  assert.deepStrictEqual(a.units.map((u) => [u.unit, u.count]), [['FERMER', 1], ['TAX_FREE', 1]]);
  assert.ok(a.preview[0].manzil.startsWith('•'), 'manzil yashirin');
  assert.ok(!JSON.stringify(a).includes('Sinov manzil'), 'tahlilda shaxsiy manzil ochiq emas');
  await assert.rejects(svc.commit('J10', { token: 'yoq' }, 'u1'), /eskirgan/);
  let c = await svc.commit('J10', { token: a.token }, 'u1');
  assert.strictEqual(c.count, 3);
  await assert.rejects(svc.commit('J10', { token: a.token }, 'u1'), /eskirgan/, 'token bir marta');

  // ── 16-jadval: ustunlar tartibi o'zgargan, sarlavha 5-qatorda; pasport — yashirin ──
  wb = new ExcelJS.Workbook();
  const s16 = wb.addWorksheet('Varaq');
  s16.getCell(5, 1).value = 'PINFL';
  s16.getCell(5, 2).value = 'Xodimning familiyasi, ismi va sharifi';
  s16.getCell(5, 3).value = 'Pasport \nraqami';
  s16.getCell(5, 4).value = 'Departament (boshqarma) nomi';
  s16.getCell(5, 5).value = 'Ortiqcha ustun';
  s16.addRow([]);
  [[Number(P.a), 'BIRINCHI SINOV', 'AA1234567', 'Fermer xoʻjaliklariga xizmat koʻrsatish'], [P.d, "TO'RTINCHI SINOV", 'AB7654321', 'Marksheyderlik xizmati boʻlimi']].forEach((r, i) => r.forEach((v, j) => (s16.getCell(6 + i, j + 1).value = v)));
  a = await svc.analyze('J16', { buffer: Buffer.from(await wb.xlsx.writeBuffer()), originalname: '16.xlsx' }, 'u1');
  assert.strictEqual(a.headerRow, 5);
  assert.strictEqual(a.total, 2);
  assert.ok(a.columns.find((x) => x.key === 'pasportRaqam').found && !a.columns.find((x) => x.key === 'telefon').found);
  assert.strictEqual(a.people.alsoInOtherSheets, 1);
  await svc.commit('J16', { token: a.token }, 'u1');
  let rows = await svc.rows('J16', {});
  assert.strictEqual(rows.rows[0].pinfl, P.a, 'Excel son sifatidagi PINFL matnga o\'girildi');
  assert.strictEqual(rows.rows[0].cells.pasportRaqam, '••••••567');

  // ── 51-jadval: bir xodimga 2 qator (multi) ──
  const j51 = (n, fio, pinfl, tuzilma, lavozim, holat) => [n, '6003', fio, '"Soliq-servis" AJ', tuzilma, lavozim, pinfl, null, null, holat];
  f = await fill('J51', [j51(1, 'IKKINCHI SINOV', P.b, 'Tax free filiali', 'Bosh mutaxassisi', 'ishlayapti'), j51(2, 'IKKINCHI SINOV', P.b, 'Tax free filiali', "Bo'lim boshlig'i", 'ishlayapti')]);
  a = await svc.analyze('J51', f, 'u1');
  assert.strictEqual(a.total, 2);
  assert.strictEqual(a.duplicateCount, 0);
  await svc.commit('J51', { token: a.token }, 'u1');

  // ── 37-jadval: PINFL yo'q — F.I.Sh. bo'yicha ──
  f = await fill('J37', [[1, 'Birinchi  Sinov', '"Soliq-servis" AJ', 'Fermer xoʻjaliklarida buxgalteriya hisobi Buxgalteri', 'oliy, iqtisodchi', 'Avvalgi MCHJ'], [2, "NOMA'LUM ODAM", '"Soliq-servis" AJ', 'Bosh mutaxassisi', 'oliy', '']]);
  a = await svc.analyze('J37', f, 'u1');
  assert.strictEqual(a.people.identified, 1);
  assert.strictEqual(a.people.unmatchedNames, 1);
  await svc.commit('J37', { token: a.token }, 'u1');

  // ── Birlashtirilgan odamlar ──
  const people = await hrPeople(db.client);
  assert.deepStrictEqual([...people.keys()].sort(), [P.a, P.b, P.c, P.d]);
  assert.deepStrictEqual(people.get(P.a).sources.sort(), ['J10', 'J16', 'J37']);
  assert.strictEqual(people.get(P.a).unit, 'FERMER');
  assert.strictEqual(people.get(P.b).unit, 'TAX_FREE');
  assert.strictEqual(people.get(P.b).position, 'Buxgalteri', '10-jadval ustun (51 faqat bo\'shini to\'ldiradi)');
  assert.strictEqual(people.get(P.d).unit, 'MARKSHEYDER');
  assert.strictEqual(people.get(P.c).unit, null);

  // ── «Miya»: bo'lim ish haqi ro'yxati ma'lumotnomalardan oziqlanadi ──
  let fr = await up.staffOf('FERMER');
  assert.deepStrictEqual(fr.map((s) => [s.pinfl, s.fullName, s.source]), [[P.a, 'BIRINCHI SINOV', 'REGISTRY']]);
  assert.deepStrictEqual((await up.staffOf('TAX_FREE')).map((s) => s.pinfl), [P.b]);
  let link = await up.link('FERMER');
  assert.strictEqual(link.byHr, true);
  assert.strictEqual(link.hrCount, 1);
  await up.setLink('FERMER', { byHr: false }, 'u1');
  assert.strictEqual((await up.staffOf('FERMER')).length, 0, 'o\'chirilsa — ma\'lumotnomadan olinmaydi');
  await up.setLink('FERMER', { byHr: true }, 'u1');
  // Ko'chish ustun: P.a apreldan Markazda
  await up.addMove({ pinfl: P.a, unit: 'CENTER', from: '2026-04' }, 'u1');
  assert.strictEqual((await up.staffOf('FERMER', '2026-05')).length, 0);
  assert.strictEqual((await up.staffOf('FERMER', '2026-03')).length, 1);

  // ── Xodim kartasi ──
  await assert.rejects(svc.person('123'), /14 raqam/);
  await assert.rejects(svc.person('39999999999999'), /topilmadi/);
  const pa = await svc.person(P.a);
  assert.strictEqual(pa.fullName, 'BIRINCHI SINOV');
  assert.deepStrictEqual(pa.sheets.map((s) => s.code), ['J10', 'J16', 'J37']);
  const pasport = pa.sheets.find((s) => s.code === 'J16').records[0].groups.find((g) => g.group === 'pasport');
  assert.deepStrictEqual(pasport.fields, [{ label: 'Pasport raqami', value: 'AA1234567' }], 'kartada — to\'liq');
  assert.strictEqual(pa.hrUnit, 'FERMER');
  assert.strictEqual(pa.registry, null);
  assert.strictEqual(pa.miya.moves.length, 1);
  const pb = await svc.person(P.b);
  assert.strictEqual(pb.sheets.find((s) => s.code === 'J51').records.length, 2);
  assert.deepStrictEqual(pb.miya.staffIn.map((x) => x.unit), ['TAX_FREE']);
  const pc = await svc.person(P.c);
  assert.ok(pc.registry && pc.registry.position === 'Bosh mutaxassis');
  assert.strictEqual(pc.miya.unit, 'CENTER');

  // ── Qidiruv ──
  assert.deepStrictEqual((await svc.search('sinov')).map((x) => x.pinfl).sort(), [P.a, P.b, P.c, P.d]);
  assert.deepStrictEqual((await svc.search('0000000002')).map((x) => x.pinfl), [P.b]);
  assert.deepStrictEqual(await svc.search('ab'), []);

  // ── Ro'yxat: qidiruv, bo'lim filtri ──
  rows = await svc.rows('J10', { unit: 'FERMER' });
  assert.deepStrictEqual(rows.rows.map((r) => r.pinfl), [P.a]);
  rows = await svc.rows('J10', { q: 'ikkinchi' });
  assert.strictEqual(rows.total, 1);
  assert.strictEqual((await svc.rows('J10', { q: 'Sinov manzil' })).total, 0, 'shaxsiy ustun bo\'yicha qidirilmaydi');
  rows = await svc.rows('J37', {});
  assert.deepStrictEqual(rows.rows.map((r) => r.pinfl), [P.a, null]);

  // ── Qayta yuklash → farq; qaytarish; tozalash ──
  f = await fill('J10', [j10(1, 'BIRINCHI SINOV', P.a, "Qibray tumani Fermer xoʻjaliklarida buxgalteriya hisobi"), j10(2, 'IKKINCHI SINOV', P.b, 'Boshqa tuzilma'), j10(3, 'BESHINCHI SINOV', '30000000000005', 'Rahbariyat')]);
  a = await svc.analyze('J10', f, 'u1');
  assert.deepStrictEqual(a.diff, { added: 1, removed: 1, changed: 1, same: 1 });
  await svc.commit('J10', { token: a.token }, 'u1');
  let ov = await svc.overview();
  assert.ok(ov.sheets.find((s) => s.code === 'J10').hasPrev);
  assert.strictEqual(ov.sheets.find((s) => s.code === 'J10').current.count, 3);
  const r = await svc.restore('J10', 'u1');
  assert.strictEqual(r.count, 3);
  assert.ok((await hrPeople(db.client)).get(P.c).sources.includes('J10'), 'qaytarilgan holat');
  await svc.clear('J10', 'u1');
  ov = await svc.overview();
  assert.strictEqual(ov.sheets.find((s) => s.code === 'J10').current, null);
  await svc.restore('J10', 'u1');
  assert.strictEqual((await svc.overview()).sheets.find((s) => s.code === 'J10').current.count, 3);

  // ── Eksport: to'liq (shaxsiy ustunlar bilan), shablon shaklida ──
  const ex = await svc.export('J16', 'u1');
  wb = new ExcelJS.Workbook();
  await wb.xlsx.load(ex.buffer);
  assert.strictEqual(wb.worksheets[0].getCell(10, 10).value, 'AA1234567');
  await assert.rejects(svc.export('J99', 'u1'), /Jadval/);

  // Noto'g'ri fayl
  const plain = new ExcelJS.Workbook();
  plain.addWorksheet('A').addRow(['x', 'y']);
  await assert.rejects(svc.analyze('J10', { buffer: Buffer.from(await plain.xlsx.writeBuffer()), originalname: 'x.xlsx' }, 'u1'), /Sarlavha qatori topilmadi/);
  const noPin = new ExcelJS.Workbook();
  noPin.addWorksheet('A').addRow(['Т.р', 'ФИО', 'Тузилмаси', 'Лавозими']);
  await assert.rejects(svc.analyze('J10', { buffer: Buffer.from(await noPin.xlsx.writeBuffer()), originalname: 'x.xlsx' }, 'u1'), /JShShIR/);

  // Audit — shaxsiy qiymatlarsiz
  assert.ok(audit.logs.filter((l) => l.entity === 'hr_sheet').length >= 8);
  assert.ok(!JSON.stringify(audit.logs.filter((l) => l.entity === 'hr_sheet')).match(/AA1234567|Sinov manzil|3000000000000/), 'auditda shaxsiy ma\'lumot yo\'q');
  clearHrCache();
  console.log('OK t-hr-sheets');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});