// Ish haqi tarkibi — istalgan shakldagi fayl: PINFL ustuni ma'lumotdan topiladi, har ustunga komponent taklifi,
// tanilmagan ustun farqni yopsa — taklif, siz tanlagan moslash qo'llanadi va saqlanganda eslab qolinadi.
// TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const fakeDb = require('./fakedb');
const { SalaryCompositionService } = require('../dist/modules/salary-composition/salary-composition.service');
const { smartScan, guessComponent } = require('../dist/modules/salary-composition/salary-composition.smart');

const P = ['51111111111111', '52222222222222', '53333333333333'];

/** «Maydan» yangi shakl: 2 qatorli sarlavha (lotin + kirill aralash), ustun raqamlari, boshqa tartib */
async function newFormat() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('May 2026 hudud');
  ws.getCell('A1').value = "Toshkent viloyati — may oyi ish haqi qaydnomasi";
  const head = [
    ['T/r', ''], ['Familiya, ismi', ''], ['JShShIR', ''], ['Lavozimi', ''], ['Ishlagan kun', ''],
    ['Hisoblandi', 'Oklad'], ['Hisoblandi', 'Ustama 40%'], ['Hisoblandi', 'Ustama 40% summa'],
    ['Hisoblandi', "Ta'til puli"], ['Hisoblandi', 'Bayram puli'], ['Hisoblandi', 'Maxsus XZ to‘lov'],
    ['Hisoblandi', 'Jami hisoblangan'], ['Ushlandi', 'Daromad solig‘i'], ['Ushlandi', 'INPS'], ['Qo‘liga', ''],
  ];
  head.forEach(([a, b], i) => {
    ws.getCell(3, i + 1).value = a;
    ws.getCell(4, i + 1).value = b || a;
    ws.getCell(5, i + 1).value = i + 1;
  });
  ws.getCell(4, 7).value = '%';
  ws.getCell(3, 7).value = 'Ustama 40%';
  ws.getCell(3, 8).value = 'Ustama 40%';
  ws.getCell(4, 8).value = 'summa';
  const rows = [
    // T/r, FISh, PINFL, lavozim, kun, oklad, %, ustama, tatil, bayram, yangi, jami, ndfl, inps, qoliga
    [1, 'Sinov Bir', P[0], 'Mutaxassis', 22, 5_000_000, 40, 2_000_000, 0, 500_000, 300_000, 7_800_000, 936_000, 0, 6_864_000],
    [2, 'Sinov Ikki', P[1], 'Bosh mutaxassis', 20, 6_000_000, 40, 2_400_000, 1_000_000, 0, 0, 9_400_000, 1_128_000, 0, 8_272_000],
    [3, 'Sinov Uch', Number(P[2]), 'Haydovchi', 22, 3_000_000.5, 40, 1_200_000, 0, 0, 150_000, 4_350_000.5, 522_000, 0, 3_828_000.5],
  ];
  rows.forEach((r, i) => r.forEach((v, j) => (ws.getCell(6 + i, j + 1).value = v)));
  ws.getCell(9, 2).value = 'JAMI';
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), originalname: 'hudud-may.xlsx', wb };
}

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.region.push({ code: 0, name: 'Markaz', isActive: true });
  T.department.push({ id: 'd1', name: 'AUP', isActive: true });
  for (const [i, p] of P.entries()) T.employee.push({ pinfl: p, fullName: `Sinov ${i}`, regionCode: 0, departmentId: 'd1', isActive: true, position: null });
  const svc = new SalaryCompositionService(db.client, { regroup: async () => null });
  await svc.onModuleInit();
  T.salaryComponent.forEach((c) => (c.isActive = true));

  // Taxmin: nomdan
  const comps = T.salaryComponent;
  assert.strictEqual(guessComponent('бетобликварагаси', 'бетобликварагаси', comps)?.code, 'KASALLIK');
  assert.strictEqual(guessComponent('bayrampuli', 'bayrampuli', comps)?.code, 'BAYRAM');
  assert.strictEqual(guessComponent('xyzqwerty', 'xyzqwerty', comps), null);

  const f = await newFormat();
  const scan = smartScan(f.wb.worksheets[0], comps, { learned: {} });
  assert.deepStrictEqual([scan.pinflCol, scan.dataStart, scan.headerTop, scan.headerBottom], [3, 6, 3, 4], 'PINFL ustuni ma\'lumotdan, sarlavha 3–4, ustun raqamlari o\'tkazildi');
  const col = (L) => scan.columns.find((c) => c.letter === L);
  assert.strictEqual(scan.nameCol, 2);
  assert.strictEqual(scan.daysCol, 5);
  assert.deepStrictEqual([col('F').kind, col('F').code], ['amount', 'OKLAD']);
  assert.strictEqual(col('G').kind, 'qualifier', 'foiz ustuni — summa emas');
  assert.deepStrictEqual([col('H').kind, col('H').code], ['amount', 'OKLAD_40']);
  assert.strictEqual(col('I').code, 'TATIL');
  assert.strictEqual(col('J').code, 'BAYRAM');
  assert.deepStrictEqual([col('K').kind, col('K').code, col('K').reason], ['amount', null, 'tanilmadi']);
  assert.strictEqual(col('L').kind, 'total');
  assert.strictEqual(scan.totalCol, 12);
  assert.ok(['M', 'N', 'O'].every((L) => col(L).kind === 'deduct'), 'ushlanmalar va qo\'liga — tarkibga kirmaydi');

  // ── 1. Tahlil: yangi ustun (K) tanilmadi → fayldagi jami bilan farq, taklif: K ni qo'shish ──
  const a = await svc.analyze('2026-05', f);
  assert.strictEqual(a.validRows, 3);
  assert.ok(a.mapping && a.mapping.pinflColumn === 'C' && a.mapping.totalColumn === 'L');
  assert.strictEqual(a.suggestions.against, 'FILE');
  assert.strictEqual(a.suggestions.mismatched, 2, 'K ustunida summa bor 2 xodim');
  const top = a.suggestions.items[0];
  assert.deepStrictEqual([top.letter, top.action, top.rows], ['K', 'ADD', 2]);
  assert.strictEqual(a.totalMismatches.length, 2);
  assert.deepStrictEqual(a.skippedColumns.map((x) => x.column), ['K']);

  // ── 2. Siz tanlaysiz: K → «Boshqa ustamalar» — farq yo'q ──
  const b = await svc.analyze('2026-05', f, undefined, undefined, { K: 'USTAMA_BOSHQA' });
  assert.strictEqual(b.suggestions.mismatched, 0);
  assert.strictEqual(b.totalMismatches.length, 0);
  const r0 = b.rows.find((r) => r.pinfl === P[0]);
  assert.strictEqual(r0.totalTiyin, String(7_800_000 * 100));
  assert.strictEqual(b.rows.find((r) => r.pinfl === P[2]).totalTiyin, String(435000050n));
  assert.strictEqual(b.mapping.columns.find((c) => c.letter === 'K').source, 'user');

  // ── 3. Saqlash + eslab qolish → keyingi oy (boshqa oy, shu shakl) o'zi taniydi ──
  const columns = b.mapping.columns.filter((c) => c.kind === 'amount').map((c) => ({ key: c.key, leaf: c.leaf, label: c.label, code: c.code ?? 'SKIP' }));
  assert.strictEqual(await svc.rememberColumns(columns), columns.length);
  const c = await svc.analyze('2026-06', f);
  const k = c.mapping.columns.find((x) => x.letter === 'K');
  assert.deepStrictEqual([k.code, k.source], ['USTAMA_BOSHQA', 'learned']);
  assert.strictEqual(c.suggestions.mismatched, 0);
  // Noma'lum kod eslab qolinmaydi; o'chirish
  assert.strictEqual(await svc.rememberColumns([{ key: 'x', leaf: 'x', code: 'YOQ_KOD' }]), 0);
  await svc.forgetLearned(k.key);
  assert.ok(!(await svc.listLearned()).some((x) => x.key === k.key));

  // ── 4. Ikki marta sanalgan ustun: J (bayram) ni ham, «jami»ni ham summa deb belgilasangiz — SKIP taklifi ──
  const d = await svc.analyze('2026-05', f, undefined, undefined, { K: 'USTAMA_BOSHQA', J: 'BAYRAM', I: 'TATIL' });
  assert.strictEqual(d.suggestions.mismatched, 0);
  // Foydalanuvchi xato: oklad ustunini «hisobga olinmasin» — farq taklifi: F ni qo'shish
  const e = await svc.analyze('2026-05', f, undefined, undefined, { F: 'SKIP', K: 'USTAMA_BOSHQA' });
  assert.strictEqual(e.suggestions.mismatched, 3);
  assert.deepStrictEqual([e.suggestions.items[0].letter, e.suggestions.items[0].action, e.suggestions.items[0].rows], ['F', 'ADD', 3]);


  // ── 5. Soliq hisoboti (ish haqi) yuklangan oy — solishtirish u bilan; farq: K ustuni ──
  T.payrollBatch.push({ id: 'pb1', period: '2026-07', status: 'COMMITTED', scope: 'ALL' });
  const pay = [7_800_000, 9_400_000, 4_350_000.5];
  P.forEach((p, i) => T.payrollEntry.push({ id: `pe${i}`, employeePinfl: p, period: '2026-07', batchId: 'pb1', baseTiyin: BigInt(Math.round(pay[i] * 100)), totalTiyin: BigInt(Math.round(pay[i] * 100)), bonusTiyin: 0n, deletedAt: null }));
  const g = await svc.analyze('2026-07', f);
  assert.strictEqual(g.suggestions.against, 'SOLIQ');
  assert.deepStrictEqual([g.suggestions.mismatched, g.suggestions.items[0].letter, g.suggestions.items[0].action], [2, 'K', 'ADD']);
  assert.strictEqual(g.check.state, 'MISMATCH');
  const h = await svc.analyze('2026-07', f, undefined, undefined, { K: 'USTAMA_BOSHQA' });
  assert.deepStrictEqual([h.suggestions.mismatched, h.check.state], [0, 'MATCHED'], 'soliq hisobotiga mos');

  // ── 6. Saqlash → Xarajatlar siyosatida komponent bo'yicha summa (Markaz / hudud xodimlari) ──
  T.employee.find((e) => e.pinfl === P[1]).regionCode = 3;
  T.region.push({ code: 3, name: 'Andijon', isActive: true });
  const saved = await svc.commit({ period: '2026-07', fileName: f.originalname, userId: 'u1', rows: h.rows.map((r) => ({ pinfl: r.pinfl, fullName: r.fullName, workedDays: r.workedDays, rate: r.rate, items: new Map(Object.entries(r.items).map(([k, v]) => [k, BigInt(v)])) })) });
  assert.strictEqual(saved.saved, 3);
  const { ExpensePolicyService } = require('../dist/modules/expense-policy/expense-policy.service');
  const pol = new ExpensePolicyService(db.client, { log: async () => null }, {});
  const am = await pol.payrollAmounts('2026-07-01', '2026-07-31');
  const ok = am.rows.find((x) => x.code === 'OKLAD');
  assert.deepStrictEqual([ok.centerTiyin, ok.regionTiyin, ok.centerEmployees, ok.regionEmployees], [String(800000050n), String(600000000n), 2, 1]);
  assert.strictEqual(am.rows.find((x) => x.code === 'USTAMA_BOSHQA').centerTiyin, String(45000000n));
  console.log('OK t-composition-smart');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});