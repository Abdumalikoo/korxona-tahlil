// Asosiy vositalar › Xarid shabloni: umumiy shablon tizimi (ikki qatorli sarlavha, «Жами» va imzo qatorlari, sana va son
// ko'rinishlari, bo'sh shablon → qayta o'qish) va aniqlab oluvchi filtr (tur, holat, chegara, summa xatolari, qo'lda tur).
// 1-bosqich — faqat reestr (settings), raqamlarga ta'sir qilmaydi. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { XaridService } = require('../dist/modules/fixed-assets/xarid.service');
const { classify, amountsOf, unitOf, platformOf, methodOf, statusOf } = require('../dist/modules/fixed-assets/xarid.classify');
const { parseWithTemplate, dateOf, numberOf, sheetKey } = require('../dist/common/templates/sheet-template');
const { XARID_SPEC } = require('../dist/modules/fixed-assets/xarid.classify');

// Sarlavha: 4-qator — guruh, 5-qator — ustun (fayldagidek), 6-qator — ustun raqamlari
const G = ['Т/р', 'Тузилма номи', 'Талабнома берди', 'Талабнома берди', 'Талабнома берди', 'Талабнома берди', 'Асослантириш (мақсад ва зарурат)', 'Товар (иш, хизмат) номи', 'Тури', 'Ўлчов бирлиги', 'Миқдори', 'Ҳарид усули', 'Ҳарид усули', 'Шартнома', 'Шартнома', 'Шартнома', 'Шартнома', 'Шартнома', 'Шартнома', 'Счёт фактура', 'Счёт фактура', 'Изоҳ'];
const S = ['Т/р', 'Тузилма номи', 'бўлим номи', 'рақами', 'санаси', 'маъсул ҳодим', 'Асослантириш (мақсад ва зарурат)', 'Товар (иш, хизмат) номи', 'Тури', 'Ўлчов бирлиги', 'Миқдори', 'тури', 'платформа', 'номи', 'рақами', 'санаси', 'сони', '1 лик сумма', 'жами сумма', 'рақами', 'санаси', 'Изоҳ'];

