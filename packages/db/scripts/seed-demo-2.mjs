/**
 * Demo ma'lumotlar — 2-qism: ish haqi, ish haqi tarkibi, xodim natijalari,
 * hududlar tushumi (shablon tuzilmasida), ijara va qo'shimcha xarajat turlari.
 *
 *   node scripts/seed-demo-2.mjs            — qo'shish (bor bo'lsa to'xtaydi)
 *   node scripts/seed-demo-2.mjs --replace  — 2-qism demosini o'chirib, qaytadan yaratish
 *   node scripts/seed-demo-2.mjs --clean    — faqat 2-qism demosini o'chirish
 *
 * Haqiqiy ma'lumotga tegilmaydi:
 *   - haqiqiy ish haqi yuklangan oylarga demo ish haqi yozilmaydi;
 *   - haqiqiy natijalar yoki tarkib yuklangan oylar o'tkazib yuboriladi.
 * Hamma demo yozuvlar "[DEMO]" belgisi bilan (fayl nomi, izoh yoki kod "DEMO_").
 */

import prismaPkg from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ═══════════════════════════════════════════════════════════
// Sozlamalar
// ═══════════════════════════════════════════════════════════

const MARK = '[DEMO]';
const START_PERIOD = '2025-01';
/** Haqiqiy ish haqi boshlangan oy — undan oldingi oylar shu darajadan kamaytirib hisoblanadi */
const SALARY_REFERENCE = '2026-01';
const SALARY_MONTHLY_GROWTH = 0.012;

const EXTRA_EXPENSE_ROWS_PER_MONTH = 300;
const EXTRA_EXPENSE_MONTHLY_SOM = 1_100_000_000;

/** Qo'shimcha xarajat turlari: [kod, nom, ota, xulq, mavsum, o'rtacha summa (so'm)] */
const EXTRA_PARENTS = [
  ['DEMO_XOJALIK', "Xo'jalik va ta'minot"],
  ['DEMO_SAFAR', 'Xizmat safarlari'],
  ['DEMO_XAVFSIZLIK', "Xavfsizlik va qo'riqlash"],
  ['DEMO_ALOQA', 'Aloqa va pochta'],
  ['DEMO_IT', 'IT infratuzilma'],
  ['DEMO_HUQUQ', 'Huquqiy va konsalting xizmatlari'],
  ['DEMO_IJTIMOIY', 'Ijtimoiy xarajatlar'],
  ['DEMO_BINO', 'Bino va hudud'],
];
const EXTRA_LEAVES = [
  ['DEMO_XOJ_TOZALASH', 'Tozalash vositalari', 'DEMO_XOJALIK', 'VARIABLE', null, 1_200_000],
  ['DEMO_XOJ_SUV', 'Ichimlik suvi', 'DEMO_XOJALIK', 'VARIABLE', 'summer', 600_000],
  ['DEMO_XOJ_CHOY', 'Choy, qahva va mehmon kutish', 'DEMO_XOJALIK', 'VARIABLE', null, 900_000],
  ['DEMO_XOJ_MEBEL', 'Mebel', 'DEMO_XOJALIK', 'VARIABLE', null, 8_000_000],
  ['DEMO_XOJ_KANS', 'Kanselyariya tovarlari', 'DEMO_XOJALIK', 'VARIABLE', null, 1_500_000],
  ['DEMO_XOJ_FORMA', 'Maxsus kiyim', 'DEMO_XOJALIK', 'VARIABLE', null, 4_000_000],
  ['DEMO_SAFAR_YOL', "Yo'l chiptalari", 'DEMO_SAFAR', 'VARIABLE', null, 1_800_000],
  ['DEMO_SAFAR_MEHMONXONA', 'Mehmonxona', 'DEMO_SAFAR', 'VARIABLE', null, 2_500_000],
  ['DEMO_SAFAR_SUTKA', 'Sutkalik', 'DEMO_SAFAR', 'VARIABLE', null, 900_000],
  ['DEMO_SAFAR_XORIJ', 'Xorijiy safarlar', 'DEMO_SAFAR', 'VARIABLE', null, 15_000_000],
  ['DEMO_XAV_QORIQLASH', "Qo'riqlash xizmati", 'DEMO_XAVFSIZLIK', 'FIXED', null, 12_000_000],
  ['DEMO_XAV_KAMERA', 'Videokuzatuv', 'DEMO_XAVFSIZLIK', 'MIXED', null, 3_500_000],
  ['DEMO_XAV_YONGIN', "Yong'in xavfsizligi", 'DEMO_XAVFSIZLIK', 'MIXED', null, 2_000_000],
  ['DEMO_ALOQA_MOBIL', 'Mobil aloqa', 'DEMO_ALOQA', 'FIXED', null, 2_200_000],
  ['DEMO_ALOQA_POCHTA', 'Pochta va kuryer', 'DEMO_ALOQA', 'VARIABLE', null, 700_000],
  ['DEMO_ALOQA_TELEFON', 'Statsionar telefon', 'DEMO_ALOQA', 'FIXED', null, 900_000],
  ['DEMO_IT_SERVER', 'Server va hosting', 'DEMO_IT', 'FIXED', null, 9_000_000],
  ['DEMO_IT_KOMPYUTER', 'Kompyuterlar', 'DEMO_IT', 'VARIABLE', null, 12_000_000],
  ['DEMO_IT_PRINTER', 'Printer va kartrij', 'DEMO_IT', 'VARIABLE', null, 1_600_000],
  ['DEMO_IT_TARMOQ', 'Tarmoq jihozlari', 'DEMO_IT', 'VARIABLE', null, 5_000_000],
  ['DEMO_IT_LITSENZIYA', 'Dasturiy litsenziyalar', 'DEMO_IT', 'FIXED', null, 7_000_000],
  ['DEMO_IT_XAVFSIZLIK', 'Antivirus va kiberxavfsizlik', 'DEMO_IT', 'FIXED', null, 3_000_000],
  ['DEMO_HUQ_NOTARIUS', 'Notarius', 'DEMO_HUQUQ', 'VARIABLE', null, 800_000],
  ['DEMO_HUQ_ADVOKAT', 'Advokat xizmati', 'DEMO_HUQUQ', 'VARIABLE', null, 6_000_000],
  ['DEMO_HUQ_AUDIT', 'Tashqi audit', 'DEMO_HUQUQ', 'VARIABLE', null, 25_000_000],
  ['DEMO_HUQ_BAHOLASH', 'Baholash xizmati', 'DEMO_HUQUQ', 'VARIABLE', null, 4_000_000],
  ['DEMO_HUQ_SUD', 'Sud xarajatlari', 'DEMO_HUQUQ', 'VARIABLE', null, 2_500_000],
  ['DEMO_IJT_TIBBIY', "Tibbiy ko'rik", 'DEMO_IJTIMOIY', 'VARIABLE', null, 5_000_000],
  ['DEMO_IJT_SPORT', 'Sport tadbirlari', 'DEMO_IJTIMOIY', 'VARIABLE', 'summer', 6_000_000],
  ['DEMO_IJT_BAYRAM', 'Bayram tadbirlari', 'DEMO_IJTIMOIY', 'VARIABLE', 'holiday', 18_000_000],
  ['DEMO_IJT_SOVGA', "Sovg'alar", 'DEMO_IJTIMOIY', 'VARIABLE', 'holiday', 7_000_000],
  ['DEMO_IJT_YORDAM', 'Moddiy yordam', 'DEMO_IJTIMOIY', 'VARIABLE', null, 3_000_000],
  ['DEMO_BINO_ELEKTR', 'Elektr energiyasi', 'DEMO_BINO', 'MIXED', 'summer', 9_000_000],
  ['DEMO_BINO_GAZ', 'Tabiiy gaz', 'DEMO_BINO', 'MIXED', 'winter', 6_000_000],
  ['DEMO_BINO_ISITISH', 'Isitish', 'DEMO_BINO', 'MIXED', 'winter', 8_000_000],
  ['DEMO_BINO_SUV', 'Suv va kanalizatsiya', 'DEMO_BINO', 'MIXED', null, 1_500_000],
  ['DEMO_BINO_CHIQINDI', 'Chiqindi olib ketish', 'DEMO_BINO', 'FIXED', null, 700_000],
  ['DEMO_BINO_LIFT', 'Lift xizmati', 'DEMO_BINO', 'FIXED', null, 1_200_000],
  ['DEMO_BINO_KORKAM', 'Obodonlashtirish', 'DEMO_BINO', 'VARIABLE', 'summer', 4_500_000],
  ['DEMO_BINO_KAPITAL', "Kapital ta'mir", 'DEMO_BINO', 'VARIABLE', null, 40_000_000],
  ['DEMO_MKT_SMM', 'SMM va ijtimoiy tarmoqlar', 'MARKETING', 'VARIABLE', null, 4_000_000],
  ['DEMO_MKT_BANNER', 'Banner va tashqi reklama', 'MARKETING', 'VARIABLE', null, 6_000_000],
  ['DEMO_MKT_TV', 'Televideniye va radio reklamasi', 'MARKETING', 'VARIABLE', null, 20_000_000],
  ['DEMO_MKT_POLIGRAFIYA', 'Poligrafiya', 'MARKETING', 'VARIABLE', null, 3_000_000],
];

