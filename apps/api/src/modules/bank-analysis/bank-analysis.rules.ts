import { createHash } from 'node:crypto';

// ═══════════════════════════════════════════════════════════
// Bank ko'chirmasi tahlili — qoidalar (sof funksiyalar, test qilinadi):
//  • o'xshashlik kaliti: yo'nalish (chiqim / kirim) + oluvchi (tashkilot ИНН, bo'lmasa nomi; jismoniy shaxslar — bitta
//    guruh) + izoh mazmuni (sana, raqam, summa, oy nomi, «№», «от», «ндс» … olib tashlanadi);
//  • tur: izoh va oluvchi nomidagi so'zlar bo'yicha (soliq, ish haqi, bank xizmati, kommunal, aloqa …);
//  • qator kaliti (id) — qayta yuklansa ham o'zgarmaydi (keyingi bosqich: izoh tuzatish va yo'naltirish shunga bog'lanadi).
// ═══════════════════════════════════════════════════════════

export type BankDir = 'OUT' | 'IN';

export type BankKind =
  | 'SOLIQ'
  | 'ISH_HAQI'
  | 'BANK'
  | 'KOMMUNAL'
  | 'ALOQA'
  | 'IJARA'
  | 'YOQILGI'
  | 'XARID'
  | 'XIZMAT'
  | 'KREDIT'
  | 'QAYTARISH'
  | 'ICHKI'
  | 'TUSHUM'
  | 'BOSHQA';

export const BANK_KIND_LABEL: Record<BankKind, string> = {
  SOLIQ: 'Soliq va majburiy to‘lovlar',
  ISH_HAQI: 'Ish haqi va xodimlarga',
  BANK: 'Bank xizmati',
  KOMMUNAL: 'Kommunal',
  ALOQA: 'Aloqa va internet',
  IJARA: 'Ijara',
  YOQILGI: 'Yoqilg‘i',
  XARID: 'Tovar va material',
  XIZMAT: 'Xizmat va ishlar',
  KREDIT: 'Kredit va foiz',
  QAYTARISH: 'Qaytarish',
  ICHKI: 'Ichki o‘tkazma',
  TUSHUM: 'Xizmat tushumi',
  BOSHQA: 'Boshqa',
};

/** Tartib muhim: birinchi mos kelgani olinadi (aniqrog'i yuqorida) */
const KIND_RULES: { kind: BankKind; re: RegExp; dir?: BankDir }[] = [
  { kind: 'QAYTARISH', re: /возврат|қайтар|qaytar|ортиқча\s*тўла|ortiqcha\s*to/iu },
  { kind: 'ICHKI', re: /перевод\s*(собственных|между\s*своими)|ўз\s*ҳисоб|o.?z\s*hisob|собственн\p{L}*\s*средств|подкреплени|ичк[иа]\s*ўтказ/iu },
  { kind: 'BANK', re: /комисси|за\s*обслуживан|услуг[иа]?\s*банка|банк\s*хизмат|bank\s*xizmat|за\s*выд\.?\s*ин\.?\s*вал|конверт|за\s*смс|sms[-\s]?xabar|инкассац|расчетно[-\s]?кассов/iu },
  { kind: 'SOLIQ', re: /налог|солиқ|soliq|ндфл|ндс(?!\s*не)|qqs|ққс|жшдс|jshds|инпс|ijtimoiy\s*soliq|ижтимоий|социальн\p{L}*\s*(налог|отчисл)|пеня|пени(?![\p{L}\p{N}])|штраф|жарима|jarima|бюджет|гни(?![\p{L}\p{N}])|давлат\s*божи|госпошлин|мулк\s*солиғ|ер\s*солиғ|сув\s*солиғ/iu },
  { kind: 'ISH_HAQI', re: /заработн|зарплат|иш\s*ҳақ|иш\s*хак|ish\s*haq|аванс|оклад|отпускн|таътил|ta.?til|мукофот|mukofot|премия|моддий\s*ёрдам|moddiy\s*yordam|командировоч|хизмат\s*сафар|xizmat\s*safar|пластик\p{L}*\s*карт|алимент|касаба|профсоюз/iu },
  { kind: 'KOMMUNAL', re: /электроэнерг|электр\s*энерг|elektr|газ(?![\p{L}\p{N}])|газоснаб|табиий\s*газ|водоснаб|водоотвед|ичимлик\s*сув|сув\s*таъмин|канализац|коммунал|kommunal|тепло|иссиқлик|issiqlik|чиқинди|мусор|вывоз\s*тбо|санитар\s*тозал/iu },
  { kind: 'ALOQA', re: /связ[ьи]|интернет|internet|телеком|telecom|узтелеком|uztelecom|мобайл|mobile|beeline|билайн|ucell|юселл|uzmobile|ummobile|perfectum|aloqa|алоқа|телефон|хостинг|домен/iu },
  { kind: 'IJARA', re: /аренд|ижара|ijara|лизинг/iu },
  { kind: 'YOQILGI', re: /топлив|бензин|ёқилғи|yoqilg|гсм(?![\p{L}\p{N}])|дизел|пропан|метан|сжиженн|автозаправ|заправк/iu },
  { kind: 'KREDIT', re: /кредит|заём|займ|ссуд|процент\p{L}*\s*по|фоиз|foiz|погашени\p{L}*\s*(основн|долг)/iu },
  { kind: 'XARID', re: /товар|махсулот|mahsulot|материал|запчаст|эҳтиёт\s*қисм|канцтовар|канцеляр|оргтехник|компьютер|бумаг|қоғоз|мебел|оборудован|жиҳоз|jihoz|хўжалик\s*мол|хозтовар|поставк|етказиб\s*бер/iu },
  { kind: 'XIZMAT', re: /услуг|хизмат|xizmat|работ[ыу]?(?![\p{L}\p{N}])|ишлар|ремонт|таъмир|ta.?mir|монтаж|ўрнат|обслуживани|консалт|аудит|нотариус|охран|қўриқла|курьер|почт|доставк|реклам|обучени|ўқитиш|сертифик|экспертиз/iu },
];