function book(rows) {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Бўш варақ').getCell('A1').value = 'Изоҳ';
  const ws = wb.addWorksheet('Эхтиёжлар');
  ws.getCell('A1').value = 'Моддий-техника эҳтиёжларини шакллантириш юзасидан';
  ws.getCell('A2').value = 'МАЪЛУМОТНОМА';
  G.forEach((h, i) => (ws.getCell(4, i + 1).value = h));
  S.forEach((h, i) => (ws.getCell(5, i + 1).value = h));
  ws.mergeCells(4, 3, 4, 6);
  S.forEach((_, i) => (ws.getCell(6, i + 1).value = i + 1));
  let r = 7;
  for (const x of rows) ws.getRow(r++).values = x;
  ws.getRow(r++).values = [null, 'Жами', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 999999999];
  ws.getRow(r++).values = ['Масъул шахс: ___________________'];
  ws.getRow(r++).values = ['Имзо: ___________________'];
  return wb;
}
// [№, tuzilma, bo'lim, talabnoma, sana, mas'ul (sun'iy), asoslash, nomi, turi, o'lchov, miqdor, usul, platforma, kontragent, sh.raqam, sh.sana, soni, 1lik, jami, SF raqam, SF sana, izoh]
const ROWS = [
  [1, 'Марказ', 'Хўжалик', '001-иф', new Date(Date.UTC(2026, 6, 1)), 'Т.Синов', 'Марказни таъминлаш', 'Кондиционер', 'товар', 'дона', 2, 'электрон дўкон', 'https://xarid.uzex.uz/shop/lot/1', 'Намуна МЧЖ', 'K-1', new Date(Date.UTC(2026, 6, 10)), 2, 6000000, 12000000, 'SF-1', '15.07.2026', 'бажарилди'],
  [2, 'Фермер', 'Хўжалик', '002-иф', 46224, 'Т.Синов', 'Таъминлаш', 'Стул ҳодимлар учун', 'товар', 'дона', 10, 'электрон дукон', 'https://xt-xarid.uz/workspace/1', 'Намуна МЧЖ', 'K-2', '26.08.2026, 18:60', 10, 500000, 5000000, 'SF-2', 46262, 'бажарилди'],
  [3, 'Марказ', 'Хўжалик', '003-иф', 'режада', 'Т.Синов', 'Захира', 'Ручка', 'товар', 'дона', 100, 'электрон дўкон', 'https://xarid.uzex.uz/shop/lot/2', 'Намуна МЧЖ', 'K-3', '2026-09-01', 100, 2000, 200000, null, null, 'бажарилди'],
  [4, 'Маркшрейдр', 'Бўлим', '004-иф', '01.09.2026', 'Т.Синов', 'Хавфсизлик', 'Боди камера', 'товар', 'дона', 4, 'танлов', 'https://ebirja.uz/ru/dashboard', 'Намуна МЧЖ', 'K-4', '02.09.2026', 4, 40000000, 40000000, 'SF-4', '03.09.2026', 'бажарилди'],
  [5, 'Марказ', 'Бўлим', '005-иф', '01.09.2026', 'Т.Синов', 'Мустақиллик эсталик совғаси', 'ТВ', 'товар', 'дона', 3, 'электрон дўкон', 'https://xarid.uzex.uz/x', 'Намуна МЧЖ', 'K-5', '02.09.2026', 3, 3000000, 9000000, 'SF-5', '03.09.2026', 'бажарилди'],
  [6, 'Такс Фри', 'Бўлим', '006-иф', '01.09.2026', 'Т.Синов', 'Ички эхтиёж', 'Принтер таъмирлаш', 'хизмат', 'мартта', 1, 'тўғридан тўғри', 'тўғридан тўғри', 'Намуна МЧЖ', 'K-6', '02.09.2026', 1, 800000, 800000, 'SF-6', '03.09.2026', 'бажарилди'],
  [7, 'Фермер', 'Бўлим', '007-иф', '01.09.2026', 'Т.Синов', 'Кийим', 'Махсус жилет', 'товар', 'дона', 100, 'электрон дўкон', 'https://cabinet.cooperation.uz/1', 'Намуна МЧЖ', 'K-7', '02.09.2026', 9999999, 50000, 5000000, 'SF-7', '03.09.2026', 'бажарилди'],
  [8, 'Марказ', 'Бўлим', '008-иф', '01.09.2026', 'Т.Синов', 'Захира', 'Моноблок', 'товар', 'комплект', 1, null, null, null, null, null, null, null, null, null, null, 'Отказ'],
  [9, 'Ҳудудий бўлинма', 'Бўлим', '009-иф', '01.09.2026', 'Т.Синов', 'Захира', 'Буклет', 'товар', 'дона', 500, null, null, null, null, null, null, null, null, null, null, null],
];

