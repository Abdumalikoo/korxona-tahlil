import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type User, type UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { isWorkerRole, normalizeLoginCode, roleAccess, roleLabel, WORKER_ROLES } from '../../common/access/role-access';
import { assertPin, generatePin } from '../../common/access/pin';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateWorkerDto, ResetPinDto, UpdateWorkerDto } from './dto/users.dto';

// ═══════════════════════════════════════════════════════════
// Foydalanuvchilar (faqat administrator): ishchi rollar uchun ID kod va PIN.
//  • ID kod tizim tomonidan beriladi: SK-0001, SK-0002 …
//  • PIN — 6 raqam; admin bergan yoki tiklagan PIN'ni ishchi birinchi kirishda o'zgartiradi
//  • O'chirilmaydi — bloklanadi (kiritgan hujjatlari va tarix saqlanadi)
// Administrator hisoblari bu yerdan o'zgartirilmaydi (o'zini qulflab qo'ymaslik uchun).
// ═══════════════════════════════════════════════════════════

const BCRYPT_ROUNDS = 12;

export interface UserView {
  id: string;
  fullName: string;
  username: string;
  role: UserRole;
  roleLabel: string;
  /** ID kod bilan kiradigan ishchi rolmi */
  worker: boolean;
  loginCode: string | null;
  /** Ochiq bo'limlar (ishchi rollarda) */
  sections: string[] | null;
  isActive: boolean;
  mustChangePin: boolean;
  /** Xato PIN tufayli vaqtincha yopilgan bo'lsa — qachongacha */
  lockedUntil: string | null;
  failedAttempts: number;
  lastLoginAt: string | null;
  createdAt: string;
}

/** Foydalanuvchi tarixi: kirishlar, xato PIN, admin amallari */
export interface UserEvent {
  id: string;
  at: string;
  action: string;
  summary: string;
  /** Kim bajargan (o'zi yoki administrator) */
  by: string;
  self: boolean;
}

export interface RoleOption {
  value: string;
  label: string;
  description: string;
  codePrefix: string;
  sections: string[];
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private view(u: User): UserView {
    const access = roleAccess(u.role);
    const locked = u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil.toISOString() : null;
    return {
      id: u.id,
      fullName: u.fullName,
      username: u.username,
      role: u.role,
      roleLabel: roleLabel(u.role),
      worker: Boolean(access),
      loginCode: u.loginCode,
      sections: access ? access.sections : null,
      isActive: u.isActive,
      mustChangePin: u.mustChangePin,
      lockedUntil: locked,
      failedAttempts: locked ? 0 : u.failedAttempts,
      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
      createdAt: u.createdAt.toISOString(),
    };
  }

  roles(): RoleOption[] {
    return Object.entries(WORKER_ROLES).map(([value, a]) => ({
      value,
      label: roleLabel(value),
      description: a!.description,
      codePrefix: a!.codePrefix,
      sections: a!.sections,
    }));
  }

  async list(): Promise<UserView[]> {
    const rows = await this.prisma.user.findMany({ orderBy: [{ createdAt: 'asc' }] });
    // Avval administratorlar, keyin ishchilar (rol, kod bo'yicha)
    return rows
      .map((u) => this.view(u))
      .sort((a, b) => Number(a.worker) - Number(b.worker) || a.role.localeCompare(b.role) || (a.loginCode ?? a.username).localeCompare(b.loginCode ?? b.username));
  }

  private async worker(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Foydalanuvchi topilmadi');
    if (!isWorkerRole(user.role)) {
      throw new BadRequestException('Administrator hisobi bu yerdan o‘zgartirilmaydi');
    }
    return user;
  }

  /** Keyingi bo'sh ID kod: SK-0001, SK-0002 … */
  private async nextCode(prefix: string): Promise<string> {
    const rows = await this.prisma.user.findMany({ where: { loginCode: { startsWith: `${prefix}-` } }, select: { loginCode: true } });
    const max = rows.reduce((m, r) => Math.max(m, Number(r.loginCode?.slice(prefix.length + 1)) || 0), 0);
    return `${prefix}-${String(max + 1).padStart(4, '0')}`;
  }

