import { BadRequestException, Injectable } from '@nestjs/common';
import { SEGMENTS, segmentLabel } from '../../common/segments/segments';
import { AuditService } from '../audit/audit.service';
import { CenterIncomeService } from '../cashbook/center-income.service';
import { ExpensesService } from '../expenses/expenses.service';
import { PrismaService } from '../prisma/prisma.service';

// ═══════════════════════════════════════════════════════════
// Moddalar boshqaruvi › Xarajatlar tarkibiy tuzilishi — haqiqiy ishlayotgan tuzilma, birlik bo'yicha:
//  • birlik: Markaz bo'limi (dep:<id>), hudud (r:<kod>) yoki yo'nalish (s:<kod>);
//  • daromad tomoni: shu birlikka yozilgan daromad (moddalar bo'yicha) va Markaz bo'limi uchun — kunlik tushum qatorlari
//    (qaysi qator shu bo'limniki — «Daromadlar › Markaz tushumi» bilan bir sozlama);
//  • xarajat tomoni: shu birlikka yozilgan xarajat moddalari (yozuvlar soni va summa);
//  • yozuvlarni boshqa modda / birlikka ko'chirish (ko'plab) — qidiruv bilan topib (bank to'lovi ham).
// Yozuvlar bazada shu joyga yoziladi (dashbordlar o'zi yangilanadi); har ko'chirish auditda.
// ═══════════════════════════════════════════════════════════

export type UnitKey = string;

/** Avtomatik qayta yoziladigan yozuvlar — qo'lda ko'chirilmaydi (o'z bo'limida o'zgartiriladi) */
const LOCKED_SOURCES: Record<string, string> = {
  PAYROLL: "Ish haqi yozuvi — xodim joyi (ish haqi tarkibi) yoki foizli bo'linish orqali o'zgaradi",
  LEASE: 'Ijara yozuvi — ijara shartnomasida (joyi) o‘zgartiriladi',
  VEHICLE: 'Mashina yozuvi — Mashinalar bo‘limida o‘zgartiriladi',
  TAX: 'Soliq yozuvi — avtomatik hisoblanadi (ish haqi / daromad bilan birga ergashadi)',
  ASSET: 'Asosiy vosita yozuvi — Asosiy vositalar bo‘limida',
  WAREHOUSE: 'Ombor yozuvi — Ombor hujjati orqali',
};

const MAX_MOVE = 500;

function parseUnit(raw: unknown): { kind: 'dep'; id: string } | { kind: 'region'; code: number } | { kind: 'segment'; code: string } {
  const s = typeof raw === 'string' ? raw : '';
  if (s.startsWith('dep:') && s.length > 4) return { kind: 'dep', id: s.slice(4) };
  if (/^r:\d{1,4}$/.test(s)) return { kind: 'region', code: Number(s.slice(2)) };
  if (s.startsWith('s:') && SEGMENTS.some((x) => x.code === s.slice(2))) return { kind: 'segment', code: s.slice(2) };
  throw new BadRequestException("Birlik noto'g'ri (dep:<id>, r:<kod> yoki s:<kod>)");
}

function parseDay(raw: unknown, name: string): Date {
  const s = typeof raw === 'string' ? raw : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new BadRequestException(`${name} noto'g'ri (YYYY-MM-DD)`);
  return new Date(`${s}T00:00:00+05:00`);
}

