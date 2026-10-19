import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
    type OnModuleInit,
} from '@nestjs/common';
import type { Lease, LeaseDocument, LeaseTerm, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, type ReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { LeaseMonthsService } from './leases.months';
import {
    amountFor,
    assertPeriod,
    buildPlace,
    currentPeriod,
    loadLookups,
    parseTiyin,
    previousPeriod,
    statusFor,
    type Lookups,
} from './leases.shared';
import {
    ALLOWED_DOCUMENT_TYPES,
    CENTRAL_REGION,
    LEASE_CATEGORY,
    LEASE_CATEGORY_LABEL,
    MAX_DOCUMENT_SIZE,
    type ChangeImpact,
    type LeaseAccrualView,
    type LeaseDetail,
    type LeaseDocumentTypeValue,
    type LeaseDocumentView,
    type LeaseFrequencyValue,
    type LeaseInput,
    type LeaseKindValue,
    type LeaseListItem,
    type LeaseListQuery,
    type LeaseListResult,
    type LeaseTermView,
    type TerminateInput,
    type TermInput,
} from './leases.types';

const KINDS: LeaseKindValue[] = ['ODDIY', 'AEROPORT'];
const FREQUENCIES: LeaseFrequencyValue[] = ['MONTHLY', 'QUARTERLY', 'YEARLY'];
const DOCUMENT_TYPES: LeaseDocumentTypeValue[] = [
  'SHARTNOMA',
  'QOSHIMCHA_KELISHUV',
  'DALOLATNOMA',
  'BOSHQA',
];

type LeaseWithRelations = Lease & { terms: LeaseTerm[]; documents: LeaseDocument[] };

/** Bo'sh satrni null'ga aylantiradi */
function text(value: unknown, max = 500): string | null {
  if (value === null || value === undefined) return null;
  const result = String(value).trim().slice(0, max);
  return result === '' ? null : result;
}

/** Multer fayl nomini latin1 deb o'qiydi — o'zbekcha/ruscha nomlar uchun tuzatamiz */
function fixFileName(name: string): string {
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    return decoded.includes('\uFFFD') ? name : decoded;
  } catch {
    return name;
  }
}

@Injectable()
export class LeasesService implements OnModuleInit {
  private readonly logger = new Logger(LeasesService.name);

  /** Hujjatlar papkasi — zaxira nusxaga albatta qo'shing */
  private readonly storageRoot = resolve(
    process.env.LEASE_FILES_DIR ?? join(process.cwd(), 'storage', 'leases'),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly months: LeaseMonthsService,
  ) {}

