import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type PurchaseKind, type PurchaseRequestStatus } from '@prisma/client';
import { SERIALIZABLE, lineAmount, withRetry } from '../../common/db/retry';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { WarehouseService, parseDate, text } from '../warehouse/warehouse.service';
import { CENTRAL_REGION, WAREHOUSE_PARENT_CATEGORY } from '../warehouse/warehouse.types';
import { lockInTx } from '../../common/db/tx-lock';

// ═══════════════════════════════════════════════════════════
// Xarid: yetkazuvchilar, arizalar, birja va oddiy xaridlar, to'lovlar.
//  • Xarid — buyurtma. Tovar kelganda xaridchi «Omborga qabul» yozadi (receipts.service.ts),
//    omborchi qabul qilgandan keyingina qoldiqqa va Xarajatlarga tushadi.
//  • Birja yig'imi — alohida xarajat (Ombor: birja yig'imi), xarid bekor bo'lsa u ham bekor.
//  • To'langan summa — to'lovlardan hisoblanadi (alohida ustun yo'q, har doim to'g'ri).
// ═══════════════════════════════════════════════════════════

export const FEE_CATEGORY = 'WH_EXCHANGE_FEE';
const KINDS: PurchaseKind[] = ['EXCHANGE', 'DIRECT'];
const METHODS = ['CASH', 'BANK', 'CARD', 'OTHER'];
const MAX_LINES = 100;

type Tx = Prisma.TransactionClient;

export interface SupplierInput { name?: string; inn?: string | null; phone?: string | null; note?: string | null }
export interface PurchaseLineInput { itemId?: string; qty?: number | string; priceTiyin?: string | number }
export interface PurchaseInput {
  kind?: string;
  date?: string;
  supplierId?: string | null;
  supplierName?: string | null;
  lotNo?: string | null;
  exchange?: string | null;
  documentNo?: string | null;
  deliveryDue?: string | null;
  paymentDue?: string | null;
  requestId?: string | null;
  feeTiyin?: string | number | null;
  note?: string | null;
  lines?: PurchaseLineInput[];
}
export interface PaymentInput { date?: string; amountTiyin?: string | number; method?: string; note?: string | null }
export interface RequestInput {
  date?: string;
  departmentId?: string | null;
  requester?: string | null;
  title?: string;
  note?: string | null;
  lines?: { name?: string; qty?: number | string; unit?: string; itemId?: string | null }[];
}

function money(value: unknown, label: string, allowZero = true): bigint {
  let v: bigint;
  try {
    v = BigInt(String(value ?? '0').trim() || '0');
  } catch {
    throw new BadRequestException(`${label} noto'g'ri`);
  }
  if (v < 0n || (!allowZero && v === 0n)) throw new BadRequestException(allowZero ? `${label} manfiy bo'lmasin` : `${label} noldan katta bo'lsin`);
  if (v > 100_000_000_000_00n) throw new BadRequestException(`${label} juda katta`);
  return v;
}

function qtyOf(value: unknown, label: string): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.').trim());
  if (!Number.isFinite(n) || n <= 0) throw new BadRequestException(`${label}: miqdor noldan katta bo'lsin`);
  if (n > 10_000_000) throw new BadRequestException(`${label}: miqdor juda katta`);
  return Math.round(n * 1000) / 1000;
}

function optDate(value: unknown, label: string): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const m = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!m) throw new BadRequestException(`${label} noto'g'ri (YYYY-MM-DD)`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3])) throw new BadRequestException(`${label} noto'g'ri`);
  return d;
}

