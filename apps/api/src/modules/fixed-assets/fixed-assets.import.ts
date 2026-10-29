import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { AuditService } from '../audit/audit.service';
import { ASSET_INVENTORY_CATEGORY, ensureCenterCategories } from '../expense-policy/policy.util';
import { translit } from '../leases/leases.match';
import { PrismaService } from '../prisma/prisma.service';
import { cellText, cellValue, parseNumber } from '../salary-composition/salary-composition.excel';
import { ASSET_MODES, FixedAssetsService, MODE_LABEL, type AssetMode } from './fixed-assets.service';
import { TASHKENT_MS } from './fixed-assets.util';
import { assertSafeXlsx } from '../../common/files/xlsx-guard';
import { assertAmount } from '../../common/validation/amount';
import { REGION_GENERAL } from '../../common/segments/segments';

// ═══════════════════════════════════════════════════════════
// Asosiy vositalar — Excel'dan yuklash (xodimlarga berilgan inventar).
//
// Fayl ustunlari (sarlavha bo'yicha topiladi): Sana, Mahsulot nomi, Inventar raqami, Miqdori, Summasi,
// Umumiy summa, Bo'lim, Qabul qiluvchi, Holati.
// Avval tahlil: har bir «Bo'lim» uchun joy taklif qilinadi (hudud yoki Markaz / Markaz bo'limi) — foydalanuvchi
// o'zgartira oladi; so'ng saqlash tanlangan rejimda:
//   HOLD — faqat balansda (xarajatga o'tmaydi), EXPENSE — xarajatga (Markaz), BALANCE — balansda, eskirish bilan.
// Bazada shu inventar raqamli vosita bo'lsa — qayta yozilmaydi.
// ═══════════════════════════════════════════════════════════

const CENTRAL_REGION = 0;
const MAX_SIZE = 10 * 1024 * 1024;
const MAX_ROWS = 5000;

const COLUMNS = {
  date: ['sana', 'berilgansana', 'date'],
  name: ['mahsulotnomi', 'nomi', 'mahsulot', 'vosita', 'jihoz'],
  inv: ['inventarraqami', 'inventar', 'invraqam', 'inv'],
  qty: ['miqdori', 'miqdor', 'soni'],
  price: ['summasi', 'narxi', 'birnarx'],
  total: ['umumiysumma', 'jamisumma', 'umumiy', 'jami'],
  place: ['bolim', 'joyi', 'hudud', 'bolinma'],
  holder: ['qabulqiluvchi', 'qabul', 'masul', 'xodim', 'kimga'],
  condition: ['holati', 'holat'],
} as const;
type Col = keyof typeof COLUMNS;

/** Solishtirish kaliti: lotin, kichik harf, belgilarsiz */
function key(text: string): string {
  return translit(text).replace(/[^a-z0-9]/g, '');
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Toshkent kuni (00:00) */
function dayOf(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d) - TASHKENT_MS);
}

/** Sana: Excel sanasi, "30.03.2026", "2026-03-30". Mavjud bo'lmagan kun (30.02) — oyning oxirgi kuni */
function parseDate(raw: unknown): { date: Date | null; warning: string | null } {
  if (raw instanceof Date) return { date: dayOf(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate()), warning: null };
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) {
    const d = new Date(Math.round((raw - 25569) * 86400 * 1000));
    return { date: dayOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), warning: null };
  }
  const text = String(raw ?? '').trim();
  let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(text);
  let y: number, mo: number, d: number;
  if (m) {
    d = Number(m[1]);
    mo = Number(m[2]);
    y = Number(m[3]!.length === 2 ? `20${m[3]}` : m[3]!.length === 3 ? `2${m[3]}` : m[3]);
  } else if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text))) {
    y = Number(m[1]);
    mo = Number(m[2]);
    d = Number(m[3]);
  } else return { date: null, warning: text ? `Sana tanilmadi: «${text}»` : null };
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return { date: null, warning: `Sana noto'g'ri: «${text}»` };
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > last) return { date: dayOf(y, mo, last), warning: `«${text}» — bunday kun yo'q, ${pad(last)}.${pad(mo)}.${y} olindi` };
  return { date: dayOf(y, mo, d), warning: null };
}

