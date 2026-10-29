/**
 * Demo ma'lumotlar: 2025-yil yanvaridan bugungacha katta hajmdagi soxta yozuvlar.
 *
 *   node scripts/seed-demo.mjs            — qo'shish (demo bor bo'lsa to'xtaydi)
 *   node scripts/seed-demo.mjs --replace  — eski demoni o'chirib, qaytadan yaratish
 *   node scripts/seed-demo.mjs --clean    — faqat demoni o'chirish
 *
 * Har bir demo yozuv belgilangan:
 *   xarajat va daromad — description "[DEMO]" bilan boshlanadi;
 *   mashina — note "[DEMO]".
 * Haqiqiy yozuvlarga tegilmaydi.
 */

import prismaPkg from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ═══════════════════════════════════════════════════════════
// Sozlamalar
// ═══════════════════════════════════════════════════════════

const MARK = '[DEMO]';
const START_PERIOD = '2025-01';

/** Oylik maqsad (so'm): mavsumiylik, o'sish va tebranish ustiga qo'yiladi */
const EXPENSE_MONTHLY_SOM = 2_400_000_000; // qo'lda kiritilgan xarajatlar
const EXPENSE_ROWS_PER_MONTH = 450;
const INCOME_MONTHLY_SOM = 5_200_000_000;
const INCOME_REGIONAL_SHARE = 0.75; // hududlar tushumi ulushi
const INCOME_MANUAL_ROWS_PER_MONTH = 120;
const MONTHLY_GROWTH = 0.014; // oyiga ~1,4% o'sish

const VEHICLES = [
  { plateNumber: '01 D 101 MO', model: 'Chevrolet Cobalt', year: 2022, color: 'Oq', fuelType: 'AI92', fuelNorm: 8.5, kmMonth: [2200, 3200], driverName: 'Demo haydovchi 1' },
  { plateNumber: '01 D 102 MO', model: 'Chevrolet Nexia 3', year: 2021, color: 'Kulrang', fuelType: 'AI92', fuelNorm: 8.0, kmMonth: [1800, 2800], driverName: 'Demo haydovchi 2' },
  { plateNumber: '01 D 103 MO', model: 'Chevrolet Damas', year: 2020, color: 'Oq', fuelType: 'METAN', fuelNorm: 9.0, kmMonth: [2600, 3800], driverName: 'Demo haydovchi 3' },
  { plateNumber: '01 D 104 MO', model: 'Chevrolet Gentra', year: 2023, color: 'Qora', fuelType: 'AI92', fuelNorm: 9.0, kmMonth: [1500, 2500], driverName: 'Demo haydovchi 4' },
  { plateNumber: '01 D 105 MO', model: 'Chevrolet Captiva', year: 2021, color: 'Qora', fuelType: 'DIZEL', fuelNorm: 10.5, kmMonth: [1200, 2200], driverName: 'Demo haydovchi 5' },
];

/** 1 litr (m³) narxi: 2025-yil boshi → har oy biroz qimmatlashadi */
const FUEL_PRICE = { AI80: 8200, AI92: 10400, AI95: 12900, DIZEL: 11800, METAN: 4300, PROPAN: 5600, ELEKTR: 1000 };

const SUPPLIERS = [
  'Demo Ta’minot MCHJ', 'Demo Kanselyariya MCHJ', 'Demo Kommunal xizmat', 'Demo IT Servis MCHJ',
  'Demo Qurilish Savdo', 'Demo Transport Logistika', 'Demo Aloqa MCHJ', 'Demo Bosmaxona',
  'Demo Mebel Savdo', 'Demo Tozalash Xizmati', 'Demo Energiya Ta’minoti', 'Demo Konsalting',
];
const CLIENTS = [
  'Demo Mijoz MCHJ', 'Demo Savdo Uyi', 'Demo Agro Klaster', 'Demo Tekstil MCHJ', 'Demo Farm MCHJ',
  'Demo Invest Group', 'Demo Qurilish Trest', 'Demo Logistika Servis', 'Demo Oziq-ovqat MCHJ', 'Demo Energo MCHJ',
];
const STATIONS = ['Demo AZS №1', 'Demo AZS №2', 'Demo Metan shoxobchasi', 'Demo AGZS'];
const SERVICES = ['Demo Avto Servis', 'Demo Moyka', 'Demo Shinomontaj', 'Demo Motor Servis'];

