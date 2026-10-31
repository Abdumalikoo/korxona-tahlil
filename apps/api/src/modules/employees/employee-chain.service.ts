import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { runExclusive } from '../../common/locks';
import { monthsBetween } from '../../common/period';
import { readPlacements, type Placement } from '../../common/placements/placements';
import { CENTRAL_REGION } from '../../common/segments/segments';
import { AuditService } from '../audit/audit.service';
import { COMPOSITION_PLACE_KEY } from '../payroll/payroll.service';
import { PrismaService } from '../prisma/prisma.service';

// ═══════════════════════════════════════════════════════════
// Xodim harakati zanjiri — har xodim, har oy: qayerda bo'lgani (Markaz bo'limi yoki hudud/tuman) va qaysi manba
// buni aytgani. Amaldagi joy — hisoblar ishlatadigan tartibda (loadLocationRefs): tarkibdagi oylik tuzatish →
// joylashuv davri → natijalar fayli → (yo'q bo'lsa) Xodimlar reestri. Manbalar bir-biriga zid bo'lsa yoki ish haqi
// olgan oyda joy ko'rsatilmagan bo'lsa — «Nazorat» ro'yxati. Hech narsa o'zgartirilmaydi; faqat «ko'rib chiqildi»
// belgisi saqlanadi (settings, migratsiyasiz).
// ═══════════════════════════════════════════════════════════

export const CHAIN_REVIEWED_KEY = 'employee.chain.reviewed';

/** Muammo turi */
export type ChainIssue =
  /** Natijalar fayli va qo'lda kiritilgan joy (davr / tarkib tuzatishi) boshqa birlikni ko'rsatadi */
  | 'CONFLICT'
  /** Ish haqi olgan, lekin shu oy joyi hech qayerda ko'rsatilmagan — reestrdagi joy olinadi */
  | 'NO_PLACE'
  /** Ish haqi ishga kirgan oydan oldin yoki bo'shagan oydan keyin */
  | 'OUT_OF_RANGE'
  /** Oxirgi oy joyi reestrdagidan boshqa — reestr eskirgan */
  | 'REGISTRY_STALE';

export const ISSUE_LABEL: Record<ChainIssue, string> = {
  CONFLICT: 'Manbalar zid',
  NO_PLACE: "Joyi ko'rsatilmagan",
  OUT_OF_RANGE: 'Ish davridan tashqari ish haqi',
  REGISTRY_STALE: 'Reestr eskirgan',
};

