// Haqiqiy PostgreSQL: xom SQL so'rovlari, tranzaksiyalar, bir vaqtdagi yozuvlar. TEST MA'LUMOTLARI SUN'IY.
const assert = require('assert');
const { D, seedBase, expectErr, run } = require('./harness');

const { IntegrityService } = D('modules/integrity/integrity.service');
const { EconData } = D('modules/econ/econ.data');
const { ReconcileService } = D('modules/reports/reconcile.service');
const { AuditService } = D('modules/audit/audit.service');
const { AuthService } = D('modules/auth/auth.service');
const { PurchasesService } = D('modules/purchases/purchases.service');
const { UnitPayrollService } = D('modules/unit-payroll/unit-payroll.service');
const { writePolicy, readPolicy } = D('modules/expense-policy/policy.util');
const { runExclusive } = D('common/locks');
const { SerializeWritesInterceptor } = D('common/interceptors/serialize-writes.interceptor');
const { UnitPayrollController } = D('modules/unit-payroll/unit-payroll.controller');
const { PayrollService } = D('modules/payroll/payroll.service');
const { PeriodCloseService } = D('modules/regional-data/period-close.service');
const { QualityService } = D('modules/regional-data/quality.service');
const { BulkDeleteService } = D('modules/bulk-delete/bulk-delete.service');
const { DeletePasswordService } = D('modules/bulk-delete/delete-password.service');
const { FixedAssetsService } = D('modules/fixed-assets/fixed-assets.service');
const { JwtService } = require('@nestjs/jwt');
const { Reflector } = require('@nestjs/core');
const { lastValueFrom, from } = require('rxjs');

const day = (s) => new Date(`${s}T07:00:00Z`);

