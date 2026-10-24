import { BadRequestException } from '@nestjs/common';
import { inflateRaw } from 'node:zlib';
import { promisify } from 'node:util';

// ═══════════════════════════════════════════════════════════
// Excel (.xlsx) faylini ochishdan oldin xavfsizlik tekshiruvi — «ZIP bomba»ga qarshi.
//
// .xlsx — bu ZIP arxiv. 5 MB fayl ichida ochilganda gigabaytlab ma'lumot bo'lishi mumkin
// va server xotirasi tugab, tizim to'xtaydi. Shuning uchun Excel kutubxonasiga berishdan oldin:
//  1) arxiv katalogi o'qiladi: yozuvlar soni, ZIP64, shifrlangan yozuvlar;
//  2) har bir yozuv HAQIQATAN ochib ko'riladi, lekin umumiy hajm chegarasi bilan —
//     sarlavhada yolg'on hajm yozilgan bo'lsa ham, chegaradan oshgan zahoti to'xtatiladi.
// Oddiy hisobot fayllari (ichida 0,2–3 MB) bu chegaralarga yaqinlashmaydi ham.
// ═══════════════════════════════════════════════════════════

/** Ochilgandagi umumiy hajm chegarasi — 150 MB (oddiy .xlsx ~ 6 baravar kattalashadi) */
export const XLSX_MAX_UNPACKED = 150 * 1024 * 1024;
/** Arxivdagi yozuvlar soni chegarasi */
export const XLSX_MAX_ENTRIES = 5000;

const inflate = promisify(inflateRaw) as (buf: Buffer, opts: { maxOutputLength: number }) => Promise<Buffer>;

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

function bad(msg: string): never {
  throw new BadRequestException(msg);
}

/**
 * Xavfli yoki buzilgan .xlsx bo'lsa — BadRequest. Yaroqli bo'lsa — hech narsa qaytarmaydi.
 * Excel kutubxonasi (exceljs) chaqirilishidan OLDIN ishlatiladi.
 */
export async function assertSafeXlsx(input: unknown, limits: { maxUnpacked?: number; maxEntries?: number } = {}): Promise<void> {
  const maxUnpacked = limits.maxUnpacked ?? XLSX_MAX_UNPACKED;
  const maxEntries = limits.maxEntries ?? XLSX_MAX_ENTRIES;
  const buf = Buffer.isBuffer(input) ? input : input instanceof Uint8Array ? Buffer.from(input.buffer, input.byteOffset, input.byteLength) : input instanceof ArrayBuffer ? Buffer.from(input) : null;
  if (!buf || buf.length < 22) bad("Faylni o'qib bo'lmadi — fayl bo'sh yoki Excel (.xlsx) emas");
  if (buf.readUInt32LE(0) === 0xe011cfd0) bad("Faylni o'qib bo'lmadi — u eski .xls formatida yoki parol bilan himoyalangan. Excel'da parolsiz «.xlsx» qilib saqlang");
  if (buf.readUInt32LE(0) !== SIG_LOC) bad("Faylni o'qib bo'lmadi — u Excel (.xlsx) fayli emas. Boshqa format bo'lsa, Excel'da «.xlsx» qilib saqlang");

  // 1) Katalog oxiri (EOCD) — faylning oxirgi 64 KB ichida
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) bad("Faylni o'qib bo'lmadi — fayl buzilgan yoki chala yuklangan");
  const entries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) bad("Fayl juda katta (ZIP64) — qabul qilinmaydi");
  if (entries === 0) bad("Faylni o'qib bo'lmadi — Excel fayli bo'sh");
  if (entries > maxEntries) bad(`Faylda juda ko'p ichki qism (${entries}) — qabul qilinmaydi`);
  if (cdOffset + cdSize > buf.length) bad("Faylni o'qib bo'lmadi — fayl buzilgan");

  // 2) Har bir yozuv: katalogdan joyi, keyin haqiqiy ochish (umumiy chegara bilan)
  let p = cdOffset;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CEN) bad("Faylni o'qib bo'lmadi — fayl buzilgan");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    p += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x1) bad("Faylni o'qib bo'lmadi — fayl parol bilan himoyalangan, parolsiz saqlab yuklang");
    if (csize === 0xffffffff || usize === 0xffffffff || local === 0xffffffff) bad("Fayl juda katta (ZIP64) — qabul qilinmaydi");
    if (usize > maxUnpacked || total + usize > maxUnpacked) bad(tooBig(maxUnpacked));

    if (local + 30 > buf.length || buf.readUInt32LE(local) !== SIG_LOC) bad("Faylni o'qib bo'lmadi — fayl buzilgan");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + csize > buf.length) bad("Faylni o'qib bo'lmadi — fayl chala yuklangan");
    const data = buf.subarray(start, start + csize);

    let real: number;
    if (method === 0) {
      real = csize; // siqilmagan
    } else if (method === 8) {
      const budget = maxUnpacked - total;
      try {
        real = (await inflate(data, { maxOutputLength: Math.max(1, budget) })).length;
      } catch (e) {
        if ((e as { code?: string })?.code === 'ERR_BUFFER_TOO_LARGE' || e instanceof RangeError) bad(tooBig(maxUnpacked));
        bad("Faylni o'qib bo'lmadi — fayl buzilgan");
      }
    } else {
      bad("Faylni o'qib bo'lmadi — odatdagi Excel formatida emas");
    }
    total += real;
    if (total > maxUnpacked) bad(tooBig(maxUnpacked));
  }
}

function tooBig(max: number): string {
  return `Fayl ochilganda juda katta (${Math.round(max / 1024 / 1024)} MB dan ortiq) — qabul qilinmaydi. Ortiqcha varaq va formatlarni olib tashlab qayta yuklang`;
}