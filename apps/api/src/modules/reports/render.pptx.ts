import PptxGenJS from 'pptxgenjs';
import { cellText, PALETTE as C, cellTone, TONE_COLOR, uzDate } from './reports.format';
import type { ChartBlock, KpiBlock, NotesBlock, ReportDoc, TableBlock } from './reports.types';

// ═══════════════════════════════════════════════════════════
// PowerPoint: muqova, asosiy xulosalar, keyin har bir bo'lim —
// ko'rsatkichlar kartochkalar, grafiklar (tahrirlanadigan), jadvallar, xulosalar.
// ═══════════════════════════════════════════════════════════

const W = 13.333;
const H = 7.5;
const FONT = 'Arial';
const ROWS_PER_SLIDE = 13;

type Slide = ReturnType<PptxGenJS['addSlide']>;

interface Plan {
  title: string;
  subtitle?: string;
  draw: (slide: Slide) => void;
}

export async function renderPptx(doc: ReportDoc): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Korxona tahlil';
  pptx.title = doc.title;

  const plans: Plan[] = [];

  // Asosiy xulosalar (birinchi ko'rsatkichlar bilan)
  const firstKpis = doc.sections.flatMap((s) => s.blocks).find((b): b is KpiBlock => b.type === 'kpis');
  plans.push({
    title: 'Asosiy xulosalar',
    subtitle: doc.subtitle,
    draw: (slide) => {
      let y = 1.55;
      if (firstKpis) {
        kpis(pptx, slide, firstKpis.items.slice(0, 4), y);
        y += 1.65;
      }
      bullets(slide, doc.highlights, 0.6, y, W - 1.2, H - 0.8 - y, 14);
    },
  });

  // Bo'limlar
  for (const section of doc.sections) {
    const blocks = section.blocks;
    for (let i = 0; i < blocks.length; i += 1) {
      const b = blocks[i]!;
      const next = blocks[i + 1];
      if (b.type === 'kpis' && b.title) {
        // Nomli KPI guruhlari (fakt / reja / prognoz) — ketma-ketlari bitta slaydda, har biri o'z qatorida
        const group: KpiBlock[] = [b];
        while (blocks[i + 1]?.type === 'kpis' && (blocks[i + 1] as KpiBlock).title && group.length < 3) group.push(blocks[++i] as KpiBlock);
        plans.push({
          title: section.title,
          subtitle: section.intro,
          draw: (slide) => {
            group.forEach((g, k) => {
              const y = 1.5 + k * 1.75;
              slide.addText(g.title!.toUpperCase(), { x: 0.6, y, w: W - 1.2, h: 0.25, fontFace: FONT, fontSize: 10, bold: true, color: C.navy, charSpacing: 1, margin: 0 });
              kpis(pptx, slide, g.items.slice(0, 4), y + 0.28);
            });
          },
        });
      } else if (b.type === 'kpis') {
        if (b === firstKpis && section === doc.sections[0] && (!next || next.type !== 'notes')) continue;
        const notes = next?.type === 'notes' ? next : null;
        if (notes) i += 1;
        plans.push({
          title: section.title,
          subtitle: section.intro,
          draw: (slide) => {
            const rows = Math.ceil(b.items.length / 4);
            for (let k = 0; k < rows; k += 1) kpis(pptx, slide, b.items.slice(k * 4, k * 4 + 4), 1.55 + k * 1.55);
            if (notes) bullets(slide, notes.items, 0.6, 1.7 + rows * 1.55, W - 1.2, H - 1.0 - (1.7 + rows * 1.55), 13);
          },
        });
      } else if (b.type === 'chart') {
        const notes = next?.type === 'notes' ? next : null;
        if (notes) i += 1;
        plans.push({
          title: section.title,
          subtitle: `${b.title} · ${b.unit}`,
          draw: (slide) => {
            chart(pptx, slide, b, 0.5, 1.5, notes ? 8.3 : W - 1.0, H - 2.2);
            if (notes) panel(pptx, slide, notes, 9.05, 1.5, W - 9.65, H - 2.2);
          },
        });
      } else if (b.type === 'table') {
        const limit = b.slideRows ?? ROWS_PER_SLIDE * 3;
        const rows = b.rows.slice(0, limit);
        const pages = Math.max(1, Math.ceil(rows.length / ROWS_PER_SLIDE));
        // Qatorlar slaydlarga teng bo'linadi (oxirgi slaydda 1–2 qator yolg'iz qolmasin)
        const perPage = Math.max(1, Math.ceil(rows.length / pages));
        for (let p = 0; p < pages; p += 1) {
          const chunk = rows.slice(p * perPage, (p + 1) * perPage);
          const last = p === pages - 1;
          plans.push({
            title: `${section.title}${pages > 1 ? ` (${p + 1}/${pages})` : ''}`,
            subtitle: b.title ?? section.intro,
            draw: (slide) => {
              table(slide, b, chunk, last ? b.total : undefined, p * perPage);
              const hidden = b.rows.length - rows.length;
              const foot = [b.note, last && hidden > 0 ? `Yana ${hidden} ta qator — Excel va PDF hisobotida.` : null].filter(Boolean).join(' ');
              if (foot) slide.addText(foot, { x: 0.6, y: H - 0.95, w: W - 1.2, h: 0.3, fontFace: FONT, fontSize: 10, color: C.muted, margin: 0 });
            },
          });
        }
      } else if (b.type === 'formulas') {
        // Formulalar: slaydga 7 tadan (raqamli hisob-kitoblar uzunroq — 5 tadan), nom — qalin, ostida formula
        const per = b.headers ? 5 : 7;
        const pages = Math.ceil(b.items.length / per);
        for (let p = 0; p < pages; p += 1) {
          const chunk = b.items.slice(p * per, (p + 1) * per);
          plans.push({
            title: `${section.title}${pages > 1 ? ` (${p + 1}/${pages})` : ''}`,
            subtitle: b.title ?? section.intro,
            draw: (slide) => {
              slide.addText(
                chunk.flatMap((f) => [
                  { text: f.name, options: { bold: true, color: C.navy, fontSize: 13, breakLine: true } },
                  { text: f.formula, options: { color: C.text, fontSize: 12, breakLine: true, paraSpaceAfter: 8 } },
                ]),
                { x: 0.6, y: 1.55, w: W - 1.2, h: H - 2.3, fontFace: FONT, valign: 'top', margin: 0, fit: 'shrink' },
              );
            },
          });
        }
      } else {
        const notes = b as NotesBlock;
        plans.push({
          title: section.title,
          subtitle: notes.title ?? section.intro,
          draw: (slide) => bullets(slide, notes.items, 0.6, 1.6, W - 1.2, H - 2.4, 15),
        });
      }
    }
  }

  // Muqova + slaydlar
  const total = plans.length + 1;
  cover(pptx, doc);
  plans.forEach((plan, i) => {
    const slide = frame(pptx, doc, plan.title, plan.subtitle ?? null, i + 2, total);
    plan.draw(slide);
  });

  const out = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  return Buffer.from(out);
}

