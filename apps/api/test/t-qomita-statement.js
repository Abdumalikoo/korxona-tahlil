// Qo'mita mablag'lari › Bank ko'chirmasidan: izohni tushunish, taklif, qabul qilish, xotira, takror, yuklashni o'chirish.
// TEST MA'LUMOTLARI SUN'IY (to'lovchilar, summalar, shartnoma raqamlari — o'ylab topilgan).
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const fakeDb = require('./fakedb');
const { QomitaService } = require('../dist/modules/qomita/qomita.service');
const { QomitaStatementService } = require('../dist/modules/qomita/qomita-statement.service');
const { interpret, cleanPurpose, monthFromText, invoiceMonth, signatureOf, deptMatch } = require('../dist/modules/qomita/qomita-statement.parse');

const DEPS = [
  { id: 'dM', name: 'Marksheyder' },
  { id: 'dC', name: 'Call markaz' },
  { id: 'dT', name: 'Tax free' },
];

// ── Tushunish (sof) ──
const I = (purpose, comment = '', docDate = '2026-09-21', memory = {}) => interpret({ docDate, purpose, comment, payer: 'Davlat soliq qo‘mitasi' }, DEPS, memory);
assert.strictEqual(I('', 'Marksheyder oylik').target, 'dep:dM');
assert.strictEqual(I('', 'marksheyder').target, 'dep:dM');
assert.strictEqual(I('', '3802 Call Markaz').target, 'dep:dC');
assert.strictEqual(I('', 'Depozit').target, 'DEPOSIT');
assert.strictEqual(I('', 'Depozit').confidence, 'HIGH');
assert.strictEqual(I('', 'qarz qaytishi').target, 'LOAN');
assert.strictEqual(I('', 'Тах фри').target, 'dep:dT', 'kirill izoh');
// Izohsiz — to'lov maqsadidan
const callP = '01.04.2026 й 2026/7-сон шартномага ва 10.08.2026 йилдаги 2026/7-1-сон хисоб фактурага асосан Call-марказ махсус сервиси оркали хизмат';
assert.strictEqual(I(callP).target, 'dep:dC');
assert.strictEqual(I(callP).confidence, 'MEDIUM');
assert.strictEqual(I(callP).period, '2026-08', 'hisob-faktura oyi');
assert.strictEqual(I(callP).periodReason, 'hisob-faktura sanasi');
assert.strictEqual(I('Ер каридан фойдаланувчиларга маркшейдерлик улчовлари').target, 'dep:dM');
assert.strictEqual(I("2026-yil 2-sentabrdagi 3-sonli qarz shartnomasiga asosan olingan mablag' qaytarilmoqda").target, 'LOAN');
assert.strictEqual(I('Noma’lum to‘lov').target, 'SKIP');
assert.strictEqual(I('Noma’lum to‘lov').confidence, 'LOW');
// Izoh to'lov maqsadidan ustun
assert.strictEqual(I(callP, 'Depozit').target, 'DEPOSIT');
// Xotira: shartnoma / majburiyat raqami
assert.strictEqual(signatureOf('12.03.2026 й 45-сон юридик мажбуриятга асосан'), 'majburiyat:45');
assert.strictEqual(signatureOf(callP), 'shartnoma:2026/7');
assert.strictEqual(I('12.03.2026 й 45-сон юридик мажбуриятга асосан').target, 'SKIP');
assert.strictEqual(I('12.03.2026 й 45-сон юридик мажбуриятга асосан', '', '2026-03-15', { 'majburiyat:45': 'DEPOSIT' }).target, 'DEPOSIT');
assert.strictEqual(I('12.03.2026 й 45-сон юридик мажбуриятга асосан', '', '2026-03-15', { 'majburiyat:45': 'dep:yoq' }).target, 'SKIP', "o'chirilgan bo'lim xotirasi — e'tiborsiz");
// Oy
assert.strictEqual(monthFromText('август ойи учун ажратма', '2026-09-05'), '2026-08');
assert.strictEqual(monthFromText('dekabr oyi uchun', '2026-01-10'), '2025-12', "keyingi oy — o'tgan yil");
assert.strictEqual(monthFromText('за сентябрь 2025', '2026-02-01'), '2025-09');
assert.strictEqual(monthFromText('ВМнинг 2025-йил 21-майдаги 325-сон карори', '2026-08-26'), null, 'qaror sanasi — davr emas');
assert.strictEqual(invoiceMonth('11.09.2026 й 2026/2-1-сон хисоб-фактурага асосан'), '2026-09');
assert.strictEqual(I('', 'Marksheyder oylik', '2026-10-07').period, '2026-10', "oy topilmasa — to'lov sanasi");
assert.strictEqual(cleanPurpose('123456~789012~Davlat soliq qo‘mitasi~matn qismi', 'Davlat soliq qo‘mitasi'), 'matn qismi');
assert.strictEqual(deptMatch('Fermer xarajati', DEPS), null);

