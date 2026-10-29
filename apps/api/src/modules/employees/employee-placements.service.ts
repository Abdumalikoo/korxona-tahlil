import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { runExclusive } from '../../common/locks';
import { overlaps, PLACEMENTS_KEY, readPlacements, readPlacementsValue, type Placement } from '../../common/placements/placements';
import { REGION_GENERAL } from '../../common/segments/segments';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const CENTRAL_REGION = 0;
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null);
const periodLabel = (p: Pick<Placement, 'from' | 'to'>) => `${p.from} — ${p.to ?? 'hozirgacha'}`;

/**
 * Xodimning joylashuv davrlari: «shu oydan shu oygacha shu joyda (Markaz bo'limi yoki hudud), shu lavozimda».
 * Oylik joy aniqlashda (ish haqi, solishtirma, Markaz bo'limlari) reestrdagi joydan ustun — common/placements.
 */
@Injectable()
export class EmployeePlacementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Xodimning davrlari (eskidan yangiga) — joy nomi bilan */
  async list(pinfl: string) {
    const items = (await readPlacements(this.prisma)).filter((p) => p.pinfl === pinfl).sort((a, b) => a.from.localeCompare(b.from));
    const labels = await this.labels(items);
    return { items: items.map((p) => ({ ...p, placeLabel: labels(p) })) };
  }

  async add(pinfl: string, body: Record<string, unknown>, userId: string) {
    const emp = await this.prisma.employee.findUnique({ where: { pinfl }, select: { pinfl: true } });
    if (!emp) throw new NotFoundException('Xodim topilmadi');
    const from = text(body?.from, 7);
    const to = text(body?.to, 7);
    if (!from || !PERIOD.test(from)) throw new BadRequestException("Boshlanish oyini tanlang (YYYY-MM)");
    if (to && (!PERIOD.test(to) || to < from)) throw new BadRequestException("Tugash oyi boshlanishdan oldin bo'lmasin");
    const unit = body?.unit === 'CENTER' || body?.unit === 'REGION' ? body.unit : null;
    if (!unit) throw new BadRequestException('Joyni tanlang: Markaz yoki Hudud');
    let departmentId: string | null = null;
    let regionCode: number | null = null;
    let districtId: string | null = null;
    if (unit === 'CENTER') {
      departmentId = text(body?.departmentId, 64);
      if (!departmentId) throw new BadRequestException("Markaz bo'limini tanlang");
      if (!(await this.prisma.department.findUnique({ where: { id: departmentId }, select: { id: true } }))) throw new BadRequestException("Bo'lim topilmadi");
    } else {
      regionCode = typeof body?.regionCode === 'number' ? body.regionCode : Number(body?.regionCode);
      if (!Number.isInteger(regionCode) || regionCode === CENTRAL_REGION || regionCode === REGION_GENERAL) throw new BadRequestException('Viloyatni tanlang');
      if (!(await this.prisma.region.findUnique({ where: { code: regionCode }, select: { code: true } }))) throw new BadRequestException('Viloyat topilmadi');
      districtId = text(body?.districtId, 64);
      if (districtId) {
        const d = await this.prisma.district.findUnique({ where: { id: districtId }, select: { regionCode: true } });
        if (!d || d.regionCode !== regionCode) throw new BadRequestException('Tuman shu viloyatga tegishli emas');
      }
    }
    const by = (await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }).catch(() => null))?.fullName ?? '';
    const item: Placement = { id: randomUUID(), pinfl, from, to, unit, departmentId, regionCode, districtId, position: text(body?.position, 120), note: text(body?.note, 300), createdAt: new Date().toISOString(), createdBy: by };

    await runExclusive(`setting:${PLACEMENTS_KEY}`, async () => {
      const all = readPlacementsValue((await this.prisma.setting.findUnique({ where: { key: PLACEMENTS_KEY } }))?.value ?? null);
      const clash = all.find((p) => p.pinfl === pinfl && overlaps(p, item));
      if (clash) throw new BadRequestException(`Bu davr mavjud davr bilan ustma-ust tushadi (${periodLabel(clash)}) — avval uni o'chiring yoki oylarni o'zgartiring`);
      await this.save([...all, item]);
    });
    const label = (await this.labels([item]))(item);
    await this.audit.log({ userId, action: 'CREATE', entity: 'employee_placement', entityId: pinfl, summary: `Joylashuv davri: ${periodLabel(item)} → ${label}${item.position ? `, ${item.position}` : ''}` });
    return { ...item, placeLabel: label };
  }

  async remove(pinfl: string, id: string, userId: string) {
    const removed = await runExclusive(`setting:${PLACEMENTS_KEY}`, async () => {
      const all = readPlacementsValue((await this.prisma.setting.findUnique({ where: { key: PLACEMENTS_KEY } }))?.value ?? null);
      const hit = all.find((p) => p.id === id && p.pinfl === pinfl);
      if (!hit) throw new NotFoundException('Davr topilmadi — sahifani yangilang');
      await this.save(all.filter((p) => p !== hit));
      return hit;
    });
    await this.audit.log({ userId, action: 'DELETE', entity: 'employee_placement', entityId: pinfl, summary: `Joylashuv davri o'chirildi: ${periodLabel(removed)} → ${(await this.labels([removed]))(removed)}` });
    return { success: true as const };
  }

  private async save(items: Placement[]) {
    const value = { items } as unknown as object;
    await this.prisma.setting.upsert({ where: { key: PLACEMENTS_KEY }, create: { key: PLACEMENTS_KEY, value }, update: { value } });
  }

  /** Joy nomi: «Markaz › Bo'lim» yoki «Viloyat › Tuman» */
  private async labels(items: Placement[]) {
    const [deps, regs, dists] = await Promise.all([
      this.prisma.department.findMany({ where: { id: { in: items.map((p) => p.departmentId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } }),
      this.prisma.region.findMany({ where: { code: { in: items.map((p) => p.regionCode).filter((x): x is number => x !== null) } }, select: { code: true, name: true } }),
      this.prisma.district.findMany({ where: { id: { in: items.map((p) => p.districtId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } }),
    ]);
    const dep = new Map(deps.map((d) => [d.id, d.name]));
    const reg = new Map(regs.map((r) => [r.code, r.name]));
    const dist = new Map(dists.map((d) => [d.id, d.name]));
    return (p: Placement) =>
      p.unit === 'CENTER'
        ? `Markaz › ${(p.departmentId && dep.get(p.departmentId)) || "bo'limsiz"}`
        : `${(p.regionCode !== null && reg.get(p.regionCode)) || 'Hudud'}${p.districtId && dist.get(p.districtId) ? ` › ${dist.get(p.districtId)}` : ''}`;
  }
}