const SUPPLIERS = [
  'Demo Xizmat MCHJ', 'Demo Servis Plus', 'Demo Ta’minot Markazi', 'Demo Texno Savdo', 'Demo Energo Sotuv',
  'Demo Huquq Konsalt', 'Demo Audit Group', 'Demo Qo‘riqlash', 'Demo Pochta Ekspress', 'Demo Reklama Agentligi',
];
const LESSORS = ['Demo Mulk MCHJ', 'Demo Invest Estate', 'Demo Biznes Markaz', 'Demo Aeroport Xizmatlari', 'Demo Hokimiyat mulki'];
const AIRPORTS = [
  [26, 'Toshkent xalqaro aeroporti'],
  [18, 'Samarqand xalqaro aeroporti'],
  [6, 'Buxoro xalqaro aeroporti'],
  [30, "Farg'ona aeroporti"],
];

// ═══════════════════════════════════════════════════════════
// .env
// ═══════════════════════════════════════════════════════════

const here = dirname(fileURLToPath(import.meta.url));
for (const file of [resolve(here, '../.env'), resolve(here, '../prisma/.env'), resolve(process.cwd(), '.env')]) {
  if (process.env.DATABASE_URL || !existsSync(file)) continue;
  const match = /^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?\s*$/m.exec(readFileSync(file, 'utf8'));
  if (match) process.env.DATABASE_URL = match[1];
}

