import type { ComponentType, SVGProps } from 'react';
import { ENTRY_UNITS } from '@/lib/segments';
import {
  NavCompare,
  NavBars,
  NavChat,
  NavBin,
  NavBolt,
  NavBox,
  NavClipboard,
  NavIn,
  NavList,
  NavMail,
  NavOut,
  NavPerson,
  NavSwap,
  NavTag,
  NavUndo,
  NavCar,
  NavDatabase,
  NavExpense,
  NavFlag,
  NavFormula,
  NavHome,
  NavIncome,
  NavReport,
  NavSettings,
  NavShield,
  NavUsers,
} from './nav-icons';

// ═══════════════════════════════════════════════════════════
// Yagona navigatsiya ro'yxati:
//  • MENU — bo'limlar (yorliqlar qatori, sarlavha, qidiruv);
//  • SIDEBAR — chap menyu: 3 zona — KIRITISH (ma'lumot kiritiladigan bo'limlar),
//    TAHLIL (ko'rish va hisobot), BOSHQARUV (munosabat, nazorat, sozlamalar);
//  • yuqori paneldagi sarlavha (sahifa o'zinikini bermasa);
//  • global qidiruvdagi "Sahifalar".
// Yangi sahifa qo'shilsa — faqat shu faylga yoziladi.
// ═══════════════════════════════════════════════════════════

export interface NavPage {
  label: string;
  href: string;
  /** Qisqa izoh (qidiruvda ko'rinadi) */
  description?: string;
  /** Yorliqlar qatorida ko'rinmaydi (faqat qidiruvda) */
  hidden?: boolean;
  /**
   * Ichma-ich guruh: bir xil guruhdagi sahifalar yorliqlar qatorida BITTA yorliq bo'lib turadi
   * (masalan, «Ish haqi xarajatlari»), bosilganda — ikkinchi qatorda ichidagi sahifalar.
   */
  group?: string;
}

export interface NavItem extends NavPage {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Shu bo'limga tegishli boshqa manzillar (masalan, /tahlil/daromad) */
  match?: string[];
  adminOnly?: boolean;
  /**
   * Faqat ishchi rol (Omborchi …) kiritish zonasi. Umumiy hududda (administrator, kuzatuvchi)
   * menyu va qidiruvda ko'rinmaydi — u yerda shu bo'limning dashbordi turadi (ROLE_DASHBOARDS).
   */
  workerOnly?: boolean;
  /** Bo'lim ichidagi sahifalar */
  pages?: NavPage[];
}

