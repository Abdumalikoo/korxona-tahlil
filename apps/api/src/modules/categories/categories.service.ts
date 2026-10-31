import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import type { Category } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateCategoryDto } from './dto/update-category.dto';
import type { CreateCategoryDto } from './dto/create-category.dto';

/** Daraxt ko'rinishidagi kategoriya */
export interface CategoryTree extends Category {
  children: CategoryTree[];
}

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Xarajat kategoriyalari — tekis ro'yxat */
  async findAll(includeInactive = false): Promise<Category[]> {
    return this.prisma.category.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { order: 'asc' },
    });
  }

  /** Daraxt ko'rinishida — UI'da ko'rsatish uchun */
  async findTree(includeInactive = false): Promise<CategoryTree[]> {
    const flat = await this.findAll(includeInactive);

    const nodes = new Map<string, CategoryTree>(
      flat.map((item) => [item.code, { ...item, children: [] }]),
    );

    const roots: CategoryTree[] = [];


    for (const node of nodes.values()) {
      if (node.parentCode === null) {
        roots.push(node);
        continue;
      }
      nodes.get(node.parentCode)?.children.push(node);
    }

    return roots;
  }

  /**
   * Faqat barg kategoriyalar — yozuv kiritish uchun yaroqlilar.
   * Ota-kategoriyaga to'g'ridan-to'g'ri xarajat yozib bo'lmaydi.
   */
  async findLeaves(): Promise<Category[]> {
    return this.prisma.category.findMany({
      where: { isActive: true, isLeaf: true },
      orderBy: { order: 'asc' },
    });
  }

  async findOne(code: string): Promise<Category> {
    const category = await this.prisma.category.findUnique({ where: { code } });
    if (!category) {
      throw new NotFoundException('Kategoriya topilmadi');
    }
    return category;
  }

  /**
   * Nomdan kod yasaydi: "Ofis mebeli" -> "OFIS_MEBELI"
   * Ozbek harflarini lotin ekvivalentiga ogiradi.
   */
  private slugify(label: string): string {
    const map: Record<string, string> = {
      "\u02BB": "", "\u2018": "", "\u2019": "", "'": "",
      "\u0441": "S", "\u043E": "O",
    };

    let text = label.trim().toUpperCase();
    for (const [from, to] of Object.entries(map)) {
      text = text.split(from).join(to);
    }

    return text
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "KATEGORIYA";
  }

  /** Kod band bolsa raqam qoshib takrorlanmas qiladi */
  private async uniqueCode(base: string): Promise<string> {
    let code = base;
    let counter = 2;

    while (await this.prisma.category.findUnique({ where: { code } })) {
      code = `${base}_${counter}`;
      counter += 1;
      if (counter > 50) break;
    }

    return code;
  }

  async create(dto: CreateCategoryDto): Promise<Category> {
    // Ota-kategoriya mavjudligini tekshiramiz
    if (dto.parentCode) {
      const parent = await this.prisma.category.findUnique({
        where: { code: dto.parentCode },
        select: { isLeaf: true, label: true },
      });

      if (!parent) {
        throw new BadRequestException("Ota-kategoriya topilmadi");
      }

      // Ota barg bolsa - endi guruh boladi
      if (parent.isLeaf) {
        await this.prisma.category.update({
          where: { code: dto.parentCode },
          data: { isLeaf: false },
        });
      }
    }

    const code = dto.code ?? (await this.uniqueCode(this.slugify(dto.label)));

    const existing = await this.prisma.category.findUnique({ where: { code } });
    if (existing) {
      throw new ConflictException("Bu kod bilan kategoriya allaqachon mavjud");
    }

    // Tartib raqami: shu guruhdagi oxirgisidan keyin
    let order = dto.order;
    if (order === undefined) {
      const last = await this.prisma.category.findFirst({
        where: { parentCode: dto.parentCode ?? null },
        orderBy: { order: "desc" },
        select: { order: true },
      });
      order = (last?.order ?? 0) + (dto.parentCode ? 1 : 100);
    }

    return this.prisma.category.create({
      data: {
        code,
        label: dto.label,
        parentCode: dto.parentCode ?? null,
        // Guruh sifatida yaratilsa barg emas
        isLeaf: dto.parentCode !== null && dto.parentCode !== undefined,
        behavior: dto.behavior ?? "VARIABLE",
        scope: dto.scope ?? "GENERAL",
        keywords: dto.keywords ?? [],
        order,
        isActive: dto.isActive ?? true,
      },
    });
  }

  /** Yangi daromad xizmat turi yaratadi */
  async createIncomeCategory(dto: { label: string; code?: string }) {
    const code = dto.code ?? (await this.uniqueIncomeCode(this.slugify(dto.label)));

    const existing = await this.prisma.incomeCategory.findUnique({
      where: { code },
    });

    if (existing) {
      throw new ConflictException("Bu kod bilan xizmat turi allaqachon mavjud");
    }

    // Tartib raqami - oxirgisidan keyin
    const last = await this.prisma.incomeCategory.findFirst({
      orderBy: { order: "desc" },
      select: { order: true },
    });

    return this.prisma.incomeCategory.create({
      data: {
        code,
        label: dto.label.trim(),
        order: (last?.order ?? 0) + 10,
      },
    });
  }

  /** Xizmat turi uchun takrorlanmas kod */
  private async uniqueIncomeCode(base: string): Promise<string> {
    let code = base;
    let counter = 2;

    while (await this.prisma.incomeCategory.findUnique({ where: { code } })) {
      code = `${base}_${counter}`;
      counter += 1;
      if (counter > 50) break;
    }

    return code;
  }

  /** Kategoriyani arxivlaydi - eski yozuvlar saqlanadi */
  async archive(code: string): Promise<Category> {
    await this.findOne(code);

    return this.prisma.category.update({
      where: { code },
      data: { isActive: false },
    });
  }

  /**
   * Xarajat moddasini butunlay o'chirish — faqat hech qayerda ishlatilmagan bo'lsa (yozuv, savatdagi yozuv,
   * ombor buyumi, asosiy vosita, byudjet, tahlil hodisasi) va ichida modda bo'lmasa. Aks holda — arxivlash.
   */
  async remove(code: string): Promise<{ success: true; label: string }> {
    const cat = await this.prisma.category.findUnique({ where: { code } });
    if (!cat) throw new NotFoundException('Kategoriya topilmadi');
    const [kids, expenses, items, assets, budgets, events] = await Promise.all([
      this.prisma.category.count({ where: { parentCode: code } }),
      this.prisma.expense.count({ where: { categoryCode: code } }),
      this.prisma.stockItem.count({ where: { categoryCode: code } }),
      this.prisma.fixedAsset.count({ where: { categoryCode: code } }),
      this.prisma.expenseBudget.count({ where: { categoryCode: code } }),
      this.prisma.analysisEvent.count({ where: { categoryCode: code } }),
    ]);
    if (kids) throw new BadRequestException(`«${cat.label}» ichida ${kids} ta modda bor — avval ularni o'chiring`);
    const used = [expenses && `${expenses} ta xarajat yozuvi (savatdagilar bilan)`, items && `${items} ta ombor buyumi`, assets && `${assets} ta asosiy vosita`, budgets && `${budgets} ta byudjet`, events && `${events} ta tahlil hodisasi`].filter(Boolean);
    if (used.length) throw new BadRequestException(`«${cat.label}» ishlatilgan: ${used.join(', ')} — o'chirib bo'lmaydi, arxivlang`);
    await this.prisma.category.delete({ where: { code } });
    // Ota guruhda boshqa modda qolmasa — u yana oddiy modda (barg) bo'ladi
    if (cat.parentCode && !(await this.prisma.category.count({ where: { parentCode: cat.parentCode } }))) {
      await this.prisma.category.update({ where: { code: cat.parentCode }, data: { isLeaf: true } });
    }
    return { success: true, label: cat.label };
  }

  /** Daromad xizmat turini arxivlash / qaytarish */
  async setIncomeActive(code: string, isActive: boolean) {
    const cat = await this.prisma.incomeCategory.findUnique({ where: { code } });
    if (!cat) throw new NotFoundException('Xizmat turi topilmadi');
    return this.prisma.incomeCategory.update({ where: { code }, data: { isActive } });
  }

  /** Daromad xizmat turlari — har biri nechta yozuvda ishlatilgani bilan */
  async incomeUsage() {
    const [cats, incomes, tariffs] = await Promise.all([
      this.prisma.incomeCategory.findMany({ orderBy: { order: 'asc' } }),
      this.prisma.income.groupBy({ by: ['categoryCode'], _count: { _all: true } }).catch(() => [] as { categoryCode: string; _count: { _all: number } }[]),
      this.prisma.serviceTariff.groupBy({ by: ['categoryCode'], _count: { _all: true } }).catch(() => [] as { categoryCode: string; _count: { _all: number } }[]),
    ]);
    const inc = new Map(incomes.map((x) => [x.categoryCode, x._count._all]));
    const tar = new Map(tariffs.map((x) => [x.categoryCode, x._count._all]));
    return cats.map((c) => ({ code: c.code, label: c.label, isActive: c.isActive, incomes: inc.get(c.code) ?? 0, tariffs: tar.get(c.code) ?? 0 }));
  }

  /** Daromad xizmat turini o'chirish — faqat daromad yozuvi va tarifi bo'lmasa */
  async removeIncome(code: string): Promise<{ success: true; label: string }> {
    const cat = await this.prisma.incomeCategory.findUnique({ where: { code } });
    if (!cat) throw new NotFoundException('Xizmat turi topilmadi');
    const [incomes, tariffs, budgets, events] = await Promise.all([
      this.prisma.income.count({ where: { categoryCode: code } }),
      this.prisma.serviceTariff.count({ where: { categoryCode: code } }),
      this.prisma.expenseBudget.count({ where: { categoryCode: code } }),
      this.prisma.analysisEvent.count({ where: { categoryCode: code } }),
    ]);
    const used = [incomes && `${incomes} ta daromad yozuvi (savatdagilar bilan)`, tariffs && `${tariffs} ta tarif`, budgets && `${budgets} ta reja`, events && `${events} ta tahlil hodisasi`].filter(Boolean);
    if (used.length) throw new BadRequestException(`«${cat.label}» ishlatilgan: ${used.join(', ')} — o'chirib bo'lmaydi, arxivlang`);
    await this.prisma.incomeCategory.delete({ where: { code } });
    return { success: true, label: cat.label };
  }

  /** Kategoriyada nechta yozuv borligini korsatadi */
  async getUsage(code: string): Promise<{ expenses: number }> {
    const expenses = await this.prisma.expense.count({
      where: { categoryCode: code, deletedAt: null },
    });

    return { expenses };
  }

  async update(code: string, dto: UpdateCategoryDto): Promise<Category> {
    await this.findOne(code);


    return this.prisma.category.update({
      where: { code },
      data: dto,
    });
  }

  // ═══════════ Moddalar boshqaruvi (Umumiy manba) ═══════════

  /**
   * Hamma faol xarajat moddalari — daraxt uchun (ota, guruhmi) va har biriga yozilgan xarajatlar soni va summasi
   * (o'chirilmagan yozuvlar). Moddalar boshqaruvi sahifasi shundan daraxt quradi.
   */
  async manageList() {
    const [cats, usage] = await Promise.all([
      this.prisma.category.findMany({ where: { isActive: true }, select: { code: true, label: true, parentCode: true, isLeaf: true, order: true }, orderBy: [{ order: 'asc' }, { label: 'asc' }] }),
      this.prisma.expense.groupBy({ by: ['categoryCode'], where: { deletedAt: null }, _count: { _all: true }, _sum: { amountTiyin: true } }),
    ]);
    const use = new Map(usage.map((u) => [u.categoryCode, u]));
    return cats.map((c) => ({ ...c, count: use.get(c.code)?._count._all ?? 0, totalTiyin: (use.get(c.code)?._sum.amountTiyin ?? 0n).toString() }));
  }

  /**
   * Moddani boshqa guruhga ko'chirish (parentCode: null — eng yuqori darajaga). Qoidalar:
   *  • o'ziga yoki o'z ichidagi bo'limchaga ko'chirib bo'lmaydi (aylana bo'lmasin);
   *  • yangi ota — guruh yoki hali yozuvi yo'q modda (u guruhga aylanadi); yozuvi bor moddaga ko'chirilmaydi
   *    (aks holda yozuvlar guruhda qolib ketadi);
   *  • eski guruh bo'sh qolsa — oddiy moddaga aylanadi.
   * Xarajat yozuvlari o'zgarmaydi — faqat modda qaysi guruhda turishi (hisobotlarda o'sha guruh ichida ko'rinadi).
   */
  async move(code: string, parentCodeRaw: unknown): Promise<{ code: string; label: string; from: string | null; to: string | null }> {
    const parentCode = typeof parentCodeRaw === 'string' && parentCodeRaw.trim() ? parentCodeRaw.trim() : null;
    const all = await this.prisma.category.findMany({ select: { code: true, label: true, parentCode: true, isLeaf: true } });
    const by = new Map(all.map((c) => [c.code, c]));
    const cat = by.get(code);
    if (!cat) throw new NotFoundException('Modda topilmadi');
    if (cat.parentCode === parentCode) return { code, label: cat.label, from: cat.parentCode, to: parentCode };
    if (parentCode) {
      const target = by.get(parentCode);
      if (!target) throw new BadRequestException('Guruh topilmadi');
      // Aylana: yangi ota — shu moddaning o'zi yoki uning ichidagi bo'limcha bo'lmasin
      for (let p: string | null = parentCode; p; p = by.get(p)?.parentCode ?? null) {
        if (p === code) throw new BadRequestException("Moddani o'ziga yoki o'z ichidagi bo'limchaga ko'chirib bo'lmaydi");
      }
      if (target.isLeaf && (await this.prisma.expense.count({ where: { categoryCode: parentCode, deletedAt: null } })) > 0) {
        throw new BadRequestException(`«${target.label}» — yozuvlari bor modda, guruh emas. Avval yangi guruh yarating va o'shanga ko'chiring`);
      }
    }
    const from = cat.parentCode;
    await this.prisma.$transaction(async (tx) => {
      if (parentCode && by.get(parentCode)!.isLeaf) await tx.category.update({ where: { code: parentCode }, data: { isLeaf: false } });
      const last = await tx.category.findFirst({ where: { parentCode }, orderBy: { order: 'desc' }, select: { order: true } });
      await tx.category.update({ where: { code }, data: { parentCode, order: (last?.order ?? 0) + (parentCode ? 1 : 100) } });
      // Eski guruh bo'sh qoldi — oddiy moddaga aylanadi
      if (from && (await tx.category.count({ where: { parentCode: from } })) === 0) await tx.category.update({ where: { code: from }, data: { isLeaf: true } });
    });
    return { code, label: cat.label, from, to: parentCode };
  }

  /** Daromad kategoriyalari */
  async findIncomeCategories(includeInactive = false) {
    return this.prisma.incomeCategory.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { order: 'asc' },
    });
  }

  /**
   * Kategoriyadan ildizgacha bo'lgan yo'l.
   * Hisobotlarda "Ish haqi fondi › Asosiy ish haqi" ko'rinishida ishlatiladi.
   */
  async getPath(code: string): Promise<Category[]> {
    const all = await this.prisma.category.findMany();
    const map = new Map(all.map((item) => [item.code, item]));

    const path: Category[] = [];
    let current = map.get(code);

    while (current) {
      path.unshift(current);
      current = current.parentCode ? map.get(current.parentCode) : undefined;
    }

    if (path.length === 0) {

      throw new NotFoundException('Kategoriya topilmadi');
    }

    return path;
  }
}
