import { BadRequestException, Injectable } from '@nestjs/common';
import type { StockDocKind } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

// ═══════════════════════════════════════════════════════════
// Ombor dalolatnomasi shabloni — tashkilot namunasi bo'yicha («Товар моддий бойлигини қабул қилиш – топшириш
// ДАЛОЛАТНОМАСИ»). Hamma o'zgaradigan narsa sozlamada: tasdiqlovchi (lavozim, F.I.Sh.), tashkilot nomi, shahar,
// omborchi, «Келишилди» ro'yxati, har hujjat turi uchun sarlavha va matnlar, jadval ustunlari, sanalar,
// ismlar yozilishi (lotin → kirill). Hududlar uchun alohida: tasdiqlovchi, shahar, omborchi, kelishuvchilar —
// hudud hujjatlari doim shu hudud shabloni bilan chiqadi.
// Matnlarda o'rinbosarlar: {giver} {receiver} {storekeeper} {supplier} {reason} {number} {date} {city} {place} {from}
// Saqlanadi: settings (kalit: warehouse.act.template).
// ═══════════════════════════════════════════════════════════

export const ACT_TEMPLATE_KEY = 'warehouse.act.template';

export interface Signer {
  title: string;
  name: string;
}

export interface KindTexts {
  /** Sarlavha: 1-qator (oddiy) va 2-qator (katta, qalin) */
  title: string;
  title2: string;
  /** «Биз, қуйида имзо чекувчилар:» */
  intro: string;
  /** Tomonlar: har biri alohida qatorda */
  parties: string[];
  /** Jadvaldan oldingi gap */
  lead: string;
  /** Jadvaldan keyingi gaplar */
  closing: string[];
  /** Moddiy javobgarlik gapi (bo'sh — chiqmaydi) */
  liability: string;
  /** Imzolar: «Топширувчи (омбор мудири): {giver}» */
  signatures: string[];
}

export interface RegionOverride {
  approverPosition?: string;
  approverName?: string;
  company?: string;
  city?: string;
  storekeeperTitle?: string;
  storekeeperName?: string;
  /** Bo'sh bo'lmasa — umumiy «Келишилди» o'rniga */
  agreed?: Signer[];
}

export interface ActTemplate {
  approveHeading: string;
  company: string;
  approverPosition: string;
  approverName: string;
  /** Tasdiqlash sanasi: hujjat sanasi yoki bo'sh (qo'lda yoziladi) */
  approveDate: 'doc' | 'blank';
  /** Dalolatnoma sanasi qatori: hujjat sanasi yoki bo'sh «“___” _______ 2026 йил» */
  actDate: 'doc' | 'blank';
  city: string;
  storekeeperTitle: string;
  storekeeperName: string;
  agreedHeading: string;
  agreed: Signer[];
  /** Jadval ustunlari: Т/р, ТМБ номи, Инвентар рақами, Ўлчов бирлиги, Миқдори, Нархи, Ҳолати */
  columns: string[];
  totalLabel: string;
  unitDefault: string;
  /** Holati ko'rsatilmagan vosita uchun */
  conditionDefault: string;
  /** Ismlar: «AKBAROV FARRUX» → «Акбаров Ф.» */
  shortNames: boolean;
  namesScript: 'asis' | 'cyrl';
  /** Hujjat raqami va dastur belgisi pastda */
  footer: boolean;
  kinds: Record<StockDocKind, KindTexts>;
  regions: Record<string, RegionOverride>;
}

const LIABILITY = 'Мен {receiver} мазкур асосий воситаларни бут сақлаш ва мақсадли фойдаланиш учун моддий жавобгарлик мажбуриятини зиммамга оламан. __________(имзо)';

