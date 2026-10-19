import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { parseDate, text, WarehouseService } from './warehouse.service';

// ═══════════════════════════════════════════════════════════
// Pochta to'lovlari: qaysi pochta korxonasiga, qancha, qachon — tamom.
// Har to'lov Xarajatlarga bitta yozuv bo'lib tushadi:
//   modda — «Ombor: pochta xizmatlari», manba — Ombor (Xarajatlar bo'limidan o'zgartirilmaydi),
//   bo'lim — Doimiy, hudud — Markaz. Bekor qilinsa — xarajat ham bekor bo'ladi.
// ═══════════════════════════════════════════════════════════

export const POSTAL_CATEGORY = 'WH_POSTAL';
const METHODS = ['CASH', 'BANK', 'CARD', 'OTHER'] as const;

export interface PostalInput {
  date?: string;
  company?: string;
  amountTiyin?: string | number;
  paymentMethod?: string;
  documentNo?: string | null;
  note?: string | null;
}

export interface PostalView {
  id: string;
  date: string;
  company: string;
  amountTiyin: string;
  paymentMethod: string;
  documentNo: string | null;
  note: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface PostalList {
  from: string;
  to: string;
  items: PostalView[];
  totalTiyin: string;
  /** Korxonalar bo'yicha jami (davr) */
  byCompany: { company: string; totalTiyin: string; count: number }[];
  /** Oldingi to'lovlardagi korxonalar — tanlash uchun */
  companies: string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class WarehousePostal {
  constructor(
    private readonly prisma: PrismaService,
    private readonly warehouse: WarehouseService,
    private readonly audit: AuditService,
  ) {}

  async list(fromInput?: string, toInput?: string): Promise<PostalList> {
    const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
    const from = fromInput && DATE_RE.test(fromInput) ? fromInput : `${today.slice(0, 7)}-01`;
    const to = toInput && DATE_RE.test(toInput) ? toInput : today;
    const [rows, recent, users] = await Promise.all([
      this.prisma.postalPayment.findMany({
        where: { deletedAt: null, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 2000,
      }),
      this.prisma.postalPayment.findMany({ where: { deletedAt: null }, select: { company: true }, orderBy: { createdAt: 'desc' }, take: 300 }),
      this.prisma.user.findMany({ select: { id: true, fullName: true, loginCode: true } }),
    ]);
    const names = new Map(users.map((u) => [u.id, u.loginCode ? `${u.fullName} (${u.loginCode})` : u.fullName]));
    const companies: string[] = [];
    for (const r of recent) if (!companies.some((c) => c.toLowerCase() === r.company.toLowerCase())) companies.push(r.company);
    const by = new Map<string, { company: string; total: bigint; count: number }>();
    for (const r of rows) {
      const k = r.company.toLowerCase();
      const x = by.get(k) ?? { company: r.company, total: 0n, count: 0 };
      x.total += r.amountTiyin;
      x.count += 1;
      by.set(k, x);
    }
    return {
      from,
      to,
      items: rows.map((r) => ({
        id: r.id,
        date: r.date.toISOString().slice(0, 10),
        company: r.company,
        amountTiyin: r.amountTiyin.toString(),
        paymentMethod: r.paymentMethod,
        documentNo: r.documentNo,
        note: r.note,
        createdByName: r.createdById ? (names.get(r.createdById) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
      })),
      totalTiyin: rows.reduce((s, r) => s + r.amountTiyin, 0n).toString(),
      byCompany: [...by.values()].sort((a, b) => Number(b.total - a.total)).map((x) => ({ company: x.company, totalTiyin: x.total.toString(), count: x.count })),
      companies: companies.slice(0, 30),
    };
  }

  async create(input: PostalInput, userId: string): Promise<PostalView> {
    const body = input ?? {};
    const { date, period } = parseDate(body.date);
    const company = text(body.company, 'Pochta korxonasi', 160);
    if (!company) throw new BadRequestException('Pochta korxonasini yozing');
    let amount: bigint;
    try {
      amount = BigInt(String(body.amountTiyin ?? '').trim());
    } catch {
      throw new BadRequestException("Summa noto'g'ri");
    }
    if (amount <= 0n) throw new BadRequestException('Summa noldan katta bo‘lsin');
    if (amount > 100_000_000_000_00n) throw new BadRequestException('Summa juda katta');
    const paymentMethod = (body.paymentMethod ?? 'CASH') as (typeof METHODS)[number];
    if (!METHODS.includes(paymentMethod)) throw new BadRequestException("To'lov usuli noto'g'ri");
    const documentNo = text(body.documentNo, 'Hujjat raqami', 80);
    const note = text(body.note, 'Izoh', 500);
    await this.warehouse.ensureCategories();

    const row = await this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          date,
          period,
          amountTiyin: amount,
          categoryCode: POSTAL_CATEGORY,
          regionCode: 0,
          description: `Pochta: ${company}${note ? ` — ${note}` : ''}`.slice(0, 500),
          paymentMethod,
          documentNo,
          counterparty: company,
          paymentStatus: 'PAID',
          source: 'WAREHOUSE',
          section: 'DOIMIY',
          createdById: userId,
        },
        select: { id: true },
      });
      return tx.postalPayment.create({ data: { date, period, company, amountTiyin: amount, paymentMethod, documentNo, note, expenseId: expense.id, createdById: userId } });
    });
    await this.audit.log({ userId, action: 'CREATE', entity: 'postal', entityId: row.id, summary: `Pochta to'lovi: ${company} — ${amount / 100n} so'm` });
    const list = await this.list(row.date.toISOString().slice(0, 10), row.date.toISOString().slice(0, 10));
    return list.items.find((i) => i.id === row.id)!;
  }

  /** Bekor qilish: to'lov va uning xarajati */
  async cancel(id: string, userId: string): Promise<{ id: string }> {
    const row = await this.prisma.postalPayment.findUnique({ where: { id } });
    if (!row || row.deletedAt) throw new NotFoundException('To‘lov topilmadi');
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.postalPayment.update({ where: { id }, data: { deletedAt: now } });
      if (row.expenseId) await tx.expense.updateMany({ where: { id: row.expenseId, deletedAt: null }, data: { deletedAt: now } });
    });
    await this.audit.log({ userId, action: 'DELETE', entity: 'postal', entityId: id, summary: `Pochta to'lovi bekor qilindi: ${row.company} — ${row.amountTiyin / 100n} so'm` });
    return { id };
  }
}