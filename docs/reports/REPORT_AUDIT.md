# Umumiy hisobot — audit (avvalgi «Rahbariyat uchun qisqa hisobot»)

Sana: 2026-10-22. Asos: `apps/api/src/modules/reports/report.executive.ts` (eski versiya), `reports.data.ts`, `reports.service.ts`, `render.*.ts`, `bplan`, `econ`, `reactions`, `alerts`, `hudud-reja` modullari.
Tekshiruv ishlab chiqish nusxasida (kod mirrori) bajarildi; kompyuteringizdagi Git holati va haqiqiy baza bu muhitdan ko'rinmadi.

## 1. Mavjud implementatsiya (o'zgarishdan oldin)

| Qism | Qanday edi | Fayl |
|---|---|---|
| Ma'lumot | Daromad va xarajat yozuvlari sana bo'yicha; summa `Number(amountTiyin)/100` (so'm, float) | `reports.data.ts › rows()` |
| Taqqoslash | Faqat o'tgan teng davr (kunlar soni bo'yicha) | `report.executive.ts › previousRange` |
| KPI | Daromad, xarajat, foyda, rentabellik; yil prognozi; zarar ehtimoli; munosabat; nazorat | `report.executive.ts` 1-bo'lim |
| Sabablar | Daromad — xizmat turi, xarajat — **guruh** (ildiz modda) — darajalar aralash | `byExpenseGroup` |
| Hududlar | Mutlaq natija (so'm) bo'yicha top-3 / oxirgi-3 | 4-bo'lim |
| Xavf/tavsiya | Erkin matn, qoidalar kod ichida, mas'ul va muddat yo'q | 5–6-bo'limlar |
| Prognoz | `econ.forecast(horizon 3)` — **bugungi holatda**, davrdan qat'i nazar | `Promise.all(...)` |
| Formatlar | Bitta hujjat → Excel/PPTX/PDF; Excel varaqlari bo'lim nomlaridan | `render.*.ts` |

## 2. Aniqlangan muammolar (dalil bilan)

| № | Muammo | Dalil | Ta'sir |
|---|---|---|---|
| 1 | Reja–fakt yo'q | Eski `report.executive.ts` biznes-reja (`BplanService`) va `HpPlanVersion`dan foydalanmaydi | Rahbar «reja bajarildimi?» savoliga javob olmaydi |
| 2 | O'tgan yilning shu davri bilan taqqoslash yo'q | Faqat `previousRange` | Mavsumiylik hisobga olinmaydi |
| 3 | O'tgan teng davr kunlar bo'yicha | `previousRange(2025-04-01…06-30)` = `2024-12-31…2025-03-31` | Chorak/oy davrlarida bazaga bir kun ortiqcha kiradi |
| 4 | Prognoz va risk o'tgan davr hisobotida ham bugungi holatda | `econ.forecast({...})` `asOf` siz | O'tgan davr hisobotida kelajak ma'lumoti aralashadi |
| 5 | Munosabat va Nazorat — bugungi holat | `reactions.list()`, `controls.list()` filtrsiz | O'tgan davr hisobotida bugungi holat ko'chiriladi |
| 6 | Manba xatosi yashirinadi | `.catch(() => null)` → karta «—», sababi yozilmaydi | Rahbar ma'lumot yo'qligini bilmaydi |
| 7 | Hududlar faqat mutlaq natija bo'yicha | `sort((a, b) => b.r - a.r)` | Katta hudud doim tepada; samaradorlik ko'rinmaydi |
| 8 | Markaz va qoplash ko'rsatilmaydi | 4-bo'limda faqat `r:` birliklar | Markaz xarajati va hududlar hissasi ko'rinmaydi |
| 9 | «Nima o'zgardi» darajalari aralash | daromad `categoryCode`, xarajat `expenseGroup` | Turli darajalar bir jadvalda |
| 10 | Pul float'da yig'iladi | `amount: Number(r.amountTiyin) / 100` | Juda katta summalarda aniqlik yo'qolishi mumkin |
| 11 | Ma'lumot to'liqligi ko'rsatilmaydi | Yopilgan oylar (`RegionalPeriodClose`) va hisobot bermagan hududlar ishlatilmaydi | Qisman ma'lumotdan to'liq xulosa |
| 12 | Chegaralar kod ichida | `>= 0.2`, `* 0.3` kabi sonlar | O'zgartirish va hujjatlash qiyin |
| 13 | Tavsiyada mas'ul/muddat yo'q | 6-bo'lim | Ijroni nazorat qilib bo'lmaydi |

## 3. Moslik va xavflar

- Tur kaliti `executive` saqlandi — hisobotlar tarixi va havolalar buzilmaydi; faqat nom «Umumiy hisobot».
- `reports.data.ts › Row` ga `tiyin: bigint` **qo'shildi** (mavjud `amount` qoldi) — boshqa 10 hisobot o'zgarishsiz.
- `reports.types.ts` ga ixtiyoriy maydonlar qo'shildi (`formats`, `sheet`, `coverSheet`, `ownMethodology`, `options`) — eski hisobotlar ularsiz avvalgidek.
- `BplanModule` endi `BplanService` ni eksport qiladi (faqat qo'shimcha).
- Baza sxemasi o'zgarmadi, migratsiya yo'q.
- Biznes-reja choraklik bo'lgani uchun oylik/ixtiyoriy davrda kompaniya reja–fakt foizi chiqmaydi (ataylab — to'qilmaydi).
- **Spetsifikatsiyadan farq:** «Markazni qoplash» spetsifikatsiyada `hududlar natijasi ÷ Markaz xarajati`; tizimdagi Solishtirma esa `÷ Markaz sof xarajati (xarajat − o'z daromadi)`. Asosiy ko'rsatkich Solishtirma bilan bir xil qoldirildi, yalpi variant qo'shimcha ko'rsatiladi. **Rahbariyat tasdig'i kerak.**