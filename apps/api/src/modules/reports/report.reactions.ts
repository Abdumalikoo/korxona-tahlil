import { BadRequestException, Injectable } from '@nestjs/common';
import { ReactionsService } from '../reactions/reactions.service';
import type { ItemEvaluation, ItemKind, ReactionDetail, ReactionSummary, Verdict } from '../reactions/reactions.types';
import { mln } from './report.common';
import { rangeText, ReportData, todayIso, type Range } from './reports.data';
import { fmtSom, fmtSignedPct, periodShort, safeFile, signedSom, uzDate } from './reports.format';
import type { Cell, Column, ReportDoc, ReportParams, ReportSection, TableBlock, Tone } from './reports.types';

// ═══════════════════════════════════════════════════════════
// Munosabatlar hisoboti.
//  • Munosabat tanlanmasa — yig'ma: davrga to'g'ri keladigan barcha munosabatlar,
//    holati, ta'siri, mas'ullar va har birining moddalari.
//  • Bitta munosabat tanlansa — batafsil: moddalar, oylar, yirik yozuvlar, mas'ullar.
// Barcha raqamlar Munosabat bo'limidagi bilan bir xil hisoblanadi (ReactionsService).
// ═══════════════════════════════════════════════════════════

const KIND_LABEL: Record<ItemKind, string> = { INCOME: 'Daromad', EXPENSE: 'Xarajat', RESULT: 'Natija' };
const VERDICT_LABEL: Record<Verdict, string> = { better: 'Yaxshilandi', worse: 'Yomonlashdi', same: "O'zgarishsiz", nodata: 'Boshlanmagan' };
const VERDICT_TONES: Record<string, Tone> = { Yaxshilandi: 'good', Yomonlashdi: 'bad', "O'zgarishsiz": 'neutral', Boshlanmagan: 'neutral' };
const STATUS_TONES: Record<string, Tone> = { Kuzatilmoqda: 'neutral', "Muddati o'tgan": 'bad', Nazoratda: 'good', Yopilgan: 'neutral' };
/** Yig'mada batafsil ko'rsatiladigan eng ko'p munosabatlar */
const MAX_DETAILS = 25;

const som = (tiyin: string | number) => Number(tiyin) / 100;

function statusText(r: ReactionSummary): string {
  if (r.status === 'CLOSED') return 'Yopilgan';
  if (r.status === 'CONTROL') return 'Nazoratda';
  return r.overdue ? "Muddati o'tgan" : 'Kuzatilmoqda';
}

/** Moddaning natijaga ta'siri: xarajat kamaysa va daromad/natija oshsa — musbat */
function gainOf(item: ItemEvaluation): number {
  const effect = som(item.effectTiyin);
  return item.kind === 'EXPENSE' ? -effect : effect;
}

/** O'zgarish foizi rangi: xarajat uchun kamayish yaxshi; "o'zgarishsiz" rangsiz */
function directionOf(item: ItemEvaluation): 'up' | 'down' | null {
  if (item.verdict === 'same' || item.verdict === 'nodata') return null;
  return item.kind === 'EXPENSE' ? 'down' : 'up';
}

function itemsTable(items: ItemEvaluation[], withTotal: boolean): TableBlock {
  const columns: Column[] = [
    { label: 'Modda', width: 2.6 },
    { label: 'Turi', width: 0.8 },
    { label: 'Baza, kuniga', format: 'money' },
    { label: 'Kuzatuv, kuniga', format: 'money' },
    { label: "O'zgarish", format: 'signedPct', toneBy: 'row', width: 0.8 },
    { label: "Kutilgan (baza sur'atida)", format: 'money' },
    { label: 'Haqiqiy', format: 'money' },
    { label: "Natijaga ta'siri", format: 'money', toneBy: 'up' },
    { label: 'Holat', width: 1.1, tones: VERDICT_TONES },
  ];
  const gain = items.reduce((s, i) => s + gainOf(i), 0);
  return {
    type: 'table',
    columns,
    rows: items.map((i) => [
      i.label,
      KIND_LABEL[i.kind],
      som(i.base.perDayTiyin),
      i.track.days > 0 ? som(i.track.perDayTiyin) : null,
      i.changePercent,
      i.track.days > 0 ? som(i.expectedTiyin) : null,
      i.track.days > 0 ? som(i.track.sumTiyin) : null,
      i.track.days > 0 ? gainOf(i) : null,
      VERDICT_LABEL[i.verdict],
    ]),
    rowTone: items.map(directionOf),
    ...(withTotal && items.length > 1 ? { total: ['Jami', null, null, null, null, null, null, gain, null] as Cell[] } : {}),
    note: "Kutilgan — belgilashdan oldingi (baza) kunlik sur'at × kuzatuv kunlari. Natijaga ta'siri: xarajat uchun kutilgan − haqiqiy (tejalgan), daromad va natija uchun haqiqiy − kutilgan.",
  };
}

