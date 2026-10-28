// 3802 › Har oylik real bajarilgan ishlar: vedomost faylini o'qish (oy — varaq nomi / sarlavha, nusxa va qismlar,
// Marksheyderlik, ustunlar → qismlar, bo'lim jamisi), oraliq bo'yicha qabul qilish va almashtirish. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { Vedomost3802Service } = require('../dist/modules/qomita/vedomost-3802.service');
const { parseVedomostWorkbook, periodFromName, periodFromTitle } = require('../dist/modules/qomita/vedomost-3802.parse');

const COLS = ['F.I.SH', 'Lavozimi', 'Lavozim maoshi', "Rag'batlanti-rish ustama to'lovi", 'Lavozim maoshi miqdorida mukofot puli', 'Tuman. koyff.', "Mehnat ta'tili", "Foydalanilmagan mehnat ta'tili uchun", "Mehnat ta'tiliga moddiy yordam", 'Vaqtinchalik mehnatga layoqatsizlik nafaqasi', 'Jami daromad'];
const MCOLS = ['F.I.SH', 'Lavozimi', 'Lavozim maoshi', "Rag'batlanti-rish ustama to'lovi", 'Lavozim maoshi miqdorida mukofot puli', 'Lavozim maoshi ustamasi', 'Ovqatlanish xarajatlari', "Yo'lkira xarajatlari", 'Jami daromad'];

/** Varaq: sarlavha (oy), ustunlar, qalin bo'lim qatori (jami bilan), xodimlar, imzolar */
function sheet(wb, name, titleMonth, sections, opts = {}) {
  const ws = wb.addWorksheet(name, { state: opts.hidden ? 'hidden' : 'visible' });
  const cols = opts.marksheyder ? MCOLS : COLS;
  ws.getCell('A2').value = `Tasdiqlangan shtat jadvaliga asosan ${titleMonth} oyida xodimlarga hisoblangan ish haqlari to'g'risida ma'lumot`;
  cols.forEach((c, i) => (ws.getCell(4, i + 1).value = c));
  let r = 5;
  const jami = cols.length;
  for (const s of sections) {
    const sum = s.people.reduce((t, p) => t + p.oklad + p.ustama + (p.mukofot ?? 0) + (p.tatil ?? 0), 0);
    const sr = ws.getRow(r++);
    sr.getCell(1).value = s.name;
    sr.getCell(1).font = { bold: true };
    sr.getCell(3).value = s.people.reduce((t, p) => t + p.oklad, 0);
    sr.getCell(jami).value = s.badTotal ?? sum;
    for (const p of s.people) {
      const row = ws.getRow(r++);
      row.getCell(1).value = p.name;
      row.getCell(2).value = p.pos;
      row.getCell(3).value = p.oklad;
      row.getCell(4).value = p.ustama;
      if (p.mukofot) row.getCell(5).value = p.mukofot;
      if (p.tatil && !opts.marksheyder) row.getCell(7).value = p.tatil;
      row.getCell(jami).value = { formula: 'SUM(C1:J1)', result: p.oklad + p.ustama + (p.mukofot ?? 0) + (p.tatil ?? 0) };
      if (p.note) row.getCell(jami + 1).value = p.note;
    }
  }
  ws.getRow(r + 1).values = [null, '"Soliq-servis" AJ direktori', null, null, null, null, null, 'T.Sinovov'];
  ws.getRow(r + 3).values = [null, 'Bosh hisobchi', null, null, null, null, null, 'A.Testova'];
  ws.getRow(r + 5).values = [null, null, 999_999_999];
  return ws;
}
const P = (name, oklad, extra = {}) => ({ name, pos: 'Bosh mutaxassis', oklad, ustama: oklad * 0.4, ...extra });
const CENTER = { name: 'Markaziy apparat', people: [P('Sinov Birinchi', 5_000_000, { mukofot: 5_000_000 }), P('Sinov Ikkinchi', 4_000_000, { tatil: 3_000_000, note: 'otpuska' })] };
const CALL = { name: 'Call markaz', people: [P('Sinov Uchinchi', 3_000_000), P('Sinov Tortinchi', 3_000_000)] };

