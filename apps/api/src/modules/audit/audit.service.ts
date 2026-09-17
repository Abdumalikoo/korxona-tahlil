import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE' | 'IMPORT';

interface LogParams {
  userId: string;
  action: AuditAction;
  /** Qaysi jadval: employee, expense, income */
  entity: string;
  entityId: string;
  /** Faqat o'zgargan maydonlar */
  changes?: Record<string, { from: unknown; to: unknown }>;
  /** Qisqa tavsif — ro'yxatda ko'rinadi */
  summary?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * O'zgarishni yozadi.
   *
   * Xatolik bo'lsa asosiy amalni to'xtatmaydi — audit
   * yordamchi vosita, u tufayli ish buzilmasligi kerak.
   */
  async log(params: LogParams): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: params.userId,
          action: params.action,
          entityType: params.entity,
          entityId: params.entityId,
          changes: {
            fields: params.changes ?? {},
            summary: params.summary ?? null,
          } as object,
        },
      });
    } catch (error) {
      this.logger.warn(`Audit yozilmadi: ${String(error)}`);
    }
  }

  /**
   * Ikki obyektni solishtiradi va farqni qaytaradi.
   * Faqat kuzatiladigan maydonlar tekshiriladi.
   */
  diff<T extends Record<string, unknown>>(
    before: T,
    after: Partial<T>,
    fields: (keyof T)[],
  ): Record<string, { from: unknown; to: unknown }> {
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    for (const field of fields) {
      if (after[field] === undefined) continue;

      const oldValue = before[field];
      const newValue = after[field];

      // BigInt va Date ni matnga o'giramiz
      const normalize = (value: unknown): unknown => {
        if (typeof value === 'bigint') return value.toString();
        if (value instanceof Date) return value.toISOString();
        return value;
      };

      const from = normalize(oldValue);
      const to = normalize(newValue);

      if (from !== to) {
        changes[String(field)] = { from, to };
      }
    }

    return changes;
  }

  /** Bitta yozuvning o'zgarishlar tarixi */
  async findByEntity(entity: string, entityId: string) {
    return this.prisma.auditLog.findMany({
      where: { entityType: entity, entityId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        user: { select: { id: true, fullName: true, username: true } },
      },
    });
  }

  /** Umumiy tarix — filtrlar bilan */
  async findAll(params: {
    entity?: string;
    action?: AuditAction;
    userId?: string;
    page?: number;
    limit?: number;
  }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 50;

    const where = {
      ...(params.entity ? { entityType: params.entity } : {}),
      ...(params.action ? { action: params.action } : {}),
      ...(params.userId ? { userId: params.userId } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, fullName: true, username: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}

