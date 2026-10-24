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
- **Fermer xo'jaligi**: Ish haqi · Ish haqi tarkibi · Ijara va internet · Asosiy vositalar · TMZ · Boshqa xarajatlar. Ish haqi va Ish haqi tarkibi oldingi shablon tizimida (xodimlar — faqat Fermer xodimlari); Ijara va internet — Tax free'dagi Ijara va kommunal kabi; Asosiy vositalar, TMZ va Boshqa xarajatlar — qo'lda kiritish jadvali.
- **Buxgalteriya xizmatlari**: Ish haqi · Ish haqi tarkibi · Reklama xarajatlari · Asosiy vositalar · TMZ · Boshqa xarajatlar. Ish haqi va Ish haqi tarkibi oldingidek (xodimlar — faqat Buxgalteriya xizmatlari xodimlari); qolganlari — qo'lda kiritish jadvali.
- **Marksheyder**: Ish haqi · Ish haqi tarkibi · Xizmat safari · Asosiy vositalar · Mashina xarajatlari · Boshqa xarajatlar. Ish haqi va Ish haqi tarkibi Tax free'dagidek ishlaydi (xodimlar — faqat Marksheyder xodimlari); qolganlari hozircha tugma.
- Har bir bo'limda oxirgi yorliq — **Xarajatlar siyosati** (avtomatik qo'shiladi).
- Shabloni berilmagan tuzilmalar hozircha faqat tugma. Har bir tuzilmaning yuklash tartibi va shabloni keyin birma-bir qo'shiladi.
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
- **API:** `/api/unit-lease/:unit/` ostida `branches` (GET; POST — joylarni saqlash), `template?from=&to=`, `analyze`, `commit`, `data?from=&to=`, `batches`, `batches/:id/cancel`.

## Fermer xo'jaligi › Ijara va internet

Manzil: Xarajatlar › Fermer xo'jaligi › Ijara va internet. Tax free › Ijara va kommunal bilan bir xil tizim (oylar oralig'i, shablon, yuklash, saqlanadigan oylarni belgilash, almashtirish, bekor qilish), farqlari:

- **Turlar:** har oy uchun «Ijara» (`LEASE`) va «Internet» (`INTERNET` — «Internet xizmatlari»; yo'q bo'lsa avtomatik yaratiladi). Bo'limlar bo'yicha turlar `unit-lease.branches.ts` dagi `LEASE_CONFIG`da.
- **Joylar:** ro'yxat qat'iy emas — sahifadagi «Joylar» kartasida tahrirlanadi (nomini o'zgartirish, qo'shish, tartibini almashtirish, o'chirish). Boshida bitta joy — «Fermer xo'jaligi». Kodlar (FX01, FX02 …) o'zgarmaydi va qayta berilmaydi: nomi o'zgarsa summalar o'sha joyda qoladi. Summasi saqlangan joyni o'chirib bo'lmaydi (qaysi oylarda borligi aytiladi). Saqlash joyi — `settings`, `unit.lease.branches.FERMER`.
- **Solishtirma daraxtida:** «Ijara va internet» → joy → Ijara / Internet.

## Fermer xo'jaligi › TMZ

Qo'lda kiritish jadvali (Asosiy vositalar kabi): sana, nomi, kontragent, hujjat №, soni × narxi = summa, izoh. Modda — «TMZ (tovar-moddiy zaxiralar)» (`UNIT_TMZ`, avtomatik yaratiladi). Saqlash joyi — `unit.entries.FERMER.TMZ`. Solishtirma daraxtida alohida «TMZ» tuzilmasi.

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

## Qo'mita pullarining sarfi (7-bo'lim)

Yangi bo'lim: kodi `QOMITA`, nomi «Qo'mita pullarining sarfi», manzili `qomita`. U boshqa yo'nalishlar kabi hamma joyda chiqadi: Xarajatlar va Daromadlar bo'limlari, kiritish, Solishtirma (`/solishtirma/qomita`), Bosh sahifa jadvallari va siyosatlarda maqsad sifatida. Unga xarajatlar Xarajatlar siyosati orqali boshqa bo'limlardan o'tkaziladi. O'tkazish tartibi keyin alohida aniqlashtiriladi.

## Bo'lim siyosati: hamma moddalar va ish haqi qismlari

- **Moddalar:** «Shu bo'limdagilar» (ro'yxatda, yozilgan yoki qoidasi bor) va «Hamma moddalar» (korxonaning hamma faol moddalari) almashtirgichi bor. Har moddani istalgan bo'lim hisobiga, jumladan Qo'mitaga o'tkazish mumkin.
- **Ish haqi qismlari:** ish haqi tarkibidagi komponentlar (bayram puli, choraklik, ustama …), har biri uchun «Ish haqi ichida qoladi» yoki «<bo'lim> hisobiga». Davrda hisoblangan va ajratilgan summalar ko'rsatiladi.
- **Qanday ishlaydi:** saqlanganda komponent summasi ish haqidan ayriladi va alohida xarajat bo'lib yoziladi. Uning moddasi `IHQ_<kod>`, ota moddasi «Ish haqi qismlari». Bu xarajat yozilgan bo'limda turadi, lekin hisobotlarda tanlangan bo'lim hisobida ko'rinadi. Jami summa o'zgarmaydi. Qoida olib tashlansa, summa ish haqiga qaytadi.
  - **Yo'nalishlar** (Tax free …): bo'limning ish haqi vedomosti va bo'lim «Ish haqi tarkibi» ishlatiladi. Qayta ajratish quyidagi hollarda bajariladi: ish haqi yoki tarkib saqlanganda, bekor qilinganda va siyosat o'zgarganda. Ajratilganlar `settings` jadvalida, `unit.payroll.split.<BO'LIM>.<OY>` kalitida saqlanadi.
  - **Markaz va Hududlar:** umumiy ish haqi va umumiy «Ish haqi tarkibi» ishlatiladi. Qayta guruhlash (regroup) avvalgidek ishlaydi:
    - umumiy siyosatdagi komponentlar (hudud xodimining bayram va choraklik pullari) Markaz moddasiga (HM_…) o'tadi;
    - bo'lim qoidasi bo'lsa, `IHQ_<kod>` moddasiga o'tadi;
    - «Hududda qoladi» deb belgilangani ajratilmaydi.
