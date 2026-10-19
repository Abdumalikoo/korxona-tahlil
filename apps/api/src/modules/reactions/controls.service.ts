import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { periodLabel, shiftPeriod } from '../econ/econ.data';
import { outlookOf } from '../econ/econ.outlook';
import { PrismaService } from '../prisma/prisma.service';
import { cleanFilter, cleanKind, daysInMonth, monthsEnding, ReactionMetrics, todayIso } from './reactions.metrics';
import { fmtSom, ReactionsService } from './reactions.service';
import type {
  AssigneeView,
  ControlMonth,
  ControlOutlook,
  ControlView,
  CreateControlInput,
  ItemFilter,
  ItemKind,
  ToControlInput,
  UpdateControlInput,
} from './reactions.types';

type ControlRow = Prisma.ControlRuleGetPayload<{ include: { reaction: { select: { title: true } } } }>;

function limitFromSom(value: unknown, field = 'Chegara'): bigint {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > 1e14) throw new BadRequestException(`${field} noto'g'ri`);
  return BigInt(Math.round(n * 100));
}

/** Chegara buzilganmi: xarajat — chegaradan oshsa, daromad va natija — rejadan kam bo'lsa */
export function controlBreached(kind: ItemKind, value: bigint, limit: bigint): boolean {
  return kind === 'EXPENSE' ? value > limit : value < limit;
}

/**
 * Nazorat: modda har oy avtomatik hisoblanadi va oylik chegara bilan solishtiriladi.
 * Xarajat — chegaradan oshmasligi, daromad va natija — chegaradan kam bo'lmasligi kerak.
 */
