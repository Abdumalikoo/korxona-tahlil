import { Injectable, NotFoundException } from '@nestjs/common';
import type { Category } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateCategoryDto } from './dto/update-category.dto';

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

  async update(code: string, dto: UpdateCategoryDto): Promise<Category> {
    await this.findOne(code);


    return this.prisma.category.update({
      where: { code },
      data: dto,
    });
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
