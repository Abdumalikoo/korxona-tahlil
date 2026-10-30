// Soliqlar › ish haqi soliqlari yonma-yon: ijtimoiy soliq (xarajat, 12%) va daromad solig'i (ushlanadi, 12% — ma'lumot).
// TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { TaxesService } = require('../dist/modules/taxes/taxes.service');

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin', createdAt: new Date() });
  T.region.push({ code: 0, name: 'Markaz', isActive: true }, { code: 5, name: 'Namuna viloyati', isActive: true });
  const emp = (pinfl, regionCode, departmentId) => T.employee.push({ pinfl, fullName: pinfl, regionCode, departmentId, isActive: true });
  emp('71000000000001', 0, 'd1');
  emp('71000000000002', 5, null);
  emp('71000000000003', 5, null);
  T.payrollBatch.push({ id: 'b1', period: '2026-09', status: 'COMMITTED', scope: 'ALL' });
  const pe = (pinfl, sum) => T.payrollEntry.push({ id: `p${pinfl}`, employeePinfl: pinfl, period: '2026-09', batchId: 'b1', baseTiyin: BigInt(sum), bonusTiyin: 0n, totalTiyin: BigInt(sum), deletedAt: null, batch: T.payrollBatch[0] });
  pe('71000000000001', 1_000_000_00);
  pe('71000000000002', 500_000_00);
  pe('71000000000003', 300_000_00);
  // Ish haqi xarajati (qayta guruhlash yozgani): Markaz bo'limi va hudud — soliq asosi shu (ko'rinadigan ish haqi bilan bir xil)
  const pay = (id, amount, categoryCode, regionCode, departmentId, extra = {}) => T.expense.push({ id, period: '2026-09', date: new Date('2026-09-30T00:00:00Z'), amountTiyin: BigInt(amount), categoryCode, regionCode, departmentId, segment: null, source: 'PAYROLL', deletedAt: null, ...extra });
  pay('x1', 1_000_000_00, 'PAYROLL_BASE', 0, 'd1');
  pay('x2', 800_000_00, 'PAYROLL_BASE', 5, null);
  const svc = new TaxesService(db.client, new AuditService(db.client));
  const m = await svc.month('2026-09');
  const pt = m.payrollTaxes;
  assert.deepStrictEqual([pt.socialPct, pt.incomeTaxPct], [12, 12]);
  const row = (k) => pt.rows.find((r) => r.key === k);
  assert.deepStrictEqual([row('center').fundTiyin, row('center').socialTiyin, row('center').incomeTaxTiyin], ['100000000', '12000000', '12000000']);
  assert.deepStrictEqual([row('r:5').fundTiyin, row('r:5').socialTiyin, row('r:5').incomeTaxTiyin], ['80000000', '9600000', '9600000']);
  assert.deepStrictEqual(pt.totals, { fundTiyin: '180000000', socialTiyin: '21600000', incomeTaxTiyin: '21600000' });
  assert.strictEqual(m.totals.totalTiyin, '21600000', "daromad solig'i jami soliq xarajatiga qo'shilmaydi");
  // Foiz — «Ish haqi solishtirma» sozlamasidan
  T.setting.push({ key: 'payroll.solishtirma', value: { taxPct: 10 } });
  assert.strictEqual((await svc.month('2026-09')).payrollTaxes.totals.incomeTaxTiyin, '18000000');
  // QQS «2026-04 daromaddan 12%» — olib tashlandi: turdan ham, avtomatik yozuvlardan ham
  const types = (await svc.types()).map((t) => (t.code === 'QQS' ? { ...t, incomeRate: 12, incomePeriods: ['2026-04'] } : t));
  T.setting = T.setting.filter((x) => x.key !== 'tax.types');
  T.setting.push({ key: 'tax.types', value: types });
  T.expense.push({ id: 'q1', period: '2026-04', date: new Date('2026-04-30T00:00:00Z'), amountTiyin: 5n, categoryCode: 'SOLIQ_QQS', regionCode: 0, departmentId: null, source: 'TAX', documentNo: 'TAX-AUTO', deletedAt: null });
  assert.strictEqual(await svc.removeQqsApril(), true);
  assert.strictEqual(await svc.removeQqsApril(), false, 'bir marta');
  const qqs = (await svc.types()).find((t) => t.code === 'QQS');
  // Hudud xodimining ish haqidan Markaz hisobiga o'tgan qismi (bayram) — soliq ham Markazda; yo'nalish ish haqi — yo'nalishda
  T.expense.find((e) => e.id === 'x2').amountTiyin = 700_000_00n;
  pay('x3', 100_000_00, 'HM_BAYRAM', 5, null);
  T.expense.push({ id: 'x4', period: '2026-09', date: new Date('2026-09-30T00:00:00Z'), amountTiyin: 200_000_00n, categoryCode: 'PAYROLL_BASE', regionCode: null, departmentId: null, segment: 'TAX_FREE', source: 'IMPORT', deletedAt: null });
  await svc.syncPeriod('2026-09');
  const soc = (pred) => T.expense.filter((e) => e.categoryCode === 'SOLIQ_IJTIMOIY' && !e.deletedAt && pred(e)).reduce((t, e) => t + e.amountTiyin, 0n);
  assert.strictEqual(soc((e) => e.regionCode === 5), 8_400_000n, 'hudud: 12% × 700 ming (qolgani)');
  assert.strictEqual(soc((e) => e.regionCode === 0 && !e.departmentId), 1_200_000n, 'Markaz: 12% × 100 ming (bayram)');
  assert.strictEqual(soc((e) => e.segment === 'TAX_FREE'), 2_400_000n, 'Tax free: 12% × 200 ming');
  assert.strictEqual(soc(() => true), 24_000_000n, 'jami — hamma ish haqining 12% i');
  assert.ok(!qqs.incomeRate && !(qqs.incomePeriods ?? []).length, 'QQS — qo‘lda');
  await svc.syncAll();
  assert.ok(!T.expense.some((e) => e.categoryCode === 'SOLIQ_QQS' && e.documentNo === 'TAX-AUTO'), "avtomatik QQS yozuvi o'chdi");
  console.log('OK t-taxes-payroll');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
