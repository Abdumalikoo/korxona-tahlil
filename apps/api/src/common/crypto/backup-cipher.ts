import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open as openFile, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform, Writable, type Readable } from 'node:stream';
import { createGunzip, createGzip } from 'node:zlib';
import { promisify } from 'node:util';

// ═══════════════════════════════════════════════════════════
// Zaxira faylini shifrlash: pg_dump → gzip → AES-256-GCM → .sql.gz.enc
// Ochiq SQL diskka umuman yozilmaydi.
//
// Kalit — muhitdagi BACKUP_ENCRYPTION_KEY (parol iborasi, kamida 16 belgi).
// Har fayl uchun alohida tuz (scrypt) va iv. Fayl tuzilishi:
//   "KTBK1\n" (6) | tuz (16) | iv (12) | shifrlangan gzip | tag (16)
// Ochish: node scripts/backup-decrypt.js <fayl> > zaxira.sql  (kalit o'sha muhit o'zgaruvchisidan)
// KALIT YO'QOLSA — ZAXIRANI OCHIB BO'LMAYDI. Nusxasini server tashqarisida saqlang.
// ═══════════════════════════════════════════════════════════

export const BACKUP_MAGIC = Buffer.from('KTBK1\n');
export const BACKUP_EXT = '.sql.gz.enc';
const scrypt = promisify(scryptCb) as (p: string, s: Buffer, n: number, o: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const KDF = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function backupKeyRaw(): string | null {
  const raw = process.env.BACKUP_ENCRYPTION_KEY ?? '';
  return raw ? raw : null;
}

export function assertBackupKey(raw: string): void {
  if (raw.length < 16) throw new Error('BACKUP_ENCRYPTION_KEY juda qisqa — kamida 16 belgi bo‘lsin');
}

async function derive(raw: string, salt: Buffer): Promise<Buffer> {
  assertBackupKey(raw);
  return scrypt(raw, salt, 32, KDF);
}

/**
 * Shifrlangan faylni tayyorlash: kalit hisoblanadi va fayl ochiladi, keyin oqim DARHOL ulanadi.
 * (pg_dump ishga tushishidan oldin chaqiriladi — birinchi baytlar yo'qolmasin.)
 */
export async function prepareEncryptedFile(filePath: string, raw: string): Promise<{ pipeFrom: (source: Readable) => Promise<void> }> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', await derive(raw, salt), iv);
  const out = createWriteStream(filePath, { mode: 0o600 });
  await new Promise<void>((resolve, reject) => {
    out.once('open', () => resolve());
    out.once('error', reject);
  });
  out.write(Buffer.concat([BACKUP_MAGIC, salt, iv]));
  // Oxirgi bo'lakdan keyin autentifikatsiya tegi qo'shiladi
  const tagger = new Transform({
    transform(chunk, _enc, cb) {
      cb(null, chunk);
    },
    flush(cb) {
      cb(null, cipher.getAuthTag());
    },
  });
  return { pipeFrom: (source: Readable) => pipeline(source, createGzip({ level: 6 }), cipher, tagger, out) };
}

/** Oqimni shifrlab faylga yozish (oqim hali o'qilmagan bo'lishi kerak) */
export async function encryptToFile(source: Readable, filePath: string, raw: string): Promise<void> {
  source.pause();
  const target = await prepareEncryptedFile(filePath, raw);
  await target.pipeFrom(source);
}

/** Shifrlangan zaxirani ochib, oqimga (stdout yoki fayl) yozish. Buzilgan yoki boshqa kalit — xato */
export async function decryptFile(filePath: string, raw: string, target: Writable): Promise<void> {
  const size = (await stat(filePath)).size;
  const head = Buffer.alloc(BACKUP_MAGIC.length + 16 + 12);
  const tag = Buffer.alloc(16);
  const fh = await openFile(filePath, 'r');
  try {
    if (size < head.length + 16) throw new Error('Zaxira fayli buzilgan (juda kichik)');
    await fh.read(head, 0, head.length, 0);
    await fh.read(tag, 0, 16, size - 16);
  } finally {
    await fh.close();
  }
  if (!head.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) throw new Error('Bu shifrlangan zaxira fayli emas');
  const salt = head.subarray(BACKUP_MAGIC.length, BACKUP_MAGIC.length + 16);
  const iv = head.subarray(BACKUP_MAGIC.length + 16);
  const decipher = createDecipheriv('aes-256-gcm', await derive(raw, salt), iv);
  decipher.setAuthTag(tag);
  try {
    await pipeline(createReadStream(filePath, { start: head.length, end: size - 17 }), decipher, createGunzip(), target);
  } catch (e) {
    const m = (e as Error).message ?? '';
    if (/auth|unable to authenticate|bad decrypt/i.test(m)) throw new Error('Zaxirani ochib bo‘lmadi — kalit noto‘g‘ri yoki fayl buzilgan');
    throw e;
  }
}

/** Tekshiruv: fayl to'liq ochiladimi (natija tashlab yuboriladi). Ochilgan hajm (bayt) qaytadi */
export async function verifyEncrypted(filePath: string, raw: string): Promise<number> {
  let bytes = 0;
  const sink = new Writable({
    write(chunk: Buffer, _e, cb) {
      bytes += chunk.length;
      cb();
    },
  });
  await decryptFile(filePath, raw, sink);
  return bytes;
}