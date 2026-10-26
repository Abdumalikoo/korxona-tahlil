import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { assertSafeXlsx } from '../../common/files/xlsx-guard';
import { runExclusive } from '../../common/locks';
import { monthLabel, monthsBetween } from '../../common/period';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { parseBankStatement, parseDate, text } from '../unit-bank/unit-bank.service';
import { accountKey, accountLabel, accountTail, BANK_KIND_LABEL, counterpartyKey, groupKey, kindOf, purposeKey, rowId, type BankDir, type BankKind } from './bank-analysis.rules';

// ═══════════════════════════════════════════════════════════
// Bank ko'chirmasi tahlili (Xarajatlar › Bank ko'chirmasi).
//
// Bankdan olingan ko'chirma (выписка, 23106 shabloni bilan bir xil shakl) o'qiladi — chiqim (debet) va kirim (kredit).
// XARAJAT VA DAROMADGA YOZILMAYDI: faqat tahlil —
//  • o'xshash to'lovlar bitta guruh (oluvchi + izoh mazmuni), oyma-oy va o'sib boruvchi (jamlanma) summalar;
//  • tanlangan davr bo'yicha umumiy; har guruh — turi (soliq, kommunal, aloqa …), muntazamligi, o'zgarishi;
//  • guruh ichida — har to'lov izohi bilan.
// Bir nechta hisob raqami bo'lishi mumkin: har yuklash bir «hisob»ga tegishli; oy qayta yuklansa — shu hisobning
// o'sha oyi almashtiriladi. Hisob raqamining o'zi saqlanmaydi (faqat oxirgi 5 raqami — nomlash uchun).
// Saqlash joyi: settings («bank.analysis.store») — migratsiya kerak emas.
// ═══════════════════════════════════════════════════════════

export const BANK_ANALYSIS_KEY = 'bank.analysis.store';
const MAX_ROWS = 30000;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const cap = (v: unknown, n: number) => text(v).slice(0, n);

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

interface AccountMonth {
  batchId: string;
  fileName: string;
  savedAt: string;
  uploadedBy: string;
  rows: BankAnRow[];
}

interface Account {
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

interface Store {
  accounts: Record<string, Account>;
  batches: BankAnBatch[];
}

function readStore(raw: unknown): Store {
  const v = (raw ?? {}) as Partial<Store>;
  return {
    accounts: v.accounts && typeof v.accounts === 'object' && !Array.isArray(v.accounts) ? (v.accounts as Record<string, Account>) : {},
    batches: Array.isArray(v.batches) ? (v.batches as BankAnBatch[]) : [],
  };
}

const big = (v: string) => {
  try {
    return BigInt(v);
  } catch {
    return 0n;
  }
};

@Injectable()
export class BankAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async store(): Promise<Store> {
    return readStore((await this.prisma.setting.findUnique({ where: { key: BANK_ANALYSIS_KEY } }))?.value ?? null);
  }

  private async save(store: Store) {
    const value = store as unknown as object;
    await this.prisma.setting.upsert({ where: { key: BANK_ANALYSIS_KEY }, create: { key: BANK_ANALYSIS_KEY, value }, update: { value } });
  }

