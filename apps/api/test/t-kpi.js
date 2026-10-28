// KPI baholash: shablonlar (hujjatlardagidek — asosiy mezonlar jami 100), ball hisobi (daraja, bor/yo'q, har holat,
// holatlar soni, toifalar), rahbar faqat o'z bo'limi, saqlash, yuborish va qulf, qaytarish, yig'ma, Excel/PDF.
// TEST MA'LUMOTLARI SUN'IY (ismlar, JShShIR — o'ylab topilgan).
require('reflect-metadata');
const assert = require('assert');
const fakeDb = require('./fakedb');
const { KPI_TEMPLATES, templateOf, criterionPoints, cleanPicks, score } = require('../dist/modules/kpi/kpi.templates');
const { KpiService } = require('../dist/modules/kpi/kpi.service');

// ── Shablonlar ──
assert.deepStrictEqual(KPI_TEMPLATES.map((t) => t.key), ['MARKSHEYDER', 'TAX_FREE', 'AXBOROT']);
for (const t of KPI_TEMPLATES) {
  const bonus = t.criteria.filter((c) => c.kind === 'BONUS');
  assert.strictEqual(bonus.reduce((s, c) => s + c.max, 0), 100, `${t.key}: asosiy mezonlar jami 100`);
  assert.strictEqual(new Set(t.criteria.map((c) => c.id)).size, t.criteria.length, `${t.key}: id takrorlanmasin`);
  // Har darajali mezonda eng yuqori daraja = max
  for (const c of bonus.filter((c) => c.type === 'LEVEL')) assert.strictEqual(Math.max(...c.levels.map((l) => l.points)), c.max, `${c.id}: eng yuqori daraja`);
}
assert.deepStrictEqual(KPI_TEMPLATES.map((t) => [t.criteria.filter((c) => c.kind === 'BONUS').length, t.criteria.filter((c) => c.kind === 'PENALTY').length]), [[4, 3], [11, 5], [12, 8]]);

// ── Ball hisobi ──
const M = templateOf('MARKSHEYDER');
const T = templateOf('TAX_FREE');
const A = templateOf('AXBOROT');
const c = (t, id) => t.criteria.find((x) => x.id === id);
assert.strictEqual(criterionPoints(c(M, 'M2'), { level: 'l3' }), 10, "LEVEL: 5–10 ta o'lchov");
assert.strictEqual(criterionPoints(c(M, 'M2'), { level: 'yoq' }), 0);
assert.strictEqual(criterionPoints(c(M, 'M1'), { counts: { t1: 2, t2: 1, t3: 1 } }), 19, 'COUNT_TIERS: 2×2 + 5 + 10');
assert.strictEqual(criterionPoints(c(M, 'M1'), { counts: { t3: 5 } }), 30, 'COUNT_TIERS: eng ko‘pi 30');
assert.strictEqual(criterionPoints(c(M, 'MP1'), { on: true }), 10, 'FLAG');
assert.strictEqual(criterionPoints(c(T, 'TP1'), { count: 1 }), 7, 'COUNT_LEVELS: 1 ta — 7');
assert.strictEqual(criterionPoints(c(T, 'TP1'), { count: 3 }), 20);
assert.strictEqual(criterionPoints(c(T, 'TP1'), { count: 9 }), 30, '4 va ko‘p — 30');
assert.strictEqual(criterionPoints(c(T, 'TP2'), { count: 3 }), 10, 'PER_CASE: 3×5, eng ko‘pi 10');
assert.strictEqual(criterionPoints(c(A, 'AP1'), { count: 2 }), 20, 'PER_CASE cheklovsiz: 2×10');
assert.strictEqual(criterionPoints(c(A, 'A1'), { on: true }), 15);
// Tozalash: shablonda yo'q mezon, noto'g'ri daraja, manfiy son — olinmaydi; ball mijozdan olinmaydi
assert.deepStrictEqual(cleanPicks(M, { M2: { level: 'l4', points: 999 }, M3: { level: 'yoq' }, MP1: { on: true }, X: { on: true }, M1: { counts: { t1: -3, t2: 2 } } }), { M2: { level: 'l4' }, MP1: { on: true }, M1: { counts: { t2: 2 } } });
// Yakuniy: rag'batlantiruvchi − kamaytiruvchi, 0…100
const s1 = score(M, { M2: { level: 'l4' }, M3: { level: 'l4' }, MP1: { on: true } });
assert.deepStrictEqual([s1.bonus, s1.penalty, s1.total], [50, 10, 40]);
assert.strictEqual(score(A, { AP1: { count: 5 } }).total, 0, 'manfiy bo‘lmaydi');

