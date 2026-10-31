// Moddalar boshqaruvi: ro'yxat (yozuvlar soni/summasi), moddani guruhga ko'chirish, aylana va yozuvli moddaga ko'chirish
// taqiqlangan, bo'sh moddaga ko'chirilsa — guruhga aylanadi, eski guruh bo'sh qolsa — oddiy modda. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { CategoriesService } = require('../dist/modules/categories/categories.service');

(async () => {
  const db = fakeDb();
  const T = db.tables;
  const cat = (code, label, parentCode, isLeaf, order = 1) => T.category.push({ code, label, parentCode, isLeaf, isActive: true, order, keywords: [], behavior: 'VARIABLE', scope: 'GENERAL' });
  cat('BOSHQA', 'Boshqa xarajat', null, false, 100);
  cat('SOLIQ_X', 'Soliq (namuna)', 'BOSHQA', true, 1);
  cat('KANS', 'Kanselyariya', 'BOSHQA', true, 2);
  cat('SOLIQLAR', 'Soliqlar', null, false, 200);
  cat('BOSH_BOLIM', "Bo'sh bo'limcha", 'SOLIQLAR', true, 1);
  cat('YOLG', 'Yolg‘iz', 'BOSHQA2', true, 1);
  cat('BOSHQA2', 'Boshqa 2', null, false, 300);
  const ex = (id, categoryCode, amount) => T.expense.push({ id, categoryCode, amountTiyin: BigInt(amount), deletedAt: null, period: '2026-09', date: new Date('2026-09-15') });
  ex('e1', 'SOLIQ_X', 500);
  ex('e2', 'SOLIQ_X', 300);
  ex('e3', 'KANS', 100);
  const svc = new CategoriesService(db.client);

  // Ro'yxat — yozuvlar soni va summasi
  const list = await svc.manageList();
  const row = (c) => list.find((x) => x.code === c);
  assert.deepStrictEqual([row('SOLIQ_X').count, row('SOLIQ_X').totalTiyin], [2, '800']);
  assert.deepStrictEqual([row('BOSHQA').count, row('BOSHQA').totalTiyin], [0, '0'], 'guruhning o‘zida yozuv yo‘q');

  // Ko'chirish: Boshqa xarajat › Soliq → Soliqlar
  const m = await svc.move('SOLIQ_X', 'SOLIQLAR');
  assert.deepStrictEqual([m.from, m.to], ['BOSHQA', 'SOLIQLAR']);
  assert.strictEqual(T.category.find((c) => c.code === 'SOLIQ_X').parentCode, 'SOLIQLAR');
  assert.strictEqual(T.expense.filter((e) => e.categoryCode === 'SOLIQ_X').length, 2, 'yozuvlar o‘zgarmadi');

  // Aylana: guruhni o'z ichidagi bo'limchaga
  await assert.rejects(svc.move('SOLIQLAR', 'BOSH_BOLIM'), /o'ziga yoki o'z ichidagi/);
  await assert.rejects(svc.move('SOLIQLAR', 'SOLIQLAR'), /o'ziga yoki o'z ichidagi/);
  // Yozuvi bor moddaga ko'chirib bo'lmaydi
  await assert.rejects(svc.move('KANS', 'SOLIQ_X'), /yozuvlari bor modda/);
  // Bo'sh moddaga ko'chirilsa — u guruhga aylanadi
  await svc.move('KANS', 'BOSH_BOLIM');
  assert.strictEqual(T.category.find((c) => c.code === 'BOSH_BOLIM').isLeaf, false, 'bo‘sh modda guruhga aylandi');
  // Eski guruh bo'sh qoldi — oddiy moddaga aylanadi
  assert.strictEqual(T.category.find((c) => c.code === 'BOSHQA').isLeaf, true, 'bo‘sh qolgan guruh — oddiy modda');
  // Eng yuqori darajaga
  const top = await svc.move('YOLG', null);
  assert.strictEqual(top.to, null);
  assert.strictEqual(T.category.find((c) => c.code === 'BOSHQA2').isLeaf, true);
  await assert.rejects(svc.move('YOQ', 'SOLIQLAR'), /topilmadi/);
  await assert.rejects(svc.move('KANS', 'YOQ'), /Guruh topilmadi/);
  console.log('OK t-categories-move');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