// ── Fayl (sun'iy ko'chirma) ──
async function statement(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Page 1');
  ws.addRow(['Выписка лицевых счетов']);
  ws.addRow(['№ пп', 'Дата документа', 'Дата обработки', '№ док', 'Наименование счёта', 'ИНН', '№ счёта', 'МФО', 'Обороты по дебету', 'Обороты по кредиту', 'Назначение платежа']);
  rows.forEach((r, i) => ws.addRow([i + 1, r.date, r.date, r.no, r.payer, '300000001', '20208000900000000001', '00014', r.debit ?? 0, r.credit ?? 0, r.purpose, r.comment ?? null]));
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), originalname: "ko'chirma-test.xlsx" };
}

const db = fakeDb();
const T = db.tables;
T.user.push({ id: 'u1', fullName: 'Admin Test' });
T.department.push(
  { id: 'dM', name: 'Marksheyder', code: 'MS', index: 20, isActive: true, order: 1 },
  { id: 'dC', name: 'Call markaz', code: 'CM', index: 22, isActive: true, order: 2 },
);
const audit = { async log() {} };
const qomita = new QomitaService(db.client, audit);
const st = new QomitaStatementService(db.client, audit, qomita);

(async () => {
  const KOM = 'Davlat soliq qo‘mitasi (markaziy apparat)';
  const file = await statement([
    { date: '21.09.2026', no: '101', payer: KOM, credit: 598000000.5, purpose: '1~2~X~28.04.2026 й 2026/2-сон шартномага ва 11.09.2026 й 2026/2-1-сон хисоб-фактурага асосан маркшейдерлик улчовлари', comment: 'Marksheyder oylik' },
    { date: '23.07.2026', no: '102', payer: KOM, credit: 1200000000, purpose: '30.04.2026 й 2026/1-сон шартномага ва 15.07.2026 йилдаги 2026/1-2-сон хисоб фактурага асосан Call-марказ махсус сервиси', comment: '3802 Call Markaz' },
    { date: '03.08.2026', no: '103', payer: KOM, credit: 40000000000, purpose: '29.07.2026 й 67-сон юридик мажбуриятга асосан', comment: 'Depozit' },
    { date: '05.08.2026', no: '104', payer: 'MCHJ Sinov', credit: 5000000, purpose: 'Xizmat uchun to‘lov' },
    { date: '06.08.2026', no: '105', payer: 'MCHJ Sinov', debit: 700000, purpose: 'Chiqim' },
  ]);

  // O'qish: faqat Qo'mitadan (3 ta), izoh ustuni topildi, chiqim yo'q
  const a = await st.analyze(file);
  assert.strictEqual(a.incomingTotal, 4);
  assert.strictEqual(a.qomitaCount, 3);
  assert.strictEqual(a.rows.length, 3);
  assert.strictEqual(a.commentColumn, 12);
  const byNo = Object.fromEntries(a.rows.map((r) => [r.docNo, r]));
  assert.strictEqual(byNo['101'].target, 'dep:dM');
  assert.strictEqual(byNo['101'].period, '2026-09');
  assert.strictEqual(byNo['101'].amountTiyin, '59800000050');
  assert.ok(!byNo['101'].purpose.includes('~'), 'maqsad tozalandi');
  assert.strictEqual(byNo['102'].target, 'dep:dC');
  assert.strictEqual(byNo['103'].target, 'DEPOSIT');
  assert.strictEqual((await st.analyze(file, true)).rows.length, 4, 'hamma kirimlar');
  assert.strictEqual(T.income.length, 0, "o'qishda hech narsa yozilmaydi");

  // Qabul qilish: taklif bo'yicha
  const dec = a.rows.map((r) => ({ rowIndex: r.rowIndex, target: r.target, period: r.period }));
  const c = await st.commit(file, JSON.stringify(dec), 'u1');
  assert.deepStrictEqual([c.written, c.notIncome, c.skipped], [2, 1, 0]);
  assert.strictEqual(c.totalTiyin, String(59800000050n + 120000000000n));
  assert.strictEqual(T.income.length, 2);
  const m = T.income.find((x) => x.contractNo === '101');
  assert.strictEqual(m.segment, 'QOMITA');
  assert.strictEqual(m.categoryCode, 'QOMITA_20', "bo'lim daromad turi yaratildi");
  assert.strictEqual(m.period, '2026-09');
  assert.strictEqual(m.source, 'IMPORT');
  assert.ok(m.importBatchId.startsWith('qomita-bank:'));
  assert.ok(T.incomeCategory.some((x) => x.code === 'QOMITA_22'));

  // Hisobot: sozlanmagan bo'limlar ham chiqadi
  const rep = await qomita.report('2026-07', '2026-09');
  const rM = rep.rows.find((r) => r.key === 'dM');
  assert.ok(rM, 'Marksheyder qatori');
  assert.strictEqual(rM.allocatedTiyin, '59800000050');
  assert.strictEqual(rM.incomeCode, 'QOMITA_20');
  assert.ok(!rep.rows.some((r) => r.key === '-'), "bo'lim ko'rsatilmagan daromad yo'q");
  const det = await qomita.detail('dC', '2026-07', '2026-09');
  assert.strictEqual(det.incomes.length, 1);
  assert.strictEqual(det.incomes[0].origin, 'FILE');

  // Takror yuklash — allaqachon yozilganlar o'tkaziladi, xotira — depozit
  const a2 = await st.analyze(file);
  assert.ok(a2.rows.filter((r) => r.docNo !== '103').every((r) => r.duplicate && r.target === 'SKIP'));
  const c2 = await st.commit(file, JSON.stringify(a.rows.map((r) => ({ rowIndex: r.rowIndex, target: r.target, period: r.period }))), 'u1');
  assert.strictEqual(c2.written, 0);
  assert.strictEqual(T.income.filter((x) => !x.deletedAt).length, 2);
  const mem = T.setting.find((s) => s.key === 'qomita.bank.memory').value;
  assert.strictEqual(mem['majburiyat:67'], 'DEPOSIT');
  assert.strictEqual(mem['shartnoma:2026/2'], 'dep:dM');

  // Xato tanlov
  await assert.rejects(() => st.commit(file, JSON.stringify([{ rowIndex: 3, target: 'dep:yoq', period: '2026-09' }]), 'u1'), /Bo'lim topilmadi/);
  await assert.rejects(() => st.commit(file, JSON.stringify([{ rowIndex: 999, target: 'SKIP' }]), 'u1'), /Qator topilmadi/);
  await assert.rejects(() => st.commit(file, '[]', 'u1'), /tanlanmagan/);

  // Bitta yozuvni o'chirish (fayldan) va qo'lda kiritish — sozlanmagan bo'limga ham
  await qomita.removeIncome(m.id, 'u1');
  assert.ok(m.deletedAt);
  const man = await qomita.addIncome({ departmentId: 'dM', period: '2026-10', amount: '1 000 000' }, 'u1');
  assert.strictEqual(T.income.find((x) => x.id === man.id).categoryCode, 'QOMITA_20');

  // Yuklashlar ro'yxati va butun yuklashni o'chirish
  const ups = await st.uploads();
  assert.strictEqual(ups.length, 2, 'ikkinchisi — faqat depozit (daromad emas)');
  const first = ups.find((u) => u.id === c.uploadId);
  assert.strictEqual(first.liveCount, 1, 'bittasi alohida o\'chirilgan');
  const rm = await st.removeUpload(c.uploadId, 'u1');
  assert.strictEqual(rm.removed, 1);
  assert.strictEqual(T.income.filter((x) => !x.deletedAt && x.importBatchId).length, 0);
  assert.ok((await st.uploads()).find((u) => u.id === c.uploadId).removedAt);
  await assert.rejects(() => st.removeUpload('yoq', 'u1'), /topilmadi/);

  console.log('OK t-qomita-statement');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
