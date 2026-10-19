// ═══════════════════════════════════════════════════════════
// Boshlang'ich hisobraqamlar ro'yxati — «Kunlik tushum va qoldiq» shablonidan
// ("Soliq-servis" AJ, Свод 2026). Bo'sh bazada bir marta yaratiladi;
// keyin Buxgalter/administrator «Hisobraqamlar» sahifasida o'zgartiradi.
// ═══════════════════════════════════════════════════════════

export interface SeedAccount {
  key: string;
  code: string | null;
  name: string;
  number?: string;
  parent?: string;
  /** Jamiga qaysi qatorga qo'shiladi; berilmasa — parent; null — hech qayerga */
  rollup?: string | null;
  inputs: string[];
  sums?: string[];
  balanceRule?: 'ADD' | 'SUB' | 'KEEP';
  isHeader?: boolean;
}

const ALL = ['ytd', 'mtd', 'refund', 'daily', 'balance'];
const SUB_ROW = ['ytd', 'mtd', 'daily'];
const BALANCE = ['balance'];

const MAIN_SUB: [string, string][] = [
  ['1.1', 'Uzum bank'],
  ['1.2', "Noto'g'ri tushgan pul (2D skaner)"],
  ['1.3', 'Payme tushum'],
  ['1.4', "Qaytarilgan pul va kassa apparat uchun to'lov"],
  ['1.5', "Shartnoma asosida tushum (xizmat ko'rsatish hudud)"],
  ['1.6', 'EHF, fiskal modul uchun (xarid.uzex.uz va shartnoma asosida), birja jarimalari'],
  ['1.7', "Rezidentlik sertifikati uchun to'lov"],
  ['1.8', 'YTIAM tushum'],
  ['1.9', 'Uzum bank (yangi shartnoma)'],
  ['1.10', "SAYT qurilmasi uchun to'lov"],
  ['1.11', "3802-Haq evaziga xizmat ko'rsatish-2026/1"],
  ['1.12', 'Buxgalteriya xizmatlari'],
  ['1.13', "Haq evaziga texnik xizmat ko'rsatish"],
  ['1.14', 'Marksheyderlik xizmati uchun (2026/2-son shartnoma)'],
  ['1.15', "Qo'mita tomonidan marksheyder tushumi"],
  ['1.16', 'Depozit tushumi (Mikrokreditbank)'],
];

const ACCOUNTS_I: [string, string, string][] = [
  ['2', 'EHF', '20210000403768814033'],
  ['3', 'Virtual kassa', '20210000103768814081'],
  ['4', 'Tax free (10 %)', '20210000403768814004'],
  ['5', 'Quyoshli xonadon (0,67%)', '20210000603768814005'],
  ['6', 'Ijtimoiy keshbek (0,67%)', '20210000803768814006'],
  ['7', 'Marksheyder', '20210000503768814032'],
  ['8', "Adaptor uchun to'lov", '20210000003768814007'],
  ['9', 'Yangi texnologiyalar ilmiy-axborot markazi (4 %)', '20210000103768814008'],
  ['10', "Soliq maslahatchilari uchun to'lov", '20210000303768814009'],
];

const REGIONS: [string, string][] = [
  ['QQR', '20210000503768814077'],
  ['Andijon v.', '20210000503768814066'],
  ['Buxoro v.', '20210000903768814078'],
  ['Jizzax v.', '20210000903768814074'],
  ['Qashqadaryo v.', '20210000803768814072'],
  ['Navoiy v.', '20210000703768814070'],
  ['Namangan v.', '20210000803768814068'],
  ['Samarqand v.', '20210000103768814067'],
  ['Surxondaryo v.', '20210000003768814076'],
  ['Sirdaryo v.', '20210000303768814073'],
  ['Toshkent v.', '20210000203768814071'],
  ["Farg'ona v.", '20210000403768814069'],
  ['Xorazm v.', '20210000603768814079'],
  ['Toshkent sh.', '20210000403768814075'],
];