  async create(dto: CreateWorkerDto, actorId: string): Promise<{ user: UserView; pin: string }> {
    const access = roleAccess(dto.role);
    if (!access) throw new BadRequestException('Rol noto‘g‘ri');
    const fullName = dto.fullName.trim().replace(/\s+/g, ' ');
    const pin = dto.pin ? assertPin(dto.pin) : generatePin();
    const pinHash = await bcrypt.hash(pin, BCRYPT_ROUNDS);
    // Parol bilan kirib bo'lmasin: hech kim bilmaydigan tasodifiy parol xeshi
    const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), BCRYPT_ROUNDS);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const code = await this.nextCode(access.codePrefix);
      try {
        const user = await this.prisma.user.create({
          data: {
            username: code.toLowerCase(),
            passwordHash,
            fullName,
            role: dto.role as UserRole,
            loginCode: code,
            pinHash,
            mustChangePin: dto.mustChange !== false,
            isActive: true,
          },
        });
        await this.audit.log({ userId: actorId, action: 'CREATE', entity: 'user', entityId: user.id, summary: `${roleLabel(dto.role ?? '')} qo‘shildi: ${fullName} (${code})` });
        return { user: this.view(user), pin };
      } catch (error) {
        // Bir vaqtda ikki admin qo'shsa — keyingi kod bilan qayta urinamiz
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
        throw error;
      }
    }
    throw new ConflictException('ID kod berib bo‘lmadi — qayta urinib ko‘ring');
  }

  async update(id: string, dto: UpdateWorkerDto, actorId: string): Promise<UserView> {
    const user = await this.worker(id);
    const data: Prisma.UserUpdateInput = {};
    const notes: string[] = [];
    if (dto.fullName !== undefined) {
      const fullName = dto.fullName.trim().replace(/\s+/g, ' ');
      if (fullName !== user.fullName) {
        data.fullName = fullName;
        notes.push(`F.I.Sh.: ${user.fullName} → ${fullName}`);
      }
    }
    if (dto.loginCode !== undefined) {
      const code = normalizeLoginCode(dto.loginCode);
      if (!code) throw new BadRequestException('ID kod ko\u2018rinishi: SK-0001');
      if (code !== user.loginCode) {
        const taken = await this.prisma.user.findFirst({ where: { OR: [{ loginCode: code }, { username: code.toLowerCase() }], NOT: { id } }, select: { fullName: true } });
        if (taken) throw new ConflictException(`${code} band — ${taken.fullName} uchun berilgan`);
        data.loginCode = code;
        data.username = code.toLowerCase();
        // Yangi kod bilan qaytadan kirsin
        data.tokenVersion = { increment: 1 };
        notes.push(`ID kod: ${user.loginCode} → ${code}`);
      }
    }
    if (dto.isActive !== undefined && dto.isActive !== user.isActive) {
      data.isActive = dto.isActive;
      // Bloklanganda ochiq sessiyalar shu zahoti yopiladi
      data.tokenVersion = { increment: 1 };
      if (dto.isActive) {
        data.failedAttempts = 0;
        data.lockedUntil = null;
      }
      notes.push(dto.isActive ? 'blokdan chiqarildi' : 'bloklandi');
    }
    if (notes.length === 0) return this.view(user);
    // Bloklash va kod o'zgarishi bir vaqtda — versiya bir marta oshadi
    const updated = await this.prisma.user.update({ where: { id }, data });
    await this.audit.log({ userId: actorId, action: 'UPDATE', entity: 'user', entityId: id, summary: `${user.loginCode}: ${notes.join('; ')}` });
    return this.view(updated);
  }

  /** Yangi PIN (berilmasa — tasodifiy). Ochiq sessiyalar yopiladi, birinchi kirishda o'zgartirish so'raladi. */
  async resetPin(id: string, dto: ResetPinDto, actorId: string): Promise<{ user: UserView; pin: string }> {
    const user = await this.worker(id);
    const pin = dto.pin ? assertPin(dto.pin) : generatePin();
    const mustChange = dto.mustChange !== false;
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        pinHash: await bcrypt.hash(pin, BCRYPT_ROUNDS),
        mustChangePin: mustChange,
        failedAttempts: 0,
        lockedUntil: null,
        tokenVersion: { increment: 1 },
      },
    });
    await this.audit.log({ userId: actorId, action: 'UPDATE', entity: 'user', entityId: id, summary: `${user.loginCode}: yangi PIN berildi${mustChange ? '' : ' (doimiy)'}` });
    return { user: this.view(updated), pin };
  }

  /** Tarix: qachon kirgani, xato PIN urinishlari, PIN tiklash, bloklash — oxirgi 200 ta */
  async history(id: string): Promise<UserEvent[]> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw new NotFoundException('Foydalanuvchi topilmadi');
    const rows = await this.prisma.auditLog.findMany({
      where: { entityType: 'user', entityId: id },
      include: { user: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => {
      const summary = (r.changes as { summary?: string | null } | null)?.summary ?? '';
      return { id: r.id, at: r.createdAt.toISOString(), action: r.action, summary, by: r.user?.fullName ?? '—', self: r.userId === id };
    });
  }

  /** Xato PIN tufayli yopilgan hisobni muddatidan oldin ochish */
  async unlock(id: string, actorId: string): Promise<UserView> {
    const user = await this.worker(id);
    const updated = await this.prisma.user.update({ where: { id }, data: { failedAttempts: 0, lockedUntil: null } });
    await this.audit.log({ userId: actorId, action: 'UPDATE', entity: 'user', entityId: id, summary: `${user.loginCode}: qulf ochildi` });
    return this.view(updated);
  }
}