- **Saqlash joyi:** `settings` jadvalidagi `expense.policy` kaliti: `unitRules` (moddalar) va `unitPayroll` (ish haqi qismlari). Migratsiya kerak emas.
- **Umumiy siyosat sahifasi:** tepasida 7 bo'lim siyosatiga havolalar bor.

## Solishtirma › yo'nalish: ichma-ich daraxt

Har bir yo'nalish sahifasida (Tax free, Marksheyder, Fermer xo'jaligi, Buxgalteriya xizmatlari, Qo'mita) ikkita ichma-ich jadval bor:

- **Xarajat:** tuzilma → xodim / filial / to'lov oluvchi / modda → oylar → yozuvlar.
  - Tuzilmalar: Ish haqi, Ish haqi qismlari, Ijara va kommunal, Bank xarajatlari, Asosiy vositalar, Reklama, Boshqa xarajatlar, Boshqa moddalar, Boshqa bo'limlardan (siyosat bo'yicha).
  - Ish haqi ichida bo'lim vedomostidagi xodimlar ko'rinadi. Agar qismlar boshqa bo'limga ajratilgan bo'lsa, farqi alohida qatorda chiqadi.
  - Ijara va kommunal ichida filiallar, ularning ichida «Ijara» va «Kommunal».
- **Daromad:** xizmat turi → mijoz → oylar → yozuvlar.
- **Boshqaruv:**
  - «Oylar kesimida» belgilansa, har oy alohida ustun bo'ladi;
  - «Hammasini ochish» tugmasi bor;
  - summa yoki oy katagi bosilsa, aynan o'sha yozuvlar ochiladi.
- **Markaz va Hududlar:** ularning ichma-ich tizimi avvalgidek ishlaydi: Markaz → bo'lim → xodim → oylar; viloyat → tuman → xodim → oylar.

## Solishtirma › Umumiy: joyida kengayadigan to'liq jadval

Umumiy sahifada qator bosilsa, endi boshqa sahifaga o'tilmaydi. Qatorning o'zi kengayib, birlikning to'liq tarkibi ochiladi (`features/regions/overall-tree.tsx`):

- **Hudud:** tumanlar → tuman (xizmatlar, xarajat tarkibi, xodimlar) → xodim → oylar (ish haqi, reja, tushum). Hudud qatorida daromad va xarajat tarkibi ham bor.
- **Markaz:** bo'limlar → bo'lim (daromad va xarajat tarkibi, xodimlar) → xodim → oylar. Bulardan tashqari: daromad manbalari, o'z xarajati, hududlar uchun to'langan (qaysi hudud uchun).
- **Yo'nalishlar** (Tax free, Qo'mita …):
  - xarajat tuzilmalari → xodim / filial / to'lov oluvchi / modda → oylar;
  - daromad → mijoz → oylar;
  - siyosat bo'yicha boshqa bo'lim hisobiga o'tganlari.
- **Biriktirilmagan:** moddalar → yozuvlar.
- **Ustunlar:** Daromad, Xarajat, Natija, O'tgan davr va o'zgarish, Xodim.
- **Boshqaruv:**
  - «yozuvlar» tugmasi o'sha summani tashkil qilgan yozuvlarni ochadi;
  - panelda «Hammasini ochish» 3 darajagacha birdan ochadi;
  - jadval tepasidagi «Hammasini ochish» hamma birliklarni ochadi;
  - ichki darajalar bosilganda yuklanadi;
  - har birlikda «Alohida sahifada ochish ↗» havolasi bor.
- **Kenglik:** ochilgan panel jadval gorizontal aylantirilsa ham ko'rinadigan kenglikda turadi.
- **Boshqa jadval va grafiklar:** Taqqoslash, Oylar, Ulush lentasi, Markazni qoplash va tepadagi kartochkalardan bosilsa, umumiy jadvalda o'sha birlik ochiladi va unga o'tiladi.
- **Yo'nalishlar hisobda:** tepadagi «Butun korxona» kartochkasi va natija ko'prigi (Bridge) grafigiga yo'nalishlar alohida qator bo'lib qo'shildi. Shu bilan qismlar yig'indisi korxona jamiga teng bo'ladi.

## 7 bo'limda o'chirish tugmalari

