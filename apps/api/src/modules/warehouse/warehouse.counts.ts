import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CountInput, CountSaveInput, CountView, CountListItem, CountLineView, CountAssetView } from './warehouse.types';
import { parseDate, text, WarehouseService } from './warehouse.service';

// ═══════════════════════════════════════════════════════════
// Inventarizatsiya (sanoq):
//  1. Boshlanadi — barcha faol TMZ va omborda turgan asosiy vositalar ro'yxati tayyorlanadi.
//  2. Sanaladi — haqiqatdagi miqdor yoziladi (bir necha kunda, saqlab-saqlab); vosita «bor / yo'q».
//     Hisobdagi qoldiq har safar jonli hisoblanadi (sanoq paytidagi kirim-chiqim ham hisobga olinadi).
//  3. Yakunlanadi — farqlar hujjatga aylanadi:
//       kamomad (TMZ va topilmagan vositalar) → «Hisobdan chiqarish»
//       ortiqcha (TMZ) → kirim, o'rtacha narxda, XARAJATSIZ (pul sarflanmagan)
//     Hisobdagi qoldiq va narx sanoq qatorida saqlanadi — dalolatnoma keyin ham o'zgarmaydi.
// ═══════════════════════════════════════════════════════════

const EPS = 1e-9;

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

@Injectable()
export class WarehouseCounts {
  constructor(
    private readonly prisma: PrismaService,
    private readonly warehouse: WarehouseService,
  ) {}

  private async nextNumber(date: Date): Promise<string> {
    const prefix = `SN-${date.getUTCFullYear()}-`;
    const last = await this.prisma.stockCount.findFirst({ where: { number: { startsWith: prefix } }, orderBy: { number: 'desc' }, select: { number: true } });
    const n = (last ? Number(last.number.slice(prefix.length)) || 0 : 0) + 1;
    return `${prefix}${String(n).padStart(4, '0')}`;
  }

  async list(): Promise<CountListItem[]> {
    const rows = await this.prisma.stockCount.findMany({ include: { lines: true, assets: true }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 200 });
    return rows.map((c) => {
      const done = c.status === 'DONE';
      const short = done ? c.lines.filter((l) => (l.actualQty ?? 0) < (l.bookQty ?? 0) - EPS).length + c.assets.filter((a) => a.found === false).length : null;
      const extra = done ? c.lines.filter((l) => (l.actualQty ?? 0) > (l.bookQty ?? 0) + EPS).length : null;
      return {
        id: c.id,
        number: c.number,
        date: c.date.toISOString().slice(0, 10),
        status: c.status,
        lines: c.lines.length + c.assets.length,
        counted: c.lines.filter((l) => l.actualQty !== null).length + c.assets.filter((a) => a.found !== null).length,
        shortages: short,
        surpluses: extra,
        createdAt: c.createdAt.toISOString(),
        finishedAt: c.finishedAt ? c.finishedAt.toISOString() : null,
      };
    });
  }

