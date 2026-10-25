import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { runExclusive } from '../../common/locks';
import { monthLabel } from '../../common/period';
import { entryUnitLabel } from '../../common/segments/segments';
import { KIND_LABELS, purposeMonth, type PayoutKind } from '../acc-23106/acc23106.purpose';
import { readStore, STORE_KEY } from '../acc-23106/acc23106.store';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CompositionReconcileService } from '../salary-composition/salary-composition.reconcile';
import { PAYROLL_UNITS, UnitPayrollService } from '../unit-payroll/unit-payroll.service';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › Ish haqi solishtirma: FOT − ushlanmalar = 23106 (bankdan qo'lga to'langan).
//
// Qoida (har xodim, har oy):
//  • Shartnoma asosida ishlovchi:  FOT − daromad solig'i (12%)                       = 23106
//  • Asosiy shtat (Markaz, hudud): FOT − daromad solig'i (12%) − kasaba uyushmasi (2%) = 23106
//  Masalan, 10 000 000 so'm: shartnoma — 10 000 000 − 1 200 000 = 8 800 000; shtat — … − 200 000 = 8 600 000.
// FOT — FAQAT soliq hisoboti («hisobot davrida hisoblangan»; yo'nalishlarda — o'sha bo'lim ish haqi vedomosti):
// tarkib boshqacha bo'lsa ham FOT soliq hisobotidan ortiq ham, kam ham bo'lmaydi. Tarkib — faqat taqqoslash uchun:
// Markaz tablosida tarkib soliq hisobotidan farq qilsa, farqni shu yerda komponentga yo'naltirish mumkin (bayram puli,
// mukofot …) — tarkib soliq hisobotiga tenglashadi (Ish haqi tarkibi › uchlik nazorat bilan bir xil, bekor qilinadi).
// Ikki tablo: Markaz (Markaz xodimlari, yo'nalishlar) va Hududlar (faqat soliq hisoboti bo'yicha).
// Xodim turi — shu oy joylashuvi (natijalar fayli), bo'lmasa Xodimlar bazasidan.
// 23106 — shu oy uchun to'langanlar (izohdagi «… oyi uchun», bo'lmasa buyruq oyi; yoki — to'langan oy), xizmat
// safaridan tashqari: ish haqi, avans, bayram, mukofot, moddiy yordam, ta'til …
// Foizlar va ruxsat etilgan farq — sozlanadi (settings «payroll.solishtirma»). Hech narsa yozilmaydi — faqat nazorat.
// ═══════════════════════════════════════════════════════════

export const SETTINGS_KEY = 'payroll.solishtirma';
/** Tasdiqlar: oy → tablo → tasdiqlangan xodimlar (o'sha paytdagi summalar bilan) */
export const CONFIRM_KEY = 'payroll.solishtirma.confirm';
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface SolishtirmaSettings {
  /** Daromad solig'i, % */
  taxPct: number;
  /** Kasaba uyushmasi (faqat asosiy shtat), % */
  unionPct: number;
  /** Ruxsat etilgan farq, so'm */
  toleranceSum: number;
}
const DEFAULTS: SolishtirmaSettings = { taxPct: 12, unionPct: 2, toleranceSum: 1000 };

export type BankMonthMode = 'ACCRUAL' | 'PAID';
/** Tablo: Markaz (Markaz xodimlari, yo'nalishlar, joyi noma'lumlar) yoki Hududlar */
export type SolTab = 'CENTER' | 'REGION';
export type SolState = 'OK' | 'LESS' | 'MORE' | 'NO_BANK' | 'NO_FOT';
export type GroupKey = 'CENTER_SHTAT' | 'CENTER_SHARTNOMA' | 'REGION_SHTAT' | 'REGION_SHARTNOMA' | 'UNIT' | 'UNKNOWN';

const GROUP_LABELS: Record<GroupKey, string> = {
  CENTER_SHTAT: 'Markaz — asosiy shtat',
  CENTER_SHARTNOMA: 'Markaz — shartnoma',
  REGION_SHTAT: 'Hududlar — asosiy shtat',
  REGION_SHARTNOMA: 'Hududlar — shartnoma',
  UNIT: "Yo'nalishlar (Tax free, Fermer …)",
  UNKNOWN: "Joyi noma'lum (bazada yo'q)",
};

const abs = (v: bigint) => (v < 0n ? -v : v);

/** Bir tablo tasdig'i: kim, qachon, qaysi xodimlar (summalari bilan — keyin o'zgarsa «o'zgargan» deb ko'rinadi) */
export interface TabConfirm {
  at: string;
  by: string;
  count: number;
  totalTiyin: string;
  rows: Record<string, { soliq: string; tarkib: string | null; bank: string }>;
}
type ConfirmStore = Record<string, Partial<Record<'CENTER' | 'REGION', TabConfirm>>>;

