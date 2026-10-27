import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import {
  MONTHS_UZ,
  parsePairsGrid,
  parseRegistryGrid,
  parseTemplatePayments,
  pickInternetPayments,
  textOf,
  type Grid,
  type ParsedPayment,
  type RegistryRow,
} from './internet.parse';
import { assertSafeXlsx } from '../../common/files/xlsx-guard';
import { assertAmount } from '../../common/validation/amount';
import { parseBankStatement } from '../unit-bank/unit-bank.service';

// ═══════════════════════════════════════════════════════════
// Internet to'lovlari: shartnomalar ro'yxati va oylik to'lovlar → xarajat.
//
//  • Ro'yxat (Sozlama «internet.registry»): har shartnoma — kimga to'lanadi (provayder), nima uchun (izoh),
//    qayerga biriktiriladi: Markaz (umumiy), Markaz bo'limi yoki hudud.
//  • Fayl o'qiladi: bank ko'chirmasining o'zi (выписка — internet to'lovlari izohdagi shartnoma raqami bo'yicha
//    ajratiladi), bank ro'yxati (oy juftliklari) yoki shablon → shartnoma × oy matritsasi, o'zgarishlar.
//  • Saqlash: har to'lov — bitta xarajat yozuvi (modda «Internet to'lovlari»), biriktirish ro'yxatdan,
//    kontragent — provayder, hujjat № — shartnoma. Qayta yuklansa — ikki marta yozilmaydi.
//  • Ro'yxat o'zgarsa — yozilgan xarajatlarni ham yangi biriktirishga o'tkazish mumkin.
// ═══════════════════════════════════════════════════════════

const REGISTRY_KEY = 'internet.registry';
const POSTED_KEY = 'internet.posted';
const TASHKENT_MS = 5 * 3600_000;
export const INTERNET_CATEGORY = { code: 'INTERNET', label: "Internet to'lovlari" };

export type UnitRef = { kind: 'center' } | { kind: 'department'; departmentId: string } | { kind: 'region'; regionCode: number };

export interface Contract {
  contractNo: string;
  contractDate: string | null;
  /** Kimga to'lanadi — provayder (Uztelecom, …) */
  provider: string | null;
  /** Nima uchun: qaysi bino / bo'lim / xizmat */
  purpose: string | null;
  unit: UnitRef | null;
}

export interface Registry {
  contracts: Contract[];
  categoryCode: string | null;
}

export interface PaymentDto {
  ref: string;
  period: string;
  amountTiyin: string;
  text: string;
  contractNo: string | null;
  contractDate: string | null;
  prepaid: boolean;
  /** Avval yozilgan (qayta yuklash) */
  posted: boolean;
}

export interface ContractSummary {
  contractNo: string;
  contractDate: string | null;
  inRegistry: boolean;
  contract: Contract | null;
  /** Oy → summa (bir oyda bir nechta to'lov bo'lsa — yig'indi) */
  months: Record<string, string>;
  totalTiyin: string;
  count: number;
  prepaid: boolean;
  /** «Fevraldan 879 000 → aprelda 819 000», «Mart oyi to'lanmagan», «Faqat yanvarda — bir martalik» */
  notes: string[];
}

export interface AnalysisResult {
  fileName: string;
  /** pairs — oy juftliklari, template — shablon, bank — bank ko'chirmasi (выписка) */
  format: 'pairs' | 'template' | 'bank';
  /** Bank ko'chirmasi bo'lsa: jami chiqim qatorlari va internet bo'lmagani (o'tkazib yuborilgan) */
  bank: { rows: number; skipped: number; skippedTiyin: string } | null;
  months: string[];
  payments: PaymentDto[];
  contracts: ContractSummary[];
  /** Shablonning «Shartnomalar» varag'idan o'qilgani (bo'lsa) — ro'yxatga qo'shish taklifi */
  registryFromFile: Contract[];
  registryUnresolved: { contractNo: string; unitName: string }[];
  byMonth: { period: string; totalTiyin: string; count: number }[];
  totalTiyin: string;
  warnings: string[];
  noContract: number;
}

export interface Lookups {
  departments: { id: string; name: string; code: string }[];
  regions: { code: number; name: string }[];
  categories: { code: string; label: string }[];
}

export interface Overview {
  registry: Registry;
  category: { code: string; label: string; exists: boolean };
  lookups: Lookups;
  /** Yozilgan xarajatlar: shartnoma × oy */
  posted: {
    months: string[];
    rows: { contractNo: string; months: Record<string, string>; totalTiyin: string; unitLabel: string; mismatch: boolean }[];
    totalTiyin: string;
    count: number;
    byUnit: { label: string; totalTiyin: string; count: number }[];
  };
}

function periodEnd(period: string): Date {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1) - TASHKENT_MS - 86_400_000 + 7 * 3600_000);
}

function monthText(period: string): string {
  const [y, m] = period.split('-');
  return `${MONTHS_UZ[Number(m) - 1] ?? m} ${y}`;
}

function money(tiyin: bigint): string {
  const som = Number(tiyin) / 100;
  return som.toLocaleString('ru-RU', { maximumFractionDigits: 2 }).replace(/,/g, ',');
}

