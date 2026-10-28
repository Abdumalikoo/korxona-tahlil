// Hisobga olinmaydigan tushumlar (depozit, ustav fondi): tekshiruv, oyma-oy jami, tahrir, o'chirish, Excel;
// daromad jadvaliga (incomes) HECH NARSA yozilmaydi. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { ExcludedIncomesService } = require('../dist/modules/excluded-incomes/excluded-incomes.service');

(async () => {
  const db = fakeDb();
  const D = db.tables;
  const logs = [];
  const svc = new ExcludedIncomesService(db.client, { async log(x) { logs.push(x); } });
  const ADM = { id: 'adm', fullName: 'Admin Test' };

  // Tekshiruv
  await assert.rejects(() => svc.create(ADM, { kind: 'YOQ', date: '2026-05-10', amountTiyin: 100 }), /Turini/);
  await assert.rejects(() => svc.create(ADM, { kind: 'DEPOZIT', date: '2026-13-10', amountTiyin: 100 }), /Sana/);
  await assert.rejects(() => svc.create(ADM, { kind: 'DEPOZIT', date: '2026-05-10', amountTiyin: 0 }), /noldan/);
  await assert.rejects(() => svc.create(ADM, { kind: 'DEPOZIT', date: '2026-05-10', amountTiyin: '12.5' }), /butun/);
  await assert.rejects(() => svc.create(ADM, { kind: 'DEPOZIT', date: '2026-05-10', amountTiyin: '-5' }), /butun/);

  // Kiritish (katta summa — BigInt matn sifatida)
  const a = await svc.create(ADM, { kind: 'DEPOZIT', date: '2026-05-10', amountTiyin: '500000000000', note: ' muddatli depozit ' });
  const b = await svc.create(ADM, { kind: 'USTAV_FONDI', date: '2026-05-20', amountTiyin: 150000 });
  await svc.create(ADM, { kind: 'DEPOZIT', date: '2026-07-01', amountTiyin: 100 });
  assert.strictEqual(a.note, 'muddatli depozit');
  assert.strictEqual(a.createdBy, 'Admin Test');

  const l = await svc.list('2026-05', '2026-06');
  assert.strictEqual(l.items.length, 2, 'davrdan tashqari (iyul) kirmaydi');
  assert.strictEqual(l.totalTiyin, '500000150000');
  assert.deepStrictEqual(l.kinds.map((k) => [k.code, k.totalTiyin]), [['DEPOZIT', '500000000000'], ['USTAV_FONDI', '150000']]);
  assert.deepStrictEqual(l.months.map((m) => [m.period, m.totalTiyin]), [['2026-05', '500000150000'], ['2026-06', '0']]);
  assert.strictEqual(l.items[0].id, b.id, 'yangi sana birinchi');
  await assert.rejects(() => svc.list('2026-06', '2026-05'), /Davr/);

  // Tahrir va o'chirish
  const u = await svc.update(ADM, b.id, { kind: 'USTAV_FONDI', date: '2026-06-02', amountTiyin: 200000 });
  assert.strictEqual(u.updatedBy, 'Admin Test');
  assert.deepStrictEqual((await svc.list('2026-05', '2026-06')).months.map((m) => m.totalTiyin), ['500000000000', '200000']);
  await assert.rejects(() => svc.update(ADM, 'yoq', { kind: 'DEPOZIT', date: '2026-06-02', amountTiyin: 1 }), /topilmadi/);
  await svc.remove(ADM, a.id);
  await assert.rejects(() => svc.remove(ADM, a.id), /topilmadi/);
  assert.strictEqual((await svc.list('2026-01', '2026-12')).items.length, 2);

  // Daromadga tegmaydi; har amal tarixda
  assert.strictEqual(D.income.length, 0, 'incomes jadvaliga yozilmaydi');
  assert.deepStrictEqual(D.setting.map((s) => s.key), ['excluded_income.items']);
  assert.deepStrictEqual(logs.map((x) => x.action), ['CREATE', 'CREATE', 'CREATE', 'UPDATE', 'DELETE']);

  // Bankdan kelgani — bu yerda tahrirlanmaydi va o'chirilmaydi (Bank ko'chirmasida bekor qilinadi)
  D.setting[0].value.push({ id: 'bank1', kind: 'DEPOZIT', date: '2026-08-01', amountTiyin: '1000', note: null, createdAt: '2026-08-01T00:00:00Z', createdBy: 'x', updatedAt: null, updatedBy: null, source: 'BANK' });
  await assert.rejects(() => svc.update(ADM, 'bank1', { kind: 'DEPOZIT', date: '2026-08-01', amountTiyin: 5 }), /bank ko'chirmasidan/);
  await assert.rejects(() => svc.remove(ADM, 'bank1'), /bank ko'chirmasidan/);

  // Excel
  const f = await svc.export('2026-01', '2026-12');
  assert.ok(f.buffer.length > 1000 && f.filename.endsWith('.xlsx'));
  console.log('OK t-excluded-incomes');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