// ═══════════════════════════════════════════════════════════
// Tasodifiy sonlar
// ═══════════════════════════════════════════════════════════

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260929);
const between = (a, b) => a + rand() * (b - a);
const int = (a, b) => Math.floor(between(a, b + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const chance = (p) => rand() < p;
function lognormal(median, sigma) {
  const u = 1 - rand();
  const v = rand();
  return median * Math.exp(sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
}
function weighted(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let r = rand() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}
/** So'm → tiyin, qadam bilan yaxlitlab */
function tiyin(som, step = 1000) {
  return BigInt(Math.max(step, Math.round(som / step) * step)) * 100n;
}
const sha = () => createHash('sha256').update(randomUUID()).digest('hex');

// ═══════════════════════════════════════════════════════════
// Sanalar
// ═══════════════════════════════════════════════════════════

const now = new Date(Date.now() + 5 * 3600_000);
const TODAY = { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1, d: now.getUTCDate() };
const CURRENT_PERIOD = `${TODAY.y}-${String(TODAY.m).padStart(2, '0')}`;

function periods(from, to) {
  const result = [];
  let [y, m] = from.split('-').map(Number);
  while (`${y}-${String(m).padStart(2, '0')}` <= to) {
    result.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m === 13) { y += 1; m = 1; }
  }
  return result;
}
function monthsBetween(a, b) {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}
function daysIn(period) {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return period === CURRENT_PERIOD ? Math.min(last, TODAY.d) : last;
}
function dateOf(period, day) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
/** Oyning oxirgi kuni, Toshkent yarim tuni — ish haqi va hududlar tushumi xizmatidagidek */
function periodEndDate(period) {
  const [y, m] = period.split('-').map(Number);
  const nextMonth = m === 12 ? 1 : m + 1;
  const nextYear = m === 12 ? y + 1 : y;
  return new Date(Date.UTC(nextYear, nextMonth - 1, 1, -5) - 86_400_000);
}
function season(period, amplitude, phase) {
  const month = Number(period.slice(5));
  return 1 + amplitude * Math.sin((2 * Math.PI * (month - phase)) / 12);
}

// ═══════════════════════════════════════════════════════════
// Prisma
// ═══════════════════════════════════════════════════════════

const { PrismaClient } = prismaPkg;
const prisma = new PrismaClient();

async function chunked(model, rows, size = 1000) {
  for (let i = 0; i < rows.length; i += size) {
    await prisma[model].createMany({ data: rows.slice(i, i + size) });
  }
}

// ═══════════════════════════════════════════════════════════
// Tozalash
// ═══════════════════════════════════════════════════════════

async function clean() {
  const counts = {};

  // Ish haqi tarkibi
  const compBatches = await prisma.salaryCompositionBatch.findMany({
    where: { fileName: { startsWith: MARK } },
    select: { id: true },
  });
  const compIds = compBatches.map((b) => b.id);
  if (compIds.length) {
    counts.tarkibElement = (await prisma.salaryCompositionItem.deleteMany({ where: { batchId: { in: compIds } } })).count;
    await prisma.salaryCompositionRow.deleteMany({ where: { batchId: { in: compIds } } });
    counts.tarkibOy = (await prisma.salaryCompositionBatch.deleteMany({ where: { id: { in: compIds } } })).count;
  }

  // Xodim natijalari va shu oylar hudud tarixi
  const resultBatches = await prisma.resultBatch.findMany({
    where: { fileName: { startsWith: MARK } },
    select: { id: true },
  });
  const resultIds = resultBatches.map((b) => b.id);
  if (resultIds.length) {
    const results = await prisma.employeeResult.findMany({
      where: { batchId: { in: resultIds } },
      select: { employeePinfl: true, period: true },
    });
    const byPeriod = new Map();
    for (const r of results) byPeriod.set(r.period, [...(byPeriod.get(r.period) ?? []), r.employeePinfl]);
    let locations = 0;
    for (const [period, pinfls] of byPeriod) {
      for (let i = 0; i < pinfls.length; i += 1000) {
        locations += (
          await prisma.employeeLocation.deleteMany({
            where: { period, source: 'RESULTS', employeePinfl: { in: pinfls.slice(i, i + 1000) } },
          })
        ).count;
      }
    }
    counts.hududTarixi = locations;
    counts.natija = (await prisma.employeeResult.deleteMany({ where: { batchId: { in: resultIds } } })).count;
    await prisma.resultBatch.deleteMany({ where: { id: { in: resultIds } } });
  }

  // Ish haqi yuklamalari va ularning xarajatlari
  const payrollBatches = await prisma.payrollBatch.findMany({
    where: { fileName: { startsWith: MARK } },
    select: { id: true },
  });
  const payrollIds = payrollBatches.map((b) => b.id);
  if (payrollIds.length) {
    counts.ishHaqiXarajat = (await prisma.expense.deleteMany({ where: { payrollBatchId: { in: payrollIds } } })).count;
    counts.ishHaqiYozuv = (await prisma.payrollEntry.deleteMany({ where: { batchId: { in: payrollIds } } })).count;
    counts.ishHaqiOy = (await prisma.payrollBatch.deleteMany({ where: { id: { in: payrollIds } } })).count;
  }

  // Ijara: shartnomalar, oylik hisoblar, oy yopishlar, xarajatlar
  const leases = await prisma.lease.findMany({ where: { note: { startsWith: MARK } }, select: { id: true } });
  const leaseIds = leases.map((l) => l.id);
  if (leaseIds.length) {
    const accruals = await prisma.leaseAccrual.findMany({
      where: { leaseId: { in: leaseIds } },
      select: { closeId: true, expenseId: true },
    });
    const expenseIds = accruals.map((a) => a.expenseId).filter(Boolean);
    for (let i = 0; i < expenseIds.length; i += 1000) {
      await prisma.expense.deleteMany({ where: { id: { in: expenseIds.slice(i, i + 1000) } } });
    }
    counts.ijaraXarajat = expenseIds.length;
    const closeIds = [...new Set(accruals.map((a) => a.closeId))];
    await prisma.leaseAccrual.deleteMany({ where: { leaseId: { in: leaseIds } } });
    // Faqat demo hisoblardan iborat bo'lgan oy yopishlar o'chiriladi
    for (const closeId of closeIds) {
      const left = await prisma.leaseAccrual.count({ where: { closeId } });
      if (left === 0) await prisma.leaseMonthClose.delete({ where: { id: closeId } });
    }
    counts.ijaraOy = closeIds.length;
    counts.ijara = (await prisma.lease.deleteMany({ where: { id: { in: leaseIds } } })).count;
  }

  // Hududlar tushumi (shablon bo'yicha)
  counts.hududlarTushumi = (
    await prisma.income.deleteMany({
      where: { description: { startsWith: MARK }, source: 'IMPORT', regionCode: { not: null }, quantity: { not: null } },
    })
  ).count;

  // Qo'shimcha xarajat turlari: avval xarajatlar, keyin kategoriyalar
  counts.qoshimchaXarajat = (await prisma.expense.deleteMany({ where: { categoryCode: { startsWith: 'DEMO_' } } })).count;
  await prisma.category.deleteMany({ where: { code: { startsWith: 'DEMO_' }, isLeaf: true } });
  counts.kategoriya = (await prisma.category.deleteMany({ where: { code: { startsWith: 'DEMO_' } } })).count;

  console.log("O'chirildi:", counts);
}

// ═══════════════════════════════════════════════════════════
// Ma'lumotnomalar
// ═══════════════════════════════════════════════════════════

async function loadReferences(months) {
  const user = (await prisma.user.findFirst({ where: { role: 'ADMIN' } })) ?? (await prisma.user.findFirst());
  if (!user) throw new Error('Foydalanuvchi topilmadi');

  // 99 — «Hududlar umumiy», viloyat emas (demo xodim / ma'lumot yozilmaydi)
  const regions = await prisma.region.findMany({ where: { isActive: true, code: { not: 99 } }, orderBy: { code: 'asc' } });
  const departments = await prisma.department.findMany({ where: { isActive: true }, orderBy: { order: 'asc' } });
  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    include: {
      region: { select: { name: true } },
      department: { select: { name: true } },
      district: { select: { name: true } },
    },
  });
  const components = await prisma.salaryComponent.findMany({ where: { isActive: true } });
  const incomeCategories = await prisma.incomeCategory.findMany({ where: { isActive: true } });

  // Har xodimning oxirgi haqiqiy oyligi (tasdiqlangan yuklamalardan)
  const entries = await prisma.payrollEntry.findMany({
    where: { deletedAt: null, totalTiyin: { gt: 0n }, batch: { status: 'COMMITTED', NOT: { fileName: { startsWith: MARK } } } },
    select: { employeePinfl: true, period: true, totalTiyin: true },
    orderBy: { period: 'desc' },
  });
  const latestSalary = new Map();
  for (const e of entries) if (!latestSalary.has(e.employeePinfl)) latestSalary.set(e.employeePinfl, e.totalTiyin);

  // Band oylar — bu oylarga demo yozilmaydi
  const realPayroll = new Set(
    (await prisma.payrollBatch.findMany({
      where: { status: 'COMMITTED', NOT: { fileName: { startsWith: MARK } } },
      select: { period: true },
    })).map((b) => b.period),
  );
  const realResults = new Set(
    (await prisma.resultBatch.findMany({ where: { cancelledAt: null }, select: { period: true } })).map((b) => b.period),
  );
  const realComposition = new Set(
    (await prisma.salaryCompositionBatch.findMany({ where: { cancelledAt: null }, select: { period: true } })).map((b) => b.period),
  );
  const closedLease = new Set(
    (await prisma.leaseMonthClose.findMany({ where: { cancelledAt: null }, select: { period: true } })).map((c) => c.period),
  );
  const existingLocations = new Set(
    (await prisma.employeeLocation.findMany({
      where: { period: { in: months } },
      select: { employeePinfl: true, period: true },
    })).map((l) => `${l.employeePinfl}|${l.period}`),
  );

  return {
    user, regions, departments, employees, components, incomeCategories,
    latestSalary, realPayroll, realResults, realComposition, closedLease, existingLocations,
  };
}

