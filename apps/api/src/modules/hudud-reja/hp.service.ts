import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ModelingService } from '../modeling/modeling.service';
import { PrismaService } from '../prisma/prisma.service';
import { currentPeriodTashkent, monthsBetween, PERIOD_RE, periodAdd, RELIABILITY_LABEL, SOURCE_LABEL, type Source } from './hp.const';
import { HpDataService } from './hp.data';

// ═══════════════════════════════════════════════════════════
// Hudud uchun reja — hisoblash sessiyalari, natijalar, tuzatishlar, tasdiqlash va versiyalar.
//
//  • Hisoblash Python xizmatida (apps/analytics, /plan/compute); NestJS faqat ma'lumotni yig'adi va natijani saqlaydi.
//  • Bir xil parametr va bir xil ma'lumot (xesh) bilan qayta so'rov — yangi hisob yaratmaydi, mavjudini qaytaradi.
//  • Holatlar: Hisoblanmoqda → Hisoblangan → (tasdiqlansa) har hudud uchun «Tasdiqlangan» versiya.
//  • Tasdiqlangan versiya o'chirilmaydi: yangisi tasdiqlanganda eskisi «almashtirilgan» bo'ladi, qayta tiklash mumkin.
// ═══════════════════════════════════════════════════════════

export interface RunParams {
  targetPeriod: string;
  historyFrom: string;
  historyTo: string;
  regions: number[] | null;
  source: Source;
  backtestMonths: number;
  selection: string;
  roundQuantity: boolean;
  allocation: { method: 'share' | 'perday'; window: number; newEmployees: boolean };
}

interface Assign {
  region: number;
  service: string;
  pinfl: string;
  amount: number;
  by: string;
  at: string;
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const MODEL_KEYS = ['auto', 'naive', 'ma3', 'snaive', 'ses', 'holt', 'hw', 'croston', 'sba'];
const STALE_MS = 15 * 60_000;

@Injectable()
export class HpService {
  private readonly logger = new Logger(HpService.name);
  /** Shu jarayonda bajarilayotgan hisoblar (parallel ikki marta boshlanmasin) */
  private readonly running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly data: HpDataService,
    private readonly modeling: ModelingService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────── Parametrlar ─────────────────────────

