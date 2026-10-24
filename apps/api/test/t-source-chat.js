// Chat › Manba chati: savolni tushunish (lotin/kirill, qo'shimchalar, davrlar, bo'limlar, modda) va manbalardan javob.
// TEST MA'LUMOTLARI SUN'IY (ismlar, PINFL, summalar — o'ylab topilgan).
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { SourceChatService, som } = require('../dist/modules/source-chat/chat.service');
const { parse, parsePeriod, norm } = require('../dist/modules/source-chat/chat.parse');
const { HrSheetsService } = require('../dist/modules/hr-sheets/hr-sheets.service');
const { UnitPayrollService } = require('../dist/modules/unit-payroll/unit-payroll.service');
const { clearHrCache } = require('../dist/modules/hr-sheets/hr-sheets.store');

const NOW = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 7);
const Y = Number(NOW.slice(0, 4));
const M = Number(NOW.slice(5, 7));

// ── Davr ──
const P = (t) => parsePeriod(norm(t), '2026-10');
assert.deepStrictEqual(P('yanvardagi ish haqi').period, { from: '2026-01', to: '2026-01', label: 'Yanvar 2026' });
assert.strictEqual(P('dekabrdagi xarajat').period.from, '2025-12', 'kelajakdagi oy — o\'tgan yil');
assert.deepStrictEqual([P('yanvardan martgacha').period.from, P('yanvardan martgacha').period.to], ['2026-01', '2026-03']);
assert.deepStrictEqual([P('yanvar va fevral').period.from, P('yanvar va fevral').compare.from], ['2026-01', '2026-02']);
assert.deepStrictEqual([P('2-chorak').period.from, P('2-chorak').period.to], ['2026-04', '2026-06']);
assert.deepStrictEqual([P("o'tgan oy").period.from], ['2026-09']);
assert.deepStrictEqual([P('oxirgi 3 oy').period.from, P('oxirgi 3 oy').period.to], ['2026-08', '2026-10']);
assert.deepStrictEqual([P("o'tgan yil").period.from, P("o'tgan yil").period.to], ['2025-01', '2025-12']);
assert.deepStrictEqual([P('2025 yil').period.from, P('2025 yil').period.to], ['2025-01', '2025-12']);
assert.deepStrictEqual([P('mart 2025').period.from], ['2025-03']);
assert.deepStrictEqual([P('2026-03').period.from], ['2026-03']);
assert.deepStrictEqual([P('03.2026').period.from], ['2026-03']);
assert.deepStrictEqual([P('Январдаги иш ҳақи').period.from], ['2026-01'], 'kirill');
assert.strictEqual(P('martaba').period, null);
assert.strictEqual(P('maydagi').period.from, '2026-05');

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
  { pinfl: '30000000000003', fullName: 'KARIMOV BOTIR OLIMOVICH', position: 'Haydovchi', regionCode: 3, departmentId: null, isActive: true, employmentType: 'SHARTNOMA', districtId: null, hiredAt: null, firedAt: null },
);
// Ma'lumotnoma (10-jadval): Fermer xodimi (bazada yo'q)
T.setting.push({ key: 'hr.sheet.J10', value: { code: 'J10', batchId: 'b', fileName: '10.xlsx', uploadedAt: '2026-10-24T10:00:00Z', uploadedBy: 'A', uploadedById: 'u1', cols: ['fio', 'holat', 'tuzilma', 'lavozim', 'pinfl', 'yosh', 'malumot', 'tizimda'], rows: [['TOSHMATOVA NIGORA ANVAROVNA', 'ishlayapti', "Qibray tumani Fermer xo'jaliklarida buxgalteriya hisobi", 'Buxgalteri', '30000000000009', '44', 'oliy', '01.07.2026'], ['QODIROV JAMSHID ALIYEVICH', 'ishlayapti', "Asaka tumani Fermer xo'jaliklarida buxgalteriya hisobi", 'Bosh mutaxassisi', '30000000000008', '29', 'o‘rta-maxsus', '15.03.2025']] } });
T.setting.push({ key: 'hr.sheet.J16', value: { code: 'J16', batchId: 'c', fileName: '16.xlsx', uploadedAt: '2026-10-24T10:00:00Z', uploadedBy: 'A', uploadedById: 'u1', cols: ['fio', 'pinfl', 'jinsi', 'toliqTuzilma'], rows: [['TOSHMATOVA NIGORA ANVAROVNA', '30000000000009', 'AYOL', 'Toshkent viloyati Qibray tumani'], ['QODIROV JAMSHID ALIYEVICH', '30000000000008', 'ERKAK', 'Andijon viloyati Asaka tumani']] } });
T.district.push({ id: '3-1', regionCode: 3, code: 1, name: 'Asaka tumani', isActive: true });
const D = (p, day = 10) => new Date(`${p}-${String(day).padStart(2, '0')}T07:00:00Z`);
const ex = (p, cat, som, place, extra = {}) => T.expense.push({ id: 'e' + T.expense.length, period: p, date: D(p), amountTiyin: BigInt(som * 100), categoryCode: cat, regionCode: null, departmentId: null, segment: null, districtId: null, source: 'MANUAL', paymentStatus: 'PAID', deletedAt: null, section: 'DOIMIY', description: null, counterparty: null, ...place, ...extra });
const inc = (p, cat, som, place) => T.income.push({ id: 'i' + T.income.length, period: p, date: D(p), amountTiyin: BigInt(som * 100), paidTiyin: 0n, categoryCode: cat, regionCode: null, departmentId: null, segment: null, deletedAt: null, section: 'DOIMIY', clientName: 'Mijoz', description: null, ...place });
const p1 = `${Y}-01`;
const p2 = `${Y}-02`;
const FR = { segment: 'FERMER' };
ex(p1, 'PAYROLL_BASE', 1000, FR, { source: 'PAYROLL' });
ex(p2, 'PAYROLL_BASE', 1200, FR, { source: 'PAYROLL' });
ex(p1, 'LEASE', 300, FR, { counterparty: 'Issiqxona' });
ex(p1, 'INTERNET', 40, FR);
ex(p1, 'LEASE', 500, { regionCode: 3, districtId: '3-1' }, { counterparty: 'Artel MCHJ', paymentStatus: 'UNPAID' });
ex(`${Y - 1}-01`, 'LEASE', 200, FR);
ex(p2, 'OFIS', 250, { regionCode: 0, departmentId: 'd1' });
ex(p1, 'PAYROLL_BASE', 2000, { regionCode: 0 }, { source: 'PAYROLL' });
inc(p1, 'TFX', 5000, { segment: 'TAX_FREE' });
inc(p2, 'BUX', 900, { regionCode: 3 });
T.payrollEntry.push({ id: 'pe1', employeePinfl: '30000000000001', period: p1, totalTiyin: 150000000n, baseTiyin: 150000000n, deletedAt: null });

