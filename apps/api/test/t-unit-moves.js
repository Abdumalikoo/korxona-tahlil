// Bo'lim sahifasidan o'chirish (scope.unit) va xodimlarning bo'limlar o'rtasida ko'chishi («miya» tarixi). TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { PayrollService } = require('../dist/modules/payroll/payroll.service');
const { PeriodCloseService } = require('../dist/modules/regional-data/period-close.service');
const { QualityService } = require('../dist/modules/regional-data/quality.service');
const { BulkDeleteService } = require('../dist/modules/bulk-delete/bulk-delete.service');
const { DeletePasswordService } = require('../dist/modules/bulk-delete/delete-password.service');
const { FixedAssetsService } = require('../dist/modules/fixed-assets/fixed-assets.service');
const { UnitPayrollService, membership } = require('../dist/modules/unit-payroll/unit-payroll.service');

const db = fakeDb();
const T = db.tables;
T.region.push({ code: 0, name: 'Markaz', isActive: true }, { code: 3, name: 'Andijon viloyati', isActive: true });
T.user.push({ id: 'a1', role: 'ADMIN', fullName: 'Admin' }, { id: 'h1', role: 'HUDUDCHI', fullName: 'Hududchi' });
T.category.push({ code: 'PAYROLL_BASE', label: 'Ish haqi', parentCode: null, isLeaf: true, isActive: true });
const D = (s) => new Date(s + 'T07:00:00Z');
let n = 0;
const exp = (place, som, date = '2026-03-10') => T.expense.push({ id: `e${++n}`, date: D(date), period: date.slice(0, 7), regionCode: null, departmentId: null, segment: null, ...place, amountTiyin: BigInt(som * 100), source: 'MANUAL', section: 'DOIMIY', deletedAt: null, description: `X${n}`, categoryCode: 'C1', payrollBatchId: null });
const inc = (place, som) => T.income.push({ id: `i${++n}`, date: D('2026-03-10'), period: '2026-03', regionCode: null, departmentId: null, segment: null, ...place, amountTiyin: BigInt(som * 100), paidTiyin: 0n, source: 'MANUAL', section: 'DOIMIY', deletedAt: null, categoryCode: 'X' });
exp({ segment: 'TAX_FREE' }, 100); exp({ segment: 'TAX_FREE' }, 200, '2026-04-10'); exp({ segment: 'QOMITA' }, 50); exp({ regionCode: 0 }, 70); exp({ regionCode: 3 }, 30);
inc({ segment: 'TAX_FREE' }, 500); inc({ regionCode: 0 }, 900);

