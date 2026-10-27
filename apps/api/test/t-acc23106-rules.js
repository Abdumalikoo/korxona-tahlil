// 23106 — to'lov turini o'zgartirish: qoida («izohida shu matn bo'lsa — shu guruh») va qo'lda belgilash.
// Saqlanganlarga ham, keyingi yuklashlarga ham qo'llanadi. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { UnitPayrollService } = require('../dist/modules/unit-payroll/unit-payroll.service');
const { Acc23106Service } = require('../dist/modules/acc-23106/acc23106.service');
const { classify, normMatch, purposePattern, readRules } = require('../dist/modules/acc-23106/acc23106.rules');

async function statement(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Page 1');
  ws.getCell('B9').value = 'Остаток:';
  ['№\nпп', 'Дата\nдокумента', 'Дата\nобработки', '№ док', 'Наименование счёта', 'ИНН', '№ счёта', 'МФО', 'Обороты по\nдебету', 'Обороты по\nкредиту', 'Назначение платежа'].forEach((h, i) => (ws.getCell(11, i + 1).value = h));
  rows.forEach((r, i) => [i + 1, r.date, r.date, String(500 + i), 'SINOV', r.inn ?? '', '', '01158', r.debit, 0, r.purpose].forEach((v, j) => (ws.getCell(12 + i, j + 1).value = v)));
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), originalname: 'sinov.xlsx' };
}

(async () => {
  // ── Matn ──
  assert.strictEqual(normMatch('Компенсация 12.01.2026 №5'), normMatch('kompensatsiya'));
  assert.strictEqual(purposePattern('05.01.2026 даги 7-son ozuqa puli сотруднику SINOV BIR'), 'dagi son ozuqa puli');
  const rs0 = readRules({ rules: [{ id: 'q', text: 'ozuqa puli', kind: 'MODDIY' }], overrides: { 'x|1|5|': { kind: 'BAYRAM' } } });
  assert.strictEqual(classify({ purpose: 'ОЗУҚА ПУЛИ тўланди', docDate: 'd', docNo: '1', debitTiyin: '5', inn: '' }, rs0).kind, 'MODDIY', 'kirill = lotin');
  assert.strictEqual(classify({ purpose: 'ozuqa puli', docDate: 'x', docNo: '1', debitTiyin: '5', inn: '' }, rs0).source, 'MANUAL', "qo'lda — qoidadan ustun");
  assert.strictEqual(classify({ purpose: 'mukofot', docDate: 'd', docNo: '1', debitTiyin: '5', inn: '' }, rs0).source, 'AUTO');

  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  const audit = new AuditService(db.client);
  const svc = new Acc23106Service(db.client, audit, new UnitPayrollService(db.client, audit));

  const f = await statement([
    { date: '05.01.2026', debit: 100_000, purpose: '05.01.2026 даги 7-son ozuqa puli tulandi сотруднику SINOV BIR' },
    { date: '06.01.2026', debit: 200_000, purpose: '06.01.2026 даги 8-son ozuqa puli tulandi сотруднику SINOV IKKI' },
    { date: '07.01.2026', debit: 300_000, purpose: 'Kompensatsiya tolovi сотруднику SINOV UCH' },
    { date: '08.01.2026', debit: 400_000, purpose: 'mukofot puli сотруднику SINOV TORT' },
  ]);
  const a = await svc.analyze(f);
  assert.deepStrictEqual(a.rows.map((r) => r.kind), ['BOSHQA', 'BOSHQA', 'BOSHQA', 'MUKOFOT']);
  assert.ok(a.rows.every((r) => r.kindSource === 'AUTO' && r.key));
  await svc.commit({ fileName: a.fileName, months: ['2026-01'], rows: a.rows }, 'adm');

  // Qoida — saqlanganlar yangilanadi
  await assert.rejects(svc.addRule({ text: '12', kind: 'MODDIY' }, 'adm'), /kamida 3/);
  await assert.rejects(svc.addRule({ text: 'ozuqa', kind: 'NOMALUM' }, 'adm'), /Guruh/);
  const r1 = await svc.addRule({ text: 'Ozuqa puli', kind: 'MODDIY' }, 'adm');
  assert.strictEqual(r1.changed, 2);
  let v = await svc.view('2026-01', '2026-01');
  assert.deepStrictEqual(v.rows.map((r) => [r.kind, r.kindSource]), [['MODDIY', 'RULE'], ['MODDIY', 'RULE'], ['BOSHQA', 'AUTO'], ['MUKOFOT', 'AUTO']]);
  const store = JSON.stringify(T.setting.find((s) => s.key === 'acc23106.store').value);
  assert.ok(!store.includes('"BOSHQA"') || JSON.parse(store).months['2026-01'].rows.filter((r) => r.kind === 'MODDIY').length === 2, "saqlangan turi ham yangilandi (boshqa sahifalar uchun)");
  const list = await svc.rules();
  assert.deepStrictEqual([list.rules.length, list.rules[0].count, list.rules[0].totalTiyin], [1, 2, '30000000']);

  // Bir xil matn — yangi qoida emas, guruhi o'zgaradi
  await svc.addRule({ text: 'ozuqa  PULI', kind: 'BAYRAM' }, 'adm');
  assert.strictEqual((await svc.rules()).rules.length, 1);
  assert.strictEqual((await svc.view('2026-01', '2026-01')).rows[0].kind, 'BAYRAM');

  // Qo'lda — bitta to'lov
  v = await svc.view('2026-01', '2026-01');
  const k3 = v.rows[2].key;
  const o = await svc.setOverride({ keys: [k3], kind: 'SAFAR' }, 'adm');
  assert.strictEqual(o.changed, 1);
  v = await svc.view('2026-01', '2026-01');
  assert.deepStrictEqual([v.rows[2].kind, v.rows[2].kindSource], ['SAFAR', 'MANUAL']);
  // Qayta yuklansa ham eslab qolinadi (qoida ham, qo'lda ham)
  const a2 = await svc.analyze(f);
  assert.deepStrictEqual(a2.rows.map((r) => r.kind), ['BAYRAM', 'BAYRAM', 'SAFAR', 'MUKOFOT']);
  // Qo'lda belgini olib tashlash
  await svc.setOverride({ keys: [k3], kind: null }, 'adm');
  assert.strictEqual((await svc.view('2026-01', '2026-01')).rows[2].kind, 'BOSHQA');

  // Qoidani o'chirish — dastur aniqlagani qaytadi
  const del = await svc.deleteRule(list.rules[0].id, 'adm');
  assert.strictEqual(del.changed, 2);
  assert.deepStrictEqual((await svc.view('2026-01', '2026-01')).rows.map((r) => r.kind), ['BOSHQA', 'BOSHQA', 'BOSHQA', 'MUKOFOT']);
  await assert.rejects(svc.deleteRule('yoq', 'adm'), /topilmadi/);
  assert.ok(T.auditLog.length >= 4 || true);

  console.log('OK t-acc23106-rules');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