export const MENU: NavItem[] = [
  {
    label: 'Bosh sahifa',
    href: '/',
    match: ['/tahlil'],
    icon: NavHome,
    description: 'Daromad, xarajat va tahlil bir qarashda',
    pages: [
      { label: 'Bosh sahifa', href: '/', description: 'Daromad, xarajat va foyda bir qarashda' },
      { label: 'Daromad', href: '/tahlil/daromad', description: 'Daromad tahlili: xizmatlar, mijozlar, hududlar' },
      { label: 'Daromad manbalari', href: '/tahlil/manbalar', description: 'Kunlik hisobotdagi har bir tushum qatori oyma-oy' },
      { label: 'Xarajat', href: '/tahlil/xarajat', description: 'Xarajat tahlili: moddalar, kontragentlar, hududlar' },
      { label: "Qo'mita pullari sarfi", href: '/tahlil/qomita', description: "3802 va Marksheyder: kelgan pul, sarf va qoldiq — oy, bo'lim, xodim" },
      { label: 'Tahlil', href: '/tahlil/umumiy', description: "Chuqur tahlil: dinamika, o'zgarish sabablari, barqarorlik, xodim samaradorligi, xulosalar" },
    ],
  },
  {
    label: 'Tez kiritish',
    href: '/kiritish',
    icon: NavBolt,
    description: "Hamma kiritish turlari bitta joyda va bugun kiritilganlar",
  },
  {
    label: 'Daromadlar',
    href: '/daromadlar',
    icon: NavIncome,
    description: "Daromadlar ro'yxati va bo'limlari",
    pages: [
      { label: 'Umumiy', href: '/daromadlar', description: 'Doimiy va Boshqa bir qarashda' },
      { label: 'Doimiy', href: '/daromadlar/doimiy', description: "Muntazam daromadlar ro'yxati" },
      { label: 'Boshqa', href: '/daromadlar/boshqa', description: 'Bir martalik daromadlar' },
      { label: 'Markaz tushumi', href: '/daromadlar/markaz', description: "Kunlik tushum va qoldiq fayli — Markaz oylik daromadi" },
      { label: 'Hududlar tushumi', href: '/daromadlar/hududlar', description: 'Hududlardan Excel orqali kelgan tushum' },
      { label: "Qo'mita mablag'lari", href: '/daromadlar/qomita', description: "Qo'mitadan kelgan pullar (daromad): bo'limlar bo'yicha, oyma-oy — bankdan yoki qo'lda" },
      { label: 'Hisobga olinmaydi', href: '/daromadlar/hisobga-olinmaydi', description: "Depozitga yo'naltirilgan mablag'lar va ustav fondi: ko'rinadi, lekin daromadga qo'shilmaydi" },
      { label: 'Natijalar', href: '/daromadlar/natijalar', description: 'Oylik natijalar' },
      { label: 'Bank ko‘chirmasi', href: '/daromadlar/bank-kochirma', description: "Bankka tushgan kirimlar: o'xshashlar oyma-oy va o'sib boruvchi (daromadga faqat tanlab yo'naltiriladi)" },
      { label: 'Schyot-fakturalar', href: '/daromadlar/fakturalar', description: "Biz yozgan (chiquvchi) schyot-fakturalar: mijoz va xizmat bo'yicha oyma-oy nazorat" },
      { label: 'Kontragentlar', href: '/daromadlar/kontragentlar', description: "Mijozlar: biz yozgan faktura va bankka tushgan, farq (tushmagan), shartnomalar" },
      { label: 'Reja va tushum', href: '/daromadlar/reja-tushum', description: "Xodimlar reja / tushum fayli — daromadni xodimlarga bo'lib beradi" },
      // 6 bo'lim — chap menyuda «Daromadlar» ostida; yorliqlar qatorida emas (qidiruvda bor)
      ...ENTRY_UNITS.map((u) => ({ label: `Daromadlar · ${u.label}`, href: `/daromadlar/bolim/${u.slug}`, description: `${u.hint}: daromadlar va xizmat turlari`, hidden: true })),
    ],
  },
  {
    label: 'Xarajatlar',
    href: '/xarajatlar',
    icon: NavExpense,
    description: "Xarajatlar ro'yxati va bo'limlari",
    pages: [
      { label: 'Umumiy', href: '/xarajatlar', description: 'Doimiy, Boshqa va qismlar bir qarashda' },
      { label: 'Doimiy', href: '/xarajatlar/doimiy', description: "Muntazam xarajatlar ro'yxati" },
      { label: 'Boshqa', href: '/xarajatlar/boshqa', description: 'Bir martalik xarajatlar' },
      { label: 'Ish haqi', href: '/xarajatlar/ish-haqi', description: 'Ish haqi vedomostlari', group: 'Ish haqi xarajatlari' },
      { label: 'Soliq hisoboti', href: '/xarajatlar/soliq-hisoboti', description: "JShDS hisob-kitobi (4 va 5-ilova) to'g'ridan-to'g'ri: shu oy oylik va boshqa daromadlar", group: 'Ish haqi xarajatlari' },
      { label: 'Ish haqi tarkibi', href: '/xarajatlar/tarkib', description: "Ish haqi komponentlar bo'yicha", group: 'Ish haqi xarajatlari' },
      { label: '23106', href: '/xarajatlar/23106', description: "Xodimlarga to'lovlar ko'chirmasi (bayram puli, mukofot, xizmat safari): xodim, sana, nima uchun — tarkib va soliq hisoboti bilan nazorat", group: 'Ish haqi xarajatlari' },
      { label: 'Schyot-fakturalar', href: '/xarajatlar/fakturalar', description: "Kiruvchi schyot-fakturalar (Didox reyestri) nazorati: kontragent va xizmat (IKPU) bo'yicha oyma-oy, faqat Подписан va Ожидает, QQS bilan" },
      { label: 'Kontragentlar', href: '/xarajatlar/kontragentlar', description: "Yetkazib beruvchilar: nima beradi, fakturada hisoblangan va bankdan to'langan, farq (qarz), shartnomalar" },
      { label: 'Bank ko‘chirmasi', href: '/xarajatlar/bank-kochirma', description: "Bankdan olingan ko'chirma tahlili: chiqim va kirim, o'xshash to'lovlar oyma-oy va o'sib boruvchi, turlari (xarajat va daromadga yozilmaydi)" },
      { label: 'Ish haqi solishtirma', href: '/xarajatlar/ish-haqi-solishtirma', description: "FOT − soliq (− kasaba uyushmasi) = 23106: bankdan to'langani hisoblanganiga mosmi — shtat va shartnoma, Markaz va hududlar kesimida", group: 'Ish haqi xarajatlari' },
      { label: 'Ijara', href: '/xarajatlar/ijara', description: "Ijara shartnomalari va to'lovlar" },
      { label: 'Internet', href: '/xarajatlar/internet', description: "Internet shartnomalari: kimga to'lanadi, qayerga biriktiriladi, oylik to'lovlar" },
      { label: 'Mashinalar', href: '/xarajatlar/mashinalar', description: "Mashina xarajatlari: benzin, moyka, ta'mir yozish va benzin hisobotini (Excel) yuklash", group: 'Mashina xarajatlari' },
      { label: 'Mashinalar hisoboti', href: '/xarajatlar/mashinalar/royxat', description: "Mashinalar guruhlar bo'yicha, haydovchilar, oylik sarf va me'yor", group: 'Mashina xarajatlari' },
      { label: 'Mashinalar · bo‘limlarga', href: '/xarajatlar/mashinalar/bolimlar', description: "Har mashina qaysi bo'limniki (Markaz bo'limi, hudud, Tax free, Marksheyder …), izoh bilan — xarajati o'sha joyga, keyingi yuklashlar ham", group: 'Mashina xarajatlari' },
      { label: 'Choraklik hisobot', href: '/xarajatlar/mashinalar/chorak', description: "24-ilova: jihozlash xarajati — mashina ta'mirlashi (bo'limiga avtomatik), balans qiymati va masofa — statistika", group: 'Mashina xarajatlari' },
      { label: 'Mashina yozuvlari', href: '/xarajatlar/mashinalar/tahlil', description: "Mashina yozuvlari: tahrirlash, o'chirish va 12 oylik tahlil", group: 'Mashina xarajatlari' },
      { label: '3D avtopark', href: '/xarajatlar/mashinalar/avtopark', description: "Hamma mashinalar 3D'da: raqami, oy xarajati, tafsilot", group: 'Mashina xarajatlari' },
      { label: 'Ombor kirimi', href: '/xarajatlar/ombor-kirim', description: "Omborga kelgan TMZ va asosiy vositalar — xarajatga yoziladi (asosiy vosita — balansga)" },
      { label: 'Pochta', href: '/xarajatlar/pochta', description: "Pochta korxonalariga to'lovlar" },
      { label: 'Soliqlar', href: '/xarajatlar/soliqlar', description: "Hamma soliqlar: hudud va Markaz bo'yicha, ish haqidan foizlilar avtomatik" },
      { label: 'Asosiy vositalar', href: '/xarajatlar/asosiy-vositalar', description: "Balansdagi vositalar va oylik sarfi (eskirish)" },
      { label: 'Xarajatlar siyosati', href: '/xarajatlar/siyosat', description: "Har bir xarajat moddasi kim hisobidan: yozilgan joyida, Markaz yoki yo'nalish" },
      { label: 'Yangi xarajat', href: '/xarajatlar/yangi', description: "Xarajat qo'shish", hidden: true },
      // 6 bo'lim — chap menyuda «Xarajatlar» ostida; yorliqlar qatorida emas (qidiruvda bor)
      ...ENTRY_UNITS.map((u) => ({ label: `Xarajatlar · ${u.label}`, href: `/xarajatlar/bolim/${u.slug}`, description: `${u.hint}: xarajatlar va moddalar`, hidden: true })),
      { label: "Foyda keltirmaydigan bo'limlar", href: '/xarajatlar/bolimlar', description: "Markaz bo'limlari: xarajat moddalari oyma-oy va bo'lim xarajatlar siyosati", hidden: true },
    ],
  },
  {
    label: "3802 — Qo'mita qoplashi",
    href: '/3802',
    icon: NavClipboard,
    description: "Qo'mita qoplaydigan xarajatlar: shtatlar (oladigan va olmaydigan), har oylik real bajarilgan ishlar, nazorat zanjiri — kelgan pul bilan solishtirish",
    pages: [{ label: 'Umumiy', href: '/3802', description: "Qoplash va qoldiq, Shtatlar (oladigan va olmaydigan), Har oylik real bajarilgan ishlar, Nazorat zanjiri" }],
  },
  { label: 'Xodimlar', href: '/xodimlar', icon: NavUsers, description: "Xodimlar ro'yxati, ko'chishlar, ma'lumotnomalar (10/16/37/51-jadval) va miya — xodim kartasi" },
  {
    label: 'Ombor',
    href: '/ombor',
    icon: NavBox,
    workerOnly: true,
    description: "TMZ va asosiy vositalar: kirim, chiqim, kimda nima bor",
    pages: [
      { label: 'Umumiy', href: '/ombor', description: "Qoldiq qiymati, davr kirim-chiqimi, kam qolganlar, kimda nima bor" },
      { label: 'Hujjatlar', href: '/ombor/hujjatlar', description: "Kirim, chiqim, qaytarish, ko'chirish, hisobdan chiqarish va dalolatnomalar" },
      { label: 'Qoldiq', href: '/ombor/qoldiq', description: "Buyumlar ma'lumotnomasi va ombordagi qoldiq" },
      { label: 'Asosiy vositalar', href: '/ombor/asosiy-vositalar', description: "Inventar raqami bo'yicha: kimda, qayerda, harakat tarixi" },
      { label: 'Kimda nima bor', href: '/ombor/kimda', description: "Odam, bo'lim yoki hudud: biriktirilgan mulk va kartochka" },
      { label: 'Inventarizatsiya', href: '/ombor/inventarizatsiya', description: 'Sanab chiqish, kamomad va ortiqcha, dalolatnoma' },
      { label: 'Pochta', href: '/ombor/pochta', description: "Pochta korxonalariga to'lovlar" },
      { label: 'Dalolatnoma shabloni', href: '/ombor/shablon', description: "Berish, qaytarish, o'tkazish dalolatnomalari: tasdiqlovchi, matnlar, hududlar" },
      { label: 'Imzolangan dalolatnomalar', href: '/ombor/imzolar', description: 'QR orqali xodim imzolagan va imzo kutayotgan dalolatnomalar, imzoli nusxalar' },
      // Kiritish sahifalari (omborchi menyusida; administratorga — tugmalar va qidiruv orqali)
      { label: 'Ish stoli', href: '/ombor/ish-stoli', description: 'Omborchi: bugungi ishlar, qoralamalar, kam qolganlar', hidden: true },
      { label: 'Kirim', href: '/ombor/kirim', description: "Omborga keldi — xarajatga yoziladi (asosiy vosita — balansga, oylik sarfi bilan)", hidden: true },
      { label: 'Chiqim (berish)', href: '/ombor/chiqim', description: "Odamga yoki bo'limga berish", hidden: true },
      { label: "Ko'chirish", href: '/ombor/kochirish', description: "Asosiy vositani boshqa odam/bo'limga o'tkazish", hidden: true },
      { label: 'Qaytarish', href: '/ombor/qaytarish', description: 'Omborga qaytib keldi', hidden: true },
      { label: 'Hisobdan chiqarish', href: '/ombor/hisobdan-chiqarish', description: "Yaroqsiz, yo'qolgan, sarflangan", hidden: true },
    ],
  },
  {
    label: 'Mashinalar',
    href: '/mashinalar',
    icon: NavCar,
    workerOnly: true,
    description: "Mashina xarajatlari: yoqilg'i, moyka, ta'mir — guruhlar bo'yicha",
    pages: [
      { label: 'Xarajat kiritish', href: '/mashinalar', description: "Mashinani tanlab benzin, moyka, ta'mir yozish" },
      { label: "Ro'yxat va hisobot", href: '/mashinalar/royxat', description: "Mashinalar guruhlar bo'yicha, oylik sarf va me'yor" },
      { label: 'Yozuvlar va tahlil', href: '/mashinalar/tahlil', description: "Oy yozuvlari (tahrirlash, o'chirish) va 12 oylik tahlil" },
      { label: '3D avtopark', href: '/mashinalar/avtopark', description: "Hamma mashinalar 3D'da: raqami, oy xarajati, tafsilot" },
      { label: "Bo'limlarga biriktirish", href: '/mashinalar/bolimlar', description: "Har mashina qaysi bo'limniki (Markaz bo'limi, hudud, Tax free, Marksheyder …), izoh bilan — xarajati o'sha joyga, keyingi yuklashlar ham" },
      { label: 'Choraklik hisobot', href: '/mashinalar/chorak', description: "24-ilova: jihozlash xarajati — mashina ta'mirlashi, qolgani — statistika" },
    ],
  },
  // ── Umumiy hudud: rollar (har biri administrator qo'ygan nom bilan) va ularning dashbordlari ──
  {
    label: 'Rollar',
    href: '/rollar',
    icon: NavUsers,
    description: "Har bir rolning katta dashbordi: xodimlari, bugungi ishi, ombor, mashinalar, pochta",
  },
  {
    label: 'Ombor',
    href: '/dashbord/ombor',
    icon: NavBox,
    description: "Omborchi kiritganlari: qoldiq, kirim-chiqim, kimda nima bor, inventarizatsiya, pochta",
  },
  {
    label: 'Mashinalar',
    href: '/dashbord/mashinalar',
    icon: NavCar,
    description: "Omborchi kiritganlari: oylik xarajat, guruhlar, 100 km ga sarf va me'yor",
  },
  {
    label: 'Xarid',
    href: '/dashbord/xarid',
    icon: NavIn,
    description: "Xaridchi kiritganlari: birja va oddiy xaridlar, qarz, yetkazish muddati, arizalar, yetkazuvchilar",
  },
  {
    label: 'Solishtirma',
    href: '/solishtirma',
    icon: NavCompare,
    description: "Hududlar, Markaz va yo'nalishlar (Tax free …) yonma-yon",
    pages: [
      { label: 'Umumiy', href: '/solishtirma/umumiy', description: "Markaz, hududlar va yo‘nalishlar birga: korxona daromadi, xarajati, natijasi va u qanday shakllanishi" },
      { label: 'Hududlar', href: '/solishtirma', description: 'Viloyatlar → tumanlar → xodimlar: daromad, xarajat, natija; Markazni qoplash; hududlar modellari (prognoz, salohiyat, KPI, DEA …)' },
      { label: 'Markaz', href: '/solishtirma/markaz', description: "Markaz → bo'limlar → xodimlar: daromad manbalari, o'z xarajati, hududlar uchun to'langan" },
      { label: 'Tax free', href: '/solishtirma/tax-free', description: "Tax free: daromad manbalari, xarajat tarkibi, natija va siyosat bo'yicha o'tganlar" },
      { label: 'Marksheyder', href: '/solishtirma/marksheyder', description: "Marksheyder: daromad manbalari, xarajat tarkibi, natija va siyosat bo'yicha o'tganlar" },
      { label: "Fermer xo'jaligi", href: '/solishtirma/fermer', description: "Fermer xo'jaligi: daromad manbalari, xarajat tarkibi, natija va siyosat bo'yicha o'tganlar" },
      { label: 'Buxgalteriya xizmatlari', href: '/solishtirma/buxgalteriya', description: "Buxgalteriya xizmatlari: daromad manbalari, xarajat tarkibi, natija va siyosat bo'yicha o'tganlar" },
      { label: "Qo'mita pullarining sarfi", href: '/solishtirma/qomita', description: "Qo'mita pullaridan qilingan sarflar: Xarajatlar siyosati bo'yicha boshqa bo'limlardan o'tganlari" },
      { label: "O'zgarishlar", href: '/solishtirma/ozgarishlar', description: "Oy bo'yicha xodimlar: oylik hisoblanganlar, ishga olingan, bo'shagan, ishlamagan, ko'chgan" },
    ],
  },
  {
    label: 'Hudud uchun reja',
    href: '/hudud-reja',
    icon: NavBars,
    description: "Kelasi oy statistik prognozi: hududlar, 39 xizmat va xodimlar rejasi",
    pages: [
      { label: 'Dashboard', href: '/hudud-reja', description: 'Kelasi oy prognozi, aniqlik, ma’lumot to‘liqligi va sifati' },
      { label: 'Ma’lumotlarni yuklash', href: '/hudud-reja/yuklash', description: 'Excel shablonlari: tarixiy daromad, xodimlar, xizmatlar va tariflar' },
      { label: 'Prognozlash', href: '/hudud-reja/prognoz', description: 'Parametrlar, tekshirish, hisoblash, natijalarni solishtirish' },
      { label: 'Hududlar bo‘yicha reja', href: '/hudud-reja/hududlar', description: 'Har hudud: prognoz, model, aniqlik, tasdiqlash va versiyalar' },
      { label: 'Xizmatlar bo‘yicha reja', href: '/hudud-reja/xizmatlar', description: 'Xizmatlar soni × tarif, modellar taqqoslanishi' },
      { label: 'Xodimlar bo‘yicha reja', href: '/hudud-reja/xodimlar', description: 'Hudud prognozining xodimlarga taqsimoti' },
    ],
  },
  {
    label: 'Modellar',
    href: '/modellar',
    match: ['/katta-modellar'],
    icon: NavFormula,
    description: 'Formulalar, prognoz, omillar, samaradorlik, risk',
    pages: [
      { label: 'Modellar', href: '/modellar', description: "Tavsifiy formulalar: o'sish, ulush, barqarorlik, bog'liqlik" },
      { label: 'Katta modellar', href: '/katta-modellar', description: 'Korxona modellari: prognoz, omillar, stsenariy va risk' },
    ],
  },
  {
    label: 'Topshiriqlar',
    href: '/topshiriqlar',
    icon: NavClipboard,
    description: "Xodimga muddatli ish — Telegramga avtomatik eslatma",
  },
  {
    label: 'Munosabat',
    href: '/munosabat',
    icon: NavFlag,
    description: 'Belgilangan moddalar natijasi',
    pages: [
      { label: 'Munosabatlar', href: '/munosabat', description: 'Muhokamaga qo\'yilgan moddalar: muddat, mas\'ullar, natija' },
      { label: 'Muhokama talab qiladi', href: '/munosabat/ogohlantirish', description: 'Tizim topgan holatlar: xarajat o\'sgan, daromad tushgan, zarar, reja, qarz' },
    ],
  },
  { label: 'Nazorat', href: '/nazorat', icon: NavShield, description: 'Oylik chegaralar va buzilishlar' },
  { label: 'Hisobotlar', href: '/hisobotlar', icon: NavReport, description: 'Excel, PowerPoint, PDF va raqamlar tekshiruvi' },
  { label: "Yig'ma KPI", href: '/yigma-kpi', icon: NavFlag, description: "Bo'lim rahbarlaridan kelgan KPI baholari: xodimlar, oylar, mezonlar; rahbarlarni biriktirish; Excel / PDF" },
  {
    label: 'Chat',
    href: '/chat',
    icon: NavChat,
    adminOnly: true,
    description: "Savol bering — javob tizimdagi manbalardan: xodimlar, ish haqi, xarajat, daromad, natija",
    pages: [
      { label: 'Manba chati', href: '/chat', description: "Javob faqat tizim manbalaridan: xodim kartasi, ish haqi, bo'lim / hudud / modda bo'yicha pul, xodimlar soni" },
      { label: 'AI chati', href: '/chat/ai', description: "Sun'iy intellekt bilan suhbat — tez kunda" },
    ],
  },
  {
    label: 'Sozlamalar',
    href: '/sozlamalar',
    icon: NavSettings,
    adminOnly: true,
    pages: [
      { label: "Ko'rinish", href: '/sozlamalar/korinish', description: "Qisqa (rahbar) yoki to'liq rejim — butun dastur uchun" },
      { label: 'Foydalanuvchilar', href: '/sozlamalar/foydalanuvchilar', description: 'Omborchi va boshqa rollar: ID kod, PIN, bloklash' },
      { label: 'Xarajat moddalari', href: '/sozlamalar/xarajat' },
      { label: 'Ish haqi komponentlari', href: '/sozlamalar/komponentlar' },
      { label: 'Savat', href: '/sozlamalar/savat' },
      { label: 'Xavfsizlik', href: '/sozlamalar/xavfsizlik', description: "O'chirish paroli: «Hammasi» yoki 50 tadan ortiq yozuv o'chirilganda so'raladi" },
      { label: 'Chat kodi', href: '/sozlamalar/chat-kodi', description: "Chatga kirish, saqlash va yangi suhbat uchun kod (standart — 8020)" },
      { label: 'Tarix', href: '/sozlamalar/tarix' },
      { label: 'Tekshiruv', href: '/sozlamalar/tekshiruv' },
      { label: 'Zaxira', href: '/sozlamalar/zaxira' },
      { label: 'Manba fayllar', href: '/sozlamalar/fayllar', description: 'Yuklangan fayllar arxivi: yuklash bilan bog‘langan, yangi bog‘liqliklar eski fayllarga ham qo‘llanadi' },
      { label: 'Ogohlantirishlar', href: '/sozlamalar/ogohlantirish', description: 'Muhokama talab qiladigan holatlar chegaralari' },
      { label: 'Telegram', href: '/sozlamalar/telegram', description: 'Bot va xodimlarni ulash — topshiriqlar avtomatik yetkaziladi' },
      { label: 'Demo ma\'lumotlar', href: '/sozlamalar/demo', description: "Barcha demolar: holati, hammasini o'chirish va qayta qo'shish" },
    ],
  },
];