@Injectable()
export class CostStructureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly expenses: ExpensesService,
    private readonly centerIncome: CenterIncomeService,
  ) {}

  /** Tanlash uchun birliklar: Markaz bo'limlari, hududlar, yo'nalishlar */
  async units() {
    const [deps, regions] = await Promise.all([
      this.prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.region.findMany({ where: { isActive: true, code: { gt: 0 } }, select: { code: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    return {
      departments: deps.map((d) => ({ key: `dep:${d.id}`, label: d.name })),
      regions: regions.map((r) => ({ key: `r:${r.code}`, label: r.name })),
      segments: SEGMENTS.map((s) => ({ key: `s:${s.code}`, label: segmentLabel(s.code) })),
    };
  }

  private where(u: ReturnType<typeof parseUnit>) {
    if (u.kind === 'dep') return { departmentId: u.id, segment: null };
    if (u.kind === 'region') return { regionCode: u.code, segment: null };
    return { segment: u.code };
  }

  /** Bitta birlik: daromad va xarajat tomoni (davr ichida) */
  async unit(rawUnit: unknown, rawFrom: unknown, rawTo: unknown) {
    const u = parseUnit(rawUnit);
    const start = parseDay(rawFrom, 'Boshlanish');
    const end = new Date(parseDay(rawTo, 'Tugash').getTime() + 86_400_000);
    const base = { deletedAt: null, date: { gte: start, lt: end }, ...this.where(u) };
    const [inc, exp, incCats, expCats, label] = await Promise.all([
      this.prisma.income.groupBy({ by: ['categoryCode'], where: base, _count: { _all: true }, _sum: { amountTiyin: true } }),
      this.prisma.expense.groupBy({ by: ['categoryCode', 'source'], where: base, _count: { _all: true }, _sum: { amountTiyin: true } }),
      this.prisma.incomeCategory.findMany({ select: { code: true, label: true } }),
      this.prisma.category.findMany({ select: { code: true, label: true, parentCode: true } }),
      u.kind === 'dep'
        ? this.prisma.department.findUnique({ where: { id: u.id }, select: { name: true } }).then((d) => d?.name ?? "Bo'lim")
        : u.kind === 'region'
          ? this.prisma.region.findUnique({ where: { code: u.code }, select: { name: true } }).then((r) => r?.name ?? 'Hudud')
          : Promise.resolve(segmentLabel(u.code)),
    ]);
    const incLabel = new Map(incCats.map((c) => [c.code, c.label]));
    const catBy = new Map(expCats.map((c) => [c.code, c]));
    // Xarajat moddalari: modda × (qo'lda ko'chirib bo'ladimi — manba bo'yicha)
    const items = new Map<string, { code: string; label: string; group: string | null; parentCode: string | null; count: number; total: bigint; locked: number }>();
    for (const g of exp) {
      const c = catBy.get(g.categoryCode);
      const it = items.get(g.categoryCode) ?? { code: g.categoryCode, label: c?.label ?? g.categoryCode, group: c?.parentCode ? (catBy.get(c.parentCode)?.label ?? null) : null, parentCode: c?.parentCode ?? null, count: 0, total: 0n, locked: 0 };
      it.count += g._count._all;
      it.total += g._sum.amountTiyin ?? 0n;
      if (LOCKED_SOURCES[g.source]) it.locked += g._count._all;
      items.set(g.categoryCode, it);
    }
    // Markaz bo'limi — kunlik tushum qatorlari (qaysi biri shu bo'limniki)
    let cashLines: { id: string; code: string | null; name: string; departmentId: string | null; totalTiyin: string }[] = [];
    if (u.kind === 'dep') {
      const year = await this.centerIncome.year(start.getUTCFullYear()).catch(() => null);
      cashLines = (year?.rows ?? [])
        .filter((r) => !r.isHeader && r.owner === 'CENTER' && r.mode && r.mode !== 'NONE')
        .map((r) => ({ id: r.id, code: r.code, name: r.name, departmentId: r.departmentId, totalTiyin: r.totalTiyin }));
    }
    const sum = (list: { total: bigint }[]) => list.reduce((s, x) => s + x.total, 0n).toString();
    const incomeParts = inc.map((g) => ({ code: g.categoryCode, label: incLabel.get(g.categoryCode) ?? g.categoryCode, count: g._count._all, total: g._sum.amountTiyin ?? 0n }));
    const expenseItems = [...items.values()].sort((a, b) => (b.total > a.total ? 1 : -1));
    return {
      unit: { key: typeof rawUnit === 'string' ? rawUnit : '', label },
      income: {
        totalTiyin: sum(incomeParts),
        parts: incomeParts.sort((a, b) => (b.total > a.total ? 1 : -1)).map((p) => ({ ...p, total: undefined, totalTiyin: p.total.toString() })),
        cashLines,
      },
      expense: {
        totalTiyin: sum(expenseItems),
        items: expenseItems.map((i) => ({ code: i.code, label: i.label, group: i.group, parentCode: i.parentCode, count: i.count, totalTiyin: i.total.toString(), locked: i.locked })),
      },
    };
  }

  /**
   * Xarajat yozuvlarini qidirish (ko'chirish uchun): izoh, bank to'lov maqsadi, kontragent, INN, hujjat raqami;
   * birlik va modda bo'yicha ham (shu birlikning shu moddasidagi yozuvlar). 200 tagacha, eng kattasidan.
   */
  async search(q: { text?: unknown; unit?: unknown; categoryCode?: unknown; from?: unknown; to?: unknown }) {
    const start = parseDay(q.from, 'Boshlanish');
    const end = new Date(parseDay(q.to, 'Tugash').getTime() + 86_400_000);
    const term = typeof q.text === 'string' ? q.text.trim().slice(0, 100) : '';
    const where: Record<string, unknown> = { deletedAt: null, date: { gte: start, lt: end } };
    if (q.unit) Object.assign(where, this.where(parseUnit(q.unit)));
    if (typeof q.categoryCode === 'string' && q.categoryCode) where.categoryCode = q.categoryCode;
    if (term) {
      where.OR = [
        { description: { contains: term, mode: 'insensitive' } },
        { bankPurpose: { contains: term, mode: 'insensitive' } },
        { counterparty: { contains: term, mode: 'insensitive' } },
        { counterpartyInn: { contains: term } },
        { documentNo: { contains: term, mode: 'insensitive' } },
      ];
    }
    if (!term && !q.unit && !q.categoryCode) throw new BadRequestException('Qidiruv matnini yozing');
    const rows = await this.prisma.expense.findMany({
      where,
      orderBy: [{ amountTiyin: 'desc' }, { date: 'desc' }],
      take: 200,
      select: { id: true, date: true, amountTiyin: true, categoryCode: true, source: true, description: true, bankPurpose: true, counterparty: true, departmentId: true, regionCode: true, segment: true, category: { select: { label: true } }, department: { select: { name: true } }, region: { select: { name: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      date: r.date.toISOString().slice(0, 10),
      amountTiyin: r.amountTiyin.toString(),
      categoryCode: r.categoryCode,
      categoryLabel: r.category.label,
      place: r.segment ? segmentLabel(r.segment) : r.regionCode && r.regionCode > 0 ? (r.region?.name ?? `Hudud ${r.regionCode}`) : r.department ? `Markaz › ${r.department.name}` : 'Markaz',
      text: (r.bankPurpose ?? r.description ?? '').slice(0, 240),
      counterparty: r.counterparty,
      locked: LOCKED_SOURCES[r.source] ?? null,
    }));
  }

  /**
   * Yozuvlarni ko'chirish: { ids, unit?, categoryCode? } — boshqa birlikka va/yoki boshqa moddaga. Har yozuv oddiy
   * tahrirlash qoidasi bilan (moddaning birlik ro'yxati, qulflar); avtomatik yozuvlar (ish haqi, soliq …) — o'tkazib
   * yuboriladi va sababi aytiladi.
   */
  async move(body: { ids?: unknown; unit?: unknown; categoryCode?: unknown }, userId: string) {
    const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.map(String))].slice(0, MAX_MOVE + 1) : [];
    if (!ids.length) throw new BadRequestException('Yozuvlarni belgilang');
    if (ids.length > MAX_MOVE) throw new BadRequestException(`Bir martada ${MAX_MOVE} tagacha yozuv`);
    const categoryCode = typeof body.categoryCode === 'string' && body.categoryCode ? body.categoryCode : undefined;
    const target = body.unit ? parseUnit(body.unit) : null;
    if (!categoryCode && !target) throw new BadRequestException('Qayerga — birlik yoki moddani tanlang');
    const place = target
      ? target.kind === 'dep'
        ? { regionCode: 0, departmentId: target.id, districtId: null, segment: null }
        : target.kind === 'region'
          ? { regionCode: target.code, departmentId: null, districtId: null, segment: null }
          : { regionCode: null, departmentId: null, districtId: null, segment: target.code }
      : {};
    const rows = await this.prisma.expense.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, source: true, amountTiyin: true } });
    let moved = 0;
    let movedTiyin = 0n;
    const skipped: { id: string; reason: string }[] = [];
    for (const r of rows) {
      const lock = LOCKED_SOURCES[r.source];
      if (lock) {
        skipped.push({ id: r.id, reason: lock });
        continue;
      }
      try {
        await this.expenses.update(r.id, { ...(categoryCode ? { categoryCode } : {}), ...place } as never);
        moved += 1;
        movedTiyin += r.amountTiyin;
      } catch (e) {
        skipped.push({ id: r.id, reason: (e as Error).message });
      }
    }
    for (const id of ids) if (!rows.some((r) => r.id === id)) skipped.push({ id, reason: 'Yozuv topilmadi' });
    if (moved) {
      await this.audit.log({
        userId,
        action: 'UPDATE',
        entity: 'expense',
        entityId: 'cost-structure',
        summary: `Xarajatlar tarkibiy tuzilishi: ${moved} ta yozuv (${(Number(movedTiyin) / 100).toLocaleString('uz-UZ')} so'm) ko'chirildi${target ? ` → ${typeof body.unit === 'string' ? body.unit : ''}` : ''}${categoryCode ? ` · modda ${categoryCode}` : ''}${skipped.length ? `; ${skipped.length} tasi o'tkazib yuborildi` : ''}`,
      });
    }
    return { moved, movedTiyin: movedTiyin.toString(), skipped: skipped.slice(0, 50), skippedCount: skipped.length };
  }
}
