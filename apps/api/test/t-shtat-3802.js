// 3802 › Shtatlar: ikki toifa (oladiganlar / olmaydiganlar) alohida yuklanadi; shtat jadvalini o'qish (bo'limlar, lavozimlar,
// «Жами» qatorlari), bo'limni ilovadagi bo'limga bog'lash, qoplash qoidasi, shablon, «kimlar kiradi» (ish haqi tarkibi va
// Kadrlar ma'lumotnomasidagi lavozim bo'yicha). TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { Shtat3802Service, suggestDepartment, sectionKey, matchPosition } = require('../dist/modules/qomita/shtat-3802.service');
const { parseShtatWorkbook, pickShtatSheet, listKind } = require('../dist/modules/qomita/shtat-3802.parse');

const HEAD = ['№', 'Лавозимлар номи', 'Штат бирлиги', 'Тариф разряди', 'МҲТ тариф сеткаси', 'Рағбат. коефф.', 'Тариф коэфф.', 'Бир штат бирлиги лавозим маоши (сўм)', 'Рағбат-ш коэф. (сўм)', 'Жами штат бирлиги учун лавозим маоши (сўм)'];

/** Varaq: sarlavha (imzo chekuvchi bilan), bo'limlar → lavozimlar → «Жами:», oxirida — yuqori daraja jamisi */
function sheet(wb, name, subtitle, sections, opts = {}) {
  const ws = wb.addWorksheet(name);
  ws.getCell('B1').value = '"КЕЛИШИЛДИ"';
  ws.getCell('B4').value = '______________ Т.Синовов';
  ws.getCell('F4').value = '2. Бир йиллик меҳнатга ҳақ тўлаш жамғармаси 1 200 000 000 (Бир миллиард икки юз миллион) сўм';
  ws.getCell('F8').value = '________________ А.Тестов';
  ws.getCell('A12').value = subtitle;
  HEAD.forEach((h, i) => (ws.getCell(14, i + 1).value = h));
  let r = 15;
  let allUnits = 0;
  let allTotal = 0;
  for (const s of sections) {
    ws.getCell(r++, 1).value = s.title;
    let u = 0;
    let t = 0;
    s.positions.forEach((p, i) => {
      const total = p.units * (p.salary + p.bonus);
      ws.getRow(r++).values = [i + 1, p.name, p.units, '12', 2.15, 2, 4.3, p.salary, p.bonus, total];
      u += p.units;
      t += total;
    });
    if (!s.noSubtotal) ws.getRow(r++).values = [null, 'Жами:', s.badUnits ?? u, null, null, null, null, null, null, t];
    allUnits += u;
    allTotal += t;
  }
  if (opts.centerTotal) ws.getRow(r++).values = [null, 'Марказий аппарат бўйича жами:', allUnits, null, null, null, null, null, null, allTotal];
  ws.getRow(r++).values = ['Жами ходимлар бўйича', 'Жами ходимлар бўйича', allUnits, null, null, null, null, null, null, allTotal];
  ws.getRow(r + 1).values = ['Бир йиллик меҳнатга ҳақ тўлаш жамғармаси', null, null, null, null, null, null, null, null, allTotal * 12];
  return ws;
}

const LEAD = { title: '1.Раҳбарият', positions: [{ name: 'Директор', units: 1, salary: 7_000_000, bonus: 2_800_000 }, { name: 'Директор ўринбосари', units: 2, salary: 6_500_000, bonus: 2_600_000 }] };
const CALL = { title: '2.Солиқ хизматининг ягона ахборот-маслаҳат "Сall-markazi" бўлими', positions: [{ name: 'Бўлим бошлиғи', units: 1, salary: 6_000_000, bonus: 2_400_000 }, { name: 'Бўлим бошлиғи ўринбосари', units: 1, salary: 5_900_000, bonus: 2_360_000 }, { name: 'Бош мутахассис', units: 2, salary: 5_800_000, bonus: 2_320_000 }] };
const TECH = { title: '1. Техник ва хизмат кўрсатувчи ходимлар', positions: [{ name: 'Енгил автомобиль ҳайдовчиси', units: 2, salary: 1_700_000, bonus: 0 }, { name: 'Фаррош', units: 1, salary: 1_400_000, bonus: 0 }] };

