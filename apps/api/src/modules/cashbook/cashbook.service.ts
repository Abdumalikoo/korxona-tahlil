import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { SERIALIZABLE, withRetry } from '../../common/db/retry';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CASH_COLUMNS,
  carryForward,
  computeAll,
  type CalcAccount,
  type CashColumn,
  type CashValues,
} from './cashbook.calc';
import { SEED_ACCOUNTS } from './cashbook.seed';
import { assertSafeXlsx } from '../../common/files/xlsx-guard';

// ═══════════════════════════════════════════════════════════
// Buxgalteriya › Kunlik tushum va qoldiq.
//   • Hisobraqamlar ro'yxati (shablondan; Buxgalter/administrator o'zgartiradi).
//   • Har kun uchun bitta ma'lumotnoma: kunlik tushum, qaytarilgan, qoldiq — kiritiladi;
//     «Yil boshidan» va «Oy boshidan» — oldingi kundan avtomatik (birinchi kunda qo'lda).
//   • Jami qatorlar avtomatik; o'tgan kun tuzatilsa — keyingi kunlarning yig'indilari qayta hisoblanadi.
//   • Excel: shablon ko'rinishida yuklab olish va to'ldirilgan shablondan o'qish.
// Pul — tiyinda (BigInt), ekranda «ming so'm».
// ═══════════════════════════════════════════════════════════

const MAX_ABS = 9_000_000_000_000_000n;
const ANCHOR_KEY = 'cashbook.anchors';
const RULES = new Set(['ADD', 'SUB', 'KEEP']);

export interface CashAccountView {
  id: string;
  key: string;
  code: string | null;
  name: string;
  number: string | null;
  parentId: string | null;
  rollupId: string | null;
  sortOrder: number;
  inputs: string[];
  sums: string[];
  balanceRule: string;
  isHeader: boolean;
  isActive: boolean;
  level: number;
}

type ValuesView = Record<CashColumn, string | null>;

export interface CashDayView {
  date: string;
  exists: boolean;
  /** Birinchi kun — «Yil boshidan», «Oy boshidan» qo'lda kiritiladi */
  opening: boolean;
  prevDate: string | null;
  nextDate: string | null;
  latestDate: string | null;
  note: string | null;
  savedAt: string | null;
  savedBy: string | null;
  accounts: CashAccountView[];
  /** Kiritiladigan qiymatlar (yangi kun bo'lsa — oldingi kundan to'ldirilgan) */
  values: Record<string, ValuesView>;
}

export interface CashLineInput {
  accountId: string;
  ytd?: string | number | null;
  mtd?: string | number | null;
  refund?: string | number | null;
  daily?: string | number | null;
  balance?: string | number | null;
}

export interface CashSaveInput {
  lines: CashLineInput[];
  note?: string | null;
}

export interface CashAccountInput {
  name?: string;
  code?: string | null;
  number?: string | null;
  parentId?: string | null;
  /** Qator turi: ACCOUNT (hamma ustun), SUB (tushum ustunlari), BALANCE (faqat qoldiq) */
  preset?: 'ACCOUNT' | 'SUB' | 'BALANCE';
  /** Jamiga qo'shilsinmi (yuqori qatorga) */
  rollup?: boolean;
  balanceRule?: string;
  isActive?: boolean;
}

export interface CashReportRow {
  date: string;
  daily: string | null;
  regions: string | null;
  refund: string | null;
  balance: string | null;
  ytdAfter: string | null;
  mtdAfter: string | null;
  savedBy: string | null;
  updatedAt: string;
}

export interface CashOverview {
  today: string;
  todaySaved: boolean;
  latestDate: string | null;
  reports: number;
  latest: CashReportRow | null;
  /** Oxirgi 30 ta kun (eskidan yangiga) */
  series: { date: string; daily: string | null; regions: string | null }[];
  /** Shu oyda kiritilmagan ish kunlari (dushanba–juma, bugungacha) */
  missing: string[];
  /** Oxirgi kun: bo'limlar bo'yicha (sarlavhalar) */
  sections: { id: string; code: string | null; name: string; daily: string | null; balance: string | null }[];
  /** Oxirgi kun: hududlar bo'yicha kunlik tushum */
  regions: { id: string; name: string; daily: string | null; mtdAfter: string | null }[];
}

export interface CashImportResult {
  date: string | null;
  matched: number;
  unmatched: string[];
  values: Record<string, ValuesView>;
}

type LineRow = { accountId: string; ytdTiyin: bigint | null; mtdTiyin: bigint | null; refundTiyin: bigint | null; dailyTiyin: bigint | null; balanceTiyin: bigint | null };

const FIELD: Record<CashColumn, keyof Omit<LineRow, 'accountId'>> = {
  ytd: 'ytdTiyin',
  mtd: 'mtdTiyin',
  refund: 'refundTiyin',
  daily: 'dailyTiyin',
  balance: 'balanceTiyin',
};

