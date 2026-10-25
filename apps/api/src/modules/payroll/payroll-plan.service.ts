import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { entryUnitLabel } from '../../common/segments/segments';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { isPayrollUnit, PAYROLL_UNITS, UnitPayrollService, type PayrollUnit } from '../unit-payroll/unit-payroll.service';
import { PayrollService, type MissingRow } from './payroll.service';
import { assertAmount } from '../../common/validation/amount';
import { hrPeople } from '../hr-sheets/hr-sheets.store';

// ═══════════════════════════════════════════════════════════
// Umumiy vedomost (Xarajatlar › Ish haqi) — bo'limlar bilan birga.
//
// Fayl yuklanganda har xodim uchun qayerga yozilishi aniqlanadi:
//  • Shu oy bo'lim sahifasida (Tax free, Fermer, Buxgalteriya, Marksheyder) ALLAQACHON yuklangan bo'lsa —
//    olinmaydi (ogohlantirish: qaysi bo'limda, nechta, qancha). Ish haqi ikki marta sanalmaydi.
//  • Bo'limga tegishli bo'lsa («miya»: ko'chishlar, bo'lim ro'yxati, Xodimlar bazasidagi bo'limi, ma'lumotnomalar),
//    lekin bo'limga hali yuklanmagan — o'sha bo'lim ish haqiga avtomatik yoziladi.
//  • Qolganlari — avvalgidek umumiy vedomost (Markaz bo'limlari, hududlar, shartnoma).
//  • Reestrda ham, bo'limlarda ham yo'q — olinmaydi (avvalgidek «Reestrda topilmadi»).
// Saqlashdan oldin har xodimning bo'limini o'zgartirish yoki uni olib tashlash mumkin.
// Bo'limi o'zgartirilsa — «miya»ga ko'chish yoziladi (shu oydan boshlab yangi bo'limida).
// Umumiy yuklash bekor qilinsa — undan bo'limlarga yozilganlari ham bekor bo'ladi.
// ═══════════════════════════════════════════════════════════

export type PlanTarget = 'GENERAL' | 'SKIP' | PayrollUnit;
const isTarget = (t: unknown): t is PlanTarget => t === 'GENERAL' || t === 'SKIP' || isPayrollUnit(t);

export interface PlanRow {
  pinfl: string;
  rowIndex: number | null;
  fullName: string | null;
  /** Xodimlar bazasidagi joyi (Markaz bo'limi / hudud) */
  place: string | null;
  amountTiyin: string;
  inRegistry: boolean;
  /** «Miya» bo'yicha shu oydagi bo'limi (CENTER, REGION yoki yo'nalish) */
  unitNow: string | null;
  unitNowLabel: string | null;
  /** Tizim taklifi */
  suggested: PlanTarget;
  /** Tanlangan (saqlanadigan) joy */
  target: PlanTarget;
  /** Bo'limga allaqachon yuklangan — o'zgartirib bo'lmaydi, olinmaydi */
  locked: { unit: string; label: string; amountTiyin: string } | null;
  /** Saqlab bo'lmasa — sababi */
  problem: string | null;
  /** Soliq hisobotidan: oylik (4-ilova) va boshqa daromad (5-ilova) */
  parts?: { salaryTiyin: string; otherTiyin: string };
  /**
   * «Miya»da bormi: MIYA — Xodimlar bazasi, bo'lim ro'yxatlari yoki ko'chishlarda; HR_ONLY — faqat katta jadvallarda
   * (10/16/37/51); NONE — hech qayerda yo'q (masalan fermer xo'jaliklari buxgalterlari — bizning xarajat emas)
   */
  presence: 'MIYA' | 'HR_ONLY' | 'NONE';
}

interface InputRow {
  pinfl?: unknown;
  amountTiyin?: unknown;
  target?: unknown;
  fullName?: unknown;
  rowIndex?: unknown;
}

const unitLabel = (u: string) => (u === 'GENERAL' ? 'Umumiy vedomost' : u === 'SKIP' ? 'Olinmaydi' : entryUnitLabel(u));

