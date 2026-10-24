import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { SERIALIZABLE, withRetry } from '../../common/db/retry';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { WarehouseService, text } from '../warehouse/warehouse.service';
import { lockInTx } from '../../common/db/tx-lock';

// ═══════════════════════════════════════════════════════════
// Omborga qabul: xaridchi «tovar keldi» deb yozadi → omborchi ko'rib qabul qiladi yoki qaytaradi.
//  • Qabul qilinganda ombor kirimi (KR-…) yaratiladi: qoldiqqa va Xarajatlarga shu paytda tushadi.
//  • Xaridning hamma qatori to'liq qabul qilinsa — xarid «Yetkazildi», ariza «Bajarildi».
//  • Qaytarilsa — sabab yoziladi, xaridchi yangi qabul yozadi.
// ═══════════════════════════════════════════════════════════

const EPS = 1e-9;
type Tx = Prisma.TransactionClient;

export interface ReceiptInput {
  purchaseId?: string;
  note?: string | null;
  /** Bo'sh bo'lsa — xaridning hali kelmagan qoldig'i butunlay */
  lines?: { itemId?: string; qty?: number | string }[];
}

export interface ReceiptView {
  id: string;
  number: string;
  purchaseId: string;
  purchaseNumber: string;
  supplierName: string;
  documentNo: string | null;
  date: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  note: string | null;
  rejectReason: string | null;
  totalTiyin: string;
  createdByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  stockDocId: string | null;
  lines: { itemId: string; itemName: string; unit: string; qty: number; priceTiyin: string; amountTiyin: string }[];
}

