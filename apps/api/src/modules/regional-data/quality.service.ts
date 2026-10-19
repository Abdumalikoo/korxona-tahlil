import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { regionalEmployees } from './rd.employees';
import { assertPeriod, CENTRAL_REGION, median, monthName, periodDays, shiftPeriod } from './rd.util';

// ═══════════════════════════════════════════════════════════
// A. Ma'lumot sifati — oy bo'yicha tekshiruv (Hududchi oyni yopishdan oldin ko'radi).
//   Xato (error) — oyni yopib bo'lmaydi; ogohlantirish (warn) — tekshirib, izoh bilan yopsa bo'ladi.
//   Qoidalar:
//    1. Daromad yuklanganmi (har hudud);           6. Xarajatda «takroriy/bir martalik» belgisi;
//    2. Hudud ish haqi vedomosti yuklanganmi;      7. Ish haqi: vedomostda yo'q faol xodimlar / bo'shaganlar;
//    3. Daromad keskin o'zgarishi (mediana ±40%);  8. Shtat va maosh kiritilmagan xodimlar;
//    4. Summa bor, soni yo'q;                      9. Xarajat rejasi kiritilganmi;
//    5. O'rtacha narx keskin o'zgarishi (±30%) —  10. O'tgan oy yopilganmi.
//       voqealar jurnalida tarif o'zgarishi bo'lsa — izohlangan.
// ═══════════════════════════════════════════════════════════

export type CheckLevel = 'ok' | 'warn' | 'error' | 'info';

export interface QualityItem {
  key: string;
  level: CheckLevel;
  title: string;
  detail: string | null;
  list: string[];
  href: string | null;
}

const JUMP = 0.4;
const PRICE_JUMP = 0.3;

const pct = (x: number) => `${x > 0 ? '+' : ''}${Math.round(x * 100)}%`;

@Injectable()
export class QualityService {
  constructor(private readonly prisma: PrismaService) {}