  /** "Ijara" kategoriyasi bo'lmasa yaratamiz (mavjud bo'lsa tegmaymiz) */
  async onModuleInit(): Promise<void> {
    try {
      await this.prisma.category.upsert({
        where: { code: LEASE_CATEGORY },
        update: {},
        create: { code: LEASE_CATEGORY, label: LEASE_CATEGORY_LABEL, order: 50 },
      });
    } catch (error) {
      this.logger.warn(`Ijara kategoriyasini tekshirib bo'lmadi: ${String(error)}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Ma'lumotnomalar
  // ═══════════════════════════════════════════════════════════

  /** Forma uchun: hududlar (tumanlari bilan), Markaz bo'limlari, aeroportlar */
  async lookups() {
    const [regions, districts, departments, airports] = await Promise.all([
      this.prisma.region.findMany({
        where: { isActive: true },
        select: { code: true, name: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.district.findMany({
        where: { isActive: true },
        select: { id: true, name: true, regionCode: true, code: true },
        orderBy: [{ regionCode: 'asc' }, { code: 'asc' }],
      }),
      this.prisma.department.findMany({
        where: { isActive: true },
        select: { id: true, name: true, index: true },
        orderBy: [{ order: 'asc' }, { index: 'asc' }],
      }),
      this.prisma.lease.findMany({
        where: { kind: 'AEROPORT', airportName: { not: null }, deletedAt: null },
        select: { airportName: true },
        distinct: ['airportName'],
      }),
    ]);

    return {
      regions: regions.map((region) => ({
        code: region.code,
        name: region.name,
        districts: districts
          .filter((d) => d.regionCode === region.code && d.code !== 0)
          .map((d) => ({ id: d.id, name: d.name })),
      })),
      departments,
      airports: airports
        .map((a) => a.airportName)
        .filter((name): name is string => Boolean(name))
        .sort((a, b) => a.localeCompare(b)),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Ro'yxat va karta
  // ═══════════════════════════════════════════════════════════

  private toListItem(lease: LeaseWithRelations, period: string, lookups: Lookups): LeaseListItem {
    const sorted = [...lease.terms].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    const latest = sorted[sorted.length - 1];
    const next = sorted.find((t) => t.validFrom > period && t.validFrom >= lease.startPeriod);

    return {
      id: lease.id,
      number: lease.number,
      contractDate: lease.contractDate ? lease.contractDate.toISOString().slice(0, 10) : null,
      kind: lease.kind as LeaseKindValue,
      title: lease.title,
      place: buildPlace(lease, lookups),
      lessorName: lease.lessorName,
      areaM2: lease.areaM2,
      vatIncluded: lease.vatIncluded,
      paymentFrequency: lease.paymentFrequency as LeaseFrequencyValue,
      startPeriod: lease.startPeriod,
      endPeriod: lease.endPeriod,
      status: statusFor(lease, period),
      monthlyTiyin: amountFor(lease, sorted, period).toString(),
      latestTiyin: (latest?.monthlyTiyin ?? 0n).toString(),
      nextChange:
        next && statusFor(lease, next.validFrom) === 'ACTIVE'
          ? { validFrom: next.validFrom, monthlyTiyin: next.monthlyTiyin.toString() }
          : null,
      documentCount: lease.documents.length,
      hasContract: lease.documents.some((d) => d.type === 'SHARTNOMA'),
    };
  }

  async list(query: LeaseListQuery): Promise<LeaseListResult> {
    const period = query.period ? assertPeriod(query.period, 'Oy') : currentPeriod();

    const where: Prisma.LeaseWhereInput = { deletedAt: null };
    if (query.kind && KINDS.includes(query.kind as LeaseKindValue)) {
      where.kind = query.kind as LeaseKindValue;
    }
    if (query.regionCode !== undefined && Number.isInteger(query.regionCode)) {
      where.regionCode = query.regionCode;
    }
    const search = text(query.search, 100);
    if (search) {
      where.OR = [
        { number: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        { lessorName: { contains: search, mode: 'insensitive' } },
        { address: { contains: search, mode: 'insensitive' } },
        { airportName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [leases, lookups] = await Promise.all([
      this.prisma.lease.findMany({
        where,
        include: { terms: true, documents: true },
        orderBy: [{ kind: 'asc' }, { regionCode: 'asc' }, { title: 'asc' }],
      }),
      loadLookups(this.prisma),
    ]);

    const all = leases.map((lease) => this.toListItem(lease, period, lookups));

    const status = query.status ?? 'all';
    const items = all.filter((item) =>
      status === 'active'
        ? item.status === 'ACTIVE'
        : status === 'ended'
          ? item.status === 'ENDED'
          : status === 'upcoming'
            ? item.status === 'NOT_STARTED'
            : true,
    );

    const active = all.filter((i) => i.status === 'ACTIVE');
    const byKind = KINDS.map((kind) => {
      const rows = active.filter((i) => i.kind === kind);
      return {
        kind,
        count: rows.length,
        monthlyTiyin: rows.reduce((sum, i) => sum + BigInt(i.monthlyTiyin), 0n).toString(),
      };
    });

    return {
      period,
      items,
      summary: {
        total: all.length,
        active: active.length,
        ended: all.filter((i) => i.status === 'ENDED').length,
        notStarted: all.filter((i) => i.status === 'NOT_STARTED').length,
        monthlyTiyin: active.reduce((sum, i) => sum + BigInt(i.monthlyTiyin), 0n).toString(),
        withoutContract: all.filter((i) => i.status !== 'ENDED' && !i.hasContract).length,
        byKind,
      },
    };
  }

  private async findLease(id: string): Promise<LeaseWithRelations> {
    const lease = await this.prisma.lease.findFirst({
      where: { id, deletedAt: null },
      include: { terms: true, documents: true },
    });
    if (!lease) throw new NotFoundException('Ijara shartnomasi topilmadi');
    return lease;
  }

  private documentView(doc: LeaseDocument): LeaseDocumentView {
    return {
      id: doc.id,
      termId: doc.termId,
      type: doc.type as LeaseDocumentTypeValue,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  async getOne(id: string, periodInput?: string): Promise<LeaseDetail> {
    const period = periodInput ? assertPeriod(periodInput, 'Oy') : currentPeriod();
    const [lease, lookups] = await Promise.all([this.findLease(id), loadLookups(this.prisma)]);
    const base = this.toListItem(lease, period, lookups);

    const terms = [...lease.terms].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    const termViews: LeaseTermView[] = terms.map((term, index) => {
      const next = terms[index + 1];
      return {
        id: term.id,
        validFrom: term.validFrom,
        validTo: next ? previousPeriod(next.validFrom) : lease.endPeriod,
        monthlyTiyin: term.monthlyTiyin.toString(),
        note: term.note,
        createdAt: term.createdAt.toISOString(),
        documents: lease.documents
          .filter((d) => d.termId === term.id)
          .map((d) => this.documentView(d)),
      };
    });

    // Yopilgan oylar: yozilgan va hozirgi shartlar bo'yicha summa
    const [closes, accruals] = await Promise.all([
      this.prisma.leaseMonthClose.findMany({
        where: { cancelledAt: null },
        select: { period: true },
      }),
      this.prisma.leaseAccrual.findMany({
        where: { leaseId: id },
        select: { period: true, amountTiyin: true },
      }),
    ]);
    const accrued = new Map(accruals.map((a) => [a.period, a.amountTiyin]));
    const periods = [...new Set(closes.map((c) => c.period))]
      .filter((p) => accrued.has(p) || statusFor(lease, p) === 'ACTIVE')
      .sort((a, b) => b.localeCompare(a));

    let accruedTotal = 0n;
    const accrualViews: LeaseAccrualView[] = periods.map((p) => {
      const actual = accrued.get(p) ?? 0n;
      const expected = amountFor(lease, terms, p);
      accruedTotal += actual;
      return {
        period: p,
        accruedTiyin: actual.toString(),
        expectedTiyin: expected.toString(),
        changed: actual !== expected,
      };
    });

    const { documentCount: _count, hasContract: _has, ...rest } = base;
    return {
      ...rest,
      address: lease.address,
      purpose: lease.purpose,
      lessorTin: lease.lessorTin,
      lessorPhone: lease.lessorPhone,
      lessorBank: lease.lessorBank,
      paymentDay: lease.paymentDay,
      endReason: lease.endReason,
      note: lease.note,
      createdAt: lease.createdAt.toISOString(),
      updatedAt: lease.updatedAt.toISOString(),
      terms: termViews.reverse(),
      documents: lease.documents
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((d) => this.documentView(d)),
      accruals: accrualViews,
      accruedTotalTiyin: accruedTotal.toString(),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Yaratish va tahrirlash
  // ═══════════════════════════════════════════════════════════

  /** Kiritilgan maydonlarni tekshiradi; tahrirlashda — faqat berilganlari */
  async validate(
    input: LeaseInput,
    current: Lease | null,
  ): Promise<Prisma.LeaseUncheckedUpdateInput> {
    const data: Prisma.LeaseUncheckedUpdateInput = {};
    const has = (key: keyof LeaseInput) => input[key] !== undefined;

    if (has('number') || !current) {
      const value = text(input.number, 100);
      if (!value) throw new BadRequestException('Shartnoma raqamini kiriting');
      data.number = value;
    }
    if (has('title') || !current) {
      const value = text(input.title, 200);
      if (!value) throw new BadRequestException('Obyekt nomini kiriting');
      data.title = value;
    }
    if (has('lessorName') || !current) {
      const value = text(input.lessorName, 300);
      if (!value) throw new BadRequestException('Ijaraga beruvchini kiriting');
      data.lessorName = value;
    }
    if (has('contractDate')) {
      const value = text(input.contractDate, 10);
      if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new BadRequestException('Shartnoma sanasi noto\'g\'ri');
      }
      data.contractDate = value ? new Date(`${value}T00:00:00Z`) : null;
    }
    if (has('startPeriod') || !current) {
      data.startPeriod = assertPeriod(input.startPeriod, 'Boshlanish oyi');
    }

    for (const key of ['address', 'purpose', 'lessorTin', 'lessorPhone', 'lessorBank', 'note'] as const) {
      if (has(key)) data[key] = text(input[key], key === 'note' ? 2000 : 300);
    }
    if (has('lessorTin') && data.lessorTin && !/^\d{9}$|^\d{14}$/.test(String(data.lessorTin))) {
      throw new BadRequestException('STIR 9 xonali (yoki JShShIR 14 xonali) bo\'lishi kerak');
    }

    if (has('areaM2')) {
      const value = input.areaM2 === null ? null : Number(input.areaM2);
      if (value !== null && (!Number.isFinite(value) || value < 0)) {
        throw new BadRequestException('Maydon noto\'g\'ri');
      }
      data.areaM2 = value;
    }
    if (has('paymentDay')) {
      const value = input.paymentDay === null ? null : Number(input.paymentDay);
      if (value !== null && (!Number.isInteger(value) || value < 1 || value > 31)) {
        throw new BadRequestException('To\'lov kuni 1–31 oralig\'ida bo\'lishi kerak');
      }
      data.paymentDay = value;
    }
    if (has('vatIncluded')) data.vatIncluded = Boolean(input.vatIncluded);
    if (has('paymentFrequency')) {
      if (!FREQUENCIES.includes(input.paymentFrequency as LeaseFrequencyValue)) {
        throw new BadRequestException('To\'lov davriyligi noto\'g\'ri');
      }
      data.paymentFrequency = input.paymentFrequency;
    }

    // ── Joy: tur, hudud, tuman, bo'lim, aeroport ──
    const kind = (input.kind ?? current?.kind ?? 'ODDIY') as LeaseKindValue;
    if (!KINDS.includes(kind)) throw new BadRequestException('Ijara turi noto\'g\'ri');

    const regionCode = input.regionCode !== undefined ? Number(input.regionCode) : current?.regionCode;
    if (regionCode === undefined || !Number.isInteger(regionCode)) {
      throw new BadRequestException('Hududni tanlang');
    }
    const region = await this.prisma.region.findUnique({ where: { code: regionCode } });
    if (!region) throw new BadRequestException('Hudud topilmadi');

    let districtId = has('districtId') ? text(input.districtId, 20) : (current?.districtId ?? null);
    let departmentId = has('departmentId')
      ? text(input.departmentId, 50)
      : (current?.departmentId ?? null);
    let airportName = has('airportName') ? text(input.airportName, 200) : (current?.airportName ?? null);

    if (kind === 'AEROPORT') {
      if (!airportName) throw new BadRequestException('Aeroport nomini kiriting');
      districtId = null;
      departmentId = null;
    } else {
      airportName = null;
      if (regionCode === CENTRAL_REGION) {
        districtId = null;
        if (departmentId) {
          const department = await this.prisma.department.findUnique({ where: { id: departmentId } });
          if (!department) throw new BadRequestException('Bo\'lim topilmadi');
        }
      } else {
        departmentId = null;
        if (districtId) {
          const district = await this.prisma.district.findUnique({ where: { id: districtId } });
          if (!district || district.regionCode !== regionCode) {
            throw new BadRequestException('Tuman tanlangan hududga tegishli emas');
          }
        }
      }
    }

    Object.assign(data, { kind, regionCode, districtId, departmentId, airportName });
    return data;
  }

  async create(input: LeaseInput, userId: string): Promise<LeaseDetail> {
    const data = await this.validate(input ?? {}, null);
    const monthly = parseTiyin(input?.monthlyTiyin, 'Oylik summa');
    if (monthly === 0n) throw new BadRequestException('Oylik summani kiriting');

    const lease = await this.prisma.lease.create({
      data: {
        ...(data as Prisma.LeaseUncheckedCreateInput),
        createdById: userId,
        terms: {
          create: {
            validFrom: data.startPeriod as string,
            monthlyTiyin: monthly,
            note: 'Boshlang\'ich narx',
            createdById: userId,
          },
        },
      },
    });
    return this.getOne(lease.id);
  }

  async update(id: string, input: LeaseInput): Promise<LeaseDetail & ChangeImpact> {
    const lease = await this.findLease(id);
    const data = await this.validate(input ?? {}, lease);

    const terms = [...lease.terms].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    const newStart = (data.startPeriod as string | undefined) ?? lease.startPeriod;

    if (lease.endPeriod && newStart > lease.endPeriod) {
      throw new BadRequestException('Boshlanish oyi tugash oyidan keyin bo\'lishi mumkin emas');
    }
    const second = terms[1];
    if (second && newStart >= second.validFrom) {
      throw new BadRequestException(
        `Boshlanish oyi keyingi narx o'zgarishidan (${second.validFrom}) oldin bo'lishi kerak`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.lease.update({ where: { id }, data });
      // Birinchi narx har doim shartnoma boshidan amal qiladi
      const first = terms[0];
      if (first && first.validFrom !== newStart) {
        await tx.leaseTerm.update({ where: { id: first.id }, data: { validFrom: newStart } });
      }
    });

    const [detail, stalePeriods] = await Promise.all([
      this.getOne(id),
      this.months.stalePeriods([id]),
    ]);
    return { ...detail, stalePeriods };
  }

  /** O'chirish — faqat xarajatga yozilmagan shartnomalar */
  async remove(id: string): Promise<{ id: string }> {
    await this.findLease(id);
    const accrued = await this.prisma.leaseAccrual.count({ where: { leaseId: id } });
    if (accrued > 0) {
      throw new BadRequestException(
        'Bu ijara bo\'yicha xarajat yozilgan oylar bor. O\'chirish o\'rniga shartnomani tugating ' +
          '(tugash oyini belgilang) yoki avval o\'sha oylarning yopilishini bekor qiling',
      );
    }
    await this.prisma.lease.update({ where: { id }, data: { deletedAt: new Date() } });
    return { id };
  }

  // ═══════════════════════════════════════════════════════════
  // Narx o'zgarishlari
  // ═══════════════════════════════════════════════════════════

  /** Shu oydan boshlab yangi narx (o'sha oy uchun narx bo'lsa — almashtiriladi) */
  async setTerm(id: string, input: TermInput, userId: string): Promise<LeaseDetail & ChangeImpact> {
    const lease = await this.findLease(id);
    const validFrom = assertPeriod(input?.validFrom, 'Qaysi oydan');
    const monthly = parseTiyin(input?.monthlyTiyin, 'Oylik summa');

    if (validFrom < lease.startPeriod) {
      throw new BadRequestException(
        `Narx shartnoma boshlanishidan (${lease.startPeriod}) oldin o'zgara olmaydi`,
      );
    }
    if (lease.endPeriod && validFrom > lease.endPeriod) {
      throw new BadRequestException(`Shartnoma ${lease.endPeriod} oyida tugagan`);
    }

    const note = text(input?.note, 500);
    await this.prisma.leaseTerm.upsert({
      where: { leaseId_validFrom: { leaseId: id, validFrom } },
      update: { monthlyTiyin: monthly, note },
      create: { leaseId: id, validFrom, monthlyTiyin: monthly, note, createdById: userId },
    });

    const [detail, stalePeriods] = await Promise.all([
      this.getOne(id),
      this.months.stalePeriods([id]),
    ]);
    return { ...detail, stalePeriods };
  }

