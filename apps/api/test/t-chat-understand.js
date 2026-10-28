// Chat › Manba chati: savolni tushunish — «oltin to'plam» (xato yozuv, kirill, buyruqlar, nechta qator, solishtirish).
// Har ibora: kutilgan niyat va maydonlar. Yangi ibora qo'shilsa — shu ro'yxatga.
// TEST MA'LUMOTLARI SUN'IY (ismlar, PINFL, summalar — o'ylab topilgan).
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { SourceChatService } = require('../dist/modules/source-chat/chat.service');
const { parse } = require('../dist/modules/source-chat/chat.parse');
const { HrSheetsService } = require('../dist/modules/hr-sheets/hr-sheets.service');
const { UnitPayrollService } = require('../dist/modules/unit-payroll/unit-payroll.service');

const NOW = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 7);
const Y = Number(NOW.slice(0, 4));

const db = fakeDb();
const T = db.tables;
T.user.push({ id: 'u1', fullName: 'Admin Test' });
T.region.push({ code: 0, name: 'Markaz', isActive: true }, { code: 3, name: 'Andijon viloyati', isActive: true }, { code: 26, name: 'Toshkent shahri', isActive: true }, { code: 27, name: 'Toshkent viloyati', isActive: true });
T.department.push({ id: 'd1', name: "Axborot texnologiyalari bo'limi", code: 'IT', index: 1, isActive: true });
T.category.push(
  { code: 'LEASE', label: 'Ijara', parentCode: null, isLeaf: true, isActive: true, order: 1 },
  { code: 'INTERNET', label: 'Internet xizmatlari', parentCode: null, isLeaf: true, isActive: true, order: 2 },
  { code: 'PAYROLL_BASE', label: 'Ish haqi', parentCode: null, isLeaf: true, isActive: true, order: 3 },
  { code: 'OFIS', label: 'Ofis jihozlari', parentCode: null, isLeaf: true, isActive: true, order: 4 },
);
T.incomeCategory.push({ code: 'TFX', label: 'Tax free xizmati', order: 1 }, { code: 'BUX', label: 'Buxgalteriya xizmati', order: 2 });
T.employee.push(
  { pinfl: '30000000000001', fullName: 'ALIYEV SARDOR BAXTIYOROVICH', position: 'Bosh mutaxassis', regionCode: 0, departmentId: 'd1', isActive: true, employmentType: 'SHTAT', districtId: null, hiredAt: null, firedAt: null },
  { pinfl: '30000000000002', fullName: 'ALIYEVA MADINA RUSTAMOVNA', position: 'Buxgalter', regionCode: 3, departmentId: null, isActive: true, employmentType: 'SHTAT', districtId: null, hiredAt: null, firedAt: null },
);
const D = (p, day = 10) => new Date(`${p}-${String(day).padStart(2, '0')}T07:00:00Z`);
const ex = (p, cat, som, place, extra = {}) => T.expense.push({ id: 'e' + T.expense.length, period: p, date: D(p), amountTiyin: BigInt(som * 100), categoryCode: cat, regionCode: null, departmentId: null, segment: null, districtId: null, source: 'MANUAL', paymentStatus: 'PAID', deletedAt: null, section: 'DOIMIY', description: null, counterparty: null, ...place, ...extra });
const inc = (p, cat, som, place) => T.income.push({ id: 'i' + T.income.length, period: p, date: D(p), amountTiyin: BigInt(som * 100), paidTiyin: 0n, categoryCode: cat, regionCode: null, departmentId: null, segment: null, deletedAt: null, section: 'DOIMIY', clientName: 'Mijoz', description: null, ...place });
const p1 = `${Y}-01`;
const p2 = `${Y}-02`;
const FR = { segment: 'FERMER' };
ex(p1, 'PAYROLL_BASE', 1000, FR, { source: 'PAYROLL' });
ex(p1, 'LEASE', 300, FR);
ex(p1, 'INTERNET', 40, FR);
ex(p2, 'OFIS', 250, FR);
ex(p1, 'LEASE', 500, { regionCode: 3 });
inc(p1, 'TFX', 5000, { segment: 'TAX_FREE' });

const audit = { async log() {} };
const up = new UnitPayrollService(db.client, audit);
const hr = new HrSheetsService(db.client, audit, up);
const svc = new SourceChatService(db.client, hr, up);
const ask = (text, context) => svc.ask({ text, context }, 'u1');
const txt = (a) => a.blocks.filter((b) => b.type === 'text').map((b) => b.text).join(' | ');

