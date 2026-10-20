// ═══════════════════════════════════════════════════════════
// Eski Excel (.xls, BIFF8) o'quvchi — tashqi kutubxonasiz.
// 1C, AZS va bank tizimlari hisobotlarni ko'pincha .xls da beradi; exceljs faqat .xlsx ni o'qiydi.
// Faqat qiymatlar o'qiladi (matn, son, formula natijasi); format, rang, birlashgan kataklar — yo'q.
// Tuzilma: CFB (OLE2) konteyner → «Workbook» oqimi → BIFF yozuvlari.
// ═══════════════════════════════════════════════════════════

export type XlsCell = string | number | boolean | null;

export interface XlsSheet {
  name: string;
  rows: XlsCell[][];
}

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;

export function isXls(buffer: Buffer): boolean {
  return buffer.length >= 512 && SIGNATURE.every((b, i) => buffer[i] === b);
}

// ─────────── CFB konteyner ───────────

function readStream(buf: Buffer, names: string[]): Buffer {
  const sectorShift = buf.readUInt16LE(30);
  const miniShift = buf.readUInt16LE(32);
  const sectorSize = 1 << sectorShift;
  const miniSize = 1 << miniShift;
  const dirStart = buf.readUInt32LE(48);
  const miniCutoff = buf.readUInt32LE(56);
  const miniFatStart = buf.readUInt32LE(60);
  const miniFatCount = buf.readUInt32LE(64);
  let difatStart = buf.readUInt32LE(68);
  const difatCount = buf.readUInt32LE(72);

  const sectorOffset = (s: number) => (s + 1) * sectorSize;
  // DIFAT → FAT sektorlari
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    const s = buf.readUInt32LE(76 + i * 4);
    if (s !== FREESECT) fatSectors.push(s);
  }
  for (let n = 0; n < difatCount && difatStart !== ENDOFCHAIN && difatStart !== FREESECT; n++) {
    const off = sectorOffset(difatStart);
    const per = sectorSize / 4 - 1;
    for (let i = 0; i < per; i++) {
      const s = buf.readUInt32LE(off + i * 4);
      if (s !== FREESECT) fatSectors.push(s);
    }
    difatStart = buf.readUInt32LE(off + per * 4);
  }
  const fat: number[] = [];
  for (const s of fatSectors) {
    const off = sectorOffset(s);
    if (off + sectorSize > buf.length) break;
    for (let i = 0; i < sectorSize / 4; i++) fat.push(buf.readUInt32LE(off + i * 4));
  }
  const chain = (start: number, table: number[]): number[] => {
    const out: number[] = [];
    const seen = new Set<number>();
    let s = start;
    while (s !== ENDOFCHAIN && s !== FREESECT && s < table.length && !seen.has(s)) {
      seen.add(s);
      out.push(s);
      s = table[s]!;
    }
    return out;
  };
  const readChain = (start: number, size?: number): Buffer => {
    const parts = chain(start, fat).map((s) => buf.subarray(sectorOffset(s), Math.min(buf.length, sectorOffset(s) + sectorSize)));
    const all = Buffer.concat(parts);
    return size === undefined ? all : all.subarray(0, size);
  };

  // Katalog
  const dir = readChain(dirStart);
  interface Entry {
    name: string;
    type: number;
    start: number;
    size: number;
  }
  const entries: Entry[] = [];
  for (let off = 0; off + 128 <= dir.length; off += 128) {
    const nameLen = dir.readUInt16LE(off + 64);
    const name = dir.toString('utf16le', off, off + Math.max(0, nameLen - 2));
    entries.push({ name, type: dir[off + 66]!, start: dir.readUInt32LE(off + 116), size: dir.readUInt32LE(off + 120) });
  }
  const root = entries.find((e) => e.type === 5);
  const entry = entries.find((e) => e.type === 2 && names.some((n) => n.toLowerCase() === e.name.toLowerCase()));
  if (!entry) throw new Error("Faylda Excel ma'lumoti (Workbook) topilmadi");

  if (entry.size >= miniCutoff || !root) return readChain(entry.start, entry.size);
  // Kichik oqim — mini FAT orqali
  const miniFat: number[] = [];
  const mf = chain(miniFatStart, fat).slice(0, miniFatCount || undefined);
  for (const s of mf) {
    const off = sectorOffset(s);
    for (let i = 0; i < sectorSize / 4; i++) miniFat.push(buf.readUInt32LE(off + i * 4));
  }
  const miniStream = readChain(root.start, root.size);
  const parts = chain(entry.start, miniFat).map((s) => miniStream.subarray(s * miniSize, s * miniSize + miniSize));
  return Buffer.concat(parts).subarray(0, entry.size);
}

