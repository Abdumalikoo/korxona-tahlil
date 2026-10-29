// ═══════════════════════════════════════════════════════════
// «Bu ma'lumot qayerda ko'rinadi» — Manba bo'limidagi har sahifa uchun:
// kiritilgan yoki yuklangan ma'lumot dasturning qaysi joylariga borib tushadi.
// Havolalar orqali o'sha joyni darhol ochish mumkin.
// ═══════════════════════════════════════════════════════════

export interface FlowTarget {
  label: string;
  href: string;
  /** U yerda nima sifatida ko'rinadi */
  what: string;
}

const HOME = (what: string): FlowTarget => ({ label: 'Bosh sahifa', href: '/', what });
const REPORTS = (what: string): FlowTarget => ({ label: 'Hisobotlar', href: '/hisobotlar', what });

const INCOME_TARGETS: FlowTarget[] = [
  HOME("«Daromad» va «Tahlil» kartochkalari — davr jami va foyda"),
  { label: 'Daromad tahlili', href: '/tahlil/daromad', what: 'Turlar, hududlar, oylar, o‘tgan davrga nisbatan o‘zgarish' },
  { label: 'Tahlil', href: '/tahlil/umumiy', what: 'Dinamika, o‘zgarish sabablari, barqarorlik, xodim samaradorligi' },
  { label: 'Solishtirma', href: '/solishtirma', what: 'Hudud daromadi (hudud yoki bo‘lim ko‘rsatilgan yozuvlar)' },
  { label: 'Solishtirma › Markaz', href: '/solishtirma/markaz', what: 'Markazga yoki Markaz bo‘limiga yozilgan daromad — manbalar bo‘yicha' },
  { label: 'Katta modellar', href: '/katta-modellar', what: 'Daromad prognozi, omillar' },
  { label: 'Nazorat', href: '/nazorat', what: 'Daromad rejasi qo‘yilgan moddalar' },
  { label: 'Ogohlantirishlar', href: '/munosabat/ogohlantirish', what: 'Daromad keskin kamaygani, to‘lanmagan qarz' },
  REPORTS('«Daromadlar tarkibi», «Davr moliyaviy hisoboti»'),
];

const EXPENSE_TARGETS: FlowTarget[] = [
  HOME("«Xarajat» va «Tahlil» kartochkalari — davr jami va foyda"),
  { label: 'Xarajat tahlili', href: '/tahlil/xarajat', what: 'Yo‘nalishlar, moddalar, hududlar, oylar' },
  { label: 'Tahlil', href: '/tahlil/umumiy', what: 'Xarajat o‘zgarish sabablari, doimiy / bir martalik qismi' },
  { label: 'Solishtirma', href: '/solishtirma', what: 'Hudud xarajati va natijasi' },
  { label: 'Solishtirma › Markaz', href: '/solishtirma/markaz', what: 'Markaz bo‘limlari xarajati va Xarajatlar siyosati bo‘yicha hududlar uchun to‘langani' },
  { label: 'Katta modellar', href: '/katta-modellar', what: 'Xarajat prognozi, stsenariy' },
  { label: 'Nazorat', href: '/nazorat', what: 'Oylik chegara qo‘yilgan moddalar' },
  { label: 'Ogohlantirishlar', href: '/munosabat/ogohlantirish', what: 'Xarajat keskin o‘sgani, g‘ayrioddiy katta yozuv' },
  REPORTS('«Xarajatlar tarkibi», «Davr moliyaviy hisoboti»'),
];

/** Ombor: xarajat KIRIM paytida yoziladi; chiqim/ko'chirish faqat kimda turganini o'zgartiradi */
const WAREHOUSE_TARGETS: FlowTarget[] = [
  { label: 'Xarajatlar ro‘yxati', href: '/xarajatlar/doimiy', what: 'Har kirim qatori — bitta xarajat yozuvi (manba: Ombor; TMZ — Doimiy, asosiy vosita — Boshqa)' },
  HOME('«Xarajat» va «Tahlil» kartochkalari — kirim summasi xarajatga qo‘shiladi'),
  { label: 'Xarajat tahlili', href: '/tahlil/xarajat', what: '«Ombor» yo‘nalishi: kanselyariya, xo‘jalik, kompyuter, mebel…' },
  { label: 'Solishtirma', href: '/solishtirma', what: 'Kirim hududga yoki bo‘limga yozilgan bo‘lsa — o‘sha hudud xarajatida' },
  { label: 'Nazorat', href: '/nazorat', what: '«Ombor» moddalariga oylik chegara qo‘yish mumkin' },
  REPORTS('«Xarajatlar tarkibi», «Davr moliyaviy hisoboti»'),
];