async function file() {
  const wb = new ExcelJS.Workbook();
  sheet(wb, 'январ', '2022 yilning yanvar', [CENTER, CALL]);
  sheet(wb, 'fevral', '2022 yilning fevral', [CENTER, CALL]);
  sheet(wb, 'fevral (2)', '2022 yilning fevral', [CALL]); // nusxa (bo'lak)
  sheet(wb, '2023 mart', '2023 yilning mart', [CENTER]);
  sheet(wb, '2023 mart 2-qism', '2023 yilning Mart', [CALL]); // qism
  sheet(wb, '2024  Oktabr (04.11)', '2024 yilning Sentabr', [CENTER]); // sarlavhada boshqa oy
  sheet(wb, '2025  Май (05.05)', '2025 yilning Мау', [CENTER]);
  sheet(wb, 'Маркшейдерлик булими (май)', '2025 yilning Мау', [{ name: "MARKSHEYDERLIK XIZMATI BO'LIMI", people: [P('Sinov Beshinchi', 5_400_000)] }], { marksheyder: true });
  sheet(wb, 'Sentyabr', '2022 yilning sentyabr', [{ ...CALL, people: [P('Sinov Uchinchi', 3_000_000), P('Sinov Tortinchi', 2_000_000)] }], { hidden: true });
  sheet(wb, 'Sentyabr (2)', '2022 yilning sentyabr', [CALL], { hidden: true }); // yashirin boshqa versiya
  sheet(wb, '2026 Avgust', '2026 yilning AVGUST', [{ ...CENTER, badTotal: 1 }]);
  wb.addWorksheet('Izoh').getCell('A1').value = "Bu varaq vedomost emas";
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), originalname: '3802-vedomost.xlsx' };
}