  async removeTerm(id: string, termId: string): Promise<LeaseDetail & ChangeImpact> {
    const lease = await this.findLease(id);
    const terms = [...lease.terms].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    const index = terms.findIndex((t) => t.id === termId);
    if (index === -1) throw new NotFoundException('Narx yozuvi topilmadi');
    if (index === 0) {
      throw new BadRequestException('Boshlang\'ich narxni o\'chirib bo\'lmaydi — uni tahrirlang');
    }

    await this.prisma.leaseTerm.delete({ where: { id: termId } });

    const [detail, stalePeriods] = await Promise.all([
      this.getOne(id),
      this.months.stalePeriods([id]),
    ]);
    return { ...detail, stalePeriods };
  }

  /** Shartnomani tugatish (endPeriod — oxirgi hisoblanadigan oy) yoki qayta tiklash (null) */
  async terminate(id: string, input: TerminateInput): Promise<LeaseDetail & ChangeImpact> {
    const lease = await this.findLease(id);

    let endPeriod: string | null = null;
    let endReason: string | null = null;
    if (input?.endPeriod !== null && input?.endPeriod !== undefined && input.endPeriod !== '') {
      endPeriod = assertPeriod(input.endPeriod, 'Tugash oyi');
      if (endPeriod < lease.startPeriod) {
        throw new BadRequestException('Tugash oyi boshlanish oyidan oldin bo\'lishi mumkin emas');
      }
      endReason = text(input.endReason, 300);
    }

    await this.prisma.lease.update({ where: { id }, data: { endPeriod, endReason } });

    const [detail, stalePeriods] = await Promise.all([
      this.getOne(id),
      this.months.stalePeriods([id]),
    ]);
    return { ...detail, stalePeriods };
  }

