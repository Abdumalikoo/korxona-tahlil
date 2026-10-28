// ═══════════════════════════════════════════════════════════
// KPI — bo'limlar baholash mezonlari (shablonlar) va ball hisobi. Sof modul: baza yo'q, testlanadi.
// Manba: «C:\dastur uchun data\KPI» hujjatlari (Tax Free, Axborot xizmati, Marksheyder baholash mezonlari).
// Ballarni BIZ belgilaganmiz — bo'lim rahbari faqat tanlaydi (daraja / bor-yo'q / holatlar soni), ball o'zi hisoblanadi
// va o'zgartirib bo'lmaydi.
//
// Mezon turlari:
//  • LEVEL   — darajalardan bittasi (masalan, «60 mln gacha — 5 ball»);
//  • FLAG    — bajarildi / bajarilmadi (to'liq ball yoki 0);
//  • PER_CASE — har holat uchun ball (cap — eng ko'pi, bo'lmasa cheklanmaydi);
//  • COUNT_LEVELS — holatlar soniga qarab qat'iy ball (masalan, 1 ta — 7, 2 ta — 12 …);
//  • COUNT_TIERS — bir necha toifa bo'yicha son × ball (Marksheyder: har mijoz shartnoma narxiga qarab), cap — eng ko'pi.
// Yakuniy ball = rag'batlantiruvchi jami − kamaytiruvchi jami, 0 … 100 oralig'ida.
// ═══════════════════════════════════════════════════════════

export type KpiKind = 'BONUS' | 'PENALTY';

export type KpiCriterion = {
  id: string;
  /** Hujjatdagi tartib raqami */
  no: number;
  kind: KpiKind;
  title: string;
  /** Eng ko'p ball (kamaytiruvchida — eng ko'p chegirma; musbat son) */
  max: number;
  /** Hisoblash methodikasi (hujjatdan qisqa) */
  method: string;
} & (
  | { type: 'LEVEL'; levels: { id: string; label: string; points: number }[] }
  | { type: 'FLAG'; label: string }
  | { type: 'PER_CASE'; perCase: number; cap: number | null }
  | { type: 'COUNT_LEVELS'; steps: { min: number; points: number }[] }
  | { type: 'COUNT_TIERS'; tiers: { id: string; label: string; points: number }[]; cap: number }
);

export interface KpiTemplate {
  key: string;
  /** Ilovadagi bo'lim nomi (departments.name bilan solishtiriladi) */
  department: string;
  title: string;
  source: string;
  criteria: KpiCriterion[];
}

/** Tanlov: LEVEL — level; FLAG — on; PER_CASE / COUNT_LEVELS — count; COUNT_TIERS — counts[tierId] */
export interface KpiPick {
  level?: string;
  on?: boolean;
  count?: number;
  counts?: Record<string, number>;
}

const L = (pairs: [string, number][]) => pairs.map(([label, points], i) => ({ id: `l${i + 1}`, label, points }));

