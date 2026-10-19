import {
  calcChange,
  calcCompletion,
  calcDiff,
  calcDivide,
  calcMargin,
  calcMean,
  calcPp,
  calcResult,
  calcShare,
  calcSum,
  FORMULAS,
  Q,
  type Calc,
  type FormulaId,
} from '@/lib/calc';

// ═══════════════════════════════════════════════════════════
// «Formulalar va atamalar» — dasturdagi hamma hisob bir joyda.
// Asosiy formulalar lib/calc.ts → FORMULAS dan olinadi (sayt, Excel, slayd bilan bir xil matn),
// har biriga oddiy sonlar bilan to'liq ishlangan misol qo'shiladi.
// Munosabat, Nazorat, Ogohlantirish va Katta modellar formulalari — backenddagi
// reactions.workings.ts, alerts.calc.ts, econ.workings.ts bilan aynan bir xil.
// ═══════════════════════════════════════════════════════════

export type HelpGroup = 'asosiy' | 'munosabat' | 'nazorat' | 'ogohlantirish' | 'modellar';

export const GROUPS: { key: HelpGroup; label: string; hint: string }[] = [
  { key: 'asosiy', label: 'Asosiy hisoblar', hint: "Bosh sahifa, Daromad, Xarajat, Tahlil, Solishtirma va Manba bo'limlarida" },
  { key: 'munosabat', label: 'Munosabat', hint: "Belgilangan moddalar avvalgi sur'at bilan solishtiriladi" },
  { key: 'nazorat', label: 'Nazorat', hint: 'Har oy chegara bilan solishtiriladi' },
  { key: 'ogohlantirish', label: 'Ogohlantirishlar', hint: '«Muhokama talab qiladi» — tizim o‘zi topadigan holatlar' },
  { key: 'modellar', label: 'Katta modellar', hint: 'Prognoz, omillar, samaradorlik, zararsizlik, risk' },
];

export interface HelpFormula {
  /** Havola uchun: /formulalar#change */
  id: string;
  group: HelpGroup;
  name: string;
  /** Formula so'z bilan (bir nechta qator bo'lishi mumkin) */
  formula: string[];
  meaning: string;
  /** Qayerda ishlatiladi */
  where?: string;
  /** Oddiy sonlar bilan to'liq ishlangan misol */
  example?: Calc;
}

const SOM = 100; // so'm → tiyin