export const DEFAULT_TEMPLATE: ActTemplate = {
  approveHeading: '“ТАСДИҚЛАЙМАН”',
  company: '“Солиқ-сервис” АЖ',
  approverPosition: 'директори',
  approverName: 'Х.Базаров',
  approveDate: 'doc',
  actDate: 'blank',
  city: 'Тошкент шаҳар',
  storekeeperTitle: 'омбор мудири',
  storekeeperName: 'Маматова Х.',
  agreedHeading: 'Келишилди:',
  agreed: [
    { title: 'Бош бухгалтер', name: 'Эргашов С.' },
    { title: 'Директор ўринбосари', name: 'Бойтемиров А.' },
  ],
  columns: ['Т/р', 'ТМБ номи', 'Инвентар рақами', 'Ўлчов бирлиги', 'Миқдори', 'Нархи', 'Ҳолати'],
  totalLabel: 'Жами',
  unitDefault: 'дона',
  conditionDefault: 'Янги',
  shortNames: true,
  namesScript: 'cyrl',
  footer: true,
  kinds: {
    ISSUE: {
      title: 'Товар моддий бойлигини қабул қилиш – топшириш',
      title2: 'ДАЛОЛАТНОМАСИ',
      intro: 'Биз, қуйида имзо чекувчилар:',
      parties: ['Топширувчи: {giver}', 'Қабул қилувчи: {receiver} ушбу далолатномани туздик.'],
      lead: 'Топширувчи қуйидаги товар-моддий бойликларни қабул қилувчига топширди:',
      closing: [
        'Топширувчи ТМБларни бут ва соз ҳолатда топшираётганлигини;',
        'Қабул қилувчи мазкур ТМБларни бут ва соз ҳолатда қабул қилганлигини тасдиқлайди ҳамда улардан хизмат мақсадларида фойдаланиш ва сақлаш учун жавобгар эканлигини тасдиқлаган ҳолда қабул қилади.',
      ],
      liability: LIABILITY,
      signatures: ['Топширувчи ({storekeeperTitle}): {giver}', 'Қабул қилувчи (бўлим бошлиғи ёки ходим): {receiver}'],
    },
    RETURN: {
      title: 'Товар моддий бойлигини омборга қайтариш',
      title2: 'ДАЛОЛАТНОМАСИ',
      intro: 'Биз, қуйида имзо чекувчилар:',
      parties: ['Топширувчи: {giver}', 'Қабул қилувчи: {receiver} ушбу далолатномани туздик.'],
      lead: 'Топширувчи ўзида бўлган қуйидаги товар-моддий бойликларни омборга қайтариб топширди:',
      closing: [
        'Қабул қилувчи ({storekeeperTitle}) мазкур ТМБларни жадвалда кўрсатилган ҳолатда қабул қилганлигини тасдиқлайди.',
        'Шу кундан бошлаб топширувчи мазкур ТМБлар бўйича моддий жавобгарликдан озод этилади.',
      ],
      liability: '',
      signatures: ['Топширувчи (ходим): {giver}', 'Қабул қилувчи ({storekeeperTitle}): {receiver}'],
    },
    TRANSFER: {
      title: 'Асосий воситаларни бир ходимдан бошқасига ўтказиш',
      title2: 'ДАЛОЛАТНОМАСИ',
      intro: 'Биз, қуйида имзо чекувчилар:',
      parties: ['Топширувчи: {giver}', 'Қабул қилувчи: {receiver}', '{storekeeperTitle}: {storekeeper} ушбу далолатномани туздик.'],
      lead: 'Топширувчи қуйидаги асосий воситаларни қабул қилувчига ўтказди:',
      closing: [
        'Топширувчи асосий воситаларни жадвалда кўрсатилган ҳолатда топшираётганлигини;',
        'Қабул қилувчи уларни шу ҳолатда қабул қилганлигини ҳамда хизмат мақсадларида фойдаланиш ва сақлаш учун жавобгар эканлигини тасдиқлайди.',
      ],
      liability: LIABILITY,
      signatures: ['Топширувчи: {giver}', 'Қабул қилувчи: {receiver}', '{storekeeperTitle}: {storekeeper}'],
    },
    WRITE_OFF: {
      title: 'Товар моддий бойликларини ҳисобдан чиқариш',
      title2: 'ДАЛОЛАТНОМАСИ',
      intro: 'Биз, қуйида имзо чекувчи комиссия аъзолари:',
      parties: ['Комиссия раиси: {receiver}', 'Аъзо ({storekeeperTitle}): {storekeeper}'],
      lead: 'Қуйидаги товар-моддий бойликлар ҳисобдан чиқарилди. Сабаб: {reason}',
      closing: ['Комиссия ушбу ТМБларни кейинги фойдаланишга яроқсиз деб топди.'],
      liability: '',
      signatures: ['Комиссия раиси: {receiver}', 'Аъзо: ____________________', 'Аъзо ({storekeeperTitle}): {storekeeper}'],
    },
    RECEIPT: {
      title: 'Товар моддий бойликларини омборга қабул қилиш',
      title2: 'ДАЛОЛАТНОМАСИ',
      intro: 'Биз, қуйида имзо чекувчилар:',
      parties: ['Етказиб берувчи: {supplier}', 'Қабул қилувчи ({storekeeperTitle}): {storekeeper} ушбу далолатномани туздик.'],
      lead: 'Қуйидаги товар-моддий бойликлар омборга қабул қилинди:',
      closing: ['Қабул қилувчи ТМБларни сони ва сифати бўйича текшириб қабул қилганлигини тасдиқлайди.'],
      liability: '',
      signatures: ['Топширувчи (етказиб берувчи): {supplier}', 'Қабул қилувчи ({storekeeperTitle}): {storekeeper}'],
    },
  },
  regions: {},
};