@Injectable()
export class ReactionsSummaryReport {
  constructor(
    private readonly data: ReportData,
    private readonly reactions: ReactionsService,
  ) {}

  async build(params: ReportParams): Promise<ReportDoc> {
    if (params.subject) {
      if (!/^[\w-]{1,64}$/.test(params.subject)) throw new BadRequestException("Munosabat noto'g'ri tanlangan");
      return this.single(await this.reactions.detail(params.subject, true));
    }
    return this.summary(this.data.parseRange(params.from, params.to));
  }

  // ═══════════════════════════════════════════════════════════
  // Yig'ma
  // ═══════════════════════════════════════════════════════════

  private async summary(range: Range): Promise<ReportDoc> {
    const today = todayIso();
    const order = (r: ReactionSummary) => (r.status === 'OPEN' ? (r.overdue ? 0 : 1) : r.status === 'CONTROL' ? 2 : 3);
    const list = (await this.reactions.list())
      .filter((r) => r.startDate <= range.to && r.dueDate >= range.from)
      .sort((a, b) => order(a) - order(b) || a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title));

    const sections: ReportSection[] = [];
    const meta = [
      `Davr: ${rangeText(range)} — kuzatuv muddati shu davrga to'g'ri keladigan munosabatlar`,
      `Ta'sir har bir munosabatning o'z kuzatuv davri bo'yicha (boshlanishdan bugungacha, muddat o'tgan bo'lsa — muddatgacha) hisoblangan; holat: ${uzDate(today)}`,
      'Manba: Munosabat bo\'limi; summalar Daromadlar va Xarajatlar bo\'limlaridan',
    ];
    const fileBase = safeFile(`Munosabatlar yig'masi - ${range.from}_${range.to}`);
    const generatedAt = new Date(Date.now() + 5 * 3600_000).toISOString();

    if (!list.length) {
      sections.push({ title: 'Bir qarashda', blocks: [{ type: 'notes', items: [`${rangeText(range)} davrida kuzatilgan munosabat yo'q.`] }] });
      return {
        kind: 'Munosabatlar hisoboti',
        title: "Munosabatlar yig'masi",
        subtitle: rangeText(range),
        meta,
        highlights: [`${rangeText(range)} davrida kuzatilgan munosabat yo'q.`],
        sections,
        fileBase,
        generatedAt,
      };
    }

    const details: ReactionDetail[] = [];
    for (const r of list.slice(0, MAX_DETAILS)) details.push(await this.reactions.detail(r.id, false));
    const allItems = details.flatMap((d) => d.items.map((item) => ({ item, reaction: d })));

    const open = list.filter((r) => r.status === 'OPEN');
    const overdue = open.filter((r) => r.overdue);
    const control = list.filter((r) => r.status === 'CONTROL');
    const closed = list.filter((r) => r.status === 'CLOSED');
    const gain = list.reduce((s, r) => s + som(r.gainTiyin), 0);
    const better = list.reduce((s, r) => s + r.better, 0);
    const worse = list.reduce((s, r) => s + r.worse, 0);
    const same = list.reduce((s, r) => s + r.same, 0);
    const itemCount = list.reduce((s, r) => s + r.itemCount, 0);
    const unassigned = list.filter((r) => r.assignees.length === 0);