// [ibora, kutilgan] — kutilganda faqat tekshiriladigan maydonlar (davrlar — «hozir» 2026-10 bo'yicha)
const CASES = [
  // Bo'lim nomi xato bilan
  ['tax fre xodimlari soni', { intent: 'staff', units: ['TAX_FREE'] }],
  ['taxfre daromadi shu yil', { intent: 'money', kind: 'income', units: ['TAX_FREE'], period: '2026-01..2026-10' }],
  ['taks fri xarajati', { kind: 'expense', units: ['TAX_FREE'] }],
  ['tax freening xarajati', { kind: 'expense', units: ['TAX_FREE'] }],
  ['taxfree daromadi', { kind: 'income', units: ['TAX_FREE'] }],
  ['Tax Free xarajati', { kind: 'expense', units: ['TAX_FREE'] }],
  ['Тах фрее ходимлари', { intent: 'staff', units: ['TAX_FREE'] }],
  ['Такс фри даромади', { kind: 'income', units: ['TAX_FREE'] }],
  ['marksheder xarajati', { kind: 'expense', units: ['MARKSHEYDER'] }],
  ['marksheyderlik daromadi', { kind: 'income', units: ['MARKSHEYDER'] }],
  ['komita daromadi', { kind: 'income', units: ['QOMITA'] }],
  ['qomita daromadi', { kind: 'income', units: ['QOMITA'] }],
  ['fermer xarajati', { kind: 'expense', units: ['FERMER'] }],
  ['fermerlar xarajati', { kind: 'expense', units: ['FERMER'] }],
  ["Fermer xo'jaligi xodimlari", { intent: 'staff', units: ['FERMER'] }],
  // Lavozim — bo'lim emas («buxgalter» ≠ Buxgalteriya xizmati; «fermer» so'zisiz — bo'limsiz)
  ['buxgalterlar soni', { units: [] }],
  ['buxgalter xodimlar', { units: [] }],
  ['haydovchilar soni', { units: [] }],
  // Davr va solishtirish
  ["fermer xarajati o'tgan oyga nisbatan", { units: ['FERMER'], period: '2026-09..2026-09', compare: '2026-10..2026-10' }],
  ["Fermer xarajati yanvar o'tgan oyga nisbatan", { period: '2025-12..2025-12', compare: '2026-01..2026-01' }],
  ['xarajat oldingi oy bilan solishtir', { kind: 'expense', period: '2026-09..2026-09', compare: '2026-10..2026-10' }],
  ["ish haqi bo'limlar bo'yicha o'tgan yilga nisbatan", { kind: 'payroll', yoy: true, groupBy: 'unit' }],
  ['yanvar va fevral xarajatlarini solishtir', { kind: 'expense', period: '2026-01..2026-01', compare: '2026-02..2026-02' }],
  ['Ijara xarajati 1-chorak', { kind: 'expense', category: 'LEASE', period: '2026-01..2026-03' }],
  ['ijara xarajati 1 chorak', { category: 'LEASE', period: '2026-01..2026-03' }],
  ["Yanvardagi ish haqi bo'limlar bo'yicha", { kind: 'payroll', period: '2026-01..2026-01', groupBy: 'unit' }],
  ["o'tgan oy xarajati", { kind: 'expense', period: '2026-09..2026-09' }],
  ['oxirgi 3 oy daromadi', { kind: 'income', period: '2026-08..2026-10' }],
  // Nechta qator
  ["eng ko'p xarajat qilgan 5 ta hudud", { kind: 'expense', limit: 5, top: 'desc', groupBy: 'unit' }],
  ['top 3 modda fermer xarajati', { units: ['FERMER'], limit: 3, top: 'desc', groupBy: 'category' }],
  ['top10 xarajat moddalari', { limit: 10, top: 'desc' }],
  ["eng ko'p ish haqi olgan 10 ta xodim", { intent: 'topPay', limit: 10 }],
  ['eng kam xarajat qilgan 3 tasi', { limit: 3, top: 'asc' }],
  ['5 mln dan katta xarajatlar', { kind: 'expense', limit: null, minSom: 5e6 }],
  ["500 ming so'mdan kam xarajatlar", { maxSom: 5e5, limit: null }],
  // Fayl buyrug'i
  ['excel ber', { intent: 'export', exportFile: true }],
  ['Excel qilib ber', { intent: 'export', exportFile: true }],
  ['faylga tashla', { intent: 'export', exportFile: true }],
  ['yubor', { intent: 'export', exportFile: true }],
  ['excel formatda yuborib ber', { intent: 'export', exportFile: true }],
  ['эксел бер', { intent: 'export', exportFile: true }],
  ['xlsx', { intent: 'export', exportFile: true }],
  ["Tax free xodimlari ro'yxati excel ber", { intent: 'staff', units: ['TAX_FREE'], exportFile: true }],
  ["Fermer xo'jaligi xarajati 2026 yil oylar bo'yicha excel qilib ber", { kind: 'expense', units: ['FERMER'], groupBy: 'month', exportFile: true }],
  ['Ijara xarajati 1-chorak faylga tashla', { category: 'LEASE', period: '2026-01..2026-03', exportFile: true }],
  ['top 5 hudud xarajati excel shaklida', { limit: 5, groupBy: 'unit', exportFile: true }],
  // Buyruq so'zisiz — fayl emas
  ['fermer xarajati', { exportFile: false }],
  ["Tax free xodimlari ro'yxati", { exportFile: false }],
];