@Injectable()
export class PayrollPlanService {
  private readonly logger = new Logger(PayrollPlanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payroll: PayrollService,
    private readonly units: UnitPayrollService,
    private readonly audit: AuditService,
  ) {}

  /** Qatorlarni tekshirish va birlashtirish (bir PINFL — bitta qator) */
  private clean(rows: InputRow[]): Map<string, { amount: bigint; target: PlanTarget | null; fullName: string | null; rowIndex: number | null }> {
    if (!Array.isArray(rows) || !rows.length) throw new BadRequestException("Saqlash uchun ma'lumot yo'q");
    if (rows.length > 10_000) throw new BadRequestException('Qatorlar juda ko‘p — 10 000 tagacha');
    const out = new Map<string, { amount: bigint; target: PlanTarget | null; fullName: string | null; rowIndex: number | null }>();
    for (const r of rows) {
      const pinfl = String(r?.pinfl ?? '').replace(/\D/g, '');
      if (!/^\d{14}$/.test(pinfl)) throw new BadRequestException(`Noto'g'ri PINFL: ${String(r?.pinfl ?? '').slice(0, 20)}`);
      let amount: bigint;
      try {
        amount = BigInt(String(r?.amountTiyin ?? '0'));
      } catch {
        throw new BadRequestException(`Noto'g'ri summa: ${pinfl}`);
      }
      if (amount < 0n) throw new BadRequestException(`Manfiy summa: ${pinfl}`);
      assertAmount(amount, pinfl);
      const name = typeof r?.fullName === 'string' && r.fullName.trim() ? r.fullName.trim().replace(/\s+/g, ' ').slice(0, 160) : null;
      const prev = out.get(pinfl);
      out.set(pinfl, {
        amount: (prev?.amount ?? 0n) + amount,
        target: isTarget(r?.target) ? r.target : (prev?.target ?? null),
        fullName: name ?? prev?.fullName ?? null,
        rowIndex: prev?.rowIndex ?? (Number.isInteger(r?.rowIndex) ? (r!.rowIndex as number) : null),
      });
    }
    return out;
  }

