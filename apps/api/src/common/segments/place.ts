import { BadRequestException } from '@nestjs/common';
import { isSegment, segmentLabel } from './segments';

// ═══════════════════════════════════════════════════════════
// Yozuv qayerga tegishli — daromad va xarajat uchun yagona tekshiruv:
//   • Markaz:   hudud kodi 0, bo'lim — ixtiyoriy, tuman yo'q;
//   • Hudud:    hudud kodi (faol), tuman — ixtiyoriy (shu hududniki), bo'lim yo'q;
//   • Yo'nalish (Tax free, Marksheyder, Fermer xo'jaligi, Buxgalteriya xizmatlari): hudud, tuman, bo'lim yo'q.
// Hech biri berilmasa — eski usul (faqat bo'lim yoki hech narsa).
// ═══════════════════════════════════════════════════════════

export interface EntryPlace {
  regionCode: number | null;
  districtId: string | null;
  departmentId: string | null;
  segment: string | null;
}

interface PlaceDb {
  district: { findUnique(args: { where: { id: string }; select: { regionCode: true; name: true } }): Promise<{ regionCode: number; name: string } | null> };
  region: { findUnique(args: { where: { code: number }; select: { isActive: true; name: true } }): Promise<{ isActive: boolean; name: string } | null> };
}

export async function resolveEntryPlace(db: PlaceDb, input: EntryPlace, what = 'yozuv'): Promise<EntryPlace> {
  if (input.segment) {
    if (!isSegment(input.segment)) throw new BadRequestException("Yo'nalish noto'g'ri");
    if (input.regionCode !== null || input.districtId || input.departmentId) throw new BadRequestException(`«${segmentLabel(input.segment)}» ${what}ida hudud, tuman yoki bo'lim tanlanmaydi`);
    return { regionCode: null, districtId: null, departmentId: null, segment: input.segment };
  }
  let { regionCode } = input;
  const { districtId, departmentId } = input;
  if (districtId) {
    const district = await db.district.findUnique({ where: { id: districtId }, select: { regionCode: true, name: true } });
    if (!district) throw new BadRequestException('Tuman topilmadi');
    if (regionCode !== null && regionCode !== district.regionCode) throw new BadRequestException(`"${district.name}" tanlangan hududga tegishli emas`);
    regionCode = district.regionCode;
  }
  if (regionCode === null) return { regionCode: null, districtId: null, departmentId, segment: null };
  const region = await db.region.findUnique({ where: { code: regionCode }, select: { isActive: true, name: true } });
  if (!region) throw new BadRequestException('Hudud topilmadi');
  if (regionCode === 0) {
    if (districtId) throw new BadRequestException(`Markaz ${what}ida tuman tanlanmaydi`);
    return { regionCode: 0, districtId: null, departmentId, segment: null };
  }
  if (!region.isActive) throw new BadRequestException(`"${region.name}" hududi faol emas`);
  if (departmentId) throw new BadRequestException(`Hudud ${what}ida Markaz bo'limi tanlanmaydi — bo'limni olib tashlang yoki «Markaz»ni tanlang`);
  return { regionCode, districtId: districtId ?? null, departmentId: null, segment: null };
}

/**
 * Tahrirlashda: yuborilgan maydonlar + joriy qiymatlar → yangi joy (hech narsa yuborilmasa — null, o'zgarmaydi).
 * Yo'nalish tanlansa — hudud/bo'lim tozalanadi; hudud yoki bo'lim yuborilsa — yo'nalish olib tashlanadi;
 * hudud almashsa — eski tuman olib tashlanadi.
 */
export async function resolveEntryPlaceUpdate(
  db: PlaceDb,
  current: EntryPlace,
  dto: { regionCode?: number | null; districtId?: string | null; departmentId?: string | null; segment?: string | null },
  what = 'yozuv',
): Promise<EntryPlace | null> {
  const sent = dto.regionCode !== undefined || dto.districtId !== undefined || dto.departmentId !== undefined || dto.segment !== undefined;
  if (!sent) return null;
  if (dto.segment) return resolveEntryPlace(db, { regionCode: null, districtId: null, departmentId: null, segment: dto.segment }, what);
  const regionSent = dto.regionCode !== undefined;
  const regionChanged = regionSent && dto.regionCode !== current.regionCode;
  // Yo'nalishdan Markaz/hududga o'tganda joriy qiymatlar bo'sh — faqat yuborilgani ishlatiladi
  const base = current.segment ? { regionCode: null, districtId: null, departmentId: null } : current;
  return resolveEntryPlace(
    db,
    {
      regionCode: regionSent ? (dto.regionCode ?? null) : base.regionCode,
      districtId: dto.districtId !== undefined ? dto.districtId || null : regionChanged ? null : base.districtId,
      departmentId: dto.departmentId !== undefined ? dto.departmentId || null : regionSent && dto.regionCode !== 0 && dto.regionCode !== null ? null : base.departmentId,
      segment: null,
    },
    what,
  );
}