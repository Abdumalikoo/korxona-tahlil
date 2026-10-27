import { BadRequestException, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { EntrySection } from '@prisma/client';
import { isSegment, segmentLabel, type SegmentCode } from '../../common/segments/segments';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CashbookService, type CashAccountView, type CashLineInput } from './cashbook.service';

// ═══════════════════════════════════════════════════════════
// Markaz daromadlari — «Kunlik tushum va qoldiq» ma'lumotnomasidan oylik daromad.
//   • Manba: Buxgalter kiritgan kunlik ma'lumotnoma yoki yuklangan Excel (o'sha shakl).
//   • Oy daromadi faqat «Oy boshidan» ustunidan (qolgan ustunlar — kunlik tushum, yil boshidan, qaytarilgan, qoldiq —
//     faqat hisobot uchun): oyning OXIRGI ma'lumotnomasidagi «Oy boshidan» − o'tgan oy oxirgi ma'lumotnomasidagi
//     «Oy boshidan» (yil ichida yig'ilib boradi). Masalan EHF: yanvar 2 mlrd, fevral 3,5 mlrd → fevral daromadi 1,5 mlrd.
//     Yanvar (yoki yilning birinchi ma'lumotnomali oyi) — o'zi. Ustun oy boshida nolga tushgan bo'lsa (har oy alohida
//     yuritilgan: «Oy boshidan» ≠ «Yil boshidan» yoki o'tgan oydan kichik) — shu oy qiymati o'zi olinadi.
//   • Har hisobraqam turi: DOIMIY (Markaz daromadi), BOSHQA (bir martalik/boshqa daromad),
//     REGION (hududiy bo'limlar — faqat hisobot uchun, tahlilga kirmaydi), NONE (daromad emas:
//     qaytarilgan, noto'g'ri tushgan, fuqarolarga to'lanadigan pul).
//   • DOIMIY va BOSHQA — Daromadlar jadvaliga Markaz (kod 0) daromadi bo'lib yoziladi
//     (importBatchId = «kassa:YYYY-MM»): Tahlil, Solishtirma, bosh sahifa ularni o'zi ko'radi.
//     Qayta yuklash yoki tuzatish — shu oy yozuvlari almashtiriladi (ikki marta sanalmaydi).
//   • Har tushum qatori kimniki: Markaz (odatiy) yoki yo'nalish — «Tax free» nomli qator (masalan, «Tax free (10 %)»)
//     Tax free daromadi, «marksheyder» so'zi bor qator — Marksheyder daromadi. Yo'nalish daromadi `segment` bilan yoziladi:
//     Solishtirmada o'sha yo'nalishning o'z xarajatlari bilan bir qatorda (daromad − xarajat = natija) ko'rinadi.
//     Buxgalter qatorning egasini o'zgartirishi mumkin (center-income.segments sozlamasi).
// ═══════════════════════════════════════════════════════════

export type CenterMode = 'DOIMIY' | 'BOSHQA' | 'REGION' | 'NONE';
const MODES: CenterMode[] = ['DOIMIY', 'BOSHQA', 'REGION', 'NONE'];
const MAP_KEY = 'center-income.map';
/** Qator egasi: Markaz yoki yo'nalish (Tax free, Marksheyder …) */
const SEG_KEY = 'center-income.segments';
export type CenterOwner = 'CENTER' | SegmentCode;
const isOwner = (v: unknown): v is CenterOwner => v === 'CENTER' || isSegment(v);
const CENTRAL = 0;
const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];

export const tagOf = (period: string) => `kassa:${period}`;
const label = (period: string) => `${MONTHS[Number(period.slice(5)) - 1]} ${period.slice(0, 4)}`;
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const nextPeriod = (p: string) => {
  const y = Number(p.slice(0, 4));
  const m = Number(p.slice(5));
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
};

