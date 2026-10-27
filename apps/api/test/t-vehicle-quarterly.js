// Mashinalar › Choraklik hisobot (24-ilova): faqat «Jihozlash» — ta'mirlash xarajati (mashina bo'limiga),
// «Saqlash» (benzin) hisobga olinmaydi, qolgani — statistika; qayta yuklash almashtiradi. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const fakeDb = require('./fakedb');
const { VehiclesService } = require('../dist/modules/vehicles/vehicles.service');
const { VehicleQuarterlyService } = require('../dist/modules/vehicles/vehicles.quarterly');

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  T.region.push({ code: 0, name: 'Markaz', isActive: true });
  T.department.push({ id: 'dX', name: 'Xo‘jalik', isActive: true, order: 1 });
  const vs = new VehiclesService(db.client);
  const audit = { log: async () => {} };
  const q = new VehicleQuarterlyService(db.client, vs, audit);
  const a = await vs.create({ plateNumber: '01 111 AAA', model: 'Damas', fuelType: 'AI92' }, 'adm');
  await vs.create({ plateNumber: '01 222 BBB', model: 'Nexia', fuelType: 'AI92' }, 'adm');
  await vs.setPlaces({ items: [{ id: a.id, unit: 'MARKSHEYDER' }] }, 'adm');

  // Shablon → to'ldirish
  const tpl = await q.template('2026', '1');
  assert.match(tpl.filename, /2026-1-chorak/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(tpl.buffer);
  const ws = wb.worksheets[0];
  assert.strictEqual(ws.getCell('C3').value, '2026-yilining 1 choragi');
  assert.strictEqual(ws.getCell('J4').value, 'Jixozlash xarajatlari');
  // 6-qator: 01 111 AAA, 7: 01 222 BBB; 8 — yangi mashina (ro'yxatda yo'q)
  ws.getCell('H6').value = '51 375,71';
  ws.getCell('I6').value = 1371.4; // saqlash — benzin, hisobga olinmaydi
  ws.getCell('J6').value = 15452.5; // ming so'm
  ws.getCell('K6').value = 2231;
  ws.getCell('L6').value = 88731;
  ws.getCell('I7').value = 5775; // jihozlash yo'q
  ws.getRow(8).values = [3, ' "Soliq - servis" AJ', 'Tracker', '01 327 DNA', 2018, 2025, 1, 0, 6335.1, 600, 3920, 129728];
  const file = Buffer.from(await wb.xlsx.writeBuffer());

  const an = await q.analyze({ buffer: file, size: file.length, originalname: 'c.xlsx' });
  assert.strictEqual(an.year, 2026);
  assert.strictEqual(an.quarter, 1);
  assert.strictEqual(an.rows.length, 3);
  const r1 = an.rows.find((r) => r.plate === '01 111 AAA');
  assert.strictEqual(r1.equipTiyin, String(15452500n * 100n));
  assert.strictEqual(r1.balanceValueTiyin, String(51375710n * 100n));
  assert.strictEqual(r1.distancePeriodKm, 2231);
  assert.strictEqual(an.rows.find((r) => r.plate === '01 327 DNA').vehicleId, null);

  const c = await q.commit({ year: an.year, quarter: an.quarter, scale: an.scale, fileName: 'c.xlsx', rows: an.rows }, 'adm');
  assert.strictEqual(c.records, 2, 'faqat jihozlash > 0');
  assert.strictEqual(c.createdVehicles, 1);
  const recs = T.vehicleRecord.filter((r) => !r.deletedAt && r.importKey?.startsWith('quarter:2026-Q1:'));
  assert.strictEqual(recs.length, 2);
  assert.ok(recs.every((r) => r.kind === 'REPAIR'));
  const exp = (r) => T.expense.find((e) => e.id === r.expenseId);
  const damas = recs.find((r) => r.vehicleId === a.id);
  assert.strictEqual(exp(damas).segment, 'MARKSHEYDER', "mashina bo'limiga tortildi");
  assert.strictEqual(exp(damas).period, '2026-03');
  assert.strictEqual(String(exp(damas).amountTiyin), String(15452500n * 100n));
  assert.ok(!T.expense.some((e) => !e.deletedAt && String(e.amountTiyin) === String(1371400n * 100n)), 'saqlash yozilmadi');

  // Qayta yuklash — almashtiradi
  an.rows[0].equipTiyin = String(1000000n * 100n);
  an.rows[2].equipTiyin = '0';
  const c2 = await q.commit({ year: 2026, quarter: 1, scale: 'THOUSAND', fileName: 'c2.xlsx', rows: an.rows }, 'adm');
  assert.strictEqual(c2.records, 1);
  const alive = T.vehicleRecord.filter((r) => !r.deletedAt && r.importKey?.startsWith('quarter:2026-Q1:'));
  assert.strictEqual(alive.length, 1);
  assert.strictEqual(String(alive[0].amountTiyin), String(1000000n * 100n));

  const list = await q.list();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].rows.length, 3);

  const rm = await q.remove('2026-Q1', 'adm');
  assert.strictEqual(rm.removed, 1);
  assert.strictEqual((await q.list()).length, 0);
  console.log('t-vehicle-quarterly OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
