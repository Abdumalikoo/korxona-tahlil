// To'lov turi — yagona yadro: qo'lda > qoida > kontragent xotirasi > IKPU / kalit so'z > budjet hisobi > aniqlanmadi.
// Guruh turi — summa bo'yicha ko'pchilik; Kontragentlar sahifasi bilan bir xil natija. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { BankAnalysisService } = require('../dist/modules/bank-analysis/bank-analysis.service');
const { CounterpartyService } = require('../dist/modules/bank-analysis/counterparty.service');
const { invoiceVerdict } = require('../dist/modules/bank-analysis/invoice-analysis.service');
const R = require('../dist/modules/bank-analysis/bank-analysis.rules');
const K = require('../dist/modules/bank-analysis/kind-engine');

async function file(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Page 1');
  ws.getCell('A3').value = 'Выписка по счету 20208000900100012345';
  ['№\nпп', 'Дата\nдокумента', 'Дата\nобработки', '№ док', 'Наименование счёта', 'ИНН', '№ счёта', 'МФО', 'Обороты по\nдебету', 'Обороты по\nкредиту', 'Назначение платежа'].forEach((h, i) => (ws.getCell(11, i + 1).value = h));
  rows.forEach((r, i) => {
    ws.getRow(12 + i).values = [String(i + 1), r.d, r.d, String(100 + i), r.name, r.inn, r.acct ?? '20208000000000000001', '00014', r.out ?? 0, r.in ?? 0, r.p];
  });
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), originalname: 'vypiska.xlsx' };
}

const ctx0 = { rules: [], memory: new Map() };
const base = (r) => () => R.kindMatch(r.dir, r.purpose, r.name ?? '');
const row = (o) => ({ dir: 'OUT', inn: '300000001', purpose: '', amountTiyin: '100', ...o });

