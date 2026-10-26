import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { runExclusive } from '../../common/locks';
import { monthLabel } from '../../common/period';
import { entryUnitLabel } from '../../common/segments/segments';
import { bankMonthOf, KIND_LABELS, kindComponents, type PayoutKind } from '../acc-23106/acc23106.purpose';
import { readStore, STORE_KEY } from '../acc-23106/acc23106.store';
import { AuditService } from '../audit/audit.service';
import { PayrollService } from '../payroll/payroll.service';
import { PrismaService } from '../prisma/prisma.service';
import { UnitPayrollService } from '../unit-payroll/unit-payroll.service';
import { DIFF_TOLERANCE_TIYIN } from './salary-composition.constants';
import { SalaryCompositionService } from './salary-composition.service';

// ═══════════════════════════════════════════════════════════
// Ish haqi tarkibi › Uchlik nazorat: TARKIB · SOLIQ HISOBOTI · 23106 (bank).
//
// Har xodim, shu oy:
//  • tarkib — komponentlar va jami (hisoblangan, soliqdan oldin);
//  • soliq hisoboti — shu oy hisoblangan daromad (4-ilova, «hisobot davrida»);
//  • 23106 — bankdan to'langanlar (bayram, mukofot, moddiy yordam, ta'til …), hisoblangan oyi shu oy bo'lganlari;
//    bank summasi soliqdan KEYINGI («qo'lga»), shuning uchun soliqdan oldingi taxmini ham ko'rsatiladi (÷ 0,88).
// Farq (soliq − tarkib) bo'lsa — qayerga o'tkazish TAVSIYA qilinadi: 23106 da shu oy to'langan, lekin tarkibda yo'q
// turdagi to'lov bo'lsa (masalan, mukofot) — o'sha komponent. Foydalanuvchi komponentni tanlab «O'tkazish»ni bosadi:
// farq tarkibning shu komponentiga qo'shiladi (tarkib = soliq hisoboti). Har o'tkazish yoziladi va bekor qilinadi.
// Tarkib qayta yuklansa — eski o'tkazishlar o'z-o'zidan eskiradi (yangi tarkibda yo'q), bekor qilish kerak emas.
// Saqlash: tarkib jadvallari (umumiy) yoki settings (yo'nalish); o'tkazishlar tarixi — settings «salary.composition.adjust».
// ═══════════════════════════════════════════════════════════

export const ADJUST_KEY = 'salary.composition.adjust';
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const NET_RATE = 0.88; // jismoniy shaxs daromad solig'i 12%
const MAX_ITEMS = 2000;

/** To'lov turi → odatdagi komponent (birinchi faoli) */
const KIND_DEFAULT: Partial<Record<PayoutKind, string[]>> = {
  BAYRAM: ['BAYRAM'],
  MUKOFOT: ['PREMIYA_BOSHQA', 'KPI', 'CHORAK'],
  MODDIY: ['MODDIY', 'MODDIY_OKLAD'],
  TATIL: ['TATIL', 'TATIL_KOMP'],
  KASALLIK: ['KASALLIK'],
};

export type ReconState = 'OK' | 'DIFF' | 'NO_TARKIB' | 'NO_SOLIQ' | 'BANK' | 'NO_PAYROLL';

export interface BankPart {
  kind: PayoutKind;
  label: string;
  /** Bankdan to'langan (soliqdan keyin) */
  netTiyin: string;
  /** Soliqdan oldingi taxmin (÷ 0,88) */
  grossTiyin: string;
  count: number;
  dates: string[];
  orders: string[];
  /** Tarkibda shu turdagi komponentlar jami (null — tarkib bilan solishtirilmaydigan tur) */
  tarkibTiyin: string | null;
  /** OK · MISSING (tarkibda yo'q) · OVER (tarkibdagidan ko'p to'langan) · NA */
  state: 'OK' | 'MISSING' | 'OVER' | 'NA';
}

export interface Suggestion {
  componentCode: string;
  componentName: string;
  amountTiyin: string;
  /** STRONG — farq bank to'lovining soliqdan oldingi summasiga mos; WEAK — tur mos, summa taxminiy */
  confidence: 'STRONG' | 'WEAK';
  reason: string;
}

