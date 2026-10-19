import { loadCenterCategories } from '../expense-policy/policy.util';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ControlsService } from '../reactions/controls.service';
import type { ItemFilter, ItemKind } from '../reactions/reactions.types';
import { DistrictsService } from '../structure/districts.service';
import { changeAlertCalc, controlAlertCalc, debtAlertCalc, full, lossAlertCalc, outlierAlertCalc, planAlertCalc } from './alerts.calc';
import {
  DEFAULT_SETTINGS,
  RULE_LABELS,
  type Alert,
  type AlertRule,
  type AlertSettings,
  type AlertsResult,
} from './alerts.types';

const TASHKENT_MS = 5 * 3600_000;
const DAY_MS = 86_400_000;
const CACHE_MS = 10 * 60_000;
const SETTINGS_KEY = 'alerts.settings';
const DISMISSED_KEY = 'alerts.dismissed';
const MAX_PER_RULE = 30;
const RULES = Object.keys(RULE_LABELS) as AlertRule[];

// ─────────── Sana va format ───────────

function todayIso(): string {
  return new Date(Date.now() + TASHKENT_MS).toISOString().slice(0, 10);
}

function monthOf(date: Date): string {
  return new Date(date.getTime() + TASHKENT_MS).toISOString().slice(0, 7);
}

function shiftMonth(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const i = y * 12 + (m - 1) + delta;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

function monthStart(period: string): Date {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1) - TASHKENT_MS);
}

function lastDay(period: string): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
function monthName(period: string): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return `${MONTHS[m - 1]} ${y}`;
}

function som(tiyin: bigint | number): string {
  const v = Number(tiyin) / 100;
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(2).replace('.', ',')} mlrd so'm`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1).replace('.', ',')} mln so'm`;
  if (a >= 1e3) return `${s}${Math.round(a / 1e3)} ming so'm`;
  return `${s}${Math.round(a)} so'm`;
}