(async () => {
  // ── Yordamchilar ──
  assert.strictEqual(sheetKey('Шартнома / жами сумма'), 'shartnomajamisumma');
  assert.strictEqual(sheetKey('Счёт фактура'), 'schyotfaktura');
  assert.strictEqual(dateOf('26.08.2026, 18:60'), '2026-08-26', 'vaqt (hatto noto‘g‘ri) e’tiborsiz');
  assert.strictEqual(dateOf(46224), '2026-07-21', 'Excel raqami (2026-01-01 = 46023)');
  assert.strictEqual(dateOf('30.02.2026'), '2026-02-28', 'mavjud bo‘lmagan kun — oy oxiri');
  assert.strictEqual(dateOf('режада'), null);
  assert.strictEqual(numberOf('1 234 567,50'), 1234567.5);
  assert.strictEqual(numberOf('1,234,567.50'), 1234567.5);
  assert.strictEqual(numberOf('-'), null);
  assert.ok(Number.isNaN(numberOf('abc')));
  assert.deepStrictEqual(['Марказ', 'Фермер', 'Маркшрейдр', 'Такс Фри', 'Ҳудудий бўлинма', 'ДСҚ'].map(unitOf), ['CENTER', 'FERMER', 'MARKSHEYDER', 'TAX_FREE', 'REGION', 'CENTER']);
  assert.deepStrictEqual([platformOf('https://xt-xarid.uz/a'), platformOf('https://xarid.uzex.uz/b'), platformOf('https://ebirja.uz'), platformOf('new.cooperation.uz SL1'), platformOf('тўғридан тўғри')], ['XT-Xarid', 'UZEX (xarid.uzex.uz)', 'E-birja', 'Kooperatsiya portali', "To'g'ridan-to'g'ri"]);
  assert.deepStrictEqual([methodOf('электрон дукон'), methodOf('электрон дўкон'), methodOf('миллий дўкон'), methodOf('танлов')], ["Elektron do'kon", "Elektron do'kon", "Milliy do'kon", 'Tanlov']);
  assert.deepStrictEqual([statusOf('бажарилди', false), statusOf('Отказ', true), statusOf('ижрода', false), statusOf(null, false), statusOf(null, true)], ['DONE', 'REJECTED', 'IN_PROGRESS', 'PLANNED', 'DONE']);

  // ── Filtr: tartib va chegara ──
  const k = (name, extra = {}, price = null, min = 5e6) => classify({ name, type: 'товар', purpose: '', ...extra }, price, min).kind;
  assert.strictEqual(k('Кондиционер', {}, 6e6), 'ASSET');
  assert.strictEqual(k('Кондиционер', {}, 4e6), 'LOW_VALUE', 'chegaradan arzon — kam baholi');
  assert.strictEqual(k('Кондиционер', {}, 4e6, 1e6), 'ASSET', 'chegara 1 mln bo‘lsa — asosiy vosita');
  assert.strictEqual(k('Иш столи табличка', {}, 17000), 'PRINT_GIFT', 'poligrafiya «stol» dan oldin');
  assert.strictEqual(k('Рахбар столи учун набор', {}, 900000), 'SUPPLY', 'sarf materiali «stol» dan oldin');
  assert.strictEqual(k('Принтер таъмирлаш', {}, 1e7), 'SERVICE', 'ta’mirlash — xizmat («printer» dan oldin)');
  assert.strictEqual(k('ТВ', { purpose: 'эсдалик совға' }, 3e6), 'PRINT_GIFT', 'sovg‘a — asoslashdan');
  assert.strictEqual(k('ТВ', {}, 6e6), 'ASSET', '«tv» — alohida so‘z');
  assert.strictEqual(k('Телефон рақами', {}, 5e6), 'SERVICE');
  assert.strictEqual(k('Номаълум буюм', {}, 7e6), 'ASSET', 'nomdan aniqlanmadi — narx bo‘yicha');
  assert.strictEqual(k('Номаълум буюм', {}, 7e3), 'SUPPLY');
  assert.strictEqual(k('Хизмат кўрсатиш', { type: 'хизмат' }, 1), 'SERVICE');

  // ── Summalar: xatolar to'g'rilanadi va ogohlantiriladi ──
  let a = amountsOf({ contractQty: 4, contractPrice: 40e6, contractTotal: 40e6 });
  assert.strictEqual(a.unitPrice, 10e6, '«1 lik» ustunida jami summa — 1 dona = jami ÷ soni');
  assert.ok(a.warnings[0].includes('jami summa yozilgan'));
  a = amountsOf({ contractQty: 9999999, contractPrice: 50000, contractTotal: 5e6 });
  assert.strictEqual(a.qty, 100, 'soni xato — jami ÷ 1 lik');
  a = amountsOf({ contractQty: 2, contractPrice: 1, contractTotal: 680000 });
  assert.strictEqual(a.unitPrice, 340000);
  a = amountsOf({ mktQty: 5, mktPrice: 1000, mktTotal: 5000 });
  assert.deepStrictEqual([a.total, a.estimate, a.unitPrice], [null, 5000, 1000], 'shartnoma (AB) yo‘q — summa yo‘q; taxminiy alohida');

  // ── O'qish: varaq va sarlavha topiladi; jami, imzo va raqamlar qatori tashlanadi ──
  const wb = book(ROWS);
  const p = parseWithTemplate(wb, XARID_SPEC);
  assert.strictEqual(p.sheet, 'Эхтиёжлар');
  assert.strictEqual(p.headerRow, 5);
  assert.strictEqual(p.rows.length, ROWS.length);
  assert.deepStrictEqual(p.skipped.map((s) => s.reason), ['ustun raqamlari qatori', 'jami yoki imzo qatori', 'jami yoki imzo qatori', 'jami yoki imzo qatori']);
  assert.strictEqual(p.columns.contractTotal, 19, '«Шартнома / жами сумма»');
  assert.strictEqual(p.columns.method, 12, '«Ҳарид усули / тури» — «Тури» bilan adashmaydi');
  assert.strictEqual(p.columns.type, 9);
  assert.strictEqual(p.columns.reqNo, 4, 'birlashgan guruh sarlavhasi');
  assert.ok(!Object.values(p.columns).includes(6), "mas'ul xodim ustuni o'qilmaydi");
  assert.deepStrictEqual([p.rows[1].values.reqDate, p.rows[1].values.contractDate, p.rows[1].values.invoiceDate], ['2026-07-21', '2026-08-26', '2026-08-28']);

  // ── Servis: tahlil → saqlash → ko'rinish → qoida → qo'lda tur → qayta yuklash → o'chirish ──
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'u1', fullName: 'Sinov Admin' });
  const svc = new XaridService(db.client, new AuditService(db.client));
  const file = { buffer: Buffer.from(await wb.xlsx.writeBuffer()), originalname: 'xarid.xlsx' };
  const an = await svc.analyze(file);
  assert.strictEqual(T.setting.length, 0, 'tahlil hech narsa saqlamaydi');
  const kinds = Object.fromEntries(an.rows.map((r) => [r.name, r.kind]));
  assert.deepStrictEqual(kinds, {
    Кондиционер: 'ASSET',
    'Стул ҳодимлар учун': 'LOW_VALUE',
    Ручка: 'SUPPLY',
    'Боди камера': 'ASSET',
    ТВ: 'PRINT_GIFT',
    'Принтер таъмирлаш': 'SERVICE',
    'Махсус жилет': 'SUPPLY',
    Моноблок: 'ASSET',
    Буклет: 'PRINT_GIFT',
  });
  assert.deepStrictEqual(an.rows.map((r) => r.status), ['DONE', 'DONE', 'DONE', 'DONE', 'DONE', 'DONE', 'DONE', 'REJECTED', 'PLANNED']);
  assert.strictEqual(an.summary.done, 7);
  assert.strictEqual(an.summary.doneTotalTiyin, String((12e6 + 5e6 + 2e5 + 40e6 + 9e6 + 8e5 + 5e6) * 100), "jami — shartnoma summalari; «Жами» qatori qo'shilmaydi");
  const asset = an.summary.byKind.find((x) => x.key === 'ASSET');
  assert.deepStrictEqual([asset.count, asset.totalTiyin, asset.all], [2, String(52e6 * 100), 3], 'rad etilgan — bajarilganlar jamisiga kirmaydi');
  assert.ok(an.rows.find((r) => r.name === 'Ручка').warnings.some((w) => w.includes('schyot-faktura')));
  assert.ok(an.rows.find((r) => r.name === 'Ручка').warnings.some((w) => w.includes('sana emas')), '«режада» — sana emas');
  // Jami — faqat «Шартнома / жами сумма»: shartnomasiz (rad etilgan, rejada) qatorlar summasi yo'q — hamma qatorlar jamisi ham AB yig'indisi
  assert.strictEqual(an.rows.filter((r) => r.totalTiyin !== null).reduce((s, r) => s + BigInt(r.totalTiyin), 0n).toString(), an.summary.doneTotalTiyin);
  assert.ok(an.rows.filter((r) => r.status !== 'DONE').every((r) => r.totalTiyin === null));
  assert.deepStrictEqual(an.summary.byUnit.map((x) => x.key).sort(), ['CENTER', 'FERMER', 'MARKSHEYDER', 'TAX_FREE']);
  assert.ok(!JSON.stringify(an).includes('Т.Синов'), "mas'ul xodim ismi natijada yo'q");

  await svc.commit(file, 'u1');
  let v = await svc.view();
  assert.strictEqual(v.loaded, true);
  assert.strictEqual(v.rows.length, ROWS.length);
  assert.strictEqual(v.savedBy, 'Sinov Admin');
  assert.ok(!JSON.stringify(T.setting).includes('Т.Синов'), "mas'ul xodim ismi saqlanmaydi");

  // Chegara 1 mln → stul (500 ming) hali ham kam baholi, chegara 400 ming → asosiy vosita
  await svc.setRule({ assetMinSom: '400 000' }, 'u1');
  v = await svc.view();
  assert.strictEqual(v.rows.find((r) => r.name === 'Стул ҳодимлар учун').kind, 'ASSET');
  assert.strictEqual(v.rule.assetMinTiyin, String(400000 * 100));
  await assert.rejects(() => svc.setRule({ assetMinSom: '-5' }, 'u1'), /Chegara/);
  await svc.setRule({ assetMinSom: 5000000 }, 'u1');

  // Qo'lda tur: ruchka → kam baholi; qayta yuklashda saqlanadi; null — filtrga qaytadi
  const pen = v.rows.find((r) => r.name === 'Ручка');
  await svc.setOverride({ key: pen.key, kind: 'LOW_VALUE' }, 'u1');
  await svc.commit(file, 'u1');
  v = await svc.view();
  const pen2 = v.rows.find((r) => r.name === 'Ручка');
  assert.deepStrictEqual([pen2.kind, pen2.autoKind, pen2.overridden], ['LOW_VALUE', 'SUPPLY', true]);
  await assert.rejects(() => svc.setOverride({ key: pen.key, kind: 'XYZ' }, 'u1'), /Noma'lum tur/);
  await assert.rejects(() => svc.setOverride({ key: 'yoq', kind: 'ASSET' }, 'u1'), /topilmadi/);
  await svc.setOverride({ key: pen.key, kind: null }, 'u1');
  assert.strictEqual((await svc.view()).rows.find((r) => r.name === 'Ручка').kind, 'SUPPLY');

  // Hech bir raqamga ta'sir yo'q: faqat settings (asset.xarid, asset.xarid.rule) yoziladi
  assert.deepStrictEqual(T.setting.map((s) => s.key).sort(), ['asset.xarid', 'asset.xarid.rule']);
  assert.strictEqual(T.expense.length, 0);
  assert.strictEqual(T.fixedAsset.length, 0);

  await svc.remove('u1');
  assert.strictEqual((await svc.view()).loaded, false);
  await assert.rejects(() => svc.remove('u1'), /yuklanmagan/);
  await assert.rejects(() => svc.analyze({ buffer: Buffer.from('not xlsx'), originalname: 'x.xlsx' }), /./);

  // ── Bo'sh shablon → to'ldiriladi → qayta o'qiladi (umumiy shablon tizimi) ──
  const { buffer } = await svc.template();
  const tw = new ExcelJS.Workbook();
  await tw.xlsx.load(buffer);
  assert.ok(tw.getWorksheet("Yo'riqnoma"), "yo'riqnoma varag'i");
  const ws = tw.worksheets[0];
  const colOf = (key) => XARID_SPEC.fields.findIndex((f) => f.key === key) + 1;
  ws.getCell(5, colOf('name')).value = 'Сейф';
  ws.getCell(5, colOf('type')).value = 'товар';
  ws.getCell(5, colOf('contractQty')).value = 1;
  ws.getCell(5, colOf('contractPrice')).value = 8000000;
  ws.getCell(5, colOf('contractTotal')).value = 8000000;
  ws.getCell(5, colOf('note')).value = 'бажарилди';
  const back = await svc.analyze({ buffer: Buffer.from(await tw.xlsx.writeBuffer()), originalname: 'shablon.xlsx' });
  assert.deepStrictEqual(back.missing, [], 'shablondagi hamma ustun tanildi');
  assert.deepStrictEqual(back.rows.map((r) => [r.name, r.kind, r.status, r.totalTiyin]), [['Сейф', 'ASSET', 'DONE', String(8e6 * 100)]]);

  console.log('OK t-asset-xarid');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