function todayIso(): string {
  return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly warehouse: WarehouseService,
  ) {}

  private async nextNumber(tx: Tx, date: Date): Promise<string> {
    const prefix = `QB-${date.getUTCFullYear()}-`;
    await lockInTx(tx, `number:${prefix}`); // bir vaqtdagi so'rovlar navbat bilan raqam oladi
    // Eng katta raqam son bo'yicha (matn tartibi 10 000-hujjatdan keyin buziladi)
    const rows = await tx.goodsReceipt.findMany({ where: { number: { startsWith: prefix } }, select: { number: true } });
    const n = rows.reduce((m, r) => Math.max(m, Number(r.number.slice(prefix.length)) || 0), 0) + 1;
    return `${prefix}${String(n).padStart(4, '0')}`;
  }

  /** Xaridning hali kelmagan (qabul qilingan va kutilayotganlarni chiqarib) qoldig'i */
  private async remaining(purchaseId: string, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    const purchase = await db.purchase.findUnique({ where: { id: purchaseId }, include: { lines: true, receipts: { include: { lines: true } } } });
    if (!purchase || purchase.deletedAt) throw new NotFoundException('Xarid topilmadi');
    const taken = new Map<string, number>();
    for (const r of purchase.receipts.filter((x) => x.status !== 'REJECTED')) for (const l of r.lines) taken.set(l.itemId, (taken.get(l.itemId) ?? 0) + l.qty);
    const rest = new Map<string, { qty: number; priceTiyin: bigint }>();
    for (const l of purchase.lines) {
      const e = rest.get(l.itemId) ?? { qty: 0, priceTiyin: l.priceTiyin };
      e.qty += l.qty;
      rest.set(l.itemId, e);
    }
    for (const [id, e] of rest) e.qty = r3(e.qty - (taken.get(id) ?? 0));
    return { purchase, rest };
  }

  private async view(rows: Prisma.GoodsReceiptGetPayload<{ include: { lines: true; purchase: true } }>[]): Promise<ReceiptView[]> {
    const itemIds = [...new Set(rows.flatMap((r) => r.lines.map((l) => l.itemId)))];
    const userIds = [...new Set(rows.flatMap((r) => [r.createdById, r.decidedById]).filter((x): x is string => Boolean(x)))];
    const [items, users] = await Promise.all([
      itemIds.length ? this.prisma.stockItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true, unit: true } }) : [],
      userIds.length ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, loginCode: true } }) : [],
    ]);
    const itemBy = new Map(items.map((i) => [i.id, i]));
    const userBy = new Map(users.map((u) => [u.id, u.loginCode ? `${u.fullName} (${u.loginCode})` : u.fullName]));
    return rows.map((r) => {
      const lines = r.lines.map((l) => ({
        itemId: l.itemId,
        itemName: itemBy.get(l.itemId)?.name ?? '—',
        unit: itemBy.get(l.itemId)?.unit ?? 'dona',
        qty: l.qty,
        priceTiyin: String(l.priceTiyin),
        amountTiyin: String(BigInt(Math.round(l.qty * Number(l.priceTiyin)))),
      }));
      return {
        id: r.id,
        number: r.number,
        purchaseId: r.purchaseId,
        purchaseNumber: r.purchase.number,
        supplierName: r.purchase.supplierName,
        documentNo: r.purchase.documentNo,
        date: r.date.toISOString().slice(0, 10),
        status: r.status,
        note: r.note,
        rejectReason: r.rejectReason,
        totalTiyin: String(lines.reduce((a, l) => a + BigInt(l.amountTiyin), 0n)),
        createdByName: r.createdById ? (userBy.get(r.createdById) ?? null) : null,
        decidedByName: r.decidedById ? (userBy.get(r.decidedById) ?? null) : null,
        decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
        stockDocId: r.stockDocId,
        lines,
      };
    });
  }

  /** status: pending (default) | accepted | rejected | all */
  async list(filter: { status?: string; purchaseId?: string } = {}): Promise<ReceiptView[]> {
    await this.heal().catch(() => 0);
    const s = filter.status ?? 'pending';
    const where: Prisma.GoodsReceiptWhereInput = {
      ...(s === 'pending' ? { status: 'PENDING' } : s === 'accepted' ? { status: 'ACCEPTED' } : s === 'rejected' ? { status: 'REJECTED' } : {}),
      ...(filter.purchaseId ? { purchaseId: filter.purchaseId } : {}),
    };
    const rows = await this.prisma.goodsReceipt.findMany({ where, include: { lines: true, purchase: true }, orderBy: [{ createdAt: s === 'pending' ? 'asc' : 'desc' }], take: 300 });
    return this.view(rows);
  }

  async get(id: string): Promise<ReceiptView> {
    const row = await this.prisma.goodsReceipt.findUnique({ where: { id }, include: { lines: true, purchase: true } });
    if (!row) throw new NotFoundException('Qabul topilmadi');
    return (await this.view([row]))[0]!;
  }

  async summary(): Promise<{ pending: number }> {
    return { pending: await this.prisma.goodsReceipt.count({ where: { status: 'PENDING' } }) };
  }

  /** Xaridchi: tovar keldi — omborchiga qabul uchun yuboriladi */
  async create(input: ReceiptInput, userId: string): Promise<ReceiptView> {
    const body = input ?? {};
    const purchaseId = String(body.purchaseId ?? '');
    if (!purchaseId) throw new BadRequestException('Xaridni tanlang');
    const { purchase, rest } = await this.remaining(purchaseId);
    if (purchase.status !== 'OPEN') throw new BadRequestException(purchase.status === 'DELIVERED' ? "Bu xarid bo'yicha tovar to'liq qabul qilingan" : 'Xarid bekor qilingan');
    const asked = Array.isArray(body.lines) && body.lines.length > 0 ? body.lines : [...rest].filter(([, e]) => e.qty > EPS).map(([itemId, e]) => ({ itemId, qty: e.qty }));
    if (asked.length === 0) throw new BadRequestException("Qabul qilinadigan tovar qolmagan");
    const merged = new Map<string, number>();
    for (const [i, l] of asked.entries()) {
      const itemId = String(l.itemId ?? '');
      const e = rest.get(itemId);
      if (!e) throw new BadRequestException(`${i + 1}-qator: bu tovar xaridda yo'q`);
      const qty = typeof l.qty === 'number' ? l.qty : Number(String(l.qty ?? '').replace(',', '.'));
      if (!Number.isFinite(qty) || qty <= 0) throw new BadRequestException(`${i + 1}-qator: miqdor noldan katta bo'lsin`);
      merged.set(itemId, r3((merged.get(itemId) ?? 0) + qty));
    }
    const items = await this.prisma.stockItem.findMany({ where: { id: { in: [...merged.keys()] } }, select: { id: true, name: true, unit: true, kind: true } });
    const by = new Map(items.map((i) => [i.id, i]));
    for (const [itemId, qty] of merged) {
      const e = rest.get(itemId)!;
      const it = by.get(itemId);
      if (qty > e.qty + EPS) throw new BadRequestException(`«${it?.name ?? itemId}»: xaridda yana ${e.qty} ${it?.unit ?? ''} qolgan, ${qty} yozilyapti`);
      if (it?.kind === 'ASSET' && !Number.isInteger(qty)) throw new BadRequestException(`«${it.name}»: asosiy vosita soni butun bo'lsin`);
    }
    const dateStr = todayIso();
    const date = new Date(`${dateStr}T00:00:00Z`);
    const id = await withRetry(() => this.prisma.$transaction(async (tx) => {
      // Ikki kishi bir vaqtda yuborsa ortiqcha qabul bo'lmasin: qoldiqni tranzaksiya ichida qayta hisoblaymiz
      const fresh = await this.remaining(purchaseId, tx);
      if (fresh.purchase.status !== 'OPEN') throw new BadRequestException('Xarid yopilgan yoki bekor qilingan');
      for (const [itemId, qty] of merged) {
        if (qty > (fresh.rest.get(itemId)?.qty ?? 0) + EPS) throw new BadRequestException("Bu tovar uchun qabul allaqachon yozilgan — sahifani yangilang");
      }
      const number = await this.nextNumber(tx, date);
      const row = await tx.goodsReceipt.create({
        data: {
          number,
          purchaseId,
          date,
          note: text(body.note, 'Izoh', 500),
          createdById: userId,
          lines: { create: [...merged].map(([itemId, qty]) => ({ itemId, qty, priceTiyin: rest.get(itemId)!.priceTiyin })) },
        },
      });
      return row.id;
    }, SERIALIZABLE));
    const view = await this.get(id);
    await this.audit.log({ userId, action: 'CREATE', entity: 'goods_receipt', entityId: id, summary: `Omborga qabul ${view.number} (${view.purchaseNumber}, ${view.supplierName}): ${view.lines.length} qator — omborchi qabul qilishi kutilmoqda` });
    return view;
  }

  /** Xaridchi: hali qabul qilinmagan yozuvni qaytarib olish */
  async withdraw(id: string, userId: string): Promise<ReceiptView> {
    const r = await this.prisma.goodsReceipt.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Qabul topilmadi');
    const claimed = await this.prisma.goodsReceipt.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'REJECTED', rejectReason: 'Xaridchi qaytarib oldi', decidedAt: new Date(), decidedById: userId } });
    if (claimed.count === 0) throw new BadRequestException('Bu qabul allaqachon ko\'rib chiqilgan');
    await this.audit.log({ userId, action: 'DELETE', entity: 'goods_receipt', entityId: id, summary: `Omborga qabul ${r.number} qaytarib olindi` });
    return this.get(id);
  }

  /** Hammasi kelganmi? Kelgan bo'lsa xarid «Yetkazildi», ariza «Bajarildi» bo'ladi */
  private async finish(purchaseId: string): Promise<boolean> {
    const { purchase, rest } = await this.remaining(purchaseId);
    if (purchase.status !== 'OPEN') return false;
    const fully = [...rest.values()].every((e) => e.qty <= EPS);
    const acceptedAll = await this.prisma.goodsReceipt.findMany({ where: { purchaseId, status: 'ACCEPTED' }, include: { lines: true } });
    const got = new Map<string, number>();
    for (const a of acceptedAll) for (const l of a.lines) got.set(l.itemId, (got.get(l.itemId) ?? 0) + l.qty);
    const complete = fully && purchase.lines.every((l) => (got.get(l.itemId) ?? 0) + EPS >= purchase.lines.filter((x) => x.itemId === l.itemId).reduce((a, x) => a + x.qty, 0));
    if (complete) {
      await this.prisma.purchase.update({ where: { id: purchaseId }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
      if (purchase.requestId) await this.prisma.purchaseRequest.update({ where: { id: purchase.requestId }, data: { status: 'DONE' } });
    }
    return complete;
  }

  /**
   * Qabul tasdiqlanayotganda server to'xtab qolgan bo'lsa: «qabul qilindi» deb belgilangan, lekin omborga kirim
   * bog'lanmagan yozuvlarni tuzatadi — kirim yozilgan bo'lsa bog'laydi, yozilmagan bo'lsa qayta kutishga qaytaradi.
   */
  async heal(): Promise<number> {
    const stuck = await this.prisma.goodsReceipt.findMany({ where: { status: 'ACCEPTED', stockDocId: null, decidedAt: { lt: new Date(Date.now() - 2 * 60_000) } }, select: { id: true, number: true, purchaseId: true }, take: 20 });
    let fixed = 0;
    for (const r of stuck) {
      const docs = await this.prisma.stockDoc.findMany({ where: { kind: 'RECEIPT', deletedAt: null, note: { contains: `qabul ${r.number}` } }, select: { id: true, note: true }, take: 5 });
      const re = new RegExp(`qabul ${r.number}(?!\\d)`);
      const doc = docs.find((d) => re.test(d.note ?? ''));
      if (doc) {
        await this.prisma.goodsReceipt.updateMany({ where: { id: r.id, stockDocId: null }, data: { stockDocId: doc.id } });
        await this.finish(r.purchaseId);
      } else {
        await this.prisma.goodsReceipt.updateMany({ where: { id: r.id, status: 'ACCEPTED', stockDocId: null }, data: { status: 'PENDING', decidedById: null, decidedAt: null } });
      }
      fixed++;
    }
    return fixed;
  }

  /** Omborchi: tovarni ko'rdi, qabul qildi — qoldiqqa tushadi */
  async accept(id: string, userId: string): Promise<ReceiptView> {
    const r = await this.prisma.goodsReceipt.findUnique({ where: { id }, include: { lines: true, purchase: true } });
    if (!r) throw new NotFoundException('Qabul topilmadi');
    if (r.purchase.status === 'CANCELLED' || r.purchase.deletedAt) throw new BadRequestException('Xarid bekor qilingan');
    // Ikki marta bosilsa — ikki marta kirim bo'lmasin
    const claimed = await this.prisma.goodsReceipt.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'ACCEPTED', decidedById: userId, decidedAt: new Date() } });
    if (claimed.count === 0) throw new BadRequestException("Bu qabul allaqachon ko'rib chiqilgan");
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
    try {
      const doc = await this.warehouse.createDoc(
        {
          kind: 'RECEIPT',
          date: todayIso(),
          counterparty: r.purchase.supplierName,
          documentNo: r.purchase.documentNo ?? r.purchase.lotNo ?? r.purchase.number,
          paymentMethod: 'BANK',
          issuedBy: user?.fullName ?? null,
          note: `Xarid ${r.purchase.number}, qabul ${r.number}${r.note ? `: ${r.note}` : ''}`,
          lines: r.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, priceTiyin: String(l.priceTiyin) })),
        },
        userId,
      );
      await this.prisma.goodsReceipt.update({ where: { id }, data: { stockDocId: doc.id } });
    } catch (error) {
      await this.prisma.goodsReceipt.updateMany({ where: { id }, data: { status: 'PENDING', decidedById: null, decidedAt: null } });
      throw error;
    }
    const complete = await this.finish(r.purchaseId);
    await this.audit.log({ userId, action: 'UPDATE', entity: 'goods_receipt', entityId: id, summary: `Qabul ${r.number} (${r.purchase.number}) omborga qabul qilindi${complete ? " — xarid to'liq yetkazildi" : ''}` });
    return this.get(id);
  }

  /** Omborchi: tovar kelmagan yoki yaroqsiz — sabab bilan qaytarish */
  async reject(id: string, reason: unknown, userId: string): Promise<ReceiptView> {
    const why = text(reason, 'Sabab', 300);
    if (!why) throw new BadRequestException('Qaytarish sababini yozing (masalan: soni kam, shikastlangan)');
    const r = await this.prisma.goodsReceipt.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Qabul topilmadi');
    const claimed = await this.prisma.goodsReceipt.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'REJECTED', rejectReason: why, decidedById: userId, decidedAt: new Date() } });
    if (claimed.count === 0) throw new BadRequestException("Bu qabul allaqachon ko'rib chiqilgan");
    await this.audit.log({ userId, action: 'UPDATE', entity: 'goods_receipt', entityId: id, summary: `Qabul ${r.number} qaytarildi: ${why}` });
    return this.get(id);
  }
}