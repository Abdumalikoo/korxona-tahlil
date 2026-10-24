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