// ═══════════════════════════════════════════════════════════
// Ishchi rollar menyusi (ID kod bilan kiradiganlar) — umumiy hudud menyusi bilan bir xil tuzilma:
//   Ish stoli
//   KIRITISH:  ombor amallari, mashina xarajati, pochta — har biri alohida sahifa
//   KO'RISH:   jurnal, qoldiq, asosiy vositalar, kimda nima bor, mashinalar hisoboti
//   NAZORAT:   inventarizatsiya
// Kalit — rolga ochiq bo'lim (user.access.pages). Bir xil sarlavhali guruhlar birlashtiriladi.
// ═══════════════════════════════════════════════════════════

export type WorkerTone = 'green' | 'blue' | 'amber' | 'slate' | 'red' | 'violet';

export interface WorkerNavItem {
  label: string;
  href: string;
  hint?: string;
  tone?: WorkerTone;
  icon: NavItem['icon'];
  /** Yonida son ko'rsatiladi (masalan, kutilayotgan qabullar) */
  badgeKey?: 'receipts';
}

export interface WorkerNavGroup {
  /** Guruh sarlavhasi (bo'sh — sarlavhasiz, bandlar to'g'ridan-to'g'ri) */
  title: string;
  /** Guruh belgisi (ochiladigan guruh sarlavhasida) */
  icon?: NavItem['icon'];
  /** Menyudagi o'rni (bir nechta bo'lim guruhlari aralashib turadi) */
  order: number;
  items: WorkerNavItem[];
}