- **Xarajatlar › <bo'lim>** (Markaz, Hududlar, Tax free, Marksheyder, Fermer, Buxgalteriya, Qo'mita): tuzilmalar qatorining o'ng tomonida «O'chirish» (oy, kun, oraliq) va «Hammasini o'chirish» tugmalari bor.
- **Daromadlar › <bo'lim>:** Doimiy va Boshqa ro'yxatlarida ham xuddi shunday: belgilanganlar, oy yoki oraliq va «Hammasini o'chirish».
- **Qamrov:** faqat shu bo'lim yozuvlari o'chadi (`scope.unit` — `entryUnitWhere` qoidasi bo'yicha). O'chganlar savatga tushadi, tiklash mumkin. «Hammasi» yoki 50 tadan ortiq yozuv uchun parol so'raladi. Hududchi faqat Hududlar bo'limida o'chira oladi.

## Xodimlarning bo'limlar o'rtasida ko'chishi («miya» tarixi)

- **Nima uchun:** xodim ba'zi oylarda bir bo'limda, keyin boshqasida bo'ladi. Masalan: Aliyev yanvar–mart Tax free'da, apreldan Markazda, iyuldan yana Tax free'da. Tizim har oy uchun xodim qaysi bo'limda ekanini biladi.
- **Qanday yoziladi:**
  - Xarajatlar › <yo'nalish> › Ish haqi › xodimlar ro'yxati › «Ko'chirish»: bo'lim (7 tadan biri) va qaysi oydan, ixtiyoriy izoh (buyruq №).
  - «+ Xodim» shaklida «Boshqa bo'limdan, shu oydan» to'ldirilsa, xodim shu oydan boshlab shu bo'limga ko'chirilgan bo'ladi.
- **Hisoblash qoidasi:** oy uchun bo'lim — o'sha oygacha (shu oy ham) bo'lgan eng so'nggi ko'chish. Ko'chish yo'q bo'lsa, odatdagi qoida ishlaydi (bo'lim ro'yxati va Xodimlar bazasi bilan bog'lanish). Oldingi oylar o'zgarmaydi.
- **Bo'lim ro'yxati:** «Oy» tanlanadi va o'sha oydagi tarkib ko'rsatiladi. Boshqa bo'limga ketganlar ro'yxatdan chiqadi, ko'chib kelganlar qo'shiladi («boshqa bo'limdan ko'chib kelgan»). Har xodimda ko'chishlar belgisi bor («Iyul 2026dan: Tax free»). Pastda ikki qism bor:
  - «Shu oyda boshqa bo'limda» — kimlar va qaysi bo'limda;
  - «Ko'chishlar tarixi» — qayerdan qayerga, qachondan, qo'lda yoki vedomostdan. Har birini bekor qilish mumkin.
- **Shablon:** oylar oralig'idagi hamma oylarda shu bo'limda bo'lganlar chiqadi. Xodim boshqa bo'limda bo'lgan oyning katagi kulrang bo'ladi, izohida qaysi bo'limda ekani yoziladi.
- **Vedomost («miya»):** xodim o'sha oyda boshqa bo'limda bo'lsa, tahlilda «bu oyda: Markaz → ko'chadi» deb ko'rsatiladi. Summa bilan saqlansa, o'sha oydan shu bo'limga ko'chish avtomatik yoziladi (`source: UPLOAD`).
- **Saqlash joyi:** `settings` jadvalidagi `unit.moves` kaliti. Migratsiya kerak emas.
- **API:** `/api/unit-payroll/:unit/` ostida: GET `staff?period=`, GET `moves?pinfl=`, POST `moves {pinfl, unit, from, note?}`, DELETE `moves/:id`.

## Yo'nalish › Ish haqi: saqlangan ish haqi xodimlar bo'yicha

- **Joylashuv:** sahifada vedomost yuklash maydonining ostida «Saqlangan ish haqi · <oy>» jadvali turadi. Uning yonida xodimlar ro'yxati, «Yuklashlar tarixi» esa pastga tushdi.
- **Jadvalda:** har xodim birma-bir — F.I.Sh., PINFL, lavozimi va summasi. Bir necha yuklashda bo'lsa, nechtasida ekani yoziladi. Ko'chishlar bo'yicha shu oyda boshqa bo'limda bo'lsa, «bu oyda: Markaz» belgisi chiqadi. Pastda jami summa, qidiruv ham bor. Siyosat bo'yicha ajratilgan ish haqi qismlari alohida eslatiladi.
- **O'chirish** (bitta yoki belgilanganlar): xodim shu oy vedomostidan olib tashlanadi. Yuklash jami va ish haqi xarajati qayta hisoblanadi, yuklash bo'sh qolsa xarajati o'chadi. Ish haqi qismlari qayta ajratiladi.
- **«Bo'lim» / «Boshqa bo'limda ishlagan…»:** o'sha oyda qaysi bo'limda ishlagani tanlanadi, so'ng:
  - «Miya»: shu oydan o'sha bo'limda deb yoziladi. «Faqat shu oy» belgilansa, keyingi oydan yana shu bo'limga qaytadi (agar keyingi oyga boshqa ko'chish yozilmagan bo'lsa).
  - Ish haqidan olib tashlanadi.
  - «Summasi bilan» belgilansa, summa o'tkaziladi:
    - yo'nalishga — uning vedomostiga, «<bo'lim>dan o'tkazildi» nomli yuklash bo'lib;
    - Markazga — Markaz ish haqi xarajati bo'lib (Xodimlar bazasidagi bo'limi bilan);
    - Hududlarga — xodimning hududi ish haqi xarajati bo'lib. Hududi noma'lum bo'lsa, rad etiladi.
- **API:** GET `/api/unit-payroll/:unit/saved?period=`, POST `saved/remove?period= {pinfls}`, POST `saved/move?period= {pinfls, target, onlyThisMonth, withAmount}`.

## Xodimlar › Ma'lumotnomalar va Miya

Manzil: Xodimlar sahifasi, yangi yorliqlar «Ma'lumotnomalar (10 · 16 · 37 · 51)» va «Miya — xodim kartasi». Faqat administrator ko'radi.

**Jadvallar** (ustunlar asl fayllardagi kabi; ro'yxat `apps/api/src/modules/hr-sheets/hr-sheets.config.ts`da):

| Jadval | Mazmuni | Xodim qanday tanib olinadi |
|---|---|---|
| 10-jadval · Umumiy | tabel, tug'ilgan sana/joy, holati, tashkilot, tuzilma, lavozim, tizimda/lavozimida, ma'lumoti, manzil, yoshi, unvon | ЖШШИР |
| 16-jadval · Shaxsiy | departament, tuzilma, lavozim, tayinlash buyrug'i, pasport, jinsi, millati, aloqa, ta'lim, diplom, to'liq tuzilma, shartnoma muddati | PINFL |
| 37-jadval · Ishga kirganlar | soliq organi, lavozimi, ma'lumoti, ilgari ishlagan joyi | F.I.Sh. (10/16-jadval yoki Xodimlar bazasidagi bilan bir xil yozilsa, bitta odamga to'g'ri kelsa) |
| 51-jadval · Qabul va o'tkazish | hudud kodi, tashkilot, qaysi tuzilma/lavozimga, asos, markaziy apparat xulosasi, holati; bir xodimga bir necha qator | JSHSHIR |

- **Shablon:** asl shaklda (1-qatorda jadval raqami, 7-qatorda sarlavha, 9-qatorda ustunlar), «Ko'rsatma» varag'i bilan.
- **Yuklash:** sarlavha qatori birinchi 30 qatordan o'zi topiladi, ustunlar nomi bo'yicha moslanadi (tartib o'zgarsa, ortiqcha ustun bo'lsa ham o'qiladi; kirill/lotin nomlari). Tahlilda: saqlanadigan qatorlar, xato qatorlar (JShShIR 14 raqam emas, F.I.Sh. bo'sh), takrorlar, topilmagan ustunlar, hozirgi holatga nisbatan yangi / chiqib ketadigan / o'zgargan, Xodimlar bazasida bor-yo'qligi, bo'limlar bo'yicha taqsimot.
- **Saqlash:** har yuklash jadvalning yangi to'liq holati. Oldingisi bitta saqlanadi — «Oldingi holatga qaytarish». «Tozalash» ham qaytariladi. Saqlash joyi — `settings`: `hr.sheet.<J10|J16|J37|J51>` va `.prev`. Migratsiya kerak emas.
- **Maxfiylik:** pasport, telefon, e-pochta, IP, manzil, diplom raqami jadval ro'yxatida yashirin (oxirgi 3 belgi). To'liq — faqat xodim kartasida, «Ko'rsatish» bosilganda. Audit jurnaliga faqat sonlar yoziladi.

**Miya qanday oziqlanadi:**

- Tuzilma / departament nomidan bo'lim aniqlanadi: «Fermer …» → Fermer xo'jaligi, «Tax free» yoki «Chet el fuqarolariga qo'shilgan qiymat solig'ini qaytarish …» → Tax free, «Marksheyder …» → Marksheyder, «Buxgalteriya xizmat …» → Buxgalteriya xizmatlari. Ustuvorlik: 10-jadval → 16-jadval → 51-jadval → 37-jadval.
- Bo'lim ish haqi (Xarajatlar › bo'lim › Ish haqi) shablonining xodimlar varag'iga shu bo'limga tegishli va ishlayotgan xodimlar o'zi tushadi. «Bog'lash» oynasida «Ma'lumotnomalardan» belgisi bilan o'chirib qo'yish mumkin. Ko'chishlar ustun turadi.
- Xodimlar bazasida yo'q JShShIR uchun vedomost tahlili, saqlangan ish haqi va ko'chishlarda ism va lavozim ma'lumotnomalardan olinadi.

**Miya — xodim kartasi:** JShShIR yoki F.I.Sh. bo'yicha qidiruv (ma'lumotnomalar va Xodimlar bazasi). Kartada: holati, hozirgi bo'limi, bo'lim ro'yxatlarida, ko'chishlar tarixi, Xodimlar bazasidagi ma'lumot, har jadvaldagi hamma maydonlar (guruhlangan), ish haqi (umumiy vedomost va bo'limlar vedomosti). Ro'yxat yorlig'ida har xodim qatorida «Miya» tugmasi; ma'lumotnoma jadvalida qatorni bosish ham kartani ochadi.

