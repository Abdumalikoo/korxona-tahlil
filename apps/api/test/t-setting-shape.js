// settings bloklari buzilgan bo'lsa — amal to'xtaydi, ma'lumot ustidan yozilmaydi; tanilmagan yozuvlar jim o'chmaydi. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { UnitPayrollService } = require('../dist/modules/unit-payroll/unit-payroll.service');
const { ChatStore } = require('../dist/modules/source-chat/chat.store');
const { shapeOf, ObjectMap, listBlock } = require('../dist/common/settings/shape');

const quiet = require('@nestjs/common').Logger;
quiet.overrideLogger(['fatal']);

(async () => {
  // Sxema
  assert.strictEqual(shapeOf('k', null, ObjectMap), null);
  assert.deepStrictEqual(shapeOf('k', { a: 1 }, ObjectMap), { a: 1 });
  assert.throws(() => shapeOf('unit.staff', [1, 2], ObjectMap), /«unit.staff» sozlamasi kutilgan ko'rinishda emas/);
  assert.throws(() => shapeOf('k', 'matn', ObjectMap), /kutilgan/);
  assert.deepStrictEqual(shapeOf('k', { moves: [], extra: 1 }, listBlock('moves')), { moves: [], extra: 1 }, 'qo\'shimcha maydonlar saqlanadi');
  assert.throws(() => shapeOf('k', { moves: 'x' }, listBlock('moves')), /kutilgan/);

  const db = fakeDb();
  const T = db.tables;
  T.region.push({ code: 0, name: 'Markaz', isActive: true });
  T.employee.push({ pinfl: '30101900000001', fullName: 'Sinov Bir', isActive: true, regionCode: 0, departmentId: null, position: null });
  const up = new UnitPayrollService(db.client, { async log() {} });

  // 1. Buzilgan blok — xato, bazadagi qiymat o'zgarmaydi
  T.setting.push({ key: 'unit.moves', value: ['buzilgan'] });
  await assert.rejects(up.addMove({ pinfl: '30101900000001', unit: 'TAX_FREE', from: '2026-03' }, 'a1'), /«unit.moves» sozlamasi kutilgan ko'rinishda emas/);
  assert.deepStrictEqual(T.setting.find((s) => s.key === 'unit.moves').value, ['buzilgan'], "ustidan yozilmadi");
  T.setting.find((s) => s.key === 'unit.staff') || T.setting.push({ key: 'unit.staff', value: 'buzuq' });
  await assert.rejects(up.addStaff('TAX_FREE', { pinfl: '30101900000001' }, 'a1'), /«unit.staff»/);
  assert.strictEqual(T.setting.find((s) => s.key === 'unit.staff').value, 'buzuq');

  // 2. Tanilmagan yozuv (eski bo'lim kodi) — yangi ko'chishda jim o'chmaydi
  T.setting.find((s) => s.key === 'unit.moves').value = { moves: [{ id: 'eski', pinfl: '30101900000009', unit: 'ESKI_BOLIM', from: '2025-01' }] };
  T.setting.splice(T.setting.findIndex((s) => s.key === 'unit.staff'), 1);
  const m = await up.addMove({ pinfl: '30101900000001', unit: 'TAX_FREE', from: '2026-03' }, 'a1');
  let saved = T.setting.find((s) => s.key === 'unit.moves').value.moves;
  assert.deepStrictEqual(saved.map((x) => x.id), ['eski', m.id], 'eski yozuv saqlanib qoldi');
  await up.removeMove(m.id, 'a1');
  saved = T.setting.find((s) => s.key === 'unit.moves').value.moves;
  assert.deepStrictEqual(saved.map((x) => x.id), ['eski']);

  // 3. Chat: buzilgan ro'yxat — xato, o'zgarmaydi
  const store = new ChatStore(db.client, 'u1');
  T.setting.push({ key: 'chat.source.u1.index', value: { threads: 'buzuq' } });
  await assert.rejects(store.threads(), /«chat.source.u1.index»/);
  assert.deepStrictEqual(T.setting.find((s) => s.key === 'chat.source.u1.index').value, { threads: 'buzuq' });
  console.log('OK t-setting-shape');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});