export const WORKER_MENUS: Record<string, WorkerNavGroup[]> = {
  '/kpi': [{ title: '', order: 0, items: [{ label: 'KPI baholash', href: '/kpi/ish-stoli', hint: "Bo'lim xodimlarini oyma-oy baholash", icon: NavFlag }] }],
  '/ombor': [
    { title: '', order: 0, items: [{ label: 'Ish stoli', href: '/ombor/ish-stoli', hint: 'Bugungi ishlar', icon: NavHome }] },
    {
      title: 'Kiritish',
      icon: NavBolt,
      order: 1,
      items: [
        { label: 'Qabul qilish', href: '/ombor/qabul', hint: 'Xaridchi yuborgan tovarni qabul qilish', tone: 'green', icon: NavIn, badgeKey: 'receipts' },
        { label: 'Chiqim (berish)', href: '/ombor/chiqim', hint: "Odamga yoki bo'limga", tone: 'blue', icon: NavOut },
        { label: "Ko'chirish", href: '/ombor/kochirish', hint: 'Asosiy vosita boshqa joyga', tone: 'amber', icon: NavSwap },
        { label: 'Qaytarish', href: '/ombor/qaytarish', hint: 'Omborga qaytdi', tone: 'slate', icon: NavUndo },
        { label: 'Hisobdan chiqarish', href: '/ombor/hisobdan-chiqarish', hint: "Yaroqsiz, yo'qolgan", tone: 'red', icon: NavBin },
        { label: "Pochta to'lovi", href: '/ombor/pochta', hint: "Pochta korxonasiga to'langan summa", tone: 'violet', icon: NavMail },
      ],
    },
    {
      title: "Ko'rish",
      icon: NavBars,
      order: 2,
      items: [
        { label: 'Jurnal', href: '/ombor/hujjatlar', hint: 'Barcha hujjatlar, dalolatnomalar', icon: NavList },
        { label: 'Qoldiq', href: '/ombor/qoldiq', hint: 'Omborda nima qancha', icon: NavBox },
        { label: 'Asosiy vositalar', href: '/ombor/asosiy-vositalar', hint: "Inventar raqami bo'yicha", icon: NavTag },
        { label: 'Kimda nima bor', href: '/ombor/kimda', hint: "Odam yoki bo'lim kartochkasi", icon: NavPerson },
      ],
    },
    {
      title: 'Nazorat',
      icon: NavShield,
      order: 3,
      items: [
        { label: 'Inventarizatsiya', href: '/ombor/inventarizatsiya', hint: 'Sanab chiqish va solishtirish', icon: NavClipboard },
        { label: 'Imzolar', href: '/ombor/imzolar', hint: 'Imzolangan va kutayotgan dalolatnomalar', icon: NavClipboard },
        { label: 'Dalolatnoma shabloni', href: '/ombor/shablon', hint: 'Tasdiqlovchi, matnlar, hududlar', icon: NavList },
      ],
    },
  ],
  '/xarid': [
    { title: '', order: 0, items: [{ label: 'Ish stoli', href: '/xarid/ish-stoli', hint: 'Bugungi ishlar', icon: NavHome }] },
    {
      title: 'Kiritish',
      icon: NavBolt,
      order: 1,
      items: [
        { label: 'Birja xaridi', href: '/xarid/birja', hint: 'Lot, shartnoma, birja yig‘imi', tone: 'blue', icon: NavCompare },
        { label: 'Oddiy xarid', href: '/xarid/oddiy', hint: "Do'kon, to'g'ridan-to'g'ri", tone: 'green', icon: NavIn },
        { label: 'Tovar keldi', href: '/xarid/qabul', hint: 'Omborchiga qabul uchun yuborish', tone: 'amber', icon: NavBox },
        { label: 'Ariza yozish', href: '/xarid/ariza', hint: "Bo'lim so'ragan tovar", tone: 'slate', icon: NavClipboard },
      ],
    },
    {
      title: "Ko'rish",
      icon: NavBars,
      order: 2,
      items: [
        { label: 'Xaridlar', href: '/xarid/xaridlar', hint: "To'lov va yetkazish holati", icon: NavList },
        { label: 'Arizalar', href: '/xarid/arizalar', hint: "Bo'limlardan kelgan so'rovlar", icon: NavClipboard },
        { label: 'Yetkazuvchilar', href: '/xarid/yetkazuvchilar', hint: 'Kim bilan ishlaymiz, qarz', icon: NavPerson },
      ],
    },
  ],
  '/buxgalteriya': [
    { title: '', order: 0, items: [{ label: 'Ish stoli', href: '/buxgalteriya/ish-stoli', hint: 'Bugungi ish', icon: NavHome }] },
    {
      title: 'Kiritish',
      icon: NavBolt,
      order: 1,
      items: [
        { label: 'Kunlik tushum', href: '/buxgalteriya/kunlik', hint: "Hisobraqamlar: tushum, qaytarilgan, qoldiq", tone: 'blue', icon: NavIncome },
        { label: 'Markaz daromadi', href: '/buxgalteriya/markaz', hint: "Fayl yuklash, oylik daromad", tone: 'green', icon: NavBars },
      ],
    },
    {
      title: "Ko'rish",
      icon: NavBars,
      order: 2,
      items: [
        { label: 'Tarix', href: '/buxgalteriya/tarix', hint: 'Saqlangan kunlar, Excel', icon: NavList },
        { label: 'Hisobraqamlar', href: '/buxgalteriya/hisobraqamlar', hint: "Ro'yxat, nomi, raqami", icon: NavTag },
      ],
    },
  ],
  '/hudud': [
    { title: '', order: 0, items: [{ label: 'Ish stoli', href: '/hudud/ish-stoli', hint: 'Oylar holati, viloyatlar', icon: NavHome }] },
    {
      title: 'Kiritish',
      icon: NavBolt,
      order: 1,
      items: [
        { label: 'Daromad yuklash', href: '/hudud/daromad', hint: "Xizmatlar bo'yicha hisobot (service_report)", tone: 'blue', icon: NavIncome },
        { label: 'Reja va tushum', href: '/hudud/reja-tushum', hint: "Xodimlar rejasi va bajarilishi (daromadni bo'lib beradi)", tone: 'blue', icon: NavUsers },
        { label: 'Ish haqi', href: '/hudud/ish-haqi', hint: 'Hudud xodimlari vedomosti', tone: 'green', icon: NavUsers },
        { label: 'Xarajatlar', href: '/hudud/xarajatlar', hint: 'Viloyat va tuman xarajatlari', tone: 'amber', icon: NavExpense },
        { label: 'Xarajat rejasi', href: '/hudud/reja', hint: 'Oylik reja (byudjet) va fakt', tone: 'violet', icon: NavClipboard },
      ],
    },
    {
      title: "Ma'lumotnomalar",
      icon: NavBars,
      order: 2,
      items: [
        { label: 'Shtat va maosh', href: '/hudud/shtat', hint: 'Stavka, lavozim maoshi, sanasi', icon: NavPerson },
        { label: 'Tariflar', href: '/hudud/tariflar', hint: '39 xizmat narxi', icon: NavTag },
        { label: 'Voqealar jurnali', href: '/hudud/voqealar', hint: "Tarif o'zgarishi, qayta tuzilish", icon: NavList },
      ],
    },
    {
      title: 'Nazorat',
      icon: NavShield,
      order: 3,
      items: [{ label: 'Oyni yopish', href: '/hudud/yopish', hint: "Tekshiruv va tasdiqlash", icon: NavClipboard }],
    },
  ],
  '/mashinalar': [
    {
      title: 'Kiritish',
      order: 1,
      items: [{ label: 'Mashina xarajati', href: '/mashinalar', hint: "Benzin, moyka, ta'mir, texnik xizmat", tone: 'blue', icon: NavCar }],
    },
    {
      title: "Ko'rish",
      order: 2,
      items: [
        { label: 'Mashinalar hisoboti', href: '/mashinalar/royxat', hint: 'Guruhlar, haydovchilar, oylik sarf', icon: NavBars },
        { label: "Bo'limlarga biriktirish", href: '/mashinalar/bolimlar', hint: "Mashina qaysi bo'limniki — xarajati o'sha yerga", icon: NavSwap },
        { label: 'Choraklik hisobot', href: '/mashinalar/chorak', hint: "24-ilova: jihozlash → ta'mirlash", icon: NavReport },
        { label: 'Mashina yozuvlari', href: '/mashinalar/tahlil', hint: "Tuzatish, o'chirish, 12 oy", icon: NavCar },
        { label: '3D avtopark', href: '/mashinalar/avtopark', hint: "Hamma mashinalar 3D'da", icon: NavCar },
      ],
    },
  ],
};

