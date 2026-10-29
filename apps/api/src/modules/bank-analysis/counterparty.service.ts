import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { monthLabel, monthsBetween } from '../../common/period';
import { PrismaService } from '../prisma/prisma.service';
import { BANK_KIND_LABEL, counterpartyKey, groupKey, kindMatch, type BankDir, type BankKind } from './bank-analysis.rules';
import { BANK_ANALYSIS_KEY, big, readStore, type BankAnRow, type Store } from './bank-analysis.service';
import { INVOICE_KEY, invoiceGroupKey, invoiceVerdict, type InvoiceRow } from './invoice-analysis.service';
import { counterpartyMemory, KIND_RULES_KEY, prepareRules, readKindRules, rowVerdict, type KindContext } from './kind-engine';
import { ikpuName } from './invoice-analysis.parse';

// ═══════════════════════════════════════════════════════════
// Kontragentlar — yagona «miya» (Xarajatlar / Daromadlar › Kontragentlar).
// Har tashkilot (INN) bo'yicha ikki manba birga: schyot-fakturalar (hisoblangan) va bank ko'chirmasi (to'langan).
//  • nomi (eng ko'p uchragan), bizga nima beradi / biz unga nima beramiz (IKPU nomlari, bank izohi), turi;
//  • oyma-oy: fakturada — bank'da, farq (to'lanmagan qarz yoki oldindan to'lov), o'sib boruvchi qoldiq;
//  • shartnomalar, bizdagi filiallar, so'nggi fakturalar va to'lovlar.
// Faqat o'qiydi (nazorat): xarajat / daromadga hech narsa yozmaydi. Manba chati ham shu ma'lumotdan javob beradi.
// ═══════════════════════════════════════════════════════════

type Src = 'INVOICE' | 'BANK';
interface Fact {
  src: Src;
  row: BankAnRow;
  account: string;
  period: string;
  kind: BankKind;
  group: string | null;
}

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

@Injectable()
export class CounterpartyService {
  constructor(private readonly prisma: PrismaService) {}

  private async stores(): Promise<{ bank: Store; inv: Store; ctx: KindContext }> {
    const rows = await this.prisma.setting.findMany({ where: { key: { in: [BANK_ANALYSIS_KEY, INVOICE_KEY, KIND_RULES_KEY] } }, select: { key: true, value: true } });
    const bank = readStore(rows.find((r) => r.key === BANK_ANALYSIS_KEY)?.value ?? null);
    const inv = readStore(rows.find((r) => r.key === INVOICE_KEY)?.value ?? null);
    // Tur — bank va faktura tahlilidagi bilan bir xil yadro: siz bergan tur, qoidalar, kontragent xotirasi
    const ctx = { rules: prepareRules(readKindRules(rows.find((r) => r.key === KIND_RULES_KEY)?.value)), memory: counterpartyMemory([bank.groups, inv.groups]) };
    return { bank, inv, ctx };
  }

  private range(from?: string, to?: string): string[] | null {
    if (!from && !to) return null;
    if (!PERIOD_RE.test(from ?? '') || !PERIOD_RE.test(to ?? '')) throw new BadRequestException("Oy noto'g'ri (YYYY-MM)");
    const m = monthsBetween(from!, to!);
    if (!m.length || m.length > 60) throw new BadRequestException("Davr noto'g'ri (ko'pi bilan 60 oy)");
    return m;
  }

