import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { RELIABILITY_LABEL, SOURCE_LABEL } from './hp.const';
import { HpService, type RunParams } from './hp.service';

// ═══════════════════════════════════════════════════════════
// Excel eksporti: A) hududlar, B) 39 xizmat, C) xodimlar rejasi, D) umumiy hisobot (alohida varaqlar).
// Hamma summalar hisoblangan natijaning o'zidan (qayta hisoblanmaydi); har faylda yaratilgan vaqt,
// prognoz davri va hisoblash versiyasi (ID, ma'lumotlar versiyasi) yoziladi.
// ═══════════════════════════════════════════════════════════

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type ExportKind = 'regions' | 'services' | 'employees' | 'full';

const MONEY = '#,##0';
const PCT = '0.0"%"';
const HEAD = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFE8EEF9' } };

const PLAN_STATUS: Record<string, string> = { CALCULATED: 'Hisoblangan', APPROVED: 'Tasdiqlangan', APPROVED_OTHER: 'Boshqa hisob tasdiqlangan' };
const METHOD: Record<string, string> = { share: 'Tarixiy ulush', perday: 'Ish kunlari bilan (bir kunlik natija × kun)' };

@Injectable()
export class HpExportService {
  constructor(private readonly hp: HpService) {}

  async build(id: string, kindRaw: string): Promise<{ buffer: Buffer; filename: string }> {
    const kind = (['regions', 'services', 'employees', 'full'] as const).find((k) => k === kindRaw);
    if (!kind) throw new BadRequestException("Eksport turi noto'g'ri");
    const meta = await this.hp.get(id);
    const { result } = await this.hp.result(id);
    const regions = await this.hp.regions(id);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Korxona tahlil — Hudud uchun reja';
    wb.created = new Date();
    const p = meta.params as RunParams;
    const info: [string, string | number][] = [
      ['Prognoz oyi', meta.targetPeriod],
      ['Tarixiy davr', `${p.historyFrom} — ${p.historyTo}`],
      ['Ma’lumotlar manbasi', SOURCE_LABEL[p.source]],
      ['Hisob ID', meta.id],
      ['Ma’lumotlar versiyasi', meta.dataVersion],
      ['Hisoblangan', new Date(meta.finishedAt ?? meta.createdAt).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' })],
      ['Fayl yaratildi', new Date().toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' })],
    ];

    if (kind === 'full') this.summarySheet(wb, result, regions, info, p);
    if (kind === 'regions' || kind === 'full') this.regionsSheet(wb, regions, info, kind === 'regions');
    if (kind === 'services' || kind === 'full') this.servicesSheet(wb, result, info, kind === 'services');
    if (kind === 'employees' || kind === 'full') this.employeesSheet(wb, result, regions, info, kind === 'employees');
    if (kind === 'full') {
      this.accuracySheet(wb, result);
      this.qualitySheet(wb, result);
      this.paramsSheet(wb, p, meta, result);
    }
    const names: Record<ExportKind, string> = { regions: 'Hududlar', services: 'Xizmatlar', employees: 'Xodimlar', full: 'Umumiy_hisobot' };
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), filename: `Hudud_reja_${meta.targetPeriod}_${names[kind]}.xlsx` };
  }

  private header(ws: ExcelJS.Worksheet, info: [string, string | number][], withInfo: boolean, cols: { h: string; w: number; fmt?: string }[]) {
    if (withInfo) {
      for (const [k, v] of info) {
        const r = ws.addRow([k, v]);
        r.getCell(1).font = { bold: true };
      }
      ws.addRow([]);
    }
    const head = ws.addRow(cols.map((c) => c.h));
    head.font = { bold: true };
    head.eachCell((c) => {
      c.fill = HEAD;
      c.alignment = { wrapText: true, vertical: 'middle' };
    });
    cols.forEach((c, i) => {
      ws.getColumn(i + 1).width = c.w;
      if (c.fmt) ws.getColumn(i + 1).numFmt = c.fmt;
    });
    ws.views = [{ state: 'frozen', ySplit: head.number }];
    return head.number;
  }

