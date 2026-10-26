import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { StreamRow } from '../../common/files/xlsx-stream';

// ═══════════════════════════════════════════════════════════
// Schyot-faktura reyestri (Didox / soliq.uz «Счет-фактура» eksporti) o'qish.
// Shakl: har faktura — sarlavha qatori (ID, holat, raqam, sana, shartnoma, sotuvchi, xaridor) va uning tovar/xizmat
// qatorlari (№, izoh, IKPU, o'lchov, miqdor, narx, summa, QQS); ko'p qatorli fakturada «Общ.» — jami qatori.
// Faqat faktura jami qatori bo'lsa (qatorlarsiz) — bitta qator sifatida olinadi.
// Summa — «Стоимость поставки с учётом НДС» (QQS bilan). Hisob raqamlari, imzolovchi va IP — o'qilmaydi.
// ═══════════════════════════════════════════════════════════

/** Tahlilga olinadigan holatlar (qolganlari — «Отказ», «Отменен», «Не настоящий» … — olinmaydi) */
export const INVOICE_STATUSES = ['Подписан', 'Ожидает'] as const;

type Field =
  | 'docNo0'
  | 'id'
  | 'docKind'
  | 'docType'
  | 'status'
  | 'number'
  | 'date'
  | 'contract'
  | 'contractDate'
  | 'sellerInn'
  | 'sellerName'
  | 'sellerBranch'
  | 'buyerInn'
  | 'buyerName'
  | 'buyerBranch'
  | 'note'
  | 'itemNo'
  | 'itemName'
  | 'ikpu'
  | 'unit'
  | 'qty'
  | 'price'
  | 'cost'
  | 'vatRate'
  | 'vat'
  | 'total';

const k = (s: string) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim();

/** Sarlavha → maydon (tartib muhim: aniqrog'i yuqorida) */
const HEADERS: { field: Field; test: (h: string) => boolean }[] = [
  { field: 'id', test: (h) => h === 'id' || h === 'идентификатор' },
  { field: 'docKind', test: (h) => h.startsWith('вид документ') },
  { field: 'docType', test: (h) => h.startsWith('тип документ') },
  { field: 'status', test: (h) => h.startsWith('статус') },
  { field: 'number', test: (h) => h.startsWith('номер документ') },
  { field: 'date', test: (h) => h.startsWith('дата документ') },
  { field: 'contract', test: (h) => h.startsWith('договор номер') || h === 'номер договора' },
  { field: 'contractDate', test: (h) => h.startsWith('договор дата') || h === 'дата договора' },
  { field: 'sellerInn', test: (h) => h.startsWith('продавец инн') || h.startsWith('поставщик инн') },
  { field: 'sellerName', test: (h) => h.startsWith('продавец наименование') || h.startsWith('поставщик наименование') },
  { field: 'sellerBranch', test: (h) => h.startsWith('продавец название филиала') },
  { field: 'buyerInn', test: (h) => h.startsWith('покупатель инн') },
  { field: 'buyerName', test: (h) => h.startsWith('покупатель наименование') },
  { field: 'buyerBranch', test: (h) => h.startsWith('покупатель название филиала') },
  { field: 'note', test: (h) => h === 'примечание' },
  { field: 'itemName', test: (h) => h.startsWith('примечание к товару') || h.startsWith('наименование товара') },
  { field: 'ikpu', test: (h) => h.startsWith('идентификационный код') || h.startsWith('икпу') },
  { field: 'unit', test: (h) => h.startsWith('единица измерения') },
  { field: 'qty', test: (h) => h === 'количество' },
  { field: 'price', test: (h) => h === 'цена' },
  { field: 'total', test: (h) => h.startsWith('стоимость поставки с учетом ндс') || h.startsWith('стоимость с ндс') },
  { field: 'cost', test: (h) => h === 'стоимость поставки' },
  { field: 'vatRate', test: (h) => h === 'ндс ставка' },
  { field: 'vat', test: (h) => h === 'ндс сумма' },
];

export interface InvoiceItem {
  no: string;
  name: string;
  ikpu: string;
  unit: string;
  qty: number | null;
  priceTiyin: string;
  costTiyin: string;
  vatRate: number | null;
  vatTiyin: string;
  totalTiyin: string;
}

