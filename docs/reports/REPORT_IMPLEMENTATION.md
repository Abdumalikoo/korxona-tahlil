# Umumiy hisobot — implementatsiya

Sana: 2026-10-22. Paket: `umumiy-hisobot.ps1`. Baza sxemasi o'zgarmaydi, migratsiya yo'q.

## 1. O'zgargan fayllar

| Fayl | Holat | Mazmuni |
|---|---|---|
| `apps/api/src/modules/reports/general.config.ts` | yangi | Chegaralar, holatlar, taqqoslash turlari, «mas'ul/muddat yo'q» matnlari |
| `apps/api/src/modules/reports/general.calc.ts` | yangi | Sof hisoblash (BigInt): jamlar, taqqoslash, sabablar, hududlar, reyting, qoplash, reja–fakt, to'liqlik, takrorlar, xavflar, xulosalar |
| `apps/api/src/modules/reports/general.sources.ts` | yangi | Manbalar: biznes-reja, hudud rejasi, prognoz/xavf (`asOf`), munosabat va nazorat (davr oxiridagi holat), ogohlantirishlar, yopilgan oylar. Har biri `{status, value, note}` qaytaradi, xato hisobotni to'xtatmaydi |
| `apps/api/src/modules/reports/report.executive.ts` | qayta yozildi | 8 bo'lim, `compare`/`view` parametrlari |
| `apps/api/src/modules/reports/reports.types.ts` | kengaytirildi | `formats` (blok qaysi formatda), `sheet`, `coverSheet`, `ownMethodology`, `options`, `KpiBlock.title`, `forFormat()` |
| `apps/api/src/modules/reports/reports.data.ts` | kengaytirildi | `Row.tiyin: bigint`, `averageHeadcountByUnit()` |
| `apps/api/src/modules/reports/reports.service.ts` | o'zgardi | Nom «Umumiy hisobot», parametrlar oq ro'yxat bo'yicha tekshiriladi, formatga qarab filtr |
| `apps/api/src/modules/reports/reports.module.ts` | o'zgardi | `AlertsModule`, `BplanModule`, `GeneralSources` |
| `apps/api/src/modules/reports/render.excel.ts` | o'zgardi | Varaq nomlari bo'limdan, muqova varag'i nomi, KPI guruh sarlavhalari |
| `apps/api/src/modules/reports/render.pdf.ts` | o'zgardi | KPI guruh sarlavhasi |
| `apps/api/src/modules/reports/render.pptx.ts` | o'zgardi | Sarlavhali KPI guruhlari bitta slaydda |
| `apps/api/src/modules/bplan/bplan.module.ts` | o'zgardi | `exports: [BplanService]` |
| `apps/web/src/features/reports/api.ts` | o'zgardi | Parametrlar, format bo'yicha ko'rinish (`forScreen`) |
| `apps/web/src/features/reports/report-view.tsx` | o'zgardi | Ekranda faqat kerakli bloklar, KPI guruh sarlavhalari |
| `apps/web/src/features/reports/reports-center.tsx` | o'zgardi | «Taqqoslash» va «Ko'rinish» tanlovlari |
| `docs/reports/REPORT_*.md` | yangi | Audit, metodika, implementatsiya |

Boshqa 10 hisobot kodiga tegilmadi; yangi maydonlar ixtiyoriy.

## 2. API

`POST /api/reports/generate` va `/preview` — `options` maydoni qo'shildi (ixtiyoriy):

```json
{ "type": "executive", "from": "2026-07-01", "to": "2026-09-30", "format": "xlsx",
  "options": { "compare": "yoy", "view": "short" } }
```

Noma'lum kalit e'tiborga olinmaydi, noto'g'ri qiymat → standart qiymat. Katalogda (`GET /api/reports/catalog`) har bir hisobot uchun `options` ro'yxati qaytadi.

## 3. Bo'limlar va formatlar

| № | Bo'lim | Excel varag'i | Qisqa PDF/PPTX |
|---|---|---|---|
| — | Muqova: xulosalar, KPI | `Qisqa_hisobot` | ha |
| 1 | Rahbariyat xulosasi (Fakt / Reja / Prognoz va xavf) | `KPI_va_formulalar` | ha |
| 2 | Reja va davrlar taqqoslash | `Reja_fakt` | ha |
| 3 | 12 oylik dinamika | `Dinamikalar` | faqat Excel (grafik PDFda) |
| 4 | O'zgarish sabablari | `Ozgarish_sabablari` | top-8; to'liq ro'yxat Excelda |
| 5 | Hududlar va Markaz | `Hududlar` | ha |
| 6 | Xavflar va tavsiyalar | `Xavflar_tavsiyalar` | top-5; hammasi Excelda |
| 7 | Ma'lumot sifati va prognoz ishonchliligi | `Malumot_sifati` | faqat muammoli qatorlar |
| 8 | Metodika | `Metodika` | `full` ko'rinishda PDFda ham |

Excel varaqlari aniq shu nomlarda; hujjat versiyasi (ma'lumot xeshi) sarlavhada.

## 4. Testlar

Kompyuteringizdagi loyihada test yuritgich yo'q, shuning uchun testlar ishlab chiqish nusxasida (soxta baza bilan) o'tkazildi va paketga kiritilmadi.

| Test | Natija |
|---|---|
| `t-general-calc` — formulalar, nol/manfiy baza, BigInt aniqligi (≈1.8·10¹⁸ tiyin), Σ ta'sir = ΔN, reyting (teng o'rin), Markaz qoplash, reja yo'q/nol, to'liqlik, takrorlar, xavf chegaralari (69% / 70%), birlashtirish, xulosalar | OK |
| `t-general-report` — 3 format, varaq nomlari, Excel qiymatlari hisob bilan mos, parametrlar oq ro'yxati, chorak emas davr, prognoz xatosi, reja yo'q, reja nol, bo'sh davr, joriy oy qisman, standart davr, takrorlar | OK |
| Butun API to'plami | 52/52 OK |
| Veb TypeScript (`features/reports`) | xato yo'q |

Sinov ma'lumotida: **PDF 4 bet, PPTX 14 slayd.** Talab 2–3 bet va 7 slayd — hali bajarilmagan (qarang 6-band).

## 5. Spetsifikatsiyadan farqlar

1. Markazni qoplash — asosiy ko'rsatkich **sof** xarajatga nisbatan (Solishtirma bilan mos), yalpi variant qo'shimcha.
2. Biznes-reja fakti — biznes-reja modulining o'z moddalar xaritasi; asosiy faktdan farq izohda.
3. Munosabat tarixi sanalardan tiklanadi → «Qisman».
4. Avtomatik ogohlantirishlar faqat joriy tekshiruv oyi uchun; o'tgan davrda «tarixiy holat mavjud emas».
5. PDF/PPTX hajmi talabdan katta.

## 6. Yetishmayotgan manbalar / keyingi qadamlar

- Kompaniya darajasida **oylik reja** yo'q — oylik davrda kompaniya reja–fakti chiqmaydi.
- Munosabat holati o'zgarishlari tarixi saqlanmaydi.
- Avtomatik ogohlantirishlar tarixi saqlanmaydi.
- PPTX 7 slaydga tushirish: bo'limlarni birlashtiruvchi alohida «qisqa slayd» shabloni kerak.

## 7. O'rnatish

```
cd C:\Projects\korxona-tahlil
powershell -ExecutionPolicy Bypass -File .\umumiy-hisobot.ps1
pnpm dev
```

Zaxira nusxa: `umumiy-hisobot-backup-<sana>` papkasida. Qaytarish — fayllarni shu papkadan joyiga ko'chirish.