  /**
   * Reja: har xodim qayerga, jamilar. targets berilmasa — tizim taklifi.
   * strict (soliq hisoboti): faqat «miya»dagi xodimlar olinadi — hech qayerda yo'q odam (miyada ham, katta jadvallarda ham)
   * tanlov qanday bo'lmasin olinmaydi va alohida ko'rsatiladi.
   */
  async plan(period: string, rows: InputRow[], opts: { strict?: boolean } = {}) {
    const input = this.clean(rows);
    const pinfls = [...input.keys()];
    const [unitsNow, uploaded, names, registry, hr] = await Promise.all([
      this.units.unitsAt(pinfls, period),
      this.units.uploadedIn(period),
      this.units.namesFor(pinfls, period),
      this.prisma.employee.findMany({ where: { pinfl: { in: pinfls } }, select: { pinfl: true } }),
      hrPeople(this.prisma).catch(() => new Map()),
    ]);
    const inRegistry = new Set(registry.map((e) => e.pinfl));
    const generalAll = await this.payroll.previewGeneral(
      period,
      pinfls.filter((p) => inRegistry.has(p)).map((p) => ({ pinfl: p, amountTiyin: input.get(p)!.amount })),
    );

    const out: PlanRow[] = pinfls.map((pinfl) => {
      const v = input.get(pinfl)!;
      const up = uploaded.get(pinfl);
      const now = unitsNow.get(pinfl) ?? null;
      const reg = inRegistry.has(pinfl);
      const presence: PlanRow['presence'] = now || reg ? 'MIYA' : hr.has(pinfl) ? 'HR_ONLY' : 'NONE';
      const suggested: PlanTarget = up ? 'SKIP' : now && isPayrollUnit(now) ? now : reg ? 'GENERAL' : 'SKIP';
      let target: PlanTarget = up ? 'SKIP' : (v.target ?? suggested);
      const fullName = names.get(pinfl)?.fullName ?? v.fullName ?? null;
      let problem: string | null = null;
      if (up) problem = `${entryUnitLabel(up.unit)} bo'limiga shu oy yuklangan — olinmaydi`;
      else if (opts.strict && presence === 'NONE') {
        problem = "Miyada ham, katta jadvallarda (10/16/37/51) ham yo'q — hisobga olinmaydi";
        target = 'SKIP';
      }
      else if (target === 'GENERAL' && !reg) {
        problem = 'Xodimlar reestrida yo‘q — umumiy vedomostga yozib bo‘lmaydi (bo‘limni tanlang yoki reestrga qo‘shing)';
        target = 'SKIP';
      } else if (isPayrollUnit(target) && !fullName) problem = 'F.I.Sh. noma’lum — kiriting';
      else if (target === 'SKIP' && presence === 'HR_ONLY') problem = 'Faqat katta jadvallarda bor (Xodimlar bazasida va bo‘limlarda yo‘q) — olinmaydi; kerak bo‘lsa bo‘limini tanlang';
      else if (target === 'SKIP' && presence === 'NONE') problem = "Miyada ham, katta jadvallarda (10/16/37/51) ham yo'q — olinmaydi";
      return {
        pinfl,
        rowIndex: v.rowIndex,
        fullName,
        place: generalAll.places.get(pinfl) ?? null,
        amountTiyin: v.amount.toString(),
        inRegistry: reg,
        unitNow: now,
        unitNowLabel: now ? entryUnitLabel(now) : null,
        suggested,
        target,
        locked: up ? { unit: up.unit, label: entryUnitLabel(up.unit), amountTiyin: up.amountTiyin.toString() } : null,
        problem,
        presence,
      };
    });

    const general = await this.payroll.previewGeneral(
      period,
      out.filter((r) => r.target === 'GENERAL').map((r) => ({ pinfl: r.pinfl, amountTiyin: BigInt(r.amountTiyin) })),
    );
    const sum = (list: PlanRow[]) => list.reduce((s, r) => s + BigInt(r.amountTiyin), 0n).toString();
    const unitParts = PAYROLL_UNITS.map((u) => {
      const list = out.filter((r) => r.target === u);
      return { unit: u, label: entryUnitLabel(u), count: list.length, totalTiyin: sum(list), zeroCount: list.filter((r) => r.amountTiyin === '0').length, unnamed: list.filter((r) => !r.fullName).length };
    });
    const lockedRows = out.filter((r) => r.locked);
    const lockedByUnit = PAYROLL_UNITS.map((u) => {
      const list = lockedRows.filter((r) => r.locked!.unit === u);
      return { unit: u, label: entryUnitLabel(u), count: list.length, fileTiyin: sum(list), uploadedTiyin: list.reduce((s, r) => s + BigInt(r.locked!.amountTiyin), 0n).toString() };
    }).filter((x) => x.count > 0);
    const skipped = out.filter((r) => r.target === 'SKIP' && !r.locked);
    const changed = out.filter((r) => !r.locked && r.target !== r.suggested);

    return {
      period,
      rows: out,
      summary: {
        total: out.length,
        totalTiyin: sum(out),
        general: { count: general.count, zeroCount: general.zeroCount, totalTiyin: general.totalTiyin.toString(), groups: general.groups.map((g) => ({ ...g, totalTiyin: g.totalTiyin.toString() })) },
        units: unitParts,
        locked: { count: lockedRows.length, fileTiyin: sum(lockedRows), byUnit: lockedByUnit },
        skipped: { count: skipped.length, totalTiyin: sum(skipped) },
        changed: changed.length,
        /** «Miya»da yo'q (hech qayerda) va faqat katta jadvallarda bor — olinmagan */
        notInMiya: { count: out.filter((r) => r.presence === 'NONE' && r.target === 'SKIP').length, totalTiyin: sum(out.filter((r) => r.presence === 'NONE' && r.target === 'SKIP')) },
        hrOnly: { count: out.filter((r) => r.presence === 'HR_ONLY' && r.target === 'SKIP').length, totalTiyin: sum(out.filter((r) => r.presence === 'HR_ONLY' && r.target === 'SKIP')) },
        strict: Boolean(opts.strict),
        /** Saqlashga to'sqinlik qiladiganlar (F.I.Sh. yo'q) */
        blocking: out.filter((r) => isPayrollUnit(r.target) && !r.fullName).length,
      },
    };
  }

