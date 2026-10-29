import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { currentPeriodTashkent, monthsBetween, periodAdd, type Source } from './hp.const';
import type { Refs } from './hp.import';
import { REGION_GENERAL } from '../../common/segments/segments';

// ═══════════════════════════════════════════════════════════
// Ma'lumotnomalar va prognoz uchun tarixiy ma'lumotni yig'ish.
//
// Manbalar:
//   system — dasturdagi daromadlar: Hududlar tushumi (incomes, SRV_xx, hudud kodi > 0) — soni va summasi;
//   import — «Daromad_Tarixi» shabloni orqali yuklangan statistika (hp_stats);
//   merged — ikkalasi: bir xil oy × hudud × xizmat bo'lsa yuklangan ustun.
//
// Yetishmayotgan ma'lumot qoidasi: hudud shu oy uchun umuman hisobot bermagan bo'lsa (hech bir xizmat yozuvi yo'q) —
// oy «ma'lumot yo'q» (null); hisobot bor, lekin xizmat yozilmagan — o'sha xizmat 0.
// ═══════════════════════════════════════════════════════════

export interface StatCell {
  qty: number;
  rev: number; // so'm
  plan: number | null;
  source: 'system' | 'import';
}

export interface Dataset {
  months: string[];
  /** `${period}|${region}|${service}` → qiymat */
  cells: Map<string, StatCell>;
  /** Hisobot bergan hudud-oylar: `${period}|${region}` */
  reported: Set<string>;
  regions: { code: number; name: string }[];
  services: { code: string; name: string }[];
}

export interface TariffRow {
  service: string;
  region: number | null;
  validFrom: string;
  price: number;
}

@Injectable()
export class HpDataService {
  constructor(private readonly prisma: PrismaService) {}

  async catalog() {
    const [regions, services, tariffs] = await Promise.all([
      this.prisma.region.findMany({ where: { code: { not: REGION_GENERAL } }, select: { code: true, name: true, isActive: true }, orderBy: { code: 'asc' } }),
      this.prisma.incomeCategory.findMany({ where: { code: { startsWith: 'SRV_' } }, select: { code: true, label: true, isActive: true, order: true }, orderBy: [{ order: 'asc' }, { code: 'asc' }] }),
      this.prisma.serviceTariff.findMany({ where: { status: 'APPROVED' }, select: { categoryCode: true, regionCode: true, priceTiyin: true, validFrom: true }, orderBy: { validFrom: 'asc' } }),
    ]);
    const tariffRows: TariffRow[] = tariffs.map((t) => ({ service: t.categoryCode, region: t.regionCode, validFrom: t.validFrom.toISOString().slice(0, 10), price: Number(t.priceTiyin) / 100 }));
    return { regions, services, tariffs: tariffRows };
  }

  tariffAt(tariffs: TariffRow[], service: string, region: number, period: string): number | null {
    const end = `${periodAdd(period, 1)}-01`;
    let reg: TariffRow | null = null;
    let gen: TariffRow | null = null;
    for (const t of tariffs) {
      if (t.service !== service || t.validFrom >= end) continue;
      if (t.region === region) reg = t;
      else if (t.region === null) gen = t;
    }
    return (reg ?? gen)?.price ?? null;
  }

  async refs(): Promise<Refs> {
    const [{ regions, services, tariffs }, employees] = await Promise.all([
      this.catalog(),
      this.prisma.employee.findMany({ select: { pinfl: true, fullName: true, regionCode: true, isActive: true } }),
    ]);
    return {
      regions: new Map(regions.map((r) => [r.code, { name: r.code === 0 ? 'Markaz' : r.name, isActive: r.isActive }])),
      services: new Map(services.map((s) => [s.code, { label: s.label, isActive: s.isActive }])),
      employees: new Map(employees.map((e) => [e.pinfl, { fullName: e.fullName, regionCode: e.regionCode, isActive: e.isActive }])),
      tariffAt: (s, r, p) => this.tariffAt(tariffs, s, r, p),
      currentPeriod: currentPeriodTashkent(),
    };
  }

  /** Tarixiy oylik statistika (hudud × xizmat × oy) tanlangan manbadan */
  async dataset(source: Source, from: string, to: string, regionCodes: number[] | null): Promise<Dataset> {
    const months = monthsBetween(from, to);
    const { regions, services } = await this.catalog();
    const cells = new Map<string, StatCell>();
    const reported = new Set<string>();
    const regionFilter = regionCodes?.length ? { in: regionCodes } : { gt: 0 };

    if (source !== 'import') {
      const sys = await this.prisma.income.groupBy({
        by: ['period', 'regionCode', 'categoryCode'],
        where: { deletedAt: null, period: { gte: from, lte: to }, categoryCode: { startsWith: 'SRV_' }, regionCode: regionFilter },
        _sum: { quantity: true, amountTiyin: true },
      });
      for (const g of sys) {
        if (g.regionCode === null || g.regionCode === 0) continue;
        const k = `${g.period}|${g.regionCode}|${g.categoryCode}`;
        cells.set(k, { qty: Number(g._sum.quantity ?? 0), rev: Number(g._sum.amountTiyin ?? 0n) / 100, plan: null, source: 'system' });
        reported.add(`${g.period}|${g.regionCode}`);
      }
    }
    if (source !== 'system') {
      const imp = await this.prisma.hpStat.findMany({
        where: { period: { gte: from, lte: to }, regionCode: regionFilter },
        select: { period: true, regionCode: true, serviceCode: true, quantity: true, revenueTiyin: true, planTiyin: true },
      });
      for (const r of imp) {
        // Bir xil kalitda yuklangan ma'lumot ustun (merged)
        cells.set(`${r.period}|${r.regionCode}|${r.serviceCode}`, { qty: r.quantity, rev: Number(r.revenueTiyin) / 100, plan: r.planTiyin === null ? null : Number(r.planTiyin) / 100, source: 'import' });
        reported.add(`${r.period}|${r.regionCode}`);
      }
    }
    const regionList = regions.filter((r) => r.code !== 0 && (!regionCodes?.length || regionCodes.includes(r.code))).map((r) => ({ code: r.code, name: r.name }));
    return { months, cells, reported, regions: regionList, services: services.map((s) => ({ code: s.code, name: s.label })) };
  }

