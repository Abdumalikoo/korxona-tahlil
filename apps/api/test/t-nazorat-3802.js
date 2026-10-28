// 3802 › Nazorat zanjiri: vedomost ↔ tarkib (ism bo'yicha moslash, qo'lda bog'lash), vedomost ↔ shtat, qoplash ↔ Qo'mita,
// izohlar, chegara; servis — oylar, sozlamalar, Excel.
// TEST MA'LUMOTLARI SUN'IY (ismlar, JShShIR, summalar — o'ylab topilgan).
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { computeMonth, matchPerson, suggestShtatSection, nameKey, isRegional, candidates } = require('../dist/modules/qomita/nazorat-3802.compute');
const { Nazorat3802Service } = require('../dist/modules/qomita/nazorat-3802.service');
const { Shtat3802Service } = require('../dist/modules/qomita/shtat-3802.service');

const S = (som) => String(som * 100);
const T = (pinfl, fullName, oklad, ustama) => ({ pinfl, fullName, okladTiyin: BigInt(oklad * 100), ustamaTiyin: BigInt(ustama * 100), totalTiyin: BigInt((oklad + ustama) * 100) });
const V = (section, fullName, position, oklad, ustama, total) => ({ section, fullName, position, amounts: { OKLAD: S(oklad), ...(ustama ? { USTAMA_40: S(ustama) } : {}) }, totalTiyin: S(total ?? oklad + ustama) });

// ── Ism ──
assert.strictEqual(nameKey("To'xtayev  Sardor"), 'toxtayev sardor');
assert.strictEqual(nameKey('Тўхтаев Сардор'), nameKey("To'xtayev Sardor").replace('toxtayev', nameKey('Тўхтаев')), 'kirill → lotin');
const rows = [T('30000000000001', 'Aliyev Sardor Baxtiyorovich', 5000000, 2000000), T('30000000000002', 'Karimova Madina Rustamovna', 4000000, 1600000), T('30000000000003', 'Karimova Madina Olimovna', 3000000, 0), T('30000000000004', 'Xudoyberdiyev Jasur Anvarovich', 6000000, 2400000)];
assert.strictEqual(matchPerson('Aliyev Sardor Baxtiyorovich', rows, {}).how, 'EXACT');
assert.strictEqual(matchPerson('ALIYEV SARDOR', rows, {}).how, 'FIRST2');
assert.strictEqual(matchPerson('Karimova Madina', rows, {}).how, 'NONE', 'ikki nomzod — avtomatik emas');
assert.strictEqual(matchPerson('Hudoyberdiyev Jasur Anvarovich', rows, {}).how, 'FUZZY');
assert.strictEqual(matchPerson('Karimova Madina', rows, { 'karimova madina': '30000000000003' }).row.pinfl, '30000000000003', "qo'lda bog'lash");
assert.strictEqual(matchPerson('Noma’lum Odam', rows, { 'nomalum odam': null }).how, 'CONFIRMED_NONE');
assert.ok(candidates('Karimova Madina', rows).length >= 2);
assert.ok(isRegional('Andijon viloyati') && isRegional('TOSHKENT SHAHAR') && isRegional("Qoraqalpog'iston Respublikasi") && !isRegional('Kadrlar bo‘limi'));