export interface Invoice {
  id: string;
  status: string;
  docKind: string;
  docType: string;
  number: string;
  date: string;
  contract: string;
  contractDate: string | null;
  sellerInn: string;
  sellerName: string;
  sellerBranch: string;
  buyerInn: string;
  buyerName: string;
  buyerBranch: string;
  note: string;
  items: InvoiceItem[];
  /** «Общ.» qatori (bor bo'lsa) */
  totalTiyin: string | null;
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());

/** Summa (so'm, kasr bilan) → tiyin */
export function tiyin(v: unknown): string {
  if (v === null || v === undefined || v === '') return '0';
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[\s ]/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 100));
}

/** «30-09-2026», «30.09.2026», «2026-09-30» yoki Excel sana raqami → YYYY-MM-DD */
export function invoiceDate(v: unknown): string | null {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  const s = str(v);
  let m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

const digits = (s: string) => s.replace(/\D/g, '');

export function parseInvoiceRows(rows: StreamRow[]) {
  // Sarlavha qatori: birinchi 30 qatordan «СТАТУС» va «Стоимость поставки» bo'lgani
  let hi = -1;
  const cols = new Map<Field, number>();
  for (let i = 0; i < Math.min(rows.length, 30) && hi < 0; i++) {
    const found = new Map<Field, number>();
    const numberCols: number[] = [];
    for (const [col, v] of [...rows[i]!.cells.entries()].sort((a, b) => a[0] - b[0])) {
      const h = k(String(v));
      if (h === '№' || h === '' || String(v).trim() === '№') {
        numberCols.push(col);
        continue;
      }
      const def = HEADERS.find((x) => !found.has(x.field) && x.test(h));
      if (def) found.set(def.field, col);
    }
    if (found.has('status') && found.has('total') && found.has('id')) {
      hi = i;
      for (const [f, c] of found) cols.set(f, c);
      // Ikkinchi «№» — tovar qatori raqami (izohdan oldin turadi)
      const itemCol = found.get('itemName');
      const itemNo = numberCols.filter((c) => itemCol === undefined || c < itemCol).pop();
      if (itemNo !== undefined && numberCols.length > 1) cols.set('itemNo', itemNo);
    }
  }
  if (hi < 0) throw new BadRequestException("Schyot-faktura reyestri topilmadi: «ID», «СТАТУС», «Стоимость поставки с учётом НДС» ustunlari bo'lgan varaq kerak (Didox / soliq.uz eksporti)");
  const get = (r: StreamRow, f: Field) => (cols.has(f) ? r.cells.get(cols.get(f)!) : undefined);

  const invoices: Invoice[] = [];
  const invalid: { row: number; reason: string }[] = [];
  let cur: Invoice | null = null;
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i]!;
    const id = str(get(r, 'id'));
    if (id) {
      const date = invoiceDate(get(r, 'date'));
      if (!date) {
        invalid.push({ row: r.row, reason: `Sana noto'g'ri: «${str(get(r, 'date')).slice(0, 20)}»` });
        cur = null;
        continue;
      }
      // Bir xil ID qayta uchrasa (filtrlangan nusxa) — o'sha faktura davomi
      const prev: Invoice | null = cur && cur.id === id ? cur : null;
      const next: Invoice = prev ?? {
        id: id.slice(0, 64),
        status: str(get(r, 'status')).slice(0, 40),
        docKind: str(get(r, 'docKind')).slice(0, 60),
        docType: str(get(r, 'docType')).slice(0, 60),
        number: str(get(r, 'number')).slice(0, 60),
        date,
        contract: str(get(r, 'contract')).slice(0, 120),
        contractDate: invoiceDate(get(r, 'contractDate')),
        sellerInn: digits(str(get(r, 'sellerInn'))).slice(0, 14),
        sellerName: str(get(r, 'sellerName')).slice(0, 300),
        sellerBranch: str(get(r, 'sellerBranch')).slice(0, 200),
        buyerInn: digits(str(get(r, 'buyerInn'))).slice(0, 14),
        buyerName: str(get(r, 'buyerName')).slice(0, 300),
        buyerBranch: str(get(r, 'buyerBranch')).slice(0, 200),
        note: str(get(r, 'note')).slice(0, 500),
        items: [],
        totalTiyin: null,
      };
      cur = next;
      if (!prev) invoices.push(next);
    }
    if (!cur) continue;
    const no = str(get(r, 'itemNo'));
    const total = tiyin(get(r, 'total'));
    if (/^общ/i.test(no) || (!no && !str(get(r, 'itemName')) && !str(get(r, 'ikpu')) && total !== '0')) {
      cur.totalTiyin = total;
      continue;
    }
    if (!str(get(r, 'itemName')) && !str(get(r, 'ikpu')) && total === '0') continue;
    const qty = Number(get(r, 'qty'));
    const rate = Number(get(r, 'vatRate'));
    cur.items.push({
      no: no.slice(0, 10) || String(cur.items.length + 1),
      name: str(get(r, 'itemName')).slice(0, 500),
      ikpu: str(get(r, 'ikpu')).slice(0, 300),
      unit: str(get(r, 'unit')).slice(0, 60),
      qty: Number.isFinite(qty) ? qty : null,
      priceTiyin: tiyin(get(r, 'price')),
      costTiyin: tiyin(get(r, 'cost')),
      vatRate: Number.isFinite(rate) ? rate : null,
      vatTiyin: tiyin(get(r, 'vat')),
      totalTiyin: total,
    });
  }
  // Qatorlari yo'q (faqat jami) fakturalar — bitta qator
  for (const inv of invoices) {
    if (!inv.items.length && inv.totalTiyin && inv.totalTiyin !== '0') inv.items.push({ no: '1', name: inv.note || 'Faktura jami (qatorlarsiz)', ikpu: '', unit: '', qty: null, priceTiyin: '0', costTiyin: '0', vatRate: null, vatTiyin: '0', totalTiyin: inv.totalTiyin });
  }
  return { invoices, invalid };
}