export interface Adjustment {
  id: string;
  period: string;
  unit: string | null;
  batchId: string;
  pinfl: string;
  fullName: string;
  componentCode: string;
  componentName: string;
  /** Tarkib jamiga qo'shilgan (manfiy — ayirilgan) */
  amountTiyin: string;
  /** Tarkibda qator yo'q edi — yangi qator yaratildi */
  createdRow: boolean;
  note: string | null;
  source: 'SUGGESTION' | 'MANUAL';
  createdAt: string;
  createdBy: string;
  status: 'APPLIED' | 'UNDONE' | 'STALE';
  undoneAt: string | null;
  /** Bo'lim sahifasidan, lekin xodim tarkibi umumiy tarkibdan bog'langan — umumiy tarkibga yozilgan */
  viaUnit?: string | null;
}

interface UnitRow {
  pinfl: string;
  fullName: string | null;
  workedDays: number | null;
  rate: number | null;
  totalTiyin: string;
  items: Record<string, string>;
}
interface UnitBatch {
  id: string;
  cancelledAt: string | null;
  createdAt: string;
  totalTiyin: string;
  employeeCount: number;
  status: string;
  mismatchCount: number;
  payrollTiyin: string;
  rows: UnitRow[];
}

const abs = (v: bigint) => (v < 0n ? -v : v);
const gross = (net: bigint) => BigInt(Math.round(Number(net) / NET_RATE));

function readAdjust(raw: unknown): Adjustment[] {
  const list = (raw as { items?: unknown } | null)?.items;
  return Array.isArray(list) ? (list as Adjustment[]).filter((a) => a && typeof a.id === 'string') : [];
}

@Injectable()
export class CompositionReconcileService {
  private readonly logger = new Logger(CompositionReconcileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly composition: SalaryCompositionService,
    private readonly payrollService: PayrollService,
    private readonly audit: AuditService,
    @Optional() private readonly unitPayroll?: UnitPayrollService,
  ) {}

  private assertPeriod(period: string) {
    if (!PERIOD_RE.test(period ?? '')) throw new BadRequestException("Davr noto'g'ri formatda (YYYY-MM)");
  }

  private async adjustments(): Promise<Adjustment[]> {
    return readAdjust((await this.prisma.setting.findUnique({ where: { key: ADJUST_KEY } }))?.value ?? null);
  }

  /** 23106: hisoblangan oyi shu oy bo'lgan to'lovlar, xodim bo'yicha (xizmat safari — tarkibga kirmaydi, olinmaydi) */
  private async bank(period: string): Promise<{ uploaded: boolean; byPinfl: Map<string, { kind: PayoutKind; net: bigint; date: string; order: string | null }[]> }> {
    const store = readStore((await this.prisma.setting.findUnique({ where: { key: STORE_KEY } }))?.value ?? null);
    const byPinfl = new Map<string, { kind: PayoutKind; net: bigint; date: string; order: string | null }[]>();
    let uploaded = false;
    for (const m of Object.values(store.months)) {
      for (const r of m.rows ?? []) {
        // Qaysi oy uchun — hamma modul bilan bir xil qoida (solishtirma bilan bir xil); xizmat safari — hisobga olinmaydi
        if (r.kind === 'SAFAR') continue;
        if (bankMonthOf(r, 'ACCRUAL') !== period) continue;
        uploaded = true;
        const d = (r.inn ?? '').replace(/\D/g, '');
        const pinfl = r.pinfl ?? (/^\d{14}$/.test(d) ? d : null);
        if (!pinfl) continue;
        let net: bigint;
        try {
          net = BigInt(r.debitTiyin);
        } catch {
          continue;
        }
        const list = byPinfl.get(pinfl) ?? [];
        list.push({ kind: r.kind, net, date: r.docDate, order: r.orderNo ? `${r.orderNo}${r.orderDate ? ` (${r.orderDate.split('-').reverse().join('.')})` : ''}` : null });
        byPinfl.set(pinfl, list);
      }
    }
    // Shu oyga tegishli to'lov bo'lmasa ham — oy ko'chirmasi saqlangan bo'lsa «yuklangan»
    if (!uploaded) uploaded = Boolean(store.months[period]);
    return { uploaded, byPinfl };
  }

  // ═══════════ Ko'rish ═══════════

