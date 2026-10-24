// Haqiqiy PostgreSQL: shifrlangan zaxira olish (pg_dump) → ochish → boshqa bazaga tiklash → ma'lumot aslidek. TEST MA'LUMOTLARI SUN'IY.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { D, seedBase, run } = require('./harness');

const { BackupService } = D('modules/backup/backup.service');

const has = (cmd) => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0;

run('pg-backup', async (prisma) => {
  if (!has('pg_dump') || !has('psql')) {
    console.log('SKIP: pg_dump yoki psql topilmadi');
    return;
  }
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!url.password) {
    console.log('SKIP: zaxira sinovi uchun TEST_DATABASE_URL da parol bo\'lsin (postgresql://user:parol@host:port/baza_test)');
    return;
  }
  await seedBase(prisma);
  await prisma.employee.createMany({ data: Array.from({ length: 50 }, (_, i) => ({ pinfl: `3010190001${String(i).padStart(4, '0')}`, lastName: `Sinov${i}`, firstName: 'Xodim', fullName: `Sinov${i} Xodim`, employmentType: 'SHTAT', regionCode: 0 })) });
  await prisma.setting.create({ data: { key: 'hr.sheet.J16', value: { rows: [{ pinfl: '30101900010001', phone: '+998900000000', passport: 'AA0000000' }] } } });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-backup-'));
  const prev = { DATABASE_URL: process.env.DATABASE_URL, BACKUP_DIR: process.env.BACKUP_DIR, BACKUP_ENCRYPTION_KEY: process.env.BACKUP_ENCRYPTION_KEY, BACKUP_MIRROR_DIR: process.env.BACKUP_MIRROR_DIR };
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; // faqat shu jarayonda, test bazasi
  process.env.BACKUP_DIR = path.join(dir, 'asosiy');
  process.env.BACKUP_MIRROR_DIR = path.join(dir, 'ikkinchi');
  process.env.BACKUP_ENCRYPTION_KEY = 'pg-zaxira-sinov-kaliti-2026';
  const restoreDb = `${url.pathname.slice(1)}_restore`;
  try {
    const svc = new BackupService();
    const b = await svc.create();
    assert.ok(b.name.endsWith('.sql.gz.enc') && b.encrypted && b.mirrored === true, JSON.stringify({ ...b, path: undefined }));
    const enc = fs.readFileSync(b.path);
    assert.ok(!enc.includes(Buffer.from('Sinov1 Xodim')) && !enc.includes(Buffer.from('+998900000000')), 'zaxirada ochiq ma\'lumot yo\'q');
    assert.ok(fs.existsSync(path.join(process.env.BACKUP_MIRROR_DIR, b.name)), 'ikkinchi joyda nusxa');
    assert.ok(fs.readdirSync(process.env.BACKUP_DIR).every((f) => !f.endsWith('.sql')), 'ochiq .sql diskda qolmadi');

    // Ochish skripti → SQL → yangi bazaga tiklash
    const script = path.join(__dirname, '..', '..', 'scripts', 'backup-decrypt.js');
    const sqlFile = path.join(dir, 'tiklash.sql');
    const dec = spawnSync(process.execPath, [script, b.path], { env: process.env, maxBuffer: 200 * 1024 * 1024 });
    assert.strictEqual(dec.status, 0, String(dec.stderr));
    fs.writeFileSync(sqlFile, dec.stdout);
    await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${restoreDb}"`);
    await prisma.$executeRawUnsafe(`CREATE DATABASE "${restoreDb}"`);
    const target = new URL(process.env.TEST_DATABASE_URL);
    target.pathname = `/${restoreDb}`;
    const r = spawnSync('psql', [target.toString(), '-v', 'ON_ERROR_STOP=1', '-q', '-f', sqlFile], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr.slice(0, 500));
    const q = spawnSync('psql', [target.toString(), '-At', '-c', `SELECT count(*), sum(length("fullName")) FROM employees`], { encoding: 'utf8' });
    const [cnt] = q.stdout.trim().split('|');
    assert.strictEqual(Number(cnt), 50, 'tiklangan bazada hamma xodimlar bor');
    const st = await svc.stats();
    assert.deepStrictEqual([st.encryption, st.lastEncrypted, st.mirror.configured, st.mirror.last?.ok], [true, true, true, true]);

    // Kalit noto'g'ri bo'lsa — zaxira olinmaydi (chala fayl qolmaydi)
    process.env.BACKUP_ENCRYPTION_KEY = 'qisqa';
    await assert.rejects(svc.create(), /juda qisqa/);
    assert.strictEqual(fs.readdirSync(process.env.BACKUP_DIR).length, 1);
    console.log(`  ✓ zaxira: shifrlangan (${b.sizeBytes} bayt), ikkinchi joyda nusxa, ochildi va yangi bazaga tiklandi — 50 xodim`);
  } finally {
    await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${restoreDb}"`).catch(() => null);
    for (const [k, v] of Object.entries(prev)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});