// ── Servis ──
(async () => {
  const db = fakeDb();
  const D = db.tables;
  D.user.push({ id: 'adm', role: 'ADMIN', fullName: 'Admin Test' }, { id: 'h1', role: 'BOLIM_RAHBARI', fullName: 'Rahbar Marksheyder', loginCode: 'KP-0001', isActive: true }, { id: 'h2', role: 'BOLIM_RAHBARI', fullName: 'Rahbar Biriktirilmagan', loginCode: 'KP-0002', isActive: true }, { id: 'v', role: 'VIEWER', fullName: 'Kuzatuvchi' });
  D.department.push({ id: 'dM', name: 'Marksheyder', index: 20, isActive: true }, { id: 'dT', name: 'Tax free', index: 21, isActive: true }, { id: 'dA', name: 'Axborot xizmati', index: 17, isActive: true });
  D.employee.push(
    { pinfl: '30000000000001', fullName: 'Aliyev Sardor', position: 'Marksheyder', departmentId: 'dM', isActive: true, hiredAt: null, firedAt: null },
    { pinfl: '30000000000002', fullName: 'Karimov Botir', position: 'Marksheyder', departmentId: 'dM', isActive: true, hiredAt: new Date('2026-05-10'), firedAt: null },
    { pinfl: '30000000000003', fullName: 'Toshmatova Nigora', position: 'Mutaxassis', departmentId: 'dT', isActive: true, hiredAt: null, firedAt: null },
  );
  const svc = new KpiService(db.client, { async log() {} });
  const ADM = { id: 'adm', role: 'ADMIN' };
  const H1 = { id: 'h1', role: 'BOLIM_RAHBARI' };
  const H2 = { id: 'h2', role: 'BOLIM_RAHBARI' };
  const V = { id: 'v', role: 'VIEWER' };

  // Rahbar biriktirish
  await svc.setHead(ADM, { userId: 'h1', b: 'MARKSHEYDER' });
  await assert.rejects(() => svc.setHead(ADM, { userId: 'adm', b: 'MARKSHEYDER' }), /rahbari topilmadi/);
  const hl = await svc.headsList();
  assert.strictEqual(hl.users.length, 2, 'faqat bo‘lim rahbarlari');
  assert.strictEqual(hl.users.find((u) => u.id === 'h1').template, 'MARKSHEYDER');
  assert.strictEqual(hl.users.find((u) => u.id === 'h2').template, null);

  // Rahbar — faqat o'z bo'limi (boshqasini so'rasa ham)
  const me = await svc.me(H1, 'TAX_FREE');
  assert.strictEqual(me.template.key, 'MARKSHEYDER');
  assert.strictEqual(me.isHead, true);
  await assert.rejects(() => svc.me(H2), /biriktirilmagan/);
  const sh = await svc.sheet(H1, 'TAX_FREE', '2026-04');
  assert.strictEqual(sh.department, 'Marksheyder');
  assert.deepStrictEqual(sh.employees.map((e) => e.fullName), ['Aliyev Sardor'], "aprelda — Karimov hali ishga kirmagan");
  assert.deepStrictEqual((await svc.sheet(H1, undefined, '2026-05')).employees.map((e) => e.fullName), ['Aliyev Sardor', 'Karimov Botir']);

  // Baholash: ball serverda, mijozdan kelgan ball e'tiborsiz
  const r = await svc.save(H1, { period: '2026-05', pinfl: '30000000000001', picks: { M2: { level: 'l4', points: 999 }, M1: { counts: { t3: 1 } }, MP2: { on: true } } });
  assert.deepStrictEqual([r.evaluation.bonus, r.evaluation.penalty, r.evaluation.total], [30, 10, 20]);
  assert.deepStrictEqual(r.evaluation.points, { M1: 10, M2: 20, MP2: 10 });
  await assert.rejects(() => svc.save(H1, { period: '2026-05', pinfl: '30000000000003', picks: { M2: { level: 'l2' } } }), /topilmadi/, 'boshqa bo‘lim xodimi');
  await assert.rejects(() => svc.save(V, { b: 'MARKSHEYDER', period: '2026-05', pinfl: '30000000000001', picks: {} }), /huquqi/);
  // Hamma tanlov olib tashlansa — baho o'chadi
  await svc.save(H1, { period: '2026-05', pinfl: '30000000000002', picks: { M2: { level: 'l2' } } });
  await svc.save(H1, { period: '2026-05', pinfl: '30000000000002', picks: {} });
  assert.strictEqual((await svc.sheet(H1, undefined, '2026-05')).employees.find((e) => e.pinfl === '30000000000002').evaluation, null);

  // Administrator — har bo'lim (?b=)
  await svc.save(ADM, { b: 'TAX_FREE', period: '2026-05', pinfl: '30000000000003', picks: { T1: { level: 'l4' }, T2: { level: 'l6' }, TP1: { count: 2 } } });
  assert.strictEqual((await svc.sheet(ADM, 'TAX_FREE', '2026-05')).employees[0].evaluation.total, 18, '15 + 15 − 12');

  // Yuborish → qulf → qaytarish
  await assert.rejects(() => svc.submit(H1, { period: '2026-06' }), /baholanmagan/);
  assert.strictEqual((await svc.submit(H1, { period: '2026-05' })).submitted, 1);
  const locked = await svc.sheet(H1, undefined, '2026-05');
  assert.ok(locked.submittedAt && locked.canEdit === false);
  await assert.rejects(() => svc.save(H1, { period: '2026-05', pinfl: '30000000000001', picks: {} }), /yuborilgan/);
  await assert.rejects(() => svc.reopen(H1, { period: '2026-05' }), /administrator/);
  await svc.reopen(ADM, { b: 'MARKSHEYDER', period: '2026-05' });
  assert.strictEqual((await svc.sheet(H1, undefined, '2026-05')).canEdit, true);
  await svc.submit(H1, { period: '2026-05' });

  // Yig'ma va hisobot
  const sm = await svc.summary('2026-04', '2026-05');
  const md = sm.departments.find((d) => d.key === 'MARKSHEYDER');
  assert.deepStrictEqual(md.employees.map((e) => [e.fullName, e.months['2026-05'].total, e.months['2026-05'].submitted, e.average]), [['Aliyev Sardor', 20, true, 20]]);
  assert.deepStrictEqual(md.months.map((m) => Boolean(m.submittedAt)), [false, true]);
  assert.strictEqual(sm.departments.find((d) => d.key === 'TAX_FREE').employees[0].months['2026-05'].submitted, false);
  const x = await svc.export('2026-04', '2026-05', 'xlsx');
  const p = await svc.export('2026-04', '2026-05', 'pdf');
  assert.ok(x.buffer.subarray(0, 2).toString() === 'PK' && p.buffer.subarray(0, 4).toString() === '%PDF');
  await assert.rejects(() => svc.summary('2026-05', '2026-01'), /keyin/);

  // Rollar › KPI: bo'lim dashbordi
  D.user.find((u) => u.id === 'h1').mustChangePin = true;
  const ov = await svc.departmentOverview('MARKSHEYDER', '2026');
  assert.strictEqual(ov.department, 'Marksheyder');
  assert.deepStrictEqual(ov.heads.map((h) => h.id), ['h1']);
  const may = ov.months.find((m) => m.period === '2026-05');
  assert.deepStrictEqual([may.count, may.average, Boolean(may.submittedAt)], [1, 20, true]);
  assert.strictEqual(ov.last.period, '2026-05');
  assert.deepStrictEqual(ov.last.top.map((x) => [x.fullName, x.total]), [['Aliyev Sardor', 20]]);
  assert.ok(ov.activity.length >= 1 && ov.activity[0].fullName === 'Aliyev Sardor');
  assert.ok(ov.alerts.some((x) => /hali kirmagan/.test(x.text)), 'rahbar PIN o‘rnatmagan');
  assert.ok(ov.alerts.some((x) => /hali baholanmagan/.test(x.text)));
  const ax = await svc.departmentOverview('AXBOROT', '2026');
  assert.ok(ax.alerts.some((x) => /rahbar biriktirilmagan/.test(x.text)));
  await assert.rejects(() => svc.departmentOverview('YOQ'), /topilmadi/);

  // ── KPI demosini o'chirish: baholar, rahbar biriktirishlari, rahbarlar; boshqa sozlama va foydalanuvchiga tegmaydi ──
  D.setting.push({ key: 'roles.labels', value: { SKLADCHI: 'Omborchi' } });
  D.auditLog.push({ id: 'al1', userId: 'h1', action: 'LOGIN' }, { id: 'al2', userId: 'adm', action: 'UPDATE' });
  const info = await svc.demoInfo();
  assert.ok(info.months >= 1 && info.scored >= 1);
  assert.deepStrictEqual([info.heads, info.users, info.codes], [1, 2, ['KP-0001', 'KP-0002']]);
  await assert.rejects(() => svc.clearDemo(ADM, {}), /O'CHIRISH/, 'tasdiqsiz o‘chmaydi');
  await assert.rejects(() => svc.clearDemo(ADM, { confirm: 'ha' }), /O'CHIRISH/);
  const cleared = await svc.clearDemo(ADM, { confirm: "O'CHIRISH" });
  assert.deepStrictEqual([cleared.deleted, cleared.blocked], [2, 0]);
  assert.deepStrictEqual(D.setting.map((s) => s.key), ['roles.labels'], 'faqat kpi.* o‘chadi');
  assert.deepStrictEqual(D.user.map((u) => u.id), ['adm', 'v'], 'faqat bo‘lim rahbarlari o‘chadi');
  assert.deepStrictEqual(D.auditLog.map((a) => a.id), ['al2'], 'adminning yozuvlari qoladi');
  const after = await svc.demoInfo();
  assert.deepStrictEqual([after.months, after.scored, after.heads, after.users], [0, 0, 0, 0]);
  console.log('OK t-kpi');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
