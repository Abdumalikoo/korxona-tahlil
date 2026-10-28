import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { CounterpartyService } from '../bank-analysis/counterparty.service';
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
  lev,
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
  /** Javob Excel fayl qilib berilsin («Excel ber», «tashla») — qaysi javob (o'zi yoki oldingisi) */
  file?: { itemId: string };
}

interface HrFact {
  pinfl: string;
  fullName: string;
  position: string | null;
  unit: string | null;
  regionCode: number | null;
  district: string | null;
  gender: 'F' | 'M' | null;
  age: number | null;
  education: string | null;
  /** Tizimga kirgan sana (KK.OO.YYYY) */
  hired: string | null;
  source: 'hr' | 'registry';
}

interface MoneyRow {
  period: string;
  date: Date;
  amountTiyin: bigint;
  categoryCode: string;
  regionCode: number | null;
  departmentId: string | null;
  districtId?: string | null;
  segment: string | null;
  paymentStatus?: string | null;
  paidTiyin?: bigint | null;
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
  private dictCache: {
    at: number;
    dict: ChatDict;
    names: Map<string, string>;
    regionNames: Map<number, string>;
    deptNames: Map<string, string>;
    districtNames: Map<string, string>;
    catLabels: Map<string, string>;
    incLabels: Map<string, string>;
  } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hr: HrSheetsService,
    private readonly unitPayroll: UnitPayrollService,
    @Optional() private readonly counterparties?: CounterpartyService,
  ) {}

  // ═══════════ Lug'at ═══════════

  private async dict() {
    if (this.dictCache && Date.now() - this.dictCache.at < DICT_TTL_MS) return this.dictCache;
    const [people, emps, regions, depts, cats, incCats, districts] = await Promise.all([
      hrPeople(this.prisma).catch(() => new Map()),
      this.prisma.employee.findMany({ select: { pinfl: true, fullName: true, position: true } }),
      this.prisma.region.findMany({ select: { code: true, name: true } }),
      this.prisma.department.findMany({ select: { id: true, name: true } }),
      this.prisma.category.findMany({ select: { code: true, label: true, parentCode: true } }),
      this.prisma.incomeCategory.findMany({ select: { code: true, label: true } }),
      this.prisma.district.findMany({ select: { id: true, regionCode: true, name: true } }).catch(() => [] as { id: string; regionCode: number; name: string }[]),
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
    const positionToks = new Set<string>();
    for (const x of [...emps.map((e) => e.position), ...[...people.values()].map((p) => p.position)]) for (const t of tokens(norm(x ?? ''))) if (t.length >= 5) positionToks.add(t);
    const nameToks = new Set(list.flatMap((p) => p.toks).filter((t) => t.length >= 3));
    const dict: ChatDict = {
      people: list,
      byPrefix,
      positionToks: [...positionToks],
      nameToks,
      districts: districts
        .map((d) => ({ id: d.id, regionCode: d.regionCode, name: d.name, stem: tokens(norm(d.name)).filter((t) => !['tumani', 'tuman', 'shahri', 'shahar', 'sh'].includes(t))[0] ?? '' }))
        .filter((d) => d.stem.length >= 4),
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
      districtNames: new Map(districts.map((d) => [d.id, d.name])),
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

  /** Bitta javobni Excel'ga */
  async exportItem(userId: string, threadId: string, itemId: string): Promise<{ buffer: Buffer; filename: string }> {
    const a = (await this.store(userId).items(threadId)).find((x) => x.id === itemId);
    if (!a) throw new NotFoundException('Javob topilmadi');
    const buffer = await chatWorkbook(a.question, [{ answer: a }]);
    return { buffer, filename: `Chat-${a.question.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'javob'}.xlsx` };
  }

  /** Faqat buyruq («Excel ber», «tashla») — suhbatdagi oxirgi ma'lumotli javob faylga */
  private async exportCommand(userId: string, threadId: string, ctx: ChatContext): Promise<Ans> {
    const items = userId && threadId ? await this.store(userId).items(threadId).catch(() => [] as ChatAnswer[]) : [];
    // Buyruq javoblari (boshqa javobga ishora qiladi) va faqat matnli javoblar o'tkazib yuboriladi
    const prev = [...items].reverse().find((x) => (!x.file || x.file.itemId === x.id) && x.blocks.some((b) => b.type !== 'text' && b.type !== 'choices'));
    if (!prev)
      return {
        blocks: [{ type: 'text', text: "Faylga tushiradigan javob yo'q. Avval savol bering (masalan, «Tax free xodimlari ro'yxati»), keyin «Excel ber» deng — yoki bir yo'la: «Tax free xodimlari ro'yxatini Excel qilib ber».", tone: 'warn' }],
        understood: [{ label: 'Buyruq', value: 'Excel fayl' }],
        sources: [],
        suggestions: this.helpSuggestions().slice(0, 3),
        context: ctx,
      };
    return {
      blocks: [{ type: 'text', text: `«${prev.question}» javobi Excel faylga tushirildi — yuklab olinmoqda. Yuklanmasa — javob ostidagi «Excel» tugmasi.` }],
      understood: [{ label: 'Buyruq', value: 'Excel fayl' }, { label: 'Javob', value: `«${prev.question}»` }],
      sources: prev.sources,
      suggestions: [],
      context: prev.context ?? ctx,
      file: { itemId: prev.id },
    };
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
    const bodyThread = typeof body?.threadId === 'string' ? body.threadId : '';
    let a: Omit<ChatAnswer, 'id' | 'question' | 'at'>;
    if (q.intent === 'export') a = await this.exportCommand(userId, bodyThread, ctx);
    else try {
      // Kontragent (INN yoki «kontragent / faktura» + nomi) — schyot-faktura va bank ko'chirmasidan
      const cp = q.pinfl ? null : await this.counterparties?.chat(question).catch(() => null);
      a = cp ? this.counterpartyAnswer(cp) : await this.answer(q, now, d);
    } catch (e) {
      if (e instanceof NotFoundException) a = { blocks: [{ type: 'text', text: String(e.message), tone: 'warn' }], understood: this.understood(q, d), sources: [], suggestions: this.helpSuggestions(), context: ctx };
      else throw e;
    }
    const out: ChatAnswer = { id: randomUUID(), question, at: new Date().toISOString(), ...a };
    // «… Excel qilib ber» — javobning o'zi faylga (ma'lumot bo'lsa)
    if (q.exportFile && !out.file && out.blocks.some((b) => b.type !== 'text' && b.type !== 'choices')) {
      out.file = { itemId: out.id };
      out.understood = [...out.understood, { label: 'Natija', value: 'Excel fayl' }];
    }
    if (!userId) return { ...out, threadId: null, thread: null };
    const st = this.store(userId);
    let threadId = bodyThread;
    if (!threadId || !(await st.threads()).some((t) => t.id === threadId)) threadId = (await st.create()).id;
    const thread = await st.append(threadId, out);
    return { ...out, threadId, thread };
  }

  private counterpartyAnswer(cp: NonNullable<Awaited<ReturnType<CounterpartyService['chat']>>>): Omit<ChatAnswer, 'id' | 'question' | 'at'> {
    const s = cp.summary;
    const items: { label: string; value: string; sub?: string; tone?: 'income' | 'expense' | 'warn' | 'brand' }[] = [];
    if (s.roles.includes('SUPPLIER')) {
      items.push({ label: 'Fakturada (bizga)', value: som(BigInt(s.invoicedOutTiyin)), sub: `${s.invoices} ta faktura`, tone: 'expense' });
      items.push({ label: "Bankdan to'langan", value: som(BigInt(s.paidOutTiyin)), sub: `${s.payments} ta to'lov` });
      const b = BigInt(s.balanceOutTiyin);
      items.push({ label: b >= 0n ? "To'lanmagan" : "Oldindan to'langan", value: som(b < 0n ? -b : b), tone: b > 100n ? 'warn' : undefined });
    }
    if (s.roles.includes('CLIENT')) {
      items.push({ label: 'Fakturada (biz unga)', value: som(BigInt(s.invoicedInTiyin)), tone: 'income' });
      items.push({ label: 'Bankka tushgan', value: som(BigInt(s.receivedInTiyin)) });
    }
    return {
      blocks: [
        { type: 'text', text: `${cp.title}${cp.title !== s.name ? ` (${s.name})` : ''} · INN ${cp.inn} — ${s.kindLabel.toLowerCase()}. ${s.firstDate ? `${s.firstDate.split('-').reverse().join('.')} – ${s.lastDate!.split('-').reverse().join('.')}` : ''}` },
        { type: 'metrics', items },
        ...(s.services.length ? [{ type: 'table' as const, title: s.roles.includes('SUPPLIER') ? 'Bizga nima beradi' : 'Biz unga nima beramiz', columns: [{ key: 'label', label: 'Xizmat / tovar' }, { key: 'kind', label: 'Turi' }, { key: 'sum', label: 'Summa', align: 'right' as const }], rows: s.services.map((x) => ({ label: x.label, kind: x.kindLabel, sum: som(BigInt(x.totalTiyin)) })) }] : []),
        ...(cp.months.length ? [{ type: 'table' as const, title: "Oxirgi oylar (chiqim)", columns: [{ key: 'm', label: 'Oy' }, { key: 'i', label: 'Fakturada', align: 'right' as const }, { key: 'p', label: "To'langan", align: 'right' as const }], rows: cp.months.map((m) => ({ m: m.label, i: som(BigInt(m.invoiced)), p: som(BigInt(m.paid)) })) }] : []),
      ],
      understood: [{ label: 'Kontragent', value: `${cp.title} (${cp.inn})` }],
      sources: ['Schyot-fakturalar (Xarajatlar › Schyot-fakturalar)', "Bank ko'chirmasi (Xarajatlar › Bank ko'chirmasi)"],
      suggestions: [`${cp.inn} fakturalari`, 'Kontragentlar', 'Manbalar'],
      context: {},
    };
  }

  private understood(q: ParsedQuery, d: Awaited<ReturnType<SourceChatService['dict']>>, extra: { label: string; value: string }[] = []) {
    const u: { label: string; value: string }[] = [];
    if (q.pinfl) u.push({ label: 'Xodim', value: d.names.get(q.pinfl) ?? q.pinfl });
    if (q.kind && q.intent !== 'person') u.push({ label: "Ko'rsatkich", value: q.overview ? 'Daromad, xarajat, natija' : KIND_LABEL[q.kind] });
    if (q.units.length) u.push({ label: "Bo'lim", value: q.units.map(entryUnitLabel).join(', ') });
    if (q.region !== null) u.push({ label: 'Viloyat', value: d.regionNames.get(q.region) ?? String(q.region) });
    if (q.regions.length > 1) u.push({ label: 'Viloyatlar', value: q.regions.map((r) => d.regionNames.get(r) ?? String(r)).join(', ') });
    if (q.district) u.push({ label: 'Tuman', value: d.districtNames.get(q.district) ?? q.district });
    if (q.dept) u.push({ label: "Markaz bo'limi", value: d.deptNames.get(q.dept) ?? q.dept });
    if (q.party) u.push({ label: 'Kontragent / izoh', value: `«${q.party}»` });
    if (q.minSom !== null) u.push({ label: 'Summa', value: `${som(BigInt(Math.round(q.minSom * 100)))} dan katta` });
    if (q.maxSom !== null) u.push({ label: 'Summa', value: `${som(BigInt(Math.round(q.maxSom * 100)))} dan kichik` });
    if (q.unpaid) u.push({ label: 'Holat', value: "to'lanmagan (qarz)" });
    if (q.hr.gender) u.push({ label: 'Jinsi', value: q.hr.gender === 'F' ? 'ayol' : 'erkak' });
    if (q.hr.minAge || q.hr.maxAge) u.push({ label: 'Yoshi', value: [q.hr.minAge ? `${q.hr.minAge} dan` : '', q.hr.maxAge ? `${q.hr.maxAge} gacha` : ''].filter(Boolean).join(' ') });
    if (q.hr.education) u.push({ label: "Ma'lumoti", value: q.hr.education });
    if (q.hr.positions.length) u.push({ label: 'Lavozim', value: q.hr.positions.join(', ') });
    if (q.hr.hired) u.push({ label: 'Filtr', value: 'ishga kirganlar' });
    if (q.category) u.push({ label: 'Modda', value: d.catLabels.get(q.category) ?? d.incLabels.get(q.category) ?? q.category });
    if (q.period) u.push({ label: 'Davr', value: q.period.label });
    if (q.compare) u.push({ label: 'Solishtirish', value: q.compare.label });
    const GB: Record<string, string> = { month: "oylar bo'yicha", unit: "bo'limlar / hududlar bo'yicha", category: "moddalar bo'yicha", party: "kontragent / mijoz bo'yicha", position: "lavozimlar bo'yicha", age: "yosh bo'yicha", gender: "jinsi bo'yicha", education: "ma'lumoti bo'yicha", region: "viloyatlar bo'yicha", district: "tumanlar bo'yicha" };
    if (q.groupBy) u.push({ label: 'Guruhlash', value: GB[q.groupBy] ?? q.groupBy });
    if (q.top) u.push({ label: 'Tartib', value: q.top === 'desc' ? "eng ko'pdan" : 'eng kamdan' });
    if (q.limit) u.push({ label: 'Qatorlar', value: `${q.limit} ta` });
    if (q.inherited.length) u.push({ label: 'Oldingi savoldan', value: q.inherited.join(', ') });
    if (q.fixes.length) u.push({ label: 'Tuzatildi', value: q.fixes.map((f) => `${f.from} → ${f.to}`).join(', ') });
    return [...u, ...extra];
  }

  private ctxOf(q: ParsedQuery): ChatContext {
    return { intent: q.intent, kind: q.kind, pinfl: q.pinfl, units: q.units, region: q.region, regions: q.regions, district: q.district, party: q.party, dept: q.dept, category: q.category, period: q.period };
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
      case 'compareUnits':
        return this.compareUnits(q, now, d);
      case 'hr':
        return this.hrQuery(q, now, d);
      case 'topPay':
        return this.topPay(q, now, d);
      case 'units':
        return this.units(d);
      case 'sources':
        return this.sources();
      default:
        return {
          blocks: [
            ...this.didYouMean(q, d),
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
        select: { period: true, date: true, amountTiyin: true, paidTiyin: true, paymentStatus: true, categoryCode: true, regionCode: true, departmentId: true, districtId: true, segment: true, description: true, clientName: true },
      });
      return rows.map((r) => ({ ...r, owner: unitKeyOf(r.regionCode, r.departmentId, r.segment) }));
    }
    const [rows, policy, cats] = await Promise.all([
      this.prisma.expense.findMany({
        where: { deletedAt: null, period: { in: months } },
        select: { period: true, date: true, amountTiyin: true, paymentStatus: true, categoryCode: true, regionCode: true, departmentId: true, districtId: true, segment: true, source: true, description: true, counterparty: true },
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

  /** Filtrlar: ko'rsatkich, modda, joy (bo'lim / viloyat / tuman / Markaz bo'limi), kontragent, summa, qarz */
  private matcher(q: ParsedQuery, catSet: Set<string> | null, kind: 'expense' | 'income', payroll: boolean) {
    const units = q.units;
    const regions = new Set(q.regions.map((r) => `r:${r}`));
    const party = q.party ? norm(q.party) : null;
    const min = q.minSom !== null ? BigInt(Math.round(q.minSom * 100)) : null;
    const max = q.maxSom !== null ? BigInt(Math.round(q.maxSom * 100)) : null;
    return (r: MoneyRow) => {
      if (payroll && !(r.source === 'PAYROLL' || r.categoryCode === 'PAYROLL_BASE' || r.categoryCode.startsWith('IHQ_'))) return false;
      if (catSet && kind === 'expense' && !catSet.has(r.categoryCode)) return false;
      if (catSet && kind === 'income' && !catSet.has(r.categoryCode)) return false;
      if (min !== null && r.amountTiyin <= min) return false;
      if (max !== null && r.amountTiyin >= max) return false;
      if (q.unpaid && (kind === 'expense' ? r.paymentStatus === 'PAID' : (r.paidTiyin ?? 0n) >= r.amountTiyin)) return false;
      if (party && !norm(`${r.counterparty ?? ''} ${r.clientName ?? ''} ${r.description ?? ''}`).includes(party)) return false;
      if (q.district && r.districtId !== q.district) return false;
      const place = units.length || q.region !== null || q.dept || regions.size;
      if (!place) return true;
      if (regions.size > 1 && regions.has(r.owner)) return true;
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
      ...q.units.filter((u) => !(u === 'REGION' && (q.region !== null || q.regions.length)) && !(u === 'CENTER' && q.dept)).map(entryUnitLabel),
      ...(q.regions.length > 1 ? q.regions.map((r) => d.regionNames.get(r) ?? '') : q.region !== null ? [d.regionNames.get(q.region) ?? ''] : []),
      q.district ? (d.districtNames.get(q.district) ?? '') : null,
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
          rows: (q.top === 'asc' ? rows.reverse() : rows).slice(0, q.limit ?? 40).map(([k, v]) => ({ u: this.ownerLabel(k, d), i: som(v.i), e: som(v.e), r: som(v.i - v.e) })),
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
    const hasPlace = Boolean(q.units.length || q.region !== null || q.regions.length || q.dept || q.district);
    const allTotal = hasPlace ? sum(cur.filter(this.matcher({ ...q, units: [], region: null, regions: [], dept: null, district: null }, catSet, base, payroll))) : 0n;
    const filtered = Boolean(q.party || q.minSom !== null || q.maxSom !== null || q.unpaid);
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
          ...(hasPlace && allTotal > 0n ? [{ label: 'Korxona jamidagi ulushi', value: `${((Number(total) / Number(allTotal)) * 100).toFixed(1).replace('.', ',')}%`, sub: `jami: ${som(allTotal)}` }] : []),
        ],
      });
      const byParty = () => {
        const by = new Map<string, { v: bigint; n: number }>();
        for (const x of R) {
          const k = ((base === 'income' ? x.clientName : x.counterparty) ?? '').trim() || "Ko'rsatilmagan";
          by.set(k, { v: (by.get(k)?.v ?? 0n) + x.amountTiyin, n: (by.get(k)?.n ?? 0) + 1 });
        }
        const items = [...by.entries()].sort((a, b) => (q.top === 'asc' ? Number(a[1].v - b[1].v) : Number(b[1].v - a[1].v))).slice(0, q.limit ?? 20);
        blocks.push({ type: 'bars', title: base === 'income' ? "Mijozlar bo'yicha" : "Kontragentlar bo'yicha", items: items.map(([k, v]) => ({ label: k, value: Number(v.v), display: som(v.v), sub: `${v.n} yozuv` })) });
      };
      if (q.groupBy === 'party' || (filtered && !q.party)) byParty();
      const byUnit = () => {
        const by = new Map<string, bigint>();
        for (const x of R) by.set(x.owner, (by.get(x.owner) ?? 0n) + x.amountTiyin);
        const items = [...by.entries()].sort((a, b) => (q.top === 'asc' ? Number(a[1] - b[1]) : Number(b[1] - a[1]))).slice(0, q.limit ?? 30);
        blocks.push({ type: 'bars', title: "Bo'limlar va hududlar bo'yicha", items: items.map(([k, v]) => ({ label: this.ownerLabel(k, d), value: Number(v), display: som(v), sub: total ? `${((Number(v) / Number(total)) * 100).toFixed(1).replace('.', ',')}%` : undefined })) });
      };
      const byCat = () => {
        const by = new Map<string, { v: bigint; n: number }>();
        for (const x of R) by.set(x.categoryCode, { v: (by.get(x.categoryCode)?.v ?? 0n) + x.amountTiyin, n: (by.get(x.categoryCode)?.n ?? 0) + 1 });
        const items = [...by.entries()].sort((a, b) => (q.top === 'asc' ? Number(a[1].v - b[1].v) : Number(b[1].v - a[1].v)));
        blocks.push({
          type: 'bars',
          title: `Moddalar bo'yicha${items.length > 15 ? ' (eng kattalari)' : ''}`,
          items: items.slice(0, q.limit ?? 15).map(([k, v]) => ({ label: labelOf(k), value: Number(v.v), display: som(v.v), sub: `${v.n} yozuv · ${((Number(v.v) / Number(total || 1n)) * 100).toFixed(1).replace('.', ',')}%` })),
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
      if (filtered) {
        const top = [...R].sort((a, b) => Number(b.amountTiyin - a.amountTiyin)).slice(0, q.limit ?? 25);
        blocks.push({
          type: 'table',
          title: `Yozuvlar (eng kattalari${R.length > 25 ? `, ${top.length} / ${num(R.length)}` : ''})`,
          columns: [
            { key: 'dt', label: 'Sana' },
            { key: 'a', label: 'Summa', align: 'right' },
            { key: 'c', label: 'Modda' },
            { key: 'u', label: 'Kim hisobida' },
            { key: 'x', label: base === 'income' ? 'Mijoz / izoh' : 'Kontragent / izoh' },
            ...(q.unpaid ? [{ key: 'st', label: 'Holat' }] : []),
          ],
          rows: top.map((r) => ({
            dt: r.date.toISOString().slice(0, 10).split('-').reverse().join('.'),
            a: som(r.amountTiyin),
            c: labelOf(r.categoryCode),
            u: this.ownerLabel(r.owner, d),
            x: [r.counterparty ?? r.clientName, r.description].filter(Boolean).join(' — ').slice(0, 120) || null,
            ...(q.unpaid ? { st: base === 'income' ? `to'langan: ${som(r.paidTiyin ?? 0n)}` : (r.paymentStatus ?? '') } : {}),
          })),
        });
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
        "O'tgan yilning shu davri bilan solishtir",
        base === 'income' ? "Mijozlar bo'yicha" : "Kontragentlar bo'yicha",
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
    // Viloyat xodimlari — baza + ma'lumotnomalar (xodimlar tahlili orqali)
    if (q.region !== null || q.regions.length || q.district) return this.hrQuery(q, nowPeriod(), d);
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
          rows: list.people.slice(0, q.limit ?? 60).map((p, i) => ({ n: String(i + 1), f: p.fullName, p: p.pinfl, l: p.position })),
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

  // ═══════════ Bo'limlar / viloyatlarni solishtirish ═══════════

  private async compareUnits(q: ParsedQuery, now: string, d: Awaited<ReturnType<SourceChatService['dict']>>): Promise<Ans> {
    const period = q.period ?? this.defaultPeriod(now);
    const months = monthsOf(period.from, period.to);
    const places = [...q.units.filter((u) => !(u === 'REGION' && q.regions.length)), ...q.regions.map((r) => `r:${r}`)];
    const [inc, exp] = await Promise.all([this.rows('income', months), this.rows('expense', months)]);
    const catSet = await this.categorySet(q.category);
    const blank = { ...q, units: [] as string[], region: null, regions: [] as number[], dept: null, district: null };
    const qOf = (p: string): ParsedQuery => (p.startsWith('r:') ? { ...blank, region: Number(p.slice(2)) } : { ...blank, units: [p] });
    const labelOf = (p: string) => (p.startsWith('r:') ? (d.regionNames.get(Number(p.slice(2))) ?? p) : entryUnitLabel(p));
    const sum = (rs: MoneyRow[]) => rs.reduce((a, r) => a + r.amountTiyin, 0n);
    const rows = places.map((p) => {
      const qq = qOf(p);
      const i = sum(inc.filter(this.matcher({ ...qq, category: null }, null, 'income', false)));
      const e = sum(exp.filter(this.matcher({ ...qq, category: null }, null, 'expense', false)));
      const pay = sum(exp.filter(this.matcher({ ...qq, category: null }, null, 'expense', true)));
      const cat = catSet ? sum(exp.filter(this.matcher(qq, catSet, 'expense', false))) : null;
      return { p, label: labelOf(p), i, e, r: i - e, pay, cat };
    });
    const kind = q.kind ?? 'result';
    const metric = (x: (typeof rows)[number]) => (q.category ? x.cat! : kind === 'income' ? x.i : kind === 'expense' ? x.e : kind === 'payroll' ? x.pay : x.r);
    const sorted = [...rows].sort((a, b) => Number(metric(b) - metric(a)));
    const lead = sorted[0]!;
    const mName = q.category ? `«${d.catLabels.get(q.category) ?? q.category}» xarajati` : KIND_LABEL[kind].toLowerCase();
    const blocks: ChatBlock[] = [
      { type: 'text', text: `${period.label} · ${mName}: eng ko'pi — ${lead.label} (${som(metric(lead))}). ${sorted.slice(1).map((x) => `${x.label}: ${som(metric(x))}`).join(', ')}.` },
      {
        type: 'table',
        title: "Solishtirma (Xarajatlar siyosati qo'llangan)",
        columns: [
          { key: 'u', label: 'Birlik' },
          { key: 'i', label: 'Daromad', align: 'right' },
          { key: 'e', label: 'Xarajat', align: 'right' },
          { key: 'pay', label: 'shu jumladan ish haqi', align: 'right' },
          ...(q.category ? [{ key: 'cat', label: d.catLabels.get(q.category) ?? 'Modda', align: 'right' as const }] : []),
          { key: 'r', label: 'Natija', align: 'right' },
          { key: 'm', label: 'Rentabellik', align: 'right' },
        ],
        rows: rows.map((x) => ({ u: x.label, i: som(x.i), e: som(x.e), pay: som(x.pay), ...(q.category ? { cat: som(x.cat ?? 0n) } : {}), r: som(x.r), m: x.i > 0n ? `${((Number(x.r) / Number(x.i)) * 100).toFixed(1).replace('.', ',')}%` : '—' })),
      },
      { type: 'bars', title: mName[0]!.toUpperCase() + mName.slice(1), items: sorted.map((x) => ({ label: x.label, value: Number(metric(x)), display: som(metric(x)) })) },
    ];
    return {
      blocks,
      understood: this.understood({ ...q, period }, d),
      sources: [`Daromadlar va xarajatlar · ${period.label}`],
      suggestions: ["Oylar bo'yicha", "Ish haqi bo'yicha solishtir", "O'tgan yilning shu davri bilan solishtir"],
      context: { ...this.ctxOf(q), intent: 'compareUnits', period },
    };
  }

  // ═══════════ Xodimlar tahlili (ma'lumotnomalar + baza) ═══════════

  private factsCache: { at: number; facts: HrFact[] } | null = null;

  private async hrFacts(d: Awaited<ReturnType<SourceChatService['dict']>>): Promise<HrFact[]> {
    if (this.factsCache && Date.now() - this.factsCache.at < DICT_TTL_MS) return this.factsCache.facts;
    const [people, j10, j16, emps] = await Promise.all([
      hrPeople(this.prisma).catch(() => new Map()),
      loadSnapshot(this.prisma, 'J10'),
      loadSnapshot(this.prisma, 'J16'),
      this.prisma.employee.findMany({ where: { isActive: true }, select: { pinfl: true, fullName: true, position: true, regionCode: true, hiredAt: true, district: { select: { name: true } } } }),
    ]);
    const rowsOf = (s: Awaited<ReturnType<typeof loadSnapshot>>, key: string) => {
      const m = new Map<string, Record<string, string | null>>();
      if (!s) return m;
      const i = s.cols.indexOf(key);
      for (const r of s.rows) {
        const o: Record<string, string | null> = {};
        s.cols.forEach((c, k) => (o[c] = r[k] ?? null));
        if (r[i]) m.set(r[i]!, o);
      }
      return m;
    };
    const a10 = rowsOf(j10, 'pinfl');
    const a16 = rowsOf(j16, 'pinfl');
    const regionOf = (txt: string): number | null => {
      const t = norm(txt);
      const hit = d.dict.regions.filter((r) => r.stems.some((st) => t.includes(st)));
      if (!hit.length) return null;
      if (hit.length > 1 && hit.some((r) => r.stems[0] === 'toshkent')) return hit.find((r) => (/shahr/.test(t) ? /shahr/ : /viloyat/).test(norm(r.name)))?.code ?? hit[0]!.code;
      return hit[0]!.code;
    };
    const ageOf = (birth: string | null): number | null => {
      const m = birth?.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      if (!m) return null;
      const now = new Date();
      let a = now.getFullYear() - Number(m[3]);
      if (now.getMonth() + 1 < Number(m[2]) || (now.getMonth() + 1 === Number(m[2]) && now.getDate() < Number(m[1]))) a -= 1;
      return a;
    };
    const facts = new Map<string, HrFact>();
    for (const p of people.values()) {
      if (!p.working) continue;
      const o10 = a10.get(p.pinfl) ?? {};
      const o16 = a16.get(p.pinfl) ?? {};
      const placeTxt = [o16.toliqTuzilma, o16.departament, o16.tuzilma, o10.tuzilma].filter(Boolean).join(' | ');
      const district = norm(`${o10.tuzilma ?? ''} ${o16.tuzilma ?? ''}`).match(/([a-z]+)\s+tumani/)?.[1] ?? null;
      const jinsi = norm(o16.jinsi ?? '');
      facts.set(p.pinfl, {
        pinfl: p.pinfl,
        fullName: p.fullName,
        position: p.position,
        unit: p.unit,
        regionCode: regionOf(placeTxt),
        district: district ? district[0]!.toUpperCase() + district.slice(1) : null,
        gender: /ayol/.test(jinsi) ? 'F' : /erkak/.test(jinsi) ? 'M' : null,
        age: o10.yosh && /^\d+$/.test(o10.yosh) ? Number(o10.yosh) : ageOf(o10.tugilganSana ?? null),
        education: o10.malumot ? norm(o10.malumot).replace(/-/g, ' ') : o16.malumot ? norm(o16.malumot).replace(/-/g, ' ') : null,
        hired: o10.tizimda ?? o16.buyruqSana ?? null,
        source: 'hr',
      });
    }
    for (const e of emps) {
      if (facts.has(e.pinfl)) {
        const f = facts.get(e.pinfl)!;
        if (f.regionCode === null && e.regionCode && e.regionCode > 0) f.regionCode = e.regionCode;
        continue;
      }
      facts.set(e.pinfl, {
        pinfl: e.pinfl,
        fullName: e.fullName,
        position: e.position ?? null,
        unit: e.regionCode === 0 ? 'CENTER' : e.regionCode ? 'REGION' : null,
        regionCode: e.regionCode && e.regionCode > 0 ? e.regionCode : null,
        district: e.district?.name ?? null,
        gender: null,
        age: null,
        education: null,
        hired: e.hiredAt ? e.hiredAt.toISOString().slice(0, 10).split('-').reverse().join('.') : null,
        source: 'registry',
      });
    }
    const list = [...facts.values()];
    this.factsCache = { at: Date.now(), facts: list };
    return list;
  }

  private async hrQuery(q: ParsedQuery, now: string, d: Awaited<ReturnType<SourceChatService['dict']>>): Promise<Ans> {
    const all = await this.hrFacts(d);
    const ym = (dmy: string | null) => (dmy && /^\d{2}\.\d{2}\.\d{4}$/.test(dmy) ? `${dmy.slice(6)}-${dmy.slice(3, 5)}` : null);
    const hirePeriod = q.hr.hired ? (q.period ?? { from: `${now.slice(0, 4)}-01`, to: now, label: `${now.slice(0, 4)} yil` }) : null;
    const distStem = q.district ? tokens(norm(d.districtNames.get(q.district) ?? ''))[0] ?? null : null;
    const regions = q.regions.length ? new Set(q.regions) : q.region !== null ? new Set([q.region]) : null;
    const list = all.filter((f) => {
      if (q.units.length) {
        const ok = q.units.some((u) => (u === 'REGION' ? f.unit === 'REGION' || (f.regionCode !== null && !isSegment(f.unit ?? '')) : f.unit === u));
        if (!ok) return false;
      }
      if (regions && (f.regionCode === null || !regions.has(f.regionCode))) return false;
      if (distStem && !norm(f.district ?? '').startsWith(distStem)) return false;
      if (q.hr.gender && f.gender !== q.hr.gender) return false;
      if (q.hr.minAge && (f.age === null || f.age < q.hr.minAge)) return false;
      if (q.hr.maxAge && (f.age === null || f.age > q.hr.maxAge)) return false;
      if (q.hr.education && !(f.education ?? '').startsWith(q.hr.education)) return false;
      if (q.hr.positions.length && !q.hr.positions.some((w) => norm(f.position ?? '').includes(w.slice(0, Math.max(5, w.length - 2))))) return false;
      if (hirePeriod) {
        const h = ym(f.hired);
        if (!h || h < hirePeriod.from || h > hirePeriod.to) return false;
      }
      return true;
    });
    const unknownG = q.hr.gender ? all.filter((f) => f.gender === null).length : 0;
    const f = list.filter((x) => x.gender === 'F').length;
    const m = list.filter((x) => x.gender === 'M').length;
    const ages = list.map((x) => x.age).filter((x): x is number => x !== null);
    const filters = this.understood(q, d).map((u) => `${u.label.toLowerCase()}: ${u.value}`).join('; ');
    const blocks: ChatBlock[] = [
      { type: 'text', text: `${filters ? `Shart — ${filters}. ` : ''}Topildi: ${num(list.length)} ta xodim${hirePeriod ? ` (ishga kirgan: ${hirePeriod.label})` : ''}.` },
      {
        type: 'metrics',
        items: [
          { label: 'Xodimlar', value: num(list.length), tone: 'brand' },
          { label: 'Ayol / erkak', value: `${num(f)} / ${num(m)}`, sub: list.length - f - m ? `jinsi noma'lum: ${num(list.length - f - m)}` : undefined },
          { label: "O'rtacha yosh", value: ages.length ? (ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1).replace('.', ',') : '—', sub: ages.length ? `${Math.min(...ages)}–${Math.max(...ages)} yosh` : undefined },
          { label: 'Xodimlar bazasida', value: num(list.filter((x) => x.source === 'registry' || d.names.has(x.pinfl)).length) },
        ],
      },
    ];
    const group = (title: string, key: (x: HrFact) => string) => {
      const by = new Map<string, number>();
      for (const x of list) by.set(key(x), (by.get(key(x)) ?? 0) + 1);
      const items = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, q.limit ?? 30);
      blocks.push({ type: 'bars', title, items: items.map(([k, v]) => ({ label: k, value: v, display: `${num(v)} ta`, sub: `${((v / Math.max(1, list.length)) * 100).toFixed(1).replace('.', ',')}%` })) });
    };
    const band = (a: number | null) => (a === null ? "noma'lum" : a < 25 ? '25 gacha' : a < 30 ? '25–29' : a < 40 ? '30–39' : a < 50 ? '40–49' : a < 60 ? '50–59' : '60 va katta');
    const gb = q.groupBy;
    if (gb === 'position' || (!gb && !q.hr.positions.length)) group("Lavozimlar bo'yicha", (x) => x.position ?? "ko'rsatilmagan");
    if (gb === 'age') group("Yosh bo'yicha", (x) => band(x.age));
    if (gb === 'gender') group("Jinsi bo'yicha", (x) => (x.gender === 'F' ? 'Ayol' : x.gender === 'M' ? 'Erkak' : "Noma'lum"));
    if (gb === 'education') group("Ma'lumoti bo'yicha", (x) => x.education ?? "noma'lum");
    if (gb === 'region' || (!gb && !regions && !q.units.length)) group("Viloyatlar bo'yicha", (x) => (x.regionCode !== null ? (d.regionNames.get(x.regionCode) ?? String(x.regionCode)) : x.unit === 'CENTER' ? 'Markaz' : 'aniqlanmagan'));
    if (gb === 'district' || (!gb && regions && regions.size === 1)) group("Tumanlar bo'yicha", (x) => x.district ?? 'aniqlanmagan');
    if (gb === 'unit') group("Bo'limlar bo'yicha (miya)", (x) => (x.unit ? entryUnitLabel(x.unit) : 'aniqlanmagan'));
    if (list.length)
      blocks.push({
        type: 'table',
        title: `Ro'yxat${list.length > 60 ? ` (birinchi 60 ta / ${num(list.length)})` : ''}`,
        columns: [
          { key: 'n', label: '№', align: 'right' },
          { key: 'f', label: 'F.I.Sh.' },
          { key: 'l', label: 'Lavozim' },
          { key: 'u', label: "Bo'lim" },
          { key: 'a', label: 'Yosh', align: 'right' },
          { key: 'h', label: 'Tizimda' },
        ],
        rows: [...list]
          .sort((a, b) => a.fullName.localeCompare(b.fullName))
          .slice(0, q.limit ?? 60)
          .map((x, i) => ({ n: String(i + 1), f: x.fullName, l: x.position, u: x.unit ? entryUnitLabel(x.unit) : null, a: x.age !== null ? String(x.age) : null, h: x.hired })),
      });
    if (unknownG && q.hr.gender) blocks.push({ type: 'text', tone: 'muted', text: `Eslatma: ${num(unknownG)} kishining jinsi ma'lumotnomada (16-jadval) ko'rsatilmagan — ular hisobga kirmadi.` });
    return {
      blocks,
      understood: this.understood(q, d),
      sources: ["Ma'lumotnomalar (10, 16-jadval)", 'Xodimlar bazasi (faol)'],
      suggestions: ["Lavozimlar bo'yicha", "Yosh bo'yicha", "Viloyatlar bo'yicha", "Ma'lumoti bo'yicha"].filter((x) => !this.understood(q, d).some((u) => u.value === x.toLowerCase())),
      context: { ...this.ctxOf(q), intent: 'hr' },
    };
  }

  // ═══════════ Ish haqi reytingi va o'rtacha ═══════════

  private async topPay(q: ParsedQuery, now: string, d: Awaited<ReturnType<SourceChatService['dict']>>): Promise<Ans> {
    const period = q.period ?? this.defaultPeriod(now);
    const months = monthsOf(period.from, period.to);
    const inM = new Set(months);
    const seg = q.units.filter((u) => isSegment(u));
    const wantsCentral = !seg.length || q.units.includes('CENTER') || q.units.includes('REGION') || q.region !== null;
    const per = new Map<string, { total: bigint; months: Set<string>; units: Set<string>; name?: string }>();
    const add = (pinfl: string, period: string, amount: bigint, unit: string, name?: string) => {
      const x = per.get(pinfl) ?? { total: 0n, months: new Set<string>(), units: new Set<string>(), name };
      x.total += amount;
      x.months.add(period);
      x.units.add(unit);
      per.set(pinfl, x);
    };
    if (wantsCentral) {
      const emps = new Map((await this.prisma.employee.findMany({ select: { pinfl: true, regionCode: true } })).map((e) => [e.pinfl, e.regionCode]));
      const entries = await this.prisma.payrollEntry.findMany({ where: { deletedAt: null, period: { in: months } }, select: { employeePinfl: true, period: true, totalTiyin: true } });
      for (const e of entries) {
        const rc = emps.get(e.employeePinfl);
        const unit = rc === 0 ? 'CENTER' : 'REGION';
        if (q.units.includes('CENTER') && unit !== 'CENTER' && !q.units.includes('REGION')) continue;
        if (q.units.includes('REGION') && unit !== 'REGION' && !q.units.includes('CENTER')) continue;
        if (q.region !== null && rc !== q.region) continue;
        if (seg.length && !q.units.includes('CENTER') && !q.units.includes('REGION') && q.region === null) continue;
        add(e.employeePinfl, e.period, BigInt(e.totalTiyin ?? 0n), unit);
      }
    }
    if (!(q.region !== null && !seg.length)) {
      const keys = await this.prisma.setting.findMany({ where: { key: { startsWith: 'unit.payroll.' } }, select: { key: true, value: true } });
      for (const k of keys) {
        const mm = /^unit\.payroll\.([A-Z_]+)\.(\d{4}-\d{2})$/.exec(k.key);
        if (!mm || !inM.has(mm[2]!)) continue;
        if ((q.units.length || q.region !== null) && !(seg as string[]).includes(mm[1]!)) continue;
        for (const b of ((k.value as { batches?: { status?: string; rows?: { pinfl: string; fullName: string; amountTiyin: string }[] }[] } | null)?.batches ?? []).filter((x) => x.status === 'COMMITTED'))
          for (const r of b.rows ?? []) if (BigInt(r.amountTiyin) > 0n) add(r.pinfl, mm[2]!, BigInt(r.amountTiyin), mm[1]!, r.fullName);
      }
    }
    const people = [...per.entries()].filter(([, v]) => v.total > 0n);
    const total = people.reduce((a, [, v]) => a + v.total, 0n);
    const personMonths = people.reduce((a, [, v]) => a + v.months.size, 0);
    const avgMonth = personMonths ? total / BigInt(personMonths) : 0n;
    const place = this.placeLabel(q, d);
    const sorted = people.sort((a, b) => (q.top === 'asc' ? Number(a[1].total - b[1].total) : Number(b[1].total - a[1].total)));
    const blocks: ChatBlock[] = people.length
      ? [
          { type: 'text', text: `${place} · ${period.label}: ${num(people.length)} xodimga jami ${som(total)} ish haqi. Bir xodimga oyiga o'rtacha ${som(avgMonth)}.` },
          {
            type: 'metrics',
            items: [
              { label: 'Jami ish haqi', value: som(total), tone: 'expense' },
              { label: 'Xodimlar', value: num(people.length) },
              { label: "Oyiga o'rtacha (1 xodim)", value: som(avgMonth), tone: 'brand' },
              { label: 'Eng katta / eng kichik', value: som(sorted[0]![1].total), sub: `eng kichik: ${som(sorted[sorted.length - 1]![1].total)}` },
            ],
          },
          {
            type: 'table',
            title: q.top === 'asc' ? 'Eng kam olganlar' : "Eng ko'p olganlar",
            columns: [
              { key: 'n', label: '№', align: 'right' },
              { key: 'f', label: 'F.I.Sh.' },
              { key: 'u', label: "Bo'lim" },
              { key: 't', label: 'Jami', align: 'right' },
              { key: 'm', label: 'Oylar', align: 'right' },
              { key: 'a', label: "Oyiga o'rtacha", align: 'right' },
            ],
            rows: sorted.slice(0, q.limit ?? 25).map(([p, v], i) => ({
              n: String(i + 1),
              f: d.names.get(p) ?? v.name ?? p,
              u: [...v.units].map(entryUnitLabel).join(', '),
              t: som(v.total),
              m: String(v.months.size),
              a: som(v.total / BigInt(v.months.size)),
            })),
          },
        ]
      : [{ type: 'text', tone: 'warn', text: `${place} · ${period.label}: ish haqi vedomostlarida yozuv topilmadi.` }];
    return {
      blocks,
      understood: this.understood({ ...q, period }, d),
      sources: ["Umumiy ish haqi vedomosti (xodim bo'yicha)", "Bo'limlar ish haqi vedomostlari"],
      suggestions: ["Eng kam ish haqi olganlar", "Ish haqi bo'limlar bo'yicha", ...sorted.slice(0, 1).map(([p]) => `${p} ish haqi`)],
      context: { ...this.ctxOf(q), intent: 'topPay', period },
    };
  }

  // ═══════════ «Balki shuni nazarda tutgandirsiz» ═══════════

  private didYouMean(q: ParsedQuery, d: Awaited<ReturnType<SourceChatService['dict']>>): ChatBlock[] {
    const toks = tokens(q.text).filter((t) => t.length >= 4 && !/^\d+$/.test(t));
    if (!toks.length) return [];
    const scored: { pinfl: string; d: number }[] = [];
    for (const p of d.dict.people) {
      const sur = p.toks[0];
      if (!sur) continue;
      let best = 9;
      for (const t of toks) best = Math.min(best, lev(skel(t), sur, 2));
      if (best <= 2) scored.push({ pinfl: p.pinfl, d: best });
      if (scored.length > 200) break;
    }
    const top = scored.sort((a, b) => a.d - b.d).slice(0, 5);
    if (!top.length) return [];
    return [{ type: 'choices', title: 'Balki shu xodimni nazarda tutgandirsiz?', items: top.map((x) => ({ label: d.names.get(x.pinfl) ?? x.pinfl, sub: `JShShIR …${x.pinfl.slice(-4)}`, ask: `${x.pinfl} barcha ma'lumotlari` })) }];
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