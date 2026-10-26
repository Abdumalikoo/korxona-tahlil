import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import type ExcelJS from 'exceljs';
import { runExclusive } from '../../common/locks';
import { monthLabel } from '../../common/period';
import { entryUnitLabel } from '../../common/segments/segments';
import { AuditService } from '../audit/audit.service';
import { PayrollPlanService } from '../payroll/payroll-plan.service';
import { COMPOSITION_PLACE_KEY, PayrollService } from '../payroll/payroll.service';
import { PrismaService } from '../prisma/prisma.service';
import { PAYROLL_UNITS, UnitPayrollService, membership } from '../unit-payroll/unit-payroll.service';
import { SourceArchiveService } from '../source-archive/source-archive.service';
import type { UnitMove } from '../unit-payroll/unit-payroll.service';
import { PayrollFactsService } from '../payroll-facts/payroll-facts.service';

// ═══════════════════════════════════════════════════════════
// Ish haqi tarkibi › «Tarkibdagi bo'limlar» — xodim o'sha oyda qaysi bo'limda ishlagani (tarkib faylidan).
//
// Tarkib faylida (Markaz vedomosti) har xodimning bo'limi so'z bilan yozilgan («Hududi» ustuni: AUP, Call markaz,
// Tax free …). «Miya» (manba) yangi — ilgari boshqa bo'limda ishlab, keyin o'tganlar uchun eski oylarda noto'g'ri joy
// ko'rsatadi. Shuning uchun:
//  1) tarkibdagi bo'lim nomi → bizdagi bo'lim (Xodimlar › bo'limlar) — dastur taklif qiladi, foydalanuvchi tasdiqlaydi
//     yoki o'zgartiradi; tasdiqlangan moslik eslab qolinadi (settings «salary.composition.deptNames»);
//  2) miyadagi joyi tarkibdan farq qiladigan xodimlar ko'rsatiladi; belgilanganlar saqlanganda FAQAT SHU OY uchun
//     tarkibdagidek bo'ladi: yo'nalish o'zgarsa — «miya»ga shu oy ko'chishi va keyingi oydan qaytishi yoziladi;
//     Markaz ichida bo'lim o'zgarsa — shu oy bo'limi (settings «salary.composition.place.<oy>»), ish haqi xarajatlari
//     shu bo'lim bo'yicha qayta guruhlanadi;
//  3) shu oy umumiy vedomost (soliq hisoboti) saqlangan bo'lsa — qayta taqsimlanadi (summa o'sha, joyi to'g'rilanadi).
// Tarkib bekor qilinsa — shu oy o'zgarishlari ham bekor. Hammasi tarix (audit) bilan.
// ═══════════════════════════════════════════════════════════

export const DEPT_NAMES_KEY = 'salary.composition.deptNames';
const SKIP = 'SKIP';
const MAX_LEARNED = 500;

/** Bo'lim ustuni sarlavhasi */
const DEPT_HEADER_RE = /^(hududi?|худуди?|bo.?limi?|bo.?limlar|булими?|бўлими?|bo.?linma(si)?|бўлинма(си)?|отдел|подразделение|структурное подразделение|ish joyi|иш жойи)(?:[\s/().,:;-].{0,40})?$/iu;

const TR: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h' };

