import { BadRequestException } from '@nestjs/common';
import { createInflateRaw, inflateRawSync } from 'node:zlib';
import { Readable } from 'node:stream';

// ═══════════════════════════════════════════════════════════
// Katta .xlsx fayllarni oqim bilan o'qish (Didox / soliq.uz reyestrlari kabi: ichida 1 GB gacha varaq, lekin
// ma'lumot — bir necha ming qator, qolgani bo'sh formatlangan qatorlar).
//  • ZIP katalogi o'zimiz o'qiladi (ZIP64, shifrlangan, juda ko'p yozuv — rad);
//  • sharedStrings — to'liq (chegara bilan), varaq — OQIM bilan: qator-qator, bo'sh qatorlar ketma-ket ko'p
//    bo'lsa (ma'lumot tugagan) — to'xtatiladi; chegaralar: ochilgan hajm, qatorlar soni, bitta qator hajmi.
//  • Natija: har qator — ustun raqami → qiymat (matn yoki son).
// ═══════════════════════════════════════════════════════════

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

export interface StreamLimits {
  /** Ma'lumot tugagandan keyin ketma-ket bo'sh qatorlar — shuncha bo'lsa to'xtaydi */
  stopAfterEmpty?: number;
  /** Ma'lumotli qatorlar chegarasi */
  maxRows?: number;
  /** Varaqdan ochiladigan eng ko'p hajm (bayt) */
  maxSheetBytes?: number;
  /** sharedStrings eng ko'p hajmi */
  maxStringsBytes?: number;
}

interface Entry {
  name: string;
  method: number;
  csize: number;
  usize: number;
  dataStart: number;
}

function bad(msg: string): never {
  throw new BadRequestException(msg);
}

function entries(buf: Buffer): Map<string, Entry> {
  if (buf.length < 22 || buf.readUInt32LE(0) !== SIG_LOC) bad("Faylni o'qib bo'lmadi — u Excel (.xlsx) fayli emas");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) bad("Faylni o'qib bo'lmadi — fayl buzilgan yoki chala yuklangan");
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) bad('Fayl juda katta (ZIP64) — qabul qilinmaydi');
  if (count > 5000) bad("Faylda juda ko'p ichki qism — qabul qilinmaydi");
  if (cdOffset + cdSize > buf.length) bad("Faylni o'qib bo'lmadi — fayl buzilgan");
  const out = new Map<string, Entry>();
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CEN) bad("Faylni o'qib bo'lmadi — fayl buzilgan");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (flags & 0x1) bad("Fayl parol bilan himoyalangan — parolsiz saqlab yuklang");
    if (method !== 0 && method !== 8) bad("Faylni o'qib bo'lmadi — noma'lum siqish usuli");
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== SIG_LOC) bad("Faylni o'qib bo'lmadi — fayl buzilgan");
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (dataStart + csize > buf.length) bad("Faylni o'qib bo'lmadi — fayl buzilgan");
    out.set(name.replace(/^\/+/, ''), { name, method, csize, usize, dataStart });
  }
  return out;
}

/** Kichik ichki fayl (workbook.xml, sharedStrings.xml) — to'liq, hajm chegarasi bilan */
function readSmall(buf: Buffer, e: Entry, max: number): string {
  const raw = buf.subarray(e.dataStart, e.dataStart + e.csize);
  if (e.method === 0) {
    if (raw.length > max) bad('Faylning ichki qismi juda katta');
    return raw.toString('utf8');
  }
  try {
    return inflateRawSync(raw, { maxOutputLength: max }).toString('utf8');
  } catch {
    bad('Faylning ichki qismi juda katta yoki buzilgan');
  }
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function xmlText(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }
    return ENT[e.toLowerCase()] ?? '';
  });
}

/** <si> ichidagi hamma <t> (rich text bo'laklari ham) */
function siText(si: string): string {
  let out = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let m: RegExpExecArray | null;
  // Fonetik (rPh) qismlari tashlanadi
  const clean = si.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  while ((m = re.exec(clean))) out += m[1] ?? '';
  return xmlText(out);
}

function sharedStrings(buf: Buffer, map: Map<string, Entry>, max: number): string[] {
  const e = map.get('xl/sharedStrings.xml');
  if (!e) return [];
  const xml = readSmall(buf, e, max);
  const out: string[] = [];
  const re = /<si>([\s\S]*?)<\/si>|<si\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(siText(m[1] ?? ''));
  return out;
}

/** Birinchi varaq yo'li (workbook.xml + rels), topilmasa — xl/worksheets/sheet1.xml */
function firstSheet(buf: Buffer, map: Map<string, Entry>): string {
  const wb = map.get('xl/workbook.xml');
  const rels = map.get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const w = readSmall(buf, wb, 8 * 1024 * 1024);
    const r = readSmall(buf, rels, 2 * 1024 * 1024);
    const sheet = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(w) ?? /<sheet\b[^>]*\bid="([^"]+)"/.exec(w);
    if (sheet) {
      const rel = new RegExp(`<Relationship\\b[^>]*\\bId="${sheet[1]!.replace(/[^\w]/g, '')}"[^>]*\\bTarget="([^"]+)"`).exec(r) ?? new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${sheet[1]!.replace(/[^\w]/g, '')}"`).exec(r);
      if (rel) {
        const t = rel[1]!.replace(/^\/+/, '');
        const path = t.startsWith('xl/') ? t : `xl/${t}`;
        if (map.has(path)) return path;
      }
    }
  }
  const any = [...map.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (!any.length) bad('Faylda varaq topilmadi');
  return any[0]!;
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n;
}

