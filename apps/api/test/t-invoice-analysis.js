// Schyot-faktura tahlili (nazorat): oqim o'quvchi (bo'sh formatlangan qatorlar), holat filtri (Подписан / Ожидает),
// QQS bilan summa, bizning INN, xizmat oyi, IKPU bo'yicha guruh va tur, qayta yuklash (ID bo'yicha), kontragent
// kartasi (faktura ↔ bank), chat. Xarajat / daromad o'zi yaratilmaydi. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { InvoiceAnalysisService, invoiceKind } = require('../dist/modules/bank-analysis/invoice-analysis.service');
const { BankAnalysisService } = require('../dist/modules/bank-analysis/bank-analysis.service');
const { CounterpartyService } = require('../dist/modules/bank-analysis/counterparty.service');
const { serviceMonth, parseInvoiceRows } = require('../dist/modules/bank-analysis/invoice-analysis.parse');
const { readSheetRows } = require('../dist/common/files/xlsx-stream');
const { cleanService } = require('../dist/modules/bank-analysis/bank-analysis.pivot');

const OUR = '300000100';
const HEAD = ['№', 'ID', 'Вид документ', 'ТИП документ', 'СТАТУС', 'Номер документ', 'Дата документ', 'Договор номер', 'Договор дата', 'Дата отправки', 'Продавец (ИНН или ПИНФЛ)', 'Продавец (наименование)', 'Продавец (расчётный счёт)', 'Продавец (МФО банка)', 'Продавец (код филиала)', 'Продавец (название филиала)', 'Покупатель (ИНН или ПИНФЛ)', 'Покупатель (наименование)', 'Покупатель (расчётный счёт)', 'Покупатель (МФО банка)', 'Покупатель (код филиала)', 'Покупатель (название филиала)', 'ПРИМЕЧАНИЕ', '№', 'Примечание к товару (работе, услуге)', 'Идентификационный код и название по Единому электронному национальному каталогу товаров (услуг)', 'Единица измерения', 'Маркировка', 'Количество', 'Цена', 'Ставка акциз', 'Сумма акциз', 'Стоимость поставки', 'НДС ставка', 'НДС сумма', 'Стоимость поставки с учётом НДС', 'Происхождение товара', 'Покупатель (подписант)', 'Покупатель (время подписи)', 'Покупатель (хост)', 'Покупатель (IP)'];

async function reg(invoices, emptyTail = 0) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  HEAD.forEach((h, i) => (ws.getCell(2, i + 2).value = h));
  let r = 3;
  let n = 1;
  for (const inv of invoices) {
    const head = [n++, inv.id, 'Счет-фактура', inv.type ?? 'Стандартный', inv.status, inv.no, inv.date, inv.contract ?? 'D-1', '01-01-2026', '', inv.seller[0], inv.seller[1], '20208000000000000001', '00014', '', '', inv.buyer[0], inv.buyer[1], '20208000000000000002', '00014', '', inv.branch ?? '', inv.note ?? ''];
    const items = inv.items;
    const multi = items.length > 1;
    if (multi) {
      const tot = items.reduce((s, x) => s + x[2], 0);
      ws.getRow(r++).values = [null, ...head, 'Общ.', '', '', '', '', items.length, '', 0, 0, tot / 1.12, '12', tot - tot / 1.12, tot];
      for (const it of items) ws.getRow(r++).values = [null, ...Array(23).fill(null), 1, it[0], it[1], 'услуга', '', 1, it[2] / 1.12, 0, 0, it[2] / 1.12, 12, it[2] - it[2] / 1.12, it[2]];
    } else {
      const it = items[0];
      ws.getRow(r++).values = [null, ...head, 1, it[0], it[1], 'услуга', '', 1, it[2] / 1.12, 0, 0, it[2] / 1.12, 12, it[2] - it[2] / 1.12, it[2]];
    }
  }
  // Bo'sh, lekin formatlangan qatorlar (Didox eksportidagidek)
  for (let i = 0; i < emptyTail; i++) for (let c = 1; c <= 44; c++) ws.getCell(r + i, c).style = { font: { name: 'Arial' } };
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), originalname: 'reyestr.xlsx' };
}

