import type { FormulaItem } from './reports.types';

// ═══════════════════════════════════════════════════════════
// Hisoblash formulalari — har bir hisobot oxirida "Hisoblash formulalari" bo'limi.
// Matn kod bilan aynan bir xil qoidalarni tasvirlaydi (o'zgartirilsa — ikkalasi birga).
// ═══════════════════════════════════════════════════════════

const F: Record<string, FormulaItem> = {
  // ─────────── Asos ───────────
  period: {
    name: 'Davr va oy',
    formula:
      "Yozuv davrga SANASI bo'yicha kiradi (Toshkent vaqti, boshlanish va tugash kunlari ham kiradi). Oy — yozuv sanasining oyi. O'chirilgan yozuvlar hech qayerda hisobga olinmaydi.",
  },
  income: { name: 'Daromad', formula: "Daromad = Σ (Daromadlar bo'limidagi davr ichidagi yozuvlar summasi)" },
  expense: { name: 'Xarajat', formula: "Xarajat = Σ (Xarajatlar bo'limidagi davr ichidagi yozuvlar summasi) — ish haqi, ijara va mashinalar ham shu yerda" },
  result: { name: 'Natija (foyda / zarar)', formula: 'Natija = Daromad − Xarajat; musbat — foyda, manfiy — zarar' },
  margin: { name: 'Rentabellik', formula: 'Rentabellik = (Daromad − Xarajat) ÷ Daromad × 100%  (daromad 0 bo\'lsa — hisoblanmaydi)' },
  change: { name: "O'zgarish, %", formula: "O'zgarish = (Shu davr − Solishtiriladigan davr) ÷ |Solishtiriladigan davr| × 100%  (asos 0 bo'lsa — «—»)" },
  prevRange: { name: "O'tgan teng davr", formula: "Tanlangan davr bilan bir xil kunlar sonidagi, undan bevosita oldingi davr (masalan, 01.07–30.09 (92 kun) uchun 31.03–30.06)" },
  yearAgo: { name: "O'tgan yilning shu davri", formula: "Xuddi shu sanalar, bir yil oldin (29-fevral — 28-fevral)" },
  share: { name: 'Ulush', formula: "Ulush = Qator summasi ÷ Jami × 100%" },
  doimiy: { name: 'Doimiy / Boshqa', formula: "Yozuvning bo'limi: Doimiy — muntazam; Boshqa — bir martalik. Doimiy + Boshqa = Jami" },
  cumulative: { name: "Yig'ma natija", formula: "Yig'ma natija (oy) = Davr boshidan shu oygacha bo'lgan oylar natijalari yig'indisi" },
  groups: { name: 'Xarajat guruhi', formula: "Ish haqi, Ijara, Mashinalar — yozuv manbai bo'yicha; qolganlari — moddaning eng yuqori (ota) moddasi bo'yicha" },
  unit: { name: 'Hudud (birlik)', formula: "Yozuvdagi hudud kodi: 0 — Markaz, boshqa — hudud; hududsiz lekin Markaz bo'limi ko'rsatilgan — Markaz; ikkalasi yo'q — «Hududga biriktirilmagan»" },
  heads: { name: 'Xodimlar soni (davrda)', formula: "Davr ichida kamida bir kun ishlagan xodimlar: ishga kirgan sana ≤ davr oxiri va (bo'shamagan yoki bo'shagan sana ≥ davr boshi). Xodimlar bo'limidan" },
  perHead: { name: 'Bir xodimga', formula: "Bir xodimga daromad (xarajat, natija) = Summa ÷ Davrda ishlagan xodimlar soni" },
  centerNet: { name: 'Markaz sof xarajati', formula: 'Markaz sof xarajati = Markaz xarajati − Markaz daromadi' },
  coverage: { name: 'Markazni qoplash', formula: 'Qoplash = Hududlar jami foydasi ÷ Markaz sof xarajati × 100%' },
  resultChange: { name: "Natija o'zgarishi", formula: "Natija o'zgarishi = Shu davr natijasi − O'tgan teng davr natijasi" },
  incomePerExpense: { name: 'Daromad / xarajat', formula: 'Daromad ÷ Xarajat (1 dan katta — foydali)' },
  lossMonths: { name: 'Zararli oylar', formula: 'Oy natijasi (daromad − xarajat) manfiy bo\'lgan oylar soni' },
  costStructure: { name: 'Xarajat tarkibi (ulush)', formula: "Ish haqi (yoki ijara, mashinalar, qolganlari) ÷ Hudud xarajati × 100%; to'rttasi yig'indisi — 100%" },
  driverEffect: { name: "Natijaga ta'sir (modda)", formula: "Daromad moddasi: Shu davr − O'tgan davr; xarajat moddasi: O'tgan davr − Shu davr (xarajat kamaysa — musbat)" },

  // ─────────── Tarkib ───────────
  avgPerDay: { name: "Kunlik o'rtacha", formula: "Kunlik o'rtacha = Jami ÷ Davrdagi kunlar soni" },
  counterparty: { name: 'Kontragent ulushi', formula: 'Kontragent summasi ÷ Jami xarajat × 100%' },
  expensePay: { name: "To'lov holati (xarajat)", formula: "Yozuvdagi to'lov holati bo'yicha summa: To'langan / Qisman to'langan / To'lanmagan" },
  avgIncome: { name: "O'rtacha summa", formula: "O'rtacha summa = Xizmat turi summasi ÷ Yozuvlar soni" },
  debt: {
    name: "To'lanmagan qism (debitorlik)",
    formula: "To'langan — 0; To'lanmagan — butun summa; Qisman — Summa − To'langan summa. Jami — barcha yozuvlar bo'yicha yig'indi",
  },
  debtDays: { name: 'Kun (qarz)', formula: 'Yozuv sanasidan bugungacha o\'tgan to\'liq kunlar' },
  top5: { name: 'Eng katta 5 mijoz ulushi', formula: "Eng katta 5 mijoz summasi ÷ Mijoz ko'rsatilgan daromad × 100%" },
  hhi: { name: 'Konsentratsiya (HHI)', formula: "HHI = Σ (har bir mijoz ulushi, %)²; 1500 gacha — past, 1500–2500 — o'rtacha, 2500 dan yuqori — yuqori" },
  newLost: { name: 'Yangi / ketgan mijoz', formula: "Yangi — o'tgan teng davrda yo'q, shu davrda bor; ketgan — o'tgan davrda bor, shu davrda yo'q" },

  // ─────────── Ish haqi ───────────
  payroll: { name: 'Ish haqi xarajati', formula: "Xarajatlar bo'limidagi ish haqi (manba — ish haqi) yozuvlari summasi" },
  payrollMonthHeads: { name: 'Oy xodimlari', formula: 'Oy ichida kamida bir kun ishlagan xodimlar soni' },
  payrollPerHeadMonth: { name: '1 xodimga oyiga', formula: "Ish haqi ÷ Ish haqi yozilgan oylar soni ÷ Oylik o'rtacha xodimlar soni; oylar jadvalida — Oy ish haqi ÷ Oy xodimlari" },
  payrollToIncome: { name: 'Ish haqi / daromad', formula: 'Ish haqi ÷ Daromad × 100%' },
  incomePerPayroll: { name: "1 so'm ish haqiga daromad", formula: 'Daromad ÷ Ish haqi' },
  turnover: { name: 'Kadrlar almashinuvi', formula: "Davrda bo'shaganlar ÷ Oylik o'rtacha xodimlar soni × 100%" },
  payrollFlag: { name: '(!) belgisi', formula: "Oy ish haqi davr oylari medianasining 1,6 barobaridan ko'p (ikki marta kiritilgan paket bo'lishi mumkin)" },

  // ─────────── Mashinalar va ijara ───────────
  vehicleTotal: { name: 'Mashina xarajati', formula: "Mashinalar reestridagi, Xarajatlar bo'limida o'chirilmagan yozuvlar summasi (yoqilg'i, moyka, ta'mir, xizmat)" },
  literPrice: { name: '1 litr narxi', formula: "Yoqilg'i summasi ÷ Litrlar" },
  mileage: { name: 'Probeg', formula: "Davrdagi spidometr ko'rsatkichlari: eng katta − eng kichik" },
  per100: {
    name: 'Sarf, l/100 km',
    formula: "To'la bakdan to'la bakgacha: spidometr bilan kiritilgan quyilishlar probeg bo'yicha tartiblanadi; (birinchisidan keyingi litrlar) ÷ (oxirgi − birinchi ko'rsatkich) × 100. (!) — me'yordan 15% dan ko'p",
  },
  leaseMonthly: { name: 'Oylik ijara (hozir)', formula: "Shartnomaning bugungi oyda amaldagi oylik summasi (eng so'nggi o'zgartirish)" },
  leaseM2: { name: '1 m² narxi', formula: 'Oylik ijara ÷ Maydon (m²); o\'rtacha — Σ oylik ÷ Σ maydon' },
  leasePeriod: { name: 'Ijara (davrda)', formula: "Davrdagi ijara xarajati yozuvlari (hisoblangan oylik to'lovlar) summasi" },

  // ─────────── Katta modellar ───────────
  forecast: {
    name: 'Prognoz',
    formula:
      "Tugagan oylar bo'yicha Holt-Winters oilasi (tekislash, trendli, mavsumiy): oxirgi oylarni yashirib sinalganda eng aniq bo'lgani tanlanadi (murakkabrog'i kamida 3% aniqroq bo'lsagina)",
  },
  yearEnd: {
    name: 'Yil yakuni',
    formula: "Yil jami = Haqiqiy (yilning tugagan oylari) + Joriy oy + Prognoz (keyingi oylardan dekabrgacha); Joriy oy = max(hozircha yozilgan, joriy oy prognozi)",
  },
  resultForecast: { name: 'Natija prognozi', formula: 'Natija prognozi = Daromad prognozi − Xarajat prognozi (har oy va yil yakunida)' },
  band80: { name: '80% oraliq', formula: "2000 ta tasodifiy yo'l simulyatsiyasining 10% va 90% kvantillari; natija uchun daromad va xarajat birga (o'zaro bog'liqligi bilan) simulyatsiya qilinadi" },
  wape: { name: "O'rtacha xato (sinov)", formula: "Σ |Haqiqiy − Prognoz| ÷ Σ |Haqiqiy| × 100% (natija uchun — daromad hajmiga nisbatan); oddiy usul — «o'tgan oy takrorlanadi»" },
  skill: { name: 'Yutuq', formula: "Yutuq = (1 − Model xatosi ÷ Oddiy usul xatosi) × 100%" },
  factors: { name: "Omil ta'siri", formula: "Panel regressiya: Daromad = β₀ + Σ βᵢ × Omilᵢ (+ hudud effekti); β — omil 1 birlikka oshganda oylik daromad o'zgarishi. p < 0,05 — ishonchli, p < 0,10 — taxminiy" },
  elasticity: { name: 'Elastiklik', formula: "log-log model: omil 1% oshganda daromad necha foiz o'zgaradi" },
  dea: { name: 'Samaradorlik (DEA)', formula: "Hudud resurslari (xodimlar, xarajatlar) bilan eng yaxshi hududlar erishgan daromadga nisbati: 100% — chegarada; Imkoniyat = Namunalar kabi ishlagandagi daromad − Haqiqiy daromad" },
  breakeven: {
    name: 'Zararsizlik nuqtasi',
    formula: "Xarajat = Doimiy + O'zgaruvchan ulush × Daromad (regressiya); Zararsizlik daromadi = Doimiy ÷ (1 − O'zgaruvchan ulush); Zaxira = (O'rtacha daromad − Zararsizlik) ÷ O'rtacha daromad × 100%",
  },
  risk: { name: 'Zarar ehtimoli', formula: "Keyingi 3 oy jami natijasi manfiy bo'lgan simulyatsiya yo'llari ulushi (daromad va xarajat birga, 2000 yo'l)" },

  // ─────────── Munosabat ───────────
  reactionBase: { name: 'Baza davri', formula: 'Munosabat belgilanishidan oldingi, kuzatuv bilan teng kunlik davr' },
  reactionExpected: { name: 'Kutilgan', formula: "Kutilgan = Baza summasi ÷ Baza kunlari × Kuzatuvda o'tgan kunlar" },
  reactionEffect: { name: "Natijaga ta'siri", formula: "Xarajat: Kutilgan − Haqiqiy (tejalgan); daromad va natija: Haqiqiy − Kutilgan. Munosabat ta'siri = moddalar ta'siri yig'indisi" },
  reactionChange: { name: "O'zgarish (sur'at)", formula: "(Kuzatuvdagi kunlik summa − Bazadagi kunlik summa) ÷ |Bazadagi kunlik summa| × 100%" },
  reactionVerdict: { name: 'Holat', formula: "|O'zgarish| < 3% — o'zgarishsiz; aks holda xarajat kamaysa (daromad, natija oshsa) — yaxshilandi, teskarisi — yomonlashdi" },
  reactionOverdue: { name: "Muddati o'tgan", formula: "Holati ochiq va bugungi sana muddat kunidan keyin" },

  // ─────────── Nazorat ───────────
  controlProjection: { name: 'Joriy oy taxmini', formula: "Hozircha yozilgan ÷ O'tgan kunlar × Oydagi kunlar (joriy oy tugamaguncha tekshirilmaydi)" },
  controlUsage: { name: 'Chegaraga nisbatan', formula: 'Joriy oy taxmini ÷ Oylik chegara × 100%' },
  controlBreach: { name: 'Buzilish', formula: "Tugagan oy, nazorat boshlangan oydan: xarajat > chegara yoki daromad / natija < chegara" },
  controlGap: { name: 'Farq', formula: 'Xarajat: Haqiqiy − Chegara; daromad va natija: Chegara − Haqiqiy' },
  controlRisk: { name: 'Buzish ehtimoli', formula: "Prognoz simulyatsiyasida oy qiymati chegaradan chiqqan yo'llar ulushi; 60% dan yuqori — xavf (ishonchli prognozda 65% dan — «Xavf ostida» holati)" },
};