/** Bir xil vositani tanish uchun: inventar raqami, nomi, sanasi, joyi, qabul qiluvchisi, summasi */
function signature(inv: string | null, name: string, date: string | null, place: string, holder: string | null, cost: string): string {
  return [inv ?? '', key(name), date ?? '', key(place), key(holder ?? ''), cost].join('|');
}

export interface ImportRowView {
  row: number;
  date: string | null;
  name: string;
  inventoryNo: string | null;
  quantity: number;
  priceTiyin: string;
  costTiyin: string;
  placeText: string;
  holderName: string | null;
  condition: string | null;
  warnings: string[];
  errors: string[];
  /** Bazada xuddi shu vosita (inventar raqami, nomi, sanasi, joyi, qabul qiluvchisi, summasi bir xil) bor — qayta yozilmaydi */
  exists: boolean;
  /** Faylda shu inventar raqami boshqa qatorda ham bor (ikkalasi ham yoziladi — tekshirib ko'ring) */
  duplicate: boolean;
}

export interface PlaceSuggestion {
  placeText: string;
  count: number;
  totalTiyin: string;
  /** "r:3" — hudud; "center" — Markaz; "d:<id>" — Markaz bo'limi */
  target: string;
  targetLabel: string;
  /** Qanday topildi — foydalanuvchiga izoh */
  reason: string;
}

export interface AssetImportAnalysis {
  fileName: string;
  total: number;
  ok: number;
  errors: number;
  exists: number;
  duplicates: number;
  zeroPrice: number;
  totalTiyin: string;
  byMonth: { period: string; count: number; totalTiyin: string }[];
  places: PlaceSuggestion[];
  targets: { value: string; label: string; group: string }[];
  rows: ImportRowView[];
}

export interface AssetImportCommit {
  fileName?: string;
  batch?: string;
  mode?: string;
  /** placeText → target */
  mapping?: Record<string, string>;
  rows?: ImportRowView[];
}

