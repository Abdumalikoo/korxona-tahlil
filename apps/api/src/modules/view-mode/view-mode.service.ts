import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// ═══════════════════════════════════════════════════════════
// Ko'rinish rejimi — butun dastur uchun bitta:
//   brief — qisqa (rahbar uchun: eng muhim raqamlar va xulosalar)
//   full  — to'liq (hamma tafsilot, maydalab ko'rish)
// Manba (ma'lumot kiritish) bo'limlari rejimdan qat'i nazar har doim to'liq.
// ═══════════════════════════════════════════════════════════

export type ViewMode = 'brief' | 'full';

export interface ViewModeState {
  mode: ViewMode;
  updatedAt: string | null;
}

const KEY = 'ui.viewMode';

@Injectable()
export class ViewModeService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<ViewModeState> {
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    const value = (row?.value ?? null) as { mode?: unknown } | null;
    const mode: ViewMode = value?.mode === 'brief' ? 'brief' : 'full';
    return { mode, updatedAt: row?.updatedAt.toISOString() ?? null };
  }

  async set(raw: unknown): Promise<ViewModeState> {
    if (raw !== 'brief' && raw !== 'full') throw new BadRequestException("Rejim noto'g'ri: brief (qisqa) yoki full (to'liq)");
    await this.prisma.setting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: { mode: raw } },
      update: { value: { mode: raw } },
    });
    return this.get();
  }
}