// ═══════════════════════════════════════════════════════════
// 1. Ish haqi — haqiqiy xodimlar asosida
// ═══════════════════════════════════════════════════════════

/** Xodim xarajat guruhi — ish haqi xizmatidagi qoida bilan bir xil */
function groupOf(employee) {
  if (employee.employmentType === 'SHARTNOMA') {
    return { key: 'shartnoma', label: 'Shartnoma asosidagi ish haqi', departmentId: null, regionCode: null };
  }
  if (employee.regionCode === 0) {
    return {
      key: `markaz-${employee.departmentId ?? 'none'}`,
      label: `Ish haqi — ${employee.department?.name ?? 'bolimsiz'}`,
      departmentId: employee.departmentId,
      regionCode: 0,
    };
  }
  return {
    key: `region-${employee.regionCode}`,
    label: `Ish haqi — ${employee.region?.name ?? employee.regionCode}`,
    departmentId: null,
    regionCode: employee.regionCode,
  };
}

function buildPayroll(refs, months) {
  const staff = refs.employees.filter((e) => refs.latestSalary.has(e.pinfl));
  // Kim qachondan ishlay boshlagan: ko'pchilik boshidan, qolganlari 2025 yil davomida
  const startIndex = new Map(staff.map((e) => [e.pinfl, chance(0.8) ? 0 : int(1, 12)]));
  const vacationMonth = new Map(staff.map((e) => [e.pinfl, int(6, 9)]));

  const batches = [];
  const entries = [];
  const expenses = [];

  months.forEach((period, index) => {
    if (refs.realPayroll.has(period)) return;
    const month = Number(period.slice(5));
    const back = monthsBetween(period, SALARY_REFERENCE); // mos oygacha qolgan oylar
    const level = 1 / (1 + SALARY_MONTHLY_GROWTH) ** Math.max(0, back);

    const batchId = `demo_pb_${randomUUID()}`;
    const date = periodEndDate(period);
    const groups = new Map();
    let total = 0n;
    let rows = 0;

    for (const employee of staff) {
      if (index < startIndex.get(employee.pinfl)) continue;
      let factor = level * lognormal(1, 0.04);
      if (month === 3) factor *= 1.08; // 8-mart
      if (month === 12) factor *= 1.18; // yil yakuni
      if (vacationMonth.get(employee.pinfl) === month) factor *= 1.35; // ta'til puli
      const amount = (BigInt(Math.round(Number(refs.latestSalary.get(employee.pinfl)) * factor / 100)) * 100n);
      rows += 1;
      total += amount;
      entries.push({
        employeePinfl: employee.pinfl,
        period,
        baseTiyin: amount,
        totalTiyin: amount,
        batchId,
      });
      const group = groupOf(employee);
      const current = groups.get(group.key) ?? { ...group, total: 0n, count: 0 };
      current.total += amount;
      current.count += 1;
      groups.set(group.key, current);
    }

    if (rows === 0) return;
    batches.push({
      id: batchId,
      period,
      status: 'COMMITTED',
      fileName: `${MARK} Ish-haqi-${period}.xlsx`,
      fileHash: sha(),
      totalRows: rows,
      matchedRows: rows,
      missingRows: 0,
      missingPinfls: [],
      totalTiyin: total,
      uploadedById: refs.user.id,
      committedAt: date,
    });
    for (const group of groups.values()) {
      if (group.total <= 0n) continue;
      expenses.push({
        date,
        period,
        amountTiyin: group.total,
        categoryCode: 'PAYROLL_BASE',
        departmentId: group.departmentId,
        regionCode: group.regionCode,
        description: `${MARK} ${group.label} (${group.count} xodim)`,
        paymentMethod: 'BANK',
        paymentStatus: 'PAID',
        source: 'PAYROLL',
        section: 'DOIMIY',
        payrollBatchId: batchId,
        createdById: refs.user.id,
      });
    }
  });

  return { batches, entries, expenses, staffCount: staff.length };
}

