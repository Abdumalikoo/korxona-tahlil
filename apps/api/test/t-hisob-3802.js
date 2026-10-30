// 3802 — ikki hisob: «Call markaz» deb kelgan pul — butun 3802 hovuzi (hamma bo'limlar), Marksheyder puli — alohida.
// Sarf — oylik shablon: Marksheyder varag'i / bo'limi Marksheyderga, qolgani hovuzga; hisobga olinmaydigan oylar;
// soddalashgan shablon (F.I.SH + Bo'lim + Jami) o'qiladi. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const fakeDb = require('./fakedb');
const { Hisob3802Service } = require('../dist/modules/qomita/hisob-3802.service');
const { parseVedomostWorkbook } = require('../dist/modules/qomita/vedomost-3802.parse');

const som = (n) => BigInt(n) * 100n;
const sec = (name, people, extra = {}) => ({ name, employees: people.map((t, i) => ({ row: i + 1, fullName: `Namuna ${name} ${i}`, position: '', amounts: {}, totalTiyin: String(som(t)), note: '' })), totalTiyin: String(som(people.reduce((a, b) => a + b, 0))), fileTotalTiyin: null, ok: true, ...extra });

(async () => {
  // ── 1. Soddalashgan shablon: F.I.SH, Bo'lim, Jami; Marksheyder varag'i alohida belgilanadi
  const wb = new ExcelJS.Workbook();
  const add = (name, rows) => {
    const ws = wb.addWorksheet(name);
    ws.getCell('A1').value = '2026 yil iyun oyida 3802 dan olingan pullar';
    ['F.I.SH', "Bo'lim", 'Jami'].forEach((c, i) => (ws.getCell(3, i + 1).value = c));
    rows.forEach(([n, d, t], i) => {
      const r = ws.getRow(4 + i);
      r.getCell(1).value = n;
      r.getCell(2).value = d;
      r.getCell(3).value = t;
    });
  };
  add('2026 IYUN', [['Namuna Bir', 'Call-Markazi bo‘limi', 100], ['Namuna Ikki', "Call-Markazi bo'limi", 50], ['Namuna Uch', 'TOSHKENT SHAHAR', 70]]);
  add('Маркшейдерлик булими (Iyun)', [['Namuna Tort', "Marksheyderlik xizmati bo'limi", 40]]);
  const parsed = parseVedomostWorkbook(wb);
  assert.strictEqual(parsed.periods.length, 1);
  const jun = parsed.periods[0];
  assert.strictEqual(jun.period, '2026-06');
  const names = jun.sections.map((s) => [s.name, s.employees.length, s.totalTiyin, s.marksheyder]);
  assert.deepStrictEqual(names, [
    ['Call-Markazi bo‘limi', 2, String(som(150)), false],
    ['TOSHKENT SHAHAR', 1, String(som(70)), false],
    ["Marksheyderlik xizmati bo'limi", 1, String(som(40)), true],
  ], "bo'lim ustuni bo'yicha (apostrof farqisiz), Marksheyder varag'i belgilangan");

  // ── 2. Ikki hisob
  const db = fakeDb();
  const T = db.tables;
  T.incomeCategory.push({ code: 'QOMITA_22', label: "Qo'mita ajratmasi: Call markaz", order: 1 }, { code: 'QOMITA_20', label: "Qo'mita ajratmasi: Marksheyder", order: 2 });
  const inc = (id, period, code, amount, importBatchId = null) => T.income.push({ id, date: new Date(`${period}-20T07:00:00Z`), period, amountTiyin: som(amount), categoryCode: code, segment: 'QOMITA', source: 'IMPORT', importBatchId, deletedAt: null });
  inc('i1', '2026-05', 'QOMITA_22', 1000, 'kassa:2026-05');
  inc('i2', '2026-05', 'QOMITA_20', 300);
  inc('i3', '2026-07', 'QOMITA_22', 2000);
  T.income.push({ id: 'del', date: new Date('2026-05-20T07:00:00Z'), period: '2026-05', amountTiyin: som(999), categoryCode: 'QOMITA_22', segment: 'QOMITA', source: 'IMPORT', importBatchId: null, deletedAt: new Date() });
  const ved = (p, sections) => T.setting.push({ key: `3802.ved.${p}`, value: { period: p, sections } });
  // Eski saqlangan shakl: marksheyder belgisi yo'q — bo'lim nomidan aniqlanadi
  ved('2026-05', [sec('Markaziy apparat', [200, 100]), sec('"Call-Markazi" bo\'limi', [400]), sec("MARKSHEYDERLIK XIZMATI BO'LIMI", [80])]);
  ved('2026-06', [sec('Markaziy apparat', [500]), sec('Andijon viloyati', [100], { marksheyder: false }), sec('Boshqa', [60], { marksheyder: true })]);
  ved('2026-07', [sec('Markaziy apparat', [900]), sec("MARKSHEYDERLIK XIZMATI BO'LIMI", [90])]);
  const svc = new Hisob3802Service(db.client, { log: async () => {} });

  let d = await svc.ledger('2026-05', '2026-07');
  const m = (side, p) => d[side].months.find((x) => x.period === p);
  assert.deepStrictEqual([m('pool', '2026-05').incomeTiyin, m('pool', '2026-05').spendTiyin], [String(som(1000)), String(som(700))], 'May: hovuz — Call markaz puli, hamma bo‘limlar sarfi');
  assert.deepStrictEqual([m('marksheyder', '2026-05').incomeTiyin, m('marksheyder', '2026-05').spendTiyin], [String(som(300)), String(som(80))], 'May: Marksheyder alohida');
  assert.strictEqual(m('pool', '2026-06').spendTiyin, String(som(600)));
  assert.strictEqual(m('marksheyder', '2026-06').spendTiyin, String(som(60)), 'belgi bo‘yicha');
  assert.strictEqual(d.pool.incomeTiyin, String(som(3000)), "o'chirilgani hisobga olinmaydi");
  assert.strictEqual(d.pool.spendTiyin, String(som(700 + 600 + 900)));
  assert.strictEqual(m('pool', '2026-07').balanceTiyin, String(som(3000 - 2200)), "yig'ma qoldiq");
  assert.strictEqual(d.pool.sections.find((s) => s.name === 'Markaziy apparat').totalTiyin, String(som(300 + 500 + 900)));
  assert.strictEqual(d.contract.amountTiyin, String(som(7_200_000_000)), 'standart shartnoma 7,2 mlrd');

  // Iyul sarfi hisobga olinmaydi — shablon o'chirilmaydi
  await svc.setExcluded({ periods: ['2026-07', 'noto‘g‘ri'] }, 'u1');
  d = await svc.ledger('2026-05', '2026-07');
  assert.deepStrictEqual(d.excluded, ['2026-07']);
  assert.deepStrictEqual([m('pool', '2026-07').spendTiyin, m('pool', '2026-07').vedomost, m('pool', '2026-07').incomeTiyin], ['0', 'EXCLUDED', String(som(2000))], 'sarf olinmaydi, kirim qoladi');
  assert.ok(T.setting.some((s) => s.key === '3802.ved.2026-07'), 'shablon saqlanib qoldi');
  assert.strictEqual(d.marksheyder.spendTiyin, String(som(80 + 60)));

  // Oy tafsiloti: bo'limlar va xodimlar, hovuz va Marksheyder alohida
  const md = await svc.monthDetail('2026-05');
  assert.deepStrictEqual(md.pool.map((s) => [s.name, s.employees.length]), [['Markaziy apparat', 2], ['"Call-Markazi" bo\'limi', 1]]);
  assert.deepStrictEqual(md.marksheyder.map((s) => s.employees[0].totalTiyin), [String(som(80))]);
  assert.strictEqual((await svc.monthDetail('2026-07')).excluded, true);
  await assert.rejects(() => svc.monthDetail('2026-13'), /Oy/);

  await svc.setContract({ year: '2026', amount: '7 500 000 000' }, 'u1');
  d = await svc.ledger('2026-05', '2026-07');
  assert.strictEqual(d.contract.amountTiyin, String(som(7_500_000_000)));
  await assert.rejects(() => svc.setContract({ year: '26', amount: '1' }, 'u1'), /Yil/);

  console.log('OK t-hisob-3802');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