**API:** `/api/hr-sheets` (umumiy holat), `/:code/rows?q=&unit=&page=`, `/:code/template`, `/:code/export`, `POST /:code/analyze` (fayl), `POST /:code/commit` (`token`), `POST /:code/restore`, `DELETE /:code`, `/search?q=`, `/person/:pinfl`.

## Chat › Manba chati

Manzil: chap menyuda «Chat» (`/chat`). Ikki yorliq: **Manba chati** va **AI chati** (keyingi bosqich, `/chat/ai`). Faqat administrator ko'radi.

Manba chati savolga **faqat tizimdagi manbalardan** javob beradi: sun'iy intellekt ishlatmaydi va taxmin qilmaydi. Ma'lumot topilmasa, shuni aytadi.

**Nimani tushunadi** (`apps/api/src/modules/source-chat/chat.parse.ts`):
- **Yozuv:** lotin va kirill, tutuq belgilari va qo'shimchalar bilan («Ўтган ойдаги иш ҳақи», «Aliyevning», «Andijonda», «fermerniki»).
- **Xodim:** JShShIR (14 raqam) yoki F.I.Sh. bo'laklari. Yozilish farqlari teng ko'riladi: h/x, iy/i, yo/o. Bir nechta odam mos kelsa, tanlash uchun ro'yxat chiqadi.
- **Davr:**
  - oy nomlari: kelajakdagi oy o'tgan yilga tegishli deb olinadi;
  - yil, `2026-03`, `03.2026`;
  - «yanvardan martgacha»;
  - «yanvar va fevral» — solishtirish;
  - «2-chorak», «birinchi yarim yil»;
  - «o'tgan oy», «shu oy», «o'tgan yil», «shu yil», «oxirgi 3 oy».
  - Davr aytilmasa: pul uchun yil boshidan; yozuvlar uchun oxirgi 3 oy.
- **Bo'lim:** Markaz, Hududlar, Tax free, Marksheyder, Fermer, Buxgalteriya, Qo'mita. Viloyat nomi bilan (Toshkent shahri va Toshkent viloyati farqlanadi). Markaz bo'limi nomi bilan.
- **Modda:** xarajat yoki daromad moddasi nomi bo'yicha (Ijara, Internet …).
- **Ko'rsatkich:** xarajat, daromad, natija (yoki daromad + xarajat), ish haqi.
- **Guruhlash:** oylar, moddalar yoki bo'limlar/hududlar bo'yicha; «eng ko'p», «eng kam».
- **Davom savollari:** oldingi javobdan kontekst olinadi.
  - «fevraldagi-chi?», «daromadi-chi?»;
  - «uning ish haqi» — oldingi xodim;
  - «shu bo'lim xarajati» — oldingi bo'lim;
  - «shu davr» — oldingi davr.

