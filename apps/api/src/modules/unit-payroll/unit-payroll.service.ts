import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { createHash, randomUUID } from 'node:crypto';
import { ENTRY_UNIT_CODES, entryUnitLabel, isSegment } from '../../common/segments/segments';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { monthLabel, monthsBetween } from '../../common/period';
import { ensurePayrollPartCategories, payrollPartCategory, readPolicy } from '../expense-policy/policy.util';
import { hrPeople, hrUnitStaff } from '../hr-sheets/hr-sheets.store';
import { assertSafeXlsx } from '../../common/files/xlsx-guard';
import { Exclusive } from '../../common/locks';
import { somToTiyin } from '../../common/money';
import { listBlock, ObjectMap, shapeOf } from '../../common/settings/shape';
import { assertAmount } from '../../common/validation/amount';
import { isNdflWorkbook, parseNdfl, type NdflResult } from '../payroll/ndfl.parser';

// ═══════════════════════════════════════════════════════════
// Bo'lim (yo'nalish) ish haqi — masalan, Xarajatlar › Tax free › Ish haqi.
//
// Umumiy vedomostdan ALOHIDA:
//  • Shablon — avvalgidek: 1-varaq «Ish haqi» (PINFL, Summa), 2-varaq — FAQAT shu bo'lim xodimlari.
//  • Xodimlar bo'limi (umumiy baza) bilan bog'langan: shu yo'nalish bo'limidagi (masalan, «Tax free») va lavozimida
//    yo'nalish nomi bor faol xodimlar ro'yxatga o'zi tushadi — Xodimlarda yangi xodim qo'shilsa, keyingi shablonda chiqadi.
//    Qaysi bo'limlar — avtomatik (nomi bo'yicha) yoki Ish haqi sahifasida «Bog'lash»da tanlanadi.
//  • Ma'lumotnomalar (Xodimlar › 10/16/37/51-jadval) ham «miya»ni oziqlaydi: tuzilmasi shu yo'nalishga tegishli
//    (masalan, «… Fermer xo'jaliklarida buxgalteriya hisobi …») va ishlayotgan xodimlar ro'yxatga o'zi tushadi;
//    Xodimlar bazasida yo'q PINFL'ning nomi va lavozimi ham shu jadvallardan olinadi.
//  • Bo'lim xodimlari ro'yxatini tizim o'zi yuritadi («miya»): vedomostda yangi PINFL kelsa — saqlanganda
//    ro'yxatga qo'shiladi va keyingi shablonning 2-varag'ida chiqadi. Qo'lda qo'shish / chiqarish ham bor.
//  • Saqlanganda — bitta xarajat yozuvi: shu yo'nalish (segment), modda «Ish haqi» (PAYROLL_BASE).
//  • Bazaga migratsiya kerak emas: ro'yxat va vedomost tafsiloti `settings` jadvalida.
// ═══════════════════════════════════════════════════════════

const STAFF_KEY = 'unit.staff';
const LINK_KEY = 'unit.staffLink';

/** Xodimlar bazasidagi bo'lim / lavozim nomi bo'yicha avtomatik bog'lash */
const NAME_PATTERNS: Record<string, RegExp> = {
  TAX_FREE: /tax\s*-?\s*free|такс\s*-?\s*фри|taks\s*-?\s*fri/i,
  MARKSHEYDER: /marksheyder|маркшейдер/i,
  FERMER: /fermer|фермер/i,
  BUXGALTERIYA: /buxgalteriya\s+xizmat|бухгалтерия\s+хизмат/i,
};

export interface StaffLink {
  /** Tanlangan bo'limlar (null — avtomatik: nomi bo'yicha) */
  departmentIds: string[] | null;
  /** Lavozimida yo'nalish nomi bor xodimlar ham (masalan, «Tax free operatori») */
  byPosition: boolean;
  /** Ma'lumotnomalardan (10/16/37/51-jadval) — tuzilmasi shu yo'nalishga tegishlilar ham */
  byHr: boolean;
}
const PAYROLL_CATEGORY = 'PAYROLL_BASE';
const TASHKENT_OFFSET_HOURS = 5;
const MAX_ROWS = 5000;
/** Shablondagi yashirin oy kodlari qatori belgisi */
const CODE_MARK = 'KOD';
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface StaffItem {
  pinfl: string;
  fullName: string;
  position: string | null;
  /** Faol — shablonning 2-varag'ida chiqadi */
  active: boolean;
  addedAt: string;
  /** Qanday qo'shilgan: vedomostdan (avtomatik), qo'lda, Xodimlar bazasidan (bo'limi bo'yicha) yoki boshqa bo'limdan ko'chib kelgan */
  source: 'UPLOAD' | 'MANUAL' | 'REGISTRY' | 'MOVE';
  leftAt: string | null;
}

/**
 * Bo'limlar o'rtasida ko'chish («miya» tarixi): xodim shu oydan boshlab qaysi bo'limda.
 * Masalan: Aliyev yanvar–mart — Tax free, apreldan — Markaz. Bo'lim — 7 ta (Markaz, Hududlar va yo'nalishlar).
 * Oy uchun bo'lim: o'sha oygacha (shu oy ham) bo'lgan eng so'nggi ko'chish; ko'chish yo'q — odatdagi qoida
 * (bo'lim ro'yxati va Xodimlar bazasi bilan bog'lanish).
 */
export interface UnitMove {
  id: string;
  pinfl: string;
  fullName: string;
  /** Qaysi bo'limga (ENTRY_UNIT kodi) */
  unit: string;
  /** Shu oydan boshlab (YYYY-MM) */
  from: string;
  note: string | null;
  /** MANUAL — qo'lda; UPLOAD — vedomost saqlanganda (boshqa bo'limdagi xodim shu bo'lim vedomostida) */
  source: 'MANUAL' | 'UPLOAD';
  createdAt: string;
  createdBy: string;
}

const MOVES_KEY = 'unit.moves';
const PERIOD_RX = /^\d{4}-(0[1-9]|1[0-2])$/;

const isMove = (m: Partial<UnitMove> | null | undefined): m is UnitMove =>
  Boolean(m && typeof m.id === 'string' && typeof m.pinfl === 'string' && typeof m.unit === 'string' && ENTRY_UNIT_CODES.includes(m.unit) && typeof m.from === 'string' && PERIOD_RX.test(m.from));

function readMoves(raw: unknown): UnitMove[] {
  const list = (raw as { moves?: unknown } | null)?.moves;
  if (!Array.isArray(list)) return [];
  return (list as Partial<UnitMove>[]).filter(isMove);
}

/** Yozishdan oldin: tanilmagan yozuvlar ham (masalan olib tashlangan bo'lim kodi) saqlanib qolsin — jim o'chmasin */
function foreignMoves(raw: unknown): unknown[] {
  const list = (raw as { moves?: unknown } | null)?.moves;
  return Array.isArray(list) ? list.filter((m) => !isMove(m as Partial<UnitMove>)) : [];
}

/** Xodim → shu oydagi bo'limi (ko'chishlar bo'yicha; ko'chish bo'lmasa — undefined) */
export function membership(moves: UnitMove[]): (pinfl: string, period: string) => string | undefined {
  const by = new Map<string, UnitMove[]>();
  for (const m of moves) by.set(m.pinfl, [...(by.get(m.pinfl) ?? []), m]);
  for (const list of by.values()) list.sort((a, b) => a.from.localeCompare(b.from) || a.createdAt.localeCompare(b.createdAt));
  return (pinfl, period) => {
    const list = by.get(pinfl);
    if (!list) return undefined;
    let out: string | undefined;
    for (const m of list) if (m.from <= period) out = m.unit;
    return out;
  };
}

/** Joriy oy (Toshkent) */
function currentPeriod(): string {
  return new Date(Date.now() + TASHKENT_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 7);
}

export interface UnitPayrollRow {
  pinfl: string;
  fullName: string;
  amountTiyin: string;
}

export interface UnitPayrollBatch {
  id: string;
  period: string;
  fileName: string;
  fileHash: string;
  status: 'COMMITTED' | 'CANCELLED';
  createdAt: string;
  cancelledAt: string | null;
  uploadedById: string;
  uploadedBy: string;
  totalTiyin: string;
  count: number;
  zeroCount: number;
  /** Shu yuklashdan qo'shilgan yangi xodimlar soni */
  newStaff: number;
  expenseId: string | null;
  rows: UnitPayrollRow[];
  /** GENERAL — umumiy vedomost (Xarajatlar › Ish haqi) yuklanganda avtomatik yaratilgan */
  origin?: 'GENERAL';
  /** Umumiy vedomost yuklashi (bekor qilinsa — bu ham bekor bo'ladi); hamma qatorlar bo'limga tushsa — null */
  generalBatchId?: string | null;
}

/** Ish haqi sahifasi bor bo'limlar (umumiy vedomostdan avtomatik taqsimlanadi) */
export const PAYROLL_UNITS = ['TAX_FREE', 'FERMER', 'BUXGALTERIYA', 'MARKSHEYDER'] as const;
/** Ish haqini o'tkazish mumkin bo'lgan joylar: Markaz, Hududlar va ish haqi yuritiladigan yo'nalishlar (Qo'mita — yo'q) */
export const MOVE_TARGETS: string[] = ['CENTER', 'REGION', ...PAYROLL_UNITS];
export type PayrollUnit = (typeof PAYROLL_UNITS)[number];
export const isPayrollUnit = (u: unknown): u is PayrollUnit => typeof u === 'string' && (PAYROLL_UNITS as readonly string[]).includes(u);

/** Tahlilda qator holati */
export type RowStatus = 'KNOWN' | 'RETURNING' | 'REGISTRY' | 'NEW';

const payrollKey = (unit: string, period: string) => `unit.payroll.${unit}.${period}`;

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === 'object') {
    const record = value as unknown as Record<string, unknown>;
    if ('result' in record) return record.result;
    if ('text' in record) return record.text;
    if ('richText' in record && Array.isArray(record.richText)) return (record.richText as { text: string }[]).map((p) => p.text).join('');
  }
  return value;
}

const isBlank = (v: unknown) => v === null || v === undefined || String(v).trim() === '';

function parsePinfl(v: unknown): string | null {
  if (isBlank(v)) return null;
  const digits = String(v).replace(/\D/g, '');
  return /^\d{14}$/.test(digits) ? digits : null;
}

/** Bo'sh yoki 0 — hisoblanmagan (0). Manfiy yoki matn — null (xato) */
function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length >= 3 && s.length <= 150 ? s : null;
}

function cleanPosition(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 120) : null;
}

function readStaff(raw: unknown): StaffItem[] {
  if (!Array.isArray(raw)) return [];
  const out: StaffItem[] = [];
  const seen = new Set<string>();
  for (const r of raw as Partial<StaffItem>[]) {
    if (!r || typeof r.pinfl !== 'string' || !/^\d{14}$/.test(r.pinfl) || seen.has(r.pinfl)) continue;
    seen.add(r.pinfl);
    out.push({
      pinfl: r.pinfl,
      fullName: typeof r.fullName === 'string' && r.fullName ? r.fullName : r.pinfl,
      position: typeof r.position === 'string' ? r.position : null,
      active: r.active !== false,
      addedAt: typeof r.addedAt === 'string' ? r.addedAt : new Date(0).toISOString(),
      source: r.source === 'MANUAL' || r.source === 'REGISTRY' ? r.source : 'UPLOAD',
      leftAt: typeof r.leftAt === 'string' ? r.leftAt : null,
    });
  }
  return out;
}

function readBatches(raw: unknown): UnitPayrollBatch[] {
  const list = (raw as { batches?: unknown } | null)?.batches;
  return Array.isArray(list) ? (list as UnitPayrollBatch[]) : [];
}