const E = ['300000001', 'ELEKTR AJ'];
const A = ['300000002', 'AEROPORT MCHJ'];
const M = ['300000003', 'MEBEL MCHJ'];
const C = ['300000009', 'MIJOZ MCHJ'];
const US = [OUR, 'BIZNING AJ'];
const so = (n) => BigInt(Math.round(n * 100));
const s = (n) => String(so(n));

(async () => {
  assert.strictEqual(serviceMonth('Аренда помещения за август 2026', '2026-09-30'), '2026-08');
  assert.strictEqual(serviceMonth('ЭКСПЛУАТАЦИОННЫЕ РАСХОДЫ за Декабрь 2025', '2026-01-01'), '2025-12');
  assert.strictEqual(serviceMonth('Аренда с 01.06.2026 до 30.06.2026', '2026-07-31'), '2026-06');
  assert.strictEqual(serviceMonth('Ofis mebeli', '2026-07-15'), '2026-07');
  assert.strictEqual(serviceMonth('Смарт-карталар ўқиш қурилмаси', '2026-06-10'), '2026-06', '«смарт» ichidagi «март» — oy emas');
  assert.strictEqual(serviceMonth('Майонез', '2026-06-10'), '2026-06');
  assert.strictEqual(cleanService('ПРОПУСК ПО НОВОЙ СИСТЕМЕ за сентябрь 2026 г.'), 'ПРОПУСК ПО НОВОЙ СИСТЕМЕ');
  assert.strictEqual(cleanService('Аренда помещения с 01.06.2026г до 30.06.2026г'), 'Аренда помещения');
  assert.strictEqual(cleanService('сентабр ойи учун ижара тўлови ҳисобланди'), 'ижара тўлови ҳисобланди');
  assert.strictEqual(cleanService('Оплата за услуги по счет-фактуре №5 от 03.01.2026'), 'Оплата за услуги по счет-фактуре №5');
  assert.strictEqual(cleanService('Смарт-карталар ўқиш қурилмаси'), 'Смарт-карталар ўқиш қурилмаси');
  assert.strictEqual(invoiceKind('OUT', { ikpu: '10713007006000000 - Возмещение затрат (расходов) за услуги электроэнергии', purpose: 'электроэнергия за май' }, 'X'), 'KOMMUNAL');
  assert.strictEqual(invoiceKind('OUT', { ikpu: '10701001001000000 - Услуги по аренде зданий и сооружений', purpose: 'Аренда помещения' }, 'X'), 'IJARA');
  assert.strictEqual(invoiceKind('OUT', { ikpu: '09401001030000000 - Стулья (всех видов)', purpose: 'Stul' }, 'X'), 'XARID');
  assert.strictEqual(invoiceKind('OUT', { ikpu: '10318001001000000 - Услуги компьютерной инженерии', purpose: 'IT-услуги 11,20 USD с НДС' }, 'X'), 'XIZMAT', 'QQS so‘zi soliq emas');
  assert.strictEqual(invoiceKind('OUT', { ikpu: '06109001001000000 - Футболки мужские', purpose: 'Трикотаж футболка' }, 'X'), 'XARID');
  assert.strictEqual(invoiceKind('OUT', { ikpu: '09904002001000000 - Услуги по вывозу твёрдых бытовых отходов (ТБО)', purpose: 'ВЫВОЗ МУСОРА' }, 'X'), 'KOMMUNAL');

  const list = [
    { id: 'inv-001', status: 'Подписан', no: '11', date: '30-06-2026', seller: E, buyer: US, branch: 'Farg‘ona filiali', items: [['Электроэнергия за июнь', '10713007006000000 - Возмещение затрат (расходов) за услуги электроэнергии', 1_120_000]] },
    { id: 'inv-002', status: 'Подписан', no: '12', date: '31-07-2026', seller: E, buyer: US, items: [['Электроэнергия за июль', '10713007006000000 - Возмещение затрат (расходов) за услуги электроэнергии', 1_232_000]] },
    { id: 'inv-003', status: 'Ожидает', no: '13', date: '31-08-2026', seller: E, buyer: US, items: [['Электроэнергия за август', '10713007006000000 - Возмещение затрат (расходов) за услуги электроэнергии', 1_344_000]] },
    { id: 'inv-004', status: 'Подписан', no: 'K1', date: '30-09-2026', seller: A, buyer: US, contract: '353', items: [['ВЫВОЗ МУСОРА за август', '09904002001000000 - Услуги по вывозу твёрдых бытовых отходов (ТБО)', 44_800], ['УБОРКА ТЕРРИТОРИИ за август', '10704004001000000 - Услуги по уборке зданий', 336_000], ['Аренда помещения за август', '10701001001000000 - Услуги по аренде зданий и сооружений', 2_240_000]] },
    { id: 'inv-005', status: 'Отказ', no: '99', date: '30-09-2026', seller: A, buyer: US, items: [['Аренда', '10701001001000000 - Услуги по аренде зданий и сооружений', 5_000_000]] },
    { id: 'inv-006', status: 'Отменен', no: '98', date: '30-09-2026', seller: M, buyer: US, items: [['Stul', '09401001030000000 - Стулья (всех видов)', 900_000]] },
    { id: 'inv-007', status: 'Подписан', no: '77', date: '15-07-2026', seller: M, buyer: US, items: [['Ofis stuli', '09401001030000000 - Стулья (всех видов)', 2_800_000]] },
    { id: 'inv-008', status: 'Подписан', no: 'S1', date: '31-07-2026', seller: US, buyer: C, items: [['Xizmat ko‘rsatildi', '10602001001000000 - Soliq bo’yicha maslahat xizmatlari', 11_200_000]] },
  ];
  const file = await reg(list, 20000);
  const sheet = await readSheetRows(file.buffer, { stopAfterEmpty: 3000 });
  assert.ok(sheet.rows.length <= 20, 'bo‘sh qatorlar o‘qilmadi');

  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  const audit = new AuditService(db.client);
  const inv = new InvoiceAnalysisService(db.client, audit);
  const bank = new BankAnalysisService(db.client, audit);
  const cps = new CounterpartyService(db.client);

  const a = await inv.analyze(file);
  assert.deepStrictEqual([a.org.inn, a.org.source], [OUR, 'DETECTED']);
  assert.deepStrictEqual(a.invoices, { total: 8, included: 6, other: 0, update: 0 });
  assert.ok(a.statuses.find((x) => x.status === 'Отказ' && !x.included));
  assert.strictEqual(a.rows.length, 8, '3 qatorli faktura — 3 qator, «Общ.» qo‘shilmaydi');
  const out = a.rows.filter((r) => r.dir === 'OUT').reduce((t, r) => t + BigInt(r.amountTiyin), 0n);
  assert.strictEqual(out, so(1_120_000 + 1_232_000 + 1_344_000 + 44_800 + 336_000 + 2_240_000 + 2_800_000), 'faqat QQS bilan, Отказ / Отменен yo‘q');
  assert.ok(a.rows.some((r) => r.dir === 'IN' && r.inn === C[0]), 'biz sotuvchi — kirim');
  const aug = a.rows.filter((r) => r.invoiceId === 'inv-004');
  assert.ok(aug.every((r) => r.period === '2026-08'), 'xizmat oyi — avgust (faktura sentabrda)');
  assert.deepStrictEqual(aug.map((r) => invoiceKind('OUT', r, 'X')), ['KOMMUNAL', 'KOMMUNAL', 'IJARA']);
  assert.ok(!JSON.stringify(a).includes('20208000000000000001'), 'hisob raqami olinmaydi');

  const c1 = await inv.commit({ fileName: 'r1.xlsx', rows: a.rows, allIds: a.allIds, org: a.org }, 'adm');
  assert.strictEqual(c1.saved, 8);
  assert.strictEqual(T.expense.length + T.income.length, 0, 'o‘zi xarajat / daromad yaratmaydi');
  let v = await inv.view('2026-06', '2026-08');
  const el = v.groups.find((g) => g.counterparty === E[1]);
  assert.deepStrictEqual([el.count, el.kind, el.pattern, el.byMonth['2026-08']], [3, 'KOMMUNAL', 'REGULAR', s(1_344_000)]);
  const mebel = v.groups.find((g) => g.counterparty === M[1]);
  assert.deepStrictEqual([mebel.kind, mebel.pattern], ['XARID', 'ONCE']);
  assert.ok(v.groups.filter((g) => g.counterparty === A[1]).length === 3, 'aeroport: IKPU bo‘yicha 3 guruh');

  // Bank ko'chirmasi: elektrga to'lovlar (iyun, iyul) — kontragent kartasida faktura ↔ bank
  T.setting.push({ key: 'bank.analysis.store', value: { accounts: { h: { key: 'h', label: 'Hisob', months: { '2026-07': { batchId: 'b', fileName: 'f', savedAt: '', uploadedBy: '', rows: [
    { id: 'b1', docDate: '2026-07-05', procDate: null, docNo: '1', accountName: 'ELEKTR AJ', inn: E[0], mfo: '', dir: 'OUT', amountTiyin: s(1_120_000), purpose: 'Оплата за электроэнергию за июнь' },
    { id: 'b2', docDate: '2026-07-06', procDate: null, docNo: '2', accountName: 'MIJOZ MCHJ', inn: C[0], mfo: '', dir: 'IN', amountTiyin: s(5_000_000), purpose: 'Оплата за услуги' },
  ] } } } }, batches: [], notes: {}, posts: [], groups: {} } });
  const L = await cps.list({ from: '2026-06', to: '2026-09' });
  const e = L.rows.find((r) => r.inn === E[0]);
  assert.deepStrictEqual([e.invoicedOutTiyin, e.paidOutTiyin, e.balanceOutTiyin, e.roles], [s(3_696_000), s(1_120_000), s(2_576_000), ['SUPPLIER']]);
  assert.ok(e.services[0].label.includes('электроэнергии'));
  const cl = L.rows.find((r) => r.inn === C[0]);
  assert.deepStrictEqual([cl.roles, cl.invoicedInTiyin, cl.receivedInTiyin, cl.balanceInTiyin], [['CLIENT'], s(11_200_000), s(5_000_000), s(6_200_000)]);
  const unpaid = await cps.list({ from: '2026-06', to: '2026-09', issue: 'UNPAID' });
  assert.ok(unpaid.rows.some((r) => r.inn === E[0]));
  const card = await cps.card(A[0], '2026-06', '2026-09');
  assert.deepStrictEqual(card.contracts.map((c) => c.number), ['353']);
  assert.strictEqual(card.byMonth.find((m) => m.period === '2026-08').invoicedOutTiyin, s(2_620_800));
  const fe = await cps.card(E[0]);
  assert.deepStrictEqual(fe.branches.map((b) => b.name), ['Farg‘ona filiali']);
  // Chat
  const ch = await cps.chat(`${E[0]} kontragent`);
  assert.strictEqual(ch.inn, E[0]);
  const ch2 = await cps.chat('aeroport mchj kontragenti haqida');
  assert.strictEqual(ch2.inn, A[0]);
  assert.strictEqual(await cps.chat('Markaz xarajati otgan oy'), null, 'oddiy savolga aralashmaydi');

  // Qayta yuklash: inv-003 «Отказ»ga o'tdi, inv-002 summasi o'zgardi; faylda yo'q fakturalar tegilmaydi
  const v2list = [{ ...list[1], items: [['Электроэнергия за июль', list[1].items[0][1], 1_300_000]] }, { ...list[2], status: 'Отказ' }];
  const a2 = await inv.analyze(await reg(v2list));
  assert.strictEqual(a2.invoices.update, 1, 'inv-002 yangilanadi');
  const c2 = await inv.commit({ fileName: 'r2.xlsx', rows: a2.rows, allIds: a2.allIds, org: a2.org }, 'adm');
  assert.strictEqual(c2.updatedInvoices, 2);
  v = await inv.view('2026-06', '2026-09');
  const el2 = v.groups.find((g) => g.counterparty === E[1]);
  assert.deepStrictEqual([el2.count, el2.byMonth['2026-07'], el2.byMonth['2026-08']], [2, s(1_300_000), '0'], 'Отказ — olib tashlandi, iyul yangilandi');
  assert.ok(v.groups.some((g) => g.counterparty === A[1]), 'faylda yo‘qlar qoldi');

  // ── Hisobot (pivot): modda › kontragent › xizmat, oylar ustunlarda ──
  const air = v.groups.filter((g) => g.counterparty === A[1]);
  await inv.groupCategory({ keys: air.map((g) => g.key), category: 'Aeroport (Tax free)' }, 'adm');
  await inv.groupMeta({ key: air.find((g) => g.kind === 'IJARA').key, name: 'Aeroport ijarasi', kind: '' }, 'adm');
  assert.deepStrictEqual(await inv.categories(), ['Aeroport (Tax free)']);
  let pv = await inv.pivot('2026-06', '2026-09', null, { dir: 'OUT' });
  const top = pv.rows.find((r) => r.label === 'Aeroport (Tax free)');
  assert.ok(top, 'o‘z moddasi bo‘yicha');
  assert.strictEqual(top.children.length, 1, 'bir INN — bitta kontragent qatori');
  assert.deepStrictEqual([top.children[0].inn, top.children[0].children.length], [A[0], 3]);
  assert.ok(top.children[0].children.some((x) => x.label === 'Aeroport ijarasi' && x.groupKey), 'xizmat — siz bergan nom, ochish kaliti bilan');
  assert.strictEqual(top.byMonth['2026-08'], s(2_620_800));
  assert.strictEqual(pv.total.totalTiyin, pv.rows.reduce((t, r) => t + BigInt(r.totalTiyin), 0n).toString(), 'jami = qatorlar');
  const kom = pv.rows.find((r) => r.label === 'Kommunal');
  assert.ok(kom && kom.children[0].inn === E[0], 'moddasi yo‘q — tur bo‘yicha');
  // Filtrlar: INN qidiruv, eng kam summa, darajalar tartibi
  pv = await inv.pivot('2026-06', '2026-09', null, { dir: 'OUT', q: E[0] });
  assert.deepStrictEqual(pv.rows.map((r) => r.label), ['Kommunal']);
  pv = await inv.pivot('2026-06', '2026-09', null, { dir: 'OUT', min: '2000000' });
  assert.ok(pv.rows.flatMap((r) => r.children).every((c) => BigInt(c.totalTiyin) >= so(2_000_000)));
  pv = await inv.pivot('2026-06', '2026-09', null, { dir: 'OUT', levels: 'counterparty,service', patterns: 'ONCE' });
  assert.deepStrictEqual([pv.levels, pv.rows.map((r) => r.label).sort()], [['counterparty', 'service'], [A[1], M[1]].sort()], 'faqat bir martaliklar (davrda bitta oyda)');
  pv = await inv.pivot('2026-06', '2026-09', null, { dir: 'IN' });
  assert.strictEqual(pv.total.totalTiyin, s(11_200_000));
  // Excel
  const xl = await inv.pivotExcel('2026-06', '2026-09', null, { dir: 'OUT' });
  const wbx = new ExcelJS.Workbook();
  await wbx.xlsx.load(xl.buffer);
  const sh = wbx.worksheets[0];
  assert.deepStrictEqual([sh.getCell(3, 1).value, sh.getCell(3, 2).value, sh.getCell(3, 3).value], ['T/p', 'Xarajatlar izohi', 'Umumiy']);
  const labels = [];
  sh.eachRow((r, i) => i > 3 && labels.push(String(r.getCell(2).value).trim()));
  assert.ok(labels.includes('Aeroport (Tax free)') && labels.includes('Aeroport ijarasi') && labels[labels.length - 1] === 'JAMI');
  assert.ok(xl.filename.startsWith('faktura-hisobot-chiqim'));

  // Tanlab yo'naltirish — faqat foydalanuvchi xohlasa
  T.department.push({ id: 'dA', name: 'AUP', isActive: true });
  T.region.push({ code: 0, name: 'Markaz', isActive: true });
  T.category.push({ code: 'KOMM', label: 'Kommunal', parentCode: null, isLeaf: true, isActive: true, order: 1 });
  const g = await inv.group(el2.key, '2026-06', '2026-09');
  assert.ok(g.rows.every((r) => r.period));
  const rt = await inv.route({ items: [{ account: 'faktura', rowId: g.rows[0].id }], place: { unit: 'CENTER', departmentId: 'dA' }, categoryCode: 'KOMM' }, 'adm');
  assert.strictEqual(rt.count, 1);
  const ex = T.expense.find((x) => !x.deletedAt);
  assert.deepStrictEqual([ex.period, String(ex.amountTiyin), ex.documentNo], ['2026-06', s(1_120_000), '11']);
  // Yuklash bekor — o'sha yuklash qatorlari va yo'naltirishi
  const cc = await inv.cancel(c1.batchId, 'adm');
  assert.ok(cc.removedRows >= 1 && cc.droppedPosts === 1);
  assert.ok(ex.deletedAt);

  console.log('t-invoice-analysis: OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