let pwSvc;
(async () => {
  const audit = new AuditService(db.client);
  const closes = new PeriodCloseService(db.client, audit, new QualityService(db.client));
  const del = new BulkDeleteService(db.client, new PayrollService(db.client), closes, audit, null, null, null, null, new FixedAssetsService(db.client, audit), (pwSvc = new DeletePasswordService(db.client, audit)));
  // Standart parol bilan o'chirib bo'lmaydi — sinov uchun yangi parol o'rnatiladi
  await pwSvc.change({ current: '3642', next: 'Sinov-Ochir-1' }, 'a1');
  const A = { id: 'a1', role: 'ADMIN' };
  // ── O'chirish: faqat shu bo'lim ──
  let p = await del.preview({ target: 'EXPENSE', mode: 'month', month: '2026-03', scope: { unit: 'TAX_FREE' } }, A);
  assert.deepStrictEqual([p.count, p.totalTiyin], [1, '10000']);
  p = await del.preview({ target: 'EXPENSE', mode: 'all', scope: { unit: 'TAX_FREE' } }, A);
  assert.strictEqual(p.count, 2);
  p = await del.preview({ target: 'EXPENSE', mode: 'all', scope: { unit: 'CENTER' } }, A);
  assert.strictEqual(p.count, 1);
  await assert.rejects(del.preview({ target: 'EXPENSE', mode: 'all', scope: { unit: 'YOQ' } }, A), /Bo'lim/);
  await assert.rejects(del.preview({ target: 'EXPENSE', mode: 'all', scope: { unit: 'TAX_FREE' } }, { id: 'h1', role: 'HUDUDCHI' }), /faqat hududlar/);
  await del.execute({ target: 'EXPENSE', mode: 'all', scope: { unit: 'TAX_FREE' }, password: 'Sinov-Ochir-1' }, A);
  assert.deepStrictEqual(T.expense.filter((e) => !e.deletedAt).map((e) => e.segment ?? e.regionCode), ['QOMITA', 0, 3]);
  await del.execute({ target: 'INCOME', mode: 'month', month: '2026-03', scope: { unit: 'TAX_FREE' } }, A);
  assert.deepStrictEqual(T.income.filter((e) => !e.deletedAt).map((e) => e.regionCode), [0]);

  // ── Ko'chishlar ──
  const up = new UnitPayrollService(db.client, audit);
  const E = (pinfl, fullName) => T.employee.push({ pinfl, fullName, isActive: true, regionCode: 0, departmentId: null, position: null });
  E('11111111111111', 'Aliyev Ali'); E('22222222222222', 'Botirova Barno');
  await up.addStaff('TAX_FREE', { pinfl: '11111111111111' }, 'a1');
  await up.addStaff('TAX_FREE', { pinfl: '22222222222222' }, 'a1');
  // Ali apreldan Markazga, iyuldan yana Tax free'ga
  await up.addMove({ pinfl: '11111111111111', unit: 'CENTER', from: '2026-04' }, 'a1');
  await up.addMove({ pinfl: '11111111111111', unit: 'TAX_FREE', from: '2026-07' }, 'a1');
  await assert.rejects(up.addMove({ pinfl: '11111111111111', unit: 'TAX_FREE', from: '2026-08' }, 'a1'), /allaqachon/);
  await assert.rejects(up.addMove({ pinfl: '1', unit: 'CENTER', from: '2026-04' }, 'a1'), /PINFL/);
  await assert.rejects(up.addMove({ pinfl: '11111111111111', unit: 'X', from: '2026-04' }, 'a1'), /Bo'limni/);
  const pins = async (p) => (await up.staffOf('TAX_FREE', p)).map((s) => s.pinfl).sort();
  assert.deepStrictEqual(await pins('2026-03'), ['11111111111111', '22222222222222']);
  assert.deepStrictEqual(await pins('2026-05'), ['22222222222222']);
  assert.deepStrictEqual(await pins('2026-07'), ['11111111111111', '22222222222222']);
  const st = await up.staff('TAX_FREE', '2026-05');
  assert.deepStrictEqual(st.away.map((a) => [a.pinfl, a.unit]), [['11111111111111', 'CENTER']]);
  // Barno — apreldan Qo'mitaga (ko'chib keladi)
  await up.addMove({ pinfl: '22222222222222', unit: 'QOMITA', from: '2026-04' }, 'a1');
  const q = await up.staffOf('QOMITA', '2026-04');
  assert.deepStrictEqual(q.map((s) => [s.pinfl, s.source]), [['22222222222222', 'MOVE']]);
  const mv = await up.moves({ unit: 'TAX_FREE' });
  assert.deepStrictEqual(mv.items.map((m) => [m.pinfl, m.from, m.unit, m.fromUnit]), [
    ['11111111111111', '2026-07', 'TAX_FREE', 'CENTER'],
    ['22222222222222', '2026-04', 'QOMITA', 'TAX_FREE'],
    ['11111111111111', '2026-04', 'CENTER', 'TAX_FREE'],
  ]);

  // Shablon (mart–may): Ali qatorida aprel va may — kulrang
  const t = await up.template('TAX_FREE', '2026-03', '2026-05');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(t.buffer);
  const ws = wb.worksheets[0];
  let aliRow = null;
  ws.eachRow((r, i) => { if (String(r.getCell(1).value) === '11111111111111') aliRow = i; });
  assert.ok(aliRow);
  const fill = (c) => ws.getCell(aliRow, c).fill?.fgColor?.argb;
  assert.deepStrictEqual([fill(3), fill(4), fill(5)], ['FFFFFBEB', 'FFE5E7EB', 'FFE5E7EB']);

  // Vedomost: may oyida Ali summa bilan — tahlilda «boshqa bo'limda», saqlanganda — maydan Tax free'ga ko'chadi
  const book = new ExcelJS.Workbook();
  const s1 = book.addWorksheet('Ish haqi');
  s1.addRow(['PINFL', 'Summa']); s1.addRow(['11111111111111', 5000000]);
  const file = { buffer: Buffer.from(await book.xlsx.writeBuffer()), originalname: 'may.xlsx' };
  const an = await up.analyze('TAX_FREE', '2026-05', file);
  assert.deepStrictEqual([an.rows[0].otherUnit, an.movedRows], ['CENTER', 1]);
  const c = await up.commit('TAX_FREE', '2026-05', { rows: an.rows, fileName: 'may.xlsx' }, false, 'a1');
  assert.strictEqual(c.movedIn, 1);
  assert.deepStrictEqual(await pins('2026-05'), ['11111111111111']);
  assert.strictEqual(membership(await up.allMoves())('11111111111111', '2026-04'), 'CENTER', "aprel o'zgarmaydi");
  // Ko'chishni bekor qilish
  const m = (await up.allMoves()).find((x) => x.from === '2026-05');
  assert.strictEqual(m.source, 'UPLOAD');
  await up.removeMove(m.id, 'a1');
  assert.deepStrictEqual(await pins('2026-05'), []);
  console.log('OK t-unit-moves');
})().catch((e) => { console.error(e); process.exit(1); });