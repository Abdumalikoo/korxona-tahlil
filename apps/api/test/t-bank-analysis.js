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
    row.values = [String(i + 1), r.d, r.pd ?? r.d, r.no ?? String(100 + i), r.name, r.inn, '20210000000000000001', '00014', r.out ?? 0, r.in ?? 0, r.p];
  });
  ws.getRow(12 + rows.length).values = ['', '', '', '', 'Итого', '', '', '', 0, 0, ''];
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), originalname: 'vypiska.xlsx' };
}

(async () => {
  // ── Qoidalar ──
  assert.strictEqual(R.purposeKey('Оплата за электроэнергию за январь 2026 г. по дог. №12 от 01.01.2025, НДС 12% 1200.00'), R.purposeKey('Оплата за электроэнергию за февраль 2026 г. по дог. №12 от 01.01.2025, НДС 12% 990.50'), 'oy, sana, summa — farq qilmaydi');
  assert.notStrictEqual(R.purposeKey('за услуги связи'), R.purposeKey('за электроэнергию'));
  // Shartnoma raqami — oylar bo'yicha bir xil, turli shartnomalar ajraladi; raqamsiz — null
  assert.strictEqual(R.contractRef('Интернет за май по дог. № 77/2 от 01.01.2025'), '77/2');
  assert.strictEqual(R.contractRef('Оплата по договору №ИН-45/2024 за июнь'), 'ИН-45/2024');
  assert.strictEqual(R.contractRef("Internet uchun 12-son shartnoma 45-А asosan"), '45-А');
  assert.strictEqual(R.contractRef('Оплата по договору от поставщика'), null);
  assert.strictEqual(R.contractRef('Оплата за электроэнергию за май'), null);
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

  // ── Turlar: tashkilot nomidagi «soliq» so'zi turini belgilamaydi; hisoblararo o'tkazma, depozit ──
  const ORG = "'SOLIQ-SERVIS' AKSIYADORLIK JAMIYATI";
  assert.strictEqual(R.kindOf('OUT', "00634 2026 yil yanvar oyi uchun oylik ish haqi to'landi.", ORG), 'ISH_HAQI');
  assert.strictEqual(R.kindOf('IN', "00642 Ikkilamchi hisob raqamdan asosiy hisob raqamga o'tkazma", ORG), 'ICHKI');
  assert.strictEqual(R.kindOf('IN', '00642 Переброска денежных средств', ORG), 'ICHKI');
  assert.strictEqual(R.kindOf('IN', "00642 Virtual kassa h/r dan asosiy hisob raqamga o'tkazma", ORG), 'ICHKI');
  assert.strictEqual(R.kindOf('OUT', "00622 shartnomaga asosan depozitga yo'naltirilgan mablag'", 'Bank AJ'), 'DEPOZIT');
  assert.strictEqual(R.kindOf('IN', '4001~202883501~Государственный налоговый комитет', 'Государственный налоговый комитет'), 'TUSHUM', 'kirim — soliq emas');
  assert.strictEqual(R.kindOf('OUT', 'Задолженность по Налог на доходы физических лиц', 'Казначейство'), 'SOLIQ');
  assert.strictEqual(R.kindOf('OUT', "rouming operatori to'lovi", 'AJ X'), 'ALOQA');

  // ── 2-bosqich: izoh, yo'naltirish (chiqim → xarajat, kirim → daromad), takror, bekor ──
  T.department.push({ id: 'dAUP', name: 'AUP', index: 1, isActive: true });
  T.region.push({ code: 0, name: 'Markaz', isActive: true }, { code: 7, name: 'Viloyat-7', isActive: true });
  T.category.push({ code: 'KOMM', label: 'Kommunal', parentCode: null, isLeaf: true, isActive: true, order: 1 }, { code: 'GRP', label: 'Guruh', parentCode: null, isLeaf: false, isActive: true, order: 2 });
  T.incomeCategory.push({ code: 'XIZ', label: 'Xizmat', isActive: true, order: 1 });
  const b2 = await svc.analyze(await file([
    { d: '10.05.2026', no: '501', name: 'ЭЛЕКТР', inn: '300000001', out: 2_000_000, p: 'Оплата за электроэнергию за май' },
    { d: '11.05.2026', no: '502', name: 'ЭЛЕКТР', inn: '300000001', out: 500_000, p: 'Оплата за электроэнергию за май 2026' },
    { d: '12.05.2026', no: '503', name: 'MIJOZ', inn: '300000003', in: 7_000_000, p: 'Оплата за услуги' },
  ], '20208000900100077777'));
  assert.ok(b2.groups.every((g) => Array.isArray(g.rowIds)), 'oldindan ko‘rish: har guruh qatorlari bilan');
  const elG = b2.groups.find((g) => g.kind === 'KOMMUNAL');
  assert.strictEqual(elG.rowIds.length, 2);
  assert.deepStrictEqual(elG.countByMonth, { '2026-05': 2 });
  const s2 = await svc.commit({ fileName: 'may.xlsx', account: 'Hisob …77777', months: ['2026-05'], rows: b2.rows }, 'adm');
  const ACC = s2.account;
  let grp = await svc.group(elG.key, '2026-05', '2026-05', ACC);
  assert.strictEqual(grp.rows.length, 2);
  const [e1, e2] = grp.rows;
  await svc.notes({ items: [{ account: ACC, rowId: e1.id, comment: 'AUP binosi elektr — may' }] }, 'adm');
  grp = await svc.group(elG.key, '2026-05', '2026-05', ACC);
  assert.strictEqual(grp.rows[0].note, 'AUP binosi elektr — may');

  // Shu sana va summada qo'lda kiritilgan xarajat bor → ogohlantiriladi
  T.expense.push({ id: 'old1', date: new Date('2026-05-11T12:00:00+05:00'), period: '2026-05', amountTiyin: so(500_000), categoryCode: 'KOMM', description: 'qo‘lda', source: 'MANUAL', deletedAt: null, createdById: 'adm' });
  const ck = await svc.check({ items: [{ account: ACC, rowId: e1.id }, { account: ACC, rowId: e2.id }] });
  assert.strictEqual(ck.duplicates.length, 1);
  assert.strictEqual(ck.duplicates[0].rowId, e2.id);
  const place = { unit: 'CENTER', departmentId: 'dAUP' };
  await assert.rejects(svc.route({ items: [{ account: ACC, rowId: e1.id }, { account: ACC, rowId: e2.id }], place, categoryCode: 'KOMM' }, 'adm'), /allaqachon bor/);
  await assert.rejects(svc.route({ items: [{ account: ACC, rowId: e1.id }], place, categoryCode: 'GRP' }, 'adm'), /ichki modda/);
  const rt = await svc.route({ items: [{ account: ACC, rowId: e1.id }, { account: ACC, rowId: e2.id }], place, categoryCode: 'KOMM', section: 'DOIMIY', description: 'Elektr energiya', skipDuplicates: true }, 'adm');
  assert.deepStrictEqual([rt.count, rt.skipped, rt.place], [1, 1, 'Markaz › AUP']);
  // Taklif (oldingi tanlov): o'xshash izoh — shu guruh; boshqa izoh, shu INN — kontragent; boshqa INN — yo'q
  {
    const sug = svc.suggester(await svc.store());
    const g = sug({ ...e1, id: 'new-june', purpose: 'Оплата за электроэнергию за июнь' });
    assert.deepStrictEqual([g.basis, g.place.departmentId, g.categoryCode, g.section], ['GROUP', 'dAUP', 'KOMM', 'DOIMIY']);
    assert.strictEqual(sug({ ...e1, purpose: 'Boshqa narsa uchun' }).basis, 'COUNTERPARTY');
    assert.strictEqual(sug({ ...e1, inn: '399999999', purpose: 'Оплата за электроэнергию за июнь' }), null, 'guruh kaliti INN bilan — boshqa INN, boshqa guruh, taklif yo‘q');
    // Shartnoma: shu raqam — CONTRACT; shu guruhda boshqa raqam — taxmin qilinmaydi
    const st = structuredClone(await svc.store()); // nusxa — saqlangan ma'lumotga tegmasin
    for (const a of Object.values(st.accounts)) for (const m of Object.values(a.months)) for (const r of m.rows) if (r.id === e1.id) r.purpose = 'Интернет за май по дог. №77 от 01.01.2025';
    const sc = svc.suggester(st);
    const c77 = sc({ ...e1, purpose: 'Интернет за июнь по дог. №77 от 01.01.2025' });
    assert.deepStrictEqual([c77.basis, c77.place.departmentId, c77.count], ['CONTRACT', 'dAUP', 1]);
    assert.strictEqual(sc({ ...e1, purpose: 'Интернет за июнь по дог. №78 от 01.03.2026' }), null, 'yangi shartnoma — boshqasining tanlovi qo‘yilmaydi');
    // Bir nechta to'lov: bir xil — o'sha, har xil — mixed
    const { commonSuggestion } = require('../dist/modules/bank-analysis/bank-analysis.service');
    assert.deepStrictEqual(commonSuggestion([c77, c77]).mixed, false);
    assert.deepStrictEqual([commonSuggestion([c77, null]).suggestion.basis, commonSuggestion([c77, null]).mixed], ['CONTRACT', true]);
    // Izoh mazmuni: bitta kontragent har xil ish qiladi — taklif izohi o'xshashiga qarab; hech biriga o'xshamasa va
    // kontragent har xil yo'naltirilgan bo'lsa — taxmin qilinmaydi (sun'iy nusxada shu kontragentning ijara to'lovi)
    const sx = structuredClone(await svc.store());
    const rows = sx.accounts[ACC].months['2026-05'].rows;
    rows.push({ ...rows.find((r) => r.id === e1.id), id: 'rent1', purpose: 'Аренда офисного помещения для филиала' });
    const p1 = sx.posts.find((p) => p.rowId === e1.id && p.status === 'POSTED');
    sx.posts.push({ ...p1, id: 'pRent', rowId: 'rent1', place: { unit: 'REGION', departmentId: null, regionCode: 7, districtId: null, label: 'Viloyat-7' }, categoryCode: 'RENT', categoryLabel: 'Ijara', section: 'DOIMIY' });
    const ss = svc.suggester(sx);
    const el = ss({ ...e1, id: 'n1', purpose: 'Электроэнергия за июнь' });
    assert.deepStrictEqual([el.basis, el.categoryCode, el.place.departmentId, el.score], ['SIMILAR', 'KOMM', 'dAUP', 100], 'qo‘shimcha boshqa — o‘zak bir xil');
    const rent = ss({ ...e1, id: 'n2', purpose: 'Аренда офисного помещения за июнь' });
    assert.deepStrictEqual([rent.basis, rent.categoryCode, rent.place.regionCode], ['SIMILAR', 'RENT', 7], 'ijara — kontragentning boshqa ishi');
    assert.ok(rent.score >= 45 && rent.score < 100 && rent.matched.includes('Аренда'), 'o‘xshashlik foizi va o‘xshagan izoh');
    assert.strictEqual(ss({ ...e1, id: 'n3', purpose: 'Ремонт кондиционера' }), null, 'o‘xshamaydi, kontragent har xil yo‘naltirilgan — taxmin yo‘q');
    assert.strictEqual(R.purposeTokens('Оплата за электроэнергию за май 2026').join(), 'электр');
  }
  const ex = T.expense.find((e) => e.id !== 'old1' && !e.deletedAt);
  assert.deepStrictEqual([String(ex.amountTiyin), ex.regionCode, ex.departmentId, ex.categoryCode, ex.description, ex.documentNo, ex.section], [s(2_000_000), 0, 'dAUP', 'KOMM', 'AUP binosi elektr — may', '501', 'DOIMIY'], 'izohingiz bilan, Markaz › AUP');
  // Bankdagi kontragent ma'lumoti saqlanadi: INN, MFO va asl to'lov maqsadi (izoh boshqacha bo'lsa ham)
  assert.deepStrictEqual([ex.counterpartyInn, ex.counterpartyMfo, ex.bankPurpose], ['300000001', '00014', 'Оплата за электроэнергию за май']);
  await assert.rejects(svc.route({ items: [{ account: ACC, rowId: e1.id }], place, categoryCode: 'KOMM' }, 'adm'), /allaqachon yo.naltirilgan/);
  // Izoh o'zgarsa — xarajat izohi ham
  await svc.notes({ items: [{ account: ACC, rowId: e1.id, comment: 'AUP elektr (tuzatildi)' }] }, 'adm');
  assert.strictEqual(ex.description, 'AUP elektr (tuzatildi)');
  // force — baribir yoziladi
  // Taklif (Markaz › AUP) ko'rsatilgan, foydalanuvchi boshqa joy tanladi — «o'zgartirilgan» bo'lib yoziladi (aniqlik statistikasi)
  const { suggestionCombo } = require('../dist/modules/bank-analysis/bank-analysis.service');
  const shownCombo = suggestionCombo({ place: { unit: 'CENTER', departmentId: 'dAUP', regionCode: 0, districtId: null }, categoryCode: 'KOMM', section: 'DOIMIY' });
  const rt2 = await svc.route({ items: [{ account: ACC, rowId: e2.id }], place: { unit: 'REGION', regionCode: 7 }, categoryCode: 'KOMM', force: true, suggested: { combo: shownCombo, basis: 'GROUP' } }, 'adm');
  assert.strictEqual(rt2.count, 1);
  const st1 = await svc.suggestionStats();
  assert.deepStrictEqual([st1.shown, st1.accepted, st1.byBasis.find((b) => b.basis === 'GROUP').shown], [1, 0, 1], 'taklif o‘zgartirildi');
  assert.strictEqual(st1.total - st1.shown, 1, 'birinchisi taklifsiz yo‘naltirilgan');
  assert.strictEqual(T.expense.find((e) => e.documentNo === '502').regionCode, 7);
  // Chiqim va kirim birga — rad; kirim → daromad
  const inG = (await svc.view('2026-05', '2026-05', ACC)).groups.find((g) => g.dir === 'IN');
  const inRow = (await svc.group(inG.key, '2026-05', '2026-05', ACC)).rows[0];
  await assert.rejects(svc.route({ items: [{ account: ACC, rowId: inRow.id }], place, categoryCode: 'KOMM' }, 'adm'), /Daromad turi/);
  const ri = await svc.route({ items: [{ account: ACC, rowId: inRow.id }], place: { unit: 'TAX_FREE' }, categoryCode: 'XIZ' }, 'adm');
  assert.strictEqual(ri.entryType, 'INCOME');
  const incE = T.income.find((x) => !x.deletedAt);
  assert.deepStrictEqual([String(incE.amountTiyin), String(incE.paidTiyin), incE.segment, incE.clientName], [s(7_000_000), s(7_000_000), 'TAX_FREE', 'MIJOZ']);
  let vv = await svc.view('2026-05', '2026-05', ACC);
  assert.strictEqual(vv.totals.posted.count, 3);
  assert.strictEqual(vv.groups.find((g) => g.kind === 'KOMMUNAL').postedCount, 2);
  // Bekor qilish — yozuv o'chadi
  await svc.unroute({ batch: ri.batch }, 'adm');
  assert.ok(incE.deletedAt, 'daromad o‘chirildi');
  // Kirim → hisobga olinmaydigan tushum (depozit): daromad yozuvi YO'Q, alohida ro'yxatda; bekor qilinsa — o'chadi
  const opts = await svc.options('IN');
  assert.deepStrictEqual(opts.categories.filter((c) => c.code.startsWith('EXCL:')).map((c) => c.code), ['EXCL:DEPOZIT', 'EXCL:USTAV_FONDI']);
  await assert.rejects(svc.route({ items: [{ account: ACC, rowId: inRow.id }], place, categoryCode: 'EXCL:YOQ' }, 'adm'), /Tur topilmadi/);
  await assert.rejects(svc.route({ items: [{ account: ACC, rowId: e1.id }], place, categoryCode: 'EXCL:DEPOZIT' }, 'adm'), /allaqachon yo.naltirilgan|faqat kirim/);
  const incBefore = T.income.length;
  const rx = await svc.route({ items: [{ account: ACC, rowId: inRow.id }], place, categoryCode: 'EXCL:DEPOZIT', description: 'depozitga' }, 'adm');
  assert.deepStrictEqual([rx.entryType, rx.count], ['EXCLUDED', 1]);
  assert.strictEqual(T.income.length, incBefore, 'daromad jadvaliga yozilmaydi');
  const exStore = () => T.setting.find((x) => x.key === 'excluded_income.items')?.value ?? [];
  assert.deepStrictEqual(exStore().map((x) => [x.kind, x.amountTiyin, x.source, x.counterparty]), [['DEPOZIT', s(7_000_000), 'BANK', 'MIJOZ']]);
  await assert.rejects(svc.route({ items: [{ account: ACC, rowId: inRow.id }], place, categoryCode: 'XIZ' }, 'adm'), /allaqachon yo.naltirilgan/);
  await svc.unroute({ batch: rx.batch }, 'adm');
  assert.deepStrictEqual(exStore(), [], 'bekor qilinsa — ro‘yxatdan o‘chadi');
  // Ro'yxatdan chiqarish (yo'naltirmasdan): yozuv yaratilmaydi; yo'naltirilganini chiqarib bo'lmaydi; chiqarilganini yo'naltirib bo'lmaydi
  const counts = () => [T.income.filter((x) => !x.deletedAt).length, T.expense.filter((x) => !x.deletedAt).length];
  const before = counts();
  await assert.rejects(svc.dismiss({ items: [{ account: ACC, rowId: e1.id }] }, 'adm'), /yo'naltirilgan — avval/);
  const dm = await svc.dismiss({ items: [{ account: ACC, rowId: inRow.id }], reason: ' avval qo‘lda kiritilgan ' }, 'adm');
  assert.deepStrictEqual([dm.count, dm.totalTiyin], [1, s(7_000_000)]);
  assert.strictEqual((await svc.dismiss({ items: [{ account: ACC, rowId: inRow.id }] }, 'adm')).count, 0, 'ikkinchi marta — o‘zgarmaydi');
  assert.deepStrictEqual(counts(), before, 'hech qanday yozuv yaratilmaydi / o‘chirilmaydi');
  const gIn = (await svc.view('2026-05', '2026-05', ACC)).groups.find((g) => g.key === inG.key);
  assert.deepStrictEqual([gIn.dismissedCount, gIn.openCount], [1, gIn.count - gIn.postedCount - 1]);
  assert.strictEqual((await svc.view('2026-05', '2026-05', ACC)).totals.dismissed, 1);
  const dRow = (await svc.group(inG.key, '2026-05', '2026-05', ACC)).rows.find((r) => r.id === inRow.id);
  assert.strictEqual(dRow.dismissed.reason, 'avval qo‘lda kiritilgan');
  await assert.rejects(svc.route({ items: [{ account: ACC, rowId: inRow.id }], place: { unit: 'TAX_FREE' }, categoryCode: 'XIZ' }, 'adm'), /ro'yxatdan chiqarilgan/);
  assert.strictEqual((await svc.undismiss({ items: [{ account: ACC, rowId: inRow.id }] }, 'adm')).count, 1);
  assert.strictEqual((await svc.group(inG.key, '2026-05', '2026-05', ACC)).rows.find((r) => r.id === inRow.id).dismissed, null);
  // Oy — ishlov sanasi bo'yicha (vipiskadagidek): hujjati aprel, bank mayda o'tkazgan → may
  const bp = await svc.analyze(await file([{ d: '30.04.2026', pd: '02.05.2026', no: '777', name: 'ТЕСТ МЧЖ', inn: '300000077', out: 1_000, p: 'Тест тўлов' }], '20208000900100055555'));
  await svc.commit({ fileName: 'apr.xlsx', account: 'Hisob …55555', months: ['2026-04'], rows: bp.rows }, 'adm');
  const accP = Object.keys(T.setting.find((x) => x.key === 'bank.analysis.store').value.accounts).find((k) => k.includes('55555'));
  const pr = (await svc.rowsList('2026-05', '2026-05', accP)).rows;
  assert.deepStrictEqual(pr.map((r) => [r.docNo, r.period]), [['777', '2026-05']], 'ishlov sanasi oyi');
  assert.strictEqual((await svc.rowsList('2026-04', '2026-04', accP)).rows.length, 0);
  // Nomma-nom: davrdagi hamma to'lov (guruhlarga bo'linmasdan), yo'nalish bo'yicha
  const nn = await svc.rowsList('2026-05', '2026-05', ACC);
  const vNow = await svc.view('2026-05', '2026-05', ACC);
  assert.strictEqual(nn.rows.length, vNow.totals.rows, 'hamma qator');
  assert.strictEqual((await svc.rowsList('2026-05', '2026-05', ACC, 'OUT')).rows.every((r) => r.dir === 'OUT'), true);
  assert.ok(nn.rows.every((r) => r.groupKey && 'post' in r && 'dismissed' in r));
  // Aniqlashtirish: ish ro'yxatidan alohida; yo'naltirilsa belgi o'zi olinadi; bekor qilinsa ham olinadi
  await assert.rejects(svc.clarify({ items: [{ account: ACC, rowId: e1.id }] }, 'adm'), /yo'naltirilgan/);
  const cl = await svc.clarify({ items: [{ account: ACC, rowId: inRow.id }], note: ' kimdan kelgani noma’lum ' }, 'adm');
  assert.strictEqual(cl.count, 1);
  const gC = (await svc.view('2026-05', '2026-05', ACC)).groups.find((g) => g.key === inG.key);
  assert.deepStrictEqual([gC.clarifyCount, gC.openCount], [1, gC.count - gC.postedCount - gC.dismissedCount - 1]);
  assert.strictEqual((await svc.view('2026-05', '2026-05', ACC)).totals.clarify, 1);
  const cRow = (await svc.rowsList('2026-05', '2026-05', ACC)).rows.find((r) => r.id === inRow.id);
  assert.strictEqual(cRow.clarify.reason, 'kimdan kelgani noma’lum');
  // «Aniqlashtirish» sahifasi (only=clarify): faqat aniqlashtirishdagi to'lov, guruhda — qolgan ish sifatida
  const vC = await svc.view('2026-05', '2026-05', ACC, 'clarify');
  assert.strictEqual(vC.totals.rows, 1);
  const gOnly = vC.groups.find((g) => g.key === inG.key);
  assert.deepStrictEqual([gOnly.count, gOnly.openCount, gOnly.clarifyCount], [1, 1, 0]);
  assert.deepStrictEqual((await svc.group(inG.key, '2026-05', '2026-05', ACC, 'clarify')).rows.map((r) => r.id), [inRow.id]);
  assert.strictEqual(counts().join(), before.join(), 'yozuv yaratilmaydi');
  await svc.dismiss({ items: [{ account: ACC, rowId: inRow.id }] }, 'adm');
  assert.strictEqual((await svc.rowsList('2026-05', '2026-05', ACC)).rows.find((r) => r.id === inRow.id).clarify, null, 'bekor qilinsa — aniqlashtirish olinadi');
  await svc.undismiss({ items: [{ account: ACC, rowId: inRow.id }] }, 'adm');
  await svc.clarify({ items: [{ account: ACC, rowId: inRow.id }] }, 'adm');
  assert.strictEqual((await svc.unclarify({ items: [{ account: ACC, rowId: inRow.id }] }, 'adm')).count, 1);
  await svc.clarify({ items: [{ account: ACC, rowId: inRow.id }] }, 'adm');
  const rc = await svc.route({ items: [{ account: ACC, rowId: inRow.id }], place: { unit: 'TAX_FREE' }, categoryCode: 'XIZ' }, 'adm');
  const afterRoute = (await svc.rowsList('2026-05', '2026-05', ACC)).rows.find((r) => r.id === inRow.id);
  assert.deepStrictEqual([Boolean(afterRoute.post), afterRoute.clarify], [true, null], 'yo‘naltirilgach — aniqlashtirish olinadi');
  await svc.unroute({ batch: rc.batch }, 'adm');
  // O'chirish: yo'naltirilganini emas; o'chirilgani tahlil va jamidan ketadi, hech qanday yozuvga tegmaydi
  await assert.rejects(svc.deleteRows({ items: [{ account: ACC, rowId: e1.id }] }, 'adm'), /yo'naltirilgan — avval/);
  const vBefore = await svc.view('2026-05', '2026-05', ACC);
  const del = await svc.deleteRows({ items: [{ account: ACC, rowId: inRow.id }] }, 'adm');
  assert.deepStrictEqual([del.count, del.totalTiyin], [1, s(7_000_000)]);
  const vAfter = await svc.view('2026-05', '2026-05', ACC);
  assert.strictEqual(vAfter.totals.rows, vBefore.totals.rows - 1);
  assert.strictEqual(BigInt(vAfter.totals.inTiyin), BigInt(vBefore.totals.inTiyin) - 700000000n);
  assert.deepStrictEqual(counts(), before, 'xarajat / daromad yozuvlariga tegmaydi');
  await assert.rejects(svc.deleteRows({ items: [{ account: ACC, rowId: inRow.id }] }, 'adm'), /topilmadi/);
  // Oy qayta yuklandi, 502 yo'q → uning xarajati o'chadi; 501 qoladi
  const b3 = await svc.analyze(await file([{ d: '10.05.2026', no: '501', name: 'ЭЛЕКТР', inn: '300000001', out: 2_000_000, p: 'Оплата за электроэнергию за май' }], '20208000900100077777'));
  const s3 = await svc.commit({ fileName: 'may2.xlsx', account: 'Hisob …77777', months: ['2026-05'], rows: b3.rows }, 'adm');
  assert.strictEqual(s3.droppedPosts, 1);
  assert.ok(T.expense.find((e) => e.documentNo === '502').deletedAt);
  assert.ok(!ex.deletedAt, 'o‘sha to‘lov — yo‘naltirish saqlanadi');
  // Ko'chirma bekor qilindi → qolgan xarajat ham o'chadi
  const c3 = await svc.cancel(s3.batchId, 'adm');
  assert.strictEqual(c3.droppedPosts, 1);
  assert.ok(ex.deletedAt);
  assert.ok(!T.expense.find((e) => e.id === 'old1').deletedAt, 'qo‘lda kiritilgan yozuvga tegilmadi');
  const hist = await svc.posts();
  assert.ok(hist.length >= 3 && hist.every((h) => h.live === 0));
  const op = await svc.options('OUT', 'CENTER');
  assert.deepStrictEqual(op.categories.map((c) => c.code), ['KOMM'], 'faqat ichki moddalar');

  // ── Guruh nomi va turi, bir martalik ──
  const b4 = await svc.analyze(await file([
    { d: '10.06.2026', no: '601', name: 'ЭЛЕКТР', inn: '300000001', out: 1_000_000, p: 'Оплата за электроэнергию за июнь' },
    { d: '10.07.2026', no: '701', name: 'ЭЛЕКТР', inn: '300000001', out: 1_100_000, p: 'Оплата за электроэнергию за июль' },
    { d: '10.08.2026', no: '801', name: 'ЭЛЕКТР', inn: '300000001', out: 1_200_000, p: 'Оплата за электроэнергию за август' },
    { d: '15.07.2026', no: '702', name: 'MEBEL MCHJ', inn: '300000020', out: 9_000_000, p: 'Оплата по договору №7 от 01.07.2026' },
    { d: '05.06.2026', no: '602', name: 'TA’MIR MCHJ', inn: '300000021', out: 400_000, p: 'Ремонт кондиционера' },
    { d: '05.08.2026', no: '802', name: 'TA’MIR MCHJ', inn: '300000021', out: 300_000, p: 'Ремонт кондиционера' },
  ], '20208000900100055555'));
  const s4 = await svc.commit({ fileName: 'jja.xlsx', account: 'Hisob …55555', months: ['2026-06', '2026-07', '2026-08'], rows: b4.rows }, 'adm');
  let v4 = await svc.view('2026-06', '2026-08', s4.account);
  const pat = (cp) => v4.groups.find((g) => g.counterparty === cp).pattern;
  assert.deepStrictEqual([pat('ЭЛЕКТР'), pat('MEBEL MCHJ'), pat('TA’MIR MCHJ')], ['REGULAR', 'ONCE', 'IRREGULAR']);
  const once = v4.totals.patterns.find((x) => x.dir === 'OUT' && x.pattern === 'ONCE');
  assert.deepStrictEqual([once.groups, once.totalTiyin], [1, s(9_000_000)]);
  const mebel = v4.groups.find((g) => g.counterparty === 'MEBEL MCHJ');
  assert.strictEqual(mebel.kind, 'BOSHQA');
  await svc.groupMeta({ key: mebel.key, name: 'Ofis mebeli (AUP)', kind: 'XARID' }, 'adm');
  v4 = await svc.view('2026-06', '2026-08', s4.account);
  const mebel2 = v4.groups.find((g) => g.key === mebel.key);
  assert.deepStrictEqual([mebel2.name, mebel2.kind, mebel2.kindEdited, mebel2.autoKind], ['Ofis mebeli (AUP)', 'XARID', true, 'BOSHQA']);
  assert.ok(v4.kinds.some((k) => k.kind === 'XARID' && k.totalTiyin === s(9_000_000)), 'turlar jamida yangi tur');
  await assert.rejects(svc.groupMeta({ key: mebel.key, name: 'x', kind: 'YOQ' }, 'adm'), /Tur/);
  // Yo'naltirishda izoh — guruh nomi
  const mrow = (await svc.group(mebel.key, '2026-06', '2026-08', s4.account)).rows[0];
  await svc.route({ items: [{ account: s4.account, rowId: mrow.id }], place: { unit: 'CENTER', departmentId: 'dAUP' }, categoryCode: 'KOMM', section: 'BOSHQA' }, 'adm');
  assert.strictEqual(T.expense.find((e) => e.documentNo === '702' && !e.deletedAt).description, 'Ofis mebeli (AUP)');
  // Keyingi yuklashda ham nom qo'llanadi (oldindan ko'rishda)
  const b5 = await svc.analyze(await file([{ d: '15.09.2026', no: '901', name: 'MEBEL MCHJ', inn: '300000020', out: 2_000_000, p: 'Оплата по договору №8 от 01.09.2026' }]));
  assert.strictEqual(b5.groups[0].name, 'Ofis mebeli (AUP)');
  // Nomni tozalash — avtomatikka qaytadi
  await svc.groupMeta({ key: mebel.key, name: '', kind: null }, 'adm');
  v4 = await svc.view('2026-06', '2026-08', s4.account);
  assert.deepStrictEqual([v4.groups.find((g) => g.key === mebel.key).name, v4.groups.find((g) => g.key === mebel.key).kind], [null, 'BOSHQA']);

  console.log('t-bank-analysis: OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