  private regionsSheet(wb: ExcelJS.Workbook, regions: Json[], info: [string, string | number][], withInfo: boolean) {
    const ws = wb.addWorksheet('Hududlar bo‘yicha prognoz');
    this.header(ws, info, withInfo, [
      { h: 'Hudud', w: 30 },
      { h: 'Oxirgi oy daromadi', w: 18, fmt: MONEY },
      { h: 'Kelasi oy prognozi', w: 18, fmt: MONEY },
      { h: 'Farq', w: 16, fmt: MONEY },
      { h: 'O‘zgarish, %', w: 12, fmt: PCT },
      { h: 'Prognoz modeli (asosiy)', w: 30 },
      { h: 'WAPE, %', w: 10, fmt: PCT },
      { h: 'Ma’lumotlar sifati', w: 20 },
      { h: 'Reja holati', w: 24 },
    ]);
    for (const r of regions)
      ws.addRow([r.name, r.lastRev, r.forecastRev, r.diff, r.changePct, r.mainModel ? `${r.mainModel.label} (${r.mainModel.count} ta xizmat)` : '—', r.wape, r.quality.label, r.plan.label]);
    const tot = ws.addRow(['Jami', sum(regions, 'lastRev'), sum(regions, 'forecastRev'), sum(regions, 'forecastRev') - sum(regions, 'lastRev'), null, '', null, '', '']);
    tot.font = { bold: true };
  }

  private servicesSheet(wb: ExcelJS.Workbook, result: Json, info: [string, string | number][], withInfo: boolean) {
    const ws = wb.addWorksheet('Xizmatlar bo‘yicha prognoz');
    this.header(ws, info, withInfo, [
      { h: 'Hudud', w: 26 },
      { h: 'Xizmat ID', w: 10 },
      { h: 'Xizmat nomi', w: 50 },
      { h: 'Oxirgi oy xizmatlar soni', w: 14 },
      { h: 'Prognoz xizmatlar soni', w: 14 },
      { h: 'Tarif', w: 12, fmt: MONEY },
      { h: 'Oxirgi oy daromadi', w: 16, fmt: MONEY },
      { h: 'Prognoz daromadi', w: 16, fmt: MONEY },
      { h: 'Model', w: 30 },
      { h: 'WAPE (soni), %', w: 12, fmt: PCT },
      { h: 'Ishonchlilik', w: 14 },
      { h: 'Izoh', w: 60 },
    ]);
    for (const g of result.regions as Json[])
      for (const s of g.services as Json[])
        ws.addRow([g.regionName, s.service, s.serviceName, s.lastQty, s.forecastQtyFinal, s.tariff, s.lastRev, s.forecastRev, s.modelLabel ?? '—', s.wape, RELIABILITY_LABEL[s.reliability] ?? '', s.reason]);
  }

