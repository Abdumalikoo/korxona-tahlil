import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { monthsBetween } from '../../common/period';
import { SEGMENTS, segmentLabel } from '../../common/segments/segments';
import { EmployeeTransfersService } from '../employee-transfers/employee-transfers.service';
import { PrismaService } from '../prisma/prisma.service';
import { Nazorat3802Service } from '../qomita/nazorat-3802.service';
import { QOMITA_INCOME_PREFIX, QOMITA_SEGMENT, readQomita } from '../qomita/qomita.util';
import { fmtPct, fmtSom, periodLabel, periodShort, safeFile, signedSom } from './reports.format';
import type { Cell, Column, ReportDoc, ReportSection } from './reports.types';

// ═══════════════════════════════════════════════════════════
// Hisobotlar › Bo'limlar bo'yicha — bitta bo'lim bo'yicha aniq raqamlar (grafiksiz):
//  Markaz bo'limi (departamentId), Hudud (viloyat, ixtiyoriy — tuman) yoki Yo'nalish (Tax free, Marksheyder …).
//  1) Xulosa; 2) Oyma-oy (o'sish sur'ati, o'zini qoplash, yig'ma natija); 3) Daromad qayerdan (modda, mijoz);
//  4) Xarajat nimaga (modda → ichki modda, kontragent); 5) Ish haqi (xodimlar soni, fond; ro'yxat — faqat administrator);
//  6) Qo'mita qoplashi (bo'lsa — Nazorat zanjiri / sarf hisobi bilan bir xil); 7) O'zgarishlar (ko'chishlar, kelgan-ketgan).
// Daromadi yo'q bo'lim — 3-bo'lim va «o'zini qoplash» chiqmaydi. Faqat o'qish: hech narsa yozilmaydi.
// ═══════════════════════════════════════════════════════════

export type UnitKind = 'DEPT' | 'REGION' | 'SEGMENT';
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const som = (t: bigint) => Number(t) / 100;
const pct = (a: number, b: number) => (b ? (a / b) * 100 : null);
const growth = (cur: number, prev: number) => (prev ? ((cur - prev) / Math.abs(prev)) * 100 : null);

export interface UnitReportInput {
  kind?: unknown;
  id?: unknown;
  district?: unknown;
  from?: unknown;
  to?: unknown;
}

interface Scope {
  kind: UnitKind;
  id: string;
  district: string | null;
  name: string;
  /** Bo'lim bilan bir xil nomdagi yo'nalish (Marksheyder bo'limi ↔ MARKSHEYDER) va aksincha — bo'lim */
  segment: string | null;
  departmentId: string | null;
  regionCode: number | null;
}