  /** Ikkala manbadan tashkilotlar (9 xonali INN) bo'yicha faktlar */
  private async facts(months: string[] | null): Promise<Map<string, Fact[]>> {
    const { bank, inv, ctx } = await this.stores();
    const want = months ? new Set(months) : null;
    const out = new Map<string, Fact[]>();
    const add = (src: Src, store: Store) => {
      for (const a of Object.values(store.accounts))
        for (const m of Object.values(a.months))
          for (const r of m.rows) {
            const inn = String(r.inn ?? '').replace(/\D/g, '');
            if (inn.length !== 9) continue;
            // Bank — ishlov sanasi oyi (vipiskadagidek), faktura — xizmat oyi
            const period = src === 'INVOICE' ? (r as InvoiceRow).period || r.docDate.slice(0, 7) : (r.procDate && /^\d{4}-\d{2}-\d{2}$/.test(r.procDate) ? r.procDate : r.docDate).slice(0, 7);
            if (want && !want.has(period)) continue;
            const ir = r as InvoiceRow;
            const manual = store.groups[src === 'INVOICE' ? invoiceGroupKey(ir) : groupKey(r.dir, r.inn, r.accountName, r.purpose)]?.kind;
            const kind: BankKind =
              manual && manual in BANK_KIND_LABEL
                ? manual
                : rowVerdict(r, ctx, () => (src === 'INVOICE' ? invoiceVerdict(r.dir, { ikpu: ir.ikpu ?? '', purpose: r.purpose }, r.accountName) : kindMatch(r.dir, r.purpose, r.accountName))).kind;
            const l = out.get(inn) ?? [];
            l.push({ src, row: r, account: a.key, period, kind, group: null });
            out.set(inn, l);
          }
    };
    add('INVOICE', inv);
    add('BANK', bank);
    // Foydalanuvchi bergan guruh nomlari (faktura va bank) — kontragent kartasida
    const names = new Map<string, string>();
    for (const [k, g] of [...Object.entries(bank.groups), ...Object.entries(inv.groups)]) {
      const m = /^(OUT|IN)\|inn:(\d{9})\|/.exec(k);
      if (m && g.name && !names.has(m[2]!)) names.set(m[2]!, g.name);
    }
    for (const [inn, l] of out) if (names.has(inn)) for (const f of l) f.group = names.get(inn)!;
    return out;
  }