// ─────────── Qolip ───────────

function cover(pptx: PptxGenJS, doc: ReportDoc) {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.35, h: H, fill: { color: C.navy }, line: { color: C.navy } });
  slide.addText(doc.kind.toUpperCase(), { x: 1.0, y: 1.5, w: 11, h: 0.4, fontFace: FONT, fontSize: 13, bold: true, color: C.muted, charSpacing: 3, margin: 0 });
  slide.addText(doc.title, { x: 1.0, y: 2.0, w: 11.3, h: 1.5, fontFace: FONT, fontSize: 36, bold: true, color: C.ink, valign: 'top', margin: 0, fit: 'shrink' });
  slide.addShape(pptx.ShapeType.line, { x: 1.0, y: 3.7, w: 3, h: 0, line: { color: C.navy, width: 2 } });
  slide.addText(
    [doc.subtitle, ...doc.meta].map((text) => ({ text, options: { breakLine: true } })),
    { x: 1.0, y: 3.95, w: 11.3, h: 2.2, fontFace: FONT, fontSize: 15, color: C.text, paraSpaceAfter: 6, valign: 'top', margin: 0, fit: 'shrink' },
  );
  slide.addText(`Tayyorlangan: ${uzDate(doc.generatedAt.slice(0, 10))} · Korxona tahlil · avtomatik hisobot`, {
    x: 1.0, y: H - 0.9, w: 11, h: 0.35, fontFace: FONT, fontSize: 11, color: C.faint, margin: 0,
  });
}