(async () => {
  // ── Kalit so'zlar: tur avvalgidek, sababi bilan ──
  assert.deepStrictEqual(R.kindMatch('OUT', 'Оплата за электроэнергию', 'X'), { kind: 'KOMMUNAL', source: 'KEYWORD', reason: 'Izohda «электроэнерг»' });
  assert.strictEqual(R.kindMatch('OUT', 'Оплата', 'UZTELECOM AJ').reason, 'Oluvchi nomida «telecom»'.replace('telecom', 'TELECOM'));
  assert.deepStrictEqual([R.kindMatch('OUT', 'Оплата по договору', 'X').source, R.kindMatch('OUT', 'Оплата по договору', 'X').kind], ['NONE', 'BOSHQA']);
  assert.deepStrictEqual([R.kindMatch('IN', 'Оплата', 'X').source, R.kindMatch('IN', 'Оплата', 'X').kind], ['DEFAULT', 'TUSHUM']);
  for (const [d, p, n] of [['OUT', 'Комиссия за обслуживание', 'B'], ['OUT', 'Иш ҳақи', 'X'], ['IN', 'Возврат', 'X'], ['OUT', 'Аренда офиса', 'X']]) assert.strictEqual(R.kindOf(d, p, n), R.kindMatch(d, p, n).kind);
  console.log('  ✓ kalit so‘zlar va sababi');

  // ── Qoida: kalit so'zdan ustun; yo'nalishi bilan; uzunroq matn oldin ──
  const rules = K.prepareRules([
    { id: 'r1', text: 'аренд', kind: 'XIZMAT', dir: null, createdAt: '', createdBy: '' },
    { id: 'r2', text: 'аренда склада', kind: 'IJARA', dir: 'OUT', createdAt: '', createdBy: '' },
    { id: 'r3', text: 'ab', kind: 'BANK', dir: null, createdAt: '', createdBy: '' },
  ]);
  assert.deepStrictEqual(rules.map((r) => r.id), ['r2', 'r1'], '3 harfdan qisqa qoida olinmaydi, uzuni oldin');
  const ctxR = { rules, memory: new Map() };
  const v1 = K.rowVerdict(row({ purpose: 'Оплата: АРЕНДА СКЛАДА за май' }), ctxR, base(row({ purpose: 'Оплата: АРЕНДА СКЛАДА за май' })));
  assert.deepStrictEqual([v1.kind, v1.source], ['IJARA', 'RULE']);
  assert.match(v1.reason, /аренда склада/);
  assert.strictEqual(K.rowVerdict(row({ dir: 'IN', purpose: 'аренда склада' }), ctxR, base(row({ dir: 'IN' }))).kind, 'XIZMAT', 'faqat chiqim qoidasi kirimga qo‘llanmaydi');
  console.log('  ✓ matn qoidalari');

  // ── Kontragent xotirasi: boshqa guruhlarga bergan turingiz; o'zi hisobga olinmaydi; har xil bo'lsa — yo'q ──
  const mem = K.counterpartyMemory([{ 'OUT|inn:300000001|a': { kind: 'KOMMUNAL' }, 'OUT|inn:300000002|a': { kind: 'IJARA' }, 'OUT|inn:300000002|b': { kind: 'XIZMAT' }, 'OUT|person|x': { kind: 'ISH_HAQI' } }]);
  assert.strictEqual(K.rememberedKind(mem, 'OUT', '300000001'), 'KOMMUNAL');
  assert.strictEqual(K.rememberedKind(mem, 'OUT', '300000001', 'OUT|inn:300000001|a'), undefined, 'guruhning o‘zi — xotira emas');
  assert.strictEqual(K.rememberedKind(mem, 'OUT', '300000002'), undefined, 'turlar har xil — noaniq');
  assert.strictEqual(K.rememberedKind(mem, 'IN', '300000001'), undefined, 'boshqa yo‘nalish');
  const vm = K.rowVerdict(row({ purpose: 'Оплата по договору' }), { rules: [], memory: mem }, base(row({ purpose: 'Оплата по договору' })));
  assert.deepStrictEqual([vm.kind, vm.source], ['KOMMUNAL', 'COUNTERPARTY']);
  console.log('  ✓ kontragent xotirasi');

  // ── Budjet hisobi: faqat izohdan hech narsa topilmaganda ──
  assert.strictEqual(K.accountCode('23402000300100001010'), '23402');
  assert.strictEqual(K.accountCode('123'), undefined);
  const vb = K.rowVerdict(row({ purpose: 'Перечисление', accountCode: '23402' }), ctx0, base(row({ purpose: 'Перечисление' })));
  assert.deepStrictEqual([vb.kind, vb.source], ['SOLIQ', 'ACCOUNT']);
  const vs = K.rowVerdict(row({ purpose: 'За услуги экспертизы', accountCode: '23402' }), ctx0, base(row({ purpose: 'За услуги экспертизы' })));
  assert.deepStrictEqual([vs.kind, vs.source], ['XIZMAT', 'KEYWORD'], 'g‘aznachilik orqali xizmat haqi — soliq emas');
  console.log('  ✓ budjet hisobi');

  // ── Guruh turi: summa bo'yicha ko'pchilik; aralash ──
  const g = (list) => K.groupVerdict(list, (r) => K.rowVerdict(r, ctx0, base(r)));
  const big = row({ purpose: 'электроэнергия', amountTiyin: '9600' });
  assert.deepStrictEqual([g([big, row({ purpose: 'комиссия', amountTiyin: '400' })]).kind, g([big, row({ purpose: 'комиссия', amountTiyin: '400' })]).mixed], ['KOMMUNAL', false]);
  assert.deepStrictEqual([g([row({ purpose: 'комиссия', amountTiyin: '100' }), big]).kind, g([big, row({ purpose: 'комиссия', amountTiyin: '600' })]).mixed], ['KOMMUNAL', true], 'oxirgi to‘lov emas — ko‘pchilik');
  console.log('  ✓ guruh turi');

  // ── Faktura: IKPU sababi ──
  const iv = invoiceVerdict('OUT', { ikpu: '10701001001000000 - Услуги по аренде зданий', purpose: 'Аренда помещения' }, 'X');
  assert.deepStrictEqual([iv.kind, iv.source], ['IJARA', 'IKPU']);
  assert.match(iv.reason, /^IKPU 10701001001000000 — Услуги по аренде/);
  console.log('  ✓ faktura IKPU');

  // ── Servis: tahlil, qo'lda tur, xotira, qoida, kontragentga qo'llash, Kontragentlar sahifasi ──
  const db = fakeDb();
  db.tables.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  const svc = new BankAnalysisService(db.client, new AuditService(db.client));
  const cps = new CounterpartyService(db.client);
  const rows = [
    { d: '10.01.2026', name: 'SUVOQOVA MCHJ', inn: '300000011', out: 500_000, p: 'Оплата по договору №4' },
    { d: '10.02.2026', name: 'SUVOQOVA MCHJ', inn: '300000011', out: 520_000, p: 'Оплата по счету за услуги водоснабжения' },
    { d: '12.01.2026', name: 'NOMA’LUM MCHJ', inn: '300000012', out: 70_000, p: 'Перечисление средств' },
    { d: '15.01.2026', name: 'GAZNACHILIK', inn: '300000013', out: 90_000, p: 'Перечисление', acct: '23402000300100001010' },
  ];
  const a = await svc.analyze(await file(rows));
  const byInn = (list, inn) => list.filter((x) => x.inn === inn);
  assert.strictEqual(a.rows.find((r) => r.inn === '300000013').accountCode, '23402');
  assert.ok(!JSON.stringify(a.rows).includes('23402000300100001010'), 'to‘liq hisob raqami qaytarilmaydi');
  const gaz = byInn(a.groups, '300000013')[0];
  assert.deepStrictEqual([gaz.kind, gaz.kindSource], ['SOLIQ', 'ACCOUNT']);
  const unknown = byInn(a.groups, '300000012')[0];
  assert.deepStrictEqual([unknown.kind, unknown.kindSource], ['BOSHQA', 'NONE']);
  await svc.commit({ fileName: 'v.xlsx', account: 'Asosiy', months: ['2026-01', '2026-02'], rows: a.rows }, 'adm');
  const store = db.tables.setting.find((s) => s.key === 'bank.analysis.store').value;
  assert.ok(!JSON.stringify(store).includes('23402000300100001010'), 'omborda to‘liq hisob raqami yo‘q');
  assert.strictEqual(Object.values(store.accounts)[0].months['2026-01'].rows.find((r) => r.inn === '300000013').accountCode, '23402', 'saqlashda hisob kodi qoladi');

  let v = await svc.view('2026-01', '2026-02');
  const suv = byInn(v.groups, '300000011');
  assert.strictEqual(suv.length, 2, 'izohlari har xil — ikki guruh');
  const first = suv.find((x) => x.kindSource === 'NONE');
  assert.ok(first, '«Оплата по договору» — aniqlanmadi');
  // Bir guruhga «Kommunal» — ikkinchisi (izohi boshqa) o'zgarmaydi (u allaqachon kalit so'zdan Kommunal),
  // birinchisi — siz bergan; endi yangi oyning yangi izohi ham xotiradan Kommunal bo'ladi
  await svc.groupMeta({ key: first.key, kind: 'KOMMUNAL' }, 'adm');
  v = await svc.view('2026-01', '2026-02');
  const edited = v.groups.find((x) => x.key === first.key);
  assert.deepStrictEqual([edited.kind, edited.kindSource, edited.kindEdited], ['KOMMUNAL', 'MANUAL', true], 'o‘z xotirasi avtomatik turga aylanmaydi');
  const b2 = await svc.analyze(await file([{ d: '10.03.2026', name: 'SUVOQOVA MCHJ', inn: '300000011', out: 530_000, p: 'Перечисление средств по акту сверки' }]));
  assert.deepStrictEqual([b2.groups[0].kind, b2.groups[0].kindSource], ['KOMMUNAL', 'COUNTERPARTY']);
  assert.match(b2.groups[0].kindReason, /INN 300000011/);

  // Qoida — xotiradan ustun; o'chirilsa — qaytadi
  const added = await svc.addKindRule({ text: 'акту сверки', kind: 'XIZMAT', dir: 'OUT' }, 'adm');
  assert.strictEqual(added.updated, false);
  assert.strictEqual((await svc.addKindRule({ text: 'Акту  сверки', kind: 'BANK', dir: 'OUT' }, 'adm')).updated, true, 'shu matn — turi almashadi');
  await assert.rejects(() => svc.addKindRule({ text: 'ab', kind: 'BANK' }, 'adm'), /kamida 3/);
  await assert.rejects(() => svc.addKindRule({ text: 'abcd', kind: 'YOQ' }, 'adm'), /Tur noto'g'ri/);
  const b3 = await svc.analyze(await file([{ d: '10.03.2026', name: 'SUVOQOVA MCHJ', inn: '300000011', out: 530_000, p: 'Перечисление средств по акту сверки' }]));
  assert.deepStrictEqual([b3.groups[0].kind, b3.groups[0].kindSource], ['BANK', 'RULE']);
  const list = await svc.kindRules();
  assert.strictEqual(list.length, 1);
  await svc.deleteKindRule(list[0].id);
  await assert.rejects(() => svc.deleteKindRule(list[0].id), /topilmadi/);
  assert.strictEqual((await svc.analyze(await file([{ d: '10.03.2026', name: 'SUVOQOVA MCHJ', inn: '300000011', out: 530_000, p: 'Перечисление средств по акту сверки' }]))).groups[0].kindSource, 'COUNTERPARTY');

  // Kontragentning hammasiga bitta tur; Kontragentlar sahifasi ham shu turni ko'radi
  const before = (await cps.card('300000012')).documents[0].kindLabel;
  assert.strictEqual(before, R.BANK_KIND_LABEL.BOSHQA);
  const ck = await svc.counterpartyKind({ inn: '300000012', dir: 'OUT', kind: 'XIZMAT' }, 'adm');
  assert.strictEqual(ck.groups, 1);
  v = await svc.view('2026-01', '2026-02');
  assert.deepStrictEqual([byInn(v.groups, '300000012')[0].kind, byInn(v.groups, '300000012')[0].kindSource], ['XIZMAT', 'MANUAL']);
  assert.strictEqual((await cps.card('300000012')).documents[0].kindLabel, R.BANK_KIND_LABEL.XIZMAT, 'Kontragentlar sahifasi — siz bergan tur');
  assert.strictEqual((await cps.card('300000011')).documents.every((d) => d.kindLabel === R.BANK_KIND_LABEL.KOMMUNAL), true, 'xotira — Kontragentlar sahifasida ham');
  await assert.rejects(() => svc.counterpartyKind({ inn: '300000099', dir: 'OUT', kind: 'XIZMAT' }, 'adm'), /topilmadi/);
  // Olib tashlash — avtomatikka qaytadi
  await svc.counterpartyKind({ inn: '300000012', dir: 'OUT', kind: null }, 'adm');
  v = await svc.view('2026-01', '2026-02');
  assert.strictEqual(byInn(v.groups, '300000012')[0].kindSource, 'NONE');
  console.log('  ✓ servis: qo‘lda, xotira, qoida, kontragentga qo‘llash, Kontragentlar sahifasi');

  // ── Yo'naltirish taklifi: shu guruhniki, bo'lmasa — shu kontragentniki; yo'q bo'lsa — null ──
  db.tables.department.push({ id: 'dAUP', name: 'AUP', index: 1, isActive: true });
  db.tables.region.push({ code: 0, name: 'Markaz', isActive: true }, { code: 7, name: 'Viloyat-7', isActive: true });
  db.tables.category.push({ code: 'KOMM', label: 'Kommunal', parentCode: null, isLeaf: true, isActive: true, order: 1 });
  v = await svc.view('2026-01', '2026-02');
  const [gA, gB] = byInn(v.groups, '300000011');
  assert.strictEqual((await svc.group(gA.key, '2026-01', '2026-02')).suggestion, null, 'yo‘naltirish yo‘q — taklif yo‘q');
  const rowsA = (await svc.group(gA.key, '2026-01', '2026-02')).rows;
  await svc.route({ items: [{ account: rowsA[0].account, rowId: rowsA[0].id }], place: { unit: 'CENTER', departmentId: 'dAUP' }, categoryCode: 'KOMM', section: 'DOIMIY' }, 'adm');
  const sA = (await svc.group(gA.key, '2026-01', '2026-02')).suggestion;
  assert.deepStrictEqual([sA.basis, sA.place.unit, sA.place.departmentId, sA.categoryCode, sA.section, sA.count], ['GROUP', 'CENTER', 'dAUP', 'KOMM', 'DOIMIY', 1]);
  const sB = (await svc.group(gB.key, '2026-01', '2026-02')).suggestion;
  assert.deepStrictEqual([sB.basis, sB.categoryCode], ['COUNTERPARTY', 'KOMM'], 'izohi boshqa guruh — kontragent bo‘yicha');
  assert.strictEqual((await svc.group(byInn(v.groups, '300000012')[0].key, '2026-01', '2026-02')).suggestion, null, 'boshqa kontragent');
  // Yo'naltirish bekor qilinsa — taklif ham yo'qoladi
  await svc.unroute({ ids: db.tables.setting.find((s) => s.key === 'bank.analysis.store').value.posts.map((p) => p.id) }, 'adm');
  assert.strictEqual((await svc.group(gA.key, '2026-01', '2026-02')).suggestion, null);
  console.log('  ✓ yo‘naltirish taklifi');

  console.log('t-kind-engine: OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
