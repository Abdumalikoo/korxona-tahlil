import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { ENTRY_UNITS, entryUnitLabel, entryUnitOf, isSegment } from '../../common/segments/segments';
import { readUnitCategories, unitList } from '../../common/segments/unit-categories';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { monthsBetween } from '../../common/period';
import { PayrollService } from '../payroll/payroll.service';
import { CATEGORY_LABELS } from '../salary-composition/salary-composition.constants';
import { UnitPayrollService } from '../unit-payroll/unit-payroll.service';
import { payrollPartCategory, payrollPartOf, policyRouting, readPolicy, ruleLookup, unitOfKey, writePolicy } from './policy.util';

// ═══════════════════════════════════════════════════════════
// Bo'lim xarajatlari siyosati — har 6 bo'limda (Markaz, Hududlar, Tax free, Marksheyder, Fermer xo'jaligi, Buxgalteriya):
// shu bo'limda yozilgan xarajat moddasi qaysi bo'lim hisobiga o'tadi.
//  • Qoida modda bo'yicha: «Markaz hisobiga», «Marksheyder hisobiga» … yoki «Shu bo'limda qoladi» (umumiy siyosatdan istisno).
//  • Ota moddaga (guruhga) berilgan qoida ichki moddalariga ham o'tadi; ichki moddada alohida qoida — ustun.
//  • Yozuvlar joyida qoladi (bazada o'zgarmaydi) — Solishtirma, hisobotlar va Markaz xarajatida tanlangan bo'lim hisobida.
//  • Qoida o'chirilsa — hammasi avvalgidek. Saqlanadi: settings «expense.policy».unitRules — migratsiya kerak emas.
// ═══════════════════════════════════════════════════════════

const TASHKENT_OFFSET_HOURS = 5;
/** Maqsad bo'lishi mumkin: Markaz va yo'nalishlar (Hududlar — aniq hudud yo'q, shuning uchun maqsad emas) */
const TARGETS = ENTRY_UNITS.filter((u) => u.code !== 'REGION').map((u) => ({ code: u.code as string, label: u.label as string }));

export interface UnitPolicyCategory {
  code: string;
  label: string;
  parentCode: string | null;
  /** Guruh (ichida moddalar bor) */
  group: boolean;
  /** Bo'lim ro'yxatida (Moddalar) */
  listed: boolean;
  /** Shu moddaning o'z qoidasi (maqsad bo'lim kodi) yoki null */
  rule: string | null;
  /** Amaldagi: kim hisobida va nima sababdan */
  effective: { target: string; targetLabel: string; origin: 'unit' | 'parent' | 'global' | 'none' };
  /** Umumiy siyosat bo'yicha (bo'lim qoidasi bo'lmasa) — kim hisobida */
  globalTarget: string;
  /** Davrda shu bo'limda yozilgan */
  count: number;
  totalTiyin: string;
  /** Shu bo'limga tegishli: ro'yxatda, davrda yozilgan yoki qoidasi bor (bo'lmasa — «Hamma moddalar»da ko'rinadi) */
  used: boolean;
}

/** Ish haqi qismi (ish haqi tarkibi komponenti) — bo'lim siyosatida */
export interface UnitPolicyPayrollPart {
  code: string;
  name: string;
  /** Komponent turi (asosiy ish haqi, premiyalar, ustamalar …) */
  group: string;
  /** Davrda shu bo'lim xodimlariga hisoblangan (ish haqi tarkibidan) */
  totalTiyin: string;
  /** Shu bo'limning qoidasi (maqsad bo'lim kodi) yoki null — ish haqi ichida */
  rule: string | null;
  /** Umumiy siyosat bo'yicha (faqat Hududlar: bayram, choraklik … — Markaz) */
  globalTarget: string | null;
  /** Davrda ish haqidan ajratib yozilgani */
  splitTiyin: string;
}

@Injectable()
export class UnitPolicyService {
  private readonly logger = new Logger(UnitPolicyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly payroll?: PayrollService,
    @Optional() private readonly unitPayroll?: UnitPayrollService,
  ) {}