**Javob turlari:**
- **Xodim kartasi:** miyadagi hamma narsa — 4 ma'lumotnoma, Xodimlar bazasi, bo'limi, ko'chishlar, ish haqi. Alohida savol bilan faqat ish haqi (davr bo'yicha), faqat ko'chishlar yoki faqat «qaysi bo'limda».
- **Pul:**
  - jami, oldingi shuncha davrga nisbatan foiz, oyiga o'rtacha;
  - oylar jadvali, moddalar diagrammasi, bo'limlar/hududlar diagrammasi;
  - natija so'ralsa: daromad, xarajat, natija va rentabellik.
  - Xarajat kim hisobida ekani Solishtirma bilan bir xil: Xarajatlar siyosati qo'llanadi.
- **Solishtirish:** ikki davr, farq va eng katta o'zgargan moddalar.
- **So'nggi yozuvlar:** 25 tasi — sana, summa, modda, kim hisobida, kontragent.
- **Xodimlar soni va ro'yxati:** bo'lim ro'yxati (miya), Markaz, Hududlar, viloyat yoki Markaz bo'limi bo'yicha. Umumiy savolda — hamma bo'limlar bo'yicha.
- **«Manbalar»:** qaysi manbada nechta yozuv bor. **«Qanday bo'limlar bor»:** bo'limlar ro'yxati.

**Har javobda:**
- «tushunildi» belgilari: ko'rsatkich, bo'lim, davr, modda, oldingi savoldan nima olingani;
- manba (qaysi jadval, nechta yozuv);
- davom savollari tugmalari.

O'ng panelda joriy kontekst va namuna savollar turadi.

**Suhbatlar** (chap panel). Har foydalanuvchiniki alohida:
- Birinchi savolda suhbat o'zi ochiladi va saqlanadi. Nomi — birinchi savol; uni o'zgartirish mumkin, qo'yilgan nom saqlanib qoladi.
- Suhbatlarni qadash mumkin (qadalganlar tepada), suhbatlar orasidan qidirish mumkin.
- Oxirgi ochilgan suhbat sahifa qayta ochilganda o'zi ochiladi.
- Ko'pi bilan 100 ta suhbat; to'lsa, eng eski qadalmagani o'chadi. Bitta suhbatda 200 tagacha savol-javob.

