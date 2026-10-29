// Kassa kunlik fayli (parseImport): matnli summa, o'qilmagan katak (jim bo'sh qolmaydi), kirill nom, tanilmagan qator.
// TEST MA'LUMOTLARI SUN'IY (hisob raqamlarsiz — faqat nom bo'yicha moslashtirish).
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const fakeDb = require('./fakedb');
const { CashbookService } = require('../dist/modules/cashbook/cashbook.service');

(async () => {
  const db = fakeDb();
  const svc = new CashbookService(db.client, { log: async () => {} });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Kunlik');
  ws.getRow(4).values = ['T/r', 'Hisobraqam nomi', 'Hisob raqami', 'Yil boshidan', 'Oy boshidan', 'Qaytarilgan', 'Kunlik tushum', '30.01.2026 holatiga qoldiq'];
  ws.addRow(['4', 'Tax free (10 %)', '', '1,234,567', '1 234,5', '', 'abc', 100]);
  ws.addRow(['', 'Андижон в.', '', 10, 20, '', 5, 30]);
  ws.addRow(['', 'Mutlaqo yangi hisobraqam', '', 1, 1, '', 1, 1]);
  const r = await svc.parseImport(Buffer.from(await wb.xlsx.writeBuffer()));

  const acc = await svc.accounts();
  const byName = (re) => acc.find((a) => re.test(a.name) && !a.isHeader);
  const tax = r.values[byName(/^Tax free \(10/).id];
  const thousand = (n) => String(BigInt(Math.round(n * 1000)) * 100n); // ming so'm → tiyin
  assert.strictEqual(r.date, '2026-01-30');
  assert.deepStrictEqual([tax.ytd, tax.mtd], [thousand(1234567), thousand(1234.5)], 'matnli summa — minglik va kasr ajratgichlar');
  assert.strictEqual(tax.daily, null);
  assert.strictEqual(r.invalid.length, 1, 'o‘qilmagan katak — ro‘yxatda (jim bo‘sh emas)');
  assert.match(r.invalid[0], /Tax free.*Kunlik tushum.*abc/);
  const andijon = r.values[byName(/^Andijon v\./).id];
  assert.ok(andijon && andijon.ytd === thousand(10), 'kirill nom — lotindagi hisobraqamga');
  assert.deepStrictEqual(r.unmatched, ['Mutlaqo yangi hisobraqam'], 'tanilmagan qator — ro‘yxatda');

  console.log('t-cashbook-import: OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