  private employeesSheet(wb: ExcelJS.Workbook, result: Json, regions: Json[], info: [string, string | number][], withInfo: boolean) {
    const ws = wb.addWorksheet('Xodimlar bo‘yicha reja');
    this.header(ws, info, withInfo, [
      { h: 'Hudud', w: 24 },
      { h: 'Xodim ID', w: 17 },
      { h: 'Xodim F.I.Sh.', w: 34 },
      { h: 'Xizmat ID', w: 10 },
      { h: 'Xizmat nomi', w: 44 },
      { h: 'Tarixiy daromad', w: 16, fmt: MONEY },
      { h: 'Reja ulushi, %', w: 12, fmt: PCT },
      { h: 'Belgilangan reja', w: 16, fmt: MONEY },
      { h: 'Jami reja (xodim)', w: 16, fmt: MONEY },
      { h: 'Reja holati', w: 22 },
    ]);
    for (const g of result.regions as Json[]) {
      const emp = g.employees;
      if (!emp) continue;
      const status = PLAN_STATUS[regions.find((r) => r.code === g.region)?.plan?.status ?? 'CALCULATED'];
      for (const e of emp.employees as Json[]) {
        if (!(e.services as Json[]).length) ws.addRow([g.regionName, e.pinfl, e.name, '', '', 0, 0, 0, e.plan, status]);
        for (const s of e.services as Json[]) ws.addRow([g.regionName, e.pinfl, e.name, s.service, s.serviceName, s.hist, (s.share ?? 0) * 100, s.plan, e.plan, status]);
      }
      for (const u of emp.unallocated as Json[]) {
        const row = ws.addRow([g.regionName, '—', 'TAQSIMLANMAGAN', u.service, u.serviceName, null, null, u.amount, null, u.reason]);
        row.font = { italic: true, color: { argb: 'FFB45309' } };
      }
      const chk = ws.addRow([`${g.regionName} — tekshiruv`, '', `Hudud prognozi ${emp.check.regionForecast}, xodimlar ${emp.check.employeesTotal}, taqsimlanmagan ${emp.check.unallocated}, farq ${emp.check.diff}`]);
      chk.font = { bold: true };
    }
  }

  private summarySheet(wb: ExcelJS.Workbook, result: Json, regions: Json[], info: [string, string | number][], p: RunParams) {
    const ws = wb.addWorksheet('Umumiy ko‘rsatkichlar');
    ws.getColumn(1).width = 40;
    ws.getColumn(2).width = 30;
    const t = ws.addRow(['Hudud uchun reja — umumiy hisobot']);
    t.font = { bold: true, size: 14 };
    ws.addRow([]);
    for (const [k, v] of info) ws.addRow([k, v]).getCell(1).font = { bold: true };
    ws.addRow([]);
    const last = sum(regions, 'lastRev');
    const fc = result.total.forecastRev;
    const rows: [string, number | string | null, string?][] = [
      ['Oxirgi oy haqiqiy daromadi', last, MONEY],
      ['Kelasi oy prognoz daromadi', fc, MONEY],
      ['O‘zgarish', fc - last, MONEY],
      ['O‘zgarish, %', last ? ((fc - last) / last) * 100 : null, PCT],
      ['Tarixiy testdagi xato (WAPE, jami daromad), %', result.total.accuracy?.wape ?? null, PCT],
      ['Test oylari soni', result.total.accuracy?.points ?? 0],
      ['Hududlar soni', regions.length],
      ['Rejasi hisoblangan xodimlar', (result.regions as Json[]).reduce((a, g) => a + ((g.employees?.employees as Json[]) ?? []).filter((e) => e.plan > 0).length, 0)],
      ['Taqsimlanmagan reja', (result.regions as Json[]).reduce((a, g) => a + (g.employees?.unallocatedTotal ?? 0), 0), MONEY],
      ['Taqsimlash usuli', METHOD[p.allocation.method]],
    ];
    for (const [k, v, f] of rows) {
      const r = ws.addRow([k, v]);
      if (f) r.getCell(2).numFmt = f;
    }
    ws.addRow([]);
    ws.addRow(['Izoh: xato tanlangan modellar bo‘yicha; model tanlovi ham shu test oylarida qilingani uchun baho biroz optimistik bo‘lishi mumkin.']);
  }

