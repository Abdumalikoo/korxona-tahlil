# Yo'nalishlar va xarajatlar siyosati

Markaz va hududlardan tashqari 4 ta alohida birlik qo'shildi. Ichki bo'linishi yo'q:

| Kod | Nomi |
|---|---|
| `TAX_FREE` | Tax free |
| `MARKSHEYDER` | Marksheyder |
| `FERMER` | Fermer xo'jaligi |
| `BUXGALTERIYA` | Buxgalteriya xizmatlari |

Ro'yxat ikki joyda yozilgan va ikkalasi bir xil bo'lishi kerak: `apps/api/src/common/segments/segments.ts` va `apps/web/src/lib/segments.ts`. Yangi yo'nalish qo'shish uchun har ikkisiga bitta qator yoziladi.

## Baza

`expenses` va `incomes` jadvallariga `segment` ustuni qo'shildi. U bo'sh bo'lishi mumkin va indeksi bor. Mavjud yozuvlar o'zgarmaydi: ularda `segment` bo'sh qoladi.

## Kiritish (daromad va xarajat)

Kiritish oynasida «Qayerga tegishli» bo'limidan bittasi tanlanadi. Yangi yozuvda bu tanlov majburiy.

- **Markaz** — bo'limni tanlash ixtiyoriy.
- **Hudud** — viloyat majburiy, tuman ixtiyoriy.
- **Yo'nalish** — hudud, tuman va bo'lim tanlanmaydi. Server ularni birga yuborishga ruxsat bermaydi.

Tekshiruv qoidasi bitta joyda: `common/segments/place.ts`.

## Xarajatlar siyosati

Har bir modda uchun kim to'lashi belgilanadi:

- **Yozilgan joyida** — hududda, Markazda yoki yo'nalishda, qayerda yozilgan bo'lsa, o'sha yerda qoladi.
- **Markaz hisobidan** — modda qayerda yozilgan bo'lsa ham Markaz xarajati bo'ladi.
- **Yo'nalish hisobidan** (Tax free, Marksheyder …) — modda qayerda yozilgan bo'lsa ham o'sha yo'nalishning xarajati bo'ladi.

Ota moddaga berilgan tanlov ichki moddalarga ham o'tadi. Ichki moddaga alohida tanlov berish mumkin, bunda moddaga eng yaqin belgi qaror qiladi.

Saqlash: `settings` jadvalidagi `expense.policy` yozuviga yangi `payers` maydoni qo'shildi. U `{ modda: yo'nalish }` ko'rinishida saqlanadi. Markaz standart hisoblanadi, shuning uchun `payers`ga yozilmaydi.

## Solishtirma va hisobotlar

- Har bir yo'nalish alohida qator bo'lib chiqadi: o'z daromadi, xarajati va natijasi bilan. U hududlar reytingiga kirmaydi.
- Ro'yxatdagi tartib: hududlar, Markaz, yo'nalishlar, biriktirilmagan.
- Markaz sahifasi, tumanlar va «Biriktirilmagan» oynasi yo'nalishga yozilgan yoki yo'nalish hisobidagi xarajatni o'zida hisoblamaydi. Shuning uchun bir summa ikki marta hisoblanmaydi.
- Hisobotlarda (`reports.data`) yo'nalish birligi `s:KOD` kalit bilan yuritiladi.
- «Solishtirma — to'liq hisobot»da yo'nalishlar alohida qator bo'ladi, ichida xizmatlar va moddalar ko'rinadi.

## Cheklovlar

- Iqtisodiy modellar (`econ`, `regional-econ`) yo'nalishlarni hali alohida birlik sifatida ko'rmaydi. Korxona jamisi to'g'ri chiqadi.
- Yo'nalishlarda xodimlar soni yo'q, chunki xodimlar faqat hudud yoki Markazga biriktiriladi.
- Eski yozuvlar avtomatik ko'chirilmaydi. Masalan, Markazdagi «Marksheyderlik» bo'limi yozuvlarini tahrirlash oynasi orqali qo'lda o'tkazish mumkin.

## Bo'lim sahifalari

Chap menyuda «Daromadlar» yoki «Xarajatlar» ochilganda, ostida 6 ta bo'lim chiqadi: `markaz`, `hududlar`, `tax-free`, `marksheyder`, `fermer`, `buxgalteriya`. Bo'limlar o'rtasida faqat chap menyu orqali o'tiladi; sahifa tepasida bo'limlar qatori yo'q.

### Xarajatlar › bo'lim

Har bo'lim umumiy Xarajatlar sahifasi kabi tuzilgan: sarlavha ostida o'z tarkibiy tuzilmalari qatori (yorliqlar). Har bo'limning tuzilmalari alohida va `apps/web/src/features/units/structure.ts` faylida yoziladi.

- Manzil: `/xarajatlar/bolim/<bo'lim>/<tuzilma>`; bo'limning o'zi ochilganda tuzilmalar tugmalari chiqadi.
- **Tax free**: Ish haqi · Ish haqi tarkibi · Ijara va kommunal · Asosiy vositalar · Bank xarajatlari · Reklama xarajatlari · Boshqa xarajatlar.
- Hozircha faqat tugmalar. Har bir tuzilmaning yuklash tartibi va shabloni keyin birma-bir qo'shiladi.
- Qolgan bo'limlarda tuzilmalar ro'yxati berilmaguncha «hali belgilanmagan» yozuvi chiqadi.

