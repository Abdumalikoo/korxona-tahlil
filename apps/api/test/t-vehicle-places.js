// Mashinani bo'limga biriktirish: Markaz bo'limi / hudud / yo'nalish (Marksheyder) + izoh;
// bor xarajatlari ko'chadi, keyingi yuklashlar (benzin hisoboti) avtomatik shu joyga. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { VehiclesService } = require('../dist/modules/vehicles/vehicles.service');

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  T.region.push({ code: 0, name: 'Markaz', isActive: true }, { code: 3, name: 'Andijon viloyati', isActive: true });
  T.department.push({ id: 'dBux', name: 'Buxgalteriya', isActive: true, order: 1 });
  const svc = new VehiclesService(db.client);
  const { id } = await svc.create({ plateNumber: '01 A 123 BC', model: 'Cobalt', fuelType: 'AI92' }, 'adm');

  const r1 = await svc.createRecord({ vehicleId: id, kind: 'FUEL', date: '2026-01-10', amountTiyin: '100000', liters: 10 }, 'adm');
  const r2 = await svc.createRecord({ vehicleId: id, kind: 'WASH', date: '2026-05-03', amountTiyin: '20000' }, 'adm');
  const exp = (rid) => T.expense.find((e) => e.id === T.vehicleRecord.find((r) => r.id === rid).expenseId);
  assert.strictEqual(exp(r1.id).regionCode, 0, 'boshida — Markaz');

  // 1) Marksheyder yo'nalishiga, izoh bilan
  let res = await svc.setPlaces({ items: [{ id, unit: 'MARKSHEYDER', comment: "Marksheyderlar dala ishida" }] }, 'adm');
  assert.deepStrictEqual(res, { vehicles: 1, expenses: 2 });
  assert.strictEqual(exp(r1.id).segment, 'MARKSHEYDER');
  assert.strictEqual(exp(r1.id).regionCode, null);
  assert.match(exp(r2.id).description, /Izoh: Marksheyderlar dala ishida/);

  // 2) Keyingi yozuv (masalan, benzin hisobotidan) — avtomatik Marksheyderga
  const r3 = await svc.createImportedFuel({ vehicleId: id, kind: 'FUEL', date: '2026-09-01', amountTiyin: '50000', liters: 5 }, 'k1', 'adm');
  assert.strictEqual(exp(r3.id).segment, 'MARKSHEYDER', 'keyingi yuklash — o‘sha bo‘limga');

  let p = await svc.places('2026-01', '2026-09');
  const row = p.items.find((x) => x.id === id);
  assert.strictEqual(row.placeLabel, 'Marksheyder');
  assert.strictEqual(row.comment, 'Marksheyderlar dala ishida');
  assert.strictEqual(row.totalTiyin, '170000');
  assert.strictEqual(p.months.length, 9);

  // 3) Faqat may oyidan boshlab — Markaz › Buxgalteriya
  res = await svc.setPlaces({ items: [{ id, unit: 'CENTER', departmentId: 'dBux' }], fromPeriod: '2026-05' }, 'adm');
  assert.strictEqual(res.expenses, 2, 'may va sentabr');
  assert.strictEqual(exp(r1.id).segment, 'MARKSHEYDER', 'yanvar — o‘zgarmadi');
  assert.strictEqual(exp(r2.id).segment, null);
  assert.strictEqual(exp(r2.id).departmentId, 'dBux');
  assert.strictEqual(exp(r2.id).regionCode, 0);
  p = await svc.places('2026-01', '2026-09');
  assert.strictEqual(p.items[0].placeLabel, 'Markaz › Buxgalteriya');

  // 4) Hudud
  await svc.setPlaces({ items: [{ id, unit: 'REGION', regionCode: 3 }] }, 'adm');
  assert.strictEqual(exp(r1.id).regionCode, 3);
  assert.strictEqual(exp(r1.id).segment, null);
  const r4 = await svc.createRecord({ vehicleId: id, kind: 'WASH', date: '2026-10-01', amountTiyin: '10000' }, 'adm');
  assert.strictEqual(exp(r4.id).regionCode, 3);

  await assert.rejects(() => svc.setPlaces({ items: [{ id, unit: 'REGION', regionCode: 99 }] }, 'adm'), /hudud/);
  await assert.rejects(() => svc.setPlaces({ items: [{ id, unit: 'XYZ' }] }, 'adm'), /noto'g'ri/);
  await assert.rejects(() => svc.setPlaces({ items: [] }, 'adm'), /tanlanmagan/);

  console.log('t-vehicle-places OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
