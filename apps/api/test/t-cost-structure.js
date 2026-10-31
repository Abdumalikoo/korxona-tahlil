// Xarajatlar tarkibiy tuzilishi: birlik ko'rinishi (daromad / xarajat moddalari), qidiruv, ko'chirish (birlik va modda),
// avtomatik yozuvlar (ish haqi, soliq) qulflangan, chegaralar. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { FixedAssetsService } = require('../dist/modules/fixed-assets/fixed-assets.service');
const { ExpensesService } = require('../dist/modules/expenses/expenses.service');
const { CostStructureService } = require('../dist/modules/cost-structure/cost-structure.service');

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  T.region.push({ code: 0, name: 'Markaz', isActive: true }, { code: 5, name: 'Namuna viloyati', isActive: true });
  T.department.push({ id: 'd1', code: 'CALL', name: 'Call markaz', index: 1, isActive: true }, { id: 'd2', code: 'MRK', name: 'Marketing', index: 2, isActive: true });
  const cat = (code, label, parentCode = null, isLeaf = true) => T.category.push({ code, label, parentCode, isLeaf, isActive: true, order: 1, keywords: [] });
  cat('BOSHQA', 'Boshqa xarajat', null, false);
  cat('INTERNET', 'Internet', 'BOSHQA');
  cat('SOLIQ_X', 'Soliq (namuna)', 'BOSHQA');
  cat('PAYROLL_BASE', 'Ish haqi');
  T.incomeCategory.push({ code: 'SRV', label: 'Xizmat', isActive: true, order: 1 });
  const d = new Date('2026-09-15T07:00:00Z');
  const ex = (id, categoryCode, amount, extra) => T.expense.push({ id, date: d, period: '2026-09', amountTiyin: BigInt(amount), categoryCode, regionCode: 0, departmentId: 'd1', segment: null, districtId: null, source: 'MANUAL', description: null, bankPurpose: null, counterparty: null, counterpartyInn: null, documentNo: null, deletedAt: null, createdById: 'adm', ...extra });
  ex('e1', 'INTERNET', 1000, { bankPurpose: 'Internet xizmati uchun tolov', counterparty: 'NAMUNA TELEKOM' });
  ex('e2', 'INTERNET', 500, {});
  ex('e3', 'PAYROLL_BASE', 9000, { source: 'PAYROLL' });
  ex('e4', 'SOLIQ_X', 300, { departmentId: 'd2' });
  T.income.push({ id: 'i1', date: d, period: '2026-09', amountTiyin: 7000n, categoryCode: 'SRV', regionCode: 0, departmentId: 'd1', segment: null, deletedAt: null });

  const audit = new AuditService(db.client);
  const exps = new ExpensesService(db.client, audit, new FixedAssetsService(db.client, audit));
  const centerIncome = { year: async () => ({ rows: [{ id: 'k5', code: '5', name: 'Quyoshli xonadon', isHeader: false, owner: 'CENTER', mode: 'CENTER', departmentId: 'd2', totalTiyin: '100' }] }) };
  const svc = new CostStructureService(db.client, audit, exps, centerIncome);

  // Birlik ko'rinishi
  const v = await svc.unit('dep:d1', '2026-09-01', '2026-09-30');
  assert.strictEqual(v.unit.label, 'Call markaz');
  assert.deepStrictEqual(v.income.parts.map((p) => [p.code, p.totalTiyin]), [['SRV', '7000']]);
  const item = (code) => v.expense.items.find((i) => i.code === code);
  assert.deepStrictEqual([item('INTERNET').count, item('INTERNET').totalTiyin, item('INTERNET').group, item('INTERNET').parentCode], [2, '1500', 'Boshqa xarajat', 'BOSHQA']);
  assert.strictEqual(item('PAYROLL_BASE').locked, 1, 'ish haqi — avtomatik');
  assert.strictEqual(v.expense.totalTiyin, '10500');
  assert.deepStrictEqual(v.income.cashLines.map((l) => [l.name, l.departmentId]), [['Quyoshli xonadon', 'd2']]);
  await assert.rejects(svc.unit('xato', '2026-09-01', '2026-09-30'), /Birlik noto/);

  // Qidiruv: bank to'lovi maqsadi bo'yicha
  const f = await svc.search({ text: 'internet xizmati', from: '2026-09-01', to: '2026-09-30' });
  assert.deepStrictEqual(f.map((r) => r.id), ['e1']);
  assert.strictEqual(f[0].place, 'Markaz › Call markaz');
  await assert.rejects(svc.search({ from: '2026-09-01', to: '2026-09-30' }), /Qidiruv matnini/);

  // Ko'chirish: Call markaz internet → Marketing; ish haqi yozuvi o'tkazib yuboriladi
  const m = await svc.move({ ids: ['e1', 'e2', 'e3', 'yoq'], unit: 'dep:d2' }, 'adm');
  assert.deepStrictEqual([m.moved, m.movedTiyin, m.skippedCount], [2, '1500', 2]);
  assert.ok(m.skipped.some((s) => s.id === 'e3' && /Ish haqi/.test(s.reason)), 'ish haqi qulflangan');
  assert.deepStrictEqual(T.expense.filter((e) => ['e1', 'e2'].includes(e.id)).map((e) => e.departmentId), ['d2', 'd2']);
  assert.strictEqual(T.expense.find((e) => e.id === 'e3').departmentId, 'd1', 'ish haqi joyida');
  // Faqat modda: Marketing › Soliq (namuna) → Internet
  const m2 = await svc.move({ ids: ['e4'], categoryCode: 'INTERNET' }, 'adm');
  assert.strictEqual(m2.moved, 1);
  assert.strictEqual(T.expense.find((e) => e.id === 'e4').categoryCode, 'INTERNET');
  const after = await svc.unit('dep:d2', '2026-09-01', '2026-09-30');
  assert.strictEqual(after.expense.items.find((i) => i.code === 'INTERNET').totalTiyin, '1800', 'ko‘chirilganlar shu birlikda');
  // Chegaralar
  await assert.rejects(svc.move({ ids: [] }, 'adm'), /belgilang/);
  await assert.rejects(svc.move({ ids: ['e1'] }, 'adm'), /Qayerga/);
  await assert.rejects(svc.move({ ids: ['e1'], unit: 's:YOQ' }, 'adm'), /Birlik noto/);
  assert.ok(T.auditLog.some((a) => /Xarajatlar tarkibiy tuzilishi/.test(a.changes?.summary ?? '')), 'auditga yozildi');
  console.log('OK t-cost-structure');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
