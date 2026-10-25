// 23106 › Xizmat safari — bo'limlarga yo'naltirish: ajratish, xodim joyini aniqlash («miya»), tekshirish,
// tasdiqlash (xarajat yozuvlari), bekor qilish; ko'chirma almashtirilsa / bekor qilinsa — tasdiqlar ham bekor.
// TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const ExcelJS = require('exceljs');
const fakeDb = require('./fakedb');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { UnitPayrollService } = require('../dist/modules/unit-payroll/unit-payroll.service');
const { Acc23106Service } = require('../dist/modules/acc-23106/acc23106.service');
const { Acc23106SafarService } = require('../dist/modules/acc-23106/acc23106.safar.service');

const P = { C: '73333333333333', E: '75555555555555', F: '76666666666666', G: '77777777777777', X: '79999999999999', K: '78888888888888' };
const ACC = '22618000900000000001';

async function statement(rows, name = '23106.xlsx') {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Page 1');
  ['№\nпп', 'Дата\nдокумента', 'Дата\nобработки', '№ док', 'Наименование счёта', 'ИНН', '№ счёта', 'МФО', 'Обороты по\nдебету', 'Обороты по\nкредиту', 'Назначение платежа'].forEach((h, i) => (ws.getCell(11, i + 1).value = h));
  rows.forEach((r, i) => {
    [i + 1, r.date, r.date, r.doc ?? String(500000 + i), r.acc ?? 'UZCARD DUO', r.inn, ACC, '01158', r.debit, 0, r.purpose].forEach((v, j) => (ws.getCell(12 + i, j + 1).value = v));
  });
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), originalname: name };
}

const safar = (d, who) => `${d} йилдаги 00001-xs-son буйрукка асосан хизмат сафари учун бунак тўланмоқда от 'NAMUNA' JAMIYATI сотруднику ${who}`;