/** Bizning INN: fakturalarda eng ko'p uchragan (xaridor yoki sotuvchi sifatida) */
export function detectOurInn(invoices: Invoice[]): { inn: string; name: string } | null {
  const c = new Map<string, { n: number; name: string }>();
  for (const i of invoices)
    for (const [inn, name] of [
      [i.buyerInn, i.buyerName],
      [i.sellerInn, i.sellerName],
    ] as const) {
      if (!inn) continue;
      const x = c.get(inn) ?? { n: 0, name };
      x.n += 1;
      c.set(inn, x);
    }
  const top = [...c.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  return top && top[1].n >= Math.max(2, invoices.length * 0.5) ? { inn: top[0], name: top[1].name.replace(/\s*\(.*\)\s*$/, '') } : null;
}

/** Fakturadagi izohdan xizmat oyi («за август», «сентабр ойи», «с 01.06.2026»), bo'lmasa — faktura oyi */
const B = '(?<![\\p{L}])';
const mon = (src: string) => new RegExp(`${B}(?:${src})`, 'u');
const MON: [RegExp, number][] = [
  [mon('январ|yanvar'), 1], [mon('феврал|fevral'), 2], [mon('март(?!\\p{L}*карт)|mart(?![a-z]*kart)'), 3], [mon('апрел|aprel'), 4], [mon('ма[йя](?![\\p{L}])|may(?![a-z])'), 5], [mon('июн|iyun'), 6],
  [mon('июл|iyul'), 7], [mon('август|avgust'), 8], [mon('сент[яа]бр|sentabr'), 9], [mon('октябр|oktabr'), 10], [mon('ноябр|noyabr'), 11], [mon('декабр|dekabr'), 12],
];
export function serviceMonth(text: string, date: string): string {
  const p = date.slice(0, 7);
  const t = text.toLowerCase();
  const range = /с\s*(\d{2})\.(\d{2})\.(\d{4})/.exec(t);
  if (range) return `${range[3]}-${range[2]}`;
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  for (const [re, mm] of MON) {
    if (!re.test(t)) continue;
    // Faktura oyidan keyingi oy (bir oydan ortiq) — o'tgan yil
    const yy = mm > m + 1 ? y - 1 : y;
    return `${yy}-${String(mm).padStart(2, '0')}`;
  }
  return p;
}

export function itemId(invoiceId: string, item: InvoiceItem, idx: number): string {
  return createHash('sha1').update([invoiceId, item.no, item.ikpu, item.totalTiyin, String(idx)].join('\u0001')).digest('hex').slice(0, 20);
}

/** IKPU kodi (17 raqam) — guruhlash uchun */
export const ikpuCode = (ikpu: string) => /^(\d{10,17})/.exec(ikpu.trim())?.[1] ?? '';
/** IKPU nomi (kod — nom) */
export const ikpuName = (ikpu: string) => ikpu.replace(/^\s*\d{5,17}\s*-\s*/, '').trim();
