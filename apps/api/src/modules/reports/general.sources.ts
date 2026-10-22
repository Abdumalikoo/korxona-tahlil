import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AlertsService } from '../alerts/alerts.service';
import { BplanService } from '../bplan/bplan.service';
import { ScenarioService } from '../econ/econ.scenario';
import { EconService } from '../econ/econ.service';
import type { ForecastResult, RiskResult } from '../econ/econ.types';
import { PrismaService } from '../prisma/prisma.service';
import { ControlsService } from '../reactions/controls.service';
import { ReactionsService } from '../reactions/reactions.service';
import { NO_HISTORY, type DataStatus } from './general.config';
import { dayStart, isoOf, monthsOf, todayIso, type Range } from './reports.data';

// ═══════════════════════════════════════════════════════════
// «Umumiy hisobot» — qo'shimcha manbalar (reja, prognoz, risk, Munosabat, Nazorat, ogohlantirishlar).
// Har bir manba alohida: xato bo'lsa hisobot to'xtamaydi — shu ko'rsatkich holati «Xato» yoki «Manba yo'q»,
// sababi foydalanuvchiga tushunarli, texnik tafsilot — logga.
// ═══════════════════════════════════════════════════════════

export interface Source<T> {
  status: DataStatus;
  value: T | null;
  /** Foydalanuvchiga ko'rsatiladigan sabab yoki izoh */
  note: string;
}

const ok = <T>(value: T, note = ''): Source<T> => ({ status: 'full', value, note });
const none = <T>(status: DataStatus, note: string): Source<T> => ({ status, value: null, note });

/** mln so'm (biznes-reja birligi) → tiyin */
const mlnToTiyin = (v: number) => BigInt(Math.round(v * 1e8));

export interface CompanyPlan {
  /** «2026-yil 2-chorak» */
  label: string;
  quarters: number[];
  year: number;
  revenuePlan: bigint;
  revenueFact: bigint;
  costPlan: bigint;
  costFact: bigint;
  profitPlan: bigint;
  profitFact: bigint;
}

export interface RegionPlan {
  regionCode: number;
  /** Davrning barcha oylari uchun tasdiqlangan reja (to'liq bo'lsa) */
  plan: bigint | null;
  /** Har oy: versiya (yo'q — null) */
  versions: { period: string; version: number | null }[];
  status: DataStatus;
}

export interface ReactionState {
  id: string;
  title: string;
  open: boolean;
  overdue: boolean;
  due: string;
  owner: string | null;
  units: string[];
  categories: string[];
}

export interface ControlState {
  label: string;
  status: 'ok' | 'risk' | 'breach' | 'nodata';
  owner: string | null;
}

@Injectable()
export class GeneralSources {
  private readonly log = new Logger('UmumiyHisobot');

  constructor(
    private readonly prisma: PrismaService,
    private readonly econ: EconService,
    private readonly scenarios: ScenarioService,
    private readonly reactions: ReactionsService,
    private readonly controls: ControlsService,
    private readonly alerts: AlertsService,
    private readonly bplan: BplanService,
  ) {}

  private fail<T>(what: string, e: unknown, userText: string): Source<T> {
    this.log.warn(`${what}: ${(e as Error)?.message ?? e}`);
    return none('error', userText);
  }

  /** Davr butun oylardan iboratmi (1-kun … oy oxiri) */
  static wholeMonths(range: Range): boolean {
    if (range.from.slice(8) !== '01') return false;
    const y = Number(range.to.slice(0, 4));
    const m = Number(range.to.slice(5, 7));
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return Number(range.to.slice(8)) === last;
  }

  /** Davr butun choraklardan iborat (bir yil ichida) bo'lsa — choraklar ro'yxati */
  static quartersOf(range: Range): { year: number; quarters: number[] } | null {
    if (!GeneralSources.wholeMonths(range)) return null;
    if (range.from.slice(0, 4) !== range.to.slice(0, 4)) return null;
    const m1 = Number(range.from.slice(5, 7));
    const m2 = Number(range.to.slice(5, 7));
    if ((m1 - 1) % 3 !== 0 || m2 % 3 !== 0) return null;
    const quarters: number[] = [];
    for (let q = (m1 + 2) / 3; q <= m2 / 3; q += 1) quarters.push(q);
    return { year: Number(range.from.slice(0, 4)), quarters };
  }