function sheetGrid(ws: ExcelJS.Worksheet): Grid {
  const grid: Grid = [];
  ws.eachRow({ includeEmpty: true }, (row, r) => {
    const a: unknown[] = [];
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      a[c - 1] = cell.value;
    });
    grid[r - 1] = a;
  });
  return grid;
}

function postedKey(p: { period: string; contractNo: string | null; amountTiyin: bigint | string; text: string }, n: number): string {
  return `${p.period}|${p.contractNo ?? '-'}|${p.amountTiyin}|${n}`;
}

function sanitizeUnit(u: unknown): UnitRef | null {
  if (!u || typeof u !== 'object') return null;
  const v = u as Record<string, unknown>;
  if (v.kind === 'center') return { kind: 'center' };
  if (v.kind === 'department' && typeof v.departmentId === 'string' && v.departmentId) return { kind: 'department', departmentId: v.departmentId };
  if (v.kind === 'region' && Number.isInteger(Number(v.regionCode)) && Number(v.regionCode) > 0) return { kind: 'region', regionCode: Number(v.regionCode) };
  return null;
}

function str(v: unknown, max = 300): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t || null;
}

@Injectable()
export class InternetService {
  constructor(private readonly prisma: PrismaService) {}

  // ─────────── Ro'yxat ───────────

  async registry(): Promise<Registry> {
    const row = await this.prisma.setting.findUnique({ where: { key: REGISTRY_KEY } });
    const v = (row?.value ?? {}) as { contracts?: unknown[]; categoryCode?: unknown };
    const contracts = Array.isArray(v.contracts) ? v.contracts.map((c) => this.sanitizeContract(c)).filter((c): c is Contract => !!c) : [];
    return { contracts, categoryCode: typeof v.categoryCode === 'string' ? v.categoryCode : null };
  }

  private sanitizeContract(c: unknown): Contract | null {
    if (!c || typeof c !== 'object') return null;
    const v = c as Record<string, unknown>;
    const no = str(v.contractNo, 60)?.toUpperCase();
    if (!no) return null;
    return { contractNo: no, contractDate: str(v.contractDate, 20), provider: str(v.provider, 120), purpose: str(v.purpose, 300), unit: sanitizeUnit(v.unit) };
  }