(async () => {
  const db = fakeDb();
  const T = db.tables;
  T.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin' });
  T.department.push({ id: 'd1', name: 'AUP', index: 1, isActive: true });
  T.region.push({ code: 0, name: 'Markaz', isActive: true }, { code: 5, name: 'Namuna viloyati', isActive: true }, { code: 6, name: 'Sinov viloyati', isActive: true });
  T.district.push({ id: '5-1', name: 'Birinchi tuman', regionCode: 5, isActive: true }, { id: '6-2', name: 'Ikkinchi tuman', regionCode: 6, isActive: true });
  T.category.push({ code: 'PAYROLL_BASE', label: 'Ish haqi', parentCode: null, isLeaf: true, isActive: true });
  const emp = (pinfl, fullName, regionCode, departmentId = null, districtId = null) => T.employee.push({ pinfl, fullName, lastName: fullName.split(' ')[0], firstName: 'X', regionCode, departmentId, districtId, position: null, employmentType: 'SHTAT', isActive: true, hiredAt: null, firedAt: null });
  emp(P.C, 'Namuna Uchinchi Namunovich', 0, 'd1'); // Markaz › AUP
  emp(P.E, 'Sinov Beshinchi', 5, null, '5-1'); // Hudud › viloyat › tuman
  emp(P.G, 'Noma Lumov', null); // bazada bor, joyi noma'lum
  emp(P.K, 'Kochgan Kochmas', 0, 'd1'); // Markazda, lekin fevraldan Tax free'ga ko'chgan
  // Tax free ro'yxati (miya)
  T.setting.push({ key: 'unit.staff', value: { TAX_FREE: [{ pinfl: P.F, fullName: 'Taksfri Oltinchi', position: null, active: true, addedAt: '2026-01-01T00:00:00Z', source: 'MANUAL', leftAt: null }] } });

  const audit = new AuditService(db.client);
  const units = new UnitPayrollService(db.client, audit);
  const sf = new Acc23106SafarService(db.client, audit, units);
  const svc = new Acc23106Service(db.client, audit, units, sf);
  await units.addMove({ pinfl: P.K, unit: 'TAX_FREE', from: '2026-02', fullName: 'Kochgan Kochmas' }, 'adm');

  const rows = [
    { date: '08.01.2026', inn: P.C, debit: 2_000_000, purpose: safar('07.01.2026', 'NAMUNA UCHINCHI NAMUNOVICH') },
    { date: '09.01.2026', inn: '39999999990002', debit: 1_500_000, purpose: safar('08.01.2026', 'SINOV BESHINCHI') }, // ism bo'yicha
    { date: '10.01.2026', inn: P.F, debit: 700_000, purpose: "xizmat safari xarajatlari to'landi сотруднику TAKSFRI OLTINCHI" },
    { date: '11.01.2026', inn: P.G, debit: 300_000, purpose: safar('10.01.2026', 'NOMA LUMOV') },
    { date: '12.01.2026', inn: P.X, debit: 100_000, purpose: safar('11.01.2026', 'BEGONA BEGONOV') },
    { date: '13.01.2026', inn: P.C, debit: 9_000_000, purpose: "13.01.2026 даги 00003-son буйрукка асосан мукофот пули туланди сотруднику NAMUNA UCHINCHI NAMUNOVICH" }, // safar emas
    { date: '05.02.2026', inn: P.K, debit: 400_000, purpose: safar('04.02.2026', 'KOCHGAN KOCHMAS') }, // fevral — Tax free (ko'chish)
    { date: '06.02.2026', inn: P.C, debit: 250_000, purpose: safar('05.02.2026', 'NAMUNA UCHINCHI NAMUNOVICH') },
  ];
  const a = await svc.analyze(await statement(rows));
  await svc.commit({ fileName: a.fileName, months: ['2026-01', '2026-02'], rows: a.rows }, 'adm');

  // ── Ko'rish: faqat xizmat safari, joyi aniqlangan ──
  let v = await sf.view('2026-01', '2026-02');
  assert.strictEqual(v.rows.length, 7, 'mukofot olinmadi');
  const by = (pinfl, period = '2026-01') => v.rows.find((r) => r.pinfl === pinfl && r.period === period);
  assert.deepStrictEqual(by(P.C).place, { unit: 'CENTER', departmentId: 'd1', regionCode: 0, districtId: null, label: 'Markaz › AUP' });
  assert.deepStrictEqual(by(P.E).place, { unit: 'REGION', departmentId: null, regionCode: 5, districtId: '5-1', label: 'Hududlar › Namuna viloyati › Birinchi tuman' }, "ism bo'yicha topildi");
  assert.strictEqual(by(P.F).place.label, 'Tax free');
  assert.deepStrictEqual([by(P.G).place, by(P.G).issue], [null, 'NO_UNIT']);
  assert.deepStrictEqual([by(P.X).place, by(P.X).issue, by(P.X).fullName], [null, 'NOT_FOUND', null]);
  assert.strictEqual(by(P.K, '2026-02').place.unit, 'TAX_FREE', "fevraldagi joyi (ko'chish)");
  assert.strictEqual(by(P.C).advance, true, 'bunak — avans');
  assert.strictEqual(by(P.F).advance, false);
  assert.deepStrictEqual([v.summary.count, v.summary.readyCount, v.summary.issueCount, v.summary.postedCount], [7, 5, 2, 0]);
  assert.strictEqual(v.summary.totalTiyin, String((2_000_000 + 1_500_000 + 700_000 + 300_000 + 100_000 + 400_000 + 250_000) * 100));
  assert.ok(v.categories.options[0].label.includes('yangi modda'), "HM_SAFAR hali yo'q — yaratilishi aytiladi");
  assert.ok(!T.expense.length, "tasdiqlanmaguncha xarajat yo'q");
  assert.ok(!JSON.stringify(v).includes(ACC), "hisob raqami ko'rsatilmaydi");

  // ── Tasdiqlash ──
  const jan = v.rows.filter((r) => r.period === '2026-01');
  const key = (p) => ({ key: by(p).key, period: '2026-01' });
  await assert.rejects(sf.confirm({ items: [key(P.G)] }, 'adm'), /joyi aniqlanmagan/);
  await assert.rejects(sf.confirm({ items: [{ ...key(P.G), place: { unit: 'NOPE' } }] }, 'adm'), /Bo'lim noto'g'ri/);
  await assert.rejects(sf.confirm({ items: [{ ...key(P.G), place: { unit: 'REGION' } }] }, 'adm'), /viloyatni tanlang/i);
  await assert.rejects(sf.confirm({ items: [{ ...key(P.G), place: { unit: 'REGION', regionCode: 5, districtId: '6-2' } }] }, 'adm'), /tarkibida topilmadi/);
  await assert.rejects(sf.confirm({ items: [{ key: 'yoq', period: '2026-01' }] }, 'adm'), /topilmadi/);
  assert.ok(!T.expense.length, 'xatoda hech narsa yozilmadi');

  const c1 = await sf.confirm({ items: [key(P.C), key(P.E), key(P.F), { ...key(P.G), place: { unit: 'REGION', regionCode: 6, districtId: '6-2' } }] }, 'adm');
  assert.deepStrictEqual([c1.count, c1.totalTiyin, c1.units], [4, String((2_000_000 + 1_500_000 + 700_000 + 300_000) * 100), 4]);
  const live = () => T.expense.filter((e) => !e.deletedAt);
  assert.strictEqual(live().length, 4);
  const ex = (name) => live().find((e) => e.counterparty === name);
  assert.deepStrictEqual(
    (({ period, amountTiyin, categoryCode, segment, regionCode, departmentId, districtId, documentNo, source, section }) => ({ period, amountTiyin, categoryCode, segment, regionCode, departmentId, districtId, documentNo, source, section }))(ex('Namuna Uchinchi Namunovich')),
    { period: '2026-01', amountTiyin: 200000000n, categoryCode: 'HM_SAFAR', segment: null, regionCode: 0, departmentId: 'd1', districtId: null, documentNo: '500000', source: 'IMPORT', section: 'BOSHQA' },
  );
  assert.strictEqual(ex('Namuna Uchinchi Namunovich').date.toISOString(), '2026-01-08T07:00:00.000Z', "to'langan kun");
  assert.ok(ex('Namuna Uchinchi Namunovich').description.includes('buyruq 07.01.2026 № 00001-xs'));
  assert.deepStrictEqual([ex('Sinov Beshinchi').regionCode, ex('Sinov Beshinchi').districtId], [5, '5-1']);
  assert.deepStrictEqual([ex('Taksfri Oltinchi').segment, ex('Taksfri Oltinchi').regionCode], ['TAX_FREE', null]);
  assert.deepStrictEqual([ex('Noma Lumov').regionCode, ex('Noma Lumov').districtId], [6, '6-2'], "qo'lda tanlangan joy");
  assert.ok(T.category.find((c) => c.code === 'HM_SAFAR' && c.parentCode === 'HM_HUDUD' && c.isLeaf), 'modda yaratildi');
  assert.ok(T.category.find((c) => c.code === 'HM_HUDUD' && !c.isLeaf));
  await assert.rejects(sf.confirm({ items: [key(P.C)] }, 'adm'), /allaqachon tasdiqlangan/);

  v = await sf.view('2026-01', '2026-02');
  assert.deepStrictEqual([v.summary.postedCount, v.summary.readyCount, v.summary.issueCount], [4, 2, 1]);
  assert.strictEqual(by(P.G).posted.place.label, 'Hududlar › Sinov viloyati › Ikkinchi tuman');
  assert.strictEqual(by(P.G).posted.auto, false);
  assert.strictEqual(by(P.C).posted.auto, true);
  assert.ok(v.categories.options.some((o) => o.code === 'HM_SAFAR' && !o.label.includes('yangi')));
  assert.strictEqual(v.byUnit.find((u) => u.label === 'Markaz › AUP').postedTiyin, '200000000');
  assert.strictEqual(v.byUnit.find((u) => u.label === 'Markaz › AUP').pendingTiyin, '25000000', 'fevral — hali tasdiqlanmagan');
  void jan;

  // ── Fevral: alohida tasdiq ──
  const feb = v.rows.filter((r) => r.period === '2026-02' && r.place).map((r) => ({ key: r.key, period: r.period }));
  const c2 = await sf.confirm({ items: feb }, 'adm');
  assert.strictEqual(c2.postIds.length, 1);
  assert.strictEqual(ex('Kochgan Kochmas').segment, 'TAX_FREE');
  assert.strictEqual(live().length, 6);

  // ── Yanvar ko'chirmasi almashtirildi → yanvar tasdiqlari bekor, fevral qoladi ──
  const a2 = await svc.analyze(await statement(rows.slice(0, 2), 'yanvar-yangi.xlsx'));
  const r2 = await svc.commit({ fileName: a2.fileName, months: ['2026-01'], rows: a2.rows }, 'adm');
  assert.strictEqual(r2.safarDropped, 4);
  assert.deepStrictEqual(live().map((e) => e.period).sort(), ['2026-02', '2026-02']);
  v = await sf.view('2026-01', '2026-01');
  assert.deepStrictEqual([v.rows.length, v.summary.postedCount], [2, 0], 'qayta tasdiqlash kerak');
  assert.ok(v.posts.some((p) => p.status === 'CANCELLED' && p.cancelReason === "ko'chirma almashtirildi"));

  // ── Tasdiqni qo'lda bekor qilish ──
  const febPost = (await sf.view('2026-02', '2026-02')).posts.find((p) => p.status === 'POSTED');
  const cx = await sf.cancel(febPost.id, 'adm');
  assert.strictEqual(cx.expenses, 2);
  assert.strictEqual(live().length, 0);
  await assert.rejects(sf.cancel(febPost.id, 'adm'), /allaqachon/);

  // ── Ko'chirma bekor qilinsa — tasdiqlar ham ──
  v = await sf.view('2026-01', '2026-01');
  await sf.confirm({ items: v.rows.map((r) => ({ key: r.key, period: r.period })) }, 'adm');
  assert.strictEqual(live().length, 2);
  const lastBatch = (await svc.batches())[0];
  const cc = await svc.cancel(lastBatch.id, 'adm');
  assert.strictEqual(cc.safarDropped, 2);
  assert.strictEqual(live().length, 0);

  assert.ok(!JSON.stringify(T.setting).includes(ACC), "bazada hisob raqami yo'q");
  assert.ok(T.auditLog.some((l) => l.entityType === 'acc_23106_safar' && l.action === 'CREATE'));
  console.log('OK t-acc23106-safar');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