// ═══════════════════════════════════════════════════════════
// 2. Ish haqi tarkibi — har xodim oyligi komponentlarga bo'linadi
// ═══════════════════════════════════════════════════════════

function splitSalary(totalTiyin, month, codes) {
  const T = Number(totalTiyin) / 100;
  const parts = {};
  const add = (code, som) => {
    if (som > 0) parts[code] = (parts[code] ?? 0) + som;
  };

  if (chance(0.7)) add('TRANSPORT', between(250_000, 450_000));
  if (chance(0.6)) add('OVQAT', between(300_000, 550_000));
  if (chance(0.55)) add('KPI', T * between(0.08, 0.2));
  if (chance(0.2)) add('SERTIFIKAT', T * between(0.05, 0.12));
  if (chance(0.15)) add('USTAMA_BOSHQA', T * between(0.03, 0.08));
  if ((month === 3 || month === 12) && chance(0.9)) add('BAYRAM', T * between(0.05, 0.12));
  if (month >= 6 && month <= 9 && chance(0.22)) add('TATIL', T * between(0.2, 0.35));
  if (chance(0.03)) add('TATIL_KOMP', T * between(0.05, 0.15));
  if (chance(0.04)) add('KASALLIK', T * between(0.03, 0.1));
  if (chance(0.01)) add('DEKRET', T * between(0.2, 0.4));
  if (chance(0.05)) add('MODDIY', T * between(0.05, 0.15));
  if (chance(0.06)) add('PREMIYA_BOSHQA', T * between(0.02, 0.06));
  if (chance(0.06)) add('BOSHQA', T * between(0.01, 0.04));
  const penalty = chance(0.03) ? Math.min(T * 0.03, 300_000) : 0;

  // Qo'shimchalar oyligining 55% idan oshmasin
  const extras = Object.values(parts).reduce((a, b) => a + b, 0);
  if (extras > T * 0.55) {
    const k = (T * 0.55) / extras;
    for (const key of Object.keys(parts)) parts[key] *= k;
  }
  const rest = T - Object.values(parts).reduce((a, b) => a + b, 0) + penalty;
  const staj = between(0.05, 0.2);
  const oklad = rest / (1.4 + staj);
  parts.OKLAD_40 = oklad * 0.4;
  parts.STAJ = oklad * staj;
  if (penalty > 0) parts.JARIMA = penalty;

  // Tiyinga o'tkazish; mavjud bo'lmagan komponent Okladga qo'shiladi
  const items = new Map();
  let signed = 0n;
  for (const [code, som] of Object.entries(parts)) {
    const target = codes.has(code) ? code : 'OKLAD';
    const amount = BigInt(Math.round(som)) * 100n;
    if (amount <= 0n) continue;
    items.set(target, (items.get(target) ?? 0n) + amount);
    signed += code === 'JARIMA' && codes.has('JARIMA') ? -amount : amount;
  }
  // Oklad — qoldiq: jami aynan soliq hisobotidagiga teng bo'ladi
  const oklad0 = totalTiyin - signed;
  items.set('OKLAD', (items.get('OKLAD') ?? 0n) + oklad0);
  if (items.get('OKLAD') <= 0n) return [{ code: 'OKLAD', amountTiyin: totalTiyin }];
  return [...items.entries()].map(([code, amountTiyin]) => ({ code, amountTiyin }));
}

async function buildComposition(refs, months) {
  const codes = new Set(refs.components.map((c) => c.code));
  if (!codes.has('OKLAD')) {
    console.warn("Diqqat: OKLAD komponenti topilmadi — ish haqi tarkibi o'tkazib yuboriladi");
    return { batches: [], rows: [], items: [] };
  }
  const names = new Map(refs.employees.map((e) => [e.pinfl, e.fullName]));

  const batches = [];
  const rows = [];
  const items = [];

  for (const period of months) {
    if (refs.realComposition.has(period)) continue;
    // Shu oy tasdiqlangan ish haqi (haqiqiy yoki demo) — xizmat solishtiradigan summa
    const grouped = await prisma.payrollEntry.groupBy({
      by: ['employeePinfl'],
      where: { period, deletedAt: null, batch: { status: 'COMMITTED' } },
      _sum: { totalTiyin: true },
    });
    const people = grouped.filter((g) => (g._sum.totalTiyin ?? 0n) > 0n);
    if (people.length === 0) continue;

    const month = Number(period.slice(5));
    const batchId = `demo_sc_${randomUUID()}`;
    let total = 0n;

    for (const person of people) {
      const amount = person._sum.totalTiyin;
      const rowId = `demo_sr_${randomUUID()}`;
      total += amount;
      rows.push({
        id: rowId,
        batchId,
        period,
        employeePinfl: person.employeePinfl,
        fullName: names.get(person.employeePinfl) ?? null,
        workedDays: chance(0.9) ? int(20, 23) : int(8, 19),
        rate: chance(0.9) ? 1 : 0.5,
        totalTiyin: amount,
      });
      for (const part of splitSalary(amount, month, codes)) {
        items.push({ batchId, rowId, componentCode: part.code, amountTiyin: part.amountTiyin });
      }
    }

    batches.push({
      id: batchId,
      period,
      fileName: `${MARK} Tarkib-${period}.xlsx`,
      employeeCount: people.length,
      totalTiyin: total,
      payrollTiyin: total,
      status: 'MATCHED',
      mismatchCount: 0,
      uploadedById: refs.user.id,
    });
  }
  return { batches, rows, items };
}

// ═══════════════════════════════════════════════════════════
// 3. Xodim natijalari — shablon: reja, tushum, ustama
// ═══════════════════════════════════════════════════════════

function bonusOf(plan, fact) {
  if (plan <= 0n) return 0n;
  const percent = Number((fact * 10000n) / plan) / 100;
  if (percent < 80) return 0n;
  if (percent <= 95) return (fact * 25n) / 100n;
  return (fact * 45n) / 100n;
}