  parseParams(body: Json): RunParams {
    const target = String(body?.targetPeriod ?? '');
    if (!PERIOD_RE.test(target)) throw new BadRequestException("Prognoz oyi noto'g'ri (YYYY-MM)");
    const historyTo = periodAdd(target, -1);
    const historyFrom = PERIOD_RE.test(String(body?.historyFrom ?? '')) ? String(body.historyFrom) : periodAdd(target, -36);
    if (historyFrom > historyTo) throw new BadRequestException('Tarixiy davr boshlanishi prognoz oyidan oldin bo‘lishi kerak');
    if (monthsBetween(historyFrom, historyTo).length < 3) throw new BadRequestException('Tarixiy davr kamida 3 oy bo‘lsin');
    if (monthsBetween(historyFrom, historyTo).length > 84) throw new BadRequestException('Tarixiy davr 7 yildan oshmasin');
    if (target > periodAdd(currentPeriodTashkent(), 1)) throw new BadRequestException('Prognoz faqat kelasi oy uchun (yoki o‘tgan oylar — tekshiruv uchun)');
    const regions = Array.isArray(body?.regions) && body.regions.length ? [...new Set((body.regions as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b) : null;
    const source: Source = body?.source === 'system' || body?.source === 'import' ? body.source : 'merged';
    const backtestMonths = Math.max(3, Math.min(12, Number(body?.backtestMonths) || 6));
    const selection = MODEL_KEYS.includes(String(body?.selection)) ? String(body.selection) : 'auto';
    const a = body?.allocation ?? {};
    return {
      targetPeriod: target,
      historyFrom,
      historyTo,
      regions,
      source,
      backtestMonths,
      selection,
      roundQuantity: body?.roundQuantity !== false,
      allocation: { method: a.method === 'share' ? 'share' : 'perday', window: [3, 6, 12].includes(Number(a.window)) ? Number(a.window) : 6, newEmployees: a.newEmployees !== false },
    };
  }

  /** Python uchun to'liq kirish (ma'lumotlar versiyasi shundan xeshlanadi) */
  private async buildInput(p: RunParams) {
    const ds = await this.data.dataset(p.source, p.historyFrom, p.historyTo, p.regions);
    const series = this.data.series(ds);
    if (!series.length) throw new BadRequestException("Tanlangan davr va hududlar bo'yicha ma'lumot yo'q — avval «Ma'lumotlarni yuklash» bo'limida tarixni yuklang yoki Hududlar tushumini kiriting");
    const regionCodes = [...new Set(series.map((s) => s.region))];
    const { tariffs } = await this.data.catalog();
    const alloc = await this.data.employeesData(regionCodes, ds.months, p.targetPeriod);
    return {
      targetPeriod: p.targetPeriod,
      months: ds.months,
      series,
      tariffs: tariffs.map((t) => ({ service: t.service, region: t.region, validFrom: t.validFrom, price: t.price })),
      services: ds.services.map((s) => ({ code: s.code, name: s.name })),
      regions: ds.regions.filter((r) => regionCodes.includes(r.code)),
      options: { backtestMonths: p.backtestMonths, selection: p.selection, roundQuantity: p.roundQuantity },
      allocation: { ...p.allocation, regions: alloc },
    };
  }

  // ───────────────────────── Ma'lumot tekshiruvi (hisoblashsiz) ─────────────────────────

  async precheck(body: Json) {
    const p = this.parseParams(body);
    const input = await this.buildInput(p);
    const n = input.months.length;
    const regions = input.regions.map((r) => {
      const ss = input.series.filter((s) => s.region === r.code);
      const reported = input.months.filter((_, i) => ss.some((s) => s.qty[i] !== null)).length;
      const active = ss.filter((s) => s.qty.some((v) => (v ?? 0) > 0)).length;
      const alloc = (input.allocation.regions as Json)[String(r.code)];
      return {
        code: r.code,
        name: r.name,
        monthsReported: reported,
        months: n,
        activeServices: active,
        employees: alloc?.employees?.length ?? 0,
        employeeServiceRows: alloc?.empServices?.length ?? 0,
        employeeMonthRows: alloc?.empMonths?.length ?? 0,
      };
    });
    const tariffMissing = input.services.filter((s) => !input.tariffs.some((t) => t.service === s.code)).map((s) => s.code);
    return { params: p, months: input.months, regions, tariffMissing, seriesCount: input.series.length, dataHash: HpDataService.hash({ s: input.series, t: input.tariffs, a: input.allocation }) };
  }

  // ───────────────────────── Hisoblash ─────────────────────────

  async start(body: Json, userId: string) {
    const p = this.parseParams(body);
    const input = await this.buildInput(p);
    const paramsHash = HpDataService.hash(p);
    const dataHash = HpDataService.hash({ s: input.series, t: input.tariffs, a: input.allocation });
    await this.expireStale();
    const existing = await this.prisma.hpRun.findFirst({ where: { paramsHash, dataHash, status: { in: ['RUNNING', 'DONE'] } }, orderBy: { createdAt: 'desc' } });
    if (existing) return { ...this.meta(existing), reused: true };
    const run = await this.prisma.hpRun.create({ data: { targetPeriod: p.targetPeriod, params: p as unknown as object, paramsHash, dataHash, status: 'RUNNING', createdById: userId } });
    await this.audit.log({ userId, action: 'CREATE', entity: 'hudud_reja_run', entityId: run.id, summary: `Hudud uchun reja: ${p.targetPeriod} prognozi hisoblanmoqda (${SOURCE_LABEL[p.source]})` });
    void this.execute(run.id, input);
    return { ...this.meta(run), reused: false };
  }

  /** Fon rejimida: Python hisobi → natija bazaga */
  async execute(id: string, input: unknown): Promise<void> {
    if (this.running.has(id)) return;
    this.running.add(id);
    const started = Date.now();
    try {
      const result = await this.modeling.call<Json>('/plan/compute', { method: 'POST', body: input, timeoutMs: 10 * 60_000 });
      await this.prisma.hpRun.update({ where: { id }, data: { status: 'DONE', result: result as object, summary: this.summarize(result) as object, finishedAt: new Date(), tookMs: Date.now() - started } });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Hudud reja hisobi ${id}: ${message}`);
      await this.prisma.hpRun.update({ where: { id }, data: { status: 'FAILED', error: message.slice(0, 1000), finishedAt: new Date(), tookMs: Date.now() - started } }).catch(() => null);
    } finally {
      this.running.delete(id);
    }
  }

  private async expireStale() {
    await this.prisma.hpRun.updateMany({
      where: { status: 'RUNNING', createdAt: { lt: new Date(Date.now() - STALE_MS) } },
      data: { status: 'FAILED', error: 'Hisoblash uzilib qoldi (server qayta ishga tushgan bo‘lishi mumkin) — qayta boshlang', finishedAt: new Date() },
    });
  }

  private summarize(r: Json) {
    const regions = (r.regions as Json[]).map((g) => ({
      code: g.region,
      name: g.regionName,
      forecastRev: g.forecastRev,
      lastRev: g.lastRev,
      prevRev: g.prevRev,
      wape: g.accuracy?.wape ?? null,
      accuracyPoints: g.accuracy?.points ?? 0,
      services: (g.services as Json[]).length,
      servicesForecast: g.servicesForecast,
      servicesNoData: (g.servicesNoData as string[]).length,
      employees: g.employees?.employees?.length ?? 0,
      employeesTotal: g.employees?.check?.employeesTotal ?? null,
      unallocated: g.employees?.unallocatedTotal ?? null,
      reliability: countBy((g.services as Json[]).filter((s) => (s.observations ?? 0) > 0).map((s) => s.reliability as string)),
    }));
    const models = countBy((r.regions as Json[]).flatMap((g) => (g.services as Json[]).map((s) => s.model ?? 'none')));
    return {
      targetPeriod: r.targetPeriod,
      months: r.months,
      total: { forecastRev: r.total.forecastRev, lastRev: r.total.lastRev, wape: r.total.accuracy?.wape ?? null, points: r.total.accuracy?.points ?? 0 },
      regions,
      models,
      employees: regions.reduce((a, g) => a + g.employees, 0),
      tookMs: r.tookMs,
    };
  }

  // ───────────────────────── O'qish ─────────────────────────

  private meta(r: { id: string; targetPeriod: string; params: unknown; status: string; error: string | null; createdAt: Date; finishedAt: Date | null; tookMs: number | null; createdById: string; dataHash: string; summary?: unknown }) {
    return { id: r.id, targetPeriod: r.targetPeriod, params: r.params as RunParams, status: r.status, error: r.error, createdAt: r.createdAt, finishedAt: r.finishedAt, tookMs: r.tookMs, createdById: r.createdById, dataVersion: r.dataHash.slice(0, 12), summary: r.summary ?? null };
  }

  async list(target?: string) {
    await this.expireStale();
    const rows = await this.prisma.hpRun.findMany({
      where: target && PERIOD_RE.test(target) ? { targetPeriod: target } : {},
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, targetPeriod: true, params: true, status: true, error: true, createdAt: true, finishedAt: true, tookMs: true, createdById: true, dataHash: true, summary: true },
    });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, fullName: true } });
    const name = new Map(users.map((u) => [u.id, u.fullName]));
    const approved = await this.prisma.hpPlanVersion.findMany({ where: { status: 'APPROVED', runId: { in: rows.map((r) => r.id) } }, select: { runId: true, regionCode: true } });
    return rows.map((r) => ({ ...this.meta(r), createdBy: name.get(r.createdById) ?? null, approvedRegions: approved.filter((a) => a.runId === r.id).map((a) => a.regionCode) }));
  }

  private async load(id: string) {
    await this.expireStale();
    const run = await this.prisma.hpRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Hisob topilmadi');
    return run;
  }

  private async loadDone(id: string) {
    const run = await this.load(id);
    if (run.status !== 'DONE' || !run.result) throw new BadRequestException(run.status === 'RUNNING' ? 'Hisob hali tugamagan' : `Hisob muvaffaqiyatsiz: ${run.error ?? ''}`);
    return { run, result: this.withEdits(run.result as Json, (run.edits as Json)?.assign ?? []) };
  }

  async get(id: string) {
    const run = await this.load(id);
    const user = await this.prisma.user.findUnique({ where: { id: run.createdById }, select: { fullName: true } });
    return { ...this.meta(run), createdBy: user?.fullName ?? null, edits: (run.edits as Json)?.assign ?? [], status: run.status };
  }

  /** Qo'lda biriktirishlarni natijaga qo'llash (yig'indilar saqlanadi: taqsimlanmagandan xodimga o'tadi) */
  private withEdits(result: Json, assigns: Assign[]): Json {
    if (!assigns.length) return result;
    const r = structuredClone(result) as Json;
    for (const a of assigns) {
      const g = (r.regions as Json[]).find((x) => x.region === a.region);
      const emp = g?.employees;
      if (!emp) continue;
      const u = (emp.unallocated as Json[]).find((x) => x.service === a.service);
      if (!u || u.amount < a.amount) continue;
      u.amount -= a.amount;
      emp.unallocatedTotal -= a.amount;
      const e = (emp.employees as Json[]).find((x) => x.pinfl === a.pinfl);
      if (!e) continue;
      e.plan += a.amount;
      const svc = (e.services as Json[]).find((x) => x.service === a.service);
      if (svc) {
        svc.plan += a.amount;
        svc.manual = (svc.manual ?? 0) + a.amount;
      } else e.services.push({ service: a.service, serviceName: u.serviceName, hist: 0, share: 0, plan: a.amount, manual: a.amount });
      e.manual = true;
      emp.unallocated = (emp.unallocated as Json[]).filter((x) => x.amount > 0);
      emp.check = { ...emp.check, employeesTotal: emp.check.employeesTotal + a.amount, unallocated: emp.unallocatedTotal, diff: emp.check.regionForecast - (emp.check.employeesTotal + a.amount) - emp.unallocatedTotal };
      for (const x of emp.employees as Json[]) x.share = emp.check.regionForecast ? x.plan / emp.check.regionForecast : null;
    }
    return r;
  }

  private async versionsFor(target: string) {
    return this.prisma.hpPlanVersion.findMany({ where: { targetPeriod: target }, orderBy: [{ regionCode: 'asc' }, { version: 'desc' }], select: { id: true, regionCode: true, version: true, runId: true, status: true, forecastTiyin: true, approvedAt: true, approvedById: true, note: true, restoredFrom: true } });
  }

  private planStatus(versions: Awaited<ReturnType<HpService['versionsFor']>>, runId: string, region: number) {
    const cur = versions.find((v) => v.regionCode === region && v.status === 'APPROVED');
    if (!cur) return { status: 'CALCULATED', label: 'Hisoblangan', version: null as number | null };
    if (cur.runId === runId) return { status: 'APPROVED', label: `Tasdiqlangan (v${cur.version})`, version: cur.version };
    return { status: 'APPROVED_OTHER', label: `Boshqa hisob tasdiqlangan (v${cur.version})`, version: cur.version };
  }

  /** Hududlar jadvali */
  async regions(id: string) {
    const { run, result } = await this.loadDone(id);
    const p = run.params as unknown as RunParams;
    const versions = await this.versionsFor(run.targetPeriod);
    // Joriy (prognoz) oyining mavjud haqiqiy ma'lumoti — bo'lsa
    const cur = await this.data.dataset(p.source, run.targetPeriod, run.targetPeriod, p.regions);
    const curRev = new Map<number, number>();
    for (const [k, c] of cur.cells) {
      const r = Number(k.split('|')[1]);
      curRev.set(r, (curRev.get(r) ?? 0) + c.rev);
    }
    return (result.regions as Json[]).map((g) => {
      const svc = g.services as Json[];
      const months = (result.months as string[]).length;
      const reported = (g.history.rev as (number | null)[]).filter((v) => v !== null).length;
      const chosen = countBy(svc.filter((s) => s.model).map((s) => s.model as string));
      const top = Object.entries(chosen).sort((a, b) => b[1] - a[1])[0];
      const quality = qualityOf(reported, months, svc);
      const diff = g.lastRev !== null ? g.forecastRev - g.lastRev : null;
      return {
        code: g.region,
        name: g.regionName,
        lastRev: g.lastRev,
        currentRev: curRev.get(g.region) ?? null,
        forecastRev: g.forecastRev,
        diff,
        changePct: diff !== null && g.lastRev ? (diff / g.lastRev) * 100 : null,
        models: chosen,
        mainModel: top ? { key: top[0], label: result.modelLabels[top[0]], count: top[1] } : null,
        wape: g.accuracy?.wape ?? null,
        accuracyPoints: g.accuracy?.points ?? 0,
        quality,
        monthsReported: reported,
        months,
        servicesForecast: g.servicesForecast,
        servicesNoData: g.servicesNoData,
        employeesTotal: g.employees?.check?.employeesTotal ?? null,
        unallocated: g.employees?.unallocatedTotal ?? null,
        plan: this.planStatus(versions, run.id, g.region),
      };
    });
  }

  /** Xizmatlar jadvali: bitta hudud yoki hamma hududlar yig'indisi */
  async services(id: string, regionRaw?: string) {
    const { result } = await this.loadDone(id);
    const region = regionRaw ? Number(regionRaw) : null;
    const regs = (result.regions as Json[]).filter((g) => region === null || g.region === region);
    if (region !== null && !regs.length) throw new NotFoundException('Bu hisobda hudud yo‘q');
    const rows = new Map<string, Json>();
    for (const g of regs) {
      for (const s of g.services as Json[]) {
        if (region !== null) {
          rows.set(s.service, { ...s, history: undefined, models: s.models, region: g.region });
          continue;
        }
        const cur = rows.get(s.service) ?? { service: s.service, serviceName: s.serviceName, lastQty: null, lastRev: null, forecastQtyFinal: null, forecastRev: null, tariffs: new Set<number>(), regions: 0, models: {}, reliability: {}, wapeNum: 0, wapeDen: 0 };
        const add = (k: string, v: number | null) => (v === null || v === undefined ? null : (cur[k] ?? 0) + v);
        cur.lastQty = add('lastQty', s.lastQty);
        cur.lastRev = add('lastRev', s.lastRev);
        cur.forecastQtyFinal = add('forecastQtyFinal', s.forecastQtyFinal);
        cur.forecastRev = add('forecastRev', s.forecastRev);
        if (s.tariff) cur.tariffs.add(Math.round(s.tariff));
        cur.regions += (s.observations ?? 0) > 0 ? 1 : 0;
        if (s.model) cur.models[s.model] = (cur.models[s.model] ?? 0) + 1;
        cur.reliability[s.reliability] = (cur.reliability[s.reliability] ?? 0) + 1;
        rows.set(s.service, cur);
      }
    }
    // Hamma hududlar: xizmat bo'yicha daromad xatosi — hududlardagi tanlangan modellar test natijasi (daromad) og'irligi bilan
    if (region === null) {
      for (const g of regs)
        for (const s of g.services as Json[]) {
          const m = (s.models as Json[] | undefined)?.find((x) => x.model === s.model);
          if (m?.revWape !== null && m?.revWape !== undefined && s.lastRev) {
            const cur = rows.get(s.service)!;
            cur.wapeNum += m.revWape * s.lastRev;
            cur.wapeDen += s.lastRev;
          }
        }
    }
    return {
      region,
      rows: [...rows.values()].map((r) =>
        region !== null
          ? {
              service: r.service,
              serviceName: r.serviceName,
              lastQty: r.lastQty,
              forecastQty: r.forecastQty,
              forecastQtyFinal: r.forecastQtyFinal,
              tariff: r.tariff,
              tariffSource: r.tariffSource,
              lastRev: r.lastRev,
              forecastRev: r.forecastRev,
              diff: r.forecastRev !== null && r.lastRev !== null ? r.forecastRev - r.lastRev : null,
              model: r.model,
              modelLabel: r.modelLabel,
              wape: r.wape,
              revWape: (r.models as Json[] | undefined)?.find((x) => x.model === r.model)?.revWape ?? null,
              reliability: r.reliability,
              reliabilityLabel: RELIABILITY_LABEL[r.reliability] ?? r.reliability,
              observations: r.observations,
              intermittent: r.intermittent,
              quality: r.observations === 0 ? 'Ma’lumot yo‘q' : r.observations < 6 ? 'Yetarli emas' : r.gaps ? 'Uzilishlar bor' : 'Yaxshi',
              interval: r.revInterval,
              reason: r.reason,
              notes: r.notes,
              formulaGap: r.formulaGap,
              outliers: r.outliers,
            }
          : {
              service: r.service,
              serviceName: r.serviceName,
              lastQty: r.lastQty,
              forecastQtyFinal: r.forecastQtyFinal,
              tariff: r.tariffs.size === 1 ? [...r.tariffs][0] : null,
              tariffNote: r.tariffs.size > 1 ? 'Hududlarda har xil' : null,
              lastRev: r.lastRev,
              forecastRev: r.forecastRev,
              diff: r.forecastRev !== null && r.lastRev !== null ? r.forecastRev - r.lastRev : null,
              regions: r.regions,
              models: r.models,
              reliability: r.reliability,
              revWape: r.wapeDen ? r.wapeNum / r.wapeDen : null,
            },
      ),
      modelLabels: result.modelLabels,
    };
  }

  /** Bitta hudud × xizmat: tarix, modellar taqqoslanishi, sabab */
  async series(id: string, regionRaw: string, service: string) {
    const { result } = await this.loadDone(id);
    const g = (result.regions as Json[]).find((x) => x.region === Number(regionRaw));
    const s = (g?.services as Json[] | undefined)?.find((x) => x.service === service);
    if (!g || !s) throw new NotFoundException('Qator topilmadi');
    return { region: g.region, regionName: g.regionName, months: result.months, targetPeriod: result.targetPeriod, ...s };
  }

  /** Xodimlar jadvali (hudud bo'yicha yoki hammasi) */
  async employees(id: string, regionRaw?: string) {
    const { run, result } = await this.loadDone(id);
    const region = regionRaw ? Number(regionRaw) : null;
    const versions = await this.versionsFor(run.targetPeriod);
    const out = [];
    const regionsOut = [];
    for (const g of result.regions as Json[]) {
      if (region !== null && g.region !== region) continue;
      const emp = g.employees;
      if (!emp) continue;
      const plan = this.planStatus(versions, run.id, g.region);
      regionsOut.push({ code: g.region, name: g.regionName, forecastRev: g.forecastRev, method: emp.method, methodUsed: emp.methodUsed, mode: emp.mode, window: emp.window, check: emp.check, unallocated: emp.unallocated, notes: emp.notes, plan });
      for (const e of emp.employees as Json[])
        out.push({
          ...e,
          region: g.region,
          regionName: g.regionName,
          change: e.plan && e.prevPlan ? ((e.plan - e.prevPlan) / e.prevPlan) * 100 : e.plan && e.lastRev ? ((e.plan - e.lastRev) / e.lastRev) * 100 : null,
          changeBase: e.prevPlan ? 'prevPlan' : e.lastRev ? 'lastRev' : null,
          planStatus: plan,
        });
    }
    return { region, regions: regionsOut, employees: out };
  }

  // ───────────────────────── Tuzatish, tasdiqlash, versiyalar ─────────────────────────

  async assign(id: string, body: Json, userId: string) {
    const { run, result } = await this.loadDone(id);
    const region = Number(body?.region);
    const service = String(body?.service ?? '');
    const pinfl = String(body?.pinfl ?? '');
    const g = (result.regions as Json[]).find((x) => x.region === region);
    const u = (g?.employees?.unallocated as Json[] | undefined)?.find((x) => x.service === service);
    if (!g || !u) throw new BadRequestException('Bu xizmat bo‘yicha taqsimlanmagan summa yo‘q');
    if (!(g.employees.employees as Json[]).some((e) => e.pinfl === pinfl)) throw new BadRequestException('Xodim shu hudud rejasida yo‘q');
    const amount = body?.amount === undefined || body?.amount === null ? u.amount : Math.round(Number(body.amount));
    if (!Number.isFinite(amount) || amount <= 0 || amount > u.amount) throw new BadRequestException(`Summa 1 dan ${u.amount} gacha bo‘lishi kerak`);
    const edits = (run.edits as Json) ?? {};
    const assign: Assign[] = [...(edits.assign ?? []), { region, service, pinfl, amount, by: userId, at: new Date().toISOString() }];
    await this.prisma.hpRun.update({ where: { id }, data: { edits: { ...edits, assign } as object } });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'hudud_reja_run', entityId: id, summary: `Taqsimlanmagan reja biriktirildi: hudud ${region}, ${service}, ${amount} so'm → ${pinfl}` });
    return this.employees(id, String(region));
  }

  async unassign(id: string, index: number, userId: string) {
    const run = await this.load(id);
    const edits = (run.edits as Json) ?? {};
    const list: Assign[] = edits.assign ?? [];
    if (!Number.isInteger(index) || index < 0 || index >= list.length) throw new BadRequestException('Tuzatish topilmadi');
    const [removed] = list.splice(index, 1);
    await this.prisma.hpRun.update({ where: { id }, data: { edits: { ...edits, assign: list } as object } });
    await this.audit.log({ userId, action: 'DELETE', entity: 'hudud_reja_run', entityId: id, summary: `Qo'lda biriktirish bekor qilindi: ${removed!.service} → ${removed!.pinfl}` });
    return { ok: true };
  }

  async approve(id: string, body: Json, userId: string) {
    const { run, result } = await this.loadDone(id);
    const want = Array.isArray(body?.regions) && body.regions.length ? (body.regions as unknown[]).map(Number) : null;
    const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : null;
    const regs = (result.regions as Json[]).filter((g) => !want || want.includes(g.region));
    if (!regs.length) throw new BadRequestException('Tasdiqlanadigan hudud tanlanmagan');
    for (const g of regs) {
      const c = g.employees?.check;
      if (c && c.diff !== 0) throw new BadRequestException(`${g.regionName}: xodimlar rejasi yig'indisi hudud prognoziga teng emas (farq ${c.diff}) — tasdiqlab bo'lmaydi`);
    }
    const created: Json[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const g of regs) {
        const last = await tx.hpPlanVersion.findFirst({ where: { targetPeriod: run.targetPeriod, regionCode: g.region }, orderBy: { version: 'desc' } });
        await tx.hpPlanVersion.updateMany({ where: { targetPeriod: run.targetPeriod, regionCode: g.region, status: 'APPROVED' }, data: { status: 'SUPERSEDED' } });
        const snapshot = snapshotOf(run.id, run.params, result, g);
        const v = await tx.hpPlanVersion.create({
          data: {
            targetPeriod: run.targetPeriod,
            regionCode: g.region,
            version: (last?.version ?? 0) + 1,
            runId: run.id,
            status: 'APPROVED',
            forecastTiyin: BigInt(Math.round(g.forecastRev * 100)),
            employeesTiyin: BigInt(Math.round((g.employees?.check?.employeesTotal ?? 0) * 100)),
            unallocatedTiyin: BigInt(Math.round((g.employees?.unallocatedTotal ?? 0) * 100)),
            data: snapshot as object,
            note,
            approvedById: userId,
          },
        });
        created.push({ region: g.region, version: v.version });
      }
    });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'hudud_reja_plan', entityId: run.id, summary: `Hudud uchun reja ${run.targetPeriod} tasdiqlandi: ${created.map((c) => `${c.region} (v${c.version})`).join(', ')}${note ? ` — ${note}` : ''}` });
    return { approved: created };
  }

