import { Injectable } from '@nestjs/common';
import { controlBreached, ControlsService } from '../reactions/controls.service';
import { ReactionMetrics } from '../reactions/reactions.metrics';
import type { ControlView, ItemKind } from '../reactions/reactions.types';
import { monthsOf, rangeText, ReportData, todayIso, type Range } from './reports.data';
import { fmtPct, fmtSom, periodLabel, periodShort, safeFile, uzDate } from './reports.format';
import type { Cell, Column, ReportDoc, ReportParams, ReportSection, Tone } from './reports.types';

// ═══════════════════════════════════════════════════════════
// Nazorat hisoboti: har bir nazorat moddasi — joriy holat, tanlangan davr oylari
// bo'yicha chegara bilan solishtirish, buzilishlar ro'yxati va keyingi 3 oy prognozi.
// Hisob Nazorat bo'limi bilan bir xil: oylik summa (ReactionMetrics.monthly),
// buzilish qoidasi (controlBreached), holat va prognoz (ControlsService).
// ═══════════════════════════════════════════════════════════

const KIND_LABEL: Record<ItemKind, string> = { INCOME: 'Daromad', EXPENSE: 'Xarajat', RESULT: 'Natija' };
const STATUS_LABEL: Record<ControlView['status'], string> = { ok: "Me'yorda", risk: 'Xavf ostida', breach: 'Buzilgan', nodata: "To'xtatilgan" };
const STATUS_TONES: Record<string, Tone> = { "Me'yorda": 'good', 'Xavf ostida': 'warn', Buzilgan: 'bad', "To'xtatilgan": 'neutral' };
const RELIABILITY: Record<string, string> = { high: 'Ishonchli', medium: "O'rtacha", low: 'Taxminiy', none: "Ma'lumot kam" };
/** Oylar jadvalidagi eng ko'p ustunlar */
const MAX_MONTH_COLUMNS = 12;

const som = (tiyin: string | number | bigint) => Number(tiyin) / 100;

interface Breach {
  control: ControlView;
  period: string;
  value: number;
  limit: number;
}

interface Row {
  c: ControlView;
  values: number[];
  checked: number;
  breaches: number;
}

@Injectable()
export class ControlsReport {
  constructor(
    private readonly data: ReportData,
    private readonly controls: ControlsService,
    private readonly metrics: ReactionMetrics,
  ) {}

