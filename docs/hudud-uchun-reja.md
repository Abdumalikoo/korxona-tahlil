# Hudud uchun reja — texnik hujjat

Kelasi oy uchun statistik prognoz: hududlar, 39 xizmat va xodimlar kesimida. Modul mavjud modullarni o'zgartirmaydi — faqat yangi jadvallar, yangi API va yangi sahifalar qo'shadi.

## 1. Arxitektura

| Qatlam | Joy | Vazifa |
|---|---|---|
| Statistika (Python, FastAPI) | `apps/analytics/app/plan/` | Modellar, tarixiy test, model tanlash, daromad = soni × tarif, hudud yig'indisi, xodimlarga taqsimlash. Holatsiz: kirish JSON → natija JSON |
| API (NestJS) | `apps/api/src/modules/hudud-reja/` | Excel shablonlari va import (ExcelJS), ma'lumotlarni yig'ish, Python'ga yuborish, natijani saqlash, tasdiqlash/versiyalar, eksport |
| Baza (Prisma) | `packages/db/prisma/schema.prisma` | 7 ta yangi jadval (`hp_*`) |
| Interfeys (Next.js) | `apps/web/src/app/(dashboard)/hudud-reja/`, `apps/web/src/features/hudud-reja/` | 6 sahifa + hudud sahifasi |

Oqim: Excel → `POST /api/hudud-reja/imports/check` (tekshiruv, bazaga yozilmaydi) → `…/confirm` (tranzaksiyada yoziladi) → `POST /api/hudud-reja/runs` (fon rejimida Python `POST /plan/compute`) → natija `hp_runs.result` → tasdiqlash `hp_plan_versions`.

## 2. Ma'lumot manbalari

* **Dasturdagi** — Hududlar tushumi (`Income`: `regionCode`, `categoryCode` = SRV_xx, `quantity`, summa).
* **Yuklangan** — `hp_stats` (Daromad_Tarixi varag'i).
* **Birlashtirilgan** (standart) — ikkalasi; bir xil oy × hudud × xizmat bo'lsa yuklangani ustun.
* Xizmatlar — mavjud `IncomeCategory` (SRV_01…SRV_39), tariflar — mavjud `ServiceTariff` (APPROVED, `validFrom`, hududiy tarif ustun).
* Xodimlar — mavjud `Employee` (JShShIR = `xodim_id`), `EmployeeResult` (oylik jami), yuklangan `hp_emp_months`, `hp_emp_services`.

**Bo'sh oy qoidasi:** hudud shu oyda umuman hisobot bermagan bo'lsa — «ma'lumot yo'q» (NaN), nol emas. Hisobot bergan, lekin xizmat yo'q bo'lsa — 0.

## 3. Jadvallar

| Jadval | Kalit (unikal) | Mazmuni |
|---|---|---|
| `hp_stats` | oy, hudud, xizmat | soni, tarif, daromad, reja (tiyin), manba, izoh, import ID |
| `hp_emp_months` | oy, xodim | hudud, ishlangan kun, soat, ta'til, jami, reja, faollik |
| `hp_emp_services` | oy, hudud, xodim, xizmat | soni, tarif, daromad |
| `hp_region_factors` | oy, hudud | faol tadbirkorlar, xodimlar soni, ish kunlari, faol xodimlar |
| `hp_imports` | — | import sessiyasi: fayl xeshi, holat CHECKED/IMPORTED/CANCELLED, xulosa, xatolar, payload |
| `hp_runs` | — | hisob: parametrlar va ularning xeshi, ma'lumot xeshi, holat RUNNING/DONE/FAILED, natija, qo'lda tuzatishlar |
| `hp_plan_versions` | oy, hudud, versiya | tasdiqlangan reja: APPROVED/SUPERSEDED, summalar, to'liq nusxa, kim/qachon, tiklangan manba |

Pul — tiyinda (BigInt), API'da so'mda. Mavjud jadvallarga **tashqi kalit qo'yilmagan** (mavjud modellar o'zgarmasligi uchun) — bog'lanish kodlar orqali (hudud kodi, xizmat kodi, JShShIR) va importda tekshiriladi.