// ── Shtat bo'limi taklifi ──
const SHTAT = [
  { kind: 'OLADI', key: 'OLADI|kadr', name: 'Кадрлар билан ишлаш бўлими', departmentId: 'dK', coverage: 'OKLAD_40', positions: [{ row: 10, name: 'Бўлим бошлиғи', units: 1, salaryTiyin: S(5000000) }, { row: 11, name: 'Бош мутахассис', units: 1, salaryTiyin: S(4000000) }] },
  { kind: 'OLADI', key: 'OLADI|axb', name: 'Ахборот хизмати', departmentId: 'dA', coverage: 'OKLAD_40', positions: [{ row: 20, name: 'Бош мутахассис', units: 1, salaryTiyin: S(4000000) }] },
  { kind: 'OLADI', key: 'OLADI|strat', name: 'Стратегик режалаштириш ва йиғма ахборот-таҳлил бўлими', departmentId: 'dS', coverage: 'FULL', positions: [{ row: 30, name: 'Бош мутахассис', units: 0.5, salaryTiyin: S(4000000) }] },
  { kind: 'OLADI', key: 'OLADI|vil', name: 'Солиқ тўловчиларга хизмат кўрсатиш бўйича вилоятлар ҳудудий бўлинмалари', departmentId: null, coverage: 'OKLAD_40', positions: [{ row: 40, name: 'Бош мутахассис', units: 2, salaryTiyin: S(3000000) }] },
  { kind: 'OLMAYDI', key: 'OLMAYDI|tf', name: 'Tax free филиали', departmentId: 'dT', coverage: 'NONE', positions: [{ row: 50, name: 'Mutaxassis', units: 1, salaryTiyin: S(3000000) }] },
];
assert.strictEqual(suggestShtatSection("Kadrlar bilan ishlash bo'limi", SHTAT).key, 'OLADI|kadr');
assert.strictEqual(suggestShtatSection('Axborot xizmat', SHTAT).key, 'OLADI|axb', 'qisqaroq — aniqroq');
assert.strictEqual(suggestShtatSection("Strategik rivojlantirish va yig'ma axborot taxlili sho'basi", SHTAT).key, 'OLADI|strat', "ko'proq mos so'z");
assert.strictEqual(suggestShtatSection('Buxoro viloyati', SHTAT).key, 'OLADI|vil');
assert.strictEqual(suggestShtatSection('Markaziy apparat', SHTAT), null);