  async check(periodRaw: string) {
    const period = assertPeriod(periodRaw);
    const prevMonths = [1, 2, 3, 4, 5, 6].map((k) => shiftPeriod(period, -k));
    const prev = prevMonths[0]!;
    const { first, last } = periodDays(period);
    const regionWhere = { not: null, notIn: [CENTRAL_REGION] };

    const [regions, incomes, oldIncomes, batches, expenses, employees, budgets, closes, events, services] = await Promise.all([
      this.prisma.region.findMany({ where: { isActive: true, code: { not: CENTRAL_REGION } }, select: { code: true, name: true }, orderBy: { code: 'asc' } }),
      this.prisma.income.findMany({ where: { deletedAt: null, source: 'IMPORT', regionCode: regionWhere, period }, select: { regionCode: true, categoryCode: true, amountTiyin: true, quantity: true } }),
      this.prisma.income.findMany({ where: { deletedAt: null, source: 'IMPORT', regionCode: regionWhere, period: { in: prevMonths } }, select: { period: true, regionCode: true, categoryCode: true, amountTiyin: true, quantity: true } }),
      this.prisma.payrollBatch.findMany({ where: { period, status: 'COMMITTED' }, select: { id: true, scope: true } }),
      this.prisma.expense.findMany({ where: { deletedAt: null, period, regionCode: regionWhere, source: 'MANUAL' }, select: { recurrence: true } }),
      regionalEmployees(this.prisma, period),
      this.prisma.expenseBudget.count({ where: { period } }),
      this.prisma.regionalPeriodClose.findMany({ where: { period: { in: [prev, period] } } }),
      this.prisma.analysisEvent.findMany({ where: { deletedAt: null, kind: 'TARIFF', date: { gte: periodDays(prev).first, lte: last } }, select: { categoryCode: true } }),
      this.prisma.incomeCategory.findMany({ where: { code: { startsWith: 'SRV_' } }, select: { code: true, label: true } }),
    ]);
    const regionName = new Map(regions.map((r) => [r.code, r.name]));
    const serviceName = new Map(services.map((s) => [s.code, s.label]));
    const items: QualityItem[] = [];
    const add = (key: string, level: CheckLevel, title: string, detail: string | null = null, list: string[] = [], href: string | null = null) => items.push({ key, level, title, detail, list, href });

    // 1. Daromad
    const withIncome = new Set(incomes.map((i) => i.regionCode));
    const noIncome = regions.filter((r) => !withIncome.has(r.code));
    if (incomes.length === 0) add('income', 'error', 'Daromad yuklanmagan', `${monthName(period)} uchun xizmatlar hisoboti yuklanmagan`, [], '/hudud/daromad');
    else if (noIncome.length) add('income', 'warn', `${noIncome.length} ta hududda daromad yo'q`, "Hisobotda bu hududlar bo'sh — to'g'rimi?", noIncome.map((r) => r.name), '/hudud/daromad');
    else add('income', 'ok', 'Daromad yuklangan', `${regions.length} ta hududning hammasida bor`);

    // 2. Ish haqi
    const regionalPins = new Set(employees.map((e) => e.pinfl));
    const entries = batches.length
      ? await this.prisma.payrollEntry.findMany({ where: { period, batchId: { in: batches.map((b) => b.id) } }, select: { employeePinfl: true, totalTiyin: true } })
      : [];
    const paidRegional = entries.filter((e) => regionalPins.has(e.employeePinfl));
    if (paidRegional.length === 0) add('payroll', 'error', 'Hudud xodimlari ish haqi yuklanmagan', `${monthName(period)} uchun vedomost yo'q`, [], '/hudud/ish-haqi');
    else add('payroll', 'ok', 'Ish haqi yuklangan', `${paidRegional.length} ta hudud xodimi`);

    // 3. Daromad keskin o'zgarishi (hudud jami vs oldingi oylar medianasi)
    if (incomes.length) {
      const jumps: string[] = [];
      for (const r of regions) {
        const cur = incomes.filter((i) => i.regionCode === r.code).reduce((s, i) => s + Number(i.amountTiyin), 0);
        const hist = prevMonths
          .map((m) => oldIncomes.filter((i) => i.period === m && i.regionCode === r.code).reduce((s, i) => s + Number(i.amountTiyin), 0))
          .filter((v) => v > 0);
        const med = hist.length >= 3 ? median(hist) : null;
        if (med && cur > 0) {
          const ch = (cur - med) / med;
          if (Math.abs(ch) > JUMP) jumps.push(`${r.name}: ${pct(ch)} (odatdagidan)`);
        }
      }
      if (jumps.length) add('jump', 'warn', `${jumps.length} ta hududda daromad keskin o'zgargan`, `Oldingi oylar medianasidan ±${JUMP * 100}% dan ko'p. Fayl to'g'riligini tekshiring; sababi bo'lsa — Voqealar jurnaliga yozing`, jumps, '/hudud/voqealar');
      else add('jump', 'ok', "Daromadda keskin sakrash yo'q");
    }

    // 4. Summa bor, soni yo'q
    const noQty = incomes.filter((i) => i.amountTiyin > 0n && !i.quantity);
    if (noQty.length) add('qty', 'warn', `${noQty.length} ta yozuvda xizmatlar soni yo'q`, "Narx va salohiyat hisobida bu qatorlar to'liq ishlatilmaydi", [...new Set(noQty.map((i) => serviceName.get(i.categoryCode) ?? i.categoryCode))].slice(0, 10));
    else if (incomes.length) add('qty', 'ok', 'Xizmatlar soni hamma qatorda bor');

    // 5. O'rtacha narx o'zgarishi (xizmat bo'yicha, barcha hududlar)
    if (incomes.length) {
      const tariffChanged = new Set(events.map((e) => e.categoryCode ?? '*'));
      const priceOf = (rows: { categoryCode: string; amountTiyin: bigint; quantity: number | null }[], code: string) => {
        const xs = rows.filter((r) => r.categoryCode === code);
        const q = xs.reduce((s, r) => s + (r.quantity ?? 0), 0);
        return q > 0 ? xs.reduce((s, r) => s + Number(r.amountTiyin), 0) / q : null;
      };
      const prevRows = oldIncomes.filter((i) => i.period === prev);
      const moved: string[] = [];
      const explained: string[] = [];
      for (const code of new Set(incomes.map((i) => i.categoryCode))) {
        const a = priceOf(incomes, code);
        const b = priceOf(prevRows, code);
        if (a && b) {
          const ch = (a - b) / b;
          if (Math.abs(ch) > PRICE_JUMP) {
            const line = `${serviceName.get(code) ?? code}: ${pct(ch)}`;
            if (tariffChanged.has(code) || tariffChanged.has('*')) explained.push(line);
            else moved.push(line);
          }
        }
      }
      if (moved.length) add('price', 'warn', `${moved.length} ta xizmatda o'rtacha narx keskin o'zgargan`, "Tarif o'zgargan bo'lsa — Tariflar yoki Voqealar jurnaliga yozing (prognoz shu sanadan qayta boshlanadi)", moved.slice(0, 15), '/hudud/tariflar');
      else add('price', 'ok', "O'rtacha narxlarda tushuntirilmagan sakrash yo'q", explained.length ? `Tarif o'zgarishi bilan izohlangan: ${explained.length} ta` : null);
    }

    // 6. Xarajat belgisi
    const unmarked = expenses.filter((e) => !e.recurrence).length;
    if (unmarked) add('recurrence', 'warn', `${unmarked} ta xarajatda «takroriy / bir martalik» belgisi yo'q`, 'Xarajat prognozi shu belgiga tayanadi', [], '/hudud/xarajatlar');
    else if (expenses.length) add('recurrence', 'ok', 'Xarajatlar belgilangan', `${expenses.length} ta yozuv`);

    // 7. Ish haqi va xodimlar mosligi
    if (paidRegional.length) {
      const paid = new Set(paidRegional.map((e) => e.employeePinfl));
      const unpaid = employees.filter((e) => !paid.has(e.pinfl));
      if (unpaid.length) add('unpaid', 'warn', `${unpaid.length} ta faol hudud xodimi vedomostda yo'q`, "Ta'tilda, ishdan bo'shagan yoki vedomostga tushmay qolgan bo'lishi mumkin. Bo'shagan bo'lsa — Xodimlar bo'limida sanasini yozing", unpaid.slice(0, 12).map((e) => `${e.fullName} (${regionName.get(e.regionCode) ?? e.regionCode})`));
      else add('unpaid', 'ok', 'Faol hudud xodimlarining hammasi vedomostda');
    }

    // 8. Shtat va maosh
    const salaries = await this.prisma.employeeSalary.findMany({ where: { employeePinfl: { in: employees.map((e) => e.pinfl) }, effectiveFrom: { lte: last } }, select: { employeePinfl: true } });
    const withSalary = new Set(salaries.map((s) => s.employeePinfl));
    const noSalary = employees.filter((e) => !withSalary.has(e.pinfl));
    if (employees.length && noSalary.length) add('salary', 'warn', `${noSalary.length} ta xodimda stavka va maosh kiritilmagan`, 'Ish haqi prognozi ular uchun oxirgi vedomostga tayanadi (aniqligi past)', noSalary.slice(0, 12).map((e) => e.fullName), '/hudud/shtat');
    else if (employees.length) add('salary', 'ok', 'Stavka va maosh hammada kiritilgan');

    // 9. Xarajat rejasi
    if (!budgets) add('budget', 'info', 'Xarajat rejasi kiritilmagan', "Majburiy emas; kiritilsa — reja va fakt solishtiriladi", [], '/hudud/reja');
    else add('budget', 'ok', 'Xarajat rejasi kiritilgan', `${budgets} ta modda`);

    // 10. O'tgan oy
    const prevClose = closes.find((c) => c.period === prev);
    if (!prevClose || prevClose.status !== 'CLOSED') add('previous', 'warn', `${monthName(prev)} yopilmagan`, "Oylar ketma-ket yopilsa, prognoz faqat tasdiqlangan ma'lumotga tayanadi", [], '/hudud/yopish');

    const cur = closes.find((c) => c.period === period);
    return {
      period,
      periodLabel: monthName(period),
      closed: cur?.status === 'CLOSED',
      errors: items.filter((i) => i.level === 'error').length,
      warnings: items.filter((i) => i.level === 'warn').length,
      items,
      stats: { from: first.toISOString().slice(0, 10), incomeRows: incomes.length, employees: employees.length, payrollEmployees: paidRegional.length, expenses: expenses.length },
    };
  }
}