const span = (p) => (p ? `${p.from}..${p.to}` : null);

(async () => {
  const d = await svc['dict']();
  const fails = [];
  for (const [text, want] of CASES) {
    const q = parse(text, '2026-10', d.dict, {});
    const got = { intent: q.intent, kind: q.kind, units: q.units, period: span(q.period), compare: span(q.compare), yoy: q.yoy, groupBy: q.groupBy, top: q.top, limit: q.limit, category: q.category, minSom: q.minSom, maxSom: q.maxSom, exportFile: q.exportFile };
    for (const [k, v] of Object.entries(want)) {
      if (JSON.stringify(got[k]) !== JSON.stringify(v)) fails.push(`«${text}»: ${k} = ${JSON.stringify(got[k])}, kutilgan ${JSON.stringify(v)}`);
    }
  }
  assert.deepStrictEqual(fails, [], `Tushunilmagan iboralar:\n${fails.join('\n')}`);

  // «N ta» — javobdagi qatorlar soni
  const top2 = await ask(`eng ko'p xarajat qilgan 2 ta modda ${Y} yil`);
  const list = top2.blocks.find((b) => b.type === 'bars' || b.type === 'table');
  assert.ok(list, 'jadval bor');
  assert.ok((list.items ?? list.rows).length <= 2, '2 ta qator');
  assert.ok(top2.understood.some((u) => u.label === 'Qatorlar' && u.value === '2 ta'));

  // Fayl: savol + «Excel ber» — oldingi javob
  const first = await ask(`Fermer xo'jaligi xarajati ${Y} yil oylar bo'yicha`);
  assert.ok(!first.file, 'oddiy savol — fayl emas');
  const cmd = await svc.ask({ text: 'excel ber', context: first.context, threadId: first.threadId }, 'u1');
  assert.strictEqual(cmd.threadId, first.threadId);
  assert.deepStrictEqual(cmd.file, { itemId: first.id }, 'oldingi javob faylga');
  assert.ok(txt(cmd).includes('Excel'), txt(cmd));
  // Ikkinchi «tashla» — yana o'sha javob (buyruq javobi o'tkazib yuboriladi)
  const cmd2 = await svc.ask({ text: 'faylga tashla', threadId: first.threadId }, 'u1');
  assert.deepStrictEqual(cmd2.file, { itemId: first.id });
  const xl = await svc.exportItem('u1', first.threadId, first.id);
  assert.ok(xl.buffer.length > 1000 && xl.buffer.subarray(0, 2).toString() === 'PK', 'xlsx fayl');
  assert.ok(/^Chat-Fermer/.test(xl.filename), xl.filename);
  await assert.rejects(() => svc.exportItem('u1', first.threadId, 'yoq'), /topilmadi/);

  // Bir yo'la: «… Excel qilib ber» — javobning o'zi
  const one = await svc.ask({ text: `Fermer xarajati ${Y} yil excel qilib ber`, threadId: first.threadId }, 'u1');
  assert.deepStrictEqual(one.file, { itemId: one.id });
  assert.ok(one.understood.some((u) => u.label === 'Natija' && u.value === 'Excel fayl'));

  // Yangi suhbatda buyruq — faylga tushadigan javob yo'q
  const empty = await ask('excel ber');
  assert.ok(!empty.file);
  assert.ok(/javob yo'q/.test(txt(empty)), txt(empty));

  console.log(`OK t-chat-understand (${CASES.length} ibora)`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