function todayStart(): Date {
  const t = new Date(Date.now() + 5 * 3600_000);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export interface PurchaseView {
  id: string;
  number: string;
  kind: PurchaseKind;
  date: string;
  supplierId: string | null;
  supplierName: string;
  lotNo: string | null;
  exchange: string | null;
  documentNo: string | null;
  deliveryDue: string | null;
  paymentDue: string | null;
  requestId: string | null;
  requestNumber: string | null;
  status: 'OPEN' | 'DELIVERED' | 'CANCELLED';
  totalTiyin: string;
  feeTiyin: string;
  paidTiyin: string;
  debtTiyin: string;
  /** Qabul kutilayotgan (omborchi hali ko'rmagan) kirimlar soni */
  pendingReceipts: number;
  /** Yetkazish muddati o'tganmi */
  deliveryLate: boolean;
  paymentLate: boolean;
  note: string | null;
  createdByName: string | null;
  createdAt: string;
  deliveredAt: string | null;
  lines: { id: string; itemId: string; itemName: string; unit: string; qty: number; priceTiyin: string; amountTiyin: string; receivedQty: number }[];
  payments: { id: string; date: string; amountTiyin: string; method: string; note: string | null }[];
  receipts: { id: string; number: string; status: string; date: string }[];
}

type PurchaseRow = Prisma.PurchaseGetPayload<{ include: { lines: true; payments: true; receipts: { include: { lines: true } } } }>;

@Injectable()
export class PurchasesService {
  private feeReady: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly warehouse: WarehouseService,
  ) {}

  // ═══════════ Ma'lumotnomalar ═══════════

  private ensureFeeCategory(): Promise<void> {
    if (!this.feeReady) {
      this.feeReady = (async () => {
        await this.warehouse.ensureCategories();
        await this.prisma.category.upsert({
          where: { code: FEE_CATEGORY },
          update: {},
          create: { code: FEE_CATEGORY, label: "Ombor: birja yig'imi", parentCode: WAREHOUSE_PARENT_CATEGORY, isLeaf: true, behavior: 'VARIABLE', order: 580 },
        });
      })().catch((e: unknown) => {
        this.feeReady = null;
        throw e;
      });
    }
    return this.feeReady;
  }

  async lookups() {
    const base = await this.warehouse.lookups();
    const suppliers = await this.prisma.supplier.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
    return {
      departments: base.departments,
      categories: base.categories,
      units: base.units,
      groups: base.groups,
      suppliers,
      methods: [
        { value: 'BANK', label: "Bank o'tkazmasi" },
        { value: 'CASH', label: 'Naqd' },
        { value: 'CARD', label: 'Karta' },
        { value: 'OTHER', label: 'Boshqa' },
      ],
    };
  }

  // ═══════════ Yetkazuvchilar ═══════════

  private supplierData(input: SupplierInput) {
    const name = text(input.name, 'Yetkazuvchi nomi', 200);
    if (!name || name.length < 2) throw new BadRequestException('Yetkazuvchi nomini yozing');
    return { name, inn: text(input.inn, 'STIR', 20), phone: text(input.phone, 'Telefon', 40), note: text(input.note, 'Izoh', 500) };
  }

  async createSupplier(input: SupplierInput, userId: string) {
    const data = this.supplierData(input ?? {});
    const dup = await this.prisma.supplier.findFirst({ where: { name: { equals: data.name, mode: 'insensitive' } } });
    if (dup) throw new BadRequestException(`«${dup.name}» allaqachon bor`);
    const row = await this.prisma.supplier.create({ data });
    await this.audit.log({ userId, action: 'CREATE', entity: 'supplier', entityId: row.id, summary: `Yetkazuvchi qo'shildi: ${row.name}` });
    return row;
  }

  async updateSupplier(id: string, input: SupplierInput & { isActive?: boolean }, userId: string) {
    const base = await this.prisma.supplier.findUnique({ where: { id } });
    if (!base) throw new NotFoundException('Yetkazuvchi topilmadi');
    const data = this.supplierData({ name: input.name ?? base.name, inn: input.inn !== undefined ? input.inn : base.inn, phone: input.phone !== undefined ? input.phone : base.phone, note: input.note !== undefined ? input.note : base.note });
    const dup = await this.prisma.supplier.findFirst({ where: { name: { equals: data.name, mode: 'insensitive' }, id: { not: id } } });
    if (dup) throw new BadRequestException(`«${dup.name}» allaqachon bor`);
    const row = await this.prisma.supplier.update({ where: { id }, data: { ...data, ...(typeof input.isActive === 'boolean' ? { isActive: input.isActive } : {}) } });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'supplier', entityId: id, summary: `Yetkazuvchi o'zgartirildi: ${row.name}` });
    return row;
  }

  /** Yetkazuvchilar: kimdan qancha olingan, qarz, oxirgi xarid */
  async suppliers() {
    const [suppliers, purchases] = await Promise.all([
      this.prisma.supplier.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.purchase.findMany({ where: { deletedAt: null, status: { not: 'CANCELLED' } }, include: { payments: true } }),
    ]);
    return suppliers.map((s) => {
      const mine = purchases.filter((p) => p.supplierId === s.id);
      const total = mine.reduce((a, p) => a + p.totalTiyin, 0n);
      const paid = mine.reduce((a, p) => a + p.payments.filter((x) => !x.deletedAt).reduce((b, x) => b + x.amountTiyin, 0n), 0n);
      const last = mine.map((p) => p.date).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      return {
        id: s.id,
        name: s.name,
        inn: s.inn,
        phone: s.phone,
        note: s.note,
        isActive: s.isActive,
        purchases: mine.length,
        totalTiyin: String(total),
        paidTiyin: String(paid),
        debtTiyin: String(total > paid ? total - paid : 0n),
        lastDate: iso(last),
      };
    });
  }

  /** Oxirgi narxlar: shu yetkazuvchidan shu buyum qancha edi (xarid yozishda yordam) */
  async lastPrices(itemIds: string[]) {
    const ids = itemIds.filter(Boolean).slice(0, 50);
    if (ids.length === 0) return {};
    const lines = await this.prisma.purchaseLine.findMany({ where: { itemId: { in: ids }, purchase: { deletedAt: null, status: { not: 'CANCELLED' } } }, include: { purchase: true }, orderBy: { id: 'desc' }, take: 500 });
    const out: Record<string, { priceTiyin: string; date: string; supplier: string }> = {};
    for (const l of lines.sort((a, b) => b.purchase.date.getTime() - a.purchase.date.getTime())) {
      if (!out[l.itemId]) out[l.itemId] = { priceTiyin: String(l.priceTiyin), date: iso(l.purchase.date)!, supplier: l.purchase.supplierName };
    }
    return out;
  }

  // ═══════════ Arizalar ═══════════

  private async nextNumber(tx: Tx, kind: 'request' | 'purchase', date: Date): Promise<string> {
    const prefix = `${kind === 'request' ? 'AR' : 'XD'}-${date.getUTCFullYear()}-`;
    await lockInTx(tx, `number:${prefix}`); // bir vaqtdagi so'rovlar navbat bilan raqam oladi
    // Eng katta raqam (matn tartibi 10 000-hujjatdan keyin buziladi — shuning uchun son bo'yicha)
    const rows =
      kind === 'request'
        ? await tx.purchaseRequest.findMany({ where: { number: { startsWith: prefix } }, select: { number: true } })
        : await tx.purchase.findMany({ where: { number: { startsWith: prefix } }, select: { number: true } });
    const n = rows.reduce((m, r) => Math.max(m, Number(r.number.slice(prefix.length)) || 0), 0) + 1;
    return `${prefix}${String(n).padStart(4, '0')}`;
  }

  async requests(filter: { status?: string } = {}) {
    const where: Prisma.PurchaseRequestWhereInput = filter.status && filter.status !== 'all' ? (filter.status === 'active' ? { status: { in: ['NEW', 'IN_PROGRESS'] } } : { status: filter.status as PurchaseRequestStatus }) : {};
    const rows = await this.prisma.purchaseRequest.findMany({ where, include: { lines: true, purchases: { select: { id: true, number: true } } }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 300 });
    const departments = new Map((await this.prisma.department.findMany({ select: { id: true, name: true } })).map((d) => [d.id, d.name]));
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      date: iso(r.date)!,
      departmentId: r.departmentId,
      departmentName: r.departmentId ? (departments.get(r.departmentId) ?? null) : null,
      requester: r.requester,
      title: r.title,
      note: r.note,
      status: r.status,
      rejectReason: r.rejectReason,
      lines: r.lines.map((l) => ({ id: l.id, name: l.name, qty: l.qty, unit: l.unit, itemId: l.itemId })),
      purchases: r.purchases,
    }));
  }

  async createRequest(input: RequestInput, userId: string) {
    const body = input ?? {};
    const { date } = parseDate(body.date ?? new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10));
    const title = text(body.title, 'Ariza mavzusi', 200);
    if (!title || title.length < 2) throw new BadRequestException('Ariza mavzusini yozing');
    const departmentId = text(body.departmentId, "Bo'lim", 40);
    if (departmentId && !(await this.prisma.department.findUnique({ where: { id: departmentId }, select: { id: true } }))) throw new BadRequestException("Bo'lim topilmadi");
    const raw = Array.isArray(body.lines) ? body.lines : [];
    if (raw.length === 0) throw new BadRequestException("Arizada kamida bitta tovar bo'lsin");
    if (raw.length > 50) throw new BadRequestException("Ariza 50 qatordan oshmasin");
    const lines = raw.map((l, i) => {
      const name = text(l.name, `${i + 1}-qator nomi`, 200);
      if (!name) throw new BadRequestException(`${i + 1}-qator: tovar nomi yozilmagan`);
      return { name, qty: qtyOf(l.qty, `${i + 1}-qator`), unit: text(l.unit, "O'lchov", 20) ?? 'dona', itemId: text(l.itemId, 'Buyum', 40) };
    });
    const row = await withRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const number = await this.nextNumber(tx, 'request', date);
        return tx.purchaseRequest.create({
          data: { number, date, departmentId, requester: text(body.requester, "So'rovchi", 160), title, note: text(body.note, 'Izoh', 1000), createdById: userId, lines: { create: lines } },
        });
      }),
    );
    await this.audit.log({ userId, action: 'CREATE', entity: 'purchase_request', entityId: row.id, summary: `Xarid arizasi ${row.number}: ${title}` });
    return (await this.requests({ status: 'all' })).find((r) => r.id === row.id)!;
  }

  async setRequestStatus(id: string, status: PurchaseRequestStatus, reason: unknown, userId: string) {
    const base = await this.prisma.purchaseRequest.findUnique({ where: { id } });
    if (!base) throw new NotFoundException('Ariza topilmadi');
    const why = text(reason, 'Sabab', 300);
    if (status === 'REJECTED' && !why) throw new BadRequestException('Rad etish sababini yozing');
    await this.prisma.purchaseRequest.update({ where: { id }, data: { status, rejectReason: status === 'REJECTED' ? why : null } });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'purchase_request', entityId: id, summary: `Ariza ${base.number}: ${status === 'DONE' ? 'bajarildi' : status === 'REJECTED' ? `rad etildi (${why})` : status === 'IN_PROGRESS' ? 'ishga olindi' : 'qayta ochildi'}` });
    return (await this.requests({ status: 'all' })).find((r) => r.id === id)!;
  }

  // ═══════════ Xaridlar ═══════════

  private async view(rows: PurchaseRow[]): Promise<PurchaseView[]> {
    const itemIds = [...new Set(rows.flatMap((r) => r.lines.map((l) => l.itemId)))];
    const reqIds = [...new Set(rows.map((r) => r.requestId).filter((x): x is string => Boolean(x)))];
    const userIds = [...new Set(rows.map((r) => r.createdById).filter((x): x is string => Boolean(x)))];
    const [items, reqs, users] = await Promise.all([
      itemIds.length ? this.prisma.stockItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true, unit: true } }) : [],
      reqIds.length ? this.prisma.purchaseRequest.findMany({ where: { id: { in: reqIds } }, select: { id: true, number: true } }) : [],
      userIds.length ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : [],
    ]);
    const itemBy = new Map(items.map((i) => [i.id, i]));
    const reqBy = new Map(reqs.map((r) => [r.id, r.number]));
    const userBy = new Map(users.map((u) => [u.id, u.fullName]));
    const today = todayStart().getTime();
    return rows.map((r) => {
      const payments = r.payments.filter((p) => !p.deletedAt);
      const paid = payments.reduce((a, p) => a + p.amountTiyin, 0n);
      const debt = r.totalTiyin > paid ? r.totalTiyin - paid : 0n;
      const accepted = new Map<string, number>();
      for (const rc of r.receipts.filter((x) => x.status === 'ACCEPTED')) for (const l of rc.lines) accepted.set(l.itemId, (accepted.get(l.itemId) ?? 0) + l.qty);
      const open = r.status === 'OPEN';
      return {
        id: r.id,
        number: r.number,
        kind: r.kind,
        date: iso(r.date)!,
        supplierId: r.supplierId,
        supplierName: r.supplierName,
        lotNo: r.lotNo,
        exchange: r.exchange,
        documentNo: r.documentNo,
        deliveryDue: iso(r.deliveryDue),
        paymentDue: iso(r.paymentDue),
        requestId: r.requestId,
        requestNumber: r.requestId ? (reqBy.get(r.requestId) ?? null) : null,
        status: r.status,
        totalTiyin: String(r.totalTiyin),
        feeTiyin: String(r.feeTiyin),
        paidTiyin: String(paid),
        debtTiyin: String(debt),
        pendingReceipts: r.receipts.filter((x) => x.status === 'PENDING').length,
        deliveryLate: open && r.deliveryDue !== null && r.deliveryDue.getTime() < today,
        paymentLate: r.status !== 'CANCELLED' && debt > 0n && r.paymentDue !== null && r.paymentDue.getTime() < today,
        note: r.note,
        createdByName: r.createdById ? (userBy.get(r.createdById) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
        deliveredAt: r.deliveredAt ? r.deliveredAt.toISOString() : null,
        lines: r.lines.map((l) => ({
          id: l.id,
          itemId: l.itemId,
          itemName: itemBy.get(l.itemId)?.name ?? '—',
          unit: itemBy.get(l.itemId)?.unit ?? 'dona',
          qty: l.qty,
          priceTiyin: String(l.priceTiyin),
          amountTiyin: String(l.amountTiyin),
          receivedQty: Math.round((accepted.get(l.itemId) ?? 0) * 1000) / 1000,
        })),
        payments: payments.sort((a, b) => a.date.getTime() - b.date.getTime()).map((p) => ({ id: p.id, date: iso(p.date)!, amountTiyin: String(p.amountTiyin), method: p.method, note: p.note })),
        receipts: r.receipts.map((x) => ({ id: x.id, number: x.number, status: x.status, date: iso(x.date)! })),
      };
    });
  }

  private static readonly INCLUDE = { lines: true, payments: true, receipts: { include: { lines: true } } } as const;

  /** filter.status: active (OPEN) | delivered | cancelled | unpaid | late | all */
  async list(filter: { status?: string; kind?: string; supplierId?: string; search?: string } = {}): Promise<PurchaseView[]> {
    const where: Prisma.PurchaseWhereInput = { deletedAt: null };
    const s = filter.status ?? 'active';
    if (s === 'active') where.status = 'OPEN';
    else if (s === 'delivered') where.status = 'DELIVERED';
    else if (s === 'cancelled') where.status = 'CANCELLED';
    else if (s === 'all' || s === 'unpaid' || s === 'late') where.status = { not: 'CANCELLED' };
    if (filter.kind && KINDS.includes(filter.kind as PurchaseKind)) where.kind = filter.kind as PurchaseKind;
    if (filter.supplierId) where.supplierId = filter.supplierId;
    const term = filter.search?.trim();
    if (term) where.OR = [{ supplierName: { contains: term, mode: 'insensitive' } }, { number: { contains: term, mode: 'insensitive' } }, { lotNo: { contains: term, mode: 'insensitive' } }, { documentNo: { contains: term, mode: 'insensitive' } }];
    const rows = await this.prisma.purchase.findMany({ where, include: PurchasesService.INCLUDE, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 500 });
    let out = await this.view(rows as PurchaseRow[]);
    if (s === 'unpaid') out = out.filter((p) => BigInt(p.debtTiyin) > 0n);
    if (s === 'late') out = out.filter((p) => p.deliveryLate || p.paymentLate);
    return out;
  }

  async get(id: string): Promise<PurchaseView> {
    const row = await this.prisma.purchase.findUnique({ where: { id }, include: PurchasesService.INCLUDE });
    if (!row || row.deletedAt) throw new NotFoundException('Xarid topilmadi');
    return (await this.view([row as PurchaseRow]))[0]!;
  }

  private async data(input: PurchaseInput, base?: PurchaseRow) {
    const kindRaw = input.kind ?? base?.kind;
    if (!KINDS.includes(kindRaw as PurchaseKind)) throw new BadRequestException("Xarid turi noto'g'ri (birja yoki oddiy)");
    const kind = kindRaw as PurchaseKind;
    const dateInput = input.date ?? (base ? iso(base.date)! : undefined);
    const { date, period } = parseDate(dateInput);
    let supplierId = input.supplierId !== undefined ? text(input.supplierId, 'Yetkazuvchi', 40) : (base?.supplierId ?? null);
    let supplierName = input.supplierName !== undefined ? text(input.supplierName, 'Yetkazuvchi', 200) : (base?.supplierName ?? null);
    if (supplierId) {
      const s = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
      if (!s) throw new BadRequestException('Yetkazuvchi topilmadi');
      supplierName = s.name;
    } else if (supplierName) {
      // Yangi nom — ro'yxatga o'zi qo'shiladi (mavjud bo'lsa shuni oladi)
      const found = await this.prisma.supplier.findFirst({ where: { name: { equals: supplierName, mode: 'insensitive' } } });
      if (found) {
        supplierId = found.id;
        supplierName = found.name;
      }
    }
    if (!supplierName) throw new BadRequestException('Yetkazuvchini tanlang yoki nomini yozing');
    const lotNo = text(input.lotNo !== undefined ? input.lotNo : base?.lotNo, 'Lot raqami', 80);
    if (kind === 'EXCHANGE' && !lotNo) throw new BadRequestException('Birja bitimi uchun lot raqamini yozing');
    const deliveryDue = input.deliveryDue !== undefined ? optDate(input.deliveryDue, 'Yetkazish muddati') : (base?.deliveryDue ?? null);
    const paymentDue = input.paymentDue !== undefined ? optDate(input.paymentDue, "To'lov muddati") : (base?.paymentDue ?? null);
    if (deliveryDue && deliveryDue.getTime() < date.getTime()) throw new BadRequestException("Yetkazish muddati xarid sanasidan oldin bo'lmasin");
    const requestId = input.requestId !== undefined ? text(input.requestId, 'Ariza', 40) : (base?.requestId ?? null);
    if (requestId && !(await this.prisma.purchaseRequest.findUnique({ where: { id: requestId }, select: { id: true } }))) throw new BadRequestException('Ariza topilmadi');
    const feeTiyin = kind === 'EXCHANGE' ? money(input.feeTiyin !== undefined ? input.feeTiyin : (base?.feeTiyin ?? 0), "Birja yig'imi") : 0n;
    return {
      kind,
      date,
      period,
      supplierId,
      supplierName,
      lotNo,
      exchange: kind === 'EXCHANGE' ? text(input.exchange !== undefined ? input.exchange : base?.exchange, 'Birja nomi', 120) : null,
      documentNo: text(input.documentNo !== undefined ? input.documentNo : base?.documentNo, 'Shartnoma/faktura raqami', 80),
      deliveryDue,
      paymentDue,
      requestId,
      feeTiyin,
      note: text(input.note !== undefined ? input.note : base?.note, 'Izoh', 1000),
    };
  }

  private async lines(raw: PurchaseLineInput[] | undefined) {
    const list = Array.isArray(raw) ? raw : [];
    if (list.length === 0) throw new BadRequestException("Xaridda kamida bitta tovar bo'lsin");
    if (list.length > MAX_LINES) throw new BadRequestException(`Qatorlar ${MAX_LINES} tadan oshmasin`);
    const ids = [...new Set(list.map((l) => String(l.itemId ?? '')))].filter(Boolean);
    const items = await this.prisma.stockItem.findMany({ where: { id: { in: ids } } });
    const by = new Map(items.map((i) => [i.id, i]));
    return list.map((l, i) => {
      const label = `${i + 1}-qator`;
      const item = by.get(String(l.itemId ?? ''));
      if (!item) throw new BadRequestException(`${label}: tovar tanlanmagan`);
      if (!item.isActive) throw new BadRequestException(`${label}: «${item.name}» faol emas`);
      const qty = qtyOf(l.qty, label);
      if (item.kind === 'ASSET' && !Number.isInteger(qty)) throw new BadRequestException(`${label}: asosiy vosita soni butun bo'lsin`);
      const price = money(l.priceTiyin, `${label}: narx`);
      return { itemId: item.id, qty, priceTiyin: price, amountTiyin: lineAmount(qty, price, label) };
    });
  }

  /** Birja yig'imi xarajati: yaratadi / yangilaydi / bekor qiladi */
  private async syncFee(tx: Tx, p: { id: string; number: string; date: Date; period: string; feeTiyin: bigint; feeExpenseId: string | null; supplierName: string; lotNo: string | null; documentNo: string | null }, userId: string, cancel = false): Promise<string | null> {
    if (cancel || p.feeTiyin === 0n) {
      if (p.feeExpenseId) await tx.expense.update({ where: { id: p.feeExpenseId }, data: { deletedAt: new Date() } }).catch(() => undefined);
      return null;
    }
    const data = {
      date: p.date,
      period: p.period,
      amountTiyin: p.feeTiyin,
      description: `Birja yig'imi ${p.number}${p.lotNo ? `, lot ${p.lotNo}` : ''}: ${p.supplierName}`.slice(0, 500),
      documentNo: p.documentNo,
      counterparty: p.supplierName,
    };
    if (p.feeExpenseId) {
      await tx.expense.update({ where: { id: p.feeExpenseId }, data: { ...data, deletedAt: null } });
      return p.feeExpenseId;
    }
    const e = await tx.expense.create({
      data: { ...data, categoryCode: FEE_CATEGORY, regionCode: CENTRAL_REGION, paymentMethod: 'BANK', paymentStatus: 'PAID', source: 'WAREHOUSE', section: 'BOSHQA', createdById: userId },
      select: { id: true },
    });
    return e.id;
  }

  async create(input: PurchaseInput, userId: string): Promise<PurchaseView> {
    const body = input ?? {};
    const d = await this.data(body);
    const lines = await this.lines(body.lines);
    const total = lines.reduce((s, l) => s + l.amountTiyin, 0n);
    if (d.feeTiyin > 0n) await this.ensureFeeCategory();
    const id = await withRetry(() =>
      this.prisma.$transaction(
      async (tx) => {
        let supplierId = d.supplierId;
        if (!supplierId) supplierId = (await tx.supplier.create({ data: { name: d.supplierName } })).id;
        const number = await this.nextNumber(tx, 'purchase', d.date);
        const row = await tx.purchase.create({ data: { ...d, supplierId, number, totalTiyin: total, createdById: userId, lines: { create: lines } } });
        const feeExpenseId = await this.syncFee(tx, { ...row, feeExpenseId: null }, userId);
        if (feeExpenseId) await tx.purchase.update({ where: { id: row.id }, data: { feeExpenseId } });
        if (d.requestId) await tx.purchaseRequest.update({ where: { id: d.requestId }, data: { status: 'IN_PROGRESS' } });
        return row.id;
      },
      { timeout: 30_000 },
    ),
    );
    const view = await this.get(id);
    await this.audit.log({ userId, action: 'CREATE', entity: 'purchase', entityId: id, summary: `Xarid ${view.number} (${d.kind === 'EXCHANGE' ? 'birja' : 'oddiy'}): ${view.supplierName}, ${view.lines.length} qator` });
    return view;
  }

  /** Tahrirlash: faqat ochiq xarid, tovar hali qabul qilinmagan bo'lsa qatorlar ham o'zgaradi */
  async update(id: string, input: PurchaseInput, userId: string): Promise<PurchaseView> {
    const base = await this.prisma.purchase.findUnique({ where: { id }, include: PurchasesService.INCLUDE });
    if (!base || base.deletedAt) throw new NotFoundException('Xarid topilmadi');
    if (base.status !== 'OPEN') throw new BadRequestException('Faqat ochiq xarid tahrirlanadi');
    const hasReceipts = base.receipts.some((r) => r.status !== 'REJECTED');
    const body = input ?? {};
    const d = await this.data(body, base as PurchaseRow);
    if (d.feeTiyin > 0n) await this.ensureFeeCategory();
    const newLines = body.lines !== undefined ? await this.lines(body.lines) : null;
    if (newLines && hasReceipts) throw new BadRequestException("Omborga qabul yozilgan — tovar qatorlarini o'zgartirib bo'lmaydi");
    const total = newLines ? newLines.reduce((s, l) => s + l.amountTiyin, 0n) : base.totalTiyin;
    await withRetry(() => this.prisma.$transaction(async (tx) => {
      // Tekshiruvni tranzaksiya ichida qayta qilamiz: shu orada omborchi qabul qilgan yoki xarid bekor bo'lgan bo'lishi mumkin
      const cur = await tx.purchase.findUnique({ where: { id }, select: { status: true, receipts: { select: { status: true } } } });
      if (!cur || cur.status !== 'OPEN') throw new BadRequestException('Faqat ochiq xarid tahrirlanadi');
      if (newLines && cur.receipts.some((r) => r.status !== 'REJECTED')) throw new BadRequestException("Omborga qabul yozilgan — tovar qatorlarini o'zgartirib bo'lmaydi");
      await tx.purchase.update({ where: { id }, data: { ...d, totalTiyin: total } });
      if (newLines) {
        await tx.purchaseLine.deleteMany({ where: { purchaseId: id } });
        await tx.purchaseLine.createMany({ data: newLines.map((l) => ({ ...l, purchaseId: id })) });
      }
      const feeExpenseId = await this.syncFee(tx, { id, number: base.number, ...d, feeExpenseId: base.feeExpenseId }, userId);
      await tx.purchase.update({ where: { id }, data: { feeExpenseId } });
    }, SERIALIZABLE));
    await this.audit.log({ userId, action: 'UPDATE', entity: 'purchase', entityId: id, summary: `Xarid ${base.number} o'zgartirildi` });
    return this.get(id);
  }

  async cancel(id: string, userId: string): Promise<PurchaseView> {
    const base = await this.prisma.purchase.findUnique({ where: { id }, include: PurchasesService.INCLUDE });
    if (!base || base.deletedAt) throw new NotFoundException('Xarid topilmadi');
    if (base.status === 'CANCELLED') throw new BadRequestException('Xarid allaqachon bekor qilingan');
    if (base.receipts.some((r) => r.status === 'ACCEPTED')) throw new BadRequestException("Tovar omborga qabul qilingan — xaridni bekor qilib bo'lmaydi (avval omborchi bilan kelishing)");
    await withRetry(() => this.prisma.$transaction(async (tx) => {
      // Omborchi aynan shu paytda qabul qilib qo'ygan bo'lishi mumkin — tranzaksiya ichida qayta tekshiramiz
      const accepted = await tx.goodsReceipt.count({ where: { purchaseId: id, status: 'ACCEPTED' } });
      if (accepted > 0) throw new BadRequestException("Tovar omborga qabul qilingan — xaridni bekor qilib bo'lmaydi (avval omborchi bilan kelishing)");
      await tx.goodsReceipt.updateMany({ where: { purchaseId: id, status: 'PENDING' }, data: { status: 'REJECTED', rejectReason: 'Xarid bekor qilindi', decidedAt: new Date() } });
      await this.syncFee(tx, { ...base, feeExpenseId: base.feeExpenseId }, userId, true);
      await tx.purchase.update({ where: { id }, data: { status: 'CANCELLED', feeExpenseId: null } });
    }, SERIALIZABLE));
    await this.audit.log({ userId, action: 'DELETE', entity: 'purchase', entityId: id, summary: `Xarid ${base.number} bekor qilindi` });
    return this.get(id);
  }

  // ═══════════ To'lovlar ═══════════

  async addPayment(id: string, input: PaymentInput, userId: string): Promise<PurchaseView> {
    const base = await this.prisma.purchase.findUnique({ where: { id }, include: { payments: true } });
    if (!base || base.deletedAt) throw new NotFoundException('Xarid topilmadi');
    if (base.status === 'CANCELLED') throw new BadRequestException('Bekor qilingan xaridga to\'lov yozib bo\'lmaydi');
    const body = input ?? {};
    const { date } = parseDate(body.date ?? new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10));
    const amount = money(body.amountTiyin, "To'lov summasi", false);
    const method = METHODS.includes(String(body.method ?? 'BANK')) ? String(body.method ?? 'BANK') : null;
    if (!method) throw new BadRequestException("To'lov usuli noto'g'ri");
    const note = text(body.note, 'Izoh', 300);
    // Ikki kishi bir vaqtda to'lov yozsa ham jami qarzdan oshmaydi (Serializable + qayta urinish)
    await withRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const cur = await tx.purchase.findUnique({ where: { id }, include: { payments: true } });
        if (!cur || cur.deletedAt || cur.status === 'CANCELLED') throw new BadRequestException("Bekor qilingan xaridga to'lov yozib bo'lmaydi");
        const paid = cur.payments.filter((p) => !p.deletedAt).reduce((a, p) => a + p.amountTiyin, 0n);
        if (paid + amount > cur.totalTiyin) throw new BadRequestException(`To'lov qarzdan oshib ketadi: qolgan qarz ${cur.totalTiyin - paid} tiyin`);
        await tx.purchasePayment.create({ data: { purchaseId: id, date, amountTiyin: amount, method, note, createdById: userId } });
      }, SERIALIZABLE),
    );
    await this.audit.log({ userId, action: 'CREATE', entity: 'purchase', entityId: id, summary: `${base.number}: to'lov ${amount} tiyin` });
    return this.get(id);
  }

  async removePayment(id: string, paymentId: string, userId: string): Promise<PurchaseView> {
    const pay = await this.prisma.purchasePayment.findUnique({ where: { id: paymentId } });
    if (!pay || pay.purchaseId !== id || pay.deletedAt) throw new NotFoundException("To'lov topilmadi");
    await this.prisma.purchasePayment.update({ where: { id: paymentId }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entity: 'purchase', entityId: id, summary: `To'lov bekor qilindi: ${pay.amountTiyin} tiyin` });
    return this.get(id);
  }

  // ═══════════ Dashbord (xaridchi ish stoli va admin uchun) ═══════════

  async overview() {
    const now = new Date(Date.now() + 5 * 3600_000);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const rows = (await this.prisma.purchase.findMany({ where: { deletedAt: null, status: { not: 'CANCELLED' } }, include: PurchasesService.INCLUDE, take: 2000 })) as PurchaseRow[];
    const views = await this.view(rows);
    const inMonth = (p: PurchaseView, from: Date, to: Date) => new Date(p.date).getTime() >= from.getTime() && new Date(p.date).getTime() < to.getTime();
    const cur = views.filter((p) => inMonth(p, monthStart, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))));
    const prev = views.filter((p) => inMonth(p, prevStart, monthStart));
    const sum = (list: PurchaseView[], f: (p: PurchaseView) => string) => list.reduce((a, p) => a + BigInt(f(p)), 0n);
    const bySupplier = new Map<string, { name: string; total: bigint; count: number }>();
    for (const p of views) {
      const k = p.supplierId ?? p.supplierName;
      const e = bySupplier.get(k) ?? { name: p.supplierName, total: 0n, count: 0 };
      e.total += BigInt(p.totalTiyin);
      e.count += 1;
      bySupplier.set(k, e);
    }
    const [requests, pendingReceipts] = await Promise.all([
      this.prisma.purchaseRequest.count({ where: { status: { in: ['NEW', 'IN_PROGRESS'] } } }),
      this.prisma.goodsReceipt.count({ where: { status: 'PENDING' } }),
    ]);
    const open = views.filter((p) => p.status === 'OPEN');
    // Oxirgi 6 oy: har oy xarid summasi (birja / oddiy)
    const trend = Array.from({ length: 6 }, (_, i) => {
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - i), 1));
      const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (4 - i), 1));
      const list = views.filter((p) => inMonth(p, from, to));
      return {
        month: from.toISOString().slice(0, 7),
        totalTiyin: String(sum(list, (p) => p.totalTiyin)),
        exchangeTiyin: String(sum(list.filter((p) => p.kind === 'EXCHANGE'), (p) => p.totalTiyin)),
        directTiyin: String(sum(list.filter((p) => p.kind === 'DIRECT'), (p) => p.totalTiyin)),
        count: list.length,
      };
    });
    const reqRows = await this.prisma.purchaseRequest.findMany({ select: { status: true } });
    const requestStatus = { NEW: 0, IN_PROGRESS: 0, DONE: 0, REJECTED: 0 } as Record<string, number>;
    for (const r of reqRows) requestStatus[r.status] = (requestStatus[r.status] ?? 0) + 1;
    return {
      trend,
      requestStatus,
      month: {
        totalTiyin: String(sum(cur, (p) => p.totalTiyin)),
        previousTiyin: String(sum(prev, (p) => p.totalTiyin)),
        exchangeTiyin: String(sum(cur.filter((p) => p.kind === 'EXCHANGE'), (p) => p.totalTiyin)),
        directTiyin: String(sum(cur.filter((p) => p.kind === 'DIRECT'), (p) => p.totalTiyin)),
        feeTiyin: String(sum(cur, (p) => p.feeTiyin)),
        count: cur.length,
      },
      debtTiyin: String(sum(views, (p) => p.debtTiyin)),
      open: { count: open.length, totalTiyin: String(sum(open, (p) => p.totalTiyin)) },
      lateDelivery: open.filter((p) => p.deliveryLate).length,
      latePayment: views.filter((p) => p.paymentLate).length,
      pendingReceipts,
      requests,
      topSuppliers: [...bySupplier.values()].sort((a, b) => (b.total > a.total ? 1 : -1)).slice(0, 5).map((s) => ({ name: s.name, totalTiyin: String(s.total), count: s.count })),
      attention: views
        .filter((p) => p.deliveryLate || p.paymentLate || p.pendingReceipts > 0)
        .sort((a, b) => (a.deliveryDue ?? a.paymentDue ?? '9').localeCompare(b.deliveryDue ?? b.paymentDue ?? '9'))
        .slice(0, 8)
        .map((p) => ({ id: p.id, number: p.number, supplierName: p.supplierName, reason: p.deliveryLate ? `Yetkazish muddati o'tgan (${p.deliveryDue})` : p.paymentLate ? `To'lov muddati o'tgan (${p.paymentDue})` : 'Omborchi qabul qilishi kutilmoqda', totalTiyin: p.totalTiyin })),
    };
  }
}