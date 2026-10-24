// Xavfsizlik 1-bosqich: parol bilan kirishda bloklash, chiqish va parol almashganda tokenlar,
// ZIP bomba himoyasi, yozuvlar navbati, kuzatuvchi va shaxsiy ma'lumotlar. TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const fakeDb = require('./fakedb');
const { JwtService } = require('@nestjs/jwt');
const { Reflector } = require('@nestjs/core');
const { lastValueFrom, of } = require('rxjs');
const { AuthService, MAX_PASSWORD_ATTEMPTS } = require('../dist/modules/auth/auth.service');
const { AuthController } = require('../dist/modules/auth/auth.controller');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { assertSafeXlsx } = require('../dist/common/files/xlsx-guard');
const { runExclusive, activeLocks } = require('../dist/common/locks');
const { SerializeWritesInterceptor } = require('../dist/common/interceptors/serialize-writes.interceptor');
const { SecurityService } = require('../dist/modules/security/security.service');
const { SecurityController } = require('../dist/modules/security/security.controller');
const { PersonalDataGuard } = require('../dist/modules/security/personal-data.guard');
const { PersonalMaskInterceptor, maskPersonal } = require('../dist/modules/security/personal-mask.interceptor');
const { EmployeesController } = require('../dist/modules/employees/employees.controller');
const { UnitPayrollController } = require('../dist/modules/unit-payroll/unit-payroll.controller');
const { SalaryCompositionController } = require('../dist/modules/salary-composition/salary-composition.controller');
const { RegionalDataController } = require('../dist/modules/regional-data/regional-data.controller');
const { DistrictsController } = require('../dist/modules/structure/districts.controller');
const { EmployeeTransfersController } = require('../dist/modules/employee-transfers/employee-transfers.controller');
const { ROLES_KEY } = require('../dist/common/decorators/roles.decorator');

const expectErr = async (p, re) => {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (e) {
    const m = e.response?.message ?? e.message;
    if (!re.test(String(m))) throw e;
    return e;
  }
  assert.fail(`xato kutilgan edi: ${re}`);
};