function buildResults(refs, months) {
  const field = refs.employees.filter((e) => e.regionCode !== 0);
  const planBase = new Map(field.map((e) => [e.pinfl, lognormal(e.employmentType === 'SHTAT' ? 34_000_000 : 22_000_000, 0.45)]));
  const skill = new Map(field.map((e) => [e.pinfl, lognormal(0.97, 0.08)]));

  const batches = [];
  const results = [];
  const locations = [];
  /** period → regionCode → jami tushum (tiyin) — hududlar tushumi shunga moslanadi */
  const factByRegion = new Map();

  months.forEach((period, index) => {
    if (refs.realResults.has(period) || field.length === 0) return;
    const batchId = `demo_rb_${randomUUID()}`;
    const growth = (1 + 0.012) ** index;
    const s = season(period, 0.12, 4);
    const totals = { plan: 0n, fact: 0n, bonus: 0n };
    const regionTotals = new Map();
    let count = 0;

    for (const employee of field) {
      const plan = tiyin(planBase.get(employee.pinfl) * growth * s);
      const ratio = Math.min(1.6, Math.max(0.3, skill.get(employee.pinfl) * lognormal(1, 0.12)));
      const fact = tiyin(Number(plan / 100n) * ratio);
      const bonus = bonusOf(plan, fact);
      totals.plan += plan;
      totals.fact += fact;
      totals.bonus += bonus;
      regionTotals.set(employee.regionCode, (regionTotals.get(employee.regionCode) ?? 0n) + fact);
      count += 1;

      results.push({
        batchId,
        period,
        employeePinfl: employee.pinfl,
        regionCode: employee.regionCode,
        districtId: employee.districtId,
        employmentType: employee.employmentType,
        planTiyin: plan,
        factTiyin: fact,
        bonusTiyin: bonus,
      });
      if (!refs.existingLocations.has(`${employee.pinfl}|${period}`)) {
        locations.push({
          employeePinfl: employee.pinfl,
          period,
          regionCode: employee.regionCode,
          districtId: employee.districtId,
          employmentType: employee.employmentType,
          source: 'RESULTS',
        });
      }
    }

    factByRegion.set(period, regionTotals);
    batches.push({
      id: batchId,
      period,
      fileName: `${MARK} Natijalar-${period}.xlsx`,
      totalRows: count,
      planTiyin: totals.plan,
      factTiyin: totals.fact,
      bonusTiyin: totals.bonus,
      movedCount: 0,
      uploadedById: refs.user.id,
      createdAt: periodEndDate(period),
    });
  });

  return { batches, results, locations, factByRegion };
}

// ═══════════════════════════════════════════════════════════
// 4. Hududlar tushumi — shablon: hudud × xizmat, soni va summasi
// ═══════════════════════════════════════════════════════════

function buildRegionalIncome(refs, months, factByRegion) {
  let services = refs.incomeCategories.filter((c) => /^SRV_\d{2}$/.test(c.code));
  if (services.length === 0) services = refs.incomeCategories;
  const catalog = services.map((category) => ({
    category,
    weight: lognormal(1, 0.9),
    price: Math.min(2_000_000, Math.max(10_000, lognormal(90_000, 0.9))),
  }));
  const regions = refs.regions.filter((r) => r.code !== 0);
  const regionWeight = new Map(regions.map((r) => [r.code, between(0.5, 2.5)]));

  const rows = [];
  months.forEach((period, index) => {
    const facts = factByRegion.get(period);
    const growth = (1 + 0.013) ** index;
    const s = season(period, 0.14, 4);
    const date = periodEndDate(period);

    for (const region of regions) {
      const fromResults = facts?.get(region.code);
      const targetSom = fromResults
        ? (Number(fromResults) / 100) * between(1.02, 1.12)
        : 220_000_000 * regionWeight.get(region.code) * growth * s * lognormal(1, 0.08);

      // Shu oy hududda ko'rsatilgan xizmatlar: 60–100% i
      const used = catalog.filter(() => chance(0.8));
      const totalWeight = used.reduce((sum, item) => sum + item.weight, 0) || 1;
      for (const item of used) {
        const amountSom = targetSom * (item.weight / totalWeight);
        const quantity = Math.max(1, Math.round(amountSom / item.price));
        const amount = tiyin(quantity * item.price, 100);
        rows.push({
          date,
          period,
          amountTiyin: amount,
          paidTiyin: amount,
          paymentStatus: 'PAID',
          paymentMethod: 'BANK',
          categoryCode: item.category.code,
          regionCode: region.code,
          quantity,
          description: `${MARK} ${region.name} — ${item.category.label}`,
          source: 'IMPORT',
          section: 'DOIMIY',
          createdById: refs.user.id,
        });
      }
    }
  });
  return rows;
}

// ═══════════════════════════════════════════════════════════
// 5. Ijara — shartnomalar va har oy yopish
// ═══════════════════════════════════════════════════════════