**Tozalash.** Har biri tasdiq bilan so'raladi va ma'lumotlarga (xarajat, daromad, xodimlar) tegmaydi:
- bitta savol-javobni o'chirish;
- suhbat ichini tozalash (suhbatning o'zi qoladi);
- suhbatni o'chirish;
- qadalmagan hamma suhbatlarni o'chirish;
- hamma suhbatlarni o'chirish.

Saqlangan javoblar bularning hammasidan keyin ham qoladi.

**Saqlash:**
- ☆ «Saqlash» bosilgan javob «Saqlanganlar»ga tushadi (300 tagacha). Unga izoh qo'shish mumkin. Saqlanganlar qidiriladi, ochib ko'riladi, javob olingan suhbatga o'tish mumkin, bittasini yoki hammasini o'chirish mumkin.
- «Nusxalash» javobni matn qilib buferga oladi: savol, tushunilgani, jadvallar, manba.
- «Excel»: suhbatni yoki saqlanganlarni (hammasini, qidiruvdagilarni yoki bittasini) faylga chiqaradi. Har savol-javob ketma-ket yoziladi: savol, vaqt, izoh, tushunilgani, matn, ko'rsatkichlar, jadvallar, manba. Xodim kartasidan faqat asosiy maydonlar chiqadi, pasport va aloqa ma'lumotlari chiqmaydi.

**Saqlash joyi** — `settings`:
- `chat.source.<foydalanuvchi>.index` — suhbatlar ro'yxati;
- `.t.<id>` — suhbat ichidagi savol-javoblar;
- `.saved` — saqlangan javoblar.

Eski bitta tarix birinchi ochilganda «Avvalgi suhbat» bo'lib ko'chadi. Migratsiya kerak emas.

**API** (`/api/source-chat/`):
- `POST ask` (`text`, `context`, `threadId`);
- `threads`: `GET`, `POST`, `DELETE` (`?keepPinned=1`);
- `threads/:id`: `GET`, `PATCH` (`title`, `pinned`), `DELETE`;
- `threads/:id/clear`, `threads/:id/items/:itemId` (`DELETE`), `threads/:id/items/:itemId/text`, `threads/:id/export`;
- `saved`: `GET`, `POST`, `DELETE`;
- `saved/:id`: `PATCH` (izoh), `DELETE`;
- `saved/export?ids=`.

### Manba chati — kuchaytirilgan imkoniyatlar

- **Xato yozuvlar tuzatiladi.** Masalan: «xarjat» → xarajat, «yanvr» → yanvar, «marksheydr» → Marksheyder, «Andjon» → Andijon. Javobda «Tuzatildi» deb ko'rsatiladi. Ism va familiyalar o'zgartirilmaydi. To'g'ri so'zlar tuzatishdan himoyalangan (olgan/otgan, buxgalter/buxgalteriya).
- **Bo'limlar va viloyatlarni solishtirish:** «Fermer va Tax free xarajatini solishtir», «Andijon va Samarqand natijasi». Jadvalda har birining daromadi, xarajati, shu jumladan ish haqi, natijasi va rentabelligi; diagramma; eng kattasi matnda aytiladi.
- **Yil-yil solishtirish:** «o'tgan yilning shu davri bilan solishtir».
- **Filtrlar:**
  - kontragent yoki mijoz: «Artelga to'langan», «kontragent X», qo'shtirnoqdagi so'z;
  - summa: «5 mln dan katta», «500 ming so'mdan kam»;
  - to'lanmagan (qarz);
  - tuman: «Asaka tumani».

  Filtrli javobda eng katta yozuvlar jadvali va kontragentlar diagrammasi chiqadi. «Kontragentlar bo'yicha» / «mijozlar bo'yicha» guruhlash ham bor.
- **Korxona jamidagi ulushi** — bo'lim yoki hudud bo'yicha har pul javobida ko'rsatiladi.
- **Xodimlar tahlili** (ma'lumotnomalar va Xodimlar bazasi):
  - **filtrlar:** jinsi (16-jadval), yoshi («40 yoshdan katta», «30 yoshgacha», «25–35 yosh»), ma'lumoti (oliy, o'rta maxsus, tugallanmagan oliy), lavozim («buxgalterlar», «bosh mutaxassislar»), ishga kirgan davr (10-jadval «Tizimda»), viloyat, tuman, bo'lim;
  - **guruhlash:** lavozim, yosh, jins, ma'lumot, viloyat, tuman yoki bo'lim bo'yicha;
  - **javobda:** soni, ayol/erkak, o'rtacha yosh, ro'yxat (60 tagacha).
- **Ish haqi reytingi:** «eng ko'p ish haqi olgan xodimlar», «eng kam», «o'rtacha ish haqi». Umumiy vedomost va bo'limlar vedomostlaridan olinadi. Javobda: jami, xodimlar soni, bir xodimga oyiga o'rtacha, top 25.
- **«Balki shu xodimni nazarda tutgandirsiz?»** — savol tushunilmasa, familiyasi yaqin xodimlar taklif qilinadi.

### Chat kodi

Manzil: Sozlamalar › Chat kodi (`/sozlamalar/chat-kodi`).

**Standart kod hammaga ma'lum**, shuning uchun u bilan chatga kirib, saqlab yoki yangi suhbat ochib bo'lmaydi. U faqat yangi kod o'rnatish uchun ishlaydi. Chat birinchi ochilganda «Chat kodini o'rnating» oynasi chiqadi: standart kod va yangi kod ikki marta kiritiladi, keyin chat darhol ochiladi.

- **Qayerda so'raladi** (sozlanadi):
  - **Chatga kirish** — qulf ekrani. Kod to'g'ri bo'lsa, belgilangan muddat (15 daqiqadan 1 kungacha, standart 2 soat) shu brauzer oynasida qayta so'ralmaydi.
  - **Saqlash** — ☆ «Saqlash» va Excel'ga yuklab olish, har safar.
  - **Yangi suhbat** — «Yangi suhbat» tugmasi yoki suhbatsiz birinchi savol, har safar.
- **O'zgartirish:** kod, qayerda so'ralishi va kirish muddati faqat joriy kod bilan saqlanadi. Kod almashtirilsa, chatga yangi kod bilan qayta kiriladi.
- **Yangi kod:** 6–8 raqam. Bir xil raqamlar (777777) va ketma-ketlik (123456, 654321) qabul qilinmaydi. Avval qo'yilgan 4–5 xonali kod ishlayveradi, lekin almashtirganda yangisi kamida 6 raqam bo'ladi.
- **Himoya:**
  - bazada faqat xesh saqlanadi (scrypt + tuz);
  - kod logga va audit jurnaliga yozilmaydi;
  - 5 marta noto'g'ri kiritilsa — 5 daqiqa kutiladi;
  - kirish ruxsati foydalanuvchiga bog'langan va imzolangan, muddati o'tsa — yaroqsiz;
  - tekshiruv serverda: kodsiz so'rov rad etiladi.
- **API** (`/api/source-chat/`):
  - `pin/status`, `pin/unlock`, `pin` (`GET` / `PUT`);
  - kirish ruxsati `X-Chat-Token` sarlavhasida yuboriladi;
  - saqlash va yangi suhbat kodi `code` maydonida yoki `X-Chat-Code` sarlavhasida yuboriladi.

## Xavfsizlik — 1-bosqich

Audit natijasidagi 1-bosqich tuzatishlari. Baza tuzilmasi o'zgarmadi (migratsiya yo'q).

**Kirish va sessiyalar** (`modules/auth`):
- **Parol bilan kirish:** 5 marta xato parol — hisob 15 daqiqaga yopiladi, to'g'ri parol ham o'tmaydi. Muddat tugagach yoki to'g'ri kirilgach hisob tozalanadi. Har xato urinish tarixga yoziladi (parolning o'zi yozilmaydi).
- **Parol almashtirilganda:** boshqa qurilma va oynalardagi hamma sessiyalar yopiladi. Joriy oyna yangi token bilan ishlashda davom etadi.
- **«Chiqish»:** serverda ham sessiya yopiladi (`POST /api/auth/logout`). Token boshqa joyda saqlanib qolgan bo'lsa ham ishlamaydi. Bu shu foydalanuvchining hamma qurilmalaridan chiqaradi.

**Standart parol va kodlar.** Ular hammaga ma'lum, shuning uchun:
- **O'chirish paroli:** standart parol bilan ko'p yozuvni o'chirib bo'lmaydi. Avval Sozlamalar › Xavfsizlik'da yangi parol (6–32 belgi, oddiy ketma-ketlik emas) qo'yiladi.
- **Chat kodi:** yuqoridagi «Chat kodi» bo'limiga qarang.
- Administrator har sahifa tepasida sariq ogohlantirish ko'radi. U ikkalasi almashtirilganda yo'qoladi; «Keyinroq» bosilsa, shu oyna yopilguncha yashiriladi.

