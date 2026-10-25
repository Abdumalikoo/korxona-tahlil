import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { runExclusive } from '../../common/locks';
import { monthLabel, monthsBetween } from '../../common/period';
import { ENTRY_UNIT_CODES, entryUnitLabel, isSegment } from '../../common/segments/segments';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { UnitPayrollService } from '../unit-payroll/unit-payroll.service';
import { nameKey } from './acc23106.purpose';
import { readStore, STORE_KEY, type PayoutRow } from './acc23106.store';

// ═══════════════════════════════════════════════════════════
// 23106 › Xizmat safari — bo'limlarga yo'naltirish.
//
// Xizmat safari pullari soliq hisobotida ham, ish haqi tarkibida ham YO'Q — yagona manba shu ko'chirma.
// Tartib (foydalanuvchi tasdig'i bilan):
//  1) Saqlangan ko'chirmadan «xizmat safari» to'lovlari ajratiladi (avans — «bunak» ham);
//  2) har to'lov PINFL orqali xodimga, xodim — to'langan oydagi joyiga bog'lanadi («miya»: bo'lim ko'chishlari,
//     yo'nalish ro'yxatlari, Xodimlar bazasi): Markaz › bo'limi, Hududlar › viloyat › tuman, Tax free …;
//  3) foydalanuvchi tekshiradi (kerak bo'lsa joyini o'zgartiradi) va TASDIQLAYDI;
//  4) shundan keyingina har to'lov — xarajat yozuvi: shu joyda, modda «Xizmat safari», oy — to'langan sana oyi.
// Tasdiqni bekor qilish — yozuvlar o'chadi. Ko'chirma almashtirilsa yoki bekor qilinsa — o'sha oy tasdiqlari ham
// bekor bo'ladi (eski to'lovlar xarajatda qolib ketmasin), qayta tasdiqlash kerak.
// Saqlash: settings «acc23106.safar» — migratsiya kerak emas. Hisob raqami saqlanmaydi.
// ═══════════════════════════════════════════════════════════

export const SAFAR_KEY = 'acc23106.safar';
/** Standart modda: «Hudud xodimlari uchun» guruhidagi «Xizmat safari (komandirovka)» (Xarajatlar siyosati bilan bir xil kod) */
export const SAFAR_CATEGORY = { code: 'HM_SAFAR', label: 'Xizmat safari (komandirovka)' };
const SAFAR_PARENT = { code: 'HM_HUDUD', label: 'Hudud xodimlari uchun (Markaz hisobidan)' };
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_ITEMS = 5000;
const SAFAR_LABEL_RE = /safar|komandir|сафар|командир/i;

export interface SafarPlace {
  /** Kiritish bo'limi: CENTER, REGION yoki yo'nalish (TAX_FREE …) */
  unit: string;
  departmentId: string | null;
  regionCode: number | null;
  districtId: string | null;
  /** «Markaz › IT bo'limi», «Hududlar › Samarqand › Urgut», «Tax free» */
  label: string;
}

export interface SafarItem {
  key: string;
  period: string;
  docDate: string;
  docNo: string;
  pinfl: string | null;
  fullName: string;
  amountTiyin: string;
  orderNo: string | null;
  orderDate: string | null;
  place: SafarPlace;
  /** Joy dastur aniqlaganidek (true) yoki qo'lda o'zgartirilgan (false) */
  auto: boolean;
  expenseId: string;
}

export interface SafarPost {
  id: string;
  months: string[];
  createdAt: string;
  createdBy: string;
  categoryCode: string;
  items: SafarItem[];
  totalTiyin: string;
  status: 'POSTED' | 'CANCELLED';
  cancelledAt: string | null;
  cancelReason: string | null;
}

interface SafarStore {
  posts: SafarPost[];
}

/** Joy aniqlanmagan sababi */
export type SafarIssue = 'NOT_FOUND' | 'NO_UNIT' | 'NO_REGION';

const ISSUE_TEXT: Record<SafarIssue, string> = {
  NOT_FOUND: "Xodim aniqlanmadi (PINFL ham, ism ham bazada yo'q)",
  NO_UNIT: "Xodim bor, lekin qaysi bo'limdaligi noma'lum (miyada yo'q)",
  NO_REGION: "Hudud xodimi, lekin Xodimlar bazasida viloyati yo'q",
};

