import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { runExclusive } from '../../common/locks';
import { monthLabel, monthsBetween } from '../../common/period';
import { CENTRAL_REGION } from '../../common/segments/segments';
import { AuditService } from '../audit/audit.service';
import { payrollCenterCategory, payrollPartCategory, readPolicy } from '../expense-policy/policy.util';
import { loadLocationRefs, PayrollService } from '../payroll/payroll.service';
import { PrismaService } from '../prisma/prisma.service';
import { BAYRAM_STORE_KEY, readBayram, type BayramItem, type BayramPost, type BayramStore } from './acc23106.bayram-ids';
import { nameKey } from './acc23106.purpose';
import { rowKeys } from './acc23106.safar.service';
import { readStore, STORE_KEY, type PayoutRow } from './acc23106.store';

// ═══════════════════════════════════════════════════════════
// 23106 › Hudud xodimlari bayram pullari — Markaz hisobiga.
//
// Hududda asosiy shtatda ishlovchilarning bayram pullarini Markaz to'laydi (23106 hisob raqamidan). Hudud xodimlari
// ish haqi tarkibida yo'q — yagona manba shu ko'chirma. Tartib (foydalanuvchi tasdig'i bilan):
//  1) saqlangan ko'chirmadan «bayram puli» to'lovlari olinadi; oy — hisoblangan oy (izohdagi oy, bo'lmasa buyruq oyi);
//  2) har to'lov xodimga, xodim — shu oydagi joyiga bog'lanadi (ish haqini guruhlash bilan BIR XIL qoida:
//     natijalar fayli, bo'lim ko'chishlari, Xodimlar bazasi). Faqat hudud × SHTAT xodimlari olinadi;
//  3) KO'RIB CHIQISH — hech narsa o'zgarmaydi: oy → viloyat → tuman → xodim, ish haqidan qancha ajratilishi;
//  4) foydalanuvchi oyni TASDIQLAYDI → shu oy ish haqi qayta guruhlanadi: xodimning bayram puli hudud ish haqidan
//     ayiriladi va Markaz hisobiga «Bayram pullari» bo'lib yoziladi (viloyat saqlanadi). Jami o'zgarmaydi.
// Summa — 23106 dagi (bank o'tkazgan) summa; xodimning shu oy ish haqidan oshmaydi.
// Ko'chirma almashtirilsa / bekor qilinsa yoki to'lov turi o'zgarsa — o'sha tasdiqlar bekor bo'ladi (qayta tasdiqlanadi).
// Saqlash: settings «acc23106.bayram» — migratsiya kerak emas.
// ═══════════════════════════════════════════════════════════

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

type Place = 'REGION' | 'CENTER' | 'OTHER';

interface Line {
  key: string;
  payMonth: string;
  period: string;
  r: PayoutRow;
  pinfl: string | null;
  fullName: string;
  place: Place;
  /** Nega olinmadi (OTHER uchun) */
  reason: string | null;
  regionCode: number | null;
  districtId: string | null;
}