  /** Fayl tahlili + reja. format: auto (shablon yoki soliq hisoboti), ndfl — faqat soliq hisoboti */
  async analyze(period: string, file: Express.Multer.File, format: 'auto' | 'ndfl' = 'auto') {
    const a = await this.payroll.analyze(period, file, format);
    // Soliq hisobotida F.I.Sh. bor — reestrda yo'q xodimni bo'limga yozishda ism so'ralmaydi
    const nameOf = (pinfl: string) => a.ndflPeople.get(pinfl)?.fullName ?? undefined;
    const rows: InputRow[] = [
      ...a.rows.map((r) => ({ pinfl: r.pinfl, amountTiyin: String(r.amountTiyin), fullName: nameOf(r.pinfl) })),
      ...a.missing.map((m) => ({ pinfl: m.pinfl, amountTiyin: String(m.amountTiyin ?? '0'), rowIndex: m.rowIndex, fullName: nameOf(m.pinfl) })),
    ];
    // Soliq hisoboti — faqat «miya»dagi xodimlar
    const plan = await this.plan(period, rows, { strict: Boolean(a.ndfl) });
    // Har xodim: oylik (4-ilova) va boshqa daromad (5-ilova) — ekranda ko'rsatish uchun
    if (a.ndfl) {
      for (const r of plan.rows) {
        const p = a.ndflPeople.get(r.pinfl);
        if (p) r.parts = { salaryTiyin: p.salaryTiyin.toString(), otherTiyin: p.otherTiyin.toString() };
      }
    }
    return {
      ndfl: a.ndfl,
      fileName: a.fileName,
      totalRows: a.totalRows,
      invalidRows: a.invalidRows,
      duplicates: a.duplicates,
      hasPrevious: a.hasPrevious,
      previousCount: a.previousCount,
      ...plan,
    };
  }

