import { sheetKey, type TemplateRow, type TemplateSpec } from '../../common/templates/sheet-template';
import { translit } from '../leases/leases.match';

// ═══════════════════════════════════════════════════════════
// Asosiy vositalar › Xarid shabloni: «Моддий-техника эҳтиёжлари маълумотномаси» (talabnoma → reja → bozor narxi →
// xarid usuli / platforma → shartnoma → schyot-faktura) — ta'rif va ANIQLAB OLUVCHI FILTR.
//
// Har qator turga ajratiladi (tartib muhim — birinchi mos kelgani):
//   1. Xizmat         — «Тури» = хизмат yoki nomida ta'mirlash, sug'urta, dastur, sertifikat, reklama …
//   2. Sovg'a         — asoslashda «эсдалик», «совға», «рағбатлантириш» (TV, soat, multivarka — tarqatiladi)
//   3. Poligrafiya    — buklet, banner, guvohnoma, blanka, tashakkurnoma, tablichka, stend, kitob …
//   4. Sarf materiali — kanselyariya, kartrij, salfetka, suv, batareyka, kabel, maxsus kiyim …
//   5. Uzoq ishlatiladigan buyum (konditsioner, mebel, texnika, kamera, qurilma …):
//        1 dona narxi ≥ chegara (standart 5 mln so'm) → ASOSIY VOSITA, aks holda → kam baholi buyum
//   6. Nomdan aniqlanmadi — tovar: narx ≥ chegara → asosiy vosita, aks holda sarf materiali (sababi bilan)
// Holat — «Изоҳ»: бажарилди / Отказ / ижрода; bo'sh — rejada. Summa — faqat «Шартнома / жами сумма» (haqiqiy qiymat);
// bozor taxminiy qiymati — alohida ma'lumot, jamiga qo'shilmaydi. «Soni × 1 lik ≠ jami» va boshqa xatolar — ogohlantirish.
// «Маъсул ҳодим» ustuni o'qilmaydi (shaxsiy ma'lumot).
// ═══════════════════════════════════════════════════════════

