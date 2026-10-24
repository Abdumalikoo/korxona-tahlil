// ═══════════════════════════════════════════════════════════
// Xodimlar ma'lumotnomalari (kadrlar jadvallari): 10, 16, 37 va 51-jadval.
// Ustunlar — asl fayllardagi sarlavhalar bilan bir xil (shablon ham shu tartibda).
// Fayl o'qilganda sarlavha qatori o'zi topiladi (birinchi 30 qatordan), ustunlar nomi bo'yicha moslanadi —
// ustunlar tartibi o'zgargan yoki ortiqcha ustun qo'shilgan fayl ham o'qiladi.
// ═══════════════════════════════════════════════════════════

export type HrSheetCode = 'J10' | 'J16' | 'J37' | 'J51';

/** Xodim kartasidagi bo'lim */
export type HrGroup = 'asosiy' | 'ish' | 'shaxsiy' | 'pasport' | 'aloqa' | 'talim' | 'buyruq';

export const HR_GROUP_LABELS: Record<HrGroup, string> = {
  asosiy: 'Asosiy',
  ish: 'Ish joyi va lavozim',
  shaxsiy: "Shaxsiy ma'lumotlar",
  pasport: 'Pasport',
  aloqa: 'Aloqa',
  talim: "Ta'lim",
  buyruq: 'Buyruqlar',
};

export interface HrColumn {
  key: string;
  /** Shablondagi sarlavha (asl fayldagidek) */
  header: string;
  /** Boshqa yozilishlari (kirill/lotin) */
  aliases?: string[];
  kind?: 'text' | 'date' | 'int' | 'pinfl';
  width: number;
  group: HrGroup;
  /** Ro'yxatda yashiriladi (pasport, telefon …) — faqat xodim kartasida to'liq */
  sensitive?: boolean;
}

export interface HrSheetDef {
  code: HrSheetCode;
  /** Jadval raqami */
  no: number;
  /** Qisqa nomi (yorliq) */
  label: string;
  /** Shablon sarlavhasi */
  title: string;
  /** Qisqa izoh */
  hint: string;
  columns: HrColumn[];
  /** Tartib raqami ustuni (saqlanmaydi) */
  seqKey: string;
  nameKey: string;
  /** PINFL ustuni; yo'q bo'lsa (37-jadval) — xodim F.I.Sh. bo'yicha topiladi */
  pinflKey: string | null;
  /** Bir xodimga bir necha qator bo'lishi mumkin (51-jadval — har qabul / o'tkazish alohida) */
  multi: boolean;
  /** Bo'lim («miya») aniqlash uchun ustunlar: tuzilma / departament nomi */
  placeKeys: string[];
  positionKey: string | null;
  /** Holat ustuni («ishlayapti» …) */
  statusKey: string | null;
}

const c = (key: string, header: string, width: number, group: HrGroup, extra: Partial<HrColumn> = {}): HrColumn => ({ key, header, width, group, ...extra });