// ── Oy ──
const base = {
  period: '2026-08',
  ved: [
    V("Kadrlar bilan ishlash bo'limi", 'Aliyev Sardor Baxtiyorovich', "Bo'lim boshlig'i", 5000000, 2000000),
    V("Kadrlar bilan ishlash bo'limi", 'Hudoyberdiyev Jasur Anvarovich', 'Bosh mutaxassis', 6000000, 2400000), // maoshdan ortiq (shtat 4 mln)
    V("Kadrlar bilan ishlash bo'limi", 'Karimova Madina', 'Bosh mutaxassis', 4000000, 1500000), // 2 nomzod — topilmadi; 2-xodim — birlikdan ortiq
    V("Strategik rivojlantirish va yig'ma axborot taxlili sho'basi", 'Sobirov Anvar', 'Bosh mutaxassis', 2000000, 800000, 3500000),
    V('Buxoro viloyati', 'Hududov Bekzod', 'Bosh mutaxassis', 3000000, 1200000),
    V('Markaziy apparat', 'Rahbarov Olim', 'Direktor', 9000000, 3600000),
    V('Axborot xizmat', 'Yangi Lavozimchi', 'Dizayner', 1000000, 400000),
  ],
  tarkib: rows,
  shtat: SHTAT,
  departments: [
    { id: 'dK', name: 'Kadrlar' },
    { id: 'dS', name: 'Strategiya' },
    { id: 'dA', name: 'Axborot xizmati' },
    { id: 'dT', name: 'Tax free' },
  ],
  income: new Map([['dK', BigInt(15000000 * 100)], ['dT', BigInt(99000000 * 100)]]),
  links: {},
  sectionMap: {},
  notes: {},
  toleranceTiyin: 100000n,
};
const m = computeMonth(base);
const L = Object.fromEntries(m.links.map((l) => [l.code, l]));
// 1) Tarkib
const it = Object.fromEntries(m.tarkib.items.map((x) => [x.fullName, x]));
assert.strictEqual(it['Aliyev Sardor Baxtiyorovich'].status, 'OK');
assert.strictEqual(it['Hudoyberdiyev Jasur Anvarovich'].status, 'OK', 'fuzzy moslandi, summa teng');
assert.strictEqual(it['Karimova Madina'].status, 'NOT_FOUND');
assert.strictEqual(it['Hududov Bekzod'].regional, true);
assert.deepStrictEqual(m.tarkib.tarkibOnly.map((x) => x.pinfl), ['30000000000002'], "tarkibda 40% bor, vedomostda yo'q");
assert.strictEqual(L.TARKIB.status, 'WARN');
// Qo'lda bog'lash → farq (ustama 1 500 000 vs 1 600 000)
const m2 = computeMonth({ ...base, links: { 'karimova madina': '30000000000002' } });
const k2 = m2.tarkib.items.find((x) => x.fullName === 'Karimova Madina');
assert.strictEqual(k2.how, 'LINK');
assert.strictEqual(k2.status, 'DIFF');
assert.strictEqual(k2.diffTiyin, String(100000 * 100));
assert.strictEqual(m2.tarkib.tarkibOnly.length, 0);
// Chegara: 100 000 so'mgacha — mos
assert.strictEqual(computeMonth({ ...base, links: { 'karimova madina': '30000000000002' }, toleranceTiyin: BigInt(100000 * 100) }).tarkib.items.find((x) => x.fullName === 'Karimova Madina').status, 'OK');
// 2) Shtat
const pos = Object.fromEntries(m.shtat.positions.map((p) => [p.key, p]));
assert.strictEqual(pos['OLADI|kadr:10'].status, 'OK');
assert.strictEqual(pos['OLADI|kadr:11'].heads, 2);
assert.strictEqual(pos['OLADI|kadr:11'].status, 'BOTH', '2 xodim > 1 birlik, 6 mln > 4 mln');
assert.strictEqual(pos['OLADI|strat:30'].status, 'OK', '0,5 birlik — 1 xodim mumkin');
assert.deepStrictEqual(m.shtat.noPosition.map((x) => x.fullName), ['Yangi Lavozimchi']);
assert.deepStrictEqual(m.shtat.sections.filter((s) => !s.shtatKey).map((s) => s.name), ['Markaziy apparat']);
assert.strictEqual(L.SHTAT.status, 'WARN');
// Bo'lim — qo'lda: Markaziy apparat → Kadrlar (sinov uchun) va «shtatda yo'q» tasdiqlash
assert.strictEqual(computeMonth({ ...base, sectionMap: { 'markaziy apparat': 'OLADI|kadr' } }).shtat.sections.find((s) => s.name === 'Markaziy apparat').mode, 'SAVED');
// 4) Qoplash: Kadrlar Oklad+40% (5+2 + 6+2,4 + 4+1,5 = 20,9 mln), Strategiya — to'liq (3,5 mln), Tax free — 3802 ga kirmaydi
const q = Object.fromEntries(m.qoplash.items.map((x) => [x.key, x]));
assert.strictEqual(q.dK.neededTiyin, String(20900000 * 100));
assert.strictEqual(q.dS.neededTiyin, String(3500000 * 100));
assert.strictEqual(q.dK.incomeTiyin, String(15000000 * 100));
assert.strictEqual(q.dK.diffTiyin, String(-5900000 * 100));
assert.strictEqual(q.dT.in3802, false);
assert.strictEqual(m.qoplash.otherIncomeTiyin, String(99000000 * 100), 'Tax free tushumi — alohida');
assert.strictEqual(m.qoplash.incomeTiyin, String(15000000 * 100));
assert.strictEqual(q['-:hudud'].neededTiyin, String(4200000 * 100), 'viloyat — hududlar');
assert.strictEqual(L.QOPLASH.status, 'WARN');
assert.match(L.QOPLASH.summary, /kamomad/);
// Izoh — tushuntirildi
const m3 = computeMonth({ ...base, notes: { 'QOPLASH|oy': 'ajratma sentabrda keladi' } });
assert.strictEqual(m3.links.find((l) => l.code === 'QOPLASH').status, 'OK');
assert.strictEqual(m3.links.find((l) => l.code === 'QOPLASH').explained, 1);
// Ma'lumot yo'q holatlari
const none = computeMonth({ ...base, tarkib: null, shtat: [], income: new Map() });
assert.deepStrictEqual(none.links.map((l) => l.status), ['NONE', 'NONE', 'NONE', 'NONE', 'LATER']);