// ═══════════════════════════════════════════════════════════
// .env — DATABASE_URL
// ═══════════════════════════════════════════════════════════

const here = dirname(fileURLToPath(import.meta.url));
for (const file of [resolve(here, '../.env'), resolve(here, '../prisma/.env'), resolve(process.cwd(), '.env')]) {
  if (process.env.DATABASE_URL || !existsSync(file)) continue;
  const match = /^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?\s*$/m.exec(readFileSync(file, 'utf8'));
  if (match) process.env.DATABASE_URL = match[1];
}

// ═══════════════════════════════════════════════════════════
// Tasodifiy sonlar (takrorlanadigan: bir xil urug' — bir xil natija)
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

const rand = mulberry32(20250101);
const between = (a, b) => a + rand() * (b - a);
const int = (a, b) => Math.floor(between(a, b + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const chance = (p) => rand() < p;

/** Log-normal: ko'p kichik, kam katta summa — haqiqiy xarajatlarga o'xshash */
function lognormal(median, sigma) {
  const u = 1 - rand();
  const v = rand();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return median * Math.exp(sigma * z);
}

/** Og'irlik bo'yicha tanlash */
function weighted(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let r = rand() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

/** So'm → tiyin (1000 so'mgacha yaxlitlanadi) */
function tiyin(som, step = 1000) {
  return BigInt(Math.max(step, Math.round(som / step) * step)) * 100n;
}

// ═══════════════════════════════════════════════════════════
// Sana va davrlar (Toshkent vaqti)
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

function daysIn(period) {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return period === CURRENT_PERIOD ? Math.min(last, TODAY.d) : last;
}

function dateOf(period, day) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

function randomDate(period) {
  return dateOf(period, int(1, daysIn(period)));
}

/** Mavsumiylik × o'sish × tebranish */
function monthFactor(period, index, amplitude = 0.12, phase = 3) {
  const month = Number(period.slice(5));
  const season = 1 + amplitude * Math.sin((2 * Math.PI * (month - phase)) / 12);
  const growth = (1 + MONTHLY_GROWTH) ** index;
  const noise = lognormal(1, 0.07);
  return season * growth * noise;
}

// ═══════════════════════════════════════════════════════════
// Asosiy
// ═══════════════════════════════════════════════════════════

const { PrismaClient } = prismaPkg;
const prisma = new PrismaClient();

async function chunked(model, rows, size = 1000) {
  for (let i = 0; i < rows.length; i += size) {
    await prisma[model].createMany({ data: rows.slice(i, i + size) });
  }
}

async function clean() {
  const demoVehicles = await prisma.vehicle.findMany({ where: { note: { startsWith: MARK } }, select: { id: true } });
  const vehicleIds = demoVehicles.map((v) => v.id);
  const records = vehicleIds.length
    ? await prisma.vehicleRecord.deleteMany({ where: { vehicleId: { in: vehicleIds } } })
    : { count: 0 };
  const vehicles = vehicleIds.length
    ? await prisma.vehicle.deleteMany({ where: { id: { in: vehicleIds } } })
    : { count: 0 };
  const expenses = await prisma.expense.deleteMany({ where: { description: { startsWith: MARK }, source: { in: ['MANUAL', 'VEHICLE'] }, NOT: { categoryCode: { startsWith: 'DEMO_' } } } });
  const incomes = await prisma.income.deleteMany({ where: { description: { startsWith: MARK }, quantity: null } });
  console.log(
    `O'chirildi: ${expenses.count} xarajat, ${incomes.count} daromad, ${vehicles.count} mashina, ${records.count} mashina yozuvi`,
  );
}

async function loadReferences() {
  const user =
    (await prisma.user.findFirst({ where: { role: 'ADMIN' } })) ?? (await prisma.user.findFirst());
  if (!user) throw new Error('Foydalanuvchi topilmadi — avval tizimga admin qo‘shing');

  const regions = (await prisma.region.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }))
    .filter((r) => r.code !== 0 && r.code !== 99); // 99 — «Hududlar umumiy», viloyat emas
  const departments = await prisma.department.findMany({ where: { isActive: true } });

  // Modul kategoriyalari (ish haqi, ijara, mashina) qo'lda yozuvlarga ishlatilmaydi
  const moduleRows = await prisma.expense.findMany({
    where: { source: { in: ['PAYROLL', 'LEASE', 'VEHICLE'] } },
    distinct: ['categoryCode'],
    select: { categoryCode: true },
  });
  const moduleCodes = new Set(moduleRows.map((r) => r.categoryCode));
  const expenseCategories = (await prisma.category.findMany({ where: { isLeaf: true, isActive: true } }))
    .filter((c) => !moduleCodes.has(c.code) && !/^(VEHICLE|LEASE|PAYROLL)/.test(c.code));
  const incomeCategories = await prisma.incomeCategory.findMany({ where: { isActive: true } });

  if (expenseCategories.length === 0) throw new Error('Xarajat kategoriyalari topilmadi');
  if (incomeCategories.length === 0) throw new Error('Daromad kategoriyalari topilmadi');
  if (regions.length === 0) console.warn('Diqqat: faol hududlar topilmadi — hududiy yozuvlar yaratilmaydi');

  return { user, regions, departments, expenseCategories, incomeCategories };
}

// ─────────── Xarajatlar ───────────

function buildExpenses(refs, months) {
  const categories = refs.expenseCategories.map((category) => ({
    category,
    weight: between(0.5, 5),
    median: lognormal(2_500_000, 0.8),
    /** Bir martalik xarakterdagi kategoriya — Boshqa bo'limiga ko'proq tushadi */
    oneOff: chance(0.2),
  }));
  const regionWeights = refs.regions.map((region) => ({ region, weight: between(0.5, 3) }));

  const rows = [];
  let seq = 0;
  months.forEach((period, index) => {
    const factor = monthFactor(period, index, 0.1, 1);
    const count = Math.round(EXPENSE_ROWS_PER_MONTH * (period === CURRENT_PERIOD ? daysIn(period) / 30 : 1) * lognormal(1, 0.08));
    const monthRows = [];
    for (let i = 0; i < count; i += 1) {
      const item = weighted(categories);
      const place = rand();
      const markaz = place < 0.45 || refs.regions.length === 0;
      const regionCode = markaz ? (place < 0.3 ? 0 : null) : weighted(regionWeights).region.code;
      const departmentId = regionCode === 0 && refs.departments.length ? pick(refs.departments).id : null;
      const method = rand() < 0.6 ? 'BANK' : rand() < 0.5 ? 'CASH' : 'CARD';
      const unpaid = chance(0.07);
      const date = randomDate(period);
      seq += 1;
      monthRows.push({
        raw: lognormal(item.median, 0.6),
        row: {
          id: `demo_e_${randomUUID()}`,
          date,
          period,
          categoryCode: item.category.code,
          departmentId,
          regionCode,
          description: `${MARK} ${item.category.label}`,
          paymentMethod: method,
          documentNo: `DEMO-E-${String(seq).padStart(6, '0')}`,
          counterparty: pick(SUPPLIERS),
          paymentStatus: unpaid ? 'UNPAID' : 'PAID',
          dueDate: unpaid ? new Date(date.getTime() + int(10, 45) * 86400_000) : null,
          source: 'MANUAL',
          section: (item.oneOff ? chance(0.7) : chance(0.08)) ? 'BOSHQA' : 'DOIMIY',
          createdById: refs.user.id,
        },
      });
    }
    // Oy summasi maqsadga keltiriladi
    const target = EXPENSE_MONTHLY_SOM * factor * (period === CURRENT_PERIOD ? daysIn(period) / 30 : 1);
    const scale = target / monthRows.reduce((sum, r) => sum + r.raw, 0);
    for (const { raw, row } of monthRows) {
      const amount = tiyin(raw * scale);
      rows.push({
        ...row,
        amountTiyin: amount,
        vatTiyin: row.paymentMethod === 'BANK' && chance(0.7) ? (amount * 12n) / 112n : null,
      });
    }
  });
  return rows;
}

// ─────────── Daromadlar ───────────

function buildIncomes(refs, months) {
  const categories = refs.incomeCategories.map((category) => ({ category, weight: between(0.5, 5), median: 1 }));
  const regionWeights = refs.regions.map((region) => ({ region, weight: between(0.6, 3.5) }));

  const rows = [];
  let seq = 0;
  months.forEach((period, index) => {
    const part = period === CURRENT_PERIOD ? daysIn(period) / 30 : 1;
    const factor = monthFactor(period, index, 0.14, 4) * part;

    // 1) Hududlar tushumi: har hudud × bir nechta xizmat (Doimiy, qulflangan)
    if (regionWeights.length) {
      const target = INCOME_MONTHLY_SOM * INCOME_REGIONAL_SHARE * factor;
      const monthRows = [];
      for (const { region, weight } of regionWeights) {
        const services = int(4, Math.min(10, categories.length + 3));
        for (let s = 0; s < services; s += 1) {
          const item = weighted(categories);
          monthRows.push({
            raw: weight * lognormal(1, 0.5),
            row: {
              id: `demo_i_${randomUUID()}`,
              date: dateOf(period, daysIn(period)),
              period,
              categoryCode: item.category.code,
              departmentId: null,
              regionCode: region.code,
              clientName: null,
              description: `${MARK} ${region.name} · ${item.category.label}`,
              contractNo: null,
              paymentStatus: 'PAID',
              paymentMethod: 'BANK',
              source: 'IMPORT',
              section: 'DOIMIY',
              createdById: refs.user.id,
            },
          });
        }
      }
      const scale = target / monthRows.reduce((sum, r) => sum + r.raw, 0);
      for (const { raw, row } of monthRows) {
        const amount = tiyin(raw * scale);
        rows.push({ ...row, amountTiyin: amount, paidTiyin: amount });
      }
    }

    // 2) Qo'lda kiritilgan daromadlar: shartnomalar, bir martalik tushumlar
    const target = INCOME_MONTHLY_SOM * (1 - INCOME_REGIONAL_SHARE) * factor;
    const count = Math.round(INCOME_MANUAL_ROWS_PER_MONTH * part * lognormal(1, 0.1));
    const monthRows = [];
    for (let i = 0; i < count; i += 1) {
      const item = weighted(categories);
      const status = rand();
      seq += 1;
      monthRows.push({
        raw: lognormal(1, 0.9),
        status: status < 0.8 ? 'PAID' : status < 0.92 ? 'PARTIAL' : 'UNPAID',
        row: {
          id: `demo_i_${randomUUID()}`,
          date: randomDate(period),
          period,
          categoryCode: item.category.code,
          departmentId: refs.departments.length && chance(0.8) ? pick(refs.departments).id : null,
          regionCode: null,
          clientName: pick(CLIENTS),
          description: `${MARK} ${item.category.label}`,
          contractNo: `DEMO-D-${String(seq).padStart(5, '0')}`,
          paymentMethod: chance(0.85) ? 'BANK' : 'CASH',
          source: 'MANUAL',
          section: chance(0.3) ? 'BOSHQA' : 'DOIMIY',
          createdById: refs.user.id,
        },
      });
    }
    const scale = target / Math.max(1, monthRows.reduce((sum, r) => sum + r.raw, 0));
    for (const { raw, status, row } of monthRows) {
      const amount = tiyin(raw * scale);
      const paid =
        status === 'PAID' ? amount : status === 'PARTIAL' ? (amount * BigInt(int(25, 85))) / 100n : 0n;
      rows.push({ ...row, amountTiyin: amount, paidTiyin: paid, paymentStatus: status });
    }
  });
  return rows;
}

// ─────────── Mashinalar ───────────

const VEHICLE_CATEGORIES = {
  FUEL: { code: 'VEHICLE_FUEL', label: "Mashina: yoqilg'i", behavior: 'VARIABLE' },
  WASH: { code: 'VEHICLE_WASH', label: 'Mashina: moyka', behavior: 'VARIABLE' },
  REPAIR: { code: 'VEHICLE_REPAIR', label: "Mashina: ta'mirlash va ehtiyot qismlar", behavior: 'VARIABLE' },
  SERVICE: { code: 'VEHICLE_SERVICE', label: 'Mashina: texnik xizmat', behavior: 'MIXED' },
  OTHER: { code: 'VEHICLE_OTHER', label: "Mashina: sug'urta, texko'rik va boshqa", behavior: 'FIXED' },
};
const KIND_LABELS = { FUEL: "Yoqilg'i", WASH: 'Moyka', REPAIR: "Ta'mirlash", SERVICE: 'Texnik xizmat', OTHER: 'Boshqa' };

async function ensureVehicleCategories() {
  await prisma.category.upsert({
    where: { code: 'VEHICLE' },
    update: {},
    create: { code: 'VEHICLE', label: 'Mashinalar', isLeaf: false, order: 55 },
  });
  let order = 551;
  for (const category of Object.values(VEHICLE_CATEGORIES)) {
    await prisma.category.upsert({
      where: { code: category.code },
      update: {},
      create: { ...category, parentCode: 'VEHICLE', isLeaf: true, order: order++ },
    });
  }
}

function buildVehicles(refs, months) {
  const department = refs.departments.length ? pick(refs.departments) : null;
  const vehicles = VEHICLES.map((spec) => ({
    id: `demo_v_${randomUUID()}`,
    spec,
    data: {
      plateNumber: spec.plateNumber,
      model: spec.model,
      year: spec.year,
      color: spec.color,
      fuelType: spec.fuelType,
      fuelNorm: spec.fuelNorm,
      regionCode: 0,
      departmentId: department?.id ?? null,
      driverName: spec.driverName,
      driverPhone: '+998 90 000 00 00',
      initialOdometerKm: int(40_000, 120_000),
      isActive: true,
      note: `${MARK} sinov mashinasi`,
      createdById: refs.user.id,
    },
  }));

  const records = [];
  const expenses = [];

  function add(vehicle, kind, date, amountSom, extra = {}) {
    const period = date.toISOString().slice(0, 7);
    const expenseId = `demo_e_${randomUUID()}`;
    const amountTiyin = tiyin(amountSom, kind === 'FUEL' ? 100 : 1000);
    const liters = extra.liters ?? null;
    const description = extra.description ?? null;
    const counterparty = extra.counterparty ?? null;
    let text = `${KIND_LABELS[kind]}: ${vehicle.data.plateNumber} (${vehicle.data.model})`;
    if (kind === 'FUEL' && liters) text += ` · ${String(liters).replace('.', ',')} l`;
    if (description) text += ` — ${description}`;

    records.push({
      vehicleId: vehicle.id,
      kind,
      date,
      period,
      amountTiyin,
      liters,
      odometerKm: extra.odometerKm ?? null,
      description,
      counterparty,
      documentNo: null,
      paymentMethod: kind === 'FUEL' ? 'CARD' : 'CASH',
      expenseId,
      createdById: refs.user.id,
    });
    expenses.push({
      id: expenseId,
      date,
      period,
      amountTiyin,
      categoryCode: VEHICLE_CATEGORIES[kind].code,
      departmentId: vehicle.data.departmentId,
      regionCode: vehicle.data.regionCode,
      description: `${MARK} ${text}`,
      paymentMethod: kind === 'FUEL' ? 'CARD' : 'CASH',
      documentNo: null,
      counterparty,
      paymentStatus: 'PAID',
      source: 'VEHICLE',
      section: 'DOIMIY',
      createdById: refs.user.id,
    });
  }

  for (const vehicle of vehicles) {
    const { spec } = vehicle;
    let odometer = vehicle.data.initialOdometerKm;
    let sinceService = int(0, 6000);

    months.forEach((period, index) => {
      const days = daysIn(period);
      const km = Math.round(between(spec.kmMonth[0], spec.kmMonth[1]) * (days / 30));
      const price = FUEL_PRICE[spec.fuelType] * (1 + 0.004 * index);
      const tank = spec.fuelType === 'METAN' ? 280 : 380; // km bir quyishda
      const fills = Math.max(1, Math.round(km / tank));

      // Yoqilg'i: oy bo'yi teng oraliqda, to'liq bak usuli
      for (let f = 0; f < fills; f += 1) {
        const segment = km / fills;
        odometer += Math.round(segment * between(0.9, 1.1));
        const liters = Math.round(((segment * spec.fuelNorm) / 100) * between(0.93, 1.18) * 10) / 10;
        const day = Math.min(days, Math.max(1, Math.round(((f + 1) * days) / (fills + 0.3))));
        add(vehicle, 'FUEL', dateOf(period, day), liters * price, {
          liters,
          odometerKm: odometer,
          counterparty: spec.fuelType === 'METAN' ? 'Demo Metan shoxobchasi' : pick(STATIONS),
        });
      }
      sinceService += km;

      // Moyka: oyiga 2–4 marta
      for (let w = 0, n = int(2, 4); w < n; w += 1) {
        add(vehicle, 'WASH', randomDate(period), between(35_000, 70_000) * (1 + 0.005 * index), {
          counterparty: 'Demo Moyka',
          description: chance(0.3) ? 'kuzov + salon' : null,
        });
      }

      // Texnik xizmat: har ~8000 km da moy va filtr
      if (sinceService >= 8000) {
        sinceService = 0;
        add(vehicle, 'SERVICE', randomDate(period), between(450_000, 850_000), {
          counterparty: pick(SERVICES),
          description: 'moy va filtrlar almashtirildi',
          odometerKm: null,
        });
      }

      // Ta'mirlash: taxminan har 4 oyda bir marta, ba'zan katta
      if (chance(0.28)) {
        add(vehicle, 'REPAIR', randomDate(period), chance(0.15) ? between(2_500_000, 7_500_000) : between(250_000, 1_800_000), {
          counterparty: pick(SERVICES),
          description: pick(['tormoz kolodkasi', 'akkumulyator', 'yurish qismi', 'elektrika', 'kuzov ishlari', 'konditsioner']),
        });
      }

      // Boshqa: yanvarda sug'urta, iyulda texko'rik, ba'zan jarima
      const month = Number(period.slice(5));
      if (month === 1) add(vehicle, 'OTHER', dateOf(period, Math.min(days, 12)), between(380_000, 620_000), { description: "OSAGO sug'urta, 1 yil" });
      if (month === 7) add(vehicle, 'OTHER', dateOf(period, Math.min(days, 18)), between(150_000, 250_000), { description: "texnik ko'rik" });
      if (chance(0.06)) add(vehicle, 'OTHER', randomDate(period), 340_000, { description: 'jarima' });
    });
  }

  // Yoqilg'i yozuvlarida spidometr sana tartibida o'sib borishi kerak
  records.sort((a, b) => a.date - b.date);
  return { vehicles, records, expenses };
}

// ─────────── Hisobot ───────────

function report(expenses, incomes, vehicleExpenses) {
  const byMonth = new Map();
  const add = (period, key, amount) => {
    const row = byMonth.get(period) ?? { expense: 0n, vehicle: 0n, income: 0n };
    row[key] += amount;
    byMonth.set(period, row);
  };
  for (const e of expenses) add(e.period, 'expense', e.amountTiyin);
  for (const e of vehicleExpenses) add(e.period, 'vehicle', e.amountTiyin);
  for (const i of incomes) add(i.period, 'income', i.amountTiyin);

  const mln = (t) => (Number(t / 100n) / 1e6).toFixed(1).padStart(9);
  console.log('\nOy        Xarajat(mln)  Mashina(mln)  Daromad(mln)');
  for (const [period, row] of [...byMonth.entries()].sort()) {
    console.log(`${period}  ${mln(row.expense)}     ${mln(row.vehicle)}     ${mln(row.income)}`);
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));

  if (args.has('--clean')) {
    await clean();
    return;
  }

  const existing = await prisma.expense.count({ where: { description: { startsWith: MARK } } });
  if (existing > 0) {
    if (!args.has('--replace')) {
      console.log(`Bazada allaqachon ${existing} ta demo xarajat bor. Qayta yaratish: --replace, o'chirish: --clean`);
      return;
    }
    await clean();
  }

  const months = periods(START_PERIOD, CURRENT_PERIOD);
  console.log(`Davr: ${months[0]} — ${months[months.length - 1]} (${months.length} oy), bugun: ${TODAY.d}.${TODAY.m}.${TODAY.y}`);

  const refs = await loadReferences();
  console.log(
    `Ma'lumotnomalar: ${refs.expenseCategories.length} xarajat kategoriyasi, ${refs.incomeCategories.length} daromad turi, ` +
      `${refs.regions.length} hudud, ${refs.departments.length} bo'lim, foydalanuvchi: ${refs.user.fullName ?? refs.user.id}`,
  );

  const expenses = buildExpenses(refs, months);
  const incomes = buildIncomes(refs, months);
  const fleet = buildVehicles(refs, months);

  console.log('Xarajatlar yozilmoqda…');
  await chunked('expense', expenses);
  console.log(`  ${expenses.length} ta`);

  console.log('Daromadlar yozilmoqda…');
  await chunked('income', incomes);
  console.log(`  ${incomes.length} ta`);

  console.log('Mashinalar yozilmoqda…');
  await ensureVehicleCategories();
  await chunked('vehicle', fleet.vehicles.map((v) => ({ id: v.id, ...v.data })));
  await chunked('expense', fleet.expenses);
  await chunked('vehicleRecord', fleet.records);
  console.log(`  ${fleet.vehicles.length} mashina, ${fleet.records.length} yozuv`);

  report(expenses, incomes, fleet.expenses);
  console.log('\nTayyor. O‘chirish uchun: node scripts/seed-demo.mjs --clean');
}

main()
  .catch((error) => {
    console.error('\nXATO:', error.message ?? error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());