  /** Davrda shu bo'lim xodimlariga ish haqi tarkibidan hisoblangan komponentlar: kod → summa */
  private async componentTotals(unit: string, months: string[]): Promise<Map<string, bigint>> {
    const out = new Map<string, bigint>();
    const add = (code: string, v: bigint) => v > 0n && out.set(code, (out.get(code) ?? 0n) + v);
    if (isSegment(unit)) {
      const rows = await this.prisma.setting.findMany({ where: { key: { in: months.map((p) => `unit.composition.${unit}.${p}`) } }, select: { value: true } });
      for (const r of rows) {
        const list = ((r.value as { batches?: { cancelledAt: string | null; createdAt: string; rows?: { items?: Record<string, string> }[] }[] } | null)?.batches ?? []).filter((b) => !b.cancelledAt);
        const active = list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        for (const row of active?.rows ?? []) {
          for (const [code, v] of Object.entries(row.items ?? {})) {
            try {
              add(code, BigInt(v));
            } catch {
              /* noto'g'ri qiymat */
            }
          }
        }
      }
      return out;
    }
    if (unit !== 'CENTER' && unit !== 'REGION') return out;
    const batches = await this.prisma.salaryCompositionBatch.findMany({ where: { period: { in: months }, cancelledAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, period: true } });
    const latest = new Map<string, string>();
    for (const b of batches) if (!latest.has(b.period)) latest.set(b.period, b.id);
    if (!latest.size) return out;
    const items = await this.prisma.salaryCompositionItem.findMany({
      where: { batchId: { in: [...latest.values()] } },
      select: { componentCode: true, amountTiyin: true, row: { select: { employeePinfl: true } } },
    });
    const pins = [...new Set(items.map((i) => i.row.employeePinfl))];
    const emp = new Map((await this.prisma.employee.findMany({ where: { pinfl: { in: pins } }, select: { pinfl: true, regionCode: true } })).map((e) => [e.pinfl, e.regionCode]));
    for (const i of items) {
      const rc = emp.get(i.row.employeePinfl);
      if (rc === undefined || rc === null) continue;
      if ((unit === 'CENTER') === (rc === 0)) add(i.componentCode, i.amountTiyin);
    }
    return out;
  }

  unitOf(raw: unknown): string {
    if (typeof raw === 'string' && ENTRY_UNITS.some((u) => u.code === raw)) return raw;
    throw new BadRequestException("Bo'lim noto'g'ri");
  }

  private bounds(from: string, to: string) {
    const months = monthsBetween(from, to);
    const [fy, fm] = months[0]!.split('-').map(Number) as [number, number];
    const [ty, tm] = months[months.length - 1]!.split('-').map(Number) as [number, number];
    return {
      months,
      start: new Date(Date.UTC(fy, fm - 1, 1, -TASHKENT_OFFSET_HOURS)),
      end: new Date(Date.UTC(ty, tm, 1, -TASHKENT_OFFSET_HOURS)),
    };
  }