### Daromadlar › bo'lim

Doimiy / Boshqa / Xizmat turlari — faqat shu bo'lim yozuvlari. Excel'dan yuklash va «oy bo'yicha o'chirish» bu sahifada yo'q.

### Bo'lim moddalari ro'yxati

`settings` jadvalidagi `unit.categories` yozuvi. Ro'yxat bo'sh bo'lsa — cheklov yo'q. To'ldirilgan bo'lsa — qo'lda kiritishda faqat undagi moddalar qabul qilinadi. API: `GET/PATCH /api/unit-categories`, `POST /api/unit-categories/item`.

## Tax free › Ish haqi

Manzil: Xarajatlar › Tax free › Ish haqi (`/xarajatlar/bolim/tax-free/ish-haqi`). Umumiy Ish haqi sahifasi kabi ishlaydi, lekin undan alohida.

- **Shablon oylar oralig'i uchun.** «Dan» va «Gacha» oylari tanlanadi, masalan yanvar–mart. 1-varaq «Ish haqi»: PINFL, F.I.Sh., keyin har oy uchun alohida ustun. Qatorlarda bo'lim xodimlari turadi, oldin saqlangan summalar yozib qo'yiladi. 0 yoki bo'sh katak — o'sha oyda hisoblanmagan. Yuklanganda fayldagi hamma oylar o'qiladi, saqlanadigan oylar belgilanadi va har oy alohida vedomost bo'lib saqlanadi. Eski shablon (A — PINFL, B — Summa) ham o'qiladi: u yuqori paneldagi oyga yoziladi. 2-varaq «Tax free xodimlari»: faqat shu bo'lim xodimlari (PINFL, F.I.Sh., lavozim).
- **Xodimlar bo'limi bilan bog'langan.** Xodimlar bazasidagi faol xodimlar ro'yxatga o'zi tushadi:
  - bog'langan bo'limda turganlar. Standart holatda bo'lim nomida «Tax free» so'zi bo'lsa, tizim uni o'zi bog'laydi. Kerakli bo'limlarni Ish haqi sahifasidagi «Bog'lash» orqali tanlash mumkin;
  - lavozimida «Tax free» yozilganlar (hududdagi aeroport filiallari uchun). Buni o'chirib qo'yish mumkin.

  Xodimlar bo'limida yangi xodim qo'shilsa, keyingi shablonda o'zi chiqadi. Bazadan kelgan xodimni «Chiqarish» bilan ro'yxatdan olib tashlasa bo'ladi, unda u shablonda chiqmaydi. Sozlama `settings` jadvalidagi `unit.staffLink` yozuvida saqlanadi. API: `GET` va `PATCH /api/unit-payroll/:unit/link`.