  async view(period: string, unit?: string) {
    this.assertPeriod(period);
    const [v, bank, adjusts] = await Promise.all([this.composition.view(period, unit), this.bank(period), this.adjustments()]);
    const comps = v.components;
    const compBy = new Map(comps.map((c) => [c.code, c]));
    const active = comps.filter((c) => c.isActive);
    const defaultFor = (kind: PayoutKind): string | null => {
      const pref = (KIND_DEFAULT[kind] ?? []).find((code) => compBy.get(code)?.isActive);
      if (pref) return pref;
      const set = kindComponents(kind, active);
      return set && set.size ? [...set][0]! : null;
    };

    type Person = { pinfl: string; fullName: string; items: Record<string, string>; tarkib: bigint | null; soliq: bigint | null };
    const people = new Map<string, Person>();
    for (const r of v.rows) people.set(r.pinfl, { pinfl: r.pinfl, fullName: r.fullName, items: r.items, tarkib: BigInt(r.totalTiyin), soliq: r.payrollTiyin === null ? null : BigInt(r.payrollTiyin) });
    for (const m of v.check.missingInComposition) if (!people.has(m.pinfl)) people.set(m.pinfl, { pinfl: m.pinfl, fullName: m.fullName, items: {}, tarkib: null, soliq: BigInt(m.payrollTiyin) });
    const payrollUploaded = v.check.payrollUploaded;
    const compositionUploaded = v.check.compositionUploaded;

    const rows = [...people.values()].map((p) => {
      const parts = new Map<PayoutKind, { net: bigint; count: number; dates: string[]; orders: string[] }>();
      for (const b of bank.byPinfl.get(p.pinfl) ?? []) {
        const x = parts.get(b.kind) ?? { net: 0n, count: 0, dates: [], orders: [] };
        x.net += b.net;
        x.count += 1;
        x.dates.push(b.date);
        if (b.order && !x.orders.includes(b.order)) x.orders.push(b.order);
        parts.set(b.kind, x);
      }
      const bankParts: BankPart[] = [...parts.entries()].map(([kind, x]) => {
        const codes = kindComponents(kind, comps);
        let tarkib: bigint | null = null;
        let state: BankPart['state'] = 'NA';
        if (codes && p.tarkib !== null) {
          tarkib = 0n;
          for (const c of codes) tarkib += BigInt(p.items[c] ?? '0');
          state = tarkib === 0n ? 'MISSING' : x.net > tarkib + DIFF_TOLERANCE_TIYIN ? 'OVER' : 'OK';
        } else if (codes && p.tarkib === null) state = 'MISSING';
        return { kind, label: KIND_LABELS[kind], netTiyin: x.net.toString(), grossTiyin: gross(x.net).toString(), count: x.count, dates: x.dates.sort(), orders: x.orders, tarkibTiyin: tarkib === null ? null : tarkib.toString(), state };
      });

      const diff = p.soliq !== null ? p.soliq - (p.tarkib ?? 0n) : p.tarkib !== null && payrollUploaded ? -p.tarkib : null;
      const hasDiff = diff !== null && abs(diff) > DIFF_TOLERANCE_TIYIN;
      let state: ReconState;
      if (!payrollUploaded) state = 'NO_PAYROLL';
      else if (p.tarkib === null) state = 'NO_TARKIB';
      else if (p.soliq === null) state = p.tarkib === 0n ? 'OK' : 'NO_SOLIQ';
      else if (hasDiff) state = 'DIFF';
      else state = bankParts.some((b) => b.state === 'MISSING' || b.state === 'OVER') ? 'BANK' : 'OK';

      // Tavsiya: farqni qaysi komponentga
      let suggestion: Suggestion | null = null;
      if (hasDiff && diff! > 0n) {
        const missing = bankParts.filter((b) => b.state === 'MISSING');
        const pick = (b: BankPart) => defaultFor(b.kind);
        // 1) bitta tur farqqa (soliqdan oldingi taxmin yoki to'g'ridan-to'g'ri) mos
        const tol = (x: bigint) => (abs(x) / 66n > 100_000n ? abs(x) / 66n : 100_000n); // ~1,5% yoki 1 000 so'm
        const exact = missing.find((b) => abs(BigInt(b.grossTiyin) - diff!) <= tol(diff!) || abs(BigInt(b.netTiyin) - diff!) <= DIFF_TOLERANCE_TIYIN);
        const chosen = exact ?? (missing.length === 1 ? missing[0] : null);
        const code = chosen ? pick(chosen) : null;
        if (chosen && code) {
          suggestion = {
            componentCode: code,
            componentName: compBy.get(code)?.name ?? code,
            amountTiyin: diff!.toString(),
            confidence: exact ? 'STRONG' : 'WEAK',
            reason: exact
              ? `23106: ${chosen.label.toLowerCase()} to'langan (${chosen.count} ta), tarkibda yo'q — soliqdan oldingi summasi farqqa mos`
              : `23106: ${chosen.label.toLowerCase()} to'langan, tarkibda yo'q — summa taxminiy, tekshiring`,
          };
        }
      }

      const history = adjusts.filter((a) => a.period === period && (a.unit ?? null) === (unit ?? null) && a.pinfl === p.pinfl && a.status === 'APPLIED' && a.batchId === v.batch?.id);
      return {
        pinfl: p.pinfl,
        fullName: p.fullName,
        tarkibTiyin: p.tarkib === null ? null : p.tarkib.toString(),
        soliqTiyin: p.soliq === null ? null : p.soliq.toString(),
        diffTiyin: diff === null ? null : diff.toString(),
        state,
        items: p.items,
        bank: bankParts,
        bankNetTiyin: bankParts.reduce((s, b) => s + BigInt(b.netTiyin), 0n).toString(),
        suggestion,
        adjustments: history.map((a) => ({ id: a.id, componentCode: a.componentCode, componentName: a.componentName, amountTiyin: a.amountTiyin, createdAt: a.createdAt, createdBy: a.createdBy })),
      };
    });

    const order: Record<ReconState, number> = { DIFF: 0, NO_TARKIB: 1, NO_SOLIQ: 2, BANK: 3, NO_PAYROLL: 4, OK: 5 };
    rows.sort((a, b) => order[a.state] - order[b.state] || (abs(BigInt(b.diffTiyin ?? '0')) > abs(BigInt(a.diffTiyin ?? '0')) ? 1 : -1) || a.fullName.localeCompare(b.fullName));
    const count = (s: ReconState) => rows.filter((r) => r.state === s).length;
    const sumDiff = rows.filter((r) => r.state === 'DIFF' || r.state === 'NO_TARKIB' || r.state === 'NO_SOLIQ').reduce((s, r) => s + BigInt(r.diffTiyin ?? '0'), 0n);
    return {
      period,
      unit: unit ?? null,
      unitLabel: unit ? entryUnitLabel(unit) : null,
      batchId: v.batch?.id ?? null,
      compositionUploaded,
      payrollUploaded,
      bankUploaded: bank.uploaded,
      summary: {
        employees: rows.length,
        ok: count('OK'),
        diff: count('DIFF'),
        noTarkib: count('NO_TARKIB'),
        noSoliq: count('NO_SOLIQ'),
        bank: count('BANK'),
        diffTiyin: sumDiff.toString(),
        suggested: rows.filter((r) => r.suggestion).length,
        strong: rows.filter((r) => r.suggestion?.confidence === 'STRONG').length,
        tarkibTiyin: v.check.compositionTiyin,
        soliqTiyin: v.check.payrollTiyin,
        bankNetTiyin: rows.reduce((s, r) => s + BigInt(r.bankNetTiyin), 0n).toString(),
      },
      components: active.map((c) => ({ code: c.code, name: c.name, category: c.category, categoryLabel: c.categoryLabel, sign: c.sign })),
      rows,
      history: adjusts
        .filter((a) => a.period === period && ((a.unit ?? null) === (unit ?? null) || (unit !== undefined && a.viaUnit === unit)))
        .reverse()
        .slice(0, 200)
        .map((a) => ({ ...a, current: a.status === 'APPLIED' && (a.batchId === v.batch?.id || (Boolean(a.viaUnit) && a.batchId === v.linkedGeneral?.batchId)) })),
    };
  }