const KINDS: StockDocKind[] = ['ISSUE', 'RETURN', 'TRANSFER', 'WRITE_OFF', 'RECEIPT'];

function str(v: unknown, fallback: string, max = 500): string {
  return typeof v === 'string' ? v.slice(0, max) : fallback;
}

function strList(v: unknown, fallback: string[], max = 1000, count = 12): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, max)).slice(0, count) : fallback;
}

function signers(v: unknown, fallback: Signer[]): Signer[] {
  if (!Array.isArray(v)) return fallback;
  return v
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
    .map((x) => ({ title: str(x.title, '', 120).trim(), name: str(x.name, '', 120).trim() }))
    .filter((x) => x.title || x.name)
    .slice(0, 10);
}

/** Saqlangan qiymatni tekshirib, yetishmaganini standartdan to'ldiradi */
export function sanitizeTemplate(raw: unknown): ActTemplate {
  const x = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_TEMPLATE;
  const kindsIn = (x.kinds && typeof x.kinds === 'object' ? x.kinds : {}) as Record<string, Record<string, unknown> | undefined>;
  const kinds = {} as Record<StockDocKind, KindTexts>;
  for (const k of KINDS) {
    const src = kindsIn[k] ?? {};
    const def = d.kinds[k];
    kinds[k] = {
      title: str(src.title, def.title, 300),
      title2: str(src.title2, def.title2, 120),
      intro: str(src.intro, def.intro, 300),
      parties: strList(src.parties, def.parties, 500, 6),
      lead: str(src.lead, def.lead, 1000),
      closing: strList(src.closing, def.closing, 1500, 8),
      liability: str(src.liability, def.liability, 1000),
      signatures: strList(src.signatures, def.signatures, 300, 8),
    };
  }
  const regionsIn = (x.regions && typeof x.regions === 'object' ? x.regions : {}) as Record<string, unknown>;
  const regions: Record<string, RegionOverride> = {};
  for (const [code, value] of Object.entries(regionsIn)) {
    if (!/^\d{1,3}$/.test(code) || !value || typeof value !== 'object') continue;
    const r = value as Record<string, unknown>;
    const o: RegionOverride = {};
    for (const f of ['approverPosition', 'approverName', 'company', 'city', 'storekeeperTitle', 'storekeeperName'] as const) {
      if (typeof r[f] === 'string' && (r[f] as string).trim()) o[f] = (r[f] as string).trim().slice(0, 200);
    }
    const ag = signers(r.agreed, []);
    if (ag.length) o.agreed = ag;
    if (Object.keys(o).length) regions[code] = o;
  }
  const cols = strList(x.columns, d.columns, 60, 7);
  return {
    approveHeading: str(x.approveHeading, d.approveHeading, 120),
    company: str(x.company, d.company, 200),
    approverPosition: str(x.approverPosition, d.approverPosition, 200),
    approverName: str(x.approverName, d.approverName, 200),
    approveDate: x.approveDate === 'blank' ? 'blank' : x.approveDate === 'doc' ? 'doc' : d.approveDate,
    actDate: x.actDate === 'doc' ? 'doc' : x.actDate === 'blank' ? 'blank' : d.actDate,
    city: str(x.city, d.city, 120),
    storekeeperTitle: str(x.storekeeperTitle, d.storekeeperTitle, 120),
    storekeeperName: str(x.storekeeperName, d.storekeeperName, 120),
    agreedHeading: str(x.agreedHeading, d.agreedHeading, 120),
    agreed: signers(x.agreed, d.agreed),
    columns: cols.length === 7 ? cols : d.columns,
    totalLabel: str(x.totalLabel, d.totalLabel, 60),
    unitDefault: str(x.unitDefault, d.unitDefault, 30),
    conditionDefault: str(x.conditionDefault, d.conditionDefault, 120),
    shortNames: typeof x.shortNames === 'boolean' ? x.shortNames : d.shortNames,
    namesScript: x.namesScript === 'asis' ? 'asis' : x.namesScript === 'cyrl' ? 'cyrl' : d.namesScript,
    footer: typeof x.footer === 'boolean' ? x.footer : d.footer,
    kinds,
    regions,
  };
}

/** Hudud uchun yakuniy shablon: umumiy + hudud o'zgartirishlari */
export function resolveTemplate(t: ActTemplate, regionCode: number | null): ActTemplate & { regionApplied: boolean } {
  const o = regionCode !== null && regionCode !== 0 ? t.regions[String(regionCode)] : undefined;
  if (!o) return { ...t, regionApplied: false };
  return {
    ...t,
    approverPosition: o.approverPosition ?? t.approverPosition,
    approverName: o.approverName ?? t.approverName,
    company: o.company ?? t.company,
    city: o.city ?? t.city,
    storekeeperTitle: o.storekeeperTitle ?? t.storekeeperTitle,
    storekeeperName: o.storekeeperName ?? t.storekeeperName,
    agreed: o.agreed?.length ? o.agreed : t.agreed,
    regionApplied: true,
  };
}

