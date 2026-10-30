// Excel eksport: 3 varaq (Jadval, Tushuntirish, Ma'lumot), formatlar (so'm, foiz), jami qator, ustun izohlari, chegaralar.
// TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const { ExportXlsxService } = require('../dist/modules/export-xlsx/export-xlsx.service');

(async () => {
  const svc = new ExportXlsxService();
  const header = ['Hudud', 'Daromad', 'Daromad ulushi, %', 'Xarajat', 'Ijtimoiy soliq', 'QQS 12%', 'Natija', 'Rentabellik, %', 'Xodimlar soni'];
  const rows = [
    ['Jami', 1000000, 100, 800000, 60000, 120000, 200000, 20, 12],
    ['Namuna viloyati', 600000, 60, 500000, 36000, 72000, 100000, 16.7, 7],
    ['Sinov viloyati', 400000, 40, 300000, 24000, 48000, -50000, -12.5, 5],
  ];
  const { buffer, filename } = await svc.build({ fileName: 'Hududlar: sinov', header, rows, page: { path: '/solishtirma', name: 'Bosh sahifa › Hududlar', what: 'Hududlar daromadi va xarajati', from: 'Daromadlar va Xarajatlar' }, period: { from: '2026-01-01', to: '2026-09-30' }, workings: [['Natija', 'Daromad − Xarajat']] });
  assert.strictEqual(filename, 'Hududlar  sinov.xlsx', 'fayl nomidan taqiqlangan belgilar olib tashlandi');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  assert.deepStrictEqual(wb.worksheets.map((w) => w.name), ['Jadval', 'Tushuntirish', "Ma'lumot"]);
  const ws = wb.getWorksheet('Jadval');
  assert.strictEqual(ws.getCell(1, 1).value, 'Bosh sahifa › Hududlar', 'sarlavha — sahifa nomi');
  assert.ok(String(ws.getCell(2, 1).value).includes('2026-01-01 — 2026-09-30'), 'davr ko‘rsatilgan');
  assert.strictEqual(ws.getCell(5, 1).value, 'Hudud');
  assert.ok(ws.getCell(5, 2).note, 'ustun izohi (Daromad)');
  assert.strictEqual(ws.getCell(6, 2).numFmt, '#,##0;[Red]-#,##0', "pul — so'm formati");
  assert.strictEqual(ws.getCell(6, 3).numFmt, '0.0"%";[Red]-0.0"%"', 'ulush — foiz');
  assert.strictEqual(ws.getCell(6, 9).numFmt, '#,##0', 'soni — butun son');
  assert.ok(ws.getCell(6, 1).font?.bold, 'Jami qatori qalin');
  assert.ok(!ws.getCell(7, 1).font?.bold, 'oddiy qator qalin emas');
  assert.ok(ws.autoFilter, 'filtr');
  const ex = wb.getWorksheet('Tushuntirish');
  const all = [];
  ex.eachRow((r) => all.push(r.values.filter(Boolean).join(' | ')));
  const textAll = all.join('\n');
  for (const h of header) assert.ok(textAll.includes(h), `ustun tushuntirilgan: ${h}`);
  assert.ok(/Ijtimoiy soliq = .*12%/.test(textAll), 'ijtimoiy soliq formulasi');
  assert.ok(/QQS = .*12%/.test(textAll), 'QQS formulasi');
  assert.ok(/Rentabellik, % = \(Daromad − Xarajat\) ÷ Daromad × 100/.test(textAll), 'rentabellik formulasi');
  assert.ok(textAll.includes('Hududlar daromadi va xarajati'), 'sahifa izohi');
  assert.ok(textAll.includes('Daromad − Xarajat'), 'hisob-kitob');
  const meta = wb.getWorksheet("Ma'lumot");
  assert.strictEqual(meta.getCell(6, 2).value, 3, 'qatorlar soni');
  // Chegaralar
  await assert.rejects(svc.build({ header: [], rows: [] }), /sarlavhasi/);
  await assert.rejects(svc.build({ header: ['A'], rows: Array.from({ length: 50001 }, () => [1]) }), /Qatorlar juda ko/);
  console.log('OK t-export-xlsx');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
