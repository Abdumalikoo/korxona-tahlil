import { Injectable, Optional } from '@nestjs/common';
import { loadLocationRefs } from '../payroll/payroll.service';
import { PrismaService } from '../prisma/prisma.service';
import { PAYROLL_UNITS, UnitPayrollService, isPayrollUnit } from '../unit-payroll/unit-payroll.service';

// ═══════════════════════════════════════════════════════════
// Ish haqi faktlari — BITTA JOYDA. Har sahifa (ish haqi tarkibi, uchlik nazorat, solishtirma, bo'lim sahifasi, nazorat)
// xodim haqida bir xil javob bersin:
//  • soliq(oy)   — xodimning soliq hisobotidagi summasi va manbasi. Asosiy — umumiy soliq hisoboti (Markaz va
//                  hududlar vedomostlari); bo'limlarga «miya» bo'yicha yozilgani — o'sha hisobot; bo'lim sahifasida
//                  qo'lda yuklangani — faqat umumiy hisobotda bo'lmasa (bo'lsa — ikki marta sanalgan deb belgilanadi);
//  • tarkib(oy)  — xodimning ish haqi tarkibi: bo'limning o'z tarkibi — xodim shu oy o'sha bo'limda bo'lsa yoki
//                  umumiy tarkibda bo'lmasa; aks holda — umumiy tarkib (ikkalasi hech qachon qo'shilmaydi);
//  • joy(oy)     — xodim shu oy qayerda: bo'lim (Tax free …) — «miya»dan; Markaz bo'limi / hudud — natijalar fayli
//                  va shu oy joy o'zgarishlari (ish haqi xarajati qayerga yozilsa — o'sha), bo'lmasa Xodimlar bazasi;
//                  turi (shtat / shartnoma) — shu oy joylashuvidan, bo'lmasa bazadan.
// Eski yozuvlarda baseTiyin = 0 bo'lishi mumkin — to'liq summa = hududda qolgani + Markazga o'tgani.
// ═══════════════════════════════════════════════════════════

export type SoliqSource = 'ALL' | 'REGIONS' | 'UNIT_GENERAL' | 'UNIT_MANUAL';
export interface SoliqFact {
  tiyin: bigint;
  source: SoliqSource;
  /** Bo'lim (bo'lim ish haqida bo'lsa) */
  unit: string | null;
  /** Umumiy hisobotda ham, bo'lim sahifasida qo'lda ham — ikki marta sanalgan */
  duplicate: boolean;
  /** Qo'lda yuklangan (ortiqcha) qism — duplicate bo'lsa */
  manualTiyin: bigint;
}

export interface TarkibFact {
  tiyin: bigint;
  /** GENERAL — umumiy tarkib; aks holda — bo'lim kodi (o'z tarkibi) */
  source: string;
  items: Record<string, bigint>;
  /** Boshqa tarkibda ham bor (olinmadi) */
  alsoIn: string | null;
}

export interface LocationFact {
  /** CENTER | REGION | bo'lim kodi */
  unit: string;
  regionCode: number | null;
  regionName: string | null;
  districtId: string | null;
  departmentId: string | null;
  departmentName: string | null;
  employmentType: 'SHTAT' | 'SHARTNOMA';
  typeKnown: boolean;
  inRegistry: boolean;
  /** Shu oy joyi o'zgartirilgan (ish haqi tarkibi yoki qo'lda) */
  fixed: boolean;
  /** Joyi ma'lum (bazada, natijalar faylida, «miya»da yoki o'zgartirilgan) — aks holda «joyi noma'lum» */
  known: boolean;
}

export const fullOf = (e: { baseTiyin: bigint; totalTiyin: bigint; bonusTiyin: bigint }) => (e.baseTiyin === 0n && e.totalTiyin + e.bonusTiyin > 0n ? e.totalTiyin + e.bonusTiyin : e.baseTiyin);