@Injectable()
export class ControlsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: ReactionMetrics,
    private readonly reactions: ReactionsService,
  ) {}

  /** Tizim taklifi: so'nggi 3 to'liq oy o'rtachasi */
  async suggest(kind: ItemKind, filter: ItemFilter): Promise<bigint> {
    const current = todayIso().slice(0, 7);
    const months = monthsEnding(current, 4).slice(0, 3);
    const values = await this.metrics.monthly(kind, filter, months);
    const active = values.filter((v) => v !== 0n);
    if (active.length === 0) return 0n;
    return active.reduce((s, v) => s + v, 0n) / BigInt(active.length);
  }

  /** Munosabatni nazoratga o'tkazishdan oldin: har modda uchun taklif qilingan chegara */
  async preview(reactionId: string) {
    const reaction = await this.prisma.reaction.findUnique({ where: { id: reactionId }, include: { items: { orderBy: { order: 'asc' } } } });
    if (!reaction) throw new NotFoundException('Munosabat topilmadi');
    return Promise.all(
      reaction.items.map(async (item) => ({
        itemId: item.id,
        kind: item.kind as ItemKind,
        label: item.label,
        suggestedTiyin: (await this.suggest(item.kind as ItemKind, (item.filter ?? {}) as ItemFilter)).toString(),
      })),
    );
  }

  /** Munosabatning barcha moddalari nazoratga o'tadi (har biriga alohida qoida) */
  async fromReaction(reactionId: string, input: ToControlInput, userId: string): Promise<ControlView[]> {
    const reaction = await this.prisma.reaction.findUnique({
      where: { id: reactionId },
      include: { items: { orderBy: { order: 'asc' } }, assignees: true },
    });
    if (!reaction) throw new NotFoundException('Munosabat topilmadi');
    const startPeriod = todayIso().slice(0, 7);
    const assignees = reaction.assignees.map((a) => ({ pinfl: a.employeePinfl, fullName: a.fullName, position: a.position, role: a.role }));
    const limits = input?.limits ?? {};

    const data: Prisma.ControlRuleCreateManyInput[] = [];
    for (const item of reaction.items) {
      const kind = item.kind as ItemKind;
      const filter = (item.filter ?? {}) as ItemFilter;
      const given = limits[item.id];
      const limit = given !== undefined && given !== null ? limitFromSom(given, `«${item.label}» chegarasi`) : await this.suggest(kind, filter);
      data.push({
        reactionId,
        title: reaction.title,
        kind,
        label: item.label,
        filter: filter as Prisma.InputJsonValue,
        limitTiyin: limit,
        startPeriod,
        assignees: assignees as Prisma.InputJsonValue,
        note: typeof input?.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 2000) : reaction.note,
        createdById: userId,
      });
    }
    await this.prisma.$transaction([
      this.prisma.controlRule.createMany({ data }),
      this.prisma.reaction.update({ where: { id: reactionId }, data: { status: 'CONTROL', closedAt: new Date() } }),
    ]);
    return this.list(reactionId);
  }

  async create(input: CreateControlInput, userId: string): Promise<ControlView> {
    const title = typeof input?.title === 'string' ? input.title.trim().slice(0, 160) : '';
    const label = typeof input?.label === 'string' ? input.label.trim().slice(0, 200) : '';
    if (!title || !label) throw new BadRequestException('Nomi kiritilmagan');
    const kind = cleanKind(input.kind);
    const filter = cleanFilter(input.filter);
    const assignees = (await this.reactions.resolveAssignees(input.assignees)).map((a) => ({ pinfl: a.employeePinfl, fullName: a.fullName, position: a.position, role: a.role }));
    const rule = await this.prisma.controlRule.create({
      data: {
        title,
        kind,
        label,
        filter: filter as Prisma.InputJsonValue,
        limitTiyin: input.limitSom !== undefined ? limitFromSom(input.limitSom) : await this.suggest(kind, filter),
        startPeriod: todayIso().slice(0, 7),
        assignees: assignees as Prisma.InputJsonValue,
        note: typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 2000) : null,
        createdById: userId,
      },
      include: { reaction: { select: { title: true } } },
    });
    return this.evaluate(rule);
  }

  async update(id: string, input: UpdateControlInput): Promise<ControlView> {
    const found = await this.prisma.controlRule.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException('Nazorat topilmadi');
    const data: Prisma.ControlRuleUpdateInput = {};
    if (input.title !== undefined) {
      const title = String(input.title).trim().slice(0, 160);
      if (!title) throw new BadRequestException('Nomi kiritilmagan');
      data.title = title;
    }
    if (input.limitSom !== undefined) data.limitTiyin = limitFromSom(input.limitSom);
    if (input.note !== undefined) data.note = input.note ? String(input.note).trim().slice(0, 2000) : null;
    if (input.isActive !== undefined) data.isActive = Boolean(input.isActive);
    if (input.assignees !== undefined) {
      data.assignees = (await this.reactions.resolveAssignees(input.assignees)).map((a) => ({
        pinfl: a.employeePinfl,
        fullName: a.fullName,
        position: a.position,
        role: a.role,
      })) as Prisma.InputJsonValue;
    }
    const rule = await this.prisma.controlRule.update({ where: { id }, data, include: { reaction: { select: { title: true } } } });
    return this.evaluate(rule);
  }

  async remove(id: string): Promise<void> {
    const found = await this.prisma.controlRule.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException('Nazorat topilmadi');
    await this.prisma.controlRule.delete({ where: { id } });
  }

  /** asOf — umumiy «Davr» oyi: o'tgan oy bo'lsa, holat o'sha oy oxiridagidek hisoblanadi */
  async list(reactionId?: string, asOf?: string): Promise<ControlView[]> {
    const rules = await this.prisma.controlRule.findMany({
      where: reactionId ? { reactionId } : {},
      include: { reaction: { select: { title: true } } },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });
    return Promise.all(rules.map((rule) => this.evaluate(rule, asOf)));
  }

  async one(id: string, asOf?: string): Promise<ControlView> {
    const rule = await this.prisma.controlRule.findUnique({ where: { id }, include: { reaction: { select: { title: true } } } });
    if (!rule) throw new NotFoundException('Nazorat topilmadi');
    return this.evaluate(rule, asOf);
  }

  // ═══════════ Avtomatik hisob ═══════════

  /**
   * asOf — o'tgan oy bo'lsa (umumiy «Davr»), nazorat o'sha oy oxirida turgandek hisoblanadi:
   * oxirgi ko'rsatiladigan oy — asOf (tugagan, tekshiriladi), prognoz keyingi oydan.
   */
  async evaluate(rule: ControlRow, asOf?: string): Promise<ControlView> {
    const kind = rule.kind as ItemKind;
    const filter = (rule.filter ?? {}) as ItemFilter;
    const today = todayIso();
    const currentPeriod = today.slice(0, 7);
    const past = asOf && /^\d{4}-(0[1-9]|1[0-2])$/.test(asOf) && asOf < currentPeriod ? asOf : null;
    const lastMonth = past ?? currentPeriod;
    // 24 oy olinadi: oxirgi 12 tasi ko'rsatiladi, hammasi prognoz modelini o'rgatish uchun
    const longMonths = monthsEnding(lastMonth, 24);
    const longValues = await this.metrics.monthly(kind, filter, longMonths);
    const months = longMonths.slice(-12);
    const values = longValues.slice(-12);
    const limit = rule.limitTiyin;
    const isMax = kind === 'EXPENSE';
    const breach = (v: bigint) => controlBreached(kind, v, limit);

    const day = Number(today.slice(8, 10));
    const monthDays = daysInMonth(currentPeriod);
    const rows: ControlMonth[] = months.map((period, i) => {
      const value = values[i]!;
      // Joriy oy hali tugamagan (oyning oxirgi kuni ham — kun tugamaguncha): tekshirilmaydi, sur'at bo'yicha taxmin qilinadi
      const partial = !past && period === currentPeriod;
      const projected = partial ? BigInt(Math.round((Number(value) / day) * monthDays)) : null;
      return {
        period,
        valueTiyin: value.toString(),
        projectedTiyin: projected === null ? null : projected.toString(),
        breached: period >= rule.startPeriod && !partial && breach(value),
        partial,
      };
    });

    const checked = rows.filter((r) => r.period >= rule.startPeriod && !r.partial);
    const breaches = checked.filter((r) => r.breached).length;
    const current = rows[rows.length - 1] ?? null;
    const currentValue = current ? BigInt(current.projectedTiyin ?? current.valueTiyin) : 0n;
    const usagePercent = limit !== 0n ? Math.round((Number(currentValue) / Number(limit)) * 1000) / 10 : null;

    const suggested = await this.suggest(kind, filter);
    const lastChecked = checked[checked.length - 1];
    let status: ControlView['status'];
    let statusText: string;
    if (!rule.isActive) {
      status = 'nodata';
      statusText = "Nazorat to'xtatilgan";
    } else if (lastChecked?.breached) {
      status = 'breach';
      statusText = isMax
        ? `${lastChecked.period} oyida chegara buzildi: ${fmtSom(BigInt(lastChecked.valueTiyin))} (chegara ${fmtSom(limit)})`
        : `${lastChecked.period} oyida reja bajarilmadi: ${fmtSom(BigInt(lastChecked.valueTiyin))} (kamida ${fmtSom(limit)})`;
    } else if (current && breach(currentValue)) {
      status = 'risk';
      statusText = isMax
        ? `Joriy oy sur'ati bilan ${fmtSom(currentValue)} bo'ladi — chegaradan oshishi mumkin`
        : `Joriy oy sur'ati bilan ${fmtSom(currentValue)} bo'ladi — rejadan kam bo'lishi mumkin`;
    } else if (past) {
      status = 'ok';
      statusText = isMax
        ? `Chegara ichida: ${periodLabel(past)} — ${fmtSom(currentValue)}`
        : `Reja bajarilgan: ${periodLabel(past)} — ${fmtSom(currentValue)}`;
    } else {
      status = 'ok';
      statusText = isMax ? `Chegara ichida: joriy oy taxmini ${fmtSom(currentValue)}` : `Reja bajarilmoqda: joriy oy taxmini ${fmtSom(currentValue)}`;
    }

    // ─────────── Prognoz: keyingi 3 oy va chegarani buzish ehtimoli ───────────
    // Tarixiy ko'rinishda oxirgi oy tugagan — hammasi o'rgatishga kiradi, prognoz keyingi oydan
    const outlook = past
      ? this.outlook(longValues.map((v) => Number(v) / 100), shiftPeriod(past, 1), kind, limit, rule.id, false)
      : this.outlook(longValues.slice(0, -1).map((v) => Number(v) / 100), currentPeriod, kind, limit, rule.id);
    if (rule.isActive && status === 'ok' && outlook && outlook.view.reliability !== 'low') {
      const next = outlook.view.months[0];
      if (next && next.breachProbability >= 0.65) {
        status = 'risk';
        statusText = `Prognoz: ${periodLabel(next.period)} oyida ${isMax ? 'chegaradan oshish' : 'rejadan kam bo\'lish'} ehtimoli ${Math.round(next.breachProbability * 100)}% (kutilayotgan ${fmtSom(BigInt(next.meanTiyin))})`;
      }
    }

    const assignees = (Array.isArray(rule.assignees) ? rule.assignees : []) as unknown as AssigneeView[];
    return {
      id: rule.id,
      reactionId: rule.reactionId,
      reactionTitle: rule.reaction?.title ?? null,
      title: rule.title,
      kind,
      label: rule.label,
      filter,
      limitTiyin: limit.toString(),
      startPeriod: rule.startPeriod,
      note: rule.note,
      isActive: rule.isActive,
      assignees,
      createdAt: rule.createdAt.toISOString(),
      months: rows,
      current,
      usagePercent,
      breaches,
      checkedMonths: checked.length,
      suggestedTiyin: suggested.toString(),
      forecastSuggestedTiyin: outlook ? outlook.suggestedTiyin : null,
      outlook: outlook ? outlook.view : null,
      status,
      statusText,
    };
  }

  /**
   * Nazorat moddasi uchun prognoz (Katta modellar yadrosi): joriy oydan keyingi 3 oy,
   * har oy chegarani buzish ehtimoli. Tarix 4 oydan kam bo'lsa — null.
   */
  private outlook(
    fullMonths: number[],
    currentPeriod: string,
    kind: ItemKind,
    limit: bigint,
    seedKey: string,
    /** true — birinchi qadam tugamagan joriy oy (ko'rsatilmaydi); tarixiy ko'rinishda false */
    skipCurrent = true,
  ): { view: ControlOutlook; suggestedTiyin: string } | null {
    const isMax = kind === 'EXPENSE';
    const limitSom = Number(limit) / 100;
    const result = outlookOf(fullMonths, currentPeriod, { steps: 4, nonNegative: kind !== 'RESULT', threshold: limitSom, seedKey: `control|${seedKey}` });
    if (!result) return null;
    // Birinchi qadam — joriy oy (u sur'at bo'yicha alohida hisoblanadi), keyingi 3 oy ko'rsatiladi.
    // Tarixiy ko'rinishda joriy oy yo'q — darhol keyingi 3 oy.
    const next = skipCurrent ? result.steps.slice(1) : result.steps.slice(0, 3);
    const months = next.map((step) => ({
      period: step.period,
      meanTiyin: String(Math.round(step.mean * 100)),
      lo80Tiyin: String(Math.round(step.lo80 * 100)),
      hi80Tiyin: String(Math.round(step.hi80 * 100)),
      breachProbability: step.pAbove === null ? 0 : isMax ? step.pAbove : 1 - step.pAbove,
    }));
    const avg = next.reduce((s, x) => s + x.mean, 0) / Math.max(1, next.length);
    const reliabilityText = { high: 'ishonchli', medium: "o'rtacha ishonchli", low: 'taxminiy', none: "ma'lumot kam" }[result.reliability];
    const risky = months.filter((m) => m.breachProbability >= 0.6);
    const text =
      `Prognoz (${result.model}, ${reliabilityText}): keyingi 3 oyda o'rtacha ${fmtSom(BigInt(Math.round(avg * 100)))} / oy. ` +
      (risky.length
        ? `${isMax ? 'Chegaradan oshishi' : 'Rejadan kam bo\'lishi'} ehtimoli yuqori oylar: ${risky.map((m) => `${periodLabel(m.period)} (${Math.round(m.breachProbability * 100)}%)`).join(', ')}.`
        : `Uch oyning hech birida ${isMax ? 'chegaradan oshish' : 'rejadan kam bo\'lish'} ehtimoli 60% dan yuqori emas.`);
    return {
      view: { model: result.model, reliability: result.reliability, reliabilityText, wape: result.wape, historyMonths: result.months, months, text },
      suggestedTiyin: String(Math.round(avg * 100)),
    };
  }
}