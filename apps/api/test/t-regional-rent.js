// Xarajatlar › Hudud ijaralari: fayl o'qish — ilova shabloni (bitta varaq, hudud/tuman/oylar) va vazirlik «Ижара маълумот»
// fayli (har viloyat — alohida varaq, «Жами» qatori, varaq tepasida ИНН, «МАРКАЗ» qatori); hudud nomlarini tanish.
// TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const { parseRentWorkbook, regionOf, RENT_SPEC, REGION_ORDER } = require('../dist/modules/leases/regional-rent.parse');
const { buildTemplate } = require('../dist/common/templates/sheet-template');

const REGIONS = [
  { code: 0, name: 'Markaz' },
  { code: 3, name: 'Andijon viloyati' },
  { code: 12, name: 'Navoiy viloyati' },
  { code: 26, name: 'Toshkent shahri' },
  { code: 27, name: 'Toshkent viloyati' },
  { code: 35, name: "Qoraqalpog'iston Respublikasi" },
];
const MON = ['январ', 'феврал', 'март', 'апрел', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

/** Vazirlik varag'i: tepada ИНН / viloyat, 5-qator guruh, 6-qator — ustunlar va oylar */
function ministrySheet(wb, name, title, inn, rows) {
  const ws = wb.addWorksheet(name);
  ws.getCell('B1').value = `ИНН : ${inn}`;
  ws.getCell('E2').value = title;
  const head = ['№', 'Ижарага олинган худуд номи', 'Манзили', 'Шартнома рақами', 'Шартнома санаси', 'Ижара майдони (кв.метр)', 'Ижара суммаси (1 йил учун)', 'Пули туланган сана'];
  head.forEach((h, i) => {
    ws.getCell(5, i + 2).value = h;
    ws.getCell(6, i + 2).value = h;
  });
  MON.forEach((m, i) => {
    ws.getCell(5, 10 + i).value = 'Ижара шартномасининг ойлик тўловлари';
    ws.getCell(6, 10 + i).value = m;
  });
  ws.getCell(6, 22).value = 'Жами сумма';
  ws.getCell(6, 23).value = 'Изоҳ';
  let r = 7;
  for (const x of rows) {
    ws.getCell(r, 2).value = r - 6;
    ws.getCell(r, 3).value = x.name;
    ws.getCell(r, 4).value = 'Sun\'iy manzil';
    ws.getCell(r, 5).value = x.no ?? null;
    ws.getCell(r, 6).value = new Date(Date.UTC(2026, 0, 5));
    ws.getCell(r, 7).value = 25;
    x.m.forEach((v, i) => (ws.getCell(r, 10 + i).value = v));
    ws.getCell(r, 22).value = x.total ?? x.m.reduce((a, b) => a + (b || 0), 0);
    ws.getCell(r, 23).value = 'тўланмаган';
    r++;
  }
  ws.getCell(r, 3).value = 'Жами';
  ws.getCell(r, 22).value = 999999;
}

(async () => {
  // ── Hudud nomlari ──
  assert.strictEqual(regionOf('Қорақалпоқ вилояти', REGIONS), 35);
  assert.strictEqual(regionOf('Тошкент ш.', REGIONS), 26);
  assert.strictEqual(regionOf('Тошкент вил.', REGIONS), 27);
  assert.strictEqual(regionOf('Андижон вилояти', REGIONS), 3);
  assert.strictEqual(regionOf('Markaz', REGIONS), 0);
  assert.strictEqual(regionOf('Номаълум', REGIONS), null);
  assert.strictEqual(REGION_ORDER[0], 35, "tartib Qoraqalpog'istondan boshlanadi");

  // ── Vazirlik fayli ──
  const wb = new ExcelJS.Workbook();
  const m5 = (a) => [a, a - 1000, a, a - 500, a, 0, 0, 0, 0, 0, 0, 0];
  ministrySheet(wb, 'Андижон', 'Андижон вилояти', '200000001', [
    { name: 'Андижон шаҳри', no: 'A-1', m: m5(100000) },
    { name: 'Асака тумани', no: 'A-2', m: m5(50000.5), total: 1 },
    { name: 'Бўз тумани', m: Array(12).fill(0) },
  ]);
  ministrySheet(wb, 'Тошкент ш.', 'Тошкент шаҳри', '200000002', [
    { name: 'Бектемир тумани', no: 'T-1', m: m5(260000) },
    { name: 'МАРКАЗ (НЕЕДС БИНОСИ)', no: 'M-1', m: m5(3300000) },
  ]);
  const p = parseRentWorkbook(wb, REGIONS);
  assert.strictEqual(p.format, 'MINISTRY');
  assert.deepStrictEqual(p.sheets, ['Андижон', 'Тошкент ш.']);
  assert.strictEqual(p.rows.length, 5, "«Жами» qatori o'qilmaydi");
  assert.deepStrictEqual(p.skipped.map((s) => s.reason), ['«Жами» qatori', '«Жами» qatori']);
  const by = Object.fromEntries(p.rows.map((r) => [r.district, r]));
  assert.strictEqual(by['Андижон шаҳри'].regionCode, 3);
  assert.deepStrictEqual(by['Андижон шаҳри'].months.slice(0, 6), [100000, 99000, 100000, 99500, 100000, 0]);
  assert.strictEqual(by['Андижон шаҳри'].lessorTin, '200000001', 'ИНН — varaq tepasidan');
  assert.strictEqual(by['Андижон шаҳри'].contractDate, '2026-01-05');
  assert.strictEqual(by['Асака тумани'].total, 1, '«Жами» o‘qiladi (tekshiruv uchun)');
  assert.strictEqual(by['Бектемир тумани'].regionCode, 26);
  assert.strictEqual(by['МАРКАЗ (НЕЕДС БИНОСИ)'].regionCode, 0, "«МАРКАЗ» qatori — Markaz ijarasi");
  assert.ok(!JSON.stringify(p).includes('тўланмаган'), "izoh (to'langan / to'lanmagan) o'qilmaydi");

  // ── Bitta umumiy shartnoma (summa katagi 3 tuman qatori bo'ylab birlashtirilgan) — summa teng bo'linadi ──
  const wm = new ExcelJS.Workbook();
  ministrySheet(wm, 'Навоий', 'Навоий вилояти', '200000003', [
    { name: 'Зарафшон ш', no: 'N-1', m: [1000.01, 900, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], total: 1900.01 },
    { name: 'Кармана т', no: null, m: [] },
    { name: 'Нурота т', no: null, m: [] },
  ]);
  const nws = wm.getWorksheet('Навоий');
  for (const c of ['J', 'K', 'V', 'E']) nws.mergeCells(`${c}7:${c}9`);
  const np = parseRentWorkbook(wm, REGIONS);
  assert.deepStrictEqual(np.rows.map((r) => r.months[0]), [333.34, 333.34, 333.33], 'yanvar 1000,01 → 3 ga (qoldiq tiyin — birinchi qatorlarga)');
  assert.deepStrictEqual(np.rows.map((r) => r.months[1]), [300, 300, 300]);
  assert.strictEqual(np.rows.reduce((s, r) => s + Math.round(r.months[0] * 100), 0), 100001, 'ulushlar yig‘indisi = umumiy summa (tiyingacha)');
  assert.ok(np.rows.every((r) => r.warnings.some((w) => w.includes('3 qator'))));
  assert.ok(np.rows.every((r) => r.contractNo === 'N-1'), 'birlashgan shartnoma raqami — hammasiga');

  // ── Ilova shabloni: bo'sh shablon → to'ldiriladi → o'qiladi ──
  const t = new ExcelJS.Workbook();
  await t.xlsx.load(await buildTemplate(RENT_SPEC));
  const ws = t.worksheets[0];
  const col = (k) => RENT_SPEC.fields.findIndex((f) => f.key === k) + 1;
  const put = (r, region, district, months, extra = {}) => {
    ws.getCell(r, col('region')).value = region;
    ws.getCell(r, col('district')).value = district;
    months.forEach((v, i) => v && (ws.getCell(r, col(`m${i}`)).value = v));
    for (const [k, v] of Object.entries(extra)) ws.getCell(r, col(k)).value = v;
  };
  put(5, "Qoraqalpog'iston Respublikasi", 'Nukus shahri', m5(40000), { contractNo: 'Q-1', lessorTin: '300 000 003' });
  put(6, 'Navoiy viloyati', 'Zarafshon shahar', m5(530000));
  put(7, 'Navoiy viloyati', 'Karmana tumani', []);
  const tp = parseRentWorkbook(t, REGIONS);
  assert.strictEqual(tp.format, 'TEMPLATE');
  assert.deepStrictEqual(tp.rows.map((r) => [r.regionCode, r.district, r.months[0], r.months[4]]), [
    [35, 'Nukus shahri', 40000, 40000],
    [12, 'Zarafshon shahar', 530000, 530000],
    [12, 'Karmana tumani', 0, 0],
  ]);
  assert.strictEqual(tp.rows[0].lessorTin, '300000003');
  assert.strictEqual(tp.rows[0].contractNo, 'Q-1');

  // Ijara ma'lumoti yo'q fayl
  const empty = new ExcelJS.Workbook();
  empty.addWorksheet('Varaq').getCell('A1').value = 'boshqa jadval';
  assert.strictEqual(parseRentWorkbook(empty, REGIONS), null);

  console.log('OK t-regional-rent');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
