// Solishtirma ichma-ich: «Mashina xarajatlari» — qaysi mashinaga qancha, turlari va izoh (birlik bo'yicha). TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { VehiclesService } = require('../dist/modules/vehicles/vehicles.service');
const { VehicleCostsService } = require('../dist/modules/structure/vehicle-costs.service');

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  T.region.push({ code: 0, name: 'Markaz', isActive: true }, { code: 3, name: 'Andijon viloyati', isActive: true });
  T.department.push({ id: 'dX', name: 'Xo‘jalik', isActive: true, order: 1 });
  const vs = new VehiclesService(db.client);
  const a = await vs.create({ plateNumber: '01 111 AAA', model: 'Damas', fuelType: 'AI92' }, 'adm');
  const b = await vs.create({ plateNumber: '01 222 BBB', model: 'Nexia', fuelType: 'AI92' }, 'adm');
  await vs.setPlaces({ items: [{ id: a.id, unit: 'MARKSHEYDER', comment: 'Dala ishlari' }, { id: b.id, unit: 'CENTER', departmentId: 'dX' }] }, 'adm');
  await vs.createRecord({ vehicleId: a.id, kind: 'FUEL', date: '2026-03-05', amountTiyin: '100000' }, 'adm');
  await vs.createRecord({ vehicleId: a.id, kind: 'REPAIR', date: '2026-03-20', amountTiyin: '50000' }, 'adm');
  await vs.createRecord({ vehicleId: a.id, kind: 'FUEL', date: '2026-02-10', amountTiyin: '70000' }, 'adm');
  await vs.createRecord({ vehicleId: b.id, kind: 'WASH', date: '2026-03-07', amountTiyin: '9000' }, 'adm');

  const svc = new VehicleCostsService(db.client);
  const m = await svc.costs({ unit: 's:MARKSHEYDER', from: '2026-03-01', to: '2026-03-31', compare: 'prev' });
  assert.strictEqual(m.items.length, 1);
  assert.strictEqual(m.items[0].plateNumber, '01 111 AAA');
  assert.strictEqual(m.items[0].comment, 'Dala ishlari');
  assert.strictEqual(m.totalTiyin, '150000');
  assert.strictEqual(m.previousTotalTiyin, '70000', 'fevral — o‘tgan davr');
  assert.deepStrictEqual(m.items[0].kinds.map((k) => [k.kind, k.amountTiyin]), [['FUEL', '100000'], ['REPAIR', '50000']]);

  const c = await svc.costs({ unit: 'dep:dX', from: '2026-03-01', to: '2026-03-31' });
  assert.strictEqual(c.items.length, 1);
  assert.strictEqual(c.items[0].plateNumber, '01 222 BBB');
  const center = await svc.costs({ unit: 'center', from: '2026-03-01', to: '2026-03-31' });
  assert.strictEqual(center.totalTiyin, '9000', "Markaz — faqat Markaz mashinalari (yo'nalish emas)");
  await assert.rejects(() => svc.costs({ unit: 'xyz', from: '2026-03-01', to: '2026-03-31' }), /noto'g'ri/);
  console.log('t-vehicle-costs OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