**Kuzatuvchi va shaxsiy ma'lumotlar** (Sozlamalar › Xavfsizlik):
- **Standart bo'yicha kuzatuvchiga yopiq:**
  - xodimlar ro'yxati, kartasi va Excel'i;
  - xodim ko'chishlari;
  - bo'lim va umumiy vedomost qatorlari (xodim bo'yicha), qo'shimcha xodimlar;
  - ish haqi tarkibi (oy ko'rinishi, xodim tarixi, Excel);
  - hududlar xodimlari va ish haqi;
  - oy natijalari (xodim bo'yicha);
  - xodimning tahlil kartasi.
- **Tuman va Markaz bo'limi tahlili ochiq**, lekin JShShIR yashiriladi (oxirgi 4 raqami qoladi), pasport, telefon va manzil olib tashlanadi.
- Umumiy summalar, hisobotlar va statistika (xodimlar soni, viloyatlar bo'yicha) ochiq.
- Administrator «Kuzatuvchiga ochish» tugmasi bilan hammasini ochishi mumkin. O'zgarish 30 soniyada kuchga kiradi va tarixga yoziladi.
- Administrator va ishchi rollarga (Hududchi va boshqalar) ta'sir qilmaydi.
- Kodda belgilash: `@Personal()` (yopiq), `@Personal('mask')` (yashirilgan), `@Personal(false)` (sinf belgisini bekor qilish).
- Sozlama `settings.security.viewerPersonal` da saqlanadi. API: `GET /api/security/status`, `PATCH /api/security/viewer-personal`.

**Bir vaqtdagi o'zgarishlar.**
- Bir bo'lim ichidagi yozuvchi so'rovlar (POST, PUT, PATCH, DELETE) navbat bilan bajariladi. Ikki kishi bir vaqtda saqlasa, birining o'zgarishi boshqasinikini o'chirmaydi.
- O'qish (GET) va boshqa bo'limlar kutmaydi.
- Xarajatlar siyosati yozuvi qaysi bo'limdan yozilmasin, alohida navbatda turadi.
- Navbatda 2 daqiqadan ko'p kutilsa — «band, qayta urinib ko'ring» xabari chiqadi.
- Navbat bitta API jarayoni ichida ishlaydi (hozirgi o'rnatish shunday). Bir nechta nusxa ishga tushirilsa, Postgres advisory lock'ga o'tish kerak (2-bosqich).
- Kod: `common/locks.ts`, `common/interceptors/serialize-writes.interceptor.ts`.

**Excel yuklashda «ZIP bomba» himoyasi** (`common/files/xlsx-guard.ts`):
- `.xlsx` ichi siqilgan arxiv. Kichik fayl ochilganda gigabaytlab bo'lib, serverni to'xtatishi mumkin.
- Har bir yuklashdan oldin (24 joy) fayl tekshiriladi:
  - ochilgandagi umumiy hajm 150 MB dan oshmasin; yozilgan hajm emas, haqiqiy ochib ko'rib tekshiriladi;
  - ichki qismlar 5 000 tadan oshmasin;
  - ZIP64, shifrlangan va noma'lum formatlar rad etiladi;
  - eski `.xls` va parolli fayl uchun aniq xabar chiqadi.
- Oddiy hisobot fayllari (ichida 0,2–3 MB) bu chegaralarga yaqinlashmaydi ham.

**Web xavfsizlik sarlavhalari** (`apps/web/next.config.ts`):
- `Content-Security-Policy`: skript va ma'lumot faqat o'z serveri va API'dan olinadi; tizimni boshqa sayt ichiga (iframe) joylab bo'lmaydi.
- `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` (kamera — faqat o'zi, imzo sahifasi uchun).
- API manzili `NEXT_PUBLIC_API_URL` dan olinadi. Mahalliy tarmoqdagi boshqa kompyuterlardan 3001-portga ulanish ham ruxsat etilgan.

**Boshqa tuzatishlar:**
- Chat kodi tokenining imzo kaliti endi birinchi ishlatilganda o'qiladi. Avval `.env` yuklanmasdan o'qilib, har ishga tushishda tasodifiy bo'lib qolardi.

**Testlar:** `test/t-security.js`. Unda:
- parol bilan kirishda bloklash;
- chiqish va parol almashganda tokenlar bekor bo'lishi;
- ZIP bomba (yolg'on sarlavha bilan ham) va 24 yuklash joyining hammasida tekshiruv borligi;
- 30 ta parallel o'zgarish yo'qolmasligi;
- kuzatuvchi uchun yopiq va yashirilgan marshrutlar.

`t-chat-pin`, `t-bulkdel-pass` va `t-unit-moves` yangi qoidalarga moslandi.


## Xavfsizlik va sifat — 2a-bosqich

Baza tuzilmasi o'zgarmadi (migratsiya yo'q). Mavjud ma'lumot qayta yozilmaydi. Yagona istisno — Telegram bot kaliti: APP_ENCRYPTION_KEY qo'yilsa, keyingi ishga tushishda shifrlanadi.

### Zaxirani shifrlash va ikkinchi joy

Sozlamalar › Zaxira. Serverdagi `.env`:

| O'zgaruvchi | Vazifasi |
|---|---|
| `BACKUP_ENCRYPTION_KEY` | Zaxira paroli (kamida 16 belgi). Qo'yilsa, yangi zaxira shifrlanadi. |
| `BACKUP_MIRROR_DIR` | Ikkinchi joy (boshqa disk yoki tarmoq papkasi). Tayyor zaxira u yerga ham nusxalanadi. |
| `APP_ENCRYPTION_KEY` | Bazadagi maxfiy kalitlar uchun (kamida 32 belgi). Hozircha Telegram bot kaliti. |

- **Qanday ishlaydi:** `pg_dump` natijasi oqimda siqiladi (gzip) va shifrlanadi (AES-256-GCM, har faylga alohida tuz). Fayl kengaytmasi: `.sql.gz.enc`.
- Ochiq SQL diskka umuman yozilmaydi.
- Har zaxira olingach, fayl to'liq ochib tekshiriladi. Xato bo'lsa, chala fayl o'chiriladi.
- Kalit qo'yilmasa, avvalgidek ochiq `.sql` olinadi. Administrator sariq ogohlantirish ko'radi.
- Eski zaxiralar 30 kundan keyin ikkala joydan ham o'chadi.
- **Tiklash** (API papkasida; kalit faqat muhit o'zgaruvchisidan olinadi, buyruq qatorida yozilmaydi):
  ```
  node scripts/backup-decrypt.js korxona_….sql.gz.enc --check
  node scripts/backup-decrypt.js korxona_….sql.gz.enc > zaxira.sql
  psql -U postgres -d korxona_tiklash -f zaxira.sql
  ```
- Skript mustaqil: build ham, kutubxona ham kerak emas.
- **Kalit yo'qolsa, zaxirani ochib bo'lmaydi.** Nusxasini server tashqarisida saqlang (parol menejeri, seyf).

### Telegram bot kaliti

- `APP_ENCRYPTION_KEY` bo'lsa, bot kaliti bazada shifrlangan holda saqlanadi.
- Eski ochiq qiymat ilova ishga tushganda o'zi shifrlanadi.
- Kalit almashtirilsa, bot ulanmaydi va «tokenni qayta kiriting» xabari chiqadi.

### Hujjat raqamlari

- Ariza, xarid, qabul, ombor hujjati va inventar raqamlari endi bazadagi qulf bilan beriladi (`pg_advisory_xact_lock`).
- Bir vaqtda kelgan so'rovlar navbat bilan raqam oladi. Raqamlar takrorlanmaydi va teshiksiz ketma-ket bo'ladi.
- Avval ko'p parallel so'rovda «raqam band» xatosi chiqishi mumkin edi. Haqiqiy PostgreSQL testida 20 ta bir vaqtdagi ariza bilan bu ko'rindi va tuzatildi.
- Ombor hujjati raqami endi son bo'yicha olinadi. Matn tartibi 10 000-hujjatdan keyin buzilardi.

### Bir vaqtdagi o'zgarishlar (qo'shimcha)

- Bo'lim xodimlari, ko'chishlar, bog'lash va ish haqi yuklashlari xizmat darajasida ham navbatda turadi (`@Exclusive`).
- Shuning uchun boshqa bo'limdan chaqirilganda ham yozuv yo'qolmaydi.
- Haqiqiy bazada tekshirildi: navbatsiz 10 ta parallel ko'chishdan faqat 1 tasi saqlanardi. Navbat bilan 10 tasi ham saqlanadi.

### settings bloklari tekshiruvi

- **Bloklar** (`common/settings/shape.ts`): bo'lim xodimlari, bog'lash, ko'chishlar, ish haqi yuklashlari, chat suhbatlari.
- **Buzilgan blok:** kutilgan ko'rinishda bo'lmasa (masalan, obyekt o'rniga massiv), amal to'xtaydi va bazadagi qiymat o'zgarmaydi. Avval kod uni «bo'sh» deb o'qib, ustidan yozib yuborardi.
- **Tanilmagan ko'chish yozuvlari** (masalan, olib tashlangan bo'lim kodi) endi yangi ko'chish saqlanganda jim o'chmaydi.

### Umumiy yordamchilar

- **Fayllar:** `common/period.ts` (oylar oralig'i, oy nomi), `common/money.ts` (so'm → tiyin), `common/excel/cells.ts` (Excel katagi).
- **Almashtirilgan nusxalar:**
  - ijara, kiritish, bank va bo'lim ish haqi yuklashlari;
  - ommaviy o'chirish va Hududchi ish stolidagi oylar oralig'i.
- **Bog'liqlik:** bo'lim modullari endi bir-biridan import qilmaydi.
- **Natijalar o'zgarmadi:** yangi funksiyalar avvalgi nusxalar bilan 120 mingdan ortiq tasodifiy qiymatda solishtirildi va aynan bir xil chiqdi (`test/t-common-helpers.js`).
- **Tegilmagan nusxalar:** xatti-harakati farq qiladiganlari (Excel formulasini boshqacha o'qiydiganlar, boshqa chegaralilar) o'z joyida qoldi.

### Tsikl ichidagi so'rovlar

- **Yaxlitlik tekshiruvi:** ish haqi yuklashlari bo'yicha bitta guruhlangan so'rov. Avval har yuklash uchun alohida so'rov edi.
- **Hudud natijalarini saqlash:** yopilgan oylar bitta so'rov bilan tekshiriladi.

### Testlar

- **Hammasi bitta buyruq bilan:** `node test/run-all.js` (avval API build). Natija: har test o'tdi / xato / o'tkazildi, oxirida jami.
- **Haqiqiy PostgreSQL testlari:** `test/pg/`. Faqat `TEST_DATABASE_URL` berilsa ishlaydi.
  - Baza nomida «test» bo'lishi shart, aks holda test to'xtaydi — ishlab chiqarish bazasiga tegmaydi.
  - Har test boshida test bazasi tozalanadi.
  - **pg-core:**
    - xom SQL (yaxlitlik, iqtisod jadvali, solishtirish);
    - parallel xato kirishlar;
    - 20 parallel ariza raqami;
    - parallel JSON yozuvlar;
    - ommaviy o'chirish tranzaksiyasi.
  - **pg-backup:** shifrlangan zaxira → ochish skripti → yangi bazaga tiklash → ma'lumot aslidek.
  - **Tayyorlash:** `TEST_DATABASE_URL=… pnpm --filter @korxona/db exec prisma db push --skip-generate`.
- **CI:** `.github/workflows/ci.yml`. Har push'da:
  - tiplar;
  - API build;
  - vaqtinchalik PostgreSQL bilan hamma testlar;
  - `pnpm audit` (faqat ogohlantirish).
- **Yangi testlar:** `t-backup-crypto`, `t-common-helpers`, `t-setting-shape`, `pg/pg-core`, `pg/pg-backup`.