  /** Bo'lim siyosati sahifasi: moddalar, qoidalar, davrdagi summalar, boshqa bo'limlardan kelganlari */
  async view(unit: string, from: string, to: string) {
    const { months, start, end } = this.bounds(from, to);
    const [policy, cats, lists, rows, components, compTotals] = await Promise.all([
      readPolicy(this.prisma),
      this.prisma.category.findMany({ select: { code: true, label: true, parentCode: true, isLeaf: true, isActive: true, order: true } }),
      readUnitCategories(this.prisma),
      this.prisma.expense.findMany({
        where: { deletedAt: null, date: { gte: start, lt: end } },
        select: { amountTiyin: true, categoryCode: true, regionCode: true, departmentId: true, segment: true },
      }),
      this.prisma.salaryComponent.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { code: true, name: true, category: true, sign: true } }),
      this.componentTotals(unit, months),
    ]);
    const routing = policyRouting(policy, cats);
    // Umumiy siyosat (bo'lim qoidalarisiz) — bo'lim qoidasi bo'lmasa nima bo'lardi
    const globalOnly = policyRouting({ ...policy, unitRules: {} }, cats);
    const own = policy.unitRules[unit] ?? {};
    const rule = ruleLookup(own, cats);
    const label = new Map(cats.map((c) => [c.code, c.label]));
    const parent = new Map(cats.map((c) => [c.code, c.parentCode]));
    const unitLabel = (code: string) => entryUnitLabel(code);
    const keyUnit = (key: string | undefined, fallback: string) => (key ? (unitOfKey(key) ?? fallback) : fallback);

    // Davrdagi yozuvlar
    const mine = new Map<string, { count: number; total: bigint }>();
    const incoming = new Map<string, { source: string; code: string; count: number; total: bigint }>();
    let written = 0n;
    let movedOut = 0n;
    let incomingTotal = 0n;
    const outBy = new Map<string, bigint>();
    for (const r of rows) {
      const source = entryUnitOf(r);
      if (!source) continue;
      const routed = routing.route(r);
      const target = keyUnit(routed?.key, source);
      if (source === unit) {
        written += r.amountTiyin;
        const m = mine.get(r.categoryCode) ?? { count: 0, total: 0n };
        m.count += 1;
        m.total += r.amountTiyin;
        mine.set(r.categoryCode, m);
        if (target !== unit) {
          movedOut += r.amountTiyin;
          outBy.set(target, (outBy.get(target) ?? 0n) + r.amountTiyin);
        }
      } else if (target === unit) {
        incomingTotal += r.amountTiyin;
        const k = `${source}|${r.categoryCode}`;
        const g = incoming.get(k) ?? { source, code: r.categoryCode, count: 0, total: 0n };
        g.count += 1;
        g.total += r.amountTiyin;
        incoming.set(k, g);
      }
    }

    // Ko'rsatiladigan moddalar: bo'lim ro'yxati + davrda yozilganlari + qoidasi borlari (ota guruhlari bilan)
    const listed = new Set(unitList(lists, 'expense', unit));
    // Ko'rinadigan: hamma faol moddalar (ish haqi qismlari moddalari — alohida bo'limda); «used» — shu bo'limga tegishlilari
    const used = new Set<string>([...listed, ...mine.keys(), ...Object.keys(own)].filter((c) => label.has(c)));
    for (const c of [...used]) {
      let p = parent.get(c) ?? null;
      for (let d = 0; p && d < 20; d += 1) {
        used.add(p);
        p = parent.get(p) ?? null;
      }
    }
    const show = new Set<string>(cats.filter((c) => (c.isActive || used.has(c.code)) && payrollPartOf(c.code) === null && c.code !== 'IHQ').map((c) => c.code));
    for (const c of [...show]) {
      let p = parent.get(c) ?? null;
      for (let d = 0; p && d < 20; d += 1) {
        show.add(p);
        p = parent.get(p) ?? null;
      }
    }
    const hasChild = new Set(cats.filter((c) => c.parentCode).map((c) => c.parentCode!));
    const sample = (code: string) => ({ categoryCode: code, ...placeOf(unit) });
    const categories: UnitPolicyCategory[] = cats
      .filter((c) => show.has(c.code))
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
      .map((c) => {
        const r = rule(c.code);
        const g = globalOnly.route(sample(c.code));
        const globalTarget = keyUnit(g?.key, unit);
        const target = r ?? globalTarget;
        const origin: UnitPolicyCategory['effective']['origin'] = own[c.code] ? 'unit' : r ? 'parent' : g ? 'global' : 'none';
        const m = mine.get(c.code);
        return {
          code: c.code,
          label: c.label,
          parentCode: c.parentCode && show.has(c.parentCode) ? c.parentCode : null,
          group: hasChild.has(c.code) || !c.isLeaf,
          listed: listed.has(c.code),
          rule: own[c.code] ?? null,
          effective: { target, targetLabel: target === unit ? `${unitLabel(unit)} (shu bo'lim)` : unitLabel(target), origin },
          globalTarget,
          count: m?.count ?? 0,
          totalTiyin: (m?.total ?? 0n).toString(),
          used: used.has(c.code),
        };
      });

    // Ish haqi qismlari: komponent → kim hisobida
    const payRules = policy.unitPayroll[unit] ?? {};
    const payrollParts: UnitPolicyPayrollPart[] = components
      .filter((c) => c.sign > 0)
      .map((c) => {
        const split = mine.get(payrollPartCategory(c.code));
        return {
          code: c.code,
          name: c.name,
          group: CATEGORY_LABELS[c.category] ?? String(c.category),
          totalTiyin: (compTotals.get(c.code) ?? 0n).toString(),
          rule: payRules[c.code] ?? null,
          globalTarget: unit === 'REGION' && policy.payrollComponents.includes(c.code) ? 'CENTER' : null,
          splitTiyin: (split?.total ?? 0n).toString(),
        };
      })
      .sort((a, b) => (BigInt(b.totalTiyin) > BigInt(a.totalTiyin) ? 1 : BigInt(b.totalTiyin) < BigInt(a.totalTiyin) ? -1 : 0) || a.name.localeCompare(b.name));

    const inc = [...incoming.values()]
      .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0))
      .map((g) => ({ source: g.source, sourceLabel: unitLabel(g.source), code: g.code, label: label.get(g.code) ?? g.code, count: g.count, totalTiyin: g.total.toString() }));

    return {
      unit,
      label: unitLabel(unit),
      from: months[0],
      to: months[months.length - 1],
      targets: TARGETS.filter((t) => t.code !== unit),
      /** Hududlar bo'limida «shu bo'limda qoladi» — hududning o'zida */
      categories,
      incoming: inc,
      payrollParts,
      payrollRulesCount: Object.keys(payRules).length,
      rulesCount: Object.keys(own).length,
      totals: {
        writtenTiyin: written.toString(),
        movedOutTiyin: movedOut.toString(),
        staysTiyin: (written - movedOut).toString(),
        incomingTiyin: incomingTotal.toString(),
        resultTiyin: (written - movedOut + incomingTotal).toString(),
        outBy: [...outBy.entries()].map(([code, t]) => ({ unit: code, label: unitLabel(code), totalTiyin: t.toString() })),
      },
    };
  }

  /**
   * Bo'lim qoidalarini saqlash (to'liq ro'yxat): { rules: { MODDA: 'CENTER' | 'TAX_FREE' | … | '<shu bo'lim>' } }.
   * Maqsad — shu bo'limning o'zi: «shu bo'limda qoladi» (umumiy siyosat qo'llanmaydi). Ro'yxatda yo'q modda — qoida yo'q.
   */
  async save(unit: string, body: { rules?: unknown; payroll?: unknown }, userId: string) {
    const raw = body?.rules ?? (body?.payroll !== undefined ? (await readPolicy(this.prisma)).unitRules[unit] ?? {} : undefined);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException("Qoidalar noto'g'ri");
    const entries = Object.entries(raw as Record<string, unknown>).filter(([, t]) => t !== null && t !== undefined && t !== '');
    if (entries.length > 2000) throw new BadRequestException("Qoidalar juda ko'p");
    const allowed = new Set([...TARGETS.map((t) => t.code), unit]);
    const codes = entries.map(([c]) => c);
    const known = new Set((await this.prisma.category.findMany({ where: { code: { in: codes } }, select: { code: true } })).map((c) => c.code));
    const rules: Record<string, string> = {};
    for (const [code, target] of entries) {
      if (!known.has(code)) throw new BadRequestException(`Modda topilmadi: ${code}`);
      if (typeof target !== 'string' || !allowed.has(target)) throw new BadRequestException(`«${code}» uchun bo'lim noto'g'ri`);
      rules[code] = target;
    }
    // Ish haqi qismlari: { KOMPONENT: bo'lim } (berilmasa — o'zgarmaydi)
    let payroll: Record<string, string> | null = null;
    if (body?.payroll !== undefined && body.payroll !== null) {
      if (typeof body.payroll !== 'object' || Array.isArray(body.payroll)) throw new BadRequestException("Ish haqi qismlari noto'g'ri");
      const pe = Object.entries(body.payroll as Record<string, unknown>).filter(([, t]) => t !== null && t !== undefined && t !== '');
      const comps = new Set((await this.prisma.salaryComponent.findMany({ where: { code: { in: pe.map(([c]) => c) } }, select: { code: true } })).map((c) => c.code));
      payroll = {};
      for (const [code, target] of pe) {
        if (!comps.has(code)) throw new BadRequestException(`Ish haqi komponenti topilmadi: ${code}`);
        if (typeof target !== 'string' || !allowed.has(target)) throw new BadRequestException(`«${code}» uchun bo'lim noto'g'ri`);
        payroll[code] = target;
      }
    }
    const policy = await readPolicy(this.prisma);
    const before = policy.unitRules[unit] ?? {};
    const next = { ...policy.unitRules };
    if (Object.keys(rules).length) next[unit] = rules;
    else delete next[unit];
    const payBefore = policy.unitPayroll[unit] ?? {};
    const payNext = { ...policy.unitPayroll };
    if (payroll) {
      if (Object.keys(payroll).length) payNext[unit] = payroll;
      else delete payNext[unit];
    }
    await writePolicy(this.prisma, { unitRules: next, ...(payroll ? { unitPayroll: payNext } : {}) });
    const payChanged = payroll ? [...new Set([...Object.keys(payBefore), ...Object.keys(payroll)])].filter((c) => payBefore[c] !== payroll![c]) : [];
    // Ish haqi qismlari o'zgarsa — ish haqi qayta ajratiladi (hamma oylar)
    const applied = payChanged.length ? await this.applyPayroll(unit) : 0;
    const changed = [...new Set([...Object.keys(before), ...Object.keys(rules)])].filter((c) => before[c] !== rules[c]);
    const fmt = (t?: string) => (!t ? 'umumiy siyosat' : t === unit ? "shu bo'limda" : entryUnitLabel(t));
    await this.audit.log({
      userId,
      action: 'UPDATE',
      entity: 'expense_policy',
      entityId: `unit:${unit}`,
      summary: `${entryUnitLabel(unit)} — xarajatlar siyosati: ${changed.length ? changed.slice(0, 5).map((c) => `${c}: ${fmt(before[c])} → ${fmt(rules[c])}`).join('; ') + (changed.length > 5 ? ` va yana ${changed.length - 5} ta` : '') : "moddalar o'zgarmadi"}${payChanged.length ? `; ish haqi qismlari: ${payChanged.slice(0, 5).map((c) => `${c}: ${fmt(payBefore[c])} → ${fmt(payroll![c])}`).join('; ')}` : ''}`,
    });
    return { unit, rules, payroll: payroll ?? payBefore, changed: changed.length + payChanged.length, recomputedPeriods: applied };
  }

  /** Ish haqi qismlarini qayta ajratish: yo'nalish — bo'lim ish haqi; Markaz va Hududlar — umumiy ish haqi (hamma oylar) */
  private async applyPayroll(unit: string): Promise<number> {
    let n = 0;
    try {
      if (isSegment(unit) && this.unitPayroll) {
        for (const p of await this.unitPayroll.payrollPeriods(unit)) {
          await this.unitPayroll.splitComponents(unit, p);
          n += 1;
        }
      } else if ((unit === 'CENTER' || unit === 'REGION') && this.payroll) {
        for (const p of await this.payroll.committedPeriods()) {
          await this.payroll.regroup(p);
          n += 1;
        }
      }
    } catch (e) {
      this.logger.warn(`Ish haqi qismlarini qayta ajratib bo'lmadi (${unit}): ${String(e)}`);
    }
    return n;
  }
}

/** Bo'limning namunaviy joyi (umumiy siyosatni tekshirish uchun) */
function placeOf(unit: string): { regionCode: number | null; departmentId: string | null; segment: string | null } {
  if (unit === 'CENTER') return { regionCode: 0, departmentId: null, segment: null };
  if (unit === 'REGION') return { regionCode: 1, departmentId: null, segment: null };
  return { regionCode: null, departmentId: null, segment: unit };
}