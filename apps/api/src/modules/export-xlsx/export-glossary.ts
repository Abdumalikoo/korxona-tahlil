// ═══════════════════════════════════════════════════════════
// Excel eksport — atamalar lug'ati: har ustun nima, qanday hisoblanadi, ma'lumot qayerdan.
// Ustun sarlavhasi bo'yicha (birinchi mos kelgani). Dasturdagi hisob qoidalari bilan bir xil.
// ═══════════════════════════════════════════════════════════

export interface GlossaryEntry {
  /** Nima */
  meaning: string;
  /** Qanday hisoblanadi */
  formula?: string;
  /** Ma'lumot qayerdan */
  source?: string;
}

export const GLOSSARY: [RegExp, GlossaryEntry][] = [
  [/rentabel/i, { meaning: 'Har 100 so‘m daromaddan qancha foyda qolgani (foizda).', formula: 'Rentabellik, % = (Daromad − Xarajat) ÷ Daromad × 100. Daromad 0 bo‘lsa — hisoblanmaydi.' }],
  [/ulush/i, { meaning: 'Qatorning jamidagi hissasi (foizda).', formula: 'Ulushi, % = Qator summasi ÷ Jami (korxona, viloyat yoki bo‘limlar jami — jadval sarlavhasida) × 100.' }],
  [/bajarilish/i, { meaning: 'Reja qanchalik bajarilgani.', formula: 'Bajarilish, % = Fakt ÷ Reja × 100 (100% dan yuqori — reja oshirib bajarilgan).', source: 'Hudud natijalari fayli (reja va fakt)' }],
  [/qqs/i, { meaning: 'Qo‘shilgan qiymat solig‘i — hudud daromadidan avtomatik.', formula: 'QQS = Haqiqatda tushgan pul (fakt / hudud daromadi) × 12%. Tumanlarga — daromad ulushiga qarab.', source: 'Soliqlar › avtomatik hisob (har oy, daromad yuklanganda darhol)' }],
  [/ijtimoiy/i, { meaning: 'Ish beruvchi to‘laydigan ijtimoiy soliq — alohida xarajat.', formula: 'Ijtimoiy soliq = Shu birlikda ko‘rinadigan ish haqi × 12% (hudud, Markaz bo‘limi, yo‘nalish — har birida aniq 12%).', source: 'Soliqlar › avtomatik hisob (ish haqi yuklanganda)' }],
  [/daromad solig|jshds/i, { meaning: 'Xodimdan ushlanadigan daromad solig‘i — ish haqi ICHIDA (alohida xarajat emas).', formula: 'Daromad solig‘i = Ish haqi × 12%; qo‘lga (sof) = Ish haqi × 88%. Ijtimoiy soliq bilan summasi teng.' }],
  [/qo['‘’]lga|sof/i, { meaning: 'Xodim qo‘liga oladigan summa (daromad solig‘i ushlangandan keyin).', formula: 'Sof = Ish haqi − Ish haqi × 12%.' }],
  [/ish haqi/i, { meaning: 'Hisoblangan to‘liq ish haqi (daromad solig‘i shu ichida).', formula: 'Har oy — ish haqi qaydnomasi (soliq hisoboti); xodim qaysi oy qaysi bo‘limda bo‘lsa — o‘sha bo‘limga (ish haqi tarkibidagi bo‘lim asosiy).', source: 'Xarajatlar › Ish haqi, Ish haqi tarkibi' }],
  [/qo['‘’]mita/i, { meaning: 'Qo‘mita mablag‘i: 3802 hovuzidan bo‘lim xodimlariga qoplangan ish haqi yoki xizmat shartnomasi puli.', formula: 'Hovuz — har bo‘limga faqat o‘z xodimlariga (3802 vedomosti bo‘yicha) qoplangani; qolgani — «Qo‘mita pullarining sarfi» qatorida (hovuz qoldig‘i). Marksheyder — shartnoma puli to‘liq.', source: 'Daromadlar › Markaz tushumi (kunlik ma’lumotnoma), 3802 vedomosti' }],
  [/foyda|natija|zarar/i, { meaning: 'Daromad va xarajat farqi.', formula: 'Natija (Foyda) = Daromad − Xarajat. Musbat — foyda, manfiy — zarar.' }],
  [/o['‘’]zgarish|farq/i, { meaning: 'Joriy davr bilan solishtirma davr (o‘tgan teng davr / o‘tgan yil) farqi.', formula: 'Farqi = Joriy − Oldingi; Farqi, % = (Joriy − Oldingi) ÷ |Oldingi| × 100 (oldingi 0 bo‘lsa — foiz hisoblanmaydi). Belgi natijaga ta’siri bo‘yicha: yaxshilanish «+», yomonlashish «−».' }],
  [/reja/i, { meaning: 'Hudud xodimi uchun rejadagi tushum.', source: 'Hudud natijalari fayli' }],
  [/fakt|tushum|tushgan/i, { meaning: 'Haqiqatda tushgan pul (bajarilgan ish).', source: 'Hudud natijalari fayli / Hududlar tushumi' }],
  [/bonus|mukofot/i, { meaning: 'Natija uchun bonus / mukofot.', source: 'Hudud natijalari fayli, 23106 ko‘chirmasi' }],
  [/bayram/i, { meaning: 'Bayram pullari (23106 ko‘chirmasidan).', formula: 'Hudud xodimlarining bayram puli tasdiqlangan oylarda hudud ish haqidan Markaz hisobiga o‘tadi.', source: 'Xarajatlar › 23106, Test ish haqi' }],
  [/xarajat/i, { meaning: 'Shu birlik (hudud, tuman, bo‘lim, yo‘nalish) xarajati.', formula: 'Xarajat = Ish haqi + Ijtimoiy soliq + QQS + Ijara + Mashina + boshqa moddalar (Xarajatlar siyosati bo‘yicha boshqa birlik hisobiga o‘tganlari kirmaydi).', source: 'Xarajatlar bo‘limidagi yozuvlar' }],
  [/daromad/i, { meaning: 'Shu birlik daromadi.', formula: 'Daromad = shu birlikka yozilgan tushumlar (hududda — Hududlar tushumi; Markazda — Markaz tushumi; Qo‘mita qoplagan ish haqi — o‘z bo‘limida).', source: 'Daromadlar bo‘limidagi yozuvlar' }],
  [/ijara/i, { meaning: 'Ijara to‘lovi (shartnoma bo‘yicha oyma-oy).', source: 'Xarajatlar › Ijara, Hudud ijaralari' }],
  [/mashina|yoqilg/i, { meaning: 'Mashinalar xarajati (yoqilg‘i, ta’mir …).', source: 'Mashinalar bo‘limi' }],
  [/(bir|1) xodimga/i, { meaning: 'Bir xodimga to‘g‘ri keladigan summa.', formula: 'Bir xodimga = Summa ÷ Xodimlar soni.' }],
  [/xodim/i, { meaning: 'Xodim yoki xodimlar soni (shu davrda shu birlikda ishlaganlar).', formula: 'Xodim oyma-oy qaysi bo‘limda ishlagani — ish haqi tarkibidagi bo‘lim (asosiy), bo‘lmasa natijalar fayli / joylashuv.', source: 'Xodimlar bo‘limi, ish haqi tarkibi' }],
  [/o['‘’]rtacha/i, { meaning: 'O‘rtacha qiymat.', formula: 'O‘rtacha = Summa ÷ Soni (yoki oylar soni).' }],
  [/soni|son\b|ta\b/i, { meaning: 'Soni (dona, xizmat, yozuv).' }],
  [/pinfl/i, { meaning: 'Xodimning shaxsiy identifikatsiya raqami (14 xonali).' }],
  [/oy|davr|sana/i, { meaning: 'Davr (oy / sana).' }],
  [/hudud|viloyat|tuman/i, { meaning: 'Hudud (viloyat / tuman).' }],
  [/bo['‘’]lim|tuzilma|birlik/i, { meaning: 'Tuzilma birligi (Markaz bo‘limi, hudud, yo‘nalish).' }],
  [/summa/i, { meaning: 'Summa (so‘mda).' }],
];

/** Hamma eksportga umumiy qoidalar (dasturdagi hisob qoidalari) */
export const GENERAL_RULES: string[] = [
  'Pul — so‘mda (dasturda tiyinda saqlanadi, eksportda so‘mga yaxlitlangan).',
  'Davr — sahifadagi «Davr» bo‘yicha (fayl tepasida ko‘rsatilgan).',
  'Ish haqi — to‘liq (hisoblangan) summa; daromad solig‘i 12% shu ish haqi ICHIDA (xodimdan ushlanadi, alohida xarajat emas).',
  'Ijtimoiy soliq — ish haqining 12% i, ish beruvchi xarajati (alohida qator); summasi daromad solig‘iga teng.',
  'QQS — hudud daromadi (haqiqatda tushgan pul) ustiga 12%, avtomatik; qo‘lda kiritiladigan QQS — Markaz hisobida.',
  'Xodim joylashuvi — har oy ish haqi tarkibidagi bo‘lim bo‘yicha (asosiy manba); bir xodim bir necha bo‘limda ishlagan bo‘lsa — har bo‘limda faqat o‘sha oylari.',
  'Qo‘mita: 3802 hovuzi puli hamma hovuz bo‘limlari uchun — har bo‘limga faqat o‘z xodimlariga qoplangani; xizmat shartnomasi (Marksheyder) — to‘liq.',
  'Xarajatlar siyosati: ayrim moddalar yozilgan joyidan qat’i nazar boshqa birlik (masalan, Markaz) hisobiga o‘tadi — o‘sha birlikda ko‘rinadi.',
  'Ulushi — jadvaldagi jamiga nisbatan; Rentabellik — foyda ÷ daromad.',
  'Har bir son bo‘yicha to‘liq ishlanish — dasturda raqamni bosing («Qanday hisoblandi?»).',
];

export function explainColumn(header: string): GlossaryEntry | null {
  const hit = GLOSSARY.find(([re]) => re.test(header));
  return hit ? hit[1] : null;
}