// ─────────── Ismlar ───────────

const LAT_CYR: [RegExp, string][] = [
  [/o['ʻ‘’`]/g, 'ў'],
  [/g['ʻ‘’`]/g, 'ғ'],
  [/sh/g, 'ш'],
  [/ch/g, 'ч'],
  [/yo/g, 'ё'],
  [/yu/g, 'ю'],
  [/ya/g, 'я'],
  [/ye/g, 'е'],
  [/ts/g, 'ц'],
];
const SINGLE: Record<string, string> = {
  a: 'а', b: 'б', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'ҳ', i: 'и', j: 'ж', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п',
  q: 'қ', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', x: 'х', y: 'й', z: 'з', c: 'с', w: 'в',
};

/** O'zbek lotin → kirill (ism-familiyalar uchun); so'z boshidagi «e» → «э» */
export function latinToCyrillic(text: string): string {
  if (!/[a-z]/i.test(text)) return text;
  return text.replace(/[A-Za-zʻ‘’'`]+/g, (word) => {
    const upper = word === word.toUpperCase() && word.length > 1;
    const cap = word[0] === word[0]!.toUpperCase();
    let w = word.toLowerCase();
    w = w.replace(/^e/, 'э');
    for (const [re, to] of LAT_CYR) w = w.replace(re, to);
    w = [...w].map((ch) => SINGLE[ch] ?? (/['ʻ‘’`]/.test(ch) ? 'ъ' : ch)).join('');
    if (upper) return w.toUpperCase();
    return cap ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  });
}

/** «AKBAROV FARRUX OTABEKOVICH» → «Akbarov F.»; allaqachon qisqa bo'lsa — o'zgarmaydi */
export function shortName(full: string): string {
  const t = full.trim().replace(/\s+/g, ' ');
  if (!t) return t;
  if (/^[^\s]+\s+[A-ZА-ЯЎҚҒҲ]\.?(\s*[A-ZА-ЯЎҚҒҲ]\.?)?$/i.test(t) || /^[A-ZА-ЯЎҚҒҲ]\.\s*[^\s]+$/i.test(t)) return t;
  const parts = t.split(' ');
  if (parts.length < 2) return cap(t);
  return `${cap(parts[0]!)} ${parts[1]!.charAt(0).toUpperCase()}.`;
  function cap(w: string): string {
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }
}

export function personName(t: ActTemplate, name: string | null | undefined): string {
  if (!name || !name.trim()) return '____________________';
  let n = t.shortNames ? shortName(name) : name.trim();
  if (t.namesScript === 'cyrl') n = latinToCyrillic(n);
  return n;
}

/** {o'rinbosar} larni to'ldirish */
export function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k]! : m));
}

const MONTHS_CYR = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

/** «2026-07-06» → «“06” июль 2026-йил» */
export function cyrDate(iso: string | null): string {
  if (!iso) return '“___” _______ 20___-йил';
  const [y, m, d] = iso.split('-');
  return `“${d}” ${MONTHS_CYR[Number(m) - 1]} ${y}-йил`;
}

@Injectable()
export class WarehouseTemplates {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<ActTemplate> {
    const row = await this.prisma.setting.findUnique({ where: { key: ACT_TEMPLATE_KEY } });
    return sanitizeTemplate(row?.value ?? {});
  }

  async save(input: unknown, userId: string): Promise<ActTemplate> {
    if (!input || typeof input !== 'object') throw new BadRequestException("Shablon noto'g'ri");
    const value = sanitizeTemplate(input);
    await this.prisma.setting.upsert({
      where: { key: ACT_TEMPLATE_KEY },
      create: { key: ACT_TEMPLATE_KEY, value: value as unknown as object },
      update: { value: value as unknown as object },
    });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'warehouse_act_template', entityId: ACT_TEMPLATE_KEY, summary: `Ombor dalolatnomasi shabloni o'zgartirildi (hududlar: ${Object.keys(value.regions).length} ta)` });
    return value;
  }

  /** Standartga qaytarish */
  async reset(userId: string): Promise<ActTemplate> {
    await this.prisma.setting.deleteMany({ where: { key: ACT_TEMPLATE_KEY } });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'warehouse_act_template', entityId: ACT_TEMPLATE_KEY, summary: 'Ombor dalolatnomasi shabloni standartga qaytarildi' });
    return sanitizeTemplate({});
  }
}