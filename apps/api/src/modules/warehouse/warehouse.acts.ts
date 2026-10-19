import { Injectable } from '@nestjs/common';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  PageOrientation,
  Tab,
  TabStopPosition,
  TabStopType,
  VerticalAlign,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { StockDocKind } from '@prisma/client';
import { ACT_TITLES, type CountView, type DocView, type HoldingsView } from './warehouse.types';
import { cyrDate, fill, latinToCyrillic, personName, resolveTemplate, sanitizeTemplate, WarehouseTemplates, type ActTemplate } from './warehouse.template';
import { WarehouseCounts } from './warehouse.counts';
import { WarehouseService } from './warehouse.service';

// ═══════════════════════════════════════════════════════════
// Word dalolatnoma (.docx): har bir ombor hujjati uchun.
// Kirim — qabul qilish; chiqim — topshirish-qabul qilish; qaytarish; ko'chirish; hisobdan chiqarish.
// Berish/qaytarish/ko'chirish/hisobdan chiqarish/kirim dalolatnomalari — sozlanadigan shablon bo'yicha
// (warehouse.template.ts): tasdiqlash bloki, matnlar, «Ҳолати» ustuni, «Келишилди», hudud o'zgartirishlari.
// ═══════════════════════════════════════════════════════════

const FONT = 'Times New Roman';
const SIZE = 24; // 12 pt
const SMALL = 20; // 10 pt
const ACT_SIZE = 28; // 14 pt — namunadagidek
const TABLE_SIZE = 24;