  async build(params: ReportParams): Promise<ReportDoc> {
    const range: Range = this.data.parseRange(params.from, params.to);
    const labels = await this.data.labels();
    const unit = this.data.checkUnit(params.unit, labels);
    const unitName = labels.units.get(unit) ?? unit;

    const today = todayIso();
    const currentPeriod = today.slice(0, 7);
    // Joriy oy hali tugamagan (oxirgi kuni ham) — Nazorat bo'limi qoidasi bilan bir xil
    const partialCurrent = true;
    const months = monthsOf(range).filter((p) => p <= currentPeriod);

    const all = (await this.controls.list()).filter((c) => unit === 'all' || c.filter.unit === unit);
    const active = all.filter((c) => c.isActive);
    const stopped = all.filter((c) => !c.isActive);

    // Davr oylari bo'yicha qiymatlar va buzilishlar (Nazorat bo'limi qoidasi bilan)
    const rows: Row[] = [];
    const breaches: Breach[] = [];
    for (const c of active) {
      const raw = months.length ? await this.metrics.monthly(c.kind, c.filter, months) : [];
      const values = raw.map(som);
      let checked = 0;
      let count = 0;
      months.forEach((p, i) => {
        const partial = p === currentPeriod && partialCurrent;
        if (p < c.startPeriod || partial) return;
        checked += 1;
        if (controlBreached(c.kind, raw[i]!, BigInt(c.limitTiyin))) {
          count += 1;
          breaches.push({ control: c, period: p, value: values[i]!, limit: som(c.limitTiyin) });
        }
      });
      rows.push({ c, values, checked, breaches: count });
    }

    const sections: ReportSection[] = [];
    const scope = unit === 'all' ? 'Butun korxona' : unitName;
    const meta = [
      `Davr: ${rangeText(range)} — nazorat oylik, shu davrga tegishli ${months.length} oy to'liq olinadi${months.includes(currentPeriod) && partialCurrent ? ` (${periodLabel(currentPeriod)} hali tugamagan — tekshirilmaydi)` : ''}`,
      `Qamrov: ${scope}; holat sanasi ${uzDate(today)}`,
      'Buzilish: xarajat chegaradan oshsa, daromad yoki natija rejadan kam bo\'lsa. Oylar nazorat boshlangan oydan tekshiriladi; hozirgi chegara ishlatiladi',
      'Manba: Nazorat bo\'limi; summalar Daromadlar va Xarajatlar bo\'limlaridan',
    ];
    const fileBase = safeFile(`Nazorat hisoboti - ${unit === 'all' ? '' : `${unitName} - `}${range.from}_${range.to}`);
    const generatedAt = new Date(Date.now() + 5 * 3600_000).toISOString();

    if (!active.length) {
      const text = stopped.length ? `Faol nazorat yo'q (${stopped.length} tasi to'xtatilgan).` : "Nazoratga qo'yilgan modda yo'q.";
      sections.push({ title: 'Bir qarashda', blocks: [{ type: 'notes', items: [text] }] });
      return { kind: 'Nazorat hisoboti', title: 'Nazorat hisoboti', subtitle: `${scope} · ${rangeText(range)}`, meta, highlights: [text], sections, fileBase, generatedAt };
    }

    const breached = active.filter((c) => c.status === 'breach');
    const risk = active.filter((c) => c.status === 'risk');
    const ok = active.filter((c) => c.status === 'ok');
    const checkedTotal = rows.reduce((s, r) => s + r.checked, 0);
    const nextRisky = active.filter((c) => (c.outlook?.months[0]?.breachProbability ?? 0) >= 0.6);

    // ─────────── 1. Bir qarashda ───────────
    sections.push({
      title: 'Bir qarashda',
      intro: `${scope}: ${active.length} ta faol nazorat${stopped.length ? `, ${stopped.length} tasi to'xtatilgan` : ''}.`,
      blocks: [
        {
          type: 'kpis',
          items: [
            { label: 'Hozir buzilgan', value: `${breached.length} ta`, sub: `${active.length} ta faol nazoratdan`, tone: breached.length ? 'bad' : 'good' },
            { label: 'Xavf ostida', value: `${risk.length} ta`, sub: `me'yorda ${ok.length} ta`, tone: risk.length ? 'warn' : 'neutral' },
            { label: 'Davrda buzilishlar', value: `${breaches.length} ta oy`, sub: `${checkedTotal} ta tekshirilgan oydan`, tone: breaches.length ? 'bad' : 'good' },
            { label: 'Keyingi oy xavfi', value: `${nextRisky.length} ta`, sub: 'buzish ehtimoli 60% va undan yuqori', tone: nextRisky.length ? 'warn' : 'neutral' },
          ],
        },
      ],
    });

    // ─────────── 2. Joriy holat ───────────
    const name = (c: ControlView) => c.label;
    const origin = (c: ControlView) => (c.reactionTitle ? `Munosabat: ${c.reactionTitle}` : c.title !== c.label ? c.title : "Qo'lda");
    const statusRows = [...rows].sort((a, b) => order(a.c) - order(b.c) || b.breaches - a.breaches || name(a.c).localeCompare(name(b.c)));
    sections.push({
      title: 'Joriy holat',
      intro: `Joriy oy (${periodLabel(currentPeriod)}) — oy oxirigacha sur'at bo'yicha taxmin: hozirgacha yozilgan ÷ o'tgan kunlar × oydagi kunlar. Keyingi oy — prognoz (Katta modellar yadrosi).`,
      blocks: [
        {
          type: 'table',
          columns: [
            { label: 'Nazorat moddasi', width: 2.4 },
            { label: 'Turi', width: 0.7 },
            { label: 'Oylik chegara', format: 'money' },
            { label: 'Joriy oy (taxmin)', format: 'money' },
            { label: 'Chegaraga nisbatan', format: 'pct', width: 0.8 },
            { label: 'Holat', width: 0.9, tones: STATUS_TONES },
            { label: 'Davrda buzilgan', width: 0.8 },
            { label: 'Keyingi oy (kutilgan)', format: 'money' },
            { label: 'Buzish ehtimoli', format: 'pct', width: 0.8 },
          ],
          rows: statusRows.map(({ c, checked, breaches: n }) => {
            const cur = c.current ? som(c.current.projectedTiyin ?? c.current.valueTiyin) : null;
            const next = c.outlook?.months[0];
            return [
              name(c),
              KIND_LABEL[c.kind],
              som(c.limitTiyin),
              cur,
              c.usagePercent,
              STATUS_LABEL[c.status],
              checked ? `${n} / ${checked}` : '—',
              next ? som(next.meanTiyin) : null,
              next ? Math.round(next.breachProbability * 1000) / 10 : null,
            ] as Cell[];
          }),
          note: "Xarajat uchun chegara — eng ko'pi, daromad va natija uchun — eng kami (reja). «Davrda buzilgan» — buzilgan oylar / tekshirilgan oylar.",
        },
      ],
    });

    // ─────────── 3. Chegaraga nisbatan (grafik) ───────────
    const usage = statusRows.filter((r) => r.c.usagePercent !== null);
    if (usage.length >= 2) {
      sections.push({
        title: 'Chegaraga nisbatan',
        intro: "Joriy oy taxmini chegaraning necha foizi. Xarajat uchun 100% dan yuqori — buzilish; daromad va natija uchun 100% dan past — reja bajarilmaydi.",
        blocks: [
          {
            type: 'chart',
            title: 'Joriy oy: chegaraga nisbatan',
            kind: 'barh',
            unit: '%',
            labels: usage.map((r) => name(r.c)),
            series: [{ name: 'Chegaraga nisbatan', values: usage.map((r) => r.c.usagePercent!) }],
          },
        ],
      });
    }

    // ─────────── 4. Oylar bo'yicha ───────────
    if (months.length) {
      const shown = months.slice(-MAX_MONTH_COLUMNS);
      const offset = months.length - shown.length;
      const monthColumns: Column[] = shown.map((p) => ({ label: `${periodShort(p)}${p === currentPeriod && partialCurrent ? '*' : ''}`, format: 'mln', width: 0.7 }));
      sections.push({
        title: "Oylar bo'yicha",
        intro: `Oylik summa, mln so'm${months.includes(currentPeriod) && partialCurrent ? '; * — joriy oy, hozirgacha yozilgan' : ''}.${offset ? ` Davrning oxirgi ${shown.length} oyi ko'rsatildi (buzilishlar ro'yxatida — hammasi).` : ''}`,
        blocks: [
          {
            type: 'table',
            columns: [{ label: 'Nazorat moddasi', width: 2.2 }, { label: 'Chegara', format: 'mln', width: 0.75 }, ...monthColumns],
            rows: statusRows.map((r) => [name(r.c), som(r.c.limitTiyin), ...r.values.slice(offset)]),
          },
        ],
      });
    }

