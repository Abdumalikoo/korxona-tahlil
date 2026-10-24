// Shifrlash: maxfiy qiymatlar (secret-box) va zaxira fayllari (backup-cipher, ochish skripti). TEST MA'LUMOTLARI SUN'IY.
require('reflect-metadata');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { spawnSync } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-crypto-'));
const box = require('../dist/common/crypto/secret-box');
const bc = require('../dist/common/crypto/backup-cipher');
const { BackupService } = require('../dist/modules/backup/backup.service');

(async () => {
  // ═══ 1. Maxfiy qiymatlar ═══
  delete process.env.APP_ENCRYPTION_KEY;
  assert.strictEqual(box.secretBoxReady(), false);
  assert.strictEqual(box.seal('ochiq'), 'ochiq', 'kalitsiz — avvalgidek');
  process.env.APP_ENCRYPTION_KEY = 'qisqa';
  assert.throws(() => box.seal('x'), /juda qisqa/);
  process.env.APP_ENCRYPTION_KEY = 'sinov-kaliti-0123456789-abcdefghijklmnop';
  const s1 = box.seal('123456789:AAH-maxfiy-bot-kaliti');
  const s2 = box.seal('123456789:AAH-maxfiy-bot-kaliti');
  assert.ok(s1.startsWith('enc:v1:') && !s1.includes('maxfiy'));
  assert.notStrictEqual(s1, s2, 'har safar boshqa iv');
  assert.strictEqual(box.open(s1), '123456789:AAH-maxfiy-bot-kaliti');
  assert.strictEqual(box.open('eski-ochiq-qiymat'), 'eski-ochiq-qiymat', 'eski qiymat o\'qiladi');
  const bad = s1.slice(0, -3) + (s1.endsWith('A') ? 'BBB' : 'AAA');
  assert.throws(() => box.open(bad), /ochib bo/);
  process.env.APP_ENCRYPTION_KEY = 'boshqa-kalit-0123456789-abcdefghijklmnopq';
  assert.throws(() => box.open(s1), /boshqa/);
  delete process.env.APP_ENCRYPTION_KEY;
  assert.throws(() => box.open(s1), /sozlanmagan/);
  console.log('  ✓ maxfiy qiymatlar: shifrlanadi, eski qiymat o\'qiladi, buzilgani va boshqa kalit — rad');

  // ═══ 2. Zaxira fayli ═══
  const KEY = 'zaxira-sinov-kaliti-2026';
  const sql = Buffer.from(Array.from({ length: 4000 }, (_, i) => `INSERT INTO t VALUES (${i}, 'Sinov xodim ${i}', '+998900000000');`).join('\n'));
  const f = path.join(dir, 'z.sql.gz.enc');
  await bc.encryptToFile(Readable.from([sql.subarray(0, 50_000), sql.subarray(50_000)]), f, KEY);
  const enc = fs.readFileSync(f);
  assert.ok(enc.subarray(0, 6).equals(bc.BACKUP_MAGIC));
  assert.ok(!enc.includes(Buffer.from('Sinov xodim')) && !enc.includes(Buffer.from('INSERT')), 'ochiq matn yo\'q');
  assert.ok(enc.length < sql.length / 3, 'siqilgan');
  assert.strictEqual(await bc.verifyEncrypted(f, KEY), sql.length);
  await assert.rejects(bc.verifyEncrypted(f, 'noto-g-ri-kalit-2026'), /kalit noto/);
  const t = Buffer.from(enc); t[200] ^= 1; fs.writeFileSync(path.join(dir, 'buzuq.enc'), t);
  await assert.rejects(bc.verifyEncrypted(path.join(dir, 'buzuq.enc'), KEY), /kalit noto|buzilgan/);
  fs.writeFileSync(path.join(dir, 'kesik.enc'), enc.subarray(0, enc.length - 100));
  await assert.rejects(bc.verifyEncrypted(path.join(dir, 'kesik.enc'), KEY));
  fs.writeFileSync(path.join(dir, 'oddiy.sql.gz.enc'), Buffer.from('SELECT 1;'.repeat(20)));
  await assert.rejects(bc.verifyEncrypted(path.join(dir, 'oddiy.sql.gz.enc'), KEY), /emas/);

  // Mustaqil ochish skripti — xizmat yozgan faylni ochadi
  const script = path.join(__dirname, '..', 'scripts', 'backup-decrypt.js');
  const r = spawnSync(process.execPath, [script, f], { env: { ...process.env, BACKUP_ENCRYPTION_KEY: KEY }, maxBuffer: 50 * 1024 * 1024 });
  assert.strictEqual(r.status, 0, String(r.stderr));
  assert.ok(Buffer.from(r.stdout).equals(sql), 'skript bilan ochilgan nusxa aslidek');
  const c = spawnSync(process.execPath, [script, f, '--check'], { env: { ...process.env, BACKUP_ENCRYPTION_KEY: KEY }, encoding: 'utf8' });
  assert.match(c.stderr, /OK: fayl butun/);
  const w = spawnSync(process.execPath, [script, f], { env: { ...process.env, BACKUP_ENCRYPTION_KEY: 'boshqa-kalit-1234567' }, encoding: 'utf8' });
  assert.notStrictEqual(w.status, 0);
  assert.match(w.stderr, /kalit noto/);
  const nk = spawnSync(process.execPath, [script, f], { env: { ...process.env, BACKUP_ENCRYPTION_KEY: '' }, encoding: 'utf8' });
  assert.match(nk.stderr, /berilmagan/);
  console.log('  ✓ zaxira: shifrlangan va siqilgan, ochiq matn yo\'q, buzilgani/boshqa kalit — rad, skript ochadi');

  // ═══ 3. Zaxira nomlari va ro'yxat ═══
  for (const ok of ['korxona_2026-10-25_02-00.sql', 'korxona_2026-10-25_02-00.sql.gz.enc']) assert.ok(BackupService.isBackupName(ok), ok);
  for (const no of ['../x.sql', 'a/b.sql', 'x.sql.gz', 'x.txt', '..sql', 'x.enc']) assert.ok(!BackupService.isBackupName(no), no);
  const bdir = path.join(dir, 'zaxira');
  fs.mkdirSync(bdir);
  process.env.BACKUP_DIR = bdir;
  process.env.BACKUP_MIRROR_DIR = path.join(dir, 'ikkinchi');
  fs.mkdirSync(process.env.BACKUP_MIRROR_DIR);
  fs.copyFileSync(f, path.join(bdir, 'korxona_2026-10-25_02-00.sql.gz.enc'));
  fs.copyFileSync(f, path.join(process.env.BACKUP_MIRROR_DIR, 'korxona_2026-10-25_02-00.sql.gz.enc'));
  fs.writeFileSync(path.join(bdir, 'korxona_2026-10-24_02-00.sql'), 'SELECT 1;');
  const svc = new BackupService();
  const list = await svc.list();
  assert.deepStrictEqual(list.map((x) => [x.name, x.encrypted, x.mirrored]).sort(), [['korxona_2026-10-24_02-00.sql', false, false], ['korxona_2026-10-25_02-00.sql.gz.enc', true, true]]);
  assert.ok(svc.resolve('korxona_2026-10-25_02-00.sql.gz.enc'));
  assert.strictEqual(svc.resolve('../korxona_2026-10-25_02-00.sql.gz.enc'), null);
  assert.strictEqual(svc.resolve('yoq.sql'), null);
  delete process.env.BACKUP_ENCRYPTION_KEY;
  let st = await svc.stats();
  assert.deepStrictEqual([st.encryption, st.mirror.configured], [false, true]);
  process.env.BACKUP_ENCRYPTION_KEY = KEY;
  st = await svc.stats();
  assert.strictEqual(st.encryption, true);
  console.log('  ✓ zaxira ro\'yxati: shifrlangan/ochiq, ikkinchi joydagi nusxa, xavfli nomlar rad');

  // ═══ 4. Telegram bot kaliti bazada shifrlanadi ═══
  const fakeDb = require('./fakedb');
  const { TelegramService } = require('../dist/modules/telegram/telegram.service');
  const db = fakeDb();
  const TOK = '123456789:AAHsinovTokenSunIy0123456789abcdefg';
  db.tables.setting.push({ key: 'telegram.bot', value: { token: TOK, username: 'sinov_bot' } });
  process.env.APP_ENCRYPTION_KEY = 'ilova-sinov-kaliti-0123456789-abcdefghij';
  const tg = new TelegramService(db.client, { async log() {} });
  tg.startPolling = () => undefined; // tarmoqqa chiqmasin
  await tg.onModuleInit();
  const stored = db.tables.setting.find((x) => x.key === 'telegram.bot').value;
  assert.ok(box.isSealed(stored.token) && !JSON.stringify(stored).includes('AAHsinov'), 'eski ochiq kalit shifrlandi');
  assert.strictEqual(tg.token, TOK, 'ishlash uchun ochilgan');
  const tg2 = new TelegramService(db.client, { async log() {} });
  tg2.startPolling = () => undefined;
  await tg2.onModuleInit();
  assert.strictEqual(tg2.token, TOK, 'qayta ishga tushganda shifrlangan qiymat ochiladi');
  process.env.APP_ENCRYPTION_KEY = 'boshqa-ilova-kaliti-0123456789-abcdefghij';
  const tg3 = new TelegramService(db.client, { async log() {} });
  tg3.startPolling = () => undefined;
  await tg3.onModuleInit();
  assert.strictEqual(tg3.token, null);
  assert.match(tg3.lastError, /qayta kiriting/);
  delete process.env.APP_ENCRYPTION_KEY;
  console.log('  ✓ Telegram bot kaliti: bazada shifrlangan, eski ochiq qiymat o\'zi shifrlanadi, boshqa kalit — xabar');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('OK t-backup-crypto');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});