run('pg-core', async (prisma) => {
  await seedBase(prisma);
  const audit = new AuditService(prisma);
  let n = 0;
  const exp = (o) => ({ id: `e${++n}`, date: day(o.date ?? '2026-03-10'), period: (o.date ?? '2026-03-10').slice(0, 7), amountTiyin: BigInt(o.som * 100), categoryCode: o.cat ?? 'IJARA', createdById: 'adm', regionCode: o.region ?? null, departmentId: o.dep ?? null, segment: o.seg ?? null, source: o.source ?? 'MANUAL' });
  const inc = (o) => ({ id: `i${++n}`, date: day(o.date ?? '2026-03-10'), period: (o.date ?? '2026-03-10').slice(0, 7), amountTiyin: BigInt(o.som * 100), paidTiyin: BigInt((o.paid ?? o.som) * 100), paymentStatus: o.status ?? 'PAID', categoryCode: 'DAROMAD', createdById: 'adm', regionCode: o.region ?? null, segment: o.seg ?? null });
  await prisma.expense.createMany({
    data: [
      exp({ som: 1000, region: 0 }), exp({ som: 1000, region: 0 }), // takroriy (bir xil sana, summa, modda)
      exp({ som: 250, region: 3, cat: 'INTERNET' }),
      exp({ som: 400, seg: 'TAX_FREE', date: '2026-04-05' }),
      exp({ som: 75, region: 8, date: '2026-04-30' }),
    ],
  });
  await prisma.income.createMany({ data: [inc({ som: 5000, region: 0 }), inc({ som: 1200, region: 3, status: 'UNPAID', paid: 0 }), inc({ som: 800, region: 8, status: 'PARTIAL', paid: 300, date: '2026-04-12' })] });

  // Ish haqi yuklashlari: biri mos, biri mos emas (xarajatlar yig'indisi farq qiladi)
  await prisma.payrollBatch.createMany({
    data: [
      { id: 'pb1', period: '2026-03', status: 'COMMITTED', fileName: 'a.xlsx', fileHash: 'h1', totalTiyin: 50000n, uploadedById: 'adm' },
      { id: 'pb2', period: '2026-04', status: 'COMMITTED', fileName: 'b.xlsx', fileHash: 'h2', totalTiyin: 90000n, uploadedById: 'adm' },
      { id: 'pb3', period: '2026-05', status: 'COMMITTED', fileName: 'c.xlsx', fileHash: 'h3', totalTiyin: 10000n, uploadedById: 'adm' },
    ],
  });
  await prisma.expense.createMany({ data: [{ ...exp({ som: 300, region: 0, source: 'PAYROLL', date: '2026-03-31' }), payrollBatchId: 'pb1' }, { ...exp({ som: 200, region: 3, source: 'PAYROLL', date: '2026-03-31' }), payrollBatchId: 'pb1' }, { ...exp({ som: 800, region: 0, source: 'PAYROLL', date: '2026-04-30' }), payrollBatchId: 'pb2' }] });

  // ── 1. Yaxlitlik tekshiruvi (xom SQL: takroriy yozuvlar, groupBy) ──
  const integ = await new IntegrityService(prisma).check();
  const dup = integ.issues.find((i) => i.code === 'duplicate_expenses');
  assert.ok(dup, 'takroriy xarajat topildi');
  assert.strictEqual(dup.count, 1);
  assert.deepStrictEqual(dup.details, ['2026-03: 1 ta']);
  const pay = integ.issues.find((i) => i.code === 'payroll_mismatch');
  assert.ok(pay, 'ish haqi farqi topildi');
  assert.deepStrictEqual(pay.details.map((d) => d.slice(0, 7)).sort(), ['2026-04', '2026-05'], 'mos kelmaganlari: aprel (800≠900) va may (xarajat yo\'q)');
  console.log(`  ✓ yaxlitlik: ${integ.issues.length} ta tekshiruv natijasi, xom SQL ishladi`);

  // ── 2. Iqtisod jadvali (xom SQL: oylar × hudud, Toshkent vaqti) ──
  const panel = await new EconData(prisma).panel('2026-04');
  const total = (k) => panel.units.reduce((s, u) => s + u[k].reduce((a, b) => a + b, 0), 0);
  assert.strictEqual(Math.round(total('income')), 7000);
  assert.strictEqual(Math.round(total('expense')), 4025);
  console.log('  ✓ iqtisod jadvali: daromad 7 000, xarajat 4 025 (bazadagi bilan bir xil)');

  // ── 3. Solishtirish SQL (yig'indilar va debitorlik) ──
  const sql = ReconcileService.prototype.sql.bind({ prisma });
  const rows = await sql('expenses', day('2026-03-01'), day('2026-05-01'));
  assert.strictEqual(rows.reduce((s, r) => s + BigInt(r.total), 0n), 402500n);
  assert.strictEqual(rows.filter((r) => r.source === 'PAYROLL').reduce((s, r) => s + BigInt(r.total), 0n), 130000n);
  assert.ok(rows.every((r) => /^\d{4}-\d{2}$/.test(r.month)));
  const irows = await sql('incomes', day('2026-03-01'), day('2026-05-01'));
  assert.strictEqual(irows.reduce((s, r) => s + BigInt(r.total), 0n), 700000n);
  console.log('  ✓ solishtirish SQL: oy × hudud × manba yig\'indilari to\'g\'ri');

  // ── 4. Kirish: parallel xato urinishlar yo'qolmaydi (atomik oshirish) ──
  const bcrypt = require('bcryptjs');
  await prisma.user.create({ data: { id: 'w1', username: 'sk-0001', passwordHash: 'x', fullName: 'Omborchi', role: 'SKLADCHI', loginCode: 'SK-0001', pinHash: bcrypt.hashSync('482913', 4) } });
  const auth = new AuthService(prisma, new JwtService({ secret: 'pg-test-secret', signOptions: { expiresIn: 3600 } }), audit);
  await Promise.allSettled(Array.from({ length: 4 }, () => auth.codeLogin('SK-0001', '000000')));
  assert.strictEqual((await prisma.user.findUnique({ where: { id: 'w1' } })).failedAttempts, 4, '4 parallel xato — 4 ta hisoblandi');
  await expectErr(auth.codeLogin('SK-0001', '000000'), /yopildi/);
  assert.ok((await prisma.user.findUnique({ where: { id: 'w1' } })).lockedUntil > new Date());
  for (let i = 0; i < 4; i++) await expectErr(auth.login('admin', 'xato'), /noto/);
  await expectErr(auth.login('admin', 'xato'), /15 daqiqaga yopildi/);
  await expectErr(auth.login('admin', 'Sinov-Parol-1'), /daqiqadan keyin/);
  await prisma.user.update({ where: { id: 'adm' }, data: { lockedUntil: null } });
  const s = await auth.login('admin', 'Sinov-Parol-1');
  const changed = await auth.changePassword('adm', 'Sinov-Parol-1', 'Yangi-Parol-22');
  assert.ok(changed.accessToken && changed.accessToken !== s.accessToken);
  assert.strictEqual((await prisma.user.findUnique({ where: { id: 'adm' } })).tokenVersion, 1);
  console.log('  ✓ kirish: parallel xatolar to\'liq sanaldi, bloklash va token versiyasi bazada');

  // ── 5. Raqamlash: 12 ta parallel ariza — raqamlar takrorlanmaydi (P2002 → qayta urinish) ──
  const purchases = new PurchasesService(prisma, audit, null);
  const made = await Promise.all(Array.from({ length: 20 }, (_, i) => purchases.createRequest({ date: '2026-04-01', title: `Ariza ${i}`, lines: [{ name: 'Qog\'oz', qty: 1 }] }, 'adm')));
  const numbers = made.map((r) => r.number);
  assert.strictEqual(new Set(numbers).size, 20, `raqamlar takrorlanmadi: ${numbers.join(', ')}`);
  assert.deepStrictEqual([...numbers].sort(), Array.from({ length: 20 }, (_, i) => `AR-2026-${String(i + 1).padStart(4, '0')}`), 'teshiksiz ketma-ket');
  console.log(`  ✓ raqamlash: 20 parallel ariza — hammasi alohida, ketma-ket raqam`);

  // ── 6. JSON sozlamalar: parallel yozuvlar yo'qolmaydi ──
  await Promise.all([
    writePolicy(prisma, { centerCategories: ['IJARA'] }),
    writePolicy(prisma, { payrollComponents: ['OKLAD'] }),
    writePolicy(prisma, { excludeCategories: ['INTERNET'] }),
    writePolicy(prisma, { payers: { IJARA: 'CENTER' } }),
  ]);
  const pol = (await prisma.setting.findUnique({ where: { key: 'expense.policy' } })) ?? (await prisma.setting.findFirst({ where: { key: { contains: 'polic' } } }));
  const v = pol.value;
  assert.deepStrictEqual([v.centerCategories, v.payrollComponents, v.excludeCategories, v.payers], [['IJARA'], ['OKLAD'], ['INTERNET'], { IJARA: 'CENTER' }], 'to\'rt parallel o\'zgarish ham saqlandi');
  void readPolicy;

  // Bo'lim xodimlari: 10 ta parallel ko'chish (HTTP navbati orqali) — hammasi saqlanadi
  const up = new UnitPayrollService(prisma, audit);
  await prisma.employee.createMany({ data: Array.from({ length: 10 }, (_, i) => ({ pinfl: `3010190000${String(i).padStart(4, '0')}`, lastName: `Sinov${i}`, firstName: 'X', fullName: `Sinov${i} X`, employmentType: 'SHTAT', regionCode: 0 })) });
  const icp = new SerializeWritesInterceptor(new Reflector());
  const ctx = { getType: () => 'http', getClass: () => UnitPayrollController, getHandler: () => () => null, switchToHttp: () => ({ getRequest: () => ({ method: 'POST' }) }) };
  await Promise.all(Array.from({ length: 10 }, (_, i) => lastValueFrom(icp.intercept(ctx, { handle: () => from(up.addMove({ pinfl: `3010190000${String(i).padStart(4, '0')}`, unit: 'TAX_FREE', from: '2026-03' }, 'adm')) }))));
  const moves = (await up.moves()).items ?? (await up.moves());
  assert.strictEqual((Array.isArray(moves) ? moves : moves.items).length, 10, '10 parallel ko\'chish — hammasi saqlandi');
  console.log('  ✓ JSON sozlamalar: parallel o\'zgarishlar yo\'qolmadi (siyosat va ko\'chishlar)');

  // ── 7. Ko'p yozuvni o'chirish — tranzaksiya, savatga ──
  const closes = new PeriodCloseService(prisma, audit, new QualityService(prisma));
  const pw = new DeletePasswordService(prisma, audit);
  const del = new BulkDeleteService(prisma, new PayrollService(prisma), closes, audit, null, null, null, null, new FixedAssetsService(prisma, audit), pw);
  const A = { id: 'adm', role: 'ADMIN' };
  const manualMarch = await prisma.expense.count({ where: { period: '2026-03', source: 'MANUAL', deletedAt: null } });
  const p = await del.preview({ target: 'EXPENSE', mode: 'month', month: '2026-03' }, A);
  assert.ok(p.count >= manualMarch, JSON.stringify({ count: p.count, manualMarch }));
  const before = await prisma.expense.count({ where: { deletedAt: null } });
  const r = await del.execute({ target: 'EXPENSE', mode: 'month', month: '2026-03' }, A);
  assert.strictEqual(r.count, p.count, 'ko\'rsatilgani va o\'chirilgani bir xil');
  assert.strictEqual(await prisma.expense.count({ where: { deletedAt: null } }), before - r.count);
  assert.strictEqual(await prisma.expense.count({ where: { deletedAt: { not: null } } }), r.count, 'savatga tushdi, bazadan o\'chmadi');
  await expectErr(del.execute({ target: 'EXPENSE', mode: 'all', password: '3642' }, A), /Standart o'chirish paroli/);
  console.log(`  ✓ ommaviy o'chirish: tranzaksiyada, savatga (${r.count} ta)`);

  // ── 8. Navbat: bitta kalitda haqiqiy yozuv (o'qib → yozish) ──
  await prisma.setting.create({ data: { key: 'pg.counter', value: { n: 0 } } });
  await Promise.all(Array.from({ length: 25 }, () => runExclusive('setting:pg.counter', async () => {
    const cur = (await prisma.setting.findUnique({ where: { key: 'pg.counter' } })).value;
    await prisma.setting.update({ where: { key: 'pg.counter' }, data: { value: { n: cur.n + 1 } } });
  })));
  assert.strictEqual((await prisma.setting.findUnique({ where: { key: 'pg.counter' } })).value.n, 25);
  console.log('  ✓ navbat: 25 parallel o\'qib-yozish — 25');

  // ── 9. Ma'lumotnomalarni shifrlash — haqiqiy bazada tranzaksiya bilan ──
  const cr = D('modules/hr-sheets/hr-sheets.crypto');
  const hrRows = Array.from({ length: 300 }, (_, i) => [`3010190002${String(i).padStart(4, '0')}`, `SINOV ${i}`, `AA${String(1000000 + i)}`, `+998 90 000 ${String(i).padStart(4, '0')}`]);
  const snap = { code: 'J16', batchId: 'b1', fileName: '16.xlsx', uploadedAt: new Date().toISOString(), uploadedBy: 'Sinov', uploadedById: 'adm', cols: ['pinfl', 'fio', 'pasportRaqam', 'telefon'], rows: hrRows };
  await prisma.setting.create({ data: { key: 'hr.sheet.J16', value: snap } });
  const prevKey = process.env.APP_ENCRYPTION_KEY;
  process.env.APP_ENCRYPTION_KEY = 'pg-hr-sinov-kaliti-0123456789-abcdefghijk';
  try {
    const r1 = await cr.sealAllHr(prisma);
    assert.strictEqual(r1.sealed, 600);
    const stored = JSON.stringify((await prisma.setting.findUnique({ where: { key: 'hr.sheet.J16' } })).value);
    assert.ok(!stored.includes('AA1000005') && stored.includes('SINOV 5') && stored.includes('30101900020005'));
    const st = await cr.hrCryptoStatus(prisma);
    assert.deepStrictEqual([st.sealed, st.plain, st.unreadable], [600, 0, 0]);
    const r2 = await cr.unsealAllHr(prisma);
    assert.strictEqual(r2.opened, 600);
    assert.deepStrictEqual((await prisma.setting.findUnique({ where: { key: 'hr.sheet.J16' } })).value.rows, hrRows, 'asl holat aynan tiklandi');
  } finally {
    if (prevKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = prevKey;
  }
  console.log("  ✓ ma'lumotnomalar: 600 ta shaxsiy qiymat bazada shifrlandi va aynan qaytarildi");
});