  /**
   * Prognoz va risk uchun «qaysi oy holatida»: davr oxiri oy oxiri bo'lsa — shu oy, aks holda oldingi oy.
   * Joriy yoki kelajak oy bo'lsa — undefined (bugungi holat).
   */
  static asOfMonth(range: Range): string | undefined {
    const to = range.to;
    const y = Number(to.slice(0, 4));
    const m = Number(to.slice(5, 7));
    const monthEnd = Number(to.slice(8)) === new Date(Date.UTC(y, m, 0)).getUTCDate();
    const month = monthEnd ? to.slice(0, 7) : isoOf(new Date(dayStart(`${to.slice(0, 7)}-01`).getTime() - 86_400_000)).slice(0, 7);
    return month < todayIso().slice(0, 7) ? month : undefined;
  }

  // ───────────────────────── Reja ─────────────────────────

  /** Choraklik biznes-reja (butun korxona). Davr choraklarga mos kelmasa — oylik taqsimot to'qilmaydi */
  async companyPlan(range: Range): Promise<Source<CompanyPlan>> {
    const q = GeneralSources.quartersOf(range);
    if (!q) return none('na', "Biznes-reja choraklik: davr to'liq chorak(lar)ga to'g'ri kelmaydi — reja–fakt foizi chiqarilmaydi");
    try {
      const sum = { revenuePlan: 0n, revenueFact: 0n, costPlan: 0n, costFact: 0n, profitPlan: 0n, profitFact: 0n };
      for (const quarter of q.quarters) {
        const ex = await this.bplan.report(q.year, quarter, 'quarter');
        const s = ex.summary;
        sum.revenuePlan += mlnToTiyin(s.revenuePlan);
        sum.revenueFact += mlnToTiyin(s.revenueFact);
        sum.costPlan += mlnToTiyin(s.costPlan);
        sum.costFact += mlnToTiyin(s.costFact);
        sum.profitPlan += mlnToTiyin(s.profitPlan);
        sum.profitFact += mlnToTiyin(s.profitFact);
      }
      const label = q.quarters.length === 1 ? `${q.year}-yil ${q.quarters[0]}-chorak` : `${q.year}-yil ${q.quarters[0]}–${q.quarters[q.quarters.length - 1]}-choraklar`;
      return ok({ label, year: q.year, quarters: q.quarters, ...sum }, `Choraklik biznes-reja, ${label}`);
    } catch (e) {
      if (e instanceof NotFoundException) return none('nosource', `${q.year}-yil biznes-rejasi yuklanmagan`);
      return this.fail('biznes-reja', e, "Biznes-rejani o'qib bo'lmadi");
    }
  }

  /** «Hudud uchun reja»: davrning har oyi uchun tasdiqlangan (amaldagi) versiya; hammasi bo'lsa — reja yig'indisi */
  async regionPlans(range: Range, regionCodes: number[]): Promise<Source<RegionPlan[]>> {
    if (!GeneralSources.wholeMonths(range)) return none('na', "Hududlar rejasi oylik: davr to'liq oylardan iborat emas");
    const months = monthsOf(range);
    try {
      const rows = await this.prisma.hpPlanVersion.findMany({
        where: { targetPeriod: { in: months }, status: 'APPROVED' },
        select: { targetPeriod: true, regionCode: true, version: true, forecastTiyin: true },
      });
      if (!rows.length) return none('nosource', "Davr oylari uchun tasdiqlangan «Hudud uchun reja» yo'q");
      const out: RegionPlan[] = regionCodes.map((code) => {
        const versions = months.map((m) => {
          const v = rows.filter((r) => r.regionCode === code && r.targetPeriod === m).sort((a, b) => b.version - a.version)[0];
          return { period: m, version: v?.version ?? null, tiyin: v?.forecastTiyin ?? null };
        });
        const complete = versions.every((v) => v.tiyin !== null);
        const any = versions.some((v) => v.tiyin !== null);
        return {
          regionCode: code,
          plan: complete ? versions.reduce((s, v) => s + (v.tiyin as bigint), 0n) : null,
          versions: versions.map((v) => ({ period: v.period, version: v.version })),
          status: complete ? 'full' : any ? 'partial' : 'nosource',
        };
      });
      return ok(out);
    } catch (e) {
      return this.fail('hudud rejasi', e, "«Hudud uchun reja»ni o'qib bo'lmadi");
    }
  }

  // ───────────────────────── Prognoz va risk ─────────────────────────

  async forecast(target: 'income' | 'expense' | 'result', asOf: string | undefined): Promise<Source<ForecastResult>> {
    try {
      const f = await this.econ.forecast({ target, unit: 'all', horizon: '3', ...(asOf ? { asOf } : {}) });
      if (f.model.kind === 'none') return none('na', f.notes[0] ?? 'Prognoz uchun tarix yetarli emas');
      return ok(f);
    } catch (e) {
      return this.fail(`prognoz (${target})`, e, 'Prognoz servisi ishlamadi');
    }
  }