/** Asosiy formulalar uchun misollar (FORMULAS kalitlari bo'yicha) */
const EXAMPLES: Record<FormulaId, { where: string; example: Calc }> = {
  result: {
    where: 'Bosh sahifa «Tahlil» kartochkasi, Tahlil, Solishtirma',
    example: calcResult(1_200_000 * SOM, 950_000 * SOM, { title: 'Natija', note: 'Misol: daromad 1 200 000, xarajat 950 000 so‘m.' }),
  },
  sum: {
    where: "Jami qatorlar, «Jami daromad / xarajat» kartochkalari",
    example: calcSum('Jami xarajat', [Q.money('Ish haqi', 600_000 * SOM), Q.money('Ijara', 250_000 * SOM), Q.money('Kommunal', 100_000 * SOM)]),
  },
  change: {
    where: "Hamma ▲ ▼ foizlar: o'tgan teng davrga nisbatan",
    example: calcChange("Daromad: o'zgarish", Q.money('Joriy davr', 1_200_000 * SOM), Q.money("O'tgan teng davr", 1_000_000 * SOM), { growthGood: true }),
  },
  delta: {
    where: "So'mdagi o'zgarish, «Eng ko'p o'zgarganlar», «Foyda nima uchun o'zgardi»",
    example: calcDiff('Farq', Q.money('Joriy davr', 1_200_000 * SOM), Q.money("O'tgan teng davr", 1_000_000 * SOM), { formulaId: 'delta' }),
  },
  share: {
    where: "Ulush ustunlari, «Eng katta modda»",
    example: calcShare('Ish haqi ulushi', Q.money('Ish haqi', 600_000 * SOM), Q.money('Jami xarajat', 950_000 * SOM)),
  },
  margin: {
    where: 'Tahlil, Solishtirma, hududlar',
    example: calcMargin(1_200_000 * SOM, 950_000 * SOM),
  },
  perHead: {
    where: 'Solishtirma: hududlarni kattaligidan qat’i nazar solishtirish',
    example: calcDivide('Bir xodimga daromad', Q.money('Hudud daromadi', 1_200_000 * SOM), Q.count('Xodimlar soni', 8), 'money', { formulaId: 'perHead' }),
  },
  average: {
    where: "«O'rtacha bitta yozuv», xizmatning o'rtacha narxi",
    example: calcDivide("O'rtacha bitta yozuv", Q.money('Jami', 1_200_000 * SOM), Q.count('Yozuvlar soni', 40), 'money', { formulaId: 'average' }),
  },
  completion: {
    where: 'Natijalar, Nazorat (daromad rejasi)',
    example: calcCompletion(1_000_000 * SOM, 920_000 * SOM),
  },
  ratio: {
    where: "«Har 1 so'm daromadga xarajat»",
    example: calcDivide("Har 1 so'm daromadga xarajat", Q.money('Xarajat', 950_000 * SOM), Q.money('Daromad', 1_200_000 * SOM), 'ratio'),
  },
  mean: {
    where: "Oyiga o'rtacha, asos davr o'rtachasi",
    example: calcMean("Oyiga o'rtacha", [Q.money('Iyul', 900_000 * SOM), Q.money('Avgust', 1_000_000 * SOM), Q.money('Sentabr', 1_100_000 * SOM)]),
  },
  diffPp: {
    where: 'Rentabellik farqi, o‘sish sur’atlari farqi',
    example: calcPp('Rentabellik farqi', { label: 'Joriy rentabellik', value: 20.8 }, { label: 'Oldingi rentabellik', value: 18.5 }),
  },
};

const BASIC: HelpFormula[] = (Object.keys(FORMULAS) as FormulaId[]).map((id) => ({
  id,
  group: 'asosiy',
  name: FORMULAS[id].name,
  formula: [FORMULAS[id].formula],
  meaning: FORMULAS[id].meaning,
  where: EXAMPLES[id].where,
  example: EXAMPLES[id].example,
}));

