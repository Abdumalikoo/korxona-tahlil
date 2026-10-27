import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { UnitPayrollService } from '../unit-payroll/unit-payroll.service';
import { monthsBetween } from '../../common/period';
import { isSegment, SEGMENTS, segmentLabel } from '../../common/segments/segments';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { payrollPartOf, policyRouting, readPolicy, ruleLookup, writePolicy } from './policy.util';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › Foyda keltirmaydigan bo'limlar — Markazning har bir bo'limi alohida:
//  • bo'limga yozilgan xarajatlar MODDALAR bo'yicha (ota guruh → modda), oyma-oy;
//  • har modda bo'yicha bo'limning XARAJATLAR SIYOSATI: kim hisobidan —
//      SELF (shu bo'lim), CENTER (Markaz umumiy — bo'limga biriktirilmagan), dep:<id> (boshqa bo'lim) yoki yo'nalish
//      (Tax free, Marksheyder … — Markazdan chiqadi);
//    qoida bo'lmasa — Markaz bo'limi qoidalari va umumiy siyosat bo'yicha (ko'rsatiladi);
//  • boshqa bo'limlardan shu bo'lim hisobiga kelganlari.
// Yozuvlar joyida qoladi — faqat Solishtirma, hisobotlar va tahlilda hisobga olinadi.
// Saqlash: settings «expense.policy».depRules — migratsiya kerak emas.
// ═══════════════════════════════════════════════════════════

const TZ_HOURS = 5;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface DepCategoryRow {
  code: string;
  label: string;
  parentCode: string | null;
  group: boolean;
  /** Shu bo'limning o'z qoidasi (maqsad) yoki null */
  rule: string | null;
  /** Amaldagi: kim hisobida va nima sababdan */
  effective: { target: string; label: string; origin: 'dep' | 'parent' | 'unit' | 'global' | 'none' };
  /** Davrda shu bo'limga yozilgan */
  count: number;
  totalTiyin: string;
  months: Record<string, string>;
  /** Davrda yozilgan yoki qoidasi bor */
  used: boolean;
}