  // ═══════════ O'tkazish ═══════════

  /**
   * Farqni tarkib komponentiga o'tkazish (bir yoki bir nechta xodim): items: [{ pinfl, componentCode, amountTiyin, note? }].
   * amountTiyin — tarkib JAMIsiga qo'shiladigan summa (manfiy — ayiriladi); komponent summasi belgisi bilan o'zgaradi.
   * Komponent summasi manfiy bo'lib qolmaydi. Hammasi bitta tranzaksiyada (biri xato — hech biri yozilmaydi).
   */
  async allocate(period: string, unit: string | undefined, body: { items?: unknown }, userId: string) {
    this.assertPeriod(period);
    if (!Array.isArray(body?.items) || !body.items.length) throw new BadRequestException("O'tkazish uchun kamida bitta xodimni tanlang");
    if (body.items.length > MAX_ITEMS) throw new BadRequestException(`Juda ko'p — ${MAX_ITEMS} tagacha`);
    const components = await this.prisma.salaryComponent.findMany({ select: { code: true, name: true, sign: true, isActive: true } });
    const compBy = new Map(components.map((c) => [c.code, c]));
    const seen = new Set<string>();
    const want = (body.items as Record<string, unknown>[]).map((x) => {
      const pinfl = typeof x?.pinfl === 'string' ? x.pinfl.trim() : '';
      if (!/^\d{14}$/.test(pinfl)) throw new BadRequestException(`PINFL noto'g'ri: ${String(x?.pinfl ?? '').slice(0, 20)}`);
      if (seen.has(pinfl)) throw new BadRequestException(`PINFL takrorlangan: ${pinfl}`);
      seen.add(pinfl);
      const code = typeof x?.componentCode === 'string' ? x.componentCode : '';
      const comp = compBy.get(code);
      if (!comp || !comp.isActive) throw new BadRequestException(`Komponent topilmadi yoki faol emas: ${code.slice(0, 40)}`);
      let amount: bigint;
      try {
        amount = BigInt(String(x?.amountTiyin ?? ''));
      } catch {
        throw new BadRequestException(`Summa noto'g'ri: ${pinfl}`);
      }
      if (amount === 0n) throw new BadRequestException(`Summa nol: ${pinfl}`);
      const note = typeof x?.note === 'string' && x.note.trim() ? x.note.trim().slice(0, 300) : null;
      const source: Adjustment['source'] = x?.source === 'SUGGESTION' ? 'SUGGESTION' : 'MANUAL';
      return { pinfl, comp, amount, note, source };
    });
    // Bo'lim sahifasida umumiy tarkibdan bog'langan xodimlar — farq umumiy tarkibga yoziladi (bitta joyda)
    let viaUnit: string | null = null;
    if (unit) {
      const uv = await this.composition.view(period, unit);
      const gen = new Set(uv.rows.filter((r) => r.fromGeneral).map((r) => r.pinfl));
      const g = want.filter((w) => gen.has(w.pinfl)).length;
      if (g && g < want.length) throw new BadRequestException(`Tanlanganlardan ${g} tasi tarkibi umumiy tarkibdan, qolgani ${entryUnitLabel(unit)} o'z tarkibidan — alohida-alohida o'tkazing`);
      if (g) {
        viaUnit = unit;
        unit = undefined;
      }
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }).catch(() => null);
    const names = await this.names(want.map((w) => w.pinfl));