  private summary(inn: string, list: Fact[]) {
    const names = new Map<string, number>();
    for (const f of list) if (f.row.accountName) names.set(f.row.accountName, (names.get(f.row.accountName) ?? 0) + 1);
    const name = [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? inn;
    const sum = (src: Src, dir: BankDir) => list.filter((f) => f.src === src && f.row.dir === dir).reduce((s, f) => s + big(f.row.amountTiyin), 0n);
    const invOut = sum('INVOICE', 'OUT');
    const bankOut = sum('BANK', 'OUT');
    const invIn = sum('INVOICE', 'IN');
    const bankIn = sum('BANK', 'IN');
    // Nima beradi: IKPU nomi (faktura) yoki bank izohi — summasi bo'yicha
    const svc = new Map<string, { label: string; total: bigint; kind: BankKind; dir: BankDir; src: Src }>();
    for (const f of list) {
      const label = f.src === 'INVOICE' ? ikpuName((f.row as InvoiceRow).ikpu ?? '') || f.row.purpose : f.row.purpose;
      const key = `${f.row.dir}|${f.src}|${label.slice(0, 80).toLowerCase()}`;
      const x = svc.get(key) ?? { label: label.slice(0, 160), total: 0n, kind: f.kind, dir: f.row.dir, src: f.src };
      x.total += big(f.row.amountTiyin);
      svc.set(key, x);
    }
    const services = [...svc.values()].filter((s) => s.src === 'INVOICE' || !list.some((f) => f.src === 'INVOICE' && f.row.dir === s.dir)).sort((a, b) => (b.total > a.total ? 1 : -1));
    const kinds = new Map<BankKind, bigint>();
    for (const f of list) kinds.set(f.kind, (kinds.get(f.kind) ?? 0n) + big(f.row.amountTiyin));
    const kind = [...kinds.entries()].sort((a, b) => (b[1] > a[1] ? 1 : -1))[0]?.[0] ?? 'BOSHQA';
    const dates = list.map((f) => f.row.docDate).sort();
    const roles: string[] = [];
    if (invOut || bankOut) roles.push('SUPPLIER');
    if (invIn || bankIn) roles.push('CLIENT');
    return {
      inn,
      name,
      /** Foydalanuvchi bergan nom (bank yoki faktura guruhida) */
      alias: list.find((f) => f.group)?.group ?? null,
      kind,
      kindLabel: BANK_KIND_LABEL[kind],
      /** SUPPLIER — bizga beradi (chiqim), CLIENT — biz unga beramiz (kirim) */
      roles,
      services: services.slice(0, 5).map((s) => ({ label: s.label, totalTiyin: s.total.toString(), kindLabel: BANK_KIND_LABEL[s.kind], dir: s.dir, src: s.src })),
      invoicedOutTiyin: invOut.toString(),
      paidOutTiyin: bankOut.toString(),
      /** Fakturada hisoblangan − bankdan to'langan (musbat — to'lanmagan, manfiy — oldindan to'langan) */
      balanceOutTiyin: (invOut - bankOut).toString(),
      invoicedInTiyin: invIn.toString(),
      receivedInTiyin: bankIn.toString(),
      balanceInTiyin: (invIn - bankIn).toString(),
      invoices: new Set(list.filter((f) => f.src === 'INVOICE').map((f) => (f.row as InvoiceRow).invoiceId)).size,
      payments: list.filter((f) => f.src === 'BANK').length,
      sources: [...new Set(list.map((f) => f.src))],
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      months: new Set(list.map((f) => f.period)).size,
    };
  }

  /** Ro'yxat: hamma kontragent (qidiruv: nom, INN, xizmat); tartib — aylanma bo'yicha */
  async list(q: { from?: string; to?: string; search?: string; role?: string; issue?: string }) {
    const months = this.range(q.from, q.to);
    const facts = await this.facts(months);
    const t = String(q.search ?? '').trim().toLowerCase();
    let rows = [...facts.entries()].map(([inn, l]) => this.summary(inn, l));
    if (q.role === 'SUPPLIER' || q.role === 'CLIENT') rows = rows.filter((r) => r.roles.includes(q.role!));
    if (q.issue === 'UNPAID') rows = rows.filter((r) => big(r.balanceOutTiyin) > 100n || big(r.balanceInTiyin) > 100n);
    if (q.issue === 'NO_INVOICE') rows = rows.filter((r) => !r.sources.includes('INVOICE'));
    if (q.issue === 'NO_BANK') rows = rows.filter((r) => !r.sources.includes('BANK'));
    if (t) rows = rows.filter((r) => r.inn.includes(t) || r.name.toLowerCase().includes(t) || (r.alias ?? '').toLowerCase().includes(t) || r.services.some((s) => s.label.toLowerCase().includes(t)));
    const turn = (r: (typeof rows)[number]) => [r.invoicedOutTiyin, r.paidOutTiyin, r.invoicedInTiyin, r.receivedInTiyin].map(big).reduce((a, b) => (a > b ? a : b), 0n);
    rows.sort((a, b) => (turn(b) > turn(a) ? 1 : turn(b) < turn(a) ? -1 : a.name.localeCompare(b.name)));
    const all = [...facts.values()].flat();
    const tot = (src: Src, dir: BankDir) => all.filter((f) => f.src === src && f.row.dir === dir).reduce((s, f) => s + big(f.row.amountTiyin), 0n).toString();
    return {
      from: months?.[0] ?? null,
      to: months?.[months.length - 1] ?? null,
      count: rows.length,
      totals: { invoicedOutTiyin: tot('INVOICE', 'OUT'), paidOutTiyin: tot('BANK', 'OUT'), invoicedInTiyin: tot('INVOICE', 'IN'), receivedInTiyin: tot('BANK', 'IN') },
      rows: rows.slice(0, 2000),
    };
  }

  /** Kontragent kartasi: oyma-oy faktura ↔ bank, xizmatlar, shartnomalar, so'nggi hujjatlar */
  async card(innRaw: string, from?: string, to?: string) {
    const inn = String(innRaw ?? '').replace(/\D/g, '');
    if (inn.length !== 9) throw new BadRequestException('INN 9 raqam bo‘lsin');
    const months = this.range(from, to);
    const list = (await this.facts(months)).get(inn);
    if (!list?.length) throw new NotFoundException(`${inn} — schyot-faktura ham, bank ko'chirmasida ham topilmadi`);
    const s = this.summary(inn, list);
    const periods = months ?? [...new Set(list.map((f) => f.period))].sort();
    let balOut = 0n;
    let balIn = 0n;
    const byMonth = periods.map((p) => {
      const l = list.filter((f) => f.period === p);
      const sum = (src: Src, dir: BankDir) => l.filter((f) => f.src === src && f.row.dir === dir).reduce((a, f) => a + big(f.row.amountTiyin), 0n);
      const io = sum('INVOICE', 'OUT');
      const bo = sum('BANK', 'OUT');
      const ii = sum('INVOICE', 'IN');
      const bi = sum('BANK', 'IN');
      balOut += io - bo;
      balIn += ii - bi;
      return { period: p, label: monthLabel(p), invoicedOutTiyin: io.toString(), paidOutTiyin: bo.toString(), invoicedInTiyin: ii.toString(), receivedInTiyin: bi.toString(), balanceOutTiyin: balOut.toString(), balanceInTiyin: balIn.toString() };
    });
    const contracts = new Map<string, { number: string; date: string | null; invoices: Set<string>; totalTiyin: bigint; last: string }>();
    const branches = new Map<string, bigint>();
    for (const f of list.filter((x) => x.src === 'INVOICE')) {
      const r = f.row as InvoiceRow;
      if (r.contract) {
        const c = contracts.get(r.contract) ?? { number: r.contract, date: r.contractDate, invoices: new Set<string>(), totalTiyin: 0n, last: r.docDate };
        c.invoices.add(r.invoiceId);
        c.totalTiyin += big(r.amountTiyin);
        if (r.docDate > c.last) c.last = r.docDate;
        contracts.set(r.contract, c);
      }
      if (r.ourBranch) branches.set(r.ourBranch, (branches.get(r.ourBranch) ?? 0n) + big(r.amountTiyin));
    }
    const recent = [...list].sort((a, b) => b.row.docDate.localeCompare(a.row.docDate) || a.src.localeCompare(b.src)).slice(0, 300);
    return {
      ...s,
      servicesAll: s.services,
      byMonth,
      contracts: [...contracts.values()].sort((a, b) => b.last.localeCompare(a.last)).map((c) => ({ number: c.number, date: c.date, invoices: c.invoices.size, totalTiyin: c.totalTiyin.toString(), lastDate: c.last })),
      branches: [...branches.entries()].sort((a, b) => (b[1] > a[1] ? 1 : -1)).map(([name, t]) => ({ name, totalTiyin: t.toString() })),
      documents: recent.map((f) => ({
        src: f.src,
        dir: f.row.dir,
        date: f.row.docDate,
        period: f.period,
        number: f.row.docNo,
        amountTiyin: f.row.amountTiyin,
        text: f.row.purpose,
        ikpu: f.src === 'INVOICE' ? ikpuName((f.row as InvoiceRow).ikpu ?? '') : null,
        status: f.src === 'INVOICE' ? (f.row as InvoiceRow).status : null,
        contract: f.src === 'INVOICE' ? (f.row as InvoiceRow).contract : null,
        kindLabel: BANK_KIND_LABEL[f.kind],
      })),
    };
  }

  /** Manba chati: savolda INN yoki kontragent nomi bo'lsa — qisqa javob (bo'lmasa null) */
  async chat(text: string): Promise<{ title: string; inn: string; summary: ReturnType<CounterpartyService['summary']>; months: { label: string; invoiced: string; paid: string }[] } | null> {
    const t = String(text ?? '').toLowerCase();
    const facts = await this.facts(null);
    if (!facts.size) return null;
    let inn = /(?<!\d)(\d{9})(?!\d)/.exec(t)?.[1] ?? null;
    if (!inn || !facts.has(inn)) {
      inn = null;
      if (!/kontragent|контрагент|faktura|фактура|yetkazib\s*beruvchi|(?<![a-z])inn(?![a-z])|(?<![а-я])инн(?![а-я])/iu.test(t)) return null;
      // Nom bo'yicha: savoldagi so'zlar (xizmat so'zlarisiz) eng ko'p mos kelgan nom
      const STOP = new Set(['kontragent', 'kontragenti', 'контрагент', 'faktura', 'fakturalar', 'фактура', 'yetkazib', 'beruvchi', 'haqida', 'qancha', 'qanday', 'qaysi', 'bizga', 'nima', 'beradi', 'tolov', 'tolovlar', 'mchj', 'aksiyadorlik', 'jamiyati']);
      const words = t.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !STOP.has(w.replace(/[ʻʼ'`]/g, '')));
      let best: { inn: string; score: number } | null = null;
      for (const [i, l] of facts) {
        const name = counterpartyKey('', l[0]!.row.accountName).slice(5);
        const score = words.filter((w) => name.includes(w)).length;
        if (score && (!best || score > best.score)) best = { inn: i, score };
      }
      inn = best?.inn ?? null;
    }
    if (!inn) return null;
    const list = facts.get(inn)!;
    const s = this.summary(inn, list);
    const periods = [...new Set(list.map((f) => f.period))].sort().slice(-6);
    return {
      title: s.alias ?? s.name,
      inn,
      summary: s,
      months: periods.map((p) => {
        const l = list.filter((f) => f.period === p && f.row.dir === 'OUT');
        return { label: monthLabel(p), invoiced: l.filter((f) => f.src === 'INVOICE').reduce((a, f) => a + big(f.row.amountTiyin), 0n).toString(), paid: l.filter((f) => f.src === 'BANK').reduce((a, f) => a + big(f.row.amountTiyin), 0n).toString() };
      }),
    };
  }
}
