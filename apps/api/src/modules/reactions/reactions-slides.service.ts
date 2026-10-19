import { Injectable } from '@nestjs/common';
import PptxGenJS from 'pptxgenjs';
import { fmtPct, fmtSom, ReactionsService } from './reactions.service';
import type { ItemEvaluation, ItemKind, ReactionDetail, Verdict } from './reactions.types';
import { gainWorking, itemWorkings, KEY_FORMULAS, type Working } from './reactions.workings';

// ═══════════════════════════════════════════════════════════
// Munosabat slaydlari (PowerPoint) — avtomatik, sokin va tushunarli dizayn
// ═══════════════════════════════════════════════════════════

const W = 13.333;
const H = 7.5;
const FONT = 'Arial';
const C = {
  navy: '1B3354',
  ink: '111827',
  text: '374151',
  muted: '6B7280',
  faint: '9CA3AF',
  line: 'E5E7EB',
  panel: 'F6F7F9',
  green: '2F7A57',
  greenSoft: 'E3F1E9',
  red: 'B3423B',
  redSoft: 'F6E1DF',
  slate: '94A3B8',
};
const MONTHS = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'];
const KIND_LABEL: Record<ItemKind, string> = { INCOME: 'Daromad', EXPENSE: 'Xarajat', RESULT: 'Natija (daromad − xarajat)' };
const VERDICT: Record<Verdict, { text: string; color: string; fill: string }> = {
  better: { text: 'Yaxshilandi', color: C.green, fill: C.greenSoft },
  worse: { text: 'Yomonlashdi', color: C.red, fill: C.redSoft },
  same: { text: "O'zgarishsiz", color: C.text, fill: C.panel },
  nodata: { text: 'Boshlanmagan', color: C.muted, fill: C.panel },
};

function uzDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function mln(tiyin: string | number): number {
  return Math.round(Number(tiyin) / 100 / 1e5) / 10;
}

type Slide = ReturnType<PptxGenJS['addSlide']>;

@Injectable()
export class ReactionsSlidesService {
  constructor(private readonly reactions: ReactionsService) {}

  async build(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const data = await this.reactions.detail(id);
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = 'Korxona tahlil';
    pptx.title = data.title;

    // muqova + xulosa + jadval + formulalar + (har modda: grafik va hisob-kitob) + mas'ullar
    const total = 4 + data.items.length * 2 + 1;
    let page = 0;
    const next = () => (page += 1);

    this.cover(pptx, data);
    next();
    this.summary(pptx, data, next(), total);
    this.table(pptx, data, next(), total);
    this.formulas(pptx, data, next(), total);
    for (const item of data.items) {
      this.item(pptx, data, item, next(), total);
      this.workings(pptx, data, item, next(), total);
    }
    this.people(pptx, data, next(), total);

    const out = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
    const safe = data.title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'munosabat';
    return { buffer: Buffer.from(out), filename: `Munosabat - ${safe} - slaydlar.pptx` };
  }

  // ─────────── Umumiy qolip ───────────

