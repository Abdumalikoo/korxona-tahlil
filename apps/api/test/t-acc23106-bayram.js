// 23106 › Hudud xodimlari bayram pullari — Markaz hisobiga: ko'rib chiqish (hech narsa o'zgarmaydi), faqat hudud × SHTAT,
// ish haqidan oshmaydi, tasdiqlangach hudud ish haqidan ayirilib Markaz hisobiga (jami o'zgarmaydi), turi o'zgarsa /
// ko'chirma bekor qilinsa — tasdiq bekor va bayram hududga qaytadi, siyosat «ajratilmasin» desa — ajratilmaydi.
// TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { UnitPayrollService } = require('../dist/modules/unit-payroll/unit-payroll.service');
const { PayrollService } = require('../dist/modules/payroll/payroll.service');
const { Acc23106Service } = require('../dist/modules/acc-23106/acc23106.service');
const { Acc23106SafarService } = require('../dist/modules/acc-23106/acc23106.safar.service');
const { Acc23106BayramService } = require('../dist/modules/acc-23106/acc23106.bayram.service');

const P = { R1: '71111111111111', R2: '72222222222222', R3: '73333333333333', C1: '74444444444444', N1: '75555555555555' };
const so = (n) => BigInt(n) * 100n;

async function statement(rows, name = '23106.xlsx') {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Page 1');
  ['№\nпп', 'Дата\nдокумента', 'Дата\nобработки', '№ док', 'Наименование счёта', 'ИНН', '№ счёта', 'МФО', 'Обороты по\nдебету', 'Обороты по\nкредиту', 'Назначение платежа'].forEach((h, i) => (ws.getCell(11, i + 1).value = h));
  rows.forEach((r, i) => {
    [i + 1, r.date, r.date, String(700000 + i), 'UZCARD DUO', r.inn, '22618000900000000001', '01158', r.debit, 0, r.purpose].forEach((v, j) => (ws.getCell(12 + i, j + 1).value = v));
  });
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), originalname: name };
}

