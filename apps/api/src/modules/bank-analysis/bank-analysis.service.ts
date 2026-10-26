import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { assertSafeXlsx } from '../../common/files/xlsx-guard';
import { runExclusive } from '../../common/locks';
import { monthLabel, monthsBetween } from '../../common/period';
import { resolveEntryPlace } from '../../common/segments/place';
import { ENTRY_UNIT_CODES, entryUnitLabel, entryUnitOf, isSegment } from '../../common/segments/segments';
import { assertUnitCategory, readUnitCategories, unitList } from '../../common/segments/unit-categories';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { parseBankStatement, parseDate, text } from '../unit-bank/unit-bank.service';
import { buildPivot, parsePivotQuery, pivotWorkbook } from './bank-analysis.pivot';
import { accountKey, accountLabel, accountTail, BANK_KIND_LABEL, counterpartyKey, groupKey, kindOf, purposeKey, rowId, type BankDir, type BankKind } from './bank-analysis.rules';

// ═══════════════════════════════════════════════════════════
// Bank ko'chirmasi tahlili (Xarajatlar › Bank ko'chirmasi).
//
// Bankdan olingan ko'chirma (выписка, 23106 shabloni bilan bir xil shakl) o'qiladi — chiqim (debet) va kirim (kredit).
// O'zi XARAJAT VA DAROMADGA YOZMAYDI — tahlil:
//  • o'xshash to'lovlar bitta guruh (oluvchi + izoh mazmuni), oyma-oy va o'sib boruvchi summalar;
//  • tanlangan davr bo'yicha umumiy; har guruh — turi (soliq, kommunal, aloqa …), muntazamligi, o'zgarishi;
//  • guruh ichida — har to'lov izohi bilan.
// Foydalanuvchi o'zi tanlasa (yo'naltirish): to'lovga o'z izohini yozadi, joyini (Markaz bo'limi, hudud, yo'nalish)
// va moddasini tanlaydi → chiqim — XARAJAT, kirim — DAROMAD bo'lib yoziladi (har to'lov — bitta yozuv). Shu sana va
// summadagi yozuv avvaldan bo'lsa — ogohlantiriladi (ikki marta yozilmasin). Yo'naltirish bekor qilinsa — yozuv
// o'chiriladi; ko'chirma bekor qilinsa yoki oy almashtirilib to'lov yo'qolsa — uning yozuvi ham o'chiriladi.
// Bir nechta hisob raqami bo'lishi mumkin: har yuklash bir «hisob»ga tegishli; oy qayta yuklansa — shu hisobning
// o'sha oyi almashtiriladi. Hisob raqamining o'zi saqlanmaydi (faqat oxirgi 5 raqami — nomlash uchun).
// Saqlash joyi: settings («bank.analysis.store») — migratsiya kerak emas.
// ═══════════════════════════════════════════════════════════

export const BANK_ANALYSIS_KEY = 'bank.analysis.store';
const MAX_ROWS = 30000;
const MAX_ITEMS = 3000;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const cap = (v: unknown, n: number) => text(v).slice(0, n);
const dayDate = (day: string) => new Date(`${day.slice(0, 10)}T12:00:00+05:00`);

export interface BankAnRow {
  id: string;
  docDate: string;
  procDate: string | null;
  docNo: string;
  /** Oluvchi / to'lovchi nomi */
  accountName: string;
  /** ИНН (tashkilot — 9 xona, jismoniy shaxs — 14 xona) */
  inn: string;
  mfo: string;
  dir: BankDir;
  amountTiyin: string;
  /** Fayldagi «Назначение платежа» — aynan o'zidek */
  purpose: string;
}

export interface AccountMonth {
  batchId: string;
  fileName: string;
  savedAt: string;
  uploadedBy: string;
  rows: BankAnRow[];
}

export interface Account {
  key: string;
  label: string;
  months: Record<string, AccountMonth>;
}

export interface BankAnBatch {
  id: string;
  account: string;
  accountLabel: string;
  fileName: string;
  createdAt: string;
  uploadedBy: string;
  months: string[];
  rows: number;
  outTiyin: string;
  inTiyin: string;
  status: 'COMMITTED' | 'CANCELLED';
  cancelledAt: string | null;
}

/** Foydalanuvchi izohi (to'lovga) */
interface BankNote {
  comment: string;
  at: string;
  by: string;
}

export interface BankPlace {
  unit: string;
  departmentId: string | null;
  regionCode: number | null;
  districtId: string | null;
  label: string;
}

/** Yo'naltirish: bitta to'lov → bitta xarajat yoki daromad yozuvi */
export interface BankPost {
  id: string;
  /** Bir martada yo'naltirilganlar (birga bekor qilish uchun) */
  batch: string;
  account: string;
  rowId: string;
  period: string;
  docDate: string;
  dir: BankDir;
  amountTiyin: string;
  place: BankPlace;
  categoryCode: string;
  categoryLabel: string;
  section: 'DOIMIY' | 'BOSHQA';
  description: string;
  entryType: 'EXPENSE' | 'INCOME';
  entryId: string;
  createdAt: string;
  createdBy: string;
  status: 'POSTED' | 'CANCELLED';
  cancelledAt: string | null;
  cancelReason: string | null;
}

/** Guruhga foydalanuvchi bergan nom va tur (o'xshashlik kaliti bo'yicha — keyingi oylarda ham qo'llanadi) */
interface GroupMeta {
  name: string | null;
  kind: BankKind | null;
  /** Hisobot moddasi (o'zingiz bergan: «Moshina uchun xarajatlar» …) */
  category?: string | null;
  at: string;
  by: string;
}

/** Takrorlanishi: muntazam (≥60% oyda, kamida 3), bir martalik (bitta oyda), vaqti-vaqti bilan */
export type BankPattern = 'REGULAR' | 'ONCE' | 'IRREGULAR';

export interface Store {
  accounts: Record<string, Account>;
  batches: BankAnBatch[];
  /** `${hisob}:${qator}` → izoh */
  notes: Record<string, BankNote>;
  posts: BankPost[];
  /** guruh kaliti → nom / tur */
  groups: Record<string, GroupMeta>;
}

export function readStore(raw: unknown): Store {
  const v = (raw ?? {}) as Partial<Store>;
  return {
    accounts: v.accounts && typeof v.accounts === 'object' && !Array.isArray(v.accounts) ? (v.accounts as Record<string, Account>) : {},
    batches: Array.isArray(v.batches) ? (v.batches as BankAnBatch[]) : [],
    notes: v.notes && typeof v.notes === 'object' && !Array.isArray(v.notes) ? (v.notes as Record<string, BankNote>) : {},
    posts: Array.isArray(v.posts) ? (v.posts as BankPost[]) : [],
    groups: v.groups && typeof v.groups === 'object' && !Array.isArray(v.groups) ? (v.groups as Record<string, GroupMeta>) : {},
  };
}

export const big = (v: string) => {
  try {
    return BigInt(v);
  } catch {
    return 0n;
  }
};
export const rk = (account: string, id: string) => `${account}:${id}`;

export type Tx = Pick<PrismaService, 'expense' | 'income' | 'setting'>;

