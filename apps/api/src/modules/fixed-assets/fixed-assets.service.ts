import { BadRequestException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { FixedAsset } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { ASSET_CHARGE_CATEGORY, ASSET_EXPENSE_CATEGORY, ASSET_INVENTORY_CATEGORY, ensureCenterCategories, expandCategories } from '../expense-policy/policy.util';
import { PrismaService } from '../prisma/prisma.service';
import { addMonths, bookValue, chargeSchedule, monthsBetween, periodOf, periodStartDate, TASHKENT_MS } from './fixed-assets.util';

// ═══════════════════════════════════════════════════════════
// Asosiy vositalar (balans).
//
// Asosiy vosita xaridi xarajatga birdaniga yozilmaydi — balansda turadi, har oy sarfi (eskirish) xarajatga o'tadi
// (modda: AV_SARF, Markaz hisobidan — Markaz xarajatining 2-guruhi «Asosiy vositalar»).
// Qaysilari asosiy vosita:
//   • Ombor › Kirimda «asosiy vosita» deb kiritilganlar (har donasi, inventar raqami bilan);
//   • siyosatda belgilangan xarajat moddalari (masalan «Asosiy vositalar xaridi») — qayerda kiritilsa ham;
//   • qo'lda kiritilgan (boshlang'ich qoldiq: bino, mashina …).
// Xarid xarajati yozuvi o'chirilgan holda saqlanadi (balansga o'tkazilgan) — «Xarajat qilib qoldirish» bilan qaytadi.
// Sarf yozuvlari (source = ASSET) har safar shu reestrdan qayta hisoblanadi — qo'lda tahrirlanmaydi.
//
// Rejimlar (har vosita uchun):
//   BALANCE — balansda, har oy sarfi (eskirish) xarajatga;
//   HOLD    — faqat balansda: xarajatga hech narsa yozilmaydi (masalan, xodimlarga berilgan inventar);
//   EXPENSE — xarajatga o'tkazilgan: qiymati xarid oyida to'liq xarajat (Excel'dan / qo'lda kiritilganlar — Markaz hisobidan,
//             modda «Asosiy vositalar (xarajatga o'tkazilgan)»; xarajatdan olinganlar — asl xarajat yozuvi qaytadi).
// Siyosat «settings» jadvalida (kalit: asset.policy).
// ═══════════════════════════════════════════════════════════

export const ASSET_POLICY_KEY = 'asset.policy';
const CENTRAL_REGION = 0;
const MAX_LIFE = 600;

/** Standart xizmat muddatlari (oy) — moddaga qarab; qolganlari — umumiy muddat */
export const DEFAULT_LIFE: Record<string, number> = {
  WH_COMPUTER: 36,
  WH_FURNITURE: 84,
};
export const DEFAULT_LIFE_MONTHS = 60;

export type AssetMode = 'BALANCE' | 'HOLD' | 'EXPENSE';
export const ASSET_MODES: AssetMode[] = ['BALANCE', 'HOLD', 'EXPENSE'];
export const MODE_LABEL: Record<AssetMode, string> = {
  BALANCE: 'Balansda, eskirish bilan',
  HOLD: 'Balansda (xarajatsiz)',
  EXPENSE: "Xarajatga o'tkazilgan",
};

export interface AssetPolicy {
  /** Asosiy vosita moddalari (ota modda belgilansa — ichkilari ham) */
  capitalCategories: string[];
  /** Modda → xizmat muddati, oy */
  life: Record<string, number>;
  /** Umumiy xizmat muddati, oy */
  defaultLife: number;
}

export interface AssetView {
  id: string;
  name: string;
  inventoryNo: string | null;
  categoryCode: string;
  categoryLabel: string;
  source: string;
  sourceLabel: string;
  mode: string;
  place: string;
  regionCode: number | null;
  departmentId: string | null;
  costTiyin: string;
  acquiredAt: string;
  lifeMonths: number;
  lifeOverridden: boolean;
  monthlyTiyin: string;
  accumulatedTiyin: string;
  residualTiyin: string;
  /** Sarf tugaydigan oy */
  endPeriod: string;
  /** Holat: active — sarf ketmoqda, done — to'liq sarflangan, disposed — hisobdan chiqarilgan, expense — xarajat sifatida, hold — balansda (xarajatsiz) */
  status: 'active' | 'done' | 'disposed' | 'expense' | 'hold';
  modeLabel: string;
  holderName: string | null;
  placeText: string | null;
  quantity: number;
  importBatch: string | null;
  disposedAt: string | null;
  disposeReason: string | null;
  note: string | null;
  expenseId: string | null;
  assetId: string | null;
}

export interface AssetsSummary {
  range: { from: string; to: string };
  count: number;
  /** Balansdagi (sarf ketayotgan va to'liq sarflangan) vositalar boshlang'ich qiymati */
  costTiyin: string;
  accumulatedTiyin: string;
  residualTiyin: string;
  /** Davr ichida: sarf (xarajatga o'tgan), xarid (balansga kirgan), hisobdan chiqarilgan qoldiq */
  chargeTiyin: string;
  acquiredTiyin: string;
  acquiredCount: number;
  disposedTiyin: string;
  months: string[];
  chargeTrend: string[];
  byCategory: { code: string; label: string; count: number; costTiyin: string; residualTiyin: string; chargeTiyin: string }[];
  /** Xarajat sifatida qoldirilganlar */
  expensedCount: number;
  expensedTiyin: string;
  /** Faqat balansda (xarajatsiz) turganlar */
  holdCount: number;
  holdTiyin: string;
  lastSyncAt: string | null;
}

const SOURCE_LABEL: Record<string, string> = {
  WAREHOUSE: 'Ombor kirimi',
  EXPENSE: 'Xarajatdan (asosiy vosita moddasi)',
  MANUAL: "Qo'lda (boshlang'ich qoldiq)",
  IMPORT: "Excel'dan yuklangan",
};

/** Xarajatga o'tkazilganda o'zining xarajat yozuvi yaratiladigan manbalar */
const OWN_EXPENSE_SOURCES = ['IMPORT', 'MANUAL'];

function todayPeriod(): string {
  return new Date(Date.now() + TASHKENT_MS).toISOString().slice(0, 7);
}

function parseDay(text: string | undefined): Date | null {
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const d = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getTime() - TASHKENT_MS);
}

function toTiyin(v: unknown): bigint | null {
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return BigInt(v.trim());
  if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.round(v));
  if (typeof v === 'bigint') return v;
  return null;
}