/** Ishchi rol menyusi: rolga ochiq bo'limlar; bir xil sarlavhali guruhlar bitta bo'lib, tartib bo'yicha */
export function workerMenu(pages: string[]): WorkerNavGroup[] {
  const merged = new Map<string, WorkerNavGroup>();
  for (const group of pages.flatMap((p) => WORKER_MENUS[p] ?? [])) {
    const have = merged.get(group.title);
    if (have) merged.set(group.title, { ...have, icon: have.icon ?? group.icon, order: Math.min(have.order, group.order), items: [...have.items, ...group.items] });
    else merged.set(group.title, { ...group, items: [...group.items] });
  }
  return [...merged.values()].sort((a, b) => a.order - b.order);
}

/** Ishchi rol shu sahifani ochadimi (menyusida bor sahifa yoki uning ichi) */
export function workerAllowed(pages: string[], pathname: string): boolean {
  const items = workerMenu(pages).flatMap((g) => g.items);
  if (items.length === 0) return pages.some((p) => under(pathname, p));
  return items.some((i) => under(pathname, i.href));
}

// ═══════════════════════════════════════════════════════════
// Chap menyu tartibi
// ═══════════════════════════════════════════════════════════

export interface SideLeaf {
  kind: 'item';
  /** MENU dagi bo'lim */
  item: NavItem;
}