function pct(value: number): string {
  return `${value.toFixed(1).replace('.', ',')}%`;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const toTiyin = (som: number) => BigInt(Math.round(som * 100));

type Meta = Pick<AlertsResult, 'period' | 'basePeriods' | 'generatedAt'>;

/** Bitta o'lchov (hudud, modda, kontragent…) oylar bo'yicha */
interface Series {
  label: string;
  values: Map<string, bigint>;
  item: { kind: ItemKind; filter: ItemFilter; label: string };
  href: string | null;
}

/**
 * «Muhokama talab qiladi»: ma'lumotni sozlamalardagi chegaralar bo'yicha tekshirib,
 * e'tibor berish kerak bo'lgan holatlarni topadi. Faqat Daromadlar, Xarajatlar va Xodimlar ma'lumoti.
 *
 * Tekshiriladigan oy — oxirgi TO'LIQ oy (joriy oy hali tugamagan); asos — undan oldingi N oy o'rtachasi.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  private cache: { key: string; at: number; alerts: Alert[]; meta: Meta } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly controls: ControlsService,
    private readonly districts: DistrictsService,
  ) {}

  // ═══════════ Sozlamalar ═══════════

  async settings(): Promise<AlertSettings> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTINGS_KEY } });
    const saved = (row?.value ?? {}) as Partial<AlertSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      enabled: { ...DEFAULT_SETTINGS.enabled, ...(saved.enabled ?? {}) },
    };
  }

  async saveSettings(input: Partial<AlertSettings>): Promise<AlertSettings> {
    const current = await this.settings();
    const num = (key: keyof AlertSettings, min: number, max: number): number => {
      const v = input[key];
      if (v === undefined) return current[key] as number;
      const n = Number(v);
      if (!Number.isFinite(n) || n < min || n > max) throw new BadRequestException(`Sozlama noto'g'ri: ${String(key)} (${min} … ${max})`);
      return n;
    };
    const enabled = { ...current.enabled };
    for (const rule of RULES) {
      const v = input.enabled?.[rule];
      if (v !== undefined) enabled[rule] = Boolean(v);
    }
    const next: AlertSettings = {
      enabled,
      baseMonths: Math.round(num('baseMonths', 1, 12)),
      expenseGrowthPct: num('expenseGrowthPct', 1, 1000),
      expenseGrowthMinSom: num('expenseGrowthMinSom', 0, 1e13),
      incomeDropPct: num('incomeDropPct', 1, 100),
      incomeDropMinSom: num('incomeDropMinSom', 0, 1e13),
      lossMinSom: num('lossMinSom', 0, 1e13),
      planMinPct: num('planMinPct', 1, 200),
      outlierFactor: num('outlierFactor', 1.1, 100),
      outlierMinSom: num('outlierMinSom', 0, 1e13),
      debtDays: Math.round(num('debtDays', 1, 3650)),
      debtMinSom: num('debtMinSom', 0, 1e13),
      byCounterparty: input.byCounterparty === undefined ? current.byCounterparty : Boolean(input.byCounterparty),
      byDistrict: input.byDistrict === undefined ? current.byDistrict : Boolean(input.byDistrict),
    };
    await this.prisma.setting.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value: next as unknown as Prisma.InputJsonValue },
      update: { value: next as unknown as Prisma.InputJsonValue },
    });
    this.cache = null;
    return next;
  }

  // ═══════════ «Ko'rildi» ═══════════

  private async dismissed(): Promise<Record<string, string>> {
    const row = await this.prisma.setting.findUnique({ where: { key: DISMISSED_KEY } });
    return (row?.value ?? {}) as Record<string, string>;
  }

  async dismiss(key: string): Promise<void> {
    if (typeof key !== 'string' || !key || key.length > 300) throw new BadRequestException("Kalit noto'g'ri");
    const map = await this.dismissed();
    map[key] = todayIso();
    // Eskilarini tozalash (6 oydan oldingi)
    const limit = new Date(Date.now() - 183 * DAY_MS).toISOString().slice(0, 10);
    for (const [k, d] of Object.entries(map)) if (d < limit) delete map[k];
    await this.prisma.setting.upsert({
      where: { key: DISMISSED_KEY },
      create: { key: DISMISSED_KEY, value: map as Prisma.InputJsonValue },
      update: { value: map as Prisma.InputJsonValue },
    });
  }

  async restoreAll(): Promise<void> {
    await this.prisma.setting.deleteMany({ where: { key: DISMISSED_KEY } });
  }

  // ═══════════ Ro'yxat ═══════════

  async list(showDismissed = false): Promise<AlertsResult> {
    const settings = await this.settings();
    const cacheKey = `${todayIso()}|${JSON.stringify(settings)}`;
    if (!this.cache || this.cache.key !== cacheKey || Date.now() - this.cache.at > CACHE_MS) {
      const { alerts, meta } = await this.compute(settings);
      this.cache = { key: cacheKey, at: Date.now(), alerts, meta };
    }
    const dismissed = await this.dismissed();
    const visible = this.cache.alerts.filter((a) => showDismissed || !dismissed[a.key]);
    const counts = Object.fromEntries(RULES.map((r) => [r, visible.filter((a) => a.rule === r).length])) as Record<AlertRule, number>;
    return {
      ...this.cache.meta,
      alerts: visible,
      dismissedCount: this.cache.alerts.filter((a) => dismissed[a.key]).length,
      counts,
      settings,
    };
  }

  // ═══════════ Hisob ═══════════

  private async compute(s: AlertSettings): Promise<{ alerts: Alert[]; meta: Meta }> {
    const today = todayIso();
    const period = shiftMonth(today.slice(0, 7), -1);
    const basePeriods = Array.from({ length: s.baseMonths }, (_, i) => shiftMonth(period, -(s.baseMonths - i)));
    const start = monthStart(basePeriods[0]!);
    const end = monthStart(shiftMonth(period, 1));

    const [regions, categories, incomeCats, expenses, incomes] = await Promise.all([
      this.prisma.region.findMany({ select: { code: true, name: true } }),
      this.prisma.category.findMany({ select: { code: true, label: true, parentCode: true } }),
      this.prisma.incomeCategory.findMany({ select: { code: true, label: true } }),
      this.prisma.expense.findMany({
        where: { deletedAt: null, date: { gte: start, lt: end } },
        select: { date: true, amountTiyin: true, regionCode: true, departmentId: true, categoryCode: true, counterparty: true },
      }),
      this.prisma.income.findMany({
        where: { deletedAt: null, date: { gte: start, lt: end } },
        select: { date: true, amountTiyin: true, regionCode: true, departmentId: true, categoryCode: true, clientName: true },
      }),
    ]);
    const regionName = new Map(regions.map((r) => [r.code, r.name]));
    const catLabel = new Map(categories.map((c) => [c.code, c.label]));
    const catParent = new Map(categories.map((c) => [c.code, c.parentCode]));
    const serviceLabel = new Map(incomeCats.map((c) => [c.code, c.label]));

    const unitOf = (regionCode: number | null, departmentId: string | null): { key: string; code: number | null } | null => {
      if (regionCode !== null) return { key: regionCode === 0 ? 'center' : `r:${regionCode}`, code: regionCode };
      if (departmentId) return { key: 'center', code: 0 };
      return null;
    };
    const unitLabel = (code: number) => (code === 0 ? (regionName.get(0) ?? 'Markaz') : (regionName.get(code) ?? `Hudud ${code}`));

    const add = (map: Map<string, Series>, key: string, make: () => Omit<Series, 'values'>, date: Date, amount: bigint) => {
      let series = map.get(key);
      if (!series) {
        series = { ...make(), values: new Map() };
        map.set(key, series);
      }
      const p = monthOf(date);
      series.values.set(p, (series.values.get(p) ?? 0n) + amount);
    };

    // ── O'lchovlar ──
    const expUnits = new Map<string, Series>();
    const expCats = new Map<string, Series>();
    const expParties = new Map<string, Series>();
    // Xarajatlar siyosati: Markaz hisobidagi moddalar — Markaz xarajati (Solishtirmadagidek)
    const centerCats = await loadCenterCategories(this.prisma).catch(() => new Set<string>());
    for (const e of expenses) {
      const u = centerCats.has(e.categoryCode) ? { key: 'center', code: 0 } : unitOf(e.regionCode, e.departmentId);
      if (u) {
        add(expUnits, u.key, () => ({
          label: unitLabel(u.code!),
          item: { kind: 'EXPENSE', filter: { unit: u.key }, label: `${unitLabel(u.code!)} — xarajat` },
          href: u.key === 'center' ? '/solishtirma/markaz' : `/solishtirma?r=${u.code}`,
        }), e.date, e.amountTiyin);
      }
      const top = catParent.get(e.categoryCode) ?? e.categoryCode;
      add(expCats, top, () => ({
        label: catLabel.get(top) ?? top,
        item: { kind: 'EXPENSE', filter: { rootCategoryCode: top }, label: `${catLabel.get(top) ?? top} (xarajat moddasi)` },
        href: '/xarajatlar/tahlil',
      }), e.date, e.amountTiyin);
      if (s.byCounterparty && e.counterparty?.trim()) {
        const cp = e.counterparty.trim();
        add(expParties, cp, () => ({
          label: cp,
          item: { kind: 'EXPENSE', filter: { counterparty: cp }, label: `${cp} (kontragent)` },
          href: `/xarajatlar/doimiy?q=${encodeURIComponent(cp)}`,
        }), e.date, e.amountTiyin);
      }
    }

    const incUnits = new Map<string, Series>();
    const incServices = new Map<string, Series>();
    const incClients = new Map<string, Series>();
    for (const i of incomes) {
      const u = unitOf(i.regionCode, i.departmentId);
      if (u && u.key !== 'center') {
        add(incUnits, u.key, () => ({
          label: unitLabel(u.code!),
          item: { kind: 'INCOME', filter: { unit: u.key }, label: `${unitLabel(u.code!)} — daromad` },
          href: `/solishtirma?r=${u.code}`,
        }), i.date, i.amountTiyin);
      }
      add(incServices, i.categoryCode, () => ({
        label: serviceLabel.get(i.categoryCode) ?? i.categoryCode,
        item: { kind: 'INCOME', filter: { categoryCode: i.categoryCode }, label: `${serviceLabel.get(i.categoryCode) ?? i.categoryCode} (daromad turi)` },
        href: '/daromadlar/tahlil',
      }), i.date, i.amountTiyin);
      if (s.byCounterparty && i.clientName?.trim()) {
        const c = i.clientName.trim();
        add(incClients, c, () => ({
          label: c,
          item: { kind: 'INCOME', filter: { clientName: c }, label: `${c} (mijoz)` },
          href: `/daromadlar/doimiy?q=${encodeURIComponent(c)}`,
        }), i.date, i.amountTiyin);
      }
    }

    const alerts: Alert[] = [];
    const baseAvg = (series: Series) => basePeriods.reduce((sum, p) => sum + (series.values.get(p) ?? 0n), 0n) / BigInt(basePeriods.length);
    const baseText = basePeriods.length === 1 ? monthName(basePeriods[0]!) : `oldingi ${basePeriods.length} oy o'rtachasi`;
    const baseList = (series: Series) => basePeriods.map((p) => ({ label: monthName(p), value: series.values.get(p) ?? 0n }));
    const push = (list: Alert[]) => alerts.push(...list.sort((a, b) => (BigInt(b.amountTiyin) > BigInt(a.amountTiyin) ? 1 : -1)).slice(0, MAX_PER_RULE));

    // ── 1) Xarajat keskin o'sgan ──
    if (s.enabled.expenseGrowth) {
      const minT = toTiyin(s.expenseGrowthMinSom);
      const found: Alert[] = [];
      const check = (map: Map<string, Series>, dim: string, what: string) => {
        for (const [key, series] of map) {
          const cur = series.values.get(period) ?? 0n;
          const base = baseAvg(series);
          const diff = cur - base;
          if (diff < minT || diff <= 0n) continue;
          const growth = base > 0n ? (Number(diff) / Number(base)) * 100 : null;
          if (growth !== null && growth < s.expenseGrowthPct) continue;
          if (growth === null && diff < minT * 2n) continue;
          found.push({
            key: `expenseGrowth:${dim}:${key}:${period}`,
            rule: 'expenseGrowth',
            ruleLabel: RULE_LABELS.expenseGrowth,
            severity: growth === null || growth >= s.expenseGrowthPct * 2 || diff >= minT * 5n ? 'high' : 'medium',
            title: `${series.label}: ${what} xarajati ${growth === null ? 'yangi paydo bo‘ldi' : `${pct(growth)} o'sdi`}`,
            detail:
              growth === null
                ? `${monthName(period)}: ${som(cur)}; ${baseText}da bu xarajat bo'lmagan.`
                : `${monthName(period)}: ${som(cur)}, ${baseText}: ${som(base)} — farq +${som(diff)} (+${pct(growth)}).`,
            amountTiyin: diff.toString(),
            period,
            item: { ...series.item, origin: "Avtomatik ogohlantirish" },
            href: series.href,
            calc: changeAlertCalc({
              dir: 'up',
              label: series.label,
              currentLabel: `Joriy oy (${monthName(period)})`,
              current: cur,
              base: baseList(series),
              baseLabel: baseText,
              thresholdPct: s.expenseGrowthPct,
              thresholdSom: s.expenseGrowthMinSom,
              source: 'Xarajat yozuvlari',
            }),
          });
        }
      };
      check(expUnits, 'unit', 'hudud');
      check(expCats, 'cat', 'modda');
      if (s.byCounterparty) check(expParties, 'cp', 'kontragent');
      push(found);
    }

    // ── 2) Daromad tushib ketgan ──
    if (s.enabled.incomeDrop) {
      const minT = toTiyin(s.incomeDropMinSom);
      const found: Alert[] = [];
      const check = (map: Map<string, Series>, dim: string, what: string) => {
        for (const [key, series] of map) {
          const cur = series.values.get(period) ?? 0n;
          const base = baseAvg(series);
          const drop = base - cur;
          if (base <= 0n || drop < minT) continue;
          const fall = (Number(drop) / Number(base)) * 100;
          if (fall < s.incomeDropPct) continue;
          found.push({
            key: `incomeDrop:${dim}:${key}:${period}`,
            rule: 'incomeDrop',
            ruleLabel: RULE_LABELS.incomeDrop,
            severity: fall >= s.incomeDropPct * 2 || drop >= minT * 5n ? 'high' : 'medium',
            title: `${series.label}: ${what} daromadi ${pct(fall)} kamaydi`,
            detail: `${monthName(period)}: ${som(cur)}, ${baseText}: ${som(base)} — farq −${som(drop)} (−${pct(fall)}).`,
            amountTiyin: drop.toString(),
            period,
            item: { ...series.item, origin: 'Avtomatik ogohlantirish' },
            href: series.href,
            calc: changeAlertCalc({
              dir: 'down',
              label: series.label,
              currentLabel: `Joriy oy (${monthName(period)})`,
              current: cur,
              base: baseList(series),
              baseLabel: baseText,
              thresholdPct: s.incomeDropPct,
              thresholdSom: s.incomeDropMinSom,
              source: 'Daromad yozuvlari',
            }),
          });
        }
      };
      check(incUnits, 'unit', 'hudud');
      check(incServices, 'svc', 'xizmat');
      if (s.byCounterparty) check(incClients, 'client', 'mijoz');
      push(found);
    }

    // ── 3) Zarar (hududlar) ──
    if (s.enabled.loss) {
      const minT = toTiyin(s.lossMinSom);
      const found: Alert[] = [];
      for (const [key, inc] of incUnits) {
        const income = inc.values.get(period) ?? 0n;
        const expense = expUnits.get(key)?.values.get(period) ?? 0n;
        const result = income - expense;
        if (income <= 0n || result > -minT) continue;
        found.push({
          key: `loss:unit:${key}:${period}`,
          rule: 'loss',
          ruleLabel: RULE_LABELS.loss,
          severity: -result >= minT * 10n ? 'high' : 'medium',
          title: `${inc.label}: ${monthName(period)} zarar bilan yopildi`,
          detail: `Daromad ${som(income)}, xarajat ${som(expense)} — natija ${som(result)}.`,
          amountTiyin: (-result).toString(),
          period,
          item: { kind: 'RESULT', filter: { unit: key }, label: `${inc.label} — natija`, origin: 'Avtomatik ogohlantirish' },
          href: inc.href,
          calc: lossAlertCalc(`${inc.label} (${monthName(period)})`, income, expense, s.lossMinSom),
        });
      }
      push(found);
    }

    // ── 4) Tumanlar (Solishtirma › tumanlar bilan bir xil hisob) ──
    if (s.byDistrict && (s.enabled.expenseGrowth || s.enabled.incomeDrop || s.enabled.loss)) {
      const found: Alert[] = [];
      const regionCodes = regions.filter((r) => r.code !== 0).map((r) => r.code);
      for (const code of regionCodes) {
        let data;
        try {
          data = await this.districts.regionDistricts(code, { from: `${period}-01`, to: lastDay(period), compare: 'prev' });
        } catch (error) {
          this.logger.warn(`Tumanlar hisoblanmadi (${code}): ${String(error)}`);
          continue;
        }
        const hasDistrictIncome = data.districts.some((d) => !d.unassigned && BigInt(d.incomeTiyin) > 0n);
        for (const d of data.districts) {
          if (d.unassigned) continue;
          const href = `/solishtirma?r=${code}&d=${encodeURIComponent(d.id)}&dn=${encodeURIComponent(d.name)}`;
          const name = `${data.region.name}, ${d.name}`;
          const cur = BigInt(d.expenseTiyin);
          const prev = BigInt(d.previousExpenseTiyin);
          if (s.enabled.expenseGrowth && prev > 0n) {
            const diff = cur - prev;
            const growth = (Number(diff) / Number(prev)) * 100;
            if (diff >= toTiyin(s.expenseGrowthMinSom) && growth >= s.expenseGrowthPct) {
              found.push({
                key: `expenseGrowth:district:${d.id}:${period}`,
                rule: 'expenseGrowth',
                ruleLabel: RULE_LABELS.expenseGrowth,
                severity: growth >= s.expenseGrowthPct * 2 ? 'high' : 'medium',
                title: `${name}: tuman xarajati ${pct(growth)} o'sdi`,
                detail: `${monthName(period)}: ${som(cur)} (ish haqi ${som(BigInt(d.payrollTiyin))}), ${data.compareLabel}: ${som(prev)} — +${som(diff)}.`,
                amountTiyin: diff.toString(),
                period,
                item: { kind: 'EXPENSE', filter: { districtId: d.id }, label: `${name} — xarajat`, origin: 'Avtomatik ogohlantirish' },
                href,
                calc: {
                  ...changeAlertCalc({
                    dir: 'up',
                    label: name,
                    currentLabel: `Joriy oy (${monthName(period)})`,
                    current: cur,
                    base: [{ label: data.compareLabel, value: prev }],
                    baseLabel: data.compareLabel,
                    thresholdPct: s.expenseGrowthPct,
                    thresholdSom: s.expenseGrowthMinSom,
                  }),
                  note: `Tuman xarajati = ish haqi ${full(BigInt(d.payrollTiyin ?? '0'))} + ijara ${full(BigInt(d.leaseTiyin ?? '0'))} + boshqa ${full(BigInt(d.otherTiyin ?? '0'))}. Chegaralar Sozlamalar › Ogohlantirishlar'da.`,
                },
              });
            }
          }
          if (!hasDistrictIncome) continue;
          const inc = BigInt(d.incomeTiyin);
          const pinc = BigInt(d.previousIncomeTiyin);
          if (s.enabled.incomeDrop && pinc > 0n) {
            const drop = pinc - inc;
            const fall = (Number(drop) / Number(pinc)) * 100;
            if (drop >= toTiyin(s.incomeDropMinSom) && fall >= s.incomeDropPct) {
              found.push({
                key: `incomeDrop:district:${d.id}:${period}`,
                rule: 'incomeDrop',
                ruleLabel: RULE_LABELS.incomeDrop,
                severity: fall >= s.incomeDropPct * 2 ? 'high' : 'medium',
                title: `${name}: tuman daromadi ${pct(fall)} kamaydi`,
                detail: `${monthName(period)}: ${som(inc)} (${d.quantity} ta xizmat), ${data.compareLabel}: ${som(pinc)} — −${som(drop)}.`,
                amountTiyin: drop.toString(),
                period,
                item: { kind: 'INCOME', filter: { districtId: d.id }, label: `${name} — daromad`, origin: 'Avtomatik ogohlantirish' },
                href,
                calc: changeAlertCalc({
                  dir: 'down',
                  label: name,
                  currentLabel: `Joriy oy (${monthName(period)})`,
                  current: inc,
                  base: [{ label: data.compareLabel, value: pinc }],
                  baseLabel: data.compareLabel,
                  thresholdPct: s.incomeDropPct,
                  thresholdSom: s.incomeDropMinSom,
                  source: 'Hududlar tushumi',
                }),
              });
            }
          }
          const result = BigInt(d.resultTiyin);
          if (s.enabled.loss && inc > 0n && result <= -toTiyin(s.lossMinSom)) {
            found.push({
              key: `loss:district:${d.id}:${period}`,
              rule: 'loss',
              ruleLabel: RULE_LABELS.loss,
              severity: 'medium',
              title: `${name}: tuman zarar bilan ishladi`,
              detail: `Daromad ${som(inc)}, xarajat ${som(cur)} — natija ${som(result)}.`,
              amountTiyin: (-result).toString(),
              period,
              item: { kind: 'RESULT', filter: { districtId: d.id }, label: `${name} — natija`, origin: 'Avtomatik ogohlantirish' },
              href,
              calc: lossAlertCalc(name, inc, cur, s.lossMinSom),
            });
          }
        }
      }
      push(found);
    }

    // ── 5) Reja bajarilmagan (Natijalar fayli) ──
    if (s.enabled.plan) {
      const latest = await this.prisma.employeeResult.findFirst({
        where: { period: { lte: period }, batch: { cancelledAt: null } },
        orderBy: { period: 'desc' },
        select: { period: true },
      });
      if (latest) {
        const results = await this.prisma.employeeResult.findMany({
          where: { period: latest.period, batch: { cancelledAt: null }, planTiyin: { gt: 0n } },
          select: {
            employeePinfl: true,
            planTiyin: true,
            factTiyin: true,
            regionCode: true,
            districtId: true,
            employee: { select: { fullName: true } },
            district: { select: { name: true } },
          },
        });
        const found: Alert[] = [];
        for (const r of results) {
          const done = (Number(r.factTiyin) / Number(r.planTiyin)) * 100;
          if (done >= s.planMinPct) continue;
          const place = [unitLabel(r.regionCode), r.district?.name].filter(Boolean).join(', ');
          const href = r.districtId
            ? `/solishtirma?r=${r.regionCode}&d=${encodeURIComponent(r.districtId)}&dn=${encodeURIComponent(r.district?.name ?? '')}&e=${r.employeePinfl}&en=${encodeURIComponent(r.employee.fullName)}`
            : null;
          found.push({
            key: `plan:${r.employeePinfl}:${latest.period}`,
            rule: 'plan',
            ruleLabel: RULE_LABELS.plan,
            severity: done < s.planMinPct - 20 ? 'high' : 'medium',
            title: `${r.employee.fullName}: reja ${pct(done)} bajarildi`,
            detail: `${monthName(latest.period)}, ${place}: reja ${som(r.planTiyin)}, fakt ${som(r.factTiyin)} — yetmadi ${som(r.planTiyin - r.factTiyin)}.`,
            amountTiyin: (r.planTiyin - r.factTiyin).toString(),
            period: latest.period,
            item: { kind: 'INCOME', filter: { employeePinfl: r.employeePinfl }, label: `${r.employee.fullName} — natija (fakt)`, origin: 'Avtomatik ogohlantirish' },
            href,
            calc: planAlertCalc(`${r.employee.fullName} (${monthName(latest.period)})`, r.planTiyin, r.factTiyin, s.planMinPct),
          });
        }
        push(found);
      }
    }

    // ── 6) Odatdan tashqari katta yozuv ──
    if (s.enabled.outlier) {
      const minT = toTiyin(s.outlierMinSom);
      const recent = await this.prisma.expense.findMany({
        where: { deletedAt: null, date: { gte: monthStart(period) }, amountTiyin: { gte: minT }, source: { in: ['MANUAL', 'IMPORT'] } },
        select: { id: true, date: true, amountTiyin: true, categoryCode: true, description: true, counterparty: true, documentNo: true },
      });
      if (recent.length) {
        const cats = [...new Set(recent.map((r) => r.categoryCode))];
        const history = await this.prisma.expense.findMany({
          where: { deletedAt: null, categoryCode: { in: cats }, date: { gte: monthStart(shiftMonth(period, -12)), lt: monthStart(period) } },
          select: { categoryCode: true, amountTiyin: true },
        });
        const byCat = new Map<string, number[]>();
        for (const h of history) byCat.set(h.categoryCode, [...(byCat.get(h.categoryCode) ?? []), Number(h.amountTiyin)]);
        const found: Alert[] = [];
        for (const r of recent) {
          const values = byCat.get(r.categoryCode) ?? [];
          if (values.length < 5) continue;
          const typical = median(values);
          if (typical <= 0 || Number(r.amountTiyin) < typical * s.outlierFactor) continue;
          const times = Number(r.amountTiyin) / typical;
          const date = new Date(r.date.getTime() + TASHKENT_MS).toISOString().slice(0, 10);
          const what = r.description?.trim() || r.counterparty || catLabel.get(r.categoryCode) || r.categoryCode;
          found.push({
            key: `outlier:${r.id}`,
            rule: 'outlier',
            ruleLabel: RULE_LABELS.outlier,
            severity: times >= s.outlierFactor * 2 ? 'high' : 'medium',
            title: `${catLabel.get(r.categoryCode) ?? r.categoryCode}: odatdagidan ${times.toFixed(1).replace('.', ',')} barobar katta yozuv`,
            detail: `${date.split('-').reverse().join('.')} — ${what}${r.documentNo ? ` (hujjat ${r.documentNo})` : ''}: ${som(r.amountTiyin)}; bu moddadagi odatiy yozuv (12 oy medianasi) ${som(typical)}.`,
            amountTiyin: r.amountTiyin.toString(),
            period: monthOf(r.date),
            item: { kind: 'EXPENSE', filter: { recordId: r.id }, label: `${what} — ${som(r.amountTiyin)}`, origin: 'Avtomatik ogohlantirish' },
            href: `/xarajatlar/doimiy?q=${encodeURIComponent(r.counterparty ?? r.description ?? '')}`,
            calc: outlierAlertCalc(what, r.amountTiyin, values, typical, s.outlierFactor, s.outlierMinSom),
          });
        }
        push(found);
      }
    }

    // ── 7) Muddati o'tgan qarz ──
    if (s.enabled.debt) {
      const minT = toTiyin(s.debtMinSom);
      const before = new Date(Date.now() - s.debtDays * DAY_MS);
      const nowMonth = today.slice(0, 7);
      const [unpaidIncomes, unpaidExpenses] = await Promise.all([
        this.prisma.income.findMany({
          where: { deletedAt: null, paymentStatus: { in: ['UNPAID', 'PARTIAL'] }, date: { lt: before } },
          select: { amountTiyin: true, paidTiyin: true, paymentStatus: true, clientName: true, date: true },
        }),
        this.prisma.expense.findMany({
          where: { deletedAt: null, paymentStatus: { in: ['UNPAID', 'PARTIAL'] }, dueDate: { lt: new Date() } },
          select: { amountTiyin: true, counterparty: true, dueDate: true },
        }),
      ]);
      const found: Alert[] = [];
      const clients = new Map<string, { sum: bigint; count: number; oldest: Date; items: { label: string; value: bigint }[] }>();
      const dateText = (d: Date) => new Date(d.getTime() + TASHKENT_MS).toISOString().slice(0, 10).split('-').reverse().join('.');
      for (const i of unpaidIncomes) {
        const owed = i.paymentStatus === 'UNPAID' ? i.amountTiyin : i.amountTiyin - i.paidTiyin;
        if (owed <= 0n) continue;
        const name = i.clientName?.trim() || "Mijoz ko'rsatilmagan";
        const c = clients.get(name) ?? { sum: 0n, count: 0, oldest: i.date, items: [] };
        c.sum += owed;
        c.count += 1;
        c.items.push({ label: `${dateText(i.date)}${i.paymentStatus === 'PARTIAL' ? ` (qisman: ${full(i.amountTiyin)} − ${full(i.paidTiyin)})` : ''}`, value: owed });
        if (i.date < c.oldest) c.oldest = i.date;
        clients.set(name, c);
      }
      for (const [name, c] of clients) {
        if (c.sum < minT) continue;
        const days = Math.floor((Date.now() - c.oldest.getTime()) / DAY_MS);
        found.push({
          key: `debt:client:${name}:${nowMonth}`,
          rule: 'debt',
          ruleLabel: RULE_LABELS.debt,
          severity: days >= s.debtDays * 3 ? 'high' : 'medium',
          title: `${name}: ${som(c.sum)} to'lanmagan (debitorlik)`,
          detail: `${c.count} ta yozuv, eng eskisi ${days} kun oldin; chegara — ${s.debtDays} kun.`,
          amountTiyin: c.sum.toString(),
          period: null,
          item: name === "Mijoz ko'rsatilmagan" ? null : { kind: 'INCOME', filter: { clientName: name }, label: `${name} (mijoz)`, origin: 'Avtomatik ogohlantirish' },
          href: '/daromadlar/doimiy',
          calc: debtAlertCalc(name, c.items, s.debtMinSom, `eng eski yozuv ${days} kun oldin ≥ ${s.debtDays} kun`),
        });
      }
      const parties = new Map<string, { sum: bigint; count: number; items: { label: string; value: bigint }[] }>();
      for (const e of unpaidExpenses) {
        const name = e.counterparty?.trim() || "Kontragent ko'rsatilmagan";
        const p = parties.get(name) ?? { sum: 0n, count: 0, items: [] };
        p.sum += e.amountTiyin;
        p.count += 1;
        p.items.push({ label: e.dueDate ? `muddat ${dateText(e.dueDate)}` : 'muddatsiz', value: e.amountTiyin });
        parties.set(name, p);
      }
      for (const [name, p] of parties) {
        if (p.sum < minT) continue;
        found.push({
          key: `debt:party:${name}:${nowMonth}`,
          rule: 'debt',
          ruleLabel: RULE_LABELS.debt,
          severity: 'medium',
          title: `${name}: to'lov muddati o'tgan — ${som(p.sum)} (kreditorlik)`,
          detail: `${p.count} ta xarajat yozuvining to'lov muddati o'tgan, hali to'lanmagan.`,
          amountTiyin: p.sum.toString(),
          period: null,
          item: name === "Kontragent ko'rsatilmagan" ? null : { kind: 'EXPENSE', filter: { counterparty: name }, label: `${name} (kontragent)`, origin: 'Avtomatik ogohlantirish' },
          href: '/xarajatlar/doimiy',
          calc: debtAlertCalc(name, p.items, s.debtMinSom, "to'lov muddati o'tgan"),
        });
      }
      push(found);
    }

    // ── 8) Nazorat chegarasi ──
    if (s.enabled.control) {
      try {
        const rules = await this.controls.list();
        const found: Alert[] = [];
        for (const r of rules) {
          if (!r.isActive || (r.status !== 'breach' && r.status !== 'risk')) continue;
          found.push({
            key: `control:${r.id}:${r.current?.period ?? today.slice(0, 7)}:${r.status}`,
            rule: 'control',
            ruleLabel: RULE_LABELS.control,
            severity: r.status === 'breach' ? 'high' : 'medium',
            title: `${r.title}: ${r.status === 'breach' ? 'chegara buzilgan' : 'chegaraga yaqin'}`,
            detail: `${r.statusText}${r.usagePercent !== null ? ` · foydalanish ${pct(r.usagePercent)}` : ''} · chegara ${som(BigInt(r.limitTiyin))}/oy.`,
            amountTiyin: r.current ? (r.current.projectedTiyin ?? r.current.valueTiyin) : r.limitTiyin,
            period: r.current?.period ?? null,
            item: null,
            href: '/nazorat',
            calc: controlAlertCalc(
              r.title,
              r.statusText,
              r.current ? BigInt(r.current.projectedTiyin ?? r.current.valueTiyin) : null,
              BigInt(r.limitTiyin),
              r.usagePercent,
            ),
          });
        }
        push(found);
      } catch (error) {
        this.logger.warn(`Nazorat holati olinmadi: ${String(error)}`);
      }
    }

    // Avval jiddiylari, keyin summasi kattalari
    alerts.sort((a, b) => (a.severity !== b.severity ? (a.severity === 'high' ? -1 : 1) : BigInt(b.amountTiyin) > BigInt(a.amountTiyin) ? 1 : -1));

    return {
      alerts,
      meta: { period, basePeriods, generatedAt: new Date().toISOString() },
    };
  }
}