  /** Python uchun qatorlar: har bir hudud × xizmat; hisobot bermagan oy — null */
  series(ds: Dataset) {
    const out: { region: number; service: string; qty: (number | null)[]; rev: (number | null)[] }[] = [];
    for (const r of ds.regions) {
      const anyReport = ds.months.some((m) => ds.reported.has(`${m}|${r.code}`));
      if (!anyReport) continue;
      for (const s of ds.services) {
        const qty: (number | null)[] = [];
        const rev: (number | null)[] = [];
        let seen = false;
        for (const m of ds.months) {
          const c = ds.cells.get(`${m}|${r.code}|${s.code}`);
          if (c) {
            seen = true;
            qty.push(c.qty);
            rev.push(c.rev);
          } else if (ds.reported.has(`${m}|${r.code}`)) {
            qty.push(0);
            rev.push(0);
          } else {
            qty.push(null);
            rev.push(null);
          }
        }
        if (!seen && qty.every((v) => v === null || v === 0)) {
          // Xizmat bu hududda umuman bo'lmagan — baribir qator yuboriladi (39 ta xizmat to'liq ko'rinsin)
        }
        out.push({ region: r.code, service: s.code, qty, rev });
      }
    }
    return out;
  }

  /** Xodimlar ma'lumoti (hudud bo'yicha) — taqsimlash uchun */
  async employeesData(regionCodes: number[], months: string[], target: string) {
    const from = months[Math.max(0, months.length - 12)]!;
    const to = target;
    const [employees, empMonths, empServices, results, factors] = await Promise.all([
      this.prisma.employee.findMany({
        where: { regionCode: { in: regionCodes } },
        select: { pinfl: true, fullName: true, regionCode: true, position: true, hiredAt: true, firedAt: true, isActive: true },
      }),
      this.prisma.hpEmpMonth.findMany({ where: { regionCode: { in: regionCodes }, period: { gte: from, lte: to } } }),
      this.prisma.hpEmpService.findMany({ where: { regionCode: { in: regionCodes }, period: { gte: from, lte: to } } }),
      this.prisma.employeeResult.findMany({
        where: { regionCode: { in: regionCodes }, period: { gte: from, lte: to }, batch: { cancelledAt: null } },
        select: { period: true, employeePinfl: true, regionCode: true, factTiyin: true, planTiyin: true },
      }),
      this.prisma.hpRegionFactor.findMany({ where: { regionCode: { in: regionCodes }, period: { gte: from, lte: to } } }),
    ]);
    const out: Record<string, unknown> = {};
    for (const code of regionCodes) {
      // Xodimning hozirgi hududi — shu hudud; tarixiy natijalar faqat shu hududdagisi olinadi
      const emps = employees.filter((e) => e.regionCode === code);
      const pins = new Set([...emps.map((e) => e.pinfl), ...empServices.filter((r) => r.regionCode === code).map((r) => r.employeePinfl)]);
      const empTotals = new Map<string, { pinfl: string; period: string; revenue: number; plan: number | null }>();
      for (const r of results.filter((x) => x.regionCode === code)) {
        const k = `${r.employeePinfl}|${r.period}`;
        const cur = empTotals.get(k) ?? { pinfl: r.employeePinfl, period: r.period, revenue: 0, plan: 0 };
        cur.revenue += Number(r.factTiyin) / 100;
        cur.plan = (cur.plan ?? 0) + Number(r.planTiyin) / 100;
        empTotals.set(k, cur);
      }
      for (const m of empMonths.filter((x) => x.regionCode === code && x.totalRevenueTiyin !== null)) {
        // Yuklangan jami tushum — dasturdagi natijadan ustun
        empTotals.set(`${m.employeePinfl}|${m.period}`, { pinfl: m.employeePinfl, period: m.period, revenue: Number(m.totalRevenueTiyin) / 100, plan: m.planTiyin === null ? null : Number(m.planTiyin) / 100 });
      }
      out[String(code)] = {
        employees: emps.map((e) => ({
          pinfl: e.pinfl,
          name: e.fullName,
          position: e.position,
          hiredAt: e.hiredAt?.toISOString().slice(0, 10) ?? null,
          firedAt: e.firedAt?.toISOString().slice(0, 10) ?? null,
          active: e.isActive && (!empMonths.some((m) => m.employeePinfl === e.pinfl && m.period === target && !m.active)),
        })),
        empMonths: empMonths.filter((x) => x.regionCode === code && pins.has(x.employeePinfl)).map((x) => ({ pinfl: x.employeePinfl, period: x.period, workedDays: x.workedDays })),
        empServices: empServices.filter((x) => x.regionCode === code).map((x) => ({ pinfl: x.employeePinfl, period: x.period, service: x.serviceCode, revenue: Number(x.revenueTiyin) / 100, qty: x.quantity })),
        empTotals: [...empTotals.values()],
        workDays: Object.fromEntries(factors.filter((f) => f.regionCode === code && f.workDays !== null).map((f) => [f.period, f.workDays])),
      };
    }
    return out;
  }

  static hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 40);
  }
}