// 3) Vedomost ↔ 23106: ta'til puli (qo'lga tegadigan — 80–100%), ish haqi bilan birga, topilmadi, hudud
const VT = (section, fullName, tatil, moddiy) => ({ section, fullName, position: 'Bosh mutaxassis', amounts: { OKLAD: S(1000000), TATIL: S(tatil), ...(moddiy ? { TATIL_MODDIY: S(moddiy) } : {}) }, totalTiyin: S(1000000 + tatil + (moddiy || 0)) });
const P = (pinfl, fullName, docDate, som, kind) => ({ pinfl, fullName, docDate, amountTiyin: BigInt(som * 100), kind });
const m3b = computeMonth({
  ...base,
  ved: [
    VT('Kadrlar bo‘limi', 'Aliyev Sardor Baxtiyorovich', 4000000, 1000000), // JShShIR orqali: 4,4 mln (88%) — to'langan
    VT('Kadrlar bo‘limi', 'Xudoyberdiyev Jasur Anvarovich', 3000000), // oynada 2 ta to'lov: shu oy 2,7 mln mos (iyuldagi — boshqa ta'til)
    VT('Kadrlar bo‘limi', 'Karimova Madina Rustamovna', 2000000), // faqat ish haqi o'tkazmasi
    VT('Kadrlar bo‘limi', 'Sobirov Anvar', 2000000), // hech narsa
    VT('Buxoro viloyati', 'Hududov Bekzod', 2000000), // hudud
    VT('Kadrlar bo‘limi', 'Kamolov Ulug‘bek', 2000000), // kam to'langan — farq
    V('Kadrlar bo‘limi', 'Tatilsiz Odam', 'Bosh mutaxassis', 1000000, 0),
  ],
  pay23106: [
    P('30000000000001', 'ALIYEV SARDOR BAXTIYOROVICH', '2026-08-05', 4400000, 'TATIL'),
    P('30000000000004', 'XUDOYBERDIYEV JASUR', '2026-07-03', 2600000, 'TATIL'),
    P('30000000000004', 'XUDOYBERDIYEV JASUR', '2026-08-10', 2700000, 'TATIL'),
    P('30000000000002', 'KARIMOVA MADINA', '2026-08-25', 9000000, 'ISH_HAQI'),
    P(null, 'HUDUDOV BEKZOD', '2026-08-25', 3000000, 'ISH_HAQI'),
    P(null, 'KAMOLOV ULUGBEK', '2026-08-12', 300000, 'MODDIY'),
  ],
});
const d3 = Object.fromEntries(m3b.d23106.items.map((x) => [x.fullName, x]));
assert.strictEqual(m3b.d23106.items.length, 6, "ta'tilsiz xodim — kirmaydi");
assert.strictEqual(d3['Aliyev Sardor Baxtiyorovich'].status, 'PAID');
assert.strictEqual(d3['Aliyev Sardor Baxtiyorovich'].how, 'PINFL');
assert.strictEqual(d3['Aliyev Sardor Baxtiyorovich'].ratio, 88);
assert.strictEqual(d3['Xudoyberdiyev Jasur Anvarovich'].status, 'PAID');
assert.deepStrictEqual(d3['Xudoyberdiyev Jasur Anvarovich'].paid.map((p) => p.docDate), ['2026-08-10'], 'shu oydagisi tanlandi');
assert.strictEqual(d3['Karimova Madina Rustamovna'].status, 'WITH_SALARY');
assert.strictEqual(d3['Sobirov Anvar'].status, 'NOT_PAID');
assert.strictEqual(d3['Hududov Bekzod'].status, 'REGIONAL', "hudud — faqat ism bo'yicha ish haqi: ishonchsiz");
assert.strictEqual(d3['Kamolov Ulug‘bek'].status, 'DIFF');
const L3 = m3b.links.find((l) => l.code === 'D23106');
assert.strictEqual(L3.status, 'WARN');
assert.strictEqual(L3.warn, 2, 'topilmadi + farq');
assert.strictEqual(computeMonth({ ...base, pay23106: [] }).links.find((l) => l.code === 'D23106').summary, "Vedomostda shu oy ta'til puli va moddiy yordam yo'q");
const m3n = computeMonth({ ...base, ved: [VT('Kadrlar bo‘limi', 'Sobirov Anvar', 2000000)], pay23106: [], notes: { 'D23106|sobirov anvar': 'naqd to‘langan' } });
assert.strictEqual(m3n.links.find((l) => l.code === 'D23106').status, 'OK');
assert.strictEqual(m3n.links.find((l) => l.code === 'D23106').explained, 1);