const OTHER: HelpFormula[] = [
  // ── Munosabat (reactions.workings.ts → KEY_FORMULAS)
  {
    id: 'perDay',
    group: 'munosabat',
    name: "Kunlik sur'at",
    formula: ["Kunlik sur'at = Davr summasi ÷ Kunlar soni"],
    meaning: "Baza — belgilashdan oldingi teng davr; kuzatuv — belgilangan kundan bugungacha.",
    example: calcDivide("Avvalgi kunlik sur'at", Q.money('Baza summasi', 3_100_000 * SOM), Q.count('Baza kunlari', 31), 'money'),
  },
  {
    id: 'expected',
    group: 'munosabat',
    name: 'Kutilgan',
    formula: ["Kutilgan = Avvalgi kunlik sur'at × Kuzatuv kunlari"],
    meaning: "Hech narsa o'zgarmaganda shuncha bo'lar edi.",
  },
  {
    id: 'effect',
    group: 'munosabat',
    name: "Ta'sir",
    formula: ["Ta'sir = Haqiqiy − Kutilgan"],
    meaning: "Xarajatda manfiy — tejalgan; daromad va natijada musbat — qo'shimcha.",
    example: calcDiff("Ta'sir", Q.money('Haqiqiy', 1_800_000 * SOM), Q.money('Kutilgan', 2_000_000 * SOM)),
  },
  {
    id: 'verdict',
    group: 'munosabat',
    name: 'Holat',
    formula: ["O'zgarish, % = (Hozirgi sur'at − Avvalgi sur'at) ÷ |Avvalgi sur'at| × 100", "|o'zgarish| < 3% — o'zgarishsiz; aks holda yo'nalishiga qarab yaxshilandi yoki yomonlashdi"],
    meaning: 'Xarajatda kamayish — yaxshi, daromad va natijada oshish — yaxshi.',
  },
  {
    id: 'gain',
    group: 'munosabat',
    name: "Umumiy ta'sir",
    formula: ["Umumiy ta'sir = Σ tejalgan xarajat + Σ qo'shimcha daromad/natija"],
    meaning: "Munosabat bo'yicha korxona qancha yutgani yoki yutqazgani.",
  },
  // ── Nazorat (alerts.calc.ts / controls.service.ts)
  {
    id: 'projection',
    group: 'nazorat',
    name: 'Oy oxirigacha taxmin',
    formula: ['Taxmin = Oy boshidan summa ÷ O‘tgan kunlar × Oydagi kunlar'],
    meaning: 'Joriy oy hali tugamagan — sur’at bo‘yicha oy oxiridagi summa taxmin qilinadi.',
    example: calcDivide("Kunlik sur'at", Q.money('Oy boshidan', 500_000 * SOM), Q.count("O'tgan kunlar", 10), 'money', { note: "Taxmin = 50 000 × 31 = 1 550 000 so'm" }),
  },
  {
    id: 'usage',
    group: 'nazorat',
    name: 'Chegaradan foydalanish',
    formula: ['Foydalanish = Oy summasi (joriy oyda — taxmin) ÷ Chegara × 100'],
    meaning: '100% dan oshsa — chegara buzilgan (xarajatda) yoki reja bajarilgan (daromadda).',
    example: calcShare('Foydalanish', Q.money('Oy summasi', 1_550_000 * SOM), Q.money('Chegara', 1_500_000 * SOM)),
  },
  {
    id: 'controlStatus',
    group: 'nazorat',
    name: 'Holat',
    formula: ["Buzilgan — oxirgi tugagan oyda chegara buzilgan", "Xavf ostida — joriy oy taxmini yoki keyingi oy prognozi (ehtimol ≥ 65%) chegaradan chiqadi", "Me'yorda — qolgan holatlar"],
    meaning: 'Har oy avtomatik hisoblanadi.',
  },
  // ── Ogohlantirishlar (alerts.calc.ts)
  {
    id: 'alertChange',
    group: 'ogohlantirish',
    name: "Xarajat keskin o'sishi / daromad kamayishi",
    formula: ["O'sish = Joriy oy − Asos; O'sish % = O'sish ÷ Asos × 100", 'Asos — oldingi oylar o‘rtachasi; ikkala chegara (foiz VA so‘m) bajarilsa — ogohlantirish'],
    meaning: 'Chegaralar Sozlamalar › Ogohlantirishlar’da o‘zgartiriladi.',
  },
  {
    id: 'alertLoss',
    group: 'ogohlantirish',
    name: 'Zarar',
    formula: ['Natija = Daromad − Xarajat; zarar, agar Natija ≤ −chegara'],
    meaning: 'Hudud yoki korxona bo‘yicha.',
  },
  {
    id: 'alertPlan',
    group: 'ogohlantirish',
    name: 'Reja bajarilmagan',
    formula: ['Bajarilish = Fakt ÷ Reja × 100; Yetmadi = Reja − Fakt'],
    meaning: 'Bajarilish chegaradan past bo‘lsa — ogohlantirish.',
  },
  {
    id: 'alertOutlier',
    group: 'ogohlantirish',
    name: 'G‘ayrioddiy katta yozuv',
    formula: ["Barobar = Yozuv summasi ÷ Odatiy yozuv", "Odatiy yozuv — shu moddaning so'nggi 12 oydagi yozuvlari medianasi"],
    meaning: 'Bir yozuv odatdagidan necha barobar katta.',
  },
  {
    id: 'alertDebt',
    group: 'ogohlantirish',
    name: 'Qarz (to‘lanmagan)',
    formula: ["Qarz = to'lanmagan yozuvlar summalari yig'indisi (qisman to'langanda — summa − to'langan)"],
    meaning: 'Tushmagan daromad yoki to‘lanmagan xarajat.',
  },
  // ── Katta modellar (econ.workings.ts → MODEL_FORMULAS)
  {
    id: 'forecast',
    group: 'modellar',
    name: 'Prognoz',
    formula: [
      'Xato e = Haqiqiy − Prognoz; Daraja(t) = Daraja(t−1) + φ×Trend(t−1) + α×e; Trend(t) = φ×Trend(t−1) + β×e; mavsumiy modelda Mavsum(oy) += γ×e',
      "Prognoz(h) = Daraja + (φ + φ² + … + φʰ)×Trend (+ Mavsum); 80% oraliq — 2000 ta simulyatsiya yo'lining 10% va 90% kvantillari",
      'Yil jami = Tugagan oylar (haqiqiy) + Joriy oy (max(yozilgan, prognoz)) + Qolgan oylar (prognoz)',
    ],
    meaning: 'Oxirgi oylar sur’ati, trend va (ma’lumot yetsa) yillik mavsum asosida.',
  },
  {
    id: 'wape',
    group: 'modellar',
    name: 'Ishonchlilik (sinov xatosi)',
    formula: ["WAPE = Σ|Haqiqiy − Model| ÷ Σ|Haqiqiy| × 100", 'Ustunlik = (1 − WAPE ÷ oddiy usul WAPE) × 100'],
    meaning: '10% dan kam — ishonchli, 25% dan kam — o‘rtacha, aks holda taxminiy.',
  },
  {
    id: 'factors',
    group: 'modellar',
    name: 'Omillar (regressiya)',
    formula: [
      "Daromad = a + b₁×Omil₁ + b₂×Omil₂ + … (eng kichik kvadratlar); FE — har hudud o'z o'zgarmasi bilan",
      't = b ÷ SE; 95% oraliq = b ± t* × SE; p < 0,05 — kuchli, p < 0,10 — zaif',
      "Kobb-Duglas: ln(Daromad) = ln A + α×ln(Xodimlar) + β×ln(Xarajat) + trend; α + β > 1 — o'suvchi miqyos",
    ],
    meaning: 'Daromad nimalarga va qanchalik bog‘liq.',
  },
  {
    id: 'efficiency',
    group: 'modellar',
    name: 'Samaradorlik (DEA)',
    formula: [
      'Samaradorlik (CRS) = hudud daromadi ÷ shu resurslar bilan namuna hududlar kombinatsiyasi oladigan daromad',
      'Miqyos = CRS ÷ VRS; Imkoniyat = Daromad ÷ CRS; Farq = Imkoniyat − Daromad',
    ],
    meaning: 'Hududlar bir-biriga nisbatan qanchalik samarali ishlayapti.',
  },
  {
    id: 'breakeven',
    group: 'modellar',
    name: 'Zararsizlik nuqtasi',
    formula: ['Xarajat = F + v × Daromad (regressiya); Zararsizlik = F ÷ (1 − v)', 'Xavfsizlik zaxirasi = (Daromad − Zararsizlik) ÷ Daromad; Leverej = Daromad×(1 − v) ÷ Foyda'],
    meaning: 'Qancha daromaddan boshlab zarar bo‘lmaydi.',
  },
  {
    id: 'risk',
    group: 'modellar',
    name: 'Risk (zararga tushish ehtimoli)',
    formula: ["Daromad va xarajat o'zaro bog'liqligi bilan 2000 marta simulyatsiya qilinadi", 'Ehtimollik = holat yuz bergan yo‘llar ÷ 2000 × 100'],
    meaning: 'Keyingi oylarda zarar ko‘rish ehtimoli.',
  },
];