    // ─────────── 5. Buzilishlar ───────────
    if (breaches.length) {
      const sorted = [...breaches].sort((a, b) => a.period.localeCompare(b.period) || name(a.control).localeCompare(name(b.control)));
      sections.push({
        title: 'Buzilishlar',
        intro: `Davrda ${breaches.length} ta buzilish (${new Set(breaches.map((b) => b.control.id)).size} ta moddada).`,
        blocks: [
          {
            type: 'table',
            columns: [
              { label: 'Nazorat moddasi', width: 2.4 },
              { label: 'Oy', width: 0.9 },
              { label: 'Haqiqiy', format: 'money' },
              { label: 'Chegara', format: 'money' },
              { label: 'Farq', format: 'money', toneBy: 'down' },
              { label: 'Farq, %', format: 'pct', width: 0.7 },
            ],
            rows: sorted.map((b) => {
              // Farq — chegaradan qanchaga chiqqani (har doim musbat)
              const gap = b.control.kind === 'EXPENSE' ? b.value - b.limit : b.limit - b.value;
              return [name(b.control), periodLabel(b.period), b.value, b.limit, gap, b.limit !== 0 ? (gap / Math.abs(b.limit)) * 100 : null];
            }),
            note: 'Farq: xarajat uchun — chegaradan ortiq sarflangan, daromad va natija uchun — rejadan kam tushgan summa.',
          },
        ],
      });
    }

    // ─────────── 6. Prognoz ───────────
    const withOutlook = statusRows.filter((r) => r.c.outlook && r.c.outlook.months.length);
    if (withOutlook.length) {
      const periods = withOutlook[0]!.c.outlook!.months.map((m) => m.period);
      const columns: Column[] = [{ label: 'Nazorat moddasi', width: 2.2 }, { label: 'Chegara', format: 'money' }];
      for (const p of periods) columns.push({ label: `${periodShort(p)}: kutilgan`, format: 'money' }, { label: 'ehtimol', format: 'pct', width: 0.6 });
      columns.push({ label: 'Ishonchlilik', width: 0.8 });
      sections.push({
        title: 'Prognoz: keyingi 3 oy',
        intro: "Kutilgan oylik summa va chegarani buzish ehtimoli (simulyatsiya). Taxminiy prognozlar holatga ta'sir qilmaydi.",
        blocks: [
          {
            type: 'table',
            columns,
            rows: withOutlook.map(({ c }) => {
              const o = c.outlook!;
              const cells: Cell[] = [name(c), som(c.limitTiyin)];
              for (const p of periods) {
                const m = o.months.find((x) => x.period === p);
                cells.push(m ? som(m.meanTiyin) : null, m ? Math.round(m.breachProbability * 1000) / 10 : null);
              }
              cells.push(RELIABILITY[o.reliability] ?? o.reliability);
              return cells;
            }),
          },
        ],
      });
    }

