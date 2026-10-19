import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// ═══════════════════════════════════════════════════════════
// Global qidiruv (Ctrl+K): xodimlar, daromadlar, xarajatlar, mashinalar,
// ijara shartnomalari, munosabat va nazorat. Har guruhdan eng mos bir nechtasi.
// O'chirilgan yozuvlar qidirilmaydi.
// ═══════════════════════════════════════════════════════════

const TZ = 5 * 3600_000;
const LIMIT = 6;

export interface SearchEntry {
  id: string;
  title: string;
  subtitle: string;
  /** Qo'shimcha ma'lumot (yozuv uchun: oy, bo'lim) */
  period?: string;
  section?: 'DOIMIY' | 'BOSHQA';
  amountTiyin?: string;
}

export interface SearchResult {
  query: string;
  employees: SearchEntry[];
  incomes: SearchEntry[];
  expenses: SearchEntry[];
  vehicles: SearchEntry[];
  leases: SearchEntry[];
  reactions: SearchEntry[];
  controls: SearchEntry[];
}

const iso = (d: Date) => new Date(d.getTime() + TZ).toISOString().slice(0, 10);
const uz = (d: Date) => iso(d).split('-').reverse().join('.');

function som(tiyin: bigint): string {
  const v = Number(tiyin) / 100;
  const abs = Math.abs(v);
  const t = abs >= 1e9 ? `${(abs / 1e9).toFixed(2)} mlrd` : abs >= 1e6 ? `${(abs / 1e6).toFixed(1)} mln` : abs >= 1e3 ? `${Math.round(abs / 1e3)} ming` : `${Math.round(abs)}`;
  return `${v < 0 ? '−' : ''}${t.replace('.', ',')} so'm`;
}

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(raw?: string): Promise<SearchResult> {
    const q = String(raw ?? '').trim().slice(0, 80);
    const empty: SearchResult = { query: q, employees: [], incomes: [], expenses: [], vehicles: [], leases: [], reactions: [], controls: [] };
    if (q.length < 2) return empty;
    const like = { contains: q, mode: 'insensitive' as const };

    const [regions, employees, incomes, expenses, vehicles, leases, reactions, controls] = await Promise.all([
      this.prisma.region.findMany({ select: { code: true, name: true } }),
      this.prisma.employee.findMany({
        where: { OR: [{ fullName: like }, { position: like }, ...(/^\d{3,}$/.test(q) ? [{ pinfl: { startsWith: q } }] : [])] },
        select: { pinfl: true, fullName: true, position: true, regionCode: true, isActive: true },
        orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
        take: LIMIT,
      }),
      this.prisma.income.findMany({
        where: { deletedAt: null, OR: [{ clientName: like }, { description: like }, { contractNo: like }] },
        select: { id: true, date: true, amountTiyin: true, clientName: true, description: true, section: true, regionCode: true, category: { select: { label: true } } },
        orderBy: { date: 'desc' },
        take: LIMIT,
      }),
      this.prisma.expense.findMany({
        where: { deletedAt: null, OR: [{ counterparty: like }, { description: like }, { documentNo: like }] } as Prisma.ExpenseWhereInput,
        select: { id: true, date: true, amountTiyin: true, counterparty: true, description: true, section: true, regionCode: true, category: { select: { label: true } } },
        orderBy: { date: 'desc' },
        take: LIMIT,
      }),
      this.prisma.vehicle.findMany({
        where: { deletedAt: null, OR: [{ plateNumber: like }, { model: like }, { driverName: like }] },
        select: { id: true, plateNumber: true, model: true, driverName: true, regionCode: true },
        take: LIMIT,
      }),
      this.prisma.lease.findMany({
        where: { deletedAt: null, OR: [{ title: like }, { lessorName: like }, { number: like }, { address: like }] },
        select: { id: true, title: true, number: true, lessorName: true, regionCode: true },
        take: LIMIT,
      }),
      this.prisma.reaction.findMany({ where: { title: like }, select: { id: true, title: true, status: true, dueDate: true }, orderBy: { createdAt: 'desc' }, take: LIMIT }),
      this.prisma.controlRule.findMany({ where: { OR: [{ label: like }, { title: like }] }, select: { id: true, label: true, title: true, isActive: true }, take: LIMIT }),
    ]);

    const region = new Map(regions.map((r) => [r.code, r.name]));
    const place = (code: number | null) => (code === null ? '' : (region.get(code) ?? `Hudud ${code}`));
    const status: Record<string, string> = { OPEN: 'kuzatilmoqda', CLOSED: 'yopilgan', CONTROL: 'nazoratda' };

    return {
      query: q,
      employees: employees.map((e) => ({ id: e.pinfl, title: e.fullName, subtitle: [e.position, place(e.regionCode), e.isActive ? null : "bo'shagan"].filter(Boolean).join(' · ') })),
      incomes: incomes.map((r) => ({
        id: r.id,
        title: r.clientName || r.description || r.category.label,
        subtitle: [uz(r.date), som(r.amountTiyin), r.category.label, place(r.regionCode)].filter(Boolean).join(' · '),
        period: iso(r.date).slice(0, 7),
        section: r.section as 'DOIMIY' | 'BOSHQA',
        amountTiyin: r.amountTiyin.toString(),
      })),
      expenses: expenses.map((r) => ({
        id: r.id,
        title: r.counterparty || r.description || r.category.label,
        subtitle: [uz(r.date), som(r.amountTiyin), r.category.label, place(r.regionCode)].filter(Boolean).join(' · '),
        period: iso(r.date).slice(0, 7),
        section: r.section as 'DOIMIY' | 'BOSHQA',
        amountTiyin: r.amountTiyin.toString(),
      })),
      vehicles: vehicles.map((v) => ({ id: v.id, title: `${v.plateNumber} · ${v.model}`, subtitle: [v.driverName, place(v.regionCode)].filter(Boolean).join(' · ') })),
      leases: leases.map((l) => ({ id: l.id, title: l.title, subtitle: [`№${l.number}`, l.lessorName, place(l.regionCode)].filter(Boolean).join(' · ') })),
      reactions: reactions.map((r) => ({ id: r.id, title: r.title, subtitle: `${status[String(r.status)] ?? r.status} · muddat ${uz(r.dueDate)}` })),
      controls: controls.map((c) => ({ id: c.id, title: c.label, subtitle: [c.title !== c.label ? c.title : null, c.isActive ? 'faol' : "to'xtatilgan"].filter(Boolean).join(' · ') })),
    };
  }
}