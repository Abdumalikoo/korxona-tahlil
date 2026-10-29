import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { ASSET_MODES, FixedAssetsService, MODE_LABEL, type AssetMode } from './fixed-assets.service';
import { bookValue, periodOf, TASHKENT_MS } from './fixed-assets.util';
import { CENTRAL_REGION } from '../../common/segments/segments';

// ═══════════════════════════════════════════════════════════
// Asosiy vositalar — balans hisoboti (sanaga): qayerda, kimda, qancha.
//   «Balansda» — eskirish bilan va xarajatsiz turganlar (qoldiq qiymati bilan);
//   «Xarajatga o'tkazilgan» — alohida bo'lim (balansda emas, Markaz xarajatida).
// Guruh: joy (hudud / Markaz bo'limi) → qabul qiluvchi → vositalar. Excel'ga ham chiqadi.
// ═══════════════════════════════════════════════════════════


export interface ReportItem {
  id: string;
  date: string;
  name: string;
  inventoryNo: string | null;
  quantity: number;
  costTiyin: string;
  residualTiyin: string;
  holderName: string | null;
  placeText: string | null;
  mode: AssetMode;
  modeLabel: string;
  source: string;
}

export interface ReportGroup {
  key: string;
  label: string;
  kind: 'region' | 'center';
  count: number;
  quantity: number;
  costTiyin: string;
  residualTiyin: string;
  holders: { name: string; count: number; costTiyin: string }[];
  items: ReportItem[];
}

export interface BalanceReport {
  at: string;
  balance: { count: number; quantity: number; costTiyin: string; residualTiyin: string; holdCount: number; holdTiyin: string; groups: ReportGroup[] };
  expensed: { count: number; costTiyin: string; groups: ReportGroup[] };
}

function dayIso(d: Date): string {
  return new Date(d.getTime() + TASHKENT_MS).toISOString().slice(0, 10);
}

