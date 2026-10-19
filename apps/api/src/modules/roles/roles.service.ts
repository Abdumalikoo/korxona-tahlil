import { BadRequestException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import { customRoleLabels, roleAccess, roleLabel, setRoleLabels, WORKER_ROLES } from '../../common/access/role-access';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

// ═══════════════════════════════════════════════════════════
// Rollar (umumiy hudud › chap panel «ROLLAR»):
//   • ro'yxat — har rol administrator qo'ygan nom bilan, xodimlari soni va dashbordlari;
//   • nomini o'zgartirish — «roles.labels» sozlamasida saqlanadi, butun dasturda (menyu,
//     foydalanuvchilar, rol egasining o'z ekrani) shu nom ko'rinadi;
//   • rol dashbordi uchun: shu rol xodimlari (oxirgi kirish, holat), bugungi ish va
//     oxirgi 7 kunlik harakatlar (kim, qachon, nima kiritdi).
// ═══════════════════════════════════════════════════════════

const KEY = 'roles.labels';
const DAY = 86_400_000;

const DOC_LABELS: Record<string, string> = {
  RECEIPT: 'Kirim',
  ISSUE: 'Chiqim',
  RETURN: 'Qaytarish',
  TRANSFER: "Ko'chirish",
  WRITE_OFF: 'Hisobdan chiqarish',
};
const VEHICLE_LABELS: Record<string, string> = {
  FUEL: "Yoqilg'i",
  WASH: 'Moyka',
  REPAIR: "Ta'mirlash",
  SERVICE: 'Texnik xizmat',
  OTHER: 'Boshqa',
};

export interface RoleItem {
  value: string;
  /** Ko'rinadigan nom (administrator qo'ygan yoki asl) */
  label: string;
  /** Asl nomi (dasturdagi) */
  defaultLabel: string;
  description: string;
  codePrefix: string;
  sections: string[];
  dashboards: { label: string; href: string }[];
  /** Manzil: /rollar/skladchi */
  slug: string;
  users: number;
  activeUsers: number;
}

export interface RoleActivity {
  id: string;
  at: string;
  type: 'STOCK' | 'VEHICLE' | 'POSTAL' | 'PURCHASE' | 'CASH';
  title: string;
  subtitle: string | null;
  amountTiyin: string;
  by: string | null;
  cancelled: boolean;
}

export interface RoleStat {
  stockDocs: number;
  vehicleRecords: number;
  postal: number;
  purchases: number;
  purchaseTiyin: string;
  amountTiyin: string;
  /** Buxgalter: saqlangan kunlik ma'lumotnomalar */
  cashReports: number;
}

export interface RoleOverview {
  role: RoleItem;
  users: { id: string; fullName: string; loginCode: string | null; isActive: boolean; locked: boolean; mustChangePin: boolean; lastLoginAt: string | null }[];
  today: RoleStat;
  week: RoleStat;
  activity: RoleActivity[];
}

function tashkentDayStart(): Date {
  const now = new Date(Date.now() + 5 * 3600_000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 5 * 3600_000);
}

@Injectable()
export class RolesService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Ishga tushishda administrator bergan nomlar yuklanadi */
  async onModuleInit(): Promise<void> {
    try {
      const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
      setRoleLabels((row?.value ?? {}) as Record<string, string>);
    } catch {
      // baza hali tayyor bo'lmasa — asl nomlar bilan ishlayveradi
    }
  }

  private findRole(raw: string): string {
    const key = String(raw ?? '').toUpperCase();
    if (!roleAccess(key)) throw new NotFoundException('Rol topilmadi');
    return key;
  }

  async list(): Promise<RoleItem[]> {
    const counts = await this.prisma.user.groupBy({ by: ['role', 'isActive'], _count: { _all: true } });
    return Object.entries(WORKER_ROLES).map(([value, a]) => {
      const mine = counts.filter((c) => c.role === value);
      return {
        value,
        label: roleLabel(value),
        defaultLabel: a!.label,
        description: a!.description,
        codePrefix: a!.codePrefix,
        sections: a!.sections,
        dashboards: a!.dashboards,
        slug: value.toLowerCase(),
        users: mine.reduce((s, c) => s + c._count._all, 0),
        activeUsers: mine.filter((c) => c.isActive).reduce((s, c) => s + c._count._all, 0),
      };
    });
  }

  /** Rol nomini o'zgartirish (bo'sh — asl nomiga qaytadi) */
  async rename(raw: string, labelRaw: unknown, actorId: string): Promise<RoleItem> {
    const role = this.findRole(raw);
    const label = typeof labelRaw === 'string' ? labelRaw.trim().replace(/\s+/g, ' ') : '';
    if (label && (label.length < 2 || label.length > 40)) throw new BadRequestException("Nom 2–40 belgidan iborat bo'lsin");
    const before = roleLabel(role);
    const labels = customRoleLabels();
    if (label && label !== roleAccess(role)!.label) labels[role] = label;
    else delete labels[role];
    const others = Object.entries(labels).filter(([k]) => k !== role).map(([, v]) => v.toLowerCase());
    if (label && others.includes(label.toLowerCase())) throw new BadRequestException(`«${label}» nomli rol allaqachon bor`);
    await this.prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: labels }, update: { value: labels } });
    setRoleLabels(labels);
    await this.audit.log({ userId: actorId, action: 'UPDATE', entity: 'user', entityId: role, summary: `Rol nomi o'zgartirildi: «${before}» → «${roleLabel(role)}»` });
    return (await this.list()).find((r) => r.value === role)!;
  }

  async overview(raw: string): Promise<RoleOverview> {
    const role = this.findRole(raw);
    const item = (await this.list()).find((r) => r.value === role)!;
    const users = await this.prisma.user.findMany({
      where: { role: role as UserRole },
      select: { id: true, fullName: true, loginCode: true, isActive: true, lockedUntil: true, mustChangePin: true, lastLoginAt: true },
      orderBy: [{ isActive: 'desc' }, { loginCode: 'asc' }],
    });
    const ids = users.map((u) => u.id);
    const names = new Map(users.map((u) => [u.id, u.loginCode ? `${u.fullName} (${u.loginCode})` : u.fullName]));
    const today = tashkentDayStart();
    const since = new Date(today.getTime() - 6 * DAY);
    const byUser = { createdById: { in: ids }, createdAt: { gte: since } };

    const cash = ids.length
      ? await this.prisma.cashReport.findMany({
          where: { updatedById: { in: ids }, updatedAt: { gte: since } },
          select: { id: true, date: true, createdAt: true, updatedAt: true, updatedById: true },
          orderBy: { updatedAt: 'desc' },
          take: 100,
        })
      : [];
    const [docs, records, postal, purchases] = ids.length
      ? await Promise.all([
          this.prisma.stockDoc.findMany({
            where: byUser,
            select: { id: true, number: true, kind: true, totalTiyin: true, counterparty: true, holderName: true, reason: true, createdAt: true, createdById: true, deletedAt: true },
            orderBy: { createdAt: 'desc' },
            take: 300,
          }),
          this.prisma.vehicleRecord.findMany({
            where: byUser,
            select: { id: true, kind: true, amountTiyin: true, liters: true, counterparty: true, createdAt: true, createdById: true, deletedAt: true, vehicle: { select: { plateNumber: true, model: true } } },
            orderBy: { createdAt: 'desc' },
            take: 300,
          }),
          this.prisma.postalPayment.findMany({
            where: byUser,
            select: { id: true, company: true, amountTiyin: true, note: true, createdAt: true, createdById: true, deletedAt: true },
            orderBy: { createdAt: 'desc' },
            take: 300,
          }),
          this.prisma.purchase.findMany({
            where: byUser,
            select: { id: true, number: true, kind: true, supplierName: true, lotNo: true, totalTiyin: true, createdAt: true, createdById: true, deletedAt: true, status: true },
            orderBy: { createdAt: 'desc' },
            take: 300,
          }),
        ])
      : [[], [], [], []];

    const activity: RoleActivity[] = [
      ...docs.map((d) => ({
        id: d.id,
        at: d.createdAt.toISOString(),
        type: 'STOCK' as const,
        title: `${DOC_LABELS[d.kind] ?? d.kind} ${d.number}`,
        subtitle: d.kind === 'RECEIPT' ? d.counterparty : d.kind === 'WRITE_OFF' ? d.reason : d.holderName,
        amountTiyin: d.totalTiyin.toString(),
        by: d.createdById ? (names.get(d.createdById) ?? null) : null,
        cancelled: d.deletedAt !== null,
      })),
      ...records.map((r) => ({
        id: r.id,
        at: r.createdAt.toISOString(),
        type: 'VEHICLE' as const,
        title: `${VEHICLE_LABELS[r.kind] ?? r.kind}: ${r.vehicle.plateNumber}`,
        subtitle: [r.vehicle.model, r.liters ? `${r.liters} l` : null, r.counterparty].filter(Boolean).join(' · ') || null,
        amountTiyin: r.amountTiyin.toString(),
        by: r.createdById ? (names.get(r.createdById) ?? null) : null,
        cancelled: r.deletedAt !== null,
      })),
      ...postal.map((p) => ({
        id: p.id,
        at: p.createdAt.toISOString(),
        type: 'POSTAL' as const,
        title: `Pochta: ${p.company}`,
        subtitle: p.note,
        amountTiyin: p.amountTiyin.toString(),
        by: p.createdById ? (names.get(p.createdById) ?? null) : null,
        cancelled: p.deletedAt !== null,
      })),
      ...purchases.map((p) => ({
        id: p.id,
        at: p.createdAt.toISOString(),
        type: 'PURCHASE' as const,
        title: `${p.kind === 'EXCHANGE' ? 'Birja' : 'Xarid'} ${p.number}`,
        subtitle: [p.supplierName, p.kind === 'EXCHANGE' && p.lotNo ? `lot ${p.lotNo}` : null].filter(Boolean).join(' · ') || null,
        amountTiyin: p.totalTiyin.toString(),
        by: p.createdById ? (names.get(p.createdById) ?? null) : null,
        cancelled: p.deletedAt !== null || p.status === 'CANCELLED',
      })),
      ...cash.map((c) => ({
        id: c.id,
        at: c.updatedAt.toISOString(),
        type: 'CASH' as const,
        title: `Kunlik tushum ${c.date.toISOString().slice(0, 10).split('-').reverse().join('.')}`,
        subtitle: c.updatedAt.getTime() - c.createdAt.getTime() > 60_000 ? "o'zgartirildi" : 'yozildi',
        amountTiyin: '0',
        by: c.updatedById ? (names.get(c.updatedById) ?? null) : null,
        cancelled: false,
      })),
    ].sort((a, b) => (a.at < b.at ? 1 : -1));

    const stat = (from: Date) => {
      const live = activity.filter((a) => !a.cancelled && new Date(a.at) >= from);
      return {
        stockDocs: live.filter((a) => a.type === 'STOCK').length,
        vehicleRecords: live.filter((a) => a.type === 'VEHICLE').length,
        postal: live.filter((a) => a.type === 'POSTAL').length,
        purchases: live.filter((a) => a.type === 'PURCHASE').length,
        cashReports: live.filter((a) => a.type === 'CASH').length,
        purchaseTiyin: live.filter((a) => a.type === 'PURCHASE').reduce((s, a) => s + BigInt(a.amountTiyin), 0n).toString(),
        // Xarajatga ta'sir: kirim, mashina, pochta (chiqim va boshqalar — ombor ichidagi harakat)
        amountTiyin: live
          .filter((a) => (a.type !== 'STOCK' || a.title.startsWith('Kirim')) && a.type !== 'PURCHASE' && a.type !== 'CASH')
          .reduce((s, a) => s + BigInt(a.amountTiyin), 0n)
          .toString(),
      };
    };

    const now = Date.now();
    return {
      role: item,
      users: users.map((u) => ({
        id: u.id,
        fullName: u.fullName,
        loginCode: u.loginCode,
        isActive: u.isActive,
        locked: Boolean(u.lockedUntil && u.lockedUntil.getTime() > now),
        mustChangePin: u.mustChangePin,
        lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
      })),
      today: stat(today),
      week: stat(since),
      activity: activity.slice(0, 60),
    };
  }
}