// ── Servis ──
(async () => {
  const db = fakeDb();
  const D = db.tables;
  D.user.push({ id: 'u1', fullName: 'Admin Test' });
  D.department.push({ id: 'dK', name: 'Kadrlar', code: 'K', index: 5, isActive: true, order: 1 });
  D.setting.push({ key: '3802.ved.index', value: { periods: { '2026-07': {}, '2026-08': {} } } });
  for (const p of ['2026-07', '2026-08'])
    D.setting.push({ key: `3802.ved.${p}`, value: { period: p, sections: [{ name: "Kadrlar bilan ishlash bo'limi", employees: [{ fullName: 'Aliyev Sardor Baxtiyorovich', position: 'Boshliq', amounts: { OKLAD: S(5000000), USTAMA_40: S(2000000) }, totalTiyin: S(7000000) }] }] } });
  D.salaryCompositionBatch.push({ id: 'b8', period: '2026-08', cancelledAt: null, createdAt: new Date() });
  D.salaryCompositionRow.push({ id: 'r1', batchId: 'b8', period: '2026-08', employeePinfl: '30000000000001', fullName: 'Aliyev Sardor Baxtiyorovich', totalTiyin: BigInt(7000000 * 100) });
  D.salaryCompositionItem.push({ id: 'i1', batchId: 'b8', rowId: 'r1', componentCode: 'OKLAD', amountTiyin: BigInt(5000000 * 100) }, { id: 'i2', batchId: 'b8', rowId: 'r1', componentCode: 'OKLAD_40', amountTiyin: BigInt(2000000 * 100) });
  D.income.push({ id: 'q1', period: '2026-08', categoryCode: 'QOMITA_5', segment: 'QOMITA', amountTiyin: BigInt(7000000 * 100), deletedAt: null });
  const audit = { async log() {} };
  const svc = new Nazorat3802Service(db.client, audit, new Shtat3802Service(db.client, audit));
  const o = await svc.overview();
  assert.deepStrictEqual(o.months.map((x) => x.period), ['2026-08', '2026-07']);
  const aug = o.months[0];
  assert.strictEqual(aug.links.find((l) => l.code === 'TARKIB').status, 'OK');
  assert.strictEqual(aug.links.find((l) => l.code === 'SHTAT').status, 'NONE');
  assert.strictEqual(aug.links.find((l) => l.code === 'QOPLASH').status, 'OK', 'kerak 7 mln = kelgan 7 mln');
  assert.strictEqual(o.months[1].links.find((l) => l.code === 'TARKIB').status, 'NONE', 'iyulda tarkib yo‘q');
  assert.strictEqual(aug.ytdBalanceTiyin, String(-7000000 * 100), 'iyulda kelmagan — yig‘ma kamomad');
  assert.strictEqual(o.toleranceTiyin, '100000');
  const d = await svc.detail('2026-08');
  assert.strictEqual(d.qoplash.items[0].ytdBalanceTiyin, String(-7000000 * 100));
  await assert.rejects(() => svc.detail('2026-09'), /qabul qilinmagan/);
  // Sozlamalar
  await svc.setConfig({ toleranceSom: '5000' }, 'u1');
  assert.strictEqual((await svc.overview()).toleranceTiyin, '500000');
  await assert.rejects(() => svc.setConfig({ toleranceSom: '-1' }, 'u1'), /Chegara/);
  await svc.setNote({ period: '2026-07', link: 'QOPLASH', item: 'oy', note: 'Iyul ajratmasi avgustda kelgan' }, 'u1');
  assert.strictEqual((await svc.overview()).months[1].links.find((l) => l.code === 'QOPLASH').status, 'OK');
  await svc.setNote({ period: '2026-07', link: 'QOPLASH', item: 'oy', note: '' }, 'u1');
  await assert.rejects(() => svc.setNote({ period: '2026-07', link: 'YOQ', item: 'x', note: 'a' }, 'u1'), /halqa/);
  await svc.setLink({ fullName: 'Boshqa Odam', pinfl: null }, 'u1');
  assert.strictEqual(D.setting.find((s) => s.key === '3802.nazorat.links').value['boshqa odam'], null);
  await assert.rejects(() => svc.setLink({ fullName: 'Boshqa Odam', pinfl: '30000000000099' }, 'u1'), /tarkibida/);
  await svc.setLink({ fullName: 'Boshqa Odam' }, 'u1');
  assert.ok(!('boshqa odam' in D.setting.find((s) => s.key === '3802.nazorat.links').value), 'bekor qilindi');
  await assert.rejects(() => svc.setSection({ section: 'Kadrlar', shtatKey: 'OLADI|yoq' }, 'u1'), /topilmadi/);
  await svc.setSection({ section: 'Markaziy apparat', shtatKey: null }, 'u1');
  const x = await svc.export('2026-08');
  assert.ok(x.buffer.subarray(0, 2).toString() === 'PK' && x.filename === '3802-nazorat-2026-08.xlsx');

  // ── Qo'mita pullarining sarfi: 3802 hovuzi va xizmat shartnomasi ──
  D.department.push({ id: 'dM', name: 'Marksheyder', code: 'M', index: 20, isActive: true, order: 2 });
  D.employee.push({ pinfl: '30000000000001', fullName: 'Aliyev Sardor Baxtiyorovich', departmentId: 'dK', isActive: true }, { pinfl: '30000000000005', fullName: 'Marksheyderov Olim', departmentId: 'dM', isActive: true });
  D.salaryCompositionRow.push({ id: 'r2', batchId: 'b8', period: '2026-08', employeePinfl: '30000000000005', fullName: 'Marksheyderov Olim', totalTiyin: BigInt(9000000 * 100) });
  D.income.push({ id: 'q2', period: '2026-08', categoryCode: 'QOMITA_20', segment: 'QOMITA', amountTiyin: BigInt(30000000 * 100), deletedAt: null });
  const ex = (id, o) => D.expense.push({ id, period: '2026-08', amountTiyin: BigInt(o.som * 100), categoryCode: o.cat, departmentId: o.dep ?? null, segment: o.seg ?? null, deletedAt: null });
  ex('x1', { som: 9000000, cat: 'PAYROLL_BASE', seg: 'MARKSHEYDER' });
  ex('x2', { som: 1000000, cat: 'VEHICLE_FUEL', seg: 'MARKSHEYDER' });
  ex('x3', { som: 8000000, cat: 'PAYROLL_BASE', dep: 'dK' });
  ex('x4', { som: 500000, cat: 'OFIS', dep: 'dX' }); // boshqa bo'lim — kirmaydi
  D.category.push({ code: 'PAYROLL_BASE', label: 'Asosiy ish haqi' }, { code: 'VEHICLE_FUEL', label: "Mashina: yoqilg'i" });
  const sf = await svc.sarf('2026-07', '2026-08');
  assert.deepStrictEqual(sf.vedMonths, ['2026-07', '2026-08']);
  // Hovuz: Kadrlar — kelgan 7 mln, qoplanishi kerak 2 oy × 7 mln = 14 mln
  assert.deepStrictEqual(sf.pool.units.map((u) => u.label), ['Kadrlar']);
  assert.strictEqual(sf.pool.incomeTiyin, String(7000000 * 100));
  assert.strictEqual(sf.pool.coveredTiyin, String(14000000 * 100));
  assert.strictEqual(sf.pool.balanceTiyin, String(-7000000 * 100));
  assert.deepStrictEqual(sf.pool.months.map((m) => m.balanceTiyin), [String(-7000000 * 100), String(-7000000 * 100)]);
  // Shartnoma: Marksheyder — kelgan 30 mln, sarf (yo'nalish xarajatlari) 10 mln
  const mk = sf.contracts.units[0];
  assert.strictEqual(mk.label, 'Marksheyder');
  assert.strictEqual(mk.segment, 'MARKSHEYDER');
  assert.strictEqual(mk.spendTiyin, String(10000000 * 100));
  assert.strictEqual(mk.fullBalanceTiyin, String(20000000 * 100));
  assert.deepStrictEqual(mk.categories.map((c) => c.label), ['Asosiy ish haqi', "Mashina: yoqilg'i"]);
  assert.strictEqual(sf.unassigned, null);
  // Bo'lim xodimlari: tarkib (hisoblangan) va 3802 qoplaydigan
  const ku = await svc.sarfUnit('dK', '2026-07', '2026-08');
  assert.strictEqual(ku.spendTiyin, String(8000000 * 100), "Kadrlar bo'limi xarajati (ma'lumot uchun)");
  assert.strictEqual(ku.employees.length, 1);
  assert.strictEqual(ku.employees[0].paidTiyin, String(7000000 * 100));
  assert.strictEqual(ku.employees[0].coveredTiyin, String(14000000 * 100), 'iyul (tarkibsiz, ism bo‘yicha) + avgust');
  const mu = await svc.sarfUnit('dM', '2026-07', '2026-08');
  assert.deepStrictEqual(mu.employees.map((e) => [e.fullName, e.paidTiyin, e.coveredTiyin]), [['Marksheyderov Olim', String(9000000 * 100), '0']]);
  await assert.rejects(() => svc.sarfUnit('dX', '2026-07', '2026-08'), /sarfida yo'q/);
  await assert.rejects(() => svc.sarf('2026-09', '2026-01'), /keyin/);
  console.log('OK t-nazorat-3802');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
