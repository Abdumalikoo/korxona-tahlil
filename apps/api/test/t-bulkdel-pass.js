// O'chirish: Mashinalar xarajatlari, «Hammasi», o'chirish paroli (50 tadan ortiq), parolni o'zgartirish. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { PayrollService } = require('../dist/modules/payroll/payroll.service');
const { PeriodCloseService } = require('../dist/modules/regional-data/period-close.service');
const { QualityService } = require('../dist/modules/regional-data/quality.service');
const { BulkDeleteService } = require('../dist/modules/bulk-delete/bulk-delete.service');
const { DeletePasswordService } = require('../dist/modules/bulk-delete/delete-password.service');
const { FixedAssetsService } = require('../dist/modules/fixed-assets/fixed-assets.service');
const { ExpensesService } = require('../dist/modules/expenses/expenses.service');

const db = fakeDb();
const T = db.tables;
T.region.push({ code: 0, name: 'Markaz', isActive: true }, { code: 3, name: 'Andijon viloyati', isActive: true });
T.user.push({ id: 'a1', role: 'ADMIN', fullName: 'Admin' }, { id: 'a2', role: 'ADMIN', fullName: 'Admin 2' });
const D = (s) => new Date(s + 'T07:00:00Z');
let n = 0;
const exp = (date, som, source = 'MANUAL') => {
  const id = `e${++n}`;
  T.expense.push({ id, date: D(date), period: date.slice(0, 7), regionCode: 0, districtId: null, amountTiyin: BigInt(som * 100), source, section: 'DOIMIY', deletedAt: null, description: `X${n}`, categoryCode: 'C1', payrollBatchId: null });
  return id;
};
// Mashinalar: 3 ta yozuv (xarajat bilan bog'langan)
const v1 = exp('2026-01-12', 471500, 'VEHICLE');
const v2 = exp('2026-01-12', 632500, 'VEHICLE');
const v3 = exp('2026-02-03', 540000, 'VEHICLE');
for (const [i, e] of [v1, v2, v3].entries()) T.vehicleRecord.push({ id: `vr${i}`, vehicleId: 'car1', expenseId: e, importKey: `k${i}`, deletedAt: null });
const w1 = exp('2026-01-15', 1000, 'WAREHOUSE');
// Yana 60 ta oddiy xarajat (fevral)
for (let i = 0; i < 60; i++) exp('2026-02-10', 100 + i);