export interface SideChild {
  label: string;
  href: string;
  adminOnly?: boolean;
  description?: string;
  match?: string[];
  /** Ichkariroq (rol nomlari «Rollar» tagida) */
  indent?: boolean;
  /** Shu band ortidan rollar (nomlari bilan) qo'yiladi — chap panel serverdan to'ldiradi */
  rolesSlot?: boolean;
  /** Kichik rangli nuqta (Omborchi amallari: kirim yashil, chiqim ko'k …) — tailwind klass */
  dot?: string;
  /** Yonidagi son (kutilayotgan ishlar) */
  badge?: number;
  /** Ichki bandlar — shu band faol bo'lganda pastida ochiladi (Daromadlar/Xarajatlar › 6 bo'lim) */
  children?: SideChild[];
}

/** Daromadlar / Xarajatlar ichidagi 6 bo'lim: Markaz, Hududlar, Tax free, Marksheyder, Fermer xo'jaligi, Buxgalteriya xizmatlari */
const unitChildren = (base: '/daromadlar' | '/xarajatlar'): SideChild[] => [
  ...ENTRY_UNITS.map((u) => ({ label: u.label, href: `${base}/bolim/${u.slug}`, match: [`${base}/bolim/${u.slug}`], description: u.hint })),
  // Xarajatlarda — 6 bo'lim tagida: Markazning har bir bo'limi alohida (xarajat moddalari va bo'lim siyosati)
  ...(base === '/xarajatlar'
    ? [{ label: "Foyda keltirmaydigan bo'limlar", href: '/xarajatlar/bolimlar', match: ['/xarajatlar/bolimlar'], description: "Markaz bo'limlari: har biriga qilingan xarajatlar moddalar bo'yicha va bo'lim xarajatlar siyosati" }]
    : [
        { label: "Qo'mita mablag'lari", href: '/daromadlar/qomita', match: ['/daromadlar/qomita'], description: "Qo'mitadan kelgan pullar (daromad)" },
        { label: 'Hisobga olinmaydi', href: '/daromadlar/hisobga-olinmaydi', match: ['/daromadlar/hisobga-olinmaydi'], description: "Depozit va ustav fondi — daromadga qo'shilmaydi" },
      ]),
];