    // ─────────── 1. Bir qarashda ───────────
    sections.push({
      title: 'Bir qarashda',
      intro: `${rangeText(range)}: ${list.length} ta munosabat.`,
      blocks: [
        {
          type: 'kpis',
          items: [
            { label: 'Munosabatlar', value: `${list.length} ta`, sub: `ochiq ${open.length}, nazoratda ${control.length}, yopilgan ${closed.length}` },
            { label: "Muddati o'tgan", value: `${overdue.length} ta`, sub: overdue.length ? 'ochiq, lekin muddati tugagan' : "muddati o'tgani yo'q", tone: overdue.length ? 'bad' : 'good' },
            { label: 'Moddalar', value: `${itemCount} ta`, sub: `yaxshilandi ${better}, yomonlashdi ${worse}, o'zgarmadi ${same}`, tone: worse > better ? 'bad' : better > 0 ? 'good' : 'neutral' },
            { label: "Umumiy ta'sir", value: signedSom(gain), sub: "tejalgan xarajat + qo'shimcha daromad", tone: gain > 0 ? 'good' : gain < 0 ? 'bad' : 'neutral' },
          ],
        },
      ],
    });

    // ─────────── 2. Ro'yxat ───────────
    sections.push({
      title: "Munosabatlar ro'yxati",
      blocks: [
        {
          type: 'table',
          columns: [
            { label: 'Munosabat', width: 2.3 },
            { label: 'Holat', width: 1.1, tones: STATUS_TONES },
            { label: 'Boshlanish', width: 1 },
            { label: 'Muddat', width: 1 },
            { label: 'Qoldi, kun', format: 'int', width: 0.75 },
            { label: 'Moddalar', format: 'int', width: 0.9 },
            { label: 'Yaxshi', format: 'int', width: 0.75 },
            { label: 'Yomon', format: 'int', width: 0.75 },
            { label: "Ta'sir", format: 'money', toneBy: 'up', width: 1.2 },
            { label: "Mas'ullar", width: 1.6 },
          ],
          rows: list.map((r) => [
            r.title,
            statusText(r),
            uzDate(r.startDate),
            uzDate(r.dueDate),
            r.status === 'OPEN' ? r.daysLeft : null,
            r.itemCount,
            r.better,
            r.worse,
            som(r.gainTiyin),
            r.assignees.map((a) => a.fullName).join(', ') || '—',
          ]),
          total: ['Jami', null, null, null, null, itemCount, better, worse, gain, null],
        },
      ],
    });

    // ─────────── 3. Ta'sir grafigi ───────────
    const withGain = list.filter((r) => Number(r.gainTiyin) !== 0).sort((a, b) => Number(b.gainTiyin) - Number(a.gainTiyin));
    if (withGain.length >= 2) {
      sections.push({
        title: "Ta'sir bo'yicha",
        intro: "Har bir munosabatning natijaga ta'siri: musbat — yaxshilangan, manfiy — yomonlashgan.",
        blocks: [
          {
            type: 'chart',
            title: "Natijaga ta'siri",
            kind: 'barh',
            unit: "mln so'm",
            labels: withGain.slice(0, 20).map((r) => r.title),
            series: [{ name: "Ta'sir", values: withGain.slice(0, 20).map((r) => mln(som(r.gainTiyin))) }],
          },
        ],
      });
    }

    // ─────────── 4. Mas'ullar ───────────
    const people = new Map<string, { name: string; position: string | null; count: number; open: number; overdue: number; gain: number }>();
    for (const r of list) {
      for (const a of r.assignees) {
        const p = people.get(a.pinfl) ?? { name: a.fullName, position: a.position, count: 0, open: 0, overdue: 0, gain: 0 };
        p.count += 1;
        if (r.status === 'OPEN') p.open += 1;
        if (r.overdue) p.overdue += 1;
        p.gain += som(r.gainTiyin);
        people.set(a.pinfl, p);
      }
    }
    if (people.size) {
      sections.push({
        title: "Mas'ullar",
        blocks: [
          {
            type: 'table',
            columns: [
              { label: 'F.I.Sh.', width: 2.2 },
              { label: 'Lavozim', width: 2 },
              { label: 'Munosabatlar', format: 'int', width: 0.9 },
              { label: 'Ochiq', format: 'int', width: 0.7 },
              { label: "Muddati o'tgan", format: 'int', width: 0.9 },
              { label: "Ta'sir", format: 'money', toneBy: 'up' },
            ],
            rows: [...people.values()].sort((a, b) => b.overdue - a.overdue || b.count - a.count || a.name.localeCompare(b.name)).map((p) => [p.name, p.position ?? '—', p.count, p.open, p.overdue, p.gain]),
            note: "Bir munosabatda bir necha mas'ul bo'lsa, uning ta'siri har biriga to'liq yoziladi — shuning uchun bu ustun jami qo'shilmaydi.",
          },
        ],
      });
    }