export const HR_SHEETS: HrSheetDef[] = [
  {
    code: 'J10',
    no: 10,
    label: '10-jadval · Umumiy',
    title: "Давлат солиқ хизмати органи ходимлари тўғрисида\nМАЪЛУМОТ",
    hint: "Hamma xodimlar: tabel, tug'ilgan sana va joyi, holati, tuzilma, lavozim, tizimdagi staj, ma'lumoti, manzili, unvoni",
    seqKey: 'tr',
    nameKey: 'fio',
    pinflKey: 'pinfl',
    multi: false,
    placeKeys: ['tuzilma'],
    positionKey: 'lavozim',
    statusKey: 'holat',
    columns: [
      c('tr', 'Т.р', 6, 'asosiy', { aliases: ['T.r', '№'] }),
      c('tabel', 'Табел', 8, 'ish', { kind: 'int', aliases: ['Tabel'] }),
      c('fio', 'ФИО', 26, 'asosiy', { aliases: ['FIO', 'F.I.Sh', 'FISH'] }),
      c('tugilganSana', 'Туғилган санаси', 11, 'shaxsiy', { kind: 'date', aliases: ["Tug'ilgan sanasi"] }),
      c('tugilganJoy', 'Туғилган жойи', 27, 'shaxsiy', { aliases: ["Tug'ilgan joyi"] }),
      c('holat', 'Холати', 16, 'asosiy', { aliases: ['Holati'] }),
      c('tashkilot', 'Ташкилот', 32, 'ish', { aliases: ['Tashkilot'] }),
      c('tuzilma', 'Тузилмаси', 32, 'ish', { aliases: ['Tuzilmasi'] }),
      c('lavozim', 'Лавозими', 21, 'ish', { aliases: ['Lavozimi'] }),
      c('tizimda', 'Тизимда', 12, 'ish', { kind: 'date', aliases: ['Tizimda'] }),
      c('lavozimda', 'Лавозимида', 13, 'ish', { kind: 'date', aliases: ['Lavozimida'] }),
      c('malumot', 'Маълумоти', 16, 'talim', { aliases: ["Ma'lumoti"] }),
      c('manzil', 'Яшаш манзили', 35, 'aloqa', { aliases: ['Yashash manzili'], sensitive: true }),
      c('yosh', 'Ёши', 10, 'shaxsiy', { kind: 'int', aliases: ['Yoshi'] }),
      c('unvon', 'Махсус унвони', 26, 'ish', { aliases: ['Maxsus unvoni'] }),
      c('pinfl', 'ЖШШИР', 17, 'asosiy', { kind: 'pinfl', aliases: ['JSHSHIR', 'PINFL', 'ЖШШИР (PINFL)'] }),
    ],
  },
  {
    code: 'J16',
    no: 16,
    label: '16-jadval · Shaxsiy',
    title: "Davlat soliq xizmati organlari xodimlari to‘g‘risida \nMA'LUMOT",
    hint: "Lavozimga tayinlash buyrug'i, pasport, jinsi, millati, aloqa, ta'lim, diplom, shartnoma muddati",
    seqKey: 'tr',
    nameKey: 'fio',
    pinflKey: 'pinfl',
    multi: false,
    placeKeys: ['departament', 'tuzilma', 'toliqTuzilma'],
    positionKey: 'lavozim',
    statusKey: null,
    columns: [
      c('tr', 'T.r', 5, 'asosiy', { aliases: ['Т.р', '№'] }),
      c('fio', 'Xodimning familiyasi, ismi va sharifi', 39, 'asosiy', { aliases: ['FIO', 'ФИО', 'FISH'] }),
      c('departament', 'Departament (boshqarma) nomi', 30, 'ish'),
      c('tuzilma', 'Tuzilma nomi', 37, 'ish'),
      c('lavozim', 'Egallab turgan lavozimi', 26, 'ish'),
      c('buyruqSana', 'Lavozimga tayinlangan buyruq sanasi', 18, 'buyruq', { kind: 'date' }),
      c('buyruqRaqam', 'Lavozimga tayinlangan buyruq raqami', 18, 'buyruq'),
      c('pinfl', 'PINFL', 17, 'asosiy', { kind: 'pinfl', aliases: ['JSHSHIR', 'ЖШШИР'] }),
      c('pasportSeriya', 'Pasport \nseriyasi', 10, 'pasport', { sensitive: true }),
      c('pasportRaqam', 'Pasport \nraqami', 12, 'pasport', { sensitive: true }),
      c('pasportKim', 'Pasport kim tomonidan berilganligi', 30, 'pasport', { sensitive: true }),
      c('pasportSana', 'Pasport berilgan sanasi', 14, 'pasport', { kind: 'date', sensitive: true }),
      c('pasportMuddat', 'Pasportning amal qilish muddati', 16, 'pasport', { kind: 'date', sensitive: true }),
      c('jinsi', 'Jinsi', 11, 'shaxsiy'),
      c('millati', 'Millati', 13, 'shaxsiy'),
      c('email', 'Elektron pochta manzili', 22, 'aloqa', { sensitive: true }),
      c('ip', 'IP raqami', 14, 'aloqa', { sensitive: true }),
      c('telefon', 'Telefon raqam', 16, 'aloqa', { sensitive: true }),
      c('malumot', 'Maʼlumoti', 20, 'talim', { aliases: ["Ma'lumoti"] }),
      c('talimDaraja', 'Ta’lim darajasi', 16, 'talim', { aliases: ["Ta'lim darajasi"] }),
      c('muassasa', 'Tamomlagan taʼlim muassasasi', 30, 'talim', { aliases: ["Tamomlagan ta'lim muassasasi"] }),
      c('tamomlaganYil', 'Tamomlagan yili', 12, 'talim', { kind: 'int' }),
      c('mutaxassislik', 'Mutaxassisligi', 22, 'talim'),
      c('diplom', 'Diplom raqami', 18, 'talim', { sensitive: true }),
      c('toliqTuzilma', 'Toʻliq tuzilma nomi', 40, 'ish', { aliases: ["To'liq tuzilma nomi"] }),
      c('buyruqAsos', 'Buyruq asosi', 30, 'buyruq'),
      c('buyruqMazmun', 'Buyruq mazmuni', 21, 'buyruq'),
      c('shartnomaTugash', 'Shartnoma \ntugash sanasi', 16, 'buyruq', { kind: 'date' }),
    ],
  },
  {
    code: 'J37',
    no: 37,
    label: '37-jadval · Ishga kirganlar',
    title: "Ishga kirgan xodimlar to‘g‘risida ma'lumot",
    hint: "Ishga kirganlar: soliq organi, lavozimi, ma'lumoti (mutaxassisligi), ilgari ishlagan joyi. PINFL yo'q — xodim F.I.Sh. bo'yicha topiladi",
    seqKey: 'tr',
    nameKey: 'fio',
    pinflKey: null,
    multi: false,
    placeKeys: ['lavozim'],
    positionKey: 'lavozim',
    statusKey: null,
    columns: [
      c('tr', '№', 5, 'asosiy', { aliases: ['T.r', 'Т.р'] }),
      c('fio', 'Familiyasi, ismi, otasining ismi', 30, 'asosiy', { aliases: ['FIO', 'ФИО', 'FISH'] }),
      c('organ', 'Soliq organi', 40, 'ish'),
      c('lavozim', 'Lavozimi', 50, 'ish'),
      c('malumot', "Ma'lumoti", 30, 'talim', { aliases: ['Maʼlumoti'] }),
      c('ilgari', 'Ilgari ishlagan joyi', 35, 'ish'),
    ],
  },
  {
    code: 'J51',
    no: 51,
    label: '51-jadval · Qabul va o‘tkazish',
    title: "Davlat soliq xizmati organlariga ishga qabul qilingan (o'tkazilgan) xodimlar bo'yicha \nMA'LUMOT",
    hint: "Ishga qabul qilish va o'tkazishlar: qaysi tuzilma va lavozimga, asos, markaziy apparat xulosasi, holati. Bir xodimga bir necha qator bo'lishi mumkin",
    seqKey: 'tr',
    nameKey: 'fio',
    pinflKey: 'pinfl',
    multi: true,
    placeKeys: ['tuzilma'],
    positionKey: 'lavozim',
    statusKey: 'holat',
    columns: [
      c('tr', '№', 6, 'asosiy', { aliases: ['T.r', 'Т.р'] }),
      c('hudud', 'Hudud kodi', 12, 'ish'),
      c('fio', 'FISH', 30, 'asosiy', { aliases: ['FIO', 'ФИО'] }),
      c('tashkilot', 'Tashkilot', 29, 'ish'),
      c('tuzilma', "Qaysi tuzilmaga ishga qabul qilingan (o'tkazilgan)", 35, 'ish'),
      c('lavozim', "Qaysi lavozimga ishga qabul qilingan (o'tkazilgan)", 25, 'ish'),
      c('pinfl', 'JSHSHIR', 17, 'asosiy', { kind: 'pinfl', aliases: ['PINFL', 'ЖШШИР'] }),
      c('asos', "Qabul qilish (o'tkazish) uchun asos ", 26, 'buyruq'),
      c('xulosa', 'Markaziy apparat xulosasi', 30, 'buyruq'),
      c('holat', 'Xodim holati', 18, 'asosiy'),
    ],
  },
];

export const HR_SHEET = (code: string): HrSheetDef | undefined => HR_SHEETS.find((s) => s.code === code);

/**
 * Tuzilma nomi → bo'lim («miya»). Xodimlar bazasidagi naqshlar bilan bir xil, Tax free uchun — rasmiy nomi ham
 * («Chet el fuqarolariga qo'shilgan qiymat solig'ini qaytarish …»).
 */
export const HR_UNIT_PATTERNS: Record<string, RegExp> = {
  TAX_FREE: /tax\s*-?\s*free|такс\s*-?\s*фри|qo\W?shilgan\s+qiymat\s+solig\W?ini\s+qaytarish|қўшилган\s+қиймат\s+солиғини\s+қайтариш/i,
  MARKSHEYDER: /marksheyder|маркшейдер/i,
  FERMER: /fermer|фермер/i,
  BUXGALTERIYA: /buxgalteriya\s+xizmat|бухгалтерия\s+хизмат/i,
};

/** «ishlayapti» — faol; bo'shagan / ishdan ketgan — faol emas */
export function isWorking(status: string | null | undefined): boolean {
  if (!status) return true;
  return !/bo\W?sha|ketgan|ozod|бўша|кетган|озод|arxiv/i.test(status);
}