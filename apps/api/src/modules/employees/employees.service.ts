import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type { Prisma, Employee } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateEmployeeDto } from './dto/create-employee.dto';
import type { UpdateEmployeeDto } from './dto/update-employee.dto';
import type { QueryEmployeeDto } from './dto/query-employee.dto';

const DEFAULT_LIMIT = 50;
const CENTRAL_REGION = 0;

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  // --------- Yordamchilar ---------

  private buildFullName(
    lastName: string,
    firstName: string,
    middleName?: string | null,
  ): string {
    return [lastName, firstName, middleName].filter(Boolean).join(' ');
  }

  /**
   * Hudud va bolim mosligini tekshiradi.
   *
   * Markaz (0) - bolim majburiy, tuman bosh.
   * Viloyat - tuman majburiy, bolim bosh.
   */
  private async validatePlacement(
    regionCode: number,
    districtId: string | null | undefined,
    departmentId: string | null | undefined,
  ): Promise<void> {
    const region = await this.prisma.region.findUnique({ where: { code: regionCode } });
    if (!region) {
      throw new BadRequestException('Hudud topilmadi');
    }

    if (regionCode === CENTRAL_REGION) {
      if (!departmentId) {
        throw new BadRequestException('Markaz xodimi uchun bolim majburiy');
      }
      if (districtId) {
        throw new BadRequestException('Markaz xodimiga tuman korsatilmaydi');
      }

      const department = await this.prisma.department.findUnique({
        where: { id: departmentId },
      });
      if (!department) {
        throw new BadRequestException('Bolim topilmadi');
      }
      return;
    }

    // Viloyat xodimi
    if (departmentId) {
      throw new BadRequestException('Viloyat xodimiga bolim korsatilmaydi');
    }

    if (districtId) {
      const district = await this.prisma.district.findUnique({
        where: { id: districtId },
      });
      if (!district) {
        throw new BadRequestException('Tuman topilmadi');
      }
      if (district.regionCode !== regionCode) {
        throw new BadRequestException('Tuman tanlangan viloyatga tegishli emas');
      }
    }
  }

  private async buildWhere(query: QueryEmployeeDto): Promise<Prisma.EmployeeWhereInput> {
    const where: Prisma.EmployeeWhereInput = {};

    if (!query.includeInactive) {
      where.isActive = true;
    }

    if (query.regionCode !== undefined) {
      where.regionCode = query.regionCode;
    }

    if (query.districtId) {
      where.districtId = query.districtId;
    }

    if (query.departmentId) {
      where.departmentId = query.departmentId;
    }

    if (query.employmentType) {
      where.employmentType = query.employmentType;
    }

    // Guruh - hudud va ish turidan hisoblanadi
    if (query.group === 'markaz-shtat') {
      where.regionCode = CENTRAL_REGION;
      where.employmentType = 'SHTAT';
    } else if (query.group === 'tuman-shtat') {
      where.regionCode = { not: CENTRAL_REGION };
      where.employmentType = 'SHTAT';
    } else if (query.group === 'shartnoma') {
      where.employmentType = 'SHARTNOMA';
    }

    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { fullName: { contains: term, mode: 'insensitive' } },
        { pinfl: { contains: term } },
        { position: { contains: term, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  // --------- Asosiy amallar ---------

  async findAll(query: QueryEmployeeDto) {
    const where = await this.buildWhere(query);
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_LIMIT;

    const [items, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        orderBy: [{ fullName: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          region: { select: { code: true, name: true } },
          district: { select: { id: true, code: true, name: true } },
          department: { select: { id: true, code: true, name: true, index: true } },
        },
      }),
      this.prisma.employee.count({ where }),
    ]);

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(pinfl: string): Promise<Employee> {
    const employee = await this.prisma.employee.findUnique({
      where: { pinfl },
      include: {
        region: { select: { code: true, name: true } },
        district: { select: { id: true, code: true, name: true } },
        department: { select: { id: true, code: true, name: true, index: true } },
      },
    });

    if (!employee) {
      throw new NotFoundException('Xodim topilmadi');
    }

    return employee;
  }

  async create(dto: CreateEmployeeDto): Promise<Employee> {
    const existing = await this.prisma.employee.findUnique({
      where: { pinfl: dto.pinfl },
    });
    if (existing) {
      throw new ConflictException('Bu PINFL bilan xodim allaqachon mavjud');
    }

    await this.validatePlacement(dto.regionCode, dto.districtId, dto.departmentId);

    return this.prisma.employee.create({
      data: {
        pinfl: dto.pinfl,
        lastName: dto.lastName,
        firstName: dto.firstName,
        middleName: dto.middleName ?? null,
        fullName: this.buildFullName(dto.lastName, dto.firstName, dto.middleName),
        employmentType: dto.employmentType,
        regionCode: dto.regionCode,
        districtId: dto.districtId ?? null,
        departmentId: dto.departmentId ?? null,
        position: dto.position ?? null,
        hiredAt: dto.hiredAt ? new Date(dto.hiredAt) : null,
        firedAt: dto.firedAt ? new Date(dto.firedAt) : null,
        isActive: dto.isActive ?? true,
      },
      include: {
        region: { select: { code: true, name: true } },
        district: { select: { id: true, code: true, name: true } },
        department: { select: { id: true, code: true, name: true, index: true } },
      },
    });
  }

  async update(pinfl: string, dto: UpdateEmployeeDto): Promise<Employee> {
    const current = await this.prisma.employee.findUnique({ where: { pinfl } });
    if (!current) {
      throw new NotFoundException('Xodim topilmadi');
    }

    // Joylashuv ozgarsa - qayta tekshiramiz
    const regionCode = dto.regionCode ?? current.regionCode;
    const districtId = dto.districtId !== undefined ? dto.districtId : current.districtId;
    const departmentId =
      dto.departmentId !== undefined ? dto.departmentId : current.departmentId;

    if (
      dto.regionCode !== undefined ||
      dto.districtId !== undefined ||
      dto.departmentId !== undefined
    ) {
      await this.validatePlacement(regionCode, districtId, departmentId);
    }

    const lastName = dto.lastName ?? current.lastName;
    const firstName = dto.firstName ?? current.firstName;
    const middleName = dto.middleName !== undefined ? dto.middleName : current.middleName;

    const data: Prisma.EmployeeUpdateInput = {
      lastName,
      firstName,
      middleName,
      fullName: this.buildFullName(lastName, firstName, middleName),
      employmentType: dto.employmentType ?? current.employmentType,
      region: { connect: { code: regionCode } },
      district: districtId ? { connect: { id: districtId } } : { disconnect: true },
      department: departmentId ? { connect: { id: departmentId } } : { disconnect: true },
    };

    if (dto.position !== undefined) data.position = dto.position;
    if (dto.hiredAt !== undefined) {
      data.hiredAt = dto.hiredAt ? new Date(dto.hiredAt) : null;
    }
    if (dto.firedAt !== undefined) {
      data.firedAt = dto.firedAt ? new Date(dto.firedAt) : null;
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    return this.prisma.employee.update({
      where: { pinfl },
      data,
      include: {
        region: { select: { code: true, name: true } },
        district: { select: { id: true, code: true, name: true } },
        department: { select: { id: true, code: true, name: true, index: true } },
      },
    });
  }

  /** Xodimni arxivlaydi - ish haqi tarixi saqlanadi */
  async archive(pinfl: string): Promise<Employee> {
    await this.findOne(pinfl);

    return this.prisma.employee.update({
      where: { pinfl },
      data: { isActive: false, firedAt: new Date() },
    });
  }

  // --------- Statistika ---------

  /** Guruhlar boyicha xodimlar soni */
  async stats() {
    const [centralStaff, regionalStaff, contract, total] = await Promise.all([
      this.prisma.employee.count({
        where: { isActive: true, regionCode: CENTRAL_REGION, employmentType: 'SHTAT' },
      }),
      this.prisma.employee.count({
        where: {
          isActive: true,
          regionCode: { not: CENTRAL_REGION },
          employmentType: 'SHTAT',
        },
      }),
      this.prisma.employee.count({
        where: { isActive: true, employmentType: 'SHARTNOMA' },
      }),
      this.prisma.employee.count({ where: { isActive: true } }),
    ]);

    return { centralStaff, regionalStaff, contract, total };
  }

  /** Hududlar boyicha taqsimot */
  async byRegion() {
    const grouped = await this.prisma.employee.groupBy({
      by: ['regionCode'],
      where: { isActive: true },
      _count: { _all: true },
    });

    const regions = await this.prisma.region.findMany({
      select: { code: true, name: true },
    });
    const map = new Map(regions.map((r) => [r.code, r.name]));

    return grouped
      .map((row) => ({
        regionCode: row.regionCode,
        name: map.get(row.regionCode) ?? String(row.regionCode),
        count: row._count._all,
      }))
      .sort((a, b) => a.regionCode - b.regionCode);
  }

  /** Bolimlar boyicha taqsimot - faqat markaz */
  async byDepartment() {
    const grouped = await this.prisma.employee.groupBy({
      by: ['departmentId'],
      where: { isActive: true, regionCode: CENTRAL_REGION },
      _count: { _all: true },
    });

    const departments = await this.prisma.department.findMany({
      select: { id: true, name: true, index: true },
    });
    const map = new Map(departments.map((d) => [d.id, d]));

    return grouped
      .map((row) => {
        const dept = row.departmentId ? map.get(row.departmentId) : null;
        return {
          departmentId: row.departmentId,
          name: dept?.name ?? 'Bolimsiz',
          index: dept?.index ?? 999,
          count: row._count._all,
        };
      })
      .sort((a, b) => a.index - b.index);
  }
}