  /**
   * Saqlash: umumiy qism — umumiy vedomost; bo'limlarga tushganlar — har bo'lim ish haqiga alohida yuklash
   * (manbasi: umumiy vedomost). Biror qadam xato bersa — shu saqlashda yaratilganlar bekor qilinadi.
   */
  async commit(period: string, body: { rows?: unknown; fileName?: unknown; strict?: unknown }, replacePrevious: boolean, userId: string) {
    const fileName = typeof body?.fileName === 'string' && body.fileName.trim() ? body.fileName.trim().slice(0, 200) : 'ish-haqi.xlsx';
    const plan = await this.plan(period, (body?.rows ?? []) as InputRow[], { strict: body?.strict === true });
    const blocking = plan.rows.filter((r) => isPayrollUnit(r.target) && !r.fullName);
    if (blocking.length) throw new BadRequestException(`${blocking.length} ta xodimning F.I.Sh. noma'lum — bo'limga yozish uchun kiriting`);
    const general = plan.rows.filter((r) => r.target === 'GENERAL');
    const byUnit = PAYROLL_UNITS.map((u) => ({ unit: u, rows: plan.rows.filter((r) => r.target === u) })).filter((x) => x.rows.length);
    if (!general.length && !byUnit.length) throw new BadRequestException("Saqlanadigan xodim yo'q — hammasi olib tashlangan yoki bo'limlarga allaqachon yuklangan");

    // Almashtirish: avvalgi umumiy yuklashlar (va ulardan bo'limlarga yozilganlar) — yangisi saqlangandan keyin bekor
    const prevIds = replacePrevious ? (await this.prisma.payrollBatch.findMany({ where: { period, status: 'COMMITTED', scope: 'ALL' }, select: { id: true } })).map((b) => b.id) : [];

    const created: { unit: string; batchId: string }[] = [];
    let generalResult: Awaited<ReturnType<PayrollService['commit']>> | null = null;
    try {
      if (general.length) {
        const missing: MissingRow[] = plan.rows.filter((r) => r.target === 'SKIP' && !r.inRegistry && !r.locked).map((r) => ({ rowIndex: r.rowIndex ?? 0, pinfl: r.pinfl }));
        // Umumiy vedomost o'zi avvalgi umumiy yuklashlarni almashtiradi (bitta tranzaksiyada)
        generalResult = await this.payroll.commit({
          period,
          rows: general.map((r) => ({ pinfl: r.pinfl, amountTiyin: BigInt(r.amountTiyin) })),
          userId,
          replacePrevious,
          fileName,
          missing,
        });
        for (const id of prevIds) await this.units.cancelByGeneral(id, period, userId);
      } else {
        // Umumiy qism bo'sh — avvalgi umumiy yuklashlar baribir almashtiriladi
        for (const id of prevIds) await this.payroll.cancel(id);
      }
      for (const { unit, rows } of byUnit) {
        const r = await this.units.commit(
          unit,
          period,
          { rows: rows.map((x) => ({ pinfl: x.pinfl, amountTiyin: x.amountTiyin, fullName: x.fullName })), fileName: `${fileName} (umumiy vedomostdan)` },
          false,
          userId,
          { origin: 'GENERAL', generalBatchId: generalResult?.batchId ?? null },
        );
        created.push({ unit, batchId: r.batchId });
      }
    } catch (e) {
      // Orqaga: shu saqlashda yaratilganlar bekor
      for (const c of created) await this.units.cancel(c.unit, period, c.batchId, userId).catch(() => null);
      if (generalResult) await this.payroll.cancel(generalResult.batchId).catch(() => null);
      throw e;
    }

    // «Miya»: bo'limi o'zgartirilganlar — shu oydan yangi bo'limida
    let moved = 0;
    for (const r of plan.rows) {
      if (r.locked || r.target === 'SKIP' || r.target === r.suggested) continue;
      const to = r.target === 'GENERAL' ? (await this.registryUnit(r.pinfl)) : r.target;
      if (!to || to === r.unitNow) continue;
      const ok = await this.units.addMove({ pinfl: r.pinfl, unit: to, from: period, fullName: r.fullName ?? undefined, note: 'Umumiy vedomost yuklashda bo‘limi o‘zgartirildi' }, userId, 'UPLOAD').then(
        () => true,
        () => false,
      );
      if (ok) moved += 1;
    }

    const unitsOut = byUnit.map(({ unit, rows }) => ({ unit, label: entryUnitLabel(unit), employees: rows.length, totalTiyin: rows.reduce((s, r) => s + BigInt(r.amountTiyin), 0n).toString() }));
    await this.audit
      .log({
        userId,
        action: 'IMPORT',
        entity: 'payroll_plan',
        entityId: generalResult?.batchId ?? period,
        summary: `Umumiy vedomost ${period} (${fileName}): umumiyga ${general.length}, bo'limlarga ${unitsOut.map((u) => `${u.label} ${u.employees}`).join(', ') || '—'}; olinmadi ${plan.summary.skipped.count + plan.summary.locked.count}${moved ? `; bo'limi o'zgartirildi ${moved}` : ''}`.slice(0, 500),
      })
      .catch(() => null);

    return {
      success: true as const,
      general: generalResult
        ? { batchId: generalResult.batchId, employees: generalResult.employees, zeroCount: generalResult.zeroCount, totalTiyin: generalResult.totalTiyin.toString(), expensesCreated: generalResult.expensesCreated, replacedPrevious: generalResult.replacedPrevious }
        : null,
      units: unitsOut,
      skipped: plan.summary.skipped.count,
      locked: plan.summary.locked.count,
      moved,
    };
  }

  /** Umumiyga o'tkazilganda — Xodimlar bazasidagi joyi bo'yicha Markaz yoki Hududlar */
  private async registryUnit(pinfl: string): Promise<string | null> {
    const e = await this.prisma.employee.findUnique({ where: { pinfl }, select: { regionCode: true } });
    if (!e) return null;
    return e.regionCode === 0 ? 'CENTER' : 'REGION';
  }

  /** Ekran uchun: maqsad nomi */
  static targetLabel(t: string): string {
    return unitLabel(t);
  }
}