    // ─────────── 7. Xulosa va tavsiyalar ───────────
    const notes: string[] = [];
    for (const c of breached) notes.push(`«${name(c)}»: ${c.statusText}.`);
    for (const c of risk) notes.push(`«${name(c)}»: ${c.statusText}.`);
    const repeated = rows.filter((r) => r.breaches >= 2).sort((a, b) => b.breaches - a.breaches);
    for (const r of repeated.slice(0, 5)) {
      const suggestion = r.c.forecastSuggestedTiyin ? ` Prognoz bo'yicha keyingi 3 oy o'rtachasi ${fmtSom(som(r.c.forecastSuggestedTiyin))}.` : '';
      notes.push(`«${name(r.c)}» davrda ${r.breaches} marta buzilgan (${r.checked} oydan) — sababini aniqlash yoki chegarani (${fmtSom(som(r.c.limitTiyin))}) qayta ko'rib chiqish kerak.${suggestion}`);
    }
    for (const c of nextRisky.filter((c) => c.status === 'ok')) {
      const m = c.outlook!.months[0]!;
      notes.push(`«${name(c)}»: ${periodLabel(m.period)} oyida buzish ehtimoli ${fmtPct(m.breachProbability * 100, 0)} (kutilgan ${fmtSom(som(m.meanTiyin))}, prognoz ${RELIABILITY[c.outlook!.reliability]?.toLowerCase()}).`);
    }
    const noOwner = active.filter((c) => c.assignees.length === 0);
    if (noOwner.length) notes.push(`Mas'ul biriktirilmagan: ${noOwner.slice(0, 6).map((c) => `«${name(c)}»`).join(', ')}${noOwner.length > 6 ? ` va yana ${noOwner.length - 6} ta` : ''}.`);
    if (stopped.length) notes.push(`To'xtatilgan nazoratlar (hisobda qatnashmaydi): ${stopped.map((c) => `«${name(c)}»`).join(', ')}.`);
    if (!notes.length) notes.push("Barcha nazoratlar me'yorda: davrda buzilish yo'q, keyingi oy uchun yuqori xavf aniqlanmadi.");
    sections.push({ title: 'Xulosa va tavsiyalar', blocks: [{ type: 'notes', items: notes }] });

    // Nazoratlar ro'yxati (manba va mas'ullar)
    sections.push({
      title: "Nazoratlar ro'yxati",
      blocks: [
        {
          type: 'table',
          columns: [
            { label: 'Nazorat moddasi', width: 2.2 },
            { label: 'Manba', width: 1.8 },
            { label: 'Boshlangan', width: 1 },
            { label: "Mas'ullar", width: 2 },
            { label: 'Izoh', width: 2 },
          ],
          rows: statusRows.map(({ c }) => [name(c), origin(c), periodLabel(c.startPeriod), c.assignees.map((a) => a.fullName).join(', ') || '—', c.note ?? '—']),
        },
      ],
    });

    const highlights = [
      `${scope}: ${active.length} ta faol nazorat — hozir buzilgan ${breached.length}, xavf ostida ${risk.length}, me'yorda ${ok.length}.`,
      breaches.length
        ? `${rangeText(range)} davrida ${breaches.length} ta buzilish (${checkedTotal} ta tekshirilgan oydan); eng ko'p — «${name(repeated[0]?.c ?? breaches[0]!.control)}».`
        : `${rangeText(range)} davrida buzilish yo'q (${checkedTotal} ta tekshirilgan oy).`,
      ...(nextRisky.length ? [`Keyingi oyda buzish ehtimoli yuqori: ${nextRisky.slice(0, 4).map((c) => `«${name(c)}»`).join(', ')}.`] : []),
      ...notes.slice(0, 3),
    ];

    return {
      kind: 'Nazorat hisoboti',
      title: 'Nazorat hisoboti',
      subtitle: `${scope} · ${rangeText(range)}`,
      meta,
      highlights: [...new Set(highlights)].slice(0, 6),
      sections,
      fileBase,
      generatedAt,
    };
  }
}

function order(c: ControlView): number {
  return c.status === 'breach' ? 0 : c.status === 'risk' ? 1 : c.status === 'ok' ? 2 : 3;
}