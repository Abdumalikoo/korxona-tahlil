// Bank ko'chirmasi tahlili: o'qish (chiqim + kirim), o'xshashlarni guruhlash, oyma-oy va o'sib boruvchi, hisob bo'yicha
// almashtirish, bekor qilish. Xarajat / daromad YARATILMAYDI. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { BankAnalysisService } = require('../dist/modules/bank-analysis/bank-analysis.service');
const R = require('../dist/modules/bank-analysis/bank-analysis.rules');

const so = (n) => BigInt(Math.round(n * 100));
const s = (n) => String(so(n));

async function file(rows, acct = '20208000900100012345') {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Page 1');
  ws.getCell('A3').value = `Выписка по счету ${acct}`;
  ['№\nпп', 'Дата\nдокумента', 'Дата\nобработки', '№ док', 'Наименование счёта', 'ИНН', '№ счёта', 'МФО', 'Обороты по\nдебету', 'Обороты по\nкредиту', 'Назначение платежа'].forEach((h, i) => (ws.getCell(11, i + 1).value = h));
  rows.forEach((r, i) => {
    const row = ws.getRow(12 + i);
    row.values = [String(i + 1), r.d, r.d, r.no ?? String(100 + i), r.name, r.inn, '20210000000000000001', '00014', r.out ?? 0, r.in ?? 0, r.p];
  });
  ws.getRow(12 + rows.length).values = ['', '', '', '', 'Итого', '', '', '', 0, 0, ''];
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), originalname: 'vypiska.xlsx' };
}

