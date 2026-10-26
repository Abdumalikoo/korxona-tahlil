// Hududlar tushumi: xizmatlar kesimidagi shablon (bitta varaq, ustunlarda viloyatlar, har xizmat — Soni/Summasi)
// yaratiladi va o'qiladi; raqamsiz qo'shimcha (bepul) qatorlar jamiga qo'shilmaydi. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const { RegionalIncomeService } = require('../dist/modules/incomes/regional-income.service');

const REGIONS = [
  [3, 'Andijon viloyati'], [6, 'Buxoro viloyati'], [8, 'Jizzax viloyati'], [10, 'Qashqadaryo viloyati'],
  [12, 'Navoiy viloyati'], [14, 'Namangan viloyati'], [18, 'Samarqand viloyati'], [22, 'Surxondaryo viloyati'],
  [24, 'Sirdaryo viloyati'], [26, 'Toshkent shahri'], [27, 'Toshkent viloyati'], [30, "Farg'ona viloyati"],
  [33, 'Xorazm viloyati'], [35, "Qoraqalpog'iston Respublikasi"],
].map(([code, name]) => ({ code, name }));
const SERVICES = Array.from({ length: 39 }, (_, i) => ({
  code: `SRV_${String(i + 1).padStart(2, '0')}`,
  label: i === 38 ? 'Boshqa xizmatlar' : `Sinov xizmati ${i + 1}`,
}));

const prisma = {
  region: { findMany: async () => [...REGIONS].reverse() },
  district: { findMany: async () => [] },
  incomeCategory: { findMany: async () => SERVICES },
  income: { count: async () => 0 },
};

(async () => {
  const svc = new RegionalIncomeService(prisma);
  const { buffer, filename } = await svc.buildTemplate('2026-01');
  assert.strictEqual(filename, 'Hududiy-daromadlar-xizmatlar-2026-01.xlsx');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  assert.strictEqual(wb.worksheets.length, 1, 'bitta varaq');
  const ws = wb.worksheets[0];
  assert.match(String(ws.getCell('B1').value), /Soliq-servis/);
  assert.strictEqual(ws.getCell('B2').value, "Xizmatlar bo'yicha hisobot (2026-01-01 dan 2026-01-31 gacha)");
  assert.strictEqual(ws.getCell('B3').value, 'Xizmat nomi');
  assert.strictEqual(ws.getCell('C3').value, "O'lchov birligi");
  assert.strictEqual(ws.getCell('D3').value, "Jami Respublika bo'yicha");
  assert.strictEqual(ws.getCell('E3').value, 'shundan,');
  assert.deepStrictEqual(REGIONS.map((_, i) => ws.getCell(4, 5 + i).value), REGIONS.map((r) => r.name), 'viloyatlar tartibi');
  assert.strictEqual(ws.getCell('B5').value, "Jami ko'rsatilgan xizmatlar");
  assert.strictEqual(ws.getCell('C5').value, 'Soni');
  assert.strictEqual(ws.getCell('C6').value, 'Summasi');
  assert.match(ws.getCell('E5').formula, /^SUMIF\(\$C\$7:\$C\$84,"Soni",E\$7:E\$84\)$/);
  assert.strictEqual(ws.getCell('A7').value, 1);
  assert.strictEqual(ws.getCell('B7').value, 'Sinov xizmati 1');
  assert.strictEqual(ws.getCell('A83').value, 39);
  assert.strictEqual(ws.getCell('D7').formula, 'SUM(E7:R7)');
  assert.match(String(ws.getCell('B85').value), /Bepul/);
  assert.strictEqual(ws.getCell('B87').value, "PF-95 bo'yicha bepul xizmat");
  assert.strictEqual(ws.getCell('A85').value, null, 'qo‘shimcha qator raqamsiz');

  // To'ldirib, qayta o'qish
  ws.getCell('E7').value = 3; // Andijon, 1-xizmat soni
  ws.getCell('E8').value = 150000.5; // summasi
  ws.getCell('N10').value = 2500; // Toshkent shahri (N), 2-xizmat summasi
  ws.getCell('R84').value = 700; // Qoraqalpog'iston, 39-xizmat summasi
  ws.getCell('F86').value = 99999; // qo'shimcha (bepul) qator — jamiga kirmaydi
  const out = Buffer.from(await wb.xlsx.writeBuffer());

  const res = await svc.analyze('2026-01', { buffer: out, originalname: filename });
  const pick = (region, code) => res.rows.find((r) => r.regionCode === region && r.categoryCode === code);
  assert.strictEqual(res.rows.length, 3);
  assert.strictEqual(pick(3, 'SRV_01').amountTiyin, 15000050n);
  assert.strictEqual(pick(3, 'SRV_01').quantity, 3);
  assert.strictEqual(pick(26, 'SRV_02').amountTiyin, 250000n);
  assert.strictEqual(pick(35, 'SRV_39').amountTiyin, 70000n);
  assert.strictEqual(res.totalTiyin, 15000050n + 250000n + 70000n);
  assert.strictEqual(res.unknownServices.length, 0, 'qo‘shimcha qatorlar tanilmagan xizmat emas');
  assert.ok(res.unknownSheets.some((m) => /qo'shimcha qator/.test(m)), 'to‘ldirilgan bepul qator haqida ogohlantirish');
  assert.strictEqual(res.districtRows, 0);

  console.log('t-regional-template OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
