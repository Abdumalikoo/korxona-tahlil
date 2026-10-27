// Internet to'lovlari — bank ko'chirmasidan (выписка): izohdagi shartnoma raqami bo'yicha ajratiladi.
// TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const fakeDb = require('./fakedb');
const { pickInternetPayments } = require('../dist/modules/internet/internet.parse');
const { InternetService } = require('../dist/modules/internet/internet.service');

(async () => {
  const row = (rowIndex, docDate, debit, purpose, accountName = 'Namuna Telekom AJ') => ({ rowIndex, docDate, docNo: String(rowIndex), accountName, inn: '200000001', debitTiyin: String(debit), purpose });
  const r = pickInternetPayments(
    [
      row(2, '2026-02-05', 87900000, 'Оплата за услуги связи январь 2026г сог.дог№CPIO-2789 от 06.01.2025 г.'),
      row(3, '2026-02-06', 50000000, 'Оплата по дог CPIO 4671 за февраль 2026'), // raqam ajratgich bilan — ro'yxatda
      row(4, '2026-02-07', 12000000, "Интернет хизмати учун тўлов, 2026 йил февраль"), // ro'yxatda yo'q, lekin internet
      row(5, '2026-02-08', 99900000, 'Ish haqi fevral 2026', 'Bank'), // internet emas
      row(6, '2026-02-09', 30000000, '26.11.2025-yildagi 1957194541-sonli shartnomaga asosan internet uchun', 'Yangi Provayder MChJ'),
      row(7, '2026-02-10', 5000000, 'Kanselyariya CPIO-27890 dog', 'Ofis MChJ'), // CPIO-2789 emas (uzunroq raqam)
    ],
    ['CPIO-2789', 'CPIO-4671'],
  );
  assert.deepStrictEqual(
    r.payments.map((p) => [p.contractNo, p.period, p.amountTiyin]),
    [
      ['CPIO-2789', '2026-01', 87900000n],
      ['CPIO-4671', '2026-02', 50000000n],
      [null, '2026-02', 12000000n],
      ['1957194541', '2026-02', 30000000n],
    ],
  );
  assert.deepStrictEqual([r.skipped, r.skippedTiyin], [2, 104900000n], "ish haqi va kanselyariya — o'tkazib yuborildi");
  assert.strictEqual(r.providers.get('1957194541'), 'Yangi Provayder MChJ', 'oluvchi — provayder taklifi');
  assert.ok(r.warnings.some((w) => w.includes('shartnoma raqami topilmadi')));

  // Xizmat orqali: haqiqiy .xlsx (выписка shakli)
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Выписка');
  ws.addRow(['Выписка по счету']);
  ws.addRow(['№ п/п', 'Дата документа', 'Дата обработки', '№ док', 'Наименование счёта', 'ИНН', '№ счёта', 'МФО', 'Обороты по дебету', 'Обороты по кредиту', 'Назначение платежа']);
  ws.addRow([1, '05.02.2026', '05.02.2026', '11', 'Namuna Telekom AJ', '200000001', '20208000000000000001', '00001', 879000, 0, 'Оплата за интернет январь 2026г сог.дог№CPIO-2789 от 06.01.2025 г.']);
  ws.addRow([2, '06.02.2026', '06.02.2026', '12', 'Mijoz MChJ', '200000002', '20208000000000000002', '00001', 0, 500000, 'Kirim']);
  ws.addRow([3, '07.02.2026', '07.02.2026', '13', 'Ofis MChJ', '200000003', '20208000000000000003', '00001', 120000, 0, 'Kanselyariya tovarlari']);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const db = fakeDb();
  db.tables.setting.push({ key: 'internet.registry', value: { contracts: [{ contractNo: 'CPIO-2789', provider: null, unit: { kind: 'center' } }] } });
  db.tables.region.push({ code: 0, name: 'Markaz', isActive: true });
  const svc = new InternetService(db.client);
  const a = await svc.analyze({ buffer, originalname: 'vypiska.xlsx' });
  assert.strictEqual(a.format, 'bank');
  assert.deepStrictEqual(a.bank, { rows: 2, skipped: 1, skippedTiyin: '12000000' });
  assert.deepStrictEqual(a.payments.map((p) => [p.contractNo, p.period, p.amountTiyin]), [['CPIO-2789', '2026-01', '87900000']]);
  assert.deepStrictEqual(a.registryFromFile.map((c) => [c.contractNo, c.provider]), [['CPIO-2789', 'Namuna Telekom AJ']], 'ro‘yxatda provayder yo‘q — bankdagi nom taklif');
  assert.strictEqual(a.contracts[0].inRegistry, true);

  // Internet to'lovi yo'q ko'chirma — tushunarli xato
  const wb2 = new ExcelJS.Workbook();
  const ws2 = wb2.addWorksheet('Выписка');
  ws2.addRow(['№ п/п', 'Дата документа', 'Дата обработки', '№ док', 'Наименование счёта', 'ИНН', '№ счёта', 'МФО', 'Обороты по дебету', 'Обороты по кредиту', 'Назначение платежа']);
  ws2.addRow([1, '05.02.2026', '05.02.2026', '11', 'Ofis MChJ', '200000003', '20208000000000000003', '00001', 1000, 0, 'Kanselyariya']);
  await assert.rejects(svc.analyze({ buffer: Buffer.from(await wb2.xlsx.writeBuffer()), originalname: 'v2.xlsx' }), /internet to'lovi topilmadi/);
  console.log('OK t-internet-bank');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