function readSafar(raw: unknown): SafarStore {
  const v = (raw ?? {}) as Partial<SafarStore>;
  return { posts: Array.isArray(v.posts) ? (v.posts as SafarPost[]).filter((p) => p && typeof p.id === 'string' && Array.isArray(p.items)) : [] };
}

/** Oy ichidagi to'lov kaliti (bir xil qator takrorlansa — tartib raqami bilan) */
export function rowKeys(rows: PayoutRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = `${r.docDate}|${r.docNo}|${r.debitTiyin}|${r.inn}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  });
}

/** To'lov sanasi → xarajat sanasi (Toshkent, kun o'rtasi) */
function dayDate(day: string): Date {
  return new Date(`${day.slice(0, 10)}T12:00:00+05:00`);
}

@Injectable()
export class Acc23106SafarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly units: UnitPayrollService,
  ) {}

  private async safar(): Promise<SafarStore> {
    return readSafar((await this.prisma.setting.findUnique({ where: { key: SAFAR_KEY } }))?.value ?? null);
  }

  private async months(): Promise<ReturnType<typeof readStore>['months']> {
    return readStore((await this.prisma.setting.findUnique({ where: { key: STORE_KEY } }))?.value ?? null).months;
  }

  /** Xodim nomi: Xodimlar bazasi, bo'lim ro'yxatlari; ism bo'yicha ham (izohdagi F.I.Sh.) */
  private async people() {
    const [registry, staffRow] = await Promise.all([
      this.prisma.employee.findMany({ select: { pinfl: true, fullName: true, regionCode: true, departmentId: true, districtId: true } }),
      this.prisma.setting.findUnique({ where: { key: 'unit.staff' } }),
    ]);
    const byPin = new Map<string, { fullName: string; regionCode: number | null; departmentId: string | null; districtId: string | null }>();
    for (const e of registry) byPin.set(e.pinfl, { fullName: e.fullName, regionCode: e.regionCode ?? null, departmentId: e.departmentId ?? null, districtId: e.districtId ?? null });
    const staff = (staffRow?.value ?? {}) as Record<string, { pinfl?: string; fullName?: string }[]>;
    for (const list of Object.values(staff)) for (const s of Array.isArray(list) ? list : []) if (s?.pinfl && s.fullName && !byPin.has(s.pinfl)) byPin.set(s.pinfl, { fullName: s.fullName, regionCode: null, departmentId: null, districtId: null });
    const byName = new Map<string, string | null>();
    for (const [p, v] of byPin) {
      const k = nameKey(v.fullName);
      if (!k.includes(' ')) continue;
      byName.set(k, byName.has(k) && byName.get(k) !== p ? null : p);
    }
    return { byPin, byName };
  }

  private async lookups() {
    const [deps, regions, districts] = await Promise.all([
      this.prisma.department.findMany({ select: { id: true, name: true } }),
      this.prisma.region.findMany({ select: { code: true, name: true } }),
      this.prisma.district.findMany({ select: { id: true, name: true, regionCode: true } }),
    ]);
    return { dep: new Map(deps.map((d) => [d.id, d.name])), reg: new Map(regions.map((r) => [r.code, r.name])), dis: new Map(districts.map((d) => [d.id, d.name])) };
  }

  private label(p: Omit<SafarPlace, 'label'>, lk: Awaited<ReturnType<Acc23106SafarService['lookups']>>): string {
    const unit = entryUnitLabel(p.unit);
    if (p.unit === 'CENTER') return p.departmentId && lk.dep.get(p.departmentId) ? `${unit} › ${lk.dep.get(p.departmentId)}` : unit;
    if (p.unit === 'REGION' && p.regionCode) {
      const r = lk.reg.get(p.regionCode) ?? `${p.regionCode}-hudud`;
      const d = p.districtId ? lk.dis.get(p.districtId) : null;
      return `${unit} › ${r}${d ? ` › ${d}` : ''}`;
    }
    return unit;
  }

  /** Saqlangan ko'chirmadagi xizmat safari to'lovlari: xodim va dastur aniqlagan joy */
  private async collect(periods: string[]) {
    const months = await this.months();
    const ppl = await this.people();
    const lk = await this.lookups();
    const raw: { key: string; period: string; r: PayoutRow; pinfl: string | null; fullName: string | null }[] = [];
    for (const p of periods) {
      const rows = months[p]?.rows ?? [];
      const keys = rowKeys(rows);
      rows.forEach((r, i) => {
        if (r.kind !== 'SAFAR') return;
        // Xodim jonli aniqlanadi (reestrga keyin qo'shilganlar ham topiladi)
        const d = r.inn.replace(/\D/g, '');
        let pinfl: string | null = /^\d{14}$/.test(d) && ppl.byPin.has(d) ? d : null;
        if (!pinfl && r.commentName) pinfl = ppl.byName.get(nameKey(r.commentName)) ?? null;
        if (!pinfl && r.pinfl && ppl.byPin.has(r.pinfl)) pinfl = r.pinfl;
        raw.push({ key: keys[i]!, period: p, r, pinfl, fullName: pinfl ? ppl.byPin.get(pinfl)!.fullName : null });
      });
    }
    // Joy: to'langan oydagi bo'limi («miya»)
    const unitAt = new Map<string, Map<string, string>>();
    for (const p of periods) {
      const pins = [...new Set(raw.filter((x) => x.period === p && x.pinfl).map((x) => x.pinfl!))];
      unitAt.set(p, await this.units.unitsAt(pins, p));
    }
    return raw.map((x) => {
      let place: SafarPlace | null = null;
      let issue: SafarIssue | null = null;
      if (!x.pinfl) issue = 'NOT_FOUND';
      else {
        const unit = unitAt.get(x.period)?.get(x.pinfl);
        const e = ppl.byPin.get(x.pinfl)!;
        if (!unit) issue = 'NO_UNIT';
        else if (unit === 'REGION' && !(e.regionCode && e.regionCode > 0)) issue = 'NO_REGION';
        else {
          const base =
            unit === 'CENTER'
              ? { unit, departmentId: e.departmentId, regionCode: 0, districtId: null }
              : unit === 'REGION'
                ? { unit, departmentId: null, regionCode: e.regionCode, districtId: e.districtId }
                : { unit, departmentId: null, regionCode: null, districtId: null };
          place = { ...base, label: this.label(base, lk) };
        }
      }
      return { ...x, place, issue };
    });
  }

  /** Tanlov uchun moddalar: standart (HM_SAFAR) va nomida «safar / komandirovka» bor faol ichki moddalar */
  private async categoryOptions() {
    const list = await this.prisma.category.findMany({ where: { isActive: true, isLeaf: true }, select: { code: true, label: true } });
    const opts = list.filter((c) => c.code === SAFAR_CATEGORY.code || SAFAR_LABEL_RE.test(c.label)).map((c) => ({ code: c.code, label: c.label }));
    const exists = opts.some((c) => c.code === SAFAR_CATEGORY.code);
    return { options: exists ? opts : [{ ...SAFAR_CATEGORY, label: `${SAFAR_CATEGORY.label} — yangi modda yaratiladi` }, ...opts], defaultCode: SAFAR_CATEGORY.code };
  }

  // ═══════════ Ko'rish ═══════════

  async view(from: string, to: string) {
    if (!PERIOD_RE.test(from ?? '') || !PERIOD_RE.test(to ?? '')) throw new BadRequestException("Oy noto'g'ri (YYYY-MM)");
    const periods = monthsBetween(from, to);
    const [rows, store, months, cats] = await Promise.all([this.collect(periods), this.safar(), this.months(), this.categoryOptions()]);
    const posted = new Map<string, { postId: string; item: SafarItem }>();
    for (const p of store.posts) if (p.status === 'POSTED') for (const it of p.items) posted.set(`${it.period}|${it.key}`, { postId: p.id, item: it });

    const out = rows.map((x) => {
      const pp = posted.get(`${x.period}|${x.key}`);
      return {
        key: x.key,
        period: x.period,
        docDate: x.r.docDate,
        docNo: x.r.docNo,
        pinfl: x.pinfl ?? (/^\d{14}$/.test(x.r.inn.replace(/\D/g, '')) ? x.r.inn.replace(/\D/g, '') : null),
        fullName: x.fullName,
        commentName: x.r.commentName,
        accountName: x.r.accountName,
        amountTiyin: x.r.debitTiyin,
        orderNo: x.r.orderNo,
        orderDate: x.r.orderDate,
        purpose: x.r.purpose,
        advance: /bunak|бунак|аванс|avans/i.test(x.r.purpose),
        place: x.place,
        issue: x.issue,
        issueText: x.issue ? ISSUE_TEXT[x.issue] : null,
        posted: pp ? { postId: pp.postId, place: pp.item.place, auto: pp.item.auto } : null,
      };
    });

    // Bo'limlar kesimi: tasdiqlanganlari tasdiqlangan joyi, qolganlari — aniqlangan joyi bo'yicha
    const byUnit = new Map<string, { label: string; count: number; total: bigint; posted: bigint; pending: bigint }>();
    for (const r of out) {
      const place = r.posted?.place ?? r.place;
      const k = place ? place.label : '— joyi aniqlanmagan';
      const u = byUnit.get(k) ?? { label: k, count: 0, total: 0n, posted: 0n, pending: 0n };
      const v = BigInt(r.amountTiyin);
      u.count += 1;
      u.total += v;
      if (r.posted) u.posted += v;
      else u.pending += v;
      byUnit.set(k, u);
    }
    const sum = (pred: (r: (typeof out)[number]) => boolean) => out.filter(pred).reduce((s, r) => s + BigInt(r.amountTiyin), 0n).toString();
    return {
      from: periods[0],
      to: periods[periods.length - 1],
      months: periods.map((p) => ({ period: p, label: monthLabel(p), saved: Boolean(months[p]) })),
      rows: out,
      byUnit: [...byUnit.values()].sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0)).map((u) => ({ label: u.label, count: u.count, totalTiyin: u.total.toString(), postedTiyin: u.posted.toString(), pendingTiyin: u.pending.toString() })),
      summary: {
        count: out.length,
        totalTiyin: sum(() => true),
        postedCount: out.filter((r) => r.posted).length,
        postedTiyin: sum((r) => Boolean(r.posted)),
        readyCount: out.filter((r) => !r.posted && r.place).length,
        readyTiyin: sum((r) => !r.posted && Boolean(r.place)),
        issueCount: out.filter((r) => !r.posted && r.issue).length,
        issueTiyin: sum((r) => !r.posted && Boolean(r.issue)),
        advanceCount: out.filter((r) => r.advance).length,
      },
      categories: cats,
      posts: store.posts
        .filter((p) => p.months.some((m) => periods.includes(m)))
        .reverse()
        .map((p) => ({ id: p.id, months: p.months, createdAt: p.createdAt, createdBy: p.createdBy, categoryCode: p.categoryCode, count: p.items.length, totalTiyin: p.totalTiyin, status: p.status, cancelledAt: p.cancelledAt, cancelReason: p.cancelReason })),
    };
  }

  // ═══════════ Tasdiqlash ═══════════

  /** Modda: tanlangani (faol, ichki) yoki standart HM_SAFAR (yo'q bo'lsa — yaratiladi) */
  private async ensureCategory(raw: unknown): Promise<string> {
    const code = typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 64) : SAFAR_CATEGORY.code;
    const c = await this.prisma.category.findUnique({ where: { code }, select: { code: true, isLeaf: true, isActive: true } });
    if (c) {
      if (!c.isActive || !c.isLeaf) throw new BadRequestException("Tanlangan modda faol ichki modda emas — boshqasini tanlang");
      return c.code;
    }
    if (code !== SAFAR_CATEGORY.code) throw new BadRequestException('Modda topilmadi');
    const parent = await this.prisma.category.findUnique({ where: { code: SAFAR_PARENT.code }, select: { code: true } });
    if (!parent) await this.prisma.category.create({ data: { code: SAFAR_PARENT.code, label: SAFAR_PARENT.label, isLeaf: false, isActive: true, order: 800 } }).catch(() => null);
    await this.prisma.category.create({ data: { code: SAFAR_CATEGORY.code, label: SAFAR_CATEGORY.label, parentCode: SAFAR_PARENT.code, isLeaf: true, isActive: true, order: 803 } }).catch(() => null);
    return SAFAR_CATEGORY.code;
  }

  /**
   * Tasdiqlash: tanlangan to'lovlar (kalit) shu joylarga xarajat bo'lib yoziladi.
   * items: [{ key, period, place? }] — place berilmasa, dastur aniqlagan joy; berilsa — qo'lda tanlangan joy.
   * Summa, sana va xodim serverda saqlangan ko'chirmadan olinadi (brauzerdan emas).
   */
  async confirm(body: { items?: unknown; categoryCode?: unknown }, userId: string) {
    if (!Array.isArray(body?.items) || !body.items.length) throw new BadRequestException("Tasdiqlash uchun kamida bitta to'lovni belgilang");
    if (body.items.length > MAX_ITEMS) throw new BadRequestException(`Juda ko'p — ${MAX_ITEMS} tagacha`);
    const want = (body.items as Record<string, unknown>[]).map((x) => ({ key: typeof x?.key === 'string' ? x.key.slice(0, 300) : '', period: typeof x?.period === 'string' ? x.period : '', place: x?.place }));
    if (want.some((w) => !w.key || !PERIOD_RE.test(w.period))) throw new BadRequestException("To'lov kaliti yoki oyi noto'g'ri");
    const periods = [...new Set(want.map((w) => w.period))].sort();
    const categoryCode = await this.ensureCategory(body.categoryCode);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }).catch(() => null);
    const lk = await this.lookups();

    const out = await runExclusive(`setting:${SAFAR_KEY}`, async () => {
      const rows = new Map((await this.collect(periods)).map((x) => [`${x.period}|${x.key}`, x]));
      const store = await this.safar();
      const already = new Set(store.posts.filter((p) => p.status === 'POSTED').flatMap((p) => p.items.map((i) => `${i.period}|${i.key}`)));
      const seen = new Set<string>();
      const items: Omit<SafarItem, 'expenseId'>[] = [];
      for (const w of want) {
        const id = `${w.period}|${w.key}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const x = rows.get(id);
        if (!x) throw new NotFoundException("To'lov topilmadi — ko'chirma o'zgargan bo'lishi mumkin, sahifani yangilang");
        if (already.has(id)) throw new BadRequestException(`${x.fullName ?? x.r.commentName ?? x.r.accountName} (${x.r.docDate}) allaqachon tasdiqlangan`);
        let place: SafarPlace;
        let auto = true;
        if (w.place && typeof w.place === 'object') {
          const p = w.place as Record<string, unknown>;
          const unit = typeof p.unit === 'string' && ENTRY_UNIT_CODES.includes(p.unit) ? p.unit : null;
          if (!unit) throw new BadRequestException("Bo'lim noto'g'ri");
          const mp = await this.units.movePlace(unit, p);
          if (unit === 'REGION' && !mp.regionCode) throw new BadRequestException(`${x.fullName ?? x.r.commentName ?? 'Xodim'}: viloyatni tanlang`);
          const base = unit === 'CENTER' ? { unit, departmentId: mp.departmentId, regionCode: 0, districtId: null } : unit === 'REGION' ? { unit, departmentId: null, regionCode: mp.regionCode, districtId: mp.districtId } : { unit, departmentId: null, regionCode: null, districtId: null };
          place = { ...base, label: this.label(base, lk) };
          auto = Boolean(x.place && x.place.unit === place.unit && x.place.departmentId === place.departmentId && x.place.regionCode === place.regionCode && x.place.districtId === place.districtId);
        } else {
          if (!x.place) throw new BadRequestException(`${x.fullName ?? x.r.commentName ?? x.r.accountName}: joyi aniqlanmagan — bo'limni tanlang`);
          place = x.place;
        }
        items.push({ key: x.key, period: x.period, docDate: x.r.docDate, docNo: x.r.docNo, pinfl: x.pinfl, fullName: x.fullName ?? x.r.commentName ?? x.r.accountName, amountTiyin: x.r.debitTiyin, orderNo: x.r.orderNo, orderDate: x.r.orderDate, place, auto });
      }
      const now = new Date().toISOString();
      const created = await this.prisma.$transaction(async (tx) => {
        const done: SafarItem[] = [];
        const postIds: string[] = [];
        for (const it of items) {
          const order = it.orderNo || it.orderDate ? `, buyruq${it.orderDate ? ` ${it.orderDate.split('-').reverse().join('.')}` : ''}${it.orderNo ? ` № ${it.orderNo}` : ''}` : '';
          const e = await tx.expense.create({
            data: {
              date: dayDate(it.docDate),
              period: it.docDate.slice(0, 7),
              amountTiyin: BigInt(it.amountTiyin),
              categoryCode,
              segment: isSegment(it.place.unit) ? it.place.unit : null,
              regionCode: it.place.regionCode,
              districtId: it.place.districtId,
              departmentId: it.place.departmentId,
              description: `Xizmat safari — ${it.fullName} (23106${order})`.slice(0, 500),
              documentNo: it.docNo.slice(0, 100) || null,
              counterparty: it.fullName.slice(0, 200),
              paymentMethod: 'BANK',
              paymentStatus: 'PAID',
              source: 'IMPORT',
              section: 'BOSHQA',
              createdById: userId,
            },
            select: { id: true },
          });
          done.push({ ...it, expenseId: e.id });
        }
        // Har oy — alohida tasdiq (bir oy ko'chirmasi almashtirilsa, boshqa oylar tasdig'i saqlanib qoladi)
        for (const p of periods) {
          const part = done.filter((d) => d.period === p);
          if (!part.length) continue;
          const id = randomUUID();
          postIds.push(id);
          store.posts.push({ id, months: [p], createdAt: now, createdBy: user?.fullName ?? '', categoryCode, items: part, totalTiyin: part.reduce((s, i) => s + BigInt(i.amountTiyin), 0n).toString(), status: 'POSTED', cancelledAt: null, cancelReason: null });
        }
        const total = done.reduce((s, i) => s + BigInt(i.amountTiyin), 0n);
        if (store.posts.length > 500) store.posts = store.posts.filter((p, i) => p.status === 'POSTED' || i >= store.posts.length - 300);
        const value = store as unknown as object;
        await tx.setting.upsert({ where: { key: SAFAR_KEY }, create: { key: SAFAR_KEY, value }, update: { value } });
        return { postIds, count: done.length, total, manual: done.filter((d) => !d.auto).length, units: new Set(done.map((d) => d.place.label)).size };
      });
      return created;
    });

    await this.audit.log({
      userId,
      action: 'CREATE',
      entity: 'acc_23106_safar',
      entityId: out.postIds.join(',').slice(0, 190),
      summary: `23106 xizmat safari tasdiqlandi: ${periods.map(monthLabel).join(', ')} — ${out.count} ta to'lov, ${(Number(out.total) / 100).toLocaleString('uz-UZ')} so'm, ${out.units} joyga${out.manual ? ` (${out.manual} tasi qo'lda tanlangan joyga)` : ''}`,
    });
    return { success: true as const, postIds: out.postIds, count: out.count, totalTiyin: out.total.toString(), units: out.units };
  }

  // ═══════════ Bekor qilish ═══════════

  private async drop(pred: (p: SafarPost) => boolean, reason: string): Promise<{ posts: SafarPost[]; expenses: number }> {
    return runExclusive(`setting:${SAFAR_KEY}`, async () => {
      const store = await this.safar();
      const hit = store.posts.filter((p) => p.status === 'POSTED' && pred(p));
      if (!hit.length) return { posts: [], expenses: 0 };
      const ids = hit.flatMap((p) => p.items.map((i) => i.expenseId)).filter(Boolean);
      const now = new Date().toISOString();
      const n = await this.prisma.$transaction(async (tx) => {
        const r = ids.length ? await tx.expense.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { deletedAt: new Date() } }) : { count: 0 };
        for (const p of hit) {
          p.status = 'CANCELLED';
          p.cancelledAt = now;
          p.cancelReason = reason;
        }
        const value = store as unknown as object;
        await tx.setting.upsert({ where: { key: SAFAR_KEY }, create: { key: SAFAR_KEY, value }, update: { value } });
        return r.count;
      });
      return { posts: hit, expenses: n };
    });
  }

  async cancel(id: string, userId: string) {
    const store = await this.safar();
    const p = store.posts.find((x) => x.id === id);
    if (!p) throw new NotFoundException('Tasdiq topilmadi');
    if (p.status === 'CANCELLED') throw new BadRequestException('Bu tasdiq allaqachon bekor qilingan');
    const out = await this.drop((x) => x.id === id, "Qo'lda bekor qilindi");
    await this.audit.log({ userId, action: 'DELETE', entity: 'acc_23106_safar', entityId: id, summary: `23106 xizmat safari tasdig'i bekor qilindi: ${p.months.map(monthLabel).join(', ')} — ${out.expenses} ta xarajat yozuvi o'chirildi` });
    return { success: true as const, expenses: out.expenses };
  }

  /** Ko'chirma oylari almashtirilsa yoki bekor qilinsa — o'sha oylardagi tasdiqlar ham bekor (eski to'lovlar xarajatda qolmasin) */
  async dropMonths(months: string[], reason: string, userId: string): Promise<number> {
    if (!months.length) return 0;
    const set = new Set(months);
    const out = await this.drop((p) => p.items.some((i) => set.has(i.period)), reason);
    if (out.posts.length) {
      await this.audit.log({ userId, action: 'DELETE', entity: 'acc_23106_safar', entityId: out.posts.map((p) => p.id).join(',').slice(0, 190), summary: `23106 xizmat safari tasdiqlari bekor qilindi (${reason}): ${months.map(monthLabel).join(', ')} — ${out.expenses} ta xarajat yozuvi o'chirildi` });
    }
    return out.expenses;
  }
}