@Injectable()
export class FixedAssetReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: FixedAssetsService,
  ) {}

  async report(atInput?: string, batch?: string): Promise<BalanceReport> {
    const today = new Date(Date.now() + TASHKENT_MS).toISOString().slice(0, 10);
    const at = atInput && /^\d{4}-\d{2}-\d{2}$/.test(atInput) ? atInput : today;
    if (at > today) throw new BadRequestException("Kelajak sanasi uchun hisobot yo'q");
    await this.assets.sync().catch(() => null);
    const end = new Date(Date.UTC(Number(at.slice(0, 4)), Number(at.slice(5, 7)) - 1, Number(at.slice(8, 10)) + 1) - TASHKENT_MS);
    const period = at.slice(0, 7);
    const [rows, regions, depts] = await Promise.all([
      this.prisma.fixedAsset.findMany({ where: { deletedAt: null, acquiredAt: { lt: end }, ...(batch ? { importBatch: batch } : {}) }, orderBy: [{ acquiredAt: 'asc' }, { name: 'asc' }] }),
      this.prisma.region.findMany({ select: { code: true, name: true } }),
      this.prisma.department.findMany({ select: { id: true, name: true } }),
    ]);
    const regionName = new Map(regions.map((r) => [r.code, r.name]));
    const deptName = new Map(depts.map((d) => [d.id, d.name]));

    const build = (list: typeof rows, residualOf: (r: (typeof rows)[number]) => bigint): ReportGroup[] => {
      type Acc = ReportGroup & { cost: bigint; residual: bigint; holderMap: Map<string, { count: number; cost: bigint }> };
      const groups = new Map<string, Acc>();
      for (const r of list) {
        const isRegion = r.regionCode !== null && r.regionCode !== CENTRAL_REGION;
        const key = isRegion ? `r:${r.regionCode}` : r.departmentId ? `d:${r.departmentId}` : 'center';
        const label = isRegion ? (regionName.get(r.regionCode!) ?? `Hudud ${r.regionCode}`) : r.departmentId ? `Markaz › ${deptName.get(r.departmentId) ?? "bo'lim"}` : 'Markaz';
        const g: Acc =
          groups.get(key) ??
          { key, label, kind: isRegion ? 'region' : 'center', count: 0, quantity: 0, costTiyin: '0', residualTiyin: '0', holders: [], items: [], cost: 0n, residual: 0n, holderMap: new Map() };
        const residual = residualOf(r);
        const mode = ((ASSET_MODES as string[]).includes(r.mode) ? r.mode : 'BALANCE') as AssetMode;
        g.count += 1;
        g.quantity += r.quantity ?? 1;
        g.cost += r.costTiyin;
        g.residual += residual;
        const holder = r.holderName?.trim() || "Ko'rsatilmagan";
        const h = g.holderMap.get(holder) ?? { count: 0, cost: 0n };
        h.count += 1;
        h.cost += r.costTiyin;
        g.holderMap.set(holder, h);
        g.items.push({
          id: r.id,
          date: dayIso(r.acquiredAt),
          name: r.name,
          inventoryNo: r.inventoryNo,
          quantity: r.quantity ?? 1,
          costTiyin: r.costTiyin.toString(),
          residualTiyin: residual.toString(),
          holderName: r.holderName,
          placeText: r.placeText,
          mode,
          modeLabel: MODE_LABEL[mode],
          source: r.source,
        });
        groups.set(key, g);
      }
      return [...groups.values()]
        .map(({ cost, residual, holderMap, ...g }) => ({
          ...g,
          costTiyin: cost.toString(),
          residualTiyin: residual.toString(),
          holders: [...holderMap.entries()].map(([name, h]) => ({ name, count: h.count, costTiyin: h.cost.toString() })).sort((a, b) => b.count - a.count),
        }))
        .sort((a, b) => (a.kind === b.kind ? (BigInt(b.costTiyin) > BigInt(a.costTiyin) ? 1 : -1) : a.kind === 'center' ? -1 : 1));
    };

    const onBalance = rows.filter((r) => r.mode !== 'EXPENSE' && !(r.disposedAt && periodOf(r.disposedAt) <= period));
    const expensed = rows.filter((r) => r.mode === 'EXPENSE');
    const residualOf = (r: (typeof rows)[number]) => (r.mode === 'HOLD' ? r.costTiyin : bookValue(r, period).residual);
    const balanceGroups = build(onBalance, residualOf);
    const expensedGroups = build(expensed, () => 0n);
    const sum = (list: typeof rows) => list.reduce((s, r) => s + r.costTiyin, 0n);
    return {
      at,
      balance: {
        count: onBalance.length,
        quantity: onBalance.reduce((s, r) => s + (r.quantity ?? 1), 0),
        costTiyin: sum(onBalance).toString(),
        residualTiyin: onBalance.reduce((s, r) => s + residualOf(r), 0n).toString(),
        holdCount: onBalance.filter((r) => r.mode === 'HOLD').length,
        holdTiyin: sum(onBalance.filter((r) => r.mode === 'HOLD')).toString(),
        groups: balanceGroups,
      },
      expensed: { count: expensed.length, costTiyin: sum(expensed).toString(), groups: expensedGroups },
    };
  }

  /** Excel: «Joylar bo'yicha», «Balansdagi vositalar», «Xarajatga o'tkazilgan» */
  async excel(at?: string, batch?: string): Promise<{ buffer: Buffer; filename: string }> {
    const r = await this.report(at, batch);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Korxona tahlil';
    const money = '#,##0.00';
    const som = (t: string) => Number(t) / 100;
    const head = (ws: ExcelJS.Worksheet, titles: string[], widths: number[]) => {
      const row = ws.addRow(titles);
      row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      row.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
        c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      });
      row.height = 30;
      widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
      ws.views = [{ state: 'frozen', ySplit: row.number }];
    };
    const title = (ws: ExcelJS.Worksheet, text: string) => {
      ws.addRow([text]).font = { bold: true, size: 13 };
      ws.addRow([`Holat: ${r.at.split('-').reverse().join('.')}${batch ? ` · partiya: ${batch}` : ''}`]).font = { italic: true, color: { argb: 'FF64748B' } };
      ws.addRow([]);
    };

    // 1) Joylar bo'yicha
    const s = wb.addWorksheet("Joylar bo'yicha");
    title(s, "Asosiy vositalar balansi — joylar bo'yicha");
    head(s, ['Joy (hudud / Markaz bo\'limi)', 'Vositalar', 'Soni (dona)', "Boshlang'ich qiymat, so'm", "Qoldiq qiymat, so'm", 'Qabul qiluvchilar'], [38, 11, 11, 20, 20, 60]);
    for (const g of r.balance.groups) {
      const row = s.addRow([g.label, g.count, g.quantity, som(g.costTiyin), som(g.residualTiyin), g.holders.map((h) => `${h.name} (${h.count})`).join(', ')]);
      row.getCell(4).numFmt = money;
      row.getCell(5).numFmt = money;
      row.getCell(6).alignment = { wrapText: true, vertical: 'top' };
    }
    const tot = s.addRow(['JAMI balansda', r.balance.count, r.balance.quantity, som(r.balance.costTiyin), som(r.balance.residualTiyin), '']);
    tot.font = { bold: true };
    tot.getCell(4).numFmt = money;
    tot.getCell(5).numFmt = money;
    if (r.expensed.count) {
      s.addRow([]);
      const ex = s.addRow(["Xarajatga o'tkazilgan (Markaz xarajatida, balansda emas)", r.expensed.count, '', som(r.expensed.costTiyin), 0, '']);
      ex.font = { italic: true };
      ex.getCell(4).numFmt = money;
    }

    // 2) Balansdagi vositalar ro'yxati
    const list = (name: string, groups: ReportGroup[], heading: string) => {
      const ws = wb.addWorksheet(name);
      title(ws, heading);
      head(ws, ['T/r', 'Sana', 'Nomi', 'Inventar raqami', 'Soni', "Qiymat, so'm", "Qoldiq, so'm", 'Joy', "Bo'lim (faylda)", 'Qabul qiluvchi', 'Rejim'], [6, 12, 40, 16, 7, 16, 16, 30, 34, 26, 24]);
      let n = 0;
      for (const g of groups) {
        const gr = ws.addRow([`${g.label} — ${g.count} ta, ${(som(g.costTiyin)).toLocaleString('ru-RU')} so'm`]);
        gr.font = { bold: true };
        gr.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
        ws.mergeCells(gr.number, 1, gr.number, 11);
        for (const it of g.items) {
          n += 1;
          const row = ws.addRow([n, it.date.split('-').reverse().join('.'), it.name, it.inventoryNo ?? '', it.quantity, som(it.costTiyin), som(it.residualTiyin), g.label, it.placeText ?? '', it.holderName ?? '', it.modeLabel]);
          row.getCell(6).numFmt = money;
          row.getCell(7).numFmt = money;
        }
      }
    };
    list('Balansdagi vositalar', r.balance.groups, 'Balansdagi asosiy vositalar (xarajatga o\'tmagan)');
    if (r.expensed.count) list("Xarajatga o'tkazilgan", r.expensed.groups, "Xarajatga o'tkazilgan asosiy vositalar (Markaz xarajati)");

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return { buffer, filename: `asosiy-vositalar-balans-${r.at}.xlsx` };
  }
}