const PRESETS: Record<NonNullable<CashAccountInput['preset']>, string[]> = {
  ACCOUNT: ['ytd', 'mtd', 'refund', 'daily', 'balance'],
  SUB: ['ytd', 'mtd', 'daily'],
  BALANCE: ['balance'],
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function todayTashkent(): string {
  return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
}

function parseDate(raw: string): Date {
  const s = String(raw ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new BadRequestException("Sana ko'rinishi: YYYY-MM-DD");
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || ymd(d) !== s) throw new BadRequestException("Sana noto'g'ri");
  if (s > todayTashkent()) throw new BadRequestException("Kelajakdagi sana uchun ma'lumotnoma yozib bo'lmaydi");
  if (s < '2000-01-01') throw new BadRequestException("Sana noto'g'ri");
  return d;
}

function toView(v: bigint | null): string | null {
  return v === null ? null : v.toString();
}

function lineValues(l: LineRow | undefined): Partial<CashValues> {
  if (!l) return {};
  return { ytd: l.ytdTiyin, mtd: l.mtdTiyin, refund: l.refundTiyin, daily: l.dailyTiyin, balance: l.balanceTiyin };
}

function parseAmount(raw: unknown, label: string, allowNegative: boolean): bigint | null {
  if (raw === null || raw === undefined || raw === '') return null;
  let v: bigint;
  try {
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw) || !Number.isInteger(raw)) throw new Error();
      v = BigInt(raw);
    } else {
      const s = String(raw).trim();
      if (!/^-?\d+$/.test(s)) throw new Error();
      v = BigInt(s);
    }
  } catch {
    throw new BadRequestException(`${label}: summa noto'g'ri`);
  }
  if (!allowNegative && v < 0n) throw new BadRequestException(`${label}: manfiy bo'lishi mumkin emas`);
  if (v > MAX_ABS || v < -MAX_ABS) throw new BadRequestException(`${label}: summa juda katta`);
  return v;
}

const COLUMN_LABEL: Record<CashColumn, string> = {
  ytd: 'Yil boshidan',
  mtd: 'Oy boshidan',
  refund: 'Qaytarilgan',
  daily: 'Kunlik tushum',
  balance: 'Qoldiq',
};