@Injectable()
export class UnitsReport {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly nazorat?: Nazorat3802Service,
    @Optional() private readonly transfers?: EmployeeTransfersService,
  ) {}

  /** Tanlash ro'yxatlari: Markaz bo'limlari, hududlar (tumanlari bilan), yo'nalishlar */
  async options() {
    const [deps, regions, districts] = await Promise.all([
      this.prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: [{ order: 'asc' }, { name: 'asc' }] }),
      this.prisma.region.findMany({ where: { code: { not: 0 } }, select: { code: true, name: true }, orderBy: { code: 'asc' } }),
      this.prisma.district.findMany({ select: { id: true, regionCode: true, name: true }, orderBy: { name: 'asc' } }).catch(() => [] as { id: string; regionCode: number; name: string }[]),
    ]);
    return {
      departments: deps,
      regions: regions.map((r) => ({ code: r.code, name: r.name, districts: districts.filter((d) => d.regionCode === r.code).map((d) => ({ id: d.id, name: d.name })) })),
      segments: SEGMENTS.filter((s) => s.code !== QOMITA_SEGMENT).map((s) => ({ code: s.code, name: s.label })),
    };
  }

  private async scope(input: UnitReportInput): Promise<Scope> {
    const kind = input?.kind;
    const id = typeof input?.id === 'string' ? input.id.trim() : String(input?.id ?? '');
    const district = typeof input?.district === 'string' && input.district ? input.district : null;
    const norm = (s: string) => s.toLowerCase().replace(/[ʻʼ‘’`']/g, '').replace(/\s+/g, ' ').trim();
    if (kind === 'DEPT') {
      const d = await this.prisma.department.findUnique({ where: { id }, select: { id: true, name: true } });
      if (!d) throw new NotFoundException("Bo'lim topilmadi");
      const seg = SEGMENTS.find((s) => s.code !== QOMITA_SEGMENT && norm(s.label) === norm(d.name));
      return { kind, id, district: null, name: d.name, segment: seg?.code ?? null, departmentId: d.id, regionCode: null };
    }
    if (kind === 'REGION') {
      const code = Number(id);
      const r = Number.isInteger(code) && code > 0 ? await this.prisma.region.findUnique({ where: { code }, select: { code: true, name: true } }) : null;
      if (!r) throw new NotFoundException('Hudud topilmadi');
      let name = r.name;
      if (district) {
        const dd = await this.prisma.district.findUnique({ where: { id: district }, select: { name: true, regionCode: true } });
        if (!dd || dd.regionCode !== code) throw new NotFoundException('Tuman topilmadi');
        name = `${r.name} · ${dd.name}`;
      }
      return { kind, id: String(code), district, name, segment: null, departmentId: null, regionCode: code };
    }
    if (kind === 'SEGMENT') {
      const seg = SEGMENTS.find((s) => s.code === id && s.code !== QOMITA_SEGMENT);
      if (!seg) throw new NotFoundException("Yo'nalish topilmadi");
      const deps = await this.prisma.department.findMany({ select: { id: true, name: true } });
      const dep = deps.find((d) => norm(d.name) === norm(seg.label));
      return { kind, id: seg.code, district: null, name: segmentLabel(seg.code), segment: seg.code, departmentId: dep?.id ?? null, regionCode: null };
    }
    throw new BadRequestException("Bo'lim turini tanlang: DEPT, REGION yoki SEGMENT");
  }

  async build(input: UnitReportInput, withPeople: boolean): Promise<ReportDoc> {
    const from = typeof input?.from === 'string' && PERIOD_RE.test(input.from) ? input.from : null;
    const to = typeof input?.to === 'string' && PERIOD_RE.test(input.to) ? input.to : null;
    if (!from || !to) throw new BadRequestException('Davrni tanlang (YYYY-MM)');
    const months = monthsBetween(from, to);
    if (!months.length) throw new BadRequestException("«Dan» oyi «Gacha»dan keyin bo'lmasin");
    if (months.length > 36) throw new BadRequestException("Ko'pi bilan 36 oy");
    const s = await this.scope(input);
    // O'sish sur'ati uchun — davrdan oldingi oy ham
    const prevMonth = (() => {
      const [y, m] = from.split('-').map(Number) as [number, number];
      return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    })();
    const periods = [prevMonth, ...months];

    // ── Yozuvlar ──
    const qCodes = s.departmentId ? await this.qomitaCodes(s.departmentId) : [];
    const expWhere =
      s.kind === 'REGION'
        ? { regionCode: s.regionCode!, ...(s.district ? { districtId: s.district } : {}) }
        : { OR: [...(s.departmentId && s.kind === 'DEPT' ? [{ departmentId: s.departmentId }] : []), ...(s.segment ? [{ segment: s.segment }] : [])] };
    const incWhere =
      s.kind === 'REGION'
        ? { regionCode: s.regionCode!, ...(s.district ? { districtId: s.district } : {}) }
        : {
            OR: [
              ...(s.departmentId && s.kind === 'DEPT' ? [{ departmentId: s.departmentId }] : []),
              ...(s.segment ? [{ segment: s.segment }] : []),
              ...(qCodes.length ? [{ segment: QOMITA_SEGMENT, categoryCode: { in: qCodes } }] : []),
            ],
          };
    const [expenses, incomes, cats, incCats] = await Promise.all([
      this.prisma.expense.findMany({ where: { deletedAt: null, period: { in: periods }, ...expWhere }, select: { period: true, amountTiyin: true, categoryCode: true, counterparty: true, source: true } }),
      this.prisma.income.findMany({ where: { deletedAt: null, period: { in: periods }, ...incWhere }, select: { period: true, amountTiyin: true, categoryCode: true, clientName: true, segment: true } }),
      this.prisma.category.findMany({ select: { code: true, label: true, parentCode: true } }),
      this.prisma.incomeCategory.findMany({ select: { code: true, label: true } }),
    ]);
    // 3802 hovuzi a'zosi (masalan, Call markaz): Qo'mita puli hamma bo'limlar qoplashi uchun — bo'lim «o'z daromadi» emas,
    // faqat «Qo'mita qoplashi»da ko'rsatiladi. Xizmat shartnomasida (Marksheyder) — haqiqiy daromad bo'lib qoladi.
    const qomita = await this.qomita(s, from, to);
    const poolMoney = qomita?.pool ?? false;
    const ownIncomes = poolMoney ? incomes.filter((r) => r.segment !== QOMITA_SEGMENT) : incomes;
    const catBy = new Map(cats.map((c) => [c.code, c]));
    const incLabel = new Map(incCats.map((c) => [c.code, c.label]));

    const zero = () => Object.fromEntries(periods.map((p) => [p, 0])) as Record<string, number>;
    const inc = zero();
    const exp = zero();
    for (const r of ownIncomes) inc[r.period]! += som(r.amountTiyin);
    for (const r of expenses) exp[r.period]! += som(r.amountTiyin);
    const sumM = (m: Record<string, number>) => months.reduce((t, p) => t + (m[p] ?? 0), 0);
    const I = sumM(inc);
    const E = sumM(exp);
    const R = I - E;
    const hasIncome = I !== 0;
    /** Oyda yozuv bormi (yuklanmagan oy — o'sish foizi chiqmaydi, «−100%» bo'lmasin) */
    const hasData = (p: string) => (inc[p] ?? 0) !== 0 || (exp[p] ?? 0) !== 0;
    const dataMonths = months.filter(hasData);
    const emptyMonths = months.filter((p) => !hasData(p));

    // ── Xodimlar ──
    const people = await this.people(s, months);
    const changes = await this.changes(s, from, to, withPeople);

    const sections: ReportSection[] = [];
    const moneyCols = (labels: string[]): Column[] => labels.map((l) => ({ label: l, format: 'money' as const }));
    const mCols = months.map(periodShort);

    // 1) Xulosa
    const lastHeads = people.heads[months[months.length - 1]!] ?? 0;
    sections.push({
      title: "Asosiy ko'rsatkichlar",
      sheet: "Ko'rsatkichlar",
      blocks: [
        {
          type: 'kpis',
          items: [
            ...(hasIncome ? [{ label: 'Daromad', value: fmtSom(I) }] : []),
            { label: 'Xarajat', value: fmtSom(E) },
            ...(hasIncome
              ? [
                  { label: 'Natija', value: signedSom(R), tone: R >= 0 ? ('good' as const) : ('bad' as const) },
                  { label: "O'zini qoplash", value: fmtPct(pct(I, E)), sub: 'daromad ÷ xarajat', tone: I >= E ? ('good' as const) : ('warn' as const) },
                ]
              : [{ label: "O'rtacha oylik xarajat", value: fmtSom(E / months.length) }]),
            { label: 'Xodimlar', value: String(lastHeads), sub: `${periodLabel(months[months.length - 1]!)} holatiga` },
            ...(qomita ? [{ label: "Qo'mita qoplagan", value: fmtSom(qomita.coveredTotal), sub: qomita.kindText }] : []),
          ],
        },
        {
          type: 'notes',
          items: [
            `Davr: ${periodLabel(from)} — ${periodLabel(to)} (${months.length} oy).`,
            s.kind === 'DEPT'
              ? `Markaz bo'limi yozuvlari${s.segment ? ` va «${segmentLabel(s.segment)}» yo'nalishi yozuvlari` : ''}${qCodes.length ? (poolMoney ? "; Qo'mitadan kelgan 3802 puli bo'lim daromadiga qo'shilmaydi (hovuz hamma bo'limlar uchun) — «Qo'mita qoplashi» bo'limida" : "; Qo'mitadan shu bo'lim uchun kelgan pul — daromad sifatida") : ''}.`
              : s.kind === 'REGION'
                ? `Hudud yozuvlari${s.district ? ' (faqat shu tuman)' : ''}.`
                : `«${s.name}» yo'nalishi yozuvlari.`,
            I === 0 && E === 0
              ? `Davrda bu tanlov bo'yicha daromad ham, xarajat ham yozilmagan${s.district ? " (tuman bo'yicha — faqat tumani ko'rsatilgan yozuvlar olinadi)" : ''}.`
              : hasIncome
                ? ''
                : "Bo'lim daromad keltirmaydi — hisobotda xarajat tarkibi asosiy.",
          ].filter(Boolean),
        },
      ],
    });

    // 2) Oyma-oy
    let cum = 0;
    const monthRows: Cell[][] = months.map((p, i) => {
      const prev = i === 0 ? prevMonth : months[i - 1]!;
      cum += (inc[p] ?? 0) - (exp[p] ?? 0);
      const ok = hasData(p) && hasData(prev);
      return hasIncome
        ? [periodLabel(p), inc[p]!, exp[p]!, inc[p]! - exp[p]!, pct(inc[p]!, exp[p]!), ok ? growth(inc[p]!, inc[prev]!) : null, ok ? growth(exp[p]!, exp[prev]!) : null, cum, people.heads[p] ?? 0]
        : [periodLabel(p), exp[p]!, ok ? growth(exp[p]!, exp[prev]!) : null, people.heads[p] ?? 0, people.heads[p] && exp[p] ? exp[p]! / people.heads[p]! : null];
    });
    sections.push({
      title: 'Oyma-oy',
      sheet: 'Oyma-oy',
      intro: `O'sish sur'ati — oldingi oyga nisbatan (birinchi oy — davrdan oldingi oyga).${emptyMonths.length ? ` Yozuv yo'q oylar (yuklanmagan bo'lishi mumkin): ${emptyMonths.map(periodLabel).join(', ')} — o'sish hisoblanmaydi.` : ''}`,
      blocks: [
        {
          type: 'table',
          freeze: true,
          columns: hasIncome
            ? [
                { label: 'Oy', width: 1.3 },
                ...moneyCols(['Daromad', 'Xarajat']),
                { label: 'Natija', format: 'money', toneBy: 'up' },
                { label: "O'zini qoplash", format: 'pct' },
                { label: "Daromad o'sishi", format: 'signedPct', toneBy: 'up' },
                { label: "Xarajat o'sishi", format: 'signedPct', toneBy: 'down' },
                { label: "Yig'ma natija", format: 'money', toneBy: 'up' },
                { label: 'Xodimlar', format: 'int' },
              ]
            : [{ label: 'Oy', width: 1.3 }, { label: 'Xarajat', format: 'money' }, { label: "Xarajat o'sishi", format: 'signedPct', toneBy: 'down' }, { label: 'Xodimlar', format: 'int' }, { label: 'Bir xodimga', format: 'money' }],
          rows: monthRows,
          total: hasIncome ? ['Jami', I, E, R, pct(I, E), null, null, R, lastHeads] : ['Jami', E, null, lastHeads, lastHeads ? E / months.length / lastHeads : null],
        },
      ],
    });

    // 3) Daromad qayerdan
    if (hasIncome) {
      const byCat = new Map<string, Record<string, number>>();
      const byClient = new Map<string, number>();
      for (const r of ownIncomes) {
        if (!months.includes(r.period)) continue;
        const label = r.segment === QOMITA_SEGMENT ? `Qo'mita: ${incLabel.get(r.categoryCode) ?? r.categoryCode}` : (incLabel.get(r.categoryCode) ?? r.categoryCode);
        const m = byCat.get(label) ?? zero();
        m[r.period]! += som(r.amountTiyin);
        byCat.set(label, m);
        const c = (r.clientName ?? '').trim() || '(mijoz ko‘rsatilmagan)';
        byClient.set(c, (byClient.get(c) ?? 0) + som(r.amountTiyin));
      }
      const catRows = [...byCat].map(([l, m]) => ({ l, m, t: sumM(m) })).sort((a, b) => b.t - a.t);
      const clients = [...byClient].sort((a, b) => b[1] - a[1]).slice(0, 20);
      sections.push({
        title: 'Daromad qayerdan keldi',
        sheet: 'Daromad',
        blocks: [
          {
            type: 'table',
            title: "Moddalar bo'yicha",
            freeze: true,
            columns: [{ label: 'Modda', width: 2.4 }, ...moneyCols(mCols), { label: 'Jami', format: 'money' }, { label: 'Ulush', format: 'pct' }],
            rows: catRows.map((x) => [x.l, ...months.map((p) => x.m[p] ?? 0), x.t, pct(x.t, I)]),
            total: ['Jami', ...months.map((p) => inc[p] ?? 0), I, 100],
          },
          {
            type: 'table',
            title: "Mijozlar (to'lovchilar) — eng kattalari",
            columns: [{ label: 'Mijoz', width: 2.6 }, { label: 'Summa', format: 'money' }, { label: 'Ulush', format: 'pct' }],
            rows: clients.map(([c, v]) => [c, v, pct(v, I)]),
          },
        ],
      });
    }

    // 4) Xarajat nimaga
    const leaf = new Map<string, Record<string, number>>();
    const byParty = new Map<string, number>();
    for (const r of expenses) {
      if (!months.includes(r.period)) continue;
      const m = leaf.get(r.categoryCode) ?? zero();
      m[r.period]! += som(r.amountTiyin);
      leaf.set(r.categoryCode, m);
      const c = (r.counterparty ?? '').trim();
      if (c) byParty.set(c, (byParty.get(c) ?? 0) + som(r.amountTiyin));
    }
    const parentOf = (code: string) => catBy.get(code)?.parentCode ?? null;
    const groups = new Map<string, { label: string; m: Record<string, number>; children: { label: string; m: Record<string, number> }[] }>();
    for (const [code, m] of leaf) {
      const p = parentOf(code) ?? code;
      const g = groups.get(p) ?? { label: catBy.get(p)?.label ?? p, m: zero(), children: [] };
      for (const k of months) g.m[k]! += m[k] ?? 0;
      if (p !== code) g.children.push({ label: catBy.get(code)?.label ?? code, m });
      groups.set(p, g);
    }
    const gl = [...groups.values()].map((g) => ({ ...g, t: sumM(g.m) })).sort((a, b) => b.t - a.t);
    const expRows: Cell[][] = [];
    const levels: number[] = [];
    // «Oxirgi oy» — ma'lumoti bor oxirgi oy (yuklanmagan oylar solishtirishga kirmaydi)
    const last = dataMonths[dataMonths.length - 1] ?? months[months.length - 1]!;
    const beforeLast = dataMonths.length > 1 ? dataMonths[dataMonths.length - 2]! : prevMonth;
    for (const g of gl) {
      expRows.push([g.label, ...months.map((p) => g.m[p] ?? 0), g.t, pct(g.t, E), growth(g.m[last] ?? 0, g.m[beforeLast] ?? 0)]);
      levels.push(0);
      for (const c of g.children.map((c) => ({ ...c, t: sumM(c.m) })).sort((a, b) => b.t - a.t)) {
        expRows.push([`   ${c.label}`, ...months.map((p) => c.m[p] ?? 0), c.t, pct(c.t, E), growth(c.m[last] ?? 0, c.m[beforeLast] ?? 0)]);
        levels.push(1);
      }
    }
    sections.push({
      title: 'Xarajat nimaga ketdi',
      sheet: 'Xarajat',
      intro: "Modda → ichki modda (bosib oching). «O'zgarish» — oxirgi oy oldingi oyga nisbatan.",
      blocks: [
        {
          type: 'table',
          title: "Moddalar bo'yicha",
          freeze: true,
          columns: [{ label: 'Modda', width: 2.6 }, ...moneyCols(mCols), { label: 'Jami', format: 'money' }, { label: 'Ulush', format: 'pct' }, { label: "O'zgarish", format: 'signedPct', toneBy: 'down' }],
          rows: expRows,
          levels,
          total: ['Jami', ...months.map((p) => exp[p] ?? 0), E, 100, growth(exp[last] ?? 0, exp[beforeLast] ?? 0)],
        },
        ...(byParty.size
          ? [
              {
                type: 'table' as const,
                title: 'Kimga to‘langan (kontragentlar) — eng kattalari',
                columns: [{ label: 'Kontragent', width: 2.6 }, { label: 'Summa', format: 'money' as const }, { label: 'Ulush', format: 'pct' as const }],
                rows: [...byParty].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([c, v]) => [c, v, pct(v, E)] as Cell[]),
              },
            ]
          : []),
      ],
    });

    // 5) Ish haqi
    sections.push({
      title: 'Ish haqi',
      sheet: 'Ish haqi',
      intro: people.source,
      blocks: [
        {
          type: 'table',
          columns: [{ label: 'Oy', width: 1.3 }, { label: 'Xodimlar', format: 'int' }, { label: "Hisoblangan ish haqi (xodimlar bo'yicha)", format: 'money' }, { label: 'Bir xodimga', format: 'money' }],
          rows: months.map((p) => [periodLabel(p), people.heads[p] ?? 0, people.fund[p] ?? 0, people.heads[p] ? (people.fund[p] ?? 0) / people.heads[p]! : null]),
          total: ['Jami', lastHeads, months.reduce((t, p) => t + (people.fund[p] ?? 0), 0), null],
        },
        ...(withPeople && people.list.length
          ? [
              {
                type: 'table' as const,
                title: "Xodimlar (hisoblangan ish haqi oyma-oy)",
                freeze: true,
                filter: true,
                columns: [{ label: 'F.I.Sh.', width: 2.4 }, ...moneyCols(mCols), { label: 'Jami', format: 'money' as const }],
                rows: people.list.map((e) => [e.fullName, ...months.map((p) => e.months[p] ?? null), e.total] as Cell[]),
              },
            ]
          : [
              {
                type: 'notes' as const,
                items: [withPeople ? "Xodimlar bo'yicha ish haqi ma'lumoti topilmadi." : "Xodimlar ro'yxati (ismlar) — faqat administrator uchun."],
              },
            ]),
      ],
    });

    // 6) Qo'mita qoplashi
    if (qomita) {
      sections.push({
        title: "Qo'mita qoplashi",
        sheet: "Qo'mita",
        intro: qomita.intro,
        blocks: [
          {
            type: 'table',
            columns: [{ label: 'Oy', width: 1.3 }, ...moneyCols(qomita.columns), { label: "Yig'ma qoldiq", format: 'money', toneBy: 'up' }],
            rows: qomita.rows,
            total: qomita.total,
          },
          ...(withPeople && qomita.people.length
            ? [
                {
                  type: 'table' as const,
                  title: "Xodimlar: 3802 qoplaydigan qism (vedomost bo'yicha)",
                  filter: true,
                  columns: [{ label: 'F.I.Sh.', width: 2.4 }, ...moneyCols(mCols), { label: 'Jami', format: 'money' as const }],
                  rows: qomita.people.map((e) => [e.fullName, ...months.map((p) => e.months[p] ?? null), e.total] as Cell[]),
                },
              ]
            : []),
        ],
      });
    }

    // 7) O'zgarishlar
    sections.push({
      title: "O'zgarishlar",
      sheet: "O'zgarishlar",
      intro: changes.intro,
      blocks: changes.rows.length
        ? [{ type: 'table', filter: true, columns: changes.columns, rows: changes.rows }]
        : [{ type: 'notes', items: ['Davrda o‘zgarish topilmadi.'] }],
    });

    const highlights = [
      I === 0 && E === 0 ? `Davrda bu tanlov bo'yicha daromad ham, xarajat ham yozilmagan${s.district ? ' (tuman bo‘yicha faqat tumani ko‘rsatilgan yozuvlar olinadi)' : ''}.` : hasIncome ? `Daromad ${fmtSom(I)}, xarajat ${fmtSom(E)} — natija ${signedSom(R)}; o'zini qoplash ${fmtPct(pct(I, E))}.` : `Xarajat ${fmtSom(E)} (oyiga o'rtacha ${fmtSom(E / months.length)}); bo'lim daromad keltirmaydi.`,
      gl[0] ? `Eng katta xarajat moddasi — «${gl[0].label}»: ${fmtSom(gl[0].t)} (${fmtPct(pct(gl[0].t, E))}).` : '',
      dataMonths.length > 1 && E > 0 ? `${periodLabel(last)}da xarajat ${periodLabel(beforeLast)}ga nisbatan ${(() => { const g = growth(exp[last] ?? 0, exp[beforeLast] ?? 0); return g === null ? "solishtirib bo'lmaydi" : `${g >= 0 ? '+' : '−'}${Math.abs(g).toFixed(1).replace('.', ',')}%`; })()}.` : '',
      qomita ? `Qo'mita qoplagan: ${fmtSom(qomita.coveredTotal)} (${qomita.kindText}).` : '',
      emptyMonths.length ? `Yozuv yo'q oylar: ${emptyMonths.map(periodLabel).join(', ')} — yuklanmagan bo'lishi mumkin.` : '',
      changes.summary,
    ].filter(Boolean);

    return {
      kind: "Bo'lim hisoboti",
      title: s.name,
      subtitle: `${periodLabel(from)} — ${periodLabel(to)}`,
      meta: [s.kind === 'DEPT' ? "Markaz bo'limi" : s.kind === 'REGION' ? 'Hudud' : "Yo'nalish", `${months.length} oy`],
      highlights,
      sections,
      fileBase: safeFile(`Bolim hisoboti - ${s.name} - ${from}_${to}`),
      generatedAt: new Date().toISOString(),
      coverSheet: 'Xulosa',
      ownMethodology: true,
    };
  }

  /** Bo'limning Qo'mita daromad turlari (sozlamadagi va «QOMITA_<indeks>») */
  private async qomitaCodes(departmentId: string): Promise<string[]> {
    const [cfg, dep] = await Promise.all([readQomita(this.prisma), this.prisma.department.findUnique({ where: { id: departmentId }, select: { index: true } })]);
    const codes = new Set<string>(cfg.items.filter((i) => i.departmentId === departmentId).map((i) => i.incomeCode));
    if (dep) codes.add(`${QOMITA_INCOME_PREFIX}${dep.index}`);
    return [...codes];
  }

  /** Xodimlar: oyma-oy soni va hisoblangan ish haqi (tarkib, bo'lmasa — ish haqi yozuvlari) */
  private async people(s: Scope, months: string[]) {
    const emps = await this.prisma.employee.findMany({
      where: s.kind === 'REGION' ? { regionCode: s.regionCode!, ...(s.district ? { districtId: s.district } : {}) } : s.departmentId ? { departmentId: s.departmentId } : { pinfl: '__none__' },
      select: { pinfl: true, fullName: true, hiredAt: true, firedAt: true, isActive: true },
    });
    const pinfls = emps.map((e) => e.pinfl);
    const heads: Record<string, number> = {};
    const fund: Record<string, number> = {};
    const per = new Map<string, { fullName: string; months: Record<string, number> }>();
    let source = '';
    if (pinfls.length) {
      // Hududda — oylik joylashuv (Natijalar fayli) bo'yicha aniq son; bo'lmasa — ishga kirish / bo'shash sanasi
      const locs =
        s.kind === 'REGION'
          ? await this.prisma.employeeLocation.findMany({ where: { period: { in: months }, regionCode: s.regionCode!, ...(s.district ? { districtId: s.district } : {}) }, select: { period: true, employeePinfl: true } })
          : [];
      const batches = await this.prisma.salaryCompositionBatch.findMany({ where: { cancelledAt: null, period: { in: months } }, select: { id: true, period: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
      const batchOf = new Map<string, string>();
      for (const b of batches) if (!batchOf.has(b.period)) batchOf.set(b.period, b.id);
      const [rows, entries] = await Promise.all([
        batchOf.size ? this.prisma.salaryCompositionRow.findMany({ where: { batchId: { in: [...batchOf.values()] }, employeePinfl: { in: pinfls } }, select: { period: true, employeePinfl: true, totalTiyin: true, batchId: true } }) : Promise.resolve([] as { period: string; employeePinfl: string; totalTiyin: bigint; batchId: string }[]),
        this.prisma.payrollEntry.findMany({ where: { deletedAt: null, period: { in: months }, employeePinfl: { in: pinfls } }, select: { period: true, employeePinfl: true, totalTiyin: true } }),
      ]);
      const name = new Map(emps.map((e) => [e.pinfl, e.fullName]));
      const fromTarkib = new Set<string>();
      for (const r of rows) {
        if (batchOf.get(r.period) !== r.batchId) continue;
        fromTarkib.add(`${r.period}|${r.employeePinfl}`);
        const x = per.get(r.employeePinfl) ?? { fullName: name.get(r.employeePinfl) ?? r.employeePinfl, months: {} };
        x.months[r.period] = (x.months[r.period] ?? 0) + som(r.totalTiyin);
        per.set(r.employeePinfl, x);
      }
      for (const r of entries) {
        if (fromTarkib.has(`${r.period}|${r.employeePinfl}`)) continue;
        const x = per.get(r.employeePinfl) ?? { fullName: name.get(r.employeePinfl) ?? r.employeePinfl, months: {} };
        x.months[r.period] = (x.months[r.period] ?? 0) + som(r.totalTiyin);
        per.set(r.employeePinfl, x);
      }
      for (const p of months) {
        const [y, m] = p.split('-').map(Number) as [number, number];
        const start = new Date(Date.UTC(y, m - 1, 1));
        const end = new Date(Date.UTC(y, m, 1));
        const byLoc = locs.filter((l) => l.period === p).length;
        const paid = [...per.values()].filter((e) => (e.months[p] ?? 0) > 0).length;
        const reg = emps.filter((e) => (!e.hiredAt || e.hiredAt < end) && (!e.firedAt || e.firedAt >= start) && (e.isActive || e.firedAt)).length;
        heads[p] = byLoc || paid || reg;
        fund[p] = [...per.values()].reduce((t, e) => t + (e.months[p] ?? 0), 0);
      }
      source =
        s.kind === 'REGION'
          ? "Xodimlar soni — oylik joylashuv (Natijalar fayli), bo'lmasa — ish haqi olganlar yoki ishga kirish / bo'shash sanasi; ish haqi — tarkib yoki ish haqi yozuvlari."
          : "Xodimlar — hozir shu bo'limga biriktirilganlar; soni — shu oy ish haqi olganlar (bo'lmasa — ishga kirish / bo'shash sanasi); ish haqi — ish haqi tarkibi, bo'lmasa — ish haqi yozuvlari.";
    } else source = "Bu bo'limga biriktirilgan xodim yo'q.";
    const list = [...per.values()]
      .map((e) => ({ ...e, total: months.reduce((t, p) => t + (e.months[p] ?? 0), 0) }))
      .filter((e) => e.total > 0)
      .sort((a, b) => b.total - a.total);
    return { heads, fund, list, source };
  }

  /** Qo'mita qoplashi — 3802 sarf hisobidan (Nazorat zanjiri bilan bir xil) */
  private async qomita(s: Scope, from: string, to: string) {
    if (!this.nazorat || !s.departmentId) return null;
    const d = await this.nazorat.sarfUnit(s.departmentId, from, to).catch(() => null);
    if (!d) return null;
    const months = d.months;
    const pool = d.kind === 'POOL';
    let bal = 0;
    const rows: Cell[][] = months.map((p) => {
      const m = d.byMonth[p]!;
      const income = som(BigInt(m.income));
      const used = som(BigInt(pool ? m.covered : m.spend));
      bal += income - used;
      return pool ? [periodLabel(p), income, used, bal] : [periodLabel(p), income, used, bal];
    });
    const income = som(BigInt(d.incomeTiyin));
    const used = som(BigInt(pool ? d.coveredTiyin : d.spendTiyin));
    const people = pool
      ? d.employees
          .filter((e) => BigInt(e.coveredTiyin) > 0n)
          .map((e) => ({ fullName: e.fullName, months: Object.fromEntries(Object.entries(e.months).map(([p, v]) => [p, som(BigInt(v.covered))])), total: som(BigInt(e.coveredTiyin)) }))
      : [];
    return {
      pool,
      kindText: pool ? '3802 hovuzi: Oklad + 40%' : "xizmat shartnomasi: to'liq sarf",
      intro: pool
        ? "3802 hovuzi: bo'limga kelgan 3802 puli va shu bo'lim xodimlarining qoplanadigan qismi (vedomost va shtat qoidasi bo'yicha). Hovuz umumiy — boshqa bo'limlar qoplashi 3802 › Qoplash va qoldiqda."
        : "Xizmat shartnomasi: Qo'mitadan kelgan pul va bo'limning to'liq sarfi (bo'lim va shu nomdagi yo'nalish xarajatlari).",
      columns: pool ? ["Qo'mitadan kelgan", '3802 qoplaydigan'] : ["Qo'mitadan kelgan", "Bo'lim sarfi"],
      rows,
      total: ['Jami', income, used, income - used] as Cell[],
      coveredTotal: used,
      people,
    };
  }

  /** O'zgarishlar: hududda — ko'chishlar (oylik joylashuv); yo'nalish — bo'limlar o'rtasida ko'chish; bo'lim — ishga kirgan / ketgan */
  private async changes(s: Scope, from: string, to: string, withPeople: boolean) {
    const who = (name: string) => (withPeople ? name : '•');
    const columns: Column[] = [{ label: 'Oy', width: 1.2 }, { label: 'Xodim', width: 2.2 }, { label: 'Nima', width: 1.4 }, { label: 'Qayerdan', width: 1.8 }, { label: 'Qayerga', width: 1.8 }];
    const rows: Cell[][] = [];
    let intro = '';
    if (s.kind === 'REGION' && this.transfers) {
      const t = await this.transfers.list({ from, to }).catch(() => null);
      for (const x of t?.transfers ?? []) {
        const inFrom = x.from.regionCode === s.regionCode && (!s.district || x.from.districtId === s.district);
        const inTo = x.to.regionCode === s.regionCode && (!s.district || x.to.districtId === s.district);
        if (!inFrom && !inTo) continue;
        const what = inTo && !inFrom ? 'kelgan' : inFrom && !inTo ? 'ketgan' : x.kinds.includes('type') ? "ish turi o'zgargan" : "ichida ko'chgan";
        const place = (p: typeof x.from) => [p.regionName, p.districtName].filter(Boolean).join(' · ');
        rows.push([x.period, who(x.fullName), what, place(x.from), place(x.to)]);
      }
      intro = "Xodim o'tkazmalari — Natijalar faylidan yozilgan oylik joylashuv bo'yicha (ketma-ket ikki oyda hudud, tuman yoki ish turi farq qilsa).";
    } else {
      // Yo'nalish / Markaz: «miya» ko'chishlari (unit.moves)
      const unitCode = s.kind === 'SEGMENT' ? s.segment : s.kind === 'DEPT' && s.segment ? s.segment : null;
      if (unitCode) {
        const raw = (await this.prisma.setting.findUnique({ where: { key: 'unit.moves' } }))?.value as { moves?: { pinfl?: string; fullName?: string; unit?: string; from?: string }[] } | null;
        const list = (raw?.moves ?? []).filter((m) => typeof m?.pinfl === 'string' && typeof m.from === 'string' && m.from >= from && m.from <= to);
        const byP = new Map<string, typeof list>();
        for (const m of raw?.moves ?? []) if (m?.pinfl) byP.set(m.pinfl, [...(byP.get(m.pinfl) ?? []), m]);
        for (const m of list) {
          const hist = (byP.get(m.pinfl!) ?? []).filter((x) => (x.from ?? '') < m.from!).sort((a, b) => (a.from ?? '').localeCompare(b.from ?? ''));
          const before = hist[hist.length - 1]?.unit ?? null;
          if (m.unit !== unitCode && before !== unitCode) continue;
          rows.push([m.from!, who(m.fullName ?? ''), m.unit === unitCode ? 'kelgan' : 'ketgan', before ? segmentLabelOrUnit(before) : '—', segmentLabelOrUnit(m.unit ?? '')]);
        }
      }
      // Ishga kirgan / bo'shagan (bo'limga biriktirilganlar)
      if (s.departmentId) {
        const start = new Date(`${from}-01T00:00:00Z`);
        const [ty, tm] = to.split('-').map(Number) as [number, number];
        const end = new Date(Date.UTC(ty, tm, 1));
        const emps = await this.prisma.employee.findMany({
          where: { departmentId: s.departmentId, OR: [{ hiredAt: { gte: start, lt: end } }, { firedAt: { gte: start, lt: end } }] },
          select: { fullName: true, hiredAt: true, firedAt: true },
        });
        for (const e of emps) {
          if (e.hiredAt && e.hiredAt >= start && e.hiredAt < end) rows.push([e.hiredAt.toISOString().slice(0, 7), who(e.fullName), 'ishga kirgan', '—', s.name]);
          if (e.firedAt && e.firedAt >= start && e.firedAt < end) rows.push([e.firedAt.toISOString().slice(0, 7), who(e.fullName), "bo'shagan", s.name, '—']);
        }
      }
      intro =
        s.kind === 'DEPT'
          ? "Ishga kirgan va bo'shaganlar (Xodimlar bazasi)" + (s.segment ? "; yo'nalishlar o'rtasidagi ko'chishlar — bo'lim «miya» tarixidan." : '. Markaz bo‘limlari o‘rtasidagi ko‘chish tarixi tizimda yuritilmaydi.')
          : "Bo'limlar o'rtasidagi ko'chishlar (bo'lim «miya» tarixi) va ishga kirgan / bo'shaganlar.";
    }
    // Sana bo'yicha (YYYY-MM), keyin — oy nomi
    rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    for (const r of rows) r[0] = periodLabel(String(r[0]));
    const came = rows.filter((r) => r[2] === 'kelgan' || r[2] === 'ishga kirgan').length;
    const left = rows.filter((r) => r[2] === 'ketgan' || r[2] === "bo'shagan").length;
    return { columns, rows, intro, summary: rows.length ? `Davrda: kelgan ${came}, ketgan ${left}${rows.length - came - left ? `, boshqa o'zgarish ${rows.length - came - left}` : ''}.` : '' };
  }
}

function segmentLabelOrUnit(code: string): string {
  if (code === 'CENTER') return 'Markaz';
  if (code === 'REGION') return 'Hududlar';
  return segmentLabel(code);
}
