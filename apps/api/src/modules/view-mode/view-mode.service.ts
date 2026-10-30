import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// ═══════════════════════════════════════════════════════════
// Ko'rinish rejimi — butun dastur uchun bitta:
//   brief — qisqa (rahbar uchun: eng muhim raqamlar va xulosalar)
//   full  — to'liq (hamma tafsilot, maydalab ko'rish)
// Manba (ma'lumot kiritish) bo'limlari rejimdan qat'i nazar har doim to'liq.
// homeOnly — «Faqat Bosh sahifa»: Bosh sahifadan boshqa hamma bo'lim hamma uchun yashiriladi (administrator yoqadi).
// ═══════════════════════════════════════════════════════════

export type ViewMode = 'brief' | 'full';

export interface ViewModeState {
  mode: ViewMode;
  /** Faqat Bosh sahifa ko'rinadi (boshqa bo'limlar hamma uchun yashirin) */
  homeOnly: boolean;
  updatedAt: string | null;
}

const KEY = 'ui.viewMode';

@Injectable()
export class ViewModeService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<ViewModeState> {
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    const value = (row?.value ?? null) as { mode?: unknown; homeOnly?: unknown } | null;
    const mode: ViewMode = value?.mode === 'brief' ? 'brief' : 'full';
    return { mode, homeOnly: value?.homeOnly === true, updatedAt: row?.updatedAt.toISOString() ?? null };
  }

  private async save(patch: { mode?: ViewMode; homeOnly?: boolean }): Promise<ViewModeState> {
    const cur = await this.get();
    const value = { mode: patch.mode ?? cur.mode, homeOnly: patch.homeOnly ?? cur.homeOnly };
    await this.prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
    return this.get();
  }

  async set(raw: unknown): Promise<ViewModeState> {
    if (raw !== 'brief' && raw !== 'full') throw new BadRequestException("Rejim noto'g'ri: brief (qisqa) yoki full (to'liq)");
    return this.save({ mode: raw });
  }

  /** «Faqat Bosh sahifa» — yoqish / o'chirish */
  async setHomeOnly(raw: unknown): Promise<ViewModeState> {
    if (typeof raw !== 'boolean') throw new BadRequestException("Qiymat noto'g'ri: true yoki false");
    return this.save({ homeOnly: raw });
  }
}