const bayram = (who) => `10.03.2026 даги 00015-son буйрукка асосан Навруз ва Ҳайит байрамлари учун мукофот пули от 'NAMUNA' JAMIYATI сотруднику ${who}`;

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  T.department.push({ id: 'd1', name: 'AUP', index: 1, isActive: true, order: 1 });
  T.region.push({ code: 0, name: 'Markaz', isActive: true }, { code: 5, name: 'Namuna viloyati', isActive: true }, { code: 6, name: 'Sinov viloyati', isActive: true });
  T.district.push({ id: '5-1', code: 1, name: 'Birinchi tuman', regionCode: 5, isActive: true }, { id: '6-2', code: 2, name: 'Ikkinchi tuman', regionCode: 6, isActive: true });
  T.category.push({ code: 'PAYROLL_BASE', label: 'Ish haqi', parentCode: null, isLeaf: true, isActive: true });
  const emp = (pinfl, fullName, regionCode, departmentId, districtId, employmentType = 'SHTAT') => T.employee.push({ pinfl, fullName, lastName: fullName.split(' ')[0], firstName: 'X', regionCode, departmentId, districtId, position: null, employmentType, isActive: true, hiredAt: null, firedAt: null });
  emp(P.R1, 'Hudud Birinchi', 5, null, '5-1');
  emp(P.R2, 'Hudud Ikkinchi', 6, null, '6-2');
  emp(P.R3, 'Shartnoma Uchinchi', 5, null, '5-1', 'SHARTNOMA');
  emp(P.C1, 'Markaz Tortinchi', 0, 'd1', null);
  emp(P.N1, 'Oyliksiz Beshinchi', 6, null, '6-2');
  // Mart ish haqi (soliq hisoboti): R1 5 mln, R2 300 ming (bayramdan kam), R3 1 mln, C1 4 mln; N1 — ish haqida yo'q
  T.payrollBatch.push({ id: 'b1', period: '2026-03', status: 'COMMITTED', scope: 'ALL', fileName: 'v.xlsx', uploadedById: 'adm' });
  const entry = (pinfl, amount) => ({ id: `pe${pinfl.slice(0, 2)}`, batchId: 'b1', employeePinfl: pinfl, period: '2026-03', baseTiyin: so(amount), bonusTiyin: 0n, totalTiyin: so(amount), deletedAt: null });
  T.payrollEntry.push(entry(P.R1, 5_000_000), entry(P.R2, 300_000), entry(P.R3, 1_000_000), entry(P.C1, 4_000_000));
  const pay = (id, regionCode, departmentId, amount) => ({ id, date: new Date('2026-03-31T07:00:00Z'), period: '2026-03', amountTiyin: so(amount), categoryCode: 'PAYROLL_BASE', departmentId, regionCode, segment: null, source: 'PAYROLL', payrollBatchId: 'b1', deletedAt: null });
  T.expense.push(pay('x5', 5, null, 6_000_000), pay('x6', 6, null, 300_000), pay('xc', 0, 'd1', 4_000_000));
  T.employeeLocation = [];
  const TOTAL = so(10_300_000);

  const audit = new AuditService(db.client);
  const units = new UnitPayrollService(db.client, audit);
  const payroll = new PayrollService(db.client, undefined, units);
  const sf = new Acc23106SafarService(db.client, audit, units);
  const bs = new Acc23106BayramService(db.client, audit, payroll);
  const svc = new Acc23106Service(db.client, audit, units, sf, bs);

  const rows = [
    { date: '12.03.2026', inn: P.R1, debit: 800_000, purpose: bayram('HUDUD BIRINCHI') },
    { date: '12.03.2026', inn: P.R2, debit: 400_000, purpose: bayram('HUDUD IKKINCHI') },
    { date: '12.03.2026', inn: P.R3, debit: 200_000, purpose: bayram('SHARTNOMA UCHINCHI') },
    { date: '12.03.2026', inn: P.C1, debit: 900_000, purpose: bayram('MARKAZ TORTINCHI') },
    { date: '12.03.2026', inn: P.N1, debit: 100_000, purpose: bayram('OYLIKSIZ BESHINCHI') },
    { date: '13.03.2026', inn: P.R1, debit: 3_000_000, purpose: "13.03.2026 даги 00016-son буйрукка асосан мукофот пули туланди сотруднику HUDUD BIRINCHI" }, // bayram emas
  ];
  const a = await svc.analyze(await statement(rows));
  assert.strictEqual(a.rows.filter((r) => r.kind === 'BAYRAM').length, 5, 'bayram to\'lovlari aniqlandi');
  await svc.commit({ fileName: a.fileName, months: ['2026-03'], rows: a.rows }, 'adm');

  const live = () => T.expense.filter((e) => e.payrollBatchId === 'b1' && !e.deletedAt);
  const sig = () => live().map((e) => `${e.categoryCode}|${e.regionCode}|${e.departmentId}|${e.amountTiyin}`).sort().join(';');
  const before = sig();

  // ── Ko'rib chiqish: hech narsa o'zgarmaydi; faqat hudud × SHTAT; ish haqidan oshmaydi ──
  let v = await bs.view('2026-01', '2026-09');
  assert.strictEqual(sig(), before, "ko'rib chiqishda xarajat o'zgarmadi");
  assert.strictEqual(v.policy.routed, true, 'standart siyosat — bayram Markazga');
  assert.strictEqual(v.months.length, 1);
  const m = v.months[0];
  assert.deepStrictEqual([m.period, m.count, m.people, m.centerCount, m.otherCount, m.notInPayroll, m.posted, m.changed], ['2026-03', 3, 3, 1, 1, 1, null, false]);
  assert.strictEqual(m.totalTiyin, String(so(1_300_000)), 'hudud × SHTAT: R1 + R2 + N1');
  assert.strictEqual(m.movableTiyin, String(so(800_000 + 300_000)), "R2 ish haqidan oshmaydi (300 ming), N1 ish haqida yo'q");
  const emps = v.regions.flatMap((r) => r.districts.flatMap((d) => d.employees.map((e) => [r.name, d.name, e.fullName, e.movableTiyin])));
  assert.deepStrictEqual(emps.sort(), [['Namuna viloyati', 'Birinchi tuman', 'Hudud Birinchi', String(so(800_000))], ['Sinov viloyati', 'Ikkinchi tuman', 'Hudud Ikkinchi', String(so(300_000))], ['Sinov viloyati', 'Ikkinchi tuman', 'Oyliksiz Beshinchi', '0']].sort());
  assert.deepStrictEqual(v.excluded.map((x) => x.reason), ['Asosiy shtatda emas (shartnoma)']);
  assert.strictEqual(v.summary.centerTiyin, String(so(900_000)), "Markaz xodimi — ma'lumot uchun, ajratilmaydi");

  // ── Tasdiqlash: hudud ish haqidan ayiriladi, Markaz hisobiga «Bayram pullari» (viloyat bilan), jami o'zgarmaydi ──
  const c = await bs.confirm({ periods: ['2026-03'] }, 'adm');
  assert.deepStrictEqual([c.count, c.totalTiyin, c.movedTiyin], [3, String(so(1_300_000)), String(so(1_100_000))]);
  const by = (cat) => live().filter((e) => e.categoryCode === cat).map((e) => [e.regionCode, e.departmentId ?? null, e.amountTiyin]).sort((x, y) => x[0] - y[0]);
  assert.deepStrictEqual(by('HM_BAYRAM'), [[5, null, so(800_000)], [6, null, so(300_000)]]);
  assert.deepStrictEqual(by('PAYROLL_BASE'), [[0, 'd1', so(4_000_000)], [5, null, so(5_200_000)]], "R2 ish haqi to'liq Markazga o'tdi (guruh 0)");
  assert.strictEqual(live().reduce((s, e) => s + e.amountTiyin, 0n), TOTAL, "jami o'zgarmadi");
  assert.ok(live().find((e) => e.categoryCode === 'HM_BAYRAM').description.includes('23106'), 'izohda manba');
  assert.ok(T.payrollEntry.find((e) => e.employeePinfl === P.C1).bonusTiyin === 0n, 'Markaz xodimiga tegilmadi');
  v = await bs.view('2026-03', '2026-03');
  assert.ok(v.months[0].posted && !v.months[0].changed, 'tasdiqlangan');
  assert.strictEqual(v.summary.postedTiyin, String(so(1_100_000)));
  await assert.rejects(bs.confirm({ periods: ['2026-02'] }, 'adm'), /bayram to'lovi yo'q/);

  // Takroriy qayta guruhlash — ikki marta yozilmaydi
  await payroll.regroup('2026-03');
  assert.strictEqual(live().reduce((s, e) => s + e.amountTiyin, 0n), TOTAL);
  assert.strictEqual(by('HM_BAYRAM').length, 2);

  // ── O'chirish: tasdiq butunlay olib tashlanadi, bayram hududga qaytadi; qayta tasdiqlash mumkin ──
  const bstore = () => T.setting.find((s) => s.key === 'acc23106.bayram').value;
  await assert.rejects(bs.remove({}, 'adm'), /tanlang/);
  await assert.rejects(bs.remove({ ids: ['yoq'] }, 'adm'), /topilmadi/);
  const del = await bs.remove({ ids: [v.months[0].posted.id] }, 'adm');
  assert.deepStrictEqual([del.removed, del.periods], [1, ['2026-03']]);
  assert.deepStrictEqual(by('HM_BAYRAM'), [], "o'chirildi — hududga qaytdi");
  assert.strictEqual(sig(), before, 'avvalgi holat');
  assert.ok(!bstore().posts.some((p) => p.status === 'POSTED'), "faol tasdiq yo'q");
  assert.strictEqual((await bs.view('2026-03', '2026-03')).months[0].posted, null);
  await bs.confirm({ periods: ['2026-03'] }, 'adm');
  assert.strictEqual(by('HM_BAYRAM').length, 2, 'qayta tasdiqlandi');
  const delAll = await bs.remove({ all: true }, 'adm');
  assert.deepStrictEqual(delAll.periods, ['2026-03']);
  assert.strictEqual(bstore().posts.length, 0, "hammasi o'chirildi (tarix bilan)");
  assert.strictEqual(sig(), before);
  await bs.confirm({ periods: ['2026-03'] }, 'adm');

  // ── Turi o'zgarsa (endi bayram emas) — tasdiq bekor, bayram hududga qaytadi ──
  const k1 = (await svc.view('2026-03', '2026-03')).rows.find((r) => r.pinfl === P.R1 && r.kind === 'BAYRAM').key;
  await svc.setOverride({ keys: [k1], kind: 'MUKOFOT' }, 'adm');
  assert.deepStrictEqual(by('HM_BAYRAM'), [], 'tasdiq bekor — hududga qaytdi');
  assert.strictEqual(sig(), before, 'avvalgi holat');
  v = await bs.view('2026-03', '2026-03');
  assert.strictEqual(v.months[0].posted, null);
  assert.strictEqual(v.months[0].count, 2, 'R1 endi bayram emas');
  await svc.setOverride({ keys: [k1], kind: null }, 'adm');

  // ── Qayta tasdiqlash, so'ng ko'chirma bekor qilinsa — tasdiq ham bekor ──
  await bs.confirm({ periods: ['2026-03'] }, 'adm');
  assert.strictEqual(by('HM_BAYRAM').length, 2);
  const batch = (await svc.batches())[0];
  await svc.cancel(batch.id, 'adm');
  assert.deepStrictEqual(by('HM_BAYRAM'), [], "ko'chirma bekor — bayram hududga qaytdi");
  assert.strictEqual(sig(), before);
  const store = T.setting.find((s) => s.key === 'acc23106.bayram').value;
  assert.ok(store.posts.every((p) => p.status === 'CANCELLED'), 'hamma tasdiqlar bekor');

  // ── Siyosat: bayram Markazga o'tadigan komponentlarda yo'q — tasdiqlansa ham ajratilmaydi ──
  const a2 = await svc.analyze(await statement(rows));
  await svc.commit({ fileName: a2.fileName, months: ['2026-03'], rows: a2.rows }, 'adm');
  T.setting.push({ key: 'expense.policy', value: { payrollComponents: [] } });
  v = await bs.view('2026-03', '2026-03');
  assert.strictEqual(v.policy.routed, false);
  const c2 = await bs.confirm({ periods: ['2026-03'] }, 'adm');
  assert.deepStrictEqual([c2.routed, c2.movedTiyin], [false, '0']);
  assert.strictEqual(sig(), before, "siyosat bo'yicha ajratilmadi");

  // Shaxsiy ma'lumot / hisob raqami ko'rinishda yo'q
  assert.ok(!JSON.stringify(v).includes('22618000900000000001'), "hisob raqami ko'rsatilmaydi");
  console.log("t-acc23106-bayram: OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