function som(tiyin: string | number | bigint): string {
  const v = Math.round(Number(tiyin) / 100);
  return `${v < 0 ? '−' : ''}${Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
}

function qtyText(q: number): string {
  return Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/\.?0+$/, '').replace('.', ',');
}

function uzDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function p(textValue: string, opts: { bold?: boolean; size?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number } = {}): Paragraph {
  return new Paragraph({
    alignment: opts.align,
    spacing: { after: opts.after ?? 80 },
    children: [new TextRun({ text: textValue, bold: opts.bold, font: FONT, size: opts.size ?? SIZE })],
  });
}

function labelLine(label: string, value: string | null | undefined): Paragraph {
  return new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text: `${label}: `, bold: true, font: FONT, size: SIZE }), new TextRun({ text: value || '—', font: FONT, size: SIZE })],
  });
}

const BORDER = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

function cell(textValue: string, opts: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; width?: number } = {}): TableCell {
  return new TableCell({
    borders: BORDERS,
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [
      new Paragraph({
        alignment: opts.align ?? AlignmentType.LEFT,
        children: [new TextRun({ text: textValue, bold: opts.bold, font: FONT, size: SMALL })],
      }),
    ],
  });
}

function signature(role: string, name: string | null | undefined): Paragraph[] {
  return [
    new Paragraph({
      spacing: { before: 240, after: 0 },
      children: [
        new TextRun({ text: `${role}: `, bold: true, font: FONT, size: SIZE }),
        new TextRun({ text: `${name || '____________________'}`, font: FONT, size: SIZE }),
        new TextRun({ text: '        imzo: ________________', font: FONT, size: SIZE }),
      ],
    }),
  ];
}

@Injectable()
export class WarehouseActs {
  constructor(
    private readonly warehouse: WarehouseService,
    private readonly counts: WarehouseCounts,
    private readonly templates: WarehouseTemplates,
  ) {}

  private async pack(title: string, children: (Paragraph | Table)[], landscape = false): Promise<Buffer> {
    const document = new Document({
      creator: 'Korxona tahlil',
      title,
      styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
      sections: [
        {
          properties: {
            page: {
              margin: { top: 900, bottom: 900, left: 1000, right: 800 },
              ...(landscape ? { size: { orientation: PageOrientation.LANDSCAPE, width: 11906, height: 16838 } } : {}),
            },
          },
          children,
        },
      ],
    });
    return Packer.toBuffer(document);
  }

  private heading(title: string, sub: string): Paragraph[] {
    return [
      p('TASDIQLAYMAN', { bold: true, align: AlignmentType.RIGHT, after: 0 }),
      p('Rahbar: ____________________', { align: AlignmentType.RIGHT, after: 0 }),
      p('«____» ______________ 20___ y.', { align: AlignmentType.RIGHT, after: 240 }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [new TextRun({ text: title.toUpperCase(), bold: true, font: FONT, size: 26, color: '000000' })],
      }),
      p(sub, { align: AlignmentType.CENTER, after: 240 }),
    ];
  }

  private table(head: { text: string; width: number; right?: boolean }[], rows: string[][], bold: number[] = []): Table {
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, children: head.map((h) => cell(h.text, { bold: true, width: h.width, align: h.right ? AlignmentType.RIGHT : AlignmentType.LEFT })) }),
        ...rows.map(
          (r, ri) => new TableRow({ children: r.map((v, i) => cell(v, { bold: bold.includes(ri), align: head[i]?.right ? AlignmentType.RIGHT : AlignmentType.LEFT })) }),
        ),
      ],
    });
  }

  /** Inventarizatsiya dalolatnomasi: hisobda / haqiqatda / farq, topilmagan vositalar, xulosa, komissiya imzolari */
  async buildCount(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const c: CountView = await this.counts.get(id);
    const out: (Paragraph | Table)[] = this.heading('Inventarizatsiya dalolatnomasi', `№ ${c.number}    ${uzDate(c.date)}${c.status === 'DRAFT' ? '    (YAKUNLANMAGAN — QORALAMA)' : ''}`);
    out.push(labelLine('Komissiya raisi', c.chairman));
    out.push(labelLine("Komissiya a'zolari", c.commission));
    if (c.note) out.push(labelLine('Izoh', c.note));
    out.push(p('Komissiya ombordagi tovar-moddiy boyliklarni sanab chiqdi va quyidagilarni aniqladi:', { after: 120 }));

    const rows = c.lines.map((l, i) => [
      String(i + 1),
      l.name,
      l.code,
      l.unit,
      qtyText(l.bookQty),
      l.actualQty === null ? '—' : qtyText(l.actualQty),
      l.diffQty === null || Math.abs(l.diffQty) < 1e-9 ? '—' : `${l.diffQty > 0 ? '+' : ''}${qtyText(l.diffQty)}`,
      som(l.priceTiyin),
      l.diffAmountTiyin === null || l.diffAmountTiyin === '0' ? '—' : som(l.diffAmountTiyin),
    ]);
    out.push(
      this.table(
        [
          { text: '№', width: 4 },
          { text: 'Nomi', width: 30 },
          { text: 'Kod', width: 9 },
          { text: "O'lchov", width: 7 },
          { text: 'Hisobda', width: 9, right: true },
          { text: 'Haqiqatda', width: 9, right: true },
          { text: 'Farq', width: 8, right: true },
          { text: "Narx, so'm", width: 11, right: true },
          { text: "Farq, so'm", width: 13, right: true },
        ],
        rows,
      ),
    );

    if (c.assets.length) {
      out.push(p('', { after: 120 }));
      out.push(p('Omborda turishi kerak bo‘lgan asosiy vositalar:', { bold: true, after: 80 }));
      out.push(
        this.table(
          [
            { text: '№', width: 5 },
            { text: 'Inventar №', width: 15 },
            { text: 'Nomi', width: 40 },
            { text: 'Seriya', width: 15 },
            { text: "Qiymati, so'm", width: 13, right: true },
            { text: 'Natija', width: 12 },
          ],
          c.assets.map((a, i) => [String(i + 1), a.inventoryNo, a.name, a.serialNo ?? '—', som(a.priceTiyin), a.moved ? 'berilgan' : a.found === null ? '—' : a.found ? 'bor' : "YO'Q"]),
        ),
      );
    }

    out.push(p('', { after: 120 }));
    out.push(p('Xulosa:', { bold: true, after: 60 }));
    out.push(p(`Kamomad: ${c.totals.shortageLines} qator, ${som(c.totals.shortageTiyin)} so'm.`, { after: 40 }));
    out.push(p(`Ortiqcha: ${c.totals.surplusLines} qator, ${som(c.totals.surplusTiyin)} so'm.`, { after: 40 }));
    if (c.status === 'DONE') out.push(p('Kamomad hisobdan chiqarildi, ortiqcha kirim qilindi (xarajatga yozilmagan).', { after: 120 }));

    out.push(...signature('Komissiya raisi', c.chairman));
    const members = (c.commission ?? '').split(/[,;]+/).map((m) => m.trim()).filter(Boolean);
    for (const m of members.length ? members : [null, null]) out.push(...signature("Komissiya a'zosi", m));
    out.push(...signature("Moddiy javobgar shaxs (omborchi)", null));
    out.push(p(''));
    out.push(p(`Hujjat «Korxona tahlil» dasturida yaratildi: ${c.number}.`, { size: 16 }));
    return { buffer: await this.pack(`Inventarizatsiya ${c.number}`, out, true), filename: `${c.number} - inventarizatsiya dalolatnomasi.docx` };
  }

  /** Kimda nima bor — moddiy javobgarlik kartochkasi (odam, bo'lim yoki hudud) */
  async buildCard(filter: { holderPinfl?: string; holderName?: string; departmentId?: string; regionCode?: string }): Promise<{ buffer: Buffer; filename: string }> {
    const h: HoldingsView = await this.warehouse.holdings(filter);
    const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
    const out: (Paragraph | Table)[] = this.heading('Moddiy javobgarlikdagi mulk kartochkasi', `${uzDate(today)} holatiga`);
    out.push(labelLine('Kimda', h.title));
    out.push(p('', { after: 120 }));

    out.push(p(`Asosiy vositalar: ${h.assets.length} ta`, { bold: true, after: 80 }));
    if (h.assets.length) {
      out.push(
        this.table(
          [
            { text: '№', width: 5 },
            { text: 'Inventar №', width: 15 },
            { text: 'Nomi', width: 38 },
            { text: 'Seriya', width: 14 },
            { text: 'Kirim sanasi', width: 13 },
            { text: "Qiymati, so'm", width: 15, right: true },
          ],
          [
            ...h.assets.map((a, i) => [String(i + 1), a.inventoryNo, a.name, a.serialNo ?? '—', uzDate(a.acquiredAt), som(a.priceTiyin)]),
            ['', '', 'JAMI', '', '', som(h.assets.reduce((s, a) => s + Number(a.priceTiyin), 0))],
          ],
          [h.assets.length],
        ),
      );
    }
    out.push(p('', { after: 120 }));
    out.push(p(`Berilgan TMZ (qaytarilmagan): ${h.tmz.length} xil`, { bold: true, after: 80 }));
    if (h.tmz.length) {
      const total = h.tmz.reduce((s, t) => s + Math.round(t.qty * Number(t.avgPriceTiyin)), 0);
      out.push(
        this.table(
          [
            { text: '№', width: 5 },
            { text: 'Nomi', width: 45 },
            { text: 'Kod', width: 12 },
            { text: 'Miqdor', width: 18, right: true },
            { text: "Summa, so'm", width: 20, right: true },
          ],
          [...h.tmz.map((t, i) => [String(i + 1), t.itemName, t.itemCode, `${qtyText(t.qty)} ${t.unit}`, som(Math.round(t.qty * Number(t.avgPriceTiyin)))]), ['', 'JAMI', '', '', som(total)]],
          [h.tmz.length],
        ),
      );
    }
    out.push(p('', { after: 120 }));
    out.push(p("Yuqoridagi mulk menga topshirilgan, saqlanishi uchun javobgarman.", { after: 120 }));
    out.push(...signature('Moddiy javobgar shaxs', h.title.split(' · ')[0] ?? null));
    out.push(...signature('Omborchi', null));
    out.push(p(''));
    out.push(p(`Hujjat «Korxona tahlil» dasturida yaratildi: ${uzDate(today)}.`, { size: 16 }));
    const safe = (h.title.split(' · ')[0] ?? 'kartochka').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60);
    return { buffer: await this.pack(`Kartochka — ${h.title}`, out), filename: `${safe} - mulk kartochkasi.docx` };
  }

  async build(docId: string): Promise<{ buffer: Buffer; filename: string }> {
    const d = await this.warehouse.doc(docId);
    const tpl = await this.templates.get();
    const buffer = await this.packAct(d, tpl);
    return { buffer, filename: `${d.number} - dalolatnoma.docx` };
  }

  /** Shablon namunasi: sozlamadagi (yoki saqlanmagan) shablon bilan sinov hujjati */
  async buildSample(kind: StockDocKind, regionCode: number | null, draft?: unknown): Promise<{ buffer: Buffer; filename: string }> {
    const tpl = draft ? sanitizeTemplate(draft) : await this.templates.get();
    const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
    const place = (holder: string | null, text: string): DocView['to'] => ({
      departmentId: null,
      departmentName: null,
      regionCode,
      regionName: null,
      holderPinfl: null,
      holderName: holder,
      text,
    });
    const store = place(null, 'Ombor');
    const emp = place('AKBAROV FARRUX OTABEKOVICH', 'Akbarov F.');
    const emp2 = place('BASHARATOV ABDUMALIK', 'Basharatov A.');
    const d: DocView = {
      id: 'sample',
      number: 'NAMUNA-0001',
      kind,
      kindLabel: ACT_TITLES[kind],
      date: today,
      period: today.slice(0, 7),
      counterparty: kind === 'RECEIPT' ? '“Техномарт” МЧЖ' : null,
      documentNo: null,
      to: kind === 'ISSUE' ? emp : kind === 'TRANSFER' ? emp2 : store,
      from: kind === 'RETURN' || kind === 'TRANSFER' ? emp : kind === 'ISSUE' ? store : null,
      issuedBy: null,
      responsible: kind === 'WRITE_OFF' ? 'Эргашов С.' : null,
      reason: kind === 'WRITE_OFF' ? 'яроқсиз ҳолга келган' : null,
      note: null,
      totalTiyin: '2352256000',
      lines: [],
      assets: [{ id: 'a', inventoryNo: '00003860', name: 'Моноблок-38 (HP pavilion)', priceTiyin: '2352256000', condition: null }],
      createdAt: new Date().toISOString(),
      createdByName: null,
      cancelled: false,
      cancelledAt: null,
      cancelledByName: null,
    };
    if (kind === 'RECEIPT') {
      d.lines = [{ id: 'l', itemId: 'i', itemCode: 'AV-0001', itemName: 'Моноблок-38 (HP pavilion)', kind: 'ASSET', unit: 'дона', qty: 1, priceTiyin: '2352256000', amountTiyin: '2352256000', note: null } as unknown as DocView['lines'][number]];
    }
    const buffer = await this.packAct(d, tpl);
    return { buffer, filename: `namuna - ${ACT_TITLES[kind]}${regionCode ? ` - hudud ${regionCode}` : ''}.docx` };
  }

  private async packAct(d: DocView, base: ActTemplate): Promise<Buffer> {
    const regionCode = d.to.regionCode ?? d.from?.regionCode ?? null;
    const tpl = resolveTemplate(base, regionCode);
    const document = new Document({
      creator: 'Korxona tahlil',
      title: `${ACT_TITLES[d.kind]} № ${d.number}`,
      styles: { default: { document: { run: { font: FONT, size: ACT_SIZE } } } },
      sections: [
        {
          properties: { page: { margin: { top: 568, bottom: 1134, left: 1418, right: 707 } } },
          children: this.body(d, tpl),
        },
      ],
    });
    return Packer.toBuffer(document);
  }

  /** Dalolatnomadagi tomonlar: kim topshiradi, kim qabul qiladi */
  static parties(d: DocView, tpl: ActTemplate): Record<string, string> {
    const storekeeper = personName(tpl, tpl.storekeeperName || d.issuedBy);
    const who = (pl: DocView['to'] | null | undefined): string => (pl?.holderName ? personName(tpl, pl.holderName) : pl && pl.text !== 'Ombor' ? (tpl.namesScript === 'cyrl' ? latinToCyrillic(pl.text) : pl.text) : '____________________');
    let giver = storekeeper;
    let receiver = who(d.to);
    if (d.kind === 'RETURN') {
      giver = who(d.from ?? (d.to.text !== 'Ombor' ? d.to : null));
      receiver = storekeeper;
    } else if (d.kind === 'TRANSFER') {
      giver = who(d.from);
    } else if (d.kind === 'WRITE_OFF') {
      giver = storekeeper;
      receiver = personName(tpl, d.responsible);
    } else if (d.kind === 'RECEIPT') {
      giver = d.counterparty?.trim() || '____________________';
      receiver = storekeeper;
    }
    return {
      giver,
      receiver,
      storekeeper,
      storekeeperTitle: tpl.storekeeperTitle,
      supplier: d.counterparty?.trim() || '____________________',
      reason: d.reason?.trim() || '____________________',
      number: d.number,
      date: uzDate(d.date),
      city: tpl.city,
      place: d.to.text,
      from: d.from?.text ?? '',
    };
  }

  private body(d: DocView, tpl: ActTemplate): (Paragraph | Table)[] {
    const k = tpl.kinds[d.kind];
    const vars = WarehouseActs.parties(d, tpl);
    const f = (t: string) => fill(fill(t, vars), vars);
    const out: (Paragraph | Table)[] = [];
    const run = (text: string, bold = false) => new TextRun({ text, bold, font: FONT, size: ACT_SIZE });
    const para = (children: TextRun[], o: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number; before?: number; indent?: number; firstLine?: number; tabs?: boolean } = {}) =>
      new Paragraph({
        alignment: o.align,
        spacing: { after: o.after ?? 0, before: o.before ?? 0 },
        indent: o.indent || o.firstLine ? { left: o.indent, firstLine: o.firstLine } : undefined,
        tabStops: o.tabs ? [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }] : undefined,
        children,
      });

    // Tasdiqlash bloki (o'ng tomonda)
    const IND = 5600;
    if (tpl.approveHeading.trim()) out.push(para([run(tpl.approveHeading, true)], { indent: IND }));
    if (tpl.company.trim()) out.push(para([run(tpl.company)], { indent: IND }));
    if (tpl.approverPosition.trim()) out.push(para([run(tpl.approverPosition)], { indent: IND }));
    out.push(para([run(`____________ ${tpl.approverName}`)], { indent: IND }));
    out.push(para([run(cyrDate(tpl.approveDate === 'doc' ? d.date : null))], { indent: IND, after: 240 }));

    // Sarlavha
    if (k.title.trim()) out.push(para([run(f(k.title), true)], { align: AlignmentType.CENTER }));
    if (k.title2.trim()) out.push(para([run(f(k.title2), true)], { align: AlignmentType.CENTER, after: d.cancelled ? 0 : 120 }));
    if (d.cancelled) out.push(para([run('(БЕКОР ҚИЛИНГАН)', true)], { align: AlignmentType.CENTER, after: 120 }));

    // Sana — shahar
    const dateText = tpl.actDate === 'doc' ? cyrDate(d.date).replace('-йил', ' йил') : `“___” _______ ${d.date.slice(0, 4)} йил`;
    out.push(para([run(dateText), new TextRun({ children: [new Tab()], font: FONT, size: ACT_SIZE }), run(tpl.city)], { tabs: true, after: 200 }));

    // Tomonlar
    if (k.intro.trim()) out.push(para([run(f(k.intro))], { firstLine: 709 }));
    for (const line of k.parties) if (line.trim()) out.push(para([run(f(line))], { firstLine: 709 }));
    if (k.lead.trim()) out.push(para([run(f(k.lead))], { firstLine: 709, before: 120, after: 120 }));

    // Jadval: Т/р | ТМБ номи | Инвентар рақами | Ўлчов бирлиги | Миқдори | Нархи | Ҳолати
    const W = [5, 30, 14, 10, 9, 14, 18];
    const c = (text: string, i: number, bold = false) =>
      new TableCell({
        borders: BORDERS,
        width: { size: W[i]!, type: WidthType.PERCENTAGE },
        margins: { top: 40, bottom: 40, left: 60, right: 60 },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({ alignment: i === 1 ? AlignmentType.LEFT : AlignmentType.CENTER, children: [new TextRun({ text, bold, font: FONT, size: TABLE_SIZE })] })],
      });
    const rows: TableRow[] = [new TableRow({ tableHeader: true, children: tpl.columns.map((h, i) => c(h, i, true)) })];
    let n = 0;
    let qty = 0;
    for (const l of d.lines) {
      if (d.kind !== 'RECEIPT' && l.kind === 'ASSET') continue;
      n += 1;
      qty += l.qty;
      const inv = l.kind === 'ASSET' && d.kind === 'RECEIPT' ? this.inventoryRange(d, l.itemName) : l.itemCode;
      rows.push(new TableRow({ children: [String(n), l.itemName + (l.note ? ` (${l.note})` : ''), inv, l.unit || tpl.unitDefault, qtyText(l.qty), som(l.amountTiyin), tpl.conditionDefault].map((v, i) => c(v, i)) }));
    }
    if (d.kind !== 'RECEIPT') {
      for (const a of d.assets) {
        n += 1;
        qty += 1;
        rows.push(new TableRow({ children: [String(n), a.name, a.inventoryNo, tpl.unitDefault, '1', som(a.priceTiyin), (tpl.namesScript === 'cyrl' ? latinToCyrillic(a.condition?.trim() || '') : a.condition?.trim()) || tpl.conditionDefault].map((v, i) => c(v, i)) }));
      }
    }
    rows.push(new TableRow({ children: ['', tpl.totalLabel, '', '', qtyText(qty), som(d.totalTiyin), ''].map((v, i) => c(v, i, true)) }));
    out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
    out.push(para([], { after: 120 }));

    for (const line of k.closing) if (line.trim()) out.push(para([run(f(line))], { firstLine: 709, align: AlignmentType.JUSTIFIED }));
    if (k.liability.trim()) out.push(para([run(f(k.liability))], { firstLine: 709, before: 120, align: AlignmentType.JUSTIFIED }));
    if (d.note) out.push(para([run(`Изоҳ: ${d.note}`)], { firstLine: 709, before: 120 }));

    // Imzolar
    out.push(para([], { after: 120 }));
    for (const line of k.signatures) {
      if (!line.trim()) continue;
      const text = f(line);
      const at = text.indexOf(':');
      out.push(
        at > 0
          ? para([run(text.slice(0, at + 1), true), new TextRun({ children: [new Tab()], font: FONT, size: ACT_SIZE }), run(`__________ ${text.slice(at + 1).trim()}`)], { tabs: true, before: 200 })
          : para([run(text)], { before: 200 }),
      );
    }
    if (tpl.agreed.length) {
      out.push(para([run(tpl.agreedHeading, true)], { before: 280 }));
      for (const a of tpl.agreed) {
        out.push(para([run(`${a.title}:`), new TextRun({ children: [new Tab()], font: FONT, size: ACT_SIZE }), run(`__________ ${a.name}`)], { tabs: true, before: 160 }));
      }
    }
    if (tpl.footer) out.push(para([new TextRun({ text: `№ ${d.number} · «Korxona tahlil»`, font: FONT, size: 14, color: '808080' })], { before: 360 }));
    return out;
  }

  /** Kirimdagi asosiy vosita qatori uchun inventar raqamlari oralig'i */
  private inventoryRange(d: DocView, itemName: string): string {
    const list = d.assets.filter((a) => a.name === itemName).map((a) => a.inventoryNo).sort();
    if (list.length === 0) return '—';
    if (list.length === 1) return list[0]!;
    return `${list[0]} – ${list[list.length - 1]}`;
  }
}