// Ish haqi tarkibi › Uchlik nazorat (tarkib · soliq hisoboti · 23106): farqlar, bank to'lovlari bo'yicha tavsiya,
// farqni komponentga o'tkazish, bekor qilish, eskirish (tarkib qayta yuklansa); yo'nalish (Tax free) tarkibi ham.
// TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { SalaryCompositionService } = require('../dist/modules/salary-composition/salary-composition.service');
const { CompositionReconcileService } = require('../dist/modules/salary-composition/salary-composition.reconcile');

const P = { A: '81111111111111', B: '82222222222222', C: '83333333333333', D: '84444444444444', E: '85555555555555', T: '86666666666666', U: '87777777777777' };
const so = (n) => BigInt(Math.round(n * 100));
const row = (pinfl, items) => ({ pinfl, fullName: null, workedDays: null, rate: null, items: new Map(Object.entries(items).map(([k, v]) => [k, so(v)])) });
const pay = (kind, pinfl, net, accrual = '2026-03', date = '2026-03-20') => ({ no: '1', docDate: date, procDate: date, docNo: `D${pinfl.slice(-3)}${kind}`, accountName: 'UZCARD', inn: pinfl, mfo: '01158', debitTiyin: String(so(net)), purpose: 'sinov', kind, orderDate: accrual + '-10', orderNo: '00009', accrual, commentName: null, pinfl, fullName: null, matchBy: 'PINFL' });

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  T.region.push({ code: 0, name: 'Markaz', isActive: true });
  for (const [p, n] of [[P.A, 'Alfa Birinchi'], [P.B, 'Beta Ikkinchi'], [P.C, 'Gamma Uchinchi'], [P.D, 'Delta Tortinchi'], [P.E, 'Epsilon Beshinchi'], [P.T, 'Taksfri Bir'], [P.U, 'Taksfri Ikki']]) {
    T.employee.push({ pinfl: p, fullName: n, lastName: n.split(' ')[0], firstName: 'S', regionCode: 0, departmentId: null, districtId: null, position: null, employmentType: 'SHTAT', isActive: true, hiredAt: null, firedAt: null });
  }
  let regrouped = 0;
  const payrollSvc = { regroup: async () => { regrouped += 1; return null; } };
  // Yo'nalish ish haqi (Tax free) vedomosti — soxta
  let split = 0;
  const unitPayroll = { payrollMap: async (u) => (u === 'TAX_FREE' ? new Map([[P.T, so(2_000_000)], [P.U, so(1_500_000)]]) : null), staffOf: async () => [], splitComponents: async () => { split += 1; } };
  const svc = new SalaryCompositionService(db.client, payrollSvc, unitPayroll);
  await svc.onModuleInit();
  T.salaryComponent.forEach((x) => (x.isActive = true)); // Prisma standarti (soxta bazada yo'q)
  const audit = new AuditService(db.client);
  const rec = new CompositionReconcileService(db.client, svc, payrollSvc, audit, unitPayroll);

  // Soliq hisoboti (mart)
  T.payrollBatch.push({ id: 'pb', period: '2026-03', status: 'COMMITTED', scope: 'ALL' });
  for (const [p, v] of [[P.A, 5_000_000], [P.B, 3_000_000], [P.C, 2_000_000], [P.E, 1_000_000]]) T.payrollEntry.push({ id: `e${p}`, employeePinfl: p, period: '2026-03', batchId: 'pb', baseTiyin: so(v), totalTiyin: so(v), bonusTiyin: 0n, deletedAt: null });
  // Tarkib (mart): A 4 mln (1 mln kam), B mos, C yo'q, D bor (soliqda yo'q), E mos
  await svc.commit({ period: '2026-03', fileName: 'tarkib-mart.xlsx', userId: 'adm', rows: [row(P.A, { OKLAD: 4_000_000 }), row(P.B, { OKLAD: 3_000_000 }), row(P.D, { OKLAD: 500_000 }), row(P.E, { OKLAD: 1_000_000 })] });
  // 23106: A — mukofot 880 000 (qo'lga; soliqdan oldin 1 mln), C — bayram 1 760 000 (2 mln), E — mukofot 300 000 (tarkibda yo'q, farq yo'q),
  // A — xizmat safari (olinmaydi), B — mukofot fevral oyi uchun (olinmaydi)
  T.setting.push({ key: 'acc23106.store', value: { months: { '2026-03': { batchId: 'x', fileName: '23106.xlsx', savedAt: '', uploadedBy: '', rows: [pay('MUKOFOT', P.A, 880_000), pay('BAYRAM', P.C, 1_760_000), pay('MUKOFOT', P.E, 300_000), pay('SAFAR', P.A, 999_000), pay('MUKOFOT', P.B, 100_000, '2026-02')] } }, batches: [] } });

  // ── Ko'rish ──
  let v = await rec.view('2026-03');
  const r = (p) => v.rows.find((x) => x.pinfl === p);
  assert.deepStrictEqual([v.compositionUploaded, v.payrollUploaded, v.bankUploaded], [true, true, true]);
  assert.deepStrictEqual([r(P.A).state, r(P.A).diffTiyin, r(P.A).tarkibTiyin, r(P.A).soliqTiyin], ['DIFF', String(so(1_000_000)), String(so(4_000_000)), String(so(5_000_000))]);
  assert.deepStrictEqual(r(P.A).bank.map((b) => [b.kind, b.netTiyin, b.grossTiyin, b.state]), [['MUKOFOT', String(so(880_000)), String(so(1_000_000)), 'MISSING']], 'safar olinmadi');
  assert.deepStrictEqual([r(P.A).suggestion.componentCode, r(P.A).suggestion.confidence, r(P.A).suggestion.amountTiyin], ['PREMIYA_BOSHQA', 'STRONG', String(so(1_000_000))]);
  assert.strictEqual(r(P.B).state, 'OK', "fevral uchun mukofot bu oyga kirmaydi");
  assert.deepStrictEqual(r(P.B).bank, []);
  assert.deepStrictEqual([r(P.C).state, r(P.C).tarkibTiyin, r(P.C).diffTiyin, r(P.C).suggestion.componentCode, r(P.C).suggestion.confidence], ['NO_TARKIB', null, String(so(2_000_000)), 'BAYRAM', 'STRONG']);
  assert.deepStrictEqual([r(P.D).state, r(P.D).diffTiyin, r(P.D).suggestion], ['NO_SOLIQ', String(-so(500_000)), null]);
  assert.deepStrictEqual([r(P.E).state, r(P.E).bank[0].state, r(P.E).suggestion], ['BANK', 'MISSING', null], "farq yo'q, lekin bankda tarkibda yo'q mukofot");
  assert.deepStrictEqual([v.rows[0].state, v.rows.at(-1).state], ['DIFF', 'OK'], 'muammolilar yuqorida');
  // Tax free xodimlari (T, U) ham soliq hisobotida bor (o'sha bo'lim ish haqida) — umumiy tarkibda ham, o'z tarkibida ham yo'q
  assert.deepStrictEqual([v.summary.diff, v.summary.noTarkib, v.summary.noSoliq, v.summary.bank, v.summary.ok, v.summary.strong], [1, 3, 1, 1, 1, 2]);
  assert.deepStrictEqual([r(P.T).state, r(P.T).soliqTiyin], ['NO_TARKIB', String(so(2_000_000))]);
  assert.ok(v.components.some((c) => c.code === 'KPI'));

  // ── O'tkazish: xatolar ──
  await assert.rejects(rec.allocate('2026-03', undefined, { items: [] }, 'adm'), /kamida bitta/);
  await assert.rejects(rec.allocate('2026-03', undefined, { items: [{ pinfl: P.A, componentCode: 'YOQ', amountTiyin: '1' }] }, 'adm'), /Komponent topilmadi/);
  await assert.rejects(rec.allocate('2026-03', undefined, { items: [{ pinfl: P.A, componentCode: 'KPI', amountTiyin: '0' }] }, 'adm'), /nol/);
  await assert.rejects(rec.allocate('2026-03', undefined, { items: [{ pinfl: P.A, componentCode: 'KPI', amountTiyin: String(so(1)) }, { pinfl: P.D, componentCode: 'KPI', amountTiyin: String(-so(10)) }] }, 'adm'), /manfiy bo'lib qoladi/);
  assert.ok(!T.salaryCompositionItem.some((i) => i.componentCode === 'KPI'), "xatoda hech narsa yozilmadi (A ham)");
  await assert.rejects(rec.allocate('2026-04', undefined, { items: [{ pinfl: P.A, componentCode: 'KPI', amountTiyin: '100' }] }, 'adm'), /yuklanmagan/);

  // ── O'tkazish: A (tavsiya bo'yicha), C (yangi qator) ──
  const before = regrouped;
  const res = await rec.allocate('2026-03', undefined, { items: [{ pinfl: P.A, componentCode: r(P.A).suggestion.componentCode, amountTiyin: r(P.A).suggestion.amountTiyin, source: 'SUGGESTION' }, { pinfl: P.C, componentCode: 'BAYRAM', amountTiyin: r(P.C).diffTiyin, source: 'SUGGESTION' }] }, 'adm');
  assert.deepStrictEqual([res.count, res.totalTiyin], [2, String(so(3_000_000))]);
  assert.strictEqual(regrouped, before + 1, 'Markaz ulushi qayta hisoblandi');
  v = await rec.view('2026-03');
  assert.deepStrictEqual([r(P.A).state, r(P.A).items.PREMIYA_BOSHQA, r(P.A).items.OKLAD, r(P.A).bank[0].state], ['OK', String(so(1_000_000)), String(so(4_000_000)), 'OK']);
  assert.deepStrictEqual([r(P.C).state, r(P.C).items.BAYRAM], ['OK', String(so(2_000_000))]);
  assert.strictEqual(r(P.A).adjustments.length, 1);
  const batch = T.salaryCompositionBatch.find((b) => !b.cancelledAt);
  assert.deepStrictEqual([batch.totalTiyin, batch.employeeCount], [so(8_500_000 + 3_000_000), 5]);
  const check = await svc.check('2026-03');
  // D — soliqda yo'q; T, U — Tax free (soliq hisobotida bor), hali hech qaysi tarkibda yo'q
  assert.deepStrictEqual([check.mismatchCount, check.notInPayroll.map((x) => x.pinfl)], [3, [P.D]], 'faqat D soliqda yoq');
  assert.strictEqual(batch.mismatchCount, 3, 'holat saqlandi');
  assert.ok(T.auditLog.some((l) => l.entityType === 'salary_composition_adjust'));

  // ── Bekor qilish ──
  const adjA = v.history.find((h) => h.pinfl === P.A);
  await rec.undo(adjA.id, 'adm');
  v = await rec.view('2026-03');
  assert.deepStrictEqual([r(P.A).state, r(P.A).items.PREMIYA_BOSHQA, r(P.A).tarkibTiyin], ['DIFF', undefined, String(so(4_000_000))]);
  await assert.rejects(rec.undo(adjA.id, 'adm'), /allaqachon/);
  const adjC = v.history.find((h) => h.pinfl === P.C && h.status === 'APPLIED');
  await rec.undo(adjC.id, 'adm');
  assert.ok(!T.salaryCompositionRow.some((x) => x.employeePinfl === P.C), "yaratilgan qator o'chdi");
  assert.strictEqual(T.salaryCompositionBatch.find((b) => !b.cancelledAt).employeeCount, 4);

  // ── Qo'lda: D — tarkibdagi ortiqcha (soliqda yo'q) OKLAD'dan ayiriladi ──
  await rec.allocate('2026-03', undefined, { items: [{ pinfl: P.D, componentCode: 'OKLAD', amountTiyin: String(-so(500_000)), note: "soliqda yo'q" }] }, 'adm');
  v = await rec.view('2026-03');
  assert.deepStrictEqual([r(P.D).state, r(P.D).tarkibTiyin], ['OK', '0']);
  const adjD = v.history.find((h) => h.pinfl === P.D);
  assert.deepStrictEqual([adjD.source, adjD.note, adjD.current], ['MANUAL', "soliqda yo'q", true]);

  // ── Tarkib qayta yuklandi → eski o'tkazishlar eskirgan ──
  await svc.commit({ period: '2026-03', fileName: 'tarkib-mart-2.xlsx', userId: 'adm', rows: [row(P.A, { OKLAD: 5_000_000 }), row(P.B, { OKLAD: 3_000_000 }), row(P.E, { OKLAD: 1_000_000 })] });
  v = await rec.view('2026-03');
  assert.strictEqual(v.history.find((h) => h.id === adjD.id).current, false);
  await assert.rejects(rec.undo(adjD.id, 'adm'), /eskirgan/);
  assert.strictEqual(T.setting.find((s) => s.key === 'salary.composition.adjust').value.items.find((a) => a.id === adjD.id).status, 'STALE');

  // ── Yo'nalish (Tax free): tarkib settings'da ──
  await svc.commit({ period: '2026-03', fileName: 'tf.xlsx', userId: 'adm', unit: 'TAX_FREE', rows: [row(P.T, { OKLAD: 1_800_000 })] });
  let u = await rec.view('2026-03', 'TAX_FREE');
  const ur = (p) => u.rows.find((x) => x.pinfl === p);
  assert.deepStrictEqual([ur(P.T).state, ur(P.T).diffTiyin, ur(P.U).state], ['DIFF', String(so(200_000)), 'NO_TARKIB']);
  const s0 = split;
  await rec.allocate('2026-03', 'TAX_FREE', { items: [{ pinfl: P.T, componentCode: 'KPI', amountTiyin: String(so(200_000)) }, { pinfl: P.U, componentCode: 'OKLAD', amountTiyin: String(so(1_500_000)) }] }, 'adm');
  assert.strictEqual(split, s0 + 1, "bo'lim ish haqi qismlari qayta ajratildi");
  u = await rec.view('2026-03', 'TAX_FREE');
  assert.deepStrictEqual([ur(P.T).state, ur(P.U).state, u.summary.ok], ['OK', 'OK', 2]);
  const tf = T.setting.find((s) => s.key === 'unit.composition.TAX_FREE.2026-03').value.batches.find((b) => !b.cancelledAt);
  assert.deepStrictEqual([tf.totalTiyin, tf.employeeCount, tf.status, tf.mismatchCount], [String(so(3_500_000)), 2, 'MATCHED', 0]);
  const adjU = u.history.find((h) => h.pinfl === P.U);
  await rec.undo(adjU.id, 'adm');
  u = await rec.view('2026-03', 'TAX_FREE');
  assert.strictEqual(ur(P.U).state, 'NO_TARKIB');
  assert.strictEqual(T.setting.find((s) => s.key === 'unit.composition.TAX_FREE.2026-03').value.batches.find((b) => !b.cancelledAt).rows.length, 1);
  // T endi Tax free'ning o'z tarkibida — umumiy tarkibda «tarkibda yo'q» deyilmaydi (U hali hech qaysida yo'q)
  const gv = await rec.view('2026-03');
  assert.deepStrictEqual([gv.rows.some((x) => x.pinfl === P.T), gv.rows.find((x) => x.pinfl === P.U)?.state], [false, 'NO_TARKIB']);
  // Umumiy tarkib o'zgarmadi
  assert.ok(!T.salaryCompositionRow.some((x) => x.employeePinfl === P.T));

  console.log('OK t-composition-reconcile');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