Migratsiya: `scripts\db-migrate.ps1 -Name hudud_reja` (migratsiyalar bo'lsa), aks holda `prisma db push`. O'rnatish skripti xato bo'lsa sxemani qaytaradi.

## 4. API

Ko'rish — ADMIN va VIEWER; yozish (import, hisoblash, biriktirish, tasdiqlash, tiklash) — faqat ADMIN.

| Metod | Yo'l | Vazifa |
|---|---|---|
| GET | `/hudud-reja/kinds` | Shablon turlari va ustunlari |
| GET | `/hudud-reja/templates/:kind?fill=1` | Shablon (`ALL` — barchasi bitta faylda; `fill=1` — mavjud yozuvlar bilan) |
| GET | `/hudud-reja/data/status` | Har tur bo'yicha yozuvlar soni, davr, so'nggi import |
| POST | `/hudud-reja/imports/check?kind=` | Faylni tekshirish (multipart `file`) |
| GET | `/hudud-reja/imports`, `/imports/:id` | Tarix, sessiya (xatolar, oldindan ko'rish) |
| POST | `/hudud-reja/imports/:id/confirm` | `{ policy: upsert|insert, excludeRows: [] }` |
| POST | `/hudud-reja/imports/:id/cancel` | Bekor qilish |
| GET | `/hudud-reja/overview?target=&region=&runId=` | Dashboard |
| GET | `/hudud-reja/quality?target=` | Ma'lumotlar sifati |
| POST | `/hudud-reja/precheck` | Hisobdan oldingi tekshiruv |
| POST | `/hudud-reja/runs` | Hisoblash (idempotent: parametr + ma'lumot xeshi) |
| GET | `/hudud-reja/runs?target=`, `/runs/:id` | Hisoblar, holat |
| GET | `/runs/:id/regions`, `/services?region=`, `/series?region=&service=`, `/employees?region=` | Natijalar |
| POST / DELETE | `/runs/:id/assign`, `/runs/:id/assign/:index` | Taqsimlanmaganni xodimga biriktirish / bekor qilish |
| POST | `/runs/:id/approve` | `{ regions: [], note }` — yangi versiya |
| GET | `/runs/:id/export?kind=regions|services|employees|full` | Excel A, B, C, D |
| GET | `/plans?target=`, `/plans/:id` | Versiyalar |
| PATCH | `/plans/:id/restore` | Eski versiyani tiklash (yangi versiya sifatida) |

Python: `GET /plan/models`, `POST /plan/compute` (X-Analytics-Key).

## 5. Shablonlar va import

Varaqlar: `Yo'riqnoma`, `Daromad_Tarixi` (majburiy), `Xodimlar_Tarixi`, `Xodim_Xizmatlari`, `Hudud_Omillari`, `Xizmatlar`, ma'lumotnomalar `Hududlar`, `Xizmat_royxati`, `Xodimlar`. Majburiy ustunlar sarg'ish, ro'yxatli ustunlarda tanlov. Kulrang **NAMUNA** qatorlari hech qachon import qilinmaydi.

Tekshiruvlar: faqat `.xlsx` (makrosiz), 10 MB; varaq turini nomi/sarlavhasi bo'yicha aniqlash; majburiy ustunlar; tur (oy YYYY-MM, son, sana, ha/yo'q); manfiy son; noma'lum hudud/xizmat/xodim; kelajak oy; fayl ichidagi dublikat (ikkala qator xato); soni × tarif ≠ daromad (ogohlantirish); katalog tarifidan farq; xizmat nomi farqi (nom o'zgartirilmaydi); xodim hudud o'zgarishi; yetishmayotgan oylar; dasturdagi tushum bilan jami farqi; xodim xizmatlari yig'indisi hudud jamidan oshishi; shu fayl avval import qilinganmi. Bazadagi bilan solishtirish: yangi / yangilanadi / o'zgarmagan. Xato qatorlar import qilinmaydi; qolganlari bitta tranzaksiyada yoziladi. Qayta yuklash dublikat yaratmaydi.

## 6. Modellar (1 oy oldinga)

| Kod | Model | Formula / shart |
|---|---|---|
| naive | O'tgan oy | Q̂ₜ₊₁ = Qₜ |
| ma3 | 3 oylik o'rtacha | (Qₜ + Qₜ₋₁ + Qₜ₋₂)/3, uchta to'liq oy kerak |
| snaive | Mavsumiy naive | Q̂ₜ₊₁ = Qₜ₋₁₁, 12+ oy |
| ses | Eksponensial tekislash | ℓₜ = αQₜ + (1−α)ℓₜ₋₁; 4+ uzluksiz oy |
| holt | Holt trend | ℓ, b; ŷ = ℓ + b; 6+ oy |
| hw | Additiv Holt-Winters | trend + 12 oylik mavsum; 24+ uzluksiz oy |
| croston / sba | Uzlukli talab | z/p (SBA × (1−α/2)); faqat nol oylar ≥ 30% bo'lsa |

Parametrlar (α, β, γ) o'quv qatoridagi bir qadamli xatolar kvadrati yig'indisi bo'yicha belgilangan to'rdan tanlanadi — tasodifiylik yo'q, natija takrorlanadi. Uzlukli qatorga Holt/HW, uzluksizga Croston/SBA qo'llanmaydi. Prognoz manfiy bo'lmaydi.

**Tarixiy test (rolling origin):** oxirgi N oyning (3–12, standart 6) har biri uchun model faqat o'sha oydan oldingi ma'lumotda o'qitiladi va bir oy oldinga prognoz qilinadi — kelajak ma'lumoti ishlatilmaydi. Metrikalar: MAE, RMSE, WAPE = Σ|xato| / Σ haqiqiy (Σ haqiqiy = 0 bo'lsa — aniqlanmagan), siljish.

**Tanlov:** barcha nomzodlar bir xil test oylarida solishtiriladi; eng kichik WAPE; farq 2 foiz punkt ichida bo'lsa soddarog'i. Ishonchlilik: yuqori ≤ 15% (kamida 4 test oyi), o'rta ≤ 30%, past > 30%, aniqlanmagan — test yo'q. 80% oraliq faqat kamida 6 ta test xatosi bo'lsa (xatolar kvantillari).

**Daromad:** Q̂ (butun songa yaxlitlanadi, sozlamada o'chirish mumkin) × prognoz oyidagi amaldagi tarif (hududiy tarif ustun; katalogda bo'lmasa — tarixdagi daromad/soni, belgilanadi). Hudud = xizmatlar yig'indisi; jami = hududlar yig'indisi. Tarixdagi daromad formulaga almashtirilmaydi — farq faqat ko'rsatiladi. Keskin qiymatlar (robust z > 4) o'chirilmaydi, faqat belgilanadi.

## 7. Xodimlarga taqsimlash

* Ulush oynasi: oxirgi 3/6/12 oy. Har xizmat bo'yicha xodimning tarixiy daromad ulushi.
* «Ish kunlariga mutanosib»: bir kunlik natija × rejadagi ish kunlari (kelasi oy qatori jadvaldan; bo'lmasa oy ish kunlari × odatiy ulush; bo'lmasa o'rtacha). Kunlar yo'q bo'lsa — ulushga qaytiladi (izohlanadi).
* Yangi xodim: shu lavozimdagi (kamida 2 kishi bo'lsa) o'xshash xodimlarning bir kunlik median natijasi × rejadagi kunlar.
* Ishdan ketgan / boshqa hududga o'tgan xodim rejaga kirmaydi.
* Hech kim ko'rsatmagan xizmat — «taqsimlanmagan» (sababi bilan). Administrator uni qo'lda biriktiradi; hudud yig'indisi saqlanadi.
* Xodim × xizmat ma'lumoti bo'lmasa — jami daromad bo'yicha taqsimlanadi.
* Yaxlitlash eng katta qoldiq usulida: xodimlar + taqsimlanmagan = hudud prognozi (farq ≠ 0 bo'lsa tasdiqlanmaydi).

## 8. Holatlar va versiyalar

Hisob natijasi — «Hisoblangan». Tasdiqlash hudud bo'yicha yangi versiya yaratadi, oldingisi «Almashtirilgan». Qayta hisoblash tasdiqlangan rejani o'chirmaydi (hudud «Boshqa hisob tasdiqlangan» deb ko'rinadi). Eski versiya tiklansa — yangi versiya sifatida. Hamma amal Audit jurnaliga yoziladi. Bir xil parametr va bir xil ma'lumot bilan qayta hisoblash yangi hisob yaratmaydi; 15 daqiqadan ko'p «hisoblanmoqda» holatidagi hisob — xato deb belgilanadi.

## 9. Sahifalar

Dashboard · Ma'lumotlarni yuklash · Prognozlash · Hududlar bo'yicha reja (+ har hudud sahifasi) · Xizmatlar bo'yicha reja (model taqqoslash oynasi) · Xodimlar bo'yicha reja. Prognoz oyi `?period=` orqali bo'limlar orasida saqlanadi. Ma'lumot yetarli bo'lmasa — «Ma'lumot yetarli emas» yoziladi, soxta raqam ko'rsatilmaydi.

## 10. Testlar

* Python: `apps\analytics> .venv\Scripts\python -m unittest test_plan -v` — 17 test: modellar formulasi, statsmodels bilan solishtirish (SES/Holt/HW), tarixiy testda ma'lumot sizmasligi, WAPE nol holati, deterministiklik, hudud = xizmatlar yig'indisi, taqsimlash yig'indisi, yangi va ketgan xodimlar.
* API e2e (ishlab chiqish muhitida, sun'iy ma'lumot bilan): shablonlar, NAMUNA, xato qatorlar raqami bilan, dublikat, qayta import, siyosatlar, bekor qilish, Python bilan hisob, idempotentlik, yig'indilar, taqsimlash, biriktirish, tasdiqlash/versiya/tiklash, 4 xil eksport (eksport summasi = hisob), dashboard va sifat.
* Interfeys: 6 sahifa haqiqiy hisob natijasidan olingan ma'lumot bilan ko'rib chiqilgan.

## 11. Cheklovlar

* Hudud bo'yicha foydalanuvchi cheklovi yo'q (foydalanuvchida hudud maydoni yo'q) — ko'rish ADMIN/VIEWER, yozish ADMIN.
* Mavjud jadvallarga tashqi kalit yo'q (yuqoriga qarang).
* Excel import/eksport NestJS'da (ExcelJS); Python faqat hisoblaydi.
* Model tanlovi ham, aniqlik bahosi ham bir xil test oylarida — baho biroz optimistik bo'lishi mumkin (sahifada yozilgan).
* Prognoz faqat 1 oy oldinga (kelasi oy; o'tgan oylarni tekshiruv uchun hisoblash mumkin).
* Python xizmati ishlamasa hisob «xato» holatiga o'tadi, oldingi natijalar o'zgarmaydi.