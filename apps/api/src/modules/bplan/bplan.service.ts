import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { execute, type Execution } from './bplan.compute';
import { FACT_KEYS, FACT_LINES, GROUPS, gv, readPlanGrid, regionIndex, REGIONS, REQUIRED_SHEETS, S, UO_REG, type Facts, type Grid, type Mode } from './bplan.model';
import { buildWorkbook, CHECKS } from './bplan.workbook';
import { assertSafeXlsx } from '../../common/files/xlsx-guard';

// ═══════════════════════════════════════════════════════════
// Hisobotlar › Choraklik ijro (biznes-reja).
//  • Reja — yillik biznes-reja fayli (1–6-иловалар) yuklanadi va o'zgarishsiz saqlanadi.
//  • Belgilash — har bir hisobot qatori dasturdagi qaysi manbadan olinishi:
//    daromad moddalari, xarajat moddalari (ichki moddalari bilan), ish haqi vedomosti, xodimlar soni yoki qo'lda.
//    Hududiy daromad moddalari — 7 xizmat guruhiga.
//  • Fakt — har chorak uchun shu belgilash bo'yicha avtomatik; istalgan katakni qo'lda o'zgartirish mumkin.
//  • Natija — ekranda (shu hisob) va to'liq formulali Excel (asl reja varaqlari + ijro varaqlari).
// ═══════════════════════════════════════════════════════════

const PLAN_KEY = (y: number) => `bplan.plan.${y}`;
const MANUAL_KEY = (y: number) => `bplan.manual.${y}`;
const MAP_KEY = 'bplan.map';
const MAX_FILE = 8 * 1024 * 1024;
const MLN = 100_000_000; // tiyin → млн.сўм

export type SourceKind = 'INCOME' | 'EXPENSE' | 'PAYROLL' | 'HEADCOUNT' | 'MANUAL';
export type Area = 'center' | 'regions' | 'all';
export interface LineSource {
  kind: SourceKind;
  categories?: string[];
  area?: Area;
  departments?: string[];
}
export interface BplanMap {
  lines: Record<string, LineSource>;
  /** Hududiy daromad moddasi → xizmat guruhi (0..6) */
  incomeGroups: Record<string, number>;
  /** Guruh → «Умумий объем» qatori (1.12 … 1.16) */
  groupMap: string[];
  /** Qo'lda saqlanganmi (aks holda — avtomatik taklif) */
  saved?: boolean;
}
export interface Manual {
  lines: Record<string, (number | null)[]>;
  /** "chorak:hudud:guruh" → qiymat */
  regions: Record<string, number>;
}
interface PlanFile {
  fileName: string;
  uploadedAt: string;
  size: number;
  data: string;
}

export interface FactCell {
  auto: (number | null)[];
  manual: (number | null)[];
  final: (number | null)[];
}

type Dict = Record<string, unknown>;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function clampYear(y: unknown): number {
  const n = Number(y);
  if (!Number.isInteger(n) || n < 2020 || n > 2100) throw new BadRequestException("Yil noto'g'ri");
  return n;
}
export function quarterMonths(year: number, q: number): string[] {
  return [0, 1, 2].map((i) => `${year}-${String((q - 1) * 3 + 1 + i).padStart(2, '0')}`);
}
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’ʻʼ'`]/g, '')
    .replace(/\s+/g, ' ');

/** Hududiy daromad moddasi nomidan xizmat guruhini taxmin qilish */
export function guessGroup(label: string): number {
  const t = norm(label);
  if (/deklarats|декларац/.test(t)) return 4;
  if (/hisobot|ҳисобот|отчет|hisobotlar/.test(t)) return 3;
  if (/kompyuter|компьютер|texnik xizmat|техник хизмат|orgtexnika/.test(t)) return 0;
  if (/malumotnoma|маълумотнома|axborot|ахборот|matnni|qarzi|далолатнома|dalolatnoma|litsenziya|лицензия/.test(t)) return 1;
  if (/ijara|ижара|faktura|фактура|imzo|имзо|nkm|нкм|kassa|касса|sugurta|суғурта|shtrix|штрих|ozini|ўзини|yollanma|ёлланма|guvohnoma|гувоҳнома/.test(t)) return 2;
  if (/rezident|ro.yxat|рўйхат|qqs|ққс|imtiyoz|имтиёз|manzil|манзил|ifut|ифут|tamaki|тамаки|baholash|баҳолаш|qishloq|қишлоқ/.test(t)) return 6;
  return 5;
}

