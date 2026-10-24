import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

// ═══════════════════════════════════════════════════════════
// Maxfiy qiymatlarni bazada shifrlab saqlash (AES-256-GCM).
//
// Kalit — muhitdagi APP_ENCRYPTION_KEY (kamida 32 belgi; masalan: openssl rand -base64 48).
// Kalit kod va bazada saqlanmaydi. U yo'qolsa, shifrlangan qiymatlarni ochib bo'lmaydi —
// nusxasini server tashqarisida (parol menejeri, seyf) saqlang.
//
// Format: "enc:v1:" + base64url(iv[12] | shifrlangan matn | tag[16]).
// Eski (ochiq) qiymatlar ham o'qiladi — kalit qo'yilgach, qayta saqlanganda shifrlanadi.
// ═══════════════════════════════════════════════════════════

const PREFIX = 'enc:v1:';
let cached: { raw: string; key: Buffer } | null = null;

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretBoxError';
  }
}

/** Kalit (har chaqiruvda muhitdan; o'zgarmagan bo'lsa — keshdan) */
function key(): Buffer | null {
  const raw = process.env.APP_ENCRYPTION_KEY ?? '';
  if (!raw) return null;
  if (raw.length < 32) throw new SecretBoxError('APP_ENCRYPTION_KEY juda qisqa — kamida 32 belgi bo‘lsin');
  if (cached?.raw === raw) return cached.key;
  const k = Buffer.from(hkdfSync('sha256', Buffer.from(raw, 'utf8'), Buffer.from('korxona-tahlil'), Buffer.from('secret-box:v1'), 32));
  cached = { raw, key: k };
  return k;
}

/** Shifrlash kaliti sozlanganmi */
export function secretBoxReady(): boolean {
  try {
    return key() !== null;
  } catch {
    return false;
  }
}

export function isSealed(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/** Shifrlash. Kalit sozlanmagan bo'lsa — qiymat o'zgarishsiz qaytadi (eski xatti-harakat) */
export function seal(plain: string): string {
  const k = key();
  if (!k) return plain;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, body, c.getAuthTag()]).toString('base64url');
}

/** Ochish. Shifrlanmagan (eski) qiymat — o'zi qaytadi */
export function open(value: string): string {
  if (!isSealed(value)) return value;
  const k = key();
  if (!k) throw new SecretBoxError('Qiymat shifrlangan, lekin APP_ENCRYPTION_KEY sozlanmagan');
  const buf = Buffer.from(value.slice(PREFIX.length), 'base64url');
  if (buf.length < 12 + 16) throw new SecretBoxError('Shifrlangan qiymat buzilgan');
  const d = createDecipheriv('aes-256-gcm', k, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(buf.length - 16));
  try {
    return Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]).toString('utf8');
  } catch {
    throw new SecretBoxError('Shifrlangan qiymatni ochib bo‘lmadi — APP_ENCRYPTION_KEY boshqa (almashtirilgan?)');
  }
}