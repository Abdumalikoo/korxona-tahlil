import { BadRequestException, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PayrollService } from '../payroll/payroll.service';
import { PrismaService } from '../prisma/prisma.service';
import { bounds, parseDay, trendMonths } from '../structure/structure.engine';
import { ALWAYS_CENTER, ASSET_GROUP_CODES, ensureCenterCategories, expandCategories, PAYROLL_CENTER_CATEGORY, PAYROLL_CENTER_OTHER, POLICY_KEY, readPolicy, writePolicy } from './policy.util';

const TASHKENT_MS = 5 * 3600_000;
const MAX_DAYS = 3 * 366;

/** Tavsiya etilgan moddalar: «Hudud xodimlari uchun (Markaz hisobidan)» guruhi */
export const RECOMMENDED_PARENT = { code: 'HM_HUDUD', label: 'Hudud xodimlari uchun (Markaz hisobidan)' };
export const RECOMMENDED: { code: string; label: string }[] = [
  { code: 'HM_BAYRAM', label: 'Bayram pullari' },
  { code: 'HM_CHORAK', label: 'Choraklik mukofot' },
  { code: 'HM_SAFAR', label: 'Xizmat safari (komandirovka)' },
  { code: 'HM_INTERNET', label: "Internet to'lovlari" },
  { code: 'HM_ALOQA', label: 'Mobil aloqa' },
  { code: 'HM_BOSHQA', label: "Boshqa qo'shimchalar" },
  { code: PAYROLL_CENTER_OTHER.code, label: PAYROLL_CENTER_OTHER.label },
];

export interface PolicyCategory {
  code: string;
  label: string;
  parentCode: string | null;
  isLeaf: boolean;
  isActive: boolean;
  /** Siyosatda to'g'ridan-to'g'ri belgilangan */
  selected: boolean;
  /** Ota moddasi orqali Markaz hisobida */
  inherited: boolean;
  /** Har doim Markaz hisobida (ish haqi qo'shimchalari, asosiy vositalar sarfi, Markaz hisobidagi soliqlar) — bu yerda o'zgartirib bo'lmaydi */
  locked: boolean;
  /** Nima uchun o'zgartirib bo'lmaydi */
  lockedReason?: string;
}

/** Modda bo'yicha davrdagi xarajat: qayerda yozilgani */
export interface CategoryAmount {
  code: string;
  /** Hududlarda yozilgan (hudud kodi > 0) */
  regionTiyin: string;
  /** Markazda yozilgan (hudud 0 yoki Markaz bo'limi) */
  centerTiyin: string;
  /** Hudud ham, bo'lim ham ko'rsatilmagan */
  noneTiyin: string;
  count: number;
}

/** Ish haqi komponenti (tarkib) — Markazga o'tadimi */
export interface PayrollComponentOption {
  code: string;
  name: string;
  categoryLabel: string;
  selected: boolean;
  /** Qaysi Markaz moddasiga yoziladi */
  target: string;
}

export interface CenterGroupPart {
  key: string;
  label: string;
  amountTiyin: string;
}

export interface CenterSummary {
  range: { from: string; to: string };
  months: string[];
  /** Markaz jami xarajati = joriy (o'ziniki + hududlar uchun) + asosiy vositalar sarfi */
  totalTiyin: string;
  ownTiyin: string;
  regionalTiyin: string;
  /** 2-guruh: asosiy vositalar sarfi (eskirish) — xarid balansda, xarajatga faqat sarf */
  assetsTiyin: string;
  ownParts: CenterGroupPart[];
  regionalParts: CenterGroupPart[];
  /** Hududlar uchun xarajat — qaysi hudud uchun (0/null — ko'rsatilmagan, Markazda yozilgan) */
  byRegion: { code: number | null; name: string; amountTiyin: string }[];
  ownTrend: string[];
  regionalTrend: string[];
  assetsTrend: string[];
  /** Siyosatda nechta modda belgilangan */
  policyCount: number;
}

function monthOf(date: Date): string {
  return new Date(date.getTime() + TASHKENT_MS).toISOString().slice(0, 7);
}