    // ─────────── 5. Har bir munosabat ───────────
    for (const d of details) {
      const who = d.assignees.length ? d.assignees.map((a) => `${a.fullName} (${a.role})`).join(', ') : "mas'ul biriktirilmagan";
      sections.push({
        title: d.title,
        intro: `${statusText(d)} · kuzatuv ${uzDate(d.startDate)} – ${uzDate(d.dueDate)} (${d.daysPassed}/${d.daysTotal} kun) · baza ${uzDate(d.baseFrom)} – ${uzDate(d.baseTo)} · ${who}`,
        blocks: [itemsTable(d.items, true), { type: 'notes', items: d.conclusions }],
      });
    }
    if (list.length > MAX_DETAILS) {
      sections.push({ title: 'Qolgan munosabatlar', blocks: [{ type: 'notes', items: [`Yana ${list.length - MAX_DETAILS} ta munosabat faqat ro'yxatda ko'rsatildi. Har birini alohida tanlab batafsil hisobot olish mumkin.`] }] });
    }

    // ─────────── 6. Xulosa va tavsiyalar ───────────
    const advice: string[] = [];
    for (const r of overdue) {
      advice.push(
        r.worse > 0
          ? `«${r.title}»: muddat ${uzDate(r.dueDate)} da tugagan, ${r.worse} ta modda yomonlashgan — Nazoratga o'tkazib, oylik chegara qo'yish tavsiya etiladi.`
          : `«${r.title}»: muddat ${uzDate(r.dueDate)} da tugagan, moddalar yomonlashmagan — yopish yoki natijani saqlash uchun Nazoratga o'tkazish mumkin.`,
      );
    }
    const soon = open.filter((r) => !r.overdue && r.daysLeft <= 7);
    if (soon.length) advice.push(`Muddati 7 kun ichida tugaydi: ${soon.map((r) => `«${r.title}» (${r.daysLeft} kun)`).join(', ')}.`);
    if (unassigned.length) advice.push(`Mas'ul biriktirilmagan: ${unassigned.map((r) => `«${r.title}»`).join(', ')}.`);
    const worst = allItems.filter((x) => x.item.verdict === 'worse').sort((a, b) => gainOf(a.item) - gainOf(b.item)).slice(0, 3);
    for (const x of worst) advice.push(`E'tibor talab qiladi — «${x.item.label}» («${x.reaction.title}»): ${x.item.verdictText.toLowerCase()}, ta'siri ${signedSom(gainOf(x.item))}.`);
    const best = allItems.filter((x) => x.item.verdict === 'better').sort((a, b) => gainOf(b.item) - gainOf(a.item)).slice(0, 3);
    for (const x of best) advice.push(`Yaxshi natija — «${x.item.label}» («${x.reaction.title}»): ${x.item.verdictText.toLowerCase()}, ta'siri ${signedSom(gainOf(x.item))}.`);
    if (!advice.length) advice.push("Jiddiy muammo yo'q: muddati o'tgan yoki yomonlashgan munosabat aniqlanmadi.");
    sections.push({ title: 'Xulosa va tavsiyalar', blocks: [{ type: 'notes', items: advice }] });