@Injectable()
export class FixedAssetImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: FixedAssetsService,
    private readonly audit: AuditService,
  ) {}

  private async references() {
    const [regions, departments] = await Promise.all([
      this.prisma.region.findMany({ where: { code: { not: REGION_GENERAL } }, select: { code: true, name: true }, orderBy: { code: 'asc' } }),
      this.prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: [{ order: 'asc' }, { name: 'asc' }] }),
    ]);
    return { regions, departments };
  }

  private targets(refs: Awaited<ReturnType<FixedAssetImportService['references']>>) {
    return [
      { value: 'center', label: 'Markaz (umumiy)', group: 'Markaz' },
      ...refs.departments.map((d) => ({ value: `d:${d.id}`, label: `Markaz › ${d.name}`, group: "Markaz bo'limlari" })),
      ...refs.regions.filter((r) => r.code !== CENTRAL_REGION).map((r) => ({ value: `r:${r.code}`, label: r.name, group: 'Hududlar' })),
    ];
  }

  /** Bo'lim matnidan joy taklifi: hudud nomi bo'lsa — hudud, Markaz bo'limi nomi bo'lsa — o'sha bo'lim, aks holda Markaz */
  private suggest(text: string, refs: Awaited<ReturnType<FixedAssetImportService['references']>>): { target: string; reason: string } {
    const k = key(text);
    // Markaz bo'limi: nomi to'liq yoki qisman mos
    for (const d of refs.departments) {
      const dk = key(d.name);
      if (dk.length >= 4 && (k === dk || (k.length >= 5 && dk.includes(k)) || (dk.length >= 6 && k.includes(dk)))) {
        return { target: `d:${d.id}`, reason: `Markaz bo'limi nomi mos: «${d.name}»` };
      }
    }
    // Hudud: viloyat nomi matnda uchrasa
    const hasToshkent = k.includes('toshkent') || k.includes('tashkent');
    const cityWords = ['shahar', 'shahri', 'shaxar', 'shaxri'];
    for (const r of refs.regions) {
      if (r.code === CENTRAL_REGION) continue;
      const rk = key(r.name);
      const base = rk.replace(/(viloyati|viloyat|respublikasi|respublika|shahri|shahar)$/, '');
      if (base.startsWith('toshkent')) continue;
      const stems = [base, base.slice(0, Math.max(5, base.length - 3))];
      if (base.startsWith('qoraqalpog')) stems.push('qoraqolpog', 'qoraqalpoq', 'karakalpak', 'nukus');
      if (base.startsWith('fargona')) stems.push('fargon', 'fergan');
      if (base.startsWith('xorazm')) stems.push('xorezm', 'urganch');
      if (base.startsWith('surxondaryo')) stems.push('surxon', 'termiz');
      if (base.startsWith('qashqadaryo')) stems.push('qashqa', 'qarshi');
      if (base.startsWith('sirdaryo')) stems.push('sirdar', 'guliston');
      if (stems.some((s) => s.length >= 4 && k.includes(s))) return { target: `r:${r.code}`, reason: `Matnda hudud nomi bor: «${r.name}»` };
    }
    if (hasToshkent) {
      const city = refs.regions.find((r) => key(r.name).startsWith('toshkent') && /shah/.test(key(r.name)));
      const region = refs.regions.find((r) => key(r.name).startsWith('toshkent') && /viloyat/.test(key(r.name)));
      if (k.includes('viloyat') && region) return { target: `r:${region.code}`, reason: `Matnda «Toshkent viloyati»` };
      if (city && (cityWords.some((w) => k.includes(w)) || !region)) return { target: `r:${city.code}`, reason: `Matnda «Toshkent shahar»` };
      if (region) return { target: `r:${region.code}`, reason: 'Matnda «Toshkent»' };
    }
    return { target: 'center', reason: "Hudud yoki Markaz bo'limi nomi topilmadi — Markaz (umumiy). Kerak bo'lsa o'zgartiring" };
  }

  /** Bazadagi Excel'dan yuklangan vositalar: «imzo» → soni */
  private async existingSignatures(): Promise<Map<string, number>> {
    const rows = await this.prisma.fixedAsset.findMany({
      where: { deletedAt: null, source: 'IMPORT' },
      select: { inventoryNo: true, name: true, acquiredAt: true, placeText: true, holderName: true, costTiyin: true },
    });
    const map = new Map<string, number>();
    for (const a of rows) {
      const sig = signature(a.inventoryNo, a.name, new Date(a.acquiredAt.getTime() + TASHKENT_MS).toISOString().slice(0, 10), a.placeText ?? '', a.holderName, a.costTiyin.toString());
      map.set(sig, (map.get(sig) ?? 0) + 1);
    }
    return map;
  }

  // ═══════════ Tahlil ═══════════

  async analyze(file: Express.Multer.File | undefined): Promise<AssetImportAnalysis> {
    if (!file?.buffer?.length) throw new BadRequestException('Fayl tanlanmagan');
    if (file.size > MAX_SIZE) throw new BadRequestException('Fayl hajmi 10 MB dan oshmasin');
    const wb = new ExcelJS.Workbook();
    await assertSafeXlsx(file.buffer);
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException("Faylni o'qib bo'lmadi — .xlsx formatida saqlang");
    }

    // Sarlavha: eng ko'p ustun tanilgan varaq va qator
    let best: { sheet: ExcelJS.Worksheet; row: number; cols: Map<Col, number> } | null = null;
    for (const sheet of wb.worksheets) {
      for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
        const found = new Map<Col, number>();
        sheet.getRow(r).eachCell((cell, col) => {
          const t = key(cellText(cell.value));
          if (!t) return;
          for (const [c, aliases] of Object.entries(COLUMNS) as [Col, readonly string[]][]) {
            if (found.has(c)) continue;
            if (aliases.some((a) => t === a || t.startsWith(a))) {
              found.set(c, col);
              break;
            }
          }
        });
        if (!best || found.size > best.cols.size) best = { sheet, row: r, cols: found };
      }
    }
    if (!best || !best.cols.has('name') || (!best.cols.has('total') && !best.cols.has('price')) || !best.cols.has('place')) {
      throw new BadRequestException("Ustunlar topilmadi: kamida «Mahsulot nomi», «Summasi» yoki «Umumiy summa» va «Bo'lim» bo'lsin");
    }
    const { sheet, row: headerRow, cols } = best;
    const raw = (r: ExcelJS.Row, c: Col) => (cols.has(c) ? cellValue(r.getCell(cols.get(c)!).value) : null);
    const text = (r: ExcelJS.Row, c: Col) => (cols.has(c) ? cellText(r.getCell(cols.get(c)!).value) : '');

    const inDb = await this.existingSignatures();
    const invCount = new Map<string, number>();
    const rows: ImportRowView[] = [];
    for (let r = headerRow + 1; r <= sheet.rowCount && rows.length < MAX_ROWS; r++) {
      const row = sheet.getRow(r);
      const name = text(row, 'name');
      const placeText = text(row, 'place');
      if (!name && !placeText) continue;
      if (/^(jami|итого|всего)/i.test(name)) continue;
      const errors: string[] = [];
      const warnings: string[] = [];
      if (!name) errors.push("Nomi yo'q");
      const d = parseDate(raw(row, 'date'));
      if (d.warning) (d.date ? warnings : errors).push(d.warning);
      if (!d.date && !d.warning) errors.push("Sana yo'q");
      const qtyN = parseNumber(row.getCell(cols.get('qty') ?? 9999).value);
      const quantity = qtyN !== null && Number.isFinite(qtyN) && qtyN > 0 ? Math.max(1, Math.round(qtyN)) : 1;
      const priceN = cols.has('price') ? parseNumber(row.getCell(cols.get('price')!).value) : null;
      const totalN = cols.has('total') ? parseNumber(row.getCell(cols.get('total')!).value) : null;
      const price = priceN !== null && Number.isFinite(priceN) ? priceN : null;
      let total = totalN !== null && Number.isFinite(totalN) ? totalN : null;
      if (total === null && price !== null) total = price * quantity;
      if (total === null) total = 0;
      if (total < 0) errors.push("Summa manfiy bo'lmasin");
      if (price !== null && totalN !== null && Math.abs(price * quantity - totalN) > 1) warnings.push(`Summasi × miqdori (${price} × ${quantity}) umumiy summaga teng emas — umumiy summa olindi`);
      if (total === 0) warnings.push("Narxi ko'rsatilmagan — 0 so'm bilan balansga yoziladi (keyin narxini kiritish mumkin)");
      const invRaw = text(row, 'inv').trim();
      const inventoryNo = invRaw && !/^[0s.\-—]*$/i.test(invRaw) && /\d/.test(invRaw) ? invRaw : null;
      if (!placeText) warnings.push("Bo'lim ko'rsatilmagan — Markaz");
      const condition = text(row, 'condition') || null;
      const dateIso = d.date ? new Date(d.date.getTime() + TASHKENT_MS).toISOString().slice(0, 10) : null;
      const costT = String(Math.round(total * 100));
      const holder = text(row, 'holder') || null;
      // Bazada bormi: xuddi shunday qatorlar soni bo'yicha (qayta yuklansa — ikki marta yozilmaydi)
      const sig = signature(inventoryNo, name, dateIso, placeText.replace(/\s+/g, ' ').trim(), holder, costT);
      const left = inDb.get(sig) ?? 0;
      const exists = left > 0;
      if (exists) inDb.set(sig, left - 1);
      if (inventoryNo) invCount.set(inventoryNo, (invCount.get(inventoryNo) ?? 0) + 1);
      rows.push({
        row: r,
        date: dateIso,
        name: name.slice(0, 300),
        inventoryNo,
        quantity,
        priceTiyin: String(Math.round((price ?? (quantity ? total / quantity : 0)) * 100)),
        costTiyin: costT,
        placeText: placeText.replace(/\s+/g, ' ').trim(),
        holderName: holder,
        condition,
        warnings,
        errors,
        exists,
        duplicate: false,
      });
    }
    if (!rows.length) throw new BadRequestException("Faylda ma'lumot qatori yo'q");
    for (const r of rows) {
      if (r.inventoryNo && (invCount.get(r.inventoryNo) ?? 0) > 1) {
        r.duplicate = true;
        r.warnings.push(`Inventar raqami ${r.inventoryNo} faylda ${invCount.get(r.inventoryNo)} marta — har biri alohida vosita sifatida yoziladi, tekshirib ko'ring`);
      }
    }

    const refs = await this.references();
    const placeMap = new Map<string, { count: number; total: bigint }>();
    for (const r of rows) {
      if (r.errors.length) continue;
      const g = placeMap.get(r.placeText) ?? { count: 0, total: 0n };
      g.count += 1;
      g.total += BigInt(r.costTiyin);
      placeMap.set(r.placeText, g);
    }
    const targets = this.targets(refs);
    const labelOf = new Map(targets.map((t) => [t.value, t.label]));
    const places = [...placeMap.entries()]
      .map(([placeText, g]) => {
        const s = this.suggest(placeText, refs);
        return { placeText, count: g.count, totalTiyin: g.total.toString(), target: s.target, targetLabel: labelOf.get(s.target) ?? 'Markaz', reason: placeText ? s.reason : "Bo'lim ko'rsatilmagan" };
      })
      .sort((a, b) => b.count - a.count);

    const okRows = rows.filter((r) => !r.errors.length && !r.exists);
    const months = new Map<string, { count: number; total: bigint }>();
    for (const r of okRows) {
      const p = r.date!.slice(0, 7);
      const g = months.get(p) ?? { count: 0, total: 0n };
      g.count += 1;
      g.total += BigInt(r.costTiyin);
      months.set(p, g);
    }
    return {
      fileName: file.originalname,
      total: rows.length,
      ok: okRows.length,
      errors: rows.filter((r) => r.errors.length).length,
      exists: rows.filter((r) => r.exists).length,
      duplicates: rows.filter((r) => r.duplicate).length,
      zeroPrice: okRows.filter((r) => r.costTiyin === '0').length,
      totalTiyin: okRows.reduce((s, r) => s + BigInt(r.costTiyin), 0n).toString(),
      byMonth: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, g]) => ({ period, count: g.count, totalTiyin: g.total.toString() })),
      places,
      targets,
      rows,
    };
  }

  // ═══════════ Saqlash ═══════════

  async commit(input: AssetImportCommit, userId: string): Promise<{ created: number; skipped: number; batch: string; mode: AssetMode; totalTiyin: string }> {
    const mode = (input?.mode ?? 'HOLD') as AssetMode;
    if (!(ASSET_MODES as string[]).includes(mode)) throw new BadRequestException("Rejim noto'g'ri");
    const rows = Array.isArray(input?.rows) ? input.rows : [];
    if (!rows.length) throw new BadRequestException("Saqlash uchun qator yo'q");
    if (rows.length > MAX_ROWS) throw new BadRequestException(`Bir martada ${MAX_ROWS} tadan ko'p emas`);
    const refs = await this.references();
    const valid = new Set(this.targets(refs).map((t) => t.value));
    const mapping = input.mapping ?? {};
    await ensureCenterCategories(this.prisma);
    const [policy, cats] = await Promise.all([this.assets.policy(), this.prisma.category.findMany({ select: { code: true, parentCode: true } })]);
    const life = this.assets.lifeFor(ASSET_INVENTORY_CATEGORY.code, policy, cats);
    const today = new Date(Date.now() + TASHKENT_MS).toISOString().slice(0, 10);
    const batch = (input.batch?.trim() || `${input.fileName?.trim() || 'Excel'} · ${today}`).slice(0, 120);
    const inDb = await this.existingSignatures();
    const data: Prisma.FixedAssetCreateManyInput[] = [];
    let skipped = 0;
    let total = 0n;
    for (const [i, r] of rows.entries()) {
      const label = `${i + 1}-qator`;
      if (!r || typeof r.name !== 'string' || r.name.trim().length < 1) throw new BadRequestException(`${label}: nomi yo'q`);
      if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) throw new BadRequestException(`${label}: sana noto'g'ri`);
      let cost: bigint;
      try {
        cost = BigInt(String(r.costTiyin));
      } catch {
        throw new BadRequestException(`${label}: summa noto'g'ri`);
      }
      if (cost < 0n) throw new BadRequestException(`${label}: summa manfiy`);
      assertAmount(cost, label);
      const inv = typeof r.inventoryNo === 'string' && r.inventoryNo.trim() ? r.inventoryNo.trim().slice(0, 60) : null;
      const placeText = typeof r.placeText === 'string' ? r.placeText.slice(0, 300) : '';
      const holderName = typeof r.holderName === 'string' && r.holderName.trim() ? r.holderName.trim().slice(0, 200) : null;
      const sig = signature(inv, r.name.trim().slice(0, 300), r.date, placeText, holderName, cost.toString());
      const left = inDb.get(sig) ?? 0;
      if (left > 0) {
        inDb.set(sig, left - 1);
        skipped += 1;
        continue;
      }
      let target = mapping[placeText] ?? 'center';
      if (!valid.has(target)) target = 'center';
      const regionCode = target.startsWith('r:') ? Number(target.slice(2)) : null;
      const departmentId = target.startsWith('d:') ? target.slice(2) : null;
      const [y, m, d] = r.date.split('-').map(Number) as [number, number, number];
      const notes = [r.condition && !/^yangi$/i.test(r.condition) ? `Holati: ${r.condition}` : null, `Excel qatori: ${r.row}`].filter(Boolean).join(' · ');
      data.push({
        name: r.name.trim().slice(0, 300),
        inventoryNo: inv,
        categoryCode: ASSET_INVENTORY_CATEGORY.code,
        costTiyin: cost,
        acquiredAt: new Date(Date.UTC(y, m - 1, d) - TASHKENT_MS),
        lifeMonths: life,
        regionCode,
        departmentId,
        source: 'IMPORT',
        mode,
        holderName,
        placeText: placeText || null,
        quantity: Number.isInteger(r.quantity) && r.quantity > 0 ? Math.min(r.quantity, 100000) : 1,
        importBatch: batch,
        note: notes.slice(0, 500),
        createdById: userId,
      });
      total += cost;
    }
    if (data.length) await this.prisma.fixedAsset.createMany({ data });
    await this.audit.log({
      userId,
      action: 'IMPORT',
      entity: 'fixed_asset',
      entityId: batch,
      summary: `Asosiy vositalar Excel'dan: ${data.length} ta, ${(Number(total) / 100).toLocaleString('ru-RU')} so'm — ${MODE_LABEL[mode]}${skipped ? `; ${skipped} tasi bazada bor edi` : ''}`,
    });
    await this.assets.sync();
    return { created: data.length, skipped, batch, mode, totalTiyin: total.toString() };
  }
}