(async () => {
  // ── Qoidalar ──
  assert.strictEqual(R.purposeKey('Оплата за электроэнергию за январь 2026 г. по дог. №12 от 01.01.2025, НДС 12% 1200.00'), R.purposeKey('Оплата за электроэнергию за февраль 2026 г. по дог. №12 от 01.01.2025, НДС 12% 990.50'), 'oy, sana, summa — farq qilmaydi');
  assert.notStrictEqual(R.purposeKey('за услуги связи'), R.purposeKey('за электроэнергию'));
  assert.strictEqual(R.kindOf('OUT', 'Оплата за электроэнергию', 'ҲУДУДИЙ ЭЛЕКТР ТАРМОҚЛАРИ'), 'KOMMUNAL');
  assert.strictEqual(R.kindOf('OUT', 'Комиссия за обслуживание', 'Bank'), 'BANK');
  assert.strictEqual(R.kindOf('OUT', 'Ижтимоий солиқ тўлови', 'ГНИ'), 'SOLIQ');
  assert.strictEqual(R.kindOf('OUT', 'Иш ҳақи', 'X'), 'ISH_HAQI');
  assert.strictEqual(R.kindOf('IN', 'Оплата за услуги', 'MCHJ'), 'TUSHUM');
  assert.strictEqual(R.counterpartyKey('12345678901234', 'Kim'), 'person');
  assert.strictEqual(R.counterpartyKey('300000001', 'ООО "Alfa"'), 'inn:300000001');
  assert.strictEqual(R.counterpartyKey('', 'ООО "Alfa"'), R.counterpartyKey('', 'Alfa МЧЖ'), 'tashkilot shakli e‘tiborsiz');
  assert.strictEqual(R.accountTail(['Выписка по счету 20208000900100012345']), '12345');

  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  const audit = new AuditService(db.client);
  const svc = new BankAnalysisService(db.client, audit);

  const rows = [
    { d: '15.01.2026', name: 'ЭЛЕКТР ТАРМОҚЛАРИ', inn: '300000001', out: 1_000_000, p: 'Оплата за электроэнергию за январь 2026 г. по дог. №12' },
    { d: '16.02.2026', name: 'ЭЛЕКТР ТАРМОҚЛАРИ', inn: '300000001', out: 1_200_000, p: 'Оплата за электроэнергию за февраль 2026 г. по дог. №12' },
    { d: '14.03.2026', name: 'ЭЛЕКТР ТАРМОҚЛАРИ', inn: '300000001', out: 1_500_000, p: 'Оплата за электроэнергию за март 2026 г. по дог. №12' },
    { d: '31.01.2026', name: 'BANK', inn: '300000002', out: 50_000, p: 'Комиссия за обслуживание счета' },
    { d: '28.02.2026', name: 'BANK', inn: '300000002', out: 50_000, p: 'Комиссия за обслуживание счета' },
    { d: '10.02.2026', name: 'Sinov Shaxs', inn: '12345678901234', out: 300_000, p: 'Моддий ёрдам' },
    { d: '11.02.2026', name: 'Boshqa Shaxs', inn: '22345678901234', out: 200_000, p: 'Моддий ёрдам' },
    { d: '05.01.2026', name: 'MIJOZ MCHJ', inn: '300000003', in: 5_000_000, p: 'Оплата за услуги по счет-фактуре №5 от 03.01.2026' },
    { d: '05.02.2026', name: 'MIJOZ MCHJ', inn: '300000003', in: 4_000_000, p: 'Оплата за услуги по счет-фактуре №9 от 02.02.2026' },
  ];
  const a = await svc.analyze(await file(rows));
  assert.strictEqual(a.rows.length, 9, 'chiqim va kirim');
  assert.deepStrictEqual(a.months.map((m) => m.period), ['2026-01', '2026-02', '2026-03']);
  assert.strictEqual(a.account.suggested, 'Hisob …12345', 'to‘liq hisob raqami ko‘rsatilmaydi');
  assert.ok(!JSON.stringify(a).includes('20208000900100012345'), 'o‘z hisob raqami qaytmaydi');
  assert.ok(!JSON.stringify(a).includes('20210000000000000001'), 'oluvchi hisob raqami olinmaydi');

  const c = await svc.commit({ fileName: a.fileName, account: a.account.suggested, months: a.months.map((m) => m.period), rows: a.rows }, 'adm');
  assert.strictEqual(c.saved, 9);
  assert.strictEqual(T.expense.length + T.income.length, 0, 'xarajat va daromad yaratilmadi');

  let v = await svc.view('2026-01', '2026-03');
  assert.strictEqual(v.totals.outTiyin, s(1_000_000 + 1_200_000 + 1_500_000 + 100_000 + 500_000));
  assert.strictEqual(v.totals.inTiyin, s(9_000_000));
  assert.deepStrictEqual(v.series.map((m) => m.outCumTiyin), [s(1_050_000), s(1_050_000 + 1_750_000), s(4_300_000)], 'o‘sib boruvchi');
  const el = v.groups.find((g) => g.kind === 'KOMMUNAL');
  assert.ok(el, 'elektr — bitta guruh');
  assert.strictEqual(el.count, 3);
  assert.deepStrictEqual(Object.values(el.byMonth), [s(1_000_000), s(1_200_000), s(1_500_000)]);
  assert.deepStrictEqual(el.cumulative, [s(1_000_000), s(2_200_000), s(3_700_000)]);
  assert.strictEqual(el.regular, true);
  assert.strictEqual(el.changePct, 25);
  const ppl = v.groups.find((g) => g.counterparty.startsWith('Jismoniy'));
  assert.strictEqual(ppl.count, 2, 'jismoniy shaxslar — bitta guruh');
  assert.strictEqual(ppl.counterparty, 'Jismoniy shaxslar (2 kishi)');
  const inc = v.groups.find((g) => g.dir === 'IN');
  assert.strictEqual(inc.count, 2, 'kirim: fakturalar bitta guruh');
  assert.strictEqual(inc.kind, 'TUSHUM');
  assert.ok(v.kinds.some((k) => k.kind === 'BANK' && k.totalTiyin === s(100_000)));

  const gd = await svc.group(el.key, '2026-01', '2026-03');
  assert.strictEqual(gd.rows.length, 3);
  assert.ok(gd.rows[0].purpose.includes('январь'), 'izoh aynan o‘zidek');

  // ── Shu hisobning fevrali qayta yuklandi — faqat fevral almashtiriladi; boshqa hisob alohida ──
  const a2 = await svc.analyze(await file([{ d: '16.02.2026', name: 'ЭЛЕКТР ТАРМОҚЛАРИ', inn: '300000001', out: 1_300_000, p: 'Оплата за электроэнергию за февраль 2026 г.' }]));
  const c2 = await svc.commit({ fileName: 'fev.xlsx', account: a2.account.suggested, months: ['2026-02'], rows: a2.rows }, 'adm');
  assert.deepStrictEqual(c2.replacedMonths, ['2026-02']);
  v = await svc.view('2026-01', '2026-03');
  assert.strictEqual(v.series[1].outTiyin, s(1_300_000));
  assert.strictEqual(v.series[0].outTiyin, s(1_050_000), 'yanvar tegilmadi');
  const a3 = await svc.analyze(await file([{ d: '20.02.2026', name: 'ALOQA', inn: '300000009', out: 70_000, p: 'За услуги связи' }], '20208000900100099999'));
  await svc.commit({ fileName: 'b.xlsx', account: a3.account.suggested, months: ['2026-02'], rows: a3.rows }, 'adm');
  v = await svc.view('2026-01', '2026-03');
  assert.strictEqual(v.accounts.length, 2);
  assert.strictEqual(v.series[1].outTiyin, s(1_370_000), 'ikki hisob qo‘shiladi');
  const only = await svc.view('2026-01', '2026-03', v.accounts.find((x) => x.label.includes('99999')).key);
  assert.strictEqual(only.totals.outTiyin, s(70_000));

  // ── Bekor qilish: birinchi yuklash — fevral keyin almashtirilgan, faqat yanvar va mart o'chadi ──
  const b = (await svc.batches()).find((x) => x.id === c.batchId);
  assert.strictEqual(b.state, 'PARTIAL');
  const x = await svc.cancel(c.batchId, 'adm');
  assert.deepStrictEqual(x.months, ['2026-01', '2026-03']);
  v = await svc.view('2026-01', '2026-03');
  assert.strictEqual(v.totals.outTiyin, s(1_370_000));
  await assert.rejects(svc.cancel(c.batchId, 'adm'), /allaqachon/);
  await assert.rejects(svc.view('2026-03', '2026-01'), /keyin/);

  console.log('t-bank-analysis: OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