/** Hisobot turlari uchun formulalar ro'yxati */
const BY_REPORT: Record<string, string[]> = {
  executive: ['period', 'income', 'expense', 'result', 'margin', 'change', 'prevRange', 'driverEffect', 'resultChange', 'yearEnd', 'resultForecast', 'risk', 'controlBreach', 'reactionOverdue'],
  financial: ['period', 'income', 'expense', 'result', 'margin', 'change', 'prevRange', 'yearAgo', 'doimiy', 'cumulative', 'share', 'groups', 'unit', 'heads', 'perHead', 'resultChange', 'centerNet', 'coverage'],
  regions: ['period', 'income', 'expense', 'result', 'margin', 'unit', 'heads', 'perHead', 'incomePerExpense', 'costStructure', 'resultChange', 'prevRange', 'centerNet', 'coverage', 'lossMonths'],
  passport: ['period', 'income', 'expense', 'result', 'margin', 'change', 'prevRange', 'yearAgo', 'share', 'groups', 'heads', 'perHead', 'forecast', 'resultForecast', 'band80', 'dea', 'breakeven', 'risk'],
  expenses: ['period', 'expense', 'groups', 'share', 'change', 'prevRange', 'avgPerDay', 'doimiy', 'counterparty', 'expensePay', 'unit'],
  incomes: ['period', 'income', 'share', 'change', 'prevRange', 'avgIncome', 'top5', 'hhi', 'newLost', 'debt', 'debtDays', 'unit'],
  payroll: ['period', 'payroll', 'heads', 'payrollMonthHeads', 'payrollPerHeadMonth', 'payrollToIncome', 'incomePerPayroll', 'share', 'turnover', 'payrollFlag', 'change', 'prevRange'],
  assets: ['period', 'vehicleTotal', 'literPrice', 'mileage', 'per100', 'leasePeriod', 'leaseMonthly', 'leaseM2', 'change', 'prevRange'],
  reactions: ['reactionBase', 'reactionExpected', 'reactionEffect', 'reactionChange', 'reactionVerdict', 'reactionOverdue', 'period'],
  controls: ['period', 'controlProjection', 'controlUsage', 'controlBreach', 'controlGap', 'controlRisk'],
  models: ['period', 'yearEnd', 'forecast', 'resultForecast', 'band80', 'wape', 'skill', 'factors', 'elasticity', 'dea', 'breakeven', 'risk', 'result'],
};

export function formulasFor(type: string): FormulaItem[] {
  return (BY_REPORT[type] ?? []).map((k) => F[k]!).filter(Boolean);
}

export const FORMULA_KEYS = Object.keys(F);
export const REPORT_FORMULAS = BY_REPORT;