// Yuklangan manba fayllar arxivi va «bog'liqliklar»: tahlilda fayl olinadi (PENDING), saqlanganda yuklash bilan bog'lanadi,
// bog'liqliklar darhol va keyin (yangi bog'liqlik / versiya) eski fayllarga ham o'zi qo'llanadi; shifrlash; bekor qilish;
// saqlanmaganlar tozalanadi. Ish haqi tarkibi: bo'lim ustuni saqlanmagan eski tarkibga — arxivdagi fayldan bo'limlar.
// TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const fakeDb = require('./fakedb');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-archive-'));
process.env.SOURCE_ARCHIVE_DIR = DIR;
process.env.APP_ENCRYPTION_KEY = 'test-kalit-faqat-sinov-uchun-0123456789abcdef';

const { AuditService } = require('../dist/modules/audit/audit.service');
const { PayrollService } = require('../dist/modules/payroll/payroll.service');
const { PayrollPlanService } = require('../dist/modules/payroll/payroll-plan.service');
const { UnitPayrollService } = require('../dist/modules/unit-payroll/unit-payroll.service');
const { SalaryCompositionService } = require('../dist/modules/salary-composition/salary-composition.service');
const { CompositionPlaceService } = require('../dist/modules/salary-composition/salary-composition.place');
const { CompositionSourceLinks } = require('../dist/modules/salary-composition/salary-composition.links');
const { SourceArchiveService } = require('../dist/modules/source-archive/source-archive.service');

const P = { A: '41111111111111', B: '42222222222222', C: '43333333333333' };
const PER = '2026-02';