export interface SideGroup {
  kind: 'group';
  key: string;
  label: string;
  /** Guruh sarlavhasi bosilganda ochiladigan sahifa (bo'lmasa — faqat ochiladi/yopiladi) */
  href: string | null;
  icon: NavItem['icon'];
  description?: string;
  children: SideChild[];
  /** Ma'lumot kiritish bo'limi (rejimdan qat'i nazar har doim to'liq) */
  source?: boolean;
}

/** Zona sarlavhasi: KIRITISH, TAHLIL, BOSHQARUV */
export interface SideHeading {
  kind: 'heading';
  label: string;
  /** Bir qatorlik izoh (sarlavha ustiga olib borilganda) */
  hint: string;
}

export type SideEntry = SideLeaf | SideGroup | SideHeading;

const byHref = (href: string): NavItem => MENU.find((m) => m.href === href)!;

/**
 * Chap menyu (umumiy hudud — administrator va kuzatuvchi):
 *   Bosh sahifa (▾ Daromad, Xarajat, Tahlil, Solishtirma)
 *   Umumiy manba (▾ Tez kiritish, Daromadlar, Xarajatlar, 3802 — Qo'mita qoplashi, Modellar, Rollar → har rol o'z nomi bilan, Xodimlar)
 *   Hisobotlar
 *   Boshqaruv (▾ Topshiriqlar, Munosabat, Nazorat, Sozlamalar)
 */
export const SIDEBAR: SideEntry[] = [
  {
    kind: 'group',
    key: 'home',
    label: 'Bosh sahifa',
    href: '/',
    icon: NavHome,
    description: 'Daromad, xarajat, tahlil va solishtirma',
    children: [
      { label: 'Daromad', href: '/tahlil/daromad' },
      { label: 'Daromad manbalari', href: '/tahlil/manbalar' },
      { label: 'Xarajat', href: '/tahlil/xarajat' },
      { label: "Qo'mita pullari sarfi", href: '/tahlil/qomita' },
      { label: 'Tahlil', href: '/tahlil/umumiy' },
      { label: 'Solishtirma', href: '/solishtirma', match: ['/solishtirma'], description: "Hududlar, Markaz va yo'nalishlar (Tax free …) yonma-yon" },
    ],
  },
  {
    kind: 'group',
    key: 'source',
    label: 'Umumiy manba',
    href: null,
    icon: NavDatabase,
    description: "Tez kiritish, daromadlar, xarajatlar, modellar, rollar va xodimlar — umumiy hudud ma'lumoti",
    source: true,
    children: [
      { label: 'Tez kiritish', href: '/kiritish', match: ['/kiritish'] },
      { label: 'Daromadlar', href: '/daromadlar', match: ['/daromadlar'], children: unitChildren('/daromadlar') },
      { label: 'Xarajatlar', href: '/xarajatlar', match: ['/xarajatlar'], children: unitChildren('/xarajatlar') },
      { label: "3802 — Qo'mita qoplashi", href: '/3802', match: ['/3802'] },
      { label: 'Modellar', href: '/modellar', match: ['/modellar', '/katta-modellar'] },
      { label: 'Rollar', href: '/rollar', rolesSlot: true },
      { label: 'Xodimlar', href: '/xodimlar', match: ['/xodimlar'] },
    ],
  },
  { kind: 'item', item: byHref('/chat') },
  { kind: 'item', item: byHref('/hudud-reja') },
  { kind: 'item', item: byHref('/hisobotlar') },
  {
    kind: 'group',
    key: 'control',
    label: 'Boshqaruv',
    href: null,
    icon: NavSettings,
    description: 'Topshiriqlar, Munosabat, Nazorat va Sozlamalar',
    children: [
      { label: 'Topshiriqlar', href: '/topshiriqlar', match: ['/topshiriqlar'] },
      { label: 'Munosabat', href: '/munosabat', match: ['/munosabat'] },
      { label: 'Nazorat', href: '/nazorat', match: ['/nazorat'] },
      { label: 'Sozlamalar', href: '/sozlamalar', match: ['/sozlamalar'], adminOnly: true },
    ],
  },
  // Eng tagida: bo'lim rahbarlaridan (rollar orqali) kelgan KPI baholari
  { kind: 'item', item: byHref('/yigma-kpi') },
];

