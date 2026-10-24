import { BadRequestException, Injectable } from '@nestjs/common';
import { ENTRY_UNITS, entryUnitLabel, entryUnitOf } from '../../common/segments/segments';
import { readUnitCategories, unitList } from '../../common/segments/unit-categories';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { monthsBetween } from '../unit-lease/unit-lease.service';
import { policyRouting, readPolicy, ruleLookup, unitOfKey, writePolicy } from './policy.util';

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
}

@Injectable()
export class UnitPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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
    const [policy, cats, lists, rows] = await Promise.all([
      readPolicy(this.prisma),
      this.prisma.category.findMany({ select: { code: true, label: true, parentCode: true, isLeaf: true, isActive: true, order: true } }),
      readUnitCategories(this.prisma),
      this.prisma.expense.findMany({
        where: { deletedAt: null, date: { gte: start, lt: end } },
        select: { amountTiyin: true, categoryCode: true, regionCode: true, departmentId: true, segment: true },
      }),
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
    const show = new Set<string>([...listed, ...mine.keys(), ...Object.keys(own)].filter((c) => label.has(c)));
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
        };
      });

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
  async save(unit: string, body: { rules?: unknown }, userId: string) {
    const raw = body?.rules;
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
    const policy = await readPolicy(this.prisma);
    const before = policy.unitRules[unit] ?? {};
    const next = { ...policy.unitRules };
    if (Object.keys(rules).length) next[unit] = rules;
    else delete next[unit];
    await writePolicy(this.prisma, { unitRules: next });
    const changed = [...new Set([...Object.keys(before), ...Object.keys(rules)])].filter((c) => before[c] !== rules[c]);
    const fmt = (t?: string) => (!t ? 'umumiy siyosat' : t === unit ? "shu bo'limda" : entryUnitLabel(t));
    await this.audit.log({
      userId,
      action: 'UPDATE',
      entity: 'expense_policy',
      entityId: `unit:${unit}`,
      summary: `${entryUnitLabel(unit)} — xarajatlar siyosati: ${changed.length ? changed.slice(0, 5).map((c) => `${c}: ${fmt(before[c])} → ${fmt(rules[c])}`).join('; ') + (changed.length > 5 ? ` va yana ${changed.length - 5} ta` : '') : "o'zgarish yo'q"}`,
    });
    return { unit, rules, changed: changed.length };
  }
}

/** Bo'limning namunaviy joyi (umumiy siyosatni tekshirish uchun) */
function placeOf(unit: string): { regionCode: number | null; departmentId: string | null; segment: string | null } {
  if (unit === 'CENTER') return { regionCode: 0, departmentId: null, segment: null };
  if (unit === 'REGION') return { regionCode: 1, departmentId: null, segment: null };
  return { regionCode: null, departmentId: null, segment: unit };
}