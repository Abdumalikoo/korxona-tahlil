import { ConflictException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { WarehouseCounts } from './warehouse.counts';
import { WarehousePostal } from './warehouse.postal';
import { WarehouseService } from './warehouse.service';
import type { DocInput, LineInput } from './warehouse.types';

// ═══════════════════════════════════════════════════════════
// Ombor › Demo: oxirgi 3 oyning namunaviy ishi — haqiqiy hujjatlar sifatida.
//   • 35 ta buyum (TMZ va asosiy vositalar), 5 ta yetkazib beruvchi;
//   • kirim (Xarajatlarga yoziladi), chiqim odam va bo'limlarga, ko'chirish, qaytarish, hisobdan chiqarish;
//   • kam qolgan buyumlar, inventarizatsiya (ombor bo'sh bo'lsa), pochta to'lovlari.
// Hammasi oddiy servis orqali yaratiladi — qoldiq, inventar raqami, dalolatnoma, xarajat to'g'ri chiqadi.
// Belgi: buyum va hujjat izohi «[DEMO] …». «Demoni o'chirish» — hammasi butunlay o'chadi.
// ═══════════════════════════════════════════════════════════

export const WH_DEMO_MARK = '[DEMO]';
const NOTE = `${WH_DEMO_MARK} Namuna ma'lumot — Ombor › Umumiy › «Demoni o'chirish» bilan o'chadi`;

type Kind = 'TMZ' | 'ASSET';
interface DemoItem {
  key: string;
  name: string;
  unit: string;
  kind: Kind;
  group: string;
  category: string;
  /** Narxi, so'm */
  price: number;
  minQty?: number;
}

const ITEMS: DemoItem[] = [
  // Kanselyariya
  { key: 'a4', name: "Qog'oz A4 (500 varaq)", unit: 'pachka', kind: 'TMZ', group: 'Kanselyariya', category: 'WH_STATIONERY', price: 48_000, minQty: 20 },
  { key: 'pen', name: "Ruchka (ko'k)", unit: 'dona', kind: 'TMZ', group: 'Kanselyariya', category: 'WH_STATIONERY', price: 2_500, minQty: 50 },
  { key: 'pencil', name: 'Qalam', unit: 'dona', kind: 'TMZ', group: 'Kanselyariya', category: 'WH_STATIONERY', price: 1_500 },
  { key: 'folder', name: 'Papka-skorosshivatel', unit: 'dona', kind: 'TMZ', group: 'Kanselyariya', category: 'WH_STATIONERY', price: 3_500, minQty: 30 },
  { key: 'files', name: 'Fayl (100 dona)', unit: 'pachka', kind: 'TMZ', group: 'Kanselyariya', category: 'WH_STATIONERY', price: 35_000 },
  { key: 'stapler', name: 'Stepler', unit: 'dona', kind: 'TMZ', group: 'Kanselyariya', category: 'WH_STATIONERY', price: 28_000 },
  { key: 'clips', name: 'Skrepka', unit: 'quti', kind: 'TMZ', group: 'Kanselyariya', category: 'WH_STATIONERY', price: 6_000 },
  { key: 'marker', name: 'Marker', unit: 'dona', kind: 'TMZ', group: 'Kanselyariya', category: 'WH_STATIONERY', price: 9_000 },
  { key: 'notebook', name: 'Daftar (96 varaq)', unit: 'dona', kind: 'TMZ', group: 'Kanselyariya', category: 'WH_STATIONERY', price: 12_000 },
  { key: 'glue', name: 'Yelim qalam', unit: 'dona', kind: 'TMZ', group: 'Kanselyariya', category: 'WH_STATIONERY', price: 7_000 },
  // Kompyuter sarf materiallari
  { key: 'cartridge', name: 'Kartrij HP 85A', unit: 'dona', kind: 'TMZ', group: 'Kompyuter sarf materiallari', category: 'WH_COMPUTER', price: 320_000, minQty: 8 },
  { key: 'mouse', name: 'Sichqoncha (USB)', unit: 'dona', kind: 'TMZ', group: 'Kompyuter sarf materiallari', category: 'WH_COMPUTER', price: 85_000, minQty: 3 },
  { key: 'keyboard', name: 'Klaviatura (USB)', unit: 'dona', kind: 'TMZ', group: 'Kompyuter sarf materiallari', category: 'WH_COMPUTER', price: 140_000 },
  { key: 'flash', name: 'USB fleshka 32 GB', unit: 'dona', kind: 'TMZ', group: 'Kompyuter sarf materiallari', category: 'WH_COMPUTER', price: 75_000 },
  // Xo'jalik
  { key: 'soap', name: 'Suyuq sovun', unit: 'litr', kind: 'TMZ', group: "Xo'jalik", category: 'WH_HOUSEHOLD', price: 18_000, minQty: 10 },
  { key: 'tp', name: "Hojatxona qog'ozi", unit: 'rulon', kind: 'TMZ', group: "Xo'jalik", category: 'WH_HOUSEHOLD', price: 4_500, minQty: 100 },
  { key: 'napkin', name: 'Salfetka', unit: 'pachka', kind: 'TMZ', group: "Xo'jalik", category: 'WH_HOUSEHOLD', price: 8_000 },
  { key: 'bags', name: 'Axlat paketi (120 l)', unit: 'rulon', kind: 'TMZ', group: "Xo'jalik", category: 'WH_HOUSEHOLD', price: 15_000 },
  { key: 'cleaner', name: 'Pol yuvish vositasi', unit: 'litr', kind: 'TMZ', group: "Xo'jalik", category: 'WH_HOUSEHOLD', price: 22_000 },
  { key: 'gloves', name: "Qo'lqop (rezina)", unit: 'juft', kind: 'TMZ', group: "Xo'jalik", category: 'WH_UNIFORM', price: 6_000 },
  // Oshxona
  { key: 'water', name: 'Ichimlik suvi (19 l)', unit: 'dona', kind: 'TMZ', group: 'Oshxona', category: 'WH_OTHER', price: 18_000, minQty: 50 },
  { key: 'tea', name: "Choy (ko'k, 100 paket)", unit: 'quti', kind: 'TMZ', group: 'Oshxona', category: 'WH_OTHER', price: 35_000 },
  { key: 'sugar', name: 'Qand', unit: 'kg', kind: 'TMZ', group: 'Oshxona', category: 'WH_OTHER', price: 14_000 },
  // Asosiy vositalar
  { key: 'laptop', name: 'Noutbuk Lenovo ThinkPad E14', unit: 'dona', kind: 'ASSET', group: 'Kompyuter texnikasi', category: 'WH_COMPUTER', price: 12_500_000 },
  { key: 'aio', name: 'Monoblok HP 24', unit: 'dona', kind: 'ASSET', group: 'Kompyuter texnikasi', category: 'WH_COMPUTER', price: 9_800_000 },
  { key: 'monitor', name: 'Monitor 24" Samsung', unit: 'dona', kind: 'ASSET', group: 'Kompyuter texnikasi', category: 'WH_COMPUTER', price: 2_300_000 },
  { key: 'printer', name: 'Printer HP LaserJet M211', unit: 'dona', kind: 'ASSET', group: 'Kompyuter texnikasi', category: 'WH_COMPUTER', price: 3_600_000 },
  { key: 'projector', name: 'Proyektor Epson EB-X51', unit: 'dona', kind: 'ASSET', group: 'Kompyuter texnikasi', category: 'WH_COMPUTER', price: 7_400_000 },
  { key: 'chair', name: 'Ofis stuli', unit: 'dona', kind: 'ASSET', group: 'Mebel', category: 'WH_FURNITURE', price: 1_200_000 },
  { key: 'desk', name: 'Ofis stoli (140×70)', unit: 'dona', kind: 'ASSET', group: 'Mebel', category: 'WH_FURNITURE', price: 2_100_000 },
  { key: 'cabinet', name: 'Hujjatlar shkafi', unit: 'dona', kind: 'ASSET', group: 'Mebel', category: 'WH_FURNITURE', price: 2_700_000 },
  { key: 'safe', name: 'Seyf (o\'tga chidamli)', unit: 'dona', kind: 'ASSET', group: 'Mebel', category: 'WH_FURNITURE', price: 3_900_000 },
  { key: 'ac', name: 'Konditsioner Artel 12', unit: 'dona', kind: 'ASSET', group: 'Jihozlar', category: 'WH_FURNITURE', price: 5_800_000 },
  { key: 'cooler', name: 'Suv kuleri', unit: 'dona', kind: 'ASSET', group: 'Jihozlar', category: 'WH_FURNITURE', price: 1_650_000 },
  { key: 'shredder', name: "Qog'oz maydalagich", unit: 'dona', kind: 'ASSET', group: 'Jihozlar', category: 'WH_FURNITURE', price: 1_900_000 },
];

const SUPPLIERS = {
  office: 'Office Market MChJ',
  tech: 'TechnoPlaza MChJ',
  furniture: 'Mebel Lux MChJ',
  artel: 'Artel savdo uyi',
  water: 'Hayot suvi MChJ',
};

/** Xodimlar (namuna): odamga beriladigan buyumlar uchun */
const PEOPLE = [
  'Aliyev Sardor',
  'Karimova Nilufar',
  'Usmonov Jahongir',
  'Rashidova Malika',
  'Qosimov Anvar',
  'Ismoilova Dilnoza',
  'Tojiyev Bekzod',
  'Nurmatova Gulnora',
  'Sobirov Javlon',
  'Ahmedova Kamola',
];
/** Bo'limlar bazada bo'lmasa — joy nomi oluvchi sifatida yoziladi */
const ROOMS = ['Buxgalteriya', 'Kadrlar bo\'limi', 'Rahbariyat qabulxonasi', 'Majlislar zali', 'Xo\'jalik bo\'limi'];

const POSTAL: Array<[number, number, string, number, string]> = [
  // [oy, kun, korxona, so'm, izoh]
  [0, 6, "O'zbekiston pochtasi", 86_000, 'Buyurtma xatlar (12 ta)'],
  [0, 21, 'EMS Uzbekistan', 145_000, 'Hududlarga hujjatlar'],
  [1, 4, "O'zbekiston pochtasi", 112_000, 'Buyurtma xatlar (16 ta)'],
  [1, 18, 'BTS Express', 68_000, 'Posilka'],
  [1, 27, "O'zbekiston pochtasi", 54_000, 'Xatlar'],
  [2, 3, 'EMS Uzbekistan', 210_000, 'Sudga hujjatlar'],
];

export interface WarehouseDemoStatus {
  items: number;
  docs: number;
  assets: number;
  postal: number;
  /** Demo kirimlari va pochta — Xarajatlarga tushgan summa */
  expenseTiyin: string;
}

function tashkentToday(): Date {
  const now = new Date(Date.now() + 5 * 60 * 60 * 1000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const som = (value: number) => String(BigInt(Math.round(value)) * 100n);

@Injectable()
export class WarehouseDemo {
  constructor(
    private readonly prisma: PrismaService,
    private readonly warehouse: WarehouseService,
    private readonly counts: WarehouseCounts,
    private readonly postal: WarehousePostal,
    private readonly audit: AuditService,
  ) {}

  private mark() {
    return { startsWith: WH_DEMO_MARK };
  }

  async status(): Promise<WarehouseDemoStatus> {
    const items = await this.prisma.stockItem.findMany({ where: { note: this.mark() }, select: { id: true } });
    const itemIds = items.map((i) => i.id);
    const [docs, assets, postal, lines] = await Promise.all([
      this.prisma.stockDoc.count({ where: { note: this.mark(), deletedAt: null } }),
      itemIds.length ? this.prisma.asset.count({ where: { itemId: { in: itemIds } } }) : Promise.resolve(0),
      this.prisma.postalPayment.findMany({ where: { note: this.mark(), deletedAt: null }, select: { amountTiyin: true } }),
      itemIds.length
        ? this.prisma.stockLine.findMany({ where: { itemId: { in: itemIds }, expenseId: { not: null } }, select: { amountTiyin: true } })
        : Promise.resolve([] as { amountTiyin: bigint }[]),
    ]);
    const total = [...lines, ...postal].reduce((s, r) => s + r.amountTiyin, 0n);
    return { items: items.length, docs, assets, postal: postal.length, expenseTiyin: total.toString() };
  }

  async create(userId: string): Promise<WarehouseDemoStatus> {
    const existing = await this.prisma.stockItem.count({ where: { note: this.mark() } });
    if (existing > 0) throw new ConflictException("Ombor demosi allaqachon qo'shilgan. Avval «Demoni o'chirish»ni bosing");

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
    const keeper = user?.fullName ?? null;
    const realItems = await this.prisma.stockItem.count({ where: { isActive: true } });
    const realAssetsInStock = await this.prisma.asset.count({ where: { status: 'IN_STOCK' } });
    const openCount = await this.prisma.stockCount.count({ where: { status: 'DRAFT' } });
    const departments = await this.prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { order: 'asc' }, take: 5 });

    // ── Sanalar: joriy oydan 2 oy oldingi 1-sanadan bugungacha ──
    const today = tashkentToday();
    const day = (month: number, d: number): Date | null => {
      const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 2 + month, d));
      return date > today ? null : date;
    };

    try {
      // ── Buyumlar ──
      const id: Record<string, string> = {};
      for (const item of ITEMS) {
        const taken = await this.prisma.stockItem.findFirst({ where: { name: { equals: item.name, mode: 'insensitive' }, kind: item.kind } });
        const created = await this.warehouse.createItem({
          name: taken ? `${item.name} (demo)` : item.name,
          unit: item.unit,
          kind: item.kind,
          group: item.group,
          categoryCode: item.category,
          minQty: item.minQty ?? null,
          note: NOTE,
        });
        id[item.key] = created.id;
      }
      const price = new Map(ITEMS.map((i) => [i.key, i.price]));
      const line = (key: string, qty: number, extra: Partial<LineInput> = {}): LineInput => ({ itemId: id[key], qty, priceTiyin: som(price.get(key)!), ...extra });
      const out = (key: string, qty: number): LineInput => ({ itemId: id[key], qty });

      const doc = async (date: Date | null, input: DocInput) => {
        if (!date) return null;
        return this.warehouse.createDoc({ issuedBy: keeper, ...input, date: iso(date), note: input.note ? `${WH_DEMO_MARK} ${input.note}` : NOTE }, userId);
      };
      const inStock = async (key: string, take: number) =>
        (await this.prisma.asset.findMany({ where: { itemId: id[key], status: 'IN_STOCK' }, orderBy: { inventoryNo: 'asc' }, select: { id: true } }))
          .slice(0, take)
          .map((a) => a.id);
      const person = (i: number) => PEOPLE[i % PEOPLE.length]!;
      const room = (i: number): Partial<DocInput> =>
        departments[i] ? { departmentId: departments[i]!.id, responsible: person(i + 3) } : { holderName: ROOMS[i % ROOMS.length], responsible: person(i + 3) };

      // ═══════════ 1-oy: boshlang'ich kirimlar va tarqatish ═══════════
      await doc(day(0, 2), {
        kind: 'RECEIPT', counterparty: SUPPLIERS.office, documentNo: 'F-1184', paymentMethod: 'BANK',
        lines: [line('a4', 60), line('pen', 200), line('pencil', 100), line('folder', 120), line('files', 20), line('stapler', 10), line('clips', 30), line('marker', 40), line('notebook', 60), line('glue', 40)],
      });
      await doc(day(0, 3), {
        kind: 'RECEIPT', counterparty: SUPPLIERS.office, documentNo: 'F-1185', paymentMethod: 'BANK',
        lines: [line('soap', 30), line('tp', 150), line('napkin', 60), line('bags', 40), line('cleaner', 20), line('gloves', 40)],
      });
      await doc(day(0, 4), {
        kind: 'RECEIPT', counterparty: SUPPLIERS.water, documentNo: 'HS-0731', paymentMethod: 'CASH',
        lines: [line('water', 40), line('tea', 12), line('sugar', 20)],
      });
      await doc(day(0, 5), {
        kind: 'RECEIPT', counterparty: SUPPLIERS.tech, documentNo: 'TP-2210', paymentMethod: 'BANK',
        lines: [
          line('laptop', 6, { serials: ['PF4K1A01', 'PF4K1A02', 'PF4K1A03', 'PF4K1A04', 'PF4K1A05', 'PF4K1A06'] }),
          line('aio', 4), line('monitor', 6), line('printer', 3), line('projector', 1), line('shredder', 1),
          line('cartridge', 10), line('mouse', 10), line('keyboard', 6), line('flash', 10),
        ],
      });
      await doc(day(0, 8), {
        kind: 'RECEIPT', counterparty: SUPPLIERS.furniture, documentNo: 'ML-095', paymentMethod: 'BANK',
        lines: [line('chair', 12), line('desk', 6), line('cabinet', 3), line('safe', 1)],
      });
      await doc(day(0, 12), {
        kind: 'RECEIPT', counterparty: SUPPLIERS.artel, documentNo: 'AR-55712', paymentMethod: 'BANK',
        lines: [line('ac', 2), line('cooler', 2)],
      });

      // Asosiy vositalarni odamlarga berish
      const laptops = await inStock('laptop', 6);
      for (let i = 0; i < laptops.length; i += 1) {
        await doc(day(0, 9 + (i % 3)), { kind: 'ISSUE', holderName: person(i), assetIds: [laptops[i]!], responsible: person(i) });
      }
      const aio = await inStock('aio', 4);
      const monitors = await inStock('monitor', 6);
      for (let i = 0; i < aio.length; i += 1) {
        await doc(day(0, 11), { kind: 'ISSUE', holderName: person(6 + i), assetIds: [aio[i]!, ...(monitors[i] ? [monitors[i]!] : [])], responsible: person(6 + i) });
      }
      if (monitors[4] && monitors[5]) await doc(day(0, 12), { kind: 'ISSUE', holderName: person(0), responsible: person(0), note: 'Ikkinchi monitor', assetIds: [monitors[4], monitors[5]] });
      const chairs = await inStock('chair', 10);
      const desks = await inStock('desk', 6);
      for (let i = 0; i < 5; i += 1) {
        await doc(day(0, 13), { kind: 'ISSUE', ...room(i), assetIds: [chairs[i * 2]!, chairs[i * 2 + 1]!, ...(desks[i] ? [desks[i]!] : [])] });
      }
      const printers = await inStock('printer', 3);
      await doc(day(0, 14), { kind: 'ISSUE', ...room(0), assetIds: [printers[0]!, ...(await inStock('cabinet', 1))] });
      await doc(day(0, 14), { kind: 'ISSUE', ...room(1), assetIds: [printers[1]!, ...(await inStock('safe', 1))] });
      await doc(day(0, 15), { kind: 'ISSUE', ...room(3), assetIds: [...(await inStock('projector', 1)), ...(await inStock('ac', 1))] });
      await doc(day(0, 15), { kind: 'ISSUE', ...room(2), assetIds: [...(await inStock('ac', 1)), ...(await inStock('cooler', 1))] });

      // TMZ tarqatish (har hafta)
      const weekly = async (month: number, d: number, i: number, scale: number) => {
        await doc(day(month, d), { kind: 'ISSUE', ...room(i), lines: [out('a4', 4 * scale), out('pen', 10 * scale), out('folder', 6 * scale), out('notebook', 3 * scale)] });
        await doc(day(month, d + 1), { kind: 'ISSUE', ...room(4), note: 'Tozalash uchun', lines: [out('soap', 2 * scale), out('tp', 12 * scale), out('bags', 2 * scale), out('cleaner', 1 * scale)] });
        await doc(day(month, d + 1), { kind: 'ISSUE', ...room(2), note: 'Oshxona', lines: [out('water', 3 * scale), out('sugar', 1 * scale)] });
      };
      await weekly(0, 16, 0, 2);
      await weekly(0, 23, 1, 2);
      await doc(day(0, 18), { kind: 'ISSUE', holderName: person(1), responsible: person(1), lines: [out('cartridge', 2), out('flash', 2)] });
      await doc(day(0, 25), { kind: 'ISSUE', holderName: person(4), responsible: person(4), lines: [out('mouse', 2), out('keyboard', 1)] });

      // ═══════════ 2-oy: to'ldirish, ko'chirish, qaytarish, hisobdan chiqarish ═══════════
      await doc(day(1, 2), {
        kind: 'RECEIPT', counterparty: SUPPLIERS.office, documentNo: 'F-1302', paymentMethod: 'BANK',
        lines: [line('a4', 30), line('pen', 100), line('folder', 60), line('tp', 100), line('soap', 15), line('napkin', 30)],
      });
      await doc(day(1, 3), { kind: 'RECEIPT', counterparty: SUPPLIERS.water, documentNo: 'HS-0812', paymentMethod: 'CASH', lines: [line('water', 30), line('tea', 6), line('sugar', 10)] });
      await doc(day(1, 4), { kind: 'RECEIPT', counterparty: SUPPLIERS.tech, documentNo: 'TP-2388', paymentMethod: 'BANK', lines: [line('cartridge', 4), line('mouse', 4)] });
      for (const [d, i] of [[6, 2], [13, 0], [20, 1], [27, 3]] as const) await weekly(1, d, i, 2);
      await doc(day(1, 9), { kind: 'ISSUE', holderName: person(7), responsible: person(7), lines: [out('cartridge', 3)] });
      // Ko'chirish: noutbuk bir xodimdan boshqasiga
      await doc(day(1, 10), { kind: 'TRANSFER', holderName: person(9), responsible: person(9), note: "Lavozim o'zgargani sababli", assetIds: [laptops[5]!] });
      // Qaytarish: monitor omborga qaytdi
      if (monitors[4]) await doc(day(1, 16), { kind: 'RETURN', note: 'Ishchi joy qisqardi', assetIds: [monitors[4]!] });
      // Hisobdan chiqarish: singan stul va yaroqsiz sichqonchalar
      await doc(day(1, 22), { kind: 'WRITE_OFF', reason: 'Singan, ta\'mirlab bo\'lmaydi (dalolatnoma bilan)', assetIds: [chairs[9]!] });
      await doc(day(1, 22), { kind: 'WRITE_OFF', reason: 'Yaroqsiz holga kelgan', lines: [out('mouse', 2)] });
      await doc(day(1, 24), { kind: 'ISSUE', ...room(3), assetIds: await inStock('shredder', 1) });

      // ═══════════ 3-oy: bugungacha ═══════════
      await doc(day(2, 1), { kind: 'RECEIPT', counterparty: SUPPLIERS.water, documentNo: 'HS-0903', paymentMethod: 'CASH', lines: [line('water', 20), line('tea', 4)] });
      await weekly(2, 2, 1, 2);
      await doc(day(2, 3), { kind: 'ISSUE', holderName: person(2), responsible: person(2), lines: [out('cartridge', 3), out('flash', 3)] });
      await doc(day(2, 4), { kind: 'ISSUE', ...room(0), lines: [out('a4', 20), out('files', 6)] });
      if (monitors[4]) await doc(day(2, 5), { kind: 'ISSUE', holderName: person(3), responsible: person(3), assetIds: [monitors[4]!] });

      // ── Inventarizatsiya: ombor faqat demodan iborat bo'lsa (haqiqiy buyumlar sanoqqa aralashmasin) ──
      const countDate = new Date(today.getTime() - 86_400_000);
      if (realItems === 0 && realAssetsInStock === 0 && openCount === 0 && countDate >= (day(0, 1) ?? today)) {
        const c = await this.counts.create(
          { date: iso(countDate), chairman: person(4), commission: `${person(0)}, ${person(3)}`, note: `${WH_DEMO_MARK} Choraklik inventarizatsiya` },
          userId,
        );
        const shortBy: Record<string, number> = { [id.pen!]: 6, [id.tp!]: 4 };
        const extraBy: Record<string, number> = { [id.clips!]: 2 };
        await this.counts.save(c.id, {
          lines: c.lines.map((l) => ({ itemId: l.itemId, actualQty: Math.max(0, (l.bookQty ?? 0) - (shortBy[l.itemId] ?? 0) + (extraBy[l.itemId] ?? 0)) })),
          assets: c.assets.map((a) => ({ assetId: a.assetId, found: true })),
        });
        await this.counts.finish(c.id, userId);
      }

      // ── Pochta to'lovlari ──
      for (const [month, d, company, amount, note] of POSTAL) {
        const date = day(month, d);
        if (!date) continue;
        await this.postal.create(
          { date: iso(date), company, amountTiyin: som(amount), paymentMethod: 'CASH', note: `${WH_DEMO_MARK} ${note}` },
          userId,
        );
      }
    } catch (error) {
      // Yarim qolgan demo qolmasin
      await this.wipe();
      throw error;
    }

    const status = await this.status();
    await this.audit.log({
      userId,
      action: 'CREATE',
      entity: 'warehouse',
      entityId: 'demo',
      summary: `Ombor demo qo'shildi: ${status.items} ta buyum, ${status.docs} ta hujjat, ${status.assets} ta asosiy vosita`,
    });
    return status;
  }

  async remove(userId: string): Promise<WarehouseDemoStatus> {
    const before = await this.status();
    await this.wipe();
    await this.audit.log({
      userId,
      action: 'DELETE',
      entity: 'warehouse',
      entityId: 'demo',
      summary: `Ombor demo o'chirildi: ${before.items} ta buyum, ${before.docs} ta hujjat, ${before.postal} ta pochta to'lovi`,
    });
    return { items: 0, docs: 0, assets: 0, postal: 0, expenseTiyin: '0' };
  }

  /**
   * Demoni butunlay o'chirish. Demo buyumlarga tegishli hamma narsa ketadi: qatorlar, xarajatlari,
   * inventar raqamlari va harakatlari, sanoq qatorlari. Haqiqiy hujjatda demo buyum ham bo'lsa —
   * faqat o'sha qator olinadi, hujjat summasi qayta hisoblanadi.
   */
  private async wipe(): Promise<void> {
    const items = await this.prisma.stockItem.findMany({ where: { note: this.mark() }, select: { id: true } });
    const itemIds = items.map((i) => i.id);
    const assets = itemIds.length ? await this.prisma.asset.findMany({ where: { itemId: { in: itemIds } }, select: { id: true } }) : [];
    const assetIds = assets.map((a) => a.id);
    const lines = itemIds.length
      ? await this.prisma.stockLine.findMany({ where: { itemId: { in: itemIds } }, select: { docId: true, expenseId: true } })
      : [];
    const moves = assetIds.length ? await this.prisma.assetMove.findMany({ where: { assetId: { in: assetIds } }, select: { docId: true } }) : [];
    const markedDocs = await this.prisma.stockDoc.findMany({ where: { note: this.mark() }, select: { id: true } });
    const docIds = [...new Set([...lines.map((l) => l.docId), ...moves.map((m) => m.docId), ...markedDocs.map((d) => d.id)].filter((x): x is string => Boolean(x)))];
    const expenseIds = lines.map((l) => l.expenseId).filter((x): x is string => Boolean(x));
    const postal = await this.prisma.postalPayment.findMany({ where: { note: this.mark() }, select: { id: true, expenseId: true } });
    const postalExpenses = postal.map((p) => p.expenseId).filter((x): x is string => Boolean(x));
    const counts = await this.prisma.stockCount.findMany({ where: { note: this.mark() }, select: { id: true } });

    await this.prisma.$transaction(
      async (tx) => {
        if (expenseIds.length || postalExpenses.length) {
          await tx.expense.deleteMany({ where: { id: { in: [...expenseIds, ...postalExpenses] }, source: 'WAREHOUSE' } });
        }
        if (postal.length) await tx.postalPayment.deleteMany({ where: { id: { in: postal.map((p) => p.id) } } });

        if (counts.length) {
          const countIds = counts.map((c) => c.id);
          await tx.stockCountLine.deleteMany({ where: { countId: { in: countIds } } });
          await tx.stockCountAsset.deleteMany({ where: { countId: { in: countIds } } });
          await tx.stockCount.deleteMany({ where: { id: { in: countIds } } });
        }
        if (itemIds.length) await tx.stockCountLine.deleteMany({ where: { itemId: { in: itemIds } } });
        if (assetIds.length) await tx.stockCountAsset.deleteMany({ where: { assetId: { in: assetIds } } });
        if (docIds.length) {
          await tx.stockCount.updateMany({ where: { writeOffDocId: { in: docIds } }, data: { writeOffDocId: null } });
          await tx.stockCount.updateMany({ where: { receiptDocId: { in: docIds } }, data: { receiptDocId: null } });
        }

        if (assetIds.length) {
          await tx.assetMove.deleteMany({ where: { assetId: { in: assetIds } } });
          await tx.asset.deleteMany({ where: { id: { in: assetIds } } });
        }
        if (itemIds.length) await tx.stockLine.deleteMany({ where: { itemId: { in: itemIds } } });

        // Hujjatlar: bo'sh qolgani o'chadi, aralashganining summasi qayta hisoblanadi
        for (const docId of docIds) {
          const [left, leftMoves] = await Promise.all([
            tx.stockLine.findMany({ where: { docId }, select: { amountTiyin: true } }),
            tx.assetMove.findMany({ where: { docId }, select: { kind: true, asset: { select: { priceTiyin: true } } } }),
          ]);
          if (left.length === 0 && leftMoves.length === 0) {
            await tx.stockDoc.delete({ where: { id: docId } });
          } else {
            const total =
              left.reduce((s, l) => s + l.amountTiyin, 0n) +
              leftMoves.filter((m) => m.kind !== 'RECEIPT').reduce((s, m) => s + m.asset.priceTiyin, 0n);
            await tx.stockDoc.update({ where: { id: docId }, data: { totalTiyin: total } });
          }
        }
        if (itemIds.length) await tx.stockItem.deleteMany({ where: { id: { in: itemIds } } });
      },
      { timeout: 120_000 },
    );
  }
}