@Injectable()
export class FixedAssetsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FixedAssetsService.name);
  private running: Promise<SyncReport> | null = null;
  private again = false;
  private kickTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSyncAt: Date | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    // Server ishga tushganda — bir marta (bloklamaydi)
    setTimeout(() => void this.sync().catch((e: unknown) => this.logger.warn(`Asosiy vositalar: ${(e as Error).message}`)), 5_000);
  }

  /** Har 10 daqiqada: yangi asosiy vosita xaridlari balansga, oy almashganda — yangi oy sarfi */
  @Interval(10 * 60_000)
  async tick(): Promise<void> {
    await this.sync().catch((e: unknown) => this.logger.warn(`Asosiy vositalar: ${(e as Error).message}`));
  }

  /** Xarajat kiritilganda chaqiriladi — 2 soniyadan keyin bir marta sinxronlaydi */
  kick(): void {
    if (this.kickTimer) clearTimeout(this.kickTimer);
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null;
      void this.sync().catch((e: unknown) => this.logger.warn(`Asosiy vositalar: ${(e as Error).message}`));
    }, 2_000);
  }

  // ═══════════ Siyosat ═══════════

  async policy(): Promise<AssetPolicy> {
    const row = await this.prisma.setting.findUnique({ where: { key: ASSET_POLICY_KEY } });
    const v = (row?.value ?? {}) as Partial<{ capitalCategories: unknown; life: unknown; defaultLife: unknown }>;
    const life: Record<string, number> = { ...DEFAULT_LIFE };
    if (v.life && typeof v.life === 'object') {
      for (const [k, n] of Object.entries(v.life as Record<string, unknown>)) {
        const m = Number(n);
        if (Number.isInteger(m) && m >= 1 && m <= MAX_LIFE) life[k] = m;
      }
    }
    const def = Number(v.defaultLife);
    return {
      capitalCategories: Array.isArray(v.capitalCategories) ? v.capitalCategories.filter((c): c is string => typeof c === 'string') : [],
      life,
      defaultLife: Number.isInteger(def) && def >= 1 && def <= MAX_LIFE ? def : DEFAULT_LIFE_MONTHS,
    };
  }

  async policyView() {
    const [policy, cats] = await Promise.all([
      this.policy(),
      this.prisma.category.findMany({ where: { isActive: true }, select: { code: true, label: true, parentCode: true, isLeaf: true, order: true }, orderBy: [{ order: 'asc' }, { label: 'asc' }] }),
    ]);
    const capital = expandCategories(policy.capitalCategories, cats);
    return {
      ...policy,
      categories: cats
        .filter((c) => c.code !== ASSET_CHARGE_CATEGORY.code && c.code !== ASSET_EXPENSE_CATEGORY.code)
        .map((c) => ({ code: c.code, label: c.label, parentCode: c.parentCode, isLeaf: c.isLeaf, selected: policy.capitalCategories.includes(c.code), inherited: !policy.capitalCategories.includes(c.code) && capital.has(c.code), lifeMonths: this.lifeFor(c.code, policy, cats) })),
    };
  }

  async savePolicy(input: unknown, userId: string) {
    const x = (input ?? {}) as Record<string, unknown>;
    const before = await this.policy();
    const cats = await this.prisma.category.findMany({ select: { code: true } });
    const known = new Set(cats.map((c) => c.code));
    const capital = Array.isArray(x.capitalCategories)
      ? [...new Set(x.capitalCategories.filter((c): c is string => typeof c === 'string' && known.has(c) && c !== ASSET_CHARGE_CATEGORY.code))]
      : before.capitalCategories;
    const life: Record<string, number> = {};
    const src = x.life && typeof x.life === 'object' ? (x.life as Record<string, unknown>) : before.life;
    for (const [k, n] of Object.entries(src)) {
      const m = Number(n);
      if (!known.has(k)) continue;
      if (!Number.isInteger(m) || m < 1 || m > MAX_LIFE) throw new BadRequestException(`Xizmat muddati 1–${MAX_LIFE} oy bo'lsin (${k})`);
      life[k] = m;
    }
    const def = x.defaultLife === undefined ? before.defaultLife : Number(x.defaultLife);
    if (!Number.isInteger(def) || def < 1 || def > MAX_LIFE) throw new BadRequestException(`Umumiy xizmat muddati 1–${MAX_LIFE} oy bo'lsin`);
    const value = { capitalCategories: capital, life, defaultLife: def };
    await this.prisma.setting.upsert({ where: { key: ASSET_POLICY_KEY }, create: { key: ASSET_POLICY_KEY, value }, update: { value } });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'asset_policy', entityId: ASSET_POLICY_KEY, summary: `Asosiy vositalar siyosati: moddalar ${before.capitalCategories.length} → ${capital.length}, umumiy muddat ${def} oy` });
    // Muddat o'zgarsa — qo'lda o'zgartirilmagan vositalarga ham qo'llanadi
    const report = await this.sync({ applyLife: true });
    return { policy: await this.policyView(), report };
  }

  /** Moddaning xizmat muddati: o'zi yoki ota moddasi bo'yicha, bo'lmasa umumiy */
  lifeFor(code: string, policy: AssetPolicy, cats: { code: string; parentCode: string | null }[]): number {
    const parent = new Map(cats.map((c) => [c.code, c.parentCode]));
    let cur: string | null | undefined = code;
    for (let depth = 0; cur && depth < 20; depth += 1) {
      if (policy.life[cur]) return policy.life[cur]!;
      cur = parent.get(cur);
    }
    return policy.defaultLife;
  }

  // ═══════════ Sinxronlash ═══════════

  /** Bir vaqtda bitta; davomida yana chaqirilsa — tugagach yana bir marta */
  async sync(opts: { applyLife?: boolean } = {}): Promise<SyncReport> {
    if (this.running) {
      this.again = true;
      if (opts.applyLife) await this.running.catch(() => null);
      else return this.running;
    }
    const run = (async () => {
      let report = await this.syncOnce(opts);
      while (this.again) {
        this.again = false;
        report = await this.syncOnce({});
      }
      return report;
    })();
    this.running = run;
    try {
      return await run;
    } finally {
      this.running = null;
    }
  }

  private async systemUserId(): Promise<string | null> {
    const admin = await this.prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (admin) return admin.id;
    return (await this.prisma.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id ?? null;
  }

  private async syncOnce(opts: { applyLife?: boolean }): Promise<SyncReport> {
    const report: SyncReport = { captured: 0, capturedTiyin: '0', updated: 0, periods: 0, chargeRows: 0 };
    await ensureCenterCategories(this.prisma);
    const [policy, cats] = await Promise.all([this.policy(), this.prisma.category.findMany({ select: { code: true, parentCode: true } })]);
    const capital = expandCategories(policy.capitalCategories, cats);
    capital.delete(ASSET_CHARGE_CATEGORY.code);
    capital.delete(ASSET_EXPENSE_CATEGORY.code);
    capital.delete(ASSET_INVENTORY_CATEGORY.code);
    const userId = await this.systemUserId();
    let capturedTiyin = 0n;
    const now = new Date();

    // ── 1. Ombor asosiy vositalari (har donasi) ──
    const linkedAssets = new Set((await this.prisma.fixedAsset.findMany({ where: { assetId: { not: null } }, select: { assetId: true } })).map((a) => a.assetId!));
    const newAssets = await this.prisma.asset.findMany({
      where: { id: { notIn: [...linkedAssets] } },
      select: { id: true, name: true, inventoryNo: true, priceTiyin: true, acquiredAt: true, receiptLineId: true, regionCode: true, departmentId: true, status: true, item: { select: { categoryCode: true } } },
      take: 5000,
    });
    if (newAssets.length) {
      const lineIds = [...new Set(newAssets.map((a) => a.receiptLineId).filter((x): x is string => Boolean(x)))];
      const lines = lineIds.length ? await this.prisma.stockLine.findMany({ where: { id: { in: lineIds } }, select: { id: true, expenseId: true } }) : [];
      const expenseOfLine = new Map(lines.map((l) => [l.id, l.expenseId]));
      for (const a of newAssets) {
        await this.prisma.fixedAsset.create({
          data: {
            name: a.name,
            inventoryNo: a.inventoryNo,
            categoryCode: a.item.categoryCode,
            costTiyin: a.priceTiyin,
            acquiredAt: a.acquiredAt,
            lifeMonths: this.lifeFor(a.item.categoryCode, policy, cats),
            regionCode: a.status === 'IN_USE' ? a.regionCode : null,
            departmentId: a.status === 'IN_USE' ? a.departmentId : null,
            source: 'WAREHOUSE',
            assetId: a.id,
            expenseId: a.receiptLineId ? (expenseOfLine.get(a.receiptLineId) ?? null) : null,
            createdById: userId,
          },
        });
        report.captured += 1;
        capturedTiyin += a.priceTiyin;
      }
      // Kirim xarajati (shu qatorlar) — balansga o'tdi, xarajatdan chiqadi
      const expenseIds = [...new Set(lines.map((l) => l.expenseId).filter((x): x is string => Boolean(x)))];
      if (expenseIds.length) await this.prisma.expense.updateMany({ where: { id: { in: expenseIds }, deletedAt: null }, data: { deletedAt: now } });
    }

    // ── 2. Asosiy vosita moddasidagi xarajatlar (qayerda kiritilgan bo'lsa ham) ──
    if (capital.size) {
      const linkedExpenses = new Set((await this.prisma.fixedAsset.findMany({ where: { expenseId: { not: null } }, select: { expenseId: true } })).map((a) => a.expenseId!));
      const rows = await this.prisma.expense.findMany({
        where: { deletedAt: null, categoryCode: { in: [...capital] }, source: { notIn: ['ASSET', 'PAYROLL'] }, amountTiyin: { gt: 0n } },
        select: { id: true, date: true, amountTiyin: true, categoryCode: true, regionCode: true, departmentId: true, description: true, counterparty: true, documentNo: true, category: { select: { label: true } } },
        take: 5000,
      });
      for (const e of rows) {
        if (linkedExpenses.has(e.id)) continue;
        const name = (e.description?.trim() || [e.category.label, e.counterparty].filter(Boolean).join(' — ') || 'Asosiy vosita').slice(0, 300);
        await this.prisma.$transaction([
          this.prisma.fixedAsset.create({
            data: {
              name,
              categoryCode: e.categoryCode,
              costTiyin: e.amountTiyin,
              acquiredAt: e.date,
              lifeMonths: this.lifeFor(e.categoryCode, policy, cats),
              regionCode: e.regionCode,
              departmentId: e.departmentId,
              source: 'EXPENSE',
              expenseId: e.id,
              note: e.documentNo ? `Hujjat: ${e.documentNo}` : null,
              createdById: userId,
            },
          }),
          this.prisma.expense.update({ where: { id: e.id }, data: { deletedAt: now } }),
        ]);
        report.captured += 1;
        capturedTiyin += e.amountTiyin;
      }
    }
    report.capturedTiyin = capturedTiyin.toString();

    // ── 3. Holatni yangilash: ombordagi joyi, hisobdan chiqarilishi; qayta tiklangan xarajat ──
    const all = await this.prisma.fixedAsset.findMany({ where: { deletedAt: null } });
    const whIds = all.filter((a) => a.assetId).map((a) => a.assetId!);
    const whAssets = whIds.length
      ? await this.prisma.asset.findMany({ where: { id: { in: whIds } }, select: { id: true, status: true, regionCode: true, departmentId: true, name: true, holderName: true, item: { select: { categoryCode: true } } } })
      : [];
    const whById = new Map(whAssets.map((a) => [a.id, a]));
    const writeOffs = whAssets.some((a) => a.status === 'WRITTEN_OFF')
      ? await this.prisma.assetMove.findMany({
          where: { assetId: { in: whAssets.filter((a) => a.status === 'WRITTEN_OFF').map((a) => a.id) }, kind: 'WRITE_OFF' },
          orderBy: [{ date: 'desc' }],
          select: { assetId: true, date: true, note: true },
        })
      : [];
    const writeOffOf = new Map<string, { date: Date; note: string | null }>();
    for (const m of writeOffs) if (!writeOffOf.has(m.assetId)) writeOffOf.set(m.assetId, { date: m.date, note: m.note });
    const sourceExpenseIds = all.filter((a) => a.source === 'EXPENSE' && a.expenseId && a.mode !== 'EXPENSE').map((a) => a.expenseId!);
    const restored = new Set(
      sourceExpenseIds.length ? (await this.prisma.expense.findMany({ where: { id: { in: sourceExpenseIds }, deletedAt: null }, select: { id: true } })).map((e) => e.id) : [],
    );

    for (const a of all) {
      const data: Record<string, unknown> = {};
      if (a.assetId) {
        const w = whById.get(a.assetId);
        if (!w) {
          // Ombor kirimi bekor qilingan — vosita ham yo'q
          data.deletedAt = now;
        } else {
          const inUse = w.status === 'IN_USE';
          const region = inUse ? w.regionCode : null;
          const dept = inUse ? w.departmentId : null;
          if (a.regionCode !== region) data.regionCode = region;
          if (a.departmentId !== dept) data.departmentId = dept;
          if (a.name !== w.name) data.name = w.name;
          // Kimda: ombordagi egasi (berish / qaytarish / ko'chirish hujjatlaridan); omborda bo'lsa — bo'sh
          const holder = inUse ? (w.holderName ?? null) : null;
          if ((a.holderName ?? null) !== holder) data.holderName = holder;
          const off = w.status === 'WRITTEN_OFF' ? writeOffOf.get(w.id) : undefined;
          const disposedAt = off?.date ?? (w.status === 'WRITTEN_OFF' ? a.disposedAt ?? now : null);
          if ((a.disposedAt?.getTime() ?? null) !== (disposedAt?.getTime() ?? null)) {
            data.disposedAt = disposedAt;
            data.disposeReason = disposedAt ? (off?.note ?? 'Ombor › Hisobdan chiqarish') : null;
          }
          if (a.categoryCode !== w.item.categoryCode) data.categoryCode = w.item.categoryCode;
        }
      }
      // Foydalanuvchi xarajatni savatdan tiklagan — xarajat sifatida qoladi
      if (a.expenseId && restored.has(a.expenseId)) data.mode = 'EXPENSE';
      if (opts.applyLife && !a.lifeOverridden) {
        const life = this.lifeFor((data.categoryCode as string | undefined) ?? a.categoryCode, policy, cats);
        if (life !== a.lifeMonths) data.lifeMonths = life;
      }
      if (Object.keys(data).length) {
        await this.prisma.fixedAsset.update({ where: { id: a.id }, data });
        Object.assign(a, data);
        report.updated += 1;
      }
    }

    // ── 4. Oylik sarf yozuvlari (xarajat: AV_SARF, source ASSET) ──
    const upto = todayPeriod();
    const desired = new Map<string, Map<string, { regionCode: number; departmentId: string | null; amount: bigint; count: number }>>();
    for (const a of all) {
      if (a.deletedAt || a.mode !== 'BALANCE') continue;
      const regionCode = a.regionCode ?? CENTRAL_REGION;
      const departmentId = regionCode === CENTRAL_REGION ? a.departmentId : null;
      for (const [period, amount] of chargeSchedule(a, upto)) {
        const byUnit = desired.get(period) ?? new Map();
        const key = `${regionCode}|${departmentId ?? ''}`;
        const u = byUnit.get(key) ?? { regionCode, departmentId, amount: 0n, count: 0 };
        u.amount += amount;
        u.count += 1;
        byUnit.set(key, u);
        desired.set(period, byUnit);
      }
    }
    const existing = await this.prisma.expense.findMany({
      where: { source: 'ASSET', deletedAt: null, categoryCode: ASSET_CHARGE_CATEGORY.code },
      select: { id: true, period: true, regionCode: true, departmentId: true, amountTiyin: true },
    });
    const existingBy = new Map<string, typeof existing>();
    for (const e of existing) {
      const list = existingBy.get(e.period) ?? [];
      list.push(e);
      existingBy.set(e.period, list);
    }
    const periods = new Set([...desired.keys(), ...existingBy.keys()]);
    const sig = (list: { key: string; amount: bigint }[]) => list.map((x) => `${x.key}:${x.amount}`).sort().join('|');
    const [regions, depts] = await Promise.all([
      this.prisma.region.findMany({ select: { code: true, name: true } }),
      this.prisma.department.findMany({ select: { id: true, name: true } }),
    ]);
    const regionName = new Map(regions.map((r) => [r.code, r.name]));
    const deptName = new Map(depts.map((d) => [d.id, d.name]));
    for (const period of [...periods].sort()) {
      const want = [...(desired.get(period)?.values() ?? [])].filter((u) => u.amount !== 0n);
      const have = existingBy.get(period) ?? [];
      if (sig(want.map((u) => ({ key: `${u.regionCode}|${u.departmentId ?? ''}`, amount: u.amount }))) === sig(have.map((e) => ({ key: `${e.regionCode}|${e.departmentId ?? ''}`, amount: e.amountTiyin })))) continue;
      if (want.length && !userId) continue;
      const date = periodStartDate(period);
      await this.prisma.$transaction([
        this.prisma.expense.deleteMany({ where: { id: { in: have.map((e) => e.id) } } }),
        ...(want.length
          ? [
              this.prisma.expense.createMany({
                data: want.map((u) => ({
                  date,
                  period,
                  amountTiyin: u.amount,
                  categoryCode: ASSET_CHARGE_CATEGORY.code,
                  regionCode: u.regionCode,
                  departmentId: u.departmentId,
                  description: `Asosiy vositalar sarfi (eskirish) — ${u.regionCode === CENTRAL_REGION ? `Markaz${u.departmentId ? `: ${deptName.get(u.departmentId) ?? "bo'lim"}` : ''}` : (regionName.get(u.regionCode) ?? `Hudud ${u.regionCode}`)} · ${u.count} ta vosita`.slice(0, 500),
                  paymentMethod: 'OTHER' as const,
                  paymentStatus: 'PAID' as const,
                  source: 'ASSET' as const,
                  section: 'DOIMIY' as const,
                  recurrence: 'RECURRING',
                  createdById: userId!,
                })),
              }),
            ]
          : []),
      ]);
      report.periods += 1;
      report.chargeRows += want.length;
    }

    // ── 5. «Xarajatga o'tkazilgan» rejimi: Excel'dan / qo'lda kiritilganlar — har biriga bitta xarajat yozuvi (Markaz) ──
    await this.syncOwnExpenses(regionName, deptName, userId);

    this.lastSyncAt = new Date();
    if (report.captured) this.logger.log(`Asosiy vositalar: ${report.captured} ta yangi vosita balansga olindi`);
    return report;
  }

  /**
   * Xarajatga o'tkazilgan vositalar uchun xarajat yozuvlari: kerakligi yaratiladi / yangilanadi,
   * rejimi o'zgargan yoki o'chirilganlariniki olib tashlanadi. Hammasi Markaz hisobidan (modda AV_XARAJAT).
   */
  private async syncOwnExpenses(regionName: Map<number, string>, deptName: Map<string, string>, userId: string | null): Promise<void> {
    const assets = await this.prisma.fixedAsset.findMany({
      where: { source: { in: OWN_EXPENSE_SOURCES }, OR: [{ mode: 'EXPENSE', deletedAt: null }, { expenseId: { not: null } }] },
    });
    if (!assets.length) return;
    const ids = assets.map((a) => a.expenseId).filter((x): x is string => Boolean(x));
    const rows = ids.length
      ? await this.prisma.expense.findMany({ where: { id: { in: ids } }, select: { id: true, amountTiyin: true, date: true, deletedAt: true, departmentId: true, categoryCode: true } })
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const a of assets) {
      const want = !a.deletedAt && a.mode === 'EXPENSE' && a.costTiyin > 0n;
      const have = a.expenseId ? byId.get(a.expenseId) : undefined;
      const ownRow = have && have.categoryCode === ASSET_EXPENSE_CATEGORY.code;
      if (!want) {
        if (ownRow) await this.prisma.expense.delete({ where: { id: have.id } }).catch(() => null);
        if (a.expenseId && (ownRow || !have)) await this.prisma.fixedAsset.update({ where: { id: a.id }, data: { expenseId: null } });
        continue;
      }
      const departmentId = a.regionCode === null || a.regionCode === CENTRAL_REGION ? a.departmentId : null;
      const where = a.regionCode !== null && a.regionCode !== CENTRAL_REGION ? (regionName.get(a.regionCode) ?? `Hudud ${a.regionCode}`) : departmentId ? (deptName.get(departmentId) ?? 'Markaz') : 'Markaz';
      const description = `Asosiy vosita xarajatga: ${a.name}${a.quantity > 1 ? ` × ${a.quantity}` : ''} — ${where}${a.holderName ? ` · ${a.holderName}` : ''}`.slice(0, 500);
      if (ownRow && !have.deletedAt) {
        if (have.amountTiyin !== a.costTiyin || have.date.getTime() !== a.acquiredAt.getTime() || have.departmentId !== departmentId) {
          await this.prisma.expense.update({ where: { id: have.id }, data: { amountTiyin: a.costTiyin, date: a.acquiredAt, period: periodOf(a.acquiredAt), departmentId, description } });
        }
        continue;
      }
      if (!userId) continue;
      const created = await this.prisma.expense.create({
        data: {
          date: a.acquiredAt,
          period: periodOf(a.acquiredAt),
          amountTiyin: a.costTiyin,
          categoryCode: ASSET_EXPENSE_CATEGORY.code,
          regionCode: CENTRAL_REGION,
          departmentId,
          description,
          documentNo: a.inventoryNo,
          paymentMethod: 'OTHER',
          paymentStatus: 'PAID',
          source: 'ASSET',
          section: 'BOSHQA',
          createdById: userId,
        },
        select: { id: true },
      });
      await this.prisma.fixedAsset.update({ where: { id: a.id }, data: { expenseId: created.id } });
    }
  }

  // ═══════════ Ro'yxat va hisob ═══════════

  private async lookups() {
    const [cats, regions, depts] = await Promise.all([
      this.prisma.category.findMany({ select: { code: true, label: true, parentCode: true } }),
      this.prisma.region.findMany({ select: { code: true, name: true } }),
      this.prisma.department.findMany({ select: { id: true, name: true } }),
    ]);
    return {
      catLabel: new Map(cats.map((c) => [c.code, c.label])),
      regionName: new Map(regions.map((r) => [r.code, r.name])),
      deptName: new Map(depts.map((d) => [d.id, d.name])),
    };
  }

  private view(a: FixedAsset, lk: Awaited<ReturnType<FixedAssetsService['lookups']>>, at: string): AssetView {
    const b = bookValue(a, at);
    const place =
      a.regionCode !== null && a.regionCode !== CENTRAL_REGION
        ? (lk.regionName.get(a.regionCode) ?? `Hudud ${a.regionCode}`)
        : a.departmentId
          ? `Markaz: ${lk.deptName.get(a.departmentId) ?? "bo'lim"}`
          : a.source === 'WAREHOUSE'
            ? 'Markaz (omborda)'
            : 'Markaz';
    const expensed = a.mode === 'EXPENSE';
    const hold = a.mode === 'HOLD';
    const mode = (ASSET_MODES as string[]).includes(a.mode) ? (a.mode as AssetMode) : 'BALANCE';
    return {
      id: a.id,
      name: a.name,
      inventoryNo: a.inventoryNo,
      categoryCode: a.categoryCode,
      categoryLabel: lk.catLabel.get(a.categoryCode) ?? a.categoryCode,
      source: a.source,
      sourceLabel: SOURCE_LABEL[a.source] ?? a.source,
      mode: a.mode,
      place,
      regionCode: a.regionCode,
      departmentId: a.departmentId,
      costTiyin: a.costTiyin.toString(),
      acquiredAt: a.acquiredAt.toISOString(),
      lifeMonths: a.lifeMonths,
      lifeOverridden: a.lifeOverridden,
      monthlyTiyin: (expensed || hold ? 0n : b.monthly).toString(),
      accumulatedTiyin: (expensed ? a.costTiyin : hold ? 0n : b.accumulated).toString(),
      residualTiyin: (expensed ? 0n : hold ? a.costTiyin : b.residual).toString(),
      endPeriod: b.endPeriod,
      status: expensed
        ? 'expense'
        : a.disposedAt && periodOf(a.disposedAt) <= at
          ? 'disposed'
          : hold
            ? 'hold'
            : b.residual <= 0n
              ? 'done'
              : 'active',
      modeLabel: MODE_LABEL[mode],
      holderName: a.holderName,
      placeText: a.placeText,
      quantity: a.quantity ?? 1,
      importBatch: a.importBatch,
      disposedAt: a.disposedAt?.toISOString() ?? null,
      disposeReason: a.disposeReason,
      note: a.note,
      expenseId: a.expenseId,
      assetId: a.assetId,
    };
  }

  async list(filter: { status?: string; search?: string; category?: string; batch?: string } = {}): Promise<AssetView[]> {
    await this.sync().catch(() => null);
    const [rows, lk] = await Promise.all([this.prisma.fixedAsset.findMany({ where: { deletedAt: null }, orderBy: [{ acquiredAt: 'desc' }, { createdAt: 'desc' }] }), this.lookups()]);
    const at = todayPeriod();
    const q = filter.search?.trim().toLowerCase();
    return rows
      .map((a) => this.view(a, lk, at))
      .filter((v) => (!filter.status || filter.status === 'all' ? true : v.status === filter.status))
      .filter((v) => (!filter.category ? true : v.categoryCode === filter.category))
      .filter((v) => (!filter.batch ? true : v.importBatch === filter.batch))
      .filter((v) => (!q ? true : `${v.name} ${v.inventoryNo ?? ''} ${v.categoryLabel} ${v.place} ${v.placeText ?? ''} ${v.holderName ?? ''}`.toLowerCase().includes(q)));
  }

  /** Davr bo'yicha: sarf, xarid, qoldiq (Markaz paneli va AV sahifasi uchun) */
  async summary(from?: string, to?: string): Promise<AssetsSummary> {
    const today = new Date(Date.now() + TASHKENT_MS).toISOString().slice(0, 10);
    const range = { from: from || `${today.slice(0, 4)}-01-01`, to: to || today };
    const a = parseDay(range.from);
    const b = parseDay(range.to);
    if (!a || !b) throw new BadRequestException("Sana noto'g'ri (YYYY-MM-DD)");
    if (a > b) throw new BadRequestException('Boshlanish sanasi tugash sanasidan keyin');
    const fromP = range.from.slice(0, 7);
    const toP = range.to.slice(0, 7);
    const span = Math.min(36, monthsBetween(fromP, toP) + 1);
    const months = Array.from({ length: Math.max(1, span) }, (_, i) => addMonths(toP, i - Math.max(1, span) + 1));
    const [rows, lk, charges] = await Promise.all([
      this.prisma.fixedAsset.findMany({ where: { deletedAt: null } }),
      this.lookups(),
      // Sarf — xarajat yozuvlaridan (Xarajatlar, Solishtirma bilan bir xil)
      this.prisma.expense.findMany({ where: { deletedAt: null, source: 'ASSET', categoryCode: ASSET_CHARGE_CATEGORY.code, date: { gte: a, lt: new Date(b.getTime() + 86_400_000) } }, select: { period: true, amountTiyin: true } }),
    ]);
    const end = toP < todayPeriod() ? toP : todayPeriod();
    let cost = 0n;
    let acc = 0n;
    let acquired = 0n;
    let acquiredCount = 0;
    let disposed = 0n;
    let expensed = 0;
    let expensedSum = 0n;
    let hold = 0;
    let holdSum = 0n;
    const byCat = new Map<string, { code: string; label: string; count: number; cost: bigint; residual: bigint; charge: bigint }>();
    for (const r of rows) {
      if (r.mode === 'EXPENSE') {
        expensed += 1;
        expensedSum += r.costTiyin;
        continue;
      }
      const isHold = r.mode === 'HOLD';
      if (r.acquiredAt >= a && r.acquiredAt < new Date(b.getTime() + 86_400_000)) {
        acquired += r.costTiyin;
        acquiredCount += 1;
      }
      if (r.acquiredAt >= new Date(b.getTime() + 86_400_000)) continue;
      // Faqat balansda (xarajatsiz): qoldiq = boshlang'ich qiymat, sarf yo'q
      const bv = isHold ? { accumulated: 0n, residual: r.costTiyin } : bookValue(r, end);
      const isDisposed = r.disposedAt && periodOf(r.disposedAt) <= end;
      if (isDisposed && r.disposedAt! >= a) {
        const before = isHold ? { accumulated: 0n } : bookValue({ ...r, disposedAt: null }, addMonths(periodOf(r.disposedAt!), -1));
        disposed += r.costTiyin - before.accumulated;
      }
      if (isDisposed) continue;
      if (isHold) {
        hold += 1;
        holdSum += r.costTiyin;
      }
      cost += r.costTiyin;
      acc += bv.accumulated;
      const c = byCat.get(r.categoryCode) ?? { code: r.categoryCode, label: lk.catLabel.get(r.categoryCode) ?? r.categoryCode, count: 0, cost: 0n, residual: 0n, charge: 0n };
      c.count += 1;
      c.cost += r.costTiyin;
      c.residual += bv.residual;
      if (!isHold) for (const [p, v] of chargeSchedule(r, end)) if (p >= fromP && p <= toP) c.charge += v;
      byCat.set(r.categoryCode, c);
    }
    const idx = new Map(months.map((m, i) => [m, i]));
    const trend = months.map(() => 0n);
    let charge = 0n;
    for (const c of charges) {
      charge += c.amountTiyin;
      const i = idx.get(c.period);
      if (i !== undefined) trend[i]! += c.amountTiyin;
    }
    return {
      range,
      count: rows.filter((r) => r.mode !== 'EXPENSE' && r.acquiredAt < new Date(b.getTime() + 86_400_000) && !(r.disposedAt && periodOf(r.disposedAt) <= end)).length,
      costTiyin: cost.toString(),
      accumulatedTiyin: acc.toString(),
      residualTiyin: (cost - acc).toString(),
      chargeTiyin: charge.toString(),
      acquiredTiyin: acquired.toString(),
      acquiredCount,
      disposedTiyin: disposed.toString(),
      months,
      chargeTrend: trend.map(String),
      byCategory: [...byCat.values()].sort((x, y) => (y.cost > x.cost ? 1 : -1)).map((c) => ({ code: c.code, label: c.label, count: c.count, costTiyin: c.cost.toString(), residualTiyin: c.residual.toString(), chargeTiyin: c.charge.toString() })),
      expensedCount: expensed,
      expensedTiyin: expensedSum.toString(),
      holdCount: hold,
      holdTiyin: holdSum.toString(),
      lastSyncAt: this.lastSyncAt?.toISOString() ?? null,
    };
  }

  /** Bitta vosita: oyma-oy sarf jadvali */
  async detail(id: string) {
    const a = await this.prisma.fixedAsset.findUnique({ where: { id } });
    if (!a || a.deletedAt) throw new NotFoundException('Asosiy vosita topilmadi');
    const lk = await this.lookups();
    const at = todayPeriod();
    const full = chargeSchedule(a, addMonths(periodOf(a.acquiredAt), a.lifeMonths + 1));
    let acc = 0n;
    const schedule = [...full.entries()].map(([period, amount]) => {
      acc += amount;
      return { period, amountTiyin: amount.toString(), accumulatedTiyin: acc.toString(), residualTiyin: (a.costTiyin - acc).toString(), done: period <= at };
    });
    return { asset: this.view(a, lk, at), schedule: a.mode === 'BALANCE' ? schedule : [] };
  }

  // ═══════════ O'zgartirish ═══════════

  async create(input: unknown, userId: string): Promise<AssetView> {
    const x = (input ?? {}) as Record<string, unknown>;
    const name = String(x.name ?? '').trim();
    if (name.length < 2) throw new BadRequestException('Nomini kiriting');
    const cost = toTiyin(x.costTiyin);
    if (cost === null || cost <= 0n) throw new BadRequestException("Qiymat musbat bo'lsin");
    const acquiredAt = parseDay(typeof x.acquiredAt === 'string' ? x.acquiredAt : undefined);
    if (!acquiredAt) throw new BadRequestException('Xarid sanasini kiriting (YYYY-MM-DD)');
    const categoryCode = String(x.categoryCode ?? '');
    if (!(await this.prisma.category.findUnique({ where: { code: categoryCode } }))) throw new BadRequestException('Moddani tanlang');
    const policy = await this.policy();
    const cats = await this.prisma.category.findMany({ select: { code: true, parentCode: true } });
    const lifeIn = x.lifeMonths === undefined || x.lifeMonths === null || x.lifeMonths === '' ? null : Number(x.lifeMonths);
    if (lifeIn !== null && (!Number.isInteger(lifeIn) || lifeIn < 1 || lifeIn > MAX_LIFE)) throw new BadRequestException(`Xizmat muddati 1–${MAX_LIFE} oy`);
    const regionCode = x.regionCode === undefined || x.regionCode === null || x.regionCode === '' ? null : Number(x.regionCode);
    if (regionCode !== null && !(await this.prisma.region.findUnique({ where: { code: regionCode } }))) throw new BadRequestException('Hudud topilmadi');
    const departmentId = typeof x.departmentId === 'string' && x.departmentId ? x.departmentId : null;
    const created = await this.prisma.fixedAsset.create({
      data: {
        name: name.slice(0, 300),
        inventoryNo: typeof x.inventoryNo === 'string' && x.inventoryNo.trim() ? x.inventoryNo.trim().slice(0, 60) : null,
        categoryCode,
        costTiyin: cost,
        acquiredAt,
        lifeMonths: lifeIn ?? this.lifeFor(categoryCode, policy, cats),
        lifeOverridden: lifeIn !== null,
        regionCode: regionCode === CENTRAL_REGION ? null : regionCode,
        departmentId: regionCode === null || regionCode === CENTRAL_REGION ? departmentId : null,
        source: 'MANUAL',
        note: typeof x.note === 'string' ? x.note.slice(0, 500) : null,
        createdById: userId,
      },
    });
    await this.audit.log({ userId, action: 'CREATE', entity: 'fixed_asset', entityId: created.id, summary: `Asosiy vosita qo'shildi: ${created.name} — ${(Number(cost) / 100).toLocaleString('uz-UZ')} so'm, ${created.lifeMonths} oy` });
    await this.sync();
    return (await this.detail(created.id)).asset;
  }

  async update(id: string, input: unknown, userId: string): Promise<AssetView> {
    const a = await this.prisma.fixedAsset.findUnique({ where: { id } });
    if (!a || a.deletedAt) throw new NotFoundException('Asosiy vosita topilmadi');
    const x = (input ?? {}) as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    if (x.lifeMonths !== undefined) {
      if (x.lifeMonths === null || x.lifeMonths === '') {
        const [policy, cats] = await Promise.all([this.policy(), this.prisma.category.findMany({ select: { code: true, parentCode: true } })]);
        data.lifeMonths = this.lifeFor(a.categoryCode, policy, cats);
        data.lifeOverridden = false;
      } else {
        const m = Number(x.lifeMonths);
        if (!Number.isInteger(m) || m < 1 || m > MAX_LIFE) throw new BadRequestException(`Xizmat muddati 1–${MAX_LIFE} oy`);
        data.lifeMonths = m;
        data.lifeOverridden = true;
      }
    }
    if (typeof x.note === 'string') data.note = x.note.slice(0, 500) || null;
    if (typeof x.name === 'string' && a.source !== 'WAREHOUSE') {
      if (x.name.trim().length < 2) throw new BadRequestException('Nomini kiriting');
      data.name = x.name.trim().slice(0, 300);
    }
    if (a.source === 'MANUAL') {
      if (x.costTiyin !== undefined) {
        const cost = toTiyin(x.costTiyin);
        if (cost === null || cost <= 0n) throw new BadRequestException("Qiymat musbat bo'lsin");
        data.costTiyin = cost;
      }
      if (typeof x.acquiredAt === 'string') {
        const d = parseDay(x.acquiredAt);
        if (!d) throw new BadRequestException("Sana noto'g'ri");
        data.acquiredAt = d;
      }
    }
    if (!Object.keys(data).length) return (await this.detail(id)).asset;
    await this.prisma.fixedAsset.update({ where: { id }, data });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'fixed_asset', entityId: id, summary: `Asosiy vosita o'zgartirildi: ${a.name}${data.lifeMonths ? ` — muddat ${a.lifeMonths} → ${String(data.lifeMonths)} oy` : ''}` });
    await this.sync();
    return (await this.detail(id)).asset;
  }

  /** Hisobdan chiqarish (ombor vositasi — Ombor › Hisobdan chiqarish orqali) */
  async dispose(id: string, input: unknown, userId: string): Promise<AssetView> {
    const a = await this.prisma.fixedAsset.findUnique({ where: { id } });
    if (!a || a.deletedAt) throw new NotFoundException('Asosiy vosita topilmadi');
    if (a.source === 'WAREHOUSE') throw new BadRequestException("Ombor vositasi: Ombor › Hujjatlar › «Hisobdan chiqarish» hujjati bilan chiqariladi (dalolatnoma bilan)");
    if (a.mode === 'EXPENSE') throw new BadRequestException("Bu vosita xarajatga o'tkazilgan — avval balansga oling");
    const x = (input ?? {}) as Record<string, unknown>;
    const undo = x.undo === true;
    const date = undo ? null : parseDay(typeof x.date === 'string' ? x.date : undefined);
    if (!undo && !date) throw new BadRequestException('Sanani kiriting (YYYY-MM-DD)');
    if (date && date < a.acquiredAt) throw new BadRequestException('Chiqarish sanasi xarid sanasidan oldin');
    await this.prisma.fixedAsset.update({ where: { id }, data: { disposedAt: date, disposeReason: undo ? null : String(x.reason ?? '').slice(0, 300) || 'Hisobdan chiqarildi' } });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'fixed_asset', entityId: id, summary: undo ? `Asosiy vosita hisobdan chiqarish bekor qilindi: ${a.name}` : `Asosiy vosita hisobdan chiqarildi: ${a.name} (${x.date as string})` });
    await this.sync();
    return (await this.detail(id)).asset;
  }

  /**
   * Rejimni o'zgartirish:
   *   BALANCE — balansda, eskirish bilan; HOLD — faqat balansda (xarajatsiz); EXPENSE — xarajatga o'tkazish.
   * Xarajatdan olingan vosita: EXPENSE — asl xarajat yozuvi qaytadi; boshqa rejimda — yashiriladi.
   * Excel'dan / qo'lda kiritilgan: EXPENSE — o'z xarajat yozuvi (Markaz) yaratiladi, qaytarilsa — o'chiriladi.
   * Ombor vositasi xarajatga o'tkazilmaydi (kirim xarajati omborda) — faqat BALANCE / HOLD.
   */
  async setMode(id: string, mode: unknown, userId: string): Promise<AssetView> {
    const res = await this.setModeMany([id], mode, userId);
    if (res.skipped.length) throw new BadRequestException(res.skipped[0]!.reason);
    return (await this.detail(id)).asset;
  }

  /** Bir nechta vosita (yoki butun import partiyasi) rejimini birdan o'zgartirish */
  async setModeMany(idsInput: unknown, mode: unknown, userId: string, batch?: string): Promise<{ changed: number; skipped: { id: string; name: string; reason: string }[] }> {
    if (typeof mode !== 'string' || !(ASSET_MODES as string[]).includes(mode)) throw new BadRequestException("Rejim noto'g'ri: BALANCE, HOLD yoki EXPENSE");
    const ids = Array.isArray(idsInput) ? idsInput.filter((x): x is string => typeof x === 'string').slice(0, 5000) : [];
    if (!ids.length && !batch) throw new BadRequestException('Vositalarni tanlang');
    const rows = await this.prisma.fixedAsset.findMany({ where: { deletedAt: null, ...(batch ? { importBatch: batch } : { id: { in: ids } }) } });
    if (!rows.length) throw new NotFoundException('Asosiy vosita topilmadi');
    const skipped: { id: string; name: string; reason: string }[] = [];
    const now = new Date();
    let changed = 0;
    for (const a of rows) {
      if (a.mode === mode) continue;
      if (mode === 'EXPENSE' && a.source === 'WAREHOUSE') {
        skipped.push({ id: a.id, name: a.name, reason: "Ombor vositasi xarajatga o'tkazilmaydi — u balansda (eskirish bilan yoki xarajatsiz) turadi" });
        continue;
      }
      if (a.source === 'EXPENSE') {
        if (mode === 'EXPENSE') {
          const e = a.expenseId ? await this.prisma.expense.findUnique({ where: { id: a.expenseId }, select: { id: true } }) : null;
          if (e) await this.prisma.expense.update({ where: { id: e.id }, data: { deletedAt: null } });
          else {
            // Savat tozalangan — xarajat yozuvi qayta yaratiladi
            const uid = (await this.systemUserId()) ?? userId;
            const created = await this.prisma.expense.create({
              data: { date: a.acquiredAt, period: periodOf(a.acquiredAt), amountTiyin: a.costTiyin, categoryCode: a.categoryCode, regionCode: a.regionCode ?? CENTRAL_REGION, departmentId: a.departmentId, description: a.name.slice(0, 500), source: 'MANUAL', section: 'BOSHQA', createdById: uid },
              select: { id: true },
            });
            await this.prisma.fixedAsset.update({ where: { id: a.id }, data: { expenseId: created.id } });
          }
        } else if (a.expenseId && a.mode === 'EXPENSE') {
          await this.prisma.expense.updateMany({ where: { id: a.expenseId, deletedAt: null }, data: { deletedAt: now } });
        }
      }
      await this.prisma.fixedAsset.update({ where: { id: a.id }, data: { mode } });
      changed += 1;
    }
    if (changed) {
      await this.audit.log({
        userId,
        action: 'UPDATE',
        entity: 'fixed_asset',
        entityId: batch ?? (rows.length === 1 ? rows[0]!.id : 'many'),
        summary: `Asosiy vositalar rejimi → ${MODE_LABEL[mode as AssetMode]}: ${changed} ta${batch ? ` (partiya: ${batch})` : rows.length === 1 ? ` — ${rows[0]!.name}` : ''}`,
      });
      await this.sync();
    }
    return { changed, skipped };
  }

  /** Excel import partiyalari (filtr va guruh boshqaruvi uchun) */
  async batches(): Promise<{ batch: string; count: number; costTiyin: string; modes: Record<string, number> }[]> {
    const rows = await this.prisma.fixedAsset.findMany({ where: { deletedAt: null, importBatch: { not: null } }, select: { importBatch: true, costTiyin: true, mode: true } });
    const map = new Map<string, { count: number; cost: bigint; modes: Record<string, number> }>();
    for (const r of rows) {
      const g = map.get(r.importBatch!) ?? { count: 0, cost: 0n, modes: {} };
      g.count += 1;
      g.cost += r.costTiyin;
      g.modes[r.mode] = (g.modes[r.mode] ?? 0) + 1;
      map.set(r.importBatch!, g);
    }
    return [...map.entries()].map(([batch, g]) => ({ batch, count: g.count, costTiyin: g.cost.toString(), modes: g.modes }));
  }

  /** Qo'lda kiritilganini o'chirish */
  async remove(id: string, userId: string): Promise<{ success: true }> {
    const a = await this.prisma.fixedAsset.findUnique({ where: { id } });
    if (!a || a.deletedAt) throw new NotFoundException('Asosiy vosita topilmadi');
    if (!OWN_EXPENSE_SOURCES.includes(a.source)) throw new BadRequestException(a.source === 'WAREHOUSE' ? 'Ombor vositasi Ombor kirimini bekor qilish bilan o\'chadi' : '«Xarajat qilib qoldirish» tugmasidan foydalaning');
    await this.prisma.fixedAsset.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entity: 'fixed_asset', entityId: id, summary: `Asosiy vosita o'chirildi: ${a.name}` });
    await this.sync();
    return { success: true };
  }

  /** Balansga o'tkazilgan xarajat yozuvlari (savatda ko'rinmasin, tiklanmasin) */
  async linkedExpenseIds(ids?: string[]): Promise<Set<string>> {
    const rows = await this.prisma.fixedAsset.findMany({
      where: { expenseId: ids ? { in: ids } : { not: null }, mode: { not: 'EXPENSE' }, deletedAt: null },
      select: { expenseId: true },
    });
    return new Set(rows.map((r) => r.expenseId!));
  }
}

export interface SyncReport {
  captured: number;
  capturedTiyin: string;
  updated: number;
  periods: number;
  chargeRows: number;
}