// ─────────── BIFF8 ───────────

function rkValue(rk: number): number {
  let v: number;
  if (rk & 2) {
    v = rk >> 2;
  } else {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(0, 0);
    b.writeUInt32LE((rk & 0xfffffffc) >>> 0, 4);
    v = b.readDoubleLE(0);
  }
  return rk & 1 ? v / 100 : v;
}

/** Bir nechta CONTINUE ga bo'lingan yozuv ma'lumoti: chegaralari bilan (SST satrlari uchun) */
class Chunks {
  private i = 0;
  private pos = 0;
  constructor(private readonly parts: Buffer[]) {}
  private get cur(): Buffer {
    return this.parts[this.i]!;
  }
  get done(): boolean {
    return this.i >= this.parts.length || (this.i === this.parts.length - 1 && this.pos >= this.cur.length);
  }
  private ensure() {
    while (this.i < this.parts.length && this.pos >= this.cur.length) {
      this.i += 1;
      this.pos = 0;
    }
  }
  u8(): number {
    this.ensure();
    return this.cur[this.pos++]!;
  }
  u16(): number {
    return this.u8() | (this.u8() << 8);
  }
  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }
  skip(n: number) {
    for (let k = 0; k < n; k++) this.u8();
  }
  /** Belgilar: CONTINUE chegarasida yangi «yuqori bayt» bayrog'i keladi */
  chars(count: number, high: boolean): string {
    let out = '';
    let wide = high;
    let left = count;
    while (left > 0) {
      if (this.pos >= this.cur.length) {
        this.i += 1;
        this.pos = 0;
        if (this.i >= this.parts.length) break;
        wide = (this.cur[this.pos++]! & 1) === 1;
      }
      const avail = Math.floor((this.cur.length - this.pos) / (wide ? 2 : 1));
      const take = Math.min(left, avail);
      if (take <= 0) {
        this.pos = this.cur.length;
        continue;
      }
      out += wide ? this.cur.toString('utf16le', this.pos, this.pos + take * 2) : this.cur.toString('latin1', this.pos, this.pos + take);
      this.pos += take * (wide ? 2 : 1);
      left -= take;
    }
    return out;
  }
}

function readSst(parts: Buffer[]): string[] {
  const c = new Chunks(parts);
  c.u32();
  const unique = c.u32();
  const out: string[] = [];
  for (let n = 0; n < unique && !c.done; n++) {
    const cch = c.u16();
    const flags = c.u8();
    const runs = flags & 0x08 ? c.u16() : 0;
    const ext = flags & 0x04 ? c.u32() : 0;
    out.push(c.chars(cch, (flags & 1) === 1));
    c.skip(runs * 4 + ext);
  }
  return out;
}

/** Oddiy satr (LABEL, STRING, BOUNDSHEET): uzunlik + bayroq + belgilar */
function shortString(b: Buffer, off: number, lenBytes: 1 | 2): string {
  const cch = lenBytes === 1 ? b[off]! : b.readUInt16LE(off);
  const flags = b[off + lenBytes]!;
  const start = off + lenBytes + 1;
  return flags & 1 ? b.toString('utf16le', start, start + cch * 2) : b.toString('latin1', start, start + cch);
}

/** Kod sahifasi 1251 (BIFF5 va LABEL ning bir baytli matnlari uchun) — kirill */
function cp1251(s: string): string {
  if (!/[\x80-\xff]/.test(s)) return s;
  const T = 'ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—\u0098™љ›њќћџ ЎўЈ¤Ґ¦§Ё©Є«¬­®Ї°±Ііґµ¶·ё№є»јЅѕї';
  return [...s]
    .map((ch) => {
      const c = ch.charCodeAt(0);
      if (c < 0x80) return ch;
      if (c >= 0xc0) return String.fromCharCode(0x410 + c - 0xc0);
      return T[c - 0x80] ?? ch;
    })
    .join('');
}