  /** Yangi sanoq: bir vaqtda faqat bitta tugallanmagan bo'lishi mumkin */
  async create(input: CountInput, userId: string): Promise<CountView> {
    const open = await this.prisma.stockCount.findFirst({ where: { status: 'DRAFT' }, select: { number: true } });
    if (open) throw new ConflictException(`Tugallanmagan inventarizatsiya bor: ${open.number} — avval uni yakunlang yoki o'chiring`);
    const { date } = parseDate(input?.date);
    const [items, assets] = await Promise.all([this.warehouse.items({ kind: 'TMZ' }), this.prisma.asset.findMany({ where: { status: 'IN_STOCK' }, select: { id: true } })]);
    if (items.length === 0 && assets.length === 0) throw new BadRequestException("Sanaydigan narsa yo'q: ma'lumotnomada faol buyum ham, omborda asosiy vosita ham yo'q");
    let created: { id: string } | null = null;
    for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
      try {
        created = await this.prisma.stockCount.create({
          data: {
            number: await this.nextNumber(date),
            date,
            chairman: text(input?.chairman, 'Komissiya raisi', 160),
            commission: text(input?.commission, "Komissiya a'zolari", 500),
            note: text(input?.note, 'Izoh', 1000),
            createdById: userId,
            lines: { create: items.map((i) => ({ itemId: i.id })) },
            assets: { create: assets.map((a) => ({ assetId: a.id })) },
          },
          select: { id: true },
        });
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') throw error;
      }
    }
    if (!created) throw new ConflictException('Raqam berib bo‘lmadi — qayta urinib ko‘ring');
    return this.get(created.id);
  }

  async get(id: string): Promise<CountView> {
    const c = await this.prisma.stockCount.findUnique({ where: { id }, include: { lines: true, assets: true } });
    if (!c) throw new NotFoundException('Inventarizatsiya topilmadi');
    const done = c.status === 'DONE';
    const items = await this.warehouse.items({ kind: 'TMZ', all: true });
    const byId = new Map(items.map((i) => [i.id, i]));

    // Sanoq davomida qo'shilgan yangi buyumlar ham ro'yxatga kiradi (hali sanalmagan)
    const lineRows = [...c.lines];
    if (!done) {
      const have = new Set(lineRows.map((l) => l.itemId));
      for (const i of items) if (i.isActive && !have.has(i.id)) lineRows.push({ id: `new:${i.id}`, countId: c.id, itemId: i.id, actualQty: null, bookQty: null, priceTiyin: null });
    }

    const lines: CountLineView[] = lineRows
      .map((l) => {
        const item = byId.get(l.itemId);
        const book = done ? (l.bookQty ?? 0) : (item?.inStock ?? 0);
        const price = done ? (l.priceTiyin ?? 0n) : BigInt(item?.avgPriceTiyin ?? '0');
        const diff = l.actualQty === null ? null : round3(l.actualQty - book);
        return {
          itemId: l.itemId,
          code: item?.code ?? '',
          name: item?.name ?? "O'chirilgan buyum",
          unit: item?.unit ?? '',
          group: item?.group ?? null,
          bookQty: round3(book),
          actualQty: l.actualQty,
          diffQty: diff,
          priceTiyin: price.toString(),
          diffAmountTiyin: diff === null ? null : String(Math.round(diff * Number(price))),
        };
      })
      .sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.name.localeCompare(b.name));

    const assetRows = await this.prisma.asset.findMany({ where: { id: { in: c.assets.map((a) => a.assetId) } }, include: { item: { select: { name: true, group: true } } } });
    const assetById = new Map(assetRows.map((a) => [a.id, a]));
    const assets: CountAssetView[] = c.assets
      .map((x) => {
        const a = assetById.get(x.assetId);
        return {
          assetId: x.assetId,
          inventoryNo: a?.inventoryNo ?? '—',
          name: a?.name ?? "O'chirilgan",
          serialNo: a?.serialNo ?? null,
          priceTiyin: (a?.priceTiyin ?? 0n).toString(),
          /** Sanoq paytida omborda emas (berilgan) — tekshirish shart emas */
          moved: !done && a?.status !== 'IN_STOCK',
          found: x.found,
        };
      })
      .sort((a, b) => a.inventoryNo.localeCompare(b.inventoryNo));

    const sum = (pred: (l: CountLineView) => boolean) => lines.filter(pred).reduce((s, l) => s + Number(l.diffAmountTiyin ?? 0), 0);
    const missingAssets = assets.filter((a) => a.found === false && !a.moved);
    return {
      id: c.id,
      number: c.number,
      date: c.date.toISOString().slice(0, 10),
      status: c.status,
      chairman: c.chairman,
      commission: c.commission,
      note: c.note,
      lines,
      assets,
      totals: {
        lines: lines.length + assets.filter((a) => !a.moved).length,
        counted: lines.filter((l) => l.actualQty !== null).length + assets.filter((a) => !a.moved && a.found !== null).length,
        shortageTiyin: String(-sum((l) => (l.diffQty ?? 0) < -EPS) + missingAssets.reduce((s, a) => s + Number(a.priceTiyin), 0)),
        surplusTiyin: String(sum((l) => (l.diffQty ?? 0) > EPS)),
        shortageLines: lines.filter((l) => (l.diffQty ?? 0) < -EPS).length + missingAssets.length,
        surplusLines: lines.filter((l) => (l.diffQty ?? 0) > EPS).length,
      },
      writeOffDocId: c.writeOffDocId,
      receiptDocId: c.receiptDocId,
      createdAt: c.createdAt.toISOString(),
      finishedAt: c.finishedAt ? c.finishedAt.toISOString() : null,
    };
  }

  /** Sanalganlarni saqlash (qisman ham bo'ladi) */
  async save(id: string, input: CountSaveInput): Promise<CountView> {
    const c = await this.prisma.stockCount.findUnique({ where: { id }, select: { status: true } });
    if (!c) throw new NotFoundException('Inventarizatsiya topilmadi');
    if (c.status !== 'DRAFT') throw new BadRequestException('Yakunlangan inventarizatsiyani o‘zgartirib bo‘lmaydi');
    const body = input ?? {};
    const lines = Array.isArray(body.lines) ? body.lines : [];
    const assets = Array.isArray(body.assets) ? body.assets : [];
    if (lines.length > 5000 || assets.length > 5000) throw new BadRequestException("Juda ko'p qator");
    for (const l of lines) {
      if (typeof l?.itemId !== 'string') throw new BadRequestException('Buyum ko‘rsatilmagan');
      if (l.actualQty !== null && l.actualQty !== undefined) {
        const q = Number(l.actualQty);
        if (!Number.isFinite(q) || q < 0 || q > 10_000_000) throw new BadRequestException('Miqdor noto‘g‘ri (manfiy bo‘lmasin)');
      }
    }
    const head: Record<string, unknown> = {};
    if (body.date !== undefined) head.date = parseDate(body.date).date;
    if (body.chairman !== undefined) head.chairman = text(body.chairman, 'Komissiya raisi', 160);
    if (body.commission !== undefined) head.commission = text(body.commission, "Komissiya a'zolari", 500);
    if (body.note !== undefined) head.note = text(body.note, 'Izoh', 1000);

    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(head).length) await tx.stockCount.update({ where: { id }, data: head });
      for (const l of lines) {
        const actualQty = l.actualQty === null || l.actualQty === undefined ? null : round3(Number(l.actualQty));
        await tx.stockCountLine.upsert({
          where: { countId_itemId: { countId: id, itemId: l.itemId } },
          update: { actualQty },
          create: { countId: id, itemId: l.itemId, actualQty },
        });
      }
      for (const a of assets) {
        if (typeof a?.assetId !== 'string') continue;
        await tx.stockCountAsset.updateMany({ where: { countId: id, assetId: a.assetId }, data: { found: a.found === null || a.found === undefined ? null : Boolean(a.found) } });
      }
    });
    return this.get(id);
  }

  /**
   * Yakunlash: hamma qator sanalgan bo'lishi shart. Farqlar hujjatga aylanadi.
   * Ikki marta bosilsa ham bir marta bajariladi (holat DRAFT → DONE shartli o'zgaradi).
   */
  async finish(id: string, userId: string): Promise<CountView> {
    const view = await this.get(id);
    if (view.status !== 'DRAFT') throw new BadRequestException('Inventarizatsiya allaqachon yakunlangan');
    const notCounted = view.lines.filter((l) => l.actualQty === null).length + view.assets.filter((a) => !a.moved && a.found === null).length;
    if (notCounted > 0) throw new BadRequestException(`${notCounted} ta qator sanalmagan. Sanang yoki «Qolganlari hisobdagidek» tugmasini bosing`);

    const locked = await this.prisma.stockCount.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'DONE', finishedAt: new Date(), finishedById: userId } });
    if (locked.count === 0) throw new ConflictException('Inventarizatsiya allaqachon yakunlanmoqda');

    const shortages = view.lines.filter((l) => (l.diffQty ?? 0) < -EPS);
    const surpluses = view.lines.filter((l) => (l.diffQty ?? 0) > EPS);
    const missing = view.assets.filter((a) => !a.moved && a.found === false);
    const created: string[] = [];
    try {
      // Hisobdagi qoldiq va narx — o'sha paytdagisi saqlanadi
      for (const l of view.lines) {
        await this.prisma.stockCountLine.upsert({
          where: { countId_itemId: { countId: id, itemId: l.itemId } },
          update: { bookQty: l.bookQty, priceTiyin: BigInt(l.priceTiyin) },
          create: { countId: id, itemId: l.itemId, actualQty: l.actualQty, bookQty: l.bookQty, priceTiyin: BigInt(l.priceTiyin) },
        });
      }
      // Sanoq paytida omborda bo'lmagan (berilgan) vositalar ro'yxatdan chiqariladi
      const moved = view.assets.filter((a) => a.moved).map((a) => a.assetId);
      if (moved.length) await this.prisma.stockCountAsset.deleteMany({ where: { countId: id, assetId: { in: moved } } });

      const commission = [view.commission ? `Komissiya a'zolari: ${view.commission}` : null, `Inventarizatsiya ${view.number}`].filter(Boolean).join('. ');
      let writeOffDocId: string | null = null;
      let receiptDocId: string | null = null;
      if (shortages.length || missing.length) {
        const doc = await this.warehouse.createDoc(
          {
            kind: 'WRITE_OFF',
            date: view.date,
            reason: `Inventarizatsiya kamomadi (${view.number})`,
            responsible: view.chairman,
            note: commission,
            lines: shortages.map((l) => ({ itemId: l.itemId, qty: round3(-(l.diffQty ?? 0)) })),
            assetIds: missing.map((a) => a.assetId),
          },
          userId,
        );
        writeOffDocId = doc.id;
        created.push(doc.id);
      }
      if (surpluses.length) {
        const doc = await this.warehouse.createDoc(
          {
            kind: 'RECEIPT',
            date: view.date,
            counterparty: 'Inventarizatsiya ortiqchasi',
            documentNo: view.number,
            responsible: view.chairman,
            note: `${commission}. Xarajatga yozilmaydi`,
            lines: surpluses.map((l) => ({ itemId: l.itemId, qty: round3(l.diffQty ?? 0), priceTiyin: l.priceTiyin })),
          },
          userId,
          { noExpense: true },
        );
        receiptDocId = doc.id;
        created.push(doc.id);
      }
      await this.prisma.stockCount.update({ where: { id }, data: { writeOffDocId, receiptDocId } });
    } catch (error) {
      // Yarim bajarilgan holat qolmasin: yaratilgan hujjatlar bekor, holat — qaytadan DRAFT
      for (const docId of created.reverse()) await this.warehouse.cancelDoc(docId, userId).catch(() => undefined);
      await this.prisma.stockCount.update({ where: { id }, data: { status: 'DRAFT', finishedAt: null, finishedById: null } });
      throw error;
    }
    return this.get(id);
  }

  /** Faqat tugallanmagani o'chiriladi */
  async remove(id: string): Promise<{ id: string }> {
    const c = await this.prisma.stockCount.findUnique({ where: { id }, select: { status: true } });
    if (!c) throw new NotFoundException('Inventarizatsiya topilmadi');
    if (c.status !== 'DRAFT') throw new BadRequestException('Yakunlangan inventarizatsiya o‘chirilmaydi — u hujjatlarga asos');
    await this.prisma.stockCount.delete({ where: { id } });
    return { id };
  }
}