interface Place {
  /** C:<bo'lim|-> yoki R:<viloyat>:<tuman|-> */
  key: string;
  /** Birlik darajasi: C (Markaz) yoki R:<viloyat> — zidlik shu darajada tekshiriladi */
  unit: string;
  label: string;
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthOf = (d: Date | null) => (d ? new Date(d.getTime() + 5 * 3600_000).toISOString().slice(0, 7) : null);

@Injectable()
export class EmployeeChainService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Davrdagi hamma manbalar (bir marta yuklanadi) */
  private async load(months: string[], pinfls?: string[]) {
    const only = pinfls ? { employeePinfl: { in: pinfls } } : {};
    const [employees, locations, placements, fixRows, regions, districts, departments, batches, payroll, reviewedRow] = await Promise.all([
      this.prisma.employee.findMany({
        where: pinfls ? { pinfl: { in: pinfls } } : {},
        select: { pinfl: true, fullName: true, regionCode: true, districtId: true, departmentId: true, position: true, hiredAt: true, firedAt: true, isActive: true },
      }),
      this.prisma.employeeLocation.findMany({ where: { period: { in: months }, ...only }, select: { employeePinfl: true, period: true, regionCode: true, districtId: true, employmentType: true } }),
      readPlacements(this.prisma),
      this.prisma.setting.findMany({ where: { key: { in: months.map(COMPOSITION_PLACE_KEY) } }, select: { key: true, value: true } }),
      this.prisma.region.findMany({ select: { code: true, name: true } }),
      this.prisma.district.findMany({ select: { id: true, name: true } }),
      this.prisma.department.findMany({ select: { id: true, name: true } }),
      this.prisma.salaryCompositionBatch.findMany({ where: { period: { in: months }, cancelledAt: null }, select: { id: true, period: true, createdAt: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.payrollEntry.findMany({ where: { period: { in: months }, ...only }, select: { employeePinfl: true, period: true }, distinct: ['employeePinfl', 'period'] }),
      this.prisma.setting.findUnique({ where: { key: CHAIN_REVIEWED_KEY } }),
    ]);
    // Ish haqi tarkibi: har oyning oxirgi (bekor qilinmagan) yuklashi
    const latest = new Map<string, string>();
    for (const b of batches) if (!latest.has(b.period)) latest.set(b.period, b.id);
    const compRows = latest.size
      ? await this.prisma.salaryCompositionRow.findMany({ where: { batchId: { in: [...latest.values()] }, ...only }, select: { employeePinfl: true, period: true } })
      : [];
    const fixes = new Map<string, Record<string, { departmentId?: string | null; regionCode?: number | null; districtId?: string | null; unit?: string }>>();
    for (const r of fixRows) fixes.set(r.key.slice('salary.composition.place.'.length), ((r.value as { fixes?: Record<string, never> } | null)?.fixes ?? {}) as never);
    const reviewed = (reviewedRow?.value && typeof reviewedRow.value === 'object' ? reviewedRow.value : {}) as Record<string, { at: string; by: string; note: string | null }>;
    return {
      employees,
      locations,
      placements: pinfls ? placements.filter((p) => pinfls.includes(p.pinfl)) : placements,
      fixes,
      regionName: new Map(regions.map((r) => [r.code, r.name])),
      districtName: new Map(districts.map((d) => [d.id, d.name])),
      depName: new Map(departments.map((d) => [d.id, d.name])),
      paid: new Set([...compRows.map((r) => `${r.employeePinfl}|${r.period}`), ...payroll.map((r) => `${r.employeePinfl}|${r.period}`)]),
      compPeriods: new Set(latest.keys()),
      reviewed,
    };
  }

  /** Bir xodim, bir oy: har manba bo'yicha joy va amaldagisi */
  private evaluate(ctx: Awaited<ReturnType<EmployeeChainService['load']>>) {
    const center = (dep: string | null | undefined): Place => ({ key: `C:${dep ?? '-'}`, unit: 'C', label: dep ? `Markaz › ${ctx.depName.get(dep) ?? "bo'lim"}` : 'Markaz' });
    const region = (code: number, dist: string | null | undefined): Place =>
      code === CENTRAL_REGION ? center(null) : { key: `R:${code}:${dist ?? '-'}`, unit: `R:${code}`, label: `${ctx.regionName.get(code) ?? `Hudud ${code}`}${dist ? ` › ${ctx.districtName.get(dist) ?? 'tuman'}` : ''}` };
    const locBy = new Map(ctx.locations.map((l) => [`${l.employeePinfl}|${l.period}`, l]));
    const placementAt = (pinfl: string, p: string): Placement | undefined => ctx.placements.find((x) => x.pinfl === pinfl && x.from <= p && (!x.to || x.to >= p));
    return (e: (typeof ctx.employees)[number], p: string) => {
      const loc = locBy.get(`${e.pinfl}|${p}`);
      const results = loc ? (loc.regionCode === CENTRAL_REGION ? center(null) : region(loc.regionCode, loc.districtId)) : null;
      const pl = placementAt(e.pinfl, p);
      const placement = pl ? (pl.unit === 'CENTER' ? center(pl.departmentId) : region(pl.regionCode ?? 0, pl.districtId)) : null;
      const f = ctx.fixes.get(p)?.[e.pinfl];
      const fix = f ? (f.unit === 'REGION' && typeof f.regionCode === 'number' && f.regionCode > 0 ? region(f.regionCode, f.districtId) : f.departmentId ? center(f.departmentId) : null) : null;
      const registry = e.regionCode === CENTRAL_REGION ? center(e.departmentId) : region(e.regionCode, e.districtId);
      const paid = ctx.paid.has(`${e.pinfl}|${p}`);
      const effective = fix ?? placement ?? results ?? (paid ? registry : null);
      const source = fix ? 'FIX' : placement ? 'PLACEMENT' : results ? 'RESULTS' : paid ? 'REGISTRY' : null;
      const issues: { type: ChainIssue; detail: string }[] = [];
      const manual = fix ?? placement;
      if (results && manual && results.unit !== manual.unit) issues.push({ type: 'CONFLICT', detail: `Natijalar faylida — ${results.label}, ${fix ? 'tarkib tuzatishida' : 'joylashuv davrida'} — ${manual.label}` });
      // Markaz xodimi (reestrda Markaz bo'limi bor) natijalar faylida bo'lmaydi — reestr uning qonuniy manbai; muammo —
      // hudud xodimi faylda yo'q yoki Markaz xodimining bo'limi ko'rsatilmagan
      const registryOk = registry.unit === 'C' && Boolean(e.departmentId);
      if (paid && !results && !manual && !registryOk) issues.push({ type: 'NO_PLACE', detail: `Ish haqi olgan, joyi ko'rsatilmagan — reestrdagi joy olinadi (${registry.label})` });
      const hired = monthOf(e.hiredAt);
      const fired = monthOf(e.firedAt);
      if (paid && ((hired && p < hired) || (fired && p > fired))) issues.push({ type: 'OUT_OF_RANGE', detail: `Ish haqi bor, lekin ${hired && p < hired ? `ishga ${hired} da kirgan` : `${fired} da bo'shagan`}` });
      return { results, placement, fix, registry, paid, effective, source, issues };
    };
  }

  /** Davr bo'yicha: harakatlar, muammolar va oyma-oy jamlama (shaxsiy ma'lumot) */
  async report(from: string, to: string) {
    const months = monthsBetween(String(from ?? ''), String(to ?? ''));
    if (months.length > 36) throw new BadRequestException("Ko'pi bilan 36 oy");
    const ctx = await this.load(months);
    const ev = this.evaluate(ctx);
    const issues: { pinfl: string; fullName: string; period: string; type: ChainIssue; detail: string; effective: string | null; reviewed: { at: string; by: string; note: string | null } | null }[] = [];
    const moves: { pinfl: string; fullName: string; period: string; from: string; to: string; source: string | null }[] = [];
    const byMonth = new Map(months.map((p) => [p, { period: p, placed: 0, paid: 0, moves: 0, issues: 0 }]));
    for (const e of ctx.employees) {
      let prev: { key: string; label: string } | null = null;
      let last: ReturnType<ReturnType<EmployeeChainService['evaluate']>> | null = null;
      for (const p of months) {
        const r = ev(e, p);
        const m = byMonth.get(p)!;
        if (r.effective) m.placed += 1;
        if (r.paid) m.paid += 1;
        for (const it of r.issues) {
          const reviewed = ctx.reviewed[`${e.pinfl}|${p}|${it.type}`] ?? null;
          issues.push({ pinfl: e.pinfl, fullName: e.fullName, period: p, type: it.type, detail: it.detail, effective: r.effective?.label ?? null, reviewed });
          if (!reviewed) m.issues += 1;
        }
        if (r.effective) {
          if (prev && prev.key !== r.effective.key) {
            moves.push({ pinfl: e.pinfl, fullName: e.fullName, period: p, from: prev.label, to: r.effective.label, source: r.source });
            m.moves += 1;
          }
          prev = r.effective;
          last = r;
        }
      }
      // Reestr: oxirgi ma'lum joy reestrdagidan boshqa birlikda (faqat ishlayotganlar)
      if (last?.effective && e.isActive && last.source !== 'REGISTRY' && last.effective.unit !== last.registry.unit) {
        const p = [...months].reverse().find((x) => ev(e, x).effective) ?? months[months.length - 1]!;
        const reviewed = ctx.reviewed[`${e.pinfl}|${p}|REGISTRY_STALE`] ?? null;
        issues.push({ pinfl: e.pinfl, fullName: e.fullName, period: p, type: 'REGISTRY_STALE', detail: `Oxirgi oy — ${last.effective.label}, reestrda — ${last.registry.label}`, effective: last.effective.label, reviewed });
        if (!reviewed) byMonth.get(p)!.issues += 1;
      }
    }
    issues.sort((a, b) => Number(Boolean(a.reviewed)) - Number(Boolean(b.reviewed)) || b.period.localeCompare(a.period) || a.fullName.localeCompare(b.fullName));
    moves.sort((a, b) => b.period.localeCompare(a.period) || a.fullName.localeCompare(b.fullName));
    const summary = Object.fromEntries((Object.keys(ISSUE_LABEL) as ChainIssue[]).map((t) => [t, { label: ISSUE_LABEL[t], open: issues.filter((x) => x.type === t && !x.reviewed).length, reviewed: issues.filter((x) => x.type === t && x.reviewed).length }]));
    return { from: months[0]!, to: months[months.length - 1]!, months: [...byMonth.values()], summary, issues: issues.slice(0, 3000), moves: moves.slice(0, 3000), totals: { issues: issues.length, moves: moves.length } };
  }

  /**
   * Xodimlar harakati jadvali — davrdagi har xodim, har oy amaldagi joyi (hisoblar ishlatadigan tartibda). Katak: joy
   * (labels indeksi, -1 — shu oy hech qayerda emas), ish haqi olganmi. Qator belgilari: ko'chgan (joy almashgan),
   * kelgan (o'rtada boshlangan), ketgan (o'rtada to'xtagan). Oyma-oy jamlama. Hech narsa o'zgartirilmaydi (shaxsiy ma'lumot).
   */
  async grid(from: string, to: string) {
    const months = monthsBetween(String(from ?? ''), String(to ?? ''));
    if (months.length > 36) throw new BadRequestException("Ko'pi bilan 36 oy");
    const ctx = await this.load(months);
    const ev = this.evaluate(ctx);
    const labels: string[] = [];
    const labelIdx = new Map<string, number>();
    const idx = (label: string) => {
      let i = labelIdx.get(label);
      if (i === undefined) {
        i = labels.length;
        labels.push(label);
        labelIdx.set(label, i);
      }
      return i;
    };
    const unitName = (unit: string) => (unit === 'C' ? 'Markaz' : (ctx.regionName.get(Number(unit.split(':')[1])) ?? 'Hudud'));
    const byMonth = months.map((p) => ({ period: p, placed: 0, moved: 0, started: 0, stopped: 0 }));
    const rows: { pinfl: string; fullName: string; position: string | null; cells: { l: number; paid: boolean; move: boolean }[]; units: string[]; moves: number; started: boolean; stopped: boolean }[] = [];
    for (const e of ctx.employees) {
      const cells: { l: number; paid: boolean; move: boolean }[] = [];
      const units = new Set<string>();
      let prevKey: string | null = null;
      let seen = false;
      let moves = 0;
      let started = false;
      let stopped = false;
      months.forEach((p, k) => {
        const r = ev(e, p);
        const place = r.effective;
        const cell = { l: place ? idx(place.label) : -1, paid: r.paid, move: false };
        if (place) {
          byMonth[k]!.placed += 1;
          units.add(unitName(place.unit));
          if (prevKey && prevKey !== place.key) {
            cell.move = true;
            moves += 1;
            byMonth[k]!.moved += 1;
          }
          if (!seen && k > 0) {
            started = true;
            byMonth[k]!.started += 1;
          }
          seen = true;
          prevKey = place.key;
        } else if (cells.length && cells[cells.length - 1]!.l >= 0) {
          stopped = true;
          byMonth[k]!.stopped += 1;
        }
        cells.push(cell);
      });
      if (!seen) continue;
      rows.push({ pinfl: e.pinfl, fullName: e.fullName, position: e.position, cells, units: [...units], moves, started, stopped });
    }
    rows.sort((a, b) => b.moves - a.moves || Number(b.started || b.stopped) - Number(a.started || a.stopped) || a.fullName.localeCompare(b.fullName));
    return { from: months[0]!, to: months[months.length - 1]!, months: byMonth, labels, rows };
  }

  /** Bir xodim: vaqt chizig'i (uzluksiz davrlar), harakatlar va har oy manbalari (shaxsiy ma'lumot) */
  async timeline(pinfl: string, from: string, to: string) {
    const months = monthsBetween(String(from ?? ''), String(to ?? ''));
    if (months.length > 60) throw new BadRequestException("Ko'pi bilan 60 oy");
    const ctx = await this.load(months, [pinfl]);
    const e = ctx.employees[0];
    if (!e) throw new NotFoundException('Xodim topilmadi');
    const ev = this.evaluate(ctx);
    const rows = months.map((p) => {
      const r = ev(e, p);
      return {
        period: p,
        paid: r.paid,
        results: r.results?.label ?? null,
        placement: r.placement?.label ?? null,
        fix: r.fix?.label ?? null,
        effective: r.effective?.label ?? null,
        effectiveKey: r.effective?.key ?? null,
        source: r.source,
        issues: r.issues.map((it) => ({ ...it, reviewed: ctx.reviewed[`${pinfl}|${p}|${it.type}`] ?? null })),
      };
    });
    // Uzluksiz davrlar: ketma-ket oylar bir xil joyda — bitta davr
    const segments: { from: string; to: string; place: string; months: number; sources: string[] }[] = [];
    for (const r of rows) {
      if (!r.effective) continue;
      const lastSeg = segments[segments.length - 1];
      const prevMonth = months[months.indexOf(r.period) - 1];
      if (lastSeg && lastSeg.place === r.effective && lastSeg.to === prevMonth) {
        lastSeg.to = r.period;
        lastSeg.months += 1;
        if (r.source && !lastSeg.sources.includes(r.source)) lastSeg.sources.push(r.source);
      } else segments.push({ from: r.period, to: r.period, place: r.effective, months: 1, sources: r.source ? [r.source] : [] });
    }
    return {
      pinfl,
      fullName: e.fullName,
      position: e.position,
      hired: monthOf(e.hiredAt),
      fired: monthOf(e.firedAt),
      isActive: e.isActive,
      registry: ev(e, months[months.length - 1]!).registry.label,
      segments,
      rows,
    };
  }

  /** «Ko'rib chiqildi» belgisi (muammo ochiq ro'yxatdan chiqadi; zanjir o'zgarmaydi): { pinfl, period, type, note?, undo? } */
  async review(body: { pinfl?: unknown; period?: unknown; type?: unknown; note?: unknown; undo?: unknown }, userId: string) {
    const pinfl = typeof body?.pinfl === 'string' ? body.pinfl.trim() : '';
    const period = typeof body?.period === 'string' ? body.period : '';
    const type = typeof body?.type === 'string' && body.type in ISSUE_LABEL ? (body.type as ChainIssue) : null;
    if (!pinfl || !PERIOD.test(period) || !type) throw new BadRequestException("Xodim, oy va muammo turi kerak");
    const note = typeof body?.note === 'string' && body.note.trim() ? body.note.replace(/\s+/g, ' ').trim().slice(0, 300) : null;
    const by = (await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }).catch(() => null))?.fullName ?? '';
    const key = `${pinfl}|${period}|${type}`;
    await runExclusive(`setting:${CHAIN_REVIEWED_KEY}`, async () => {
      const cur = ((await this.prisma.setting.findUnique({ where: { key: CHAIN_REVIEWED_KEY } }))?.value ?? {}) as Record<string, unknown>;
      const next = { ...(cur && typeof cur === 'object' ? cur : {}) } as Record<string, unknown>;
      if (body?.undo === true) delete next[key];
      else next[key] = { at: new Date().toISOString(), by, note };
      await this.prisma.setting.upsert({ where: { key: CHAIN_REVIEWED_KEY }, create: { key: CHAIN_REVIEWED_KEY, value: next as object }, update: { value: next as object } });
    });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'employee_chain', entityId: pinfl, summary: `Harakat zanjiri: ${period} — «${ISSUE_LABEL[type]}» ${body?.undo === true ? 'qayta ochildi' : "ko'rib chiqildi"}${note ? ` (${note})` : ''}` });
    return { key, reviewed: body?.undo !== true };
  }
}
