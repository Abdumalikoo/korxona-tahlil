# Umumiy hisobot — metodika

Hisobot kaliti: `executive`. Nomi: **Umumiy hisobot**. Sozlamalar: `apps/api/src/modules/reports/general.config.ts`.
Asosiy qoida: **ma'lumot to'qilmaydi.** Manba yo'q bo'lsa — «Manba yo'q», hisoblab bo'lmasa — «Hisoblanmaydi», xato bo'lsa — «Xato». Hech qachon 0 bilan almashtirilmaydi.

## 1. Davr va parametrlar

| Parametr | Qiymatlar | Standart |
|---|---|---|
| Davr | ixtiyoriy `from…to` | oxirgi **yopilgan** oy; yopilgan oy bo'lmasa — oxirgi to'liq oy |
| Taqqoslash (`compare`) | `yoy` — o'tgan yilning shu davri; `prev` — o'tgan teng davr | `yoy` |
| Ko'rinish (`view`) | `short` — qisqa (PDF/PPTX ixcham); `full` — to'liq | `short` |

- O'tgan teng davr: davr butun oylardan iborat bo'lsa — **oylar soni** bo'yicha (masalan, 2-chorak → 1-chorak); aks holda kunlar bo'yicha.
- O'tgan yil: har ikki sana bir yil orqaga.

## 2. Pul va aniqlik

- Barcha summalar bazadagi `amountTiyin` (tiyin, `BigInt`) bo'yicha yig'iladi va ayiriladi. So'mga (`÷100`) va foizga faqat **ko'rsatishda** aylantiriladi.
- Foizlar 4 xona aniqlikda hisoblanadi, ko'rsatishda 1 xona.
- Biznes-reja summalari (mln so'm) tiyinga `× 10⁸` bilan o'tkaziladi.

## 3. Ko'rsatkichlar (Fakt)

| Ko'rsatkich | Formula | Hisoblanmaydi, agar |
|---|---|---|
| Daromad (D) | Σ daromad yozuvlari (davr ichida) | — (yozuv yo'q → 0 va «yozuvlar yo'q» belgisi) |
| Xarajat (X) | Σ xarajat yozuvlari | — |
| Natija (N) | D − X | — |
| Rentabellik | N ÷ D × 100 | D = 0 |
| O'zgarish, % | (joriy − baza) ÷ baza × 100 | baza yo'q, baza = 0 yoki **baza ≤ 0** |
| O'zgarish, so'm | joriy − baza | baza davrida yozuv yo'q |

Manfiy bazaga nisbatan foiz chalg'ituvchi bo'lgani uchun faqat so'mdagi farq ko'rsatiladi.

## 4. Reja–fakt (Reja)

| Manba | Qachon ishlatiladi | Qoida |
|---|---|---|
| Biznes-reja (`BplanService.report(yil, chorak, 'quarter')`) | Davr **to'liq choraklardan** iborat bo'lsa | Har chorak alohida olinadi va yig'iladi. Fakt — biznes-reja modulining o'z moddalar xaritasi bo'yicha (asosiy faktdan farq qilishi mumkin — izohda ko'rsatiladi) |
| Hudud uchun reja (`HpPlanVersion`, holati APPROVED) | Har oy uchun eng oxirgi tasdiqlangan versiya | Versiya raqami va tasdiqlangan sana jadvalda ko'rsatiladi |

- Bajarilish = Fakt ÷ Reja × 100; Farq = Fakt − Reja.
- Reja = 0 → «Hisoblanmaydi»; reja yo'q → «Manba yo'q».
- Oylik yoki ixtiyoriy davr uchun choraklik reja **bo'linmaydi** (oylik reja to'qilmaydi).

## 5. Prognoz va xavf

- Yil oxiri prognozi va 3 oylik zarar ehtimoli tahlil xizmatidan `asOf` = davrning oxirgi to'liq oyi bilan so'raladi — o'tgan davr hisobotiga keyingi ma'lumot aralashmaydi.
- Prognoz har doim «Bu prognoz, haqiqiy natija emas» deb belgilanadi va faktdan alohida guruhda.
- Ishonchlilik: model xatosi (WAPE) ko'rsatiladi; WAPE > 20% → ogohlantirish.

## 6. O'zgarish sabablari

- Daromad — **xizmat turi** (kategoriya kodi), xarajat — **modda** (eng quyi daraja). Darajalar aralashtirilmaydi.
- Ta'sir: daromad uchun `+Δ`, xarajat uchun `−Δ`.
- **Tekshiruv:** Σ ta'sir = N(joriy) − N(baza). Jadvalda eng katta 8 ta (modul bo'yicha) + «Qolganlari» + «Jami» qatori.

## 7. Hududlar va Markaz