@Injectable()
export class BankAnalysisService {
  /** Saqlash kaliti (settings) — faktura tahlili o'z kaliti bilan */
  protected readonly key: string = BANK_ANALYSIS_KEY;
  /** Yozuv izohi va tarix uchun manba nomi */
  protected readonly sourceLabel: string = "Bank ko'chirmasi";
  /** Audit yozuvi turi */
  protected readonly entity: string = 'bank_analysis';

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly audit: AuditService,
  ) {}

  // ═══════════ Manbaga xos qoidalar (faktura tahlili o'zgartiradi) ═══════════

  /** To'lov qaysi oyga tegishli (bank — hujjat sanasi oyi) */
  protected periodOf(r: BankAnRow): string {
    return r.docDate.slice(0, 7);
  }

  /** O'xshashlik kaliti */
  protected keyOf(r: BankAnRow): string {
    return groupKey(r.dir, r.inn, r.accountName, r.purpose);
  }

  /** Avtomatik tur */
  protected kindFor(dir: BankDir, r: BankAnRow, counterparty: string): BankKind {
    return kindOf(dir, r.purpose, counterparty);
  }

  /** Yo'naltirilganda yozuv sanasi: hujjat sanasi (oyi boshqa bo'lsa — o'sha oyning oxirgi kuni) */
  protected entryDate(r: BankAnRow): Date {
    const p = this.periodOf(r);
    if (r.docDate.startsWith(p)) return dayDate(r.docDate);
    const [y, m] = p.split('-').map(Number) as [number, number];
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return dayDate(`${p}-${String(last).padStart(2, '0')}`);
  }

  protected async store(): Promise<Store> {
    return readStore((await this.prisma.setting.findUnique({ where: { key: this.key } }))?.value ?? null);
  }

  protected async save(store: Store, tx: Tx = this.prisma) {
    const value = store as unknown as object;
    await tx.setting.upsert({ where: { key: this.key }, create: { key: this.key, value }, update: { value } });
  }

  protected async userName(userId: string): Promise<string> {
    return (await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }).catch(() => null))?.fullName ?? '';
  }

  /** Fayldagi qatorlar → tahlil qatorlari (kaliti bilan) */
  protected toRows(list: { docDate: string; procDate: string | null; docNo: string; accountName: string; inn: string; mfo: string; debitTiyin: string; creditTiyin: string; purpose: string }[]): BankAnRow[] {
    const seen = new Map<string, number>();
    const out: BankAnRow[] = [];
    for (const r of list) {
      const debit = big(r.debitTiyin);
      const credit = big(r.creditTiyin);
      const dir: BankDir = debit > 0n ? 'OUT' : 'IN';
      const amount = (dir === 'OUT' ? debit : credit).toString();
      if (amount === '0') continue;
      const base = { docDate: r.docDate, procDate: r.procDate, docNo: cap(r.docNo, 60), accountName: cap(r.accountName, 300), inn: cap(r.inn, 20).replace(/\s+/g, ''), mfo: cap(r.mfo, 10), dir, amountTiyin: amount, purpose: cap(r.purpose, 1000) };
      const sig = `${base.docDate}|${base.docNo}|${base.inn}|${dir}|${amount}|${base.purpose}`;
      const n = seen.get(sig) ?? 0;
      seen.set(sig, n + 1);
      out.push({ id: rowId(base, n), ...base });
    }
    return out;
  }

  /** Ko'chirmada endi yo'q to'lovlarning yo'naltirishlari bekor (yozuvlari o'chiriladi) — tx ichida */
  protected async dropOrphans(store: Store, tx: Tx, reason: string): Promise<number> {
    const live = new Set<string>();
    for (const a of Object.values(store.accounts)) for (const m of Object.values(a.months)) for (const r of m.rows) live.add(rk(a.key, r.id));
    const orphans = store.posts.filter((p) => p.status === 'POSTED' && !live.has(rk(p.account, p.rowId)));
    if (!orphans.length) return 0;
    await this.softDelete(orphans, tx);
    const now = new Date().toISOString();
    for (const p of orphans) {
      p.status = 'CANCELLED';
      p.cancelledAt = now;
      p.cancelReason = reason;
    }
    return orphans.length;
  }

  protected async softDelete(posts: BankPost[], tx: Tx) {
    const exp = posts.filter((p) => p.entryType === 'EXPENSE').map((p) => p.entryId);
    const inc = posts.filter((p) => p.entryType === 'INCOME').map((p) => p.entryId);
    if (exp.length) await tx.expense.updateMany({ where: { id: { in: exp }, deletedAt: null }, data: { deletedAt: new Date() } });
    if (inc.length) await tx.income.updateMany({ where: { id: { in: inc }, deletedAt: null }, data: { deletedAt: new Date() } });
  }

  // ═══════════ Yuklash ═══════════

  /** Faylni o'qish — hech narsa saqlanmaydi */
  async analyze(file: Express.Multer.File | undefined) {
    if (!file?.buffer) throw new BadRequestException('Fayl yuklanmadi');
    await assertSafeXlsx(file.buffer);
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException("Faylni o'qib bo'lmadi — .xlsx formatida saqlang (bank dasturidan «Excel» qilib oling)");
    }
    const p = parseBankStatement(wb, { credits: true });
    const rows = this.toRows(p.rows);
    if (!rows.length) throw new BadRequestException('Faylda summali qator (debet yoki kredit) topilmadi');
    if (rows.length > MAX_ROWS) throw new BadRequestException(`Qatorlar juda ko'p — ${MAX_ROWS} tagacha`);
    const tail = accountTail(p.top ?? []);
    const suggested = tail ? `Hisob …${tail}` : 'Asosiy hisob';
    const store = await this.store();
    const periods = [...new Set(rows.map((r) => r.docDate.slice(0, 7)))].sort();
    const months = periods.map((period) => {
      const list = rows.filter((r) => r.docDate.startsWith(period));
      return {
        period,
        label: monthLabel(period),
        count: list.length,
        outTiyin: list.filter((r) => r.dir === 'OUT').reduce((s, r) => s + big(r.amountTiyin), 0n).toString(),
        inTiyin: list.filter((r) => r.dir === 'IN').reduce((s, r) => s + big(r.amountTiyin), 0n).toString(),
      };
    });
    return {
      fileName: String(file.originalname ?? 'kochirma.xlsx').slice(0, 200),
      sheetName: p.sheetName,
      account: { suggested, known: Object.values(store.accounts).map((a) => ({ key: a.key, label: a.label, months: Object.keys(a.months).sort() })) },
      months,
      rows,
      invalid: p.invalid.slice(0, 50),
      invalidCount: p.invalid.length,
      /** Hamma guruh — har birining qatorlari (rowIds) bilan: saqlashdan oldin ochib ko'rish uchun */
      groups: this.groups(rows.map((r) => ({ ...r, account: '' })), periods, new Map(), true, store.groups),
    };
  }

  async commit(body: { fileName?: unknown; account?: unknown; months?: unknown; rows?: unknown }, userId: string) {
    if (!Array.isArray(body?.months) || !body.months.length) throw new BadRequestException('Saqlash uchun kamida bitta oy tanlang');
    const months = [...new Set(body.months.map(String))].sort();
    if (months.some((p) => !PERIOD_RE.test(p))) throw new BadRequestException("Oy noto'g'ri");
    if (!Array.isArray(body.rows) || !body.rows.length) throw new BadRequestException("Ma'lumot yo'q");
    if (body.rows.length > MAX_ROWS) throw new BadRequestException(`Qatorlar juda ko'p — ${MAX_ROWS} tagacha`);
    const fileName = typeof body.fileName === 'string' && body.fileName.trim() ? body.fileName.trim().slice(0, 200) : 'kochirma.xlsx';
    const label = accountLabel(body.account, 'Asosiy hisob');
    const akey = accountKey(label);
    // Qatorlar serverda qayta tekshiriladi va kaliti qayta hisoblanadi
    const clean = (body.rows as Record<string, unknown>[]).map((raw) => {
      const docDate = parseDate(raw?.docDate);
      if (!docDate) throw new BadRequestException(`Sana noto'g'ri: ${cap(raw?.docDate, 20)}`);
      const dir = raw?.dir === 'IN' ? 'IN' : raw?.dir === 'OUT' ? 'OUT' : null;
      if (!dir) throw new BadRequestException(`Yo'nalish noto'g'ri: ${cap(raw?.docNo, 30)}`);
      const amount = big(text(raw.amountTiyin));
      if (amount <= 0n) throw new BadRequestException(`Summa noto'g'ri: ${cap(raw?.docNo, 30)}`);
      return { docDate, procDate: parseDate(raw.procDate), docNo: cap(raw.docNo, 60), accountName: cap(raw.accountName, 300), inn: cap(raw.inn, 20), mfo: cap(raw.mfo, 10), debitTiyin: dir === 'OUT' ? amount.toString() : '0', creditTiyin: dir === 'IN' ? amount.toString() : '0', purpose: cap(raw.purpose, 1000) };
    });
    const rows = this.toRows(clean).filter((r) => months.includes(r.docDate.slice(0, 7)));
    if (!rows.length) throw new BadRequestException("Tanlangan oylarda qator yo'q");
    const user = await this.userName(userId);
    const batchId = randomUUID();
    const now = new Date().toISOString();
    const result = await runExclusive(`setting:${this.key}`, async () => {
      const store = await this.store();
      const acc = (store.accounts[akey] ??= { key: akey, label, months: {} });
      acc.label = label;
      const replaced: string[] = [];
      for (const p of months) {
        if (acc.months[p]) replaced.push(p);
        acc.months[p] = { batchId, fileName, savedAt: now, uploadedBy: user, rows: rows.filter((r) => r.docDate.startsWith(p)) };
      }
      const outT = rows.filter((r) => r.dir === 'OUT').reduce((s, r) => s + big(r.amountTiyin), 0n);
      const inT = rows.filter((r) => r.dir === 'IN').reduce((s, r) => s + big(r.amountTiyin), 0n);
      store.batches.push({ id: batchId, account: akey, accountLabel: label, fileName, createdAt: now, uploadedBy: user, months, rows: rows.length, outTiyin: outT.toString(), inTiyin: inT.toString(), status: 'COMMITTED', cancelledAt: null });
      if (store.batches.length > 300) store.batches = store.batches.slice(-300);
      // Almashtirilgan oyda endi yo'q to'lovlarning yo'naltirishi bekor (bor bo'lsa — kaliti o'sha, saqlanib qoladi)
      const dropped = await this.prisma.$transaction(async (tx) => {
        const n = replaced.length ? await this.dropOrphans(store, tx, "ko'chirma almashtirildi — to'lov yangi ko'chirmada yo'q") : 0;
        await this.save(store, tx);
        return n;
      });
      return { replaced, outT, inT, dropped };
    });
    await this.audit.log({
      userId,
      action: 'IMPORT',
      entity: 'bank_analysis',
      entityId: batchId,
      summary: `Bank ko'chirmasi tahlili (${label}): ${months.map(monthLabel).join(', ')} — ${rows.length} ta qator${result.replaced.length ? `, ${result.replaced.length} oy almashtirildi` : ''}${result.dropped ? `, ${result.dropped} ta yo'naltirish bekor qilindi` : ''}`,
    });
    return { success: true as const, batchId, account: akey, months, saved: rows.length, replacedMonths: result.replaced, outTiyin: result.outT.toString(), inTiyin: result.inT.toString(), droppedPosts: result.dropped };
  }

  async batches() {
    const store = await this.store();
    return [...store.batches].reverse().map((b) => {
      const acc = store.accounts[b.account];
      const live = b.months.filter((p) => acc?.months[p]?.batchId === b.id);
      return { ...b, liveMonths: live, state: b.status === 'CANCELLED' ? 'CANCELLED' : live.length === b.months.length ? 'ACTIVE' : live.length ? 'PARTIAL' : 'REPLACED' };
    });
  }

  async cancel(id: string, userId: string) {
    const out = await runExclusive(`setting:${this.key}`, async () => {
      const store = await this.store();
      const b = store.batches.find((x) => x.id === id);
      if (!b) throw new NotFoundException('Yuklash topilmadi');
      if (b.status === 'CANCELLED') throw new BadRequestException('Bu yuklash allaqachon bekor qilingan');
      const acc = store.accounts[b.account];
      const removed: string[] = [];
      for (const p of b.months) {
        if (acc?.months[p]?.batchId === id) {
          delete acc.months[p];
          removed.push(p);
        }
      }
      if (acc && !Object.keys(acc.months).length) delete store.accounts[b.account];
      b.status = 'CANCELLED';
      b.cancelledAt = new Date().toISOString();
      const dropped = await this.prisma.$transaction(async (tx) => {
        const n = await this.dropOrphans(store, tx, "ko'chirma bekor qilindi");
        await this.save(store, tx);
        return n;
      });
      return { removed, b, dropped };
    });
    await this.audit.log({ userId, action: 'DELETE', entity: 'bank_analysis', entityId: id, summary: `Bank ko'chirmasi tahlili bekor qilindi: ${out.b.fileName} (${out.b.accountLabel}; ${out.removed.map(monthLabel).join(', ') || 'oylar keyin almashtirilgan'})${out.dropped ? `; ${out.dropped} ta yo'naltirilgan yozuv o'chirildi` : ''}` });
    return { success: true as const, months: out.removed, droppedPosts: out.dropped };
  }

  // ═══════════ Tahlil ═══════════

  protected rowsIn(store: Store, months: string[], account?: string | null): (BankAnRow & { account: string })[] {
    const accs = Object.values(store.accounts).filter((a) => !account || a.key === account);
    const want = new Set(months);
    return accs.flatMap((a) => Object.values(a.months).flatMap((m) => m.rows.filter((r) => want.has(this.periodOf(r))).map((r) => ({ ...r, account: a.key }))));
  }

  protected postedMap(store: Store): Map<string, BankPost> {
    return new Map(store.posts.filter((p) => p.status === 'POSTED').map((p) => [rk(p.account, p.rowId), p]));
  }

  /** O'xshashlar guruhi: oyma-oy, o'sib boruvchi, turi, muntazamligi, yo'naltirilgani */
  protected groups(rows: (BankAnRow & { account: string })[], months: string[], posted: Map<string, BankPost>, withRows = false, meta: Record<string, GroupMeta> = {}) {
    const map = new Map<string, { key: string; dir: BankDir; rows: (BankAnRow & { account: string })[] }>();
    for (const r of rows) {
      const k = this.keyOf(r);
      const g = map.get(k) ?? { key: k, dir: r.dir, rows: [] };
      g.rows.push(r);
      map.set(k, g);
    }
    const totalBy: Record<BankDir, bigint> = { OUT: 0n, IN: 0n };
    for (const r of rows) totalBy[r.dir] += big(r.amountTiyin);
    const list = [...map.values()].map((g) => {
      const byMonth: Record<string, bigint> = Object.fromEntries(months.map((p) => [p, 0n]));
      const countBy: Record<string, number> = Object.fromEntries(months.map((p) => [p, 0]));
      let postedCount = 0;
      let postedTiyin = 0n;
      for (const r of g.rows) {
        const p = this.periodOf(r);
        if (p in byMonth) {
          byMonth[p]! += big(r.amountTiyin);
          countBy[p]! += 1;
        }
        if (posted.has(rk(r.account, r.id))) {
          postedCount += 1;
          postedTiyin += big(r.amountTiyin);
        }
      }
      let run = 0n;
      const cumulative = months.map((p) => (run += byMonth[p]!).toString());
      const total = run;
      const active = months.filter((p) => byMonth[p]! > 0n);
      const sorted = [...g.rows].sort((a, b) => b.docDate.localeCompare(a.docDate));
      const last = sorted[0]!;
      // Eng ko'p uchragan nom (bir tashkilot nomi turlicha yozilgan bo'lishi mumkin)
      const names = new Map<string, number>();
      for (const r of g.rows) names.set(r.accountName, (names.get(r.accountName) ?? 0) + 1);
      const name = [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
      const cp = counterpartyKey(last.inn, last.accountName);
      const people = cp === 'person' ? new Set(g.rows.map((r) => r.inn)).size : 0;
      const m = meta[g.key];
      const autoKind: BankKind = this.kindFor(g.dir, last, name);
      const kind: BankKind = m?.kind && m.kind in BANK_KIND_LABEL ? m.kind : autoKind;
      const regular = active.length >= Math.max(3, Math.ceil(months.length * 0.6));
      // Bir martalik: bitta to'lov yoki faqat bitta oyda (davr bir oydan ko'p bo'lsa)
      const pattern: BankPattern = regular ? 'REGULAR' : g.rows.length === 1 || (months.length > 1 && active.length === 1) ? 'ONCE' : 'IRREGULAR';
      // O'zgarish: oxirgi faol oy va undan oldingi faol oy
      const lastP = active[active.length - 1];
      const prevP = active[active.length - 2];
      const change = lastP && prevP && byMonth[prevP]! > 0n ? Number(((byMonth[lastP]! - byMonth[prevP]!) * 10000n) / byMonth[prevP]!) / 100 : null;
      const samples = [...new Set(sorted.map((r) => r.purpose))].slice(0, 3);
      return {
        key: g.key,
        dir: g.dir,
        kind,
        kindLabel: BANK_KIND_LABEL[kind],
        counterparty: cp === 'person' ? `Jismoniy shaxslar (${people} kishi)` : name,
        /** Siz bergan nom (bo'lmasa — null) */
        name: m?.name ?? null,
        /** Hisobot moddasi (siz bergan) */
        category: m?.category ?? null,
        autoKind,
        kindEdited: Boolean(m?.kind && m.kind !== autoKind),
        pattern,
        inn: cp.startsWith('inn:') ? cp.slice(4) : null,
        label: purposeKey(last.purpose) || '—',
        samples,
        count: g.rows.length,
        totalTiyin: total.toString(),
        sharePct: totalBy[g.dir] > 0n ? Number((total * 10000n) / totalBy[g.dir]) / 100 : 0,
        avgTiyin: active.length ? (total / BigInt(active.length)).toString() : '0',
        byMonth: Object.fromEntries(Object.entries(byMonth).map(([p, v]) => [p, v.toString()])),
        countByMonth: countBy,
        cumulative,
        activeMonths: active.length,
        /** Muntazam: tanlangan oylarning kamida 60 foizida (va kamida 3 oyda) */
        regular,
        firstDate: sorted[sorted.length - 1]!.docDate,
        lastDate: last.docDate,
        changePct: change,
        /** Xarajat / daromadga yo'naltirilgani */
        postedCount,
        postedTiyin: postedTiyin.toString(),
        ...(withRows ? { rowIds: sorted.map((r) => r.id) } : {}),
      };
    });
    return list.sort((a, b) => (big(b.totalTiyin) > big(a.totalTiyin) ? 1 : big(b.totalTiyin) < big(a.totalTiyin) ? -1 : a.counterparty.localeCompare(b.counterparty)));
  }

  /** Tanlangan davr: oyma-oy jami (chiqim, kirim), o'sib boruvchi, turlar, guruhlar */
  async view(from: string, to: string, account?: string | null) {
    const months = this.range(from, to);
    const store = await this.store();
    const acc = account && store.accounts[account] ? account : null;
    const rows = this.rowsIn(store, months, acc);
    const posted = this.postedMap(store);
    const groups = this.groups(rows, months, posted, false, store.groups);
    const series = months.map((p) => {
      const list = rows.filter((r) => this.periodOf(r) === p);
      return {
        period: p,
        label: monthLabel(p),
        outTiyin: list.filter((r) => r.dir === 'OUT').reduce((s, r) => s + big(r.amountTiyin), 0n),
        inTiyin: list.filter((r) => r.dir === 'IN').reduce((s, r) => s + big(r.amountTiyin), 0n),
        count: list.length,
        uploaded: Object.values(store.accounts)
          .filter((a) => (!acc || a.key === acc) && a.months[p])
          .map((a) => ({ account: a.key, label: a.label, fileName: a.months[p]!.fileName, savedAt: a.months[p]!.savedAt })),
      };
    });
    let co = 0n;
    let ci = 0n;
    const byKind = new Map<string, { dir: BankDir; kind: BankKind; label: string; count: number; total: bigint; groups: number; byMonth: Record<string, bigint> }>();
    for (const g of groups) {
      const k = `${g.dir}|${g.kind}`;
      const x = byKind.get(k) ?? { dir: g.dir, kind: g.kind, label: g.kindLabel, count: 0, total: 0n, groups: 0, byMonth: Object.fromEntries(months.map((p) => [p, 0n])) };
      x.count += g.count;
      x.total += big(g.totalTiyin);
      x.groups += 1;
      for (const p of months) x.byMonth[p]! += big(g.byMonth[p] ?? '0');
      byKind.set(k, x);
    }
    const outTotal = series.reduce((s, m) => s + m.outTiyin, 0n);
    const inTotal = series.reduce((s, m) => s + m.inTiyin, 0n);
    const postedIn = rows.filter((r) => posted.has(rk(r.account, r.id)));
    return {
      from: months[0]!,
      to: months[months.length - 1]!,
      months,
      accounts: Object.values(store.accounts).map((a) => ({ key: a.key, label: a.label, months: Object.keys(a.months).sort() })),
      account: acc,
      series: series.map((m) => {
        co += m.outTiyin;
        ci += m.inTiyin;
        return { period: m.period, label: m.label, count: m.count, uploaded: m.uploaded, outTiyin: m.outTiyin.toString(), inTiyin: m.inTiyin.toString(), outCumTiyin: co.toString(), inCumTiyin: ci.toString(), netTiyin: (m.inTiyin - m.outTiyin).toString() };
      }),
      totals: {
        rows: rows.length,
        outTiyin: outTotal.toString(),
        inTiyin: inTotal.toString(),
        netTiyin: (inTotal - outTotal).toString(),
        groups: groups.length,
        regularOut: groups.filter((g) => g.dir === 'OUT' && g.regular).length,
        /** Takrorlanishi bo'yicha (chiqim / kirim): soni va summasi */
        patterns: (['OUT', 'IN'] as const).flatMap((d) =>
          (['REGULAR', 'IRREGULAR', 'ONCE'] as const).map((p) => {
            const l = groups.filter((g) => g.dir === d && g.pattern === p);
            return { dir: d, pattern: p, groups: l.length, count: l.reduce((s, g) => s + g.count, 0), totalTiyin: l.reduce((s, g) => s + big(g.totalTiyin), 0n).toString() };
          }),
        ),
        monthsWithData: series.filter((m) => m.count > 0).length,
        posted: {
          count: postedIn.length,
          outTiyin: postedIn.filter((r) => r.dir === 'OUT').reduce((s, r) => s + big(r.amountTiyin), 0n).toString(),
          inTiyin: postedIn.filter((r) => r.dir === 'IN').reduce((s, r) => s + big(r.amountTiyin), 0n).toString(),
        },
      },
      kinds: [...byKind.values()]
        .sort((a, b) => (a.dir === b.dir ? (b.total > a.total ? 1 : -1) : a.dir === 'OUT' ? -1 : 1))
        .map((k) => ({ dir: k.dir, kind: k.kind, label: k.label, count: k.count, groups: k.groups, totalTiyin: k.total.toString(), sharePct: (k.dir === 'OUT' ? outTotal : inTotal) > 0n ? Number((k.total * 10000n) / (k.dir === 'OUT' ? outTotal : inTotal)) / 100 : 0, byMonth: Object.fromEntries(Object.entries(k.byMonth).map(([p, v]) => [p, v.toString()])) })),
      groups,
    };
  }

  protected range(from: string, to: string): string[] {
    if (!PERIOD_RE.test(from ?? '') || !PERIOD_RE.test(to ?? '')) throw new BadRequestException("Oy noto'g'ri (YYYY-MM)");
    const months = monthsBetween(from, to);
    if (!months.length) throw new BadRequestException("«Dan» oyi «Gacha»dan keyin bo'lmasin");
    if (months.length > 36) throw new BadRequestException("Ko'pi bilan 36 oy");
    return months;
  }

  /** Hisobot (pivot): darajalar (modda › kontragent › xizmat …), ustunlarda oylar; filtrlar bilan */
  async pivot(from: string, to: string, account: string | null, raw: Record<string, unknown>) {
    const months = this.range(from, to);
    const store = await this.store();
    const acc = account && store.accounts[account] ? account : null;
    const groups = this.groups(this.rowsIn(store, months, acc), months, this.postedMap(store), false, store.groups);
    return { from: months[0]!, to: months[months.length - 1]!, ...buildPivot(groups, months, parsePivotQuery(raw)) };
  }

  /** Hisobot — Excel */
  async pivotExcel(from: string, to: string, account: string | null, raw: Record<string, unknown>) {
    const p = await this.pivot(from, to, account, raw);
    const span = p.months.length > 1 ? `${monthLabel(p.from)} – ${monthLabel(p.to)}` : monthLabel(p.from);
    const what = p.dir === 'OUT' ? 'chiqimlar' : 'kirimlar';
    const buffer = await pivotWorkbook(p, `${this.sourceLabel}: ${what} hisoboti · ${span} (so'm)`);
    return { buffer, filename: `${this.entity === 'bank_analysis' ? 'bank' : 'faktura'}-hisobot-${p.dir === 'OUT' ? 'chiqim' : 'kirim'}-${p.from}_${p.to}.xlsx` };
  }

  /** Bitta guruh: har to'lov — sana, hujjat, oluvchi, summa, izohi (aynan o'zidek), sizning izohingiz, yo'naltirilgani */
  async group(key: string, from: string, to: string, account?: string | null) {
    if (typeof key !== 'string' || !key || key.length > 400) throw new BadRequestException("Guruh noto'g'ri");
    const months = this.range(from, to);
    const store = await this.store();
    const acc = account && store.accounts[account] ? account : null;
    const posted = this.postedMap(store);
    const rows = this.rowsIn(store, months, acc)
      .filter((r) => this.keyOf(r) === key)
      .sort((a, b) => a.docDate.localeCompare(b.docDate) || a.docNo.localeCompare(b.docNo))
      .map((r) => {
        const p = posted.get(rk(r.account, r.id));
        const note = store.notes[rk(r.account, r.id)];
        return {
          ...r,
          period: this.periodOf(r),
          accountLabel: store.accounts[r.account]?.label ?? r.account,
          note: note ? note.comment : null,
          noteBy: note ? `${note.by} · ${note.at}` : null,
          post: p ? { id: p.id, batch: p.batch, place: p.place.label, categoryLabel: p.categoryLabel, section: p.section, description: p.description, entryType: p.entryType, createdAt: p.createdAt, createdBy: p.createdBy } : null,
        };
      });
    return { key, rows, totalTiyin: rows.reduce((s, r) => s + big(r.amountTiyin), 0n).toString() };
  }

  // ═══════════ Izoh ═══════════

  protected findRow(store: Store, account: string, id: string): BankAnRow | null {
    const a = store.accounts[account];
    if (!a) return null;
    for (const m of Object.values(a.months)) {
      const r = m.rows.find((x) => x.id === id);
      if (r) return r;
    }
    return null;
  }

  protected items(raw: unknown): { account: string; rowId: string }[] {
    if (!Array.isArray(raw) || !raw.length) throw new BadRequestException("Kamida bitta to'lovni belgilang");
    if (raw.length > MAX_ITEMS) throw new BadRequestException(`Juda ko'p — ${MAX_ITEMS} tagacha`);
    const seen = new Set<string>();
    const out: { account: string; rowId: string }[] = [];
    for (const x of raw as Record<string, unknown>[]) {
      const account = typeof x?.account === 'string' ? x.account.slice(0, 60) : '';
      const id = typeof x?.rowId === 'string' ? x.rowId.slice(0, 40) : '';
      if (!account || !id) throw new BadRequestException("To'lov kaliti noto'g'ri");
      if (seen.has(rk(account, id))) continue;
      seen.add(rk(account, id));
      out.push({ account, rowId: id });
    }
    return out;
  }

  /**
   * To'lovga o'z izohingiz: items: [{ account, rowId, comment }] (bo'sh — o'chiriladi).
   * Yo'naltirilgan bo'lsa — xarajat / daromad yozuvi izohi ham yangilanadi.
   */
  async notes(body: { items?: unknown }, userId: string) {
    const list = this.items(body?.items);
    const comments = new Map((body.items as Record<string, unknown>[]).map((x) => [rk(String(x?.account ?? ''), String(x?.rowId ?? '')), typeof x?.comment === 'string' ? x.comment.replace(/\s+/g, ' ').trim().slice(0, 500) : '']));
    const by = await this.userName(userId);
    const out = await runExclusive(`setting:${this.key}`, async () => {
      const store = await this.store();
      const posted = this.postedMap(store);
      const now = new Date().toISOString();
      let saved = 0;
      let cleared = 0;
      const updates: { post: BankPost; text: string }[] = [];
      for (const it of list) {
        const row = this.findRow(store, it.account, it.rowId);
        if (!row) throw new NotFoundException("To'lov topilmadi — ko'chirma o'zgargan bo'lishi mumkin, sahifani yangilang");
        const k = rk(it.account, it.rowId);
        const c = comments.get(k) ?? '';
        if (c) {
          store.notes[k] = { comment: c, at: now, by };
          saved += 1;
        } else if (store.notes[k]) {
          delete store.notes[k];
          cleared += 1;
        }
        const p = posted.get(k);
        if (p) updates.push({ post: p, text: (c || p.description || row.purpose).slice(0, 500) });
      }
      await this.prisma.$transaction(async (tx) => {
        for (const u of updates) {
          if (u.post.entryType === 'EXPENSE') await tx.expense.updateMany({ where: { id: u.post.entryId, deletedAt: null }, data: { description: u.text } });
          else await tx.income.updateMany({ where: { id: u.post.entryId, deletedAt: null }, data: { description: u.text } });
          u.post.description = u.text;
        }
        await this.save(store, tx);
      });
      return { saved, cleared, entries: updates.length };
    });
    return { success: true as const, ...out };
  }

  // ═══════════ Guruh nomi va turi ═══════════

  /**
   * Guruhga o'z nomingiz va turi: { key, name, kind } (bo'sh nom — avtomatik nomga qaytadi; kind null — avtomatik tur).
   * O'xshashlik kaliti bo'yicha saqlanadi — keyingi oylarda yuklangan shu to'lovlarga ham qo'llanadi.
   * Yo'naltirishda izoh: to'lovga yozilgan izoh → umumiy izoh → shu nom → bankdagi izoh.
   */
  async groupMeta(body: { key?: unknown; name?: unknown; kind?: unknown; category?: unknown }, userId: string) {
    const key = typeof body?.key === 'string' ? body.key : '';
    if (!key || key.length > 400) throw new BadRequestException("Guruh noto'g'ri");
    const name = typeof body?.name === 'string' ? body.name.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
    const kind = typeof body?.kind === 'string' && body.kind in BANK_KIND_LABEL ? (body.kind as BankKind) : null;
    if (body?.kind !== undefined && body.kind !== null && body.kind !== '' && !kind) throw new BadRequestException("Tur noto'g'ri");
    const category = typeof body?.category === 'string' ? body.category.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
    const by = await this.userName(userId);
    await runExclusive(`setting:${this.key}`, async () => {
      const store = await this.store();
      // category berilmasa (eski so'rov) — avvalgisi saqlanadi
      const cat = body?.category === undefined ? (store.groups[key]?.category ?? '') : category;
      if (!name && !kind && !cat) delete store.groups[key];
      else store.groups[key] = { name: name || null, kind, category: cat || null, at: new Date().toISOString(), by };
      await this.save(store);
    });
    return { success: true as const, key, name: name || null, kind, category: category || null };
  }

  /** Bir nechta guruhga bitta hisobot moddasi (bo'sh — olib tashlanadi): { keys, category } */
  async groupCategory(body: { keys?: unknown; category?: unknown }, userId: string) {
    const keys = Array.isArray(body?.keys) ? [...new Set(body.keys.filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= 400))].slice(0, 2000) : [];
    if (!keys.length) throw new BadRequestException('Guruhlarni tanlang');
    const category = typeof body?.category === 'string' ? body.category.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
    const by = await this.userName(userId);
    await runExclusive(`setting:${this.key}`, async () => {
      const store = await this.store();
      const at = new Date().toISOString();
      for (const k of keys) {
        const g = store.groups[k] ?? { name: null, kind: null, at, by };
        g.category = category || null;
        g.at = at;
        g.by = by;
        if (!g.name && !g.kind && !g.category) delete store.groups[k];
        else store.groups[k] = g;
      }
      await this.save(store);
    });
    return { success: true as const, count: keys.length, category: category || null };
  }

  /** Hisobot moddalari ro'yxati (avval berilganlar) */
  async categories(): Promise<string[]> {
    const store = await this.store();
    return [...new Set(Object.values(store.groups).map((g) => g.category).filter((c): c is string => Boolean(c)))].sort((a, b) => a.localeCompare(b));
  }

  /** Turlar ro'yxati (guruh turini o'zgartirish uchun) */
  kinds() {
    return Object.entries(BANK_KIND_LABEL).map(([code, label]) => ({ code, label }));
  }

  // ═══════════ Yo'naltirish (xarajat / daromad) ═══════════

  /** Yo'naltirish uchun moddalar: chiqim — xarajat moddalari, kirim — daromad turlari (bo'lim ro'yxati bo'lsa — faqat undagilar) */
  async options(dirRaw: string, unitRaw?: string) {
    const dir: BankDir = dirRaw === 'IN' ? 'IN' : 'OUT';
    const unit = unitRaw && ENTRY_UNIT_CODES.includes(unitRaw) ? unitRaw : null;
    const lists = await readUnitCategories(this.prisma);
    const allowed = unit ? unitList(lists, dir === 'OUT' ? 'expense' : 'income', unit) : [];
    if (dir === 'OUT') {
      const cats = await this.prisma.category.findMany({ where: { isActive: true }, select: { code: true, label: true, parentCode: true, isLeaf: true }, orderBy: [{ order: 'asc' }, { label: 'asc' }] });
      const parent = new Map(cats.map((c) => [c.code, c.label]));
      return { dir, unit, limited: allowed.length > 0, categories: cats.filter((c) => c.isLeaf && (!allowed.length || allowed.includes(c.code))).map((c) => ({ code: c.code, label: c.label, group: c.parentCode ? (parent.get(c.parentCode) ?? null) : null })) };
    }
    const cats = await this.prisma.incomeCategory.findMany({ where: { isActive: true }, select: { code: true, label: true }, orderBy: [{ order: 'asc' }, { label: 'asc' }] });
    return { dir, unit, limited: allowed.length > 0, categories: cats.filter((c) => !allowed.length || allowed.includes(c.code)).map((c) => ({ code: c.code, label: c.label, group: null })) };
  }

  /** Joy: { unit, departmentId?, regionCode?, districtId? } → yozuv joyi va nomi */
  protected async place(raw: unknown): Promise<BankPlace> {
    const p = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const unit = typeof p.unit === 'string' && ENTRY_UNIT_CODES.includes(p.unit) ? p.unit : null;
    if (!unit) throw new BadRequestException("Qayerga — bo'limni tanlang (Markaz, hudud yoki yo'nalish)");
    const dep = typeof p.departmentId === 'string' && p.departmentId.trim() ? p.departmentId.trim() : null;
    const reg = typeof p.regionCode === 'number' ? p.regionCode : typeof p.regionCode === 'string' && /^\d{1,3}$/.test(p.regionCode) ? Number(p.regionCode) : null;
    const dis = typeof p.districtId === 'string' && p.districtId.trim() ? p.districtId.trim() : null;
    let input: { regionCode: number | null; districtId: string | null; departmentId: string | null; segment: string | null };
    if (unit === 'CENTER') {
      if (dep) {
        const d = await this.prisma.department.findUnique({ where: { id: dep }, select: { isActive: true } });
        if (!d || !d.isActive) throw new BadRequestException("Markaz bo'limi topilmadi");
      }
      input = { regionCode: 0, districtId: null, departmentId: dep, segment: null };
    } else if (unit === 'REGION') {
      if (reg === null || reg <= 0) throw new BadRequestException('Viloyatni tanlang');
      input = { regionCode: reg, districtId: dis, departmentId: null, segment: null };
    } else if (isSegment(unit)) input = { regionCode: null, districtId: null, departmentId: null, segment: unit };
    else throw new BadRequestException("Bo'lim noto'g'ri");
    const r = await resolveEntryPlace(this.prisma, input, 'yozuv');
    const [d, rg, ds] = await Promise.all([
      r.departmentId ? this.prisma.department.findUnique({ where: { id: r.departmentId }, select: { name: true } }) : null,
      r.regionCode ? this.prisma.region.findUnique({ where: { code: r.regionCode }, select: { name: true } }) : null,
      r.districtId ? this.prisma.district.findUnique({ where: { id: r.districtId }, select: { name: true } }) : null,
    ]);
    const label = unit === 'CENTER' ? `Markaz${d ? ` › ${d.name}` : ''}` : unit === 'REGION' ? `${rg?.name ?? `${r.regionCode}-hudud`}${ds ? ` › ${ds.name}` : ''}` : entryUnitLabel(unit);
    return { unit, departmentId: r.departmentId, regionCode: r.regionCode, districtId: r.districtId, label };
  }

  /** Shu sana va summadagi (o'chirilmagan) yozuvlar — ikki marta yozilmasin */
  protected async duplicates(rows: { key: string; row: BankAnRow }[], own: Set<string>) {
    const out = new Map<string, { id: string; date: string; description: string | null; categoryLabel: string; source: string }[]>();
    for (const { key, row } of rows) {
      const d = this.entryDate(row);
      const from = new Date(d.getTime() - 12 * 3600_000);
      const to = new Date(d.getTime() + 12 * 3600_000);
      const where = { deletedAt: null, amountTiyin: big(row.amountTiyin), date: { gte: from, lt: to } };
      const hits =
        row.dir === 'OUT'
          ? (await this.prisma.expense.findMany({ where, select: { id: true, date: true, description: true, source: true, category: { select: { label: true } } }, take: 5 })).map((e) => ({ id: e.id, date: e.date.toISOString().slice(0, 10), description: e.description, categoryLabel: e.category?.label ?? '', source: String(e.source) }))
          : (await this.prisma.income.findMany({ where, select: { id: true, date: true, description: true, source: true, category: { select: { label: true } } }, take: 5 })).map((e) => ({ id: e.id, date: e.date.toISOString().slice(0, 10), description: e.description, categoryLabel: e.category?.label ?? '', source: String(e.source) }));
      const real = hits.filter((h) => !own.has(h.id));
      if (real.length) out.set(key, real);
    }
    return out;
  }

  /** Yo'naltirishdan oldin: tanlanganlar — allaqachon yo'naltirilganmi, shu sana va summada boshqa yozuv bormi */
  async check(body: { items?: unknown }) {
    const list = this.items(body?.items);
    const store = await this.store();
    const posted = this.postedMap(store);
    const rows: { key: string; row: BankAnRow }[] = [];
    const already: string[] = [];
    for (const it of list) {
      const row = this.findRow(store, it.account, it.rowId);
      if (!row) throw new NotFoundException("To'lov topilmadi — sahifani yangilang");
      const k = rk(it.account, it.rowId);
      if (posted.has(k)) already.push(k);
      else rows.push({ key: k, row });
    }
    const own = new Set(store.posts.filter((p) => p.status === 'POSTED').map((p) => p.entryId));
    const dups = await this.duplicates(rows, own);
    return {
      count: rows.length,
      totalTiyin: rows.reduce((s, r) => s + big(r.row.amountTiyin), 0n).toString(),
      dirs: [...new Set(rows.map((r) => r.row.dir))],
      already,
      duplicates: [...dups.entries()].map(([key, matches]) => {
        const [account, rowId] = [key.slice(0, key.lastIndexOf(':')), key.slice(key.lastIndexOf(':') + 1)];
        const r = rows.find((x) => x.key === key)!.row;
        return { account, rowId, docDate: r.docDate, amountTiyin: r.amountTiyin, purpose: r.purpose, matches };
      }),
    };
  }

  /**
   * Yo'naltirish: items: [{ account, rowId }] (bir yo'nalish — hammasi chiqim yoki hammasi kirim), place, categoryCode,
   * section (DOIMIY | BOSHQA), description (umumiy izoh, ixtiyoriy). Izoh: to'lovga yozilgan izohingiz → umumiy izoh →
   * bankdagi izoh. skipDuplicates — shu sana va summada yozuvi borlar o'tkazib yuboriladi; force — baribir yoziladi.
   */
  async route(body: { items?: unknown; place?: unknown; categoryCode?: unknown; section?: unknown; description?: unknown; force?: unknown; skipDuplicates?: unknown }, userId: string) {
    const list = this.items(body?.items);
    const place = await this.place(body?.place);
    const section: 'DOIMIY' | 'BOSHQA' = body?.section === 'BOSHQA' ? 'BOSHQA' : 'DOIMIY';
    const common = typeof body?.description === 'string' ? body.description.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
    const code = typeof body?.categoryCode === 'string' ? body.categoryCode.trim().slice(0, 64) : '';
    if (!code) throw new BadRequestException('Moddani tanlang');
    const by = await this.userName(userId);
    const unitOfPlace = entryUnitOf({ regionCode: place.regionCode, departmentId: place.departmentId, segment: isSegment(place.unit) ? place.unit : null });

    const out = await runExclusive(`setting:${this.key}`, async () => {
      const store = await this.store();
      const posted = this.postedMap(store);
      const picked: { account: string; row: BankAnRow }[] = [];
      for (const it of list) {
        const row = this.findRow(store, it.account, it.rowId);
        if (!row) throw new NotFoundException("To'lov topilmadi — ko'chirma o'zgargan bo'lishi mumkin, sahifani yangilang");
        if (posted.has(rk(it.account, it.rowId))) throw new BadRequestException(`${row.docDate.split('-').reverse().join('.')} № ${row.docNo || '—'}: allaqachon yo'naltirilgan`);
        picked.push({ account: it.account, row });
      }
      const dirs = new Set(picked.map((p) => p.row.dir));
      if (dirs.size > 1) throw new BadRequestException("Chiqim va kirimni alohida yo'naltiring (chiqim — xarajat, kirim — daromad)");
      const dir = picked[0]!.row.dir;
      // Modda: chiqim — xarajat moddasi (ichki), kirim — daromad turi; bo'lim ro'yxatida bo'lsin
      let categoryLabel: string;
      if (dir === 'OUT') {
        const c = await this.prisma.category.findUnique({ where: { code }, select: { label: true, isLeaf: true, isActive: true } });
        if (!c) throw new BadRequestException('Xarajat moddasi topilmadi');
        if (!c.isActive || !c.isLeaf) throw new BadRequestException('Tanlangan modda faol ichki modda emas — boshqasini tanlang');
        categoryLabel = c.label;
        await assertUnitCategory(this.prisma, 'expense', unitOfPlace, code);
      } else {
        const c = await this.prisma.incomeCategory.findUnique({ where: { code }, select: { label: true, isActive: true } });
        if (!c || !c.isActive) throw new BadRequestException('Daromad turi topilmadi yoki faol emas');
        categoryLabel = c.label;
        await assertUnitCategory(this.prisma, 'income', unitOfPlace, code);
      }
      // Ikki marta yozilmasin: shu sana va summada boshqa yozuv bo'lsa — to'xtatiladi (yoki o'tkazib yuboriladi / baribir)
      const own = new Set(store.posts.filter((p) => p.status === 'POSTED').map((p) => p.entryId));
      const dups = await this.duplicates(picked.map((p) => ({ key: rk(p.account, p.row.id), row: p.row })), own);
      let todo = picked;
      if (dups.size && body?.force !== true) {
        if (body?.skipDuplicates === true) todo = picked.filter((p) => !dups.has(rk(p.account, p.row.id)));
        else throw new BadRequestException(`${dups.size} ta to'lov uchun shu sana va summada ${dir === 'OUT' ? 'xarajat' : 'daromad'} yozuvi allaqachon bor — tekshiring («o'tkazib yuborish» yoki «baribir yozish»)`);
      }
      if (!todo.length) return { batch: null, count: 0, total: 0n, skipped: picked.length, dir, categoryLabel };
      const batch = randomUUID();
      const now = new Date().toISOString();
      const made = await this.prisma.$transaction(
        async (tx) => {
          const posts: BankPost[] = [];
          for (const { account, row } of todo) {
            const note = store.notes[rk(account, row.id)]?.comment;
            const gName = store.groups[this.keyOf(row)]?.name;
            const description = (note || common || gName || row.purpose || this.sourceLabel).slice(0, 500);
            const base = {
              date: this.entryDate(row),
              period: this.periodOf(row),
              amountTiyin: big(row.amountTiyin),
              categoryCode: code,
              segment: isSegment(place.unit) ? place.unit : null,
              regionCode: place.regionCode,
              districtId: place.districtId,
              departmentId: place.departmentId,
              description,
              paymentMethod: 'BANK' as const,
              paymentStatus: 'PAID' as const,
              source: 'IMPORT' as const,
              section,
              createdById: userId,
            };
            const e =
              dir === 'OUT'
                ? await tx.expense.create({ data: { ...base, documentNo: row.docNo.slice(0, 100) || null, counterparty: row.accountName.slice(0, 200) || null }, select: { id: true } })
                : await tx.income.create({ data: { ...base, paidTiyin: big(row.amountTiyin), clientName: row.accountName.slice(0, 200) || null, contractNo: row.docNo.slice(0, 100) || null }, select: { id: true } });
            posts.push({ id: randomUUID(), batch, account, rowId: row.id, period: this.periodOf(row), docDate: row.docDate, dir, amountTiyin: row.amountTiyin, place, categoryCode: code, categoryLabel, section, description, entryType: dir === 'OUT' ? 'EXPENSE' : 'INCOME', entryId: e.id, createdAt: now, createdBy: by, status: 'POSTED', cancelledAt: null, cancelReason: null });
          }
          store.posts.push(...posts);
          // Ko'p bo'lsa — bekor qilinganlarning eskilari tashlanadi (yo'naltirilganlar doim qoladi)
          if (store.posts.length > 20000) {
            const cancelled = store.posts.filter((p) => p.status !== 'POSTED');
            store.posts = [...store.posts.filter((p) => p.status === 'POSTED'), ...cancelled.slice(-2000)];
          }
          await this.save(store, tx);
          return posts;
        },
        { timeout: 120_000, maxWait: 10_000 },
      );
      return { batch, count: made.length, total: made.reduce((s, p) => s + big(p.amountTiyin), 0n), skipped: picked.length - todo.length, dir, categoryLabel };
    });
    if (out.count) {
      await this.audit.log({
        userId,
        action: 'CREATE',
        entity: `${this.entity}_route`,
        entityId: out.batch!,
        summary: `${this.sourceLabel}dan ${out.dir === 'OUT' ? 'xarajatga' : 'daromadga'}: ${out.count} ta to'lov, ${(Number(out.total) / 100).toLocaleString('uz-UZ')} so'm → ${place.label}, «${out.categoryLabel}»${out.skipped ? ` (${out.skipped} tasi o'tkazib yuborildi — yozuvi bor)` : ''}`,
      });
    }
    return { success: true as const, batch: out.batch, count: out.count, totalTiyin: out.total.toString(), skipped: out.skipped, entryType: out.dir === 'OUT' ? 'EXPENSE' : 'INCOME', place: place.label };
  }

  /** Yo'naltirishni bekor qilish: ids (post) yoki batch — yozuvlar o'chiriladi, to'lov yana tahlilda «yo'naltirilmagan» */
  async unroute(body: { ids?: unknown; batch?: unknown }, userId: string) {
    const ids = Array.isArray(body?.ids) ? new Set(body.ids.map(String)) : null;
    const batch = typeof body?.batch === 'string' ? body.batch : null;
    if (!ids?.size && !batch) throw new BadRequestException("Bekor qilinadiganini tanlang");
    const out = await runExclusive(`setting:${this.key}`, async () => {
      const store = await this.store();
      const hit = store.posts.filter((p) => p.status === 'POSTED' && ((ids && ids.has(p.id)) || (batch && p.batch === batch)));
      if (!hit.length) throw new NotFoundException("Yo'naltirish topilmadi yoki allaqachon bekor qilingan");
      const now = new Date().toISOString();
      await this.prisma.$transaction(async (tx) => {
        await this.softDelete(hit, tx);
        for (const p of hit) {
          p.status = 'CANCELLED';
          p.cancelledAt = now;
          p.cancelReason = "qo'lda bekor qilindi";
        }
        await this.save(store, tx);
      });
      return { count: hit.length, total: hit.reduce((s, p) => s + big(p.amountTiyin), 0n) };
    });
    await this.audit.log({ userId, action: 'DELETE', entity: `${this.entity}_route`, entityId: batch ?? [...(ids ?? [])].join(',').slice(0, 190), summary: `${this.sourceLabel}dan yo'naltirish bekor qilindi: ${out.count} ta yozuv, ${(Number(out.total) / 100).toLocaleString('uz-UZ')} so'm` });
    return { success: true as const, count: out.count, totalTiyin: out.total.toString() };
  }

  /** Yo'naltirishlar tarixi (bir martada qilinganlari bitta qator) */
  async posts(limit = 100) {
    const store = await this.store();
    const by = new Map<string, BankPost[]>();
    for (const p of store.posts) {
      const l = by.get(p.batch) ?? [];
      l.push(p);
      by.set(p.batch, l);
    }
    return [...by.entries()]
      .map(([batch, list]) => {
        const live = list.filter((p) => p.status === 'POSTED');
        const f = list[0]!;
        return { batch, createdAt: f.createdAt, createdBy: f.createdBy, dir: f.dir, entryType: f.entryType, place: f.place.label, categoryLabel: f.categoryLabel, section: f.section, count: list.length, live: live.length, totalTiyin: list.reduce((s, p) => s + big(p.amountTiyin), 0n).toString(), liveTiyin: live.reduce((s, p) => s + big(p.amountTiyin), 0n).toString(), months: [...new Set(list.map((p) => p.period))].sort(), cancelReason: live.length ? null : (list.find((p) => p.cancelReason)?.cancelReason ?? null) };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.min(500, Math.max(1, limit)));
  }
}