    const lockKey = unit ? `setting:unit.composition.${unit}.${period}` : `composition:${period}`;
    const out = await runExclusive(lockKey, () =>
      runExclusive(`setting:${ADJUST_KEY}`, async () => {
        const now = new Date().toISOString();
        const made: Adjustment[] = [];
        if (unit) {
          const key = `unit.composition.${unit}.${period}`;
          await this.prisma.$transaction(async (tx) => {
            const list = ((await tx.setting.findUnique({ where: { key } }))?.value as { batches?: UnitBatch[] } | null)?.batches ?? [];
            const batch = list.filter((b) => !b.cancelledAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
            if (!batch) throw new BadRequestException(`${entryUnitLabel(unit)}: shu oy ish haqi tarkibi yuklanmagan — avval tarkibni yuklang`);
            for (const w of want) {
              let row = batch.rows.find((r) => r.pinfl === w.pinfl);
              const createdRow = !row;
              if (!row) {
                row = { pinfl: w.pinfl, fullName: names.get(w.pinfl) ?? null, workedDays: null, rate: null, totalTiyin: '0', items: {} };
                batch.rows.push(row);
              }
              const next = BigInt(row.items[w.comp.code] ?? '0') + (w.comp.sign < 0 ? -w.amount : w.amount);
              if (next < 0n) throw new BadRequestException(`${row.fullName ?? w.pinfl}: «${w.comp.name}» manfiy bo'lib qoladi — summani kamaytiring`);
              if (next === 0n) delete row.items[w.comp.code];
              else row.items[w.comp.code] = next.toString();
              row.totalTiyin = (BigInt(row.totalTiyin) + w.amount).toString();
              batch.totalTiyin = (BigInt(batch.totalTiyin) + w.amount).toString();
              made.push(this.record(period, unit, batch.id, w, row.fullName ?? names.get(w.pinfl) ?? w.pinfl, createdRow, now, user?.fullName ?? ''));
            }
            batch.employeeCount = batch.rows.length;
            const value = { ...((await tx.setting.findUnique({ where: { key } }))?.value as object), batches: list } as object;
            await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
            await this.saveAdjust(tx, made);
          });
        } else {
          await this.prisma.$transaction(
            async (tx) => {
              const batch = await tx.salaryCompositionBatch.findFirst({ where: { period, cancelledAt: null }, orderBy: { createdAt: 'desc' } });
              if (!batch) throw new BadRequestException('Shu oy ish haqi tarkibi yuklanmagan — avval tarkibni yuklang');
              let total = batch.totalTiyin;
              let added = 0;
              for (const w of want) {
                let row = await tx.salaryCompositionRow.findUnique({ where: { batchId_employeePinfl: { batchId: batch.id, employeePinfl: w.pinfl } } });
                const createdRow = !row;
                if (!row) {
                  row = await tx.salaryCompositionRow.create({ data: { batchId: batch.id, period, employeePinfl: w.pinfl, fullName: names.get(w.pinfl) ?? null, totalTiyin: 0n } });
                  added += 1;
                }
                const item = await tx.salaryCompositionItem.findUnique({ where: { rowId_componentCode: { rowId: row.id, componentCode: w.comp.code } } });
                const next = (item?.amountTiyin ?? 0n) + (w.comp.sign < 0 ? -w.amount : w.amount);
                if (next < 0n) throw new BadRequestException(`${row.fullName ?? w.pinfl}: «${w.comp.name}» manfiy bo'lib qoladi — summani kamaytiring`);
                if (item && next === 0n) await tx.salaryCompositionItem.delete({ where: { id: item.id } });
                else if (item) await tx.salaryCompositionItem.update({ where: { id: item.id }, data: { amountTiyin: next } });
                else await tx.salaryCompositionItem.create({ data: { batchId: batch.id, rowId: row.id, componentCode: w.comp.code, amountTiyin: next } });
                await tx.salaryCompositionRow.update({ where: { id: row.id }, data: { totalTiyin: row.totalTiyin + w.amount } });
                total += w.amount;
                made.push({ ...this.record(period, null, batch.id, w, row.fullName ?? names.get(w.pinfl) ?? w.pinfl, createdRow, now, user?.fullName ?? ''), ...(viaUnit ? { viaUnit } : {}) });
              }
              await tx.salaryCompositionBatch.update({ where: { id: batch.id }, data: { totalTiyin: total, employeeCount: batch.employeeCount + added } });
              await this.saveAdjust(tx, made);
            },
            { timeout: 60_000, maxWait: 10_000 },
          );
        }
        return made;
      }),
    );

    await this.afterChange(period, unit);
    const total = out.reduce((s, a) => s + BigInt(a.amountTiyin), 0n);
    await this.audit.log({
      userId,
      action: 'UPDATE',
      entity: 'salary_composition_adjust',
      entityId: `${unit ?? viaUnit ?? 'CENTER'}:${period}`,
      summary: `Ish haqi tarkibi${unit ? ` (${entryUnitLabel(unit)})` : viaUnit ? ` (${entryUnitLabel(viaUnit)} — umumiy tarkibda)` : ''} ${monthLabel(period)}: ${out.length} xodim farqi komponentga o'tkazildi — ${(Number(total) / 100).toLocaleString('uz-UZ')} so'm (${[...new Set(out.map((a) => a.componentName))].join(', ')})`,
    });
    return { success: true as const, count: out.length, totalTiyin: total.toString(), ids: out.map((a) => a.id) };
  }