async function buf(build) {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), originalname: 'shtat.xlsx' };
}
/** To'liq fayl (ikkala varaq) */
const full = (opts = {}) =>
  buf((wb) => {
    sheet(wb, 'Штат ', '2026 йил 01 сентябрь ҳолатига', [LEAD, CALL, TECH], { centerTotal: true });
    sheet(wb, '3802', '2026 йил 01 сентябрь ҳолатига', [LEAD, { ...CALL, ...(opts.badCall ? { badUnits: 9 } : {}), noSubtotal: true }]);
    sheet(wb, '3802- olmaydigan', '3802 олмайдиганлар', [TECH]);
    wb.addWorksheet('Izoh').getCell('A1').value = 'Bu varaqda shtat jadvali yo‘q';
  });

(async () => {
  // ── O'qish ──
  assert.deepStrictEqual(['Штат ', '3802', '3802- olmaydigan', 'Маркшейдер'].map(listKind), ['UMUMIY', 'OLADI', 'OLMAYDI', 'BOSHQA']);
  const f = await full();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(f.buffer);
  const sheets = parseShtatWorkbook(wb);
  assert.deepStrictEqual(sheets.map((s) => s.sheet), ['Штат', '3802', '3802- olmaydigan'], 'shtatsiz varaq olinmaydi');
  const shtat = sheets[0];
  assert.deepStrictEqual(shtat.sections.map((s) => [s.name, s.positions.length, s.units, s.ok]), [
    ['Раҳбарият', 2, 3, true],
    ['Солиқ хизматининг ягона ахборот-маслаҳат "Сall-markazi" бўлими', 3, 4, true],
    ['Техник ва хизмат кўрсатувчи ходимлар', 2, 3, true],
  ], '«Марказий аппарат бўйича жами» — lavozim emas');
  assert.strictEqual(shtat.annualFundTiyin, String(1_200_000_000 * 100));
  const dir = shtat.sections[0].positions[0];
  assert.deepStrictEqual([dir.salaryTiyin, dir.bonusTiyin, dir.totalTiyin], ['700000000', '280000000', '980000000']);
  assert.deepStrictEqual(sheets[1].sections.map((s) => [s.units, s.ok, s.fileUnits]), [[3, true, 3], [4, true, null]], 'varaq jamisi — bo‘lim tekshiruviga olinmaydi');
  assert.ok(!JSON.stringify(sheets).includes('Синовов') && !JSON.stringify(sheets).includes('Тестов'), 'imzo chekuvchilar saqlanmaydi');
  // Toifa varag'i: to'liq fayldan — o'z varag'i; alohida fayl (bitta varaq) — o'sha
  assert.strictEqual(pickShtatSheet(sheets, 'OLADI').sheet, '3802');
  assert.strictEqual(pickShtatSheet(sheets, 'OLMAYDI').sheet, '3802- olmaydigan');
  const single = pickShtatSheet([{ ...sheets[2], sheet: 'Mening jadvalim', kind: 'BOSHQA' }], 'OLADI');
  assert.deepStrictEqual([single.sheet, single.kind], ['Mening jadvalim', 'OLADI']);
  assert.throws(() => pickShtatSheet([sheets[0], { ...sheets[2], kind: 'BOSHQA' }], 'OLADI'), /varag'i topilmadi/);
  const bad = new ExcelJS.Workbook();
  sheet(bad, '3802', '', [{ ...LEAD, badUnits: 5 }]);
  const [b] = parseShtatWorkbook(bad);
  assert.deepStrictEqual([b.sections[0].ok, b.sections[0].fileUnits, b.sections[0].units], [false, 5, 3]);
  console.log('  ✓ shtat jadvalini o‘qish va toifa varag‘i');

  // ── Bog'lash taklifi va lavozim moslashtirish ──
  const deps = ['AUP', 'Call markaz', 'Marksheyder', 'Axborot xizmati', 'Yurist', 'Texnik xodimlar'].map((name, i) => ({ id: `d${i}`, name }));
  const sug = (s) => deps.find((d) => d.id === suggestDepartment(s, deps))?.name ?? null;
  assert.strictEqual(sug('Раҳбарият'), 'AUP');
  assert.strictEqual(sug('Солиқ хизматининг ягона ахборот-маслаҳат "Сall-markazi" бўлими'), 'Call markaz', 'aralash yozuv «Сall»');
  assert.strictEqual(sug('Юридик бюро'), 'Yurist');
  assert.strictEqual(sug('Товар(хизмат)ларнинг бозор нархини аниқлаш'), null);
  const pos = ['Бўлим бошлиғи', 'Бўлим бошлиғи ўринбосари', 'Бош мутахассис', 'Енгил автомобиль ҳайдовчиси', 'Ҳар хил ишларни бажарувчи техник', 'Бош юрисконсульт', 'Юрисконсульт'];
  const m = (p) => (matchPosition(p, pos) === null ? null : pos[matchPosition(p, pos)]);
  assert.strictEqual(m('Bosh mutaxassisi (0,5 stavka)'), 'Бош мутахассис');
  assert.strictEqual(m('Bo‘lim boshlig‘i'), 'Бўлим бошлиғи');
  assert.strictEqual(m('Bo‘lim boshlig‘i o‘rinbosari'), 'Бўлим бошлиғи ўринбосари', 'to‘liqrog‘i');
  assert.strictEqual(m('Haydovchisi'), 'Енгил автомобиль ҳайдовчиси', 'qisqa shakl');
  assert.strictEqual(m('Turli ishlarni bajaruvchi ishchi'), 'Ҳар хил ишларни бажарувчи техник');
  assert.strictEqual(m('Bosh yuriskonsulti'), 'Бош юрисконсульт');
  assert.strictEqual(m('Bosh hisobchi'), null, 'faqat «bosh» — moslik emas');
  assert.strictEqual(m('Yetakchi mutaxassisi'), null, 'boshqa daraja — moslik emas');
  assert.strictEqual(m('Boshlig‘i'), 'Бўлим бошлиғи', 'bitta so‘zli lavozim');
  assert.strictEqual(m('Kompyuterlarga xizmat ko‘rsatuvchi texnik'), null);
  console.log('  ✓ bo‘limga bog‘lash va lavozim moslashtirish');

  // ── Servis ──
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  deps.forEach((d, i) => T.department.push({ ...d, index: i + 1, order: i, isActive: true }));
  const svc = new Shtat3802Service(db.client, new AuditService(db.client));
  let v = await svc.view();
  assert.deepStrictEqual([v.OLADI, v.OLMAYDI], [null, null]);
  await assert.rejects(() => svc.analyze('BOSHQA', f), /Toifa noto/);
  const a = await svc.analyze('OLADI', f);
  assert.ok(!T.setting.some((s) => s.key.startsWith('3802.shtat')), 'ko‘rish — saqlamaydi');
  const call = a.sheet.sections[1];
  assert.deepStrictEqual([a.sheet.sheet, call.departmentName, call.mapping, call.coverage, call.coveredTiyin], ['3802', 'Call markaz', 'SUGGESTED', 'OKLAD_40', call.totalTiyin]);
  assert.strictEqual(a.summary.coveredMonthlyTiyin, a.sheet.totalTiyin);
  // Olmaydiganlar — alohida fayl (faqat o'z varag'i) ham bo'ladi
  const own = await buf((w) => sheet(w, 'Jadval', '3802 олмайдиганлар', [TECH]));
  const o = await svc.analyze('OLMAYDI', own);
  assert.deepStrictEqual([o.sheet.kind, o.sheet.sections[0].coverage, o.summary.coveredMonthlyTiyin], ['OLMAYDI', 'NONE', '0']);

  await svc.commit('OLADI', f, 'adm');
  v = await svc.view();
  assert.ok(v.OLADI && !v.OLMAYDI, 'faqat oladiganlar saqlandi');
  await svc.commit('OLMAYDI', own, 'adm');
  v = await svc.view();
  assert.strictEqual(v.OLMAYDI.sheet.sections[0].departmentName, 'Texnik xodimlar');
  await svc.setSection({ kind: 'OLADI', section: call.name, departmentId: 'd1', coverage: 'FULL' }, 'adm');
  await svc.setSection({ kind: 'OLADI', section: 'Раҳбарият', departmentId: 'd0', coverage: 'OKLAD_40' }, 'adm');
  await svc.setSection({ kind: 'OLMAYDI', section: TECH.title.replace(/^\d+\.\s*/, ''), departmentId: 'd5', coverage: 'FULL' }, 'adm');
  await assert.rejects(() => svc.setSection({ kind: 'OLADI', section: 'Раҳбарият', coverage: 'BARCHASI' }, 'adm'), /qoidasi noto/);
  await assert.rejects(() => svc.setSection({ kind: 'OLADI', section: 'Yo‘q bo‘lim', coverage: 'NONE' }, 'adm'), /avval jadvalni/);
  v = await svc.view();
  assert.deepStrictEqual(v.OLADI.sheet.sections.map((s) => [s.mapping, s.departmentName, s.coverage]), [['SAVED', 'AUP', 'OKLAD_40'], ['SAVED', 'Call markaz', 'FULL']]);
  assert.strictEqual(v.OLMAYDI.sheet.sections[0].coverage, 'NONE', 'olmaydiganlar — doim qoplanmaydi');
  // Qayta yuklash — sozlama nomi bo'yicha qoladi; boshqa toifaga tegilmaydi
  await svc.commit('OLADI', await full({ badCall: true }), 'adm');
  v = await svc.view();
  assert.deepStrictEqual(v.OLADI.sheet.sections.map((s) => s.coverage), ['OKLAD_40', 'FULL']);
  assert.ok(v.OLMAYDI, 'olmaydiganlar joyida');
  assert.notStrictEqual(sectionKey('OLADI', 'Раҳбарият'), sectionKey('OLMAYDI', 'Раҳбарият'), 'toifalar sozlamasi alohida');
  console.log('  ✓ servis: ikki toifa, ko‘rish, saqlash, bog‘lash, qoida, qayta yuklash');

  // ── Kimlar kiradi: ish haqi tarkibi (2026-09) + Kadrlar ma'lumotnomasi (lavozim) ──
  const P = (n) => String(30000000000000 + n);
  const people = [
    [1, 'Sinov Direktor', 'd0', 'Direktori'],
    [2, 'Sinov Orinbosar', 'd0', 'Direktori o‘rinbosari'],
    [3, 'Sinov Boshliq', 'd1', 'Bo‘lim boshlig‘i'],
    [4, 'Sinov Mutaxassis', 'd1', 'Bosh mutaxassisi'],
    [5, 'Sinov Ikkinchi', 'd1', 'Bosh mutaxassisi (0,5 stavka)'],
    [6, 'Sinov Texnik', 'd1', 'Kompyuterlarga xizmat ko‘rsatuvchi texnik'],
    [7, 'Sinov Haydovchi', 'd5', 'Haydovchisi'],
    [8, 'Sinov Lavozimsiz', 'd1', null],
    [9, 'Sinov Boshqa', 'd2', 'Bosh mutaxassisi'],
  ];
  for (const [i, name, dep] of people) T.employee.push({ pinfl: P(i), fullName: name, departmentId: dep, regionCode: 0, isActive: true });
  T.setting.push({ key: 'hr.sheet.J10', value: { code: 'J10', batchId: 'hb1', fileName: 'j10.xlsx', uploadedAt: '', uploadedBy: '', uploadedById: '', cols: ['tr', 'fio', 'pinfl', 'lavozim', 'tuzilma'], rows: people.map(([i, name, , p]) => [String(i), name, P(i), p, null]) } });
  T.salaryCompositionBatch.push({ id: 'cb1', period: '2026-09', cancelledAt: null, createdAt: new Date('2026-10-01') }, { id: 'cb0', period: '2026-08', cancelledAt: null, createdAt: new Date('2026-09-01') });
  people.forEach(([i, name]) => {
    T.salaryCompositionRow.push({ id: `r${i}`, batchId: 'cb1', period: '2026-09', employeePinfl: P(i), fullName: name, totalTiyin: 1_000_000_00n });
    T.salaryCompositionItem.push({ id: `o${i}`, batchId: 'cb1', rowId: `r${i}`, componentCode: 'OKLAD', amountTiyin: 600_000_00n }, { id: `u${i}`, batchId: 'cb1', rowId: `r${i}`, componentCode: 'OKLAD_40', amountTiyin: 240_000_00n }, { id: `k${i}`, batchId: 'cb1', rowId: `r${i}`, componentCode: 'KPI', amountTiyin: 10_000_00n });
  });
  const mem = await svc.members('OLADI');
  assert.deepStrictEqual([mem.period, mem.periods], ['2026-09', ['2026-09', '2026-08']], 'sukut — oxirgi oy');
  const lead = mem.sections.find((s) => s.name === 'Раҳбарият');
  assert.deepStrictEqual(lead.positions.map((p) => [p.name, p.units, p.members.map((x) => x.fullName)]), [['Директор', 1, ['Sinov Direktor']], ['Директор ўринбосари', 2, ['Sinov Orinbosar']]]);
  assert.deepStrictEqual([lead.positions[0].members[0].okladTiyin, lead.positions[0].members[0].ustamaTiyin], ['60000000', '24000000'], 'Oklad va 40% — tarkibdan');
  const c = mem.sections.find((s) => s.departmentName === 'Call markaz');
  assert.deepStrictEqual(c.positions.map((p) => p.members.length), [1, 0, 2]);
  assert.deepStrictEqual(c.others.map((x) => x.fullName).sort(), ['Sinov Lavozimsiz', 'Sinov Texnik'], 'lavozimi shtatda yo‘q — alohida');
  assert.deepStrictEqual([mem.totals.members, mem.totals.others, mem.noPosition], [5, 2, 1]);
  assert.ok(!JSON.stringify(mem).includes('Sinov Boshqa'), 'bog‘lanmagan bo‘lim xodimi — kirmaydi');
  const mo = await svc.members('OLMAYDI', '2026-09');
  assert.deepStrictEqual(mo.sections[0].positions.map((p) => p.members.map((x) => x.fullName)), [['Sinov Haydovchi'], []]);
  const empty = await svc.members('OLADI', '2026-08');
  assert.strictEqual(empty.totals.members, 0, 'shu oy tarkibida xodim yo‘q');
  console.log('  ✓ kimlar kiradi: bo‘lim va lavozim bo‘yicha, Oklad va 40%');

  // ── Shablon: yuklab olinadigan fayl — o'qiladi, bo'sh bo'lsa — tushunarli xato ──
  const t = await svc.template('OLADI');
  assert.match(t.filename, /oladiganlar-shablon\.xlsx$/);
  const tw = new ExcelJS.Workbook();
  await tw.xlsx.load(t.buffer);
  assert.deepStrictEqual(tw.worksheets.map((w) => w.name), ['3802', "Yo'riqnoma"]);
  assert.throws(() => parseShtatWorkbook(tw), /lavozimlari to'ldirilgan/);
  // Shablonga yozilgan jadval — o'qiladi
  const tws = tw.getWorksheet('3802');
  tws.getCell('A15').value = '1. Раҳбарият';
  tws.getRow(16).values = [1, 'Директор', 1, '15', null, null, null, 7_000_000, 2_800_000, 9_800_000];
  const filled = await svc.analyze('OLADI', { buffer: Buffer.from(await tw.xlsx.writeBuffer()), originalname: 'shablon.xlsx' });
  assert.deepStrictEqual([filled.sheet.sections.length, filled.sheet.units, filled.sheet.sections[0].departmentName], [1, 1, 'AUP']);
  assert.match((await svc.template('OLMAYDI')).filename, /olmaydiganlar/);
  assert.strictEqual(T.auditLog.filter((x) => x.entityType === 'shtat_3802').length, 6, 'har saqlash va sozlama — tarixda (3 yuklash, 3 sozlama)');
  console.log('  ✓ shablon');

  // O'chirish: shu toifa o'chadi, boshqasi va bo'lim bog'lashlari qoladi
  await svc.remove('OLMAYDI', 'adm');
  const afterRm = await svc.view();
  assert.strictEqual(afterRm.OLMAYDI, null);
  assert.ok(afterRm.OLADI, 'OLADI qoldi');
  assert.ok(T.setting.some((x) => x.key === '3802.shtat.map'), 'bog\'lashlar qoldi');
  await assert.rejects(() => svc.remove('OLMAYDI', 'adm'), /yuklanmagan/);
  await assert.rejects(() => svc.remove('BOSHQA', 'adm'));
  console.log('  ✓ o‘chirish');

  console.log('t-shtat-3802: OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