export const XARID_SPEC: TemplateSpec = {
  id: 'asset-xarid',
  title: 'Моддий-техника эҳтиёжлари маълумотномаси',
  rowKey: 'name',
  scanRows: 20,
  fields: [
    { key: 'no', label: 'Т/р', aliases: ['tr', 'n', 'no', 'nomer'], kind: 'number', width: 6 },
    { key: 'unit', label: 'Тузилма номи', aliases: ['tuzilmanomi', 'tuzilma', 'tarkibiybolinmanomi', 'bolinma'], kind: 'text', width: 18 },
    { key: 'reqDept', label: 'бўлим номи', groupLabel: 'Талабнома берди', group: ['talabnomaberdi', 'talabnoma'], aliases: ['bolimnomi', 'bolim'], kind: 'text', width: 22 },
    { key: 'reqNo', label: 'рақами', groupLabel: 'Талабнома берди', group: ['talabnomaberdi', 'talabnoma'], aliases: ['raqami', 'raqam'], kind: 'text', width: 12 },
    { key: 'reqDate', label: 'санаси', groupLabel: 'Талабнома берди', group: ['talabnomaberdi', 'talabnoma'], aliases: ['sanasi', 'sana'], kind: 'date', width: 12 },
    { key: 'planDate', label: 'Режа график киритилган сана', aliases: ['rejagrafikkiritilgansana', 'rejagrafiksana', 'rejagrafik'], kind: 'date', width: 14 },
    { key: 'purpose', label: 'Асослантириш (мақсад ва зарурат)', aliases: ['asoslantirishmaqsadvazarurat', 'asoslantirish', 'maqsad'], kind: 'text', width: 30 },
    { key: 'name', label: 'Товар (иш, хизмат) номи', aliases: ['tovarishxizmatnomi', 'tovarnomi', 'mahsulotnomi', 'tovarishxizmat', 'nomi'], kind: 'text', required: true, width: 34 },
    { key: 'type', label: 'Тури', aliases: ['turi'], kind: 'text', width: 10 },
    { key: 'measure', label: 'Ўлчов бирлиги', aliases: ['olchovbirligi', 'olchov'], kind: 'text', width: 10 },
    { key: 'qty', label: 'Миқдори', aliases: ['miqdori', 'miqdor'], kind: 'number', width: 10 },
    { key: 'spec', label: 'Техник топшириқ', aliases: ['texniktopshiriq'], kind: 'text', width: 14 },
    { key: 'mktCount', label: 'тт сони', groupLabel: 'Бозор тахминий қиймати', group: ['bozortaxminiyqiymati', 'bozorqiymati'], aliases: ['ttsoni'], kind: 'number', width: 8 },
    { key: 'mktDate', label: 'сана', groupLabel: 'Бозор тахминий қиймати', group: ['bozortaxminiyqiymati', 'bozorqiymati'], aliases: ['sana', 'sanasi'], kind: 'date', width: 12 },
    { key: 'mktQty', label: 'сони', groupLabel: 'Бозор тахминий қиймати', group: ['bozortaxminiyqiymati', 'bozorqiymati'], aliases: ['soni'], kind: 'number', width: 10 },
    { key: 'mktPrice', label: 'бирлик', groupLabel: 'Бозор тахминий қиймати', group: ['bozortaxminiyqiymati', 'bozorqiymati'], aliases: ['birlik', '1lik'], kind: 'number', width: 14 },
    { key: 'mktTotal', label: 'умумий', groupLabel: 'Бозор тахминий қиймати', group: ['bozortaxminiyqiymati', 'bozorqiymati'], aliases: ['umumiy', 'jami'], kind: 'number', width: 16 },
    { key: 'method', label: 'тури', groupLabel: 'Ҳарид усули', group: ['haridusuli', 'xaridusuli'], aliases: ['turi', 'usuli'], kind: 'text', width: 16 },
    { key: 'platform', label: 'платформа', groupLabel: 'Ҳарид усули', group: ['haridusuli', 'xaridusuli'], aliases: ['platforma', 'havola'], kind: 'text', width: 30 },
    { key: 'methodDate', label: 'санаси', groupLabel: 'Ҳарид усули', group: ['haridusuli', 'xaridusuli'], aliases: ['sanasi', 'sana'], kind: 'date', width: 12 },
    { key: 'supplier', label: 'номи', groupLabel: 'Шартнома', group: ['shartnoma'], aliases: ['nomi', 'kontragent', 'yetkazibberuvchi'], kind: 'text', width: 28 },
    { key: 'contractNo', label: 'рақами', groupLabel: 'Шартнома', group: ['shartnoma'], aliases: ['raqami', 'raqam'], kind: 'text', width: 14 },
    { key: 'contractDate', label: 'санаси', groupLabel: 'Шартнома', group: ['shartnoma'], aliases: ['sanasi', 'sana'], kind: 'date', width: 12 },
    { key: 'contractQty', label: 'сони', groupLabel: 'Шартнома', group: ['shartnoma'], aliases: ['soni', 'miqdori'], kind: 'number', width: 10 },
    { key: 'contractPrice', label: '1 лик сумма', groupLabel: 'Шартнома', group: ['shartnoma'], aliases: ['1liksumma', '1lik', 'birliksumma', 'narxi'], kind: 'number', width: 14 },
    { key: 'contractTotal', label: 'жами сумма', groupLabel: 'Шартнома', group: ['shartnoma'], aliases: ['jamisumma', 'jami', 'umumiysumma'], kind: 'number', width: 16 },
    { key: 'invoiceNo', label: 'рақами', groupLabel: 'Счёт фактура', group: ['schyotfaktura', 'schetfaktura', 'hisobfaktura', 'faktura'], aliases: ['raqami', 'raqam'], kind: 'text', width: 14 },
    { key: 'invoiceDate', label: 'санаси', groupLabel: 'Счёт фактура', group: ['schyotfaktura', 'schetfaktura', 'hisobfaktura', 'faktura'], aliases: ['sanasi', 'sana'], kind: 'date', width: 12 },
    { key: 'note', label: 'Изоҳ', aliases: ['izoh', 'holati', 'holat'], kind: 'text', width: 14 },
  ],
  help: [
    "• Sarlavha — ikki qator (guruh va ustun): «Талабнома берди / рақами», «Шартнома / жами сумма» … — nomlar kirill yoki lotinda bo'lishi mumkin.",
    "• Har qator — bitta tovar, ish yoki xizmat. «Тури»: товар, хизмат yoki эхтиёж.",
    "• Summa — faqat «Шартнома / жами сумма» ustuni (haqiqiy qiymat, so'mda). «Бозор тахминий қиймати» — faqat ma'lumot uchun, jamiga qo'shilmaydi.",
    "• «Изоҳ»: бажарилди, Отказ, ижрода; bo'sh — rejada.",
    "• Sanalar: 26.08.2026 yoki Excel sanasi. «Жами» va imzo qatorlari o'qilmaydi.",
    "• Mas'ul xodim ustuni bo'lsa — saqlanmaydi.",
    "• Tizim har qatorni aniqlaydi: asosiy vosita, kam baholi buyum, sarf materiali, poligrafiya va sovg'a, xizmat. Turini qo'lda o'zgartirish mumkin.",
  ],
};

