import { isSealed, open, seal, secretBoxReady } from '../../common/crypto/secret-box';
import type { PrismaService } from '../prisma/prisma.service';
import { HR_SHEET, HR_SHEETS } from './hr-sheets.config';

// ═══════════════════════════════════════════════════════════
// Ma'lumotnomalardagi shaxsiy maydonlarni bazada shifrlash (AES-256-GCM, APP_ENCRYPTION_KEY).
//
// Qaysi maydonlar — jadval sozlamasidagi «sensitive» ustunlar:
//   10-jadval: yashash manzili;
//   16-jadval: pasport (seriya, raqam, kim bergan, sana, muddat), telefon, e-pochta, IP, diplom raqami.
// F.I.Sh., JShShIR, lavozim, tuzilma, jins, yosh — shifrlanmaydi (qidiruv va «miya» ular bilan ishlaydi).
//
//  • Yangi yuklangan jadval — kalit bo'lsa, darhol shifrlab saqlanadi.
//  • Avval yuklanganlari — Sozlamalar › Xavfsizlik › «Hozir shifrlash» (oldin zaxira olinadi).
//  • O'qishda ochiladi; ekranda hammasi avvalgidek ko'rinadi.
//  • Kalit yo'q yoki boshqa bo'lsa — maydon o'rnida «[shifrlangan — kalit yo'q]», qolgan ma'lumot ishlayveradi.
// ═══════════════════════════════════════════════════════════

export const LOCKED_TEXT = "[shifrlangan — kalit yo'q]";
const KEYS = HR_SHEETS.flatMap((d) => [`hr.sheet.${d.code}`, `hr.sheet.${d.code}.prev`]);

interface RawSnap {
  code?: unknown;
  cols?: unknown;
  rows?: unknown;
  [k: string]: unknown;
}

/** Shu jadval qatoridagi shaxsiy ustunlar o'rni */
function sensitiveIdx(raw: RawSnap): number[] {
  const def = typeof raw.code === 'string' ? HR_SHEET(raw.code) : undefined;
  if (!def || !Array.isArray(raw.cols)) return [];
  const sens = new Set(def.columns.filter((c) => c.sensitive).map((c) => c.key));
  return (raw.cols as unknown[]).map((k, i) => (typeof k === 'string' && sens.has(k) ? i : -1)).filter((i) => i >= 0);
}

/** Har qiymatga funksiya qo'llab, yangi nusxa (asl obyekt o'zgarmaydi) */
function mapSensitive(raw: RawSnap, fn: (v: string) => string): { value: RawSnap; touched: number } {
  const idx = sensitiveIdx(raw);
  if (!idx.length || !Array.isArray(raw.rows)) return { value: raw, touched: 0 };
  let touched = 0;
  const rows = (raw.rows as unknown[]).map((row) => {
    if (!Array.isArray(row)) return row;
    const copy = [...row];
    for (const i of idx) {
      const v = copy[i];
      if (typeof v !== 'string' || v === '') continue;
      const next = fn(v);
      if (next !== v) {
        copy[i] = next;
        touched += 1;
      }
    }
    return copy;
  });
  return { value: { ...raw, rows }, touched };
}

/** Yozishdan oldin: kalit bo'lsa — shaxsiy maydonlar shifrlanadi (allaqachon shifrlanganiga tegilmaydi) */
export function sealSnapshot<T extends object>(snap: T): T {
  if (!secretBoxReady()) return snap;
  return mapSensitive(snap as RawSnap, (v) => (isSealed(v) ? v : seal(v))).value as T;
}

/** O'qishda: shifrlanganlari ochiladi; kalit bo'lmasa — o'rnida LOCKED_TEXT */
export function openSnapshot<T extends object>(snap: T): { snap: T; locked: number } {
  let locked = 0;
  const { value } = mapSensitive(snap as RawSnap, (v) => {
    if (!isSealed(v)) return v;
    try {
      return open(v);
    } catch {
      locked += 1;
      return LOCKED_TEXT;
    }
  });
  return { snap: value as T, locked };
}