@Injectable()
export class ExpensePolicyService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ExpensePolicyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payroll: PayrollService,
  ) {}

  /**
   * Bir marta (yangilanishdan keyin): hamma oylar ish haqi qayta hisoblanadi — hudud xodimlariga sof oylik,
   * bayram va choraklik pullar Markaz hisobiga. Bajarilgani «settings»da belgilanadi.
   */
  onApplicationBootstrap(): void {
    setTimeout(() => {
      void (async () => {
        const KEY = 'payroll.center.applied';
        if (await this.prisma.setting.findUnique({ where: { key: KEY } })) return;
        const report = await this.payroll.regroupAll();
        await this.prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: { at: new Date().toISOString(), ...report } }, update: { value: { at: new Date().toISOString(), ...report } } });
        this.logger.log(`Ish haqi qayta hisoblandi: ${report.periods} oy, ${report.changedBatches} vedomost; Markazga o'tgan qism ${report.centerTiyin} tiyin`);
      })().catch((e: unknown) => this.logger.warn(`Ish haqi qayta hisoblanmadi: ${(e as Error).message}`));
    }, 8_000);
  }

  async get(): Promise<{ categories: PolicyCategory[]; centerCategories: string[]; excludeCategories: string[]; recommended: { parent: typeof RECOMMENDED_PARENT; items: typeof RECOMMENDED; missing: number }; payrollComponents: PayrollComponentOption[] }> {
    await ensureCenterCategories(this.prisma).catch(() => null);
    const [policy, cats, components] = await Promise.all([
      readPolicy(this.prisma),
      this.prisma.category.findMany({ select: { code: true, label: true, parentCode: true, isLeaf: true, isActive: true, order: true }, orderBy: [{ order: 'asc' }, { label: 'asc' }] }),
      this.prisma.salaryComponent.findMany({ where: { isActive: true, sign: { gt: 0 } }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }], select: { code: true, name: true, category: true } }),
    ]);
    const known = new Set(cats.map((c) => c.code));
    // Tanlanganlar — foydalanuvchi belgilagani; har doimgilar (ish haqi qo'shimchalari, AV sarfi) — «locked»
    const selected = new Set(policy.chosenCategories.filter((c) => known.has(c)));
    const excluded = policy.excludedCategories.filter((c) => known.has(c));
    const all = expandCategories([...selected, ...ALWAYS_CENTER, ...excluded.map((c) => `!${c}`)], cats);
    const missing = [RECOMMENDED_PARENT, ...RECOMMENDED].filter((r) => !known.has(r.code)).length;
    const catLabel = new Map(cats.map((c) => [c.code, c.label]));
    const CATEGORY_LABEL: Record<string, string> = { ASOSIY: 'Asosiy ish haqi', TATIL: "Ta'til va kasallik", PREMIYA: 'Premiyalar', KOMPENSATSIYA: 'Kompensatsiyalar', USTAMA: 'Ustamalar', BOSHQA: 'Boshqa' };
    // Soliqlar sahifasida «Markaz hisobidan» belgilangan soliq turlari — shu yerda ham qulflangan
    const taxLocked = new Set(policy.centerCategories.filter((c) => c.startsWith('SOLIQ_') && !ALWAYS_CENTER.includes(c) && !policy.chosenCategories.includes(c)));
    const lockedReason = (code: string): string | undefined =>
      ALWAYS_CENTER.includes(code)
        ? ASSET_GROUP_CODES.includes(code)
          ? 'Asosiy vositalar — har doim Markaz hisobidan'
          : "Ish haqi qo'shimchasi — pastdagi «Ish haqi» bo'limida boshqariladi"
        : taxLocked.has(code)
          ? 'Soliqlar sahifasida «Markaz hisobidan» belgilangan'
          : undefined;
    return {
      categories: cats.map((c) => {
        const reason = lockedReason(c.code);
        return { code: c.code, label: c.label, parentCode: c.parentCode, isLeaf: c.isLeaf, isActive: c.isActive, selected: selected.has(c.code), inherited: !selected.has(c.code) && (all.has(c.code) || taxLocked.has(c.code)), locked: Boolean(reason), ...(reason ? { lockedReason: reason } : {}) };
      }),
      centerCategories: [...selected],
      excludeCategories: excluded,
      recommended: { parent: RECOMMENDED_PARENT, items: RECOMMENDED, missing },
      payrollComponents: components.map((c) => {
        const target = PAYROLL_CENTER_CATEGORY[c.code]?.code ?? PAYROLL_CENTER_OTHER.code;
        return { code: c.code, name: c.name, categoryLabel: CATEGORY_LABEL[c.category] ?? c.category, selected: policy.payrollComponents.includes(c.code), target: catLabel.get(target) ?? target };
      }),
    };
  }

  /** Ish haqi komponentlari: Markazga o'tadiganlar */
  async savePayroll(input: unknown, userId: string) {
    if (!Array.isArray(input)) throw new BadRequestException("Komponentlar ro'yxati kerak");
    const codes = [...new Set(input.filter((c): c is string => typeof c === 'string' && c.length > 0 && c.length <= 64))];
    const known = new Set((await this.prisma.salaryComponent.findMany({ where: { code: { in: codes } }, select: { code: true } })).map((c) => c.code));
    const unknown = codes.filter((c) => !known.has(c));
    if (unknown.length) throw new BadRequestException(`Komponent topilmadi: ${unknown.slice(0, 5).join(', ')}`);
    const before = await readPolicy(this.prisma);
    await writePolicy(this.prisma, { payrollComponents: codes });
    await this.audit.log({
      userId,
      action: 'UPDATE',
      entity: 'expense_policy',
      entityId: 'payroll',
      summary: `Xarajatlar siyosati: ish haqidan Markazga o'tadigan komponentlar — ${before.payrollComponents.join(', ') || "yo'q"} → ${codes.join(', ') || "yo'q"}`,
    });
    const report = await this.payroll.regroupAll();
    return { policy: await this.get(), report };
  }

  async recompute(userId: string) {
    const report = await this.payroll.regroupAll();
    await this.audit.log({ userId, action: 'UPDATE', entity: 'expense_policy', entityId: 'payroll', summary: `Ish haqi qayta hisoblandi: ${report.periods} oy, ${report.changedBatches} vedomost o'zgardi` });
    return report;
  }

  async save(codesInput: unknown, userId: string, excludeInput?: unknown) {
    if (!Array.isArray(codesInput)) throw new BadRequestException("Moddalar ro'yxati kerak");
    if (excludeInput !== undefined && !Array.isArray(excludeInput)) throw new BadRequestException("Istisnolar ro'yxati noto'g'ri");
    const clean = (list: unknown[]) => [...new Set(list.filter((c): c is string => typeof c === 'string' && c.length > 0 && c.length <= 64))];
    const codes = clean(codesInput);
    const excludes = clean((excludeInput as unknown[] | undefined) ?? []).filter((c) => !codes.includes(c));
    const known = new Set((await this.prisma.category.findMany({ where: { code: { in: [...codes, ...excludes] } }, select: { code: true } })).map((c) => c.code));
    const unknown = [...codes, ...excludes].filter((c) => !known.has(c));
    if (unknown.length) throw new BadRequestException(`Modda topilmadi: ${unknown.slice(0, 5).join(', ')}`);
    const before = await readPolicy(this.prisma);
    await writePolicy(this.prisma, { centerCategories: codes, excludeCategories: excludes });
    await this.audit.log({
      userId,
      action: 'UPDATE',
      entity: 'expense_policy',
      entityId: POLICY_KEY,
      summary: `Xarajatlar siyosati: Markaz hisobidagi moddalar ${before.chosenCategories.length} → ${codes.filter((c) => !ALWAYS_CENTER.includes(c)).length}${excludes.length ? `, hududda qoldirilgan ichki moddalar: ${excludes.length}` : ''}`,
    });
    return this.get();
  }

  /** Tavsiya etilgan moddalarni yaratadi (borlariga tegmaydi) va ota moddani siyosatga qo'shadi */
  async seed(userId: string) {
    const exists = new Set((await this.prisma.category.findMany({ where: { code: { in: [RECOMMENDED_PARENT.code, ...RECOMMENDED.map((r) => r.code)] } }, select: { code: true } })).map((c) => c.code));
    let created = 0;
    if (!exists.has(RECOMMENDED_PARENT.code)) {
      await this.prisma.category.create({ data: { code: RECOMMENDED_PARENT.code, label: RECOMMENDED_PARENT.label, isLeaf: false, isActive: true, order: 800 } });
      created += 1;
    }
    for (const [i, r] of RECOMMENDED.entries()) {
      if (exists.has(r.code)) continue;
      await this.prisma.category.create({ data: { code: r.code, label: r.label, parentCode: RECOMMENDED_PARENT.code, isLeaf: true, isActive: true, order: 801 + i } });
      created += 1;
    }
    const policy = await readPolicy(this.prisma);
    if (!policy.chosenCategories.includes(RECOMMENDED_PARENT.code)) {
      await writePolicy(this.prisma, { centerCategories: [...policy.chosenCategories, RECOMMENDED_PARENT.code] });
    }
    await this.audit.log({ userId, action: 'CREATE', entity: 'expense_policy', entityId: RECOMMENDED_PARENT.code, summary: `Xarajatlar siyosati: tavsiya etilgan moddalar qo'shildi (${created} ta yangi)` });
    return { created, policy: await this.get() };
  }

  /**
   * Har bir modda bo'yicha davrdagi xarajat — qayerda yozilgani (hududlarda / Markazda / ko'rsatilmagan).
   * Siyosat sahifasida: modda Markazga o'tkazilsa, hududlarda yozilgan qismi Markaz xarajatiga o'tadi.
   */
  async amounts(from?: string, to?: string): Promise<{ range: { from: string; to: string }; rows: CategoryAmount[] }> {
    const today = new Date(Date.now() + TASHKENT_MS).toISOString().slice(0, 10);
    const range = { from: from || `${today.slice(0, 4)}-01-01`, to: to || today };
    const a = parseDay(range.from);
    const b = parseDay(range.to);
    if (a === null || b === null) throw new BadRequestException("Sana noto'g'ri (YYYY-MM-DD)");
    if (a > b) throw new BadRequestException('Boshlanish sanasi tugash sanasidan keyin');
    if ((b - a) / 86_400_000 > MAX_DAYS) throw new BadRequestException('Davr 3 yildan oshmasin');
    const { start, end } = bounds(range);
    const groups = await this.prisma.expense.groupBy({
      by: ['categoryCode', 'regionCode', 'departmentId'],
      where: { deletedAt: null, date: { gte: start, lt: end } },
      _sum: { amountTiyin: true },
      _count: { _all: true },
    });
    const map = new Map<string, { region: bigint; center: bigint; none: bigint; count: number }>();
    for (const g of groups) {
      const r = map.get(g.categoryCode) ?? { region: 0n, center: 0n, none: 0n, count: 0 };
      const v = g._sum.amountTiyin ?? 0n;
      if (g.regionCode !== null && g.regionCode !== 0) r.region += v;
      else if (g.regionCode === 0 || g.departmentId) r.center += v;
      else r.none += v;
      r.count += g._count._all;
      map.set(g.categoryCode, r);
    }
    return {
      range,
      rows: [...map.entries()].map(([code, r]) => ({ code, regionTiyin: r.region.toString(), centerTiyin: r.center.toString(), noneTiyin: r.none.toString(), count: r.count })),
    };
  }

  /** Markaz xarajati: o'ziniki va hududlar uchun (siyosat bo'yicha) */
  async summary(from?: string, to?: string): Promise<CenterSummary> {
    const today = new Date(Date.now() + TASHKENT_MS).toISOString().slice(0, 10);
    const range = { from: from || `${today.slice(0, 4)}-01-01`, to: to || today };
    const a = parseDay(range.from);
    const b = parseDay(range.to);
    if (a === null || b === null) throw new BadRequestException("Sana noto'g'ri (YYYY-MM-DD)");
    if (a > b) throw new BadRequestException('Boshlanish sanasi tugash sanasidan keyin');
    if ((b - a) / 86_400_000 > MAX_DAYS) throw new BadRequestException('Davr 3 yildan oshmasin');
    const { start, end } = bounds(range);
    const months = trendMonths(range, 12);
    const monthIndex = new Map(months.map((p, i) => [p, i]));

    const [policy, cats, regions] = await Promise.all([
      readPolicy(this.prisma),
      this.prisma.category.findMany({ select: { code: true, label: true, parentCode: true } }),
      this.prisma.region.findMany({ select: { code: true, name: true } }),
    ]);
    const center = expandCategories(policy.centerCategories, cats);
    const label = new Map(cats.map((c) => [c.code, c.label]));
    const parent = new Map(cats.map((c) => [c.code, c.parentCode]));
    const regionName = new Map(regions.map((r) => [r.code, r.name]));

    const rows = await this.prisma.expense.findMany({
      where: {
        deletedAt: null,
        date: { gte: start, lt: end },
        OR: [{ regionCode: 0 }, { regionCode: null, departmentId: { not: null } }, ...(center.size ? [{ categoryCode: { in: [...center] } }] : [])],
      },
      select: { date: true, amountTiyin: true, categoryCode: true, regionCode: true, departmentId: true, source: true },
    });

    let own = 0n;
    let regional = 0n;
    let assets = 0n;
    const assetsTrend = months.map(() => 0n);
    const ownParts = new Map<string, { label: string; amount: bigint }>();
    const regParts = new Map<string, { label: string; amount: bigint }>();
    const byRegion = new Map<string, { code: number | null; name: string; amount: bigint }>();
    const ownTrend = months.map(() => 0n);
    const regTrend = months.map(() => 0n);
    const add = (m: Map<string, { label: string; amount: bigint }>, key: string, lbl: string, v: bigint) => {
      const p = m.get(key) ?? { label: lbl, amount: 0n };
      p.amount += v;
      m.set(key, p);
    };
    for (const r of rows) {
      const top = parent.get(r.categoryCode) ?? r.categoryCode;
      const mi = monthIndex.get(monthOf(r.date));
      if (ASSET_GROUP_CODES.includes(r.categoryCode)) {
        // 2-guruh: asosiy vositalar sarfi va xarajatga o'tkazilganlar
        assets += r.amountTiyin;
        if (mi !== undefined) assetsTrend[mi]! += r.amountTiyin;
      } else if (center.has(r.categoryCode)) {
        regional += r.amountTiyin;
        // Siyosat guruhida — aniq modda nomi (bayram puli, komandirovka …)
        add(regParts, r.categoryCode, label.get(r.categoryCode) ?? r.categoryCode, r.amountTiyin);
        const code = r.regionCode && r.regionCode !== 0 ? r.regionCode : null;
        const key = code === null ? '-' : String(code);
        const g = byRegion.get(key) ?? { code, name: code === null ? "Hudud ko'rsatilmagan (Markazda yozilgan)" : (regionName.get(code) ?? `Hudud ${code}`), amount: 0n };
        g.amount += r.amountTiyin;
        byRegion.set(key, g);
        if (mi !== undefined) regTrend[mi]! += r.amountTiyin;
      } else {
        own += r.amountTiyin;
        const [key, lbl] = r.source === 'PAYROLL' ? ['PAYROLL', 'Ish haqi'] : r.source === 'LEASE' ? ['LEASE', 'Ijara'] : r.source === 'VEHICLE' ? ['VEHICLE', 'Mashinalar'] : [`c:${top}`, label.get(top) ?? top];
        add(ownParts, key, lbl, r.amountTiyin);
        if (mi !== undefined) ownTrend[mi]! += r.amountTiyin;
      }
    }
    const parts = (m: Map<string, { label: string; amount: bigint }>) =>
      [...m.entries()].sort((x, y) => (y[1].amount > x[1].amount ? 1 : -1)).map(([key, p]) => ({ key, label: p.label, amountTiyin: p.amount.toString() }));
    return {
      range,
      months,
      totalTiyin: (own + regional + assets).toString(),
      ownTiyin: own.toString(),
      regionalTiyin: regional.toString(),
      assetsTiyin: assets.toString(),
      ownParts: parts(ownParts),
      regionalParts: parts(regParts),
      byRegion: [...byRegion.values()].sort((x, y) => (y.amount > x.amount ? 1 : -1)).map((g) => ({ code: g.code, name: g.name, amountTiyin: g.amount.toString() })),
      ownTrend: ownTrend.map(String),
      regionalTrend: regTrend.map(String),
      assetsTrend: assetsTrend.map(String),
      policyCount: policy.chosenCategories.length,
    };
  }
}