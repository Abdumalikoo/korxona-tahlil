import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ENTRY_UNITS, SEGMENTS, entryUnitLabel, isSegment, segmentLabel, unitKeyOf } from '../../common/segments/segments';
import { policyRouting, readPolicy } from '../expense-policy/policy.util';
import { HrSheetsService } from '../hr-sheets/hr-sheets.service';
import { HR_SHEETS } from '../hr-sheets/hr-sheets.config';
import { hrPeople, loadSnapshot } from '../hr-sheets/hr-sheets.store';
import { PrismaService } from '../prisma/prisma.service';
import { UnitPayrollService } from '../unit-payroll/unit-payroll.service';
import { answerText, chatWorkbook } from './chat.export';
import { ChatStore } from './chat.store';
import {
  addMonths,
  catTokens,
  monthsOf,
  norm,
  parse,
  periodLabel,
  skel,
  spanLabel,
  tokens,
  type ChatContext,
  type ChatDict,
  type MoneyKind,
  type ParsedQuery,
  type PeriodSpec,
} from './chat.parse';

// ═══════════════════════════════════════════════════════════
// Manba chati — savolga faqat tizimdagi manbalardan javob (sun'iy intellektsiz, taxminsiz).
//  • Xodim: ma'lumotnomalar (10/16/37/51-jadval), Xodimlar bazasi, bo'limi («miya»), ko'chishlar, ish haqi.
//  • Pul: xarajat / daromad / natija / ish haqi — bo'lim, viloyat, Markaz bo'limi, modda, davr bo'yicha.
//    Xarajat egasi Solishtirma bilan bir xil: Xarajatlar siyosati (bo'lim qoidasi, so'ng umumiy) qo'llanadi.
//  • Xodimlar soni va ro'yxati, so'nggi yozuvlar, solishtirish (ikki davr), «eng ko'p», guruhlash.
//  • Har javobda: nima tushunilgani, qaysi manbadan olingani va davom savollari.
//  • Suhbatlar (bir nechta, nomi, qadash), tozalash (javob / suhbat / hammasi), saqlanganlar (izoh bilan),
//    Excel'ga yuklab olish va matn sifatida nusxalash — chat.store.ts, chat.export.ts. Migratsiya kerak emas.
// ═══════════════════════════════════════════════════════════

const TASHKENT_OFFSET_HOURS = 5;
const DICT_TTL_MS = 60_000;

export type ChatBlock =
  | { type: 'text'; text: string; tone?: 'muted' | 'warn' }
  | { type: 'metrics'; items: { label: string; value: string; sub?: string; tone?: 'income' | 'expense' | 'warn' | 'brand' }[] }
  | { type: 'table'; title?: string; columns: { key: string; label: string; align?: 'right' }[]; rows: Record<string, string | null>[]; total?: Record<string, string | null>; note?: string }
  | { type: 'bars'; title?: string; items: { label: string; value: number; display: string; sub?: string }[] }
  | { type: 'person'; data: unknown }
  | { type: 'choices'; title: string; items: { label: string; sub?: string; ask: string }[] };

export interface ChatAnswer {
  id: string;
  question: string;
  at: string;
  blocks: ChatBlock[];
  understood: { label: string; value: string }[];
  sources: string[];
  suggestions: string[];
  context: ChatContext;
}

interface MoneyRow {
  period: string;
  date: Date;
  amountTiyin: bigint;
  categoryCode: string;
  regionCode: number | null;
  departmentId: string | null;
  segment: string | null;
  source?: string | null;
  description?: string | null;
  counterparty?: string | null;
  clientName?: string | null;
  owner: string;
}

const nowPeriod = () => new Date(Date.now() + TASHKENT_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 7);

/** Tiyin → «12 345 678 so'm» */
export function som(t: bigint | string | number): string {
  const v = typeof t === 'bigint' ? t : BigInt(typeof t === 'number' ? Math.round(t) : t || '0');
  const neg = v < 0n;
  const s = ((neg ? -v : v) + 50n) / 100n;
  return `${neg ? '−' : ''}${s.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so'm`;
}
const num = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
function pct(cur: bigint, prev: bigint): string | null {
  if (prev === 0n) return null;
  const p = (Number(cur - prev) / Math.abs(Number(prev))) * 100;
  return `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(1).replace('.', ',')}%`;
}
type Ans = Omit<ChatAnswer, 'id' | 'question' | 'at'>;
const KIND_LABEL: Record<MoneyKind, string> = { expense: 'Xarajat', income: 'Daromad', result: 'Natija', payroll: 'Ish haqi' };