- **Xodimlar ro'yxatini tizim o'zi yuritadi.** Vedomostda yangi PINFL kelsa, saqlanganda ro'yxatga qo'shiladi va keyingi shablonning 2-varag'ida chiqadi. Ismi umumiy xodimlar bazasidan olinadi. Bazada bo'lmasa, tahlil jadvalida F.I.Sh. kiritiladi. Ro'yxatdan chiqarilgan xodim keyingi vedomostda kelsa, ro'yxatga qaytadi.
- **Qo'lda boshqarish:** «+ Xodim» (PINFL kiritilsa, ism bazadan o'zi chiqadi), «Chiqarish» va «Qaytarish». Chiqarilgan xodim shablonga tushmaydi.
- **Saqlash** bitta xarajat yozuvini yaratadi: yo'nalish Tax free, modda «Ish haqi» (`PAYROLL_BASE`), sanasi oyning oxirgi kuni. Shu oyga oldin vedomost saqlangan bo'lsa, ikki yo'l bor: «Almashtirish» (oldingisi bekor qilinadi) yoki «Qo'shish». Bir xil vedomost ikki marta saqlanmaydi.
- **Bekor qilish** xarajatni savatga tushiradi. Xodimlar ro'yxati o'zgarmaydi.
- **Saqlash joyi:** `settings` jadvali. Xodimlar ro'yxati — `unit.staff`, vedomostlar — `unit.payroll.<BO'LIM>.<OY>`. Migratsiya kerak emas.
- **API:** `/api/unit-payroll/:unit/` ostida `staff`, `lookup/:pinfl`, `template`, `analyze`, `commit`, `batches`, `batches/:id/cancel`. O'zgartirish faqat administratorga ruxsat.

Cheklovlar:

- Tax free ish haqidan ijtimoiy soliq (Xarajatlar › Soliqlar) avtomatik hisoblanmaydi, chunki u umumiy vedomost asosida hisoblanadi.
- Ish haqi tarkibi (bayram, choraklik ulushlari) Tax free'ga qo'llanmaydi.
- Tax free xodimlari umumiy xodimlar bazasidagi Markaz yoki hudud sonlariga ta'sir qilmaydi.

## Tax free › Ish haqi tarkibi

Manzil: Xarajatlar › Tax free › Ish haqi tarkibi. Umumiy «Ish haqi tarkibi» sahifasining o'zi, Tax free uchun alohida yuritiladi.

- **Shablon** avvalgidek, vedomost shaklida. Xodimlar faqat Tax free xodimlari: «Ish haqi» yorlig'idagi faol ro'yxat va shu oy Tax free vedomostida borlar.
- **Fayl o'qilishi** avvalgidek: shablon yoki buxgalteriyaning «OYLIK» vedomosti, kerakli oy varag'i o'zi tanlanadi.
- **Solishtirish** shu oy Tax free ish haqi vedomosti bilan, har bir xodim bo'yicha.
- **Saqlash** `settings` jadvaliga (`unit.composition.TAX_FREE.<OY>`). Umumiy tarkibga, Markaz ulushiga (bayram, choraklik) va soliqlarga tegmaydi. Qayta saqlansa, shu oyning oldingi tarkibi almashtiriladi.
- **API** — avvalgi `/api/salary-composition/...`, oxiriga `?unit=TAX_FREE` qo'shiladi: `template`, `analyze`, `commit`, `view`, `check`, `batches`, `batches/:id/cancel` (`&period=` bilan), `employee/:pinfl`, `export`.

## Tax free › Ijara va kommunal

Manzil: Xarajatlar › Tax free › Ijara va kommunal. To'lovlar 13 ta filial kesimida yuritiladi. Filiallar ro'yxati `apps/api/src/modules/unit-lease/unit-lease.branches.ts` faylida, kodlari TF01–TF13.

- **Oylar oralig'i:** «Dan» va «Gacha» tanlanadi (masalan, yanvar–aprel), ko'pi bilan 24 oy. Tezkor tugmalar: «Shu oy», «Shu chorak», «Yil boshidan».
- **Shablon:** bitta varaq. Qatorlar — 13 filial, ustunlar — har oy uchun «Ijara» va «Kommunal», oxirida «Jami» (formula) va JAMI qatori. Oldin saqlangan summalar shablonga yozib qo'yiladi. Yashirin 4-qatorda oy va tur kodlari turadi, fayl shu qator bo'yicha o'qiladi.
- **Yuklash:** fayldagi hamma oylar o'qiladi. Ekranda saqlanadigan oylar belgilanadi: bo'sh oylar belgilanmagan bo'ladi, oldin saqlangan oy «almashtiriladi» deb ko'rsatiladi. Noto'g'ri katak 0 deb olinadi va ro'yxatda chiqadi. Filiali aniqlanmagan qator saqlanmaydi.
- **Saqlash:** har bir filial, oy va tur bo'yicha summa 0 dan katta bo'lsa, alohida xarajat yoziladi. Yo'nalish — Tax free, modda — «Ijara» (`LEASE`) yoki «Kommunal to'lovlar» (`KOMMUNAL`; yo'q bo'lsa avtomatik yaratiladi), kontragent — filial nomi. Oy qayta saqlansa, oldingi xarajatlari savatga tushadi.
- **Bekor qilish:** shu yuklash bilan turgan oylarning ma'lumoti o'chadi, xarajatlari savatga tushadi. Undan oldingi yuklash qaytmaydi.
- **Saqlash joyi:** `settings` jadvali, `unit.lease.TAX_FREE`. Migratsiya kerak emas.
- **API:** `/api/unit-lease/:unit/` ostida `branches`, `template?from=&to=`, `analyze`, `commit`, `data?from=&to=`, `batches`, `batches/:id/cancel`.

## Tax free › Bank xarajatlari

Manzil: Xarajatlar › Tax free › Bank xarajatlari. Shablon bank ko'chirmasi (выписка) shaklida. Ustunlar: №пп, Дата документа, Дата обработки, № док, Наименование счёта, ИНН, № счёта, МФО, Обороты по дебету, Обороты по кредиту, Назначение платежа.

- **O'qish:** fayldagi ma'lumot aynan o'zidek olinadi. Ustunlar sarlavha matni bo'yicha topiladi, shuning uchun tartibi farq qilsa ham o'qiladi.
- **Nima xarajat hisoblanadi:** «Обороты по дебету» summasi bor har bir qator. Faqat kredit (kirim) summasi bor qatorlar va «Итого» qatori xarajat emas. Kirim qatorlari soni va summasi ekranda ko'rsatiladi.
- **Izoh:** «Назначение платежа»dan olinadi. «За выд.ин.вал. по курсу ЦБ.» o'rniga «Naqd pul konvertatsiya to'lovi» yoziladi. Almashtirish qoidalari `apps/api/src/modules/unit-bank/unit-bank.service.ts` faylidagi `PURPOSE_RULES` ro'yxatida, yangisi bitta qator bilan qo'shiladi.
- **Oy va sana:** «Дата документа» bo'yicha. Fayldagi hamma oylar o'qiladi, saqlanadigan oylar ekranda belgilanadi. Oy qayta saqlansa, oldingi ma'lumoti almashtiriladi.
- **Xarajat yozuvi:** har bir to'lov alohida yoziladi. Yo'nalish — Tax free, modda — «Bank xarajatlari» (`BANK_XARAJAT`; yo'q bo'lsa avtomatik yaratiladi), kontragent — «Наименование счёта», hujjat raqami — «№ док».
- **Ko'rinish (ichma-ich):** oy (jami) → to'lovlar (izoh, sana, kimga, summa) → to'lov ochilsa, ko'chirmadagi hamma maydonlar, asl «Назначение платежа» ham.
- **Saqlash joyi:** `settings` jadvali, `unit.bank.TAX_FREE`. Migratsiya kerak emas.
- **API:** `/api/unit-bank/:unit/` ostida `template`, `analyze`, `commit`, `data?from=&to=`, `batches`, `batches/:id/cancel`.

## Tax free › Asosiy vositalar, Reklama xarajatlari, Boshqa xarajatlar (qo'lda kiritish jadvali)

Manzil: Xarajatlar › Tax free › Asosiy vositalar / Reklama xarajatlari / Boshqa xarajatlar. Uchalasi bitta jadval asosida ishlaydi, faqat moddasi va ustunlari farq qiladi.

- **Jadval (Excel kabi):** katakka to'g'ridan-to'g'ri yoziladi. Enter bosilsa, pastdagi katakka o'tiladi. Yuqoridagi bo'sh qatorga yozilsa, ostidan yangi bo'sh qator ochiladi. Yangi qatorlar yashil, tahrirlangan qatorlar sariq ko'rinadi, xato katak qizil bo'ladi (sichqoncha olib borilsa, sababi chiqadi).
- **Ustunlar:** Sana*, Nomi*, Filial (13 filial ro'yxatidan), Kontragent, Hujjat №, Summa*, Izoh. Asosiy vositalarda Soni va Narxi ham bor: Summa bo'sh qolsa, Soni × Narxi bo'yicha hisoblanadi.
- **Excel'dan qo'yish:** Excel'da kataklar nusxalanadi (Ctrl+C) va jadvalning istalgan katagiga qo'yiladi (Ctrl+V). Qatorlar va ustunlar o'zi to'ladi, kerak bo'lsa yangi qatorlar ochiladi. Sana «05.01.2026» ko'rinishida ham qabul qilinadi. Filial nomi yoki № bo'yicha topiladi.
- **Shablon → yuklash:** shablonda «Kiritish» varag'i (Filial ustunida ro'yxatdan tanlanadi), «Filiallar» va «Yo'riqnoma» varaqlari bor. To'ldirilgan fayl yuklansa, qatorlar jadvalga qoralama bo'lib tushadi. Ular tekshirilib, «Saqlash» bosiladi.
- **Saqlash:** hamma o'zgarishlar (yangi va tahrir) birga saqlanadi. Bitta qatorda xato bo'lsa ham hech narsa yozilmaydi va xato qatorlar ko'rsatiladi. Har qator Xarajatlarda alohida yozuvga aylanadi: yo'nalish Tax free, manba — qo'lda. Qator tahrirlansa, o'sha yozuv yangilanadi.
- **Moddalar** (yo'q bo'lsa avtomatik yaratiladi): `UNIT_ASSET` — Asosiy vositalar (xarid), `REKLAMA` — Reklama xarajatlari, `UNIT_OTHER` — Boshqa xarajatlar.
- **O'chirish:** qatorlar belgilanib o'chiriladi va xarajat yozuvlari savatga tushadi. Xarajatlar bo'limida o'chirilgan yozuv bu jadvalda ko'rinmaydi, savatdan tiklansa qaytadi.
- **Boshqa imkoniyatlar:** oylar oralig'i bo'yicha ko'rish, qidirish, oylar kesimida jami, Excel'ga yuklab olish.
- **Saqlash joyi:** `settings` jadvali, `unit.entries.<BO'LIM>.<ASSET|AD|OTHER>`. Migratsiya kerak emas.
- **API:** `/api/unit-entries/:unit/:kind/` ostida: GET `?from=&to=`, POST `save {rows}`, POST `delete {ids}`, GET `template`, GET `export?from=&to=`, POST `parse` (fayl).

