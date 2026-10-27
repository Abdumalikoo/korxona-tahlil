# korxona-tahlil — ish qoidalari

## Til va uslub
- Javoblar faqat o'zbek tilida. Sifat darajasi — «mukammal».
- Ishni bosqichma-bosqich qil. Katta yoki qaytarib bo'lmaydigan qadamdan oldin ruxsat so'ra.
- Prettier ISHLATILMASIN (formatlashni o'zgartirma).

## Xavfsizlik (qat'iy)
- Maxfiy kalitlar, parollar, JWT, .env qiymatlari va shaxsiy ma'lumotlarni (PINFL, F.I.Sh.) terminalga, logga yoki hisobotga chiqarma.
- Ishlab chiqarish bazasiga tegma. Faqat lokal yoki sinov bazasi.
- Haqiqiy ma'lumotni o'chiradigan buyruqlarni tasdiqsiz bajarma.
- Baza migratsiyasi yoki biznes formulalarini o'zgartirishdan oldin reja ko'rsat va ruxsat ol.
  Ma'lumotlar settings jadvalida saqlanadi (migratsiyasiz yondashuv).
- Testlarda faqat sun'iy ma'lumot ishlat.

## Loyiha
- pnpm monorepo: apps/api (NestJS 11), apps/web (Next 16 + Tailwind 4), packages/db (Prisma 6).
- Pul — tiyinda (BigInt). Web'da `sum(tiyin)` ishlat, `formatSum` so'm qabul qiladi.

## Tekshiruv (har o'zgarishdan keyin)
- API: `cd apps/api; npx tsc -p tsconfig.json --noEmit false --outDir dist; node test/run-all.js`
  (t-security.js avvaldan yiqilib turadi — bu ma'lum).
- Web: `cd apps/web; npx tsc --noEmit; npx eslint <o'zgargan fayllar>; npx next build`
- Ishga tushirish: `powershell -ExecutionPolicy Bypass -File .\ishga-tushir.ps1 -Build`