(async () => {
  const audit = new AuditService(db.client);
  const closes = new PeriodCloseService(db.client, audit, new QualityService(db.client));
  const fa = new FixedAssetsService(db.client, audit);
  const pw = new DeletePasswordService(db.client, audit);
  const svc = new BulkDeleteService(db.client, new PayrollService(db.client), closes, audit, null, null, null, null, fa, pw);
  const A = { id: 'a1', role: 'ADMIN' };

  // ── Mashinalar xarajati endi o'chiriladi; Ombor kirimi — yo'q ──
  let p = await svc.preview({ target: 'EXPENSE', mode: 'ids', ids: [v1, v2, w1] }, A);
  assert.strictEqual(p.count, 2);
  assert.deepStrictEqual(p.locked.map((l) => l.key), ['WAREHOUSE']);
  assert.ok(p.allowed && !p.needsPassword);
  const r = await svc.execute({ target: 'EXPENSE', mode: 'ids', ids: [v1, v2, w1] }, A);
  assert.strictEqual(r.count, 2);
  assert.ok(T.expense.find((e) => e.id === v1).deletedAt);
  assert.ok(!T.expense.find((e) => e.id === w1).deletedAt);
  const rec0 = T.vehicleRecord.find((x) => x.id === 'vr0');
  assert.ok(rec0.deletedAt, "Mashinalar yozuvi ham o'chdi");
  assert.strictEqual(rec0.importKey, null, "qayta yuklash uchun kalit bo'shatildi");
  assert.ok(!T.vehicleRecord.find((x) => x.id === 'vr2').deletedAt);

  // Savatdan tiklash — Mashinalar yozuvi ham qaytadi
  const exps = new ExpensesService(db.client, audit, fa);
  await exps.restore(v1);
  assert.ok(!T.expense.find((e) => e.id === v1).deletedAt);
  assert.ok(!T.vehicleRecord.find((x) => x.id === 'vr0').deletedAt);

  // ── 50 tadan ortiq — parol kerak ──
  p = await svc.preview({ target: 'EXPENSE', mode: 'month', month: '2026-02' }, A);
  assert.strictEqual(p.count, 61);
  assert.strictEqual(p.needsPassword, true);
  await assert.rejects(svc.execute({ target: 'EXPENSE', mode: 'month', month: '2026-02' }, A), /parol kerak/);
  await assert.rejects(svc.execute({ target: 'EXPENSE', mode: 'month', month: '2026-02', password: '1111' }, A), /noto'g'ri \(4 ta/);
  assert.strictEqual(T.expense.filter((e) => e.period === '2026-02' && !e.deletedAt).length, 61, "hech narsa o'chmadi");
  // Standart parol hammaga ma'lum — u bilan o'chirib bo'lmaydi (avval yangi parol)
  await assert.rejects(svc.execute({ target: 'EXPENSE', mode: 'month', month: '2026-02', password: '3642' }, A), /Standart o'chirish paroli bilan o'chirish yopilgan/);
  assert.strictEqual(T.expense.filter((e) => e.period === '2026-02' && !e.deletedAt).length, 61, "hech narsa o'chmadi");
  assert.strictEqual((await pw.info()).isDefault, true);
  await assert.rejects(pw.change({ current: '0000', next: 'Kuchli-77' }, 'a2'), /noto'g'ri/);
  await assert.rejects(pw.change({ current: '3642', next: '12' }, 'a2'), /6 dan 32/);
  await assert.rejects(pw.change({ current: '3642', next: '7777' }, 'a2'), /6 dan 32/);
  await assert.rejects(pw.change({ current: '3642', next: '123456' }, 'a2'), /juda oddiy/);
  await assert.rejects(pw.change({ current: '3642', next: 'aaaaaaa' }, 'a2'), /juda oddiy/);
  await pw.change({ current: '3642', next: 'Birinchi-1' }, 'a2');
  const r2 = await svc.execute({ target: 'EXPENSE', mode: 'month', month: '2026-02', password: 'Birinchi-1' }, A);
  assert.strictEqual(r2.count, 61);

  // ── «Hammasi» — har doim parol bilan; faqat daromad/xarajat ──
  p = await svc.preview({ target: 'EXPENSE', mode: 'all' }, A);
  assert.strictEqual(p.periodLabel, 'Barcha davrlar');
  assert.strictEqual(p.count, 1); // faqat tiklangan v1 (Ombor kirimi — o'z joyida)
  assert.strictEqual(p.needsPassword, true);
  await assert.rejects(svc.preview({ target: 'PAYROLL', mode: 'all' }, A), /faqat daromad va xarajat/);

  // ── Parolni o'zgartirish ──
  await assert.rejects(pw.change({ current: 'Birinchi-1', next: 'Birinchi-1' }, 'a2'), /farq qilsin/);
  const info = await pw.change({ current: 'Birinchi-1', next: 'Yangi-2026' }, 'a2');
  assert.strictEqual(info.isDefault, false);
  assert.strictEqual(info.updatedBy, 'Admin 2');
  const stored = JSON.stringify(T.setting.find((s) => s.key === 'delete.password').value);
  assert.ok(!stored.includes('Yangi-2026'), "parol ochiq saqlanmaydi");
  await assert.rejects(svc.execute({ target: 'EXPENSE', mode: 'all', password: '3642' }, A), /noto'g'ri/);
  const r3 = await svc.execute({ target: 'EXPENSE', mode: 'all', password: 'Yangi-2026' }, A);
  assert.strictEqual(r3.count, 1);
  assert.strictEqual(T.expense.filter((e) => !e.deletedAt).map((e) => e.source).join(','), 'WAREHOUSE');

  // ── 5 marta noto'g'ri — kutish ──
  for (let i = 0; i < 4; i++) await assert.rejects(pw.verify('x', 'u9'), /noto'g'ri/);
  await assert.rejects(pw.verify('x', 'u9'), /daqiqa kuting/);
  await assert.rejects(pw.verify('Yangi-2026', 'u9'), /daqiqadan keyin/);
  await pw.verify('Yangi-2026', 'a1'); // boshqa foydalanuvchi — ta'sir qilmaydi
  console.log('t-bulkdel-pass OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});