  /** O'tkazishni bekor qilish — tarkib avvalgi holatiga qaytadi (tarkib shu yuklash bo'lsa) */
  async undo(id: string, userId: string) {
    const all = await this.adjustments();
    const a = all.find((x) => x.id === id);
    if (!a) throw new NotFoundException("O'tkazish topilmadi");
    if (a.status !== 'APPLIED') throw new BadRequestException(a.status === 'UNDONE' ? 'Bu o\'tkazish allaqachon bekor qilingan' : "Tarkib qayta yuklangan — bu o'tkazish eskirgan");
    const unit = a.unit ?? undefined;
    const lockKey = unit ? `setting:unit.composition.${unit}.${a.period}` : `composition:${a.period}`;
    const sign = (await this.prisma.salaryComponent.findUnique({ where: { code: a.componentCode }, select: { sign: true } }))?.sign ?? 1;
    const amount = BigInt(a.amountTiyin);
    const delta = sign < 0 ? -amount : amount;

    const result = await runExclusive(lockKey, () =>
      runExclusive(`setting:${ADJUST_KEY}`, async () => {
        return this.prisma.$transaction(async (tx) => {
          const list = readAdjust((await tx.setting.findUnique({ where: { key: ADJUST_KEY } }))?.value ?? null);
          const cur = list.find((x) => x.id === id)!;
          // Navbat ichida qayta tekshiriladi — ikki marta bosilsa, ikki marta ayirilmasin
          if (!cur || cur.status !== 'APPLIED') throw new BadRequestException("Bu o'tkazish allaqachon bekor qilingan");
          let stale = false;
          if (unit) {
            const key = `unit.composition.${unit}.${a.period}`;
            const raw = (await tx.setting.findUnique({ where: { key } }))?.value as { batches?: UnitBatch[] } | null;
            const batches = raw?.batches ?? [];
            const batch = batches.find((b) => b.id === a.batchId && !b.cancelledAt);
            const row = batch?.rows.find((r) => r.pinfl === a.pinfl);
            if (!batch || !row) stale = true;
            else {
              const next = BigInt(row.items[a.componentCode] ?? '0') - delta;
              if (next < 0n) throw new BadRequestException(`«${a.componentName}» summasi keyin o'zgargan — bekor qilib bo'lmaydi`);
              if (next === 0n) delete row.items[a.componentCode];
              else row.items[a.componentCode] = next.toString();
              row.totalTiyin = (BigInt(row.totalTiyin) - amount).toString();
              batch.totalTiyin = (BigInt(batch.totalTiyin) - amount).toString();
              if (a.createdRow && !Object.keys(row.items).length && row.totalTiyin === '0') batch.rows = batch.rows.filter((r) => r !== row);
              batch.employeeCount = batch.rows.length;
              const value = { ...(raw as object), batches } as object;
              await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
            }
          } else {
            const batch = await tx.salaryCompositionBatch.findUnique({ where: { id: a.batchId } });
            const row = batch && !batch.cancelledAt ? await tx.salaryCompositionRow.findUnique({ where: { batchId_employeePinfl: { batchId: batch.id, employeePinfl: a.pinfl } } }) : null;
            if (!batch || batch.cancelledAt || !row) stale = true;
            else {
              const item = await tx.salaryCompositionItem.findUnique({ where: { rowId_componentCode: { rowId: row.id, componentCode: a.componentCode } } });
              const next = (item?.amountTiyin ?? 0n) - delta;
              if (next < 0n) throw new BadRequestException(`«${a.componentName}» summasi keyin o'zgargan — bekor qilib bo'lmaydi`);
              if (item && next === 0n) await tx.salaryCompositionItem.delete({ where: { id: item.id } });
              else if (item) await tx.salaryCompositionItem.update({ where: { id: item.id }, data: { amountTiyin: next } });
              else if (next > 0n) await tx.salaryCompositionItem.create({ data: { batchId: batch.id, rowId: row.id, componentCode: a.componentCode, amountTiyin: next } });
              const left = await tx.salaryCompositionItem.count({ where: { rowId: row.id } });
              const newTotal = row.totalTiyin - amount;
              let removed = 0;
              if (a.createdRow && left === 0 && newTotal === 0n) {
                await tx.salaryCompositionRow.delete({ where: { id: row.id } });
                removed = 1;
              } else await tx.salaryCompositionRow.update({ where: { id: row.id }, data: { totalTiyin: newTotal } });
              await tx.salaryCompositionBatch.update({ where: { id: batch.id }, data: { totalTiyin: batch.totalTiyin - amount, employeeCount: batch.employeeCount - removed } });
            }
          }
          cur.status = stale ? 'STALE' : 'UNDONE';
          cur.undoneAt = new Date().toISOString();
          const value = { items: list } as object;
          await tx.setting.upsert({ where: { key: ADJUST_KEY }, create: { key: ADJUST_KEY, value }, update: { value } });
          return { stale };
        });
      }),
    );
    if (result.stale) throw new BadRequestException("Tarkib qayta yuklangan — bu o'tkazish eskirgan (yangi tarkibda yo'q)");
    await this.afterChange(a.period, unit);
    await this.audit.log({ userId, action: 'UPDATE', entity: 'salary_composition_adjust', entityId: id, summary: `Ish haqi tarkibi ${monthLabel(a.period)}: ${a.fullName} — «${a.componentName}»ga o'tkazilgan ${(Number(amount) / 100).toLocaleString('uz-UZ')} so'm bekor qilindi` });
    return { success: true as const };
  }