export const XARID_KINDS = ['ASSET', 'LOW_VALUE', 'SUPPLY', 'PRINT_GIFT', 'SERVICE'] as const;
export type XaridKind = (typeof XARID_KINDS)[number];
export const XARID_KIND_LABEL: Record<XaridKind, string> = {
  ASSET: 'Asosiy vosita',
  LOW_VALUE: 'Kam baholi buyum',
  SUPPLY: 'Sarf materiali',
  PRINT_GIFT: "Poligrafiya va sovg'a",
  SERVICE: 'Xizmat',
};
export type XaridStatus = 'DONE' | 'IN_PROGRESS' | 'PLANNED' | 'REJECTED';
export const XARID_STATUS_LABEL: Record<XaridStatus, string> = { DONE: 'Bajarildi', IN_PROGRESS: 'Ijroda', PLANNED: 'Rejada', REJECTED: 'Rad etildi' };

/** Saqlanadigan qator (o'qilgan qiymatlar; summalar — so'mda, Excel'dagidek) */
export interface XaridRaw {
  row: number;
  key: string;
  values: Record<string, string | number | null>;
  warnings: string[];
}

/** Nom va asoslash matni — lotin, kichik harf, tutuq belgisiz, bitta bo'shliq */
const plain = (s: unknown) =>
  translit(String(s ?? ''))
    .replace(/[‘’ʻʼ`'"“”«»]/g, '')
    .replace(/[^a-z0-9+\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const has = (text: string, words: string[]) => words.find((w) => text.includes(w)) ?? null;

const SERVICE_WORDS = ['tamir', 'sugurta', 'sertifikat', 'dastur', 'api key', 'malaka', 'obuna', 'litsenz', 'reklama', 'baholash', 'telefon raqam', 'hosting', 'domen', 'internet', 'ijara', 'tozalash'];
const GIFT_PURPOSE = ['esdalik', 'estalik', 'sovga', 'ragbat', 'rahbat'];
const PRINT_WORDS = ['buklet', 'banner', 'guvohnoma', 'guvoxnoma', 'blank', 'tashakurnoma', 'tashakkurnoma', 'tablichka', 'stend', 'kitob', 'daftar', 'flayer', 'plakat', 'vizitka', 'kalendar', 'bayroq', 'lavha'];
const SUPPLY_WORDS = ['ruchka', 'qalam', 'kartrij', 'salfetka', 'sovun', 'suv', 'batareyka', 'fayl', 'stiker', 'skoba', 'bloknot', 'qogoz', 'papka', 'konnektor', 'patch cord', 'kabel', 'osvejitel', 'osvijitel', 'domestos', 'perfofayl', 'organayzer', 'etajerka', 'nabor', 'jilet', 'kiyim', 'forma', 'chiqindi', 'yelim', 'skotch', 'marker', 'toner', 'kanselyar', 'konselyar'];
const DURABLE_WORDS = ['konditsioner', 'kondisioner', 'stol', 'stul', 'kreslo', 'shkaf', 'seyf', 'mebel', 'divan', 'monoblok', 'kompyuter', 'noutbuk', 'macbook', 'printer', 'mfu', 'skaner', 'televizor', 'tv', 'router', 'routor', 'svich', 'switch', 'kamera', 'planshet', 'regula', 'qurilma', 'mashina', 'dron', 'telefon', 'avtomobil', 'generator', 'proyektor', 'proektor', 'multivarka', 'muzlatgich', 'server', 'monitor', 'klaviatura', 'sichqoncha', 'mosla', 'muhr', 'muxr', 'naushnik', 'smart card', 'kuller', 'isitgich', 'changyutgich'];

/** Tuzilma → birlik (Solishtirma birliklari); topilmasa — Markaz */
export function unitOf(text: unknown): string {
  const k = sheetKey(text);
  if (!k) return 'CENTER';
  if (k.includes('fermer')) return 'FERMER';
  if (k.includes('marksh') || k.includes('marksheyd')) return 'MARKSHEYDER';
  if (k.includes('taksfri') || k.includes('taxfree') || k.includes('taksfree')) return 'TAX_FREE';
  if (k.includes('hududiy') || k.includes('viloyat') || k.includes('tuman') || k.startsWith('hudud')) return 'REGION';
  if (k.includes('buxgalteriyaxizmat')) return 'BUXGALTERIYA';
  if (k.includes('qomita')) return 'QOMITA';
  return 'CENTER';
}

/** Xarid usuli — bir xil yozuvga keltiriladi */
export function methodOf(text: unknown): string | null {
  const p = plain(text);
  if (!p) return null;
  if (p.includes('elektron d')) return "Elektron do'kon";
  if (p.includes('milliy d')) return "Milliy do'kon";
  if (p.includes('katalog')) return 'Elektron katalog';
  if (p.includes('tanlov') || p.includes('konkurs')) return 'Tanlov';
  if (p.includes('auks') || p.includes('auktsion')) return 'Auksion';
  if (p.includes('togridan')) return "To'g'ridan-to'g'ri";
  if (p.includes('birja')) return 'Birja';
  return String(text).trim().slice(0, 40);
}

/** Platforma — havoladan (domen) yoki matndan */
export function platformOf(text: unknown): string | null {
  const s = String(text ?? '').toLowerCase();
  if (!s.trim()) return null;
  if (s.includes('xt-xarid')) return 'XT-Xarid';
  if (s.includes('uzex')) return 'UZEX (xarid.uzex.uz)';
  if (s.includes('ebirja')) return 'E-birja';
  if (s.includes('cooperation')) return 'Kooperatsiya portali';
  if (plain(s).includes('togridan')) return "To'g'ridan-to'g'ri";
  return 'Boshqa';
}

export function statusOf(note: unknown, hasContract: boolean): XaridStatus {
  const p = plain(note);
  if (p.includes('otkaz') || p.includes('rad etil') || p.includes('bekor')) return 'REJECTED';
  if (p.includes('bajaril')) return 'DONE';
  if (p.includes('ijro')) return 'IN_PROGRESS';
  return hasContract ? 'DONE' : 'PLANNED';
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Miqdor, 1 dona narxi va summa: shartnoma ustunlari tekshiriladi, xatolar — ogohlantirish bilan to'g'rilanadi */
/** Summa — faqat «Шартнома / жами сумма» (AB) ustunidan (haqiqiy qiymat). Bozor taxminiy qiymati — alohida, jamiga qo'shilmaydi */
export function amountsOf(v: Record<string, string | number | null>): { qty: number | null; unitPrice: number | null; total: number | null; estimate: number | null; warnings: string[] } {
  const warnings: string[] = [];
  const cTotal = n(v.contractTotal);
  if (cTotal && cTotal > 0) {
    let qty = n(v.contractQty) ?? n(v.qty);
    const price = n(v.contractPrice);
    let unit = price;
    if (qty && price && Math.abs(qty * price - cTotal) > Math.max(1, cTotal * 0.001)) {
      if (Math.abs(price - cTotal) < 1 && qty > 1) {
        unit = cTotal / qty;
        warnings.push(`«1 lik summa» ustuniga jami summa yozilgan — 1 dona: ${Math.round(unit).toLocaleString('ru')} so'm`);
      } else if (price <= 1) {
        unit = cTotal / qty;
        warnings.push(`1 lik summa ${price} so'm — 1 dona jami ÷ soni bo'yicha olindi`);
      } else if (qty * price > cTotal * 50) {
        const fixed = Math.round(cTotal / price);
        warnings.push(`Soni xato bo'lishi mumkin: ${qty.toLocaleString('ru')} — jami ÷ 1 lik = ${fixed.toLocaleString('ru')}`);
        qty = fixed;
      } else {
        warnings.push(`Soni × 1 lik (${Math.round(qty * price).toLocaleString('ru')}) ≠ jami (${Math.round(cTotal).toLocaleString('ru')}) — farq ${Math.round(cTotal - qty * price).toLocaleString('ru')} so'm`);
      }
    }
    if (!unit && qty) unit = cTotal / qty;
    return { qty, unitPrice: unit, total: cTotal, estimate: null, warnings };
  }
  const mTotal = n(v.mktTotal);
  const mQty = n(v.mktQty) ?? n(v.qty);
  const mPrice = n(v.mktPrice) ?? (mTotal && mQty ? mTotal / mQty : null);
  // Shartnoma yo'q — summa yo'q (null); 1 dona narxi (turini aniqlash uchun) va taxminiy qiymat — bozor narxidan
  return { qty: n(v.qty) ?? mQty, unitPrice: mPrice && mPrice > 0 ? mPrice : null, total: null, estimate: mTotal && mTotal > 0 ? mTotal : null, warnings };
}