@Injectable()
export class PayrollFactsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly units?: UnitPayrollService,
  ) {}

  /** Xodimning soliq hisobotidagi summasi (shu oy) — umumiy hisobot asosiy */
  async soliq(period: string): Promise<Map<string, SoliqFact>> {
    const out = new Map<string, SoliqFact>();
    const entries = await this.prisma.payrollEntry
      .findMany({ where: { period, deletedAt: null, batch: { status: 'COMMITTED' } }, select: { employeePinfl: true, baseTiyin: true, totalTiyin: true, bonusTiyin: true, batch: { select: { scope: true } } } })
      .catch(() => [] as { employeePinfl: string; baseTiyin: bigint; totalTiyin: bigint; bonusTiyin: bigint; batch: { scope: string } | null }[]);
    for (const e of entries) {
      const x = out.get(e.employeePinfl);
      const v = fullOf(e);
      if (x) x.tiyin += v;
      else out.set(e.employeePinfl, { tiyin: v, source: e.batch?.scope === 'REGIONS' ? 'REGIONS' : 'ALL', unit: null, duplicate: false, manualTiyin: 0n });
    }
    if (this.units && typeof this.units.allBatches === 'function') {
      const gen = new Map<string, { tiyin: bigint; unit: string }>();
      const man = new Map<string, { tiyin: bigint; unit: string }>();
      for (const u of await this.units.allBatches(period)) {
        if (u.batch.status !== 'COMMITTED') continue;
        const into = u.batch.origin === 'GENERAL' ? gen : man;
        for (const r of u.batch.rows ?? []) {
          const x = into.get(r.pinfl) ?? { tiyin: 0n, unit: u.unit };
          x.tiyin += BigInt(r.amountTiyin);
          into.set(r.pinfl, x);
        }
      }
      for (const [p, g] of gen) {
        const x = out.get(p);
        if (x) {
          // Umumiy hisobotda ham, undan bo'limga ham — ikki marta (eski xato); umumiy asosiy
          x.duplicate = true;
        } else out.set(p, { tiyin: g.tiyin, source: 'UNIT_GENERAL', unit: g.unit, duplicate: false, manualTiyin: 0n });
      }
      for (const [p, m] of man) {
        const x = out.get(p);
        if (x) {
          x.duplicate = true;
          x.manualTiyin += m.tiyin;
          x.unit = x.unit ?? m.unit;
        } else out.set(p, { tiyin: m.tiyin, source: 'UNIT_MANUAL', unit: m.unit, duplicate: false, manualTiyin: 0n });
      }
    } else if (this.units) {
      // Soddalashtirilgan (sinov) — bo'lim vedomosti xaritasi
      for (const u of PAYROLL_UNITS) {
        const m = await this.units.payrollMap(u, period).catch(() => null);
        if (m) for (const [p, v] of m) if (!out.has(p)) out.set(p, { tiyin: v, source: 'UNIT_GENERAL', unit: u, duplicate: false, manualTiyin: 0n });
      }
    }
    return out;
  }

  /** Xodimning ish haqi tarkibi (shu oy) — bitta qoida bilan tanlangan bitta tarkib */
  async tarkib(period: string): Promise<{ map: Map<string, TarkibFact>; generalUploaded: boolean; unitUploaded: string[] }> {
    const general = new Map<string, { tiyin: bigint; items: Record<string, bigint> }>();
    const batch = await this.prisma.salaryCompositionBatch.findFirst({ where: { period, cancelledAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (batch) {
      const rows = await this.prisma.salaryCompositionRow.findMany({ where: { batchId: batch.id }, select: { id: true, employeePinfl: true, totalTiyin: true } });
      const items = await this.prisma.salaryCompositionItem.findMany({ where: { batchId: batch.id }, select: { rowId: true, componentCode: true, amountTiyin: true } }).catch(() => [] as { rowId: string; componentCode: string; amountTiyin: bigint }[]);
      const byRow = new Map<string, Record<string, bigint>>();
      for (const it of items) {
        const r = byRow.get(it.rowId) ?? {};
        r[it.componentCode] = (r[it.componentCode] ?? 0n) + it.amountTiyin;
        byRow.set(it.rowId, r);
      }
      for (const r of rows) general.set(r.employeePinfl, { tiyin: r.totalTiyin, items: byRow.get(r.id) ?? {} });
    }
    const unitT = new Map<string, { tiyin: bigint; unit: string; items: Record<string, bigint> }>();
    const unitUploaded: string[] = [];
    const settings = await this.prisma.setting.findMany({ where: { key: { in: PAYROLL_UNITS.map((u) => `unit.composition.${u}.${period}`) } }, select: { key: true, value: true } });
    for (const s of settings) {
      const u = s.key.split('.')[2]!;
      const list = ((s.value as { batches?: { cancelledAt: string | null; createdAt: string; rows?: { pinfl?: string; totalTiyin?: string; items?: Record<string, string> }[] }[] } | null)?.batches ?? []).filter((b) => !b.cancelledAt);
      const active = list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (!active) continue;
      unitUploaded.push(u);
      for (const r of active.rows ?? []) {
        if (!r.pinfl || !/^\d{14}$/.test(r.pinfl) || unitT.has(r.pinfl)) continue;
        try {
          unitT.set(r.pinfl, { tiyin: BigInt(r.totalTiyin ?? '0'), unit: u, items: Object.fromEntries(Object.entries(r.items ?? {}).map(([k, v]) => [k, BigInt(v)])) });
        } catch {
          /* noto'g'ri qiymat */
        }
      }
    }
    // Ikkalasida bo'lganlar: shu oy qaysi bo'limda — o'sha bo'lim tarkibi; Markaz / hududda — umumiy tarkib
    const both = [...unitT.keys()].filter((p) => general.has(p));
    const at = both.length && this.units && typeof this.units.unitsAt === 'function' ? await this.units.unitsAt(both, period) : new Map<string, string>();
    const map = new Map<string, TarkibFact>();
    for (const [p, g] of general) map.set(p, { tiyin: g.tiyin, source: 'GENERAL', items: g.items, alsoIn: null });
    for (const [p, u] of unitT) {
      const g = map.get(p);
      if (!g) map.set(p, { tiyin: u.tiyin, source: u.unit, items: u.items, alsoIn: null });
      else if (at.get(p) === u.unit) map.set(p, { tiyin: u.tiyin, source: u.unit, items: u.items, alsoIn: 'GENERAL' });
      else g.alsoIn = u.unit;
    }
    return { map, generalUploaded: Boolean(batch), unitUploaded };
  }

  /** Xodim shu oy qayerda (bo'lim / Markaz bo'limi / hudud) va turi */
  async location(period: string, pinfls: string[]): Promise<Map<string, LocationFact>> {
    const out = new Map<string, LocationFact>();
    if (!pinfls.length) return out;
    const [refs, emps, regions, deps, unitsAt, fixesRaw] = await Promise.all([
      loadLocationRefs(this.prisma, period, pinfls),
      this.prisma.employee.findMany({ where: { pinfl: { in: pinfls } }, select: { pinfl: true, regionCode: true, departmentId: true, employmentType: true, districtId: true } }),
      this.prisma.region.findMany({ select: { code: true, name: true } }),
      this.prisma.department.findMany({ select: { id: true, name: true } }),
      this.units && typeof this.units.unitsAt === 'function' ? this.units.unitsAt(pinfls, period) : Promise.resolve(new Map<string, string>()),
      this.prisma.setting.findUnique({ where: { key: `salary.composition.place.${period}` } }).catch(() => null),
    ]);
    const fixes = ((fixesRaw?.value as { fixes?: Record<string, unknown> } | null)?.fixes ?? {}) as Record<string, unknown>;
    const empBy = new Map(emps.map((e) => [e.pinfl, e]));
    const regName = new Map(regions.map((r) => [r.code, r.name]));
    const depName = new Map(deps.map((d) => [d.id, d.name]));
    for (const p of pinfls) {
      const e = empBy.get(p);
      const ref = refs.get(p);
      const mu = unitsAt.get(p) ?? null;
      const regionCode = ref?.regionCode ?? e?.regionCode ?? null;
      // Bo'lim (Tax free …) — «miya»dan; Markaz / hudud — ish haqi xarajati qayerga yozilsa (natijalar fayli, shu oy
      // joy o'zgarishi), bo'lmasa «miya» yoki Xodimlar bazasi
      let unit: string;
      if (mu && isPayrollUnit(mu)) unit = mu;
      else if (ref) unit = ref.regionCode === 0 ? 'CENTER' : 'REGION';
      else if (mu === 'CENTER' || mu === 'REGION') unit = mu;
      else unit = regionCode !== null && regionCode !== 0 ? 'REGION' : 'CENTER';
      const fx = fixes[p] as { unit?: string } | undefined;
      if (fx?.unit && !isPayrollUnit(unit)) unit = fx.unit === 'REGION' || fx.unit === 'CENTER' ? fx.unit : unit;
      const depId = unit === 'CENTER' ? (ref?.department?.id ?? e?.departmentId ?? null) : null;
      const type = ref?.employmentType ?? e?.employmentType ?? null;
      out.set(p, {
        unit,
        regionCode: unit === 'REGION' ? regionCode : unit === 'CENTER' ? 0 : regionCode,
        regionName: unit === 'REGION' && regionCode !== null ? (regName.get(regionCode) ?? `Hudud ${regionCode}`) : null,
        districtId: unit === 'REGION' ? (ref?.districtId ?? e?.districtId ?? null) : null,
        departmentId: depId,
        departmentName: depId ? (ref?.department?.name ?? depName.get(depId) ?? null) : null,
        employmentType: type === 'SHARTNOMA' ? 'SHARTNOMA' : 'SHTAT',
        typeKnown: type === 'SHARTNOMA' || type === 'SHTAT',
        inRegistry: Boolean(e),
        fixed: Boolean(fixes[p]),
        known: Boolean(e || ref || mu || fixes[p]),
      });
    }
    return out;
  }
}
