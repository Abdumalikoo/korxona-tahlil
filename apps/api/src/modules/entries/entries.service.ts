import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// ═══════════════════════════════════════════════════════════
// Tez kiritish › «Bugun kiritilganlar»: bugun (Toshkent vaqti) yaratilgan yozuvlar bitta ro'yxatda —
// xarajatlar, daromadlar, ombor hujjatlari. Excel yuklash va ish haqi vedomosti — bitta qator bo'lib.
// Ombor kirimi xarajatlari alohida ko'rsatilmaydi (hujjatning o'zi chiqadi), pochta to'lovi — chiqadi.
// ═══════════════════════════════════════════════════════════

export type EntryType = 'EXPENSE' | 'INCOME' | 'STOCK' | 'IMPORT';

export interface EntryItem {
  id: string;
  at: string;
  type: EntryType;
  title: string;
  subtitle: string | null;
  amountTiyin: string | null;
  /** Yozuv qayerda ko'rinadi */
  href: string;
  by: string | null;
}

/** «Boshlash» ro'yxati: dasturni to'ldirish tartibi */
export interface SetupStep {
  key: string;
  label: string;
  /** Nima uchun va qanday — bir qator */
  hint: string;
  href: string;
  /** Bajarildimi (kamida bitta haqiqiy yozuv bor) */
  done: boolean;
  count: number;
}

export interface SetupStatus {
  steps: SetupStep[];
  done: number;
  total: number;
}

export interface EntriesToday {
  date: string;
  items: EntryItem[];
  totals: { count: number; expenseTiyin: string; incomeTiyin: string; stockDocs: number };
}

const STOCK_LABELS: Record<string, string> = {
  RECEIPT: 'Kirim',
  ISSUE: 'Chiqim',
  RETURN: 'Qaytarish',
  TRANSFER: "Ko'chirish",
  WRITE_OFF: 'Hisobdan chiqarish',
};

function dayStart(iso?: string): { start: Date; end: Date; date: string } {
  let date = iso;
  if (date === undefined || date === '') date = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException("Sana noto'g'ri (YYYY-MM-DD)");
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  // Toshkent yarim tuni = UTC 19:00 (oldingi kun)
  const start = new Date(Date.UTC(y, m - 1, d) - 5 * 3600_000);
  return { start, end: new Date(start.getTime() + 86_400_000), date };
}

function expenseHref(e: { source: string; categoryCode: string; section: string }): string {
  // Rollar kiritgani — umumiy hududda dashbord
  if (e.categoryCode === 'WH_POSTAL') return '/dashbord/ombor';
  if (e.source === 'VEHICLE') return '/dashbord/mashinalar';
  if (e.source === 'PAYROLL') return '/xarajatlar/ish-haqi';
  if (e.source === 'LEASE') return '/xarajatlar/ijara';
  if (e.source === 'ASSET') return '/xarajatlar/asosiy-vositalar';
  if (e.source === 'TAX') return '/xarajatlar/soliqlar';
  return e.section === 'BOSHQA' ? '/xarajatlar/boshqa' : '/xarajatlar/doimiy';
}

@Injectable()
export class EntriesService {
  constructor(private readonly prisma: PrismaService) {}