export const FLOW: Record<string, FlowTarget[]> = {
  '/daromadlar': INCOME_TARGETS,
  '/daromadlar/doimiy': INCOME_TARGETS,
  '/daromadlar/boshqa': INCOME_TARGETS,
  '/daromadlar/hududlar': [
    { label: 'Daromadlar ro‘yxati', href: '/daromadlar/doimiy', what: 'Har tuman × xizmat bitta yozuv bo‘lib tushadi (manba: Hududlar tushumi)' },
    { label: 'Daromad tahlili', href: '/tahlil/daromad', what: 'Hududlar va xizmat turlari' },
    { label: 'Solishtirma', href: '/solishtirma', what: 'Viloyat → tuman → xizmatlar' },
    HOME('Daromad jami'),
    REPORTS('«Daromadlar tarkibi», «Hududlar solishtirmasi»'),
  ],
  '/daromadlar/markaz': [
    { label: 'Daromadlar ro‘yxati', href: '/daromadlar/doimiy', what: 'Har oy × hisobraqam bitta Markaz daromadi yozuvi (Kassa: …)' },
    { label: 'Solishtirma › Markaz', href: '/solishtirma/markaz', what: 'Markaz daromadi manbalari' },
    HOME('Daromad jami'),
    REPORTS('«Daromadlar tarkibi»'),
  ],
  '/daromadlar/reja-tushum': [
    { label: 'Solishtirma', href: '/solishtirma', what: 'Tuman xodimlari: reja, tushum; tumanga bo‘linmagan daromad shu tushum ulushida taqsimlanadi' },
    { label: 'Ish haqi', href: '/xarajatlar/ish-haqi', what: '«Ustama miqdori» — Hududlar ish haqi vedomosti' },
    { label: 'Munosabat', href: '/munosabat', what: 'Xodim natijasini kuzatuvga olish' },
  ],
  '/daromadlar/natijalar': [
    { label: 'Solishtirma', href: '/solishtirma', what: 'Tuman xodimlari: reja va fakt' },
    { label: 'Ogohlantirishlar', href: '/munosabat/ogohlantirish', what: 'Reja bajarilmagan xodim va hududlar' },
    { label: 'Munosabat', href: '/munosabat', what: 'Xodim natijasini kuzatuvga olish' },
    REPORTS('«Ish haqi va xodimlar», «Hudud pasporti»'),
  ],
  '/xarajatlar': EXPENSE_TARGETS,
  '/xarajatlar/doimiy': EXPENSE_TARGETS,
  '/xarajatlar/boshqa': EXPENSE_TARGETS,
  '/xarajatlar/ish-haqi': [
    { label: 'Xarajatlar ro‘yxati', href: '/xarajatlar/doimiy', what: '«Ish haqi» yozuvlari (har xodim × oy)' },
    { label: 'Xarajat tahlili', href: '/tahlil/xarajat', what: '«Ish haqi» yo‘nalishi va tuzilmasi' },
    { label: 'Solishtirma', href: '/solishtirma', what: 'Hudud va tuman xodimlari ish haqi' },
    { label: 'Katta modellar', href: '/katta-modellar', what: 'Ish haqi prognozi, omillar (xodimlar soni)' },
    REPORTS('«Ish haqi va xodimlar»'),
  ],
  '/xarajatlar/tarkib': [
    { label: 'Xarajat tahlili', href: '/tahlil/xarajat', what: 'Ish haqi tuzilmasi: oklad, premiya, jarima' },
    { label: 'Ish haqi', href: '/xarajatlar/ish-haqi', what: 'Qaydnoma bilan solishtiriladi (tarkib = jami)' },
    REPORTS('«Ish haqi va xodimlar»'),
  ],
  '/mashinalar/tahlil': [
    { label: 'Xarajatlar ro‘yxati', href: '/xarajatlar/doimiy', what: '«Mashinalar» yozuvlari' },
    { label: 'Xarajat tahlili', href: '/tahlil/xarajat', what: '«Mashinalar» yo‘nalishi' },
    { label: 'Solishtirma', href: '/solishtirma', what: 'Hudud xarajatida' },
    REPORTS('«Mashinalar va ijara»'),
  ],
  '/dashbord/mashinalar': [
    { label: 'Xarajatlar ro‘yxati', href: '/xarajatlar/doimiy', what: '«Mashinalar» yozuvlari' },
    { label: 'Xarajat tahlili', href: '/tahlil/xarajat', what: '«Mashinalar» yo‘nalishi' },
    { label: 'Solishtirma', href: '/solishtirma', what: 'Hudud xarajatida' },
    REPORTS('«Mashinalar va ijara»'),
  ],
  '/xarajatlar/ijara': [
    { label: 'Xarajatlar ro‘yxati', href: '/xarajatlar/doimiy', what: '«Ijara» yozuvlari — har oy avtomatik' },
    { label: 'Xarajat tahlili', href: '/tahlil/xarajat', what: '«Ijara shartnomalari» yo‘nalishi' },
    { label: 'Solishtirma', href: '/solishtirma', what: 'Hudud xarajatida' },
    { label: 'Katta modellar', href: '/katta-modellar', what: 'Stsenariy: ijara o‘zgarishi' },
    REPORTS('«Mashinalar va ijara»'),
  ],
  '/xodimlar': [
    { label: 'Solishtirma', href: '/solishtirma', what: 'Hudud xodimlari, 1 xodimga daromad' },
    { label: 'Ish haqi', href: '/xarajatlar/ish-haqi', what: 'Qaydnomadagi xodimlar PINFL bo‘yicha moslanadi' },
    { label: 'Katta modellar', href: '/katta-modellar', what: 'Xodimlar soni — omillar va stsenariy' },
    REPORTS('«Hudud pasporti», «Ish haqi va xodimlar»'),
  ],
  '/ombor': WAREHOUSE_TARGETS,
  '/dashbord/ombor': WAREHOUSE_TARGETS,
  '/ombor/hujjatlar': WAREHOUSE_TARGETS,
  '/ombor/qoldiq': WAREHOUSE_TARGETS,
  '/ombor/asosiy-vositalar': [
    { label: 'Ombor', href: '/ombor', what: '«Kimda nima bor» — bo‘lim va hududlar bo‘yicha asosiy vositalar soni va qiymati' },
    { label: 'Xarajatlar ro‘yxati', href: '/xarajatlar/boshqa', what: 'Kirim summasi — «Ombor › …» moddasi (manba: Ombor)' },
    { label: 'Xarajat tahlili', href: '/tahlil/xarajat', what: '«Ombor» yo‘nalishi' },
  ],
};

export function flowFor(pathname: string): FlowTarget[] {
  return FLOW[pathname] ?? [];
}