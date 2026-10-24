#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════
// Shifrlangan zaxirani ochish (tiklash uchun). Mustaqil: build va kutubxona kerak emas.
//
//   BACKUP_ENCRYPTION_KEY=... node scripts/backup-decrypt.js korxona_2026-10-25_02-00.sql.gz.enc > zaxira.sql
//   BACKUP_ENCRYPTION_KEY=... node scripts/backup-decrypt.js fayl.sql.gz.enc --check     (faqat tekshirish)
//
// Kalit faqat muhit o'zgaruvchisidan olinadi (buyruq qatorida yozilmaydi — tarixda qolmasin).
// PowerShell:  $env:BACKUP_ENCRYPTION_KEY = Read-Host -AsSecureString ... (yoki .env dan)
// Keyin tiklash:  psql -d <yangi_baza> -f zaxira.sql
// ═══════════════════════════════════════════════════════════
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const zlib = require('zlib');
const { pipeline, Writable } = require('stream');

const MAGIC = Buffer.from('KTBK1\n');
const file = process.argv[2];
const check = process.argv.includes('--check');
const raw = process.env.BACKUP_ENCRYPTION_KEY || '';

function fail(msg) {
  process.stderr.write(`Xato: ${msg}\n`);
  process.exit(1);
}
if (!file) fail('fayl ko‘rsatilmagan. Foydalanish: node scripts/backup-decrypt.js <fayl.sql.gz.enc> [--check] > zaxira.sql');
if (!raw) fail('BACKUP_ENCRYPTION_KEY muhit o‘zgaruvchisi berilmagan');
if (raw.length < 16) fail('BACKUP_ENCRYPTION_KEY juda qisqa');
if (!fs.existsSync(file)) fail('fayl topilmadi');

const size = fs.statSync(file).size;
const headLen = MAGIC.length + 16 + 12;
if (size < headLen + 16) fail('fayl buzilgan (juda kichik)');
const fd = fs.openSync(file, 'r');
const head = Buffer.alloc(headLen);
const tag = Buffer.alloc(16);
fs.readSync(fd, head, 0, headLen, 0);
fs.readSync(fd, tag, 0, 16, size - 16);
fs.closeSync(fd);
if (!head.subarray(0, MAGIC.length).equals(MAGIC)) fail('bu shifrlangan zaxira fayli emas');

const salt = head.subarray(MAGIC.length, MAGIC.length + 16);
const iv = head.subarray(MAGIC.length + 16);
const key = crypto.scryptSync(raw, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
decipher.setAuthTag(tag);

let bytes = 0;
const out = check
  ? new Writable({ write(c, _e, cb) { bytes += c.length; cb(); } })
  : process.stdout;
pipeline(fs.createReadStream(file, { start: headLen, end: size - 17 }), decipher, zlib.createGunzip(), out, (err) => {
  if (err) fail(/auth|authenticate|bad decrypt/i.test(err.message) ? 'kalit noto‘g‘ri yoki fayl buzilgan' : err.message);
  if (check) process.stderr.write(`OK: fayl butun, ochilgan hajmi ${bytes} bayt\n`);
});