function readConfirm(raw: unknown): ConfirmStore {
  const v = (raw as { periods?: unknown } | null)?.periods;
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as ConfirmStore) : {};
}

const CATEGORY_LABELS: Record<string, string> = { ASOSIY: 'Asosiy ish haqi', TATIL: "Ta'til va kasallik", PREMIYA: 'Premiyalar', KOMPENSATSIYA: 'Kompensatsiyalar', USTAMA: 'Ustamalar', JARIMA: 'Jarimalar', BOSHQA: 'Boshqa' };
const CATEGORY_ORDER = ['ASOSIY', 'TATIL', 'PREMIYA', 'KOMPENSATSIYA', 'USTAMA', 'BOSHQA', 'JARIMA'];
/** Foiz (bir necha xonali kasr ham) → tiyin, yaxlitlash bilan */
const pct = (base: bigint, p: number) => (base * BigInt(Math.round(p * 10000)) + 500000n) / 1000000n;

function readSettings(raw: unknown): SolishtirmaSettings {
  const v = (raw ?? {}) as Partial<SolishtirmaSettings>;
  const num = (x: unknown, d: number, max: number) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= max ? x : d);
  return { taxPct: num(v.taxPct, DEFAULTS.taxPct, 100), unionPct: num(v.unionPct, DEFAULTS.unionPct, 100), toleranceSum: num(v.toleranceSum, DEFAULTS.toleranceSum, 1_000_000) };
}