  /** Fayldagi qatorlar → tahlil qatorlari (kaliti bilan) */
  private toRows(list: { docDate: string; procDate: string | null; docNo: string; accountName: string; inn: string; mfo: string; debitTiyin: string; creditTiyin: string; purpose: string }[]): BankAnRow[] {
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
    if (!rows.length) throw new BadRequestException("Faylda summali qator (debet yoki kredit) topilmadi");
    if (rows.length > MAX_ROWS) throw new BadRequestException(`Qatorlar juda ko'p — ${MAX_ROWS} tagacha`);
    const tail = accountTail(p.top ?? []);
    const suggested = tail ? `Hisob …${tail}` : 'Asosiy hisob';
    const store = await this.store();
    const months = [...new Set(rows.map((r) => r.docDate.slice(0, 7)))].sort().map((period) => {
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
      preview: this.groups(rows, months.map((m) => m.period)).slice(0, 15),
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
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }).catch(() => null);
    const batchId = randomUUID();
    const now = new Date().toISOString();
    const result = await runExclusive(`setting:${BANK_ANALYSIS_KEY}`, async () => {
      const store = await this.store();
      const acc = (store.accounts[akey] ??= { key: akey, label, months: {} });
      acc.label = label;
      const replaced: string[] = [];
      for (const p of months) {
        if (acc.months[p]) replaced.push(p);
        acc.months[p] = { batchId, fileName, savedAt: now, uploadedBy: user?.fullName ?? '', rows: rows.filter((r) => r.docDate.startsWith(p)) };
      }
      const outT = rows.filter((r) => r.dir === 'OUT').reduce((s, r) => s + big(r.amountTiyin), 0n);
      const inT = rows.filter((r) => r.dir === 'IN').reduce((s, r) => s + big(r.amountTiyin), 0n);
      store.batches.push({ id: batchId, account: akey, accountLabel: label, fileName, createdAt: now, uploadedBy: user?.fullName ?? '', months, rows: rows.length, outTiyin: outT.toString(), inTiyin: inT.toString(), status: 'COMMITTED', cancelledAt: null });
      if (store.batches.length > 300) store.batches = store.batches.slice(-300);
      await this.save(store);
      return { replaced, outT, inT };
    });
    await this.audit.log({
      userId,
      action: 'IMPORT',
      entity: 'bank_analysis',
      entityId: batchId,
      summary: `Bank ko'chirmasi tahlili (${label}): ${months.map(monthLabel).join(', ')} — ${rows.length} ta qator${result.replaced.length ? `, ${result.replaced.length} oy almashtirildi` : ''}`,
    });
    return { success: true as const, batchId, account: akey, months, saved: rows.length, replacedMonths: result.replaced, outTiyin: result.outT.toString(), inTiyin: result.inT.toString() };
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
    const out = await runExclusive(`setting:${BANK_ANALYSIS_KEY}`, async () => {
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
      await this.save(store);
      return { removed, b };
    });
    await this.audit.log({ userId, action: 'DELETE', entity: 'bank_analysis', entityId: id, summary: `Bank ko'chirmasi tahlili bekor qilindi: ${out.b.fileName} (${out.b.accountLabel}; ${out.removed.map(monthLabel).join(', ') || 'oylar keyin almashtirilgan'})` });
    return { success: true as const, months: out.removed };
  }

  // ═══════════ Tahlil ═══════════

  private rowsIn(store: Store, months: string[], account?: string | null): BankAnRow[] {
    const accs = Object.values(store.accounts).filter((a) => !account || a.key === account);
    return accs.flatMap((a) => months.flatMap((p) => a.months[p]?.rows ?? []));
  }

  /** O'xshashlar guruhi: oyma-oy, o'sib boruvchi, turi, muntazamligi */
  private groups(rows: BankAnRow[], months: string[]) {
    const map = new Map<string, { key: string; dir: BankDir; rows: BankAnRow[] }>();
    for (const r of rows) {
      const k = groupKey(r.dir, r.inn, r.accountName, r.purpose);
      const g = map.get(k) ?? { key: k, dir: r.dir, rows: [] };
      g.rows.push(r);
      map.set(k, g);
    }
    const totalBy: Record<BankDir, bigint> = { OUT: 0n, IN: 0n };
    for (const r of rows) totalBy[r.dir] += big(r.amountTiyin);
    const list = [...map.values()].map((g) => {
      const byMonth: Record<string, bigint> = Object.fromEntries(months.map((p) => [p, 0n]));
      for (const r of g.rows) {
        const p = r.docDate.slice(0, 7);
        if (p in byMonth) byMonth[p]! += big(r.amountTiyin);
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
      const kind: BankKind = kindOf(g.dir, last.purpose, name);
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
        inn: cp.startsWith('inn:') ? cp.slice(4) : null,
        label: purposeKey(last.purpose) || '—',
        samples,
        count: g.rows.length,
        totalTiyin: total.toString(),
        sharePct: totalBy[g.dir] > 0n ? Number((total * 10000n) / totalBy[g.dir]) / 100 : 0,
        avgTiyin: active.length ? (total / BigInt(active.length)).toString() : '0',
        byMonth: Object.fromEntries(Object.entries(byMonth).map(([p, v]) => [p, v.toString()])),
        cumulative,
        activeMonths: active.length,
        /** Muntazam: tanlangan oylarning kamida 60 foizida (va kamida 3 oyda) */
        regular: active.length >= Math.max(3, Math.ceil(months.length * 0.6)),
        firstDate: sorted[sorted.length - 1]!.docDate,
        lastDate: last.docDate,
        changePct: change,
      };
    });
    return list.sort((a, b) => (big(b.totalTiyin) > big(a.totalTiyin) ? 1 : big(b.totalTiyin) < big(a.totalTiyin) ? -1 : a.counterparty.localeCompare(b.counterparty)));
  }