  // ═══════════════════════════════════════════════════════════
  // Hujjatlar
  // ═══════════════════════════════════════════════════════════

  async addDocument(
    id: string,
    file: Express.Multer.File | undefined,
    options: { type?: string; termId?: string },
    userId: string,
  ): Promise<LeaseDocumentView> {
    const lease = await this.findLease(id);
    if (!file?.buffer?.length) throw new BadRequestException('Fayl tanlanmagan');
    if (file.size > MAX_DOCUMENT_SIZE) throw new BadRequestException('Fayl hajmi 25 MB dan oshmasin');

    const extension = ALLOWED_DOCUMENT_TYPES[file.mimetype];
    if (!extension) {
      throw new BadRequestException('Faqat PDF, rasm (JPG, PNG), Word yoki Excel fayl yuklash mumkin');
    }

    const type = (options.type ?? 'SHARTNOMA') as LeaseDocumentTypeValue;
    if (!DOCUMENT_TYPES.includes(type)) throw new BadRequestException('Hujjat turi noto\'g\'ri');

    const termId = text(options.termId, 50);
    if (termId && !lease.terms.some((t) => t.id === termId)) {
      throw new BadRequestException('Narx yozuvi topilmadi');
    }

    const storedName = `${randomUUID()}${extension}`;
    const folder = join(this.storageRoot, lease.id);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, storedName), file.buffer);

    try {
      const doc = await this.prisma.leaseDocument.create({
        data: {
          leaseId: lease.id,
          termId,
          type,
          fileName: fixFileName(file.originalname).slice(0, 255),
          storedName,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          uploadedById: userId,
        },
      });
      return this.documentView(doc);
    } catch (error) {
      await unlink(join(folder, storedName)).catch(() => undefined);
      throw error;
    }
  }

  async documentFile(
    docId: string,
  ): Promise<{ stream: ReadStream; fileName: string; mimeType: string; size: number }> {
    const doc = await this.prisma.leaseDocument.findUnique({ where: { id: docId } });
    if (!doc) throw new NotFoundException('Hujjat topilmadi');

    const path = join(this.storageRoot, doc.leaseId, doc.storedName);
    if (!existsSync(path)) {
      throw new NotFoundException('Fayl serverda topilmadi (zaxiradan tiklash kerak bo\'lishi mumkin)');
    }
    return {
      stream: createReadStream(path),
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      size: doc.sizeBytes,
    };
  }

  async removeDocument(docId: string): Promise<{ id: string }> {
    const doc = await this.prisma.leaseDocument.findUnique({ where: { id: docId } });
    if (!doc) throw new NotFoundException('Hujjat topilmadi');

    await this.prisma.leaseDocument.delete({ where: { id: docId } });
    await unlink(join(this.storageRoot, doc.leaseId, doc.storedName)).catch(() => undefined);
    return { id: docId };
  }
}
