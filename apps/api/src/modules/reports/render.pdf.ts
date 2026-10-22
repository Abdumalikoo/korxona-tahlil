import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { cellText, PALETTE as C, cellTone, TONE_COLOR, uzDate } from './reports.format';
import { chartSvg } from './reports.svg';
import type { KpiBlock, ReportDoc, TableBlock } from './reports.types';

// ═══════════════════════════════════════════════════════════
// PDF (A4): chop etish va yuborish uchun tayyor hujjat.
// Shrift — Roboto (pdfmake bilan keladi): o'zbekcha harflar va belgilar to'g'ri chiqadi.
// ═══════════════════════════════════════════════════════════

// require — tsconfig dagi esModuleInterop sozlamasidan qat'i nazar ishlaydi
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PdfPrinter = require('pdfmake') as typeof import('pdfmake');

let printer: InstanceType<typeof PdfPrinter> | null = null;

function getPrinter(): InstanceType<typeof PdfPrinter> {
  if (printer) return printer;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const raw = require('pdfmake/build/vfs_fonts') as Record<string, unknown>;
  const vfs = ((raw.pdfMake as { vfs?: Record<string, string> } | undefined)?.vfs ?? (raw.vfs as Record<string, string> | undefined) ?? raw) as Record<string, string>;
  const font = (name: string) => Buffer.from(vfs[name]!, 'base64');
  printer = new PdfPrinter({
    Roboto: {
      normal: font('Roboto-Regular.ttf'),
      bold: font('Roboto-Medium.ttf'),
      italics: font('Roboto-Italic.ttf'),
      bolditalics: font('Roboto-MediumItalic.ttf'),
    },
  });
  return printer;
}

const hex = (h: string) => `#${h}`;