@Injectable()
export class PayrollSolishtirmaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly unitPayroll?: UnitPayrollService,
    @Optional() private readonly reconcile?: CompositionReconcileService,
  ) {}

  async settings(): Promise<SolishtirmaSettings> {
    return readSettings((await this.prisma.setting.findUnique({ where: { key: SETTINGS_KEY } }))?.value ?? null);
  }

  async saveSettings(body: Partial<Record<keyof SolishtirmaSettings, unknown>>, userId: string): Promise<SolishtirmaSettings> {
    const n = (x: unknown, label: string, max: number) => {
      const v = typeof x === 'number' ? x : typeof x === 'string' && x.trim() ? Number(x.replace(',', '.')) : NaN;
      if (!Number.isFinite(v) || v < 0 || v > max) throw new BadRequestException(`${label} noto'g'ri (0 — ${max})`);
      return Math.round(v * 100) / 100;
    };
    const next: SolishtirmaSettings = { taxPct: n(body?.taxPct, "Daromad solig'i foizi", 100), unionPct: n(body?.unionPct, 'Kasaba uyushmasi foizi', 100), toleranceSum: n(body?.toleranceSum, 'Ruxsat etilgan farq', 1_000_000) };
    const prev = await this.settings();
    await runExclusive(`setting:${SETTINGS_KEY}`, () => this.prisma.setting.upsert({ where: { key: SETTINGS_KEY }, create: { key: SETTINGS_KEY, value: next as unknown as object }, update: { value: next as unknown as object } }));
    await this.audit.log({ userId, action: 'UPDATE', entity: 'payroll_solishtirma', entityId: SETTINGS_KEY, summary: `Ish haqi solishtirma sozlamalari: soliq ${prev.taxPct}% → ${next.taxPct}%, kasaba ${prev.unionPct}% → ${next.unionPct}%, farq chegarasi ${prev.toleranceSum} → ${next.toleranceSum} so'm` });
    return next;
  }

  // ═══════════ Ma'lumot ═══════════

  /** FOT: tarkib (umumiy + yo'nalishlar), bo'lmasa — soliq hisoboti / bo'lim vedomosti */
  private async fot(period: string) {
    const tarkib = new Map<string, { total: bigint; unit: string | null }>();
    const soliq = new Map<string, { total: bigint; unit: string | null }>();
    const batch = await this.prisma.salaryCompositionBatch.findFirst({ where: { period, cancelledAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (batch) for (const r of await this.prisma.salaryCompositionRow.findMany({ where: { batchId: batch.id }, select: { employeePinfl: true, totalTiyin: true } })) tarkib.set(r.employeePinfl, { total: r.totalTiyin, unit: null });
    const unitRows = await this.prisma.setting.findMany({ where: { key: { in: PAYROLL_UNITS.map((u) => `unit.composition.${u}.${period}`) } }, select: { key: true, value: true } });
    for (const row of unitRows) {
      const unit = row.key.split('.')[2]!;
      const list = ((row.value as { batches?: { cancelledAt: string | null; createdAt: string; rows?: { pinfl?: string; totalTiyin?: string }[] }[] } | null)?.batches ?? []).filter((b) => !b.cancelledAt);
      const active = list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      for (const r of active?.rows ?? []) {
        if (!r.pinfl) continue;
        try {
          tarkib.set(r.pinfl, { total: BigInt(r.totalTiyin ?? '0'), unit });
        } catch {
          /* noto'g'ri qiymat */
        }
      }
    }
    const grouped = await this.prisma.payrollEntry.groupBy({ by: ['employeePinfl'], where: { period, deletedAt: null, batch: { status: 'COMMITTED' } }, _sum: { baseTiyin: true } });
    for (const g of grouped) soliq.set(g.employeePinfl, { total: g._sum.baseTiyin ?? 0n, unit: null });
    if (this.unitPayroll) {
      for (const u of PAYROLL_UNITS) {
        const m = await this.unitPayroll.payrollMap(u, period).catch(() => null);
        if (m) for (const [p, v] of m) soliq.set(p, { total: v, unit: u });
      }
    }
    return { tarkib, soliq, tarkibUploaded: Boolean(batch) || unitRows.length > 0, soliqUploaded: grouped.length > 0 || [...soliq.values()].some((x) => x.unit) };
  }

  /** 23106: shu oy uchun to'langanlar (xizmat safarisiz), xodim bo'yicha */
  private async bank(period: string, mode: BankMonthMode) {
    const store = readStore((await this.prisma.setting.findUnique({ where: { key: STORE_KEY } }))?.value ?? null);
    const by = new Map<string, { kind: PayoutKind; net: bigint; date: string; purpose: string }[]>();
    let months = 0;
    for (const [m, st] of Object.entries(store.months)) {
      if (mode === 'PAID' && m !== period) continue;
      let used = false;
      for (const r of st.rows ?? []) {
        if (r.kind === 'SAFAR') continue;
        const month = mode === 'PAID' ? r.docDate.slice(0, 7) : (purposeMonth(r.purpose ?? '', r.docDate) ?? r.accrual);
        if (month !== period) continue;
        const d = (r.inn ?? '').replace(/\D/g, '');
        const pinfl = r.pinfl ?? (/^\d{14}$/.test(d) ? d : null);
        if (!pinfl) continue;
        let net: bigint;
        try {
          net = BigInt(r.debitTiyin);
        } catch {
          continue;
        }
        used = true;
        const list = by.get(pinfl) ?? [];
        list.push({ kind: r.kind, net, date: r.docDate, purpose: (r.purpose ?? '').slice(0, 300) });
        by.set(pinfl, list);
      }
      if (used) months += 1;
    }
    const uploaded = Boolean(store.months[period]) || months > 0;
    return { by, uploaded };
  }

  // ═══════════ Solishtirma ═══════════

  async view(period: string, modeRaw?: string, tabRaw?: string) {
    if (!PERIOD_RE.test(period ?? '')) throw new BadRequestException("Davr noto'g'ri formatda (YYYY-MM)");
    const mode: BankMonthMode = modeRaw === 'PAID' ? 'PAID' : 'ACCRUAL';
    const tab: SolTab = tabRaw === 'REGION' ? 'REGION' : 'CENTER';
    const [set, f, bank] = await Promise.all([this.settings(), this.fot(period), this.bank(period, mode)]);
    const tol = BigInt(Math.round(set.toleranceSum * 100));
    const pinfls = [...new Set([...f.tarkib.keys(), ...f.soliq.keys(), ...bank.by.keys()])];
    const [emps, locs, regions] = await Promise.all([
      this.prisma.employee.findMany({ where: { pinfl: { in: pinfls } }, select: { pinfl: true, fullName: true, regionCode: true, employmentType: true } }),
      this.prisma.employeeLocation.findMany({ where: { employeePinfl: { in: pinfls }, period }, select: { employeePinfl: true, regionCode: true, employmentType: true } }),
      this.prisma.region.findMany({ select: { code: true, name: true } }),
    ]);
    const empBy = new Map(emps.map((e) => [e.pinfl, e]));
    const locBy = new Map(locs.map((l) => [l.employeePinfl, l]));
    const regName = new Map(regions.map((r) => [r.code, r.name]));
    const staffNames = new Map<string, string>();
    const staff = ((await this.prisma.setting.findUnique({ where: { key: 'unit.staff' } }))?.value ?? {}) as Record<string, { pinfl?: string; fullName?: string }[]>;
    for (const list of Object.values(staff)) for (const s of Array.isArray(list) ? list : []) if (s?.pinfl && s.fullName && !staffNames.has(s.pinfl)) staffNames.set(s.pinfl, s.fullName);

    const allRows = pinfls.map((pinfl) => {
      const e = empBy.get(pinfl);
      const loc = locBy.get(pinfl);
      const t = f.tarkib.get(pinfl);
      const s = f.soliq.get(pinfl);
      const unit = t?.unit ?? s?.unit ?? null;
      const regionCode = loc?.regionCode ?? e?.regionCode ?? null;
      const typeRaw = (loc?.employmentType ?? e?.employmentType ?? null) as string | null;
      const type: 'SHTAT' | 'SHARTNOMA' = typeRaw === 'SHARTNOMA' ? 'SHARTNOMA' : 'SHTAT';
      const group: GroupKey = unit ? 'UNIT' : regionCode === null ? 'UNKNOWN' : regionCode === 0 ? (type === 'SHTAT' ? 'CENTER_SHTAT' : 'CENTER_SHARTNOMA') : type === 'SHTAT' ? 'REGION_SHTAT' : 'REGION_SHARTNOMA';
      // FOT — faqat soliq hisoboti
      const fot = s?.total ?? null;
      const fotSource: 'SOLIQ' | null = s ? 'SOLIQ' : null;
      // Soliq hisoboti − tarkib (tarkib bo'lmasa — butun soliq summasi; soliq bo'lmasa — minus tarkib)
      const tsDiff = t || s ? (s?.total ?? 0n) - (t?.total ?? 0n) : null;
      const tax = fot === null ? null : pct(fot, set.taxPct);
      const union = fot === null ? null : type === 'SHTAT' ? pct(fot, set.unionPct) : 0n;
      const expected = fot === null ? null : fot - tax! - union!;
      const parts = new Map<PayoutKind, { net: bigint; count: number; dates: string[] }>();
      for (const b of bank.by.get(pinfl) ?? []) {
        const x = parts.get(b.kind) ?? { net: 0n, count: 0, dates: [] };
        x.net += b.net;
        x.count += 1;
        x.dates.push(b.date);
        parts.set(b.kind, x);
      }
      const paid = [...parts.values()].reduce((sum, x) => sum + x.net, 0n);
      const hasBank = parts.size > 0;
      const diff = expected === null ? null : paid - expected;
      let state: SolState;
      if (fot === null) state = 'NO_FOT';
      else if (!hasBank) state = expected === 0n ? 'OK' : 'NO_BANK';
      else if (abs(diff!) <= tol) state = 'OK';
      else state = diff! < 0n ? 'LESS' : 'MORE';

      // Sabab taxmini
      let hint: string | null = null;
      if ((state === 'LESS' || state === 'MORE') && fot !== null && fot > 0n) {
        const unionAlt = pct(fot, set.unionPct);
        const near = (x: bigint, y: bigint) => abs(x - y) <= (tol > abs(y) / 200n ? tol : abs(y) / 200n);
        if (type === 'SHTAT' && near(diff!, unionAlt)) hint = "Farq kasaba uyushmasi (2%)ga teng — ushlanmagan: xodim shartnoma asosida bo'lishi mumkin (Xodimlarda turini tekshiring)";
        else if (type === 'SHARTNOMA' && near(-diff!, unionAlt)) hint = "Farq kasaba uyushmasi (2%)ga teng — ushlangan: xodim asosiy shtatda bo'lishi mumkin (Xodimlarda turini tekshiring)";
        else if (near(diff!, tax!)) hint = "Farq daromad solig'iga teng — soliqsiz to'langan bo'lishi mumkin";
        else if (state === 'LESS' && !parts.has('ISH_HAQI')) hint = "Bu oy uchun ish haqi to'lovi ko'chirmada yo'q — qoldiq keyingi oy to'langan yoki boshqa hisobdan o'tgan bo'lishi mumkin";
        else if (state === 'LESS') hint = "Bankdan kam to'langan — avans/qoldiqning bir qismi boshqa oyda, yoki boshqa ushlanma (aliment, qarz …) bor";
        else hint = "Bankdan ko'p to'langan — boshqa oy puli shu oyga kirgan, yoki bu to'lov soliq hisobotida yo'q";
      }
      if (state === 'NO_BANK') hint = mode === 'ACCRUAL' ? "23106 da shu oy uchun to'lov yo'q (boshqa hisob raqamidan to'langan bo'lishi mumkin)" : "23106 da shu oy to'langan pul yo'q";
      if (state === 'NO_FOT') hint = t ? "Soliq hisobotida yo'q — tarkibda bor (soliq hisoboti asosiy: tarkibdagi summa olinmaydi)" : "23106 da to'lov bor, lekin soliq hisobotida ham, ish haqi tarkibida ham yo'q";

      return {
        pinfl,
        fullName: e?.fullName ?? staffNames.get(pinfl) ?? '—',
        inRegistry: Boolean(e),
        group,
        groupLabel: GROUP_LABELS[group],
        unit,
        unitLabel: unit ? entryUnitLabel(unit) : null,
        regionCode,
        regionName: regionCode === null ? null : regionCode === 0 ? 'Markaz' : (regName.get(regionCode) ?? `${regionCode}-hudud`),
        employmentType: type,
        typeKnown: typeRaw === 'SHTAT' || typeRaw === 'SHARTNOMA',
        fotTiyin: fot === null ? null : fot.toString(),
        fotSource,
        tarkibTiyin: t ? t.total.toString() : null,
        soliqTiyin: s ? s.total.toString() : null,
        /** Soliq hisoboti − tarkib */
        tarkibSoliqDiffTiyin: tsDiff === null ? null : tsDiff.toString(),
        /** Markaz tablosi: tarkib kategoriyalari (belgisi bilan) */
        categories: [] as { category: string; label: string; tiyin: string }[],
        /** «To'g'ri» deb tasdiqlash mumkinmi (Markaz: tarkib = soliq hisoboti; Hududlar: 23106 = kutilgan) */
        confirmable: false,
        /** Tasdiq holati: CONFIRMED — tasdiqlangan va o'zgarmagan; CHANGED — tasdiqdan keyin summa o'zgargan */
        confirm: null as null | 'CONFIRMED' | 'CHANGED',
        /** Markaz tablosi: tarkib farqini komponentga yo'naltirish (to'ldiriladi pastda) */
        tarkibFix: null as null | {
          unit: string | null;
          canAllocate: boolean;
          diffTiyin: string;
          suggestion: { componentCode: string; componentName: string; amountTiyin: string; confidence: 'STRONG' | 'WEAK'; reason: string } | null;
          adjustments: { id: string; componentName: string; amountTiyin: string }[];
        },
        taxTiyin: tax === null ? null : tax.toString(),
        unionTiyin: union === null ? null : union.toString(),
        expectedTiyin: expected === null ? null : expected.toString(),
        bankTiyin: paid.toString(),
        bank: [...parts.entries()].map(([kind, x]) => ({ kind, label: KIND_LABELS[kind], netTiyin: x.net.toString(), count: x.count, dates: x.dates.sort() })),
        diffTiyin: diff === null ? null : diff.toString(),
        state,
        hint,
      };
    });

    const isRegion = (r: { group: GroupKey }) => r.group === 'REGION_SHTAT' || r.group === 'REGION_SHARTNOMA';
    // Tasdiqlar (ikkala tablo): tasdiqlangan va o'zgarmagan xodim — umumiy hisobdan chiqadi
    const confirmStore = readConfirm((await this.prisma.setting.findUnique({ where: { key: CONFIRM_KEY } }))?.value ?? null)[period] ?? {};
    const sameAsSnap = (r: (typeof allRows)[number], k: SolTab) => {
      const snap = confirmStore[k]?.rows[r.pinfl];
      return snap ? (snap.soliq === (r.soliqTiyin ?? '') && snap.tarkib === r.tarkibTiyin && snap.bank === r.bankTiyin ? 'CONFIRMED' : 'CHANGED') : null;
    };
    const tabStat = (list: typeof allRows, k: SolTab) => {
      const open = list.filter((r) => sameAsSnap(r, k) !== 'CONFIRMED');
      return { employees: list.length, confirmed: list.length - open.length, problems: open.filter((r) => r.state !== 'OK').length, tarkibDiff: open.filter((r) => r.tarkibSoliqDiffTiyin !== null && abs(BigInt(r.tarkibSoliqDiffTiyin)) > tol).length };
    };
    const tabs = { CENTER: tabStat(allRows.filter((r) => !isRegion(r)), 'CENTER'), REGION: tabStat(allRows.filter(isRegion), 'REGION') };
    const rows = allRows.filter((r) => (tab === 'REGION' ? isRegion(r) : !isRegion(r)));

    // Markaz tablosi: tarkib farqi → qayerga (uchlik nazorat tavsiyasi bilan)
    let components: { code: string; name: string; category: string; categoryLabel: string; sign: number }[] = [];
    const fixScopes: { unit: string | null; label: string; compositionUploaded: boolean }[] = [];
    const compBy = new Map<string, { category: string; sign: number }>();
    // Kategoriyalar uchun: nofaol komponentlar ham (eski tarkibda bo'lishi mumkin)
    for (const c of await this.prisma.salaryComponent.findMany({ select: { code: true, category: true, sign: true } })) compBy.set(c.code, { category: c.category, sign: c.sign });
    if (tab === 'CENTER' && this.reconcile) {
      const scopes = [null, ...new Set(rows.map((r) => r.unit).filter((u): u is string => Boolean(u)))];
      for (const u of scopes) {
        const rv = await this.reconcile.view(period, u ?? undefined).catch(() => null);
        if (!rv) continue;
        if (!components.length) components = rv.components;
        for (const c of rv.components) compBy.set(c.code, c);
        fixScopes.push({ unit: u, label: u ? entryUnitLabel(u) : 'Markaz', compositionUploaded: rv.compositionUploaded });
        const by = new Map(rv.rows.map((x) => [x.pinfl, x]));
        for (const r of rows) {
          if ((r.unit ?? null) !== u) continue;
          const d = r.tarkibSoliqDiffTiyin === null ? 0n : BigInt(r.tarkibSoliqDiffTiyin);
          const x = by.get(r.pinfl);
          if (x) {
            const acc = new Map<string, bigint>();
            for (const [code, v] of Object.entries(x.items)) {
              const c = compBy.get(code);
              const cat = c?.category ?? 'BOSHQA';
              acc.set(cat, (acc.get(cat) ?? 0n) + ((c?.sign ?? 1) < 0 ? -BigInt(v) : BigInt(v)));
            }
            r.categories = CATEGORY_ORDER.filter((k) => acc.get(k)).map((k) => ({ category: k, label: CATEGORY_LABELS[k] ?? k, tiyin: acc.get(k)!.toString() }));
          }
          if (abs(d) <= tol && !x?.adjustments.length) continue;
          r.tarkibFix = {
            unit: u,
            canAllocate: rv.compositionUploaded && abs(d) > tol,
            diffTiyin: d.toString(),
            suggestion: x?.suggestion && x.suggestion.amountTiyin === d.toString() ? x.suggestion : null,
            adjustments: (x?.adjustments ?? []).map((a) => ({ id: a.id, componentName: a.componentName, amountTiyin: a.amountTiyin })),
          };
        }
      }
    }

    const order: Record<SolState, number> = { LESS: 0, MORE: 1, NO_BANK: 2, NO_FOT: 3, OK: 4 };
    rows.sort((a, b) => order[a.state] - order[b.state] || (abs(BigInt(b.diffTiyin ?? b.bankTiyin)) > abs(BigInt(a.diffTiyin ?? a.bankTiyin)) ? 1 : -1) || a.fullName.localeCompare(b.fullName));

    // Tasdiq: tasdiqlash mumkinlar va saqlangan tasdiq bilan solishtirish
    const tabConfirm = confirmStore[tab] ?? null;
    for (const r of rows) {
      const tsOk = r.tarkibTiyin !== null && r.soliqTiyin !== null && abs(BigInt(r.tarkibSoliqDiffTiyin ?? '0')) <= tol;
      r.confirmable = tab === 'CENTER' ? tsOk : r.state === 'OK' && r.soliqTiyin !== null;
      r.confirm = sameAsSnap(r, tab);
    }
    const matched = rows.filter((r) => r.confirmable);
    const catAcc = new Map<string, bigint>();
    for (const r of matched) for (const c of r.categories) catAcc.set(c.category, (catAcc.get(c.category) ?? 0n) + BigInt(c.tiyin));
    const matchedInfo = {
      count: matched.length,
      soliqTiyin: matched.reduce((x, r) => x + BigInt(r.soliqTiyin ?? '0'), 0n).toString(),
      bankTiyin: matched.reduce((x, r) => x + BigInt(r.bankTiyin), 0n).toString(),
      bankOk: matched.filter((r) => r.state === 'OK').length,
      categories: CATEGORY_ORDER.filter((k) => catAcc.get(k)).map((k) => ({ category: k, label: CATEGORY_LABELS[k] ?? k, tiyin: catAcc.get(k)!.toString() })),
      byGroup: (Object.keys(GROUP_LABELS) as GroupKey[]).map((g) => ({ key: g, label: GROUP_LABELS[g], count: matched.filter((r) => r.group === g).length, soliqTiyin: matched.filter((r) => r.group === g).reduce((x, r) => x + BigInt(r.soliqTiyin ?? '0'), 0n).toString() })).filter((g) => g.count > 0),
      confirmed: tabConfirm ? { at: tabConfirm.at, by: tabConfirm.by, count: tabConfirm.count, totalTiyin: tabConfirm.totalTiyin, changed: rows.filter((r) => r.confirm === 'CHANGED').length, missing: Object.keys(tabConfirm.rows).filter((p) => !rows.some((r) => r.pinfl === p)).length } : null,
      unconfirmed: matched.filter((r) => r.confirm !== 'CONFIRMED').length,
    };

    // Umumiy hisob (bo'limchalar, xulosa, hududlar) — tasdiqlanganlarsiz
    const open = rows.filter((r) => r.confirm !== 'CONFIRMED');
    const groups = (Object.keys(GROUP_LABELS) as GroupKey[])
      .map((g) => {
        const list = open.filter((r) => r.group === g);
        const sum = (k: 'fotTiyin' | 'tarkibTiyin' | 'soliqTiyin' | 'taxTiyin' | 'unionTiyin' | 'expectedTiyin' | 'bankTiyin' | 'diffTiyin') => list.reduce((s, r) => s + BigInt(r[k] ?? '0'), 0n).toString();
        return {
          key: g,
          label: GROUP_LABELS[g],
          rule: g === 'UNIT' ? "turi bo'yicha (shtat — kasaba bilan)" : g === 'UNKNOWN' ? '—' : g.endsWith('SHTAT') ? `FOT − ${set.taxPct}% soliq − ${set.unionPct}% kasaba` : `FOT − ${set.taxPct}% soliq`,
          employees: list.length,
          ok: list.filter((r) => r.state === 'OK').length,
          problems: list.filter((r) => r.state !== 'OK').length,
          fotTiyin: sum('fotTiyin'),
          tarkibTiyin: sum('tarkibTiyin'),
          soliqTiyin: sum('soliqTiyin'),
          taxTiyin: sum('taxTiyin'),
          unionTiyin: sum('unionTiyin'),
          expectedTiyin: sum('expectedTiyin'),
          bankTiyin: sum('bankTiyin'),
          // 23106 − kutilgan (FOT'i yo'q xodimning to'lovi ham — butun summa farq)
          diffTiyin: list.reduce((s, r) => s + BigInt(r.bankTiyin) - BigInt(r.expectedTiyin ?? '0'), 0n).toString(),
        };
      })
      .filter((g) => g.employees > 0);

    // Hududlar kesimi (hudud xodimlari)
    const regionAcc = new Map<string, { employees: number; problems: number; expected: bigint; bank: bigint }>();
    for (const r of open) {
      if (r.group !== 'REGION_SHTAT' && r.group !== 'REGION_SHARTNOMA') continue;
      const k = r.regionName ?? '—';
      const x = regionAcc.get(k) ?? { employees: 0, problems: 0, expected: 0n, bank: 0n };
      x.employees += 1;
      if (r.state !== 'OK') x.problems += 1;
      x.expected += BigInt(r.expectedTiyin ?? '0');
      x.bank += BigInt(r.bankTiyin);
      regionAcc.set(k, x);
    }

    const count = (s: SolState) => open.filter((r) => r.state === s).length;
    return {
      period,
      label: monthLabel(period),
      mode,
      /** Eski web bilan moslik: FOT doim soliq hisobotidan */
      fotMode: 'SOLIQ' as const,
      tab,
      tabs,
      components,
      fixScopes,
      matched: matchedInfo,
      settings: set,
      sources: { tarkib: f.tarkibUploaded, soliq: f.soliqUploaded, bank: bank.uploaded },
      summary: {
        employees: open.length,
        /** «To'g'ri» deb tasdiqlangan (umumiy hisobdan chiqqan) */
        confirmed: rows.length - open.length,
        ok: count('OK'),
        less: count('LESS'),
        more: count('MORE'),
        noBank: count('NO_BANK'),
        noFot: count('NO_FOT'),
        /** Tarkibi soliq hisobotidan farq qiladigan xodimlar (ikkalasi bor) */
        tarkibSoliqDiff: open.filter((r) => r.tarkibSoliqDiffTiyin !== null && (BigInt(r.tarkibSoliqDiffTiyin) > tol || BigInt(r.tarkibSoliqDiffTiyin) < -tol)).length,
        fotTiyin: open.reduce((s, r) => s + BigInt(r.fotTiyin ?? '0'), 0n).toString(),
        expectedTiyin: open.reduce((s, r) => s + BigInt(r.expectedTiyin ?? '0'), 0n).toString(),
        bankTiyin: open.reduce((s, r) => s + BigInt(r.bankTiyin), 0n).toString(),
        unknownType: open.filter((r) => r.fotTiyin !== null && !r.typeKnown).length,
      },
      groups,
      regions: [...regionAcc.entries()].sort((a, b) => b[1].problems - a[1].problems || a[0].localeCompare(b[0])).map(([name, x]) => ({ name, employees: x.employees, problems: x.problems, expectedTiyin: x.expected.toString(), bankTiyin: x.bank.toString(), diffTiyin: (x.bank - x.expected).toString() })),
      rows,
    };
  }

  // ═══════════ Tasdiqlash: mos kelganlar «to'g'ri» ═══════════

  /**
   * Tablo bo'yicha mos kelgan xodimlarni «to'g'ri» deb tasdiqlash (pinfls berilmasa — hamma mos kelganlar).
   * O'sha paytdagi summalar saqlanadi: keyin soliq hisoboti, tarkib yoki 23106 o'zgarsa — «o'zgargan» deb ko'rinadi.
   * Avvalgi tasdiq bo'lsa — yangi xodimlar qo'shiladi (eski tasdiqlanganlar yangilanadi).
   */
  async confirm(period: string, tabRaw: string | undefined, mode: string | undefined, body: { pinfls?: unknown }, userId: string) {
    const tab: SolTab = tabRaw === 'REGION' ? 'REGION' : 'CENTER';
    const v = await this.view(period, mode, tab);
    const want = Array.isArray(body?.pinfls) ? new Set(body.pinfls.map(String)) : null;
    const list = v.rows.filter((r) => r.confirmable && (!want || want.has(r.pinfl)));
    if (want) {
      const bad = [...want].filter((p) => !v.rows.some((r) => r.pinfl === p && r.confirmable));
      if (bad.length) throw new BadRequestException(`${bad.length} xodim mos emas (yoki topilmadi) — faqat mos kelganlar tasdiqlanadi`);
    }
    if (!list.length) throw new BadRequestException("Tasdiqlash uchun mos kelgan xodim yo'q");
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }).catch(() => null);
    const out = await runExclusive(`setting:${CONFIRM_KEY}`, async () => {
      const store = readConfirm((await this.prisma.setting.findUnique({ where: { key: CONFIRM_KEY } }))?.value ?? null);
      const prev = store[period]?.[tab];
      const rows: TabConfirm['rows'] = { ...(prev?.rows ?? {}) };
      for (const r of list) rows[r.pinfl] = { soliq: r.soliqTiyin ?? '', tarkib: r.tarkibTiyin, bank: r.bankTiyin };
      const total = Object.values(rows).reduce((x, r) => x + BigInt(r.soliq || '0'), 0n);
      const entry: TabConfirm = { at: new Date().toISOString(), by: user?.fullName ?? '', count: Object.keys(rows).length, totalTiyin: total.toString(), rows };
      store[period] = { ...(store[period] ?? {}), [tab]: entry };
      // Eng ko'pi 36 oy saqlanadi
      const keys = Object.keys(store).sort();
      for (const k of keys.slice(0, Math.max(0, keys.length - 36))) delete store[k];
      const value = { periods: store } as unknown as object;
      await this.prisma.setting.upsert({ where: { key: CONFIRM_KEY }, create: { key: CONFIRM_KEY, value }, update: { value } });
      return entry;
    });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'payroll_solishtirma', entityId: `${tab}:${period}`, summary: `Ish haqi solishtirma ${monthLabel(period)} (${tab === 'CENTER' ? 'Markaz' : 'Hududlar'}): ${list.length} xodim «to'g'ri» deb tasdiqlandi (jami tasdiqlangan ${out.count})` });
    return { success: true as const, confirmed: list.length, total: out.count };
  }

  async cancelConfirm(period: string, tabRaw: string | undefined, userId: string) {
    if (!PERIOD_RE.test(period ?? '')) throw new BadRequestException("Davr noto'g'ri formatda (YYYY-MM)");
    const tab: SolTab = tabRaw === 'REGION' ? 'REGION' : 'CENTER';
    const removed = await runExclusive(`setting:${CONFIRM_KEY}`, async () => {
      const store = readConfirm((await this.prisma.setting.findUnique({ where: { key: CONFIRM_KEY } }))?.value ?? null);
      const prev = store[period]?.[tab];
      if (!prev) throw new BadRequestException('Bu oy uchun tasdiq yo\'q');
      delete store[period]![tab];
      if (!Object.keys(store[period]!).length) delete store[period];
      const value = { periods: store } as unknown as object;
      await this.prisma.setting.upsert({ where: { key: CONFIRM_KEY }, create: { key: CONFIRM_KEY, value }, update: { value } });
      return prev.count;
    });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'payroll_solishtirma', entityId: `${tab}:${period}`, summary: `Ish haqi solishtirma ${monthLabel(period)} (${tab === 'CENTER' ? 'Markaz' : 'Hududlar'}): tasdiq bekor qilindi (${removed} xodim)` });
    return { success: true as const, removed };
  }
}