    const highlights = [
      `${rangeText(range)}: ${list.length} ta munosabat — ochiq ${open.length}${overdue.length ? ` (${overdue.length} tasining muddati o'tgan)` : ''}, nazoratda ${control.length}, yopilgan ${closed.length}.`,
      `${itemCount} ta moddadan ${better} tasi yaxshilandi, ${worse} tasi yomonlashdi, ${same} tasi o'zgarmadi.`,
      gain !== 0 ? `Umumiy ta'sir: ${signedSom(gain)} (${gain > 0 ? "tejalgan xarajat va qo'shimcha daromad" : 'vaziyat avvalgidan yomonlashgan'}).` : "Umumiy ta'sir hozircha nolga teng.",
      ...advice.slice(0, 3),
    ];

    return {
      kind: 'Munosabatlar hisoboti',
      title: "Munosabatlar yig'masi",
      subtitle: rangeText(range),
      meta,
      highlights: highlights.slice(0, 6),
      sections,
      fileBase,
      generatedAt,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Bitta munosabat — batafsil
  // ═══════════════════════════════════════════════════════════

  private single(d: ReactionDetail): ReportDoc {
    const today = todayIso();
    const gain = som(d.gainTiyin);
    const sections: ReportSection[] = [];

    sections.push({
      title: 'Umumiy holat',
      intro: `Kuzatuv ${uzDate(d.startDate)} – ${uzDate(d.dueDate)}; baza (belgilashdan oldingi teng davr) ${uzDate(d.baseFrom)} – ${uzDate(d.baseTo)}.`,
      blocks: [
        {
          type: 'kpis',
          items: [
            { label: 'Holat', value: statusText(d), sub: d.status === 'OPEN' && !d.overdue ? `muddatgacha ${d.daysLeft} kun` : `muddat ${uzDate(d.dueDate)}`, tone: STATUS_TONES[statusText(d)] ?? 'neutral' },
            { label: 'Kuzatuv', value: `${d.daysPassed} / ${d.daysTotal} kun`, sub: `${uzDate(d.startDate)} dan` },
            { label: 'Moddalar', value: `${d.itemCount} ta`, sub: `yaxshilandi ${d.better}, yomonlashdi ${d.worse}, o'zgarmadi ${d.same}`, tone: d.worse > d.better ? 'bad' : d.better > 0 ? 'good' : 'neutral' },
            { label: "Umumiy ta'sir", value: signedSom(gain), sub: "tejalgan xarajat + qo'shimcha daromad", tone: gain > 0 ? 'good' : gain < 0 ? 'bad' : 'neutral' },
          ],
        },
        { type: 'notes', title: 'Xulosalar', items: d.conclusions },
        {
          type: 'table',
          title: "Ma'lumot",
          columns: [{ label: "Ko'rsatkich", width: 1.2 }, { label: 'Qiymat', width: 3.8 }],
          rows: [
            ['Kuzatuv davri', `${uzDate(d.startDate)} – ${uzDate(d.dueDate)} (${d.daysTotal} kun; o'tdi ${d.daysPassed}, qoldi ${d.daysLeft})`],
            ['Solishtirish bazasi', `${uzDate(d.baseFrom)} – ${uzDate(d.baseTo)}`],
            ["Mas'ullar", d.assignees.length ? d.assignees.map((a) => `${a.fullName}${a.position ? ` (${a.position})` : ''} — ${a.role}`).join('; ') : 'Biriktirilmagan'],
            ["Nazoratga o'tkazilgan", d.controlCount ? `${d.controlCount} ta modda` : "Yo'q"],
            ['Izoh', d.note ?? '—'],
          ],
        },
      ],
    });

    const items: TableBlock = itemsTable(d.items, true);
    const blocks: ReportSection['blocks'] = [items];
    const withGain = d.items.filter((i) => i.track.days > 0);
    if (withGain.length >= 2) {
      blocks.push({
        type: 'chart',
        title: "Moddalar: natijaga ta'siri",
        kind: 'barh',
        unit: "mln so'm",
        labels: withGain.map((i) => i.label),
        series: [{ name: "Ta'sir", values: withGain.map((i) => mln(gainOf(i))) }],
      });
    }
    blocks.push({ type: 'notes', title: 'Moddalar izohi', items: d.items.map((i) => `${i.label}: ${i.notes.join(' ')}`) });
    sections.push({ title: "Moddalar bo'yicha natija", blocks });

    // Oylar: oxirgi 12 oy (joriy oy — hozirgacha)
    const months = (d.items[0]?.months ?? []).slice(-12);
    if (months.length && d.items.length) {
      const current = today.slice(0, 7);
      sections.push({
        title: "Oylar bo'yicha",
        intro: "Oxirgi 12 oy, mln so'm. Joriy oy (*) — hozirgacha yozilgan summa.",
        blocks: [
          {
            type: 'table',
            columns: [{ label: 'Modda', width: 2.4 }, ...months.map((p) => ({ label: `${periodShort(p)}${p === current ? '*' : ''}`, format: 'mln' as const, width: 0.72 }))],
            rows: d.items.map((i) => [i.label, ...i.monthly.slice(-12).map((v) => som(v))]),
          },
        ],
      });
    }

    const records = d.items.flatMap((i) => i.topRecords.map((r) => ({ item: i.label, r })));
    if (records.length) {
      sections.push({
        title: 'Yirik yozuvlar',
        intro: "Kuzatuv davridagi summasi eng katta yozuvlar (har modda bo'yicha 8 tagacha).",
        blocks: [
          {
            type: 'table',
            columns: [
              { label: 'Modda', width: 1.8 },
              { label: 'Sana', width: 0.8 },
              { label: 'Turi', width: 0.7 },
              { label: 'Tavsif', width: 2.2 },
              { label: 'Joy', width: 1.2 },
              { label: "Summa, so'm", format: 'money' },
            ],
            rows: records.map(({ item, r }) => [item, uzDate(r.date), r.kind === 'INCOME' ? 'Daromad' : 'Xarajat', r.label, r.place, som(r.amountTiyin)]),
          },
        ],
      });
    }

    if (d.assignees.length) {
      sections.push({
        title: "Mas'ullar",
        blocks: [
          {
            type: 'table',
            columns: [{ label: 'F.I.Sh.', width: 2.2 }, { label: 'Lavozim', width: 2.2 }, { label: 'Roli', width: 1 }],
            rows: d.assignees.map((a) => [a.fullName, a.position ?? '—', a.role]),
          },
        ],
      });
    }

    const worst = d.items.filter((i) => i.verdict === 'worse').sort((a, b) => gainOf(a) - gainOf(b))[0];
    const highlights = [
      `${statusText(d)}: kuzatuvning ${d.daysPassed}-kuni (jami ${d.daysTotal} kun), muddat ${uzDate(d.dueDate)}.`,
      `${d.itemCount} ta moddadan ${d.better} tasi yaxshilandi, ${d.worse} tasi yomonlashdi, ${d.same} tasi o'zgarmadi.`,
      gain !== 0 ? `Umumiy ta'sir: ${signedSom(gain)}.` : "Umumiy ta'sir hozircha nolga teng.",
      ...(worst ? [`Eng ko'p e'tibor talab qiladigan modda — «${worst.label}»: ${worst.verdictText.toLowerCase()} (${fmtSignedPct(worst.changePercent)}).`] : []),
      ...(d.assignees.length ? [] : ["Mas'ul xodim biriktirilmagan."]),
    ];

    return {
      kind: 'Munosabat hisoboti',
      title: d.title,
      subtitle: `Munosabat · ${uzDate(d.startDate)} – ${uzDate(d.dueDate)}`,
      meta: [
        `Holat: ${statusText(d)}; holat sanasi ${uzDate(today)}`,
        `Kuzatuv: ${uzDate(d.startDate)} – ${uzDate(d.dueDate)} (${d.daysTotal} kun); baza: ${uzDate(d.baseFrom)} – ${uzDate(d.baseTo)}`,
        `Umumiy ta'sir: ${fmtSom(gain)}`,
        'Manba: Munosabat bo\'limi; summalar Daromadlar va Xarajatlar bo\'limlaridan',
      ],
      highlights,
      sections,
      fileBase: safeFile(`Munosabat - ${d.title} - ${d.startDate}`),
      generatedAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
    };
  }
}