/** Markaz daromad moddasi nomidan hisobot qatorini taxmin qilish */
export function guessCenterLine(label: string): string | null {
  const t = norm(label);
  if (/uzum|узум/.test(t)) return 'R15';
  if (/e-?pos|е-?пос/.test(t)) return 'R14';
  if (/yatiam|ятиам/.test(t)) return 'R13';
  if (/marksheyder|маркшейдер/.test(t)) return 'R17';
  if (/maslahat|маслаҳат|маслахат/.test(t)) return 'R16';
  if (/virtual|виртуал|hujjat aylanish|ҳужжат айланиш|edo|kassa dastur/.test(t)) return 'R12';
  if (/orgtexnika|оргтехника/.test(t)) return 'R11';
  if (/komak|кўмак|texnik|техник/.test(t)) return 'R10';
  return null;
}

@Injectable()
export class BplanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─────────── Sozlamalar (saqlash) ───────────

  private async getSetting<T>(key: string): Promise<T | null> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return (row?.value as T | undefined) ?? null;
  }
  private async setSetting(key: string, value: unknown): Promise<void> {
    await this.prisma.setting.upsert({ where: { key }, create: { key, value: value as object }, update: { value: value as object } });
  }

  // ─────────── Reja fayli ───────────

  private async planFile(year: number): Promise<PlanFile | null> {
    return this.getSetting<PlanFile>(PLAN_KEY(year));
  }

  private async grid(year: number): Promise<{ grid: Grid; buffer: Buffer; meta: PlanFile } | null> {
    const meta = await this.planFile(year);
    if (!meta) return null;
    const buffer = Buffer.from(meta.data, 'base64');
    const wb = new ExcelJS.Workbook();
    await assertSafeXlsx(buffer);
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    return { grid: readPlanGrid(wb), buffer, meta };
  }

  async uploadPlan(yearRaw: unknown, file: Express.Multer.File | undefined, userId: string) {
    const year = clampYear(yearRaw);
    if (!file?.buffer?.length) throw new BadRequestException('Fayl tanlanmagan');
    if (file.size > MAX_FILE) throw new BadRequestException('Fayl 8 MB dan katta');
    if (!/\.xlsx$/i.test(file.originalname ?? '')) throw new BadRequestException('Faqat .xlsx fayl (Excel 2007+)');
    const wb = new ExcelJS.Workbook();
    await assertSafeXlsx(file.buffer);
    try {
      await wb.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException("Faylni o'qib bo'lmadi — Excel (.xlsx) ekanini tekshiring");
    }
    const missing = REQUIRED_SHEETS.filter((n) => !wb.getWorksheet(n));
    if (missing.length) throw new BadRequestException(`Biznes-reja fayli emas: varaqlar topilmadi — ${missing.join(', ')}`);
    const g = readPlanGrid(wb);
    if (!gv(g, S.F2, 'D5') && !gv(g, S.UO, 'D8')) throw new BadRequestException("Rejada sof tushum topilmadi (Ф-2, D5) — faylni Excel'da ochib, hisoblangan holda qayta saqlang");
    const meta: PlanFile = { fileName: file.originalname, uploadedAt: new Date().toISOString(), size: file.size, data: file.buffer.toString('base64') };
    await this.setSetting(PLAN_KEY(year), meta);
    await this.audit.log({ userId, action: 'UPDATE', entity: 'bplan', entityId: PLAN_KEY(year), summary: `Biznes-reja ${year} yuklandi: ${file.originalname}` });
    return this.overview(year);
  }

  async removePlan(yearRaw: unknown, userId: string) {
    const year = clampYear(yearRaw);
    await this.prisma.setting.deleteMany({ where: { key: PLAN_KEY(year) } });
    await this.audit.log({ userId, action: 'DELETE', entity: 'bplan', entityId: PLAN_KEY(year), summary: `Biznes-reja ${year} o'chirildi` });
    return this.overview(year);
  }

  // ─────────── Manbalar va belgilash ───────────

  private async sources() {
    const [incomeCats, expenseCats, departments, regions] = await Promise.all([
      this.prisma.incomeCategory.findMany({ select: { code: true, label: true, isActive: true }, orderBy: [{ order: 'asc' }, { label: 'asc' }] }),
      this.prisma.category.findMany({ select: { code: true, label: true, parentCode: true, isActive: true }, orderBy: [{ order: 'asc' }, { label: 'asc' }] }),
      this.prisma.department.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.region.findMany({ select: { code: true, name: true } }),
    ]);
    return { incomeCats, expenseCats, departments, regions };
  }

  /** Saqlangan belgilash; bo'lmasa — nomlar bo'yicha taklif */
  async map(): Promise<BplanMap> {
    const saved = await this.getSetting<BplanMap>(MAP_KEY);
    if (saved?.lines) return { lines: saved.lines, incomeGroups: saved.incomeGroups ?? {}, groupMap: GROUPS.map((g, i) => saved.groupMap?.[i] ?? g.uo), saved: true };
    return this.suggest();
  }

  async suggest(): Promise<BplanMap> {
    const { incomeCats } = await this.sources();
    // Qaysi moddalar hududlarda, qaysilari Markazda ishlatilgan
    const used = await this.prisma.income.findMany({ where: { deletedAt: null }, select: { categoryCode: true, regionCode: true }, take: 50_000 });
    const regional = new Set<string>();
    const central = new Set<string>();
    for (const u of used) (u.regionCode && u.regionCode !== 0 ? regional : central).add(u.categoryCode);
    const lines: Record<string, LineSource> = {};
    const incomeGroups: Record<string, number> = {};
    for (const c of incomeCats) {
      if (regional.has(c.code)) incomeGroups[c.code] = guessGroup(c.label);
      const line = guessCenterLine(c.label);
      if (line && (central.has(c.code) || !regional.has(c.code))) {
        const cur = lines[line] ?? { kind: 'INCOME' as const, categories: [], area: 'center' as const };
        cur.categories = [...(cur.categories ?? []), c.code];
        lines[line] = cur;
      }
    }
    lines.P15 = { kind: 'PAYROLL', area: 'center' };
    lines.P19 = { kind: 'PAYROLL', area: 'regions' };
    lines.N15 = { kind: 'HEADCOUNT', area: 'center' };
    lines.N19 = { kind: 'HEADCOUNT', area: 'regions' };
    return { lines, incomeGroups, groupMap: GROUPS.map((g) => g.uo), saved: false };
  }

  async saveMap(body: unknown, userId: string): Promise<BplanMap> {
    const b = (body ?? {}) as Dict;
    const linesIn = (b.lines ?? {}) as Record<string, unknown>;
    const lines: Record<string, LineSource> = {};
    for (const [key, v] of Object.entries(linesIn)) {
      if (!FACT_KEYS.has(key) || key.startsWith('U')) continue;
      const s = (v ?? {}) as Dict;
      const kind = String(s.kind ?? 'MANUAL') as SourceKind;
      if (!['INCOME', 'EXPENSE', 'PAYROLL', 'HEADCOUNT', 'MANUAL'].includes(kind)) throw new BadRequestException(`${key}: manba turi noto'g'ri`);
      const area = (['center', 'regions', 'all'].includes(String(s.area)) ? s.area : 'all') as Area;
      const strings = (x: unknown) => (Array.isArray(x) ? x.map(String).filter(Boolean).slice(0, 200) : []);
      if (kind === 'MANUAL') continue;
      lines[key] = { kind, area, categories: strings(s.categories), departments: strings(s.departments) };
    }
    const incomeGroups: Record<string, number> = {};
    for (const [code, gi] of Object.entries((b.incomeGroups ?? {}) as Record<string, unknown>)) {
      const n = Number(gi);
      if (Number.isInteger(n) && n >= 0 && n < GROUPS.length) incomeGroups[String(code)] = n;
    }
    const codes = UO_REG.map(([c]) => c);
    const groupMap = GROUPS.map((g, i) => {
      const v = String(((b.groupMap ?? []) as unknown[])[i] ?? g.uo);
      return codes.includes(v) ? v : g.uo;
    });
    const value: BplanMap = { lines, incomeGroups, groupMap, saved: true };
    await this.setSetting(MAP_KEY, value);
    await this.audit.log({ userId, action: 'UPDATE', entity: 'bplan', entityId: MAP_KEY, summary: `Choraklik hisobot qatorlari belgilandi (${Object.keys(lines).length} ta qator)` });
    return value;
  }

  async saveManual(yearRaw: unknown, body: unknown, userId: string): Promise<Manual> {
    const year = clampYear(yearRaw);
    const b = (body ?? {}) as Dict;
    const lines: Manual['lines'] = {};
    for (const [key, v] of Object.entries((b.lines ?? {}) as Record<string, unknown>)) {
      if (!FACT_KEYS.has(key) || key.startsWith('U') || !Array.isArray(v)) continue;
      const arr = [0, 1, 2, 3].map((i) => num(v[i]));
      if (arr.some((x) => x !== null)) lines[key] = arr;
    }
    const regions: Manual['regions'] = {};
    for (const [k, v] of Object.entries((b.regions ?? {}) as Record<string, unknown>)) {
      if (!/^[1-4]:\d{1,2}:\d$/.test(k)) continue;
      const n = num(v);
      if (n !== null) regions[k] = n;
    }
    const value: Manual = { lines, regions };
    await this.setSetting(MANUAL_KEY(year), value);
    await this.audit.log({ userId, action: 'UPDATE', entity: 'bplan', entityId: MANUAL_KEY(year), summary: `Choraklik hisobot ${year}: qo'lda kiritilgan fakt (${Object.keys(lines).length} qator, ${Object.keys(regions).length} hudud katagi)` });
    return value;
  }

  // ─────────── Fakt (dasturdan) ───────────

  /** Yil bo'yicha avtomatik fakt: qatorlar (4 chorak) va hududlar × guruhlar */
  async autoFacts(year: number, map: BplanMap): Promise<{ lines: Record<string, (number | null)[]>; regions: number[][][]; notes: Record<string, string>; unmatchedRegions: string[] }> {
    const months = [1, 2, 3, 4].flatMap((q) => quarterMonths(year, q));
    const qOf = (period: string) => Math.floor((Number(period.slice(5, 7)) - 1) / 3);
    const { incomeCats, expenseCats, departments, regions } = await this.sources();
    const regionIdx = new Map<number, number>();
    const unmatchedRegions: string[] = [];
    for (const r of regions) {
      if (r.code === 0) continue;
      const i = regionIndex(r.name);
      if (i >= 0) regionIdx.set(r.code, i);
      else unmatchedRegions.push(r.name);
    }
    const lines: Record<string, (number | null)[]> = {};
    const notes: Record<string, string> = {};
    const label = (list: { code: string; label: string }[], codes: string[]) =>
      codes
        .map((c) => list.find((x) => x.code === c)?.label ?? c)
        .slice(0, 4)
        .join(', ') + (codes.length > 4 ? ` +${codes.length - 4}` : '');
    const areaText = (a?: Area) => (a === 'center' ? 'Markaz' : a === 'regions' ? 'hududlar' : 'hammasi');
    const inArea = (regionCode: number | null, a?: Area) => (a === 'center' ? !regionCode : a === 'regions' ? !!regionCode : true);

    // Daromadlar
    const incomeLines = Object.entries(map.lines).filter(([, s]) => s.kind === 'INCOME' && s.categories?.length);
    const groupCats = Object.keys(map.incomeGroups);
    const incomeCodes = [...new Set([...incomeLines.flatMap(([, s]) => s.categories ?? []), ...groupCats])];
    const regionsAgg: number[][][] = [0, 1, 2, 3].map(() => REGIONS.map(() => GROUPS.map(() => 0)));
    if (incomeCodes.length) {
      const rows = await this.prisma.income.findMany({ where: { period: { in: months }, deletedAt: null, categoryCode: { in: incomeCodes } }, select: { period: true, amountTiyin: true, categoryCode: true, regionCode: true } });
      for (const [key, s] of incomeLines) {
        const set = new Set(s.categories);
        const q4 = [0, 0, 0, 0];
        for (const r of rows) if (set.has(r.categoryCode) && inArea(r.regionCode, s.area)) q4[qOf(r.period)]! += Number(r.amountTiyin) / MLN;
        lines[key] = q4;
        notes[key] = `Daromad (${areaText(s.area)}): ${label(incomeCats, s.categories ?? [])}`;
      }
      for (const r of rows) {
        if (!r.regionCode) continue;
        const gi = map.incomeGroups[r.categoryCode];
        const ri = regionIdx.get(r.regionCode);
        if (gi === undefined || ri === undefined) continue;
        regionsAgg[qOf(r.period)]![ri]![gi]! += Number(r.amountTiyin) / MLN;
      }
    }

    // Xarajatlar (moddaning ichki moddalari bilan)
    const children = new Map<string, string[]>();
    for (const c of expenseCats) if (c.parentCode) children.set(c.parentCode, [...(children.get(c.parentCode) ?? []), c.code]);
    const expand = (codes: string[]) => {
      const out = new Set<string>();
      const walk = (c: string) => {
        if (out.has(c)) return;
        out.add(c);
        for (const ch of children.get(c) ?? []) walk(ch);
      };
      codes.forEach(walk);
      return out;
    };
    const expenseLines = Object.entries(map.lines).filter(([, s]) => s.kind === 'EXPENSE' && s.categories?.length);
    if (expenseLines.length) {
      const sets = expenseLines.map(([k, s]) => [k, s, expand(s.categories ?? [])] as const);
      const all = [...new Set(sets.flatMap(([, , set]) => [...set]))];
      const rows = await this.prisma.expense.findMany({ where: { period: { in: months }, deletedAt: null, categoryCode: { in: all } }, select: { period: true, amountTiyin: true, categoryCode: true, regionCode: true, departmentId: true } });
      for (const [key, s, set] of sets) {
        const deps = new Set(s.departments ?? []);
        const q4 = [0, 0, 0, 0];
        for (const r of rows) {
          if (!set.has(r.categoryCode) || !inArea(r.regionCode, s.area)) continue;
          if (deps.size && !(r.departmentId && deps.has(r.departmentId))) continue;
          q4[qOf(r.period)]! += Number(r.amountTiyin) / MLN;
        }
        lines[key] = q4;
        notes[key] = `Xarajat (${areaText(s.area)}): ${label(expenseCats, s.categories ?? [])}`;
      }
    }

    // Ish haqi va xodimlar soni (vedomost)
    const payLines = Object.entries(map.lines).filter(([, s]) => s.kind === 'PAYROLL' || s.kind === 'HEADCOUNT');
    if (payLines.length) {
      const entries = await this.prisma.payrollEntry.findMany({
        where: { period: { in: months }, deletedAt: null },
        select: { period: true, totalTiyin: true, employeePinfl: true, employee: { select: { regionCode: true, departmentId: true } } },
      });
      const depName = (ids: string[]) => ids.map((id) => departments.find((d) => d.id === id)?.name ?? id).join(', ');
      for (const [key, s] of payLines) {
        const deps = new Set(s.departments ?? []);
        const match = (e: (typeof entries)[number]) => {
          const rc = e.employee?.regionCode ?? null;
          if (!inArea(rc, s.area)) return false;
          return !deps.size || (!!e.employee?.departmentId && deps.has(e.employee.departmentId));
        };
        if (s.kind === 'PAYROLL') {
          const q4 = [0, 0, 0, 0];
          for (const e of entries) if (match(e)) q4[qOf(e.period)]! += Number(e.totalTiyin) / MLN;
          lines[key] = q4;
          notes[key] = `Ish haqi vedomosti (${areaText(s.area)}${deps.size ? `: ${depName([...deps])}` : ''})`;
        } else {
          const perMonth = new Map<string, Set<string>>();
          for (const e of entries) if (match(e)) perMonth.set(e.period, (perMonth.get(e.period) ?? new Set()).add(e.employeePinfl));
          lines[key] = [1, 2, 3, 4].map((q) => {
            const ms = quarterMonths(year, q).filter((m) => perMonth.has(m));
            return ms.length ? Math.round((ms.reduce((t, m) => t + perMonth.get(m)!.size, 0) / ms.length) * 10) / 10 : null;
          });
          notes[key] = `Vedomostdagi xodimlar, oylik o'rtacha (${areaText(s.area)}${deps.size ? `: ${depName([...deps])}` : ''})`;
        }
      }
    }
    return { lines, regions: regionsAgg, notes, unmatchedRegions };
  }

  /** Avtomatik + qo'lda = yakuniy fakt */
  async facts(year: number): Promise<{ facts: Facts; cells: Record<string, FactCell>; regionCells: { auto: number[][][]; manual: Manual['regions']; final: number[][][] }; notes: Record<string, string>; unmatchedRegions: string[]; map: BplanMap; manual: Manual }> {
    const map = await this.map();
    const manual = (await this.getSetting<Manual>(MANUAL_KEY(year))) ?? { lines: {}, regions: {} };
    const auto = await this.autoFacts(year, map);
    const cells: Record<string, FactCell> = {};
    const lines: Facts['lines'] = {};
    for (const l of FACT_LINES) {
      if (l.derived) continue;
      const a = auto.lines[l.key] ?? [null, null, null, null];
      const m = manual.lines?.[l.key] ?? [null, null, null, null];
      const final = [0, 1, 2, 3].map((i) => (m[i] !== null && m[i] !== undefined ? m[i]! : (a[i] ?? null)));
      cells[l.key] = { auto: a, manual: [0, 1, 2, 3].map((i) => m[i] ?? null), final };
      lines[l.key] = final;
    }
    const finalRegions = auto.regions.map((qr, qi) => qr.map((reg, ri) => reg.map((v, gi) => manual.regions?.[`${qi + 1}:${ri}:${gi}`] ?? v)));
    return {
      facts: { lines, regions: finalRegions, groupMap: map.groupMap },
      cells,
      regionCells: { auto: auto.regions, manual: manual.regions ?? {}, final: finalRegions },
      notes: auto.notes,
      unmatchedRegions: auto.unmatchedRegions,
      map,
      manual,
    };
  }

  // ─────────── Natija ───────────

  async overview(yearRaw: unknown) {
    const year = clampYear(yearRaw ?? new Date().getFullYear());
    const [meta, src, f] = await Promise.all([this.planFile(year), this.sources(), this.facts(year)]);
    const plans = await this.prisma.setting.findMany({ where: { key: { startsWith: 'bplan.plan.' } }, select: { key: true } });
    let checks: { text: string; a: number; b: number }[] = [];
    if (meta) {
      const g = (await this.grid(year))!.grid;
      checks = CHECKS.map(([text, a, b]) => ({ text, a: evalRef(g, a), b: evalRef(g, b) }));
    }
    return {
      year,
      years: plans.map((p) => Number(p.key.split('.').pop())).filter(Number.isFinite).sort(),
      plan: meta ? { fileName: meta.fileName, uploadedAt: meta.uploadedAt, size: meta.size } : null,
      lines: FACT_LINES,
      groups: GROUPS.map((g) => g.name),
      regions: REGIONS.map((r) => r.name),
      uoCodes: UO_REG.map(([c, , n]) => ({ code: c, name: n })),
      map: f.map,
      cells: f.cells,
      regionCells: f.regionCells,
      notes: f.notes,
      unmatchedRegions: f.unmatchedRegions,
      checks,
      sources: {
        incomeCategories: src.incomeCats.map((c) => ({ code: c.code, label: c.label, active: c.isActive })),
        expenseCategories: src.expenseCats.map((c) => ({ code: c.code, label: c.label, parentCode: c.parentCode, active: c.isActive })),
        departments: src.departments,
      },
    };
  }

  async report(yearRaw: unknown, quarterRaw: unknown, modeRaw: unknown): Promise<Execution> {
    const year = clampYear(yearRaw);
    const quarter = Number(quarterRaw);
    if (![1, 2, 3, 4].includes(quarter)) throw new BadRequestException('Chorak 1–4');
    const mode: Mode = modeRaw === 'quarter' ? 'quarter' : 'ytd';
    const plan = await this.grid(year);
    if (!plan) throw new NotFoundException(`${year} yil biznes-rejasi yuklanmagan`);
    const { facts } = await this.facts(year);
    return execute(plan.grid, facts, year, quarter, mode);
  }

  async excel(yearRaw: unknown, quarterRaw: unknown, modeRaw: unknown): Promise<{ buffer: Buffer; filename: string }> {
    const year = clampYear(yearRaw);
    const quarter = Number(quarterRaw);
    if (![1, 2, 3, 4].includes(quarter)) throw new BadRequestException('Chorak 1–4');
    const mode: Mode = modeRaw === 'quarter' ? 'quarter' : 'ytd';
    const plan = await this.grid(year);
    if (!plan) throw new NotFoundException(`${year} yil biznes-rejasi yuklanmagan`);
    const { facts, notes, manual } = await this.facts(year);
    const marks: Record<string, string> = { ...notes };
    for (const [k, v] of Object.entries(manual.lines ?? {})) if (v.some((x) => x !== null)) marks[k] = `${marks[k] ? `${marks[k]}; ` : ''}qo'lda tuzatilgan`;
    const buffer = await buildWorkbook(plan.buffer, { year, quarter, mode, facts, notes: marks });
    const label = mode === 'quarter' ? `${quarter}-chorak` : ['1-chorak', '1-yarim yil', '9 oy', 'yil'][quarter - 1];
    return { buffer, filename: `Choraklik ijro ${year} - ${label}.xlsx` };
  }
}