  async today(dateIso?: string): Promise<EntriesToday> {
    const { start, end, date } = dayStart(dateIso);
    const created = { gte: start, lt: end };

    const [expenses, incomes, docs] = await Promise.all([
      this.prisma.expense.findMany({
        where: { createdAt: created, deletedAt: null },
        select: {
          id: true, amountTiyin: true, description: true, counterparty: true, source: true, section: true, categoryCode: true,
          importBatchId: true, payrollBatchId: true, createdAt: true,
          category: { select: { label: true } },
          createdBy: { select: { fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 3000,
      }),
      this.prisma.income.findMany({
        where: { createdAt: created, deletedAt: null },
        select: {
          id: true, amountTiyin: true, description: true, clientName: true, section: true, importBatchId: true, createdAt: true,
          category: { select: { label: true } },
          createdBy: { select: { fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 3000,
      }),
      this.prisma.stockDoc.findMany({
        where: { createdAt: created, deletedAt: null },
        select: { id: true, number: true, kind: true, totalTiyin: true, counterparty: true, holderName: true, createdAt: true, createdById: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
    ]);

    const userIds = [...new Set(docs.map((d) => d.createdById).filter((x): x is string => Boolean(x)))];
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : [];
    const userName = new Map(users.map((u) => [u.id, u.fullName]));

    const items: EntryItem[] = [];
    const batches = new Map<string, EntryItem & { n: number; sum: bigint }>();
    const batch = (key: string, base: Omit<EntryItem, 'amountTiyin'>, amount: bigint) => {
      const b = batches.get(key) ?? { ...base, amountTiyin: null, n: 0, sum: 0n };
      b.n += 1;
      b.sum += amount;
      if (base.at > b.at) b.at = base.at;
      batches.set(key, b);
    };

    let expenseSum = 0n;
    for (const e of expenses) {
      expenseSum += e.amountTiyin;
      // Ombor kirimi — hujjatning o'zi ko'rsatiladi
      if (e.source === 'WAREHOUSE' && e.categoryCode !== 'WH_POSTAL') continue;
      const at = e.createdAt.toISOString();
      const by = e.createdBy?.fullName ?? null;
      if (e.payrollBatchId) {
        batch(`p:${e.payrollBatchId}`, { id: `p:${e.payrollBatchId}`, at, type: 'IMPORT', title: 'Ish haqi vedomosti', subtitle: null, href: '/xarajatlar/ish-haqi', by }, e.amountTiyin);
        continue;
      }
      if (e.importBatchId) {
        batch(`e:${e.importBatchId}`, { id: `e:${e.importBatchId}`, at, type: 'IMPORT', title: 'Xarajatlar: Excel yuklash', subtitle: null, href: expenseHref(e), by }, e.amountTiyin);
        continue;
      }
      items.push({
        id: e.id,
        at,
        type: 'EXPENSE',
        title: e.categoryCode === 'WH_POSTAL' ? `Pochta: ${e.counterparty ?? ''}`.trim() : e.category?.label ?? 'Xarajat',
        subtitle: (e.description ?? e.counterparty ?? null)?.slice(0, 140) ?? null,
        amountTiyin: e.amountTiyin.toString(),
        href: expenseHref(e),
        by,
      });
    }

    let incomeSum = 0n;
    for (const i of incomes) {
      incomeSum += i.amountTiyin;
      const at = i.createdAt.toISOString();
      const by = i.createdBy?.fullName ?? null;
      const href = i.section === 'BOSHQA' ? '/daromadlar/boshqa' : '/daromadlar/doimiy';
      if (i.importBatchId) {
        batch(`i:${i.importBatchId}`, { id: `i:${i.importBatchId}`, at, type: 'IMPORT', title: 'Daromadlar: Excel yuklash', subtitle: null, href: '/daromadlar/hududlar', by }, i.amountTiyin);
        continue;
      }
      items.push({
        id: i.id,
        at,
        type: 'INCOME',
        title: i.category?.label ?? 'Daromad',
        subtitle: [i.clientName, i.description].filter(Boolean).join(' — ').slice(0, 140) || null,
        amountTiyin: i.amountTiyin.toString(),
        href,
        by,
      });
    }

    for (const d of docs) {
      items.push({
        id: d.id,
        at: d.createdAt.toISOString(),
        type: 'STOCK',
        title: `Ombor: ${STOCK_LABELS[d.kind] ?? d.kind} ${d.number}`,
        subtitle: d.kind === 'RECEIPT' ? d.counterparty : d.holderName,
        amountTiyin: d.totalTiyin.toString(),
        href: '/dashbord/ombor',
        by: d.createdById ? (userName.get(d.createdById) ?? null) : null,
      });
    }

    for (const b of batches.values()) {
      const { n, sum, ...rest } = b;
      items.push({ ...rest, subtitle: `${n} ta yozuv`, amountTiyin: sum.toString() });
    }

    items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return {
      date,
      items: items.slice(0, 200),
      totals: { count: items.length, expenseTiyin: expenseSum.toString(), incomeTiyin: incomeSum.toString(), stockDocs: docs.length },
    };
  }

  /**
   * «Boshlash» ro'yxati (umumiy hudud) — qaysi tartibda to'ldirish kerak va nimasi bajarilgan.
   * Ombor va mashinalarni Omborchi o'z bo'limida yuritadi: bu yerda faqat «Omborchi qo'shish» qadami.
   */
  async setup(): Promise<SetupStatus> {
    const [employees, incomes, expenses, payroll, keepers] = await Promise.all([
      this.prisma.employee.count(),
      this.prisma.income.count({ where: { deletedAt: null } }),
      this.prisma.expense.count({ where: { deletedAt: null, source: { in: ['MANUAL', 'IMPORT'] } } }),
      this.prisma.payrollBatch.count(),
      this.prisma.user.count({ where: { role: 'SKLADCHI' } }),
    ]);
    const steps: SetupStep[] = [
      { key: 'employees', label: 'Xodimlar', hint: "Ro'yxatni Excel'dan yuklang — ish haqi, ombor va hisobotlar shunga tayanadi", href: '/xodimlar', done: employees > 0, count: employees },
      { key: 'incomes', label: 'Birinchi daromad', hint: "Tushumlarni kiriting yoki hududlar Excel'ini yuklang", href: '/daromadlar/doimiy?new=1', done: incomes > 0, count: incomes },
      { key: 'expenses', label: 'Birinchi xarajat', hint: "Kommunal, aloqa, xizmatlar — muntazam to'lovlar", href: '/xarajatlar/yangi', done: expenses > 0, count: expenses },
      { key: 'payroll', label: 'Ish haqi vedomosti', hint: 'Oylik qaydnomani yuklang — eng katta xarajat moddasi', href: '/xarajatlar/ish-haqi', done: payroll > 0, count: payroll },
      { key: 'keepers', label: 'Omborchi', hint: "Omborchiga ID kod va PIN bering — ombor, mashina va pochtani u kiritadi, sizga dashbord bo'lib keladi", href: '/sozlamalar/foydalanuvchilar', done: keepers > 0, count: keepers },
    ];
    return { steps, done: steps.filter((s) => s.done).length, total: steps.length };
  }
}