export const HELP_FORMULAS: HelpFormula[] = [...BASIC, ...OTHER];

// ═══════════════════════════════════════════════════════════
// Atamalar
// ═══════════════════════════════════════════════════════════

export interface Term {
  term: string;
  text: string;
}

export const TERMS: Term[] = [
  { term: 'Daromad', text: "Daromadlar bo'limidagi yozuvlar summasi — hisoblangan (to'langan yoki to'lanmaganidan qat'i nazar)." },
  { term: 'Xarajat', text: "Xarajatlar bo'limidagi yozuvlar: ish haqi, ijara, mashinalar va boshqalar." },
  { term: 'Natija (foyda / zarar)', text: 'Daromad − Xarajat. Musbat — foyda, manfiy — zarar.' },
  { term: 'Doimiy', text: 'Har oy takrorlanadigan daromad yoki xarajat (shartnoma, ish haqi, ijara…).' },
  { term: 'Boshqa (bir martalik)', text: 'Bir martalik yoki tasodifiy yozuvlar.' },
  { term: 'Davr', text: "Yuqori paneldagi «Davr» tugmasida tanlanadi — hamma bo'lim uchun bitta. Oy bilan ishlaydigan sahifalarda davrning oxirgi oyi olinadi." },
  { term: "O'tgan teng davr", text: "Tanlangan davrga teng uzunlikdagi undan oldingi davr. Masalan, 01.10 — 05.10 uchun 26.09 — 30.09." },
  { term: 'Joriy oy', text: "Hali tugamagan oy. Unda summa to'liq emas — Nazorat va prognozlar uni sur'at bo'yicha taxmin qiladi." },
  { term: 'Tugagan oy', text: 'Oxirgi kuni o‘tgan oy — tekshiruvlar (chegara, reja) faqat tugagan oylar bo‘yicha.' },
  { term: 'Tarixiy ko‘rinish', text: "Yuqorida o'tgan oy tanlansa — modellar, Nazorat va Xodimlar o'sha oy oxirida turgandek hisoblanadi; keyingi yozuvlar olinmaydi." },
  { term: 'Rentabellik', text: "Natija ÷ Daromad × 100 — har 100 so'm daromaddan qancha foyda qoladi." },
  { term: 'Tushmagan daromad', text: "Hisoblangan, lekin hali to'lanmagan daromad: Hisoblangan − Tushgan." },
  { term: 'Ulush', text: 'Qism ÷ Jami × 100.' },
  { term: 'Foiz punkti (p.p.)', text: "Ikki foiz orasidagi oddiy ayirma: 20,8% − 18,5% = 2,3 punkt." },
  { term: 'Munosabat', text: "Belgilangan daromad yoki xarajat moddalari bo'yicha kuzatuv: muddat, mas'ullar, avtomatik hisobot va slaydlar." },
  { term: 'Nazorat', text: 'Modda uchun oylik chegara (xarajat) yoki reja (daromad) — har oy avtomatik tekshiriladi.' },
  { term: 'Prognoz', text: "Keyingi oylar uchun model kutayotgan summa va 80% oraliq (10 holatdan 8 tasida haqiqiy summa shu oraliqqa tushadi)." },
  { term: 'Qisqa / To‘liq rejim', text: "Qisqa — rahbar uchun eng muhim raqamlar va xulosalar; To'liq — hamma tafsilot. Manba bo'limlari har doim to'liq." },
  { term: 'Manba', text: "Ma'lumot kiritiladigan bo'limlar: Daromadlar, Xarajatlar, Xodimlar, Sozlamalar. Dasturdagi hamma hisob faqat shulardan olinadi." },
  { term: '«Qanday hisoblandi?»', text: 'Raqam tagidagi nuqtali chiziq yoki «ƒx» belgisi: bosilsa formula, sonlar va bosqichma-bosqich ishlanishi ochiladi.' },
];