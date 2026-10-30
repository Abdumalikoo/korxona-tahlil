// «Oltin raqamlar» — refaktor raqamlarni o'zgartirmaganini isbotlash (faqat LOKAL baza, faqat o'qish).
//   node --env-file=../../packages/db/.env test/golden/golden-local.js --update   — joriy natijalar xeshini saqlash
//   node --env-file=../../packages/db/.env test/golden/golden-local.js            — solishtirish (farq bo'lsa — chiqish kodi 1)
// Asosiy hisoblar (Solishtirma, Markaz, viloyatlar, yo'nalishlar, tarkib, Bosh sahifa › Daromad/Xarajat, hisobotlar
// tekshiruvi, Katta modellar, Hududlar modellari, Qo'mita/3802, kassa, harakat zanjiri) controller'lar orqali
// chaqiriladi; natija kanonik JSON → SHA-256. Faqat xesh saqlanadi (.golden-local/, gitga kirmaydi) — shaxsiy ma'lumot
// diskka ham, ekranga ham chiqmaydi. Fon ishlari (sinxronlash, zaxira, tozalash) ishga tushmaydi.
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const url = process.env.DATABASE_URL || '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.log("DATABASE_URL lokal emas — to'xtatildi");
  process.exit(2);
}
process.env.SOURCE_ARCHIVE_BACKFILL = 'off';
// Ishga tushish hook'laridagi kechiktirilgan fon ishlari (≥ 3 s) — o'tkazib yuboriladi
const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...args) => (Number(ms) >= 3000 ? { unref() {}, ref() {}, hasRef: () => false, refresh() {} } : realSetTimeout(fn, ms, ...args));

require('reflect-metadata');
const dist = (p) => require(path.resolve(__dirname, '../../dist', p));
const { NestFactory } = require('@nestjs/core');
const { Module } = require('@nestjs/common');

const UPDATE = process.argv.includes('--update');
const OUT = path.resolve(__dirname, '../../.golden-local/golden.json');

// Kanonik JSON: kalitlar tartiblangan, BigInt — matn, vaqt belgilari (o'zgaruvchan) olib tashlanadi
const VOLATILE = /^(generatedAt|updatedAt|createdAt|savedAt|computedAt|checkedAt|durationMs|at|now|tookMs)$/;
function canon(v) {
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) if (!VOLATILE.test(k) && v[k] !== undefined) o[k] = canon(v[k]);
    return o;
  }
  return v;
}
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(canon(v))).digest('hex');