## Har bo'lim › Xarajatlar siyosati (modda boshqa bo'lim hisobiga)

Manzil: Xarajatlar › <bo'lim> › Xarajatlar siyosati. Bu sahifa 6 bo'limning hammasida bor: Markaz, Hududlar, Tax free, Marksheyder, Fermer xo'jaligi, Buxgalteriya xizmatlari.

- **Nima qiladi:** shu bo'limda yozilgan xarajat moddasi qaysi bo'lim hisobida hisoblanishini belgilaydi. Masalan, Tax free'dagi «Internet» Markaz hisobiga, «Reklama» esa Marksheyder hisobiga o'tishi mumkin.
- **Variantlar:** «Umumiy siyosat bo'yicha» (qoida yo'q), «Shu bo'limda qoladi» (umumiy siyosatdan istisno) yoki «<bo'lim> hisobiga». Hududlar maqsad bo'la olmaydi, chunki aniq hudud yo'q. Hududlar bo'limida faqat «Hududda qoladi» varianti bor.
- **Guruhlar:** guruhga berilgan qoida ichidagi moddalarga ham o'tadi. Ichki moddaning o'z qoidasi bo'lsa, o'shanisi ustun.
- **Ustuvorlik:** avval bo'lim qoidasi, keyin umumiy siyosat (Xarajatlar › Xarajatlar siyosati).
- **Yozuvlar:** joyida qoladi, bazada hech narsa o'zgarmaydi. Qoida Solishtirma, tumanlar, hisobotlar, Markaz xarajati (siyosat xulosasi) va Nazorat (reconcile) natijalarida qo'llanadi. Qoida olib tashlansa, hammasi avvalgidek bo'ladi.
- **Sahifa:**
  - davrda yozilgan summa;
  - boshqa bo'limlar hisobiga o'tgani (qaysi bo'limga qancha);
  - boshqa bo'limlardan kelgani;
  - bo'lim hisobidagi xarajat;
  - modda daraxti: summa, kim hisobida va sababi (bo'lim qoidasi, guruh qoidasi, umumiy siyosat yoki yozilgan joyida);
  - bir nechta moddani belgilab, bitta qoidani birdaniga qo'llash.

  O'zgarishlar «Saqlash» bosilishidan oldin ham jami summalarda ko'rinadi.
- **Saqlash joyi:** `settings` jadvali, `expense.policy` kalitidagi `unitRules` maydoni: `{ TAX_FREE: { INTERNET: 'CENTER' } }`. Migratsiya kerak emas. Umumiy siyosat saqlanganda bo'lim qoidalari o'chmaydi.
- **API:** GET `/api/expense-policy/unit/:unit?from=YYYY-MM&to=YYYY-MM`, PATCH `/api/expense-policy/unit/:unit { rules }` (to'liq ro'yxat yuboriladi).

## Umumiy ko'rinish: yo'nalishlar — o'z bo'limi sifatida

Bosh sahifa › Daromad / Xarajat / Tahlil (ichma-ich jadvallar) va Modellar sahifalarida Tax free, Marksheyder, Fermer xo'jaligi va Buxgalteriya xizmatlari yozuvlari endi «Biriktirilmagan» deb ko'rinmaydi. Har biri o'z nomi bilan alohida birlik sifatida chiqadi:

- **Ko'rsatkichlar:** har yo'nalish uchun alohida kartochka (summa, ulushi, yozuvlar soni). Bosilsa, o'sha bo'lim yozuvlari ochiladi.
- **Daromad tarkibi:** daraxt tartibi Markaz → Hududlar → Tax free → … → Biriktirilmagan. Yo'nalish ichida moddalar bor, ular ichidagi summa bosilsa yozuvlar ochiladi.
- **Xarajat moddalari:** Markaz va Hududlar ustunlaridan keyin yozuvi bor har bir yo'nalish uchun alohida ustun qo'shiladi.
- **Kesimlar va oylar:** «Birlik» kesimida va oylar grafigida yo'nalishlar alohida ko'rinadi.
- **Tahlil (natija):** foyda va zarar hisobotida daromad yo'nalishlar bo'yicha ham ajratiladi. Har bir birlik jadvalida yo'nalishning o'z daromadi, xarajati va natijasi bor.
- **Biriktirilmagan:** faqat hudud, bo'lim yoki yo'nalish ko'rsatilmagan yozuvlar shu yerda qoladi.
- **Modellar:** yo'nalish alohida birlik (`segment`) bo'ladi. Hududlar uchun reja va ustama xarajat taqsimotida yo'nalish yozuvlari hisobga olinmaydi. Siyosat bo'yicha Markaz hisobiga o'tganlari esa Markaz xarajatiga qo'shiladi.
- **Filtr:** `unit = s:TAX_FREE`, `s:MARKSHEYDER` … bitta yo'nalish uchun, `segments` hamma yo'nalishlar uchun.

## Solishtirma › Tax free, Marksheyder, Fermer xo'jaligi, Buxgalteriya xizmatlari

Solishtirma menyusida Markazdan keyin 4 ta yangi sahifa bor: `/solishtirma/tax-free`, `/solishtirma/marksheyder`, `/solishtirma/fermer`, `/solishtirma/buxgalteriya`. Har biri o'z bo'limi bo'yicha alohida ma'lumot beradi:

- **Ko'rsatkichlar:**
  - daromad: korxona jamidagi ulushi bilan;
  - xarajat: ish haqi alohida, siyosat bo'yicha kelgan va o'tgan summa bilan;
  - natija (foyda yoki zarar);
  - rentabellik.

  Hammasi o'tgan davr yoki o'tgan yil bilan taqqoslanadi. Bo'lim filtri: Hammasi, Doimiy yoki Boshqa.
- **Daromad manbalari:** xizmat turlari bo'yicha, ulushi va o'zgarishi bilan.
- **Xarajat tarkibi:** guruh → modda. Unda shu bo'limda yozilgan va shu bo'lim hisobida qolgan xarajatlar ko'rinadi.
- **Siyosat oqimlari:**
  - «Boshqa bo'limlardan shu bo'lim hisobiga» — xarajatga qo'shiladi;
  - «Shu bo'limdan boshqa bo'lim hisobiga» — xarajatga kirmaydi.
- **So'nggi 12 oy:** daromad va xarajat ustunlari, har oyning natijasi.
- **Ichma-ich ko'rish:** istalgan summa bosilsa, o'sha summani tashkil qilgan yozuvlar ochiladi (Bosh sahifadagi bilan bir xil panel).
- **Hisob:** Solishtirmadagi bilan bir xil. Jami summalar Solishtirma jadvalidagi yo'nalish qatoriga teng.
- **Bog'lanish:** Solishtirma jadvalida (Hududlar va Umumiy) yo'nalish qatori bosilsa, uning sahifasi ochiladi.
- **API:** GET `/api/structure/regions/segment/:code?from&to&section&compare`.