/**
 * Ma'lumot kiritish sahifalari — qisqa (rahbar) rejimda ham har doim to'liq ko'rinadi.
 */
export const SOURCE_PREFIXES = ['/kiritish', '/daromadlar', '/xarajatlar', '/3802', '/xodimlar', '/sozlamalar'];

/**
 * Rol zonalari: bu sahifalarda faqat rol (Omborchi) ishlaydi. Umumiy hudud foydalanuvchisi
 * ularni ochsa — shu bo'limning dashbordiga o'tkaziladi.
 */
export const ROLE_DASHBOARDS: { prefix: string; dashboard: string }[] = [
  { prefix: '/ombor', dashboard: '/dashbord/ombor' },
  { prefix: '/mashinalar', dashboard: '/dashbord/mashinalar' },
  { prefix: '/xarid', dashboard: '/dashbord/xarid' },
  { prefix: '/buxgalteriya', dashboard: '/dashbord/buxgalteriya' },
  { prefix: '/hudud', dashboard: '/dashbord/hudud' },
];

/** Umumiy hudud foydalanuvchisi rol sahifasini ochsa — qaysi dashbordga o'tkaziladi */
export function roleDashboardFor(pathname: string): string | null {
  return ROLE_DASHBOARDS.find((r) => under(pathname, r.prefix))?.dashboard ?? null;
}

/** Guruh ichidagi band faolmi */
export function isChildActive(child: SideGroup['children'][number], pathname: string): boolean {
  if (child.match) return child.match.some((prefix) => under(pathname, prefix));
  return pathname === child.href;
}

/** Guruh faolmi: o'zi yoki ichidagi biror band */
export function isGroupActive(group: SideGroup, pathname: string): boolean {
  if (group.href === '/' && pathname === '/') return true;
  if (group.href && group.href !== '/' && under(pathname, group.href)) return true;
  return group.children.some((c) => isChildActive(c, pathname));
}

/**
 * Ko'rsatuv sahifalari — Bosh sahifa (va uning tahlillari) va Solishtirma: ularni boshqalar ham ko'radi, shuning uchun
 * boshqaruv elementlari (Kiritish, Munosabat qatori, xavfsizlik ogohlantirishi, foydalanuvchi roli) chiqmaydi.
 */
export function isPresentationPath(pathname: string): boolean {
  return pathname === '/' || under(pathname, '/tahlil') || under(pathname, '/solishtirma');
}

/** Kiritish zonasidami (ma'lumot kiritish sahifalari) */
export function isSourcePath(pathname: string): boolean {
  return SOURCE_PREFIXES.some((prefix) => under(pathname, prefix));
}

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Menyu bandi joriy manzilga tegishlimi */
export function isMenuActive(item: NavItem, pathname: string): boolean {
  if (item.href === '/') return pathname === '/' || (item.match ?? []).some((prefix) => under(pathname, prefix));
  return [item.href, ...(item.match ?? [])].some((prefix) => under(pathname, prefix));
}

/**
 * Yuqori panel uchun zaxira sarlavha: "Xarajatlar › Ish haqi".
 * Sahifa o'zining PageHeader'ini bersa, u ko'rinadi (bu yashiriladi).
 */
export function titleFor(pathname: string): { title: string; parent?: string } {
  const item = MENU.find((m) => isMenuActive(m, pathname));
  if (!item) return { title: 'Korxona tahlil' };
  if (isSourcePath(pathname) && (item.pages ?? []).every((p) => !under(pathname, p.href) || p.href === item.href)) {
    return { title: item.label, parent: item.href === '/sozlamalar' || item.href === '/kiritish' ? undefined : 'Kiritish' };
  }
  const page = item.pages
    ?.filter((p) => under(pathname, p.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (page && page.href !== item.href) return { title: page.label, parent: item.label };
  return { title: item.label };
}

/**
 * Bo'lim yorliqlari qatori: joriy manzil tegishli bo'lim va uning ichidagi sahifalar.
 * Ichida bittadan ko'p sahifa bo'lmasa — null (qator chizilmaydi).
 */
export function sectionFor(pathname: string, isAdmin: boolean): { item: NavItem; tabs: NavPage[] } | null {
  const item = MENU.find((m) => (!m.adminOnly || isAdmin) && !m.workerOnly && isMenuActive(m, pathname));
  const tabs = (item?.pages ?? []).filter((p) => !p.hidden);
  if (!item || tabs.length < 2) return null;
  return { item, tabs };
}

/** Yorliq faolmi: aniq manzil (bo'lim "Umumiy"si faqat o'zida) */
export function isTabActive(href: string, pathname: string): boolean {
  return pathname === href;
}

/** Bu yorliqlar bo'lim qatorida allaqachon bormi (sahifa ichidagi takror qatorni yashirish uchun) */
export function coveredBySection(hrefs: string[], pathname: string, isAdmin: boolean): boolean {
  const section = sectionFor(pathname, isAdmin);
  if (!section || hrefs.length === 0) return false;
  const known = new Set(section.tabs.map((t) => t.href));
  return hrefs.every((h) => known.has(h.split('?')[0] ?? h));
}

/** Global qidiruv uchun barcha sahifalar: "Xarajatlar › Ish haqi" */
export function pageIndex(isAdmin: boolean): { trail: string; href: string; description?: string }[] {
  const out: { trail: string; href: string; description?: string }[] = [];
  for (const item of MENU) {
    if (item.adminOnly && !isAdmin) continue;
    if (item.workerOnly) continue;
    if (item.href !== '/sozlamalar') out.push({ trail: item.label, href: item.href, description: item.description });
    for (const page of item.pages ?? []) {
      if (page.href === item.href) continue;
      out.push({ trail: `${item.label} › ${page.label}`, href: page.href, description: page.description });
    }
  }
  return out;
}