(async () => {
  const mods = [
    dist('modules/prisma/prisma.module').PrismaModule,
    dist('modules/audit/audit.module').AuditModule,
    dist('modules/structure/structure.module').StructureModule,
    dist('modules/explore/explore.module').ExploreModule,
    dist('modules/econ/econ.module').EconModule,
    dist('modules/regional-econ/regional-econ.module').RegionalEconModule,
    dist('modules/reports/reports.module').ReportsModule,
    dist('modules/employees/employees.module').EmployeesModule,
    dist('modules/qomita/qomita.module').QomitaModule,
    dist('modules/cashbook/cashbook.module').CashbookModule,
    dist('modules/taxes/taxes.module').TaxesModule,
    dist('modules/fixed-assets/fixed-assets.module').FixedAssetsModule,
    dist('modules/payroll-facts/payroll-facts.module').PayrollFactsModule,
    dist('modules/source-archive/source-archive.module').SourceArchiveModule,
  ];
  class GoldenModule {}
  Module({ imports: mods })(GoldenModule);
  const app = await NestFactory.createApplicationContext(GoldenModule, { logger: ['error'] });
  const get = (file, name) => app.get(dist(file)[name], { strict: false });
  const regions = get('modules/structure/regions.controller', 'RegionsController');
  const structure = get('modules/structure/structure.controller', 'StructureController');
  const districts = get('modules/structure/districts.controller', 'DistrictsController');
  const explore = get('modules/explore/explore.controller', 'ExploreController');
  const reports = get('modules/reports/reports.controller', 'ReportsController');
  const econ = get('modules/econ/econ.controller', 'EconController');
  const rEcon = get('modules/regional-econ/regional-econ.controller', 'RegionalEconController');
  const hisob = get('modules/qomita/hisob-3802.service', 'Hisob3802Service');
  const nz = get('modules/qomita/nazorat-3802.service', 'Nazorat3802Service');
  const qomita = get('modules/qomita/qomita.service', 'QomitaService');
  const center = get('modules/cashbook/center-income.service', 'CenterIncomeService');
  const chain = get('modules/employees/employee-chain.service', 'EmployeeChainService');

  const Y = ['2026-01-01', '2026-09-30'];
  const Q = ['2026-07-01', '2026-09-30'];
  const cases = [
    ['solishtirma.yil', () => regions.compare(...Y, 'ALL', 'prev')],
    ['solishtirma.chorak', () => regions.compare(...Q, 'ALL', 'prev')],
    ['solishtirma.yillik-solishtirish', () => regions.compare(...Q, 'ALL', 'yoy')],
    ...['TAX_FREE', 'MARKSHEYDER', 'FERMER', 'BUXGALTERIYA', 'QOMITA'].map((c) => [`yonalish.${c}`, () => regions.segment(c, ...Y, 'ALL', 'prev')]),
    ['markaz', () => districts.center(...Y, 'ALL', 'prev')],
    ['viloyat.10', () => districts.region('10', ...Y, 'ALL', 'prev')],
    ['viloyat.3', () => districts.region('3', ...Y, 'ALL', 'prev')],
    ['tarkib.flow', () => structure.flow(...Y, 'ALL', 'prev')],
    ['tarkib.daromad', () => structure.tree('income', ...Y, 'ALL', '', 'prev', undefined)],
    ['tarkib.xarajat', () => structure.tree('expense', ...Y, 'ALL', '', 'prev', undefined)],
    ['explore.daromad', () => explore.income(...Y)],
    ['explore.xarajat', () => explore.expense(...Y)],
    ['explore.natija', () => explore.result(...Y)],
    ['explore.xarajat.chorak', () => explore.expense(...Q)],
    ['hisobot.tekshiruv', () => reports.check(...Y)],
    ['econ.overview', () => econ.overview('2026-09')],
    ['econ.efficiency', () => econ.efficiency('12', 'resources', '2026-09')],
    ['econ.breakeven', () => econ.breakeven('12', '2026-09')],
    ['hudud.dashboard', () => rEcon.dashboard('2026-09')],
    ['hudud.potential', () => rEcon.potential('2026-09', '3')],
    ['hudud.forecast', () => rEcon.forecast('2026-09', '3')],
    ['qomita.3802-hisob', () => hisob.ledger('2026-01', '2026-10')],
    ['qomita.sarf', () => nz.sarf('2026-01', '2026-09')],
    ['qomita.report', () => qomita.report('2026-01', '2026-09')],
    ['kassa.yil', () => center.year(2026)],
    ['xodim.zanjir', () => chain.report('2026-01', '2026-10')],
  ];

  const results = {};
  let failed = 0;
  for (const [name, fn] of cases) {
    try {
      const a = hash(await fn());
      const b = hash(await fn());
      results[name] = a === b ? a : `NONDETERMINISTIC:${a}`;
    } catch (e) {
      results[name] = `ERROR:${String(e && e.message).slice(0, 120)}`;
    }
  }
  await app.close();

  if (UPDATE) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ savedAt: new Date().toISOString(), results }, null, 2));
    for (const [k, v] of Object.entries(results)) console.log(`${v.startsWith('ERROR') || v.startsWith('NON') ? '!' : '•'} ${k}: ${v.slice(0, 16)}${v.length > 64 ? '' : '…'}`);
    console.log(`\nSaqlandi: ${Object.keys(results).length} ta hisob → ${path.relative(process.cwd(), OUT)}`);
    process.exit(0);
  }
  if (!fs.existsSync(OUT)) {
    console.log('Oltin xeshlar yo‘q — avval --update bilan saqlang');
    process.exit(2);
  }
  const before = JSON.parse(fs.readFileSync(OUT, 'utf8')).results;
  for (const [k, v] of Object.entries(results)) {
    const ok = before[k] === v;
    if (!ok) failed += 1;
    console.log(`${ok ? '✓' : '✗'} ${k}${ok ? '' : `  (avval ${String(before[k]).slice(0, 16)}…, hozir ${v.slice(0, 16)}…)`}`);
  }
  console.log(failed ? `\n${failed} ta hisob O'ZGARDI` : `\nHammasi bir xil: ${Object.keys(results).length} ta hisob`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