  async lookups(): Promise<Lookups> {
    const [departments, regions, categories] = await Promise.all([
      this.prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true, code: true }, orderBy: { order: 'asc' } }),
      this.prisma.region.findMany({ where: { isActive: true }, select: { code: true, name: true }, orderBy: { code: 'asc' } }),
      this.prisma.category.findMany({ where: { isActive: true, isLeaf: true }, select: { code: true, label: true }, orderBy: { order: 'asc' } }),
    ]);
    return { departments, regions: regions.filter((r) => r.code !== 0), categories };
  }

  /** Modda: ro'yxatda tanlangani → «INTERNET» → nomida «internet» bor barg → (saqlashda) yaratiladi */
  private async resolveCategory(registry: Registry): Promise<{ code: string; label: string; exists: boolean }> {
    if (registry.categoryCode) {
      const c = await this.prisma.category.findUnique({ where: { code: registry.categoryCode }, select: { code: true, label: true } });
      if (c) return { ...c, exists: true };
    }
    const own = await this.prisma.category.findUnique({ where: { code: INTERNET_CATEGORY.code }, select: { code: true, label: true } });
    if (own) return { ...own, exists: true };
    const leaves = await this.prisma.category.findMany({ where: { isActive: true, isLeaf: true }, select: { code: true, label: true } });
    const byName = leaves.find((c) => /internet/i.test(c.label) && !c.code.startsWith('HM_')) ?? leaves.find((c) => /internet/i.test(c.label));
    if (byName) return { ...byName, exists: true };
    return { ...INTERNET_CATEGORY, exists: false };
  }

  private async ensureCategory(cat: { code: string; label: string; exists: boolean }): Promise<string> {
    if (cat.exists) return cat.code;
    await this.prisma.category.create({ data: { code: cat.code, label: cat.label, isLeaf: true, isActive: true, behavior: 'FIXED', keywords: ['internet', 'интернет'], order: 600 } }).catch(() => null);
    return cat.code;
  }

  async saveRegistry(input: { contracts?: unknown[]; categoryCode?: unknown; applyToPosted?: boolean }): Promise<{ registry: Registry; updated: number }> {
    if (!Array.isArray(input?.contracts)) throw new BadRequestException("Shartnomalar ro'yxati kerak");
    const seen = new Set<string>();
    const contracts: Contract[] = [];
    for (const raw of input.contracts) {
      const c = this.sanitizeContract(raw);
      if (!c || seen.has(c.contractNo)) continue;
      seen.add(c.contractNo);
      contracts.push(c);
    }
    await this.validateUnits(contracts);
    let categoryCode: string | null = null;
    if (typeof input.categoryCode === 'string' && input.categoryCode) {
      const c = await this.prisma.category.findUnique({ where: { code: input.categoryCode }, select: { code: true } });
      if (!c) throw new BadRequestException('Modda topilmadi');
      categoryCode = c.code;
    }
    const registry: Registry = { contracts, categoryCode };
    await this.prisma.setting.upsert({ where: { key: REGISTRY_KEY }, create: { key: REGISTRY_KEY, value: registry as unknown as object }, update: { value: registry as unknown as object } });
    const updated = input.applyToPosted ? await this.applyToPosted(registry) : 0;
    return { registry, updated };
  }

  private async validateUnits(contracts: Contract[]): Promise<void> {
    const depIds = [...new Set(contracts.flatMap((c) => (c.unit?.kind === 'department' ? [c.unit.departmentId] : [])))];
    const regCodes = [...new Set(contracts.flatMap((c) => (c.unit?.kind === 'region' ? [c.unit.regionCode] : [])))];
    if (depIds.length) {
      const found = new Set((await this.prisma.department.findMany({ where: { id: { in: depIds } }, select: { id: true } })).map((d) => d.id));
      const bad = depIds.find((id) => !found.has(id));
      if (bad) throw new BadRequestException("Bo'lim topilmadi");
    }
    if (regCodes.length) {
      const found = new Set((await this.prisma.region.findMany({ where: { code: { in: regCodes } }, select: { code: true } })).map((r) => r.code));
      const bad = regCodes.find((c) => !found.has(c));
      if (bad !== undefined) throw new BadRequestException(`Hudud topilmadi: ${bad}`);
    }
  }

  private async posted(): Promise<Record<string, string>> {
    const row = await this.prisma.setting.findUnique({ where: { key: POSTED_KEY } });
    const v = (row?.value ?? {}) as { keys?: Record<string, string> };
    return v.keys && typeof v.keys === 'object' ? { ...v.keys } : {};
  }

  private async savePosted(keys: Record<string, string>): Promise<void> {
    await this.prisma.setting.upsert({ where: { key: POSTED_KEY }, create: { key: POSTED_KEY, value: { keys } }, update: { value: { keys } } });
  }

  /** Biriktirish → xarajat maydonlari */
  private unitFields(unit: UnitRef | null): { regionCode: number | null; departmentId: string | null } {
    if (!unit) return { regionCode: null, departmentId: null };
    if (unit.kind === 'center') return { regionCode: 0, departmentId: null };
    if (unit.kind === 'department') return { regionCode: 0, departmentId: unit.departmentId };
    return { regionCode: unit.regionCode, departmentId: null };
  }

  private description(c: Contract | null, p: { contractNo: string | null; contractDate: string | null; period: string; prepaid: boolean }): string {
    const no = p.contractNo ? `shartnoma № ${p.contractNo}${(c?.contractDate ?? p.contractDate) ? ` (${c?.contractDate ?? p.contractDate})` : ''}` : 'shartnoma ko‘rsatilmagan';
    return `Internet: ${c?.purpose ?? 'xizmat'} — ${no}, ${monthText(p.period)}${p.prepaid ? ' (oldindan to‘lov)' : ''}`;
  }

  // ─────────── Ko'rinish ───────────

  async overview(): Promise<Overview> {
    const [registry, lookups, keys] = await Promise.all([this.registry(), this.lookups(), this.posted()]);
    const category = await this.resolveCategory(registry);
    const ids = [...new Set(Object.values(keys))];
    const expenses = ids.length
      ? await this.prisma.expense.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, period: true, amountTiyin: true, documentNo: true, regionCode: true, departmentId: true } })
      : [];
    const depName = new Map(lookups.departments.map((d) => [d.id, d.name]));
    const regName = new Map(lookups.regions.map((r) => [r.code, r.name]));
    const unitLabel = (e: { regionCode: number | null; departmentId: string | null }) =>
      e.regionCode === null ? 'Biriktirilmagan' : e.regionCode === 0 ? (e.departmentId ? `Markaz › ${depName.get(e.departmentId) ?? "bo'lim"}` : 'Markaz (umumiy)') : (regName.get(e.regionCode) ?? `Hudud ${e.regionCode}`);
    const byContract = new Map<string, { months: Map<string, bigint>; total: bigint; units: Set<string> }>();
    const byUnit = new Map<string, { total: bigint; count: number }>();
    const months = new Set<string>();
    let total = 0n;
    for (const e of expenses) {
      const no = e.documentNo ?? '—';
      const acc = byContract.get(no) ?? { months: new Map(), total: 0n, units: new Set() };
      acc.months.set(e.period, (acc.months.get(e.period) ?? 0n) + e.amountTiyin);
      acc.total += e.amountTiyin;
      const label = unitLabel(e);
      acc.units.add(label);
      byContract.set(no, acc);
      const u = byUnit.get(label) ?? { total: 0n, count: 0 };
      u.total += e.amountTiyin;
      u.count += 1;
      byUnit.set(label, u);
      months.add(e.period);
      total += e.amountTiyin;
    }
    // Ro'yxatdagi biriktirish bilan yozilgani farq qiladimi
    const regUnit = new Map(registry.contracts.map((c) => [c.contractNo, c.unit]));
    const rows = [...byContract.entries()]
      .sort((a, b) => (b[1].total > a[1].total ? 1 : -1))
      .map(([contractNo, acc]) => {
        const want = regUnit.has(contractNo) ? unitLabel(this.unitFields(regUnit.get(contractNo) ?? null)) : null;
        return {
          contractNo,
          months: Object.fromEntries([...acc.months.entries()].map(([k, v]) => [k, v.toString()])),
          totalTiyin: acc.total.toString(),
          unitLabel: [...acc.units].join(', '),
          mismatch: want !== null && (acc.units.size !== 1 || !acc.units.has(want)),
        };
      });
    return {
      registry,
      category,
      lookups,
      posted: {
        months: [...months].sort(),
        rows,
        totalTiyin: total.toString(),
        count: expenses.length,
        byUnit: [...byUnit.entries()].sort((a, b) => (b[1].total > a[1].total ? 1 : -1)).map(([label, u]) => ({ label, totalTiyin: u.total.toString(), count: u.count })),
      },
    };
  }

  // ─────────── Fayl tahlili ───────────

  private async readFile(file: Express.Multer.File | undefined): Promise<{ wb: ExcelJS.Workbook; name: string }> {
    if (!file?.buffer?.length) throw new BadRequestException('Fayl yuklanmadi');
    const wb = new ExcelJS.Workbook();
    await assertSafeXlsx(file.buffer);
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException("Faylni o'qib bo'lmadi — .xlsx shaklida saqlang");
    }
    if (!wb.worksheets.length) throw new BadRequestException('Faylda varaq yo‘q');
    return { wb, name: file.originalname || 'internet.xlsx' };
  }

  /** Fayldan to'lovlar va (shablon bo'lsa) shartnomalar ro'yxati */
  /** Bank ko'chirmasi (выписка) bo'lsa — internet to'lovlari shartnoma raqami bo'yicha ajratiladi; bo'lmasa — null */
  private parseBank(wb: ExcelJS.Workbook, contractNos: string[]) {
    let statement: ReturnType<typeof parseBankStatement>;
    try {
      statement = parseBankStatement(wb);
    } catch {
      return null;
    }
    const picked = pickInternetPayments(statement.rows, contractNos);
    const warnings = [...picked.warnings];
    if (statement.invalid.length) warnings.push(`${statement.invalid.length} ta qator o'qilmadi (sana yoki summa noto'g'ri): ${statement.invalid.slice(0, 3).map((x) => `${x.rowIndex}-qator — ${x.reason}`).join('; ')}`);
    return { payments: picked.payments, providers: picked.providers, warnings, rows: statement.rows.length, skipped: picked.skipped, skippedTiyin: picked.skippedTiyin };
  }

  private parseWorkbook(wb: ExcelJS.Workbook): { format: 'pairs' | 'template'; payments: ParsedPayment[]; warnings: string[]; registryRows: RegistryRow[] } {
    const year = Number(new Date(Date.now() + TASHKENT_MS).toISOString().slice(0, 4));
    const paySheet = wb.worksheets.find((w) => /to.?lov/i.test(w.name));
    const regSheet = wb.worksheets.find((w) => /shartnoma/i.test(w.name));
    const registryRows = regSheet ? parseRegistryGrid(sheetGrid(regSheet)) : [];
    if (paySheet) {
      const grid = sheetGrid(paySheet);
      // Shablon «To'lovlar» varag'i ham juftlik shaklida bo'lishi mumkin (bank ro'yxati shu varaqqa qo'yilgan)
      const header = (grid[0] ?? []).map((v) => textOf(v).toLowerCase()).join(' ');
      if (/summa|сумм/.test(header) && /^.*\boy\b|oy\s*\(/.test(header)) {
        const r = parseTemplatePayments(grid, year);
        return { format: 'template', payments: r.payments, warnings: r.warnings, registryRows };
      }
      const pairs = parsePairsGrid(grid, year);
      if (pairs) return { format: 'pairs', payments: pairs.payments, warnings: pairs.warnings, registryRows };
      const r = parseTemplatePayments(grid, year);
      return { format: 'template', payments: r.payments, warnings: r.warnings, registryRows };
    }
    for (const ws of wb.worksheets) {
      if (ws === regSheet) continue;
      const pairs = parsePairsGrid(sheetGrid(ws), year);
      if (pairs && pairs.payments.length) return { format: 'pairs', payments: pairs.payments, warnings: pairs.warnings, registryRows };
    }
    if (registryRows.length) return { format: 'template', payments: [], warnings: [], registryRows };
    throw new BadRequestException("Faylda to'lovlar topilmadi: bank ko'chirmasi (выписка: «Обороты по дебету», «Назначение платежа»), oy ustunlari (Yanvar, Fevral …: summa | shartnoma) yoki shablonning «To'lovlar» varag'i kerak");
  }

  /** Shablondagi nom → bo'lim / hudud */
  private resolveRegistryRows(rows: RegistryRow[], lookups: Lookups): { contracts: Contract[]; unresolved: { contractNo: string; unitName: string }[] } {
    const norm = (s: string) => s.toLowerCase().replace(/[ʻʼ'`‘’]/g, '').replace(/\s+/g, ' ').trim();
    const unresolved: { contractNo: string; unitName: string }[] = [];
    const contracts = rows.map((r) => {
      let unit: UnitRef | null = null;
      const name = r.unitName ? norm(r.unitName) : '';
      if (r.unitKind === 'center' && !name) unit = { kind: 'center' };
      else if (r.unitKind === 'department' || (r.unitKind === null && name)) {
        const d = lookups.departments.find((x) => norm(x.name) === name || norm(x.code) === name) ?? lookups.departments.find((x) => name && norm(x.name).includes(name));
        if (d) unit = { kind: 'department', departmentId: d.id };
      }
      if (!unit && (r.unitKind === 'region' || (r.unitKind === null && name))) {
        const g = lookups.regions.find((x) => norm(x.name) === name || String(x.code) === name) ?? lookups.regions.find((x) => name && norm(x.name).startsWith(name.split(' ')[0]!));
        if (g) unit = { kind: 'region', regionCode: g.code };
      }
      if (!unit && r.unitKind === 'center') unit = { kind: 'center' };
      if (!unit && r.unitName) unresolved.push({ contractNo: r.contractNo, unitName: r.unitName });
      return { contractNo: r.contractNo, contractDate: r.contractDate, provider: r.provider, purpose: r.purpose, unit };
    });
    return { contracts, unresolved };
  }

  async analyze(file: Express.Multer.File | undefined): Promise<AnalysisResult> {
    const { wb, name } = await this.readFile(file);
    const [registry, keys, lookups] = await Promise.all([this.registry(), this.posted(), this.lookups()]);
    const bank = this.parseBank(wb, registry.contracts.map((c) => c.contractNo));
    const parsed = bank
      ? { format: 'bank' as const, payments: bank.payments, warnings: bank.warnings, registryRows: [] as RegistryRow[] }
      : this.parseWorkbook(wb);
    if (bank && !bank.payments.length)
      throw new BadRequestException(
        `Bank ko'chirmasida internet to'lovi topilmadi (${bank.rows} ta chiqim ko'rildi). Izohda ro'yxatdagi shartnoma raqami yoki «интернет» so'zi bo'lishi kerak — avval shartnomalar ro'yxatini to'ldiring`,
      );
    const fromFile = this.resolveRegistryRows(parsed.registryRows, lookups);
    // Bank: ro'yxatda yo'q shartnomalar — oluvchi (provayder) bilan taklif
    if (bank) {
      // Ro'yxatdagisida provayder yozilmagan bo'lsa ham — bankdagi oluvchi nomi taklif qilinadi
      const known = new Set(registry.contracts.filter((c) => c.provider).map((c) => c.contractNo));
      for (const [no, provider] of bank.providers)
        if (!known.has(no)) fromFile.contracts.push({ contractNo: no, contractDate: bank.payments.find((p) => p.contractNo === no)?.contractDate ?? null, provider, purpose: null, unit: null });
    }
    const regMap = new Map(registry.contracts.map((c) => [c.contractNo, c]));
    const fileMap = new Map(fromFile.contracts.map((c) => [c.contractNo, c]));

    // Takrorlanish raqami: bir oyda bir shartnomaga bir xil summa ikki marta
    const seq = new Map<string, number>();
    const payments: PaymentDto[] = parsed.payments.map((p) => {
      const base = postedKey(p, 0).slice(0, -2);
      const n = seq.get(base) ?? 0;
      seq.set(base, n + 1);
      return {
        ref: p.ref,
        period: p.period,
        amountTiyin: p.amountTiyin.toString(),
        text: p.text,
        contractNo: p.contractNo,
        contractDate: p.contractDate,
        prepaid: p.prepaid,
        posted: !!keys[postedKey(p, n)],
      };
    });

    const months = [...new Set(payments.map((p) => p.period))].sort();
    const groups = new Map<string, PaymentDto[]>();
    for (const p of payments) {
      const k = p.contractNo ?? '—';
      groups.set(k, [...(groups.get(k) ?? []), p]);
    }
    const contracts: ContractSummary[] = [...groups.entries()].map(([no, list]) => {
      const m = new Map<string, bigint>();
      for (const p of list) m.set(p.period, (m.get(p.period) ?? 0n) + BigInt(p.amountTiyin));
      const total = [...m.values()].reduce((a, v) => a + v, 0n);
      const contract = regMap.get(no) ?? fileMap.get(no) ?? null;
      return {
        contractNo: no,
        contractDate: list.find((p) => p.contractDate)?.contractDate ?? contract?.contractDate ?? null,
        inRegistry: regMap.has(no),
        contract,
        months: Object.fromEntries([...m.entries()].map(([k, v]) => [k, v.toString()])),
        totalTiyin: total.toString(),
        count: list.length,
        prepaid: list.some((p) => p.prepaid),
        notes: this.notesOf(m, months),
      };
    });
    contracts.sort((a, b) => (BigInt(b.totalTiyin) > BigInt(a.totalTiyin) ? 1 : -1));

    const byMonth = months.map((period) => {
      const list = payments.filter((p) => p.period === period);
      return { period, totalTiyin: list.reduce((a, p) => a + BigInt(p.amountTiyin), 0n).toString(), count: list.length };
    });
    return {
      fileName: name,
      format: parsed.format,
      bank: bank ? { rows: bank.rows, skipped: bank.skipped, skippedTiyin: bank.skippedTiyin.toString() } : null,
      months,
      payments,
      contracts,
      registryFromFile: fromFile.contracts,
      registryUnresolved: fromFile.unresolved,
      byMonth,
      totalTiyin: payments.reduce((a, p) => a + BigInt(p.amountTiyin), 0n).toString(),
      warnings: parsed.warnings,
      noContract: payments.filter((p) => !p.contractNo).length,
    };
  }

  /** Shartnoma bo'yicha o'zgarishlar: summa o'zgargan, to'lanmagan oy, bir martalik */
  private notesOf(m: Map<string, bigint>, months: string[]): string[] {
    const notes: string[] = [];
    const paid = months.filter((p) => m.has(p));
    if (paid.length === 1 && months.length > 1) notes.push(`Faqat ${monthText(paid[0]!).split(' ')[0]!.toLowerCase()} oyida — bir martalik yoki yangi shartnoma`);
    const first = paid[0];
    const last = paid[paid.length - 1];
    if (first && last) {
      const missing = months.filter((p) => p > first && p < last && !m.has(p));
      if (missing.length) notes.push(`${missing.map((p) => monthText(p).split(' ')[0]).join(', ')} oyida to'lov yo'q`);
      const before = months.filter((p) => p < first);
      if (before.length && paid.length > 1) notes.push(`${monthText(first).split(' ')[0]}dan boshlangan`);
      const after = months.filter((p) => p > last);
      if (after.length && paid.length > 1) notes.push(`${monthText(last).split(' ')[0]}dan keyin to'lanmagan`);
    }
    for (let i = 1; i < paid.length; i++) {
      const a = m.get(paid[i - 1]!)!;
      const b = m.get(paid[i]!)!;
      if (a !== b) {
        const pct = a > 0n ? ((Number(b) - Number(a)) / Number(a)) * 100 : 0;
        notes.push(`${monthText(paid[i]!).split(' ')[0]}: ${money(a)} → ${money(b)} (${pct > 0 ? '+' : ''}${pct.toFixed(1).replace('.', ',')}%)`);
      }
    }
    return notes;
  }

  // ─────────── Saqlash: xarajat yozuvlari ───────────

  async commit(
    input: { fileName?: unknown; payments?: unknown[]; contracts?: unknown[]; categoryCode?: unknown },
    userId: string,
  ): Promise<{ created: number; skipped: number; totalTiyin: string; unassigned: number; batchId: string | null }> {
    if (!Array.isArray(input?.payments) || input.payments.length === 0) throw new BadRequestException("Saqlash uchun to'lov yo'q");
    // Ro'yxat — avval saqlanadi (sahifada to'ldirilgan provayder / izoh / biriktirish)
    let registry = await this.registry();
    if (Array.isArray(input.contracts)) {
      const merged = new Map(registry.contracts.map((c) => [c.contractNo, c]));
      for (const raw of input.contracts) {
        const c = this.sanitizeContract(raw);
        if (c) merged.set(c.contractNo, c);
      }
      registry = (await this.saveRegistry({ contracts: [...merged.values()], categoryCode: typeof input.categoryCode === 'string' ? input.categoryCode : registry.categoryCode })).registry;
    } else if (typeof input.categoryCode === 'string' && input.categoryCode) {
      registry = (await this.saveRegistry({ contracts: registry.contracts, categoryCode: input.categoryCode })).registry;
    }
    const category = await this.ensureCategory(await this.resolveCategory(registry));
    const regMap = new Map(registry.contracts.map((c) => [c.contractNo, c]));

    const payments = input.payments.map((raw, i) => {
      const v = (raw ?? {}) as Record<string, unknown>;
      const period = String(v.period ?? '');
      if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period)) throw new BadRequestException(`${i + 1}-to'lov: oy noto'g'ri`);
      let amount: bigint;
      try {
        amount = BigInt(String(v.amountTiyin));
      } catch {
        throw new BadRequestException(`${i + 1}-to'lov: summa noto'g'ri`);
      }
      if (amount <= 0n) throw new BadRequestException(`${i + 1}-to'lov: summa noto'g'ri`);
      assertAmount(amount, `${i + 1}-to'lov`);
      return {
        period,
        amountTiyin: amount,
        text: String(v.text ?? '').slice(0, 1000),
        contractNo: str(v.contractNo, 60)?.toUpperCase() ?? null,
        contractDate: str(v.contractDate, 20),
        prepaid: v.prepaid === true,
      };
    });

    const keys = await this.posted();
    const existing = Object.values(keys).length
      ? new Set((await this.prisma.expense.findMany({ where: { id: { in: [...new Set(Object.values(keys))] }, deletedAt: null }, select: { id: true } })).map((e) => e.id))
      : new Set<string>();
    const seq = new Map<string, number>();
    const todo: { key: string; p: (typeof payments)[number] }[] = [];
    let skipped = 0;
    for (const p of payments) {
      const base = postedKey(p, 0).slice(0, -2);
      const n = seq.get(base) ?? 0;
      seq.set(base, n + 1);
      const key = postedKey(p, n);
      if (keys[key] && existing.has(keys[key]!)) {
        skipped += 1;
        continue;
      }
      todo.push({ key, p });
    }
    if (todo.length === 0) return { created: 0, skipped, totalTiyin: '0', unassigned: 0, batchId: null };

    const fileName = str(input.fileName, 200) ?? 'internet.xlsx';
    const hash = createHash('sha256').update(JSON.stringify(todo.map((t) => t.key))).digest('hex');
    let unassigned = 0;
    let total = 0n;
    const created = await this.prisma.$transaction(
      async (tx) => {
        const batch = await tx.importBatch.create({
          data: { type: 'EXPENSE', status: 'COMMITTED', fileName, fileHash: hash, fileSize: 0, period: todo[0]!.p.period, totalRows: payments.length, validRows: todo.length, committedRows: todo.length, uploadedById: userId, committedAt: new Date() },
          select: { id: true },
        });
        const ids: { key: string; id: string }[] = [];
        for (const { key, p } of todo) {
          const c = p.contractNo ? (regMap.get(p.contractNo) ?? null) : null;
          const unit = this.unitFields(c?.unit ?? null);
          if (unit.regionCode === null) unassigned += 1;
          total += p.amountTiyin;
          const e = await tx.expense.create({
            data: {
              date: periodEnd(p.period),
              period: p.period,
              amountTiyin: p.amountTiyin,
              categoryCode: category,
              regionCode: unit.regionCode,
              departmentId: unit.departmentId,
              description: this.description(c, p),
              documentNo: p.contractNo,
              counterparty: c?.provider ?? null,
              paymentMethod: 'BANK',
              paymentStatus: 'PAID',
              source: 'IMPORT',
              section: 'DOIMIY',
              importBatchId: batch.id,
              createdById: userId,
            },
            select: { id: true },
          });
          ids.push({ key, id: e.id });
        }
        return { batchId: batch.id, ids };
      },
      { timeout: 60_000 },
    );
    for (const { key, id } of created.ids) keys[key] = id;
    await this.savePosted(keys);
    return { created: created.ids.length, skipped, totalTiyin: total.toString(), unassigned, batchId: created.batchId };
  }

  /** Ro'yxat o'zgargan bo'lsa — yozilgan xarajatlarning biriktirishi, kontragenti va izohi yangilanadi */
  private async applyToPosted(registry: Registry): Promise<number> {
    const keys = await this.posted();
    const ids = [...new Set(Object.values(keys))];
    if (!ids.length) return 0;
    const regMap = new Map(registry.contracts.map((c) => [c.contractNo, c]));
    const expenses = await this.prisma.expense.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, documentNo: true, period: true, regionCode: true, departmentId: true, counterparty: true, description: true } });
    let updated = 0;
    for (const e of expenses) {
      const c = e.documentNo ? regMap.get(e.documentNo) : undefined;
      if (!c) continue;
      const unit = this.unitFields(c.unit);
      const prepaid = /oldindan/.test(e.description ?? '');
      const description = this.description(c, { contractNo: e.documentNo, contractDate: c.contractDate, period: e.period, prepaid });
      if (e.regionCode === unit.regionCode && e.departmentId === unit.departmentId && e.counterparty === c.provider && e.description === description) continue;
      await this.prisma.expense.update({ where: { id: e.id }, data: { regionCode: unit.regionCode, departmentId: unit.departmentId, counterparty: c.provider, description } });
      updated += 1;
    }
    return updated;
  }

  // ─────────── Shablon ───────────

  /** Shablon: «Shartnomalar» (ro'yxat) + «To'lovlar» + «Ro'yxatlar» (bo'lim / hudud nomlari). payments berilsa — to'ldirilgan */
  async template(source?: Express.Multer.File): Promise<{ buffer: Buffer; filename: string }> {
    const [registry, lookups] = await Promise.all([this.registry(), this.lookups()]);
    let analysis: AnalysisResult | null = null;
    if (source) analysis = await this.analyze(source);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Korxona tahlil';
    const head = (ws: ExcelJS.Worksheet, color: string) => {
      const r = ws.getRow(1);
      r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
      r.alignment = { vertical: 'middle', wrapText: true };
      r.height = 32;
    };

    const kinds = ['Markaz', "Markaz bo'limi", 'Hudud'];
    const maxLen = Math.max(kinds.length, lookups.departments.length, lookups.regions.length);
    // Shartnomalar
    const reg = wb.addWorksheet('Shartnomalar', {
      views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }],
      pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    const months = analysis?.months ?? [];
    reg.columns = [
      { header: 'Shartnoma №', key: 'no', width: 18 },
      { header: 'Shartnoma sanasi', key: 'date', width: 14 },
      { header: "Kimga to'lanadi (provayder)", key: 'provider', width: 28 },
      { header: 'Nima uchun (izoh: bino, xona, xizmat)', key: 'purpose', width: 40 },
      { header: 'Biriktirish turi (Markaz / Markaz bo\'limi / Hudud)', key: 'kind', width: 22 },
      { header: "Bo'lim yoki hudud nomi", key: 'unit', width: 32 },
      ...months.map((p) => ({ header: monthText(p), key: p, width: 14 })),
      ...(months.length ? [{ header: 'Jami', key: 'total', width: 15 }, { header: 'Tahlil', key: 'notes', width: 50 }] : []),
    ];
    head(reg, 'FF1D4ED8');
    const depName = new Map(lookups.departments.map((d) => [d.id, d.name]));
    const regName = new Map(lookups.regions.map((r) => [r.code, r.name]));
    const regMap = new Map(registry.contracts.map((c) => [c.contractNo, c]));
    const order = analysis ? analysis.contracts.map((c) => c.contractNo).filter((n) => n !== '—') : [];
    for (const c of registry.contracts) if (!order.includes(c.contractNo)) order.push(c.contractNo);
    for (const no of order) {
      const c = regMap.get(no) ?? analysis?.contracts.find((x) => x.contractNo === no)?.contract ?? null;
      const sum = analysis?.contracts.find((x) => x.contractNo === no);
      const unit = c?.unit;
      const row = reg.addRow({
        no,
        date: c?.contractDate ?? sum?.contractDate ?? null,
        provider: c?.provider ?? null,
        purpose: c?.purpose ?? null,
        kind: unit ? (unit.kind === 'center' ? 'Markaz' : unit.kind === 'department' ? "Markaz bo'limi" : 'Hudud') : null,
        unit: unit?.kind === 'department' ? (depName.get(unit.departmentId) ?? null) : unit?.kind === 'region' ? (regName.get(unit.regionCode) ?? null) : null,
        ...Object.fromEntries(months.map((p) => [p, sum?.months[p] ? Number(sum.months[p]) / 100 : null])),
        ...(months.length ? { total: sum ? Number(sum.totalTiyin) / 100 : null, notes: sum?.notes.join('; ') || null } : {}),
      });
      row.alignment = { vertical: 'top', wrapText: true };
    }
    if (months.length) {
      const totalRow = reg.addRow({ no: 'JAMI', ...Object.fromEntries(months.map((p) => [p, Number(analysis!.byMonth.find((b) => b.period === p)!.totalTiyin) / 100])), total: Number(analysis!.totalTiyin) / 100 });
      totalRow.font = { bold: true };
    }
    const dataRows = reg.rowCount;
    const lastRow = Math.max(dataRows + 60, 100);
    for (let r = 2; r <= lastRow; r++) {
      if (months.length && r === dataRows) continue; // JAMI qatori
      reg.getCell(r, 5).dataValidation = { type: 'list', allowBlank: true, formulae: [`'Ro''yxatlar'!$A$2:$A$4`] };
      if (lookups.departments.length + lookups.regions.length > 0) reg.getCell(r, 6).dataValidation = {
        type: 'list',
        allowBlank: true,
        showErrorMessage: false,
        formulae: [`'Ro''yxatlar'!$B$2:$C$${maxLen + 1}`],
      };
      for (const c of [3, 4, 5, 6]) reg.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } };
    }
    for (let i = 0; i < months.length + 1; i++) reg.getColumn(7 + i).numFmt = '#,##0.00';

    // To'lovlar
    const pay = wb.addWorksheet("To'lovlar", { views: [{ state: 'frozen', ySplit: 1 }] });
    pay.columns = [
      { header: 'Oy (2026-05 yoki May)', key: 'period', width: 14 },
      { header: "Summa (so'm)", key: 'amount', width: 16 },
      { header: "To'lov izohi (bankdagi matn)", key: 'text', width: 90 },
      { header: 'Shartnoma № (izohda bo\'lmasa)', key: 'no', width: 18 },
    ];
    head(pay, 'FFDC2626');
    pay.getColumn(2).numFmt = '#,##0.00';
    if (analysis) {
      for (const p of analysis.payments) pay.addRow({ period: p.period, amount: Number(p.amountTiyin) / 100, text: p.text, no: p.contractNo });
    } else {
      const sample = pay.addRow({ period: '2026-05', amount: 879000, text: '00668 100% оплата за интернет услуг май 2026г сог.дог№1930794980 от 03.01.2025 г.', no: null });
      sample.font = { italic: true, color: { argb: 'FF94A3B8' } };
    }

    // Ro'yxatlar — tanlash uchun manba
    const lists = wb.addWorksheet("Ro'yxatlar");
    lists.columns = [
      { header: 'Biriktirish turi', key: 'kind', width: 20 },
      { header: "Markaz bo'limlari", key: 'dep', width: 40 },
      { header: 'Hududlar', key: 'reg', width: 34 },
    ];
    head(lists, 'FF475569');
    for (let i = 0; i < maxLen; i++) lists.addRow({ kind: kinds[i] ?? null, dep: lookups.departments[i]?.name ?? null, reg: lookups.regions[i]?.name ?? null });

    // Yo'riqnoma
    const help = wb.addWorksheet("Yo'riqnoma");
    help.getColumn(1).width = 110;
    [
      "Internet to'lovlari shabloni",
      '',
      "1. «Shartnomalar» — har shartnoma uchun: kimga to'lanadi, nima uchun, qayerga biriktiriladi (sariq ustunlar).",
      "   Biriktirish turi: Markaz — Markazning umumiy xarajati; Markaz bo'limi — tanlangan bo'lim; Hudud — tanlangan hudud.",
      "   Bo'lim / hudud nomi «Ro'yxatlar» varag'idagi kabi yozilsin (tanlash ro'yxati bor).",
      "2. «To'lovlar» — har oy to'lovlari: oy, summa, bankdagi to'lov izohi. Shartnoma raqami izohdan o'zi olinadi.",
      "   Bank ro'yxatini (Yanvar | Yanvar … — summa | shartnoma ustunlari bilan) ham to'g'ridan-to'g'ri yuklash mumkin.",
      "3. Xarajatlar › Internet sahifasida faylni yuklang: tahlil, o'zgarishlar va biriktirish ko'rinadi, so'ng «Xarajat sifatida saqlash».",
      "   Qayta yuklansa — avval yozilgan to'lovlar ikki marta yozilmaydi.",
    ].forEach((t, i) => {
      const r = help.addRow([t]);
      if (i === 0) r.font = { bold: true, size: 14 };
    });

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const stamp = new Date(Date.now() + TASHKENT_MS).toISOString().slice(0, 10);
    return { buffer, filename: `Internet-shartnomalar-${stamp}.xlsx` };
  }
}