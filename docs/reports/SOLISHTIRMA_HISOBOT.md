# Solishtirma — to'liq hisobot (Excel)

Hisobot kaliti: `solishtirma`. Hisobotlar › Hududlar guruhi. Format: faqat Excel.
Sozlamalar: **Taqqoslash** (o'tgan teng davr / o'tgan yilning shu davri), **Yozuvlar** (hammasi / doimiy / bir martalik).

## Asosiy qoida

Raqamlar Solishtirma sahifasi ishlatadigan xizmatlarning o'zidan olinadi. Alohida hisob yo'q, shuning uchun hisobot va sahifadagi raqamlar bir xil chiqadi:
`RegionsService` (hududlar, Markaz, biriktirilmagan va sohalar kesimi), `DistrictsService` (tumanlar, xizmatlar, xodimlar, xodim oylari), `CenterService` (Markaz bo'limlari), `UnassignedService`, `ChangesService`.

## Varaqlar

| Varaq | Mazmuni |
|---|---|
| Xulosa | Sarlavha, davr, asosiy ko'rsatkichlar, Solishtirma xulosalari |
| Ko'rsatkichlar | Korxona jami, hududlar natijasi, Markaz sof xarajati, qoplash, xulosalar |
| **Hududlar** (ichma-ich) | Hudud → daromad (xizmat turlari), xarajat (modda guruhi → modda), tumanlar → tuman → xizmatlar / xarajat tarkibi / xodimlar. Markaz → daromad manbalari, bo'limlar → moddalar / xodimlar, hududlar uchun to'langan → qaysi hudud uchun, asosiy vositalar sarfi. Biriktirilmagan → turlari, moddalari, manbasi |
| **Sohalar** (ichma-ich) | DAROMAD → xizmat turi → hudud → tuman; XARAJAT → modda guruhi → modda → hudud; NATIJA |
| Daromad_matritsa | Xizmat turi × hudud (filtrli) |
| Xarajat_matritsa | Modda × hudud, «Markaz hisobidan» belgisi bilan |
| Hududlar_jadval | Har bir birlik: daromad, xarajat, ish haqi, natija, rentabellik, o'tgan davr, xodimlar, bir xodimga, yozuvlar soni |
| Tumanlar | Barcha tumanlar: daromad (shundan taqsimlangan), soni, xarajat (ish haqi, ijara, boshqa), natija, xodimlar, reja/fakt |
| Xizmatlar | Hudud, tuman, xizmat turi: soni, summa, o'rtacha narx |
| Xarajat_tarkibi | Tuman va Markaz bo'limlari moddalari |
| Xodimlar | Hudud/Markaz, tuman/bo'lim, F.I.Sh., lavozim, ish haqi, oylar, reja, fakt, bonus |
| Xodimlar_oylar | Har xodimning har oyi: qayerda ishlagani, ish haqi, reja, fakt, bonus |
| Oylar | 24 oy: har birlik natijasi, ichida daromad va xarajat |
| Markaz | Markaz jami, bo'limlar, hududlar uchun to'langan, 12 oy |
| Biriktirilmagan | Oylar, turlar, moddalar, manbalar, fayllar, yozuvlar |
| Xodimlar_harakati | Oy → birlik: ishga olindi, qaytdi, bo'shatildi, ishlamadi, ko'chdi; xodimlar ro'yxati |
| Tekshiruv | Jamilar mosligi tiyingacha (birliklar = sohalar; hudud = tumanlar yig'indisi; Markaz; biriktirilmagan) va manbalar holati |
| Metodika | Har bir ko'rsatkich qanday hisoblangani |

## Ichma-ich (Excel)

- Qatorlar Excel'ning guruhlash funksiyasi bilan guruhlangan. Chapdagi [+] ichkariga kiradi, [−] yopadi.
- Yuqori chapdagi 1, 2, 3 … tugmalari shu darajagacha hammasini ochadi.
- Fayl ochilganda faqat yuqori daraja ko'rinadi. «Sohalar» varag'ida xizmat turlari va modda guruhlari ham ko'rinadi.
- Sarlavha qatori va birinchi ustun qotirilgan. Tekis ro'yxatlarda avtofiltr bor.
- Ichma-ich jadvalning «JAMI» qatori faqat yuqori daraja qatorlaridan yig'iladi. Ichki qatorlar shu qatorning tarkibi bo'lgani uchun bir summa ikki marta qo'shilmaydi.

## Ekranda

Hisobotlar sahifasida ichma-ich jadval bosib ochiladi, «Hammasini ochish» va «Yopish» tugmalari bor.
Juda katta jadvallarda ekranda 400 tagacha qator ko'rsatiladi. Ichma-ich jadvalning yuqori ikki darajasi esa doim to'liq chiqadi. To'liq ro'yxat Excel faylida.

## Qoidalar

- O'zgarish foizi faqat o'tgan davr qiymati musbat bo'lsa ko'rsatiladi. Rentabellik faqat daromad musbat bo'lsa hisoblanadi.
- Pul tiyinda (butun son) yig'iladi, jadvalda so'mda ko'rsatiladi.
- Shaxsiy identifikator (JShShIR) faylga chiqarilmaydi, faqat F.I.Sh. va lavozim.
- Biror manba (masalan, Markaz tafsiloti) o'qilmasa, hisobot to'xtamaydi: «Tekshiruv» varag'ida «Xato» deb, sababi bilan ko'rsatiladi.

## O'zgargan fayllar

| Fayl | O'zgarish |
|---|---|
| `apps/api/src/modules/structure/regions.service.ts` | `full()` qo'shildi (Solishtirma + sohalar kesimi bitta hisobdan). `compare()` avvalgidek ishlaydi |
| `apps/api/src/modules/structure/districts.service.ts` | `regionFull()` (viloyat + barcha tumanlar tafsiloti, bitta yig'ishdan) va `employeesMonths()` qo'shildi. Tuman tafsiloti umumiy `detailOf()` ga ajratildi, natijalar avvalgidek |
| `apps/api/src/modules/structure/center.service.ts` | `full()` qo'shildi (moddalar cheklovsiz). Sahifa uchun avvalgidek 12 ta + «Boshqalar» |
| `apps/api/src/modules/structure/structure.module.ts` | `ChangesService`, `UnassignedService` eksporti |
| `apps/api/src/modules/reports/report.solishtirma.ts` | Yangi hisobot |
| `apps/api/src/modules/reports/reports.types.ts` | Jadvalga `levels`, `openLevels`, `freeze`, `filter` (ixtiyoriy) qo'shildi |
| `apps/api/src/modules/reports/render.excel.ts` | Guruhlash, chekinish, qotirish, avtofiltr. Ichma-ich jadvalda jami formulalari qo'yilmaydi |
| `apps/api/src/modules/reports/reports.service.ts` | Katalog, ekran uchun katta jadvallarni qisqartirish |
| `apps/api/src/modules/reports/reports.module.ts` | Provayder |
| `apps/web/src/features/reports/api.ts`, `report-view.tsx` | Ichma-ich jadvalni ekranda ochish/yopish |

Baza sxemasi o'zgarmaydi.