  private accuracySheet(wb: ExcelJS.Workbook, result: Json) {
    const ws = wb.addWorksheet('Model aniqligi');
    this.header(ws, [], false, [
      { h: 'Hudud', w: 24 },
      { h: 'Xizmat ID', w: 10 },
      { h: 'Model', w: 34 },
      { h: 'Tanlangan', w: 10 },
      { h: 'Test oylari', w: 10 },
      { h: 'MAE (soni)', w: 12, fmt: '0.00' },
      { h: 'RMSE (soni)', w: 12, fmt: '0.00' },
      { h: 'WAPE (soni), %', w: 12, fmt: PCT },
      { h: 'WAPE (daromad), %', w: 12, fmt: PCT },
      { h: 'Daromad MAE', w: 14, fmt: MONEY },
    ]);
    for (const g of result.regions as Json[])
      for (const s of g.services as Json[])
        for (const m of (s.models as Json[]) ?? []) ws.addRow([g.regionName, s.service, m.label, m.model === s.model ? 'ha' : '', m.points, m.mae, m.rmse, m.wape, m.revWape ?? null, m.revMae ?? null]);
    ws.addRow([]);
    const t = ws.addRow(['Hududlar bo‘yicha (jami daromad)']);
    t.font = { bold: true };
    for (const g of result.regions as Json[]) ws.addRow([g.regionName, '', 'Tanlangan modellar', '', g.accuracy?.points ?? 0, g.accuracy?.mae ?? null, g.accuracy?.rmse ?? null, g.accuracy?.wape ?? null]);
  }

  private qualitySheet(wb: ExcelJS.Workbook, result: Json) {
    const ws = wb.addWorksheet('Ma’lumotlar sifati');
    this.header(ws, [], false, [
      { h: 'Hudud', w: 24 },
      { h: 'Xizmat ID', w: 10 },
      { h: 'Kuzatuvlar (oy)', w: 12 },
      { h: 'Uzilgan oylar', w: 12 },
      { h: 'Uzlukli talab', w: 12 },
      { h: 'Tarif manbai', w: 16 },
      { h: 'Daromad − soni×tarif, %', w: 14, fmt: PCT },
      { h: 'Keskin o‘zgarishlar', w: 40 },
      { h: 'Izohlar', w: 60 },
    ]);
    for (const g of result.regions as Json[])
      for (const s of g.services as Json[])
        ws.addRow([
          g.regionName,
          s.service,
          s.observations,
          s.gaps,
          s.intermittent ? 'ha' : '',
          s.tariffSource === 'catalog' ? 'Katalog' : s.tariffSource === 'implied' ? 'Haqiqiy o‘rtacha narx' : 'Yo‘q',
          s.formulaGap?.pct ?? null,
          ((s.outliers as Json[]) ?? []).map((o) => `${o.month}: ${o.value}`).join('; '),
          [...((s.notes as string[]) ?? [])].join('; '),
        ]);
  }

  private paramsSheet(wb: ExcelJS.Workbook, p: RunParams, meta: Json, result: Json) {
    const ws = wb.addWorksheet('Hisoblash parametrlari');
    ws.getColumn(1).width = 34;
    ws.getColumn(2).width = 60;
    const rows: [string, string | number][] = [
      ['Hisob ID', meta.id],
      ['Ma’lumotlar versiyasi (xesh)', meta.dataVersion],
      ['Prognoz oyi', p.targetPeriod],
      ['Tarixiy davr', `${p.historyFrom} — ${p.historyTo}`],
      ['Hududlar', p.regions?.join(', ') ?? 'Hammasi'],
      ['Manba', SOURCE_LABEL[p.source]],
      ['Tarixiy test oylari', p.backtestMonths],
      ['Model tanlash', p.selection === 'auto' ? 'Avtomatik (WAPE bo‘yicha, teng bo‘lsa soddarog‘i)' : String(result.modelLabels?.[p.selection] ?? p.selection)],
      ['Xizmatlar sonini yaxlitlash', p.roundQuantity ? 'ha' : 'yo‘q'],
      ['Taqsimlash usuli', METHOD[p.allocation.method]],
      ['Taqsimlash oynasi (oy)', p.allocation.window],
      ['Yangi xodimlar', p.allocation.newEmployees ? 'O‘xshash xodimlar medianasi bo‘yicha' : 'Qo‘lda'],
      ['Hisoblash dvigateli', String(result.engine ?? 'apps/analytics')],
      ['Hisoblash vaqti, ms', Number(result.tookMs ?? 0)],
    ];
    for (const [k, v] of rows) ws.addRow([k, v]).getCell(1).font = { bold: true };
  }
}

function sum(rows: Json[], k: string): number {
  return rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
}