@Injectable()
export class UnitPayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ═══════════ Yordamchilar ═══════════

  unitOf(raw: unknown): string {
    if (isSegment(raw)) return raw;
    throw new BadRequestException("Bo'lim noto'g'ri — ish haqi faqat yo'nalishlar (Tax free …) uchun");
  }

  private assertPeriod(period: string): void {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? '')) throw new BadRequestException("Davr noto'g'ri formatda (YYYY-MM)");
  }

  /** Davr oxirgi kuni — xarajat sanasi */
  private periodEndDate(period: string): Date {
    const [y, m] = period.split('-').map(Number) as [number, number];
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    return new Date(Date.UTC(ny, nm - 1, 1, -TASHKENT_OFFSET_HOURS) - 86_400_000);
  }

  private async readSetting(key: string): Promise<unknown> {
    return (await this.prisma.setting.findUnique({ where: { key } }))?.value ?? null;
  }

  /** O'qish + tashqi tuzilma tekshiruvi (buzilgan bo'lsa — xato, ustidan yozilmaydi) */
  private async readShaped(key: string, kind: 'map' | 'moves' | 'batches'): Promise<unknown> {
    const raw = await this.readSetting(key);
    return shapeOf(key, raw, kind === 'map' ? ObjectMap : listBlock(kind));
  }

  private async writeSetting(key: string, value: unknown): Promise<void> {
    const v = value as object;
    await this.prisma.setting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
  }

  /** Bo'limning o'z ro'yxati (qo'lda, vedomostdan va bazadagilarni «chiqarish» belgilari) — yozish uchun */
  private async ownStaff(unit: string): Promise<StaffItem[]> {
    const all = ((await this.readShaped(STAFF_KEY, 'map')) ?? {}) as Record<string, unknown>;
    return readStaff(all[unit]);
  }

  // ─────────── Xodimlar bazasi bilan bog'lash ───────────

  async linkOf(unit: string): Promise<StaffLink> {
    const all = ((await this.readShaped(LINK_KEY, 'map')) ?? {}) as Record<string, Partial<StaffLink> | undefined>;
    const v = all[unit] ?? {};
    return {
      departmentIds: Array.isArray(v.departmentIds) ? v.departmentIds.filter((x): x is string => typeof x === 'string') : null,
      byPosition: v.byPosition !== false,
      byHr: v.byHr !== false,
    };
  }

  /** Bog'langan bo'limlar: tanlangan yoki (avtomatik) nomida yo'nalish nomi borlar */
  private async linkedDepartments(unit: string, link: StaffLink): Promise<{ id: string; name: string }[]> {
    const deps = await this.prisma.department.findMany({ select: { id: true, name: true } });
    if (link.departmentIds) return deps.filter((d) => link.departmentIds!.includes(d.id));
    const re = NAME_PATTERNS[unit];
    return re ? deps.filter((d) => re.test(d.name)) : [];
  }

  /** Xodimlar bazasidagi shu yo'nalish xodimlari (faol): bog'langan bo'limda yoki lavozimida yo'nalish nomi bor */
  private async registryStaff(unit: string): Promise<{ pinfl: string; fullName: string; position: string | null }[]> {
    const link = await this.linkOf(unit);
    const deps = await this.linkedDepartments(unit, link);
    const re = NAME_PATTERNS[unit];
    const or: Record<string, unknown>[] = [];
    if (deps.length) or.push({ departmentId: { in: deps.map((d) => d.id) } });
    // Lavozim bo'yicha: lavozimi yozilganlar olinadi, naqsh bilan tekshiriladi (kirill/lotin yozilishlari)
    if (link.byPosition && re) or.push({ position: { not: null } });
    const rows = or.length
      ? await this.prisma.employee.findMany({
          where: { isActive: true, OR: or },
          select: { pinfl: true, fullName: true, position: true, departmentId: true },
        })
      : [];
    const depIds = new Set(deps.map((d) => d.id));
    const out = rows
      .filter((r) => (r.departmentId && depIds.has(r.departmentId)) || (link.byPosition && re && r.position && re.test(r.position)))
      .map((r) => ({ pinfl: r.pinfl, fullName: r.fullName, position: r.position ?? null }));
    if (link.byHr) {
      // Ma'lumotnomalardan: tuzilmasi shu yo'nalishga tegishli, ishlayotganlar (Xodimlar bazasida arxivda bo'lsa — olinmaydi)
      const have = new Set(out.map((r) => r.pinfl));
      const hr = (await hrUnitStaff(this.prisma, unit)).filter((p) => !have.has(p.pinfl));
      if (hr.length) {
        const archived = new Set(
          (await this.prisma.employee.findMany({ where: { pinfl: { in: hr.map((p) => p.pinfl) }, isActive: false }, select: { pinfl: true } })).map((e) => e.pinfl),
        );
        for (const p of hr) if (!archived.has(p.pinfl)) out.push({ pinfl: p.pinfl, fullName: p.fullName, position: p.position });
      }
    }
    return out;
  }

  /**
   * Bo'lim xodimlari (o'qish uchun): Xodimlar bazasidan bog'langanlar + o'z ro'yxati.
   * O'z ro'yxatida «chiqarilgan» (active=false) bo'lsa — bazada bo'lsa ham chiqmaydi.
   */
  async staffOf(unit: string, period: string = currentPeriod(), applyMoves = true): Promise<StaffItem[]> {
    const own = await this.ownStaff(unit);
    const have = new Set(own.map((s) => s.pinfl));
    const out = [...own];
    for (const e of await this.registryStaff(unit)) {
      if (have.has(e.pinfl)) continue;
      out.push({ pinfl: e.pinfl, fullName: e.fullName, position: e.position, active: true, addedAt: '', source: 'REGISTRY', leftAt: null });
    }
    // Ko'chishlar («miya» tarixi): shu oyda boshqa bo'limda bo'lganlar chiqmaydi, shu bo'limga ko'chib kelganlar qo'shiladi
    const moves = applyMoves ? await this.allMoves() : [];
    if (!moves.length) return out;
    const at = membership(moves);
    const kept = out.filter((s) => {
      const u = at(s.pinfl, period);
      return u === undefined || u === unit;
    });
    const keptPins = new Set(kept.map((s) => s.pinfl));
    const incoming = [...new Set(moves.filter((m) => m.unit === unit && !keptPins.has(m.pinfl)).map((m) => m.pinfl))].filter((p) => at(p, period) === unit);
    if (incoming.length) {
      const names = await this.registryNames(incoming);
      for (const p of incoming) {
        const last = moves.filter((m) => m.pinfl === p && m.unit === unit && m.from <= period).sort((a, b) => b.from.localeCompare(a.from))[0]!;
        kept.push({ pinfl: p, fullName: names.get(p)?.fullName ?? last.fullName, position: names.get(p)?.position ?? null, active: true, addedAt: last.createdAt, source: 'MOVE', leftAt: null });
      }
    }
    return kept;
  }

  // ─────────── Ko'chishlar (bo'limlar o'rtasida) ───────────

  async allMoves(): Promise<UnitMove[]> {
    return readMoves(await this.readShaped(MOVES_KEY, 'moves'));
  }

  /** Ko'chishdan oldingi «odatdagi» bo'limi: yo'nalish ro'yxati / bog'lanishi bo'yicha, bo'lmasa Xodimlar bazasidagi joyi */
  private async baseUnits(pinfls: string[], period: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!pinfls.length) return out;
    const want = new Set(pinfls);
    for (const seg of ENTRY_UNIT_CODES.filter((c) => isSegment(c))) {
      for (const s of await this.staffOf(seg, period, false)) if (want.has(s.pinfl) && s.active && !out.has(s.pinfl)) out.set(s.pinfl, seg);
    }
    const rest = pinfls.filter((p) => !out.has(p));
    if (rest.length) {
      const emps = await this.prisma.employee.findMany({ where: { pinfl: { in: rest } }, select: { pinfl: true, regionCode: true } });
      for (const e of emps) if (e.regionCode !== null && e.regionCode !== undefined) out.set(e.pinfl, e.regionCode === 0 ? 'CENTER' : 'REGION');
    }
    return out;
  }

  /** Ko'chishlar ro'yxati: bo'lim bo'yicha (shu bo'limga kelgan yoki ketgan) yoki xodim bo'yicha; har birida — qayerdan */
  async moves(filter: { unit?: string; pinfl?: string } = {}) {
    const all = await this.allMoves();
    const at = membership(all);
    const prevPeriod = (p: string) => {
      const [y, m] = p.split('-').map(Number) as [number, number];
      return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    };
    const firstOf = new Map<string, string>();
    for (const m of all) if (!firstOf.has(m.pinfl) || m.from < firstOf.get(m.pinfl)!) firstOf.set(m.pinfl, m.from);
    // Birinchi ko'chishdan oldin — odatdagi bo'limi
    const base = new Map<string, string>();
    for (const [pinfl, first] of firstOf) {
      const b = await this.baseUnits([pinfl], prevPeriod(first));
      if (b.has(pinfl)) base.set(pinfl, b.get(pinfl)!);
    }
    const list = all
      .map((m) => {
        const before = at(m.pinfl, prevPeriod(m.from)) ?? base.get(m.pinfl);
        return { ...m, unitLabel: entryUnitLabel(m.unit), fromUnit: before ?? null, fromUnitLabel: before ? entryUnitLabel(before) : null };
      })
      .filter((m) => (!filter.pinfl || m.pinfl === filter.pinfl) && (!filter.unit || m.unit === filter.unit || m.fromUnit === filter.unit))
      .sort((a, b) => b.from.localeCompare(a.from) || b.createdAt.localeCompare(a.createdAt));
    return { items: list, units: ENTRY_UNIT_CODES.map((c) => ({ code: c, label: entryUnitLabel(c) })) };
  }

  /**
   * Ko'chirish: xodim «from» oydan boshlab «unit» bo'limida. Eski oylar o'zgarmaydi (o'sha oylardagi bo'limi saqlanadi).
   * Shu oyda shu xodimga boshqa ko'chish bo'lsa — almashtiriladi. «from» dagi bo'limi allaqachon shu bo'lsa — rad etiladi.
   */
  @Exclusive('unit-payroll')
  async addMove(body: { pinfl?: unknown; unit?: unknown; from?: unknown; note?: unknown; fullName?: unknown }, userId: string, source: UnitMove['source'] = 'MANUAL'): Promise<UnitMove> {
    const pinfl = parsePinfl(body?.pinfl);
    if (!pinfl) throw new BadRequestException("PINFL 14 ta raqam bo'lishi kerak");
    const unit = typeof body?.unit === 'string' && ENTRY_UNIT_CODES.includes(body.unit) ? body.unit : null;
    if (!unit) throw new BadRequestException("Bo'limni tanlang");
    const from = typeof body?.from === 'string' && PERIOD_RX.test(body.from) ? body.from : null;
    if (!from) throw new BadRequestException("Oyni tanlang (YYYY-MM)");
    const raw = await this.readShaped(MOVES_KEY, 'moves');
    const all = readMoves(raw);
    const reg = (await this.registryNames([pinfl])).get(pinfl);
    const fullName = reg?.fullName ?? cleanName(body?.fullName) ?? all.find((m) => m.pinfl === pinfl)?.fullName ?? pinfl;
    const rest = all.filter((m) => !(m.pinfl === pinfl && m.from === from));
    const before = membership(rest)(pinfl, from);
    if (before === unit) throw new BadRequestException(`${fullName} — ${monthLabel(from)}da allaqachon «${entryUnitLabel(unit)}» bo'limida`);
    const move: UnitMove = {
      id: randomUUID(),
      pinfl,
      fullName,
      unit,
      from,
      note: typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 300) : null,
      source,
      createdAt: new Date().toISOString(),
      createdBy: userId,
    };
    await this.writeSetting(MOVES_KEY, { moves: [...foreignMoves(raw), ...rest, move] });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'unit_move', entityId: pinfl, summary: `${fullName}: ${monthLabel(from)}dan «${entryUnitLabel(unit)}» bo'limida${before ? ` (oldin — ${entryUnitLabel(before)})` : ''}${source === 'UPLOAD' ? ' · vedomostdan' : ''}` });
    return move;
  }

  @Exclusive('unit-payroll')
  async removeMove(id: string, userId: string) {
    const raw = await this.readShaped(MOVES_KEY, 'moves');
    const all = readMoves(raw);
    const m = all.find((x) => x.id === id);
    if (!m) throw new NotFoundException("Ko'chish topilmadi");
    await this.writeSetting(MOVES_KEY, { moves: [...foreignMoves(raw), ...all.filter((x) => x.id !== id)] });
    await this.audit.log({ userId, action: 'DELETE', entity: 'unit_move', entityId: m.pinfl, summary: `${m.fullName}: ${monthLabel(m.from)}dan «${entryUnitLabel(m.unit)}» — ko'chish bekor qilindi` });
    return { success: true as const, id };
  }

  /** Bog'lash sozlamasi va ko'rinishi: bo'limlar (tanlangani, xodimlar soni) */
  async link(unit: string) {
    const link = await this.linkOf(unit);
    const [deps, counts, linked] = await Promise.all([
      this.prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.employee.groupBy({ by: ['departmentId'], where: { isActive: true }, _count: { _all: true } }).catch(() => [] as { departmentId: string | null; _count: { _all: number } }[]),
      this.linkedDepartments(unit, link),
    ]);
    const count = new Map(counts.map((c) => [c.departmentId, c._count._all]));
    const on = new Set(linked.map((d) => d.id));
    return {
      unit,
      label: entryUnitLabel(unit),
      auto: link.departmentIds === null,
      byPosition: link.byPosition,
      byHr: link.byHr,
      hrCount: link.byHr ? (await hrUnitStaff(this.prisma, unit)).length : 0,
      departments: deps.map((d) => ({ id: d.id, name: d.name, employees: count.get(d.id) ?? 0, selected: on.has(d.id) })),
      linkedCount: (await this.registryStaff(unit)).length,
    };
  }

  @Exclusive('unit-payroll')
  async setLink(unit: string, body: { departmentIds?: unknown; byPosition?: unknown; byHr?: unknown }, userId: string) {
    const all = { ...(((await this.readShaped(LINK_KEY, 'map')) ?? {}) as Record<string, unknown>) };
    const prev = await this.linkOf(unit);
    let departmentIds: string[] | null = prev.departmentIds;
    if (body?.departmentIds === null) departmentIds = null;
    else if (Array.isArray(body?.departmentIds)) {
      const ids = [...new Set(body.departmentIds.filter((x): x is string => typeof x === 'string'))].slice(0, 200);
      const found = await this.prisma.department.findMany({ where: { id: { in: ids } }, select: { id: true } });
      if (found.length !== ids.length) throw new BadRequestException("Bo'lim topilmadi");
      departmentIds = ids;
    }
    const value: StaffLink = {
      departmentIds,
      byPosition: typeof body?.byPosition === 'boolean' ? body.byPosition : prev.byPosition,
      byHr: typeof body?.byHr === 'boolean' ? body.byHr : prev.byHr,
    };
    all[unit] = value;
    await this.writeSetting(LINK_KEY, all);
    await this.audit.log({ userId, action: 'UPDATE', entity: 'unit_staff_link', entityId: unit, summary: `${entryUnitLabel(unit)} xodimlari — Xodimlar bazasi bilan bog'lash: ${departmentIds === null ? 'avtomatik' : `${departmentIds.length} ta bo'lim`}${value.byPosition ? ', lavozim bo\'yicha ham' : ''}${value.byHr ? ", ma'lumotnomalardan ham" : ''}` });
    return this.link(unit);
  }

  private async saveStaff(unit: string, items: StaffItem[]): Promise<void> {
    const all = { ...(((await this.readShaped(STAFF_KEY, 'map')) ?? {}) as Record<string, unknown>) };
    all[unit] = items;
    await this.writeSetting(STAFF_KEY, all);
  }

  private async batchesOf(unit: string, period: string): Promise<UnitPayrollBatch[]> {
    return readBatches(await this.readShaped(payrollKey(unit, period), 'batches'));
  }

  /**
   * Shu oy saqlangan vedomost(lar) bo'yicha xodim → summa (ish haqi tarkibi bilan solishtirish uchun).
   * Saqlangan vedomost yo'q bo'lsa — null.
   */
  async payrollMap(unit: string, period: string): Promise<Map<string, bigint> | null> {
    this.assertPeriod(period);
    const committed = (await this.batchesOf(unit, period)).filter((b) => b.status === 'COMMITTED');
    if (!committed.length) return null;
    const map = new Map<string, bigint>();
    for (const b of committed) for (const r of b.rows ?? []) map.set(r.pinfl, (map.get(r.pinfl) ?? 0n) + BigInt(r.amountTiyin));
    return map;
  }

  /** Xodimlar bazasidagi (umumiy reestr) ismlar — bo'lsa */
  /** PINFL → nomi va lavozimi: Xodimlar bazasidan, bo'lmasa — ma'lumotnomalardan («miya») */
  private async registryNames(pinfls: string[]): Promise<Map<string, { fullName: string; position: string | null }>> {
    if (!pinfls.length) return new Map();
    const rows = await this.prisma.employee.findMany({ where: { pinfl: { in: pinfls } }, select: { pinfl: true, fullName: true, position: true } });
    const out = new Map(rows.map((r) => [r.pinfl, { fullName: r.fullName, position: r.position ?? null }]));
    if (out.size < pinfls.length) {
      const hr = await hrPeople(this.prisma).catch(() => new Map());
      for (const p of pinfls) {
        const h = hr.get(p);
        if (!out.has(p) && h) out.set(p, { fullName: h.fullName, position: h.position });
      }
    }
    return out;
  }

  // ═══════════ Umumiy vedomost bilan bog'lanish ═══════════

  /** F.I.Sh. va lavozim: Xodimlar bazasi, ma'lumotnomalar, bo'limlarning o'z ro'yxatlari */
  async namesFor(pinfls: string[], period: string = currentPeriod()): Promise<Map<string, { fullName: string; position: string | null }>> {
    const out = await this.registryNames(pinfls);
    if (out.size < pinfls.length) {
      const want = new Set(pinfls.filter((p) => !out.has(p)));
      for (const unit of PAYROLL_UNITS) {
        if (!want.size) break;
        for (const s of await this.staffOf(unit, period, false)) {
          if (want.has(s.pinfl) && s.fullName && s.fullName !== s.pinfl) {
            out.set(s.pinfl, { fullName: s.fullName, position: s.position });
            want.delete(s.pinfl);
          }
        }
      }
    }
    return out;
  }

  /**
   * Shu oyda har xodim qaysi bo'limda: avval ko'chishlar («miya» tarixi), bo'lmasa — yo'nalish ro'yxatlari
   * (bog'langan bo'lim, lavozim, ma'lumotnomalar, qo'lda qo'shilgan), bo'lmasa — Xodimlar bazasi (Markaz / Hududlar).
   * Hech qayerda topilmasa — xaritada yo'q.
   */
  async unitsAt(pinfls: string[], period: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!pinfls.length) return out;
    const at = membership(await this.allMoves());
    const base = await this.baseUnits(pinfls, period);
    for (const p of pinfls) {
      const u = at(p, period) ?? base.get(p);
      if (u) out.set(p, u);
    }
    return out;
  }

  /**
   * Shu oy bo'limlar sahifasida (qo'lda) yuklangan ish haqi: xodim → bo'lim va summa.
   * Umumiy vedomostdan avtomatik yaratilgan yuklashlar hisobga olinmaydi.
   */
  async uploadedIn(period: string): Promise<Map<string, { unit: string; amountTiyin: bigint }>> {
    const out = new Map<string, { unit: string; amountTiyin: bigint }>();
    for (const unit of PAYROLL_UNITS) {
      for (const b of await this.batchesOf(unit, period)) {
        if (b.status !== 'COMMITTED' || b.origin === 'GENERAL') continue;
        for (const r of b.rows ?? []) {
          const x = out.get(r.pinfl);
          if (x && x.unit !== unit) continue; // birinchi topilgan bo'lim
          out.set(r.pinfl, { unit, amountTiyin: (x?.amountTiyin ?? 0n) + BigInt(r.amountTiyin) });
        }
      }
    }
    return out;
  }

  /** Shu oy hamma bo'limlar yuklashlari (nazorat uchun: saqlangan va bekor qilingan) */
  async allBatches(period: string): Promise<{ unit: string; batch: UnitPayrollBatch }[]> {
    const out: { unit: string; batch: UnitPayrollBatch }[] = [];
    for (const unit of PAYROLL_UNITS) for (const b of await this.batchesOf(unit, period)) out.push({ unit, batch: b });
    return out;
  }

  /** Umumiy vedomostdan (shu yuklashdan) bo'limlarga yozilgan qatorlar — qayta taqsimlash uchun */
  async generalRows(period: string, generalBatchId: string): Promise<{ unit: string; pinfl: string; fullName: string; amountTiyin: string }[]> {
    const out: { unit: string; pinfl: string; fullName: string; amountTiyin: string }[] = [];
    for (const unit of PAYROLL_UNITS) {
      for (const b of await this.batchesOf(unit, period)) {
        if (b.status !== 'COMMITTED' || b.origin !== 'GENERAL' || b.generalBatchId !== generalBatchId) continue;
        for (const r of b.rows ?? []) out.push({ unit, pinfl: r.pinfl, fullName: r.fullName, amountTiyin: String(r.amountTiyin) });
      }
    }
    return out;
  }

  /** Umumiy vedomost yuklashi bekor qilinganda — undan yaratilgan bo'lim yuklashlari ham bekor */
  async cancelByGeneral(generalBatchId: string, period: string, userId: string): Promise<number> {
    let n = 0;
    for (const unit of PAYROLL_UNITS) {
      for (const b of await this.batchesOf(unit, period)) {
        if (b.status === 'COMMITTED' && b.origin === 'GENERAL' && b.generalBatchId === generalBatchId) {
          await this.cancel(unit, period, b.id, userId);
          n += 1;
        }
      }
    }
    return n;
  }

  /** Shu oy umumiy yoki hududlar vedomostida (saqlangan) bor xodimlar */
  private async inGeneral(period: string, pinfls: string[]): Promise<Set<string>> {
    if (!pinfls.length) return new Set();
    const rows = await this.prisma.payrollEntry
      .findMany({ where: { period, employeePinfl: { in: pinfls }, batch: { status: 'COMMITTED' } }, select: { employeePinfl: true } })
      .catch(() => [] as { employeePinfl: string }[]);
    const out = new Set(rows.map((r) => r.employeePinfl));
    // Umumiy soliq hisobotidan bo'limlarga (miya bo'yicha) yozilganlar ham — o'sha hisobotda bor
    const want = new Set(pinfls);
    for (const unit of PAYROLL_UNITS)
      for (const b of await this.batchesOf(unit, period)) if (b.status === 'COMMITTED' && b.origin === 'GENERAL') for (const r of b.rows ?? []) if (want.has(r.pinfl)) out.add(r.pinfl);
    return out;
  }

  // ═══════════ Xodimlar ro'yxati ═══════════

  async staff(unit: string, periodRaw?: string) {
    const period = periodRaw && PERIOD_RX.test(periodRaw) ? periodRaw : currentPeriod();
    const items = await this.staffOf(unit, period);
    const names = await this.registryNames(items.map((i) => i.pinfl));
    const moves = await this.allMoves();
    const timeline = (pinfl: string) =>
      moves
        .filter((m) => m.pinfl === pinfl)
        .sort((a, b) => a.from.localeCompare(b.from))
        .map((m) => ({ id: m.id, unit: m.unit, unitLabel: entryUnitLabel(m.unit), from: m.from }));
    const rows = items
      .map((i) => ({ ...i, fullName: names.get(i.pinfl)?.fullName ?? i.fullName, position: i.position ?? names.get(i.pinfl)?.position ?? null, inRegistry: names.has(i.pinfl), moves: timeline(i.pinfl) }))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.fullName.localeCompare(b.fullName));
    // Shu oydan keyin boshqa bo'limga ketadiganlar va shu oyda boshqa bo'limda bo'lganlar (oldin shu yerda edi)
    const at = membership(moves);
    const keptPins = new Set(rows.map((r) => r.pinfl));
    const base = await this.staffOf(unit, period, false);
    const awayPins = [...new Set([...base.map((b) => b.pinfl), ...moves.filter((m) => m.unit === unit).map((m) => m.pinfl)])].filter((p) => !keptPins.has(p));
    const awayNames = await this.registryNames(awayPins);
    const away = awayPins
      .map((p) => ({ pinfl: p, fullName: awayNames.get(p)?.fullName ?? moves.find((m) => m.pinfl === p)?.fullName ?? p, unit: at(p, period) ?? null, unitLabel: at(p, period) ? entryUnitLabel(at(p, period)!) : null, moves: timeline(p) }))
      .filter((a) => a.unit && a.unit !== unit);
    return { unit, label: entryUnitLabel(unit), period, active: rows.filter((r) => r.active).length, total: rows.length, items: rows, away };
  }

  /** PINFL bo'yicha: ro'yxatda bormi, umumiy bazada ismi */
  async lookup(unit: string, pinflRaw: string) {
    const pinfl = parsePinfl(pinflRaw);
    if (!pinfl) throw new BadRequestException("PINFL 14 ta raqam bo'lishi kerak");
    const own = (await this.staffOf(unit)).find((s) => s.pinfl === pinfl) ?? null;
    const reg = (await this.registryNames([pinfl])).get(pinfl) ?? null;
    return { pinfl, inStaff: Boolean(own), active: own?.active ?? false, fullName: reg?.fullName ?? own?.fullName ?? null, position: reg?.position ?? own?.position ?? null, inRegistry: Boolean(reg) };
  }

  @Exclusive('unit-payroll')
  async addStaff(unit: string, body: { pinfl?: unknown; fullName?: unknown; position?: unknown }, userId: string) {
    const pinfl = parsePinfl(body?.pinfl);
    if (!pinfl) throw new BadRequestException("PINFL 14 ta raqam bo'lishi kerak");
    const merged = await this.staffOf(unit);
    const items = await this.ownStaff(unit);
    const reg = (await this.registryNames([pinfl])).get(pinfl);
    const fullName = cleanName(body?.fullName) ?? reg?.fullName ?? null;
    if (!fullName) throw new BadRequestException("F.I.Sh. kiriting (kamida 3 harf) — bu PINFL xodimlar bazasida yo'q");
    const position = cleanPosition(body?.position) ?? reg?.position ?? null;
    const now = new Date().toISOString();
    const present = merged.find((s) => s.pinfl === pinfl && s.active);
    if (present) throw new BadRequestException(`${present.fullName} — ro'yxatda allaqachon bor${present.source === 'REGISTRY' ? ' (Xodimlar bazasidan)' : ''}`);
    const existing = items.find((s) => s.pinfl === pinfl);
    if (existing) Object.assign(existing, { active: true, leftAt: null, fullName, position });
    else items.push({ pinfl, fullName, position, active: true, addedAt: now, source: 'MANUAL', leftAt: null });
    await this.saveStaff(unit, items);
    await this.audit.log({ userId, action: 'CREATE', entity: 'unit_staff', entityId: `${unit}:${pinfl}`, summary: `${entryUnitLabel(unit)} xodimlari: + ${fullName}` });
    return this.staff(unit);
  }

  /** Ro'yxatdan chiqarish (ishdan ketgan) yoki qaytarish; ism / lavozimni tuzatish */
  @Exclusive('unit-payroll')
  async updateStaff(unit: string, pinflRaw: string, body: { active?: unknown; fullName?: unknown; position?: unknown }, userId: string) {
    const pinfl = parsePinfl(pinflRaw);
    const items = await this.ownStaff(unit);
    let item = pinfl ? items.find((s) => s.pinfl === pinfl) : undefined;
    if (!item && pinfl) {
      // Xodimlar bazasidan kelgan: o'z ro'yxatiga yoziladi (masalan, «chiqarish» — shablonda chiqmasin)
      const linked = (await this.staffOf(unit)).find((s) => s.pinfl === pinfl && s.source === 'REGISTRY');
      if (linked) {
        item = { ...linked, addedAt: new Date().toISOString() };
        items.push(item);
      }
    }
    if (!item) throw new NotFoundException("Xodim bo'lim ro'yxatida topilmadi");
    const changes: string[] = [];
    if (typeof body?.active === 'boolean' && body.active !== item.active) {
      item.active = body.active;
      item.leftAt = body.active ? null : new Date().toISOString();
      changes.push(body.active ? 'qaytarildi' : 'chiqarildi');
    }
    if (body?.fullName !== undefined) {
      const name = cleanName(body.fullName);
      if (!name) throw new BadRequestException("F.I.Sh. kamida 3 harf bo'lsin");
      item.fullName = name;
      changes.push('ism');
    }
    if (body?.position !== undefined) {
      item.position = cleanPosition(body.position);
      changes.push('lavozim');
    }
    if (!changes.length) return this.staff(unit);
    // Bazadan kelgan xodim qaytarildi (boshqa o'zgarish yo'q) — yana faqat bog'lanish orqali (o'z ro'yxatidan olinadi)
    const finalItems = item.source === 'REGISTRY' && item.active && changes.length === 1 && changes[0] === 'qaytarildi' ? items.filter((x) => x !== item) : items;
    await this.saveStaff(unit, finalItems);
    await this.audit.log({ userId, action: 'UPDATE', entity: 'unit_staff', entityId: `${unit}:${item.pinfl}`, summary: `${entryUnitLabel(unit)} xodimlari: ${item.fullName} — ${changes.join(', ')}` });
    return this.staff(unit);
  }

  // ═══════════ Shablon ═══════════

  /**
   * Shablon — oylar oralig'i uchun (from–to; bitta oy ham bo'ladi).
   * 1-varaq «Ish haqi»: PINFL, F.I.Sh., keyin har oy ustuni (summa); yashirin 2-qatorda oy kodlari.
   * Qatorlar — bo'lim xodimlari (oldin saqlangan summalar yozilgan holda). 0 yoki bo'sh — o'sha oyda hisoblanmagan.
   * 2-varaq — bo'lim xodimlari ro'yxati.
   */
  async template(unit: string, from: string, to: string = from): Promise<{ buffer: Buffer; filename: string }> {
    const months = monthsBetween(from, to);
    const label = entryUnitLabel(unit);
    const { items } = await this.staff(unit, months[months.length - 1]);
    // Oralig'idagi hamma oylarda shu bo'limda bo'lganlar (ko'chishlar bilan) — «miya»
    const union = new Map<string, StaffItem>(items.filter((i) => i.active).map((i) => [i.pinfl, i]));
    for (const p of months) for (const s of await this.staffOf(unit, p)) if (s.active && !union.has(s.pinfl)) union.set(s.pinfl, s);
    const active = [...union.values()];
    const at = membership(await this.allMoves());
    const saved = new Map<string, Map<string, bigint> | null>();
    for (const p of months) saved.set(p, await this.payrollMap(unit, p));
    // Saqlangan vedomostda bor, lekin ro'yxatda faol bo'lmaganlar ham (o'sha oyda ish haqi olgan)
    const rows = [...active.map((s) => ({ pinfl: s.pinfl, fullName: s.fullName }))];
    const have = new Set(rows.map((r) => r.pinfl));
    const extra = new Set<string>();
    for (const m of saved.values()) for (const k of m?.keys() ?? []) if (!have.has(k)) extra.add(k);
    if (extra.size) {
      const names = await this.registryNames([...extra]);
      const byPin = new Map(items.map((i) => [i.pinfl, i.fullName]));
      for (const k of extra) rows.push({ pinfl: k, fullName: names.get(k)?.fullName ?? byPin.get(k) ?? '' });
    }
    rows.sort((a, b) => a.fullName.localeCompare(b.fullName));

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Korxona tahlil';
    const sheet = wb.addWorksheet('Ish haqi', { views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }] });
    const head = sheet.getRow(1);
    head.values = ['PINFL', 'F.I.Sh.', ...months.map(monthLabel)];
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    head.alignment = { horizontal: 'center', vertical: 'middle' };
    head.height = 22;
    const codes = sheet.getRow(2);
    codes.values = [CODE_MARK, unit, ...months];
    codes.hidden = true;
    sheet.getColumn(1).width = 18;
    sheet.getColumn(1).numFmt = '@';
    sheet.getColumn(2).width = 40;
    months.forEach((_, i) => {
      sheet.getColumn(3 + i).width = 16;
      sheet.getColumn(3 + i).numFmt = '#,##0.00';
    });
    for (const r of rows) {
      const row = sheet.addRow([r.pinfl, r.fullName, ...months.map((p) => {
        const v = saved.get(p)?.get(r.pinfl);
        return v === undefined ? null : Number(v) / 100;
      })]);
      row.getCell(1).numFmt = '@';
      months.forEach((p, i) => {
        const other = at(r.pinfl, p);
        const cell = row.getCell(3 + i);
        if (other && other !== unit) {
          // Bu oyda boshqa bo'limda — kulrang, izoh bilan
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
          cell.note = `${monthLabel(p)}: «${entryUnitLabel(other)}» bo'limida`;
        } else cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } };
      });
    }

    // 2-varaq — faqat shu bo'lim xodimlari (Xodimlar bo'limidan va o'z ro'yxatidan)
    const ref = wb.addWorksheet(`${label} xodimlari`.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
    ref.columns = [
      { header: '№', key: 'n', width: 6 },
      { header: 'PINFL', key: 'pinfl', width: 20 },
      { header: 'F.I.Sh.', key: 'fullName', width: 42 },
      { header: 'Lavozim', key: 'position', width: 28 },
    ];
    const rh = ref.getRow(1);
    rh.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    rh.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF475569' } };
    rh.height = 22;
    ref.getColumn('B').numFmt = '@';
    active.forEach((s, i) => ref.addRow({ n: i + 1, pinfl: s.pinfl, fullName: s.fullName, position: s.position ?? '' }));
    if (active.length) ref.autoFilter = { from: 'A1', to: `D${ref.rowCount}` };
    else ref.addRow({ n: '', pinfl: '', fullName: `${label} xodimlari topilmadi — Xodimlar bo'limida bog'lang yoki vedomost yuklang` });

    const help = wb.addWorksheet("Yo'riqnoma");
    help.getColumn(1).width = 110;
    [
      `${label} — ish haqi shabloni · ${monthLabel(months[0]!)}${months.length > 1 ? ` – ${monthLabel(months[months.length - 1]!)}` : ''}`,
      '',
      "• «Ish haqi» varag'ida har oy ustuniga xodimning shu oydagi ish haqi summasini (so'mda) yozing.",
      "• 0 yoki bo'sh — o'sha oyda hisoblanmagan.",
      "• Yangi xodim — pastga qator qo'shing: PINFL va F.I.Sh. Saqlanganda ro'yxatga qo'shiladi.",
      "• Kulrang katak — xodim o'sha oyda boshqa bo'limda edi (izohda — qaysi). Summa yozilsa, saqlanganda shu oydan shu bo'limga ko'chirilgan bo'ladi.",
      "• Ustun va sarlavhalarni o'chirmang. Yuklanganda fayldagi hamma oylar o'qiladi, saqlanadiganlarini tanlaysiz.",
    ].forEach((t, i) => {
      help.getCell(i + 1, 1).value = t;
      if (i === 0) help.getCell(1, 1).font = { bold: true, size: 12 };
    });

    const data = await wb.xlsx.writeBuffer();
    const tag = months.length > 1 ? `${months[0]}_${months[months.length - 1]}` : months[0]!;
    return { buffer: Buffer.from(data), filename: `Ish-haqi-${label.replace(/\s+/g, '-')}-${tag}.xlsx` };
  }

  // ═══════════ Tahlil — hech narsa saqlanmaydi ═══════════

  private async loadBook(file: Express.Multer.File | undefined): Promise<ExcelJS.Workbook> {
    if (!file?.buffer) throw new BadRequestException('Fayl yuklanmadi');
    const wb = new ExcelJS.Workbook();
    await assertSafeXlsx(file.buffer);
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException("Faylni o'qib bo'lmadi — .xlsx formatidagi Excel fayl yuklang");
    }
    if (!wb.worksheets[0]) throw new BadRequestException('Faylda varaq topilmadi');
    return wb;
  }

  /**
   * Faylni o'qish: yangi shablon (oylar ustunlari, yashirin «KOD» qatori) yoki eski (A — PINFL, B — Summa; oy — tanlangan).
   * Soliq hisoboti (4 va 5-ilova) bo'lsa — tanlangan oy uchun «hisobot davrida» summalari, ikkala ilova PINFL bo'yicha qo'shiladi.
   * Natija: oy → xodim → summa. Bo'sh yoki 0 — hisoblanmagan (0).
   */
  private parseBook(wb: ExcelJS.Workbook, period: string, fileName = '', format: 'auto' | 'ndfl' = 'auto') {
    if (isNdflWorkbook(wb)) {
      const ndfl = parseNdfl(wb, fileName);
      const m = new Map<string, { rowIndex: number; amountTiyin: bigint }>();
      const fileNames = new Map<string, string>();
      for (const p of ndfl.people) {
        m.set(p.pinfl, { rowIndex: p.rowIndex, amountTiyin: p.salaryTiyin + p.otherTiyin });
        if (p.fullName) fileNames.set(p.pinfl, p.fullName);
      }
      return {
        multi: false,
        byMonth: new Map([[period, m]]),
        fileNames,
        invalidRows: ndfl.invalid.map((x) => ({ rowIndex: x.rowIndex, reason: `${x.sheet}: ${x.reason}` })),
        duplicates: [] as string[],
        ndfl,
      };
    }
    if (format === 'ndfl') {
      throw new BadRequestException("Bu fayl soliq hisoboti emas: «ЖШ ШИР» va «ҳисобот даврида ҳисобланган … даромадлар» ustunli varaq (4 yoki 5-ilova) topilmadi");
    }
    const sheet = wb.worksheets[0]!;
    const invalidRows: { rowIndex: number; reason: string }[] = [];
    const duplicates = new Set<string>();
    let codeRow = 0;
    const cols: { col: number; period: string }[] = [];
    for (let r = 1; r <= Math.min(sheet.rowCount, 6); r++) {
      if (String(cellValue(sheet.getRow(r).getCell(1).value) ?? '').trim().toUpperCase() !== CODE_MARK) continue;
      codeRow = r;
      sheet.getRow(r).eachCell((cell, c) => {
        const v = String(cellValue(cell.value) ?? '').trim();
        if (c > 1 && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)) cols.push({ col: c, period: v });
      });
      break;
    }
    const multi = codeRow > 0 && cols.length > 0;
    if (!multi) cols.push({ col: 2, period });
    const start = multi ? codeRow + 1 : 2;
    const byMonth = new Map<string, Map<string, { rowIndex: number; amountTiyin: bigint }>>(cols.map((c) => [c.period, new Map()]));
    const fileNames = new Map<string, string>();

    for (let r = start; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const rawPinfl = cellValue(row.getCell(1).value);
      const values = cols.map((c) => cellValue(row.getCell(c.col).value));
      if (isBlank(rawPinfl) && values.every(isBlank)) continue;
      const pinfl = parsePinfl(rawPinfl);
      if (!pinfl) {
        invalidRows.push({ rowIndex: r, reason: "PINFL noto'g'ri" });
        continue;
      }
      if (multi) {
        const name = cleanName(cellValue(row.getCell(2).value));
        if (name && !fileNames.has(pinfl)) fileNames.set(pinfl, name);
      }
      cols.forEach((c, i) => {
        const amount = somToTiyin(values[i]);
        if (amount === null) {
          invalidRows.push({ rowIndex: r, reason: `${multi ? `${monthLabel(c.period)}: ` : ''}summa noto'g'ri` });
          return;
        }
        const m = byMonth.get(c.period)!;
        const prev = m.get(pinfl);
        if (prev) {
          prev.amountTiyin += amount;
          duplicates.add(pinfl);
        } else m.set(pinfl, { rowIndex: r, amountTiyin: amount });
      });
    }
    return { multi, byMonth, fileNames, invalidRows, duplicates: [...duplicates], ndfl: null as NdflResult | null };
  }

  /**
   * Soliq hisoboti odatda butun tashkilot bo'yicha — bo'limga faqat shu bo'lim xodimlari olinadi:
   * bo'lim ro'yxatida (Xodimlar bazasidan, katta jadvallardan yoki o'zining) yoki «miya» bo'yicha shu oy shu bo'limda bo'lganlar.
   * Qolganlari olinmaydi: Markaz, hududlar, boshqa bo'limlar xodimlari (outside) va «miya»da ham, katta jadvallarda ham
   * umuman yo'q odamlar (notInMiya — masalan fermer xo'jaliklari buxgalterlari: soliq hisobotida bor, lekin bizning xarajat emas).
   */
  private async ndflForUnit(unit: string, period: string, parsed: Map<string, { rowIndex: number; amountTiyin: bigint }>) {
    const pins = [...parsed.keys()];
    const [staff, names, moves, others] = await Promise.all([
      this.staffOf(unit, period),
      this.registryNames(pins),
      this.allMoves(),
      Promise.all(PAYROLL_UNITS.filter((u) => u !== unit).map((u) => this.staffOf(u, period))),
    ]);
    const own = new Set(staff.filter((x) => x.active).map((x) => x.pinfl));
    const elsewhere = new Set(others.flat().filter((x) => x.active).map((x) => x.pinfl));
    const at = membership(moves);
    const kept = new Map<string, { rowIndex: number; amountTiyin: bigint }>();
    let outside = 0;
    let outsideTiyin = 0n;
    const notInMiya: { pinfl: string; amountTiyin: bigint }[] = [];
    for (const [pinfl, v] of parsed) {
      const where = at(pinfl, period);
      const mine = own.has(pinfl) || where === unit;
      if (mine) kept.set(pinfl, v);
      else if (!names.has(pinfl) && !elsewhere.has(pinfl) && !where) notInMiya.push({ pinfl, amountTiyin: v.amountTiyin });
      else {
        outside += 1;
        outsideTiyin += v.amountTiyin;
      }
    }
    return { kept, outside, outsideTiyin, notInMiya };
  }

  /** Soliq hisoboti xulosasi (ekran uchun) */
  private ndflSummary(ndfl: NdflResult, period: string, outside: { outside: number; outsideTiyin: bigint; notInMiya: { pinfl: string; amountTiyin: bigint }[] }) {
    const nameOf = new Map(ndfl.people.map((p) => [p.pinfl, p.fullName]));
    return {
      sheets: ndfl.sheets.map((x) => ({ ...x, monthTiyin: x.monthTiyin.toString(), cumulativeTiyin: x.cumulativeTiyin.toString(), taxMonthTiyin: x.taxMonthTiyin.toString(), types: x.types.map((t) => ({ ...t, monthTiyin: t.monthTiyin.toString() })) })),
      people: ndfl.people.length,
      inBoth: ndfl.inBoth,
      monthOverCumulative: ndfl.monthOverCumulative,
      periodHint: ndfl.periodHint,
      periodMismatch: Boolean(ndfl.periodHint && ndfl.periodHint !== period),
      salaryTiyin: ndfl.people.reduce((a, p) => a + p.salaryTiyin, 0n).toString(),
      otherTiyin: ndfl.people.reduce((a, p) => a + p.otherTiyin, 0n).toString(),
      taxTiyin: ndfl.people.reduce((a, p) => a + p.taxTiyin, 0n).toString(),
      /** Boshqa joy xodimlari — bo'limga olinmadi */
      outside: outside.outside,
      outsideTiyin: outside.outsideTiyin.toString(),
      /** «Miya»da ham, katta jadvallarda ham yo'q — olinmadi (ro'yxat: F.I.Sh. soliq hisobotidan) */
      notInMiya: {
        count: outside.notInMiya.length,
        totalTiyin: outside.notInMiya.reduce((s, x) => s + x.amountTiyin, 0n).toString(),
        people: outside.notInMiya
          .sort((a, b) => (b.amountTiyin > a.amountTiyin ? 1 : -1))
          .slice(0, 500)
          .map((x) => ({ pinfl: x.pinfl, fullName: nameOf.get(x.pinfl) ?? null, amountTiyin: x.amountTiyin.toString() })),
      },
    };
  }

  /** Bir oy natijasi (xodimlar holati, jamilar, oldingi vedomost) */
  private async monthResult(
    unit: string,
    period: string,
    fileName: string,
    parsed: Map<string, { rowIndex: number; amountTiyin: bigint }>,
    invalidRows: { rowIndex: number; reason: string }[],
    duplicates: string[],
    fileNames: Map<string, string> = new Map(),
  ) {
    const staff = await this.staffOf(unit, period);
    const byPinfl = new Map(staff.map((s) => [s.pinfl, s]));
    const names = await this.registryNames([...parsed.keys()]);
    const at = membership(await this.allMoves());
    const general = await this.inGeneral(period, [...parsed.keys()]);

    const rows = [...parsed.entries()].map(([pinfl, r]) => {
      const own = byPinfl.get(pinfl);
      const reg = names.get(pinfl);
      const status: RowStatus = own ? (own.active ? 'KNOWN' : 'RETURNING') : reg ? 'REGISTRY' : 'NEW';
      // Shu oyda boshqa bo'limda (ko'chishlar bo'yicha) — summa bo'lsa, saqlanganda shu bo'limga ko'chadi
      const other = at(pinfl, period);
      return {
        rowIndex: r.rowIndex,
        pinfl,
        fullName: reg?.fullName ?? own?.fullName ?? fileNames.get(pinfl) ?? null,
        position: own?.position ?? reg?.position ?? null,
        amountTiyin: r.amountTiyin.toString(),
        status,
        ...(other && other !== unit ? { otherUnit: other, otherUnitLabel: entryUnitLabel(other) } : {}),
        /** Shu oy umumiy vedomostda bor — saqlanganda olinmaydi (ish haqi ikki marta sanalmasin) */
        ...(general.has(pinfl) ? { inGeneral: true } : {}),
      };
    });

    const total = rows.filter((r) => !general.has(r.pinfl)).reduce((s, r) => s + BigInt(r.amountTiyin), 0n);
    const inFile = new Set(parsed.keys());
    const notInFile = staff.filter((s) => s.active && !inFile.has(s.pinfl)).map((s) => ({ pinfl: s.pinfl, fullName: names.get(s.pinfl)?.fullName ?? s.fullName }));
    const previous = (await this.batchesOf(unit, period)).filter((b) => b.status === 'COMMITTED');

    return {
      unit,
      label: entryUnitLabel(unit),
      period,
      monthLabel: monthLabel(period),
      fileName,
      totalRows: parsed.size + invalidRows.length,
      validRows: rows.length,
      zeroRows: rows.filter((r) => r.amountTiyin === '0').length,
      paidRows: rows.filter((r) => r.amountTiyin !== '0').length,
      knownRows: rows.filter((r) => r.status === 'KNOWN').length,
      /** Ro'yxatga yangi qo'shiladiganlar (bazadan topilgan + mutlaqo yangi) va qaytganlar */
      newRows: rows.filter((r) => r.status === 'REGISTRY' || r.status === 'NEW').length,
      returningRows: rows.filter((r) => r.status === 'RETURNING').length,
      /** Ismi noma'lum — saqlashdan oldin F.I.Sh. kiritiladi */
      unnamedRows: rows.filter((r) => !r.fullName).length,
      /** Shu oyda boshqa bo'limda bo'lgan, lekin summasi bor — saqlanganda shu bo'limga ko'chadi */
      movedRows: rows.filter((r) => 'otherUnit' in r && r.amountTiyin !== '0').length,
      /** Umumiy vedomostda allaqachon bor — olinmaydi */
      inGeneralRows: rows.filter((r) => general.has(r.pinfl)).length,
      inGeneralTiyin: rows.filter((r) => general.has(r.pinfl)).reduce((s, r) => s + BigInt(r.amountTiyin), 0n).toString(),
      totalTiyin: total.toString(),
      invalidRows,
      duplicates,
      notInFile,
      hasPrevious: previous.length > 0,
      previousCount: previous.length,
      previousTiyin: previous.reduce((s, b) => s + BigInt(b.totalTiyin), 0n).toString(),
      rows,
    };
  }

  /** Bitta oy (eski usul): fayldagi «period» ustuni yoki eski shablon (PINFL, Summa) */
  async analyze(unit: string, period: string, file: Express.Multer.File | undefined, format: 'auto' | 'ndfl' = 'auto') {
    this.assertPeriod(period);
    const fileName = String(file?.originalname ?? 'ish-haqi.xlsx').slice(0, 200);
    const p = this.parseBook(await this.loadBook(file), period, fileName, format);
    let parsed = p.byMonth.get(period) ?? p.byMonth.values().next().value ?? new Map();
    let ndfl: ReturnType<UnitPayrollService['ndflSummary']> | null = null;
    if (p.ndfl) {
      const f = await this.ndflForUnit(unit, period, parsed);
      parsed = f.kept;
      ndfl = this.ndflSummary(p.ndfl, period, f);
      if (parsed.size === 0) throw new BadRequestException(`Soliq hisobotida ${entryUnitLabel(unit)} xodimlari topilmadi (${f.outside} xodim — boshqa joylarniki${f.notInMiya.length ? `, ${f.notInMiya.length} tasi miyada ham, katta jadvallarda ham yo'q` : ''}). Umumiy hisobotni Xarajatlar › Soliq hisoboti orqali yuklang — bo'lim xodimlari o'z bo'limiga avtomatik yoziladi`);
    }
    if (parsed.size === 0) throw new BadRequestException('Faylda yaroqli qator topilmadi (1-varaq: A — PINFL, keyin summa)');
    if (parsed.size > MAX_ROWS) throw new BadRequestException(`Qatorlar juda ko'p (${parsed.size}) — ${MAX_ROWS} tagacha`);
    return { ...(await this.monthResult(unit, period, fileName, parsed, p.invalidRows, p.duplicates, p.fileNames)), ndfl };
  }

  /**
   * Fayldagi hamma oylar: yangi shablon — har oy ustuni alohida; eski shablon — tanlangan oy.
   * Har oy — alohida natija (saqlashda tanlangan oylar birma-bir saqlanadi).
   */
  async analyzeMany(unit: string, period: string, file: Express.Multer.File | undefined, format: 'auto' | 'ndfl' = 'auto') {
    this.assertPeriod(period);
    const fileName = String(file?.originalname ?? 'ish-haqi.xlsx').slice(0, 200);
    const p = this.parseBook(await this.loadBook(file), period, fileName, format);
    if (p.ndfl) {
      const single = await this.analyze(unit, period, file, 'ndfl');
      return { unit, label: entryUnitLabel(unit), fileName, format: 'NDFL' as const, invalidRows: p.invalidRows, duplicates: [], months: [single], ndfl: single.ndfl };
    }
    const size = Math.max(0, ...[...p.byMonth.values()].map((m) => m.size));
    if (size === 0) throw new BadRequestException("Faylda yaroqli qator topilmadi — shablonni shu sahifadan yuklab oling (A — PINFL, keyin oylar)");
    if (size > MAX_ROWS) throw new BadRequestException(`Qatorlar juda ko'p (${size}) — ${MAX_ROWS} tagacha`);
    const months = [];
    for (const [per, parsed] of [...p.byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      months.push(await this.monthResult(unit, per, fileName, parsed, [], p.duplicates, p.fileNames));
    }
    return { unit, label: entryUnitLabel(unit), fileName, format: p.multi ? ('MONTHS' as const) : ('SINGLE' as const), invalidRows: p.invalidRows, duplicates: p.duplicates, months, ndfl: null };
  }

  // ═══════════ Saqlash ═══════════

  @Exclusive('unit-payroll')
  async commit(
    unit: string,
    period: string,
    body: { rows?: unknown; fileName?: unknown },
    replacePrevious: boolean,
    userId: string,
    opts: { origin?: 'GENERAL'; generalBatchId?: string | null } = {},
  ) {
    this.assertPeriod(period);
    if (!Array.isArray(body?.rows) || body.rows.length === 0) throw new BadRequestException("Saqlash uchun ma'lumot yo'q");
    if (body.rows.length > MAX_ROWS) throw new BadRequestException(`Qatorlar juda ko'p — ${MAX_ROWS} tagacha`);
    const fileName = typeof body.fileName === 'string' && body.fileName.trim() ? body.fileName.trim().slice(0, 200) : 'ish-haqi.xlsx';

    // Qatorlar: PINFL, summa (tiyin), yangi xodim uchun F.I.Sh.
    const merged = new Map<string, { amount: bigint; fullName: string | null }>();
    for (const raw of body.rows as { pinfl?: unknown; amountTiyin?: unknown; fullName?: unknown }[]) {
      const pinfl = parsePinfl(raw?.pinfl);
      if (!pinfl) throw new BadRequestException(`Noto'g'ri PINFL: ${String(raw?.pinfl ?? '').slice(0, 20)}`);
      let amount: bigint;
      try {
        amount = BigInt(String(raw?.amountTiyin ?? '0'));
      } catch {
        throw new BadRequestException(`Noto'g'ri summa: ${pinfl}`);
      }
      if (amount < 0n) throw new BadRequestException(`Manfiy summa: ${pinfl}`);
      assertAmount(amount, pinfl);
      const prev = merged.get(pinfl);
      merged.set(pinfl, { amount: (prev?.amount ?? 0n) + amount, fullName: cleanName(raw?.fullName) ?? prev?.fullName ?? null });
    }

    // Shu oy umumiy vedomostda bor xodimlar olinmaydi — ish haqi ikki marta sanalmasin
    const skippedInGeneral: string[] = [];
    if (opts.origin !== 'GENERAL') {
      const general = await this.inGeneral(period, [...merged.keys()]);
      for (const p of general) {
        merged.delete(p);
        skippedInGeneral.push(p);
      }
      if (!merged.size) throw new BadRequestException(`Fayldagi hamma xodimlar (${skippedInGeneral.length}) shu oy umumiy vedomostda bor — saqlanmadi`);
    }

    const pinfls = [...merged.keys()];
    const staff = await this.ownStaff(unit);
    const unitStaff = await this.staffOf(unit);
    const ownBy = new Map(staff.map((s) => [s.pinfl, s]));
    const byPinfl = new Map(unitStaff.map((s) => [s.pinfl, s]));
    const names = await this.registryNames(pinfls);

    const unnamed = pinfls.filter((p) => !byPinfl.has(p) && !names.has(p) && !merged.get(p)!.fullName);
    if (unnamed.length) {
      throw new BadRequestException(`${unnamed.length} ta yangi xodimning F.I.Sh. kiritilmagan: ${unnamed.slice(0, 5).join(', ')}${unnamed.length > 5 ? ' …' : ''}`);
    }

    const rows: UnitPayrollRow[] = pinfls.map((p) => ({
      pinfl: p,
      fullName: names.get(p)?.fullName ?? merged.get(p)!.fullName ?? byPinfl.get(p)?.fullName ?? p,
      amountTiyin: merged.get(p)!.amount.toString(),
    }));
    const total = rows.reduce((s, r) => s + BigInt(r.amountTiyin), 0n);
    const paid = rows.filter((r) => r.amountTiyin !== '0').length;
    const fileHash = createHash('sha256')
      .update(`${unit}:${period}:${JSON.stringify(rows.map((r) => [r.pinfl, r.amountTiyin]).sort())}`)
      .digest('hex');

    const key = payrollKey(unit, period);
    const label = entryUnitLabel(unit);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }).catch(() => null);

    const result = await this.prisma.$transaction(
      async (tx) => {
        const batches = readBatches(shapeOf(key, (await tx.setting.findUnique({ where: { key } }))?.value ?? null, listBlock('batches')));
        const committed = batches.filter((b) => b.status === 'COMMITTED');
        const now = new Date().toISOString();
        let replaced = 0;

        if (replacePrevious) {
          const ids = committed.map((b) => b.expenseId).filter((id): id is string => Boolean(id));
          if (ids.length) await tx.expense.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { deletedAt: new Date() } });
          for (const b of committed) {
            b.status = 'CANCELLED';
            b.cancelledAt = now;
          }
          replaced = committed.length;
        } else if (committed.some((b) => b.fileHash === fileHash)) {
          throw new BadRequestException("Bu vedomost shu oy uchun allaqachon saqlangan (xuddi shu ma'lumotlar). Ikki marta yozilmaydi");
        }

        let expenseId: string | null = null;
        if (total > 0n) {
          const expense = await tx.expense.create({
            data: {
              date: this.periodEndDate(period),
              period,
              amountTiyin: total,
              categoryCode: PAYROLL_CATEGORY,
              segment: unit,
              regionCode: null,
              departmentId: null,
              description: `Ish haqi — ${label} (${paid} xodim)`,
              documentNo: fileName.slice(0, 100),
              paymentMethod: 'BANK',
              paymentStatus: 'PAID',
              source: 'IMPORT',
              section: 'DOIMIY',
              createdById: userId,
            },
            select: { id: true },
          });
          expenseId = expense.id;
        }

        // «Miya»: yangi PINFL'lar bo'lim ro'yxatiga, ketgan deb belgilanganlar qaytadi
        let newStaff = 0;
        let returned = 0;
        for (const r of rows) {
          const known = byPinfl.get(r.pinfl);
          const own = ownBy.get(r.pinfl);
          if (!known) {
            staff.push({ pinfl: r.pinfl, fullName: r.fullName, position: names.get(r.pinfl)?.position ?? null, active: true, addedAt: now, source: 'UPLOAD', leftAt: null });
            newStaff += 1;
          } else if (own && !own.active) {
            own.active = true;
            own.leftAt = null;
            returned += 1;
          }
        }

        const batch: UnitPayrollBatch = {
          id: randomUUID(),
          period,
          fileName,
          fileHash,
          status: 'COMMITTED',
          createdAt: now,
          cancelledAt: null,
          uploadedById: userId,
          uploadedBy: user?.fullName ?? '',
          totalTiyin: total.toString(),
          count: rows.length,
          zeroCount: rows.length - paid,
          newStaff,
          expenseId,
          rows,
          ...(opts.origin === 'GENERAL' ? { origin: 'GENERAL' as const, generalBatchId: opts.generalBatchId ?? null } : {}),
        };
        const value = { batches: [...batches, batch] } as object;
        await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });

        const allStaff = { ...((((await tx.setting.findUnique({ where: { key: STAFF_KEY } }))?.value ?? {}) as Record<string, unknown>)) };
        allStaff[unit] = staff;
        await tx.setting.upsert({ where: { key: STAFF_KEY }, create: { key: STAFF_KEY, value: allStaff as object }, update: { value: allStaff as object } });

        return { batchId: batch.id, expenseId, replaced, newStaff, returned };
      },
      { timeout: 60_000 },
    );

    await this.audit.log({
      userId,
      action: 'CREATE',
      entity: 'unit_payroll',
      entityId: `${unit}:${period}:${result.batchId}`,
      summary: `${label} ish haqi ${period}${opts.origin === 'GENERAL' ? ' (umumiy vedomostdan)' : ''}: ${rows.length} xodim, ${(Number(total) / 100).toLocaleString('uz-UZ')} so'm${result.newStaff ? `, ${result.newStaff} yangi xodim` : ''}${result.replaced ? `, ${result.replaced} ta oldingisi almashtirildi` : ''}${skippedInGeneral.length ? `, ${skippedInGeneral.length} tasi umumiy vedomostda bor — olinmadi` : ''}`,
    });

    // «Miya»: shu oyda boshqa bo'limda bo'lgan xodim shu bo'lim vedomostida (summa bilan) — shu oydan shu bo'limga ko'chadi
    const at = membership(await this.allMoves());
    let movedIn = 0;
    for (const [pinfl, v] of merged) {
      if (v.amount <= 0n) continue;
      const other = at(pinfl, period);
      if (other && other !== unit) {
        await this.addMove({ pinfl, unit, from: period, fullName: v.fullName ?? undefined }, userId, 'UPLOAD').catch(() => null);
        movedIn += 1;
      }
    }

    // Ish haqi qismlari (siyosat bo'yicha) — qayta ajratiladi
    await this.splitComponents(unit, period).catch(() => null);

    return {
      success: true as const,
      batchId: result.batchId,
      expenseCreated: result.expenseId !== null,
      employees: rows.length,
      zeroCount: rows.length - paid,
      totalTiyin: total.toString(),
      newStaff: result.newStaff,
      returned: result.returned,
      /** Boshqa bo'limdan shu bo'limga ko'chganlar (shu oydan) */
      movedIn,
      replacedPrevious: result.replaced > 0,
      /** Umumiy vedomostda bor bo'lgani uchun olinmaganlar */
      skippedInGeneral: skippedInGeneral.length,
    };
  }

  // ═══════════ Tarix va bekor qilish ═══════════

  async batches(unit: string, period: string) {
    this.assertPeriod(period);
    const list = await this.batchesOf(unit, period);
    return [...list]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ rows, fileHash: _h, ...b }) => ({ ...b, rowsCount: rows.length }));
  }

  async batch(unit: string, period: string, id: string) {
    this.assertPeriod(period);
    const b = (await this.batchesOf(unit, period)).find((x) => x.id === id);
    if (!b) throw new NotFoundException('Yuklash topilmadi');
    const { fileHash: _h, ...rest } = b;
    return rest;
  }

  @Exclusive('unit-payroll')
  async cancel(unit: string, period: string, id: string, userId: string) {
    this.assertPeriod(period);
    const key = payrollKey(unit, period);
    const out = await this.prisma.$transaction(async (tx) => {
      const batches = readBatches(shapeOf(key, (await tx.setting.findUnique({ where: { key } }))?.value ?? null, listBlock('batches')));
      const b = batches.find((x) => x.id === id);
      if (!b) throw new NotFoundException('Yuklash topilmadi');
      if (b.status !== 'COMMITTED') throw new BadRequestException('Bu yuklash allaqachon bekor qilingan');
      if (b.expenseId) await tx.expense.updateMany({ where: { id: b.expenseId, deletedAt: null }, data: { deletedAt: new Date() } });
      b.status = 'CANCELLED';
      b.cancelledAt = new Date().toISOString();
      const value = { batches } as object;
      await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
      return b;
    });
    await this.audit.log({ userId, action: 'DELETE', entity: 'unit_payroll', entityId: `${unit}:${period}:${id}`, summary: `${entryUnitLabel(unit)} ish haqi ${period} bekor qilindi: ${out.fileName}` });
    await this.splitComponents(unit, period).catch(() => null);
    return { success: true as const, id };
  }

  // ═══════════ Saqlangan ish haqi — xodimlar bo'yicha (ko'rish, o'chirish, boshqa bo'limga o'tkazish) ═══════════

  /** Shu oy saqlangan ish haqi: har xodim — summa, qaysi yuklashdan; shu oyda boshqa bo'limda bo'lsa — belgisi */
  async saved(unit: string, period: string) {
    this.assertPeriod(period);
    const committed = (await this.batchesOf(unit, period)).filter((b) => b.status === 'COMMITTED');
    const byPin = new Map<string, { pinfl: string; fullName: string; amount: bigint; batches: { id: string; fileName: string; general?: boolean }[] }>();
    for (const b of committed) {
      for (const r of b.rows ?? []) {
        const x = byPin.get(r.pinfl) ?? { pinfl: r.pinfl, fullName: r.fullName, amount: 0n, batches: [] };
        x.amount += BigInt(r.amountTiyin);
        x.batches.push({ id: b.id, fileName: b.fileName, ...(b.origin === 'GENERAL' ? { general: true } : {}) });
        byPin.set(r.pinfl, x);
      }
    }
    const names = await this.registryNames([...byPin.keys()]);
    const at = membership(await this.allMoves());
    const split = ((await this.readSetting(`unit.payroll.split.${unit}.${period}`)) as { parts?: Record<string, string> } | null)?.parts ?? {};
    const rows = [...byPin.values()]
      .map((x) => {
        const other = at(x.pinfl, period);
        return {
          pinfl: x.pinfl,
          fullName: names.get(x.pinfl)?.fullName ?? x.fullName,
          position: names.get(x.pinfl)?.position ?? null,
          amountTiyin: x.amount.toString(),
          batches: x.batches,
          /** Qayerdan: umumiy vedomostdan (soliq hisoboti) va/yoki shu sahifada yuklangan */
          fromGeneral: x.batches.some((b) => b.general),
          fromUnit: x.batches.some((b) => !b.general),
          inRegistry: names.has(x.pinfl),
          ...(other && other !== unit ? { otherUnit: other, otherUnitLabel: entryUnitLabel(other) } : {}),
        };
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    const total = rows.reduce((s, r) => s + BigInt(r.amountTiyin), 0n);
    const splitTotal = Object.values(split).reduce((s, v) => s + BigInt(v), 0n);
    return {
      unit,
      label: entryUnitLabel(unit),
      period,
      monthLabel: monthLabel(period),
      count: rows.length,
      paidCount: rows.filter((r) => r.amountTiyin !== '0').length,
      totalTiyin: total.toString(),
      /** Ish haqi qismlari (siyosat bo'yicha) boshqa bo'limga ajratilgan */
      splitTiyin: splitTotal.toString(),
      batches: committed.length,
      rows,
    };
  }

  /** Saqlangan vedomostlardan xodimlarni olib tashlash (yuklash jami va xarajat qayta hisoblanadi) — olib tashlanganlar */
  private async dropRows(unit: string, period: string, pinfls: Set<string>, onlyManual = false): Promise<{ pinfl: string; fullName: string; amountTiyin: bigint }[]> {
    const key = payrollKey(unit, period);
    return this.prisma.$transaction(
      async (tx) => {
        const batches = readBatches(shapeOf(key, (await tx.setting.findUnique({ where: { key } }))?.value ?? null, listBlock('batches')));
        const dropped = new Map<string, { pinfl: string; fullName: string; amountTiyin: bigint }>();
        const now = new Date().toISOString();
        for (const b of batches) {
          if (b.status !== 'COMMITTED' || (onlyManual && b.origin === 'GENERAL')) continue;
          const out = (b.rows ?? []).filter((r) => pinfls.has(r.pinfl));
          if (!out.length) continue;
          for (const r of out) {
            const d = dropped.get(r.pinfl) ?? { pinfl: r.pinfl, fullName: r.fullName, amountTiyin: 0n };
            d.amountTiyin += BigInt(r.amountTiyin);
            dropped.set(r.pinfl, d);
          }
          b.rows = (b.rows ?? []).filter((r) => !pinfls.has(r.pinfl));
          const total = b.rows.reduce((s, r) => s + BigInt(r.amountTiyin), 0n);
          b.totalTiyin = total.toString();
          b.count = b.rows.length;
          b.zeroCount = b.rows.filter((r) => r.amountTiyin === '0').length;
          if (b.expenseId) {
            if (total > 0n) await tx.expense.updateMany({ where: { id: b.expenseId, deletedAt: null }, data: { amountTiyin: total, description: `Ish haqi — ${entryUnitLabel(unit)} (${b.count - b.zeroCount} xodim)` } });
            else {
              await tx.expense.updateMany({ where: { id: b.expenseId, deletedAt: null }, data: { deletedAt: new Date() } });
              b.expenseId = null;
            }
          }
          if (!b.rows.length) {
            b.status = 'CANCELLED';
            b.cancelledAt = now;
          }
        }
        const value = { batches } as object;
        await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
        return [...dropped.values()];
      },
      { timeout: 60_000 },
    );
  }

  /**
   * Ikki marta sanalganlar (umumiy soliq hisobotida ham bor): faqat shu sahifada QO'LDA yuklangan qatori olib tashlanadi,
   * umumiy hisobotdan kelgani qoladi
   */
  @Exclusive('unit-payroll')
  async removeManualRows(unit: string, period: string, pinfls: string[], userId: string) {
    this.assertPeriod(period);
    const pins = this.parsePins(pinfls);
    const dropped = await this.dropRows(unit, period, pins, true);
    await this.splitComponents(unit, period).catch(() => null);
    const total = dropped.reduce((s, d) => s + d.amountTiyin, 0n);
    if (dropped.length) await this.audit.log({ userId, action: 'UPDATE', entity: 'unit_payroll', entityId: `${unit}:${period}`, summary: `${entryUnitLabel(unit)} ish haqi ${period}: ${dropped.length} xodimning qo'lda yuklangan qatori olib tashlandi — umumiy soliq hisobotida bor (${(Number(total) / 100).toLocaleString('uz-UZ')} so'm, ikki marta sanalgan edi)` });
    return { removed: dropped.length, totalTiyin: total.toString() };
  }

  private parsePins(raw: unknown): Set<string> {
    const list = Array.isArray(raw) ? raw.map(parsePinfl).filter((x): x is string => Boolean(x)) : [];
    if (!list.length) throw new BadRequestException('Xodimlar belgilanmagan');
    if (list.length > MAX_ROWS) throw new BadRequestException("Juda ko'p");
    return new Set(list);
  }

  /** Shu oy ish haqidan xodimlarni o'chirish (yozuv, yuklash jami va xarajat kamayadi) */
  @Exclusive('unit-payroll')
  async removeRows(unit: string, period: string, body: { pinfls?: unknown }, userId: string) {
    this.assertPeriod(period);
    const pins = this.parsePins(body?.pinfls);
    // Ish haqi xarajati = soliq hisoboti: umumiy soliq hisobotidan kelgan qator bu yerdan o'chirilmaydi
    // (o'chsa — xarajat hisobotdan kam bo'ladi); u boshqa joyga o'tkaziladi yoki umumiy hisobot qayta yuklanadi
    const fromGeneral = new Set<string>();
    const manualPins = new Set<string>();
    for (const b of await this.batchesOf(unit, period)) {
      if (b.status !== 'COMMITTED') continue;
      for (const r of b.rows ?? []) if (pins.has(r.pinfl)) (b.origin === 'GENERAL' ? fromGeneral : manualPins).add(r.pinfl);
    }
    const onlyGeneral = [...fromGeneral].filter((p) => !manualPins.has(p));
    if (onlyGeneral.length) throw new BadRequestException(`${onlyGeneral.length} xodimning ish haqi umumiy soliq hisobotidan kelgan — o'chirilmaydi (xarajat soliq hisobotiga teng bo'lishi kerak). Shu oy boshqa joyda ishlagan bo'lsa — «Bo'lim» bilan o'tkazing`);
    const dropped = await this.dropRows(unit, period, pins, true);
    if (!dropped.length) throw new NotFoundException("Belgilangan xodimlar shu oy ish haqida yo'q");
    await this.splitComponents(unit, period).catch(() => null);
    const total = dropped.reduce((s, d) => s + d.amountTiyin, 0n);
    await this.audit.log({ userId, action: 'DELETE', entity: 'unit_payroll', entityId: `${unit}:${period}`, summary: `${entryUnitLabel(unit)} ish haqi ${period}: ${dropped.length} xodim olib tashlandi (${dropped.slice(0, 5).map((d) => d.fullName).join(', ')}${dropped.length > 5 ? ' …' : ''}) — ${(Number(total) / 100).toLocaleString('uz-UZ')} so'm` });
    return { removed: dropped.length, totalTiyin: total.toString() };
  }

  /**
   * Xodim(lar) shu oyda boshqa bo'limda ishlagan: ish haqi shu bo'limdan olinadi va (summasi bilan) o'sha bo'limga o'tkaziladi.
   *  • «Miya»: shu oydan o'sha bo'limda; onlyThisMonth — keyingi oydan yana shu bo'limga qaytadi (o'sha oyda ko'chish yo'q bo'lsa).
   *  • Summa: yo'nalishga — uning ish haqi vedomostiga (alohida yuklash); Markazga — tanlangan Markaz bo'limi
   *    (tanlanmasa — Xodimlar bazasidagi bo'limi) ish haqi xarajati; Hududlarga — tanlangan viloyat va tuman
   *    (tanlanmasa — Xodimlar bazasidagi hududi) ish haqi xarajati.
   *  • Qo'mita pullari — ish haqi emas: unga o'tkazilmaydi.
   */
  @Exclusive('unit-payroll')
  async moveRows(
    unit: string,
    period: string,
    body: { pinfls?: unknown; target?: unknown; onlyThisMonth?: unknown; withAmount?: unknown; place?: unknown },
    userId: string,
  ) {
    this.assertPeriod(period);
    const pins = this.parsePins(body?.pinfls);
    const target = typeof body?.target === 'string' && ENTRY_UNIT_CODES.includes(body.target) && body.target !== unit ? body.target : null;
    if (!target) throw new BadRequestException("Qaysi bo'limga — tanlang");
    if (!MOVE_TARGETS.includes(target)) throw new BadRequestException("Qo'mita pullariga ish haqi o'tkazilmaydi — boshqa bo'limni tanlang");
    const place = await this.movePlace(target, body?.place);
    const onlyThisMonth = body?.onlyThisMonth !== false;
    const withAmount = body?.withAmount !== false;
    const all = (await this.saved(unit, period)).rows.filter((r) => pins.has(r.pinfl));
    if (!all.length) throw new NotFoundException("Belgilangan xodimlar shu oy ish haqida yo'q");
    // Umumiy soliq hisobotidan kelganlar — umumiy oqim ichida o'tkaziladi (Ish haqi tarkibi › joy: summa hisobotda qoladi)
    const generalOnly = all.filter((r) => r.fromGeneral && !r.fromUnit);
    if (generalOnly.length) throw new BadRequestException(`${generalOnly.length} xodimning ish haqi umumiy soliq hisobotidan kelgan — sahifani yangilang (Ctrl+F5) va qaytadan o'tkazing: ular umumiy hisobot ichida o'tkaziladi`);
    const current = all;
    // Hududga — xodimning hududi kerak
    const emps = await this.prisma.employee.findMany({ where: { pinfl: { in: current.map((r) => r.pinfl) } }, select: { pinfl: true, regionCode: true, departmentId: true } });
    const empBy = new Map(emps.map((e) => [e.pinfl, e]));
    if (withAmount && target === 'REGION' && !place.regionCode) {
      const bad = current.filter((r) => !(empBy.get(r.pinfl)?.regionCode && empBy.get(r.pinfl)!.regionCode! > 0));
      if (bad.length) throw new BadRequestException(`Hududi noma'lum (Xodimlar bazasida hudud yo'q): ${bad.slice(0, 3).map((b) => b.fullName).join(', ')} — avval Xodimlar bo'limida hududini belgilang`);
    }
    const next = (() => {
      const [y, m] = period.split('-').map(Number) as [number, number];
      return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    })();
    // «Miya»
    for (const r of current) {
      const before = membership(await this.allMoves());
      const nextUnitBefore = before(r.pinfl, next);
      if (before(r.pinfl, period) !== target) await this.addMove({ pinfl: r.pinfl, unit: target, from: period, fullName: r.fullName, note: `${entryUnitLabel(unit)} ish haqidan o'tkazildi` }, userId);
      if (onlyThisMonth) {
        const hasNext = (await this.allMoves()).some((m) => m.pinfl === r.pinfl && m.from === next);
        if (!hasNext && (nextUnitBefore === undefined || nextUnitBefore === unit)) {
          await this.addMove({ pinfl: r.pinfl, unit, from: next, fullName: r.fullName, note: `${monthLabel(period)}dan keyin qaytdi` }, userId).catch(() => null);
        }
      }
    }
    // Ish haqidan olib tashlash (faqat shu sahifada yuklangan qatorlar)
    const dropped = await this.dropRows(unit, period, pins, true);
    const total = dropped.reduce((s, d) => s + d.amountTiyin, 0n);
    // Summani o'tkazish
    let created = 0;
    if (withAmount && total > 0n) {
      const paid = dropped.filter((d) => d.amountTiyin > 0n);
      if (isSegment(target)) {
        await this.commit(target, period, { rows: paid.map((d) => ({ pinfl: d.pinfl, amountTiyin: d.amountTiyin.toString(), fullName: d.fullName })), fileName: `${entryUnitLabel(unit)}dan o'tkazildi` }, false, userId);
        created = 1;
      } else {
        for (const d of paid) {
          const e = empBy.get(d.pinfl);
          await this.prisma.expense.create({
            data: {
              date: this.periodEndDate(period),
              period,
              amountTiyin: d.amountTiyin,
              categoryCode: PAYROLL_CATEGORY,
              segment: null,
              regionCode: target === 'CENTER' ? 0 : (place.regionCode ?? e!.regionCode),
              districtId: target === 'REGION' ? place.districtId : null,
              departmentId: target === 'CENTER' ? (place.departmentId ?? e?.departmentId ?? null) : null,
              description: `Ish haqi — ${d.fullName} (${entryUnitLabel(unit)}dan o'tkazildi${place.label ? `: ${place.label}` : ''}, ${monthLabel(period)})`.slice(0, 500),
              documentNo: d.pinfl,
              paymentMethod: 'BANK',
              paymentStatus: 'PAID',
              source: 'IMPORT',
              section: 'DOIMIY',
              createdById: userId,
            },
          });
          created += 1;
        }
      }
    }
    await this.splitComponents(unit, period).catch(() => null);
    await this.audit.log({
      userId,
      action: 'UPDATE',
      entity: 'unit_payroll',
      entityId: `${unit}:${period}`,
      summary: `${entryUnitLabel(unit)} ish haqi ${period}: ${dropped.length} xodim «${entryUnitLabel(target)}» bo'limiga o'tkazildi${withAmount ? ` (${(Number(total) / 100).toLocaleString('uz-UZ')} so'm bilan)` : ' (summasiz)'}${onlyThisMonth ? ', faqat shu oy' : ''}`,
    });
    return { moved: dropped.length, totalTiyin: total.toString(), target, targetLabel: place.label ? `${entryUnitLabel(target)} › ${place.label}` : entryUnitLabel(target), created };
  }

  /**
   * O'tkazishda aniq joy: Markaz — bo'limi; Hududlar — viloyati va (ixtiyoriy) tumani.
   * Berilmasa — eski tartib (Xodimlar bazasidagi joyi). Noto'g'ri yoki faol bo'lmagan joy — rad etiladi.
   */
  async movePlace(target: string, raw: unknown): Promise<{ departmentId: string | null; regionCode: number | null; districtId: string | null; label: string | null }> {
    const none = { departmentId: null, regionCode: null, districtId: null, label: null };
    const p = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    if (target === 'CENTER') {
      const id = typeof p.departmentId === 'string' && p.departmentId.trim() ? p.departmentId.trim() : null;
      if (!id) return none;
      const dep = await this.prisma.department.findUnique({ where: { id }, select: { id: true, name: true, isActive: true } });
      if (!dep || !dep.isActive) throw new BadRequestException("Markaz bo'limi topilmadi");
      return { ...none, departmentId: dep.id, label: dep.name };
    }
    if (target === 'REGION') {
      const code = typeof p.regionCode === 'number' ? p.regionCode : typeof p.regionCode === 'string' && /^\d{1,3}$/.test(p.regionCode) ? Number(p.regionCode) : null;
      if (code === null) return none;
      if (!Number.isInteger(code) || code <= 0) throw new BadRequestException('Viloyatni tanlang');
      const region = await this.prisma.region.findUnique({ where: { code }, select: { code: true, name: true, isActive: true } });
      if (!region || !region.isActive) throw new BadRequestException('Viloyat topilmadi');
      const did = typeof p.districtId === 'string' && p.districtId.trim() ? p.districtId.trim() : null;
      if (!did) return { ...none, regionCode: region.code, label: region.name };
      const district = await this.prisma.district.findUnique({ where: { id: did }, select: { id: true, name: true, regionCode: true, isActive: true } });
      if (!district || !district.isActive || district.regionCode !== region.code) throw new BadRequestException(`Tuman ${region.name} tarkibida topilmadi`);
      return { ...none, regionCode: region.code, districtId: district.id, label: `${region.name} › ${district.name}` };
    }
    return none;
  }

  // ═══════════ Ish haqi qismlari (Xarajatlar siyosati bo'yicha) ═══════════
  //
  // Bo'lim siyosatida «ish haqi qismi → bo'lim» belgilangan bo'lsa (masalan, Tax free: bayram puli → Qo'mita):
  // shu oy ish haqi tarkibidagi o'sha komponent summasi ish haqi xarajatidan ayriladi va alohida xarajat
  // (modda «IHQ_<kod>», shu bo'limda) bo'lib yoziladi — Solishtirma va hisobotlarda tanlangan bo'lim hisobida.
  // Jami o'zgarmaydi. Qayta hisoblash: ish haqi / tarkib saqlanganda yoki bekor qilinganda, siyosat o'zgarganda.
  // Ajratilgan yozuvlar: settings «unit.payroll.split.<BO'LIM>.<OY>».

  /** Shu bo'limda ish haqi yuklangan oylar */
  async payrollPeriods(unit: string): Promise<string[]> {
    const prefix = `unit.payroll.${unit}.`;
    const rows = await this.prisma.setting.findMany({ where: { key: { startsWith: prefix } }, select: { key: true } });
    return rows.map((r) => r.key.slice(prefix.length)).filter((p) => PERIOD_RE.test(p)).sort();
  }

  /** Shu oy uchun ajratish: { parts: komponent → summa, moved: jami ajratilgan } */
  async splitComponents(unit: string, period: string): Promise<{ parts: Record<string, string>; movedTiyin: string }> {
    if (!isSegment(unit) || !PERIOD_RE.test(period)) return { parts: {}, movedTiyin: '0' };
    const splitKey = `unit.payroll.split.${unit}.${period}`;
    const [policy, batches, compRow, prevSplit] = await Promise.all([
      readPolicy(this.prisma),
      this.batchesOf(unit, period),
      this.prisma.setting.findUnique({ where: { key: `unit.composition.${unit}.${period}` } }),
      this.prisma.setting.findUnique({ where: { key: splitKey } }),
    ]);
    const rules = policy.unitPayroll[unit] ?? {};
    const committed = batches.filter((b) => b.status === 'COMMITTED' && b.expenseId && BigInt(b.totalTiyin) > 0n).sort((a, b) => (BigInt(b.totalTiyin) > BigInt(a.totalTiyin) ? 1 : -1));
    const payrollTotal = committed.reduce((s, b) => s + BigInt(b.totalTiyin), 0n);

    // Faol tarkib yuklamasi → komponent summalari (faqat boshqa bo'limga o'tadiganlari)
    const compList = ((compRow?.value as { batches?: { cancelledAt: string | null; createdAt: string; rows?: { items?: Record<string, string> }[] }[] } | null)?.batches ?? [])
      .filter((b) => !b.cancelledAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const active = compList[0];
    const moving = Object.entries(rules).filter(([, t]) => t !== unit).map(([c]) => c);
    const comps = moving.length ? await this.prisma.salaryComponent.findMany({ where: { code: { in: moving } }, select: { code: true, name: true, sign: true } }) : [];
    const want = new Map<string, bigint>();
    if (active?.rows) {
      for (const c of comps) {
        if (c.sign <= 0) continue;
        let sum = 0n;
        for (const r of active.rows) {
          try {
            const v = BigInt(r.items?.[c.code] ?? '0');
            if (v > 0n) sum += v;
          } catch {
            /* noto'g'ri qiymat — o'tkaziladi */
          }
        }
        if (sum > 0n) want.set(c.code, sum);
      }
    }
    // Ish haqidan oshmasin (tartib: katta summa birinchi)
    const parts = new Map<string, bigint>();
    let left = payrollTotal;
    for (const [code, v] of [...want.entries()].sort((a, b) => (b[1] > a[1] ? 1 : -1))) {
      if (left <= 0n) break;
      const take = v < left ? v : left;
      parts.set(code, take);
      left -= take;
    }
    const moved = [...parts.values()].reduce((s, v) => s + v, 0n);
    if (parts.size) await ensurePayrollPartCategories(this.prisma, comps.filter((c) => parts.has(c.code)));
    const label = entryUnitLabel(unit);
    const prevIds = ((prevSplit?.value as { expenseIds?: unknown } | null)?.expenseIds as string[] | undefined) ?? [];

    await this.prisma.$transaction(
      async (tx) => {
        if (prevIds.length) await tx.expense.updateMany({ where: { id: { in: prevIds }, deletedAt: null }, data: { deletedAt: new Date() } });
        // Asosiy ish haqi yozuvlari: yuklama summasi − ajratilgan (kattasidan boshlab)
        let cut = moved;
        for (const b of committed) {
          const total = BigInt(b.totalTiyin);
          const take = cut < total ? cut : total;
          cut -= take;
          await tx.expense.updateMany({ where: { id: b.expenseId!, deletedAt: null }, data: { amountTiyin: total - take } });
        }
        const ids: string[] = [];
        const name = new Map(comps.map((c) => [c.code, c.name]));
        for (const [code, amount] of parts) {
          const e = await tx.expense.create({
            data: {
              date: this.periodEndDate(period),
              period,
              amountTiyin: amount,
              categoryCode: payrollPartCategory(code),
              segment: unit,
              regionCode: null,
              departmentId: null,
              description: `${name.get(code) ?? code} — ${label} ish haqidan ajratilgan (siyosat bo'yicha: ${entryUnitLabel(rules[code]!)})`.slice(0, 500),
              paymentMethod: 'BANK',
              paymentStatus: 'PAID',
              source: 'IMPORT',
              section: 'DOIMIY',
              createdById: committed[0]!.uploadedById,
            },
            select: { id: true },
          });
          ids.push(e.id);
        }
        const value = { expenseIds: ids, parts: Object.fromEntries([...parts].map(([k, v]) => [k, v.toString()])), updatedAt: new Date().toISOString() } as object;
        await tx.setting.upsert({ where: { key: splitKey }, create: { key: splitKey, value }, update: { value } });
      },
      { timeout: 60_000 },
    );
    return { parts: Object.fromEntries([...parts].map(([k, v]) => [k, v.toString()])), movedTiyin: moved.toString() };
  }
}