function kpiGrid(block: KpiBlock): Content {
  const perRow = block.items.length <= 4 ? block.items.length : 3;
  const rows: TableCell[][] = [];
  for (let i = 0; i < block.items.length; i += perRow) {
    const slice = block.items.slice(i, i + perRow);
    const row: TableCell[] = slice.map((k) => ({
      stack: [
        { text: k.label.toUpperCase(), fontSize: 7, bold: true, color: hex(C.muted), characterSpacing: 0.4 },
        { text: k.value, fontSize: 14, bold: true, color: hex(TONE_COLOR[k.tone ?? 'neutral']), margin: [0, 3, 0, 1] },
        ...(k.sub ? [{ text: k.sub, fontSize: 7.5, color: hex(C.muted) }] : []),
      ],
      fillColor: hex(C.panel),
      margin: [8, 7, 8, 7],
    }));
    while (row.length < perRow) row.push({ text: '' });
    rows.push(row);
  }
  return {
    table: { widths: Array.from({ length: perRow }, () => '*'), body: rows },
    layout: { hLineWidth: () => 4, vLineWidth: () => 4, hLineColor: () => '#FFFFFF', vLineColor: () => '#FFFFFF', paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
    margin: [-4, 0, -4, 10],
  };
}

function table(block: TableBlock): Content[] {
  const fontSize = block.columns.length > 8 ? 6.8 : block.columns.length > 6 ? 7.4 : 8.2;
  const head: TableCell[] = block.columns.map((c, i) => ({ text: c.label, bold: true, color: '#FFFFFF', fillColor: hex(C.navy), alignment: i === 0 ? 'left' : 'center', fontSize }));
  const toRow = (values: TableBlock['rows'][number], bold: boolean, zebra: boolean, index: number): TableCell[] =>
    values.map((v, i) => {
      const col = block.columns[i];
      const tone = cellTone(v, col, block.rowTone?.[index]);
      return {
        text: cellText(v, col?.format),
        alignment: typeof v === 'number' ? 'right' : 'left',
        bold,
        color: tone === 'neutral' ? hex(C.ink) : hex(TONE_COLOR[tone]),
        fillColor: bold ? hex(C.line) : zebra ? hex(C.panel) : undefined,
        fontSize,
      };
    });
  const weights = block.columns.map((c, i) => c.width ?? (i === 0 ? 2.2 : 1));
  const sum = weights.reduce((a, v) => a + v, 0);
  const out: Content[] = [];
  if (block.title) out.push({ text: block.title, bold: true, fontSize: 10, color: hex(C.navy), margin: [0, 2, 0, 4], headlineLevel: 2 } as Content);
  out.push({
    table: {
      headerRows: 1,
      widths: weights.map((w) => `${((w / sum) * 100).toFixed(2)}%`),
      body: [head, ...block.rows.map((r, i) => toRow(r, false, i % 2 === 1, i)), ...(block.total ? [toRow(block.total, true, false, -1)] : [])],
      dontBreakRows: true,
    },
    layout: {
      hLineWidth: (i: number) => (i === 0 ? 0 : 0.4),
      vLineWidth: () => 0,
      hLineColor: () => hex(C.line),
      paddingLeft: () => 4,
      paddingRight: () => 4,
      paddingTop: () => 2.5,
      paddingBottom: () => 2.5,
    },
    margin: [0, 0, 0, block.note ? 3 : 10],
  });
  if (block.note) out.push({ text: block.note, fontSize: 7.5, italics: true, color: hex(C.muted), margin: [0, 0, 0, 10] });
  return out;
}

export async function renderPdf(doc: ReportDoc): Promise<Buffer> {
  const content: Content[] = [];

  // Sarlavha qismi
  content.push({ canvas: [{ type: 'rect', x: 0, y: 0, w: 515, h: 3, color: hex(C.navy) }], margin: [0, 0, 0, 10] });
  content.push({ text: doc.kind.toUpperCase(), fontSize: 8, bold: true, color: hex(C.muted), characterSpacing: 1.2 });
  content.push({ text: doc.title, fontSize: 20, bold: true, color: hex(C.ink), margin: [0, 3, 0, 3] });
  content.push({ text: doc.subtitle, fontSize: 10, color: hex(C.muted), margin: [0, 0, 0, 6] });
  content.push({ ul: doc.meta.map((m) => ({ text: m, fontSize: 8.5, color: hex(C.text) })), margin: [0, 0, 0, 10] });
  if (doc.highlights.length) {
    content.push({
      table: {
        widths: ['*'],
        body: [
          [
            {
              stack: [
                { text: 'Asosiy xulosalar', bold: true, fontSize: 11, color: hex(C.navy), margin: [0, 0, 0, 4] },
                { ol: doc.highlights.map((h) => ({ text: h, fontSize: 9, color: hex(C.text), margin: [0, 1, 0, 2] })) },
              ],
              fillColor: hex(C.panel),
              margin: [8, 8, 8, 6],
            },
          ],
        ],
      },
      layout: { hLineWidth: () => 0, vLineWidth: (i: number) => (i === 0 ? 2.5 : 0), vLineColor: () => hex(C.navy) },
      margin: [0, 0, 0, 14],
    });
  }

  for (const [si, section] of doc.sections.entries()) {
    content.push({
      stack: [
        { text: `${si + 1}. ${section.title}`, fontSize: 13, bold: true, color: hex(C.navy) },
        { canvas: [{ type: 'line', x1: 0, y1: 3, x2: 515, y2: 3, lineWidth: 0.6, lineColor: hex(C.line) }] },
        ...(section.intro ? [{ text: section.intro, fontSize: 8.5, color: hex(C.muted), margin: [0, 4, 0, 0] as [number, number, number, number] }] : []),
      ],
      margin: [0, 6, 0, 8],
      headlineLevel: 1,
    } as Content);
    for (const block of section.blocks) {
      if (block.type === 'kpis') {
        if (block.title) content.push({ text: block.title.toUpperCase(), fontSize: 7.5, bold: true, color: hex(C.navy), characterSpacing: 0.6, margin: [0, 0, 0, 3] });
        content.push(kpiGrid(block));
      }
      else if (block.type === 'table') content.push(...table(block));
      else if (block.type === 'chart') {
        const h = block.kind === 'barh' ? Math.min(300, 30 + block.labels.length * 16) : 190;
        // Sarlavha va grafik bir sahifada qoladi
        content.push({
          stack: [
            { text: `${block.title} (${block.unit})`, bold: true, fontSize: 9.5, color: hex(C.text), margin: [0, 2, 0, 3] },
            { svg: chartSvg(block, 515, h), width: 515 },
          ],
          unbreakable: true,
          margin: [0, 0, 0, 10],
        } as Content);
      } else if (block.type === 'formulas') {
        if (block.title) content.push({ text: block.title, bold: true, fontSize: 9.5, color: hex(C.navy), margin: [0, 2, 0, 3] } as Content);
        content.push({
          table: {
            headerRows: 1,
            widths: ['28%', '72%'],
            body: [
              [
                { text: block.headers?.[0] ?? "Ko'rsatkich", bold: true, color: '#FFFFFF', fillColor: hex(C.navy), fontSize: 8.2 },
                { text: block.headers?.[1] ?? 'Qanday hisoblanadi', bold: true, color: '#FFFFFF', fillColor: hex(C.navy), fontSize: 8.2 },
              ],
              ...block.items.map((f, i) => [
                { text: f.name, bold: true, fontSize: 8.2, color: hex(C.ink), fillColor: i % 2 ? hex(C.panel) : undefined },
                { text: f.formula, fontSize: 8.2, color: hex(C.text), fillColor: i % 2 ? hex(C.panel) : undefined },
              ]),
            ],
            dontBreakRows: true,
          },
          layout: { hLineWidth: (i: number) => (i === 0 ? 0 : 0.4), vLineWidth: () => 0, hLineColor: () => hex(C.line), paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 3, paddingBottom: () => 3 },
          margin: [0, 0, 0, 10],
        } as Content);
      } else {
        content.push({
          stack: [
            ...(block.title ? [{ text: block.title, bold: true, fontSize: 10, color: hex(C.navy), margin: [0, 0, 0, 3] as [number, number, number, number] }] : []),
            { ol: block.items.map((t) => ({ text: t, fontSize: 9, color: hex(C.text), margin: [0, 1, 0, 2] })) },
          ],
          margin: [0, 0, 0, 10],
        });
      }
    }
  }

  const def: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [40, 46, 40, 44],
    info: { title: doc.title, author: 'Korxona tahlil', subject: doc.kind },
    defaultStyle: { font: 'Roboto', fontSize: 9, color: hex(C.text), lineHeight: 1.18 },
    header: (page: number) =>
      page === 1
        ? null
        : { text: doc.title, fontSize: 7.5, color: hex(C.faint), margin: [40, 22, 40, 0] },
    footer: (page: number, pages: number) => ({
      columns: [
        { text: `Korxona tahlil · ${doc.kind} · ${uzDate(doc.generatedAt.slice(0, 10))}`, fontSize: 7.5, color: hex(C.faint) },
        { text: `${page} / ${pages}`, alignment: 'right', fontSize: 7.5, color: hex(C.faint) },
      ],
      margin: [40, 16, 40, 0],
    }),
    // Bo'lim sarlavhasi sahifa oxirida yolg'iz qolmasin
    pageBreakBefore: (current) => Boolean((current.headlineLevel === 1 || current.headlineLevel === 2) && (current.startPosition?.top ?? 0) > (current.headlineLevel === 1 ? 640 : 700)),
    content,
  };

  const pdf = getPrinter().createPdfKitDocument(def);
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    pdf.on('data', (c: Buffer) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    pdf.end();
  });
}