@Injectable()
export class SourceChatService {
  private dictCache: { at: number; dict: ChatDict; names: Map<string, string>; regionNames: Map<number, string>; deptNames: Map<string, string>; catLabels: Map<string, string>; incLabels: Map<string, string> } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hr: HrSheetsService,
    private readonly unitPayroll: UnitPayrollService,
  ) {}

  // ═══════════ Lug'at ═══════════

  private async dict() {
    if (this.dictCache && Date.now() - this.dictCache.at < DICT_TTL_MS) return this.dictCache;
    const [people, emps, regions, depts, cats, incCats] = await Promise.all([
      hrPeople(this.prisma).catch(() => new Map()),
      this.prisma.employee.findMany({ select: { pinfl: true, fullName: true } }),
      this.prisma.region.findMany({ select: { code: true, name: true } }),
      this.prisma.department.findMany({ select: { id: true, name: true } }),
      this.prisma.category.findMany({ select: { code: true, label: true, parentCode: true } }),
      this.prisma.incomeCategory.findMany({ select: { code: true, label: true } }),
    ]);
    const names = new Map<string, string>();
    for (const e of emps) names.set(e.pinfl, e.fullName);
    for (const p of people.values()) if (!names.has(p.pinfl)) names.set(p.pinfl, p.fullName);
    const list = [...names.entries()].map(([pinfl, fullName]) => ({ pinfl, fullName, toks: tokens(norm(fullName)).filter((t) => t.length >= 2).map(skel) }));
    const byPrefix = new Map<string, number[]>();
    list.forEach((p, i) => {
      for (const t of p.toks) {
        if (t.length < 3) continue;
        const k = t.slice(0, 3);
        const arr = byPrefix.get(k) ?? [];
        if (arr[arr.length - 1] !== i) arr.push(i);
        byPrefix.set(k, arr);
      }
    });
    const dict: ChatDict = {
      people: list,
      byPrefix,
      regions: regions
        .filter((r) => r.code !== 0)
        .map((r) => ({ code: r.code, name: r.name, stems: tokens(norm(r.name)).filter((t) => !['viloyati', 'viloyat', 'respublikasi', 'shahri', 'shahar', 'sh'].includes(t) && t.length >= 4).slice(0, 1) }))
        .filter((r) => r.stems.length),
      depts: depts.map((d) => ({ id: d.id, name: d.name, toks: tokens(norm(d.name)) })),
      cats: [
        ...cats.map((c) => ({ code: c.code, label: c.label, toks: catTokens(c.label), kind: 'expense' as const })),
        ...incCats.map((c) => ({ code: c.code, label: c.label, toks: catTokens(c.label), kind: 'income' as const })),
      ],
    };
    this.dictCache = {
      at: Date.now(),
      dict,
      names,
      regionNames: new Map(regions.map((r) => [r.code, r.name])),
      deptNames: new Map(depts.map((d) => [d.id, d.name])),
      catLabels: new Map(cats.map((c) => [c.code, c.label])),
      incLabels: new Map(incCats.map((c) => [c.code, c.label])),
    };
    return this.dictCache;
  }

  private ownerLabel(key: string, d: { regionNames: Map<number, string> }): string {
    if (key === 'center') return 'Markaz';
    if (key.startsWith('r:')) return d.regionNames.get(Number(key.slice(2))) ?? `Hudud ${key.slice(2)}`;
    if (key.startsWith('s:')) return segmentLabel(key.slice(2));
    return 'Biriktirilmagan';
  }

  // ═══════════ Suhbatlar va saqlanganlar ═══════════

  store(userId: string): ChatStore {
    return new ChatStore(this.prisma, userId);
  }

  /** Suhbatni Excel'ga */
  async exportThread(userId: string, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const t = await this.store(userId).get(id);
    const buffer = await chatWorkbook(t.title, t.items.map((answer) => ({ answer })));
    return { buffer, filename: `Chat-${t.title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40)}.xlsx` };
  }

  /** Saqlanganlarni Excel'ga (hammasi yoki tanlanganlari) */
  async exportSaved(userId: string, ids?: string): Promise<{ buffer: Buffer; filename: string }> {
    const want = ids ? new Set(ids.split(',')) : null;
    const list = (await this.store(userId).saved()).filter((x) => !want || want.has(x.id));
    const buffer = await chatWorkbook('Saqlangan javoblar', list.map((x) => ({ answer: x.answer, note: x.note, thread: x.threadTitle })));
    return { buffer, filename: 'Chat-saqlanganlar.xlsx' };
  }

  /** Javob matni (nusxalash uchun) */
  async itemText(userId: string, threadId: string, itemId: string): Promise<string> {
    const a = (await this.store(userId).items(threadId)).find((x) => x.id === itemId);
    if (!a) throw new NotFoundException('Javob topilmadi');
    return answerText(a);
  }

  // ═══════════ Savol ═══════════

  /** Savol: suhbat ko'rsatilmasa — yangi suhbat ochiladi (nomi — birinchi savol) */
  async ask(body: { text?: unknown; context?: unknown; threadId?: unknown }, userId: string): Promise<ChatAnswer & { threadId: string | null; thread: unknown }> {
    const question = typeof body?.text === 'string' ? body.text.trim().slice(0, 500) : '';
    const ctx = (body?.context && typeof body.context === 'object' ? body.context : {}) as ChatContext;
    const now = nowPeriod();
    const d = await this.dict();
    const q = parse(question, now, d.dict, ctx);
    let a: Omit<ChatAnswer, 'id' | 'question' | 'at'>;
    try {
      a = await this.answer(q, now, d);
    } catch (e) {
      if (e instanceof NotFoundException) a = { blocks: [{ type: 'text', text: String(e.message), tone: 'warn' }], understood: this.understood(q, d), sources: [], suggestions: this.helpSuggestions(), context: ctx };
      else throw e;
    }
    const out: ChatAnswer = { id: randomUUID(), question, at: new Date().toISOString(), ...a };
    if (!userId) return { ...out, threadId: null, thread: null };
    const st = this.store(userId);
    let threadId = typeof body?.threadId === 'string' ? body.threadId : '';
    if (!threadId || !(await st.threads()).some((t) => t.id === threadId)) threadId = (await st.create()).id;
    const thread = await st.append(threadId, out);
    return { ...out, threadId, thread };
  }

  private understood(q: ParsedQuery, d: Awaited<ReturnType<SourceChatService['dict']>>, extra: { label: string; value: string }[] = []) {
    const u: { label: string; value: string }[] = [];
    if (q.pinfl) u.push({ label: 'Xodim', value: d.names.get(q.pinfl) ?? q.pinfl });
    if (q.kind && q.intent !== 'person') u.push({ label: "Ko'rsatkich", value: q.overview ? 'Daromad, xarajat, natija' : KIND_LABEL[q.kind] });
    if (q.units.length) u.push({ label: "Bo'lim", value: q.units.map(entryUnitLabel).join(', ') });
    if (q.region !== null) u.push({ label: 'Viloyat', value: d.regionNames.get(q.region) ?? String(q.region) });
    if (q.dept) u.push({ label: "Markaz bo'limi", value: d.deptNames.get(q.dept) ?? q.dept });
    if (q.category) u.push({ label: 'Modda', value: d.catLabels.get(q.category) ?? d.incLabels.get(q.category) ?? q.category });
    if (q.period) u.push({ label: 'Davr', value: q.period.label });
    if (q.compare) u.push({ label: 'Solishtirish', value: q.compare.label });
    if (q.groupBy) u.push({ label: 'Guruhlash', value: q.groupBy === 'month' ? "oylar bo'yicha" : q.groupBy === 'unit' ? "bo'limlar / hududlar bo'yicha" : "moddalar bo'yicha" });
    if (q.top) u.push({ label: 'Tartib', value: q.top === 'desc' ? "eng ko'pdan" : 'eng kamdan' });
    if (q.inherited.length) u.push({ label: 'Oldingi savoldan', value: q.inherited.join(', ') });
    return [...u, ...extra];
  }

  private ctxOf(q: ParsedQuery): ChatContext {
    return { intent: q.intent, kind: q.kind, pinfl: q.pinfl, units: q.units, region: q.region, dept: q.dept, category: q.category, period: q.period };
  }

  private helpSuggestions(): string[] {
    return ["Fermer xo'jaligi xarajati shu yil oylar bo'yicha", "Yanvardagi ish haqi bo'limlar bo'yicha", 'Markaz daromadi va xarajati otgan oy', "Eng ko'p xarajat qilgan hududlar", 'Tax free xodimlari soni', 'Manbalar'];
  }

  private async answer(q: ParsedQuery, now: string, d: Awaited<ReturnType<SourceChatService['dict']>>): Promise<Omit<ChatAnswer, 'id' | 'question' | 'at'>> {
    switch (q.intent) {
      case 'greeting':
        return {
          blocks: [{ type: 'text', text: "Assalomu alaykum! Men tizimdagi manbalardan javob beraman: xodimlar (JShShIR yoki F.I.Sh. bo'yicha), ish haqi, xarajat, daromad va natija — bo'lim, hudud, modda va davr bo'yicha. Savolingizni yozing." }],
          understood: [],
          sources: [],
          suggestions: this.helpSuggestions(),
          context: {},
        };
      case 'person':
        return this.person(q, now, d);
      case 'money':
        return q.compare ? this.compare(q, now, d) : this.money(q, now, d);
      case 'records':
        return this.records(q, now, d);
      case 'staff':
        return this.staff(q, d);
      case 'units':
        return this.units(d);
      case 'sources':
        return this.sources();
      default:
        return {
          blocks: [
            { type: 'text', text: "Savolni tushunmadim. Men faqat tizimdagi manbalar bo'yicha javob beraman. Masalan:" },
            {
              type: 'table',
              columns: [
                { key: 'q', label: 'Savol' },
                { key: 'a', label: 'Javob' },
              ],
              rows: [
                { q: "<Familiya Ism> barcha ma'lumotlari  yoki  <JShShIR> ma'lumotlari", a: "Xodim kartasi: 10/16/37/51-jadval, baza, bo'limi, ko'chishlar, ish haqi" },
                { q: '<Familiya Ism> yanvardagi ish haqi', a: "Xodimning oylari bo'yicha ish haqi" },
                { q: "Fermer xo'jaligi xarajati 2026 yil oylar bo'yicha", a: "Bo'lim xarajati, oylar va moddalar kesimida" },
                { q: "Yanvardagi ish haqi bo'limlar bo'yicha", a: "Ish haqi xarajati bo'limlar / hududlar kesimida" },
                { q: 'Andijon viloyati daromadi va xarajati otgan oy', a: 'Viloyat natijasi' },
                { q: "Ijara xarajati 1-chorak", a: "Modda bo'yicha" },
                { q: "Yanvar va fevral xarajatlarini solishtir", a: 'Ikki davr farqi' },
                { q: 'Tax free xodimlari ro‘yxati', a: "Bo'lim xodimlari (miya)" },
                { q: 'Oxirgi xarajat yozuvlari Markaz', a: "So'nggi yozuvlar" },
              ],
            },
          ],
          understood: this.understood(q, d),
          sources: [],
          suggestions: this.helpSuggestions(),
          context: this.ctxOf(q),
        };
    }
  }

  // ═══════════ Xodim ═══════════

  private async person(q: ParsedQuery, now: string, d: Awaited<ReturnType<SourceChatService['dict']>>): Promise<Ans> {
    if (!q.pinfl) {
      const items = q.personChoices.map((p) => {
        const verb = q.aspect === 'payroll' ? 'ish haqi' : q.aspect === 'moves' ? "ko'chishlari" : q.aspect === 'where' ? "qaysi bo'limda" : "barcha ma'lumotlari";
        return { label: d.names.get(p) ?? p, sub: `JShShIR …${p.slice(-4)}`, ask: `${p} ${verb}${q.period && q.aspect === 'payroll' ? ` ${q.period.label}` : ''}` };
      });
      return {
        blocks: [{ type: 'choices' as const, title: `${items.length} ta xodim mos keldi — qaysi biri?`, items }],
        understood: this.understood(q, d),
        sources: ["Ma'lumotnomalar", 'Xodimlar bazasi'],
        suggestions: [],
        context: this.ctxOf(q),
      };
    }
    const card = await this.hr.person(q.pinfl).catch((e) => {
      if (e instanceof NotFoundException) throw new NotFoundException(`JShShIR ${q.pinfl} bo'yicha xodim topilmadi (ma'lumotnomalarda ham, Xodimlar bazasida ham yo'q)`);
      throw e;
    });
    const name = card.fullName;
    const srcs = [card.registry ? 'Xodimlar bazasi' : null, ...card.sheets.map((s) => `${s.no}-jadval`), card.payroll.months.length || card.payroll.units.length ? 'Ish haqi vedomostlari' : null].filter((x): x is string => Boolean(x));
    const base = { understood: this.understood(q, d), sources: srcs, context: { ...this.ctxOf(q), intent: 'person' as const } };

    if (q.aspect === 'payroll') {
      const inP = (p: string) => !q.period || (p >= q.period.from && p <= q.period.to);
      const months = card.payroll.months.filter((m) => inP(m.period));
      const units = card.payroll.units.filter((u) => inP(u.period));
      const total = [...months.map((m) => BigInt(m.totalTiyin)), ...units.map((u) => BigInt(u.amountTiyin))].reduce((a, b) => a + b, 0n);
      const blocks: ChatBlock[] = [];
      if (!months.length && !units.length) {
        blocks.push({ type: 'text', text: `${name}: ${q.period ? q.period.label : 'hech bir davr'} uchun ish haqi yozuvi topilmadi.`, tone: 'warn' });
      } else {
        blocks.push({ type: 'text', text: `${name} — ish haqi${q.period ? ` (${q.period.label})` : ''}: jami ${som(total)}.` });
        blocks.push({
          type: 'table',
          columns: [
            { key: 'p', label: 'Oy' },
            { key: 'src', label: 'Manba' },
            { key: 'a', label: 'Summa', align: 'right' },
          ],
          rows: [
            ...months.map((m) => ({ p: periodLabel(m.period), src: 'Umumiy vedomost', a: som(m.totalTiyin), _k: m.period })),
            ...units.map((u) => ({ p: periodLabel(u.period), src: `${u.label} vedomosti`, a: som(u.amountTiyin), _k: u.period })),
          ]
            .sort((a, b) => b._k.localeCompare(a._k))
            .map(({ _k, ...r }) => r),
          total: { p: 'Jami', src: '', a: som(total) },
        });
      }
      return { ...base, blocks, suggestions: [`${q.pinfl} barcha ma'lumotlari`, `${q.pinfl} qaysi bo'limda`, `${q.pinfl} ko'chishlari`] };
    }
    if (q.aspect === 'moves') {
      const blocks: ChatBlock[] = card.miya.moves.length
        ? [
            { type: 'text', text: `${name} — bo'limlar o'rtasida ko'chishlar (${card.miya.moves.length} ta):` },
            {
              type: 'table',
              columns: [
                { key: 'f', label: 'Oydan' },
                { key: 'from', label: 'Qayerdan' },
                { key: 'to', label: 'Qayerga' },
                { key: 's', label: 'Qanday' },
              ],
              rows: card.miya.moves.map((m) => ({ f: periodLabel(m.from), from: m.fromUnitLabel ?? '—', to: m.unitLabel, s: m.source === 'UPLOAD' ? 'vedomostdan' : "qo'lda" })),
            },
          ]
        : [{ type: 'text', text: `${name} bo'limlar o'rtasida ko'chmagan.` }];
      return { ...base, blocks, suggestions: [`${q.pinfl} barcha ma'lumotlari`, `${q.pinfl} ish haqi`] };
    }
    if (q.aspect === 'where') {
      const text = card.miya.unitLabel
        ? `${name} ${periodLabel(card.miya.period)} holatiga «${card.miya.unitLabel}» bo'limida.${card.place ? ` Tuzilmasi: ${card.place}.` : ''}`
        : `${name}ning bo'limi aniqlanmagan.${card.place ? ` Tuzilmasi: ${card.place}.` : ''}`;
      return { ...base, blocks: [{ type: 'text', text }], suggestions: [`${q.pinfl} barcha ma'lumotlari`, `${q.pinfl} ish haqi`, `${q.pinfl} ko'chishlari`] };
    }
    const facts = [
      card.position ? `lavozimi: ${card.position}` : null,
      card.miya.unitLabel ? `bo'limi: ${card.miya.unitLabel}` : null,
      card.status ? `holati: ${card.status}` : null,
      `manbalar: ${srcs.join(', ') || '—'}`,
    ].filter(Boolean);
    return {
      ...base,
      blocks: [
        { type: 'text', text: `${name} (JShShIR ${card.pinfl}) — ${facts.join('; ')}.` },
        { type: 'person', data: card },
      ],
      suggestions: [`${q.pinfl} ish haqi`, `${q.pinfl} ish haqi shu yil`, `${q.pinfl} ko'chishlari`],
    };
  }

  // ═══════════ Pul: yuklash va filtr ═══════════

  private async rows(kind: 'expense' | 'income', months: string[]): Promise<MoneyRow[]> {
    if (!months.length) return [];
    if (kind === 'income') {
      const rows = await this.prisma.income.findMany({
        where: { deletedAt: null, period: { in: months } },
        select: { period: true, date: true, amountTiyin: true, categoryCode: true, regionCode: true, departmentId: true, segment: true, description: true, clientName: true },
      });
      return rows.map((r) => ({ ...r, owner: unitKeyOf(r.regionCode, r.departmentId, r.segment) }));
    }
    const [rows, policy, cats] = await Promise.all([
      this.prisma.expense.findMany({
        where: { deletedAt: null, period: { in: months } },
        select: { period: true, date: true, amountTiyin: true, categoryCode: true, regionCode: true, departmentId: true, segment: true, source: true, description: true, counterparty: true },
      }),
      readPolicy(this.prisma),
      this.prisma.category.findMany({ select: { code: true, parentCode: true } }),
    ]);
    const routing = policyRouting(policy, cats);
    return rows.map((r) => ({ ...r, owner: routing.route(r)?.key ?? unitKeyOf(r.regionCode, r.departmentId, r.segment) }));
  }

  private async categorySet(code: string | null): Promise<Set<string> | null> {
    if (!code) return null;
    const cats = await this.prisma.category.findMany({ select: { code: true, parentCode: true } });
    const out = new Set([code]);
    for (let changed = true; changed; ) {
      changed = false;
      for (const c of cats) if (c.parentCode && out.has(c.parentCode) && !out.has(c.code)) {
        out.add(c.code);
        changed = true;
      }
    }
    return out;
  }

  private matcher(q: ParsedQuery, catSet: Set<string> | null, kind: 'expense' | 'income', payroll: boolean) {
    const units = q.units;
    return (r: MoneyRow) => {
      if (payroll && !(r.source === 'PAYROLL' || r.categoryCode === 'PAYROLL_BASE' || r.categoryCode.startsWith('IHQ_'))) return false;
      if (catSet && kind === 'expense' && !catSet.has(r.categoryCode)) return false;
      if (catSet && kind === 'income' && !catSet.has(r.categoryCode)) return false;
      const place = units.length || q.region !== null || q.dept;
      if (!place) return true;
      if (q.region !== null && r.owner === `r:${q.region}`) return true;
      if (q.dept && r.owner === 'center' && r.departmentId === q.dept) return true;
      for (const u of units) {
        if (u === 'CENTER' && r.owner === 'center' && !q.dept) return true;
        if (u === 'REGION' && r.owner.startsWith('r:') && q.region === null) return true;
        if (isSegment(u) && r.owner === `s:${u}`) return true;
      }
      return false;
    };
  }

  private placeLabel(q: ParsedQuery, d: Awaited<ReturnType<SourceChatService['dict']>>): string {
    const parts = [
      ...q.units.filter((u) => !(u === 'REGION' && q.region !== null) && !(u === 'CENTER' && q.dept)).map(entryUnitLabel),
      q.region !== null ? (d.regionNames.get(q.region) ?? '') : null,
      q.dept ? `Markaz › ${d.deptNames.get(q.dept) ?? ''}` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(', ') : 'Butun korxona';
  }

  private defaultPeriod(now: string): PeriodSpec {
    const from = `${now.slice(0, 4)}-01`;
    return { from, to: now, label: `${spanLabel(from, now)} (yil boshidan)` };
  }

  // ═══════════ Pul: bitta davr ═══════════

  private async money(q: ParsedQuery, now: string, d: Awaited<ReturnType<SourceChatService['dict']>>): Promise<Ans> {
    const defaulted = !q.period;
    const period = q.period ?? this.defaultPeriod(now);
    const months = monthsOf(period.from, period.to);
    const prevTo = addMonths(period.from, -1);
    const prevFrom = addMonths(period.from, -months.length);
    const prevMonths = monthsOf(prevFrom, prevTo);
    const kind = q.kind ?? 'expense';
    const catSet = await this.categorySet(q.category);
    const place = this.placeLabel(q, d);
    const blocks: ChatBlock[] = [];
    const sources: string[] = [];
    const ul = this.understood({ ...q, period }, d, defaulted ? [{ label: 'Eslatma', value: 'davr aytilmadi — yil boshidan olindi' }] : []);
    const sum = (rs: MoneyRow[]) => rs.reduce((s, r) => s + r.amountTiyin, 0n);

    if (q.overview || kind === 'result') {
      const [inc, exp, incP, expP] = await Promise.all([this.rows('income', months), this.rows('expense', months), this.rows('income', prevMonths), this.rows('expense', prevMonths)]);
      const mi = this.matcher({ ...q, category: null }, null, 'income', false);
      const me = this.matcher({ ...q, category: null }, null, 'expense', false);
      const I = inc.filter(mi);
      const E = exp.filter(me);
      const i = sum(I);
      const e = sum(E);
      const ip = sum(incP.filter(mi));
      const ep = sum(expP.filter(me));
      const r = i - e;
      blocks.push({ type: 'text', text: `${place} · ${period.label}: daromad ${som(i)}, xarajat ${som(e)}, natija ${som(r)}${i > 0n ? ` (rentabellik ${((Number(r) / Number(i)) * 100).toFixed(1).replace('.', ',')}%)` : ''}.` });
      blocks.push({
        type: 'metrics',
        items: [
          { label: 'Daromad', value: som(i), sub: `${num(I.length)} yozuv${pct(i, ip) ? ` · oldingi davrga ${pct(i, ip)}` : ''}`, tone: 'income' },
          { label: 'Xarajat', value: som(e), sub: `${num(E.length)} yozuv${pct(e, ep) ? ` · oldingi davrga ${pct(e, ep)}` : ''}`, tone: 'expense' },
          { label: 'Natija', value: som(r), sub: `oldingi davr: ${som(ip - ep)}`, tone: r >= 0n ? 'income' : 'expense' },
        ],
      });
      if (months.length > 1 && q.groupBy !== 'unit') {
        const by = new Map(months.map((m) => [m, { i: 0n, e: 0n }]));
        for (const x of I) by.get(x.period)!.i += x.amountTiyin;
        for (const x of E) by.get(x.period)!.e += x.amountTiyin;
        blocks.push({
          type: 'table',
          title: "Oylar bo'yicha",
          columns: [
            { key: 'p', label: 'Oy' },
            { key: 'i', label: 'Daromad', align: 'right' },
            { key: 'e', label: 'Xarajat', align: 'right' },
            { key: 'r', label: 'Natija', align: 'right' },
          ],
          rows: months.map((m) => ({ p: periodLabel(m), i: som(by.get(m)!.i), e: som(by.get(m)!.e), r: som(by.get(m)!.i - by.get(m)!.e) })),
          total: { p: 'Jami', i: som(i), e: som(e), r: som(r) },
        });
      }
      if (!q.units.length && q.region === null && !q.dept) {
        const by = new Map<string, { i: bigint; e: bigint }>();
        for (const x of I) by.set(x.owner, { i: (by.get(x.owner)?.i ?? 0n) + x.amountTiyin, e: by.get(x.owner)?.e ?? 0n });
        for (const x of E) by.set(x.owner, { i: by.get(x.owner)?.i ?? 0n, e: (by.get(x.owner)?.e ?? 0n) + x.amountTiyin });
        const rows = [...by.entries()].sort((a, b) => Number(b[1].i - b[1].e - (a[1].i - a[1].e)));
        blocks.push({
          type: 'table',
          title: "Bo'limlar va hududlar bo'yicha",
          columns: [
            { key: 'u', label: 'Birlik' },
            { key: 'i', label: 'Daromad', align: 'right' },
            { key: 'e', label: 'Xarajat', align: 'right' },
            { key: 'r', label: 'Natija', align: 'right' },
          ],
          rows: (q.top === 'asc' ? rows.reverse() : rows).slice(0, 40).map(([k, v]) => ({ u: this.ownerLabel(k, d), i: som(v.i), e: som(v.e), r: som(v.i - v.e) })),
        });
      }
      sources.push(`Daromadlar (${num(I.length)} yozuv)`, `Xarajatlar (${num(E.length)} yozuv, Xarajatlar siyosati qo'llangan)`);
      return {
        blocks,
        understood: ul,
        sources,
        suggestions: [`${place === 'Butun korxona' ? '' : `${place} `}xarajati moddalar bo'yicha`.trim(), "Oylar bo'yicha", 'Otgan yil shu davr', "Eng ko'p xarajat qilgan hududlar"],
        context: { ...this.ctxOf(q), kind: 'result', period },
      };
    }

    const base: 'expense' | 'income' = kind === 'income' ? 'income' : 'expense';
    const payroll = kind === 'payroll';
    const [cur, prev] = await Promise.all([this.rows(base, months), this.rows(base, prevMonths)]);
    const m = this.matcher(q, catSet, base, payroll);
    const R = cur.filter(m);
    const total = sum(R);
    const prevTotal = sum(prev.filter(m));
    const labelOf = (code: string) => (base === 'income' ? d.incLabels.get(code) : d.catLabels.get(code)) ?? code;
    const what = q.category ? `«${labelOf(q.category)}» ${KIND_LABEL[kind].toLowerCase()}i` : KIND_LABEL[kind].toLowerCase();
    if (!R.length) {
      blocks.push({ type: 'text', text: `${place} · ${period.label}: ${what} bo'yicha yozuv topilmadi.`, tone: 'warn' });
    } else {
      const ch = pct(total, prevTotal);
      blocks.push({ type: 'text', text: `${place} · ${period.label}: ${what} — ${som(total)} (${num(R.length)} yozuv).${ch ? ` Oldingi shuncha davrga (${spanLabel(prevFrom, prevTo)}) nisbatan ${ch}.` : ''}` });
      blocks.push({
        type: 'metrics',
        items: [
          { label: KIND_LABEL[kind], value: som(total), sub: `${num(R.length)} yozuv`, tone: base === 'income' ? 'income' : 'expense' },
          { label: 'Oldingi davr', value: som(prevTotal), sub: spanLabel(prevFrom, prevTo) },
          { label: "O'zgarish", value: ch ?? '—', sub: som(total - prevTotal), tone: 'brand' },
          ...(months.length > 1 ? [{ label: "Oyiga o'rtacha", value: som(total / BigInt(months.length)), sub: `${months.length} oy` }] : []),
        ],
      });
      const byUnit = () => {
        const by = new Map<string, bigint>();
        for (const x of R) by.set(x.owner, (by.get(x.owner) ?? 0n) + x.amountTiyin);
        const items = [...by.entries()].sort((a, b) => (q.top === 'asc' ? Number(a[1] - b[1]) : Number(b[1] - a[1]))).slice(0, 30);
        blocks.push({ type: 'bars', title: "Bo'limlar va hududlar bo'yicha", items: items.map(([k, v]) => ({ label: this.ownerLabel(k, d), value: Number(v), display: som(v), sub: total ? `${((Number(v) / Number(total)) * 100).toFixed(1).replace('.', ',')}%` : undefined })) });
      };
      const byCat = () => {
        const by = new Map<string, { v: bigint; n: number }>();
        for (const x of R) by.set(x.categoryCode, { v: (by.get(x.categoryCode)?.v ?? 0n) + x.amountTiyin, n: (by.get(x.categoryCode)?.n ?? 0) + 1 });
        const items = [...by.entries()].sort((a, b) => (q.top === 'asc' ? Number(a[1].v - b[1].v) : Number(b[1].v - a[1].v)));
        blocks.push({
          type: 'bars',
          title: `Moddalar bo'yicha${items.length > 15 ? ' (eng kattalari)' : ''}`,
          items: items.slice(0, 15).map(([k, v]) => ({ label: labelOf(k), value: Number(v.v), display: som(v.v), sub: `${v.n} yozuv · ${((Number(v.v) / Number(total || 1n)) * 100).toFixed(1).replace('.', ',')}%` })),
        });
      };
      const byMonth = () => {
        const by = new Map(months.map((mm) => [mm, 0n]));
        for (const x of R) by.set(x.period, (by.get(x.period) ?? 0n) + x.amountTiyin);
        blocks.push({
          type: 'table',
          title: "Oylar bo'yicha",
          columns: [
            { key: 'p', label: 'Oy' },
            { key: 'v', label: KIND_LABEL[kind], align: 'right' },
            { key: 'c', label: 'Oldingi oyga', align: 'right' },
          ],
          rows: months.map((mm, i) => ({ p: periodLabel(mm), v: som(by.get(mm)!), c: i ? (pct(by.get(mm)!, by.get(months[i - 1]!)!) ?? '—') : '—' })),
          total: { p: 'Jami', v: som(total), c: '' },
        });
      };
      const order = q.groupBy === 'unit' ? [byUnit, byMonth, byCat] : q.groupBy === 'category' ? [byCat, byMonth, byUnit] : [byMonth, byCat, byUnit];
      const showUnit = q.groupBy === 'unit' || (!q.units.length && q.region === null && !q.dept) || q.units.includes('REGION');
      for (const f of order) {
        if (f === byMonth && months.length < 2) continue;
        if (f === byUnit && !showUnit) continue;
        if (f === byCat && q.category && !catSet?.size) continue;
        f();
      }
    }
    sources.push(`${base === 'income' ? 'Daromadlar' : 'Xarajatlar'} (${num(R.length)} yozuv${base === 'expense' ? ", Xarajatlar siyosati qo'llangan" : ''})`);
    if (payroll) sources.push("Ish haqi: umumiy va bo'limlar vedomostlari, ish haqi qismlari");
    return {
      blocks,
      understood: ul,
      sources,
      suggestions: [
        q.groupBy !== 'month' ? "Oylar bo'yicha" : "Moddalar bo'yicha",
        q.groupBy !== 'unit' ? "Bo'limlar bo'yicha" : "Moddalar bo'yicha",
        'Otgan yil shu davr',
        base === 'income' ? 'Xarajati-chi?' : 'Daromadi-chi?',
        `Oxirgi ${kind === 'income' ? 'daromad' : 'xarajat'} yozuvlari`,
      ],
      context: { ...this.ctxOf(q), kind, period },
    };
  }

  // ═══════════ Pul: ikki davrni solishtirish ═══════════

  private async compare(q: ParsedQuery, _now: string, d: Awaited<ReturnType<SourceChatService['dict']>>): Promise<Ans> {
    const A = q.period!;
    const B = q.compare!;
    const kind = q.kind ?? 'expense';
    const overview = q.overview || kind === 'result';
    const catSet = await this.categorySet(q.category);
    const place = this.placeLabel(q, d);
    const load = async (p: PeriodSpec, k: 'expense' | 'income') => (await this.rows(k, monthsOf(p.from, p.to))).filter(this.matcher(overview ? { ...q, category: null } : q, overview ? null : catSet, k, kind === 'payroll'));
    const sum = (rs: MoneyRow[]) => rs.reduce((s, r) => s + r.amountTiyin, 0n);
    const blocks: ChatBlock[] = [];
    if (overview) {
      const [ia, ea, ib, eb] = await Promise.all([load(A, 'income'), load(A, 'expense'), load(B, 'income'), load(B, 'expense')]);
      const row = (l: string, a: bigint, b: bigint) => ({ k: l, a: som(a), b: som(b), d: som(b - a), p: pct(b, a) ?? '—' });
      blocks.push({ type: 'text', text: `${place}: ${A.label} va ${B.label} solishtirmasi.` });
      blocks.push({
        type: 'table',
        columns: [
          { key: 'k', label: "Ko'rsatkich" },
          { key: 'a', label: A.label, align: 'right' },
          { key: 'b', label: B.label, align: 'right' },
          { key: 'd', label: 'Farq', align: 'right' },
          { key: 'p', label: '%', align: 'right' },
        ],
        rows: [row('Daromad', sum(ia), sum(ib)), row('Xarajat', sum(ea), sum(eb)), row('Natija', sum(ia) - sum(ea), sum(ib) - sum(eb))],
      });
    } else {
      const base: 'expense' | 'income' = kind === 'income' ? 'income' : 'expense';
      const [ra, rb] = await Promise.all([load(A, base), load(B, base)]);
      const a = sum(ra);
      const b = sum(rb);
      blocks.push({ type: 'text', text: `${place} · ${KIND_LABEL[kind].toLowerCase()}: ${A.label} — ${som(a)}, ${B.label} — ${som(b)}. Farq ${som(b - a)}${pct(b, a) ? ` (${pct(b, a)})` : ''}.` });
      blocks.push({
        type: 'metrics',
        items: [
          { label: A.label, value: som(a), sub: `${num(ra.length)} yozuv` },
          { label: B.label, value: som(b), sub: `${num(rb.length)} yozuv` },
          { label: 'Farq', value: som(b - a), sub: pct(b, a) ?? '', tone: b >= a ? (base === 'income' ? 'income' : 'expense') : base === 'income' ? 'expense' : 'income' },
        ],
      });
      const labelOf = (code: string) => (base === 'income' ? d.incLabels.get(code) : d.catLabels.get(code)) ?? code;
      const by = new Map<string, { a: bigint; b: bigint }>();
      for (const x of ra) by.set(x.categoryCode, { a: (by.get(x.categoryCode)?.a ?? 0n) + x.amountTiyin, b: by.get(x.categoryCode)?.b ?? 0n });
      for (const x of rb) by.set(x.categoryCode, { a: by.get(x.categoryCode)?.a ?? 0n, b: (by.get(x.categoryCode)?.b ?? 0n) + x.amountTiyin });
      const rows = [...by.entries()].sort((x, y) => Math.abs(Number(y[1].b - y[1].a)) - Math.abs(Number(x[1].b - x[1].a))).slice(0, 15);
      if (rows.length)
        blocks.push({
          type: 'table',
          title: "Moddalar bo'yicha farq (eng katta o'zgarishlar)",
          columns: [
            { key: 'k', label: 'Modda' },
            { key: 'a', label: A.label, align: 'right' },
            { key: 'b', label: B.label, align: 'right' },
            { key: 'd', label: 'Farq', align: 'right' },
          ],
          rows: rows.map(([k, v]) => ({ k: labelOf(k), a: som(v.a), b: som(v.b), d: som(v.b - v.a) })),
        });
    }
    return {
      blocks,
      understood: this.understood(q, d),
      sources: [overview ? "Daromadlar va xarajatlar (siyosat qo'llangan)" : kind === 'income' ? 'Daromadlar' : "Xarajatlar (Xarajatlar siyosati qo'llangan)"],
      suggestions: ["Oylar bo'yicha", "Bo'limlar bo'yicha"],
      context: { ...this.ctxOf(q), kind },
    };
  }

  // ═══════════ So'nggi yozuvlar ═══════════

  private async records(q: ParsedQuery, now: string, d: Awaited<ReturnType<SourceChatService['dict']>>): Promise<Ans> {
    const period = q.period ?? { from: addMonths(now, -2), to: now, label: `${spanLabel(addMonths(now, -2), now)} (oxirgi 3 oy)` };
    const kind = q.kind ?? 'expense';
    const base: 'expense' | 'income' = kind === 'income' ? 'income' : 'expense';
    const catSet = await this.categorySet(q.category);
    const R = (await this.rows(base, monthsOf(period.from, period.to))).filter(this.matcher(q, catSet, base, kind === 'payroll')).sort((a, b) => b.date.getTime() - a.date.getTime());
    const labelOf = (code: string) => (base === 'income' ? d.incLabels.get(code) : d.catLabels.get(code)) ?? code;
    const n = Math.min(25, R.length);
    const blocks: ChatBlock[] = R.length
      ? [
          { type: 'text', text: `${this.placeLabel(q, d)} · ${period.label}: ${num(R.length)} ta ${base === 'income' ? 'daromad' : 'xarajat'} yozuvi, so'nggi ${n} tasi:` },
          {
            type: 'table',
            columns: [
              { key: 'dt', label: 'Sana' },
              { key: 'a', label: 'Summa', align: 'right' },
              { key: 'c', label: 'Modda' },
              { key: 'u', label: 'Kim hisobida' },
              { key: 'x', label: base === 'income' ? 'Mijoz / izoh' : 'Kontragent / izoh' },
            ],
            rows: R.slice(0, n).map((r) => ({
              dt: r.date.toISOString().slice(0, 10).split('-').reverse().join('.'),
              a: som(r.amountTiyin),
              c: labelOf(r.categoryCode),
              u: this.ownerLabel(r.owner, d),
              x: [r.counterparty ?? r.clientName, r.description].filter(Boolean).join(' — ').slice(0, 120) || null,
            })),
            note: R.length > n ? `Yana ${num(R.length - n)} ta yozuv — Bosh sahifa › ${base === 'income' ? 'Daromad' : 'Xarajat'} bo'limida filtr bilan ko'ring.` : undefined,
          },
        ]
      : [{ type: 'text', text: 'Bu shartlar bo‘yicha yozuv topilmadi.', tone: 'warn' }];
    return { blocks, understood: this.understood({ ...q, period }, d), sources: [base === 'income' ? 'Daromadlar' : 'Xarajatlar'], suggestions: ["Moddalar bo'yicha", "Oylar bo'yicha"], context: { ...this.ctxOf(q), intent: 'records' as const, kind, period } };
  }

  // ═══════════ Xodimlar ═══════════

  private async staff(q: ParsedQuery, d: Awaited<ReturnType<SourceChatService['dict']>>): Promise<Ans> {
    const blocks: ChatBlock[] = [];
    const sources: string[] = [];
    const listOf = async (): Promise<{ title: string; people: { pinfl: string; fullName: string; position: string | null; note?: string }[] } | null> => {
      const seg = q.units.find((u) => isSegment(u));
      if (seg) {
        const s = (await this.unitPayroll.staffOf(seg)).filter((x) => x.active);
        sources.push(`Bo'lim ro'yxati (miya: vedomostlar, Xodimlar bazasi, ma'lumotnomalar, ko'chishlar)`);
        return { title: `${segmentLabel(seg)} xodimlari`, people: s.map((x) => ({ pinfl: x.pinfl, fullName: x.fullName, position: x.position })) };
      }
      const where: Record<string, unknown> = { isActive: true };
      let title = '';
      if (q.dept) {
        where.departmentId = q.dept;
        title = `Markaz › ${d.deptNames.get(q.dept)} xodimlari`;
      } else if (q.region !== null) {
        where.regionCode = q.region;
        title = `${d.regionNames.get(q.region)} xodimlari`;
      } else if (q.units.includes('CENTER')) {
        where.regionCode = 0;
        title = 'Markaz xodimlari';
      } else if (q.units.includes('REGION')) {
        where.regionCode = { gt: 0 };
        title = 'Hududlar xodimlari';
      } else return null;
      const emps = await this.prisma.employee.findMany({ where, select: { pinfl: true, fullName: true, position: true }, orderBy: { fullName: 'asc' } });
      sources.push('Xodimlar bazasi (faol)');
      return { title, people: emps.map((e) => ({ pinfl: e.pinfl, fullName: e.fullName, position: e.position ?? null })) };
    };
    const list = await listOf();
    if (list) {
      blocks.push({ type: 'text', text: `${list.title}: ${num(list.people.length)} ta.` });
      if (list.people.length)
        blocks.push({
          type: 'table',
          columns: [
            { key: 'n', label: '№', align: 'right' },
            { key: 'f', label: 'F.I.Sh.' },
            { key: 'p', label: 'JShShIR' },
            { key: 'l', label: 'Lavozim' },
          ],
          rows: list.people.slice(0, 60).map((p, i) => ({ n: String(i + 1), f: p.fullName, p: p.pinfl, l: p.position })),
          note: list.people.length > 60 ? `Yana ${num(list.people.length - 60)} ta — to'liq ro'yxat Xodimlar yoki bo'lim › Ish haqi sahifasida.` : undefined,
        });
      return { blocks, understood: this.understood(q, d), sources, suggestions: list.people.slice(0, 2).map((p) => `${p.pinfl} barcha ma'lumotlari`), context: { ...this.ctxOf(q), intent: 'staff' as const } };
    }
    // Umumiy: bo'limlar bo'yicha
    const [center, region, people] = await Promise.all([
      this.prisma.employee.count({ where: { isActive: true, regionCode: 0 } }),
      this.prisma.employee.count({ where: { isActive: true, regionCode: { gt: 0 } } }),
      hrPeople(this.prisma).catch(() => new Map()),
    ]);
    const rows: { u: string; c: string; s: string }[] = [
      { u: 'Markaz', c: num(center), s: 'Xodimlar bazasi' },
      { u: 'Hududlar', c: num(region), s: 'Xodimlar bazasi' },
    ];
    for (const s of SEGMENTS) rows.push({ u: s.label, c: num((await this.unitPayroll.staffOf(s.code)).filter((x) => x.active).length), s: "Bo'lim ro'yxati (miya)" });
    blocks.push({ type: 'text', text: `Faol xodimlar bo'limlar bo'yicha. Ma'lumotnomalarda jami ${num(people.size)} kishi (JShShIR bo'yicha).` });
    blocks.push({
      type: 'table',
      columns: [
        { key: 'u', label: "Bo'lim" },
        { key: 'c', label: 'Xodimlar', align: 'right' },
        { key: 's', label: 'Manba' },
      ],
      rows,
    });
    return { blocks, understood: this.understood(q, d), sources: ['Xodimlar bazasi', "Bo'lim ro'yxatlari (miya)", "Ma'lumotnomalar"], suggestions: ["Fermer xo'jaligi xodimlari ro'yxati", 'Markaz xodimlari soni'], context: { ...this.ctxOf(q), intent: 'staff' as const } };
  }

  private async units(d: Awaited<ReturnType<SourceChatService['dict']>>): Promise<Ans> {
    return {
      blocks: [
        { type: 'text' as const, text: `Kiritish bo'limlari: ${ENTRY_UNITS.map((u) => u.label).join(', ')}. Viloyatlar: ${num(d.regionNames.size - (d.regionNames.has(0) ? 1 : 0))} ta, Markaz bo'limlari: ${num(d.deptNames.size)} ta.` },
      ],
      understood: [],
      sources: ["Tizim tuzilmasi"],
      suggestions: ENTRY_UNITS.slice(0, 4).map((u) => `${u.label} natijasi shu yil`),
      context: {},
    };
  }

  private async sources(): Promise<Ans> {
    const [exp, inc, emp, pay] = await Promise.all([
      this.prisma.expense.count({ where: { deletedAt: null } }),
      this.prisma.income.count({ where: { deletedAt: null } }),
      this.prisma.employee.count({ where: { isActive: true } }),
      this.prisma.payrollEntry.count({ where: { deletedAt: null } }).catch(() => 0),
    ]);
    const rows: { s: string; c: string; w: string }[] = [
      { s: 'Xarajatlar', c: `${num(exp)} yozuv`, w: "bo'lim, hudud, modda, davr; Xarajatlar siyosati bilan" },
      { s: 'Daromadlar', c: `${num(inc)} yozuv`, w: "bo'lim, hudud, xizmat turi, davr" },
      { s: 'Xodimlar bazasi', c: `${num(emp)} faol xodim`, w: 'joylashuv, lavozim, ish turi' },
      { s: 'Umumiy ish haqi vedomosti', c: `${num(pay)} qator`, w: "xodim bo'yicha oylar" },
    ];
    for (const def of HR_SHEETS) {
      const s = await loadSnapshot(this.prisma, def.code);
      rows.push({ s: def.label, c: s ? `${num(s.rows.length)} qator · ${s.uploadedAt.slice(0, 10).split('-').reverse().join('.')}` : 'yuklanmagan', w: def.hint });
    }
    return {
      blocks: [
        { type: 'text' as const, text: "Men quyidagi manbalardan javob beraman (taxmin qilmayman — faqat bazadagi ma'lumot):" },
        {
          type: 'table' as const,
          columns: [
            { key: 's', label: 'Manba' },
            { key: 'c', label: 'Hajmi' },
            { key: 'w', label: 'Nimalarni biladi' },
          ],
          rows,
        },
      ],
      understood: [],
      sources: [],
      suggestions: this.helpSuggestions(),
      context: {},
    };
  }
}