/** Tekshiruv formulasi (oddiy): 'Varaq'!A1, SUM('Varaq'!A1:B2), +, *son, son */
export function evalRef(g: Grid, expr: string): number {
  let total = 0;
  for (const part of expr.split('+')) {
    let p = part.trim();
    let mul = 1;
    const m = /^(.*)\*([\d.]+)$/.exec(p);
    if (m) {
      p = m[1]!.trim();
      mul = Number(m[2]);
    }
    let v = 0;
    const sum = /^SUM\('(.+)'!([A-Z]+)(\d+):([A-Z]+)(\d+)\)$/.exec(p);
    const ref = /^'(.+)'!([A-Z]+\d+)$/.exec(p);
    if (sum) {
      const [, sheet, c1, r1, c2, r2] = sum;
      const col = (s: string) => s.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
      for (let r = Number(r1); r <= Number(r2); r += 1)
        for (let c = col(c1!); c <= col(c2!); c += 1) {
          let name = '';
          let n = c;
          while (n > 0) {
            name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
            n = Math.floor((n - 1) / 26);
          }
          v += gv(g, sheet!.replace(/''/g, "'"), `${name}${r}`);
        }
    } else if (ref) v = gv(g, ref[1]!.replace(/''/g, "'"), ref[2]!);
    else if (/^[\d.]+$/.test(p)) v = Number(p);
    total += v * mul;
  }
  return total;
}