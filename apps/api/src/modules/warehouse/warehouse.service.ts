import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AssetStatus, type StockDocKind, type StockItemKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ASSET_STATUS_LABELS,
  CENTRAL_REGION,
  DOC_KIND_LABELS,
  DOC_KINDS,
  DOC_PREFIX,
  ITEM_KINDS,
  UNITS,
  WAREHOUSE_CATEGORIES,
  WAREHOUSE_PARENT_CATEGORY,
  WAREHOUSE_PARENT_LABEL,
  type AssetFilter,
  type AssetMoveView,
  type AssetView,
  type DocFilter,
  type DocInput,
  type DocView,
  type HoldingsView,
  type ItemInput,
  type ItemView,
  type LineInput,
  type LineView,
  type Place,
  type WarehouseOverview,
} from './warehouse.types';

// ═══════════════════════════════════════════════════════════
// Ombor xizmati.
//  • Qoldiq hujjatlardan hisoblanadi (alohida «qoldiq» ustuni yo'q — har doim to'g'ri):
//      TMZ: Σ kirim + Σ qaytarish − Σ chiqim − Σ hisobdan chiqarish (bekor qilinmagan hujjatlar)
//      Asosiy vosita: assets jadvalidagi holat (Omborda / Foydalanishda / Hisobdan chiqarilgan)
//  • Kirim — har qatori bitta Xarajat yozuvi (manba WAREHOUSE): Bosh sahifa, Tahlil,
//    Solishtirma, modellar va hisobotlarga o'zi tushadi.
//  • Har o'zgarish bitta tranzaksiyada; hujjat raqami va inventar raqami ketma-ket.
// ═══════════════════════════════════════════════════════════

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const PAYMENT_METHODS = ['CASH', 'BANK', 'CARD', 'OTHER'] as const;
const MAX_LINES = 200;
const MAX_ASSETS_PER_LINE = 500;
const EPS = 1e-9;

type Tx = Prisma.TransactionClient;

function todayIso(): string {
  return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
}

export function parseDate(value: unknown): { date: Date; period: string } {
  const match = typeof value === 'string' ? DATE_RE.exec(value) : null;
  if (!match) throw new BadRequestException("Sana noto'g'ri (YYYY-MM-DD)");
  const [, y, m, d] = match as unknown as [string, string, string, string];
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (Number.isNaN(date.getTime()) || date.getUTCDate() !== Number(d) || Number(y) < 2000) throw new BadRequestException("Sana noto'g'ri");
  if (`${y}-${m}-${d}` > todayIso()) throw new BadRequestException("Kelajakdagi sanani kiritib bo'lmaydi");
  return { date, period: `${y}-${m}` };
}

/** "YYYY-MM-DD" yoki "YYYY-MM" → kun yoki oyning boshi/oxiri (UTC yarim tun — sanalar shunday saqlanadi) */
function dayBound(value: string, edge: 'start' | 'end'): Date | undefined {
  if (DATE_RE.test(value)) return new Date(`${value}T00:00:00Z`);
  if (PERIOD_RE.test(value)) {
    const [y, m] = value.split('-').map(Number) as [number, number];
    return edge === 'start' ? new Date(Date.UTC(y, m - 1, 1)) : new Date(Date.UTC(y, m, 0));
  }
  return undefined;
}

export function text(value: unknown, label: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new BadRequestException(`${label} noto'g'ri`);
  const v = value.trim().replace(/\s+/g, ' ');
  if (!v) return null;
  if (v.length > max) throw new BadRequestException(`${label} ${max} belgidan oshmasin`);
  return v;
}

function required(value: unknown, label: string, max: number): string {
  const v = text(value, label, max);
  if (!v) throw new BadRequestException(`${label} kiritilmagan`);
  return v;
}

function positiveQty(value: unknown, label: string, integer: boolean): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.').trim());
  if (!Number.isFinite(n) || n <= 0) throw new BadRequestException(`${label}: miqdor noldan katta bo'lsin`);
  if (n > 10_000_000) throw new BadRequestException(`${label}: miqdor juda katta`);
  if (integer && !Number.isInteger(n)) throw new BadRequestException(`${label}: asosiy vosita soni butun son bo'lsin`);
  return Math.round(n * 1000) / 1000;
}

function priceTiyin(value: unknown, label: string): bigint {
  let v: bigint;
  try {
    v = BigInt(String(value ?? '').trim());
  } catch {
    throw new BadRequestException(`${label}: narx noto'g'ri`);
  }
  if (v < 0n) throw new BadRequestException(`${label}: narx manfiy bo'lmasin`);
  if (v > 100_000_000_000_00n) throw new BadRequestException(`${label}: narx juda katta`);
  return v;
}

/** qty × narx (tiyin), yaxlitlab */
function amountOf(qty: number, price: bigint): bigint {
  const v = Math.round(qty * Number(price));
  if (!Number.isFinite(v) || v > 9_000_000_000_000_000) throw new BadRequestException('Qator summasi juda katta');
  return BigInt(v);
}

function fmtQty(q: number): string {
  return Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/\.?0+$/, '').replace('.', ',');
}

/** "center" | "r:26" | 26 → hudud kodi */
function regionOf(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (value === 'center') return CENTRAL_REGION;
  const raw = typeof value === 'string' && value.startsWith('r:') ? value.slice(2) : value;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 999) throw new BadRequestException("Hudud noto'g'ri");
  return n;
}

const SIGN: Record<StockDocKind, number> = { RECEIPT: 1, RETURN: 1, ISSUE: -1, WRITE_OFF: -1, TRANSFER: 0 };

interface StockStat {
  qty: number;
  recvQty: number;
  recvAmount: bigint;
  lastPrice: bigint | null;
  lastAt: number;
}

interface Lookup {
  departments: Map<string, string>;
  regions: Map<number, string>;
  /** Foydalanuvchilar: «Kim kiritdi», «Kim bekor qildi» */
  users: Map<string, string>;
}

interface Target {
  departmentId: string | null;
  regionCode: number | null;
  holderPinfl: string | null;
  holderName: string | null;
}


/** Oldindan ko'rish natijasi — tranzaksiyani bekor qilish uchun «xato» sifatida otiladi */
class PreviewOnly extends Error {
  constructor(readonly view: DocView) {
    super('preview');
  }
}

@Injectable()
export class WarehouseService {
  private categoriesReady: Promise<void> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  // ═══════════ Ma'lumotnomalar ═══════════

  /** Ombor xarajat moddalari (bir marta yaratiladi, mavjud bo'lsa tegilmaydi) */
  ensureCategories(): Promise<void> {
    if (!this.categoriesReady) {
      this.categoriesReady = (async () => {
        await this.prisma.category.upsert({
          where: { code: WAREHOUSE_PARENT_CATEGORY },
          update: {},
          create: { code: WAREHOUSE_PARENT_CATEGORY, label: WAREHOUSE_PARENT_LABEL, isLeaf: false, order: 57 },
        });
        let order = 571;
        for (const c of WAREHOUSE_CATEGORIES) {
          await this.prisma.category.upsert({
            where: { code: c.code },
            update: {},
            create: { code: c.code, label: c.label, parentCode: WAREHOUSE_PARENT_CATEGORY, isLeaf: true, behavior: c.behavior, order: order++ },
          });
        }
      })().catch((error: unknown) => {
        this.categoriesReady = null;
        throw error;
      });
    }
    return this.categoriesReady;
  }

  private async lookup(): Promise<Lookup> {
    const [departments, regions, users] = await Promise.all([
      this.prisma.department.findMany({ select: { id: true, name: true } }),
      this.prisma.region.findMany({ select: { code: true, name: true } }),
      this.prisma.user.findMany({ select: { id: true, fullName: true, loginCode: true } }),
    ]);
    return {
      departments: new Map(departments.map((d) => [d.id, d.name])),
      regions: new Map(regions.map((r) => [r.code, r.name])),
      users: new Map(users.map((u) => [u.id, u.loginCode ? `${u.fullName} (${u.loginCode})` : u.fullName])),
    };
  }