export const KPI_TEMPLATES: KpiTemplate[] = [
  // ─────────── Marksheyderlik xizmati ───────────
  {
    key: 'MARKSHEYDER',
    department: 'Marksheyder',
    title: "«Marksheyderlik xizmati» bo'limi xodimlari faoliyatini baholash mezonlari",
    source: 'Маркшейдер бахолаш мезонлари.docx',
    criteria: [
      {
        id: 'M1', no: 1, kind: 'BONUS', title: "Marksheyderlik xizmati bo'yicha yangi mijoz (shartnoma) jalb qilish — oyiga kamida 3 ta", max: 30,
        method: "Har bir yangi mijoz bilan tuzilgan shartnoma narxiga qarab: 5 mln so'mgacha — 2 ball; 5–10 mln — 5 ball; 10 mln dan yuqori — 10 ball (jami 30 gacha)",
        type: 'COUNT_TIERS', cap: 30,
        tiers: [{ id: 't1', label: "5 mln so'mgacha", points: 2 }, { id: 't2', label: '5 mln dan 10 mln gacha', points: 5 }, { id: 't3', label: '10 mln dan yuqori', points: 10 }],
      },
      {
        id: 'M2', no: 2, kind: 'BONUS', title: "Marksheyderlik o'lchovlari soni (yangi jalb qilinganlardan tashqari)", max: 20,
        method: "Hisobot oyida o'tkazilgan o'lchovlar soni", type: 'LEVEL',
        levels: L([["O'lchov yo'q", 0], ['5 tagacha', 5], ['5 tadan 10 tagacha', 10], ['10 tadan ortiq', 20]]),
      },
      {
        id: 'M3', no: 3, kind: 'BONUS', title: "O'lchovlar samaradorligi (yangi jalb qilinganlardan tashqari)", max: 30,
        method: "Aniqlangan qo'shimcha hajm soliq hisobotiga nisbatan", type: 'LEVEL',
        levels: L([["Qo'shimcha aniqlanmadi", 0], ['150% gacha qo‘shimcha', 10], ['150% dan 200% gacha', 20], ['200% dan yuqori', 30]]),
      },
      {
        id: 'M4', no: 4, kind: 'BONUS', title: "Ro'yxatdan o'tgan obyektlarni qamrab olish darajasi (oxirgi 6 oy)", max: 20,
        method: "Biriktirilgan hududdagi faol obyektlardan xizmat ko'rsatilganlari ulushi", type: 'LEVEL',
        levels: L([['5% gacha', 5], ['5% dan 10% gacha', 10], ['10% dan yuqori', 20]]),
      },
      { id: 'MP1', no: 1, kind: 'PENALTY', title: "O'lchov va hisob-kitoblarda xatolikka yo'l qo'yilishi", max: 10, method: 'Dastlabki o‘lchov xato bo‘lib, qayta bajarish zarurati tug‘ilganda', type: 'FLAG', label: 'Holat bor' },
      { id: 'MP2', no: 2, kind: 'PENALTY', title: "Hisobot va ma'lumotlarni o'z vaqtida taqdim etmaslik", max: 10, method: 'Oylik hisobotlarni belgilangan muddatdan kechiktirib topshirish', type: 'FLAG', label: 'Holat bor' },
      { id: 'MP3', no: 3, kind: 'PENALTY', title: "Mijozlar yoki soliq to'lovchilardan asosli shikoyat", max: 10, method: 'Davlat soliq organlari yoki boshqa tashkilotlardan asosli e‘tiroz kelib tushganda', type: 'FLAG', label: 'Holat bor' },
    ],
  },

  // ─────────── Tax free ───────────
  {
    key: 'TAX_FREE',
    department: 'Tax free',
    title: "«Tax free» bo'limi xodimlari faoliyatini baholash mezonlari",
    source: 'Tax Free бахолаш мезонлари ходимлар.docx',
    criteria: [
      { id: 'T1', no: 1, kind: 'BONUS', title: "Chet el fuqarolariga qaytarilgan QQS summasi (bitta xodim, oy davomida)", max: 15, method: 'Shoxobchadagi xodim xizmati natijasida qaytarilgan QQS', type: 'LEVEL', levels: L([['60 mln so‘mgacha', 5], ['60 mln dan 100 mln gacha', 8], ['100 mln dan 150 mln gacha', 12], ['150 mln dan yuqori', 15]]) },
      { id: 'T2', no: 2, kind: 'BONUS', title: "Qaytarilgan QQS summasining o'sish sur'ati (o'tgan oyga nisbatan)", max: 15, method: "O'tgan oyga nisbatan o'sish (foizda)", type: 'LEVEL', levels: L([['Kamaygan', 0], ["O'sish yo'q (0% atrofida)", 3], ['1% dan 4,9% gacha', 6], ['5% dan 9,9% gacha', 9], ['10% dan 14,9% gacha', 12], ['15% dan yuqori', 15]]) },
      { id: 'T3', no: 3, kind: 'BONUS', title: "Ingliz, rus, xitoy, arab tillarida axborot materiallari joylashtirish", max: 10, method: 'Hisobot oyida joylashtirilgan materiallar soni', type: 'LEVEL', levels: L([['Joylashtirilmagan', 0], ['1 ta', 2], ['2 ta', 4], ['3 ta', 6], ['4 ta', 8], ['5 ta va undan ko‘p', 10]]) },
      { id: 'T4', no: 4, kind: 'BONUS', title: "Tax Free xizmatidan foydalanuvchilar soni ortishi", max: 10, method: "O'tgan oyga yoki o'tgan yilning mos davriga nisbatan", type: 'LEVEL', levels: L([["O'sish yo'q (5% dan kam)", 0], ['5–9% oshgan', 5], ['10–19% oshgan', 8], ['20% va undan yuqori', 10]]) },
      { id: 'T5', no: 5, kind: 'BONUS', title: "Qaytarishlarni o'z vaqtida rasmiylashtirish", max: 10, method: 'Ichki muddatda rasmiylashtirilganlar ulushi (bank/tizim kechikishi alohida)', type: 'LEVEL', levels: L([['90% dan kam', 0], ['90–94,99%', 5], ['95–97,99%', 8], ['98–100%', 10]]) },
      { id: 'T6', no: 6, kind: 'BONUS', title: "Hujjatlarni tekshirish va ma'lumot kiritish aniqligi", max: 10, method: 'Xatosiz yopilgan hujjatlar ulushi', type: 'LEVEL', levels: L([['95% dan kam', 0], ['95–97,99%', 4], ['98–99,49%', 7], ['99,5–100%', 10]]) },
      { id: 'T7', no: 7, kind: 'BONUS', title: "Kunlik kassa va qaytarish reestrlarini to'liq yuritish", max: 10, method: 'Muddatida topshirilgan imzolangan reestrlar ulushi', type: 'LEVEL', levels: L([['90% dan kam', 0], ['90–94,99%', 5], ['95–99,99%', 7], ['100%', 10]]) },
      { id: 'T8', no: 8, kind: 'BONUS', title: 'Hisobot va ijro intizomi', max: 3, method: 'Oylik hisobotni keyingi oyning 2-sanasigacha taqdim etish (uzrli holatlar istisno)', type: 'LEVEL', levels: L([['Muddatida', 3], ['1 ta kechikish', 2], ['2 ta kechikish', 1], ['3 ta va ko‘p', 0]]) },
      { id: 'T9', no: 9, kind: 'BONUS', title: "QQS qaytarish huquqi va tovarlarga qo'yilgan talablarni to'g'ri tekshirish", max: 8, method: 'To‘g‘ri tekshirilgan amaliyotlar ulushi (yosh, norezidentlik, 300 000 so‘m, 3 oy, chek)', type: 'LEVEL', levels: L([['100%', 8], ['98–99,99%', 5], ['95–97,99%', 2], ['95% dan kam', 0]]) },
      { id: 'T10', no: 10, kind: 'BONUS', title: "Qaytarish usuli va summasini qonunchilikka muvofiq hisoblash", max: 5, method: 'Naqdda 85%, kartaga — amaldagi me‘yor; to‘lov usuli to‘g‘ri qayd etilgan', type: 'LEVEL', levels: L([['100%', 5], ['98–99,99%', 3], ['95–97,99%', 1], ['95% dan kam', 0]]) },
      { id: 'T11', no: 11, kind: 'BONUS', title: "Aviaqatnovlar grafigi asosida uzluksiz xizmat ko'rsatish", max: 4, method: 'Navbatchilik jadvalidagi smenalarni to‘liq qoplash (uzrli holatlar chiqariladi)', type: 'LEVEL', levels: L([['100%', 4], ['95–99,99%', 2], ['95% dan kam', 0]]) },
      // Hujjatda «har holat −5, jami −30 gacha» va «1 ta — 7, 2 ta — 12, 3 ta — 20, 4+ — 30» birga yozilgan; jadval (aniqroq) olindi
      { id: 'TP1', no: 1, kind: 'PENALTY', title: "Xodim aybi bilan QQS qaytarish muddati buzilishi", max: 30, method: 'Hujjat bilan tasdiqlangan holatlar: 1 ta — 7, 2 ta — 12, 3 ta — 20, 4 ta va ko‘p — 30 ball', type: 'COUNT_LEVELS', steps: [{ min: 1, points: 7 }, { min: 2, points: 12 }, { min: 3, points: 20 }, { min: 4, points: 30 }] },
      { id: 'TP2', no: 2, kind: 'PENALTY', title: 'Chet el fuqarolaridan rasmiy shikoyatlar', max: 10, method: 'Har bir asosli shikoyat uchun 5 ball, eng ko‘pi 10', type: 'PER_CASE', perCase: 5, cap: 10 },
      { id: 'TP3', no: 3, kind: 'PENALTY', title: 'Intizom buzilishi (kechikish, ish joyini sababsiz tark etish)', max: 10, method: 'Har bir holat uchun 5 ball, eng ko‘pi 10', type: 'PER_CASE', perCase: 5, cap: 10 },
      { id: 'TP4', no: 4, kind: 'PENALTY', title: 'Naqd pul yoki hisobot reestrida tasdiqlangan tafovut', max: 10, method: '1 ta holat — 5 ball; 2 ta va ko‘p — 10 ball (dalolatnoma bilan)', type: 'COUNT_LEVELS', steps: [{ min: 1, points: 5 }, { min: 2, points: 10 }] },
      { id: 'TP5', no: 5, kind: 'PENALTY', title: 'Bajarilmagan rahbariyat topshiriqlari', max: 7, method: '1 ta asossiz kechikish — 2; 2 ta — 4; 3 ta va ko‘p — 7 ball', type: 'COUNT_LEVELS', steps: [{ min: 1, points: 2 }, { min: 2, points: 4 }, { min: 3, points: 7 }] },
    ],
  },

  // ─────────── Axborot xizmati ───────────
  {
    key: 'AXBOROT',
    department: 'Axborot xizmati',
    title: 'Axborot xizmati bosh mutaxassisi faoliyatini baholash mezonlari',
    source: 'Ахборот хизмати мезонлари.docx',
    criteria: [
      { id: 'A1', no: 1, kind: 'BONUS', title: "Faoliyatga oid axborotlarni OAV va ijtimoiy tarmoqlarda yoritish rejasining bajarilishi", max: 15, method: 'Oylik media-reja 100% bajarilishi', type: 'FLAG', label: 'Bajarildi' },
      { id: 'A2', no: 2, kind: 'BONUS', title: 'Rasmiy veb-saytni dolzarb axborot bilan muntazam yangilash', max: 10, method: 'Belgilangan muddatda barcha materiallar joylashtirilsa', type: 'FLAG', label: 'Bajarildi' },
      { id: 'A3', no: 3, kind: 'BONUS', title: "Ijtimoiy tarmoqlarda rasmiy sahifalarni yuritish samaradorligi", max: 10, method: 'Kontent-reja to‘liq bajarilsa', type: 'FLAG', label: 'Bajarildi' },
      { id: 'A4', no: 4, kind: 'BONUS', title: "Matbuot relizlari, rasmiy xabarlar va intervyularni o'z vaqtida tayyorlash", max: 10, method: 'Rahbariyat topshiriqlari muddatida bajarilsa', type: 'FLAG', label: 'Bajarildi' },
      { id: 'A5', no: 5, kind: 'BONUS', title: 'Videorolik, infografika va boshqa mediamahsulotlar tayyorlash', max: 8, method: 'Oylik rejadagi materiallar to‘liq tayyorlansa', type: 'FLAG', label: 'Bajarildi' },
      { id: 'A6', no: 6, kind: 'BONUS', title: "OAV va blogerlar bilan hamkorlik, ijobiy chiqishlar soni", max: 8, method: 'Belgilangan ko‘rsatkichga erishilsa', type: 'FLAG', label: 'Bajarildi' },
      { id: 'A7', no: 7, kind: 'BONUS', title: "Salbiy xabarlarga tezkor munosabat bildirish", max: 8, method: '1 ish kuni ichida munosabat bildirilsa', type: 'FLAG', label: 'Bajarildi' },
      { id: 'A8', no: 8, kind: 'BONUS', title: "Fuqarolar va OAV so'rovlariga o'z vaqtida javob tayyorlash", max: 7, method: 'Barcha so‘rovlarga qonuniy muddatda javob berilsa', type: 'FLAG', label: 'Bajarildi' },
      { id: 'A9', no: 9, kind: 'BONUS', title: 'Xizmatlarni ommalashtirishga qaratilgan PR-aksiya va tadbirlar', max: 8, method: 'Oylik reja 100% bajarilsa', type: 'FLAG', label: 'Bajarildi' },
      { id: 'A10', no: 10, kind: 'BONUS', title: "Axborot materiallari sifati (imloviy, uslubiy, huquqiy xatosiz)", max: 6, method: 'Kamchilik aniqlanmasa', type: 'FLAG', label: 'Bajarildi' },
      { id: 'A11', no: 11, kind: 'BONUS', title: "Tahliliy hisobotlarni rahbariyatga o'z vaqtida taqdim etish", max: 5, method: 'Barcha hisobotlar muddatida taqdim etilsa', type: 'FLAG', label: 'Bajarildi' },
      { id: 'A12', no: 12, kind: 'BONUS', title: 'Axborot siyosati va imijni yaxshilash bo‘yicha yangi tashabbuslar', max: 5, method: 'Hisobot oyida kamida 1 ta tashabbus', type: 'FLAG', label: 'Bajarildi' },
      { id: 'AP1', no: 1, kind: 'PENALTY', title: "Axborot materiallarini belgilangan muddatda e'lon qilmaslik", max: 10, method: 'Har bir holat uchun 10 ball', type: 'PER_CASE', perCase: 10, cap: null },
      { id: 'AP2', no: 2, kind: 'PENALTY', title: "Relizlar yoki rasmiy xabarlarda imloviy, uslubiy yoki faktologik xato", max: 5, method: 'Har bir holat uchun 5 ball', type: 'PER_CASE', perCase: 5, cap: null },
      { id: 'AP3', no: 3, kind: 'PENALTY', title: "Rahbariyat topshiriqlarini o'z vaqtida bajarmaslik", max: 5, method: 'Har bir topshiriq uchun 5 ball', type: 'PER_CASE', perCase: 5, cap: null },
      { id: 'AP4', no: 4, kind: 'PENALTY', title: "Veb-sayt yoki ijtimoiy tarmoqlarni muddatida yangilamaslik", max: 10, method: 'Har bir holat uchun 10 ball', type: 'PER_CASE', perCase: 10, cap: null },
      { id: 'AP5', no: 5, kind: 'PENALTY', title: "Fuqarolar yoki OAV so'rovlariga kechiktirib javob berish", max: 5, method: 'Har bir holat uchun 5 ball', type: 'PER_CASE', perCase: 5, cap: null },
      { id: 'AP6', no: 6, kind: 'PENALTY', title: "Imijga salbiy ta'sir qilgan noto'g'ri yoki tekshirilmagan axborot", max: 10, method: 'Har bir tasdiqlangan holat uchun 10 ball', type: 'PER_CASE', perCase: 10, cap: null },
      { id: 'AP7', no: 7, kind: 'PENALTY', title: "Foydalanuvchilarning asosli murojaatlarini javobsiz qoldirish", max: 5, method: 'Har bir holat uchun 5 ball', type: 'PER_CASE', perCase: 5, cap: null },
      { id: 'AP8', no: 8, kind: 'PENALTY', title: "Axborot xavfsizligi yoki maxfiy ma'lumotlarni oshkor etishga yo'l qo'yish", max: 5, method: 'Har bir tasdiqlangan holat uchun 5 ball', type: 'PER_CASE', perCase: 5, cap: null },
    ],
  },
];