export type StreamRow = { row: number; cells: Map<number, string | number> };

const CELL_RE = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

function parseRow(xml: string, rowNo: number, strings: string[]): StreamRow {
  const cells = new Map<number, string | number>();
  let m: RegExpExecArray | null;
  CELL_RE.lastIndex = 0;
  let auto = 0;
  while ((m = CELL_RE.exec(xml))) {
    const attrs = m[1] ?? '';
    const inner = m[2];
    auto += 1;
    if (!inner) continue;
    const ref = /\br="([A-Z]+)\d*"/.exec(attrs)?.[1];
    const col = ref ? colIndex(ref) : auto;
    const t = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
    let val: string | number | null = null;
    if (t === 'inlineStr') {
      const is = /<is>([\s\S]*?)<\/is>/.exec(inner);
      val = is ? siText(is[1]!) : '';
    } else {
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
      if (!v) continue;
      const raw = v[1]!;
      if (t === 's') val = strings[Number(raw)] ?? '';
      else if (t === 'str' || t === 'e') val = xmlText(raw);
      else if (t === 'b') val = raw === '1' ? 'TRUE' : 'FALSE';
      else {
        const num = Number(raw);
        val = Number.isFinite(num) ? num : xmlText(raw);
      }
    }
    if (val === null || val === '') continue;
    cells.set(col, val);
  }
  return { row: rowNo, cells };
}

/**
 * Birinchi varaq qatorlari (faqat qiymatli kataklar bilan). Bo'sh qatorlar qaytarilmaydi.
 * Ma'lumot boshlangandan keyin ketma-ket stopAfterEmpty ta bo'sh qator — to'xtaydi.
 */
export async function readSheetRows(input: Buffer, limits: StreamLimits = {}): Promise<{ rows: StreamRow[]; truncated: boolean }> {
  const stopAfterEmpty = limits.stopAfterEmpty ?? 3000;
  const maxRows = limits.maxRows ?? 60000;
  const maxSheetBytes = limits.maxSheetBytes ?? 4 * 1024 * 1024 * 1024;
  const map = entries(input);
  const strings = sharedStrings(input, map, limits.maxStringsBytes ?? 64 * 1024 * 1024);
  const sheet = map.get(firstSheet(input, map))!;
  const raw = input.subarray(sheet.dataStart, sheet.dataStart + sheet.csize);
  const source = Readable.from([raw]);
  const stream = sheet.method === 0 ? source : source.pipe(createInflateRaw({ chunkSize: 256 * 1024 }));

  const rows: StreamRow[] = [];
  let pending = '';
  let total = 0;
  let empty = 0;
  let truncated = false;
  let done = false;
  let rowAuto = 0;
  const finish = () => {
    done = true;
    stream.destroy();
    if (stream !== source) source.destroy();
  };
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      total += chunk.length;
      if (total > maxSheetBytes) bad('Fayl varag‘i juda katta — qabul qilinmaydi');
      pending += chunk.toString('utf8');
      // To'liq qatorlar: <row …/> yoki <row …>…</row>
      let pos = 0;
      for (;;) {
        const start = pending.indexOf('<row', pos);
        if (start < 0) {
          pos = Math.max(pos, pending.length - 8);
          break;
        }
        const openEnd = pending.indexOf('>', start);
        if (openEnd < 0) {
          pos = start;
          break;
        }
        const open = pending.slice(start, openEnd + 1);
        let xml: string;
        let next: number;
        if (open.endsWith('/>')) {
          xml = '';
          next = openEnd + 1;
        } else {
          const close = pending.indexOf('</row>', openEnd);
          if (close < 0) {
            pos = start;
            break;
          }
          xml = pending.slice(openEnd + 1, close);
          next = close + 6;
        }
        rowAuto += 1;
        const rowNo = Number(/\br="(\d+)"/.exec(open)?.[1] ?? rowAuto);
        const hasValue = xml.includes('<v>') || xml.includes('<is>');
        if (hasValue) {
          const r = parseRow(xml, rowNo, strings);
          if (r.cells.size) {
            rows.push(r);
            empty = 0;
            if (rows.length >= maxRows) {
              truncated = true;
              finish();
              break;
            }
          } else if (rows.length) empty += 1;
        } else if (rows.length) empty += 1;
        if (rows.length && empty >= stopAfterEmpty) {
          finish();
          break;
        }
        pos = next;
      }
      if (done) break;
      pending = pending.slice(pos);
      if (pending.length > 8 * 1024 * 1024) bad("Fayldagi bitta qator juda katta — fayl buzilgan bo'lishi mumkin");
      if (pending.includes('</sheetData>')) break;
    }
  } catch (e) {
    if (e instanceof BadRequestException) throw e;
    if (!done) bad("Faylni o'qib bo'lmadi — fayl buzilgan yoki chala yuklangan");
  }
  return { rows, truncated };
}