export function readXls(buffer: Buffer): XlsSheet[] {
  if (!isXls(buffer)) throw new Error('Bu .xls (Excel 97–2003) fayli emas');
  const wb = readStream(buffer, ['Workbook', 'Book']);
  const sheetsMeta: { name: string; pos: number }[] = [];
  let sst: string[] = [];
  let codepage = 1252;

  // 1) Kitob global qismi: varaqlar, SST
  let off = 0;
  const recordAt = (o: number) => ({ type: wb.readUInt16LE(o), len: wb.readUInt16LE(o + 2) });
  while (off + 4 <= wb.length) {
    const { type, len } = recordAt(off);
    const data = wb.subarray(off + 4, off + 4 + len);
    if (type === 0x002f) throw new Error('Fayl parol bilan himoyalangan — parolsiz saqlab yuklang');
    if (type === 0x0042) codepage = data.readUInt16LE(0);
    if (type === 0x0085) sheetsMeta.push({ pos: data.readUInt32LE(0), name: shortString(data, 6, 1) });
    if (type === 0x00fc) {
      const parts = [data];
      let next = off + 4 + len;
      while (next + 4 <= wb.length && wb.readUInt16LE(next) === 0x003c) {
        const l = wb.readUInt16LE(next + 2);
        parts.push(wb.subarray(next + 4, next + 4 + l));
        next += 4 + l;
      }
      sst = readSst(parts);
    }
    off += 4 + len;
    if (type === 0x000a) break; // global EOF
  }
  const fix = (s: string) => (codepage === 1251 ? cp1251(s) : s);

  // 2) Har varaq
  return sheetsMeta.map(({ name, pos }) => {
    const rows: XlsCell[][] = [];
    const set = (r: number, c: number, v: XlsCell) => {
      if (r > 200000 || c > 1000) return;
      (rows[r] ??= [])[c] = v;
    };
    let o = pos;
    let pendingFormula: { r: number; c: number } | null = null;
    while (o + 4 <= wb.length) {
      const { type, len } = recordAt(o);
      const d = wb.subarray(o + 4, o + 4 + len);
      o += 4 + len;
      if (type === 0x000a) break;
      switch (type) {
        case 0x00fd: // LABELSST
          set(d.readUInt16LE(0), d.readUInt16LE(2), sst[d.readUInt32LE(6)] ?? '');
          break;
        case 0x0204: // LABEL
          set(d.readUInt16LE(0), d.readUInt16LE(2), fix(shortString(d, 6, 2)));
          break;
        case 0x0203: // NUMBER
          set(d.readUInt16LE(0), d.readUInt16LE(2), d.readDoubleLE(6));
          break;
        case 0x027e: // RK
          set(d.readUInt16LE(0), d.readUInt16LE(2), rkValue(d.readUInt32LE(6)));
          break;
        case 0x00bd: {
          // MULRK
          const r = d.readUInt16LE(0);
          const first = d.readUInt16LE(2);
          const n = (len - 6) / 6;
          for (let k = 0; k < n; k++) set(r, first + k, rkValue(d.readUInt32LE(4 + k * 6 + 2)));
          break;
        }
        case 0x0205: // BOOLERR
          set(d.readUInt16LE(0), d.readUInt16LE(2), d[7] === 0 ? Boolean(d[6]) : null);
          break;
        case 0x0006: {
          // FORMULA — natijasi
          const r = d.readUInt16LE(0);
          const c = d.readUInt16LE(2);
          if (d.readUInt16LE(12) === 0xffff) {
            const kind = d[6];
            if (kind === 0) pendingFormula = { r, c };
            else if (kind === 1) set(r, c, Boolean(d[8]));
            else set(r, c, null);
          } else set(r, c, d.readDoubleLE(6));
          break;
        }
        case 0x0207: // STRING (formula matni)
          if (pendingFormula) {
            set(pendingFormula.r, pendingFormula.c, fix(shortString(d, 0, 2)));
            pendingFormula = null;
          }
          break;
        default:
          break;
      }
    }
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
    return { name, rows: rows.map((r) => Array.from({ length: width }, (_, i) => (r[i] === undefined ? null : r[i]!))) };
  });
}