export const SEED_ACCOUNTS: SeedAccount[] = [
  // ── I. Jami hisobraqamlar bo'yicha (II bo'lim ham shu jamiga kiradi — shablondagidek) ──
  { key: 'I', code: 'I', name: "Jami hisobraqamlar bo'yicha", isHeader: true, inputs: [], sums: ALL, rollup: null },
  { key: 'I.1', code: '1', name: 'Asosiy hisobraqam', number: '20210000903768814001', parent: 'I', inputs: ['refund', 'balance'], sums: SUB_ROW },
  ...MAIN_SUB.map(([code, name]): SeedAccount => ({ key: `I.1.${code.split('.')[1]}`, code, name, parent: 'I.1', inputs: SUB_ROW })),
  { key: 'I.1.17', code: null, name: 'Qarz shartnomasi qaytarildi', parent: 'I.1', inputs: SUB_ROW },
  ...ACCOUNTS_I.map(([code, name, number]): SeedAccount => ({ key: `I.${code}`, code, name, number, parent: 'I', inputs: ALL })),
  { key: 'I.11', code: '11', name: 'Korporativ karta', number: '22620000503768814001', parent: 'I', rollup: null, inputs: BALANCE, balanceRule: 'KEEP' },
  { key: 'I.11.1', code: null, name: 'Korporativ karta (chatgpt)', number: '22620000703768814002', parent: 'I.11', rollup: null, inputs: BALANCE, balanceRule: 'KEEP' },

  // ── II. Hududiy bo'limlar ──
  { key: 'II', code: 'II', name: "Hududiy bo'limlardan tushgan mablag'lar", isHeader: true, inputs: [], sums: ALL, rollup: 'I' },
  ...REGIONS.map(([name, number], i): SeedAccount => ({ key: `II.${i + 1}`, code: String(i + 1), name, number, parent: 'II', inputs: ALL })),

  // ── III. Fuqarolarga to'lanadigan mablag'lar (jamiga kirmaydi) ──
  { key: 'III', code: 'III', name: "Fuqarolarga to'lanishi kerak bo'lgan pul mablag'lari", isHeader: true, inputs: [], sums: [], rollup: null },
  { key: 'III.1', code: '1', name: "Tax free (asosiy — G'aznadan tushadigan) tushum", number: '20210000903768814002', parent: 'III', rollup: null, inputs: ALL },
  { key: 'III.1.1', code: null, name: "Tax free: naqd qaytarishga yo'naltirilgan mablag'", parent: 'III.1', rollup: null, inputs: SUB_ROW },
  { key: 'III.2', code: '2', name: 'Tax free (maxsus hisob — valyuta ayirboshlash uchun)', number: '29896000003768814001', parent: 'III', rollup: null, inputs: ALL },
  { key: 'III.3', code: '3', name: 'Quyoshli xonadon', number: '29896000303768814003', parent: 'III', rollup: null, inputs: ALL, balanceRule: 'SUB' },
  { key: 'III.4', code: '4', name: 'Ijtimoiy keshbek', number: '29896000503768814004', parent: 'III', rollup: null, inputs: ALL, balanceRule: 'SUB' },

  // ── IV. Davlat xaridlari platformalari (faqat qoldiq) ──
  { key: 'IV', code: 'IV', name: "Davlat xaridlari platformalaridagi pul mablag'lari", isHeader: true, inputs: [], sums: BALANCE, rollup: null },
  { key: 'IV.1', code: '1', name: 'Xarid.uzex.uz', number: '20208000000600257003', parent: 'IV', inputs: BALANCE, balanceRule: 'KEEP' },
  { key: 'IV.1.1', code: '1.1', name: 'Xarid.uzex.uz', number: '20208000900600257053', parent: 'IV.1', rollup: 'IV', inputs: BALANCE, balanceRule: 'KEEP' },
  { key: 'IV.1.2', code: '1.2', name: 'Xarid.uzex.uz', number: '700110860262877950600262008', parent: 'IV.1', rollup: 'IV', inputs: BALANCE, balanceRule: 'KEEP' },
  { key: 'IV.2', code: '2', name: 'Xt.xarid.uz', number: '20214000205122905002', parent: 'IV', inputs: BALANCE, balanceRule: 'KEEP' },
  { key: 'IV.3', code: '3', name: 'ebirja.uz', number: '20210000903768814001', parent: 'IV', inputs: BALANCE, balanceRule: 'KEEP' },
  { key: 'IV.4', code: '4', name: 'New.cooperation.uz', number: '20208000205235588202', parent: 'IV', inputs: BALANCE, balanceRule: 'KEEP' },

  // ── V. Depozit (Hayot bank) ──
  { key: 'V', code: 'V', name: "Depozitga yo'naltirilgan pul mablag'laridan tushum (Hayot bank)", isHeader: true, inputs: [], sums: ALL, rollup: null },
  { key: 'V.1', code: null, name: 'Shartnoma №298/СД (40 mlrd)', parent: 'V', inputs: ALL },
  { key: 'V.2', code: null, name: 'Shartnoma №298/СД (15 mlrd)', parent: 'V', inputs: ALL },
  { key: 'V.3', code: null, name: 'Shartnoma №302/СД (20 mlrd)', parent: 'V', inputs: ALL },
];