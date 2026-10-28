// Bank ko'chirmasi va schyot-faktura reyestrini o'qish: rus / o'zbek (lotin, kirill) sarlavhalar, ikki qatorli sarlavha,
// xonalarga ajratilgan summalar, «Итого» va qoldiq bilan o'z-o'zini tekshirish. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const { amountNumber, statementTiyin, somToTiyin } = require('../dist/common/money');
const { parseBankStatement } = require('../dist/modules/unit-bank/unit-bank.service');
const { parseInvoiceRows, invoiceStatus, tiyin } = require('../dist/modules/bank-analysis/invoice-analysis.parse');

const so = (n) => String(BigInt(Math.round(n * 100)));

const HEAD = {
  ru: ['№\nпп', 'Дата\nдокумента', 'Дата\nобработки', '№ док', 'Наименование счёта', 'ИНН', '№ счёта', 'МФО', 'Обороты по\nдебету', 'Обороты по\nкредиту', 'Назначение платежа'],
  uzl: ['T/r', 'Hujjat sanasi', 'Ishlov berish sanasi', 'Hujjat raqami', 'Hisob nomi', 'STIR', 'Hisob raqami', 'MFO', 'Debet aylanmasi', 'Kredit aylanmasi', "To'lov maqsadi"],
  uzc: ['Т/р', 'Ҳужжат санаси', 'Ишлов бериш санаси', 'Ҳужжат рақами', 'Ҳисоб номи', 'СТИР', 'Ҳисоб рақами', 'МФО', 'Дебет айланмаси', 'Кредит айланмаси', 'Тўлов мақсади'],
};

const ROWS = [
  { d: '05.01.2026', name: 'ALFA MCHJ', inn: '300000001', out: 1_234_567.89, p: 'Оплата за услуги связи' },
  { d: '06.01.2026', name: 'BETA AJ', inn: '300000002', out: 250_000, p: 'Перечисление остатка на конец месяца по договору №5' },
  { d: '07.01.2026', name: 'MIJOZ MCHJ', inn: '300000003', in: 5_000_000, p: 'Оплата за услуги' },
];

/**
 * Sun'iy ko'chirma. o: { head, two (ikki qatorli), amount (summa → katak), total (Итого debet), totalCol, top, bottom }
 */
function sheet(o = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Page 1');
  ws.getCell('A2').value = 'Выписка по счету 20208000900100012345';
  for (const [r, v] of o.top ?? []) ws.getCell(r, 1).value = v;
  const head = o.head ?? HEAD.ru;
  const hr = 6;
  head.forEach((h, i) => {
    if (o.two && (i === 8 || i === 9)) {
      ws.getCell(hr, i + 1).value = 'Обороты';
      ws.getCell(hr + 1, i + 1).value = i === 8 ? 'по дебету' : 'по кредиту';
    } else ws.getCell(hr, i + 1).value = h;
  });
  const amount = o.amount ?? ((n) => n);
  let r = hr + (o.two ? 2 : 1);
  const rows = o.rows ?? ROWS;
  for (const x of rows) ws.getRow(r++).values = ['1', x.d, x.d, '10', x.name, x.inn, '20208000000000000001', '00014', amount(x.out ?? 0), amount(x.in ?? 0), x.p];
  const out = rows.reduce((s, x) => s + (x.out ?? 0), 0);
  const inn = rows.reduce((s, x) => s + (x.in ?? 0), 0);
  if (o.total !== null) {
    const t = ws.getRow(r++);
    t.getCell(o.totalCol ?? 5).value = 'Итого';
    t.getCell(9).value = amount(o.total ?? out);
    t.getCell(10).value = amount(inn);
  }
  for (const [col, v] of o.bottom ?? []) ws.getCell(r + 1, col).value = v;
  return wb;
}

const check = (p, code) => p.checks.items.find((i) => i.code === code);