  private place(lk: Lookup, p: { departmentId: string | null; regionCode: number | null; holderPinfl: string | null; holderName: string | null }): Place {
    const departmentName = p.departmentId ? (lk.departments.get(p.departmentId) ?? "Bo'lim") : null;
    const regionName = p.regionCode !== null ? (lk.regions.get(p.regionCode) ?? (p.regionCode === CENTRAL_REGION ? 'Markaz' : `Hudud ${p.regionCode}`)) : null;
    const parts = [departmentName ?? (p.regionCode !== null && p.regionCode !== CENTRAL_REGION ? regionName : null), p.holderName].filter(Boolean);
    return {
      departmentId: p.departmentId,
      departmentName,
      regionCode: p.regionCode,
      regionName,
      holderPinfl: p.holderPinfl,
      holderName: p.holderName,
      text: parts.length ? parts.join(' · ') : 'Ombor',
    };
  }

  async lookups() {
    await this.ensureCategories();
    const [departments, regions, categories, groups] = await Promise.all([
      this.prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { order: 'asc' } }),
      this.prisma.region.findMany({ where: { isActive: true }, select: { code: true, name: true }, orderBy: { code: 'asc' } }),
      this.prisma.category.findMany({ where: { isLeaf: true, isActive: true, code: { not: 'WH_POSTAL' } }, select: { code: true, label: true, parentCode: true }, orderBy: [{ order: 'asc' }, { label: 'asc' }] }),
      this.prisma.stockItem.findMany({ where: { group: { not: null } }, select: { group: true }, distinct: ['group'] }),
    ]);
    return {
      departments,
      regions: regions.map((r) => ({ code: r.code, name: r.code === CENTRAL_REGION ? 'Markaz' : r.name })),
      // Ombor moddalari birinchi
      categories: [...categories.filter((c) => c.parentCode === WAREHOUSE_PARENT_CATEGORY), ...categories.filter((c) => c.parentCode !== WAREHOUSE_PARENT_CATEGORY)],
      units: UNITS,
      groups: groups.map((g) => g.group!).sort((a, b) => a.localeCompare(b)),
      itemKinds: ITEM_KINDS,
      docKinds: DOC_KINDS.map((k) => ({ value: k, label: DOC_KIND_LABELS[k] })),
    };
  }

  /** Oluvchi/mas'ul tanlash uchun xodimlar (Xodimlar bo'limidan) */
  async employees(search?: string) {
    const term = search?.trim();
    const rows = await this.prisma.employee.findMany({
      where: {
        isActive: true,
        ...(term ? { OR: [{ fullName: { contains: term, mode: 'insensitive' } }, { pinfl: { startsWith: term } }, { position: { contains: term, mode: 'insensitive' } }] } : {}),
      },
      select: { pinfl: true, fullName: true, position: true, regionCode: true, departmentId: true, region: { select: { name: true } }, department: { select: { name: true } } },
      orderBy: { fullName: 'asc' },
      take: 30,
    });
    return rows.map((e) => ({
      pinfl: e.pinfl,
      fullName: e.fullName,
      position: e.position,
      regionCode: e.regionCode,
      departmentId: e.departmentId,
      place: e.department?.name ?? e.region?.name ?? '',
    }));
  }

  // ═══════════ Buyumlar (ma'lumotnoma) ═══════════

  /** TMZ qoldig'i va o'rtacha narxi — hujjatlardan */
  private async stockStats(itemIds?: string[]): Promise<Map<string, StockStat>> {
    const lines = await this.prisma.stockLine.findMany({
      where: { doc: { deletedAt: null }, ...(itemIds ? { itemId: { in: itemIds } } : {}) },
      select: { itemId: true, qty: true, priceTiyin: true, amountTiyin: true, doc: { select: { kind: true, date: true, createdAt: true } } },
    });
    const out = new Map<string, StockStat>();
    for (const l of lines) {
      const s = out.get(l.itemId) ?? { qty: 0, recvQty: 0, recvAmount: 0n, lastPrice: null, lastAt: 0 };
      s.qty += SIGN[l.doc.kind] * l.qty;
      if (l.doc.kind === 'RECEIPT') {
        s.recvQty += l.qty;
        s.recvAmount += l.amountTiyin;
        // Oxirgi kirim narxi — yangi kirimda o'zi qo'yiladi
        const at = l.doc.date.getTime() * 1000 + (l.doc.createdAt.getTime() % 1000);
        if (at >= s.lastAt) {
          s.lastAt = at;
          s.lastPrice = l.priceTiyin;
        }
      }
      out.set(l.itemId, s);
    }
    return out;
  }

  private avgPrice(s: { recvQty: number; recvAmount: bigint } | undefined): bigint {
    if (!s || s.recvQty <= 0) return 0n;
    return BigInt(Math.round(Number(s.recvAmount) / s.recvQty));
  }

  async items(filter: { kind?: string; search?: string; all?: boolean } = {}): Promise<ItemView[]> {
    await this.ensureCategories();
    const kind = filter.kind && ITEM_KINDS.includes(filter.kind as StockItemKind) ? (filter.kind as StockItemKind) : undefined;
    const term = filter.search?.trim();
    const [items, categories, assetCounts] = await Promise.all([
      this.prisma.stockItem.findMany({
        where: {
          ...(filter.all ? {} : { isActive: true }),
          ...(kind ? { kind } : {}),
          ...(term ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, { code: { contains: term, mode: 'insensitive' } }, { group: { contains: term, mode: 'insensitive' } }] } : {}),
        },
        orderBy: [{ kind: 'asc' }, { group: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.category.findMany({ select: { code: true, label: true } }),
      this.prisma.asset.groupBy({ by: ['itemId', 'status'], _count: { _all: true }, _sum: { priceTiyin: true } }),
    ]);
    const stats = await this.stockStats(items.map((i) => i.id));
    const catLabel = new Map(categories.map((c) => [c.code, c.label]));
    const assets = new Map<string, { inStock: number; inUse: number; stockValue: bigint }>();
    for (const g of assetCounts) {
      const a = assets.get(g.itemId) ?? { inStock: 0, inUse: 0, stockValue: 0n };
      if (g.status === 'IN_STOCK') {
        a.inStock += g._count._all;
        a.stockValue += g._sum.priceTiyin ?? 0n;
      }
      if (g.status === 'IN_USE') a.inUse += g._count._all;
      assets.set(g.itemId, a);
    }
    return items.map((i) => {
      const s = stats.get(i.id);
      const avg = this.avgPrice(s);
      const isAsset = i.kind === 'ASSET';
      const a = assets.get(i.id);
      const inStock = isAsset ? (a?.inStock ?? 0) : Math.round((s?.qty ?? 0) * 1000) / 1000;
      const value = isAsset ? (a?.stockValue ?? 0n) : amountOf(inStock, avg);
      return {
        id: i.id,
        code: i.code,
        name: i.name,
        unit: i.unit,
        kind: i.kind,
        group: i.group,
        categoryCode: i.categoryCode,
        categoryLabel: catLabel.get(i.categoryCode) ?? i.categoryCode,
        minQty: i.minQty,
        note: i.note,
        isActive: i.isActive,
        inStock,
        inUse: a?.inUse ?? 0,
        avgPriceTiyin: avg.toString(),
        lastPriceTiyin: s?.lastPrice !== null && s?.lastPrice !== undefined ? s.lastPrice.toString() : null,
        stockValueTiyin: value.toString(),
        low: i.minQty !== null && inStock < i.minQty,
      };
    });
  }

  private async itemData(input: ItemInput, base?: { kind: StockItemKind }) {
    const name = required(input.name, 'Nomi', 160);
    const unit = required(input.unit ?? 'dona', "O'lchov birligi", 20);
    const kind = (input.kind ?? base?.kind ?? 'TMZ') as StockItemKind;
    if (!ITEM_KINDS.includes(kind)) throw new BadRequestException("Turi noto'g'ri");
    if (base && base.kind !== kind) throw new BadRequestException("Buyum turini o'zgartirib bo'lmaydi (TMZ ↔ asosiy vosita)");
    const categoryCode = required(input.categoryCode, 'Xarajat moddasi', 60);
    const category = await this.prisma.category.findUnique({ where: { code: categoryCode }, select: { isLeaf: true } });
    if (!category) throw new BadRequestException('Xarajat moddasi topilmadi');
    if (!category.isLeaf) throw new BadRequestException("Ichki modda tanlang (guruh emas)");
    const minRaw = input.minQty;
    const minQty = minRaw === undefined || minRaw === null || minRaw === '' ? null : Number(String(minRaw).replace(',', '.'));
    if (minQty !== null && (!Number.isFinite(minQty) || minQty < 0)) throw new BadRequestException("Minimal qoldiq noto'g'ri");
    return {
      name,
      unit,
      kind,
      group: text(input.group, 'Guruh', 80),
      categoryCode,
      minQty,
      note: text(input.note, 'Izoh', 500),
      ...(input.isActive !== undefined ? { isActive: Boolean(input.isActive) } : {}),
    };
  }

  async createItem(input: ItemInput): Promise<ItemView> {
    await this.ensureCategories();
    const data = await this.itemData(input ?? {});
    const exists = await this.prisma.stockItem.findFirst({ where: { name: { equals: data.name, mode: 'insensitive' }, kind: data.kind } });
    if (exists) throw new ConflictException(`«${data.name}» ma'lumotnomada bor (${exists.code})`);
    const created = await this.prisma.$transaction(async (tx) => {
      const prefix = data.kind === 'ASSET' ? 'AV' : 'TMZ';
      const last = await tx.stockItem.findFirst({ where: { code: { startsWith: `${prefix}-` } }, orderBy: { code: 'desc' }, select: { code: true } });
      const next = (last ? Number(last.code.slice(prefix.length + 1)) || 0 : 0) + 1;
      return tx.stockItem.create({ data: { ...data, code: `${prefix}-${String(next).padStart(4, '0')}` } });
    });
    return (await this.items({ all: true, search: created.code }))[0]!;
  }

  async updateItem(id: string, input: ItemInput): Promise<ItemView> {
    const item = await this.prisma.stockItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Buyum topilmadi');
    const data = await this.itemData({ ...item, ...input, minQty: input.minQty !== undefined ? input.minQty : item.minQty }, item);
    await this.prisma.stockItem.update({ where: { id }, data });
    return (await this.items({ all: true, search: item.code }))[0]!;
  }

  /** Hujjatda ishlatilgan buyum o'chirilmaydi — faolsizlantiriladi */
  async removeItem(id: string): Promise<{ id: string; archived: boolean }> {
    const item = await this.prisma.stockItem.findUnique({ where: { id }, select: { id: true } });
    if (!item) throw new NotFoundException('Buyum topilmadi');
    const used = (await this.prisma.stockLine.count({ where: { itemId: id } })) + (await this.prisma.asset.count({ where: { itemId: id } }));
    if (used > 0) {
      await this.prisma.stockItem.update({ where: { id }, data: { isActive: false } });
      return { id, archived: true };
    }
    await this.prisma.stockItem.delete({ where: { id } });
    return { id, archived: false };
  }

  // ═══════════ Hujjatlar ═══════════

  private async nextNumber(tx: Tx, kind: StockDocKind, date: Date): Promise<string> {
    const prefix = `${DOC_PREFIX[kind]}-${date.getUTCFullYear()}-`;
    const last = await tx.stockDoc.findFirst({ where: { number: { startsWith: prefix } }, orderBy: { number: 'desc' }, select: { number: true } });
    const n = (last ? Number(last.number.slice(prefix.length)) || 0 : 0) + 1;
    return `${prefix}${String(n).padStart(4, '0')}`;
  }

  private async nextInventory(tx: Tx, count: number): Promise<string[]> {
    const last = await tx.asset.findFirst({ where: { inventoryNo: { startsWith: 'INV-' } }, orderBy: { inventoryNo: 'desc' }, select: { inventoryNo: true } });
    const start = (last ? Number(last.inventoryNo.slice(4)) || 0 : 0) + 1;
    return Array.from({ length: count }, (_, i) => `INV-${String(start + i).padStart(6, '0')}`);
  }

  /** Kimga/qayerga: bo'lim, hudud, odam (xodim tanlansa — ism va joyi Xodimlardan) */
  private async target(input: DocInput, need: boolean): Promise<Target> {
    const departmentId = text(input.departmentId, "Bo'lim", 40);
    let regionCode = regionOf(input.regionCode);
    const holderPinfl = text(input.holderPinfl, 'Xodim', 14);
    let holderName = text(input.holderName, 'Oluvchi', 160);
    let dept = departmentId;
    if (dept) {
      const d = await this.prisma.department.findUnique({ where: { id: dept }, select: { id: true } });
      if (!d) throw new BadRequestException("Bo'lim topilmadi");
      if (regionCode === null) regionCode = CENTRAL_REGION;
    }
    if (holderPinfl) {
      const e = await this.prisma.employee.findUnique({ where: { pinfl: holderPinfl }, select: { fullName: true, regionCode: true, departmentId: true } });
      if (!e) throw new BadRequestException('Xodim topilmadi');
      holderName = e.fullName;
      if (!dept && regionCode === null) {
        dept = e.departmentId;
        regionCode = e.regionCode;
      }
    }
    if (regionCode !== null) {
      const r = await this.prisma.region.findUnique({ where: { code: regionCode }, select: { code: true } });
      if (!r) throw new BadRequestException('Hudud topilmadi');
    }
    if (need && !dept && regionCode === null && !holderName) throw new BadRequestException("Kimga yoki qaysi bo'lim/hududga berilayotgani ko'rsatilmagan");
    return { departmentId: dept, regionCode, holderPinfl, holderName };
  }

  /** TMZ qatorlari: buyum, miqdor, narx (kirimda — kiritilgan, boshqalarida — o'rtacha tannarx) */
  private async tmzLines(kind: StockDocKind, raw: LineInput[] | undefined) {
    const list = Array.isArray(raw) ? raw : [];
    if (list.length > MAX_LINES) throw new BadRequestException(`Qatorlar ${MAX_LINES} tadan oshmasin`);
    const ids = [...new Set(list.map((l) => String(l.itemId ?? '')))].filter(Boolean);
    const items = await this.prisma.stockItem.findMany({ where: { id: { in: ids } } });
    const byId = new Map(items.map((i) => [i.id, i]));
    const stats = kind === 'RECEIPT' ? new Map() : await this.stockStats(ids);
    const need = new Map<string, number>();
    const out = list.map((l, index) => {
      const label = `${index + 1}-qator`;
      const item = byId.get(String(l.itemId ?? ''));
      if (!item) throw new BadRequestException(`${label}: buyum tanlanmagan`);
      if (!item.isActive && kind === 'RECEIPT') throw new BadRequestException(`${label}: «${item.name}» faol emas`);
      if (item.kind === 'ASSET' && kind !== 'RECEIPT') throw new BadRequestException(`${label}: asosiy vositalar inventar raqami bo'yicha tanlanadi`);
      const qty = positiveQty(l.qty, label, item.kind === 'ASSET');
      if (item.kind === 'ASSET' && qty > MAX_ASSETS_PER_LINE) throw new BadRequestException(`${label}: bir qatorda ${MAX_ASSETS_PER_LINE} donadan ko'p bo'lmasin`);
      const price = kind === 'RECEIPT' ? priceTiyin(l.priceTiyin, label) : this.avgPrice(stats.get(item.id));
      if (kind === 'ISSUE' || kind === 'WRITE_OFF') need.set(item.id, (need.get(item.id) ?? 0) + qty);
      const serials = (Array.isArray(l.serials) ? l.serials : []).map((s) => String(s ?? '').trim()).filter(Boolean).slice(0, qty);
      return { item, qty, price, amount: amountOf(qty, price), note: text(l.note, `${label}: izoh`, 300), serials };
    });
    // Omborda yetarlimi
    for (const [itemId, qty] of need) {
      const have = stats.get(itemId)?.qty ?? 0;
      if (qty > have + EPS) {
        const item = byId.get(itemId)!;
        throw new BadRequestException(`«${item.name}» omborda ${fmtQty(Math.max(0, have))} ${item.unit} bor, ${fmtQty(qty)} ${item.unit} so'ralyapti`);
      }
    }
    return out;
  }

  private async assetsFor(kind: StockDocKind, ids: string[] | undefined) {
    const list = [...new Set(Array.isArray(ids) ? ids.map(String) : [])];
    if (list.length === 0) return [];
    if (list.length > 1000) throw new BadRequestException("Bir hujjatda 1000 tadan ko'p asosiy vosita bo'lmasin");
    const assets = await this.prisma.asset.findMany({ where: { id: { in: list } } });
    if (assets.length !== list.length) throw new BadRequestException('Ba\'zi asosiy vositalar topilmadi');
    for (const a of assets) {
      const bad =
        (kind === 'ISSUE' && a.status !== 'IN_STOCK') ||
        (kind === 'RETURN' && a.status !== 'IN_USE') ||
        (kind === 'TRANSFER' && a.status !== 'IN_USE') ||
        (kind === 'WRITE_OFF' && a.status === 'WRITTEN_OFF');
      if (bad) {
        const why = kind === 'ISSUE' ? 'omborda emas' : kind === 'WRITE_OFF' ? 'allaqachon hisobdan chiqarilgan' : 'foydalanishda emas';
        throw new BadRequestException(`${a.inventoryNo} «${a.name}» — ${why} (${ASSET_STATUS_LABELS[a.status]})`);
      }
    }
    return assets;
  }

  /**
   * Hujjat yaratish. opts — faqat ichki chaqiruvlar uchun (kontroller bermaydi):
   * noExpense — inventarizatsiya ortiqchasi kabi kirim xarajatga yozilmaydi.
   */
  async createDoc(input: DocInput, userId: string, opts: { noExpense?: boolean; preview?: boolean } = {}): Promise<DocView> {
    const body = input ?? {};
    const kind = body.kind as StockDocKind;
    if (!DOC_KINDS.includes(kind)) throw new BadRequestException("Hujjat turi noto'g'ri");
    const { date, period } = parseDate(body.date);

    const counterparty = text(body.counterparty, 'Yetkazuvchi', 200);
    const documentNo = text(body.documentNo, 'Hujjat raqami', 80);
    const issuedBy = text(body.issuedBy, 'Topshiruvchi', 160);
    const responsible = text(body.responsible, "Mas'ul shaxs", 160);
    const reason = text(body.reason, 'Sabab', 500);
    const note = text(body.note, 'Izoh', 1000);
    if (kind === 'WRITE_OFF' && !reason) throw new BadRequestException('Hisobdan chiqarish sababini yozing');

    const target = await this.target(body, kind === 'ISSUE' || kind === 'TRANSFER');
    const lines = kind === 'TRANSFER' ? [] : await this.tmzLines(kind, body.lines);
    const assets = kind === 'RECEIPT' ? [] : await this.assetsFor(kind, body.assetIds);
    if (lines.length === 0 && assets.length === 0) throw new BadRequestException("Hujjatda birorta ham qator yo'q");
    if (kind === 'RETURN' && lines.length > 0 && !target.departmentId && target.regionCode === null && !target.holderName) {
      throw new BadRequestException('TMZ qaytarilayotganda kimdan yoki qaysi bo\'limdan qaytgani ko\'rsatilsin');
    }

    const paymentMethod = (body.paymentMethod ?? 'BANK') as (typeof PAYMENT_METHODS)[number];
    if (kind === 'RECEIPT' && !PAYMENT_METHODS.includes(paymentMethod)) throw new BadRequestException("To'lov usuli noto'g'ri");
    if (kind === 'RECEIPT') await this.ensureCategories();

    const total = lines.reduce((s, l) => s + l.amount, 0n) + assets.reduce((s, a) => s + a.priceTiyin, 0n);
    // Dalolatnomaning «Ҳолати» ustuni: har vosita uchun (bo'sh — shablondagi standart qiymat)
    const conditions = body.conditions && typeof body.conditions === 'object' ? body.conditions : {};
    const conditionOf = (id: string): string | null => {
      const v = (conditions as Record<string, unknown>)[id];
      return typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null;
    };

    const run = () =>
      this.prisma.$transaction(
        async (tx) => {
          const number = await this.nextNumber(tx, kind, date);
          const doc = await tx.stockDoc.create({
            data: {
              number,
              kind,
              date,
              period,
              counterparty,
              documentNo,
              departmentId: target.departmentId,
              regionCode: target.regionCode,
              holderPinfl: target.holderPinfl,
              holderName: target.holderName,
              issuedBy,
              responsible,
              reason,
              note,
              totalTiyin: total,
              createdById: userId,
            },
          });

          // ── TMZ qatorlari (kirimda — asosiy vositalar ham) ──
          for (const l of lines) {
            let expenseId: string | null = null;
            if (kind === 'RECEIPT' && l.amount > 0n && !opts.noExpense) {
              const expense = await tx.expense.create({
                data: {
                  date,
                  period,
                  amountTiyin: l.amount,
                  categoryCode: l.item.categoryCode,
                  departmentId: target.departmentId,
                  regionCode: target.regionCode ?? CENTRAL_REGION,
                  description: `Ombor kirimi ${number}: ${l.item.name} — ${fmtQty(l.qty)} ${l.item.unit}`.slice(0, 500),
                  paymentMethod,
                  documentNo,
                  counterparty,
                  paymentStatus: 'PAID',
                  source: 'WAREHOUSE',
                  section: l.item.kind === 'ASSET' ? 'BOSHQA' : 'DOIMIY',
                  createdById: userId,
                },
                select: { id: true },
              });
              expenseId = expense.id;
            }
            const line = await tx.stockLine.create({
              data: { docId: doc.id, itemId: l.item.id, qty: l.qty, priceTiyin: l.price, amountTiyin: l.amount, expenseId, note: l.note },
            });
            // Asosiy vosita kirimi — har donasiga inventar raqami
            if (kind === 'RECEIPT' && l.item.kind === 'ASSET') {
              const numbers = await this.nextInventory(tx, l.qty);
              for (let i = 0; i < numbers.length; i += 1) {
                const asset = await tx.asset.create({
                  data: {
                    inventoryNo: numbers[i]!,
                    itemId: l.item.id,
                    name: l.item.name,
                    serialNo: l.serials[i] ?? null,
                    priceTiyin: l.price,
                    acquiredAt: date,
                    receiptLineId: line.id,
                    status: 'IN_STOCK',
                  },
                });
                await tx.assetMove.create({
                  data: { assetId: asset.id, docId: doc.id, kind: 'RECEIPT', date, note: counterparty ? `Yetkazuvchi: ${counterparty}` : null, createdById: userId },
                });
              }
            }
          }

          // ── Asosiy vositalar harakati ──
          for (const a of assets) {
            const from = { departmentId: a.departmentId, regionCode: a.regionCode, holderPinfl: a.holderPinfl, holderName: a.holderName };
            const to: Target =
              kind === 'ISSUE' || kind === 'TRANSFER' ? target : { departmentId: null, regionCode: null, holderPinfl: null, holderName: null };
            const status: AssetStatus = kind === 'WRITE_OFF' ? 'WRITTEN_OFF' : kind === 'RETURN' ? 'IN_STOCK' : 'IN_USE';
            await tx.asset.update({ where: { id: a.id }, data: { status, ...to } });
            await tx.assetMove.create({
              data: {
                assetId: a.id,
                docId: doc.id,
                kind,
                date,
                fromDepartmentId: from.departmentId,
                fromRegionCode: from.regionCode,
                fromHolderPinfl: from.holderPinfl,
                fromHolderName: from.holderName,
                toDepartmentId: to.departmentId,
                toRegionCode: to.regionCode,
                toHolderPinfl: to.holderPinfl,
                toHolderName: to.holderName,
                note: kind === 'WRITE_OFF' ? reason : note,
                condition: conditionOf(a.id),
                createdById: userId,
              },
            });
          }

          // Ko'chirishda «qayerdan» — hammasi bir joydan bo'lsa hujjatga yoziladi
          if ((kind === 'TRANSFER' || kind === 'RETURN') && assets.length > 0) {
            const first = assets[0]!;
            const same = assets.every((a) => a.departmentId === first.departmentId && a.regionCode === first.regionCode && a.holderPinfl === first.holderPinfl && a.holderName === first.holderName);
            if (same) {
              await tx.stockDoc.update({
                where: { id: doc.id },
                data: { fromDepartmentId: first.departmentId, fromRegionCode: first.regionCode, fromHolderPinfl: first.holderPinfl, fromHolderName: first.holderName },
              });
            }
          }
          // Oldindan ko'rish (imzo uchun): hujjat to'liq tuziladi, ko'rinishi olinadi va tranzaksiya bekor qilinadi
          if (opts.preview) {
            const full = await tx.stockDoc.findUnique({ where: { id: doc.id }, include: { lines: { include: { item: true } }, moves: { include: { asset: true } } } });
            throw new PreviewOnly(this.mapDoc(full!, await this.lookup()));
          }
          return doc.id;
        },
        { timeout: 60_000, maxWait: 10_000 },
      );

    let id: string;
    try {
      id = await run();
    } catch (error) {
      if (error instanceof PreviewOnly) return error.view;
      // Bir vaqtda ikki hujjat bir xil raqam olsa — bir marta qayta urinamiz
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        try {
          id = await run();
        } catch (again) {
          if (again instanceof PreviewOnly) return again.view;
          throw again;
        }
      } else throw error;
    }
    return this.doc(id);
  }

  /**
   * Hujjatni bekor qilish. Kirim — yaratilgan xarajatlar va inventar raqamlari ham bekor qilinadi
   * (asosiy vositalar hali omborda va boshqa harakat bo'lmagan bo'lsa). Boshqalari — asosiy vositalar
   * oldingi joyiga qaytadi (bu hujjat ularning oxirgi harakati bo'lsa). Qoldiq manfiyga tushmaydi.
   */
  async docKind(id: string): Promise<string | null> {
    const d = await this.prisma.stockDoc.findUnique({ where: { id }, select: { kind: true } });
    return d?.kind ?? null;
  }

  async cancelDoc(id: string, userId?: string): Promise<DocView> {
    const doc = await this.prisma.stockDoc.findUnique({ where: { id }, include: { lines: { include: { item: true } }, moves: true } });
    if (!doc) throw new NotFoundException('Hujjat topilmadi');
    if (doc.deletedAt) throw new BadRequestException('Hujjat allaqachon bekor qilingan');

    // TMZ qoldig'i: kirim yoki qaytarish bekor qilinsa kamayadi
    if (SIGN[doc.kind] > 0) {
      const stats = await this.stockStats(doc.lines.map((l) => l.itemId));
      for (const l of doc.lines.filter((x) => x.item.kind === 'TMZ')) {
        const have = stats.get(l.itemId)?.qty ?? 0;
        if (have - l.qty < -EPS) {
          throw new BadRequestException(
            `«${l.item.name}»: bu hujjatdagi ${fmtQty(l.qty)} ${l.item.unit} dan ${fmtQty(l.qty - have)} ${l.item.unit} allaqachon berilgan (omborda ${fmtQty(Math.max(0, have))} ${l.item.unit} qolgan) — avval o'sha chiqimlarni bekor qiling`,
          );
        }
      }
    }

    const assetIds = [...new Set(doc.moves.map((m) => m.assetId))];
    const lastMoves = await this.prisma.assetMove.findMany({
      where: { assetId: { in: assetIds } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, assetId: true },
    });
    const lastOf = new Map<string, string>();
    for (const m of lastMoves) if (!lastOf.has(m.assetId)) lastOf.set(m.assetId, m.id);
    for (const m of doc.moves) {
      if (lastOf.get(m.assetId) !== m.id) {
        const a = await this.prisma.asset.findUnique({ where: { id: m.assetId }, select: { inventoryNo: true } });
        throw new BadRequestException(`${a?.inventoryNo ?? 'Asosiy vosita'} shundan keyin yana harakatlangan — avval keyingi hujjatlarni bekor qiling`);
      }
    }

    const now = new Date();
    await this.prisma.$transaction(
      async (tx) => {
        if (doc.kind === 'RECEIPT') {
          const expenseIds = doc.lines.map((l) => l.expenseId).filter((x): x is string => Boolean(x));
          if (expenseIds.length) await tx.expense.updateMany({ where: { id: { in: expenseIds }, deletedAt: null }, data: { deletedAt: now } });
          await tx.asset.deleteMany({ where: { id: { in: assetIds } } });
          // Xarid asosida qabul qilingan kirim bekor qilinsa: qabul «qaytarildi», xarid yana ochiq — tovarni qayta qabul qilish mumkin
          const linked = await tx.goodsReceipt.findMany({ where: { stockDocId: doc.id }, include: { purchase: true } });
          for (const g of linked) {
            await tx.goodsReceipt.update({ where: { id: g.id }, data: { status: 'REJECTED', rejectReason: 'Ombor kirimi bekor qilindi', stockDocId: null } });
            if (g.purchase.status === 'DELIVERED') {
              await tx.purchase.update({ where: { id: g.purchaseId }, data: { status: 'OPEN', deliveredAt: null } });
              if (g.purchase.requestId) await tx.purchaseRequest.updateMany({ where: { id: g.purchase.requestId, status: 'DONE' }, data: { status: 'IN_PROGRESS' } });
            }
          }
        } else {
          for (const m of doc.moves) {
            const from = { departmentId: m.fromDepartmentId, regionCode: m.fromRegionCode, holderPinfl: m.fromHolderPinfl, holderName: m.fromHolderName };
            const hadPlace = Boolean(from.departmentId || from.regionCode !== null || from.holderName);
            const status: AssetStatus = m.kind === 'ISSUE' ? 'IN_STOCK' : m.kind === 'RETURN' ? 'IN_USE' : hadPlace ? 'IN_USE' : 'IN_STOCK';
            await tx.asset.update({ where: { id: m.assetId }, data: { status, ...from } });
          }
          await tx.assetMove.deleteMany({ where: { docId: doc.id } });
        }
        await tx.stockDoc.update({ where: { id: doc.id }, data: { deletedAt: now, cancelledById: userId ?? null } });
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    return this.doc(id);
  }

  // ═══════════ Ko'plab o'chirish (belgilanganlar) ═══════════

  private ids(raw: unknown, max = 200): string[] {
    if (!Array.isArray(raw)) throw new BadRequestException("Ro'yxat kerak");
    const ids = [...new Set(raw.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 40))];
    if (!ids.length) throw new BadRequestException('Hech narsa belgilanmagan');
    if (ids.length > max) throw new BadRequestException(`Bir martada ${max} tadan ko'p emas`);
    return ids;
  }

  /**
   * Belgilangan hujjatlarni bekor qilish: eng yangisidan boshlab (keyingi harakatlar avval bekor bo'lsin).
   * Bittasida xato bo'lsa — qolganlari davom etadi, xatolar ro'yxatda qaytadi.
   */
  async cancelDocs(raw: unknown, userId: string, role?: string): Promise<{ cancelled: { id: string; number: string }[]; failed: { id: string; number: string; reason: string }[] }> {
    const ids = this.ids(raw);
    const docs = await this.prisma.stockDoc.findMany({ where: { id: { in: ids } }, select: { id: true, number: true, kind: true, date: true, createdAt: true, deletedAt: true } });
    docs.sort((a, b) => b.date.getTime() - a.date.getTime() || b.createdAt.getTime() - a.createdAt.getTime());
    const cancelled: { id: string; number: string }[] = [];
    const failed: { id: string; number: string; reason: string }[] = [];
    for (const id of ids) if (!docs.some((d) => d.id === id)) failed.push({ id, number: '—', reason: 'Hujjat topilmadi' });
    for (const d of docs) {
      if (d.deletedAt) continue;
      if (role === 'SKLADCHI' && d.kind === 'RECEIPT') {
        failed.push({ id: d.id, number: d.number, reason: 'Kirimni faqat administrator bekor qiladi' });
        continue;
      }
      try {
        await this.cancelDoc(d.id, userId);
        cancelled.push({ id: d.id, number: d.number });
      } catch (e) {
        failed.push({ id: d.id, number: d.number, reason: (e as Error).message });
      }
    }
    return { cancelled, failed };
  }

  /** Belgilangan buyumlar: hujjatda ishlatilgan bo'lsa — arxivga, aks holda o'chiriladi */
  async removeItems(raw: unknown): Promise<{ deleted: number; archived: number; failed: { id: string; reason: string }[] }> {
    const ids = this.ids(raw, 500);
    let deleted = 0;
    let archived = 0;
    const failed: { id: string; reason: string }[] = [];
    for (const id of ids) {
      try {
        const r = await this.removeItem(id);
        if (r.archived) archived += 1;
        else deleted += 1;
      } catch (e) {
        failed.push({ id, reason: (e as Error).message });
      }
    }
    return { deleted, archived, failed };
  }

  /**
   * Asosiy vositani o'chirish (xato kiritilgan bo'lsa). Shartlar: kirimdan keyin hujjat bilan harakatlanmagan
   * (berish, ko'chirish, qaytarish, hisobdan chiqarish bo'lsa — avval o'sha hujjatlar bekor qilinadi).
   * Kirim hujjatida: qator miqdori 1 taga, summasi va xarajati shu vosita narxiga kamayadi; qator bo'shasa —
   * qator va xarajat o'chadi; hujjatda qator qolmasa — hujjat bekor bo'ladi.
   * «Xarajatlar › Asosiy vositalar» balansidagi yozuv: ombor kirimidan kelgan bo'lsa — o'chadi; Excel'dan
   * kiritilgan bo'lsa — qoladi (faqat ombordagi bog'lanish uziladi).
   */
  async removeAsset(id: string, userId?: string): Promise<{ id: string; inventoryNo: string; docCancelled: string | null }> {
    const a = await this.prisma.asset.findUnique({ where: { id }, include: { moves: { select: { id: true, kind: true, docId: true } } } });
    if (!a) throw new NotFoundException('Asosiy vosita topilmadi');
    const later = a.moves.filter((m) => m.docId && m.kind !== 'RECEIPT');
    if (later.length) {
      const docs = await this.prisma.stockDoc.findMany({ where: { id: { in: later.map((m) => m.docId!) }, deletedAt: null }, select: { number: true } });
      if (docs.length) throw new BadRequestException(`${a.inventoryNo}: keyin hujjat bilan harakatlangan (${docs.map((d) => d.number).join(', ')}) — avval o'sha hujjatlarni bekor qiling`);
    }
    const now = new Date();
    let docCancelled: string | null = null;
    await this.prisma.$transaction(
      async (tx) => {
        await tx.assetMove.deleteMany({ where: { assetId: id } });
        await tx.stockCountAsset.deleteMany({ where: { assetId: id } });
        await tx.asset.delete({ where: { id } });
        const fixed = await tx.fixedAsset.findMany({ where: { assetId: id }, select: { id: true, source: true } });
        for (const f of fixed) {
          await tx.fixedAsset.update({ where: { id: f.id }, data: f.source === 'WAREHOUSE' ? { deletedAt: now } : { assetId: null } });
        }
        if (!a.receiptLineId) return;
        const line = await tx.stockLine.findUnique({ where: { id: a.receiptLineId }, include: { doc: { select: { id: true, number: true, totalTiyin: true, deletedAt: true } } } });
        if (!line) return;
        const qty = line.qty - 1;
        const amount = line.amountTiyin - a.priceTiyin > 0n ? line.amountTiyin - a.priceTiyin : 0n;
        const minus = line.amountTiyin - amount;
        if (qty <= EPS) {
          if (line.expenseId) await tx.expense.updateMany({ where: { id: line.expenseId, deletedAt: null }, data: { deletedAt: now } });
          await tx.stockLine.delete({ where: { id: line.id } });
        } else {
          await tx.stockLine.update({ where: { id: line.id }, data: { qty, amountTiyin: amount } });
          if (line.expenseId) {
            const e = await tx.expense.findUnique({ where: { id: line.expenseId }, select: { amountTiyin: true } });
            if (e) await tx.expense.update({ where: { id: line.expenseId }, data: { amountTiyin: e.amountTiyin - minus > 0n ? e.amountTiyin - minus : 0n } });
          }
        }
        const left = await tx.stockLine.count({ where: { docId: line.docId } });
        const total = line.doc.totalTiyin - minus > 0n ? line.doc.totalTiyin - minus : 0n;
        if (left === 0 && !line.doc.deletedAt) {
          await tx.stockDoc.update({ where: { id: line.docId }, data: { totalTiyin: total, deletedAt: now, cancelledById: userId ?? null } });
          docCancelled = line.doc.number;
        } else {
          await tx.stockDoc.update({ where: { id: line.docId }, data: { totalTiyin: total } });
        }
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    return { id, inventoryNo: a.inventoryNo, docCancelled };
  }

  async removeAssets(raw: unknown, userId?: string): Promise<{ deleted: { id: string; inventoryNo: string }[]; docsCancelled: string[]; failed: { id: string; reason: string }[] }> {
    const ids = this.ids(raw, 500);
    const deleted: { id: string; inventoryNo: string }[] = [];
    const docsCancelled: string[] = [];
    const failed: { id: string; reason: string }[] = [];
    for (const id of ids) {
      try {
        const r = await this.removeAsset(id, userId);
        deleted.push({ id: r.id, inventoryNo: r.inventoryNo });
        if (r.docCancelled) docsCancelled.push(r.docCancelled);
      } catch (e) {
        failed.push({ id, reason: (e as Error).message });
      }
    }
    return { deleted, docsCancelled, failed };
  }

  async docs(filter: DocFilter): Promise<DocView[]> {
    const kind = filter.kind && DOC_KINDS.includes(filter.kind as StockDocKind) ? (filter.kind as StockDocKind) : undefined;
    // Davr: "YYYY-MM-DD" (umumiy «Davr») yoki "YYYY-MM"
    const from = filter.from ? dayBound(filter.from, 'start') : undefined;
    const to = filter.to ? dayBound(filter.to, 'end') : undefined;
    const term = filter.search?.trim();
    const region = filter.regionCode ? regionOf(filter.regionCode) : null;
    const rows = await this.prisma.stockDoc.findMany({
      where: {
        ...(kind ? { kind } : {}),
        ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
        ...(region !== null ? { regionCode: region } : {}),
        ...(term
          ? {
              OR: [
                { number: { contains: term, mode: 'insensitive' } },
                { counterparty: { contains: term, mode: 'insensitive' } },
                { holderName: { contains: term, mode: 'insensitive' } },
                { documentNo: { contains: term, mode: 'insensitive' } },
                { lines: { some: { item: { name: { contains: term, mode: 'insensitive' } } } } },
              ],
            }
          : {}),
      },
      include: { lines: { include: { item: true } }, moves: { include: { asset: true } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 1000,
    });
    const lk = await this.lookup();
    return rows.map((d) => this.mapDoc(d, lk));
  }

  async doc(id: string): Promise<DocView> {
    const d = await this.prisma.stockDoc.findUnique({ where: { id }, include: { lines: { include: { item: true } }, moves: { include: { asset: true } } } });
    if (!d) throw new NotFoundException('Hujjat topilmadi');
    return this.mapDoc(d, await this.lookup());
  }

  private mapDoc(
    d: Prisma.StockDocGetPayload<{ include: { lines: { include: { item: true } }; moves: { include: { asset: true } } } }>,
    lk: Lookup,
  ): DocView {
    const lines: LineView[] = d.lines.map((l) => ({
      id: l.id,
      itemId: l.itemId,
      itemCode: l.item.code,
      itemName: l.item.name,
      unit: l.item.unit,
      kind: l.item.kind,
      qty: l.qty,
      priceTiyin: l.priceTiyin.toString(),
      amountTiyin: l.amountTiyin.toString(),
      expenseId: l.expenseId,
      note: l.note,
    }));
    const hasFrom = d.fromDepartmentId || d.fromRegionCode !== null || d.fromHolderName;
    return {
      id: d.id,
      number: d.number,
      kind: d.kind,
      kindLabel: DOC_KIND_LABELS[d.kind],
      date: d.date.toISOString().slice(0, 10),
      period: d.period,
      counterparty: d.counterparty,
      documentNo: d.documentNo,
      to: this.place(lk, d),
      from: hasFrom ? this.place(lk, { departmentId: d.fromDepartmentId, regionCode: d.fromRegionCode, holderPinfl: d.fromHolderPinfl, holderName: d.fromHolderName }) : null,
      issuedBy: d.issuedBy,
      responsible: d.responsible,
      reason: d.reason,
      note: d.note,
      totalTiyin: d.totalTiyin.toString(),
      lines,
      assets: d.moves
        .map((m) => ({ id: m.asset.id, inventoryNo: m.asset.inventoryNo, name: m.asset.name, priceTiyin: m.asset.priceTiyin.toString(), condition: m.condition ?? null }))
        .sort((a, b) => a.inventoryNo.localeCompare(b.inventoryNo)),
      createdAt: d.createdAt.toISOString(),
      createdByName: d.createdById ? (lk.users.get(d.createdById) ?? null) : null,
      cancelled: Boolean(d.deletedAt),
      cancelledAt: d.deletedAt ? d.deletedAt.toISOString() : null,
      cancelledByName: d.cancelledById ? (lk.users.get(d.cancelledById) ?? null) : null,
    };
  }

  // ═══════════ Asosiy vositalar ═══════════

  async assets(filter: AssetFilter): Promise<AssetView[]> {
    const status = filter.status && ['IN_STOCK', 'IN_USE', 'WRITTEN_OFF'].includes(filter.status) ? (filter.status as AssetStatus) : undefined;
    const region = filter.regionCode ? regionOf(filter.regionCode) : null;
    const term = filter.search?.trim();
    const holder = filter.holder?.trim();
    const rows = await this.prisma.asset.findMany({
      where: {
        ...(status ? { status } : { status: { not: 'WRITTEN_OFF' } }),
        ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
        ...(region !== null ? { regionCode: region } : {}),
        ...(filter.itemId ? { itemId: filter.itemId } : {}),
        ...(holder ? { OR: [{ holderPinfl: holder }, { holderName: { contains: holder, mode: 'insensitive' } }] } : {}),
        ...(term
          ? {
              AND: [
                {
                  OR: [
                    { inventoryNo: { contains: term, mode: 'insensitive' } },
                    { name: { contains: term, mode: 'insensitive' } },
                    { serialNo: { contains: term, mode: 'insensitive' } },
                    { holderName: { contains: term, mode: 'insensitive' } },
                  ],
                },
              ],
            }
          : {}),
      },
      include: { item: { select: { name: true, group: true } } },
      orderBy: { inventoryNo: 'asc' },
      take: 5000,
    });
    const lk = await this.lookup();
    return rows.map((a) => this.mapAsset(a, lk));
  }

  private mapAsset(a: Prisma.AssetGetPayload<{ include: { item: { select: { name: true; group: true } } } }>, lk: Lookup): AssetView {
    return {
      id: a.id,
      inventoryNo: a.inventoryNo,
      itemId: a.itemId,
      itemName: a.item.name,
      group: a.item.group,
      name: a.name,
      serialNo: a.serialNo,
      priceTiyin: a.priceTiyin.toString(),
      acquiredAt: a.acquiredAt.toISOString().slice(0, 10),
      status: a.status,
      statusLabel: ASSET_STATUS_LABELS[a.status],
      place: this.place(lk, a),
      note: a.note,
    };
  }

  /** Bitta asosiy vosita va uning butun harakat tarixi */
  async asset(id: string): Promise<{ asset: AssetView; moves: AssetMoveView[] }> {
    const a = await this.prisma.asset.findUnique({ where: { id }, include: { item: { select: { name: true, group: true } } } });
    if (!a) throw new NotFoundException('Asosiy vosita topilmadi');
    const moves = await this.prisma.assetMove.findMany({ where: { assetId: id }, include: { doc: { select: { number: true } } }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] });
    const lk = await this.lookup();
    return {
      asset: this.mapAsset(a, lk),
      moves: moves.map((m) => ({
        id: m.id,
        kind: m.kind,
        kindLabel: DOC_KIND_LABELS[m.kind],
        date: m.date.toISOString().slice(0, 10),
        docId: m.docId,
        docNumber: m.doc?.number ?? null,
        from: this.place(lk, { departmentId: m.fromDepartmentId, regionCode: m.fromRegionCode, holderPinfl: m.fromHolderPinfl, holderName: m.fromHolderName }),
        to: this.place(lk, { departmentId: m.toDepartmentId, regionCode: m.toRegionCode, holderPinfl: m.toHolderPinfl, holderName: m.toHolderName }),
        note: m.note,
      })),
    };
  }

  /** Seriya raqami va izohni tahrirlash (joyi faqat hujjat bilan o'zgaradi) */
  async updateAsset(id: string, input: { serialNo?: string | null; note?: string | null; name?: string }): Promise<AssetView> {
    const a = await this.prisma.asset.findUnique({ where: { id }, select: { id: true } });
    if (!a) throw new NotFoundException('Asosiy vosita topilmadi');
    await this.prisma.asset.update({
      where: { id },
      data: {
        ...(input.serialNo !== undefined ? { serialNo: text(input.serialNo, 'Seriya raqami', 80) } : {}),
        ...(input.note !== undefined ? { note: text(input.note, 'Izoh', 500) } : {}),
        ...(input.name !== undefined ? { name: required(input.name, 'Nomi', 160) } : {}),
      },
    });
    return (await this.asset(id)).asset;
  }

  // ═══════════ Kiritishni tezlashtirish ═══════════

  /** Oldingi kirimlardagi yetkazib beruvchilar — oxirgisi birinchi */
  async suppliers(): Promise<{ name: string; lastDate: string; count: number }[]> {
    const rows = await this.prisma.stockDoc.findMany({
      where: { kind: 'RECEIPT', deletedAt: null, counterparty: { not: null } },
      select: { counterparty: true, date: true },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 2000,
    });
    const map = new Map<string, { name: string; lastDate: string; count: number }>();
    for (const r of rows) {
      const name = (r.counterparty ?? '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const x = map.get(key);
      if (x) x.count += 1;
      else map.set(key, { name, lastDate: r.date.toISOString().slice(0, 10), count: 1 });
    }
    return [...map.values()].slice(0, 200);
  }

  /**
   * Kimda nima bor: odam (PINFL yoki ism), bo'lim yoki hudud bo'yicha —
   * foydalanishdagi asosiy vositalar, berilgan va hali qaytmagan TMZ, oxirgi chiqim hujjati.
   * Qaytarish sahifasi va «Oxirgi berilganni takrorlash» shu yerdan oladi.
   */
  async holdings(filter: { holderPinfl?: string; holderName?: string; departmentId?: string; regionCode?: string }): Promise<HoldingsView> {
    const pinfl = filter.holderPinfl?.trim() || null;
    const name = filter.holderName?.trim() || null;
    const dept = filter.departmentId?.trim() || null;
    const region = regionOf(filter.regionCode);
    if (!pinfl && !name && !dept && region === null) throw new BadRequestException("Odam, bo'lim yoki hudud tanlanmagan");

    const who: Prisma.StockDocWhereInput = pinfl
      ? { holderPinfl: pinfl }
      : name
        ? { holderName: { equals: name, mode: 'insensitive' } }
        : dept
          ? { departmentId: dept }
          : { regionCode: region, departmentId: null };
    const assetWho: Prisma.AssetWhereInput = pinfl
      ? { holderPinfl: pinfl }
      : name
        ? { holderName: { equals: name, mode: 'insensitive' } }
        : dept
          ? { departmentId: dept }
          : { regionCode: region, departmentId: null };

    const lk = await this.lookup();
    let title: string;
    if (pinfl) {
      const e = await this.prisma.employee.findUnique({ where: { pinfl }, select: { fullName: true, position: true, departmentId: true, regionCode: true } });
      const place = e?.departmentId ? lk.departments.get(e.departmentId) : e && e.regionCode !== CENTRAL_REGION ? lk.regions.get(e.regionCode) : null;
      title = [e?.fullName ?? name ?? pinfl, e?.position, place].filter(Boolean).join(' · ');
    } else if (name) title = name;
    else if (dept) title = lk.departments.get(dept) ?? "Bo'lim";
    else title = region === CENTRAL_REGION ? 'Markaz' : (lk.regions.get(region!) ?? `Hudud ${region}`);
    const [assets, lines, last] = await Promise.all([
      this.prisma.asset.findMany({ where: { status: 'IN_USE', ...assetWho }, include: { item: { select: { name: true, group: true } } }, orderBy: { inventoryNo: 'asc' } }),
      this.prisma.stockLine.findMany({
        where: { doc: { deletedAt: null, kind: { in: ['ISSUE', 'RETURN'] }, ...who }, item: { kind: 'TMZ' } },
        select: { itemId: true, qty: true, doc: { select: { kind: true } } },
      }),
      this.prisma.stockDoc.findFirst({
        where: { deletedAt: null, kind: 'ISSUE', ...who },
        include: { lines: { include: { item: true } }, moves: { include: { asset: true } } },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);

    const net = new Map<string, number>();
    for (const l of lines) net.set(l.itemId, (net.get(l.itemId) ?? 0) + (l.doc.kind === 'ISSUE' ? l.qty : -l.qty));
    const heldIds = [...net.entries()].filter(([, q]) => q > 1e-9).map(([id]) => id);
    const items = heldIds.length ? await this.items({ all: true }).then((all) => all.filter((i) => heldIds.includes(i.id))) : [];

    return {
      title,
      assets: assets.map((a) => this.mapAsset(a, lk)),
      tmz: items
        .map((i) => ({ itemId: i.id, itemCode: i.code, itemName: i.name, unit: i.unit, qty: Math.round((net.get(i.id) ?? 0) * 1000) / 1000, avgPriceTiyin: i.avgPriceTiyin }))
        .sort((a, b) => a.itemName.localeCompare(b.itemName)),
      lastIssue: last ? this.mapDoc(last, lk) : null,
    };
  }

  // ═══════════ Umumiy ko'rinish (rahbariyat uchun) ═══════════

  async overview(fromInput?: string, toInput?: string): Promise<WarehouseOverview> {
    const today = todayIso();
    const from = fromInput && DATE_RE.test(fromInput) ? fromInput : `${today.slice(0, 7)}-01`;
    const to = toInput && DATE_RE.test(toInput) ? toInput : today;
    const lk = await this.lookup();
    const [items, assets, docs, issued] = await Promise.all([
      this.items(),
      this.prisma.asset.findMany({ where: { status: { not: 'WRITTEN_OFF' } }, select: { status: true, priceTiyin: true, departmentId: true, regionCode: true, holderName: true } }),
      this.prisma.stockDoc.findMany({
        where: { deletedAt: null, kind: { in: ['RECEIPT', 'ISSUE'] }, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
        select: { kind: true, totalTiyin: true },
      }),
      // Berilgan TMZ (chiqim − qaytarish) joylar bo'yicha — butun davr
      this.prisma.stockLine.findMany({
        where: { doc: { deletedAt: null, kind: { in: ['ISSUE', 'RETURN'] } }, item: { kind: 'TMZ' } },
        select: { amountTiyin: true, doc: { select: { kind: true, departmentId: true, regionCode: true } } },
      }),
    ]);

    const byPlace = new Map<string, { key: string; name: string; assets: number; assetsValueTiyin: bigint; tmzIssuedTiyin: bigint }>();
    const placeKey = (departmentId: string | null, regionCode: number | null) => {
      if (departmentId) return { key: `d:${departmentId}`, name: lk.departments.get(departmentId) ?? "Bo'lim" };
      if (regionCode !== null && regionCode !== CENTRAL_REGION) return { key: `r:${regionCode}`, name: lk.regions.get(regionCode) ?? `Hudud ${regionCode}` };
      if (regionCode === CENTRAL_REGION) return { key: 'center', name: 'Markaz' };
      return { key: 'person', name: "Shaxsan (bo'limsiz)" };
    };
    const acc = (k: { key: string; name: string }) => {
      const x = byPlace.get(k.key) ?? { ...k, assets: 0, assetsValueTiyin: 0n, tmzIssuedTiyin: 0n };
      byPlace.set(k.key, x);
      return x;
    };
    for (const a of assets.filter((x) => x.status === 'IN_USE')) {
      const x = acc(placeKey(a.departmentId, a.regionCode));
      x.assets += 1;
      x.assetsValueTiyin += a.priceTiyin;
    }
    for (const l of issued) {
      const x = acc(placeKey(l.doc.departmentId, l.doc.regionCode));
      x.tmzIssuedTiyin += l.doc.kind === 'ISSUE' ? l.amountTiyin : -l.amountTiyin;
    }

    const receipts = docs.filter((d) => d.kind === 'RECEIPT');
    const issues = docs.filter((d) => d.kind === 'ISSUE');
    return {
      items: items.length,
      tmzValueTiyin: items.filter((i) => i.kind === 'TMZ').reduce((s, i) => s + BigInt(i.stockValueTiyin), 0n).toString(),
      assetsTotal: assets.length,
      assetsInStock: assets.filter((a) => a.status === 'IN_STOCK').length,
      assetsInUse: assets.filter((a) => a.status === 'IN_USE').length,
      assetsValueTiyin: assets.reduce((s, a) => s + a.priceTiyin, 0n).toString(),
      lowItems: items.filter((i) => i.low).map((i) => ({ id: i.id, name: i.name, unit: i.unit, inStock: i.inStock, minQty: i.minQty ?? 0 })),
      period: {
        from,
        to,
        receiptsTiyin: receipts.reduce((s, d) => s + d.totalTiyin, 0n).toString(),
        issuesTiyin: issues.reduce((s, d) => s + d.totalTiyin, 0n).toString(),
        receipts: receipts.length,
        issues: issues.length,
      },
      byPlace: [...byPlace.values()]
        .sort((a, b) => Number(b.assetsValueTiyin + b.tmzIssuedTiyin - (a.assetsValueTiyin + a.tmzIssuedTiyin)))
        .map((x) => ({ key: x.key, name: x.name, assets: x.assets, assetsValueTiyin: x.assetsValueTiyin.toString(), tmzIssuedTiyin: x.tmzIssuedTiyin.toString() })),
    };
  }
}