function frame(pptx: PptxGenJS, doc: ReportDoc, title: string, subtitle: string | null, page: number, total: number): Slide {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.12, fill: { color: C.navy }, line: { color: C.navy } });
  slide.addText(title, { x: 0.6, y: 0.35, w: W - 1.2, h: 0.6, fontFace: FONT, fontSize: 24, bold: true, color: C.ink, margin: 0, fit: 'shrink' });
  if (subtitle) slide.addText(subtitle, { x: 0.6, y: 0.95, w: W - 1.2, h: 0.4, fontFace: FONT, fontSize: 13, color: C.muted, margin: 0, fit: 'shrink' });
  slide.addShape(pptx.ShapeType.line, { x: 0.6, y: H - 0.55, w: W - 1.2, h: 0, line: { color: C.line, width: 0.75 } });
  slide.addText(doc.title, { x: 0.6, y: H - 0.48, w: 9, h: 0.3, fontFace: FONT, fontSize: 9, color: C.faint, margin: 0 });
  slide.addText(`${page} / ${total}`, { x: W - 2.6, y: H - 0.48, w: 2, h: 0.3, fontFace: FONT, fontSize: 9, color: C.faint, align: 'right', margin: 0 });
  return slide;
}

function kpis(pptx: PptxGenJS, slide: Slide, items: KpiBlock['items'], y: number) {
  const count = Math.max(1, items.length);
  const gap = 0.3;
  const w = (W - 1.2 - gap * (count - 1)) / count;
  items.forEach((k, i) => {
    const x = 0.6 + i * (w + gap);
    slide.addShape(pptx.ShapeType.rect, { x, y, w, h: 1.35, fill: { color: C.panel }, line: { color: C.panel } });
    slide.addText(k.label.toUpperCase(), { x: x + 0.2, y: y + 0.12, w: w - 0.4, h: 0.3, fontFace: FONT, fontSize: 9.5, bold: true, color: C.muted, charSpacing: 1, margin: 0, fit: 'shrink' });
    slide.addText(k.value, { x: x + 0.2, y: y + 0.44, w: w - 0.4, h: 0.5, fontFace: FONT, fontSize: 22, bold: true, color: TONE_COLOR[k.tone ?? 'neutral'], margin: 0, fit: 'shrink' });
    if (k.sub) slide.addText(k.sub, { x: x + 0.2, y: y + 0.94, w: w - 0.4, h: 0.32, fontFace: FONT, fontSize: 10, color: C.muted, margin: 0, fit: 'shrink' });
  });
}

function bullets(slide: Slide, items: string[], x: number, y: number, w: number, h: number, size: number) {
  if (!items.length || h <= 0.3) return;
  slide.addText(
    items.map((text, i) => ({ text: `${i + 1}.  ${text}`, options: { breakLine: true } })),
    { x, y, w, h, fontFace: FONT, fontSize: size, color: C.text, paraSpaceAfter: 7, valign: 'top', margin: 0, fit: 'shrink' },
  );
}

function panel(pptx: PptxGenJS, slide: Slide, notes: NotesBlock, x: number, y: number, w: number, h: number) {
  slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: C.panel }, line: { color: C.panel } });
  if (notes.title) slide.addText(notes.title, { x: x + 0.2, y: y + 0.15, w: w - 0.4, h: 0.35, fontFace: FONT, fontSize: 13, bold: true, color: C.navy, margin: 0 });
  bullets(slide, notes.items, x + 0.2, y + (notes.title ? 0.6 : 0.2), w - 0.4, h - (notes.title ? 0.8 : 0.4), 12);
}