function buildLeases(refs, months) {
  const regions = refs.regions.filter((r) => r.code !== 0);
  const specs = [];
  let n = 0;
  const next = () => `DEMO-IJ-${String(++n).padStart(3, '0')}`;

  for (const [title, som, area] of [
    ["Bosh ofis — qo'shimcha qavat", 38_000_000, 420],
    ['Markaziy ombor', 16_000_000, 600],
    ['Arxiv binosi', 9_000_000, 250],
  ]) {
    specs.push({ kind: 'ODDIY', title, regionCode: 0, departmentId: refs.departments.length ? pick(refs.departments).id : null, som, area });
  }
  for (const region of regions) {
    specs.push({
      kind: 'ODDIY',
      title: `${region.name} — hududiy ofis`,
      regionCode: region.code,
      som: lognormal(11_000_000, 0.35),
      area: int(80, 260),
    });
    if (chance(0.35)) {
      specs.push({ kind: 'ODDIY', title: `${region.name} — xizmat ko'rsatish shoxobchasi`, regionCode: region.code, som: lognormal(5_000_000, 0.3), area: int(30, 90) });
    }
  }
  for (const [code, name] of AIRPORTS) {
    if (!refs.regions.some((r) => r.code === code)) continue;
    specs.push({ kind: 'AEROPORT', title: `${name} — kassa`, regionCode: code, airportName: name, som: lognormal(7_500_000, 0.25), area: int(8, 20) });
  }

  const leases = [];
  const terms = [];
  for (const spec of specs) {
    const id = `demo_ls_${randomUUID()}`;
    const startPeriod = chance(0.75) ? `2024-${String(int(1, 12)).padStart(2, '0')}` : pick(months.slice(0, 12));
    const ended = chance(0.1);
    const endPeriod = ended ? pick(months.slice(14, 19)) : null;
    const [sy, sm] = startPeriod.split('-').map(Number);
    leases.push({
      id,
      number: next(),
      contractDate: new Date(Date.UTC(sy, sm - 1, int(1, 25))),
      kind: spec.kind,
      title: spec.title,
      regionCode: spec.regionCode,
      districtId: null,
      departmentId: spec.departmentId ?? null,
      airportName: spec.airportName ?? null,
      address: `${spec.title}, demo manzil`,
      areaM2: spec.area,
      purpose: spec.kind === 'AEROPORT' ? 'Kassa' : 'Ofis',
      lessorName: spec.kind === 'AEROPORT' ? 'Demo Aeroport Xizmatlari' : pick(LESSORS),
      lessorTin: String(int(300000000, 399999999)),
      lessorPhone: '+998 71 000 00 00',
      vatIncluded: chance(0.7),
      paymentFrequency: chance(0.85) ? 'MONTHLY' : 'QUARTERLY',
      paymentDay: int(5, 15),
      startPeriod,
      endPeriod,
      endReason: ended ? 'Shartnoma muddati tugadi' : null,
      note: `${MARK} sinov shartnomasi`,
      createdById: refs.user.id,
    });
    const base = tiyin(spec.som, 10_000);
    terms.push({ leaseId: id, validFrom: startPeriod, monthlyTiyin: base, createdById: refs.user.id });
    if (chance(0.6)) {
      const raise = BigInt(Math.round(between(1.08, 1.18) * 1000));
      terms.push({
        leaseId: id,
        validFrom: '2026-01',
        monthlyTiyin: ((base * raise) / 1000n / 1_000_000n) * 1_000_000n,
        note: "Qo'shimcha kelishuv: narx indeksatsiyasi",
        createdById: refs.user.id,
      });
    }
  }

  // Oylarni yopish
  const closes = [];
  const accruals = [];
  const expenses = [];
  for (const period of months) {
    if (refs.closedLease.has(period)) continue;
    const [y, m] = period.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, 1));
    const closeId = `demo_lc_${randomUUID()}`;
    let total = 0n;
    let count = 0;

    for (const lease of leases) {
      if (lease.startPeriod > period || (lease.endPeriod && lease.endPeriod < period)) continue;
      const term = terms
        .filter((t) => t.leaseId === lease.id && t.validFrom <= period)
        .sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1))[0];
      if (!term) continue;
      const amount = term.monthlyTiyin;
      const expenseId = `demo_e_${randomUUID()}`;
      total += amount;
      count += 1;
      accruals.push({ closeId, leaseId: lease.id, period, amountTiyin: amount, expenseId });
      expenses.push({
        id: expenseId,
        date,
        period,
        amountTiyin: amount,
        categoryCode: 'LEASE',
        departmentId: lease.departmentId,
        regionCode: lease.regionCode,
        description: `${MARK} Ijara: ${lease.title}`,
        documentNo: lease.number,
        counterparty: lease.lessorName,
        vatTiyin: lease.vatIncluded ? (amount * 12n + 56n) / 112n : null,
        paymentMethod: 'BANK',
        paymentStatus: 'PAID',
        source: 'LEASE',
        section: 'DOIMIY',
        createdById: refs.user.id,
      });
    }
    if (count === 0) continue;
    closes.push({ id: closeId, period, leaseCount: count, totalTiyin: total, closedById: refs.user.id, closedAt: periodEndDate(period) });
  }

  return { leases, terms, closes, accruals, expenses };
}

// ═══════════════════════════════════════════════════════════
// 6. Qo'shimcha xarajat turlari
// ═══════════════════════════════════════════════════════════

async function ensureExtraCategories() {
  const parents = new Set((await prisma.category.findMany({ select: { code: true } })).map((c) => c.code));
  let order = 700;
  for (const [code, label] of EXTRA_PARENTS) {
    await prisma.category.upsert({ where: { code }, update: {}, create: { code, label, isLeaf: false, order: order++ } });
    parents.add(code);
  }
  for (const [code, label, parentCode, behavior] of EXTRA_LEAVES) {
    await prisma.category.upsert({
      where: { code },
      update: {},
      create: { code, label, parentCode: parents.has(parentCode) ? parentCode : null, isLeaf: true, behavior, order: order++ },
    });
  }
}

function buildExtraExpenses(refs, months) {
  const regions = refs.regions.filter((r) => r.code !== 0);
  const items = EXTRA_LEAVES.map(([code, label, , , profile, median]) => ({ code, label, profile, median, weight: between(0.5, 4) }));
  const profileFactor = (profile, month) => {
    if (profile === 'winter') return [12, 1, 2].includes(month) ? 2.2 : [11, 3].includes(month) ? 1.5 : 0.35;
    if (profile === 'summer') return [6, 7, 8].includes(month) ? 1.9 : [5, 9].includes(month) ? 1.3 : 0.6;
    if (profile === 'holiday') return [3, 12].includes(month) ? 3 : [1, 9].includes(month) ? 1.4 : 0.4;
    return 1;
  };

  const rows = [];
  let seq = 0;
  months.forEach((period, index) => {
    const month = Number(period.slice(5));
    const part = period === CURRENT_PERIOD ? daysIn(period) / 30 : 1;
    const count = Math.round(EXTRA_EXPENSE_ROWS_PER_MONTH * part * lognormal(1, 0.08));
    const monthly = items.map((item) => ({ ...item, weight: item.weight * profileFactor(item.profile, month) }));
    const draft = [];
    for (let i = 0; i < count; i += 1) {
      const item = weighted(monthly);
      const place = rand();
      const regionCode = place < 0.5 ? 0 : place < 0.85 && regions.length ? pick(regions).code : null;
      const date = dateOf(period, int(1, daysIn(period)));
      const unpaid = chance(0.06);
      seq += 1;
      draft.push({
        raw: lognormal(item.median, 0.5) * profileFactor(item.profile, month) ** 0.5,
        row: {
          date,
          period,
          categoryCode: item.code,
          departmentId: regionCode === 0 && refs.departments.length ? pick(refs.departments).id : null,
          regionCode,
          description: `${MARK} ${item.label}`,
          paymentMethod: chance(0.7) ? 'BANK' : chance(0.5) ? 'CASH' : 'CARD',
          documentNo: `DEMO-X-${String(seq).padStart(6, '0')}`,
          counterparty: pick(SUPPLIERS),
          paymentStatus: unpaid ? 'UNPAID' : 'PAID',
          dueDate: unpaid ? new Date(date.getTime() + int(10, 40) * 86_400_000) : null,
          responsible: chance(0.3) ? 'Demo mas’ul xodim' : null,
          source: 'MANUAL',
          section: ['DEMO_XOJ_MEBEL', 'DEMO_SAFAR_XORIJ', 'DEMO_HUQ_AUDIT', 'DEMO_BINO_KAPITAL', 'DEMO_IT_KOMPYUTER', 'DEMO_IJT_BAYRAM', 'DEMO_MKT_TV'].includes(item.code)
            ? 'BOSHQA'
            : 'DOIMIY',
          createdById: refs.user.id,
        },
      });
    }
    const target = EXTRA_EXPENSE_MONTHLY_SOM * (1 + 0.012) ** index * season(period, 0.1, 1) * part * lognormal(1, 0.06);
    const scale = target / draft.reduce((sum, d) => sum + d.raw, 0);
    for (const { raw, row } of draft) {
      const amount = tiyin(raw * scale);
      rows.push({ ...row, amountTiyin: amount, vatTiyin: row.paymentMethod === 'BANK' && chance(0.7) ? (amount * 12n) / 112n : null });
    }
  });
  return rows;
}