// ── Sun'iy ZIP yasash (xlsx guard uchun) ──
function zipOf(entries, { lie = false, method = 8, encrypted = false } = {}) {
  const locals = [];
  const cens = [];
  let off = 0;
  for (const { name, data } of entries) {
    const comp = method === 8 ? zlib.deflateRawSync(data) : data;
    const nm = Buffer.from(name);
    const usize = lie ? 1000 : data.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(encrypted ? 1 : 0, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(usize, 22); lh.writeUInt16LE(nm.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(encrypted ? 1 : 0, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(usize, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nm, comp);
    cens.push(ch, nm);
    off += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(cens);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

(async () => {
  // ═══════════ 1. Parol bilan kirish: 5 marta xato — 15 daqiqa yopiladi ═══════════
  const db = fakeDb();
  const T = db.tables;
  const bcrypt = require('bcryptjs');
  T.user.push({ id: 'adm', username: 'boshliq', passwordHash: bcrypt.hashSync('Sinov-Parol-1', 4), fullName: 'Admin', role: 'ADMIN', isActive: true, loginCode: null, pinHash: null, mustChangePin: false, failedAttempts: 0, lockedUntil: null, tokenVersion: 0, lastLoginAt: null, createdAt: new Date() });
  const audit = new AuditService(db.client);
  const jwt = new JwtService({ secret: 'test-secret', signOptions: { expiresIn: 3600 } });
  const auth = new AuthService(db.client, jwt, audit);
  const ctl = new AuthController(auth);
  const u = () => T.user.find((x) => x.id === 'adm');

  for (let i = 1; i < MAX_PASSWORD_ATTEMPTS; i++) await expectErr(auth.login('boshliq', 'xato'), /Login yoki parol noto/);
  assert.strictEqual(u().failedAttempts, MAX_PASSWORD_ATTEMPTS - 1);
  await expectErr(auth.login('boshliq', 'xato'), /5 marta xato parol kiritildi. Hisob 15 daqiqaga yopildi/);
  assert.ok(u().lockedUntil > new Date());
  await expectErr(auth.login('boshliq', 'Sinov-Parol-1'), /daqiqadan keyin/); // to'g'ri parol ham o'tmaydi
  u().lockedUntil = new Date(Date.now() - 1000); // muddat o'tdi
  const s1 = await auth.login('BOSHLIQ', 'Sinov-Parol-1');
  assert.strictEqual(u().failedAttempts, 0);
  assert.strictEqual(u().lockedUntil, null);
  const logs = JSON.stringify(T.auditLog ?? []);
  assert.ok(!/Sinov-Parol-1|xato"/.test(logs), 'parol logga chiqmaydi');
  console.log('  ✓ parol: 5 xato → 15 daqiqa, keyin tozalanadi');

  // ═══════════ 2. Parol almashganda eski tokenlar yaroqsiz; chiqish ═══════════
  let p = jwt.decode(s1.accessToken);
  assert.ok(await auth.validateById(p.sub, p.tv));
  const changed = (await ctl.changePassword('adm', { currentPassword: 'Sinov-Parol-1', newPassword: 'Yangi-Parol-22' })).data;
  assert.strictEqual(changed.success, true);
  assert.ok(changed.accessToken, 'joriy oyna uchun yangi token');
  assert.strictEqual(await auth.validateById(p.sub, p.tv), null, 'eski token yaroqsiz');
  const p2 = jwt.decode(changed.accessToken);
  assert.ok(await auth.validateById(p2.sub, p2.tv), 'yangi token ishlaydi');
  await expectErr(auth.login('boshliq', 'Sinov-Parol-1'), /noto/);
  const s3 = await auth.login('boshliq', 'Yangi-Parol-22');
  const p3 = jwt.decode(s3.accessToken);
  await ctl.logout('adm');
  assert.strictEqual(await auth.validateById(p3.sub, p3.tv), null, 'chiqqandan keyin token yaroqsiz');
  assert.strictEqual(await auth.validateById(p2.sub, p2.tv), null, 'boshqa qurilma ham chiqdi');
  console.log('  ✓ parol almashganda va chiqishda tokenlar bekor');

  // ═══════════ 3. ZIP bomba himoyasi ═══════════
  // Haqiqiy Excel (exceljs) — o'tadi
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('A');
  for (let i = 0; i < 2000; i++) ws.addRow([i, `Qator ${i}`, i * 1.5]);
  const good = Buffer.from(await wb.xlsx.writeBuffer());
  await assertSafeXlsx(good);
  for (const f of fs.readdirSync(path.join(__dirname, 'fixtures')).filter((x) => x.endsWith('.xlsx'))) await assertSafeXlsx(fs.readFileSync(path.join(__dirname, 'fixtures', f)));
  // Ochilganda 200 MB (siqilgani ~200 KB) — rad
  const bomb = zipOf([{ name: 'xl/worksheets/sheet1.xml', data: Buffer.alloc(200 * 1024 * 1024) }]);
  assert.ok(bomb.length < 1024 * 1024, `bomba kichik: ${bomb.length}`);
  await expectErr(assertSafeXlsx(bomb), /ochilganda juda katta/);
  // Sarlavhada yolg'on hajm (1000 bayt) — baribir haqiqiy ochishda to'xtatiladi
  await expectErr(assertSafeXlsx(zipOf([{ name: 'a.xml', data: Buffer.alloc(200 * 1024 * 1024) }], { lie: true })), /ochilganda juda katta/);
  // Ko'p kichik qism, jami chegaradan oshadi
  await expectErr(assertSafeXlsx(zipOf(Array.from({ length: 4 }, (_, i) => ({ name: `p${i}.xml`, data: Buffer.alloc(40 * 1024 * 1024) })))), /ochilganda juda katta/);
  await expectErr(assertSafeXlsx(zipOf(Array.from({ length: 6000 }, (_, i) => ({ name: `${i}`, data: Buffer.from('x') })), { method: 0 })), /juda ko'p ichki qism/);
  await expectErr(assertSafeXlsx(zipOf([{ name: 'a', data: Buffer.from('salom') }], { encrypted: true })), /parol bilan himoyalangan/);
  await expectErr(assertSafeXlsx(Buffer.from('salom dunyo, bu excel emas, oddiy matn fayli')), /o'qib bo'lmadi/);
  await expectErr(assertSafeXlsx(Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), Buffer.alloc(100)])), /eski \.xls/);
  await expectErr(assertSafeXlsx(good.subarray(0, Math.floor(good.length / 2))), /o'qib bo'lmadi/);
  await expectErr(assertSafeXlsx(undefined), /o'qib bo'lmadi/);
  // 24 ta yuklash joyining hammasida tekshiruv bor
  const src = path.join(__dirname, '../src/modules');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.ts') ? [path.join(d, e.name)] : []));
  let loads = 0;
  for (const f of walk(src)) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (!/\.xlsx\.load\(/.test(l)) return;
      loads++;
      const before = lines.slice(Math.max(0, i - 3), i).join('\n');
      assert.ok(/assertSafeXlsx\(/.test(before), `${path.relative(src, f)}:${i + 1} — tekshiruvsiz yuklash`);
    });
  }
  assert.ok(loads >= 24, `yuklash joylari: ${loads}`);
  console.log(`  ✓ ZIP bomba: ${loads} ta yuklash joyi himoyalangan, oddiy fayllar o'tadi`);

  // ═══════════ 4. Yozuvlar navbati: o'qib → yozish yo'qolmaydi ═══════════
  let shared = { n: 0, list: [] };
  const slow = (ms) => new Promise((r) => setTimeout(r, ms));
  const rmw = (i) =>
    runExclusive('k', async () => {
      const cur = JSON.parse(JSON.stringify(shared));
      await slow(3);
      cur.n += 1;
      cur.list.push(i);
      shared = cur;
    });
  await Promise.all(Array.from({ length: 30 }, (_, i) => rmw(i)));
  assert.strictEqual(shared.n, 30, 'hech bir o\'zgarish yo\'qolmadi');
  assert.deepStrictEqual(shared.list, Array.from({ length: 30 }, (_, i) => i), 'kelish tartibida');
  // Xato navbatni to'xtatmaydi; ichma-ich chaqiruv o'zini kutib qolmaydi
  await expectErr(runExclusive('k', async () => { throw new Error('ataylab'); }), /ataylab/);
  assert.strictEqual(await runExclusive('k', () => runExclusive('k', async () => 'ichki')), 'ichki');
  // Har xil kalitlar bir-birini kutmaydi
  let order = [];
  await Promise.all([runExclusive('a', async () => { await slow(30); order.push('a'); }), runExclusive('b', async () => { order.push('b'); })]);
  assert.deepStrictEqual(order, ['b', 'a']);
  // Kutish chegarasi
  const hold = runExclusive('t', () => slow(80));
  await expectErr(runExclusive('t', async () => 'x', 20), /band/);
  await hold;
  assert.strictEqual(activeLocks(), 0, 'navbat xotirada qolmaydi');

  // Interceptor: POST — navbat bilan, GET — darhol
  const icp = new SerializeWritesInterceptor(new Reflector());
  const ictx = (method, Cls) => ({ getType: () => 'http', getClass: () => Cls, getHandler: () => () => null, switchToHttp: () => ({ getRequest: () => ({ method }) }) });
  let cnt = { v: 0 };
  const handler = () => ({ handle: () => require('rxjs').from((async () => { const c = cnt.v; await slow(2); cnt.v = c + 1; return c; })()) });
  await Promise.all(Array.from({ length: 20 }, () => lastValueFrom(icp.intercept(ictx('POST', UnitPayrollController), handler()))));
  assert.strictEqual(cnt.v, 20, 'parallel POSTlar bir-birini o\'chirmadi');
  cnt.v = 0;
  await Promise.all(Array.from({ length: 5 }, () => lastValueFrom(icp.intercept(ictx('GET', UnitPayrollController), handler()))));
  assert.ok(cnt.v < 5, 'GET navbatga qo\'yilmaydi (parallel)');
  assert.strictEqual(await lastValueFrom(icp.intercept(ictx('POST', AuthController), { handle: () => of('kirish') })), 'kirish');
  console.log('  ✓ yozuvlar navbati: 30 parallel o\'zgarish — hech biri yo\'qolmadi');

  // ═══════════ 5. Kuzatuvchi va shaxsiy ma'lumotlar ═══════════
  const sdb = fakeDb();
  const sec = new SecurityService(sdb.client, { async log() {} });
  const refl = new Reflector();
  const guard = new PersonalDataGuard(refl, sec);
  const mask = new PersonalMaskInterceptor(refl, sec);
  const gctx = (role, Cls, method) => ({ getType: () => 'http', getHandler: () => Cls.prototype[method], getClass: () => Cls, switchToHttp: () => ({ getRequest: () => ({ user: { id: 'x', role } }) }) });
  const denied = [
    [EmployeesController, 'findAll'],
    [EmployeesController, 'exportExcel'],
    [EmployeesController, 'findOne'],
    [EmployeeTransfersController, Object.getOwnPropertyNames(EmployeeTransfersController.prototype).find((m) => m !== 'constructor')],
    [UnitPayrollController, 'staff'],
    [SalaryCompositionController, 'employee'],
    [SalaryCompositionController, 'view'],
    [RegionalDataController, 'staff'],
    [DistrictsController, 'employee'],
  ];
  for (const [Cls, m] of denied) {
    assert.ok(Cls.prototype[m], `${Cls.name}.${m} mavjud`);
    await expectErr(guard.canActivate(gctx('VIEWER', Cls, m)), /kuzatuvchi uchun yopiq/);
    assert.strictEqual(await guard.canActivate(gctx('ADMIN', Cls, m)), true);
  }
  assert.strictEqual(await guard.canActivate(gctx('HUDUDCHI', RegionalDataController, 'staff')), true, 'Hududchi o\'z xodimlarini ko\'radi');
  assert.strictEqual(await guard.canActivate(gctx('VIEWER', EmployeesController, 'stats')), true, 'umumiy statistika ochiq');
  assert.strictEqual(await guard.canActivate(gctx('VIEWER', DistrictsController, 'district')), true, 'tuman tahlili ochiq (yashirilgan)');

  // Yashirish: JShShIR oxirgi 4 raqami, pasport/telefon olib tashlanadi
  const body = { data: { staff: [{ pinfl: '31234567890123', fullName: 'Sinov Xodim', phone: '+998900000000', passport: 'AA0000000', salary: '100' }], total: '100' } };
  const masked = await lastValueFrom(mask.intercept(gctx('VIEWER', DistrictsController, 'district'), { handle: () => of(body) }));
  assert.deepStrictEqual(masked.data.staff[0], { pinfl: '••••••••••0123', fullName: 'Sinov Xodim', salary: '100' });
  assert.strictEqual(masked.data.total, '100');
  assert.strictEqual(await lastValueFrom(mask.intercept(gctx('ADMIN', DistrictsController, 'district'), { handle: () => of(body) })), body);
  assert.deepStrictEqual(maskPersonal([{ jshshir: 12345678901234n.toString() }]), [{ jshshir: '••••••••••1234' }]);

  // Administrator ochadi — kuzatuvchi ko'radi
  const sctl = new SecurityController(sec);
  assert.deepStrictEqual(Reflect.getMetadata(ROLES_KEY, SecurityController), ['ADMIN']);
  for (const k of ['BACKUP_ENCRYPTION_KEY', 'BACKUP_MIRROR_DIR', 'APP_ENCRYPTION_KEY']) delete process.env[k];
  let st = (await sctl.status()).data;
  assert.deepStrictEqual([st.viewerPersonal, st.deletePasswordDefault, st.chatCodeDefault, st.backupEncrypted, st.backupMirror, st.secretsEncrypted, st.warnings.length], [false, true, true, false, false, false, 5]);
  await expectErr(sctl.viewerPersonal({ enabled: 'ha' }, 'adm'), /true yoki false/);
  st = (await sctl.viewerPersonal({ enabled: true }, 'adm')).data;
  assert.strictEqual(st.viewerPersonal, true);
  assert.strictEqual(await guard.canActivate(gctx('VIEWER', EmployeesController, 'findAll')), true);
  const open = await lastValueFrom(mask.intercept(gctx('VIEWER', DistrictsController, 'district'), { handle: () => of(body) }));
  assert.strictEqual(open, body);
  await sctl.viewerPersonal({ enabled: false }, 'adm');
  await expectErr(guard.canActivate(gctx('VIEWER', EmployeesController, 'findAll')), /yopiq/);
  sdb.tables.setting.push({ key: 'delete.password', value: { salt: 'aa', hash: 'bb' } }, { key: 'chat.pin', value: { salt: 'aa', hash: 'bb' } });
  Object.assign(process.env, { BACKUP_ENCRYPTION_KEY: 'zaxira-kaliti-0123456', BACKUP_MIRROR_DIR: '/mnt/ikkinchi', APP_ENCRYPTION_KEY: 'ilova-kaliti-0123456789-abcdefghijklmnop' });
  st = (await sctl.status()).data;
  assert.deepStrictEqual([st.deletePasswordDefault, st.chatCodeDefault, st.backupEncrypted, st.backupMirror, st.secretsEncrypted, st.warnings.length], [false, false, true, true, true, 0]);
  assert.ok(!JSON.stringify(st).includes('zaxira-kaliti') && !JSON.stringify(st).includes('ilova-kaliti'), 'kalitlar javobga chiqmaydi');
  console.log("  ✓ kuzatuvchi: shaxsiy ma'lumotlar yopiq / yashirilgan, administrator ochishi mumkin");

  console.log('OK t-security');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});