  // ═══════════ Yordamchilar ═══════════

  private record(period: string, unit: string | null, batchId: string, w: { pinfl: string; comp: { code: string; name: string }; amount: bigint; note: string | null; source: Adjustment['source'] }, fullName: string, createdRow: boolean, now: string, by: string): Adjustment {
    return { id: randomUUID(), period, unit, batchId, pinfl: w.pinfl, fullName, componentCode: w.comp.code, componentName: w.comp.name, amountTiyin: w.amount.toString(), createdRow, note: w.note, source: w.source, createdAt: now, createdBy: by, status: 'APPLIED', undoneAt: null };
  }

  private async saveAdjust(tx: { setting: PrismaService['setting'] }, made: Adjustment[]) {
    const list = readAdjust((await tx.setting.findUnique({ where: { key: ADJUST_KEY } }))?.value ?? null);
    list.push(...made);
    // Eng ko'pi 5000 ta (eskilari — bekor qilingan / eskirganlari — tashlanadi)
    const kept = list.length > 5000 ? [...list.filter((a) => a.status === 'APPLIED'), ...list.filter((a) => a.status !== 'APPLIED').slice(-1000)].slice(-5000) : list;
    const value = { items: kept } as object;
    await tx.setting.upsert({ where: { key: ADJUST_KEY }, create: { key: ADJUST_KEY, value }, update: { value } });
  }

