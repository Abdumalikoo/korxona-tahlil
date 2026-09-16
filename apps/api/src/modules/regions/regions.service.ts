import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RegionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Barcha viloyatlar - Markaz birinchi */
  async findAll(includeInactive = false) {
    return this.prisma.region.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  /** Viloyatlar tumanlari bilan birga - tanlagich uchun */
  async findAllWithDistricts(includeInactive = false) {
    return this.prisma.region.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { code: 'asc' },
      include: {
        districts: {
          where: includeInactive ? {} : { isActive: true },
          orderBy: { code: 'asc' },
        },
      },
    });
  }

  async findOne(code: number) {
    const region = await this.prisma.region.findUnique({
      where: { code },
      include: { districts: { orderBy: { code: 'asc' } } },
    });

    if (!region) {
      throw new NotFoundException('Viloyat topilmadi');
    }

    return region;
  }

  /** Bitta viloyatning tumanlari */
  async findDistricts(regionCode: number, includeInactive = false) {
    return this.prisma.district.findMany({
      where: {
        regionCode,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: { code: 'asc' },
    });
  }

  /** Barcha tumanlar - qidiruv uchun */
  async findAllDistricts(search?: string) {
    return this.prisma.district.findMany({
      where: {
        isActive: true,
        ...(search?.trim()
          ? { name: { contains: search.trim(), mode: 'insensitive' } }
          : {}),
      },
      orderBy: [{ regionCode: 'asc' }, { code: 'asc' }],
      include: {
        region: { select: { code: true, name: true } },
      },
      take: search ? 50 : 500,
    });
  }
}