@Injectable()
export class DepPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly unitPayroll?: UnitPayrollService,
  ) {}

  /** Yo'nalishlarga bog'langan bo'limlar — bu ro'yxatga kirmaydi (ular 6 bo'lim ichida) */
  private async segmentDeps(): Promise<Set<string>> {
    return this.unitPayroll ? this.unitPayroll.segmentDepartmentIds().catch(() => new Set<string>()) : new Set<string>();
  }

  private range(from: string, to: string) {
    if (!PERIOD_RE.test(from ?? '') || !PERIOD_RE.test(to ?? '')) throw new BadRequestException("Oy noto'g'ri (YYYY-MM)");
    const months = monthsBetween(from, to);
    if (!months.length || months.length > 36) throw new BadRequestException("Davr noto'g'ri");
    const [fy, fm] = months[0]!.split('-').map(Number) as [number, number];
    const [ty, tm] = months[months.length - 1]!.split('-').map(Number) as [number, number];
    return { months, start: new Date(Date.UTC(fy, fm - 1, 1, -TZ_HOURS)), end: new Date(Date.UTC(ty, tm, 1, -TZ_HOURS)) };
  }

  private async load(from: string, to: string) {
    const { months, start, end } = this.range(from, to);
    const [allDeps, cats, policy, rows, segDeps] = await Promise.all([
      this.prisma.department.findMany({ select: { id: true, name: true, isActive: true, index: true }, orderBy: { index: 'asc' } }),
      this.prisma.category.findMany({ select: { code: true, label: true, parentCode: true, isLeaf: true, isActive: true, order: true } }),
      readPolicy(this.prisma),
      // Markazda yozilgan xarajatlar (bo'limli yoki bo'limsiz)
      this.prisma.expense.findMany({
        where: { deletedAt: null, date: { gte: start, lt: end }, segment: null, OR: [{ regionCode: 0 }, { regionCode: null, departmentId: { not: null } }] },
        select: { date: true, amountTiyin: true, categoryCode: true, regionCode: true, departmentId: true, segment: true },
      }),
      this.segmentDeps(),
    ]);
    // Yo'nalish bo'limlari (Tax free, Marksheyder …) — ular 6 bo'lim ichida, bu yerda emas
    const deps = allDeps.filter((d) => !segDeps.has(d.id));
    return { months, deps, allDeps, cats, policy, rows, routing: policyRouting(policy, cats) };
  }

  /** Maqsad matni */
  private targetLabel(t: string, depName: Map<string, string>, self: string): string {
    if (t === 'SELF' || t === `dep:${self}`) return "Shu bo'lim";
    if (t === 'CENTER') return "Markaz (bo'limga biriktirilmagan)";
    if (t === 'center:global') return "Markaz — hududlar uchun (umumiy siyosat)";
    if (t.startsWith('dep:')) return depName.get(t.slice(4)) ?? "Boshqa bo'lim";
    if (isSegment(t)) return segmentLabel(t);
    return t;
  }

  /** Yozuv qayerga tushadi: dep:<id> | CENTER | center:global | yo'nalish kodi */
  private landing(routing: ReturnType<typeof policyRouting>, r: { categoryCode: string; regionCode: number | null; departmentId: string | null; segment: string | null }): string {
    const routed = routing.route(r);
    if (routed) {
      if (routed.key.startsWith('s:')) return routed.key.slice(2);
      if (routed.key === 'center') return routed.origin === 'global' ? 'center:global' : 'CENTER';
      return routed.key;
    }
    const d = routing.depOf(r);
    return d ? `dep:${d}` : 'CENTER';
  }

  /** Bo'limlar ro'yxati: davrda yozilgani, o'zida qolgani, kelgani, qoidalar soni */
  async list(from: string, to: string) {
    const { deps, policy, rows, routing } = await this.load(from, to);
    const acc = new Map<string, { written: bigint; stays: bigint; incoming: bigint; count: number; codes: Set<string> }>();
    const get = (id: string) => {
      let a = acc.get(id);
      if (!a) acc.set(id, (a = { written: 0n, stays: 0n, incoming: 0n, count: 0, codes: new Set() }));
      return a;
    };
    for (const r of rows) {
      const land = this.landing(routing, r);
      if (r.departmentId) {
        const a = get(r.departmentId);
        a.written += r.amountTiyin;
        a.count += 1;
        a.codes.add(r.categoryCode);
        if (land === `dep:${r.departmentId}`) a.stays += r.amountTiyin;
      }
      if (land.startsWith('dep:') && land !== `dep:${r.departmentId}`) get(land.slice(4)).incoming += r.amountTiyin;
    }
    return deps
      .filter((d) => d.isActive || acc.has(d.id))
      .map((d) => {
        const a = acc.get(d.id);
        return {
          id: d.id,
          name: d.name,
          isActive: d.isActive,
          writtenTiyin: (a?.written ?? 0n).toString(),
          staysTiyin: (a?.stays ?? 0n).toString(),
          incomingTiyin: (a?.incoming ?? 0n).toString(),
          resultTiyin: ((a?.stays ?? 0n) + (a?.incoming ?? 0n)).toString(),
          count: a?.count ?? 0,
          categories: a?.codes.size ?? 0,
          rules: Object.keys(policy.depRules[d.id] ?? {}).length,
        };
      });
  }

  /** Bitta bo'lim: moddalar (oyma-oy), siyosat, kelganlari */
  async view(id: string, from: string, to: string) {
    const { months, deps, allDeps, cats, policy, rows, routing } = await this.load(from, to);
    const dep = allDeps.find((d) => d.id === id);
    if (!dep) throw new NotFoundException("Bo'lim topilmadi");
    const depName = new Map(allDeps.map((d) => [d.id, d.name]));
    const own = policy.depRules[id] ?? {};
    const rule = ruleLookup(own, cats);
    // Bo'lim qoidasisiz (Markaz bo'limi qoidalari va umumiy siyosat) — nima bo'lardi
    const noDep = policyRouting({ ...policy, depRules: {} }, cats);
    const label = new Map(cats.map((c) => [c.code, c.label]));
    const parent = new Map(cats.map((c) => [c.code, c.parentCode]));
    const monthOf = (d: Date) => new Date(d.getTime() + TZ_HOURS * 3600_000).toISOString().slice(0, 7);

    const mine = new Map<string, { count: number; total: bigint; months: Map<string, bigint> }>();
    const incoming = new Map<string, { from: string; code: string; count: number; total: bigint }>();
    let written = 0n;
    let stays = 0n;
    let incomingTotal = 0n;
    const outBy = new Map<string, bigint>();
    for (const r of rows) {
      const land = this.landing(routing, r);
      if (r.departmentId === id) {
        written += r.amountTiyin;
        const m = mine.get(r.categoryCode) ?? { count: 0, total: 0n, months: new Map<string, bigint>() };
        m.count += 1;
        m.total += r.amountTiyin;
        const mo = monthOf(r.date);
        m.months.set(mo, (m.months.get(mo) ?? 0n) + r.amountTiyin);
        mine.set(r.categoryCode, m);
        if (land === `dep:${id}`) stays += r.amountTiyin;
        else outBy.set(land, (outBy.get(land) ?? 0n) + r.amountTiyin);
      } else if (land === `dep:${id}`) {
        incomingTotal += r.amountTiyin;
        const src = r.departmentId ? `dep:${r.departmentId}` : 'CENTER';
        const k = `${src}|${r.categoryCode}`;
        const g = incoming.get(k) ?? { from: src, code: r.categoryCode, count: 0, total: 0n };
        g.count += 1;
        g.total += r.amountTiyin;
        incoming.set(k, g);
      }
    }

    // Ko'rsatiladigan moddalar: hamma faol (ish haqi qismlarisiz) + yozilganlar + qoidasi borlar, ota guruhlari bilan
    const used = new Set<string>([...mine.keys(), ...Object.keys(own)].filter((c) => label.has(c)));
    const withParents = (set: Set<string>) => {
      for (const c of [...set]) {
        let p = parent.get(c) ?? null;
        for (let d = 0; p && d < 20; d += 1) {
          set.add(p);
          p = parent.get(p) ?? null;
        }
      }
      return set;
    };
    withParents(used);
    const show = withParents(new Set(cats.filter((c) => (c.isActive || used.has(c.code)) && payrollPartOf(c.code) === null && c.code !== 'IHQ').map((c) => c.code)));
    for (const c of used) show.add(c);
    const hasChild = new Set(cats.filter((c) => c.parentCode).map((c) => c.parentCode!));
    // Ota guruh summasi — ichki moddalar yig'indisi
    const groupTotals = new Map<string, { total: bigint; count: number; months: Map<string, bigint> }>();
    for (const [code, m] of mine) {
      let p: string | null = code;
      for (let d = 0; p && d < 20; d += 1) {
        const g = groupTotals.get(p) ?? { total: 0n, count: 0, months: new Map<string, bigint>() };
        g.total += m.total;
        g.count += m.count;
        for (const [mo, v] of m.months) g.months.set(mo, (g.months.get(mo) ?? 0n) + v);
        groupTotals.set(p, g);
        p = parent.get(p) ?? null;
      }
    }
    const sample = (code: string) => ({ categoryCode: code, regionCode: 0, departmentId: id, segment: null as string | null });
    const categories: DepCategoryRow[] = cats
      .filter((c) => show.has(c.code))
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
      .map((c) => {
        const r = rule(c.code);
        let target: string;
        let origin: DepCategoryRow['effective']['origin'];
        if (r) {
          target = r === 'SELF' ? `dep:${id}` : r;
          origin = own[c.code] ? 'dep' : 'parent';
        } else {
          const routed = noDep.route(sample(c.code));
          target = this.landing(noDep, sample(c.code));
          origin = routed ? (routed.origin === 'global' ? 'global' : 'unit') : 'none';
        }
        const g = groupTotals.get(c.code);
        return {
          code: c.code,
          label: c.label,
          parentCode: c.parentCode && show.has(c.parentCode) ? c.parentCode : null,
          group: hasChild.has(c.code) || !c.isLeaf,
          rule: own[c.code] ?? null,
          effective: { target, label: this.targetLabel(target, depName, id), origin },
          count: g?.count ?? 0,
          totalTiyin: (g?.total ?? 0n).toString(),
          months: Object.fromEntries([...(g?.months ?? new Map<string, bigint>()).entries()].map(([k, v]) => [k, v.toString()])),
          used: used.has(c.code),
        };
      });

    return {
      department: { id: dep.id, name: dep.name },
      from: months[0],
      to: months[months.length - 1],
      months,
      targets: [
        { code: 'SELF', label: "Shu bo'lim" },
        { code: 'CENTER', label: "Markaz (bo'limga biriktirilmagan)" },
        ...deps.filter((d) => d.id !== id && d.isActive).map((d) => ({ code: `dep:${d.id}`, label: `Bo'lim: ${d.name}` })),
        ...SEGMENTS.map((s) => ({ code: s.code as string, label: `${s.label} hisobidan` })),
      ],
      categories,
      rulesCount: Object.keys(own).length,
      incoming: [...incoming.values()]
        .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0))
        .map((g) => ({ from: g.from, fromLabel: g.from === 'CENTER' ? "Markaz (bo'limsiz)" : (depName.get(g.from.slice(4)) ?? g.from), code: g.code, label: label.get(g.code) ?? g.code, count: g.count, totalTiyin: g.total.toString() })),
      totals: {
        writtenTiyin: written.toString(),
        staysTiyin: stays.toString(),
        movedOutTiyin: (written - stays).toString(),
        incomingTiyin: incomingTotal.toString(),
        resultTiyin: (stays + incomingTotal).toString(),
        outBy: [...outBy.entries()].map(([t, v]) => ({ target: t, label: this.targetLabel(t, depName, id), totalTiyin: v.toString() })),
      },
    };
  }

  /** Bo'lim qoidalarini saqlash (to'liq ro'yxat): { rules: { MODDA: 'SELF' | 'CENTER' | 'dep:<id>' | yo'nalish } } */
  async save(id: string, body: { rules?: unknown }, userId: string) {
    const dep = await this.prisma.department.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!dep) throw new NotFoundException("Bo'lim topilmadi");
    const raw = body?.rules;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException("Qoidalar noto'g'ri");
    const entries = Object.entries(raw as Record<string, unknown>).filter(([, t]) => t !== null && t !== undefined && t !== '');
    if (entries.length > 2000) throw new BadRequestException("Qoidalar juda ko'p");
    const [known, deps] = await Promise.all([
      this.prisma.category.findMany({ where: { code: { in: entries.map(([c]) => c) } }, select: { code: true } }).then((l) => new Set(l.map((c) => c.code))),
      this.prisma.department.findMany({ select: { id: true } }).then((l) => new Set(l.map((d) => d.id))),
    ]);
    const rules: Record<string, string> = {};
    for (const [code, target] of entries) {
      if (!known.has(code)) throw new BadRequestException(`Modda topilmadi: ${code.slice(0, 64)}`);
      const t = String(target);
      const ok = t === 'SELF' || t === 'CENTER' || isSegment(t) || (t.startsWith('dep:') && deps.has(t.slice(4)) && t.slice(4) !== id);
      if (!ok) throw new BadRequestException(`«${code}» uchun maqsad noto'g'ri`);
      rules[code] = t;
    }
    const policy = await readPolicy(this.prisma);
    const before = policy.depRules[id] ?? {};
    const next = { ...policy.depRules };
    if (Object.keys(rules).length) next[id] = rules;
    else delete next[id];
    await writePolicy(this.prisma, { depRules: next });
    const changed = [...new Set([...Object.keys(before), ...Object.keys(rules)])].filter((c) => before[c] !== rules[c]);
    const fmt = (t?: string) => (!t ? 'umumiy' : t === 'SELF' ? "shu bo'lim" : t === 'CENTER' ? 'Markaz' : t.startsWith('dep:') ? "boshqa bo'lim" : segmentLabel(t));
    await this.audit.log({
      userId,
      action: 'UPDATE',
      entity: 'expense_policy',
      entityId: `dep:${id}`.slice(0, 190),
      summary: `${dep.name} — bo'lim xarajatlari siyosati: ${changed.length ? changed.slice(0, 5).map((c) => `${c}: ${fmt(before[c])} → ${fmt(rules[c])}`).join('; ') + (changed.length > 5 ? ` va yana ${changed.length - 5} ta` : '') : "o'zgarmadi"}`,
    });
    return { id, rules, changed: changed.length };
  }
}