(async () => {
  // ── Summa matni ──
  assert.strictEqual(amountNumber('1,234,567.89'), 1234567.89);
  assert.strictEqual(amountNumber('1.234.567,89'), 1234567.89);
  assert.strictEqual(amountNumber("1'234,56"), 1234.56);
  assert.strictEqual(amountNumber('1 234 567,89'), 1234567.89);
  assert.strictEqual(amountNumber('1,234'), 1.234, 'noaniq — kasr (oddiy usul)');
  assert.strictEqual(amountNumber('1.234,567.89'), null, 'aralash xona belgilari');
  assert.strictEqual(amountNumber('1,234,56'), null, 'xona va kasr belgisi bir xil');
  assert.strictEqual(amountNumber('12,34,567'), null);
  assert.strictEqual(amountNumber('abc'), null);
  assert.strictEqual(statementTiyin('1,234,567.89'), 123456789n);
  assert.strictEqual(statementTiyin('-5'), null, 'manfiy — rad');
  assert.strictEqual(somToTiyin('1,234,567.89'), null, 'somToTiyin o‘zgarmagan');
  assert.strictEqual(tiyin('1,234.50'), '123450');
  assert.strictEqual(tiyin('abc'), '0');
  console.log('  ✓ summa matni');

  // ── Bank: rus, o'zbek lotin, o'zbek kirill, ikki qatorli sarlavha — natija bir xil ──
  const base = parseBankStatement(sheet(), { credits: true });
  assert.strictEqual(base.rows.length, 3);
  assert.deepStrictEqual(base.rows.map((r) => r.debitTiyin), [so(1_234_567.89), so(250_000), '0']);
  assert.strictEqual(base.rows[1].purpose, ROWS[1].p, 'sanali to‘lov izohidagi «остатка на конец» — qoldiq emas');
  assert.strictEqual(base.checks.ok, true);
  assert.strictEqual(check(base, 'TOTAL_DEBIT').status, 'OK');
  assert.strictEqual(check(base, 'TOTAL_CREDIT').status, 'OK');
  assert.strictEqual(check(base, 'BALANCE').status, 'ABSENT');
  assert.deepStrictEqual(base.checks.headerRows, [6]);
  const sig = (p) => JSON.stringify(p.rows.map((r) => [r.docDate, r.docNo, r.accountName, r.inn, r.debitTiyin, r.creditTiyin, r.purpose]));
  for (const [what, wb] of [
    ['o‘zbek lotin', sheet({ head: HEAD.uzl })],
    ['o‘zbek kirill', sheet({ head: HEAD.uzc })],
    ['ikki qatorli', sheet({ two: true })],
    ['1,234,567.89', sheet({ amount: (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2 }) })],
    ['1.234.567,89', sheet({ amount: (n) => n.toLocaleString('de-DE', { minimumFractionDigits: 2 }) })],
    ['Итого izoh ustunida', sheet({ totalCol: 11 })],
  ]) {
    const p = parseBankStatement(wb, { credits: true });
    assert.strictEqual(sig(p), sig(base), what);
    assert.strictEqual(p.invalid.length, 0, what);
    assert.strictEqual(p.checks.ok, true, what);
  }
  assert.deepStrictEqual(parseBankStatement(sheet({ two: true })).checks.headerRows, [6, 7]);
  // Kirim qatorlari faqat tahlil uchun olinadi, lekin jami ular bilan tekshiriladi
  const debitOnly = parseBankStatement(sheet());
  assert.strictEqual(debitOnly.rows.length, 2);
  assert.strictEqual(check(debitOnly, 'TOTAL_CREDIT').status, 'OK');
  console.log('  ✓ bank: sarlavha va summa shakllari');

  // ── Bank: «Итого» mos emas ──
  const bad = parseBankStatement(sheet({ total: 9_999_999 }));
  assert.strictEqual(check(bad, 'TOTAL_DEBIT').status, 'MISMATCH');
  assert.strictEqual(check(bad, 'TOTAL_DEBIT').fileTiyin, so(9_999_999));
  assert.strictEqual(check(bad, 'TOTAL_DEBIT').readTiyin, so(1_484_567.89));
  assert.strictEqual(bad.checks.ok, false);
  // Jami yo'q
  assert.strictEqual(check(parseBankStatement(sheet({ total: null })), 'TOTAL_DEBIT').status, 'ABSENT');
  // Kunlik oraliq jamilar (umumiy jamisiz) — yig'indisi
  {
    const wb = sheet({ total: null });
    const ws = wb.getWorksheet('Page 1');
    const t1 = ws.getRow(20);
    t1.getCell(5).value = 'Итого за день';
    t1.getCell(9).value = 1_000_000;
    const t2 = ws.getRow(21);
    t2.getCell(5).value = 'Итого за день';
    t2.getCell(9).value = 484_567.89;
    assert.strictEqual(check(parseBankStatement(wb), 'TOTAL_DEBIT').status, 'OK');
  }
  console.log('  ✓ bank: «Итого» tekshiruvi');

  // ── Bank: qoldiq (kirish + kirim − chiqim = chiqish) ──
  const opening = 10_000_000;
  const closing = opening + 5_000_000 - 1_484_567.89;
  const bal = parseBankStatement(sheet({ top: [[3, 'Входящий остаток: 10 000 000,00']], bottom: [[5, 'Исходящий остаток'], [9, closing]] }));
  assert.strictEqual(check(bal, 'BALANCE').status, 'OK');
  assert.strictEqual(check(bal, 'BALANCE').fileTiyin, so(closing));
  const balBad = parseBankStatement(sheet({ top: [[3, 'Kiruvchi qoldiq: 10 000 000,00']], bottom: [[5, 'Chiquvchi qoldiq'], [9, closing + 1]] }));
  assert.strictEqual(check(balBad, 'BALANCE').status, 'MISMATCH');
  assert.strictEqual(balBad.checks.ok, false);
  assert.strictEqual(balBad.rows.length, 2, 'qoldiq qatorlari — to‘lov emas');
  console.log('  ✓ bank: qoldiq tekshiruvi');

  // ── Bank: «Kontragent STIR» — INN, nom emas; bank bo'lmagan varaq — rad ──
  {
    const head = [...HEAD.uzl];
    head[4] = 'Kontragent nomi';
    head[5] = 'Kontragent STIR';
    const p = parseBankStatement(sheet({ head }));
    assert.strictEqual(p.rows[0].inn, '300000001');
    assert.strictEqual(p.rows[0].accountName, 'ALFA MCHJ');
  }
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("To'lovlar");
    ws.getRow(1).values = ['Yanvar summa', 'Yanvar shartnoma', 'Fevral summa'];
    ws.getRow(2).values = [100000, 'A-1', 200000];
    assert.throws(() => parseBankStatement(wb), /Bank ko'chirmasi topilmadi/);
  }
  console.log('  ✓ bank: ustun nomlari va boshqa varaqlar');

  // ── Schyot-faktura ──
  const row = (n, arr) => ({ row: n, cells: new Map(arr.map((v, i) => [i + 1, v]).filter(([, v]) => v !== null && v !== '')) });
  const RU = ['№', 'ID', 'СТАТУС', 'Номер документ', 'Дата документ', 'Продавец (ИНН или ПИНФЛ)', 'Продавец (наименование)', 'Покупатель (ИНН или ПИНФЛ)', 'Покупатель (наименование)', 'ПРИМЕЧАНИЕ', '№', 'Примечание к товару (работе, услуге)', 'Идентификационный код и название по Единому электронному национальному каталогу товаров (услуг)', 'Количество', 'Цена', 'Стоимость поставки', 'НДС ставка', 'НДС сумма', 'Стоимость поставки с учётом НДС'];
  const UZ = ['№', 'ID', 'Holati', 'Hujjat raqami', 'Hujjat sanasi', 'Sotuvchi STIR', 'Sotuvchi nomi', 'Xaridor STIR', 'Xaridor nomi', 'Izoh', '№', 'Tovar (xizmat) nomi', 'MXIK kodi', 'Miqdori', 'Narxi', 'Yetkazib berish qiymati', 'QQS stavkasi', 'QQS summasi', "QQS bilan yetkazib berish qiymati"];
  const inv = (H, status, o = {}) => {
    const head = ['1', 'inv-1', status, 'F-1', '30.06.2026', '300000001', 'ALFA MCHJ', '300000100', 'BIZ AJ', ''];
    const items = o.items ?? [
      ['Xizmat A', '10602001001000000 - Xizmat', 1, 100_000, 100_000, 12, 12_000, 112_000],
      ['Xizmat B', '10602001001000000 - Xizmat', 1, 200_000, 200_000, 12, 24_000, 224_000],
    ];
    const tot = o.total ?? items.reduce((s, x) => s + x[7], 0);
    const amt = o.amount ?? ((n) => n);
    return [
      row(1, H),
      row(2, [...head, o.totalLabel ?? 'Общ.', '', '', '', '', '', '', '', amt(tot)]),
      ...items.map((x, i) => row(3 + i, [...Array(10).fill(null), String(i + 1), x[0], x[1], x[2], amt(x[3]), amt(x[4]), x[5], amt(x[6]), amt(x[7])])),
    ];
  };
  const ok = parseInvoiceRows(inv(RU, 'Подписан'));
  assert.strictEqual(ok.invoices.length, 1);
  assert.strictEqual(ok.invoices[0].items.length, 2);
  assert.deepStrictEqual([ok.checks.ok, ok.checks.totalsChecked, ok.checks.totalMismatchCount, ok.checks.itemMismatchCount], [true, 1, 0, 0]);
  // O'zbekcha sarlavha va holat — natija bir xil (holat ruscha nomga keltiriladi)
  const uz = parseInvoiceRows(inv(UZ, 'Imzolangan', { totalLabel: 'Jami' }));
  assert.deepStrictEqual(uz.invoices, ok.invoices);
  assert.strictEqual(uz.checks.ok, true);
  assert.strictEqual(invoiceStatus('Kutilmoqda'), 'Ожидает');
  assert.strictEqual(invoiceStatus('Rad etilgan'), 'Отказ');
  assert.strictEqual(invoiceStatus('Подписан'), 'Подписан');
  // Kirill: «Ҳолати» (avval ҳ/қ harflari bo'shliqqa aylanib, sarlavha tanilmasdi)
  const cyr = parseInvoiceRows(inv(['№', 'ID', 'Ҳолати', 'Ҳужжат рақами', 'Ҳужжат санаси', 'Сотувчи СТИР', 'Сотувчи номи', 'Харидор СТИР', 'Харидор номи', 'Изоҳ', '№', 'Товар номи', 'МХИК', 'Миқдори', 'Нархи', 'Етказиб бериш қиймати', 'ҚҚС ставкаси', 'ҚҚС суммаси', 'ҚҚС билан етказиб бериш қиймати'], 'Имзоланган'));
  assert.deepStrictEqual(cyr.invoices, ok.invoices);
  // Matndagi xonalarga ajratilgan summa
  const txt = parseInvoiceRows(inv(RU, 'Подписан', { amount: (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2 }) }));
  assert.deepStrictEqual(txt.invoices, ok.invoices);
  console.log('  ✓ faktura: sarlavha, holat va summa shakllari');

  // Jami mos emas; qator: qiymat + QQS ≠ jami; summa noto'g'ri
  const badTot = parseInvoiceRows(inv(RU, 'Подписан', { total: 999_000 }));
  assert.deepStrictEqual([badTot.checks.ok, badTot.checks.totalMismatchCount], [false, 1]);
  assert.deepStrictEqual(badTot.checks.totalMismatch[0], { number: 'F-1', date: '2026-06-30', row: 2, fileTiyin: so(999_000), readTiyin: so(336_000) });
  const badItem = parseInvoiceRows(inv(RU, 'Подписан', { items: [['Xizmat A', '1 - X', 1, 100_000, 100_000, 12, 12_000, 113_000]] }));
  assert.deepStrictEqual([badItem.checks.itemMismatchCount, badItem.checks.itemMismatch[0].row], [1, 3]);
  const badAmt = parseInvoiceRows(inv(RU, 'Подписан', { items: [['Xizmat A', '1 - X', 1, 100_000, 100_000, 12, 12_000, 'abc']], total: 0 }));
  assert.strictEqual(badAmt.invalid.length, 1);
  assert.match(badAmt.invalid[0].reason, /Summa noto'g'ri/);
  assert.strictEqual(badAmt.checks.ok, false);
  console.log('  ✓ faktura: o‘z-o‘zini tekshirish');

  console.log('t-statement-parse: OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