function norm(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[ʼ‘’`']/g, '')
    .replace(/[^a-z0-9а-яё]/g, '');
}

/** Tushum hisoblanadigan qator: «Oy boshidan» yoki «Kunlik tushum» kiritiladi */
const counted = (a: CashAccountView) => !a.isHeader && (a.inputs.includes('daily') || a.inputs.includes('mtd'));

export interface CenterMonth {
  period: string;
  label: string;
  /** Oyning oxirgi ma'lumotnomasi sanasi */
  reportDate: string | null;
  reports: number;
  doimiyTiyin: string;
  boshqaTiyin: string;
  /** Markaz daromadi jami (doimiy + boshqa) */
  markazTiyin: string;
  /** Hududiy bo'limlardan tushgan (faqat hisobot uchun) */
  regionsTiyin: string;
  /** Daromadlar jadvaliga yozilgani */
  syncedTiyin: string;
  inSync: boolean;
  /** Markazga boshqa yo'l bilan (qo'lda, boshqa fayl) yozilgan daromad — ikki marta sanalmasin, tekshirish uchun */
  otherCenterTiyin: string;
  /** Hududlar tushumi (Daromadlar › Hududlar tushumi) — hududiy bo'limlar bilan solishtirish */
  regionIncomeTiyin: string;
  /** Shundan yo'nalishlarga (Tax free, Marksheyder …) yozilgan daromad */
  segmentsTiyin: string;
}

export interface CenterRow {
  id: string;
  key: string;
  code: string | null;
  name: string;
  level: number;
  isHeader: boolean;
  /** Qator turi (tushum qatorlari uchun); sarlavha — null */
  mode: CenterMode | null;
  defaultMode: CenterMode | null;
  /** Qator egasi (tushum qatorlari uchun): Markaz yoki yo'nalish */
  owner: CenterOwner | null;
  defaultOwner: CenterOwner | null;
  months: Record<string, string | null>;
  totalTiyin: string;
}

export interface CenterYear {
  year: number;
  latestDate: string | null;
  months: CenterMonth[];
  rows: CenterRow[];
  totals: { doimiyTiyin: string; boshqaTiyin: string; markazTiyin: string; regionsTiyin: string; syncedTiyin: string };
}

export interface CenterPreview {
  date: string;
  period: string;
  label: string;
  exists: boolean;
  matched: number;
  unmatched: string[];
  /** Oldingi saqlangan kun bilan «Oy/Yil boshidan» mos kelmaydi (oraliq kunlar kiritilmagan) — fayldagisi olinadi */
  gap: { prevDate: string; accounts: number } | null;
  /** Oyning keyingi kunlari allaqachon bor — oy daromadi o'sha kundan olinadi */
  laterInMonth: string | null;
  doimiyTiyin: string;
  boshqaTiyin: string;
  markazTiyin: string;
  regionsTiyin: string;
  lines: { id: string; code: string | null; name: string; mode: CenterMode; amountTiyin: string }[];
}

@Injectable()
export class CenterIncomeService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CenterIncomeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cashbook: CashbookService,
    private readonly audit: AuditService,
  ) {}

  /** Bir marta (yangi qoidaga o'tishda): hamma oylar Markaz daromadi «Oy boshidan» farqi bilan qayta yoziladi */
  onApplicationBootstrap(): void {
    setTimeout(() => {
      void (async () => {
        const KEY = 'center-income.rule';
        const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
        // v3 — yo'nalish qatorlari (Tax free, Marksheyder) o'z yo'nalishiga yoziladi
        if ((row?.value as { v?: number } | null)?.v === 3) return;
        const admin = await this.prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
        if (!admin) return;
        const r = await this.syncAll(admin.id);
        const value = { v: 3, at: new Date().toISOString(), periods: r.periods };
        await this.prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
        this.logger.log(`Markaz daromadi qayta yozildi (yo'nalishlar bilan): ${r.periods} oy`);
      })().catch((e: unknown) => this.logger.warn(`Markaz daromadi qayta hisoblanmadi: ${(e as Error).message}`));
    }, 6_000);
  }

  // ─────────── Qator turlari ───────────

  /** Boshlang'ich tur: I bo'lim — Markaz daromadi (qaytarilgan/noto'g'ri/qarz — yo'q, depozit — boshqa), II — hududlar, V — boshqa */
  defaultMode(a: CashAccountView, byId: Map<string, CashAccountView>): CenterMode {
    let top = a;
    for (let i = 0; i < 10 && top.parentId && byId.has(top.parentId); i++) top = byId.get(top.parentId)!;
    const n = norm(a.name);
    const root = top.key.split('.')[0];
    if (root === 'I' || top.key.startsWith('U.')) {
      if (/notogri|qaytar|qarz/.test(n)) return 'NONE';
      if (/depozit/.test(n)) return 'BOSHQA';
      return 'DOIMIY';
    }
    if (root === 'II') return 'REGION';
    if (root === 'V') return 'BOSHQA';
    return 'NONE';
  }

  /** Boshlang'ich egasi: nomida «Tax free» — Tax free, «marksheyder» — Marksheyder, qolgani — Markaz */
  defaultOwner(a: CashAccountView): CenterOwner {
    const n = norm(a.name);
    if (/taxfree/.test(n)) return 'TAX_FREE';
    if (/marksheyd|маркшейд/.test(n)) return 'MARKSHEYDER';
    return 'CENTER';
  }

  private async ownerMap(): Promise<Record<string, CenterOwner>> {
    const row = await this.prisma.setting.findUnique({ where: { key: SEG_KEY } });
    const v = row?.value;
    const out: Record<string, CenterOwner> = {};
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, o] of Object.entries(v as Record<string, unknown>)) if (isOwner(o)) out[k] = o;
    return out;
  }

  private async owners(accounts: CashAccountView[]): Promise<Map<string, CenterOwner>> {
    const map = await this.ownerMap();
    return new Map(accounts.filter(counted).map((a) => [a.id, map[a.id] ?? this.defaultOwner(a)]));
  }

  private async modeMap(): Promise<Record<string, CenterMode>> {
    const row = await this.prisma.setting.findUnique({ where: { key: MAP_KEY } });
    const v = row?.value;
    const out: Record<string, CenterMode> = {};
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, m] of Object.entries(v as Record<string, unknown>)) if (MODES.includes(m as CenterMode)) out[k] = m as CenterMode;
    return out;
  }

  private async modes(accounts: CashAccountView[]): Promise<Map<string, CenterMode>> {
    const map = await this.modeMap();
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return new Map(accounts.filter(counted).map((a) => [a.id, map[a.id] ?? this.defaultMode(a, byId)]));
  }

  async setModes(input: unknown, userId: string): Promise<CenterYear> {
    const body = (input ?? {}) as { modes?: Record<string, unknown>; owners?: Record<string, unknown>; year?: unknown };
    const hasModes = Boolean(body.modes && typeof body.modes === 'object');
    const hasOwners = Boolean(body.owners && typeof body.owners === 'object');
    if (!hasModes && !hasOwners) throw new BadRequestException("O'zgartirish yuborilmadi");
    const accounts = await this.cashbook.accounts();
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const map = await this.modeMap();
    const changed: string[] = [];
    if (hasOwners) {
      const owners = await this.ownerMap();
      for (const [id, raw] of Object.entries(body.owners!)) {
        const a = byId.get(id);
        if (!a || !counted(a)) throw new BadRequestException('Hisobraqam topilmadi (sahifani yangilang)');
        if (!isOwner(raw)) throw new BadRequestException(`${a.name}: egasi noto'g'ri`);
        if ((owners[id] ?? this.defaultOwner(a)) !== raw) changed.push(`${a.name} → ${raw === 'CENTER' ? 'Markaz' : segmentLabel(raw)}`);
        if (raw === this.defaultOwner(a)) delete owners[id];
        else owners[id] = raw;
      }
      await this.prisma.setting.upsert({ where: { key: SEG_KEY }, create: { key: SEG_KEY, value: owners }, update: { value: owners } });
    }
    for (const [id, raw] of Object.entries(body.modes ?? {})) {
      const a = byId.get(id);
      if (!a || !counted(a)) throw new BadRequestException('Hisobraqam topilmadi (sahifani yangilang)');
      if (!MODES.includes(raw as CenterMode)) throw new BadRequestException(`${a.name}: tur noto'g'ri`);
      const m = raw as CenterMode;
      if ((map[id] ?? this.defaultMode(a, byId)) !== m) changed.push(`${a.name} → ${m}`);
      if (m === this.defaultMode(a, byId)) delete map[id];
      else map[id] = m;
    }
    await this.prisma.setting.upsert({ where: { key: MAP_KEY }, create: { key: MAP_KEY, value: map }, update: { value: map } });
    if (changed.length) {
      await this.syncAll(userId);
      await this.audit.log({ userId, action: 'UPDATE', entity: 'center_income', entityId: MAP_KEY, summary: `Markaz daromadi qatorlari: ${changed.slice(0, 5).join('; ')}${changed.length > 5 ? ' …' : ''}` });
    }
    return this.year(Number(body.year) || new Date().getUTCFullYear());
  }

  // ─────────── Oy qiymatlari ───────────

  private async monthReports(from: string, to: string) {
    return this.prisma.cashReport.findMany({
      where: { date: { gte: new Date(`${from}-01T00:00:00Z`), lt: new Date(`${to}-01T00:00:00Z`) } },
      select: { id: true, date: true },
      orderBy: { date: 'asc' },
    });
  }

  /**
   * Hisobraqamning oy daromadi «Oy boshidan» ustunidan:
   *   cur — shu oy oxirgi ma'lumotnomasidagi «Oy boshidan», prev — yil ichidagi o'tgan oyniki.
   *   Yil boshidan yig'ilib borsa — farq; har oy noldan boshlansa (Yil boshidan bilan farq qiladi yoki kamaygan) — o'zi.
   */
  static incomeOf(cur: { mtd: bigint | null; ytd: bigint | null }, prev: { mtd: bigint | null } | null): bigint {
    const m = cur.mtd ?? 0n;
    if (!prev) return m;
    const pm = prev.mtd ?? 0n;
    if (cur.ytd !== null && cur.ytd !== m) return m;
    return m >= pm ? m - pm : m;
  }

  /** Oylar oxirgi ma'lumotnomalari: oy → sana, hisobraqam → «Oy boshidan», «Yil boshidan» */
  private async lastReports(from: string, to: string) {
    const reports = await this.monthReports(from, to);
    const last = new Map<string, { id: string; date: Date; count: number }>();
    for (const r of reports) {
      const p = ymd(r.date).slice(0, 7);
      const prev = last.get(p);
      last.set(p, { id: r.id, date: r.date, count: (prev?.count ?? 0) + 1 });
    }
    const ids = [...last.values()].map((x) => x.id);
    const lines = ids.length
      ? await this.prisma.cashReportLine.findMany({ where: { reportId: { in: ids } }, select: { reportId: true, accountId: true, mtdTiyin: true, ytdTiyin: true } })
      : [];
    const out = new Map<string, { date: string; reports: number; cum: Map<string, { mtd: bigint | null; ytd: bigint | null }> }>();
    for (const [p, r] of last) {
      const cum = new Map<string, { mtd: bigint | null; ytd: bigint | null }>();
      for (const l of lines) if (l.reportId === r.id) cum.set(l.accountId, { mtd: l.mtdTiyin ?? null, ytd: l.ytdTiyin ?? null });
      out.set(p, { date: ymd(r.date), reports: r.count, cum });
    }
    return out;
  }

  /** Oy → oxirgi kun → hisobraqam bo'yicha oy daromadi («Oy boshidan» farqi) */
  private async monthValues(periods: string[]): Promise<Map<string, { date: string; reports: number; values: Map<string, bigint> }>> {
    const out = new Map<string, { date: string; reports: number; values: Map<string, bigint> }>();
    if (!periods.length) return out;
    const sorted = [...periods].sort();
    // Yil boshidan o'qiymiz — o'tgan oy qiymati kerak
    const last = await this.lastReports(`${sorted[0]!.slice(0, 4)}-01`, nextPeriod(sorted[sorted.length - 1]!));
    const months = [...last.keys()].sort();
    for (const p of periods) {
      const r = last.get(p);
      if (!r) continue;
      const before = months.filter((x) => x < p && x.slice(0, 4) === p.slice(0, 4)).pop();
      const prev = before ? last.get(before)! : null;
      const values = new Map<string, bigint>();
      for (const [id, c] of r.cum) values.set(id, CenterIncomeService.incomeOf(c, prev ? (prev.cum.get(id) ?? { mtd: 0n }) : null));
      out.set(p, { date: r.date, reports: r.reports, values });
    }
    return out;
  }

  /** Berilgan kundan oldingi (yil ichidagi, boshqa oy) oxirgi ma'lumotnoma «Oy boshidan» qiymatlari */
  private async previousMonthCum(date: string): Promise<Map<string, { mtd: bigint | null }> | null> {
    const period = date.slice(0, 7);
    if (period.endsWith('-01')) return null;
    const last = await this.lastReports(`${period.slice(0, 4)}-01`, period);
    const months = [...last.keys()].sort();
    const before = months.pop();
    return before ? last.get(before)!.cum : null;
  }

  // ─────────── Daromadlarga yozish ───────────

  private async categoryFor(a: CashAccountView): Promise<string> {
    const code = `KASSA-${a.key}`.slice(0, 60);
    const name = `Kassa: ${a.name}`.slice(0, 150);
    await this.prisma.incomeCategory.upsert({ where: { code }, create: { code, label: name, order: 900 + Math.round(a.sortOrder / 10) }, update: { label: name } });
    return code;
  }

  /** Bir oy: oxirgi ma'lumotnomadan Markaz daromadi — Daromadlar jadvalidagi shu oy yozuvlari almashtiriladi */
  async syncPeriod(period: string, userId: string): Promise<{ period: string; created: number; totalTiyin: string }> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new BadRequestException("Oy noto'g'ri (YYYY-MM)");
    const accounts = await this.cashbook.accounts();
    const modes = await this.modes(accounts);
    const owners = await this.owners(accounts);
    const month = (await this.monthValues([period])).get(period);
    const center = await this.prisma.region.findUnique({ where: { code: CENTRAL }, select: { code: true } });
    const rows: { a: CashAccountView; amount: bigint; section: EntrySection; category: string; segment: SegmentCode | null }[] = [];
    if (month) {
      for (const a of accounts) {
        const m = modes.get(a.id);
        const amount = month.values.get(a.id) ?? 0n;
        if ((m !== 'DOIMIY' && m !== 'BOSHQA') || amount <= 0n) continue;
        const owner = owners.get(a.id) ?? 'CENTER';
        rows.push({ a, amount, section: m, category: await this.categoryFor(a), segment: owner === 'CENTER' ? null : owner });
      }
    }
    const date = month ? new Date(`${month.date}T00:00:00Z`) : null;
    const dmy = month ? month.date.split('-').reverse().join('.') : '';
    const tag = tagOf(period);
    await this.prisma.$transaction(async (tx) => {
      await tx.income.deleteMany({ where: { importBatchId: tag } });
      if (rows.length && date)
        await tx.income.createMany({
          data: rows.map((r) => ({
            date,
            period,
            amountTiyin: r.amount,
            paidTiyin: r.amount,
            categoryCode: r.category,
            // Yo'nalish daromadi — hudud/bo'limsiz, `segment` bilan (yo'nalish xarajatlari bilan bir birlikda)
            regionCode: r.segment ? null : center ? CENTRAL : null,
            segment: r.segment,
            description: `${r.a.code ? `${r.a.code}. ` : ''}${r.a.name} — kunlik ma'lumotnoma ${dmy} holatiga («Oy boshidan», o'tgan oyga nisbatan farq)`.slice(0, 500),
            paymentStatus: 'PAID' as const,
            paymentMethod: 'BANK' as const,
            source: 'IMPORT' as const,
            section: r.section,
            importBatchId: tag,
            createdById: userId,
          })),
        });
    });
    const total = rows.reduce((s, r) => s + r.amount, 0n);
    return { period, created: rows.length, totalTiyin: total.toString() };
  }

  /** Kun saqlangan/o'chirilgandan keyin: shu oy va keyingi oy (zanjir o'zgargan bo'lishi mumkin) */
  async afterDayChange(rawDate: string, userId: string): Promise<void> {
    const p = String(rawDate).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(p)) return;
    await this.syncPeriod(p, userId);
    const n = nextPeriod(p);
    const hasNext = await this.prisma.cashReport.findFirst({ where: { date: { gte: new Date(`${n}-01T00:00:00Z`), lt: new Date(`${nextPeriod(n)}-01T00:00:00Z`) } }, select: { id: true } });
    const hadNext = await this.prisma.income.findFirst({ where: { importBatchId: tagOf(n) }, select: { id: true } });
    if (hasNext || hadNext) await this.syncPeriod(n, userId);
  }

  /** Hamma oylar (ma'lumotnoma bor yoki avval yozilgan) — qator turi o'zgarganda */
  async syncAll(userId: string): Promise<{ periods: number }> {
    const [reports, synced] = await Promise.all([
      this.prisma.cashReport.findMany({ select: { date: true } }),
      this.prisma.income.findMany({ where: { importBatchId: { startsWith: 'kassa:' } }, select: { importBatchId: true } }),
    ]);
    const periods = new Set<string>(reports.map((r) => ymd(r.date).slice(0, 7)));
    for (const s of synced) if (s.importBatchId) periods.add(s.importBatchId.slice(6));
    for (const p of [...periods].sort()) await this.syncPeriod(p, userId);
    return { periods: periods.size };
  }

  // ─────────── Yil ko'rinishi ───────────

  async year(yearInput: unknown): Promise<CenterYear> {
    const year = Number(yearInput) || new Date().getUTCFullYear();
    if (year < 2000 || year > 2100) throw new BadRequestException("Yil noto'g'ri");
    const periods = Array.from({ length: 12 }, (_, i) => `${year}-${pad(i + 1)}`);
    const accounts = await this.cashbook.accounts();
    const modes = await this.modes(accounts);
    const owners = await this.owners(accounts);
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const values = await this.monthValues(periods);
    const [synced, incomes, latest] = await Promise.all([
      this.prisma.income.findMany({ where: { deletedAt: null, period: { in: periods }, importBatchId: { startsWith: 'kassa:' } }, select: { period: true, amountTiyin: true, segment: true } }),
      this.prisma.income.findMany({ where: { deletedAt: null, period: { in: periods } }, select: { period: true, amountTiyin: true, regionCode: true, departmentId: true, importBatchId: true } }),
      this.prisma.cashReport.findFirst({ orderBy: { date: 'desc' }, select: { date: true } }),
    ]);
    const sum = (list: { period: string; amountTiyin: bigint }[], p: string) => list.filter((x) => x.period === p).reduce((s, x) => s + x.amountTiyin, 0n);

    const months: CenterMonth[] = periods.map((p) => {
      const m = values.get(p);
      const by: Record<CenterMode, bigint> = { DOIMIY: 0n, BOSHQA: 0n, REGION: 0n, NONE: 0n };
      if (m) for (const [id, v] of m.values) { const mode = modes.get(id); if (mode) by[mode] += v; }
      const markaz = by.DOIMIY + by.BOSHQA;
      // Daromadlar jadvaliga faqat musbat qiymatlar yoziladi
      let expected = 0n;
      if (m) for (const [id, v] of m.values) { const mode = modes.get(id); if ((mode === 'DOIMIY' || mode === 'BOSHQA') && v > 0n) expected += v; }
      const syncedT = sum(synced, p);
      const other = incomes.filter((x) => x.period === p && x.regionCode === CENTRAL && !String(x.importBatchId ?? '').startsWith('kassa:')).reduce((s, x) => s + x.amountTiyin, 0n);
      const regionIncome = incomes.filter((x) => x.period === p && x.regionCode !== null && x.regionCode !== CENTRAL).reduce((s, x) => s + x.amountTiyin, 0n);
      return {
        period: p,
        label: label(p),
        reportDate: m?.date ?? null,
        reports: m?.reports ?? 0,
        doimiyTiyin: by.DOIMIY.toString(),
        boshqaTiyin: by.BOSHQA.toString(),
        markazTiyin: markaz.toString(),
        regionsTiyin: by.REGION.toString(),
        syncedTiyin: syncedT.toString(),
        inSync: syncedT === expected,
        otherCenterTiyin: other.toString(),
        regionIncomeTiyin: regionIncome.toString(),
        segmentsTiyin: synced.filter((x) => x.period === p && x.segment).reduce((s, x) => s + x.amountTiyin, 0n).toString(),
      };
    });

    // Qatorlar: tushum qatorlari — o'z qiymati; sarlavha/ota — ichidagi tushum qatorlari yig'indisi
    const kids = new Map<string, string[]>();
    for (const a of accounts) if (a.parentId) kids.set(a.parentId, [...(kids.get(a.parentId) ?? []), a.id]);
    const own = (id: string, p: string): bigint | null => {
      const a = byId.get(id)!;
      const m = values.get(p);
      if (!m) return null;
      if (counted(a)) return m.values.has(id) ? m.values.get(id)! : null;
      let s: bigint | null = null;
      const walk = (x: string) => {
        for (const k of kids.get(x) ?? []) {
          const ka = byId.get(k)!;
          if (counted(ka)) {
            const v = m.values.get(k);
            if (v !== undefined) s = (s ?? 0n) + v;
          }
          walk(k);
        }
      };
      walk(id);
      return s;
    };
    const rows: CenterRow[] = accounts
      .filter((a) => a.isActive && (counted(a) || a.isHeader || kids.has(a.id)))
      .map((a) => {
        const ms: Record<string, string | null> = {};
        let total = 0n;
        for (const p of periods) {
          const v = own(a.id, p);
          ms[p] = v === null ? null : v.toString();
          total += v ?? 0n;
        }
        return {
          id: a.id,
          key: a.key,
          code: a.code,
          name: a.name,
          level: a.level,
          isHeader: a.isHeader,
          mode: modes.get(a.id) ?? null,
          defaultMode: counted(a) ? this.defaultMode(a, byId) : null,
          owner: owners.get(a.id) ?? null,
          defaultOwner: counted(a) ? this.defaultOwner(a) : null,
          months: ms,
          totalTiyin: total.toString(),
        };
      })
      // Hech qachon tushum ko'rsatilmaydigan (faqat qoldiq) bo'limlar — ro'yxatda kerak emas
      .filter((r) => r.mode !== null || accounts.some((a) => counted(a) && this.isUnder(a, r.id, byId)));

    const tot = (k: keyof CenterMonth) => months.reduce((s, m) => s + BigInt(m[k] as string), 0n).toString();
    return {
      year,
      latestDate: latest ? ymd(latest.date) : null,
      months,
      rows,
      totals: { doimiyTiyin: tot('doimiyTiyin'), boshqaTiyin: tot('boshqaTiyin'), markazTiyin: tot('markazTiyin'), regionsTiyin: tot('regionsTiyin'), syncedTiyin: tot('syncedTiyin') },
    };
  }

  private isUnder(a: CashAccountView, ancestor: string, byId: Map<string, CashAccountView>): boolean {
    let p = a.parentId;
    for (let i = 0; i < 10 && p; i++) {
      if (p === ancestor) return true;
      p = byId.get(p)?.parentId ?? null;
    }
    return false;
  }

  // ─────────── Fayl ───────────

  /** Fayl o'qiladi (saqlanmaydi): sana, oy daromadi turlar bo'yicha, zanjir bilan farq */
  async preview(buffer: Buffer | undefined, dateInput?: string): Promise<CenterPreview & { input: CashLineInput[] }> {
    const parsed = await this.cashbook.parseImport(buffer);
    const date = (dateInput && /^\d{4}-\d{2}-\d{2}$/.test(dateInput) ? dateInput : null) ?? parsed.date;
    if (!date) throw new BadRequestException("Faylda sana topilmadi («… holatiga qoldiq» ustuni) — sanani tanlang");
    if (!parsed.matched) throw new BadRequestException("Fayldagi hisobraqamlar tanilmadi — «Kunlik tushum va qoldiq» shaklidagi fayl yuklang");
    const accounts = await this.cashbook.accounts();
    const modes = await this.modes(accounts);
    const period = date.slice(0, 7);
    const exists = Boolean(await this.prisma.cashReport.findUnique({ where: { date: new Date(`${date}T00:00:00Z`) }, select: { id: true } }));
    const later = await this.prisma.cashReport.findFirst({
      where: { date: { gt: new Date(`${date}T00:00:00Z`), lt: new Date(`${nextPeriod(period)}-01T00:00:00Z`) } },
      orderBy: { date: 'desc' },
      select: { date: true },
    });

    // Oldingi kundan zanjir bo'yicha kutilgan «Yil/Oy boshidan» — fayldagisi bilan solishtiriladi
    const prev = await this.cashbook.previousLines(date);
    let gapAccounts = 0;
    if (prev) {
      const samePeriod = prev.date.slice(0, 7) === period;
      const sameYear = prev.date.slice(0, 4) === date.slice(0, 4);
      for (const a of accounts) {
        const v = parsed.values[a.id];
        if (!v) continue;
        const p = prev.lines.get(a.id);
        const expectMtd = samePeriod ? (p?.mtd ?? 0n) + (p?.daily ?? 0n) : 0n;
        const expectYtd = sameYear ? (p?.ytd ?? 0n) + (p?.daily ?? 0n) : 0n;
        if ((a.inputs.includes('mtd') && v.mtd !== null && BigInt(v.mtd) !== expectMtd) || (a.inputs.includes('ytd') && v.ytd !== null && BigInt(v.ytd) !== expectYtd)) gapAccounts++;
      }
    }

    const by: Record<CenterMode, bigint> = { DOIMIY: 0n, BOSHQA: 0n, REGION: 0n, NONE: 0n };
    const lines: CenterPreview['lines'] = [];
    // Oy daromadi = «Oy boshidan» − o'tgan oy oxiridagi «Oy boshidan» (yil ichida)
    const prevCum = await this.previousMonthCum(date);
    for (const a of accounts) {
      const mode = modes.get(a.id);
      const v = parsed.values[a.id];
      if (!mode || !v) continue;
      const cur = { mtd: v.mtd !== null && v.mtd !== undefined ? BigInt(v.mtd) : null, ytd: v.ytd !== null && v.ytd !== undefined ? BigInt(v.ytd) : null };
      const amount = CenterIncomeService.incomeOf(cur, prevCum ? (prevCum.get(a.id) ?? { mtd: 0n }) : null);
      if (amount === 0n) continue;
      by[mode] += amount;
      lines.push({ id: a.id, code: a.code, name: a.name, mode, amountTiyin: amount.toString() });
    }
    const input: CashLineInput[] = Object.entries(parsed.values).map(([accountId, v]) => ({ accountId, ...v }));
    return {
      date,
      period,
      label: label(period),
      exists,
      matched: parsed.matched,
      unmatched: parsed.unmatched,
      gap: prev && gapAccounts ? { prevDate: prev.date, accounts: gapAccounts } : null,
      laterInMonth: later ? ymd(later.date) : null,
      doimiyTiyin: by.DOIMIY.toString(),
      boshqaTiyin: by.BOSHQA.toString(),
      markazTiyin: (by.DOIMIY + by.BOSHQA).toString(),
      regionsTiyin: by.REGION.toString(),
      lines,
      input,
    };
  }

  /** Faylni saqlash: shu kunning ma'lumotnomasi (Buxgalteriya › Kunlik tushum) + shu oy Markaz daromadi */
  async upload(buffer: Buffer | undefined, dateInput: string | undefined, userId: string) {
    const p = await this.preview(buffer, dateInput);
    // Oraliq kunlar kiritilmagan — fayldagi «Yil/Oy boshidan» tayanch bo'lib saqlanadi
    await this.cashbook.save(p.date, { lines: p.input, note: null }, userId, p.gap ? { anchor: true } : {});
    await this.afterDayChange(p.date, userId);
    await this.audit.log({
      userId,
      action: p.exists ? 'UPDATE' : 'CREATE',
      entity: 'center_income',
      entityId: p.date,
      summary: `Markaz daromadi fayli ${p.date.split('-').reverse().join('.')}: ${p.label} — Markaz ${(Number(BigInt(p.markazTiyin) / 100n)).toLocaleString('ru-RU')} so'm`,
    });
    const { input: _input, ...rest } = p;
    void _input;
    return { ...rest, year: await this.year(Number(p.date.slice(0, 4))) };
  }
}