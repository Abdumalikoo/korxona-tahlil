// ═══════════════════════════════════════════════════════════
// Sahifa tepasidagi qisqa tushuntirish: bu sahifa nima ko'rsatadi, ma'lumot qayerdan,
// qanday ishlatiladi. Manzil bo'yicha (aniq moslik; /munosabat/[id] kabi — prefiks bilan).
// ═══════════════════════════════════════════════════════════

export interface PageIntro {
  /** Bu sahifa nima ko'rsatadi */
  what: string;
  /** Ma'lumot qayerdan olinadi */
  from: string;
  /** Qanday ishlatiladi (ixtiyoriy) */
  how?: string;
}

const INCOME_SRC = "Daromadlar bo'limidagi yozuvlar";
const EXPENSE_SRC = "Xarajatlar bo'limidagi yozuvlar";
const BOTH_SRC = "Daromadlar va Xarajatlar bo'limlaridagi yozuvlar";

export const INTROS: Record<string, PageIntro> = {
  '/': {
    what: 'Tanlangan davrdagi daromad, xarajat va natija bir qarashda.',
    from: BOTH_SRC,
    how: "Daromad, Xarajat yoki Tahlil kartochkasini bosing — ichiga kirib boriladigan jadvallar ochiladi. Davrni yuqoridagi «Davr» tugmasidan o'zgartiring.",
  },
  '/tahlil/daromad': {
    what: 'Daromad qayerdan va qancha keldi: Markaz va hududlar, moddalar, bo‘limlar, mijozlar, oylar; o‘tgan davr va o‘tgan yilga nisbatan.',
    from: INCOME_SRC,
    how: '▸ belgisi — qator ichini ochadi; istalgan summa bosilsa — uni tashkil qilgan aniq yozuvlar ochiladi. Grafiklar sahifa oxirida.',
  },
  '/tahlil/xarajat': {
    what: 'Pul nimaga sarflandi: guruhlar va moddalar, Markaz va hududlar, bo‘limlar, kontragentlar, oylar; o‘tgan davr va o‘tgan yilga nisbatan.',
    from: EXPENSE_SRC,
    how: '▸ belgisi — qator ichini ochadi; istalgan summa bosilsa — uni tashkil qilgan aniq yozuvlar ochiladi. Grafiklar sahifa oxirida.',
  },
  '/tahlil/umumiy': {
    what: 'Korxona foydada ishlayaptimi: foyda, rentabellik, foyda nima uchun o‘zgargani va xavfli holatlar.',
    from: BOTH_SRC,
    how: '«Natija jadvali» — oylar bo‘yicha foyda va zarar hamda Markaz va hududlar natijasi (summalar bosiladi); boshqa yorliqlar — dinamika, samaradorlik va tarkib.',
  },
  '/solishtirma': {
    what: 'Hududlar va Markaz yonma-yon: kim qancha daromad keltirdi, qancha xarajat qildi va natijasi.',
    from: `${BOTH_SRC}, Xodimlar bo'limi`,
    how: "Viloyatni bosing — tumanlar, tumanni bosing — xizmatlar va xodimlar ochiladi. Markaz — yuqoridagi «Markaz» yorlig'ida.",
  },
  '/hudud-reja': {
    what: "Kelasi oy uchun statistik prognoz: jami, hududlar, xizmatlar va xodimlar rejasi; prognoz aniqligi (tarixiy test) va ma'lumotlar to'liqligi.",
    from: "Hududlar tushumi (dasturdagi) va «Ma'lumotlarni yuklash»dagi Excel tarixlari, xizmatlar katalogi va tariflar",
    how: "Prognoz oyini tanlang. Hisob yo'q bo'lsa — «Prognozlash»da hisoblang. Grafiklar pastda.",
  },
  '/hudud-reja/yuklash': {
    what: "Prognoz uchun tarixiy ma'lumotlarni Excel orqali yuklash: daromad va xizmatlar soni, xodimlar natijalari, xodim × xizmat, hudud omillari, tariflar.",
    from: 'Siz to‘ldirgan shablonlar',
    how: "Shablonni yuklab oling → to'ldiring → yuklang. Fayl avval tekshiriladi; natijani ko'rib «Tasdiqlash» bosilgandagina bazaga yoziladi.",
  },
  '/hudud-reja/prognoz': {
    what: "Prognozni hisoblash: har hudud × xizmat uchun 8 tagacha model tarixiy testda solishtiriladi, eng aniq (teng bo'lsa soddarog'i) tanlanadi.",
    from: "Yuklangan va dasturdagi tarix, tariflar, xodimlar ma'lumoti",
    how: "Avval «Ma'lumotlarni tekshirish», so'ng «Prognozni hisoblash». Bir nechta hisobni pastda solishtirish mumkin.",
  },
  '/hudud-reja/hududlar': {
    what: "Har hudud: oxirgi oy, prognoz, o'zgarish, asosiy model, aniqlik, ma'lumot sifati va reja holati (Hisoblangan / Tasdiqlangan).",
    from: 'Tanlangan prognoz hisobi',
    how: "Hudud nomini bosing — xizmatlar va grafiklar. «Tasdiqlash» yangi versiya yaratadi; eski versiyalarni tiklash mumkin.",
  },
  '/hudud-reja/xizmatlar': {
    what: "39 xizmat: oxirgi va prognoz qilingan soni, tarif, daromad, tanlangan model, tarixiy xato va ishonchlilik.",
    from: 'Tanlangan prognoz hisobi',
    how: "Hududni tanlang va qatorni bosing — barcha modellar taqqoslanishi, tanlov sababi va tarix ochiladi.",
  },
  '/hudud-reja/xodimlar': {
    what: "Hudud prognozining xodimlarga taqsimoti: xizmatlar bo'yicha tarixiy ulush va ish kunlari; taqsimlanmagan qism alohida ko'rsatiladi.",
    from: "Xodimlar_Tarixi va Xodim_Xizmatlari (yuklangan), Xodimlar bo'limi",
    how: "Taqsimlanmagan summani «Xodimga biriktirish» bilan o'tkazing; hudud yig'indisi o'zgarmaydi.",
  },
  '/solishtirma/umumiy': {
    what: "Butun korxona bitta ekranda: Markaz va barcha hududlar bir jadvalda — daromad, xarajat tarkibi, natija, rentabellik va Markazni qoplash.",
    from: `${BOTH_SRC}, Xodimlar bo'limi, Xarajatlar siyosati`,
    how: "Yuqorida korxona jami (Hududlar | Markaz bo'yicha), so'ng natija ko'prigi va jadval. Qatorni bosing — o'sha hudud yoki Markaz sahifasi ochiladi.",
  },
  '/xarajatlar/internet': {
    what: "Internet to'lovlari: qaysi shartnomaga qancha to'lanmoqda, kimga va qayerga (Markaz, Markaz bo'limi yoki hudud) biriktiriladi.",
    from: "Bank ro'yxati (har oy: summa | shartnoma ustunlari) yoki Internet shabloni",
    how: "Faylni yuklang — shartnoma raqami to'lov izohidan o'zi olinadi; har shartnomaga provayder, izoh va biriktirishni tanlab «Xarajat sifatida saqlash».",
  },
  '/solishtirma/ozgarishlar': {
    what: "Xodimlar o'zgarishi: bu oy nechta xodimga oylik hisoblandi (hududlar va Markaz), o'tgan oyga nisbatan kim ishga olindi, bo'shadi, ishlamadi yoki ko'chdi.",
    from: "Ish haqi vedomostlari, Xodimlar reestri (ishga kirgan va bo'shagan sana), natijalar faylidagi hudud tarixi",
    how: "Oyni tanlang; hudud qatorini bossangiz — pastdagi ro'yxat shu hudud bo'yicha, holat tugmalari bilan saralanadi.",
  },
  '/solishtirma/markaz': {
    what: "Markaz: daromad manbalari, o'z xarajati, hududlar uchun to'langan xarajat va sof natija.",
    from: `${BOTH_SRC}, Xodimlar bo'limi, Xarajatlar siyosati`,
    how: "Bo'limni bosing — xodimlari, xodimni bosing — oylar bo'yicha ish haqi ochiladi.",
  },
  '/tahlil/markaz': {
    what: "Markaz hisobraqamlari bo'yicha oylik tushum (kunlik ma'lumotnomadan).",
    from: "Buxgalteriya › Kunlik tushum va qoldiq (qo'lda yoki fayldan)",
    how: "Oy daromadi — oyning oxirgi ma'lumotnomasidagi «Oy boshidan» + «Kunlik tushum».",
  },
  '/daromadlar/markaz': {
    what: "Markaz tushumi: kunlik tushum va qoldiq faylini yuklash, oylik Markaz daromadi.",
    from: "«Kunlik tushum va qoldiq» Excel fayli yoki Buxgalter kiritgan ma'lumotnoma",
    how: "Faylni tashlang — ko'rib chiqib saqlang; Markaz daromadi Daromadlarga avtomatik yoziladi.",
  },
  '/daromadlar/reja-tushum': {
    what: "Xodimlar reja va tushumi: daromadni xodimlarga bo'lib beradi, ustama — hudud ish haqi.",
    from: "Reja/tushum Excel fayli (Xodim F.I.Sh, JShShIR, Shtat, Hudud nomi, reja, tushum, ustama)",
    how: "Oyni tanlab faylni tashlang; olinmaydigan qatorlar ko'rsatiladi, reestrda yo'q xodimni shu yerdan qo'shasiz.",
  },
  '/xarajatlar/soliqlar': {
    what: "Soliqlar: hamma soliqlar bir joyda — Markaz va hududlar bo'yicha oyma-oy; soliq turlarini o'zingiz qo'shasiz.",
    from: "Qo'lda yoki Excel shablondan kiritilgan summalar; ish haqidan foizli soliqlar (ijtimoiy soliq) — ish haqi vedomostidan avtomatik",
    how: "Oyni tanlang, kataklarga summani yozib «Saqlash»; yangi soliq — pastdagi «Soliq turlari»da. «Markaz hisobidan» belgilangan soliq qaysi hududda yozilsa ham Markaz xarajati.",
  },
  '/xarajatlar/asosiy-vositalar': {
    what: "Asosiy vositalar: xarid balansda turadi, xarajatga har oy faqat sarfi (eskirishi) o'tadi.",
    from: "Ombor › Kirim (asosiy vosita), asosiy vosita moddasidagi xarajatlar va qo'lda kiritilganlar",
    how: "Moddalar va xizmat muddatini belgilang; sarf har oy avtomatik yoziladi, hisobdan chiqarilsa qolgan qiymat o'sha oy sarfga o'tadi.",
  },
  '/xarajatlar/siyosat': {
    what: "Xarajatlar siyosati: qaysi moddalar hudud o'rniga Markaz hisobidan to'lanadi.",
    from: "Xarajatlar bo'limidagi moddalar",
    how: "Har bir modda yonida «Markaz | Hudud» tugmasi; bir nechtasini belgilab, tepadagi ikki tugma bilan birdan o'tkazish mumkin. Saqlangach Solishtirma, Markaz paneli, Munosabat va hisobotlarda qo'llanadi.",
  },
  '/daromadlar': {
    what: 'Daromadlar bo‘limi: tanlangan oyda Doimiy va Boshqa daromadlar jami va dinamikasi.',
    from: 'Siz kiritgan va Excel orqali yuklangan daromad yozuvlari',
    how: 'Yozuvlarni ko‘rish va qo‘shish uchun «Doimiy» yoki «Boshqa» yorlig‘iga o‘ting.',
  },
  '/daromadlar/doimiy': {
    what: 'Har oy takrorlanadigan daromadlar ro‘yxati — qo‘shish, tahrirlash, Excel’dan yuklash.',
    from: 'Siz kiritgan yozuvlar',
    how: 'Yozuvni bosing — tahrirlash oynasi ochiladi. Oyni yuqoridan o‘zgartiring.',
  },
  '/daromadlar/boshqa': {
    what: 'Bir martalik daromadlar ro‘yxati — qo‘shish, tahrirlash, Excel’dan yuklash.',
    from: 'Siz kiritgan yozuvlar',
  },
  '/daromadlar/hududlar': {
    what: 'Hududlardan Excel orqali keladigan tushum: shablon, yuklash va hududlar bo‘yicha jami.',
    from: 'Yuklangan Excel fayllar',
    how: 'Shablonni yuklab oling → to‘ldiring → «Yuklash». Tekshiruvdan keyin saqlanadi.',
  },
  '/daromadlar/natijalar': {
    what: 'Xodimlarning oylik natijalari (reja va fakt) — yuklash va hisobot.',
    from: 'Yuklangan Excel fayllar, Xodimlar bo‘limi',
  },
  '/daromadlar/tahlil': {
    what: 'Tanlangan oyda daromadning bo‘limlar va xulq-atvor bo‘yicha taqsimoti.',
    from: INCOME_SRC,
  },
  '/xarajatlar': {
    what: 'Xarajatlar bo‘limi: tanlangan oyda Doimiy va Boshqa xarajatlar jami va dinamikasi.',
    from: 'Siz kiritgan va yuklangan xarajat yozuvlari (ish haqi, ijara, mashinalar ham)',
    how: 'Yozuvlarni ko‘rish va qo‘shish uchun «Doimiy» yoki «Boshqa» yorlig‘iga o‘ting.',
  },
  '/xarajatlar/doimiy': {
    what: 'Har oy takrorlanadigan xarajatlar ro‘yxati — qo‘shish, tahrirlash, Excel’dan yuklash.',
    from: 'Siz kiritgan yozuvlar',
  },
  '/xarajatlar/boshqa': {
    what: 'Bir martalik xarajatlar ro‘yxati — qo‘shish, tahrirlash, Excel’dan yuklash.',
    from: 'Siz kiritgan yozuvlar',
  },
  '/xarajatlar/ish-haqi': {
    what: 'Oylik ish haqi qaydnomasi: yuklash, tekshiruv va xarajatlarga yozish.',
    from: 'Yuklangan Excel qaydnoma, Xodimlar bo‘limi',
    how: 'Shablonni yuklab oling → to‘ldiring → «Yuklash». Xatolar ko‘rsatiladi, keyin saqlanadi.',
  },
  '/xarajatlar/soliq-hisoboti': {
    what: "Soliq hisobotining o'zi (JShDS hisob-kitobi): 4-ilova — oylik, 5-ilova — ta'til puli va boshqa daromadlar.",
    from: 'Soliq idorasiga topshirilgan Excel hisobot',
    how: "Faqat «hisobot davrida hisoblangan» summa olinadi; ikkala ilovadagi summa PINFL bo'yicha qo'shiladi. Keyin — Ish haqidagidek bo'limlarga taqsimot va saqlash.",
  },
  '/xarajatlar/23106': {
    what: "23106 hisob raqamidan xodimlarga to'lovlar (bayram puli, mukofot, xizmat safari …): kim, qachon, nima uchun.",
    from: "Bankdan olingan ko'chirma (выписка) Excel fayli",
    how: "Xodim — ИНН ustunidagi PINFL (bo'lmasa izohdagi F.I.Sh.); nima uchun va buyruq — «Назначение платежа»dan. Ish haqi tarkibi va soliq hisoboti bilan solishtiriladi; xarajat yozuvi yaratilmaydi.",
  },
  '/xarajatlar/bank-kochirma': {
    what: "Bank ko'chirmasi tahlili: hisob raqamidan chiqim va kirim — nimaga, kimga, qancha, oyma-oy va o'sib boruvchi.",
    from: "Bankdan olingan ko'chirma (выписка) Excel fayli — 23106 shabloni shaklida",
    how: "O'xshash to'lovlar (bir oluvchiga bir maqsadda; izohdagi sana, raqam, summa e'tiborga olinmaydi) bitta guruhga yig'iladi va turi aniqlanadi (soliq, kommunal, aloqa …). Xarajat va daromadga yozilmaydi.",
  },
  '/xarajatlar/ish-haqi-solishtirma': {
    what: "Har xodim: ish haqi fondi (FOT) − daromad solig'i (12%) − kasaba uyushmasi (2%, faqat asosiy shtat) = 23106 dan to'langan summa. Farq chiqqanlar alohida ko'rsatiladi.",
    from: "Ish haqi tarkibi (bo'lmasa soliq hisoboti), Xodimlar bo'limi (shtat yoki shartnoma), 23106 ko'chirmasi",
    how: "Shartnoma: 10 000 000 − 1 200 000 = 8 800 000. Shtat: 10 000 000 − 1 200 000 − 200 000 = 8 600 000. Bank oyi — izohdagi «… oyi uchun» (avans va qoldiq bitta oyga), yoki to'langan oy. Foizlar sozlanadi.",
  },
  '/xarajatlar/tarkib': {
    what: 'Ish haqi tarkibi: har xodim bo‘yicha komponentlar (oklad, ustama, mukofot…).',
    from: 'Yuklangan Excel fayl',
  },
  '/mashinalar/tahlil': {
    what: 'Mashinalar xarajatlari: yoqilg‘i, ta’mir, probeg va 100 km ga sarf.',
    from: 'Mashina yozuvlari (ular Xarajatlarga ham yoziladi)',
  },
  '/xarajatlar/ijara': {
    what: 'Ijara shartnomalari va oylik to‘lovlar: oyni yopish, muddati tugayotganlar.',
    from: 'Ijara shartnomalari (to‘lovlar Xarajatlarga yoziladi)',
  },
  '/xarajatlar/tahlil': {
    what: 'Tanlangan oyda xarajatning bo‘limlar, xulq-atvori va keskin oshgan moddalar bo‘yicha tahlili.',
    from: EXPENSE_SRC,
  },
  '/xodimlar': {
    what: 'Xodimlar ro‘yxati: hudud, bo‘lim, lavozim; o‘tkazmalar (kim qayerdan qayerga o‘tgan).',
    from: 'Siz kiritgan va qaydnomadan olingan xodimlar',
    how: 'Davr oxiri o‘tgan kun bo‘lsa — ro‘yxat o‘sha kundagi holat bo‘yicha.',
  },
  '/dashbord/ombor': {
    what: 'Ombor dashbordi: qoldiq qiymati, davr kirimi va chiqimi, kimda nima bor, kam qolganlar, inventarizatsiya va pochta.',
    from: 'Omborchi o‘z bo‘limida kiritgan hujjatlar (kirim summasi Xarajatlarga o‘zi tushadi)',
    how: 'Bu yerda kiritilmaydi — faqat ko‘rish. Xato hujjatni ochib bekor qilish mumkin.',
  },
  '/dashbord/mashinalar': {
    what: 'Mashinalar dashbordi: oy xarajati turlar va guruhlar bo‘yicha, 100 km ga sarf, me’yordan oshganlar, 12 oylik grafik.',
    from: 'Omborchi o‘z bo‘limida kiritgan mashina xarajatlari (har biri Xarajatlarga ham tushadi)',
    how: 'Bu yerda yangi yozuv qo‘shilmaydi. Xato yozuvni bosib tuzatish yoki o‘chirish mumkin.',
  },
  '/kiritish': {
    what: 'Umumiy hudud kiritadiganlari bitta joyda: xarajat, daromad, Excel yuklash. O‘ngda — bugun kim nima kiritgani (rollar kiritgani ham).',
    from: 'Kiritilgan har yozuv o‘z bo‘limiga tushadi (Xarajatlar, Daromadlar). Ombor, mashina, pochta — Omborchi bo‘limida',
    how: 'Istalgan sahifada N tugmasi yoki yuqoridagi «+ Kiritish» — shu ro‘yxat. Yozib qidirish mumkin: «benzin», «pochta», «oylik».',
  },
  '/ombor': {
    what: 'Ombor bir qarashda: qoldiq qiymati, davrdagi kirim va chiqim, kam qolgan buyumlar, qaysi bo‘lim va hududda nima borligi.',
    from: 'Ombor hujjatlari (kirim, chiqim, qaytarish, ko‘chirish, hisobdan chiqarish)',
    how: 'Kirim summasi o‘sha zahoti Xarajatlarga yoziladi — Bosh sahifa va Tahlilda ko‘rinadi.',
  },
  '/ombor/hujjatlar': {
    what: 'Barcha ombor hujjatlari davr bo‘yicha. Har biri uchun Word dalolatnoma yuklab olinadi.',
    from: 'Siz kiritgan ombor hujjatlari',
    how: 'Yuqoridagi tugmalardan hujjat turini tanlang. Qatorni bosing — tafsilot, dalolatnoma, bekor qilish.',
  },
  '/ombor/qoldiq': {
    what: 'Buyumlar ma’lumotnomasi va hozirgi qoldiq: omborda qancha, o‘rtacha narx, qiymati, kam qolganlari.',
    from: 'Kirim − chiqim − hisobdan chiqarish + qaytarish (bekor qilinmagan hujjatlar)',
    how: 'Yangi buyumni bir marta qo‘shing — keyin kirim va chiqimda tanlanadi.',
  },
  '/ombor/asosiy-vositalar': {
    what: 'Har bir asosiy vosita inventar raqami bilan: hozir kimda va qayerda, qayerlardan o‘tgan.',
    from: 'Kirim (har donasiga inventar raqami), chiqim, ko‘chirish, qaytarish hujjatlari',
    how: 'Qatorni bosing — harakat tarixi va «Ko‘chirish», «Qaytarish» tugmalari ochiladi.',
  },
  '/modellar': {
    what: 'Matematik formulalar: o‘sish, ulush, barqarorlik, bog‘liqlik — korxona ma’lumotlari ustida.',
    from: `${BOTH_SRC}, Xodimlar bo'limi`,
    how: 'Chapdan formulani tanlang, parametrlarni belgilang — natija va izoh pastda chiqadi.',
  },
  '/katta-modellar': {
    what: 'Prognoz, omillar, samaradorlik, zararsizlik, stsenariy va risk — kelajak va sabablar.',
    from: `${BOTH_SRC}, Xodimlar bo'limi`,
    how: "O'tgan oy tanlansa — modellar o'sha oy oxiridagi holat bo'yicha (prognozni haqiqat bilan solishtirish uchun).",
  },
  '/munosabat': {
    what: 'Muhokamaga qo‘yilgan moddalar: muddat, mas’ullar va avvalgi sur’atga nisbatan natija.',
    from: BOTH_SRC,
    how: 'Yuqoridagi sariq «+ Munosabat» bilan sahifalardan moddalarni belgilang va munosabat yarating.',
  },
  '/munosabat/ogohlantirish': {
    what: 'Tizim o‘zi topgan holatlar: xarajat keskin o‘sgan, daromad tushgan, zarar, reja bajarilmagan, qarz.',
    from: BOTH_SRC,
    how: 'Holatni bosing — hisob-kitobi ochiladi; kerak bo‘lsa munosabat yarating yoki «Ko‘rildi» deb belgilang.',
  },
  '/nazorat': {
    what: 'Oylik chegaralar: har oy avtomatik tekshiriladi, buzilgan va xavf ostidagilar ajratiladi.',
    from: BOTH_SRC,
  },
  '/hisobotlar': {
    what: 'Tayyor hisobotlar: ekranda ko‘ring yoki Excel, PowerPoint, PDF yuklab oling.',
    from: `${BOTH_SRC}, Xodimlar bo'limi`,
    how: 'Tepada hisobotni tanlang; davr yuqori paneldagi «Davr» tugmasidan.',
  },
  '/formulalar': {
    what: 'Dasturdagi har bir raqam qanday hisoblanadi: formula, ma’nosi va misol.',
    from: 'Saytda, Excel va slaydlarda ishlatiladigan formulalar',
  },
};

/** Munosabat sahifasi kabi ichki sahifalar */
const PREFIX: { prefix: string; intro: PageIntro }[] = [
  {
    prefix: '/munosabat/',
    intro: {
      what: 'Bitta munosabat: har modda avvalgi sur’at bilan solishtiriladi — ta’sir, holat, grafiklar, mas’ullar.',
      from: BOTH_SRC,
      how: 'Excel va slaydlarda har modda bo‘yicha hisob-kitob bor.',
    },
  },
];

export function introFor(pathname: string): PageIntro | null {
  const exact = INTROS[pathname];
  if (exact) return exact;
  // /munosabat/ogohlantirish aniq ro'yxatda — prefiks faqat qolganlari uchun
  return PREFIX.find((p) => pathname.startsWith(p.prefix))?.intro ?? null;
}