(async () => {
  // ── Oy: varaq nomi va sarlavha ──
  assert.deepStrictEqual(periodFromName('2025  ЯНВАР (05.02.2025)'), { year: 2025, month: 1 });
  assert.deepStrictEqual(periodFromName('2025  МАРТ (01,04)'), { year: 2025, month: 3 }, 'qavsdagi sana — oy emas');
  assert.deepStrictEqual(periodFromName('Маркшейдерлик булими (июль)'), { year: null, month: 7 }, 'qavsdagi oy nomi — olinadi');
  assert.deepStrictEqual(periodFromName('январ'), { year: null, month: 1 });
  assert.deepStrictEqual(periodFromName('2024 iyul (2)'), { year: 2024, month: 7 });
  assert.deepStrictEqual(periodFromTitle('Tasdiqlangan shtat jadvaliga asosan 2026 yilning AVGUST oyida xodimlarga'), { year: 2026, month: 8 });
  assert.deepStrictEqual(periodFromTitle('… 2025 yilning Мау oyida …'), { year: 2025, month: 5 });
  console.log('  ✓ oy: varaq nomi va sarlavha');

  // ── Fayl ──
  const f = await file();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(f.buffer);
  const { periods, unknown } = parseVedomostWorkbook(wb);
  assert.deepStrictEqual(periods.map((p) => p.period), ['2022-01', '2022-02', '2022-09', '2023-03', '2024-10', '2025-05', '2026-08']);
  assert.deepStrictEqual(unknown.map((u) => u.sheet), ['Izoh']);
  const by = new Map(periods.map((p) => [p.period, p]));
  const jan = by.get('2022-01');
  assert.deepStrictEqual([jan.employees, jan.sections.map((s) => s.name)], [4, ['Markaziy apparat', 'Call markaz']]);
  const e1 = jan.sections[0].employees[0];
  assert.deepStrictEqual([e1.fullName, e1.position, e1.amounts.OKLAD, e1.amounts.USTAMA_40, e1.amounts.MUKOFOT, e1.totalTiyin], ['Sinov Birinchi', 'Bosh mutaxassis', '500000000', '200000000', '500000000', '1200000000']);
  assert.deepStrictEqual([jan.sections[0].employees[1].amounts.TATIL, jan.sections[0].employees[1].note], ['300000000', 'otpuska']);
  const all = JSON.stringify(periods);
  assert.ok(!all.includes('Sinovov') && !all.includes('Testova') && !all.includes('99999999900'), 'imzolar va ulardan keyingi qatorlar o‘qilmaydi');
  assert.strictEqual(jan.okladTiyin, String((5_000_000 + 4_000_000 + 3_000_000 + 3_000_000) * 100));
  // Nusxa — olinmaydi
  assert.deepStrictEqual([by.get('2022-02').used, by.get('2022-02').skipped.map((s) => s.sheet), by.get('2022-02').employees], [['fevral'], ['fevral (2)'], 4]);
  // Qism — qo'shiladi
  assert.deepStrictEqual([by.get('2023-03').used, by.get('2023-03').employees], [['2023 mart', '2023 mart 2-qism'], 4]);
  // Sarlavhada boshqa oy — varaq nomi olinadi, ogohlantirish
  assert.ok(by.get('2024-10').warnings.some((w) => /Sarlavhada 9-oy, varaq nomida 10-oy/.test(w)));
  // Marksheyderlik — o'z oyiga qo'shiladi, qismlari bilan
  const may = by.get('2025-05');
  assert.deepStrictEqual([may.used, may.employees], [['2025  Май (05.05)', 'Маркшейдерлик булими (май)'], 3]);
  // Yashirin ikki versiya: summalari farqli — biri olinadi, ogohlantirish
  const sep = by.get('2022-09');
  assert.deepStrictEqual([sep.used.length, sep.skipped.length], [1, 1]);
  assert.match(sep.skipped[0].reason, /nusxasi \(yashirin\) — 1 xodimda summa boshqacha/);
  // Bo'lim jamisi mos emas — ogohlantirish
  assert.ok(by.get('2026-08').warnings.some((w) => /Bo'lim jamisi xodimlar yig'indisiga mos emas: Markaziy apparat/.test(w)));
  assert.strictEqual(by.get('2026-08').sections[0].ok, false);
  console.log('  ✓ fayl: oylar, nusxa, qism, Marksheyderlik, ustunlar, jami tekshiruvi');

  // ── Servis: ko'rish → oraliq bo'yicha qabul qilish ──
  const db = fakeDb();
  db.tables.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  const svc = new Vedomost3802Service(db.client, new AuditService(db.client));
  const a = await svc.analyze(f);
  assert.deepStrictEqual([a.from, a.to, a.periods.length, a.periods.every((p) => p.saved === null)], ['2022-01', '2026-08', 7, true]);
  assert.ok(!db.tables.setting.some((s) => s.key.startsWith('3802.ved')), 'ko‘rish — saqlamaydi');
  await assert.rejects(() => svc.commit(f, '2025-01', '2024-01', 'adm'), /keyin bo'lmasin/);
  await assert.rejects(() => svc.commit(f, '2027-01', '2027-12', 'adm'), /oralig'ida oy yo'q/);
  await assert.rejects(() => svc.commit(f, '2025', '2026-08', 'adm'), /Oraliqni tanlang/);
  const c = await svc.commit(f, '2024-01', '2026-12', 'adm');
  assert.deepStrictEqual([c.saved, c.replaced, c.periods], [3, 0, ['2024-10', '2025-05', '2026-08']], 'faqat tanlangan oraliq');
  let list = (await svc.list()).periods;
  assert.deepStrictEqual(list.map((p) => p.period), ['2026-08', '2025-05', '2024-10']);
  assert.strictEqual(list[1].sheets.length, 2);
  const again = await svc.analyze(f);
  assert.deepStrictEqual(again.periods.filter((p) => p.saved).map((p) => p.period), ['2024-10', '2025-05', '2026-08']);
  const c2 = await svc.commit(f, '2025-05', '2025-05', 'adm');
  assert.deepStrictEqual([c2.saved, c2.replaced], [1, 1], 'saqlangan oy — almashtiriladi');
  const d = await svc.detail('2025-05');
  assert.deepStrictEqual(d.sections.map((s) => s.name), ['Markaziy apparat', "MARKSHEYDERLIK XIZMATI BO'LIMI"]);
  assert.deepStrictEqual(d.components.map((x) => x.code), ['OKLAD', 'USTAMA_40', 'MUKOFOT', 'TATIL']);
  assert.strictEqual(d.sections[0].okladTiyin, String(9_000_000 * 100));
  await assert.rejects(() => svc.detail('2023-03'), /qabul qilinmagan/);
  await assert.rejects(() => svc.detail('2023-3'), /Oy noto'g'ri/);
  assert.strictEqual(db.tables.auditLog.filter((x) => x.entityType === 'vedomost_3802').length, 2);
  console.log('  ✓ servis: ko‘rish, oraliq bo‘yicha qabul qilish, almashtirish, oy tafsiloti');

  // O'chirish: bitta oy va oraliq
  const r1 = await svc.remove('2025-05', '2025-05', 'adm');
  assert.deepStrictEqual(r1.periods, ['2025-05']);
  assert.deepStrictEqual((await svc.list()).periods.map((p) => p.period), ['2026-08', '2024-10']);
  await assert.rejects(() => svc.detail('2025-05'), /qabul qilinmagan/);
  await assert.rejects(() => svc.remove('2025-05', '2025-05', 'adm'), /qabul qilingan oy yo'q/);
  await assert.rejects(() => svc.remove('2026-01', '2025-01', 'adm'), /noto'g'ri/);
  const r2 = await svc.remove('2024-01', '2026-12', 'adm');
  assert.strictEqual(r2.removed, 2);
  assert.strictEqual((await svc.list()).periods.length, 0);
  assert.ok(!db.tables.setting.some((x) => /^3802\.ved\.\d/.test(x.key)), 'oy yozuvlari o\'chdi');
  console.log('  ✓ o‘chirish: oy va oraliq');

  console.log('t-vedomost-3802: OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
