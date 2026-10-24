import ExcelJS from 'exceljs';
import type { ChatAnswer, ChatBlock } from './chat.service';

// ═══════════════════════════════════════════════════════════
// Manba chati → Excel: har savol-javob ketma-ket — savol, tushunilgani, matn, ko'rsatkichlar, jadvallar, manba.
// Xodim kartasidan faqat asosiy maydonlar (pasport, aloqa — chiqarilmaydi).
// Matn ko'rinishi (nusxalash uchun) ham shu yerda.
// ═══════════════════════════════════════════════════════════

interface PersonLite {
  fullName?: string;
  pinfl?: string;
  position?: string | null;
  place?: string | null;
  status?: string | null;
  miya?: { unitLabel?: string | null };
  registry?: { region?: string | null; district?: string | null; department?: string | null } | null;
  sources?: string[];
}

const fmtAt = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 5 * 3600e3);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

function personRows(p: PersonLite): [string, string][] {
  return (
    [
      ['F.I.Sh.', p.fullName],
      ['JShShIR', p.pinfl],
      ['Lavozim', p.position],
      ["Bo'limi (miya)", p.miya?.unitLabel],
      ['Tuzilma', p.place],
      ['Holati', p.status],
      ['Joylashuv (baza)', [p.registry?.region, p.registry?.district, p.registry?.department].filter(Boolean).join(' · ')],
      ['Manbalar', (p.sources ?? []).join(', ')],
    ] as [string, string | null | undefined][]
  ).filter((r): r is [string, string] => Boolean(r[1]));
}

/** Javob matni (nusxalash / eksport uchun) */
export function answerText(a: ChatAnswer): string {
  const out: string[] = [`Savol: ${a.question}`];
  if (a.understood.length) out.push(`Tushunildi: ${a.understood.map((u) => `${u.label}: ${u.value}`).join('; ')}`);
  for (const b of a.blocks) out.push(...blockText(b));
  if (a.sources.length) out.push(`Manba: ${a.sources.join(' · ')}`);
  out.push(`Vaqt: ${fmtAt(a.at)}`);
  return out.join('\n');
}

function blockText(b: ChatBlock): string[] {
  switch (b.type) {
    case 'text':
      return [b.text];
    case 'metrics':
      return b.items.map((m) => `${m.label}: ${m.value}${m.sub ? ` (${m.sub})` : ''}`);
    case 'table': {
      const lines = b.title ? [b.title] : [];
      lines.push(b.columns.map((c) => c.label).join(' | '));
      for (const r of b.rows) lines.push(b.columns.map((c) => r[c.key] ?? '').join(' | '));
      if (b.total) lines.push(b.columns.map((c) => b.total![c.key] ?? '').join(' | '));
      if (b.note) lines.push(b.note);
      return lines;
    }
    case 'bars':
      return [...(b.title ? [b.title] : []), ...b.items.map((x) => `${x.label}: ${x.display}${x.sub ? ` (${x.sub})` : ''}`)];
    case 'person':
      return personRows(b.data as PersonLite).map(([k, v]) => `${k}: ${v}`);
    case 'choices':
      return [b.title, ...b.items.map((x) => `• ${x.label}${x.sub ? ` — ${x.sub}` : ''}`)];
    default:
      return [];
  }
}

export async function chatWorkbook(title: string, entries: { answer: ChatAnswer; note?: string | null; thread?: string | null }[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Korxona tahlil';
  const ws = wb.addWorksheet('Chat', { views: [{ state: 'frozen', ySplit: 2 }] });
  const W = 6;
  [34, 22, 22, 22, 22, 22].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const thin = { style: 'thin' as const, color: { argb: 'FFD1D5DB' } };
  const border: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
  const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  let r = 1;
  ws.mergeCells(r, 1, r, W);
  ws.getCell(r, 1).value = title;
  ws.getCell(r, 1).font = { bold: true, size: 14 };
  r += 1;
  ws.mergeCells(r, 1, r, W);
  ws.getCell(r, 1).value = `Manba chati · ${entries.length} ta javob · yuklab olindi ${fmtAt(new Date().toISOString())}. Javoblar tizimdagi manbalardan.`;
  ws.getCell(r, 1).font = { italic: true, color: { argb: 'FF6B7280' } };
  r += 2;

  const line = (text: string, opts: { bold?: boolean; color?: string; bg?: string; size?: number; italic?: boolean } = {}) => {
    ws.mergeCells(r, 1, r, W);
    const c = ws.getCell(r, 1);
    c.value = text;
    c.alignment = { wrapText: true, vertical: 'top' };
    c.font = { bold: opts.bold, italic: opts.italic, size: opts.size, color: opts.color ? { argb: opts.color } : undefined };
    if (opts.bg) c.fill = fill(opts.bg);
    ws.getRow(r).height = Math.min(120, 15 * Math.max(1, Math.ceil(text.length / 140)));
    r += 1;
  };
  const table = (head: string[], rows: (string | null)[][], total?: (string | null)[], rightFrom = 1) => {
    head.forEach((h, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = h;
      c.font = { bold: true };
      c.fill = fill('FFF3F4F6');
      c.border = border;
      c.alignment = { horizontal: i >= rightFrom ? 'right' : 'left', wrapText: true };
    });
    r += 1;
    for (const row of [...rows, ...(total ? [total] : [])]) {
      row.forEach((v, i) => {
        const c = ws.getCell(r, i + 1);
        c.value = v ?? '';
        c.border = border;
        c.alignment = { horizontal: i >= rightFrom ? 'right' : 'left', wrapText: true, vertical: 'top' };
        if (row === total) c.font = { bold: true };
      });
      r += 1;
    }
  };

  entries.forEach(({ answer: a, note, thread }, n) => {
    line(`${n + 1}. ${a.question}`, { bold: true, size: 12, bg: 'FFE0E7FF' });
    const meta = [fmtAt(a.at), thread ? `suhbat: ${thread}` : null, note ? `izoh: ${note}` : null].filter(Boolean).join(' · ');
    line(meta, { italic: true, color: 'FF6B7280' });
    if (a.understood.length) line(`Tushunildi: ${a.understood.map((u) => `${u.label}: ${u.value}`).join('; ')}`, { color: 'FF374151' });
    for (const b of a.blocks) {
      if (b.type === 'text') line(b.text);
      else if (b.type === 'metrics') table(b.items.map((m) => m.label), [b.items.map((m) => m.value), b.items.map((m) => m.sub ?? '')], undefined, 0);
      else if (b.type === 'table') {
        if (b.title) line(b.title, { bold: true });
        const right = b.columns.findIndex((c) => c.align === 'right');
        table(
          b.columns.map((c) => c.label),
          b.rows.map((row) => b.columns.map((c) => row[c.key] ?? '')),
          b.total ? b.columns.map((c) => b.total![c.key] ?? '') : undefined,
          right < 0 ? 99 : right,
        );
        if (b.note) line(b.note, { italic: true, color: 'FF6B7280' });
      } else if (b.type === 'bars') {
        if (b.title) line(b.title, { bold: true });
        table(['Nomi', 'Summa', 'Ulush / izoh'], b.items.map((x) => [x.label, x.display, x.sub ?? '']), undefined, 1);
      } else if (b.type === 'person') table(['Maydon', "Qiymat"], personRows(b.data as PersonLite), undefined, 99);
      else if (b.type === 'choices') line(`${b.title} ${b.items.map((x) => x.label).join('; ')}`);
    }
    if (a.sources.length) line(`Manba: ${a.sources.join(' · ')}`, { italic: true, color: 'FF6B7280' });
    r += 1;
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}