export function kindOf(dir: BankDir, purpose: string, counterparty: string): BankKind {
  const t = `${purpose} ${counterparty}`;
  for (const r of KIND_RULES) if ((!r.dir || r.dir === dir) && r.re.test(t)) return dir === 'IN' && (r.kind === 'XIZMAT' || r.kind === 'XARID') ? 'TUSHUM' : r.kind;
  return dir === 'IN' ? 'TUSHUM' : 'BOSHQA';
}

const MONTH_WORDS = /(?<![\p{L}\p{N}])(январ\p{L}*|феврал\p{L}*|март\p{L}*|апрел\p{L}*|ма[йя]\p{L}*|июн\p{L}*|июл\p{L}*|август\p{L}*|сентябр\p{L}*|октябр\p{L}*|ноябр\p{L}*|декабр\p{L}*|yanvar\p{L}*|fevral\p{L}*|mart\p{L}*|aprel\p{L}*|may\p{L}*|iyun\p{L}*|iyul\p{L}*|avgust\p{L}*|sentabr\p{L}*|oktabr\p{L}*|noyabr\p{L}*|dekabr\p{L}*)(?![\p{L}\p{N}])/giu;
const NOISE_WORDS = new Set([
  'от', 'для', 'по', 'за', 'на', 'из', 'без', 'или', 'при', 'сум', 'сўм', 'сумм', 'сумма', 'суммы', 'som', 'so', 'год', 'года', 'йил', 'йилнинг', 'yil', 'yilning', 'ойи', 'ой', 'учун', 'uchun', 'oyi', 'oy',
  'ндс', 'qqs', 'ққс', 'том', 'числе', 'включая', 'шу', 'жумладан', 'jumladan', 'договор', 'договору', 'дог', 'шартнома', 'шартномага', 'shartnoma', 'счет', 'счету', 'счёт', 'фактура', 'фактуре', 'ҳисоб',
  'hisob', 'faktura', 'акт', 'акту', 'согласно', 'асосан', 'asosan', 'основании', 'оплата', 'оплату', 'тўлов', 'тўловни', 'тулов', 'tolov', "to'lov", 'платеж', 'платежа', 'перечисление',
]);

/** Izoh mazmuni (o'xshashlik uchun): sana, raqam, summa, oy nomi va ortiqcha so'zlarsiz, eng ko'pi 7 so'z */
export function purposeKey(purpose: string): string {
  const words = String(purpose ?? '')
    .toLowerCase()
    .replace(/[ʻʼ‘’`']/g, '')
    .replace(MONTH_WORDS, ' ')
    .replace(/\d+([.,/-]\d+)*/g, ' ')
    .replace(/[№#%«»"()[\]{}:;,.!?*+=_/\\|-]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !NOISE_WORDS.has(w));
  return words.slice(0, 7).join(' ');
}

const ORG_FORMS = /(?<![\p{L}\p{N}])(ооо|оао|зао|ао|ап|чп|ип|мчж|аж|хк|хт|ук|ддп|гуп|дук|ddp|mchj|aj|xk|xt|ooo|llc|jsc)(?![\p{L}\p{N}])/giu;

/** Oluvchi kaliti: tashkilot ИНН (9 xona); jismoniy shaxs (14 xonali PINFL) — bitta guruh; bo'lmasa nomi */
export function counterpartyKey(inn: string, name: string): string {
  const d = String(inn ?? '').replace(/\D/g, '');
  if (d.length === 14) return 'person';
  if (d.length === 9) return `inn:${d}`;
  const n = String(name ?? '')
    .toLowerCase()
    .replace(/[ʻʼ‘’`'"«»]/g, '')
    .replace(ORG_FORMS, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return n ? `name:${n.slice(0, 80)}` : 'name:—';
}

export function groupKey(dir: BankDir, inn: string, name: string, purpose: string): string {
  return `${dir}|${counterpartyKey(inn, name)}|${purposeKey(purpose)}`;
}

/** Qator kaliti: qayta yuklansa ham o'zgarmaydi (bir faylda aynan bir xil qatorlar — tartib raqami bilan ajraladi) */
export function rowId(r: { docDate: string; docNo: string; inn: string; dir: BankDir; amountTiyin: string; purpose: string }, occurrence: number): string {
  return createHash('sha1').update([r.docDate, r.docNo, r.inn, r.dir, r.amountTiyin, r.purpose, String(occurrence)].join('\u0001')).digest('hex').slice(0, 20);
}

/** Ko'chirma yuqorisidagi o'z hisob raqami — faqat oxirgi 5 raqami (to'liq raqam saqlanmaydi) */
export function accountTail(lines: string[]): string | null {
  for (const l of lines) {
    const m = /(?<!\d)(\d{20})(?!\d)/.exec(l.replace(/\s+/g, ''));
    if (m) return m[1]!.slice(-5);
  }
  return null;
}

/** Hisob nomi (foydalanuvchi bergan yoki fayldan): qisqa, xavfsiz */
export function accountLabel(raw: unknown, fallback: string): string {
  const t = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
  return t || fallback;
}

/** Hisob kaliti (oylar shu hisob bo'yicha almashtiriladi) */
export function accountKey(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'asosiy'
  );
}