- Birliklar: har bir faol hudud, **Markaz** (alohida), **Biriktirilmagan**. Hududlar + Markaz + Biriktirilmagan = korxona jami (ikki marta hisob yo'q).
- **Uchta mustaqil reyting**, umumiy ball yo'q:
  1. Natija (so'm);
  2. Rentabellik (%) — daromad 0 bo'lsa reytingga kirmaydi;
  3. Bir xodimga natija = N ÷ o'rtacha xodim soni (oyma-oy o'rtacha); xodim 0 → kirmaydi.
- Teng qiymatlar bir xil o'rin oladi (1, 2, 2, 4…). Ma'lumoti qisman hudud `*` bilan belgilanadi.
- **Markazni qoplash** (asosiy) = Σ hududlar natijasi ÷ Markaz **sof** xarajati (Markaz xarajati − Markaz o'z daromadi) × 100 — tizimdagi «Solishtirma» bilan bir xil.
  Qo'shimcha: ÷ Markaz yalpi xarajati. Markaz xarajati 0 → «Hisoblanmaydi».

## 8. Xavflar va tavsiyalar

Har bir xavf: ustuvorlik, shart, dalil, nimaga taalluqli, tavsiya, mas'ul, muddat, tekshirish usuli. Bir xil kalitli xavflar birlashtiriladi (dalillar qo'shiladi). Saralash: ustuvorlik, so'ng summa ta'siri. Xulosada ko'pi bilan **5 ta**, to'liq ro'yxat Excelda.

| Kalit | Ustuvorlik | Shart |
|---|---|---|
| loss-regions | 1 — yuqori | Hudud natijasi < 0 |
| loss-probability | 1 | 3 oylik zarar ehtimoli ≥ 70% |
| controls | 1 | Nazoratdagi modda chegarani buzgan (davr oxirigacha yaratilgan nazoratlar) |
| alert:… | 1 | Yuqori darajali avtomatik ogohlantirish (faqat davr joriy tekshiruv oyi bo'lsa) |
| plan-company | 2 — o'rta | Biznes-reja bajarilishi < 90% |
| plan-regions | 2 | Hudud rejasi bajarilishi < 90% |
| expense-growth | 2 | Xarajat o'sishi > 10% |
| income-drop | 2 | Daromad pasayishi > 10% |
| overdue-reactions | 2 | Munosabat ochiq va muddati davr oxirida o'tgan |
| data-quality | 2 | Hisobot bermagan hudud, yopilmagan oy yoki takroriy yozuv |
| forecast-error | 3 — past | WAPE > 20% |

- **Mas'ul va muddat** faqat mavjud Munosabatlardan (shu hudud yoki modda bo'yicha ochiq) olinadi. Topilmasa: «Mas'ul tayinlanishi kerak», «Muddat rahbar tomonidan belgilanadi». Tizim o'zi mas'ul tayinlamaydi.

## 9. Tarixiy holat

- Munosabatlar davr oxiridagi holatga `createdAt`, `closedAt`, `dueDate` orqali tiklanadi; o'zgarishlar tarixi saqlanmagani uchun holat «Qisman».
- Nazorat: faqat davr oxirigacha yaratilganlari.
- Avtomatik ogohlantirishlar tarixi saqlanmaydi → o'tgan davr uchun «Tanlangan davr uchun tarixiy holat mavjud emas».

## 10. Ma'lumot holati

| Holat | Ma'nosi |
|---|---|
| To'liq | Manba bor, barcha oylar yopilgan, barcha hududlar hisobot bergan |
| Qisman | Joriy oy tugamagan, oy yopilmagan, hudud hisobot bermagan yoki tarix tiklangan |
| Manba yo'q | Reja/prognoz kiritilmagan |
| Hisoblanmaydi | Maxraj 0 yoki manfiy baza |
| Xato | Manbani o'qishda xato (sababi jurnalga yoziladi, hisobot to'xtamaydi) |

Takroriy yozuvlar: bir xil sana, birlik, modda, summa va manba — ogohlantirish (o'chirilmaydi).

## 11. Xulosalar va grafiklar

- 4–6 jumla, faqat mavjud qiymatlardan: natija va o'zgarish; reja bajarilishi; eng yaxshi/eng zaif hudud; prognoz (belgilangan); xavflar soni; ma'lumot to'liqligi.
- Grafiklar ko'pi bilan 3: 12 oylik dinamika, reja–fakt, hududlar natijasi.

## 12. Rahbariyat tasdig'i kerak

1. Chegaralar 90 / 10 / 10 / 70 / 20 — boshlang'ich qiymatlar, korxona normativi emas.
2. Markazni qoplash — sof (hozir asosiy) yoki yalpi xarajatga nisbatan.
3. Reyting metodikasi — uchta mustaqil reyting yetarlimi, «bir xodimga» uchun o'rtacha xodim soni to'g'rimi.
4. Biznes-reja fakti bilan asosiy fakt farqi — qaysi biri rasmiy.
5. Oylik reja manbasi — kompaniya darajasida oylik reja kiritilishi kerakmi.