export interface HrCryptoStatus {
  /** APP_ENCRYPTION_KEY sozlanganmi */
  ready: boolean;
  /** Shifrlangan va ochiq shaxsiy qiymatlar soni (joriy va oldingi nusxalar bilan) */
  sealed: number;
  plain: number;
  /** Ochib bo'lmaydiganlar (kalit yo'q yoki boshqa) */
  unreadable: number;
  sheets: { key: string; sealed: number; plain: number }[];
}

/** verify=false — tez: ochib ko'rilmaydi (unreadable faqat kalit yo'qligida sanaladi) */
export async function hrCryptoStatus(prisma: PrismaService, verify = true): Promise<HrCryptoStatus> {
  const rows = await prisma.setting.findMany({ where: { key: { in: KEYS } } });
  const ready = secretBoxReady();
  let sealed = 0;
  let plain = 0;
  let unreadable = 0;
  const sheets: HrCryptoStatus['sheets'] = [];
  for (const r of rows) {
    const raw = r.value as RawSnap;
    let s = 0;
    let p = 0;
    mapSensitive(raw, (v) => {
      if (isSealed(v)) {
        s += 1;
        if (ready && verify) {
          try {
            open(v);
          } catch {
            unreadable += 1;
          }
        } else if (!ready) unreadable += 1;
      } else p += 1;
      return v;
    });
    sealed += s;
    plain += p;
    sheets.push({ key: r.key, sealed: s, plain: p });
  }
  return { ready, sealed, plain, unreadable, sheets: sheets.sort((a, b) => a.key.localeCompare(b.key)) };
}

/**
 * Hamma saqlangan nusxalarni shifrlash. Har qiymat shifrlangach darhol qayta ochib tekshiriladi;
 * birortasi mos kelmasa — hech narsa yozilmaydi. Hammasi bitta tranzaksiyada.
 */
export async function sealAllHr(prisma: PrismaService): Promise<{ sealed: number; sheets: number }> {
  if (!secretBoxReady()) throw new Error("APP_ENCRYPTION_KEY sozlanmagan — shifrlab bo'lmaydi");
  const rows = await prisma.setting.findMany({ where: { key: { in: KEYS } } });
  const updates: { key: string; value: object }[] = [];
  let total = 0;
  for (const r of rows) {
    const { value, touched } = mapSensitive(r.value as RawSnap, (v) => {
      if (isSealed(v)) return v;
      const s = seal(v);
      if (open(s) !== v) throw new Error('Shifrlash tekshiruvdan o‘tmadi — hech narsa yozilmadi');
      return s;
    });
    if (touched) {
      updates.push({ key: r.key, value: value as object });
      total += touched;
    }
  }
  if (updates.length) {
    await prisma.$transaction(async (tx) => {
      for (const u of updates) await tx.setting.update({ where: { key: u.key }, data: { value: u.value } });
    });
  }
  return { sealed: total, sheets: updates.length };
}

/** Orqaga qaytarish: shifrlanganlarni ochiq holga (kalit kerak; ochib bo'lmasa — hech narsa yozilmaydi) */
export async function unsealAllHr(prisma: PrismaService): Promise<{ opened: number; sheets: number }> {
  if (!secretBoxReady()) throw new Error("APP_ENCRYPTION_KEY sozlanmagan — ochib bo'lmaydi");
  const rows = await prisma.setting.findMany({ where: { key: { in: KEYS } } });
  const updates: { key: string; value: object }[] = [];
  let total = 0;
  for (const r of rows) {
    const { value, touched } = mapSensitive(r.value as RawSnap, (v) => (isSealed(v) ? open(v) : v));
    if (touched) {
      updates.push({ key: r.key, value: value as object });
      total += touched;
    }
  }
  if (updates.length) {
    await prisma.$transaction(async (tx) => {
      for (const u of updates) await tx.setting.update({ where: { key: u.key }, data: { value: u.value } });
    });
  }
  return { opened: total, sheets: updates.length };
}