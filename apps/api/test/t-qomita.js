// Qo'mita mablag'lari: ish haqi qismlari (Oklad, 40% ustama) bo'limdan Qo'mita hisobiga, boshqa moddalar siyosat orqali,
// ajratmalar (daromad) — qo'lda va bankdan, hisobot: ajratildi / qoplanishi kerak / qoldiq.
// TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { PayrollService } = require('../dist/modules/payroll/payroll.service');
const { QomitaService } = require('../dist/modules/qomita/qomita.service');
const { splitWithQomita } = require('../dist/modules/qomita/qomita.util');

(async () => {
  // ── 1. Ajratish qoidasi: avval Qo'mita, keyin siyosatdagi qismlar (qoplangani ikki marta ajratilmaydi), jami oshmaydi
  const ihq = (c) => `IHQ_${c}`;
  let parts = splitWithQomita(1000n, new Map([['IHQ_OKLAD', 300n], ['IHQ_BAYRAM', 100n]]), new Map([['OKLAD', 600n], ['OKLAD_40', 240n]]), ['OKLAD', 'OKLAD_40'], ihq);
  assert.deepStrictEqual(Object.fromEntries(parts), { QMT_OKLAD: 600n, QMT_OKLAD_40: 240n, IHQ_BAYRAM: 100n }, 'IHQ_OKLAD qoplangani uchun tashlandi');
  parts = splitWithQomita(500n, undefined, new Map([['OKLAD', 600n], ['OKLAD_40', 240n]]), ['OKLAD', 'OKLAD_40'], ihq);
  assert.strictEqual([...parts.values()].reduce((s, v) => s + v, 0n), 500n, "to'liq ish haqidan oshmaydi");

  // ── 2. Qayta guruhlash: Call-markaz xodimlari Oklad + 40% — Qo'mita hisobiga
  const db = fakeDb();
  const T = db.tables;
  T.region.push({ code: 0, name: 'Markaz' });
  T.department.push({ id: 'd1', name: 'Call-markaz', index: 7, isActive: true, order: 1 }, { id: 'd2', name: 'AUP', index: 8, isActive: true, order: 2 });
  T.user.push({ id: 'u1', fullName: 'Admin' });
  const emp = (pinfl, fullName, departmentId) => ({ pinfl, fullName, regionCode: 0, departmentId, employmentType: 'SHTAT', districtId: null, position: null });
  T.employee.push(emp('10000000000001', 'Namuna Bir', 'd1'), emp('10000000000002', 'Namuna Ikki', 'd1'), emp('10000000000003', 'Namuna Uch', 'd2'));
  T.payrollBatch.push({ id: 'b1', period: '2026-09', status: 'COMMITTED', scope: 'ALL', fileName: 'v.xlsx', uploadedById: 'u1' });
  const entry = (pinfl, amount) => ({ id: `pe${pinfl.slice(-1)}`, batchId: 'b1', employeePinfl: pinfl, period: '2026-09', baseTiyin: BigInt(amount), bonusTiyin: 0n, totalTiyin: BigInt(amount), deletedAt: null });
  T.payrollEntry.push(entry('10000000000001', 1000), entry('10000000000002', 2000), entry('10000000000003', 500));
  const pay = (departmentId, amount) => ({ id: `x${departmentId}`, date: new Date('2026-09-30T07:00:00Z'), period: '2026-09', amountTiyin: BigInt(amount), categoryCode: 'PAYROLL_BASE', departmentId, regionCode: 0, segment: null, source: 'PAYROLL', payrollBatchId: 'b1', deletedAt: null });
  T.expense.push(pay('d1', 3000), pay('d2', 500));
  T.salaryComponent.push({ code: 'OKLAD', name: 'Oklad', sign: 1, isActive: true, sortOrder: 10, category: 'ASOSIY' }, { code: 'OKLAD_40', name: 'Oklad ustamasi 40%', sign: 1, isActive: true, sortOrder: 20, category: 'ASOSIY' }, { code: 'BAYRAM', name: 'Bayram', sign: 1, isActive: true, sortOrder: 30, category: 'PREMIYA' });
  T.salaryCompositionBatch.push({ id: 'sb1', period: '2026-09', cancelledAt: null, createdAt: new Date('2026-10-01') });
  const row = (id, pinfl) => T.salaryCompositionRow.push({ id, batchId: 'sb1', employeePinfl: pinfl });
  row('r1', '10000000000001');
  row('r2', '10000000000002');
  row('r3', '10000000000003');
  const item = (rowId, componentCode, amount) => T.salaryCompositionItem.push({ id: `${rowId}${componentCode}`, batchId: 'sb1', rowId, componentCode, amountTiyin: BigInt(amount) });
  item('r1', 'OKLAD', 600);
  item('r1', 'OKLAD_40', 240);
  item('r1', 'BAYRAM', 100);
  item('r2', 'OKLAD', 1200);
  item('r2', 'OKLAD_40', 480);
  item('r3', 'OKLAD', 300); // AUP — Qo'mitaga emas
  T.employeeLocation = [];

  const payroll = new PayrollService(db.client);
  const audit = { log: async () => null };
  const bankStub = { route: async (b) => ({ routed: b }) };
  const svc = new QomitaService(db.client, audit, payroll, bankStub);

  // Sozlama: Call-markaz — Oklad + 40% ustama va «Aloqa» moddasi
  T.category.push({ code: 'ALOQA', label: 'Aloqa xizmatlari', parentCode: null, isLeaf: true, isActive: true, order: 1 }, { code: 'KANS', label: 'Kanselyariya', parentCode: null, isLeaf: true, isActive: true, order: 2 });
  await assert.rejects(svc.saveItem({ departmentId: 'd1', components: [], categories: [] }, 'u1'), /Nima qoplanadi/);
  await assert.rejects(svc.saveItem({ departmentId: 'd1', components: ['YOQ'], categories: [] }, 'u1'), /topilmadi/);
  await assert.rejects(svc.saveItem({ departmentId: 'd1', components: [], categories: ['PAYROLL_BASE'] }, 'u1'), /Modda topilmadi/);
  const saved = await svc.saveItem({ departmentId: 'd1', components: ['OKLAD_40', 'OKLAD'], categories: ['ALOQA'] }, 'u1');
  assert.strictEqual(saved.item.incomeCode, 'QOMITA_7');
  assert.strictEqual(saved.recalculated, true, saved.warning);
  assert.ok(T.incomeCategory.find((c) => c.code === 'QOMITA_7' && c.label === "Qo'mita ajratmasi: Call-markaz"), 'daromad turi yaratildi');
  const policy = T.setting.find((s) => s.key === 'expense.policy').value;
  assert.deepStrictEqual(policy.depRules, { d1: { ALOQA: 'QOMITA' } }, 'Aloqa — siyosat orqali Qo‘mita hisobiga');

  const live = T.expense.filter((e) => e.payrollBatchId === 'b1' && !e.deletedAt);
  const by = (f) => live.filter(f).map((e) => [e.categoryCode, e.departmentId, e.segment ?? null, e.amountTiyin]).sort();
  assert.deepStrictEqual(by((e) => e.segment === 'QOMITA'), [['QMT_OKLAD', null, 'QOMITA', 1800n], ['QMT_OKLAD_40', null, 'QOMITA', 720n]], "Qo'mita hisobiga: Oklad 1800, 40% 720");
  assert.deepStrictEqual(by((e) => e.categoryCode === 'PAYROLL_BASE'), [['PAYROLL_BASE', 'd1', null, 480n], ['PAYROLL_BASE', 'd2', null, 500n]], 'Call-markaz ish haqi qolgani 480, AUP o‘zgarmadi');
  assert.strictEqual(live.reduce((s, e) => s + e.amountTiyin, 0n), 3500n, 'jami o‘zgarmadi');
  assert.ok(live.find((e) => e.categoryCode === 'QMT_OKLAD').description.includes('Call-markaz xodimlari'));
  assert.ok(T.category.find((c) => c.code === 'QMT_OKLAD_40'), 'QMT moddasi yaratildi');
  const summary = T.setting.find((s) => s.key === 'qomita.payroll.2026-09').value;
  assert.deepStrictEqual(summary.deps.d1.parts, { OKLAD: '1800', OKLAD_40: '720' });
  assert.strictEqual(summary.deps.d1.employees.length, 2);
  // Qayta guruhlash takrorlansa — ikki marta yozilmaydi
  await payroll.regroup('2026-09');
  assert.strictEqual(T.expense.filter((e) => e.payrollBatchId === 'b1' && !e.deletedAt).reduce((s, e) => s + e.amountTiyin, 0n), 3500n);
  // Xarajat tafsiloti (Qo'mita yozuvi → xodimlar)
  const qrow = T.expense.find((e) => e.categoryCode === 'QMT_OKLAD' && !e.deletedAt);
  const det = await payroll.expenseDetail(qrow.id);
  assert.deepStrictEqual(det.entries.map((e) => [e.employee.fullName, e.totalTiyin]), [['Namuna Ikki', 1200n], ['Namuna Bir', 600n]]);

  // ── 3. Boshqa moddalar va ajratmalar
  const ex = (id, departmentId, categoryCode, amount, period = '2026-09') => T.expense.push({ id, date: new Date(`${period}-10T07:00:00Z`), period, amountTiyin: BigInt(amount), categoryCode, departmentId, regionCode: 0, segment: null, source: 'MANUAL', deletedAt: null, description: 'Internet', counterparty: 'Aloqa AJ' });
  ex('a1', 'd1', 'ALOQA', 150);
  ex('a2', 'd1', 'KANS', 70); // qoplanmaydi
  ex('a3', 'd2', 'ALOQA', 90); // boshqa bo'lim
  const inc = await svc.addIncome({ departmentId: 'd1', period: '2026-09', amount: '20,5', description: 'Sentabr ajratmasi' }, 'u1');
  assert.strictEqual(inc.amountTiyin, '2050');
  // Ro'yxatda yo'q bo'lim ham — o'z daromad turi bilan (qoplash qoidasi keyin belgilanadi); noma'lum bo'lim — xato
  await assert.rejects(svc.addIncome({ departmentId: 'yoq', period: '2026-09', amount: '5' }, 'u1'), /Bo'lim topilmadi/);
  await assert.rejects(svc.addIncome({ departmentId: 'd1', period: '2026-09', amount: '-5' }, 'u1'), /Summa/);
  T.incomeCategory.push({ code: 'QOMITA_UMUMIY', label: "Qo'mita", isActive: true });
  T.income.push({ id: 'i9', date: new Date('2026-09-15T07:00:00Z'), period: '2026-09', amountTiyin: 99n, categoryCode: 'QOMITA_UMUMIY', segment: 'QOMITA', source: 'IMPORT', deletedAt: null });

  const rep = await svc.report('2026-09', '2026-09');
  const call = rep.rows.find((r) => r.key === 'd1');
  assert.deepStrictEqual([call.allocatedTiyin, call.payrollTiyin, call.otherTiyin, call.coveredTiyin, call.balanceTiyin], ['2050', '2520', '150', '2670', '-620'], 'ajratildi 2050, qoplanishi kerak 2670, kamomad 620');
  assert.deepStrictEqual(call.months['2026-09'], { allocated: '2050', payroll: '2520', other: '150' });
  assert.deepStrictEqual(call.categories, [{ code: 'ALOQA', label: 'Aloqa xizmatlari' }]);
  const none = rep.rows.find((r) => r.key === '-');
  assert.strictEqual(none.allocatedTiyin, '99', "bo'limsiz Qo'mita daromadi alohida qatorda");
  assert.strictEqual(rep.totals.allocatedTiyin, '2149');
  assert.deepStrictEqual(rep.tarkibMissing, []);

  const d = await svc.detail('d1', '2026-09', '2026-09');
  assert.deepStrictEqual(d.payrollParts.map((p) => [p.code, p.totalTiyin]), [['OKLAD', '1800'], ['OKLAD_40', '720']]);
  assert.deepStrictEqual(d.employees.map((e) => [e.fullName, e.totalTiyin]), [['Namuna Ikki', '1680'], ['Namuna Bir', '840']]);
  assert.deepStrictEqual(d.categories.map((c) => [c.code, c.totalTiyin]), [['ALOQA', '150']]);
  assert.deepStrictEqual(d.incomes.map((i) => [i.amountTiyin, i.origin]), [['2050', 'MANUAL']]);

  // Tasdiqlash: belgi tafsilotda ko'rinadi, olib tashlash mumkin
  await svc.approveIncome(inc.id, true, 'u1');
  assert.ok((await svc.detail('d1', '2026-09', '2026-09')).incomes[0].approved, 'tasdiqlangan');
  await svc.approveIncome(inc.id, false, 'u1');
  assert.strictEqual((await svc.detail('d1', '2026-09', '2026-09')).incomes[0].approved, null);
  await assert.rejects(svc.approveIncome('yoq', true, 'u1'), /topilmadi/);

  // Qo'lda kiritilgani o'chiriladi, boshqasi — yo'q
  await assert.rejects(svc.removeIncome('i9', 'u1'), /bank/);
  await svc.removeIncome(inc.id, 'u1');
  assert.strictEqual((await svc.report('2026-09', '2026-09')).rows.find((r) => r.key === 'd1').allocatedTiyin, '0');

  // Ro'yxat va birdan o'chirish: qo'lda kiritilganlar o'chadi, boshqa manbadagisi — sababi bilan qoladi
  const a1 = await svc.addIncome({ departmentId: 'd1', period: '2026-09', amount: '10' }, 'u1');
  const a2 = await svc.addIncome({ departmentId: 'd1', period: '2026-09', amount: '7' }, 'u1');
  const list = await svc.incomes('2026-09', '2026-09');
  assert.ok(list.find((x) => x.id === a1.id).canDelete, 'qo‘lda — o‘chiriladi');
  assert.strictEqual(list.find((x) => x.id === 'i9').canDelete, false, 'boshqa manba — yo‘q');
  const bulk = await svc.removeIncomes({ ids: [a1.id, a2.id, 'i9'] }, 'u1');
  assert.strictEqual(bulk.removed, 2);
  assert.deepStrictEqual(bulk.failed.map((f) => f.id), ['i9']);
  assert.ok(!(await svc.incomes('2026-09', '2026-09')).some((x) => x.id === a1.id || x.id === a2.id), 'o‘chirildi');
  await assert.rejects(svc.removeIncomes({ ids: [] }, 'u1'), /tanlang/);

  // ── 4. Bank: Qo'mitadan kelgan kirimlar topiladi, yo'naltirilgani chiqmaydi
  T.setting.push({ key: 'bank.analysis.store', value: { accounts: { A1: { key: 'A1', label: 'Hisob …12345', months: { '2026-09': { rows: [
    { id: 'r1', docDate: '2026-09-05', docNo: '11', accountName: 'Namuna qo‘mitasi', inn: '200000001', dir: 'IN', amountTiyin: '500000', purpose: 'Call-markaz xarajatlari uchun' },
    { id: 'r2', docDate: '2026-09-06', docNo: '12', accountName: 'Mijoz MChJ', inn: '200000002', dir: 'IN', amountTiyin: '7000', purpose: 'Xizmat haqi' },
    { id: 'r3', docDate: '2026-09-07', docNo: '13', accountName: 'ООО Тест', inn: '200000003', dir: 'IN', amountTiyin: '8000', purpose: 'По письму комитета' },
    { id: 'r4', docDate: '2026-09-08', docNo: '14', accountName: 'Namuna qo‘mitasi', inn: '200000001', dir: 'OUT', amountTiyin: '1', purpose: 'chiqim' },
  ] } } } }, posts: [{ account: 'A1', rowId: 'r3', status: 'POSTED', entryId: 'zz' }] } });
  let b = await svc.bankCandidates();
  assert.deepStrictEqual(b.items.map((x) => x.rowId), ['r1'], "qo'mita kirimi; yo'naltirilgani va chiqim yo'q");
  b = await svc.bankCandidates('mijoz');
  assert.deepStrictEqual(b.items.map((x) => [x.rowId, x.matched]), [['r2', false]], 'qidiruv bilan har qanday kirim');
  const routed = await svc.bankRoute({ items: [{ account: 'A1', rowId: 'r1' }], departmentId: 'd1' }, 'u1');
  assert.deepStrictEqual([routed.routed.place, routed.routed.categoryCode], [{ unit: 'QOMITA' }, 'QOMITA_7']);

  // ── 5. Olib tashlash: ish haqi bo'limga qaytadi, siyosat tozalanadi
  await svc.removeItem('d1', 'u1');
  const after = T.expense.filter((e) => e.payrollBatchId === 'b1' && !e.deletedAt);
  assert.deepStrictEqual(after.filter((e) => e.segment === 'QOMITA').length, 0, "Qo'mita qatorlari olib tashlandi");
  assert.strictEqual(after.find((e) => e.departmentId === 'd1').amountTiyin, 3000n, 'Call-markaz ish haqi to‘liq qaytdi');
  assert.deepStrictEqual(T.setting.find((s) => s.key === 'expense.policy').value.depRules, {});
  assert.ok(!T.setting.find((s) => s.key === 'qomita.payroll.2026-09'), 'xulosa o‘chirildi');
  console.log('OK t-qomita');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