export function templateOf(key: string): KpiTemplate | null {
  return KPI_TEMPLATES.find((t) => t.key === key) ?? null;
}

const MAX_COUNT = 99;
const int = (v: unknown) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_COUNT) : 0;
};

/** Bitta mezon bo'yicha ball (musbat; kamaytiruvchida — chegirma miqdori). Noto'g'ri tanlov — 0 */
export function criterionPoints(c: KpiCriterion, pick: KpiPick | undefined): number {
  if (!pick) return 0;
  switch (c.type) {
    case 'LEVEL':
      return c.levels.find((l) => l.id === pick.level)?.points ?? 0;
    case 'FLAG':
      return pick.on ? c.max : 0;
    case 'PER_CASE': {
      const v = int(pick.count) * c.perCase;
      return c.cap === null ? v : Math.min(v, c.cap);
    }
    case 'COUNT_LEVELS': {
      const n = int(pick.count);
      let p = 0;
      for (const s of c.steps) if (n >= s.min) p = s.points;
      return p;
    }
    case 'COUNT_TIERS': {
      const v = c.tiers.reduce((t, x) => t + int(pick.counts?.[x.id]) * x.points, 0);
      return Math.min(v, c.cap);
    }
  }
}

/** Tanlovni tozalash: faqat shablondagi mezonlar va to'g'ri qiymatlar qoladi (ball — keyin hisoblanadi) */
export function cleanPicks(t: KpiTemplate, raw: unknown): Record<string, KpiPick> {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, Record<string, unknown>>) : {};
  const out: Record<string, KpiPick> = {};
  for (const c of t.criteria) {
    const p = src[c.id];
    if (!p || typeof p !== 'object') continue;
    if (c.type === 'LEVEL' && typeof p.level === 'string' && c.levels.some((l) => l.id === p.level)) out[c.id] = { level: p.level };
    else if (c.type === 'FLAG' && p.on === true) out[c.id] = { on: true };
    else if ((c.type === 'PER_CASE' || c.type === 'COUNT_LEVELS') && int(p.count) > 0) out[c.id] = { count: int(p.count) };
    else if (c.type === 'COUNT_TIERS' && p.counts && typeof p.counts === 'object') {
      const counts = Object.fromEntries(c.tiers.map((x) => [x.id, int((p.counts as Record<string, unknown>)[x.id])]).filter(([, v]) => (v as number) > 0));
      if (Object.keys(counts).length) out[c.id] = { counts };
    }
  }
  return out;
}

/** Baho: mezonlar bo'yicha ball, rag'batlantiruvchi, kamaytiruvchi va yakuniy (0 … 100) */
export function score(t: KpiTemplate, picks: Record<string, KpiPick>) {
  const items = t.criteria.map((c) => ({ id: c.id, kind: c.kind, points: criterionPoints(c, picks[c.id]) }));
  const bonus = items.filter((x) => x.kind === 'BONUS').reduce((s, x) => s + x.points, 0);
  const penalty = items.filter((x) => x.kind === 'PENALTY').reduce((s, x) => s + x.points, 0);
  return { items, bonus, penalty, total: Math.max(0, Math.min(100, bonus - penalty)) };
}