/** Turi aniqlash: tur va sababi */
export function classify(v: Record<string, string | number | null>, unitPrice: number | null, assetMinSom: number): { kind: XaridKind; reason: string } {
  const name = plain(v.name);
  const purpose = plain(v.purpose);
  const type = plain(v.type);
  if (type.startsWith('xizmat')) return { kind: 'SERVICE', reason: '«Тури» — хизмат' };
  const svc = has(name, SERVICE_WORDS);
  if (svc) return { kind: 'SERVICE', reason: `nomida «${svc}»` };
  const gift = has(purpose, GIFT_PURPOSE);
  if (gift) return { kind: 'PRINT_GIFT', reason: `asoslashda «${gift}» — tarqatiladi` };
  const pr = has(name, PRINT_WORDS);
  if (pr) return { kind: 'PRINT_GIFT', reason: `nomida «${pr}»` };
  const sup = has(name, SUPPLY_WORDS);
  if (sup) return { kind: 'SUPPLY', reason: `nomida «${sup}»` };
  const limit = `${assetMinSom.toLocaleString('ru')} so'm`;
  // «tv» kabi qisqa so'zlar — alohida so'z sifatida
  const dur = DURABLE_WORDS.find((w) => (w.length <= 3 ? new RegExp(`(^|\\s)${w}(\\s|$)`).test(name) : name.includes(w)));
  if (dur) {
    if (unitPrice === null) return { kind: 'ASSET', reason: `uzoq ishlatiladigan («${dur}»), narxi noma'lum` };
    return unitPrice >= assetMinSom ? { kind: 'ASSET', reason: `uzoq ishlatiladigan («${dur}»), 1 dona ≥ ${limit}` } : { kind: 'LOW_VALUE', reason: `uzoq ishlatiladigan («${dur}»), 1 dona < ${limit}` };
  }
  if (unitPrice !== null && unitPrice >= assetMinSom) return { kind: 'ASSET', reason: `nomdan aniqlanmadi — 1 dona ≥ ${limit}` };
  return { kind: 'SUPPLY', reason: 'nomdan aniqlanmadi — arzon tovar' };
}

/** Qator kaliti (qo'lda belgilangan turni qayta yuklashda saqlash uchun): talabnoma + nom + shartnoma */
export function rowKeys(rows: TemplateRow[]): XaridRaw[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = [sheetKey(r.values.reqNo), sheetKey(r.values.name).slice(0, 40), sheetKey(r.values.contractNo)].join('|');
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    return { row: r.row, key: k > 1 ? `${base}#${k}` : base, values: r.values, warnings: r.warnings };
  });
}