  async versions(target: string) {
    if (!PERIOD_RE.test(target ?? '')) throw new BadRequestException("Oy noto'g'ri");
    const rows = await this.prisma.hpPlanVersion.findMany({ where: { targetPeriod: target }, orderBy: [{ regionCode: 'asc' }, { version: 'desc' }] });
    const [regions, users] = await Promise.all([
      this.prisma.region.findMany({ select: { code: true, name: true } }),
      this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.approvedById))] } }, select: { id: true, fullName: true } }),
    ]);
    const rn = new Map(regions.map((r) => [r.code, r.name]));
    const un = new Map(users.map((u) => [u.id, u.fullName]));
    return rows.map((r) => ({
      id: r.id,
      regionCode: r.regionCode,
      regionName: rn.get(r.regionCode) ?? String(r.regionCode),
      version: r.version,
      runId: r.runId,
      status: r.status,
      forecast: Number(r.forecastTiyin) / 100,
      employees: Number(r.employeesTiyin) / 100,
      unallocated: Number(r.unallocatedTiyin) / 100,
      note: r.note,
      restoredFrom: r.restoredFrom ?? null,
      approvedBy: un.get(r.approvedById) ?? null,
      approvedAt: r.approvedAt,
    }));
  }

  async version(id: string) {
    const v = await this.prisma.hpPlanVersion.findUnique({ where: { id } });
    if (!v) throw new NotFoundException('Versiya topilmadi');
    return { ...v, forecastTiyin: v.forecastTiyin.toString(), employeesTiyin: v.employeesTiyin.toString(), unallocatedTiyin: v.unallocatedTiyin.toString() };
  }

  async restore(id: string, body: Json, userId: string) {
    const v = await this.prisma.hpPlanVersion.findUnique({ where: { id } });
    if (!v) throw new NotFoundException('Versiya topilmadi');
    if (v.status === 'APPROVED') throw new BadRequestException('Bu versiya allaqachon amalda');
    const note = typeof body?.note === 'string' ? body.note.slice(0, 500) : null;
    const created = await this.prisma.$transaction(async (tx) => {
      const last = await tx.hpPlanVersion.findFirst({ where: { targetPeriod: v.targetPeriod, regionCode: v.regionCode }, orderBy: { version: 'desc' } });
      await tx.hpPlanVersion.updateMany({ where: { targetPeriod: v.targetPeriod, regionCode: v.regionCode, status: 'APPROVED' }, data: { status: 'SUPERSEDED' } });
      return tx.hpPlanVersion.create({
        data: { targetPeriod: v.targetPeriod, regionCode: v.regionCode, version: (last?.version ?? 0) + 1, runId: v.runId, status: 'APPROVED', forecastTiyin: v.forecastTiyin, employeesTiyin: v.employeesTiyin, unallocatedTiyin: v.unallocatedTiyin, data: v.data as object, note: note ?? `v${v.version} tiklandi`, restoredFrom: v.id, approvedById: userId },
      });
    });
    await this.audit.log({ userId, action: 'RESTORE', entity: 'hudud_reja_plan', entityId: created.id, summary: `Hudud uchun reja ${v.targetPeriod}, hudud ${v.regionCode}: v${v.version} tiklandi → v${created.version}` });
    return { version: created.version };
  }

  // ───────────────────────── Dashboard va sifat ─────────────────────────

  async overview(q: Json) {
    const target = PERIOD_RE.test(String(q?.target ?? '')) ? String(q.target) : periodAdd(currentPeriodTashkent(), 1);
    const source: Source = q?.source === 'system' || q?.source === 'import' ? q.source : 'merged';
    const region = q?.region ? Number(q.region) : null;
    await this.expireStale();
    let run = q?.runId ? await this.prisma.hpRun.findUnique({ where: { id: String(q.runId) } }) : null;
    if (!run) run = await this.prisma.hpRun.findFirst({ where: { targetPeriod: target, status: 'DONE' }, orderBy: { createdAt: 'desc' } });
    const hist = monthsBetween(periodAdd(target, -24), periodAdd(target, -1));
    const ds = await this.data.dataset(source, hist[0]!, hist[hist.length - 1]!, region ? [region] : null);
    const byMonth = hist.map((m) => {
      let rev = 0;
      let qty = 0;
      let any = false;
      for (const r of ds.regions)
        for (const s of ds.services) {
          const c = ds.cells.get(`${m}|${r.code}|${s.code}`);
          if (c) {
            rev += c.rev;
            qty += c.qty;
            any = true;
          }
        }
      return { period: m, rev: any ? rev : null, qty: any ? qty : null };
    });
    const regionsWithData = ds.regions.filter((r) => hist.some((m) => ds.reported.has(`${m}|${r.code}`)));
    const window = hist.slice(-12);
    const expected = regionsWithData.length * window.length;
    const have = regionsWithData.reduce((a, r) => a + window.filter((m) => ds.reported.has(`${m}|${r.code}`)).length, 0);
    const lastMonth = periodAdd(target, -1);
    const lastActual = byMonth.find((b) => b.period === lastMonth)?.rev ?? null;

    let fc: Json | null = null;
    if (run?.status === 'DONE' && run.result) {
      const res = this.withEdits(run.result as Json, (run.edits as Json)?.assign ?? []);
      const regs = (res.regions as Json[]).filter((g) => region === null || g.region === region);
      const total = regs.reduce((a, g) => a + g.forecastRev, 0);
      const acc = region === null ? res.total.accuracy : regs[0]?.accuracy;
      const services = new Map<string, Json>();
      for (const g of regs)
        for (const s of g.services as Json[]) {
          const c = services.get(s.service) ?? { service: s.service, name: s.serviceName, forecastRev: 0, lastRev: 0, insufficient: true };
          c.forecastRev += s.forecastRev ?? 0;
          c.lastRev += s.lastRev ?? 0;
          if ((s.observations ?? 0) > 0 && s.forecastRev !== null) c.insufficient = false;
          services.set(s.service, c);
        }
      const employees = regs.flatMap((g) => ((g.employees?.employees as Json[]) ?? []).map((e) => ({ pinfl: e.pinfl, name: e.name, region: g.regionName, plan: e.plan })));
      const versions = await this.versionsFor(run.targetPeriod);
      fc = {
        runId: run.id,
        createdAt: run.createdAt,
        params: run.params,
        dataVersion: run.dataHash.slice(0, 12),
        total,
        accuracy: acc ? { wape: acc.wape, points: acc.points, months: acc.months, actual: acc.actual, forecast: acc.forecast } : null,
        selectionNote: 'Xato tanlangan modellar bo‘yicha; model tanlovi ham shu test oylarida qilingani uchun baho biroz optimistik bo‘lishi mumkin',
        regions: regs.map((g) => ({ code: g.region, name: g.regionName, forecastRev: g.forecastRev, lastRev: g.lastRev, insufficient: g.servicesForecast === 0, plan: this.planStatus(versions, run!.id, g.region) })),
        services: [...services.values()].sort((a, b) => b.forecastRev - a.forecastRev),
        employees: employees.sort((a, b) => b.plan - a.plan),
        employeesCount: employees.filter((e) => e.plan > 0).length,
        unallocated: regs.reduce((a, g) => a + (g.employees?.unallocatedTotal ?? 0), 0),
      };
    }
    return {
      target,
      source,
      sourceLabel: SOURCE_LABEL[source],
      region,
      lastMonth,
      lastActual,
      history: byMonth,
      completeness: expected ? { have, expected, pct: (have / expected) * 100, months: window.length, regions: regionsWithData.length } : null,
      forecast: fc,
      run: run ? { id: run.id, status: run.status, error: run.error, createdAt: run.createdAt } : null,
    };
  }

  async quality(q: Json) {
    const target = PERIOD_RE.test(String(q?.target ?? '')) ? String(q.target) : periodAdd(currentPeriodTashkent(), 1);
    const source: Source = q?.source === 'system' || q?.source === 'import' ? q.source : 'merged';
    const months = monthsBetween(periodAdd(target, -24), periodAdd(target, -1));
    const ds = await this.data.dataset(source, months[0]!, months[months.length - 1]!, null);
    const { tariffs } = await this.data.catalog();
    const items: Json[] = [];
    const push = (code: string, level: 'error' | 'warning' | 'info', title: string, list: string[], hint?: string) => list.length && items.push({ code, level, title, count: list.length, items: list.slice(0, 60), hint });

    // 1. Oylar ketma-ketligi to'liq emas
    const gaps: string[] = [];
    for (const r of ds.regions) {
      const rep = months.filter((m) => ds.reported.has(`${m}|${r.code}`));
      if (!rep.length) continue;
      const miss = months.filter((m) => m >= rep[0]! && !ds.reported.has(`${m}|${r.code}`));
      if (miss.length) gaps.push(`${r.name}: ${miss.join(', ')}`);
    }
    push('gaps', 'warning', 'Tarixiy oylar ketma-ketligi to‘liq emas (bu oylar «ma’lumot yo‘q», nol emas)', gaps);
    const noData = ds.regions.filter((r) => !months.some((m) => ds.reported.has(`${m}|${r.code}`))).map((r) => r.name);
    push('noData', 'info', 'Oxirgi 24 oyda umuman ma’lumoti yo‘q hududlar', noData, 'Bu hududlar uchun prognoz hisoblanmaydi');
    // 5. Tarif yo'q
    const noTariff = ds.services.filter((s) => !tariffs.some((t) => t.service === s.code)).map((s) => `${s.code} — ${s.name}`);
    push('tariff', 'warning', 'Katalogda tasdiqlangan tarifi yo‘q xizmatlar', noTariff, 'Daromad oxirgi oylardagi haqiqiy o‘rtacha narx bilan hisoblanadi');
    // 6. Daromad ≠ soni × tarif
    const gap: string[] = [];
    for (const r of ds.regions) {
      let rec = 0;
      let formula = 0;
      for (const m of months.slice(-12))
        for (const s of ds.services) {
          const c = ds.cells.get(`${m}|${r.code}|${s.code}`);
          const t = this.data.tariffAt(tariffs, s.code, r.code, m);
          if (c && t) {
            rec += c.rev;
            formula += c.qty * t;
          }
        }
      if (formula > 0 && Math.abs(rec - formula) / formula > 0.02) gap.push(`${r.name}: haqiqiy ${fmt(rec)}, soni × tarif ${fmt(formula)} (${(((rec - formula) / formula) * 100).toFixed(1)}%)`);
    }
    push('formula', 'warning', 'Daromad va «xizmatlar soni × tarif» o‘rtasida izohlanmagan farq (oxirgi 12 oy)', gap, 'Haqiqiy daromad formulaga almashtirilmaydi — sababini tekshiring');
    // 7. Xodimlar daromadi hududdan ko'p
    const emp = await this.prisma.hpEmpService.groupBy({ by: ['period', 'regionCode', 'serviceCode'], where: { period: { gte: months[0], lte: months[months.length - 1] } }, _sum: { revenueTiyin: true } });
    const over: string[] = [];
    for (const e of emp) {
      const c = ds.cells.get(`${e.period}|${e.regionCode}|${e.serviceCode}`);
      const v = Number(e._sum.revenueTiyin ?? 0n) / 100;
      if (c && v > c.rev * 1.01 + 1000) over.push(`${e.period} · ${ds.regions.find((r) => r.code === e.regionCode)?.name ?? e.regionCode} · ${e.serviceCode}: xodimlar ${fmt(v)} > hudud ${fmt(c.rev)}`);
    }
    push('empOver', 'warning', 'Xodimlar daromadi hududiy daromaddan ko‘p', over);
    // 8. Yuklangan va dasturdagi jami mos emas
    if (source === 'merged') {
      const sys = await this.data.dataset('system', months[0]!, months[months.length - 1]!, null);
      const imp = await this.data.dataset('import', months[0]!, months[months.length - 1]!, null);
      const sum = (d: typeof sys) => {
        const out = new Map<string, number>();
        for (const [k, c] of d.cells) {
          const [p, r] = k.split('|');
          out.set(`${p}|${r}`, (out.get(`${p}|${r}`) ?? 0) + c.rev);
        }
        return out;
      };
      const a = sum(sys);
      const b = sum(imp);
      const mism: string[] = [];
      for (const [k, v] of b) {
        const s = a.get(k);
        if (s !== undefined && Math.abs(v - s) > Math.max(1000, s * 0.01)) {
          const [p, r] = k.split('|');
          mism.push(`${p} · ${ds.regions.find((x) => x.code === Number(r))?.name ?? r}: yuklangan ${fmt(v)}, dasturdagi ${fmt(s)}`);
        }
      }
      push('mismatch', 'info', 'Yuklangan tarix va dasturdagi Hududlar tushumi jami mos emas (yuklangan ishlatiladi)', mism);
    }
    // 9. Xodim boshqa hududga biriktirilgan
    const empRows = await this.prisma.hpEmpService.findMany({ where: { period: { gte: months[0], lte: months[months.length - 1] } }, select: { employeePinfl: true, regionCode: true }, distinct: ['employeePinfl', 'regionCode'] });
    const employees = await this.prisma.employee.findMany({ where: { pinfl: { in: [...new Set(empRows.map((e) => e.employeePinfl))] } }, select: { pinfl: true, fullName: true, regionCode: true } });
    const moved = empRows
      .filter((r) => {
        const e = employees.find((x) => x.pinfl === r.employeePinfl);
        return e && e.regionCode !== r.regionCode;
      })
      .map((r) => {
        const e = employees.find((x) => x.pinfl === r.employeePinfl)!;
        return `${e.fullName}: natija ${ds.regions.find((x) => x.code === r.regionCode)?.name ?? r.regionCode} hududida, hozir ${ds.regions.find((x) => x.code === e.regionCode)?.name ?? e.regionCode}`;
      });
    push('moved', 'info', 'Xodim natijasi boshqa hududda (o‘tgan yoki noto‘g‘ri biriktirilgan bo‘lishi mumkin)', moved, 'Tarixiy yozuvlar yangi hududga ko‘chirilmaydi');
    // 11–12. Oxirgi hisobdan: tarix yetarli emas va keskin o'zgarishlar
    const run = await this.prisma.hpRun.findFirst({ where: { targetPeriod: target, status: 'DONE' }, orderBy: { createdAt: 'desc' } });
    if (run?.result) {
      const res = run.result as Json;
      const short: string[] = [];
      const jumps: string[] = [];
      for (const g of res.regions as Json[])
        for (const s of g.services as Json[]) {
          if ((s.observations ?? 0) > 0 && (s.reliability === 'none' || (s.observations ?? 0) < 6) && (s.lastQty ?? 0) > 0) short.push(`${g.regionName} · ${s.serviceName}: ${s.observations} oy`);
          for (const o of (s.outliers as Json[]) ?? []) jumps.push(`${g.regionName} · ${s.serviceName}: ${o.month} — ${o.value} (odatdagidan keskin farq)`);
        }
      push('short', 'warning', 'Prognoz uchun tarixi yetarli bo‘lmagan qatorlar (oxirgi hisob)', short);
      push('jumps', 'info', 'Keskin o‘sish yoki pasayish (avtomatik o‘chirilmaydi — tekshiring)', jumps);
    }
    return { target, source, months: [months[0], months[months.length - 1]], items };
  }

  async result(id: string) {
    return this.loadDone(id);
  }
}