/** Bo'lim nomini solishtirish kaliti: lotin, kichik harf, tutuq belgisiz, x = h, «bo'limi» so'zisiz */
export function deptKey(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[а-яёўқғҳ]/g, (ch) => TR[ch] ?? ch)
    .replace(/[‘’ʻʼ`'"«»]/g, '')
    .replace(/x/g, 'h')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(bolimi|bolim|bolinmasi|bolinma|otdel)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const words = (k: string) => [...new Set(k.split(' ').filter((w) => w.length >= 3))];
/** So'zlar mos: biri ikkinchisining boshi («mah» — «mahsulotlar», «men» — «menejerlari») yoki o'zagi (5 harf) bir xil */
const sameWord = (a: string, b: string) => a.startsWith(b) || b.startsWith(a) || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));

/** O'xshashlik 0..1 (a — tarkibdagi nom, b — bizdagi bo'lim): aynan / qisqartirilgan (boshi bir xil) / so'zlar bo'yicha */
export function deptScore(a: string, b: string): number {
  const x = deptKey(a);
  const y = deptKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  // Tarkibdagi nom kesilgan («… ko'rsatishni muvofiql») — kuchli; bizdagi nom tarkibdagining boshi (ortiqcha so'z bor) — kuchsizroq
  if (x.length >= 4 && y.startsWith(x)) return 0.93 + 0.05 * (x.length / y.length);
  if (y.length >= 4 && x.startsWith(y)) return 0.8 + 0.05 * (y.length / x.length);
  // So'zlar bo'yicha: qisqartmalar ham (kirillcha «мах.ни мувоф-риш» — «mahsulotlarni muvofiqlashtirish»)
  const A = words(x);
  const B = words(y);
  if (!A.length || !B.length) return 0;
  const used = new Set<number>();
  let hit = 0;
  for (const t of A) {
    const j = B.findIndex((u, i) => !used.has(i) && sameWord(t, u));
    if (j >= 0) {
      used.add(j);
      hit += 1;
    }
  }
  return (hit / Math.max(A.length, B.length)) * 0.9;
}

/** Eng mos bo'lim (bir xil ballilar bo'lsa — aniqlanmaydi) */
export function matchDepartment(name: string, deps: { id: string; name: string }[]): { id: string; score: number } | null {
  let best: { id: string; score: number } | null = null;
  let tie = false;
  for (const d of deps) {
    const sc = deptScore(name, d.name);
    if (!best || sc > best.score + 1e-9) {
      best = { id: d.id, score: sc };
      tie = false;
    } else if (Math.abs(sc - best.score) <= 1e-9) tie = true;
  }
  return best && best.score >= 0.34 && !tie ? best : null;
}

/** Varaqdan bo'lim ustunini topish: sarlavhasi «Hududi / Bo'lim / Отдел …» va qiymatlari takrorlanuvchi matn */
export function findDeptColumn(ws: ExcelJS.Worksheet, dataStart: number, pinflCol: number, text: (v: ExcelJS.CellValue) => string): { col: number; label: string } | null {
  const candidates: { col: number; label: string; prio: number }[] = [];
  for (let r = 1; r < dataStart && r <= 30; r++) {
    const row = ws.getRow(r);
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      if (col === pinflCol) return;
      const t = text(cell.value).replace(/\s+/g, ' ').trim();
      if (t && DEPT_HEADER_RE.test(t)) candidates.push({ col, label: t, prio: /bo.?lim|булим|отдел|подраздел|bo.?linma|бўлинма/i.test(t) ? 0 : 1 });
    });
  }
  candidates.sort((a, b) => a.prio - b.prio);
  for (const c of candidates) {
    let filled = 0;
    let rows = 0;
    const distinct = new Set<string>();
    for (let r = dataStart; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (!/^\d{14}$/.test(text(row.getCell(pinflCol).value).replace(/\D/g, ''))) continue;
      rows += 1;
      const v = text(row.getCell(c.col).value).trim();
      if (!v || /^[\d\s.,-]+$/.test(v)) continue;
      filled += 1;
      distinct.add(deptKey(v));
    }
    if (rows && filled / rows >= 0.5 && distinct.size <= Math.max(40, rows * 0.4)) return { col: c.col, label: c.label };
  }
  return null;
}

export interface PlaceFix {
  pinfl: string;
  fullName: string;
  /** Tarkibdagi nom */
  deptName: string;
  /** Markaz bo'limi (Markazga — majburiy; yo'nalishga — o'sha bo'lim; hududga — null) */
  departmentId: string | null;
  departmentName: string | null;
  /** Hududga o'tkazilganda — viloyat va (ixtiyoriy) tuman */
  regionCode?: number | null;
  districtId?: string | null;
  placeLabel?: string | null;
  /** MANUAL — bo'lim sahifasida qo'lda tanlangan; yo'q — ish haqi tarkibi bo'yicha */
  source?: 'MANUAL';
  /** Shu oy bo'lgan joy (kiritish bo'limi: CENTER, REGION yoki yo'nalish) */
  unit: string;
  /** O'zgarishdan oldingi joy («miya») */
  fromUnit: string | null;
  fromDepartmentId: string | null;
  fromDepartmentName: string | null;
  /** «Miya»ga yozilgan ko'chishlar (bekor qilish uchun) */
  moveIds: string[];
  /** Ko'chishlar o'rniga yozilgan avvalgilari («miya»da shu oy boshqa ko'chish bor edi) — qaytarishda tiklanadi */
  displacedMoves?: UnitMove[];
  at: string;
  by: string;
}

interface MonthPlace {
  batchId: string | null;
  at: string;
  /** Tarkibdagi bo'lim nomi: pinfl → nom */
  depts: Record<string, string>;
  /** Shu oy o'zgartirilgan joylar */
  fixes: Record<string, PlaceFix>;
}

function readMonth(raw: unknown): MonthPlace {
  const v = (raw ?? {}) as Partial<MonthPlace>;
  return { batchId: typeof v.batchId === 'string' ? v.batchId : null, at: typeof v.at === 'string' ? v.at : '', depts: v.depts && typeof v.depts === 'object' ? v.depts : {}, fixes: v.fixes && typeof v.fixes === 'object' ? v.fixes : {} };
}

const nextPeriod = (p: string) => {
  const [y, m] = p.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

@Injectable()
export class CompositionPlaceService {
  private readonly logger = new Logger(CompositionPlaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly units: UnitPayrollService,
    @Optional() private readonly payroll?: PayrollService,
    @Optional() private readonly plan?: PayrollPlanService,
    @Optional() private readonly archive?: SourceArchiveService,
  ) {}

  /**
   * Shu oy saqlangan tarkibda bo'limlar yo'q bo'lsa — arxivdagi o'sha faylidan o'qiladi (qayta yuklashsiz).
   * Natija: fayl arxivdami va o'qish natijasi (masalan, «Faylda bo'lim ustuni yo'q»).
   */
  private async repairDepts(period: string): Promise<{ archived: boolean; note: string | null }> {
    const batch = await this.prisma.salaryCompositionBatch.findFirst({ where: { period, cancelledAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, fileName: true } });
    if (!batch || !this.archive) return { archived: false, note: null };
    const e = await this.archive.adopt('salary-composition', { period, refId: batch.id, fileName: batch.fileName, unit: null }).catch(() => null);
    return { archived: Boolean(e), note: e?.links?.depts?.note ?? null };
  }

  private async learned(): Promise<Record<string, string>> {
    const v = (await this.prisma.setting.findUnique({ where: { key: DEPT_NAMES_KEY } }))?.value as { map?: Record<string, string> } | null;
    return v?.map && typeof v.map === 'object' ? v.map : {};
  }

  private async month(period: string): Promise<MonthPlace> {
    return readMonth((await this.prisma.setting.findUnique({ where: { key: COMPOSITION_PLACE_KEY(period) } }))?.value ?? null);
  }

  private async saveMonth(period: string, m: MonthPlace) {
    const key = COMPOSITION_PLACE_KEY(period);
    const value = m as unknown as object;
    await this.prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }

  /** Bo'lim → yo'nalish (Tax free bo'limi — Tax free …; bog'lanmagan — Markaz) */
  private async deptUnits(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const u of PAYROLL_UNITS) {
      const l = await this.units.link(u).catch(() => null);
      for (const d of l?.departments ?? []) if (d.selected && !out.has(d.id)) out.set(d.id, u);
    }
    return out;
  }

  /** Bo'limlar ro'yxati (tanlash uchun) — har biri qaysi yo'nalishga tushadi */
  private async options() {
    const [deps, du] = await Promise.all([this.prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }), this.deptUnits()]);
    return deps.map((d) => {
      const unit = du.get(d.id) ?? 'CENTER';
      return { id: d.id, name: d.name, unit, unitLabel: entryUnitLabel(unit) };
    });
  }

  /** «Miya» bo'yicha shu oy joyi: yo'nalish (ko'chishlar bilan) va Markaz bo'limi (shu oy o'zgartirilgan bo'lsa — o'sha) */
  private async miya(pinfls: string[], period: string, month: MonthPlace) {
    const [unitsAt, emps, deps] = await Promise.all([
      this.units.unitsAt(pinfls, period),
      this.prisma.employee.findMany({ where: { pinfl: { in: pinfls } }, select: { pinfl: true, departmentId: true, fullName: true } }),
      this.prisma.department.findMany({ select: { id: true, name: true } }),
    ]);
    const depName = new Map(deps.map((d) => [d.id, d.name]));
    const empBy = new Map(emps.map((e) => [e.pinfl, e]));
    const out = new Map<string, { unit: string | null; departmentId: string | null; departmentName: string | null; fixed: boolean; fullName: string | null }>();
    for (const p of pinfls) {
      const fix = month.fixes[p];
      const depId = fix?.departmentId ?? empBy.get(p)?.departmentId ?? null;
      out.set(p, { unit: unitsAt.get(p) ?? null, departmentId: depId, departmentName: depId ? (depName.get(depId) ?? null) : null, fixed: Boolean(fix), fullName: empBy.get(p)?.fullName ?? null });
    }
    return out;
  }

  // ═══════════ Tahlil ═══════════

  /** Tarkib tahlili uchun: bo'limlar (taklif bilan), tanlash ro'yxati, har xodimning tarkibdagi va miyadagi joyi */
  async analyze(period: string, rows: { pinfl: string; fullName: string; deptName?: string | null }[], column: { letter: string; label: string } | null) {
    const withDept = rows.filter((r) => r.deptName);
    if (!column || !withDept.length) return { column, departments: [], options: [], rows: [] };
    const [options, learned, month] = await Promise.all([this.options(), this.learned(), this.month(period)]);
    const deps = options.map((o) => ({ id: o.id, name: o.name }));
    const optBy = new Map(options.map((o) => [o.id, o]));
    const counts = new Map<string, { name: string; count: number }>();
    for (const r of withDept) {
      const k = deptKey(r.deptName!);
      const c = counts.get(k) ?? { name: r.deptName!.trim(), count: 0 };
      c.count += 1;
      counts.set(k, c);
    }
    const departments = [...counts.entries()]
      .map(([k, c]) => {
        const l = learned[k];
        const m = l && l !== SKIP && optBy.has(l) ? { id: l, score: 1 } : null;
        const g = m ?? (l === SKIP ? null : matchDepartment(c.name, deps));
        const o = g ? optBy.get(g.id)! : null;
        return {
          name: c.name,
          key: k,
          count: c.count,
          departmentId: o?.id ?? null,
          departmentName: o?.name ?? null,
          unit: o?.unit ?? null,
          unitLabel: o?.unitLabel ?? null,
          source: (m ? 'LEARNED' : l === SKIP ? 'SKIPPED' : g ? 'MATCH' : 'NONE') as 'LEARNED' | 'SKIPPED' | 'MATCH' | 'NONE',
          exact: Boolean(g && g.score >= 0.999),
        };
      })
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const miya = await this.miya(withDept.map((r) => r.pinfl), period, month);
    return {
      column,
      departments,
      options,
      rows: withDept.map((r) => {
        const x = miya.get(r.pinfl)!;
        return { pinfl: r.pinfl, fullName: r.fullName, deptName: r.deptName!.trim(), deptKey: deptKey(r.deptName!), miya: { unit: x.unit, unitLabel: x.unit ? entryUnitLabel(x.unit) : null, departmentId: x.departmentId, departmentName: x.departmentName, fixed: x.fixed } };
      }),
    };
  }

  // ═══════════ Saqlash ═══════════

  /**
   * Tarkib saqlangandan keyin: bo'lim nomlari mosligini eslab qolish, shu oy bo'limlarini saqlash va belgilangan
   * xodimlarning joyini shu oy uchun tarkibdagidek qilish.
   * body: { map: { [tarkibdagi nom]: departmentId | 'SKIP' }, apply: string[] (PINFL) }
   */
  async apply(period: string, batchId: string | null, rows: { pinfl: string; fullName: string | null; dept?: string | null }[], body: unknown, userId: string, learn = true) {
    const b = (body && typeof body === 'object' ? body : {}) as { map?: unknown; apply?: unknown };
    const options = await this.options();
    const optBy = new Map(options.map((o) => [o.id, o]));
    // Moslik: nom kaliti → bo'lim
    const map = new Map<string, string>();
    if (b.map && typeof b.map === 'object') {
      for (const [name, v] of Object.entries(b.map as Record<string, unknown>)) {
        if (typeof v !== 'string') continue;
        if (v !== SKIP && !optBy.has(v)) throw new BadRequestException(`«${name.slice(0, 60)}» uchun tanlangan bo'lim topilmadi`);
        map.set(deptKey(name), v);
      }
    }
    const depts: Record<string, string> = {};
    for (const r of rows) if (typeof r.dept === 'string' && r.dept.trim()) depts[r.pinfl] = r.dept.trim().slice(0, 120);
    const want = new Set(Array.isArray(b.apply) ? b.apply.map(String).filter((p) => depts[p]) : []);
    // Tarkib almashtirildi (yangi yuklash) — eski tarkib bo'yicha qilingan joy o'zgarishlari bekor (qo'ldagilari qoladi)
    const prevMonth = await this.month(period);
    if (batchId && prevMonth.batchId && prevMonth.batchId !== batchId) {
      await this.revert(period, null, userId, 'ish haqi tarkibi almashtirildi', (f) => f.source !== 'MANUAL').catch(() => null);
      if (!Object.keys(depts).length) {
        await runExclusive(`setting:${COMPOSITION_PLACE_KEY(period)}`, async () => {
          const m = await this.month(period);
          await this.saveMonth(period, { ...m, batchId, depts: {} });
        });
      }
    }
    if (!Object.keys(depts).length) return { departments: 0, fixed: 0, moved: 0, redistributed: false, warnings: [] as string[] };
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }).catch(() => null);

    // Eslab qolish (faqat foydalanuvchi bergan moslik)
    if (map.size && learn) {
      await runExclusive(`setting:${DEPT_NAMES_KEY}`, async () => {
        const cur = await this.learned();
        for (const [k, v] of map) cur[k] = v;
        const keys = Object.keys(cur);
        for (const k of keys.slice(0, Math.max(0, keys.length - MAX_LEARNED))) delete cur[k];
        const value = { map: cur } as object;
        await this.prisma.setting.upsert({ where: { key: DEPT_NAMES_KEY }, create: { key: DEPT_NAMES_KEY, value }, update: { value } });
      });
    }

    const warnings: string[] = [];
    const result = await runExclusive(`setting:${COMPOSITION_PLACE_KEY(period)}`, async () => {
      const month = await this.month(period);
      month.batchId = batchId;
      month.at = new Date().toISOString();
      month.depts = depts;
      let fixed = 0;
      let moved = 0;
      const touched: PlaceFix[] = [];
      for (const pinfl of want) {
        const depId = map.get(deptKey(depts[pinfl]!));
        if (!depId || depId === SKIP) continue;
        const target = optBy.get(depId)!;
        // Avvalgi o'zgarish bo'lsa — avval bekor (asl joyidan qayta hisoblanadi)
        const prev = month.fixes[pinfl];
        if (prev) {
          await this.undoMoves(prev, userId);
          delete month.fixes[pinfl];
        }
        const before = (await this.miya([pinfl], period, month)).get(pinfl)!;
        const sameUnit = before.unit === target.unit;
        if (sameUnit && (target.unit !== 'CENTER' || before.departmentId === target.id)) continue; // farq yo'q
        const moveIds: string[] = [];
        const displacedMoves: UnitMove[] = [];
        if (!sameUnit) {
          // «Miya»: shu oy — tarkibdagi yo'nalish; keyingi oydan — avvalgi joyi (keyingi oy alohida ko'chish bo'lmasa)
          const next = nextPeriod(period);
          const all = await this.units.allMoves();
          const at = membership(all);
          const nextBefore = at(pinfl, next) ?? before.unit;
          const m = await this.units.addMove({ pinfl, unit: target.unit, from: period, fullName: before.fullName ?? undefined, note: `Ish haqi tarkibi bo'yicha (${monthLabel(period)}, faqat shu oy)` }, userId, 'UPLOAD');
          moveIds.push(m.id);
          if (m.displaced) displacedMoves.push(m.displaced);
          const hasNext = all.some((x) => x.pinfl === pinfl && x.from === next);
          if (!hasNext && nextBefore && nextBefore !== target.unit) {
            const back = await this.units.addMove({ pinfl, unit: nextBefore, from: next, fullName: before.fullName ?? undefined, note: `${monthLabel(period)}dan keyin avvalgi joyiga (ish haqi tarkibi bo'yicha)` }, userId, 'UPLOAD').catch(() => null);
            if (back) moveIds.push(back.id);
          }
          moved += 1;
        }
        const fix: PlaceFix = {
          pinfl,
          fullName: before.fullName ?? rows.find((r) => r.pinfl === pinfl)?.fullName ?? pinfl,
          deptName: depts[pinfl]!,
          departmentId: target.id,
          departmentName: target.name,
          unit: target.unit,
          fromUnit: before.unit,
          fromDepartmentId: before.departmentId,
          fromDepartmentName: before.departmentName,
          moveIds,
          ...(displacedMoves.length ? { displacedMoves } : {}),
          at: month.at,
          by: user?.fullName ?? '',
        };
        month.fixes[pinfl] = fix;
        touched.push(fix);
        fixed += 1;
      }
      await this.saveMonth(period, month);
      return { fixed, moved, touched };
    });

    // Bo'limlar ish haqi qo'lda yuklangan bo'lsa — o'sha sahifadan o'tkaziladi (avtomatik tegilmaydi)
    if (result.touched.length) {
      const uploaded = await this.units.uploadedIn(period).catch(() => new Map<string, { unit: string; amountTiyin: bigint }>());
      for (const f of result.touched) {
        const up = uploaded.get(f.pinfl);
        if (up && up.unit !== f.unit) warnings.push(`${f.fullName}: shu oy ish haqi «${entryUnitLabel(up.unit)}» sahifasida qo'lda yuklangan — o'sha sahifadan «${entryUnitLabel(f.unit)}»ga o'tkazing`);
      }
    }
    const redistributed = result.touched.length ? await this.refresh(period, result.touched.some((f) => f.unit !== f.fromUnit), userId) : false;
    if (result.touched.length) {
      await this.audit.log({
        userId,
        action: 'UPDATE',
        entity: 'composition_place',
        entityId: period,
        summary: `Ish haqi tarkibi ${monthLabel(period)}: ${result.fixed} xodimning shu oydagi joyi tarkibdagidek qilindi (${result.moved} tasi boshqa yo'nalishga)${redistributed ? '; umumiy vedomost qayta taqsimlandi' : ''}`,
      });
    }
    return { departments: new Set(Object.values(depts).map(deptKey)).size, fixed: result.fixed, moved: result.moved, redistributed, warnings };
  }

  private async undoMoves(fix: PlaceFix, userId: string) {
    // O'zi yozgan ko'chishlar olib tashlanadi, ular o'rniga yozilgan avvalgilari tiklanadi («miya» yo'qolmaydi)
    await this.units.undoMoves(fix.moveIds ?? [], fix.displacedMoves ?? [], userId, `ish haqi tarkibi bo'yicha joy qaytarildi (${fix.fullName})`).catch(() => null);
  }

  /** Xarajatlar: yo'nalish o'zgargan bo'lsa — umumiy vedomost qayta taqsimlanadi; faqat bo'lim — qayta guruhlanadi */
  private async refresh(period: string, unitChanged: boolean, userId: string): Promise<boolean> {
    try {
      if (unitChanged && this.plan) {
        const r = await this.plan.redistribute(period, userId);
        if (r) return true;
      }
      await this.payroll?.regroup(period);
    } catch (e) {
      this.logger.warn(`Ish haqi ${period} qayta taqsimlanmadi: ${(e as Error).message}`);
    }
    return false;
  }

  // ═══════════ Ko'rish va bekor qilish ═══════════

  /** Shu oy: tarkibdagi bo'limlar (nechta xodim) va o'zgartirilgan joylar */
  async view(period: string) {
    const m = await this.month(period);
    const counts = new Map<string, number>();
    for (const n of Object.values(m.depts)) counts.set(n, (counts.get(n) ?? 0) + 1);
    return {
      period,
      batchId: m.batchId,
      at: m.at || null,
      departments: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
      fixes: Object.values(m.fixes)
        .sort((a, b) => a.fullName.localeCompare(b.fullName))
        .map((f) => ({ ...f, unitLabel: entryUnitLabel(f.unit), fromUnitLabel: f.fromUnit ? entryUnitLabel(f.fromUnit) : null })),
    };
  }

  /** Tarkibdagi nom → bizdagi bo'lim (eslab qolingan, bo'lmasa — taxminiy moslik); «hisobga olinmasin» — SKIP */
  private async resolver() {
    const [options, learned] = await Promise.all([this.options(), this.learned()]);
    const optBy = new Map(options.map((o) => [o.id, o]));
    const deps = options.map((o) => ({ id: o.id, name: o.name }));
    const cache = new Map<string, { option: (typeof options)[number] | null; skipped: boolean; guessed: boolean }>();
    return (name: string) => {
      const k = deptKey(name);
      const hit = cache.get(k);
      if (hit) return hit;
      const l = learned[k];
      let r: { option: (typeof options)[number] | null; skipped: boolean; guessed: boolean };
      if (l === SKIP) r = { option: null, skipped: true, guessed: false };
      else if (l && optBy.has(l)) r = { option: optBy.get(l)!, skipped: false, guessed: false };
      else {
        const g = matchDepartment(name, deps);
        r = { option: g ? optBy.get(g.id)! : null, skipped: false, guessed: Boolean(g) };
      }
      cache.set(k, r);
      return r;
    };
  }

  /** Shu oy hamma yuklanganlar: umumiy soliq hisoboti, umumiy tarkib va yo'nalishlar tarkibi (xodim bo'yicha) */
  private async sources(period: string) {
    // Hamma sahifa bilan bir xil qoida: soliq hisoboti (umumiy asosiy), bitta tarkib (qo'shilmaydi)
    const facts = new PayrollFactsService(this.prisma, this.units);
    const [sol, tar] = await Promise.all([facts.soliq(period), facts.tarkib(period)]);
    const general = new Map<string, bigint>();
    for (const [p, x] of sol) general.set(p, x.tiyin);
    const tarkib = new Map<string, { total: bigint; source: string }>();
    const unitTarkib = new Map<string, string>();
    for (const [p, t] of tar.map) {
      tarkib.set(p, { total: t.tiyin, source: t.source });
      if (t.source !== 'GENERAL') unitTarkib.set(p, t.source);
      else if (t.alsoIn) unitTarkib.set(p, t.alsoIn);
    }
    return { general, tarkib, unitTarkib };
  }

  /**
   * Bo'lim sahifasi (Tax free …): shu oy «Manbada» (miyadagi asl joyi) va «Ish haqi tarkibida» (yuklangan tarkibdagi
   * bo'lim) yonma-yon. Ikki guruh: manbada shu bo'limdagilar va tarkibda shu bo'limda, manbada boshqa joydagilar.
   */
  async compare(period: string, unit: string) {
    // Bo'limlar yo'q — arxivdagi fayldan (bo'lsa) o'zi o'qiladi
    let source: { archived: boolean; note: string | null } | null = null;
    if (!Object.keys((await this.month(period)).depts).length) source = await this.repairDepts(period);
    const [month, resolve, staff, moves] = await Promise.all([this.month(period), this.resolver(), this.units.staffOf(unit, period), this.units.allMoves()]);
    const fixIds = new Set(Object.values(month.fixes).flatMap((f) => f.moveIds ?? []));
    // Manba (asl) — tarkib bo'yicha qilingan ko'chishlarsiz
    const asl = membership(moves.filter((m) => !fixIds.has(m.id)));
    // Hamma yuklanganlar bir-biriga ulanadi: umumiy tarkib (bo'limlari bilan) + yo'nalishlarning o'z tarkibi;
    // summalar — umumiy soliq hisoboti va bo'limlarda yuklangan vedomostlar
    const sums = await this.sources(period);
    const hasTarkib = Object.keys(month.depts).length > 0 || sums.unitTarkib.size > 0;
    const tarkibOf = (p: string) => {
      const name = month.depts[p];
      if (!name) {
        const own = sums.unitTarkib.get(p);
        if (!own) return null;
        // Umumiy tarkibda bo'limi yo'q, lekin yo'nalishning o'z tarkibida bor — o'sha yo'nalish
        return { deptName: `${entryUnitLabel(own)} tarkibi`, departmentId: null, departmentName: null, unit: own, unitLabel: entryUnitLabel(own), skipped: false, guessed: false, source: 'UNIT' as const };
      }
      const r = resolve(name);
      return { deptName: name, departmentId: r.option?.id ?? null, departmentName: r.option?.name ?? null, unit: r.option?.unit ?? null, unitLabel: r.option?.unitLabel ?? null, skipped: r.skipped, guessed: r.guessed, source: 'GENERAL' as const };
    };
    const pins = new Set<string>(staff.filter((s) => s.active).map((s) => s.pinfl));
    for (const f of Object.values(month.fixes)) if (f.unit === unit || f.fromUnit === unit) pins.add(f.pinfl);
    // Markaz — alohida ro'yxati yo'q: tarkibdagi hamma xodim tekshiriladi (manbada Markazda bo'lganlar qoladi)
    for (const p of Object.keys(month.depts)) if (unit === 'CENTER' || tarkibOf(p)?.unit === unit) pins.add(p);
    for (const [p, u] of sums.unitTarkib) if (u === unit) pins.add(p);
    const list = [...pins];
    const [cur, names, paid] = await Promise.all([
      this.miya(list, period, month),
      this.units.namesFor(list, period).catch(() => new Map<string, { fullName: string; position: string | null }>()),
      this.units.payrollMap(unit, period).catch(() => null),
    ]);
    // Manbadagi asl yo'nalish: ko'chishlar (tarkibnikisiz) yoki ro'yxat
    const baseUnits = await this.units.unitsAt(list, period);
    const rows = list.map((p) => {
      const fix = month.fixes[p] ?? null;
      const c = cur.get(p)!;
      const mUnit = fix ? fix.fromUnit : (asl(p, period) ?? baseUnits.get(p) ?? null);
      const mDeptId = fix ? fix.fromDepartmentId : c.departmentId;
      const mDeptName = fix ? fix.fromDepartmentName : c.departmentName;
      const t = tarkibOf(p);
      let status: 'MOS' | 'FARQ' | 'FIXED' | 'NO_TARKIB' | 'UNKNOWN';
      if (fix) status = 'FIXED';
      else if (!t) status = 'NO_TARKIB';
      else if (!t.unit) status = 'UNKNOWN';
      else status = t.unit === mUnit && (t.unit !== 'CENTER' || t.departmentId === mDeptId) ? 'MOS' : 'FARQ';
      const amount = paid?.get(p);
      const soliq = sums.general.get(p);
      const tk = sums.tarkib.get(p);
      return {
        /** Umumiy soliq hisobotida (Xarajatlar › Ish haqi) */
        soliqTiyin: soliq !== undefined ? soliq.toString() : null,
        /** Ish haqi tarkibida jami (umumiy yoki yo'nalish tarkibi) */
        tarkibTiyin: tk ? tk.total.toString() : null,
        tarkibSource: tk ? tk.source : null,
        pinfl: p,
        fullName: names.get(p)?.fullName ?? c.fullName ?? fix?.fullName ?? p,
        group: (mUnit === unit ? 'HERE' : 'TARKIB_HERE') as 'HERE' | 'TARKIB_HERE',
        manba: { unit: mUnit, unitLabel: mUnit ? entryUnitLabel(mUnit) : null, departmentId: mDeptId, departmentName: mDeptName },
        tarkib: t,
        status,
        fix: fix ? { unit: fix.unit, unitLabel: entryUnitLabel(fix.unit), departmentName: fix.departmentName, placeLabel: fix.placeLabel ?? null, manual: fix.source === 'MANUAL', at: fix.at, by: fix.by } : null,
        amountTiyin: amount !== undefined ? amount.toString() : null,
      };
    });
    // Manbada boshqa joyda va tarkibda ham boshqa joyda (shu bo'limga aloqasi yo'q) — chiqarilmaydi
    const shown = rows
      .filter((r) => r.group === 'HERE' || r.tarkib?.unit === unit || r.fix?.unit === unit)
      .sort((a, b) => a.group.localeCompare(b.group) || Number(a.status === 'MOS') - Number(b.status === 'MOS') || a.fullName.localeCompare(b.fullName, 'uz'));
    const count = (s: string) => shown.filter((r) => r.status === s).length;
    // Tanilmagan nomlar (shu bo'limga tegishli bo'lishi mumkin) — tanlash uchun
    const nameCount = new Map<string, number>();
    for (const n of Object.values(month.depts)) if (!resolve(n).option && !resolve(n).skipped) nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
    const unmapped = [...nameCount.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, count: n }));
    const batch = await this.prisma.salaryCompositionBatch.findFirst({ where: { period, cancelledAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, fileName: true, createdAt: true } }).catch(() => null);
    return {
      /** Shu oy saqlangan umumiy tarkib (bo'limlari bormi — hasTarkib) */
      batch: batch ? { id: batch.id, fileName: batch.fileName, createdAt: batch.createdAt } : null,
      /** Bo'limlar yo'q bo'lganda: tarkib fayli arxivdami va o'qish natijasi */
      source,
      unmapped,
      options: unmapped.length ? await this.options() : [],
      period,
      unit,
      label: entryUnitLabel(unit),
      hasTarkib,
      tarkibAt: month.at || null,
      rows: shown,
      counts: { total: shown.length, mos: count('MOS'), farq: count('FARQ'), fixed: count('FIXED'), noTarkib: count('NO_TARKIB'), unknown: count('UNKNOWN'), tarkibHere: shown.filter((r) => r.group === 'TARKIB_HERE').length },
    };
  }

  /**
   * Oldin saqlangan tarkibga bo'limlarni bog'lash (eski yuklashlarda bo'lim ustuni saqlanmagan): o'sha faylning faqat
   * bo'lim ustuni o'qiladi. Tarkib qayta saqlanmaydi, summalarga va joylarga tegilmaydi.
   */
  async attachDepts(period: string, rows: { pinfl: string; deptName?: string | null }[], column: { letter: string; label: string } | null, userId: string) {
    const batch = await this.prisma.salaryCompositionBatch.findFirst({ where: { period, cancelledAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, fileName: true } });
    if (!batch) throw new BadRequestException(`${monthLabel(period)} uchun ish haqi tarkibi saqlanmagan — avval tarkibni yuklang`);
    const withDept = rows.filter((r) => typeof r.deptName === 'string' && r.deptName.trim());
    if (!column || !withDept.length) throw new BadRequestException("Faylda bo'lim ustuni («Hududi», «Bo'lim», «Подразделение») topilmadi");
    const saved = new Set((await this.prisma.salaryCompositionRow.findMany({ where: { batchId: batch.id }, select: { employeePinfl: true } })).map((r) => r.employeePinfl));
    const hit = withDept.filter((r) => saved.has(r.pinfl));
    if (hit.length < Math.max(1, Math.ceil(withDept.length * 0.5))) throw new BadRequestException(`Fayl ${monthLabel(period)} saqlangan tarkibiga mos emas: ${withDept.length} xodimdan ${hit.length} tasi topildi (boshqa oy fayli bo'lishi mumkin)`);
    const depts: Record<string, string> = {};
    for (const r of hit) depts[r.pinfl] = r.deptName!.trim().slice(0, 120);
    await runExclusive(`setting:${COMPOSITION_PLACE_KEY(period)}`, async () => {
      const m = await this.month(period);
      await this.saveMonth(period, { ...m, batchId: batch.id, at: new Date().toISOString(), depts });
    });
    const resolve = await this.resolver();
    const unknown = [...new Set(Object.values(depts))].filter((n) => !resolve(n).option && !resolve(n).skipped);
    await this.audit.log({ userId, action: 'UPDATE', entity: 'composition_place', entityId: period, summary: `Ish haqi tarkibi ${monthLabel(period)}: saqlangan tarkibga bo'limlar bog'landi (${hit.length} xodim, ${column.label} ustuni)` });
    return { batchId: batch.id, matched: hit.length, total: withDept.length, notInTarkib: withDept.length - hit.length, departments: new Set(Object.values(depts).map(deptKey)).size, unknown, column };
  }

  /** Tarkibdagi nom → bo'lim mosligini saqlash (bo'lim sahifasidan): { [nom]: departmentId | 'SKIP' } */
  async learnNames(raw: unknown) {
    const options = await this.options();
    const ids = new Set(options.map((o) => o.id));
    const map = new Map<string, string>();
    if (raw && typeof raw === 'object') {
      for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v !== 'string' || !name.trim()) continue;
        if (v !== SKIP && !ids.has(v)) throw new BadRequestException(`«${name.slice(0, 60)}» uchun tanlangan bo'lim topilmadi`);
        map.set(deptKey(name), v);
      }
    }
    if (!map.size) throw new BadRequestException("Bo'limni tanlang");
    await runExclusive(`setting:${DEPT_NAMES_KEY}`, async () => {
      const cur = await this.learned();
      for (const [k, v] of map) cur[k] = v;
      const value = { map: cur } as object;
      await this.prisma.setting.upsert({ where: { key: DEPT_NAMES_KEY }, create: { key: DEPT_NAMES_KEY, value }, update: { value } });
    });
    return { saved: map.size };
  }

  /** Bo'lim sahifasidan: tanlangan xodimlarning shu oy joyini saqlangan tarkibdagidek qilish */
  async fixStored(period: string, pinfls: string[], userId: string) {
    const month = await this.month(period);
    const want = pinfls.filter((p) => month.depts[p]);
    if (!want.length) throw new BadRequestException("Tanlangan xodimlar shu oy ish haqi tarkibida yo'q (yoki tarkibda bo'limi yozilmagan)");
    const resolve = await this.resolver();
    const map: Record<string, string> = {};
    for (const p of want) {
      const r = resolve(month.depts[p]!);
      if (!r.option) throw new BadRequestException(`«${month.depts[p]!.slice(0, 60)}» qaysi bo'lim ekanligi belgilanmagan — Ish haqi tarkibi sahifasida tanlang`);
      map[month.depts[p]!] = r.option.id;
    }
    const rows = Object.entries(month.depts).map(([pinfl, dept]) => ({ pinfl, fullName: null, dept }));
    return this.apply(period, month.batchId, rows, { map, apply: want }, userId, false);
  }

  /**
   * Bo'lim sahifasidan qo'lda: umumiy soliq hisobotidan kelgan xodim(lar) shu oy boshqa joyda ishlagan —
   * «miya»da shu oy joyi (Markaz › bo'lim, hudud yoki yo'nalish), umumiy vedomost qayta taqsimlanadi: xodim shu
   * sahifadan chiqadi va tanlangan joyda chiqadi (summa o'sha). onlyThisMonth — keyingi oydan avvalgi joyiga.
   */
  async setPlace(period: string, body: { pinfls?: unknown; target?: unknown; place?: unknown; onlyThisMonth?: unknown }, userId: string) {
    const pinfls = Array.isArray(body?.pinfls) ? [...new Set(body.pinfls.map(String).filter((p) => /^\d{14}$/.test(p)))].slice(0, 2000) : [];
    if (!pinfls.length) throw new BadRequestException('Xodimlarni tanlang');
    const target = typeof body?.target === 'string' ? body.target : '';
    if (!['CENTER', 'REGION', ...PAYROLL_UNITS].includes(target)) throw new BadRequestException("Qaysi joyga — tanlang");
    const place = await this.units.movePlace(target, body?.place);
    if (target === 'CENTER' && !place.departmentId) throw new BadRequestException("Markazning qaysi bo'limi — tanlang");
    if (target === 'REGION' && !place.regionCode) throw new BadRequestException('Qaysi hudud — tanlang');
    const onlyThisMonth = body?.onlyThisMonth !== false;
    const depName = place.departmentId ? ((await this.prisma.department.findUnique({ where: { id: place.departmentId }, select: { name: true } }))?.name ?? null) : null;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }).catch(() => null);
    const result = await runExclusive(`setting:${COMPOSITION_PLACE_KEY(period)}`, async () => {
      const month = await this.month(period);
      const at = new Date().toISOString();
      const touched: PlaceFix[] = [];
      for (const pinfl of pinfls) {
        const prev = month.fixes[pinfl];
        if (prev) {
          await this.undoMoves(prev, userId);
          delete month.fixes[pinfl];
        }
        const before = (await this.miya([pinfl], period, month)).get(pinfl)!;
        const moveIds: string[] = [];
        const displacedMoves: UnitMove[] = [];
        if (before.unit !== target) {
          const next = nextPeriod(period);
          const all = await this.units.allMoves();
          const nextBefore = membership(all)(pinfl, next) ?? before.unit;
          const m = await this.units.addMove({ pinfl, unit: target, from: period, fullName: before.fullName ?? undefined, note: `${place.label ?? entryUnitLabel(target)} (${monthLabel(period)}${onlyThisMonth ? ', faqat shu oy' : ''})` }, userId, 'UPLOAD');
          moveIds.push(m.id);
          if (m.displaced) displacedMoves.push(m.displaced);
          if (onlyThisMonth && !all.some((x) => x.pinfl === pinfl && x.from === next) && nextBefore && nextBefore !== target) {
            const back = await this.units.addMove({ pinfl, unit: nextBefore, from: next, fullName: before.fullName ?? undefined, note: `${monthLabel(period)}dan keyin avvalgi joyiga` }, userId, 'UPLOAD').catch(() => null);
            if (back) moveIds.push(back.id);
          }
        } else if (target !== 'CENTER' || before.departmentId === place.departmentId) continue; // joyi o'sha
        const fix: PlaceFix = {
          pinfl,
          fullName: before.fullName ?? pinfl,
          deptName: "qo'lda tanlangan",
          departmentId: target === 'CENTER' ? place.departmentId : null,
          departmentName: target === 'CENTER' ? depName : null,
          regionCode: target === 'REGION' ? place.regionCode : null,
          districtId: target === 'REGION' ? place.districtId : null,
          placeLabel: place.label ? `${entryUnitLabel(target)} › ${place.label}` : entryUnitLabel(target),
          source: 'MANUAL',
          unit: target,
          fromUnit: before.unit,
          fromDepartmentId: before.departmentId,
          fromDepartmentName: before.departmentName,
          moveIds,
          ...(displacedMoves.length ? { displacedMoves } : {}),
          at,
          by: user?.fullName ?? '',
        };
        month.fixes[pinfl] = fix;
        touched.push(fix);
      }
      await this.saveMonth(period, month);
      return touched;
    });
    if (!result.length) return { moved: 0, redistributed: false, targetLabel: entryUnitLabel(target), warnings: [] as string[] };
    const warnings: string[] = [];
    const uploaded = await this.units.uploadedIn(period).catch(() => new Map<string, { unit: string; amountTiyin: bigint }>());
    for (const f of result) {
      const up = uploaded.get(f.pinfl);
      if (up && up.unit !== f.unit) warnings.push(`${f.fullName}: shu oy «${entryUnitLabel(up.unit)}» sahifasida ham qo'lda yuklangan — o'sha summani o'sha sahifadan o'tkazing`);
    }
    const redistributed = await this.refresh(period, result.some((f) => f.unit !== f.fromUnit), userId);
    const label = result[0]!.placeLabel ?? entryUnitLabel(target);
    await this.audit.log({ userId, action: 'UPDATE', entity: 'composition_place', entityId: period, summary: `${monthLabel(period)}: ${result.length} xodim «${label}»da (qo'lda${onlyThisMonth ? ', faqat shu oy' : ''})${redistributed ? '; umumiy vedomost qayta taqsimlandi' : ''}` });
    return { moved: result.length, redistributed, targetLabel: label, warnings };
  }

  /** O'zgarishni bekor qilish (pinfls berilmasa — shu oy hammasi): «miya» va xarajatlar avvalgi holatiga */
  async revert(period: string, pinfls: string[] | null, userId: string, reason = "qo'lda bekor qilindi", only?: (f: PlaceFix) => boolean) {
    const out = await runExclusive(`setting:${COMPOSITION_PLACE_KEY(period)}`, async () => {
      const m = await this.month(period);
      const list = Object.values(m.fixes).filter((f) => (!pinfls || pinfls.includes(f.pinfl)) && (!only || only(f)));
      for (const f of list) {
        await this.undoMoves(f, userId);
        delete m.fixes[f.pinfl];
      }
      if (list.length || !pinfls) await this.saveMonth(period, pinfls ? m : { ...m, fixes: m.fixes });
      return list;
    });
    if (!out.length) return { reverted: 0, redistributed: false };
    const redistributed = await this.refresh(period, out.some((f) => f.unit !== f.fromUnit), userId);
    await this.audit.log({ userId, action: 'UPDATE', entity: 'composition_place', entityId: period, summary: `Ish haqi tarkibi ${monthLabel(period)}: ${out.length} xodimning shu oydagi joyi avvalgi holatiga qaytarildi (${reason})` });
    return { reverted: out.length, redistributed };
  }

  /** Tarkib bekor qilinganda — shu oy hamma o'zgarishlar ham bekor, bo'limlar ro'yxati tozalanadi */
  async onCancel(period: string, userId: string) {
    // Faqat tarkib bo'yicha qilinganlari; bo'lim sahifasida qo'lda tanlangan joylar tarkibga bog'liq emas — qoladi
    const r = await this.revert(period, null, userId, 'ish haqi tarkibi bekor qilindi', (f) => f.source !== 'MANUAL');
    await runExclusive(`setting:${COMPOSITION_PLACE_KEY(period)}`, async () => {
      const m = await this.month(period);
      await this.saveMonth(period, { ...m, batchId: null, depts: {} });
    });
    return r;
  }
}