async function tarkib(rows, name = 'tarkib-fevral.xlsx') {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Fevral');
  ws.addRow(['№', 'ПИНФЛ', 'ФИО', 'Hududi', 'Oklad', 'Jami']);
  rows.forEach((r, i) => ws.addRow([i + 1, r.pinfl, r.name, r.dept, r.sum, r.sum]));
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), originalname: name };
}

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  T.region.push({ code: 0, name: 'Markaz', isActive: true });
  T.department.push({ id: 'dA', name: 'AUP', index: 1, isActive: true }, { id: 'dC', name: 'Call markaz', index: 2, isActive: true }, { id: 'dT', name: 'Tax free', index: 3, isActive: true });
  const emp = (pinfl, fullName, departmentId) => T.employee.push({ pinfl, fullName, lastName: fullName.split(' ')[0], firstName: 'S', regionCode: 0, departmentId, districtId: null, position: null, employmentType: 'SHTAT', isActive: true, hiredAt: null, firedAt: null });
  emp(P.A, 'Alfa Kochgan', 'dT');
  emp(P.B, 'Beta Joyida', 'dA');
  emp(P.C, 'Gamma Joyida', 'dC');

  const audit = new AuditService(db.client);
  const units = new UnitPayrollService(db.client, audit);
  const pay = new PayrollService(db.client, undefined, units);
  const plan = new PayrollPlanService(db.client, pay, units, audit);
  const comp = new SalaryCompositionService(db.client, pay, units);
  await comp.onModuleInit();
  T.salaryComponent.forEach((x) => (x.isActive = true));
  const places = new CompositionPlaceService(db.client, audit, units, pay, plan);
  const archive = new SourceArchiveService(db.client);

  const f = await tarkib([
    { pinfl: P.A, name: 'Alfa Kochgan', dept: 'Call markaz', sum: 1_000_000 },
    { pinfl: P.B, name: 'Beta Joyida', dept: 'AUP', sum: 2_000_000 },
    { pinfl: P.C, name: 'Gamma Joyida', dept: 'Call markaz', sum: 3_000_000 },
  ]);
  const commitRows = (a) => a.rows.map((r) => ({ pinfl: r.pinfl, fullName: r.fullName, workedDays: null, rate: null, items: new Map(Object.entries(r.items).map(([k, v]) => [k, BigInt(v)])) }));

  // ── 1) «Eski» yuklash: bog'liqlik hali yo'q (arxiv bor, lekin bo'lim bog'liqligi ro'yxatdan o'tmagan) ──
  const a = await comp.analyze(PER, f);
  const held = await archive.hold('salary-composition', f, { userId: 'adm', periods: [PER], unit: null, sheet: a.sheetName });
  assert.strictEqual(held.status, 'PENDING');
  const c = await comp.commit({ period: PER, fileName: f.originalname, userId: 'adm', rows: commitRows(a) });
  const linked = await archive.link('salary-composition', { userId: 'adm', fileName: f.originalname, refId: c.batchId, periods: [PER], unit: null });
  assert.deepStrictEqual([linked.status, linked.refId, Object.keys(linked.links).length], ['LINKED', c.batchId, 0]);
  assert.strictEqual((await places.compare(PER, 'TAX_FREE')).hasTarkib, false, "bo'limlar hali yo'q");

  // Disk: shifrlangan (xlsx zip belgisi yo'q), o'qilganda — aynan o'sha fayl
  const onDisk = fs.readFileSync(path.join(DIR, 'salary-composition', `${linked.sha256}.bin`));
  assert.ok(!onDisk.includes(Buffer.from('PK\u0003\u0004')) && onDisk.subarray(0, 5).toString() === 'KTSF1', 'shifrlangan');
  assert.ok((await archive.read(linked)).equals(f.buffer));

  // ── 2) Yangi bog'liqlik qo'shildi (dastur yangilandi) → arxivdagi eski faylga o'zi qo'llanadi, qayta yuklashsiz ──
  new CompositionSourceLinks(db.client, comp, places, archive).onModuleInit();
  const bf = await archive.backfill();
  assert.deepStrictEqual([bf.files, bf.failed], [1, 0]);
  let cmp = await places.compare(PER, 'TAX_FREE');
  assert.ok(cmp.hasTarkib, 'eski tarkibdan bo‘limlar olindi');
  const ra = cmp.rows.find((r) => r.pinfl === P.A);
  assert.deepStrictEqual([ra.status, ra.manba.unit, ra.tarkib.departmentName], ['FARQ', 'TAX_FREE', 'Call markaz']);
  let e = (await archive.list('salary-composition')).entries[0];
  const V = archive.linkersOf('salary-composition')[0].version;
  assert.deepStrictEqual([e.links.depts.version, e.links.depts.ok], [V, true]);
  assert.match(e.links.depts.note, /3 xodim/);
  // Qayta ishga tushish — takrorlanmaydi
  assert.strictEqual((await archive.backfill()).files, 0);

  // Bog'liqlik versiyasi oshsa — yana qo'llanadi
  const l = archive.linkersOf('salary-composition')[0];
  archive.register({ ...l, version: V + 1 });
  assert.strictEqual((await archive.backfill()).files, 1);
  e = (await archive.list('salary-composition')).entries[0];
  assert.deepStrictEqual([e.links.depts.version, e.links.depts.note.startsWith("Bo'limlar bog'langan")], [V + 1, true]);
  archive.register(l);

  // ── 3) Yangi yuklash (bog'liqlik bor): saqlanganda darhol qo'llanadi ──
  await places.onCancel(PER, 'adm');
  await comp.cancel(c.batchId);
  assert.strictEqual(await archive.cancel('salary-composition', c.batchId), 1);
  const f2 = await tarkib([{ pinfl: P.A, name: 'Alfa Kochgan', dept: 'AUP', sum: 1_000_000 }, { pinfl: P.B, name: 'Beta Joyida', dept: 'AUP', sum: 2_000_000 }], 'tarkib-fevral-2.xlsx');
  const a2 = await comp.analyze(PER, f2);
  await archive.hold('salary-composition', f2, { userId: 'adm', periods: [PER], unit: null, sheet: a2.sheetName });
  const c2 = await comp.commit({ period: PER, fileName: f2.originalname, userId: 'adm', rows: commitRows(a2) });
  const l2 = await archive.link('salary-composition', { userId: 'adm', fileName: f2.originalname, refId: c2.batchId, periods: [PER], unit: null });
  assert.strictEqual(l2.links.depts?.ok ?? (await archive.find('salary-composition', { refId: c2.batchId })).links.depts.ok, true);
  cmp = await places.compare(PER, 'CENTER');
  assert.deepStrictEqual(cmp.rows.find((r) => r.pinfl === P.A).tarkib.departmentName, 'AUP');
  const list = (await archive.list()).entries;
  assert.deepStrictEqual(list.map((x) => x.status).sort(), ['CANCELLED', 'LINKED'], 'bekor qilingan fayl ham arxivda');
  // Bekor qilingan tarkib fayli — bog'liqlik qo'llanmaydi (joriy tarkibni buzmaydi)
  assert.strictEqual((await archive.backfill(undefined, true)).failed, 0);
  assert.strictEqual((await places.compare(PER, 'CENTER')).rows.find((r) => r.pinfl === P.A).tarkib.departmentName, 'AUP');

  // ── 3b) Saqlashda bo'limlar yozilmay qolgan (xato bo'lgan) va fayl bog'lanmagan — bo'lim sahifasi ochilganda o'zi tuzaladi ──
  const P3 = '2026-03';
  const f3 = await tarkib([{ pinfl: P.A, name: 'Alfa Kochgan', dept: 'Call markaz', sum: 1_000_000 }, { pinfl: P.C, name: 'Gamma Joyida', dept: 'Call markaz', sum: 3_000_000 }], 'aprel-oyi-uchun.xlsx');
  const a3 = await comp.analyze(P3, f3);
  await archive.hold('salary-composition', f3, { userId: 'adm', periods: [P3], unit: null, sheet: a3.sheetName });
  await comp.commit({ period: P3, fileName: f3.originalname, userId: 'adm', rows: commitRows(a3) });
  const placesA = new CompositionPlaceService(db.client, audit, units, pay, plan, archive);
  const c3 = await placesA.compare(P3, 'TAX_FREE');
  assert.deepStrictEqual([c3.hasTarkib, c3.source.archived], [true, true], 'arxivdagi fayldan bo‘limlar o‘qildi');
  assert.strictEqual(c3.rows.find((r) => r.pinfl === P.A).tarkib.departmentName, 'Call markaz');
  // Fayli arxivda yo'q tarkib — aniq aytiladi
  await comp.commit({ period: '2026-05', fileName: 'yoq.xlsx', userId: 'adm', rows: commitRows(a3) });
  const c5 = await placesA.compare('2026-05', 'TAX_FREE');
  assert.deepStrictEqual([c5.hasTarkib, c5.source.archived], [false, false]);

  // ── 4) Bitta fayldan bir necha yuklash (oylar) — har biriga bog'lanadi ──
  const fu = { buffer: Buffer.from('bolim vedomosti'), originalname: 'taxfree-yanvar-mart.xlsx' };
  await archive.hold('unit-payroll', fu, { userId: 'adm', periods: ['2026-01'], unit: 'TAX_FREE' });
  const u1 = await archive.link('unit-payroll', { userId: 'adm', fileName: fu.originalname, refId: 'b1', periods: ['2026-01'], unit: 'TAX_FREE' });
  const u2 = await archive.link('unit-payroll', { userId: 'adm', fileName: fu.originalname, refId: 'b2', periods: ['2026-02'], unit: 'TAX_FREE' });
  assert.deepStrictEqual([u1.refId, u2.refId, u1.sha256 === u2.sha256, u1.id !== u2.id], ['b1', 'b2', true, true]);
  assert.strictEqual((await archive.find('unit-payroll', { period: '2026-02', unit: 'TAX_FREE' })).refId, 'b2');
  // Boshqa bo'lim yoki boshqa foydalanuvchining tahlili bog'lanmaydi
  assert.strictEqual(await archive.link('unit-payroll', { userId: 'boshqa', fileName: 'yoq.xlsx', refId: 'b3', unit: 'TAX_FREE' }), null);

  // ── 5) Saqlanmagan tahlil 48 soatdan keyin tozalanadi (fayli ham) ──
  const fp = { buffer: Buffer.from('saqlanmagan tahlil'), originalname: 'qoralama.xlsx' };
  const h = await archive.hold('payroll', fp, { userId: 'adm', periods: [PER] });
  const key = 'source.archive.payroll';
  const row = T.setting.find((s) => s.key === key);
  row.value.entries.find((x) => x.id === h.id).at = new Date(Date.now() - 49 * 3600 * 1000).toISOString();
  await archive.hold('payroll', { buffer: Buffer.from('boshqa'), originalname: 'b.xlsx' }, { userId: 'adm' });
  const pending = T.setting.find((s) => s.key === key).value.entries;
  assert.ok(!pending.some((x) => x.id === h.id), "ro'yxatdan");
  assert.ok(!fs.existsSync(path.join(DIR, 'payroll', `${h.sha256}.bin`)), 'diskdan');
  // Ro'yxatda saqlanmaganlar ko'rinmaydi, yuklab olish — faqat saqlanganlar
  assert.ok(!(await archive.list('payroll')).entries.length);
  await assert.rejects(archive.get('payroll', pending[0].id), /topilmadi/);

  // Buzilgan fayl — aniqlanadi
  const ent = await archive.find('unit-payroll', { refId: 'b1' });
  fs.writeFileSync(path.join(DIR, 'unit-payroll', `${ent.sha256}.bin`), Buffer.from('buzilgan'));
  await assert.rejects(archive.read(ent), /buzilgan/);

  fs.rmSync(DIR, { recursive: true, force: true });
  console.log('OK t-source-archive');
})().catch((e) => {
  fs.rmSync(DIR, { recursive: true, force: true });
  console.error(e);
  process.exit(1);
});
