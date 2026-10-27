// 23106 — aqlli aniqlash: har xil yozilish (ruscha / o'zbekcha, kirill / lotin, o↔a, x↔h, xatolar),
// ishonch darajasi, xodim ismi hisobga olinmasligi; saqlanganlarni qayta tahlil — avval sinov, keyin qo'llash.
// TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const ExcelJS = require('exceljs');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { UnitPayrollService } = require('../dist/modules/unit-payroll/unit-payroll.service');
const { Acc23106Service } = require('../dist/modules/acc-23106/acc23106.service');
const { smartKind, fold } = require('../dist/modules/acc-23106/acc23106.smart');

const CASES = {
  SAFAR: [
    '07.01.2026 йилдаги 00001-xs-son буйрукка асосан хизмат сафари учун бунак тўланмоқда сотруднику SINOV BIR',
    'камандировочный расходы', 'komandirovichniy xarajat', 'Командировочные за январь', 'Коммандировка Самарканд', 'камондировка', 'комондировочний',
    'kamandirovka', 'KOMANDIROVKA', 'командировачные', 'командировочн. расх.', 'xizmat safariga', 'Xizmt safari uchun', 'хизм. сафар харажатлари',
    'хизмат сафарига бўнак', 'xizmat safari xarajatlari', 'hizmat safari', 'хизмат сафар', 'суточные', 'sutochnie', 'yo‘l kira haqi', "yo'l xarajati",
    'служебная командировка', 'safar xarajatlari', 'сафар харажатлари учун', 'проездные расходы',
  ],
  MUKOFOT: ['мукофот пули туланди', 'mukafot puli', 'Mukofot', 'Премия за 1 квартал', 'premiya', 'премиальные', 'рағбатлантириш', "rag'batlantirish puli", 'ойлик мукофот', 'бонус', 'KPI буйича', 'pul mukofoti'],
  BAYRAM: ['байрам мукофоти', '8-март байрами муносабати билан', 'Navro‘z bayrami', 'праздничные', 'bayram puli', 'байрам пул', 'Янги йил байрами', 'xotin-qizlar kuni'],
  MODDIY: ['моддий ёрдам', 'Материальная помощь', 'мат.помощь', 'moddiy yordam puli', 'матпомощь', 'бир марталик ёрдам', 'modiy yordam'],
  TATIL: ['таътил пули', 'Отпускные', "ta'til puli", 'mehnat ta’tili uchun', 'компенсация за неиспользованный отпуск', 'tatil puli', 'таьтил'],
  KASALLIK: ['касаллик варақаси', 'Больничный лист', 'vaqtincha mehnatga layoqatsizlik nafaqasi', 'декретные', 'kasallik varaqasi', 'ҳомиладорлик нафақаси'],
  ISH_HAQI: ['январ ойи учун иш ҳақи', 'Заработная плата за январь', 'аванс', 'oylik maosh', 'зарплата', 'иш хаки', 'ish haqi', 'иш ҳақи аванс'],
  BOSHQA: ['Возврат средств', 'Ozuqa puli', 'перевод', 'xodimi SAFAROV SAFAR', 'Сафаров Анвар учун', 'oziq-ovqat', ''],
};