// ───────────────────────── Yordamchilar ─────────────────────────

function countBy(xs: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
}

function fmt(v: number): string {
  return `${Math.round(v).toLocaleString('ru-RU').replace(/,/g, ' ')} so'm`;
}

function qualityOf(reported: number, months: number, svc: Json[]): { key: string; label: string } {
  if (reported < 6) return { key: 'low', label: 'Ma’lumot yetarli emas' };
  const weak = svc.filter((s) => (s.observations ?? 0) > 0 && s.reliability === 'none').length;
  if (reported < months || weak > svc.length / 3) return { key: 'partial', label: 'Qisman' };
  return { key: 'good', label: 'Yaxshi' };
}

function snapshotOf(runId: string, params: unknown, result: Json, g: Json) {
  return {
    runId,
    params,
    targetPeriod: result.targetPeriod,
    region: g.region,
    regionName: g.regionName,
    forecastRev: g.forecastRev,
    lastRev: g.lastRev,
    accuracy: { wape: g.accuracy?.wape ?? null, points: g.accuracy?.points ?? 0 },
    services: (g.services as Json[]).map((s) => ({ service: s.service, name: s.serviceName, qty: s.forecastQtyFinal, tariff: s.tariff, rev: s.forecastRev, model: s.model, wape: s.wape, reliability: s.reliability })),
    employees: ((g.employees?.employees as Json[]) ?? []).map((e) => ({ pinfl: e.pinfl, name: e.name, plan: e.plan, share: e.share, services: (e.services as Json[]).map((x) => ({ service: x.service, plan: x.plan, manual: x.manual ?? 0 })) })),
    unallocated: g.employees?.unallocated ?? [],
    check: g.employees?.check ?? null,
    method: g.employees?.methodUsed ?? null,
  };
}