function chart(pptx: PptxGenJS, slide: Slide, b: ChartBlock, x: number, y: number, w: number, h: number) {
  const colors = [C.navy, C.expenseBar, C.green, C.amber, C.ramp[3]!, C.slate];
  const common = {
    x, y, w, h,
    catAxisLabelFontSize: 10,
    catAxisLabelFontFace: FONT,
    catAxisLabelColor: C.muted,
    valAxisLabelFontSize: 9,
    valAxisLabelColor: C.faint,
    valAxisLabelFormatCode: '#,##0.#',
    valGridLine: { color: C.line, style: 'solid', size: 0.5 },
    catGridLine: { style: 'none' },
    showLegend: b.series.length > 1,
    legendPos: 'b',
    legendFontSize: 10,
    legendFontFace: FONT,
  };
  const data = (s: ChartBlock['series'][number]) => [{ name: s.name, labels: b.labels, values: s.values.map((v) => Math.round(v * 100) / 100) }];
  if (b.kind === 'barh') {
    const s = b.series[0]!;
    slide.addChart(pptx.ChartType.bar, data(s) as never, {
      ...common,
      barDir: 'bar',
      chartColors: [s.color ?? C.navy],
      invertedColors: [C.red],
      catAxisOrientation: 'maxMin',
      catAxisLabelPos: 'low',
      showValue: true,
      dataLabelFontSize: 9,
      dataLabelFormatCode: '#,##0.#',
      showLegend: false,
    } as never);
    return;
  }
  const hasLine = b.series.some((s) => s.asLine) || b.kind === 'line';
  const hasBar = b.kind === 'bar' && b.series.some((s) => !s.asLine);
  if (hasLine && hasBar) {
    // Barcha ustunlar BITTA guruhda — yonma-yon turadi (alohida guruhlar bir-birining ustiga tushib qoladi);
    // chiziqlar alohida, ustunlar ustida
    const color = (s: ChartBlock['series'][number]) => s.color ?? colors[b.series.indexOf(s) % colors.length]!;
    const bars = b.series.filter((s) => !s.asLine);
    const lines = b.series.filter((s) => s.asLine);
    const series = [
      {
        type: pptx.ChartType.bar,
        data: bars.map((s) => data(s)[0]!),
        options: { chartColors: bars.map(color), barGapWidthPct: 45, barOverlapPct: -8, barDir: 'col', barGrouping: b.stacked ? 'stacked' : 'clustered' },
      },
      ...lines.map((s) => ({
        type: pptx.ChartType.line,
        data: data(s),
        options: { chartColors: [color(s)], lineSize: 2.25, lineDataSymbol: 'circle', lineDataSymbolSize: 6 },
      })),
    ];
    slide.addChart(series as unknown as PptxGenJS.IChartMulti[], common as never);
    return;
  }
  slide.addChart(
    b.kind === 'line' ? pptx.ChartType.line : pptx.ChartType.bar,
    b.series.map((s) => data(s)[0]!) as never,
    {
      ...common,
      chartColors: b.series.map((s, i) => s.color ?? colors[i % colors.length]!),
      barDir: 'col',
      barGapWidthPct: 45,
      // Ustunlar yonma-yon, orasida kichik bo'shliq (yig'mada — ustma-ust)
      barOverlapPct: -8,
      barGrouping: b.stacked ? 'stacked' : 'clustered',
      lineSize: 2,
      lineDataSymbol: 'circle',
      lineDataSymbolSize: 5,
    } as never,
  );
}

function table(slide: Slide, b: TableBlock, rows: TableBlock['rows'], total?: TableBlock['total'], offset = 0) {
  const totalW = W - 1.2;
  const weights = b.columns.map((c, i) => c.width ?? (i === 0 ? 2.2 : 1));
  const sum = weights.reduce((a, v) => a + v, 0);
  const colW = weights.map((v) => (v / sum) * totalW);
  const fontSize = b.columns.length > 8 ? 9 : b.columns.length > 6 ? 10 : 11;
  const head = b.columns.map((c, i) => ({
    text: c.label,
    options: { bold: true, color: 'FFFFFF', fill: { color: C.navy }, fontSize, align: (i === 0 ? 'left' : 'center') as 'left' | 'center', valign: 'middle' as const },
  }));
  const toRow = (values: TableBlock['rows'][number], bold: boolean, index: number) =>
    values.map((v, i) => {
      const col = b.columns[i];
      const tone = cellTone(v, col, b.rowTone?.[index]);
      return {
        text: cellText(v, col?.format),
        options: {
          align: (typeof v === 'number' ? 'right' : 'left') as 'right' | 'left',
          bold,
          color: tone === 'neutral' ? C.text : TONE_COLOR[tone],
          fill: bold ? { color: C.panel } : undefined,
        },
      };
    });
  const body = [head, ...rows.map((r, i) => toRow(r, false, offset + i)), ...(total ? [toRow(total, true, -1)] : [])];
  slide.addTable(body as never, {
    x: 0.6,
    y: 1.5,
    w: totalW,
    colW,
    fontFace: FONT,
    fontSize,
    color: C.text,
    rowH: 0.33,
    border: { type: 'solid', pt: 0.5, color: C.line },
    valign: 'middle',
    autoPage: false,
  });
}