(async () => {
  // ── Bir xillash ──
  assert.strictEqual(fold('камандировочный'), fold('komandirovochniy'));
  assert.strictEqual(fold('тўланди'), fold('туланди'));
  assert.strictEqual(fold('ҳақи'), fold('haqi'));
  assert.strictEqual(fold('Коммандировка'), fold('komandirovka'));

  // ── Har xil yozilishlar ──
  let n = 0;
  for (const [kind, list] of Object.entries(CASES)) {
    for (const t of list) {
      const r = smartKind(t);
      assert.strictEqual(r.kind, kind, `«${t}» → ${kind} bo'lishi kerak, ${r.kind} chiqdi`);
      n += 1;
    }
  }
  assert.ok(n >= 80, `kamida 80 ta holat (${n})`);

  // ── Ishonch ──
  assert.strictEqual(smartKind('хизмат сафари').confidence, 'HIGH');
  assert.strictEqual(smartKind('мукопот').confidence, 'LOW', 'faqat xato bilan topilgan — tekshirish kerak');
  assert.strictEqual(smartKind('перевод').confidence, 'NONE');
  const mix = smartKind('таътил пули ва моддий ёрдам');
  assert.strictEqual(mix.confidence, 'HIGH', "ta'til + moddiy yordam — tabiiy juftlik");
  const both = smartKind('хизмат сафари ва касаллик варақаси');
  assert.deepStrictEqual([both.confidence, Boolean(both.alt)], ['LOW', true], "ikki xil guruh — tekshirish kerak");
  assert.ok(smartKind('камандировочный').hits.includes('камандировочный'), "topilgan so'z asl ko'rinishda");

  // ── Saqlanganlarni qayta tahlil: sinov → qo'llash ──
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  const audit = new AuditService(db.client);
  const svc = new Acc23106Service(db.client, audit, new UnitPayrollService(db.client, audit));
  const row = (no, purpose, kind) => ({ no, docDate: '2026-01-10', procDate: null, docNo: no, accountName: 'X', inn: '', mfo: '', debitTiyin: '10000000', purpose, kind, orderDate: null, orderNo: null, accrual: '2026-01', commentName: null, pinfl: null, fullName: null, matchBy: null });
  // Eski yuklash: eski usul «камандировочный» ni topa olmagan (BOSHQA), autoKind yo'q
  T.setting.push({
    key: 'acc23106.store',
    value: {
      months: { '2026-01': { batchId: 'b', fileName: 'eski.xlsx', savedAt: 'x', uploadedBy: 'x', rows: [row('1', 'камандировочный расходы', 'BOSHQA'), row('2', 'Отпускные', 'TATIL'), row('3', 'комондировочний', 'BOSHQA'), row('4', 'мукофот', 'MUKOFOT')] } },
      batches: [],
    },
  });
  let v = await svc.view('2026-01', '2026-01');
  assert.deepStrictEqual(v.rows.map((r) => r.kind), ['BOSHQA', 'TATIL', 'BOSHQA', 'MUKOFOT'], "qo'llanmaguncha saqlangan holat o'zgarmaydi");
  assert.deepStrictEqual([v.rows[0].smartKind, v.rows[0].confidence], ['SAFAR', 'LOW'], 'farq — tekshirish kerak, taklif bilan');
  const pv = await svc.reanalyzePreview();
  assert.deepStrictEqual([pv.rows, pv.changed, pv.moves.length, pv.moves[0].from, pv.moves[0].to, pv.moves[0].count], [4, 2, 1, 'BOSHQA', 'SAFAR', 2]);
  assert.strictEqual(JSON.stringify(T.setting.find((s) => s.key === 'acc23106.store').value.months['2026-01'].rows.map((r) => r.kind)), JSON.stringify(['BOSHQA', 'TATIL', 'BOSHQA', 'MUKOFOT']), 'sinov hech narsani yozmaydi');
  // Qo'lda belgilangan ustun qoladi
  await svc.setOverride({ keys: [v.rows[2].key], kind: 'MUKOFOT' }, 'adm');
  const ap = await svc.reanalyzeApply('adm');
  assert.strictEqual(ap.changed, 1);
  v = await svc.view('2026-01', '2026-01');
  assert.deepStrictEqual(v.rows.map((r) => [r.kind, r.kindSource]), [['SAFAR', 'AUTO'], ['TATIL', 'AUTO'], ['MUKOFOT', 'MANUAL'], ['MUKOFOT', 'AUTO']]);
  assert.strictEqual(v.rows[0].confidence, 'HIGH');
  assert.strictEqual((await svc.reanalyzePreview()).changed, 0, "qo'llangandan keyin farq yo'q");
  assert.ok(T.setting.find((s) => s.key === 'acc23106.store').value.months['2026-01'].rows.every((r) => r.autoKind), 'autoKind yozildi');

  // ── Yuklash bilan birga: eski oylar ham avtomatik yangilanadi (alohida qayta tahlil shart emas) ──
  {
    const db2 = fakeDb();
    db2.tables.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
    const au2 = new AuditService(db2.client);
    const s2 = new Acc23106Service(db2.client, au2, new UnitPayrollService(db2.client, au2));
    db2.tables.setting.push({ key: 'acc23106.store', value: { months: { '2026-01': { batchId: 'b', fileName: 'eski.xlsx', savedAt: 'x', uploadedBy: 'x', rows: [row('1', 'камандировочный расходы', 'BOSHQA'), row('2', 'комондировочний', 'BOSHQA'), row('3', 'мукофот', 'MUKOFOT')] } }, batches: [] } });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Page 1');
    ['№\nпп', 'Дата\nдокумента', 'Дата\nобработки', '№ док', 'Наименование счёта', 'ИНН', '№ счёта', 'МФО', 'Обороты по\nдебету', 'Обороты по\nкредиту', 'Назначение платежа'].forEach((h, i) => (ws.getCell(11, i + 1).value = h));
    [1, '10.02.2026', '10.02.2026', '9', 'X', '', '', '01158', 150000, 0, 'командировочные расходы'].forEach((v, j) => (ws.getCell(12, j + 1).value = v));
    const a3 = await s2.analyze({ buffer: Buffer.from(await wb.xlsx.writeBuffer()), originalname: 'fevral.xlsx' });
    assert.deepStrictEqual([a3.rows[0].kind, a3.reanalyze.changed, a3.reanalyze.moves[0].to], ['SAFAR', 2, 'SAFAR'], "tahlilda: eski oylarda nima o'zgarishi ko'rinadi");
    assert.deepStrictEqual(db2.tables.setting[0].value.months['2026-01'].rows.map((r) => r.kind), ['BOSHQA', 'BOSHQA', 'MUKOFOT'], "tahlil hech narsa yozmaydi");
    const c3 = await s2.commit({ fileName: 'fevral.xlsx', months: ['2026-02'], rows: a3.rows }, 'adm');
    assert.strictEqual(c3.reanalyzed.changed, 2);
    assert.deepStrictEqual((await s2.view('2026-01', '2026-02')).rows.map((r) => r.kind), ['SAFAR', 'SAFAR', 'MUKOFOT', 'SAFAR']);
  }

  console.log(`OK t-acc23106-smart (${n} ta yozilish)`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