/** Nomni solishtirish uchun: kichik harf, faqat harf va raqam, kirill «А» → «a» */
function norm(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[аА]/g, 'a')
    .replace(/[сС]/g, 'c')
    .replace(/[дД]/g, 'd')
    .replace(/[ʼ‘’`']/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Ikki nom o'xshashligi (0..1, Dice koeffitsiyenti) */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const x = bigrams(a);
  const y = bigrams(b);
  let common = 0;
  for (const [g, n] of x) common += Math.min(n, y.get(g) ?? 0);
  const total = Math.max(1, a.length - 1 + (b.length - 1));
  return (2 * common) / total;
}

@Injectable()
export class CashbookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─────────── Tayanch kunlar ───────────
  // Fayldan yuklangan kun (oraliq kunlar kiritilmagan bo'lsa): «Yil/Oy boshidan» fayldagidek saqlanadi,
  // oldingi kundan qayta hisoblanmaydi (birinchi kun kabi). Ro'yxat — settings: cashbook.anchors

  private async anchorSet(db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<Set<string>> {
    const row = await db.setting.findUnique({ where: { key: ANCHOR_KEY } });
    return new Set(Array.isArray(row?.value) ? (row!.value as unknown[]).map(String) : []);
  }

  private async setAnchor(key: string, on: boolean): Promise<void> {
    const set = await this.anchorSet();
    if (set.has(key) === on) return;
    if (on) set.add(key);
    else set.delete(key);
    const value = [...set].sort();
    await this.prisma.setting.upsert({ where: { key: ANCHOR_KEY }, create: { key: ANCHOR_KEY, value }, update: { value } });
  }

  /** Shu kun tayanchmi (Yil/Oy boshidan qo'lda/fayldan) */
  async isAnchor(rawDate: string): Promise<boolean> {
    return (await this.anchorSet()).has(ymd(parseDate(rawDate)));
  }

  /** Sana bo'yicha oldingi saqlangan kun va uning qatorlari (fayl yuklashda zanjir bilan solishtirish uchun) */
  async previousLines(rawDate: string): Promise<{ date: string; lines: Map<string, { ytd: bigint | null; mtd: bigint | null; refund: bigint | null; daily: bigint | null; balance: bigint | null }> } | null> {
    const date = parseDate(rawDate);
    const prev = await this.prisma.cashReport.findFirst({ where: { date: { lt: date } }, orderBy: { date: 'desc' } });
    if (!prev) return null;
    const out = new Map<string, { ytd: bigint | null; mtd: bigint | null; refund: bigint | null; daily: bigint | null; balance: bigint | null }>();
    for (const [id, l] of await this.lines(prev.id)) out.set(id, { ytd: l.ytdTiyin, mtd: l.mtdTiyin, refund: l.refundTiyin, daily: l.dailyTiyin, balance: l.balanceTiyin });
    return { date: ymd(prev.date), lines: out };
  }

  // ─────────── Hisobraqamlar ───────────

  /** Bo'sh bazada shablondagi hisobraqamlar yaratiladi (bir marta) */
  private async ensureSeed(): Promise<void> {
    if ((await this.prisma.cashAccount.count()) > 0) return;
    const ids = new Map<string, string>();
    let order = 0;
    for (const s of SEED_ACCOUNTS) {
      const parentId = s.parent ? (ids.get(s.parent) ?? null) : null;
      const row = await this.prisma.cashAccount
        .create({
          data: {
            key: s.key,
            code: s.code,
            name: s.name,
            number: s.number ?? null,
            parentId,
            rollupId: null,
            sortOrder: (order += 10),
            inputs: s.inputs,
            sums: s.sums ?? [],
            balanceRule: s.balanceRule ?? 'ADD',
            isHeader: s.isHeader ?? false,
          },
          select: { id: true },
        })
        .catch(async () => this.prisma.cashAccount.findUnique({ where: { key: s.key }, select: { id: true } }));
      if (row) ids.set(s.key, row.id);
    }
    // Jami bog'lanishlari — hamma qator yaratilgach
    for (const s of SEED_ACCOUNTS) {
      const rollupKey = s.rollup === undefined ? (s.parent ?? null) : s.rollup;
      const id = ids.get(s.key);
      const rid = rollupKey ? ids.get(rollupKey) : null;
      if (id && rid) await this.prisma.cashAccount.update({ where: { id }, data: { rollupId: rid } });
    }
  }

  private view(rows: Awaited<ReturnType<CashbookService['rawAccounts']>>): CashAccountView[] {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const level = (id: string | null, depth = 0): number => {
      if (!id || depth > 10) return depth;
      const r = byId.get(id);
      return r?.parentId ? level(r.parentId, depth + 1) : depth;
    };
    // Tartib: ierarxiya bo'yicha (ota — keyin uning bolalari), har darajada sortOrder
    const kids = new Map<string | null, typeof rows>();
    for (const r of rows) {
      const p = r.parentId && byId.has(r.parentId) ? r.parentId : null;
      const list = kids.get(p) ?? [];
      list.push(r);
      kids.set(p, list);
    }
    for (const list of kids.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    const out: CashAccountView[] = [];
    const walk = (p: string | null) => {
      for (const r of kids.get(p) ?? []) {
        out.push({
          id: r.id,
          key: r.key,
          code: r.code,
          name: r.name,
          number: r.number,
          parentId: r.parentId,
          rollupId: r.rollupId,
          sortOrder: r.sortOrder,
          inputs: r.inputs,
          sums: r.sums,
          balanceRule: r.balanceRule,
          isHeader: r.isHeader,
          isActive: r.isActive,
          level: level(r.id),
        });
        walk(r.id);
      }
    };
    walk(null);
    return out;
  }

  private rawAccounts() {
    return this.prisma.cashAccount.findMany({
      select: {
        id: true,
        key: true,
        code: true,
        name: true,
        number: true,
        parentId: true,
        rollupId: true,
        sortOrder: true,
        inputs: true,
        sums: true,
        balanceRule: true,
        isHeader: true,
        isActive: true,
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async accounts(): Promise<CashAccountView[]> {
    await this.ensureSeed();
    return this.view(await this.rawAccounts());
  }

  private cleanText(raw: unknown, max: number): string | null {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).trim().replace(/\s+/g, ' ');
    if (!s) return null;
    if (s.length > max) throw new BadRequestException(`Matn juda uzun (ko'pi bilan ${max} belgi)`);
    return s;
  }

  private cleanNumber(raw: unknown): string | null {
    const s = this.cleanText(raw, 40);
    if (!s) return null;
    const digits = s.replace(/\s/g, '');
    if (!/^\d{5,30}$/.test(digits)) throw new BadRequestException("Hisob raqami faqat raqamlardan iborat bo'lsin");
    return digits;
  }

  async createAccount(input: CashAccountInput, userId: string): Promise<CashAccountView> {
    await this.ensureSeed();
    const name = this.cleanText(input.name, 200);
    if (!name || name.length < 2) throw new BadRequestException('Hisobraqam nomini yozing');
    const parentId = input.parentId || null;
    const parent = parentId ? await this.prisma.cashAccount.findUnique({ where: { id: parentId } }) : null;
    if (parentId && !parent) throw new BadRequestException("Yuqori qator topilmadi");
    const preset = input.preset && PRESETS[input.preset] ? input.preset : 'ACCOUNT';
    const rule = input.balanceRule && RULES.has(input.balanceRule) ? input.balanceRule : preset === 'BALANCE' ? 'KEEP' : 'ADD';
    const siblings = await this.prisma.cashAccount.findMany({ where: { parentId }, select: { sortOrder: true }, orderBy: { sortOrder: 'desc' }, take: 1 });
    const rollupId = input.rollup === false || !parent ? null : parent.sums.length > 0 ? parent.id : (parent.rollupId ?? null);
    const row = await this.prisma.cashAccount.create({
      data: {
        key: `U.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        code: this.cleanText(input.code, 12),
        name,
        number: this.cleanNumber(input.number),
        parentId,
        rollupId,
        sortOrder: (siblings[0]?.sortOrder ?? 0) + 10,
        inputs: PRESETS[preset],
        sums: [],
        balanceRule: rule,
      },
      select: { id: true },
    });
    await this.audit.log({ userId, action: 'CREATE', entity: 'cash_account', entityId: row.id, summary: `Hisobraqam qo'shildi: ${name}` });
    return (await this.accounts()).find((a) => a.id === row.id)!;
  }

  async updateAccount(id: string, input: CashAccountInput, userId: string): Promise<CashAccountView> {
    const row = await this.prisma.cashAccount.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Hisobraqam topilmadi');
    const data: Prisma.CashAccountUpdateInput = {};
    if (input.name !== undefined) {
      const name = this.cleanText(input.name, 200);
      if (!name || name.length < 2) throw new BadRequestException('Hisobraqam nomini yozing');
      data.name = name;
    }
    if (input.code !== undefined) data.code = this.cleanText(input.code, 12);
    if (input.number !== undefined) data.number = this.cleanNumber(input.number);
    if (input.isActive !== undefined) {
      if (row.isHeader && input.isActive === false) throw new BadRequestException("Bo'lim sarlavhasini yashirib bo'lmaydi");
      data.isActive = Boolean(input.isActive);
    }
    if (input.balanceRule !== undefined) {
      if (!RULES.has(input.balanceRule)) throw new BadRequestException("Qoldiq qoidasi noto'g'ri");
      data.balanceRule = input.balanceRule;
    }
    await this.prisma.cashAccount.update({ where: { id }, data });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'cash_account', entityId: id, summary: `Hisobraqam o'zgartirildi: ${String(data.name ?? row.name)}` });
    return (await this.accounts()).find((a) => a.id === id)!;
  }

  /**
   * Hisobraqamni o'chirish — faqat hech bir kunda summasi kiritilmagan, ichida qatori yo'q va boshqa qator
   * jamisi unga bog'lanmagan bo'lsa. Aks holda — «Yashirish» (isActive=false) taklif qilinadi (tarix buzilmasin).
   */
  async removeAccount(id: string, userId: string): Promise<{ success: true }> {
    const row = await this.prisma.cashAccount.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Hisobraqam topilmadi');
    if (row.isHeader) throw new BadRequestException("Bo'lim sarlavhasini o'chirib bo'lmaydi");
    const [kids, rolled, lines] = await Promise.all([
      this.prisma.cashAccount.count({ where: { parentId: id } }),
      this.prisma.cashAccount.count({ where: { rollupId: id } }),
      this.prisma.cashReportLine.count({ where: { accountId: id } }),
    ]);
    if (kids || rolled) throw new BadRequestException("Ichida qatorlari bor — avval ularni o'chiring yoki ko'chiring");
    if (lines) throw new BadRequestException(`Bu hisobraqam bo'yicha ${lines} ta kunda summa kiritilgan — o'chirib bo'lmaydi, «Yashirish»dan foydalaning`);
    await this.prisma.cashAccount.delete({ where: { id } });
    await this.audit.log({ userId, action: 'DELETE', entity: 'cash_account', entityId: id, summary: `Hisobraqam o'chirildi: ${row.name}` });
    return { success: true };
  }

  /** Bir qatorni yuqoriga/pastga (bir xil ota ichida) */
  async move(id: string, dir: 'up' | 'down'): Promise<CashAccountView[]> {
    const row = await this.prisma.cashAccount.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Hisobraqam topilmadi');
    const siblings = await this.prisma.cashAccount.findMany({ where: { parentId: row.parentId }, orderBy: { sortOrder: 'asc' } });
    const i = siblings.findIndex((s) => s.id === id);
    const j = dir === 'up' ? i - 1 : i + 1;
    if (i >= 0 && j >= 0 && j < siblings.length) {
      const other = siblings[j]!;
      await this.prisma.$transaction(async (tx) => {
        await tx.cashAccount.update({ where: { id: row.id }, data: { sortOrder: other.sortOrder } });
        await tx.cashAccount.update({ where: { id: other.id }, data: { sortOrder: row.sortOrder } });
      });
    }
    return this.accounts();
  }

  // ─────────── Kunlik ma'lumotnoma ───────────

  private async lines(reportId: string, db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<Map<string, LineRow>> {
    const rows = await db.cashReportLine.findMany({
      where: { reportId },
      select: { accountId: true, ytdTiyin: true, mtdTiyin: true, refundTiyin: true, dailyTiyin: true, balanceTiyin: true },
    });
    return new Map(rows.map((r) => [r.accountId, r]));
  }

  private async userName(id: string | null): Promise<string | null> {
    if (!id) return null;
    const u = await this.prisma.user.findUnique({ where: { id }, select: { fullName: true, loginCode: true } });
    return u ? (u.loginCode ? `${u.fullName} (${u.loginCode})` : u.fullName) : null;
  }

  async day(rawDate: string): Promise<CashDayView> {
    const date = parseDate(rawDate);
    const key = ymd(date);
    await this.ensureSeed();
    const all = this.view(await this.rawAccounts());
    const [report, prev, next, latest] = await Promise.all([
      this.prisma.cashReport.findUnique({ where: { date } }),
      this.prisma.cashReport.findFirst({ where: { date: { lt: date } }, orderBy: { date: 'desc' } }),
      this.prisma.cashReport.findFirst({ where: { date: { gt: date } }, orderBy: { date: 'asc' } }),
      this.prisma.cashReport.findFirst({ orderBy: { date: 'desc' }, select: { date: true } }),
    ]);
    const own = report ? await this.lines(report.id) : new Map<string, LineRow>();
    const prevLines = prev ? await this.lines(prev.id) : new Map<string, LineRow>();
    const anchored = Boolean(report) && (await this.anchorSet()).has(key);
    // Yashirilgan hisobraqam faqat shu kunda qiymati bo'lsa ko'rinadi
    const accounts = all.filter((a) => a.isActive || own.has(a.id));
    const values: Record<string, ValuesView> = {};
    for (const a of accounts) {
      const line = own.get(a.id);
      const carry = prev ? carryForward(a, lineValues(prevLines.get(a.id)), ymd(prev.date), key) : null;
      const v: ValuesView = { ytd: null, mtd: null, refund: null, daily: null, balance: null };
      for (const col of CASH_COLUMNS) {
        if (!a.inputs.includes(col)) continue;
        if (report) v[col] = toView(line ? line[FIELD[col]] : null);
        // Yangi kun: yil/oy boshidan va qoldiq — oldingi kundan
        else if (carry && (col === 'ytd' || col === 'mtd' || col === 'balance')) v[col] = toView(carry[col]);
      }
      // Birinchi kun bo'lmasa — yil/oy boshidan har doim oldingi kundan (qo'lda o'zgarmaydi)
      if (report && carry && !anchored) {
        if (a.inputs.includes('ytd')) v.ytd = toView(carry.ytd);
        if (a.inputs.includes('mtd')) v.mtd = toView(carry.mtd);
      }
      values[a.id] = v;
    }
    return {
      date: key,
      exists: Boolean(report),
      opening: !prev || anchored,
      prevDate: prev ? ymd(prev.date) : null,
      nextDate: next ? ymd(next.date) : null,
      latestDate: latest ? ymd(latest.date) : null,
      note: report?.note ?? null,
      savedAt: report ? report.updatedAt.toISOString() : null,
      savedBy: report ? await this.userName(report.updatedById ?? report.createdById) : null,
      accounts,
      values,
    };
  }

  /** Saqlash: shu kunning hamma qatorlari almashtiriladi; keyingi kunlarning yil/oy boshidan qayta hisoblanadi */
  async save(rawDate: string, input: CashSaveInput, userId: string, opts: { anchor?: boolean } = {}): Promise<CashDayView> {
    const date = parseDate(rawDate);
    const key = ymd(date);
    if (!input || !Array.isArray(input.lines)) throw new BadRequestException("Qatorlar yuborilmadi");
    if (input.lines.length > 2000) throw new BadRequestException("Qatorlar juda ko'p");
    await this.ensureSeed();
    const accounts = await this.rawAccounts();
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const note = this.cleanText(input.note, 500);
    if (opts.anchor !== undefined) await this.setAnchor(key, opts.anchor);
    const anchored = (await this.anchorSet()).has(key);

    // Kiritilgan qiymatlar (faqat kiritiladigan ustunlar)
    const parsed = new Map<string, Partial<CashValues>>();
    for (const l of input.lines) {
      const a = byId.get(String(l?.accountId ?? ''));
      if (!a) throw new BadRequestException('Hisobraqam topilmadi (sahifani yangilang)');
      const v: Partial<CashValues> = {};
      for (const col of CASH_COLUMNS) {
        if (!a.inputs.includes(col)) continue;
        v[col] = parseAmount(l[col], `${a.name} — ${COLUMN_LABEL[col]}`, col === 'balance');
      }
      parsed.set(a.id, v);
    }

    const result = await withRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const prev = await tx.cashReport.findFirst({ where: { date: { lt: date } }, orderBy: { date: 'desc' } });
        const prevLines = prev ? await this.lines(prev.id, tx) : new Map<string, LineRow>();
        const existing = await tx.cashReport.findUnique({ where: { date } });
        const report = existing
          ? await tx.cashReport.update({ where: { id: existing.id }, data: { note, updatedById: userId } })
          : await tx.cashReport.create({ data: { date, note, createdById: userId, updatedById: userId } });

        const rows: (LineRow & { reportId: string })[] = [];
        for (const a of accounts) {
          const v: Partial<CashValues> = { ...(parsed.get(a.id) ?? {}) };
          if (prev && !anchored) {
            // Birinchi kun (yoki tayanch kun) emas — yil/oy boshidan oldingi kundan olinadi
            const carry = carryForward(a, lineValues(prevLines.get(a.id)), ymd(prev.date), key);
            if (a.inputs.includes('ytd')) v.ytd = carry.ytd;
            if (a.inputs.includes('mtd')) v.mtd = carry.mtd;
          }
          const row = {
            reportId: report.id,
            accountId: a.id,
            ytdTiyin: v.ytd ?? null,
            mtdTiyin: v.mtd ?? null,
            refundTiyin: v.refund ?? null,
            dailyTiyin: v.daily ?? null,
            balanceTiyin: v.balance ?? null,
          };
          if (CASH_COLUMNS.some((c) => row[FIELD[c]] !== null)) rows.push(row);
        }
        await tx.cashReportLine.deleteMany({ where: { reportId: report.id } });
        if (rows.length) await tx.cashReportLine.createMany({ data: rows });
        const changed = await this.recomputeAfter(tx, date, accounts);
        return { report, created: !existing, changed };
      }, SERIALIZABLE),
    );

    const total = this.totalDaily(accounts, parsed);
    await this.audit.log({
      userId,
      action: result.created ? 'CREATE' : 'UPDATE',
      entity: 'cash_report',
      entityId: result.report.id,
      summary: `Kunlik tushum ${key.split('-').reverse().join('.')}: ${result.created ? 'yozildi' : "o'zgartirildi"}${total !== null ? ` (kunlik jami ${(Number(total) / 100_000).toLocaleString('ru-RU', { maximumFractionDigits: 3 })} ming so'm)` : ''}${result.changed ? `; keyingi ${result.changed} kun qayta hisoblandi` : ''}`,
    });
    return this.day(key);
  }

  private totalDaily(accounts: CalcAccount[], parsed: Map<string, Partial<CashValues>>): bigint | null {
    const head = (accounts as (CalcAccount & { key?: string })[]).find((a) => a.key === 'I');
    if (!head) return null;
    return computeAll(accounts, parsed).get(head.id)?.values.daily ?? null;
  }

  /** `from` sanasidan keyingi kunlarning «yil boshidan» va «oy boshidan»ini zanjir bo'yicha qayta hisoblaydi */
  private async recomputeAfter(tx: Prisma.TransactionClient, from: Date, accounts: CalcAccount[]): Promise<number> {
    const later = await tx.cashReport.findMany({ where: { date: { gt: from } }, orderBy: { date: 'asc' }, select: { id: true, date: true } });
    if (!later.length) return 0;
    let prev = await tx.cashReport.findFirst({ where: { date: { lte: from } }, orderBy: { date: 'desc' }, select: { id: true, date: true } });
    let prevLines = prev ? await this.lines(prev.id, tx) : new Map<string, LineRow>();
    const carried = accounts.filter((a) => a.inputs.includes('ytd') || a.inputs.includes('mtd'));
    const anchors = await this.anchorSet(tx);
    for (const r of later) {
      const own = await this.lines(r.id, tx);
      if (prev && !anchors.has(ymd(r.date))) {
        for (const a of carried) {
          const c = carryForward(a, lineValues(prevLines.get(a.id)), ymd(prev.date), ymd(r.date));
          const line = own.get(a.id);
          const ytd = a.inputs.includes('ytd') ? c.ytd : (line?.ytdTiyin ?? null);
          const mtd = a.inputs.includes('mtd') ? c.mtd : (line?.mtdTiyin ?? null);
          if (line) {
            if (line.ytdTiyin !== ytd || line.mtdTiyin !== mtd) {
              await tx.cashReportLine.update({ where: { reportId_accountId: { reportId: r.id, accountId: a.id } }, data: { ytdTiyin: ytd, mtdTiyin: mtd } });
              line.ytdTiyin = ytd;
              line.mtdTiyin = mtd;
            }
          } else if (ytd !== null || mtd !== null) {
            const row = { accountId: a.id, ytdTiyin: ytd, mtdTiyin: mtd, refundTiyin: null, dailyTiyin: null, balanceTiyin: null };
            await tx.cashReportLine.create({ data: { reportId: r.id, ...row } });
            own.set(a.id, row);
          }
        }
      }
      prev = r;
      prevLines = own;
    }
    return later.length;
  }

  /** Kunni o'chirish (faqat administrator) — keyingi kunlar qayta hisoblanadi */
  async remove(rawDate: string, userId: string): Promise<{ ok: true }> {
    const date = parseDate(rawDate);
    const report = await this.prisma.cashReport.findUnique({ where: { date } });
    if (!report) throw new NotFoundException('Bu kun uchun ma\'lumotnoma yo\'q');
    const accounts = await this.rawAccounts();
    await this.prisma.$transaction(async (tx) => {
      await tx.cashReportLine.deleteMany({ where: { reportId: report.id } });
      await tx.cashReport.delete({ where: { id: report.id } });
      await this.recomputeAfter(tx, date, accounts);
    }, SERIALIZABLE);
    await this.setAnchor(ymd(date), false);
    await this.audit.log({ userId, action: 'DELETE', entity: 'cash_report', entityId: report.id, summary: `Kunlik tushum ${ymd(date).split('-').reverse().join('.')} o'chirildi` });
    return { ok: true };
  }

  // ─────────── Ro'yxat, dashbord ───────────

  private summarize(accounts: (CalcAccount & { key: string })[], lines: Map<string, LineRow>) {
    const input = new Map<string, Partial<CashValues>>();
    for (const [id, l] of lines) input.set(id, lineValues(l));
    const all = computeAll(accounts, input);
    const at = (k: string) => {
      const a = accounts.find((x) => x.key === k);
      return a ? (all.get(a.id) ?? null) : null;
    };
    return { all, total: at('I'), regions: at('II') };
  }

  async reports(from?: string, to?: string): Promise<CashReportRow[]> {
    await this.ensureSeed();
    const where: Prisma.CashReportWhereInput = {};
    const range: Prisma.DateTimeFilter = {};
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) range.gte = new Date(`${from}T00:00:00Z`);
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) range.lte = new Date(`${to}T00:00:00Z`);
    if (range.gte || range.lte) where.date = range;
    const reports = await this.prisma.cashReport.findMany({ where, orderBy: { date: 'desc' }, take: 400 });
    return this.rows(reports);
  }

  private async rows(reports: { id: string; date: Date; updatedAt: Date; updatedById: string | null; createdById: string | null }[]): Promise<CashReportRow[]> {
    if (!reports.length) return [];
    const accounts = await this.rawAccounts();
    const lineRows = await this.prisma.cashReportLine.findMany({
      where: { reportId: { in: reports.map((r) => r.id) } },
      select: { reportId: true, accountId: true, ytdTiyin: true, mtdTiyin: true, refundTiyin: true, dailyTiyin: true, balanceTiyin: true },
    });
    const byReport = new Map<string, Map<string, LineRow>>();
    for (const l of lineRows) {
      const m = byReport.get(l.reportId) ?? new Map<string, LineRow>();
      m.set(l.accountId, l);
      byReport.set(l.reportId, m);
    }
    const userIds = [...new Set(reports.map((r) => r.updatedById ?? r.createdById).filter((x): x is string => Boolean(x)))];
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : [];
    const names = new Map(users.map((u) => [u.id, u.fullName]));
    return reports.map((r) => {
      const s = this.summarize(accounts, byReport.get(r.id) ?? new Map());
      const t = s.total;
      return {
        date: ymd(r.date),
        daily: toView(t?.values.daily ?? null),
        regions: toView(s.regions?.values.daily ?? null),
        refund: toView(t?.values.refund ?? null),
        balance: toView(t?.after.balance ?? null),
        ytdAfter: toView(t?.after.ytd ?? null),
        mtdAfter: toView(t?.after.mtd ?? null),
        savedBy: names.get(r.updatedById ?? r.createdById ?? '') ?? null,
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }

  async overview(): Promise<CashOverview> {
    await this.ensureSeed();
    const today = todayTashkent();
    const recent = await this.prisma.cashReport.findMany({ orderBy: { date: 'desc' }, take: 30 });
    const count = await this.prisma.cashReport.count();
    const rows = await this.rows(recent);
    const latest = recent[0] ?? null;

    // Shu oyning ish kunlari (dushanba–juma), bugungacha — kiritilmaganlari
    const have = new Set(rows.map((r) => r.date));
    const monthStart = `${today.slice(0, 7)}-01`;
    const monthRows = await this.prisma.cashReport.findMany({ where: { date: { gte: new Date(`${monthStart}T00:00:00Z`) } }, select: { date: true } });
    for (const r of monthRows) have.add(ymd(r.date));
    const missing: string[] = [];
    for (let d = new Date(`${monthStart}T00:00:00Z`); ymd(d) <= today; d = new Date(d.getTime() + 86_400_000)) {
      const wd = d.getUTCDay();
      if (wd !== 0 && wd !== 6 && !have.has(ymd(d))) missing.push(ymd(d));
    }

    let sections: CashOverview['sections'] = [];
    let regions: CashOverview['regions'] = [];
    if (latest) {
      const accounts = await this.rawAccounts();
      const s = this.summarize(accounts, await this.lines(latest.id));
      sections = accounts
        .filter((a) => a.isHeader)
        .map((a) => {
          const v = s.all.get(a.id);
          return { id: a.id, code: a.code, name: a.name, daily: toView(v?.values.daily ?? null), balance: toView(v?.after.balance ?? null) };
        });
      const head = accounts.find((a) => a.key === 'II');
      regions = head
        ? accounts
            .filter((a) => a.rollupId === head.id && a.isActive)
            .map((a) => {
              const v = s.all.get(a.id);
              return { id: a.id, name: a.name, daily: toView(v?.values.daily ?? null), mtdAfter: toView(v?.after.mtd ?? null) };
            })
        : [];
    }

    return {
      today,
      todaySaved: have.has(today),
      latestDate: latest ? ymd(latest.date) : null,
      reports: count,
      latest: rows[0] ?? null,
      series: [...rows].reverse().map((r) => ({ date: r.date, daily: r.daily, regions: r.regions })),
      missing,
      sections,
      regions,
    };
  }

  // ─────────── Excel ───────────

  /** Shablon ko'rinishidagi Excel (ming so'mda) */
  async exportXlsx(rawDate: string, opts: { blank?: boolean } = {}): Promise<{ buffer: Buffer; filename: string }> {
    const view = await this.day(rawDate);
    if (opts.blank) {
      // Bo'sh shablon: faqat hisobraqamlar ro'yxati (qiymatlarsiz), yashirilganlar ko'rsatilmaydi
      view.accounts = view.accounts.filter((a) => a.isActive);
      for (const id of Object.keys(view.values)) view.values[id] = { ytd: null, mtd: null, refund: null, daily: null, balance: null };
      view.note = null;
    } else if (!view.exists) throw new NotFoundException("Bu kun uchun ma'lumotnoma hali saqlanmagan");
    const input = new Map<string, Partial<CashValues>>();
    for (const [id, v] of Object.entries(view.values)) {
      const p: Partial<CashValues> = {};
      for (const c of CASH_COLUMNS) p[c] = v[c] === null ? null : BigInt(v[c]!);
      input.set(id, p);
    }
    const calc = computeAll(view.accounts, input);
    const dmy = view.date.split('-').reverse().join('.');

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Korxona tahlil';
    const ws = wb.addWorksheet(`Kunlik ${dmy}`, { views: [{ state: 'frozen', ySplit: 5 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
    ws.columns = [
      { width: 7 },
      { width: 52 },
      { width: 26 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
      { width: 16 },
      { width: 18 },
      { width: 3 },
      { width: 16 },
      { width: 16 },
      { width: 18 },
    ];
    const font = { name: 'Times New Roman', size: 11 };
    const thin = { style: 'thin' as const, color: { argb: 'FF808080' } };
    const border = { top: thin, left: thin, bottom: thin, right: thin };

    ws.mergeCells('A1:H1');
    const title = ws.getCell('A1');
    title.value = "Hisobraqamlar bo'yicha kunlik tushum hamda qoldiq mablag'lar to'g'risida\nMA'LUMOT";
    title.font = { ...font, size: 14, bold: true };
    title.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    ws.getRow(1).height = 48;
    ws.getCell('H3').value = "ming so'mda";
    ws.getCell('H3').font = { ...font, italic: true };
    ws.getCell('H3').alignment = { horizontal: 'right' };

    const heads = ['T/r', 'Hisobraqam nomi', 'Hisob raqami', 'Yil boshidan', 'Oy boshidan', "Qaytarilgan pul mablag'lari", 'Kunlik tushum', `${dmy} holatiga qoldiq`];
    heads.forEach((h, i) => {
      const col = String.fromCharCode(65 + i);
      ws.mergeCells(`${col}4:${col}5`);
      const c = ws.getCell(`${col}4`);
      c.value = h;
      c.font = { ...font, bold: true };
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E2F3' } };
      c.border = border;
    });
    ws.mergeCells('J4:L4');
    ws.getCell('J4').value = 'Bugun bilan birga';
    ['Yil boshidan', 'Oy boshidan', 'Bugungi holatga qoldiq'].forEach((h, i) => {
      const c = ws.getCell(5, 10 + i);
      c.value = h;
      c.font = { ...font, bold: true };
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
      c.border = border;
    });
    ws.getCell('J4').font = { ...font, bold: true };
    ws.getCell('J4').alignment = { horizontal: 'center' };
    ws.getRow(4).height = 22;
    ws.getRow(5).height = 34;

    const num = (v: bigint | null | undefined) => (v === null || v === undefined ? null : Number(v) / 100_000);
    let r = 6;
    for (const a of view.accounts) {
      const c = calc.get(a.id);
      const v = c?.values;
      const row = ws.getRow(r);
      row.values = [
        a.code ?? '',
        `${'   '.repeat(Math.max(0, a.level - (a.isHeader ? 0 : 1)))}${a.name}`,
        a.number ?? '',
        num(v?.ytd),
        num(v?.mtd),
        num(v?.refund),
        num(v?.daily),
        num(v?.balance),
        null,
        num(c?.after.ytd),
        num(c?.after.mtd),
        num(c?.after.balance),
      ];
      for (let i = 1; i <= 12; i++) {
        if (i === 9) continue;
        const cell = row.getCell(i);
        cell.font = { ...font, bold: a.isHeader || (a.level === 1 && a.sums.length > 0) };
        cell.border = border;
        if (i >= 4) cell.numFmt = '#,##0.0##;-#,##0.0##;"-"';
        if (i === 2) cell.alignment = { wrapText: true, vertical: 'middle' };
        if (i === 1 || i === 3) cell.alignment = { horizontal: 'center', vertical: 'middle' };
        if (a.isHeader) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
        if (i >= 10 && !a.isHeader) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F7' } };
      }
      r++;
    }
    if (view.note) {
      ws.getCell(r + 1, 2).value = `Izoh: ${view.note}`;
      ws.getCell(r + 1, 2).font = { ...font, italic: true };
    }
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return { buffer, filename: opts.blank ? `Kunlik tushum shablon ${dmy}.xlsx` : `Kunlik tushum ${dmy}.xlsx` };
  }

  /**
   * To'ldirilgan shablondan o'qish (saqlamaydi — ekranga qaytaradi, Buxgalter tekshirib saqlaydi).
   * Qatorlar hisob raqami, T/r va nomi bo'yicha moslashtiriladi.
   */
  async parseImport(buffer: Buffer | undefined): Promise<CashImportResult> {
    if (!buffer || buffer.length === 0) throw new BadRequestException('Fayl yuklanmadi');
    const wb = new ExcelJS.Workbook();
    await assertSafeXlsx(buffer);
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException("Faylni o'qib bo'lmadi (.xlsx bo'lishi kerak)");
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('Faylda varaq topilmadi');
    await this.ensureSeed();
    const accounts = this.view(await this.rawAccounts());

    const text = (v: ExcelJS.CellValue): string => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') {
        if ('richText' in v) return v.richText.map((t) => t.text).join('');
        if ('result' in v) return text(v.result as ExcelJS.CellValue);
        if ('text' in v) return String(v.text);
      }
      return String(v);
    };
    const amount = (v: ExcelJS.CellValue): bigint | null => {
      const raw = v && typeof v === 'object' && 'result' in v ? v.result : v;
      if (raw === null || raw === undefined || raw === '') return null;
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(n)) return null;
      return BigInt(Math.round(n * 1000)) * 100n; // ming so'm → so'm → tiyin
    };

    // Sarlavha qatori va sana
    let start = 0;
    let date: string | null = null;
    ws.eachRow((row, i) => {
      if (start) return;
      const b = norm(text(row.getCell(2).value));
      if (b.includes('hisobraqamnomi')) {
        start = i + 1;
        const h = text(row.getCell(8).value);
        const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(h);
        if (m) date = `${m[3]}-${m[2]}-${m[1]}`;
      }
    });
    if (!start) throw new BadRequestException("Shablon topilmadi: «Hisobraqam nomi» ustuni yo'q");

    const used = new Set<string>();
    const values: Record<string, ValuesView> = {};
    const unmatched: string[] = [];
    let section: string | null = null;
    const ROMAN = /^(I|II|III|IV|V|VI|VII|VIII|IX|X)$/;

    for (let i = start; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      const code = text(row.getCell(1).value).trim();
      const name = text(row.getCell(2).value).trim();
      const number = text(row.getCell(3).value).replace(/\s/g, '');
      // Birlashtirilgan sarlavha katagi (B4:B5) ikkinchi qatorda ham o'qiladi — o'tkazib yuboriladi
      if (!name || norm(name) === 'hisobraqamnomi') continue;
      if (ROMAN.test(code)) section = code;
      const pool = accounts.filter((a) => !used.has(a.id) && (section ? a.key === section || a.key.startsWith(`${section}.`) || !/^[IVX]+(\.|$)/.test(a.key) : true));
      let best: (typeof accounts)[number] | null = null;
      let score = 0;
      const n = norm(name);
      for (const a of pool) {
        let s = similarity(n, norm(a.name)) * 40;
        if (number && a.number && a.number === number) s += 100;
        if (code && a.code && a.code === code) s += 25;
        if (s > score) {
          score = s;
          best = a;
        }
      }
      if (!best || score < 30) {
        unmatched.push(name.replace(/\s+/g, ' '));
        continue;
      }
      used.add(best.id);
      const v: ValuesView = { ytd: null, mtd: null, refund: null, daily: null, balance: null };
      const cells: Record<CashColumn, number> = { ytd: 4, mtd: 5, refund: 6, daily: 7, balance: 8 };
      for (const col of CASH_COLUMNS) if (best.inputs.includes(col)) v[col] = toView(amount(row.getCell(cells[col]).value));
      values[best.id] = v;
    }
    return { date, matched: Object.keys(values).length, unmatched, values };
  }
}