  /** Tanlangan davr: oyma-oy jami (chiqim, kirim), o'sib boruvchi, turlar, guruhlar */
  async view(from: string, to: string, account?: string | null) {
    if (!PERIOD_RE.test(from ?? '') || !PERIOD_RE.test(to ?? '')) throw new BadRequestException("Oy noto'g'ri (YYYY-MM)");
    const months = monthsBetween(from, to);
    if (!months.length) throw new BadRequestException("«Dan» oyi «Gacha»dan keyin bo'lmasin");
    if (months.length > 36) throw new BadRequestException("Ko'pi bilan 36 oy");
    const store = await this.store();
    const acc = account && store.accounts[account] ? account : null;
    const rows = this.rowsIn(store, months, acc);
    const groups = this.groups(rows, months);
    const series = months.map((p) => {
      const list = rows.filter((r) => r.docDate.startsWith(p));
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
        monthsWithData: series.filter((m) => m.count > 0).length,
      },
      kinds: [...byKind.values()]
        .sort((a, b) => (a.dir === b.dir ? (b.total > a.total ? 1 : -1) : a.dir === 'OUT' ? -1 : 1))
        .map((k) => ({ dir: k.dir, kind: k.kind, label: k.label, count: k.count, groups: k.groups, totalTiyin: k.total.toString(), sharePct: (k.dir === 'OUT' ? outTotal : inTotal) > 0n ? Number((k.total * 10000n) / (k.dir === 'OUT' ? outTotal : inTotal)) / 100 : 0, byMonth: Object.fromEntries(Object.entries(k.byMonth).map(([p, v]) => [p, v.toString()])) })),
      groups,
    };
  }

  /** Bitta guruh: har to'lov — sana, hujjat, oluvchi, summa, izohi (aynan o'zidek) */
  async group(key: string, from: string, to: string, account?: string | null) {
    if (typeof key !== 'string' || !key || key.length > 400) throw new BadRequestException("Guruh noto'g'ri");
    if (!PERIOD_RE.test(from ?? '') || !PERIOD_RE.test(to ?? '')) throw new BadRequestException("Oy noto'g'ri (YYYY-MM)");
    const months = monthsBetween(from, to);
    if (months.length > 36) throw new BadRequestException("Ko'pi bilan 36 oy");
    const store = await this.store();
    const acc = account && store.accounts[account] ? account : null;
    const labelOf = new Map<string, string>();
    const rows: (BankAnRow & { account: string; accountLabel: string })[] = [];
    for (const a of Object.values(store.accounts)) {
      if (acc && a.key !== acc) continue;
      labelOf.set(a.key, a.label);
      for (const p of months) for (const r of a.months[p]?.rows ?? []) if (groupKey(r.dir, r.inn, r.accountName, r.purpose) === key) rows.push({ ...r, account: a.key, accountLabel: a.label });
    }
    rows.sort((a, b) => a.docDate.localeCompare(b.docDate) || a.docNo.localeCompare(b.docNo));
    return { key, rows, totalTiyin: rows.reduce((s, r) => s + big(r.amountTiyin), 0n).toString() };
  }
}