// ═══════════════════════════════════════════════════════════
// Asosiy
// ═══════════════════════════════════════════════════════════

const mln = (t) => (Number(t / 100n) / 1e6).toFixed(1);
const sum = (rows, key = 'amountTiyin') => rows.reduce((s, r) => s + r[key], 0n);

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--clean')) {
    await clean();
    return;
  }

  const existing = await prisma.payrollBatch.count({ where: { fileName: { startsWith: MARK } } });
  if (existing > 0) {
    if (!args.has('--replace')) {
      console.log(`2-qism demosi allaqachon bor (${existing} ta ish haqi oyi). Qayta yaratish: --replace, o'chirish: --clean`);
      return;
    }
    await clean();
  }

  const months = periods(START_PERIOD, CURRENT_PERIOD);
  const refs = await loadReferences(months);
  console.log(
    `Davr: ${months[0]} — ${months.at(-1)} · xodimlar: ${refs.employees.length}, oyligi ma'lum: ${refs.latestSalary.size}, ` +
      `hududlar: ${refs.regions.length}, komponentlar: ${refs.components.length}`,
  );
  console.log(`Haqiqiy ish haqi bor oylar (tegilmaydi): ${[...refs.realPayroll].sort().join(', ') || '—'}`);
  console.log(`Haqiqiy natijalar bor oylar (tegilmaydi): ${[...refs.realResults].sort().join(', ') || '—'}`);

  // Seed-1 dagi oddiy hududlar tushumi shablon bo'yichasiga almashtiriladi
  const oldRegional = await prisma.income.deleteMany({
    where: { description: { startsWith: MARK }, source: 'IMPORT', regionCode: { not: null }, quantity: null },
  });
  if (oldRegional.count) console.log(`1-qismdagi ${oldRegional.count} ta soddalashtirilgan hududlar tushumi almashtiriladi`);

  // 1. Ish haqi
  console.log('\n1) Ish haqi…');
  const payroll = buildPayroll(refs, months);
  await chunked('payrollBatch', payroll.batches);
  await chunked('payrollEntry', payroll.entries);
  await chunked('expense', payroll.expenses);
  console.log(`   ${payroll.batches.length} oy, ${payroll.entries.length} yozuv (${payroll.staffCount} xodim), ${payroll.expenses.length} xarajat guruhi, jami ${mln(sum(payroll.expenses))} mln so'm`);

  // 2. Ish haqi tarkibi (haqiqiy + demo ish haqi oylari)
  console.log('2) Ish haqi tarkibi…');
  const composition = await buildComposition(refs, months);
  await chunked('salaryCompositionBatch', composition.batches);
  await chunked('salaryCompositionRow', composition.rows);
  await chunked('salaryCompositionItem', composition.items, 2000);
  console.log(`   ${composition.batches.length} oy, ${composition.rows.length} qator, ${composition.items.length} element`);

  // 3. Xodim natijalari
  console.log('3) Xodim natijalari…');
  const results = buildResults(refs, months);
  await chunked('resultBatch', results.batches);
  await chunked('employeeResult', results.results);
  await chunked('employeeLocation', results.locations);
  console.log(`   ${results.batches.length} oy, ${results.results.length} natija, tushum ${mln(sum(results.batches, 'factTiyin'))} mln so'm`);

  // 4. Hududlar tushumi
  console.log('4) Hududlar tushumi (shablon)…');
  const regional = buildRegionalIncome(refs, months, results.factByRegion);
  await chunked('income', regional);
  console.log(`   ${regional.length} qator, jami ${mln(sum(regional))} mln so'm`);

  // 5. Ijara
  console.log('5) Ijara…');
  const lease = buildLeases(refs, months);
  await chunked('lease', lease.leases);
  await chunked('leaseTerm', lease.terms);
  await chunked('leaseMonthClose', lease.closes);
  await chunked('expense', lease.expenses);
  await chunked('leaseAccrual', lease.accruals);
  console.log(`   ${lease.leases.length} shartnoma, ${lease.closes.length} oy yopildi, ${lease.expenses.length} xarajat, jami ${mln(sum(lease.expenses))} mln so'm`);

  // 6. Qo'shimcha xarajat turlari
  console.log("6) Qo'shimcha xarajat turlari…");
  await ensureExtraCategories();
  const extra = buildExtraExpenses(refs, months);
  await chunked('expense', extra);
  console.log(`   ${EXTRA_LEAVES.length} yangi tur, ${extra.length} xarajat, jami ${mln(sum(extra))} mln so'm`);

  console.log('\nTayyor. 2-qismni o‘chirish: node scripts/seed-demo-2.mjs --clean');
}

main()
  .catch((error) => {
    console.error('\nXATO:', error.message ?? error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());