  async risk(asOf: string | undefined): Promise<Source<RiskResult>> {
    try {
      return ok(await this.scenarios.risk({ horizon: '3', ...(asOf ? { asOf } : {}) }));
    } catch (e) {
      return this.fail('risk', e, 'Zarar xavfi modeli ishlamadi');
    }
  }

  // ───────────────────────── Munosabat, Nazorat, ogohlantirishlar ─────────────────────────

  /**
   * Munosabatlar davr oxiridagi holatda: yaratilgan va yopilgan sanalaridan tiklanadi
   * (holat tarixi alohida saqlanmaydi — shu cheklov metodikada yozilgan).
   */
  async reactionsAt(range: Range): Promise<Source<ReactionState[]>> {
    try {
      const end = new Date(dayStart(range.to).getTime() + 86_400_000);
      const list = await this.reactions.list();
      const existed = list.filter((r) => new Date(r.createdAt) < end);
      const ids = existed.map((r) => r.id);
      const items = ids.length ? await this.prisma.reactionItem.findMany({ where: { reactionId: { in: ids } }, select: { reactionId: true, filter: true } }) : [];
      const out = existed.map((r) => {
        const open = !r.closedAt || new Date(r.closedAt) >= end;
        const own = items.filter((i) => i.reactionId === r.id).map((i) => (i.filter ?? {}) as { unit?: string; categoryCode?: string; rootCategoryCode?: string });
        return {
          id: r.id,
          title: r.title,
          open,
          overdue: open && new Date(r.dueDate) < end,
          due: r.dueDate.slice(0, 10),
          owner: r.assignees[0]?.fullName ?? null,
          units: own.map((f) => f.unit).filter((x): x is string => Boolean(x)),
          categories: own.flatMap((f) => [f.categoryCode, f.rootCategoryCode]).filter((x): x is string => Boolean(x)),
        };
      });
      return ok(out, 'Holat yaratilgan va yopilgan sanalardan tiklangan');
    } catch (e) {
      return this.fail('munosabatlar', e, "Munosabatlarni o'qib bo'lmadi");
    }
  }

  /** Nazorat davrning oxirgi oyi holatida (o'tgan oy — shu oy oxiridagi hisob; joriy oy — bugungi holat) */
  async controlsAt(range: Range): Promise<Source<ControlState[]>> {
    try {
      const month = range.to.slice(0, 7);
      const end = new Date(dayStart(range.to).getTime() + 86_400_000);
      const views = await this.controls.list(undefined, month);
      const out = views
        .filter((v) => v.isActive && new Date(v.createdAt) < end)
        .map((v) => ({ label: v.label, status: v.status, owner: v.assignees[0]?.fullName ?? null }));
      return ok(out);
    } catch (e) {
      return this.fail('nazorat', e, "Nazoratni o'qib bo'lmadi");
    }
  }

  /** Avtomatik ogohlantirishlar — faqat oxirgi tekshirilgan oy uchun; boshqa davrga ko'chirilmaydi */
  async alertsAt(range: Range): Promise<Source<{ title: string; detail: string; severity: 'high' | 'medium'; rule: string }[]>> {
    try {
      const res = await this.alerts.list(true);
      if (res.period !== range.to.slice(0, 7)) return none('na', `${NO_HISTORY} (ogohlantirishlar faqat ${res.period} oyi uchun hisoblanadi)`);
      return ok(res.alerts.map((a) => ({ title: a.title, detail: a.detail, severity: a.severity, rule: a.rule })));
    } catch (e) {
      return this.fail('ogohlantirishlar', e, "Ogohlantirishlarni o'qib bo'lmadi");
    }
  }

  // ───────────────────────── Ma'lumot holati ─────────────────────────

  async closedMonths(): Promise<Set<string>> {
    const rows = await this.prisma.regionalPeriodClose.findMany({ where: { status: 'CLOSED' }, select: { period: true } }).catch(() => []);
    return new Set(rows.map((r) => r.period));
  }

  /** Eng oxirgi yopilgan oy (standart davr uchun) */
  async lastClosedMonth(): Promise<string | null> {
    const closed = [...(await this.closedMonths())].sort();
    return closed[closed.length - 1] ?? null;
  }

  async activeRegions(): Promise<{ code: number; key: string; name: string }[]> {
    const rows = await this.prisma.region.findMany({ where: { code: { gt: 0 }, isActive: true }, select: { code: true, name: true }, orderBy: { name: 'asc' } });
    return rows.map((r) => ({ code: r.code, key: `r:${r.code}`, name: r.name }));
  }
}