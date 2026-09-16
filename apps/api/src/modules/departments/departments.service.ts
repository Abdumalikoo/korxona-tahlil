import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateDepartmentDto } from './dto/create-department.dto';
import type { UpdateDepartmentDto } from './dto/update-department.dto';

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(includeInactive = false) {
    return this.prisma.department.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string) {
    const department = await this.prisma.department.findUnique({ where: { id } });
    if (!department) {
      throw new NotFoundException('Bo\u2018lim topilmadi');
    }
    return department;
  }

  async create(dto: CreateDepartmentDto) {
    const existing = await this.prisma.department.findUnique({
      where: { code: dto.code },
    });
    if (existing) {
      throw new ConflictException('Bu kod bilan bo\u2018lim allaqachon mavjud');
    }


    return this.prisma.department.create({
      data: {
        code: dto.code,
        name: dto.name,
        index: dto.index,
        order: dto.order ?? dto.index * 10,
        allocationWeight: dto.allocationWeight ?? 1,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: string, dto: UpdateDepartmentDto) {
    await this.findOne(id);

    return this.prisma.department.update({
      where: { id },
      data: dto,
    });
  }

  /**
   * Bo'lim o'chirilmaydi — arxivga olinadi.
   * Unga bog'langan xarajat va daromadlar saqlanib qoladi.
   */
  async archive(id: string) {
    await this.findOne(id);

    return this.prisma.department.update({
      where: { id },
      data: { isActive: false },
    });
  }


  /** Bo'limda nechta yozuv borligini ko'rsatadi */
  async getUsage(id: string) {
    const [expenses, incomes, employees] = await Promise.all([
      this.prisma.expense.count({ where: { departmentId: id, deletedAt: null } }),
      this.prisma.income.count({ where: { departmentId: id, deletedAt: null } }),
      this.prisma.employee.count({ where: { departmentId: id, isActive: true } }),
    ]);

    return { expenses, incomes, employees };
  }
}
