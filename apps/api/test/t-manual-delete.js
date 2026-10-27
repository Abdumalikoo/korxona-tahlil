// Qo'lda qo'shilganlarni o'chirish: kassa hisobraqami, yetkazuvchi, xarid arizasi, xarajat moddasi, daromad xizmati.
// Ishlatilgani o'chirilmaydi (sababi aytiladi), ishlatilmagani o'chiriladi. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { CashbookService } = require('../dist/modules/cashbook/cashbook.service');
const { PurchasesService } = require('../dist/modules/purchases/purchases.service');
const { CategoriesService } = require('../dist/modules/categories/categories.service');

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  const audit = new AuditService(db.client);

  // ── Kassa hisobraqami ──
  const cash = new CashbookService(db.client, audit);
  T.cashAccount.push(
    { id: 'h', key: 'I', name: 'Sarlavha', isHeader: true, inputs: [], sums: ['ytd'], parentId: null, rollupId: null, sortOrder: 1, isActive: true, balanceRule: 'ADD' },
    { id: 'a1', key: 'U.1', name: 'Yangi bank', isHeader: false, inputs: ['daily'], sums: [], parentId: 'h', rollupId: 'h', sortOrder: 2, isActive: true, balanceRule: 'ADD' },
    { id: 'a2', key: 'U.2', name: 'Ishlatilgan', isHeader: false, inputs: ['daily'], sums: [], parentId: 'h', rollupId: 'h', sortOrder: 3, isActive: true, balanceRule: 'ADD' },
  );
  T.cashReportLine.push({ id: 'l1', reportId: 'r1', accountId: 'a2' });
  await assert.rejects(cash.removeAccount('h', 'adm'), /sarlavha/);
  await assert.rejects(cash.removeAccount('a2', 'adm'), /1 ta kunda summa/);
  await cash.removeAccount('a1', 'adm');
  assert.deepStrictEqual(T.cashAccount.map((a) => a.id), ['h', 'a2']);

  // ── Yetkazuvchi va ariza ──
  const pur = new PurchasesService(db.client, audit, {});
  T.supplier.push({ id: 's1', name: 'Bo‘sh MChJ', isActive: true }, { id: 's2', name: 'Xaridli MChJ', isActive: true });
  T.purchaseRequest.push({ id: 'q1', number: 'AR-1', title: 'Qog‘oz', status: 'NEW' }, { id: 'q2', number: 'AR-2', title: 'Stol', status: 'DONE' });
  T.purchaseRequestLine.push({ id: 'ql1', requestId: 'q1', name: 'Qog‘oz', qty: 1, unit: 'dona' });
  T.purchase.push({ id: 'p1', supplierId: 's2', requestId: 'q2', status: 'OPEN', totalTiyin: 1n });
  await assert.rejects(pur.removeSupplier('s2', 'adm'), /1 ta xarid/);
  await pur.removeSupplier('s1', 'adm');
  assert.deepStrictEqual(T.supplier.map((s) => s.id), ['s2']);
  await assert.rejects(pur.removeRequest('q2', 'adm'), /xarid rasmiylashtirilgan/);
  await pur.removeRequest('q1', 'adm');
  assert.deepStrictEqual([T.purchaseRequest.map((q) => q.id), T.purchaseRequestLine.length], [['q2'], 0], 'ariza qatorlari bilan');

  // ── Xarajat moddasi ──
  const cat = new CategoriesService(db.client);
  T.category.push(
    { code: 'G', label: 'Guruh', parentCode: null, isLeaf: false, isActive: true },
    { code: 'G1', label: 'Bo‘sh modda', parentCode: 'G', isLeaf: true, isActive: true },
    { code: 'G2', label: 'Ishlatilgan', parentCode: 'G', isLeaf: true, isActive: true },
    { code: 'H', label: 'Bo‘sh guruh', parentCode: null, isLeaf: false, isActive: true },
    { code: 'H1', label: 'Yagona', parentCode: 'H', isLeaf: true, isActive: true },
  );
  T.expense.push({ id: 'e1', categoryCode: 'G2', deletedAt: new Date(), amountTiyin: 1n });
  await assert.rejects(cat.remove('G'), /ichida 2 ta modda/);
  await assert.rejects(cat.remove('G2'), /1 ta xarajat yozuvi \(savatdagilar bilan\)/, "savatdagi yozuv ham hisob");
  await cat.remove('G1');
  await cat.remove('H1');
  assert.strictEqual(T.category.find((c) => c.code === 'H').isLeaf, true, "bo'shagan guruh yana barg");
  await cat.remove('H');
  assert.deepStrictEqual(T.category.map((c) => c.code), ['G', 'G2']);

  // ── Daromad xizmati ──
  T.incomeCategory.push({ code: 'SRV_1', label: 'Yangi xizmat', isActive: true, order: 1 }, { code: 'SRV_2', label: 'Ishlatilgan xizmat', isActive: true, order: 2 });
  T.income.push({ id: 'i1', categoryCode: 'SRV_2', amountTiyin: 1n });
  const usage = await cat.incomeUsage();
  assert.deepStrictEqual(usage.map((u) => [u.code, u.incomes]), [['SRV_1', 0], ['SRV_2', 1]]);
  await assert.rejects(cat.removeIncome('SRV_2'), /1 ta daromad yozuvi/);
  await cat.setIncomeActive('SRV_2', false);
  assert.strictEqual(T.incomeCategory.find((c) => c.code === 'SRV_2').isActive, false);
  await cat.removeIncome('SRV_1');
  assert.deepStrictEqual(T.incomeCategory.map((c) => c.code), ['SRV_2']);
  await assert.rejects(cat.removeIncome('YOQ'), /topilmadi/);

  console.log('OK t-manual-delete');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