  private frame(pptx: PptxGenJS, data: ReactionDetail, title: string, subtitle: string | null, page: number, total: number): Slide {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.12, fill: { color: C.navy }, line: { color: C.navy } });
    slide.addText(title, { x: 0.6, y: 0.35, w: W - 1.2, h: 0.6, fontFace: FONT, fontSize: 24, bold: true, color: C.ink, margin: 0 });
    if (subtitle) slide.addText(subtitle, { x: 0.6, y: 0.95, w: W - 1.2, h: 0.4, fontFace: FONT, fontSize: 13, color: C.muted, margin: 0 });
    slide.addShape(pptx.ShapeType.line, { x: 0.6, y: H - 0.55, w: W - 1.2, h: 0, line: { color: C.line, width: 0.75 } });
    slide.addText(data.title, { x: 0.6, y: H - 0.48, w: 8, h: 0.3, fontFace: FONT, fontSize: 9, color: C.faint, margin: 0 });
    slide.addText(`${page} / ${total}`, { x: W - 2.6, y: H - 0.48, w: 2, h: 0.3, fontFace: FONT, fontSize: 9, color: C.faint, align: 'right', margin: 0 });
    return slide;
  }

  private kpi(slide: Slide, pptx: PptxGenJS, x: number, y: number, w: number, label: string, value: string, color = C.ink, sub?: string) {
    slide.addShape(pptx.ShapeType.rect, { x, y, w, h: 1.35, fill: { color: C.panel }, line: { color: C.panel } });
    slide.addText(label.toUpperCase(), { x: x + 0.2, y: y + 0.12, w: w - 0.4, h: 0.3, fontFace: FONT, fontSize: 9.5, bold: true, color: C.muted, charSpacing: 1, margin: 0 });
    slide.addText(value, { x: x + 0.2, y: y + 0.45, w: w - 0.4, h: 0.5, fontFace: FONT, fontSize: 22, bold: true, color, margin: 0 });
    if (sub) slide.addText(sub, { x: x + 0.2, y: y + 0.95, w: w - 0.4, h: 0.3, fontFace: FONT, fontSize: 10, color: C.muted, margin: 0 });
  }

  // ─────────── 1. Muqova ───────────

  private cover(pptx: PptxGenJS, data: ReactionDetail) {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.35, h: H, fill: { color: C.navy }, line: { color: C.navy } });
    slide.addText('MUNOSABAT HISOBOTI', { x: 1.0, y: 1.6, w: 10, h: 0.4, fontFace: FONT, fontSize: 13, bold: true, color: C.muted, charSpacing: 3, margin: 0 });
    slide.addText(data.title, { x: 1.0, y: 2.1, w: 11, h: 1.4, fontFace: FONT, fontSize: 38, bold: true, color: C.ink, valign: 'top', margin: 0, fit: 'shrink' });
    slide.addShape(pptx.ShapeType.line, { x: 1.0, y: 3.75, w: 3, h: 0, line: { color: C.navy, width: 2 } });
    const lines = [
      `Kuzatuv davri: ${uzDate(data.startDate)} — ${uzDate(data.dueDate)} (${data.daysTotal} kun)`,
      `Solishtirish bazasi: ${uzDate(data.baseFrom)} — ${uzDate(data.baseTo)}`,
      `Moddalar: ${data.itemCount} ta · Mas'ullar: ${data.assignees.length ? data.assignees.map((a) => a.fullName).join(', ') : 'biriktirilmagan'}`,
    ];
    slide.addText(
      lines.map((text) => ({ text, options: { breakLine: true } })),
      { x: 1.0, y: 4.0, w: 11, h: 1.4, fontFace: FONT, fontSize: 15, color: C.text, paraSpaceAfter: 6, valign: 'top', margin: 0 },
    );
    slide.addText(`Tayyorlangan: ${uzDate(new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10))} · avtomatik hisobot`, {
      x: 1.0, y: H - 0.9, w: 11, h: 0.35, fontFace: FONT, fontSize: 11, color: C.faint, margin: 0,
    });
  }

  // ─────────── 2. Qisqacha natija ───────────

  private summary(pptx: PptxGenJS, data: ReactionDetail, page: number, total: number) {
    const status =
      data.status === 'OPEN'
        ? data.overdue
          ? 'Muddat tugagan'
          : `Muddatgacha ${data.daysLeft} kun qoldi`
        : data.status === 'CONTROL'
          ? "Nazoratga o'tkazilgan"
          : 'Yopilgan';
    const slide = this.frame(pptx, data, 'Qisqacha natija', `${status} · kuzatuvning ${data.daysPassed}-kuni`, page, total);
    const gain = Number(data.gainTiyin);
    const w = (W - 1.2 - 0.3 * 3) / 4;
    this.kpi(slide, pptx, 0.6, 1.6, w, 'Moddalar', String(data.itemCount), C.ink, 'belgilangan');
    this.kpi(slide, pptx, 0.6 + (w + 0.3), 1.6, w, 'Yaxshilandi', String(data.better), C.green, `${data.same} ta o'zgarishsiz`);
    this.kpi(slide, pptx, 0.6 + (w + 0.3) * 2, 1.6, w, 'Yomonlashdi', String(data.worse), data.worse > 0 ? C.red : C.ink, 'e\'tibor talab qiladi');
    this.kpi(slide, pptx, 0.6 + (w + 0.3) * 3, 1.6, w, "Umumiy ta'sir", fmtSom(gain), gain >= 0 ? C.green : C.red, gain >= 0 ? 'tejalgan / qo\'shimcha' : 'yo\'qotilgan');

    slide.addText('Asosiy xulosalar', { x: 0.6, y: 3.3, w: 6, h: 0.4, fontFace: FONT, fontSize: 15, bold: true, color: C.navy, margin: 0 });
    slide.addText(
      data.conclusions.slice(0, 6).map((text, i) => ({ text: `${i + 1}.  ${text}`, options: { breakLine: true } })),
      { x: 0.6, y: 3.8, w: W - 1.2, h: 2.9, fontFace: FONT, fontSize: 14, color: C.text, paraSpaceAfter: 8, valign: 'top', margin: 0, fit: 'shrink' },
    );
  }

  // ─────────── 3. Moddalar jadvali ───────────

  private table(pptx: PptxGenJS, data: ReactionDetail, page: number, total: number) {
    const slide = this.frame(pptx, data, "Moddalar bo'yicha holat", 'Kunlik sur\'at: belgilashdan oldingi davr va kuzatuv davri', page, total);
    const head = ['Modda', 'Turi', 'Avval, kuniga', 'Hozir, kuniga', "O'zgarish", "Ta'sir", 'Holat'].map((text) => ({
      text,
      options: { bold: true, color: 'FFFFFF', fill: { color: C.navy }, fontSize: 11, align: 'center' as const, valign: 'middle' as const },
    }));
    const rows = data.items.slice(0, 12).map((item) => {
      const v = VERDICT[item.verdict];
      const effect = Number(item.effectTiyin);
      const good = item.kind === 'EXPENSE' ? effect < 0 : effect > 0;
      return [
        { text: item.label, options: { align: 'left' as const } },
        { text: KIND_LABEL[item.kind].split(' ')[0]!, options: { align: 'center' as const, color: C.muted } },
        { text: fmtSom(Number(item.base.perDayTiyin)), options: { align: 'right' as const } },
        { text: fmtSom(Number(item.track.perDayTiyin)), options: { align: 'right' as const } },
        { text: fmtPct(item.changePercent, true), options: { align: 'right' as const, color: v.color, bold: true } },
        { text: effect === 0 ? '0' : `${effect > 0 ? '+' : '−'}${fmtSom(Math.abs(effect))}`, options: { align: 'right' as const, color: effect === 0 ? C.text : good ? C.green : C.red } },
        { text: v.text, options: { align: 'center' as const, bold: true, color: v.color, fill: { color: v.fill } } },
      ];
    });
    slide.addTable([head, ...rows], {
      x: 0.6,
      y: 1.55,
      w: W - 1.2,
      colW: [3.9, 1.1, 1.55, 1.55, 1.2, 1.6, 1.23],
      fontFace: FONT,
      fontSize: 11,
      color: C.text,
      rowH: 0.38,
      border: { type: 'solid', pt: 0.5, color: C.line },
      valign: 'middle',
      autoPage: false,
    });
    if (data.items.length > 12) {
      slide.addText(`Yana ${data.items.length - 12} ta modda — Excel hisobotida.`, { x: 0.6, y: H - 0.95, w: 8, h: 0.3, fontFace: FONT, fontSize: 10, color: C.muted, margin: 0 });
    }
  }

  // ─────────── 4. Har modda ───────────

  private item(pptx: PptxGenJS, data: ReactionDetail, item: ItemEvaluation, page: number, total: number) {
    const v = VERDICT[item.verdict];
    const slide = this.frame(pptx, data, item.label, `${KIND_LABEL[item.kind]}${item.origin ? ` · ${item.origin}` : ''}`, page, total);
    // Holat belgisi
    slide.addShape(pptx.ShapeType.roundRect, { x: W - 3.2, y: 0.42, w: 2.6, h: 0.45, fill: { color: v.fill }, line: { color: v.fill }, rectRadius: 0.08 });
    slide.addText(item.verdictText, { x: W - 3.2, y: 0.42, w: 2.6, h: 0.45, fontFace: FONT, fontSize: 11, bold: true, color: v.color, align: 'center', valign: 'middle', margin: 0, fit: 'shrink' });

    // Grafik: so'nggi 12 oy va bir yil oldin (mln so'm)
    const months = item.months.slice(-12);
    const current = item.monthly.slice(-12).map(mln);
    const yearAgo = item.monthly.length >= 24 ? item.monthly.slice(-24, -12).map(mln) : null;
    const labels = months.map((p) => MONTHS[Number(p.slice(5, 7)) - 1] ?? p);
    const barColor = item.kind === 'INCOME' ? C.green : item.kind === 'EXPENSE' ? 'C9837D' : C.navy;
    slide.addText("So'nggi 12 oy, mln so'm", { x: 0.6, y: 1.5, w: 7.6, h: 0.3, fontFace: FONT, fontSize: 11, bold: true, color: C.muted, margin: 0 });
    // Ustunlar — so'nggi 12 oy, uzuq chiziq — bir yil oldingi xuddi shu oylar (bitta o'qda)
    const series: { type: PptxGenJS.CHART_NAME; data: { name: string; labels: string[]; values: number[] }[]; options: Record<string, unknown> }[] = [
      { type: pptx.ChartType.bar, data: [{ name: "So'nggi 12 oy", labels, values: current }], options: { chartColors: [barColor], barGapWidthPct: 60, barDir: 'col' } },
    ];
    if (yearAgo) {
      series.push({
        type: pptx.ChartType.line,
        data: [{ name: 'Bir yil oldin', labels, values: yearAgo }],
        options: { chartColors: [C.slate], lineSize: 2, lineDataSymbol: 'none', lineDash: 'dash' },
      });
    }
    // Aralash grafik: pptxgenjs da ikkinchi argument — umumiy sozlamalar
    slide.addChart(series as unknown as PptxGenJS.IChartMulti[], {
      x: 0.5,
      y: 1.8,
      w: 7.8,
      h: 3.55,
      catAxisLabelFontSize: 10,
      catAxisLabelFontFace: FONT,
      catAxisLabelColor: C.muted,
      valAxisLabelFontSize: 9,
      valAxisLabelColor: C.faint,
      valAxisLabelFormatCode: '#,##0.0',
      valGridLine: { color: C.line, style: 'solid', size: 0.5 },
      catGridLine: { style: 'none' },
      showLegend: Boolean(yearAgo),
      legendPos: 'b',
      legendFontSize: 10,
      legendFontFace: FONT,
    } as never);

    // O'ng panel: raqamlar
    const px = 8.7;
    const pw = W - px - 0.6;
    slide.addShape(pptx.ShapeType.rect, { x: px, y: 1.5, w: pw, h: 3.95, fill: { color: C.panel }, line: { color: C.panel } });
    const effect = Number(item.effectTiyin);
    const good = item.kind === 'EXPENSE' ? effect < 0 : effect > 0;
    const rows: [string, string, string?][] = [
      [`Avval (${item.base.days} kun), kuniga`, fmtSom(Number(item.base.perDayTiyin))],
      [`Hozir (${item.track.days} kun), kuniga`, fmtSom(Number(item.track.perDayTiyin)), v.color],
      ["O'zgarish", fmtPct(item.changePercent, true), v.color],
      ['Kutilgan / haqiqiy', `${fmtSom(Number(item.expectedTiyin))} / ${fmtSom(Number(item.track.sumTiyin))}`],
      [
        item.kind === 'EXPENSE' ? (good ? 'Tejaldi' : 'Ortiqcha sarf') : good ? "Qo'shimcha tushum" : 'Yetishmovchilik',
        fmtSom(Math.abs(effect)),
        effect === 0 ? C.text : good ? C.green : C.red,
      ],
    ];
    rows.forEach(([label, value, color], i) => {
      const y = 1.7 + i * 0.74;
      slide.addText(label, { x: px + 0.25, y, w: pw - 0.5, h: 0.28, fontFace: FONT, fontSize: 10.5, color: C.muted, margin: 0 });
      slide.addText(value, { x: px + 0.25, y: y + 0.26, w: pw - 0.5, h: 0.4, fontFace: FONT, fontSize: 16, bold: true, color: color ?? C.ink, margin: 0, fit: 'shrink' });
    });

    // Pastda: oddiy tildagi izoh
    slide.addText(
      item.notes.slice(0, 3).map((text) => ({ text, options: { bullet: { code: '2022' }, breakLine: true } })),
      { x: 0.6, y: 5.6, w: W - 1.2, h: 1.25, fontFace: FONT, fontSize: 12, color: C.text, paraSpaceAfter: 4, valign: 'top', margin: 0, fit: 'shrink' },
    );
  }

  // ─────────── Hisob-kitob: formulalar va har modda ishlanishi ───────────

  private workingsTable(pptx: PptxGenJS, slide: Slide, rows: Working[], y: number, h: number) {
    const head = ["Ko'rsatkich", 'Formula', 'Ishlanishi', 'Javob'].map((text) => ({ text, options: { bold: true, color: 'FFFFFF', fill: { color: C.navy }, fontSize: 10.5 } }));
    const body = rows.map((w) => [
      { text: w.title, options: { bold: true } },
      { text: w.formula, options: { color: C.muted } },
      { text: w.steps.join('\n') },
      { text: w.result, options: { bold: true, color: C.navy } },
    ]);
    slide.addTable([head, ...body], {
      x: 0.6,
      y,
      w: W - 1.2,
      h,
      colW: [2.0, 3.6, 4.7, 1.83],
      fontFace: FONT,
      fontSize: 11,
      color: C.text,
      valign: 'top',
      border: { type: 'solid', pt: 0.5, color: C.line },
      autoPage: false,
    });
    void pptx;
  }

  private formulas(pptx: PptxGenJS, data: ReactionDetail, page: number, total: number) {
    const slide = this.frame(pptx, data, 'Qanday hisoblanadi', "Baholash formulalari — saytdagi «Qanday hisoblandi?» bilan bir xil", page, total);
    slide.addText(
      KEY_FORMULAS.map((text, i) => ({ text: `${i + 1}.  ${text}`, options: { breakLine: true } })),
      { x: 0.6, y: 1.55, w: W - 1.2, h: 3.2, fontFace: FONT, fontSize: 13, color: C.text, paraSpaceAfter: 8, valign: 'top', margin: 0, fit: 'shrink' },
    );
    const gain = gainWorking(data.items, Number(data.gainTiyin));
    slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 4.95, w: W - 1.2, h: 1.8, fill: { color: C.panel }, line: { color: C.panel } });
    slide.addText(gain.title, { x: 0.85, y: 5.08, w: 6, h: 0.35, fontFace: FONT, fontSize: 13, bold: true, color: C.navy, margin: 0 });
    slide.addText(`${gain.formula}\n${gain.steps.join('\n')}\n= ${gain.result}`, { x: 0.85, y: 5.45, w: W - 1.7, h: 1.2, fontFace: FONT, fontSize: 11.5, color: C.text, valign: 'top', margin: 0, fit: 'shrink' });
  }

  private workings(pptx: PptxGenJS, data: ReactionDetail, item: ItemEvaluation, page: number, total: number) {
    const slide = this.frame(pptx, data, `Hisob-kitob: ${item.label}`, `${KIND_LABEL[item.kind]} · sonlar bilan ishlanishi`, page, total);
    this.workingsTable(pptx, slide, itemWorkings(item), 1.5, 5.2);
  }

  // ─────────── 5. Mas'ullar va keyingi qadamlar ───────────

  private people(pptx: PptxGenJS, data: ReactionDetail, page: number, total: number) {
    const slide = this.frame(pptx, data, "Mas'ullar va keyingi qadamlar", `Muddat: ${uzDate(data.dueDate)}`, page, total);
    if (data.assignees.length) {
      const head = ['F.I.Sh.', 'Lavozim', 'Roli'].map((text) => ({ text, options: { bold: true, color: 'FFFFFF', fill: { color: C.navy }, fontSize: 11 } }));
      const rows = data.assignees.slice(0, 8).map((a) => [{ text: a.fullName }, { text: a.position ?? '—', options: { color: C.muted } }, { text: a.role }]);
      slide.addTable([head, ...rows], { x: 0.6, y: 1.55, w: 7.4, colW: [3.4, 2.6, 1.4], fontFace: FONT, fontSize: 11, color: C.text, rowH: 0.38, border: { type: 'solid', pt: 0.5, color: C.line } });
    } else {
      slide.addText("Mas'ul xodim biriktirilmagan.", { x: 0.6, y: 1.6, w: 7.4, h: 0.4, fontFace: FONT, fontSize: 14, color: C.red, margin: 0 });
    }
    const steps: string[] = [];
    const worse = data.items.filter((i) => i.verdict === 'worse');
    if (worse.length) steps.push(`Yomonlashgan ${worse.length} ta modda bo'yicha sabablarni aniqlash: ${worse.slice(0, 3).map((i) => `«${i.label}»`).join(', ')}.`);
    if (data.status === 'OPEN' && !data.overdue) steps.push(`Muddatgacha (${uzDate(data.dueDate)}) ${data.daysLeft} kun qoldi — natijalar har kuni avtomatik yangilanadi.`);
    if (data.overdue) steps.push("Muddat tugadi: natijani muhokama qilib, munosabatni yopish yoki Nazoratga o'tkazish.");
    steps.push("Doimiy kuzatuv uchun moddalarni Nazoratga o'tkazib, oylik chegara belgilash mumkin.");
    if (data.note) steps.unshift(`Vazifa: ${data.note}`);
    slide.addShape(pptx.ShapeType.rect, { x: 8.4, y: 1.55, w: W - 9.0, h: 4.9, fill: { color: C.panel }, line: { color: C.panel } });
    slide.addText('Keyingi qadamlar', { x: 8.65, y: 1.75, w: W - 9.5, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: C.navy, margin: 0 });
    slide.addText(
      steps.map((text, i) => ({ text: `${i + 1}.  ${text}`, options: { breakLine: true } })),
      { x: 8.65, y: 2.25, w: W - 9.5, h: 4.0, fontFace: FONT, fontSize: 12, color: C.text, paraSpaceAfter: 8, valign: 'top', margin: 0, fit: 'shrink' },
    );
  }
}