  private async names(pinfls: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const e of await this.prisma.employee.findMany({ where: { pinfl: { in: pinfls } }, select: { pinfl: true, fullName: true } })) out.set(e.pinfl, e.fullName);
    const staff = ((await this.prisma.setting.findUnique({ where: { key: 'unit.staff' } }))?.value ?? {}) as Record<string, { pinfl?: string; fullName?: string }[]>;
    for (const list of Object.values(staff)) for (const s of Array.isArray(list) ? list : []) if (s?.pinfl && s.fullName && !out.has(s.pinfl)) out.set(s.pinfl, s.fullName);
    return out;
  }

  /** Tarkib o'zgardi: holat (mos / farq) yangilanadi; Markaz ulushi yoki bo'lim ish haqi qismlari qayta hisoblanadi */
  private async afterChange(period: string, unit?: string) {
    if (unit) {
      const check = await this.composition.check(period, unit).catch(() => null);
      if (check) {
        const key = `unit.composition.${unit}.${period}`;
        await runExclusive(`setting:${key}`, async () => {
          const raw = (await this.prisma.setting.findUnique({ where: { key } }))?.value as { batches?: UnitBatch[] } | null;
          const batch = (raw?.batches ?? []).filter((b) => !b.cancelledAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
          if (!batch) return;
          batch.status = check.state === 'MATCHED' ? 'MATCHED' : check.state === 'MISMATCH' ? 'MISMATCH' : 'NO_PAYROLL';
          batch.mismatchCount = check.mismatchCount;
          batch.payrollTiyin = check.payrollTiyin;
          const value = raw as object;
          await this.prisma.setting.update({ where: { key }, data: { value } });
        }).catch(() => null);
      }
      await this.unitPayroll?.splitComponents(unit, period).catch(() => null);
      return;
    }
    await this.composition.check(period).catch(() => null);
    await this.payrollService.regroup(period).catch((error: unknown) => {
      this.logger.warn(`Ish haqi Markaz ulushi qayta hisoblanmadi (${period}): ${(error as Error).message}`);
    });
    // Umumiy tarkib bo'limlarga ham bog'langan — ularning ajratmasi ham yangilanadi
    await this.composition.resplitUnits(period).catch(() => null);
  }
}