const audit = { async log() {} };
const up = new UnitPayrollService(db.client, audit);
const hr = new HrSheetsService(db.client, audit, up);
const svc = new SourceChatService(db.client, hr, up);
const ask = (text, context) => svc.ask({ text, context }, 'u1');
const txt = (a) => a.blocks.filter((b) => b.type === 'text').map((b) => b.text).join(' | ');

(async () => {
  clearHrCache();
  assert.strictEqual(som(123456700n), "1 234 567 so'm");

  // Salom va yordam
  assert.strictEqual((await ask('Salom')).blocks[0].type, 'text');
  let a = await ask('asdf qwer');
  assert.match(txt(a), /tushunmadim/i);
  assert.ok(a.suggestions.length);

  // ── Xodim: ism bo'yicha (qo'shimcha bilan), barcha ma'lumot ──
  a = await ask("Aliyev Sardorning barcha ma'lumotlari");
  assert.ok(a.blocks.some((b) => b.type === 'person'));
  assert.strictEqual(a.context.pinfl, '30000000000001');
  assert.match(txt(a), /Bosh mutaxassis/);
  // Kirillda
  a = await ask('Алиев Сардор ҳақида маълумот');
  assert.strictEqual(a.context.pinfl, '30000000000001', 'kirill ism');
  // Bir nechta mos — tanlash
  a = await ask('Aliyev');
  const ch = a.blocks.find((b) => b.type === 'choices');
  assert.ok(ch && ch.items.length === 2, 'Aliyev / Aliyeva — tanlash');
  // JShShIR bo'yicha va ma'lumotnomadan (bazada yo'q)
  a = await ask("30000000000009 ma'lumotlari");
  assert.match(txt(a), /Fermer/);
  assert.ok(a.sources.includes('10-jadval'));
  a = await ask('Toshmatova Nigora qaysi bolimda');
  assert.match(txt(a), /«Fermer xo'jaligi» bo'limida/);
  // Ish haqi
  a = await ask('Aliyev Sardorning yanvardagi ish haqi');
  assert.match(txt(a), /1 500 000 so'm/);
  a = await ask('fevraldagi-chi?', a.context);
  assert.match(txt(a), /topilmadi/, 'kontekst: shu xodim, fevral');
  a = await ask('39999999999999 malumotlari');
  assert.match(txt(a), /topilmadi/);

  // ── Pul: bo'lim xarajati, oylar bo'yicha ──
  a = await ask(`Fermer xo'jaligi xarajati ${Y} yil oylar bo'yicha`);
  assert.match(txt(a), /2 540 so'm/, 'Fermer: 1000+1200+300+40');
  assert.strictEqual(a.context.units[0], 'FERMER');
  const tbl = a.blocks.find((b) => b.type === 'table' && b.title === "Oylar bo'yicha");
  assert.ok(tbl && tbl.rows.length === Math.max(M, 2) - 0 || tbl, 'oylar jadvali');
  // Davom: daromadi-chi
  let b = await ask('daromadi-chi?', a.context);
  assert.match(txt(b), /topilmadi|0 so'm/);
  // «Shu bo'lim» — oldingi javobdagi bo'lim
  b = await ask(`shu bo'limning ish haqi yanvar ${Y}`, a.context);
  assert.match(txt(b), /Fermer xo'jaligi · Yanvar \d{4}: ish haqi — 1 000 so'm/);
  // «Uning» — oldingi xodim
  const pa = await ask('Aliyev Sardor kim');
  b = await ask(`uning ish haqi yanvar ${Y}`, pa.context);
  assert.match(txt(b), /ALIYEV SARDOR.*1 500 000 so'm/);
  // Modda
  a = await ask(`Ijara xarajati yanvar ${Y}`);
  assert.match(txt(a), /«Ijara» xarajati — 800 so'm/);
  a = await ask(`yanvar ${Y} internet xarajati fermer`);
  assert.match(txt(a), /40 so'm/);
  // Ish haqi bo'limlar bo'yicha
  a = await ask(`yanvar ${Y} dagi ish haqi bo'limlar bo'yicha`);
  assert.match(txt(a), /3 000 so'm/, 'ish haqi: Fermer 1000 + Markaz 2000');
  const bars = a.blocks.find((x) => x.type === 'bars');
  assert.deepStrictEqual(bars.items.map((i) => i.label), ['Markaz', "Fermer xo'jaligi"]);
  // Viloyat (qo'shimcha bilan) — natija
  a = await ask(`Andijonda daromad va xarajat ${Y} yil`);
  assert.match(txt(a), /daromad 900 so'm, xarajat 500 so'm, natija 400 so'm/);
  // Markaz bo'limi
  a = await ask(`Axborot texnologiyalari bo'limi xarajati fevral ${Y}`);
  assert.match(txt(a), /250 so'm/);
  // Eng ko'p
  a = await ask(`eng ko'p xarajat qilgan hududlar ${Y} yil`);
  assert.deepStrictEqual(a.blocks.find((x) => x.type === 'bars').items.map((i) => i.label), ['Andijon viloyati'], 'faqat hududlar');
  a = await ask(`eng ko'p xarajat qilgan bo'limlar ${Y} yil`);
  assert.deepStrictEqual(a.blocks.find((x) => x.type === 'bars').items.map((i) => i.label), ["Fermer xo'jaligi", 'Markaz', 'Andijon viloyati'], 'Fermer 2540 > Markaz 2250 > Andijon 500');
  // Butun korxona natijasi
  a = await ask(`Natija ${Y} yil`);
  assert.match(txt(a), /Butun korxona/);
  // Solishtirish
  a = await ask(`yanvar va fevral ${Y} xarajatlarini solishtir`);
  assert.match(txt(a), /Yanvar 2026|Yanvar/);
  assert.ok(a.blocks.some((x) => x.type === 'metrics' && x.items.length === 3));
  // Yozuvlar
  a = await ask(`Fermer oxirgi xarajat yozuvlari ${Y} yil`);
  const rec = a.blocks.find((x) => x.type === 'table');
  assert.strictEqual(rec.rows.length, 4);
  assert.ok(rec.rows.some((r) => /Issiqxona/.test(r.x || '')));

  // ── Kuchaytirilgan: xatolar, solishtirish, yil-yil, kontragent, summa, qarz, tuman ──
  a = await ask(`fermer xarjati yanvr ${Y}`);
  assert.match(txt(a), /1 340 so'm/, 'xato yozuv tuzatildi: 1000+300+40');
  assert.ok(a.understood.some((u) => u.label === 'Tuzatildi'));
  a = await ask(`Andijon va fermer xarajatini solishtir ${Y} yil`);
  const cmp = a.blocks.find((x) => x.type === 'table');
  assert.deepStrictEqual(cmp.rows.map((r) => r.u), ["Fermer xo'jaligi", 'Andijon viloyati']);
  assert.match(txt(a), /eng ko'pi — Fermer xo'jaligi \(2 540 so'm\)/);
  a = await ask(`Fermer xarajati yanvar ${Y} o'tgan yilning shu davri bilan solishtir`);
  assert.match(txt(a), /Yanvar \d{4} — 200 so'm, Yanvar \d{4} — 1 340 so'm/);
  a = await ask("artelga to'langan");
  assert.match(txt(a), /500 so'm/);
  assert.ok(a.blocks.some((x) => x.type === 'table' && /Yozuvlar/.test(x.title)));
  a = await ask(`${Y} yil 900 so'mdan katta xarajatlar`);
  assert.match(txt(a), /4 200 so'm \(3 yozuv\)/, '1000, 1200, 2000');
  a = await ask(`to'lanmagan xarajatlar ${Y} yil`);
  assert.match(txt(a), /500 so'm \(1 yozuv\)/);
  a = await ask(`Asaka tumani xarajati ${Y} yil`);
  assert.match(txt(a), /Asaka tumani · .*500 so'm/);
  a = await ask(`Fermer xarajati ${Y} yil`);
  assert.ok(a.blocks.find((x) => x.type === 'metrics').items.some((i) => i.label === 'Korxona jamidagi ulushi'));

  // ── Xodimlar tahlili ──
  a = await ask('40 yoshdan katta ayollar soni');
  assert.match(txt(a), /Topildi: 1 ta/);
  a = await ask("ayol xodimlar soni");
  assert.match(txt(a), /Topildi: 1 ta/);
  a = await ask('buxgalterlar soni');
  assert.match(txt(a), /Topildi: [12] ta/);
  a = await ask("o'rta maxsus ma'lumotli xodimlar");
  assert.match(txt(a), /Topildi: 1 ta/);
  a = await ask(`${Y} yilda ishga kirganlar`);
  assert.match(txt(a), /Topildi: 1 ta/);
  a = await ask("Andijon viloyati xodimlari lavozimlar bo'yicha");
  assert.ok(a.blocks.some((x) => x.type === 'bars' && /Lavozim/.test(x.title)) || /xodimlari: /.test(txt(a)));
  a = await ask("xodimlar yosh bo'yicha");
  assert.ok(a.blocks.find((x) => x.type === 'bars' && /Yosh/.test(x.title)));

  // ── Ish haqi reytingi ──
  a = await ask(`eng ko'p ish haqi olgan xodimlar ${Y} yil`);
  assert.match(txt(a), /1 xodimga jami 1 500 000 so'm/);
  a = await ask(`o'rtacha ish haqi ${Y} yil`);
  assert.ok(a.blocks.some((x) => x.type === 'metrics'));

  // Balki
  a = await ask('Toshmatva');
  assert.ok(a.blocks.some((x) => x.type === 'choices'), 'xato familiya — tanlash yoki taklif');

  // ── Xodimlar ──
  a = await ask('Andijon viloyati xodimlari soni');
  assert.match(txt(a), /Topildi: 3 ta xodim/, 'baza (2) + ma\'lumotnoma (1)');
  a = await ask("Fermer xo'jaligi xodimlari ro'yxati");
  assert.match(txt(a), /2 ta/, 'miya: ma\'lumotnomadan (2 kishi)');
  a = await ask('nechta xodim bor');
  assert.ok(a.blocks.find((x) => x.type === 'table').rows.some((r) => r.u === 'Markaz' && r.c === '1'));

  // Manbalar, bo'limlar
  a = await ask('manbalar');
  assert.ok(a.blocks.find((x) => x.type === 'table').rows.some((r) => /10-jadval/.test(r.s)));
  a = await ask("qanday bo'limlar bor");
  assert.match(txt(a), /Fermer/);

  // Toshkent shahri / viloyati
  const dict = (await svc['dict']()).dict;
  assert.strictEqual(parse('Toshkent shahrida xarajat', '2026-10', dict).region, 26);
  assert.strictEqual(parse('Toshkent viloyati xarajat', '2026-10', dict).region, 27);

  // ── Suhbatlar: ask suhbat ochadi, nomi — birinchi savol; davomi shu suhbatga ──
  const st = svc.store('u1');
  let threads = await st.list();
  assert.ok(threads.length > 10, 'har threadId siz savol — yangi suhbat');
  const s1 = await ask("Fermer xo'jaligi xarajati shu yil");
  assert.ok(s1.threadId);
  assert.strictEqual(s1.thread.title, "Fermer xo'jaligi xarajati shu yil");
  const s2 = await svc.ask({ text: 'daromadi-chi?', context: s1.context, threadId: s1.threadId }, 'u1');
  assert.strictEqual(s2.threadId, s1.threadId);
  let t1 = await st.get(s1.threadId);
  assert.deepStrictEqual(t1.items.map((x) => x.question), ["Fermer xo'jaligi xarajati shu yil", 'daromadi-chi?']);
  assert.strictEqual(t1.title, "Fermer xo'jaligi xarajati shu yil", 'nomi o\'zgarmaydi');
  // Nomi, qadash, tartib
  await st.update(s1.threadId, { title: '  Fermer   tahlili ', pinned: true });
  threads = await st.list();
  assert.strictEqual(threads[0].id, s1.threadId, 'qadalgan tepada');
  assert.strictEqual(threads[0].title, 'Fermer tahlili');
  assert.strictEqual((await st.list('fermer t')).length, 1, 'qidiruv');
  await assert.rejects(st.update(s1.threadId, { title: '  ' }), /bo'sh/);
  await svc.ask({ text: 'nechta xodim bor', threadId: s1.threadId }, 'u1');
  assert.strictEqual((await st.get(s1.threadId)).title, 'Fermer tahlili', 'qo\'lda qo\'yilgan nom saqlanadi');

  // Saqlash (izoh bilan), takror saqlanmaydi, suhbat o'chsa ham qoladi
  const sv = await st.save({ threadId: s1.threadId, itemId: s1.id, note: 'Hisobot uchun' });
  assert.strictEqual(sv.note, 'Hisobot uchun');
  assert.strictEqual(sv.threadTitle, 'Fermer tahlili');
  assert.strictEqual((await st.save({ threadId: s1.threadId, itemId: s1.id })).id, sv.id);
  await st.updateSaved(sv.id, { note: '' });
  assert.strictEqual((await st.saved())[0].note, null);
  await assert.rejects(st.save({ threadId: s1.threadId, itemId: 'yoq' }), /topilmadi/);

  // Matn va Excel (xodim kartasidan pasport chiqmaydi)
  const pp = await svc.ask({ text: '30000000000009 malumotlari', threadId: s1.threadId }, 'u1');
  const txtOut = await svc.itemText('u1', s1.threadId, pp.id);
  assert.match(txtOut, /Savol: 30000000000009/);
  assert.match(txtOut, /JShShIR: 30000000000009/);
  const ExcelJS = require('exceljs');
  const ex1 = await svc.exportThread('u1', s1.threadId);
  assert.match(ex1.filename, /Chat-Fermer-tahlili/);
  const wbx = new ExcelJS.Workbook();
  await wbx.xlsx.load(ex1.buffer);
  const cells = [];
  wbx.worksheets[0].eachRow((row) => row.eachCell((c) => cells.push(String(c.value))));
  assert.ok(cells.some((c) => /Fermer xo'jaligi xarajati shu yil/.test(c)));
  assert.ok(cells.some((c) => c === 'TOSHMATOVA NIGORA ANVAROVNA'));
  assert.ok(!cells.some((c) => /pasport/i.test(c)));
  const ex2 = await svc.exportSaved('u1');
  assert.ok(ex2.buffer.length > 1000);

  // Tozalash: bitta javob, suhbat ichi, suhbat, hammasi (qadalganlar qolishi mumkin)
  t1 = await st.removeItem(s1.threadId, s2.id);
  assert.strictEqual(t1.count, 3);
  await assert.rejects(st.removeItem(s1.threadId, s2.id), /topilmadi/);
  t1 = await st.clear(s1.threadId);
  assert.strictEqual(t1.count, 0);
  assert.strictEqual((await st.get(s1.threadId)).items.length, 0);
  assert.strictEqual((await st.saved()).length, 1, 'saqlangan javob qoladi');
  const other = (await st.list()).find((t) => t.id !== s1.threadId);
  await st.delete(other.id);
  await assert.rejects(st.get(other.id), /topilmadi/);
  const r1 = await st.deleteAll({ keepPinned: true });
  assert.ok(r1.deleted > 5);
  assert.deepStrictEqual((await st.list()).map((t) => t.id), [s1.threadId]);
  await st.deleteAll();
  assert.strictEqual((await st.list()).length, 0);
  assert.ok(!T.setting.some((x) => x.key.startsWith('chat.source.u1.t.')), 'suhbat yozuvlari o\'chdi');
  await st.unsave(sv.id);
  assert.strictEqual((await st.saved()).length, 0);
  await st.clearSaved();

  // Eski bitta tarix → «Avvalgi suhbat»
  T.setting.push({ key: 'chat.source.u2', value: { items: [{ ...s1, id: 'old1' }] } });
  const st2 = svc.store('u2');
  const mig = await st2.list();
  assert.deepStrictEqual(mig.map((t) => [t.title, t.count]), [['Avvalgi suhbat', 1]]);
  assert.ok(!T.setting.some((x) => x.key === 'chat.source.u2'), 'eski kalit o\'chdi');
  assert.strictEqual((await st2.get(mig[0].id)).items[0].id, 'old1');
  console.log('OK t-source-chat');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});