@Injectable()
export class Acc23106BayramService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payroll: PayrollService,
  ) {}

  private async store(): Promise<BayramStore> {
    return readBayram((await this.prisma.setting.findUnique({ where: { key: BAYRAM_STORE_KEY } }))?.value ?? null);
  }

  private async save(store: BayramStore) {
    if (store.posts.length > 500) store.posts = store.posts.filter((p, i) => p.status === 'POSTED' || i >= store.posts.length - 300);
    const value = store as unknown as object;
    await this.prisma.setting.upsert({ where: { key: BAYRAM_STORE_KEY }, create: { key: BAYRAM_STORE_KEY, value }, update: { value } });
  }

  /** Siyosat: bayram puli hudud ish haqidan ajratiladimi (Xarajatlar siyosati › ish haqi komponentlari) */
  private async policy(): Promise<{ routed: boolean; text: string }> {
    const p = await readPolicy(this.prisma);
    const rule = (p.unitPayroll.REGION ?? {}).BAYRAM;
    if (rule === 'REGION') return { routed: false, text: "Xarajatlar siyosatida bayram puli «hududda qoladi» deb belgilangan — tasdiqlansa ham ajratilmaydi" };
    if (rule) return { routed: true, text: 'Hududlar siyosatida tanlangan bo\'lim hisobiga («ish haqi qismlari»)' };
    if (p.payrollComponents.includes('BAYRAM')) return { routed: true, text: 'Markaz hisobiga — «Hudud xodimlari uchun › Bayram pullari» moddasi' };
    return { routed: false, text: "Xarajatlar siyosatida bayram puli Markazga o'tadigan komponentlar ro'yxatida yo'q — tasdiqlansa ham ajratilmaydi" };
  }

  /** Saqlangan ko'chirmadagi bayram to'lovlari (hisoblangan oy shu davrda) — xodim va shu oydagi joyi */
  private async collect(periods: string[]): Promise<Line[]> {
    const want = new Set(periods);
    const months = readStore((await this.prisma.setting.findUnique({ where: { key: STORE_KEY } }))?.value ?? null).months;
    const registry = await this.prisma.employee.findMany({ select: { pinfl: true, fullName: true, regionCode: true, districtId: true, employmentType: true } });
    const byPin = new Map(registry.map((e) => [e.pinfl, e]));
    const byName = new Map<string, string | null>();
    for (const e of registry) {
      const k = nameKey(e.fullName);
      if (!k.includes(' ')) continue;
      byName.set(k, byName.has(k) && byName.get(k) !== e.pinfl ? null : e.pinfl);
    }
    const raw: { key: string; payMonth: string; period: string; r: PayoutRow; pinfl: string | null }[] = [];
    for (const [payMonth, m] of Object.entries(months)) {
      const rows = m.rows ?? [];
      const keys = rowKeys(rows);
      rows.forEach((r, i) => {
        if (r.kind !== 'BAYRAM' || !want.has(r.accrual)) return;
        // Xodim jonli aniqlanadi (reestrga keyin qo'shilganlar ham topiladi)
        const d = r.inn.replace(/\D/g, '');
        let pinfl: string | null = /^\d{14}$/.test(d) && byPin.has(d) ? d : null;
        if (!pinfl && r.commentName) pinfl = byName.get(nameKey(r.commentName)) ?? null;
        if (!pinfl && r.pinfl && byPin.has(r.pinfl)) pinfl = r.pinfl;
        raw.push({ key: keys[i]!, payMonth, period: r.accrual, r, pinfl });
      });
    }
    // Joy: hisoblangan oydagi (ish haqini guruhlash bilan bir xil — loadLocationRefs, bo'lmasa Xodimlar bazasi)
    const refs = new Map<string, Awaited<ReturnType<typeof loadLocationRefs>>>();
    for (const p of [...new Set(raw.map((x) => x.period))]) {
      const pins = [...new Set(raw.filter((x) => x.period === p && x.pinfl).map((x) => x.pinfl!))];
      refs.set(p, pins.length ? await loadLocationRefs(this.prisma, p, pins) : new Map());
    }
    return raw.map((x) => {
      const base = { key: x.key, payMonth: x.payMonth, period: x.period, r: x.r, pinfl: x.pinfl };
      const name = x.r.commentName ?? x.r.accountName;
      if (!x.pinfl) return { ...base, fullName: name, place: 'OTHER' as const, reason: "Xodim aniqlanmadi (PINFL ham, ism ham bazada yo'q)", regionCode: null, districtId: null };
      const e = byPin.get(x.pinfl)!;
      const ref = refs.get(x.period)?.get(x.pinfl);
      const regionCode = ref ? ref.regionCode : e.regionCode;
      const districtId = ref ? ref.districtId : e.districtId;
      const type = ref?.employmentType ?? e.employmentType;
      const out = { ...base, fullName: e.fullName, regionCode, districtId };
      if (regionCode === CENTRAL_REGION) return { ...out, place: 'CENTER' as const, reason: null };
      if (!(regionCode > 0)) return { ...out, place: 'OTHER' as const, reason: 'Xodimning viloyati aniqlanmagan' };
      if (type !== 'SHTAT') return { ...out, place: 'OTHER' as const, reason: 'Asosiy shtatda emas (shartnoma)' };
      return { ...out, place: 'REGION' as const, reason: null };
    });
  }

  /** Shu oy ish haqidagi to'liq summa (tasdiqlangan yuklamalar): PINFL → summa */
  private async fullSalary(period: string, pins: string[]): Promise<Map<string, bigint>> {
    const out = new Map<string, bigint>();
    if (!pins.length) return out;
    const entries = await this.prisma.payrollEntry.findMany({
      where: { period, employeePinfl: { in: pins }, deletedAt: null, batch: { status: 'COMMITTED' } },
      select: { employeePinfl: true, baseTiyin: true, bonusTiyin: true, totalTiyin: true },
    });
    for (const e of entries) {
      const full = e.baseTiyin === 0n && e.totalTiyin + e.bonusTiyin > 0n ? e.totalTiyin + e.bonusTiyin : e.baseTiyin;
      out.set(e.employeePinfl, (out.get(e.employeePinfl) ?? 0n) + full);
    }
    return out;
  }

  private async lookups() {
    const [regions, districts] = await Promise.all([this.prisma.region.findMany({ select: { code: true, name: true } }), this.prisma.district.findMany({ select: { id: true, name: true } })]);
    return { reg: new Map(regions.map((r) => [r.code, r.name])), dis: new Map(districts.map((d) => [d.id, d.name])) };
  }

  // ═══════════ Ko'rib chiqish (hech narsa o'zgartirilmaydi) ═══════════

  async view(from: string, to: string) {
    if (!PERIOD_RE.test(from ?? '') || !PERIOD_RE.test(to ?? '')) throw new BadRequestException("Oy noto'g'ri (YYYY-MM)");
    const periods = monthsBetween(from, to);
    const [lines, store, policy, lk] = await Promise.all([this.collect(periods), this.store(), this.policy(), this.lookups()]);
    const posted = new Map<string, BayramPost>();
    for (const p of store.posts) if (p.status === 'POSTED' && periods.includes(p.period)) posted.set(p.period, p);
    const postedKeys = new Set([...posted.values()].flatMap((p) => p.items.map((i) => `${i.payMonth}|${i.key}`)));

    // Xodim × oy: to'lovlar, ish haqidagi to'liq summa, ajratiladigan (ish haqidan oshmaydi)
    type Emp = { pinfl: string; fullName: string; period: string; regionCode: number; districtId: string | null; payments: { docDate: string; docNo: string; amountTiyin: string; posted: boolean }[]; amount: bigint; full: bigint | null; movable: bigint; posted: boolean };
    const emps = new Map<string, Emp>();
    const region = lines.filter((l) => l.place === 'REGION');
    for (const p of periods) {
      const list = region.filter((l) => l.period === p);
      if (!list.length) continue;
      const full = await this.fullSalary(p, [...new Set(list.map((l) => l.pinfl!))]);
      for (const l of list) {
        const id = `${p}|${l.pinfl}`;
        const e = emps.get(id) ?? { pinfl: l.pinfl!, fullName: l.fullName, period: p, regionCode: l.regionCode!, districtId: l.districtId, payments: [], amount: 0n, full: full.get(l.pinfl!) ?? null, movable: 0n, posted: false };
        const isPosted = postedKeys.has(`${l.payMonth}|${l.key}`);
        e.payments.push({ docDate: l.r.docDate, docNo: l.r.docNo, amountTiyin: l.r.debitTiyin, posted: isPosted });
        e.amount += BigInt(l.r.debitTiyin);
        e.posted = e.posted || isPosted;
        emps.set(id, e);
      }
    }
    for (const e of emps.values()) e.movable = e.full === null ? 0n : e.amount < e.full ? e.amount : e.full;

    // Viloyat → tuman → xodim
    const regs = new Map<number, { regionCode: number; name: string; amount: bigint; movable: bigint; people: Set<string>; count: number; districts: Map<string, { districtId: string | null; name: string; amount: bigint; movable: bigint; count: number; employees: Emp[] }> }>();
    for (const e of emps.values()) {
      const r = regs.get(e.regionCode) ?? { regionCode: e.regionCode, name: lk.reg.get(e.regionCode) ?? `${e.regionCode}-hudud`, amount: 0n, movable: 0n, people: new Set<string>(), count: 0, districts: new Map() };
      r.amount += e.amount;
      r.movable += e.movable;
      r.people.add(e.pinfl);
      r.count += e.payments.length;
      const dk = e.districtId ?? '';
      const d = r.districts.get(dk) ?? { districtId: e.districtId, name: e.districtId ? (lk.dis.get(e.districtId) ?? 'Tuman') : 'Tumani aniqlanmagan', amount: 0n, movable: 0n, count: 0, employees: [] };
      d.amount += e.amount;
      d.movable += e.movable;
      d.count += e.payments.length;
      d.employees.push(e);
      r.districts.set(dk, d);
      regs.set(e.regionCode, r);
    }
    const byAmount = <T extends { amount: bigint }>(a: T, b: T) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0);
    const empOut = (e: Emp) => ({ pinfl: e.pinfl, fullName: e.fullName, period: e.period, payments: e.payments, amountTiyin: e.amount.toString(), fullTiyin: e.full === null ? null : e.full.toString(), movableTiyin: e.movable.toString(), posted: e.posted });

    const sumOf = (list: Line[]) => list.reduce((s, l) => s + BigInt(l.r.debitTiyin), 0n);
    const months = periods
      .map((p) => {
        const reg = region.filter((l) => l.period === p);
        const center = lines.filter((l) => l.period === p && l.place === 'CENTER');
        const other = lines.filter((l) => l.period === p && l.place === 'OTHER');
        if (!reg.length && !center.length && !other.length && !posted.has(p)) return null;
        const pe = [...emps.values()].filter((e) => e.period === p);
        const post = posted.get(p);
        const now = new Set(reg.map((l) => `${l.payMonth}|${l.key}`));
        const snap = new Set(post?.items.map((i) => `${i.payMonth}|${i.key}`) ?? []);
        return {
          period: p,
          label: monthLabel(p),
          count: reg.length,
          people: pe.length,
          totalTiyin: sumOf(reg).toString(),
          movableTiyin: pe.reduce((s, e) => s + e.movable, 0n).toString(),
          notInPayroll: pe.filter((e) => e.full === null).length,
          centerCount: center.length,
          centerTiyin: sumOf(center).toString(),
          otherCount: other.length,
          otherTiyin: sumOf(other).toString(),
          posted: post ? { id: post.id, createdAt: post.createdAt, createdBy: post.createdBy, count: post.items.length, totalTiyin: post.totalTiyin } : null,
          // Tasdiqdan keyin ko'chirma yoki xodim joyi o'zgargan — qayta tasdiqlash kerak
          changed: Boolean(post) && (now.size !== snap.size || [...now].some((k) => !snap.has(k))),
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    const other = lines.filter((l) => l.place === 'OTHER');
    const all = [...emps.values()];
    return {
      from: periods[0],
      to: periods[periods.length - 1],
      policy,
      months,
      regions: [...regs.values()].sort(byAmount).map((r) => ({
        regionCode: r.regionCode,
        name: r.name,
        count: r.count,
        people: r.people.size,
        totalTiyin: r.amount.toString(),
        movableTiyin: r.movable.toString(),
        districts: [...r.districts.values()].sort(byAmount).map((d) => ({ districtId: d.districtId, name: d.name, count: d.count, totalTiyin: d.amount.toString(), movableTiyin: d.movable.toString(), employees: d.employees.sort(byAmount).map(empOut) })),
      })),
      excluded: other.map((l) => ({ fullName: l.fullName, period: l.period, docDate: l.r.docDate, amountTiyin: l.r.debitTiyin, reason: l.reason ?? '' })),
      summary: {
        count: region.length,
        people: new Set(all.map((e) => e.pinfl)).size,
        totalTiyin: sumOf(region).toString(),
        movableTiyin: all.reduce((s, e) => s + e.movable, 0n).toString(),
        postedTiyin: all.filter((e) => e.posted).reduce((s, e) => s + e.movable, 0n).toString(),
        notInPayroll: all.filter((e) => e.full === null).length,
        centerCount: lines.filter((l) => l.place === 'CENTER').length,
        centerTiyin: sumOf(lines.filter((l) => l.place === 'CENTER')).toString(),
        otherCount: other.length,
        otherTiyin: sumOf(other).toString(),
      },
    };
  }

  // ═══════════ Tasdiqlash ═══════════

  /** Markaz hisobiga ajratilgan bayram (shu oy, hududlar) — ish haqi qayta guruhlangandan keyin */
  private async movedTiyin(period: string): Promise<bigint> {
    const r = await this.prisma.expense.aggregate({ where: { period, deletedAt: null, source: 'PAYROLL', regionCode: { gt: CENTRAL_REGION }, categoryCode: { in: [payrollCenterCategory('BAYRAM'), payrollPartCategory('BAYRAM')] } }, _sum: { amountTiyin: true } });
    return r._sum.amountTiyin ?? 0n;
  }

  /**
   * Tanlangan oylarni tasdiqlash: shu oy hudud xodimlarining bayram to'lovlari (serverdagi ko'chirmadan) saqlanadi
   * va ish haqi qayta guruhlanadi. Oy avval tasdiqlangan bo'lsa — yangisi bilan almashtiriladi.
   */
  async confirm(body: { periods?: unknown }, userId: string) {
    if (!Array.isArray(body?.periods) || !body.periods.length) throw new BadRequestException('Tasdiqlash uchun kamida bitta oyni tanlang');
    const periods = [...new Set(body.periods.map(String))].sort();
    if (periods.some((p) => !PERIOD_RE.test(p))) throw new BadRequestException("Oy noto'g'ri");
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }).catch(() => null);
    const policy = await this.policy();

    const out = await runExclusive(`setting:${BAYRAM_STORE_KEY}`, async () => {
      const lines = (await this.collect(periods)).filter((l) => l.place === 'REGION');
      const store = await this.store();
      const now = new Date().toISOString();
      const done: { period: string; id: string; count: number; total: bigint }[] = [];
      for (const p of periods) {
        const items: BayramItem[] = lines
          .filter((l) => l.period === p)
          .map((l) => ({ key: l.key, payMonth: l.payMonth, docDate: l.r.docDate, docNo: l.r.docNo, pinfl: l.pinfl!, fullName: l.fullName, regionCode: l.regionCode!, districtId: l.districtId, amountTiyin: l.r.debitTiyin }));
        if (!items.length) throw new BadRequestException(`${monthLabel(p)}: hudud xodimlarining bayram to'lovi yo'q`);
        for (const old of store.posts) {
          if (old.status !== 'POSTED' || old.period !== p) continue;
          old.status = 'CANCELLED';
          old.cancelledAt = now;
          old.cancelReason = 'qayta tasdiqlandi';
        }
        const id = randomUUID();
        const total = items.reduce((s, i) => s + BigInt(i.amountTiyin), 0n);
        store.posts.push({ id, period: p, createdAt: now, createdBy: user?.fullName ?? '', items, totalTiyin: total.toString(), status: 'POSTED', cancelledAt: null, cancelReason: null });
        done.push({ period: p, id, count: items.length, total });
      }
      await this.save(store);
      return done;
    });

    // Ish haqi qayta guruhlanadi — bayram hudud ish haqidan Markaz hisobiga o'tadi
    let moved = 0n;
    for (const p of periods) {
      await this.payroll.regroup(p);
      moved += await this.movedTiyin(p);
    }
    const count = out.reduce((s, d) => s + d.count, 0);
    const total = out.reduce((s, d) => s + d.total, 0n);
    await this.audit.log({
      userId,
      action: 'CREATE',
      entity: 'acc_23106_bayram',
      entityId: out.map((d) => d.id).join(',').slice(0, 190),
      summary: `23106 hudud xodimlari bayram pullari tasdiqlandi: ${periods.map(monthLabel).join(', ')} — ${count} ta to'lov, ${(Number(total) / 100).toLocaleString('uz-UZ')} so'm; Markaz hisobiga o'tdi ${(Number(moved) / 100).toLocaleString('uz-UZ')} so'm`,
    });
    return { success: true as const, count, totalTiyin: total.toString(), movedTiyin: moved.toString(), routed: policy.routed };
  }

  // ═══════════ Bekor qilish ═══════════

  private async drop(pred: (p: BayramPost) => boolean, reason: string): Promise<BayramPost[]> {
    const hit = await runExclusive(`setting:${BAYRAM_STORE_KEY}`, async () => {
      const store = await this.store();
      const list = store.posts.filter((p) => p.status === 'POSTED' && pred(p));
      if (!list.length) return [];
      const now = new Date().toISOString();
      for (const p of list) {
        p.status = 'CANCELLED';
        p.cancelledAt = now;
        p.cancelReason = reason;
      }
      await this.save(store);
      return list;
    });
    // Ish haqi qayta guruhlanadi — bayram hududga qaytadi
    for (const period of [...new Set(hit.map((p) => p.period))]) await this.payroll.regroup(period);
    return hit;
  }

  async cancel(id: string, userId: string) {
    const p = (await this.store()).posts.find((x) => x.id === id);
    if (!p) throw new NotFoundException('Tasdiq topilmadi');
    if (p.status === 'CANCELLED') throw new BadRequestException('Bu tasdiq allaqachon bekor qilingan');
    await this.drop((x) => x.id === id, "Qo'lda bekor qilindi");
    await this.audit.log({ userId, action: 'DELETE', entity: 'acc_23106_bayram', entityId: id, summary: `23106 hudud bayram pullari tasdig'i bekor qilindi: ${monthLabel(p.period)} — ${p.items.length} ta to'lov hudud ish haqiga qaytdi` });
    return { success: true as const, period: p.period };
  }

  /** Ko'chirma oylari almashtirilsa yoki bekor qilinsa — shu oylardagi to'lovlar kirgan tasdiqlar bekor */
  async dropPayMonths(months: string[], reason: string, userId: string): Promise<number> {
    if (!months.length) return 0;
    const set = new Set(months);
    const hit = await this.drop((p) => p.items.some((i) => set.has(i.payMonth)), reason);
    if (hit.length) await this.audit.log({ userId, action: 'DELETE', entity: 'acc_23106_bayram', entityId: hit.map((p) => p.id).join(',').slice(0, 190), summary: `23106 hudud bayram pullari tasdiqlari bekor qilindi (${reason}): ${hit.map((p) => monthLabel(p.period)).join(', ')}` });
    return hit.length;
  }

  /** Turi o'zgargan (endi bayram puli emas) to'lovlar kirgan tasdiqlar bekor */
  async dropKeys(keys: string[], reason: string, userId: string): Promise<number> {
    if (!keys.length) return 0;
    const set = new Set(keys);
    const hit = await this.drop((p) => p.items.some((i) => set.has(i.key.replace(/#\d+$/, ''))), reason);
    if (hit.length) await this.audit.log({ userId, action: 'DELETE', entity: 'acc_23106_bayram', entityId: hit.map((p) => p.id).join(',').slice(0, 190), summary: `23106 hudud bayram pullari tasdiqlari bekor qilindi (${reason}): ${hit.map((p) => monthLabel(p.period)).join(', ')}` });
    return hit.length;
  }
}
