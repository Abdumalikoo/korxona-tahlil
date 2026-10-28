import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { runExclusive } from '../../common/locks';
import { monthsBetween } from '../../common/period';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { renderExcel } from '../reports/render.excel';
import { renderPdf } from '../reports/render.pdf';
import { FORMAT_INFO, type Cell, type ReportDoc, type ReportSection } from '../reports/reports.types';
import { periodLabel, safeFile } from '../reports/reports.format';
import { cleanPicks, KPI_TEMPLATES, score, templateOf, type KpiPick, type KpiTemplate } from './kpi.templates';

// ═══════════════════════════════════════════════════════════
// KPI baholash: bo'lim rahbari (rol BOLIM_RAHBARI) faqat o'z bo'limi xodimlarini oyma-oy baholaydi —
// xodim → tur (rag'batlantiruvchi / kamaytiruvchi) → mezon → daraja / holatlar soni; ball shablondan hisoblanadi
// (o'zgartirib bo'lmaydi) va o'zi saqlanadi. Oy yakunida «Yuborish» — baholar yig'ma KPI'ga tushadi va qulflanadi
// (administrator qaytara oladi). Administrator har bo'lim stolini ochib ko'radi va baholay oladi.
// Saqlash — settings (migratsiyasiz):
//  «kpi.heads»               — foydalanuvchi id → shablon kaliti (qaysi bo'lim rahbari);
//  «kpi.eval.<kalit>.<oy>»   — oy baholari: xodim → tanlovlar, ballar (hisoblangan nusxa), kim / qachon; yuborilgani.
// ═══════════════════════════════════════════════════════════

const HEADS_KEY = 'kpi.heads';
const evalKey = (t: string, period: string) => `kpi.eval.${t}.${period}`;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface KpiActor {
  id: string;
  role: UserRole | string;
  fullName?: string;
}

export interface EvalEntry {
  picks: Record<string, KpiPick>;
  points: Record<string, number>;
  bonus: number;
  penalty: number;
  total: number;
  savedAt: string;
  savedBy: string;
}

export interface MonthStore {
  employees: Record<string, EvalEntry>;
  submittedAt: string | null;
  submittedBy: string | null;
}

@Injectable()
export class KpiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async read<T>(key: string, fallback: T): Promise<T> {
    const v = (await this.prisma.setting.findUnique({ where: { key } }))?.value;
    return v && typeof v === 'object' ? (v as T) : fallback;
  }

  private async write(key: string, value: unknown) {
    const v = value as object;
    await this.prisma.setting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
  }

  private async heads(): Promise<Record<string, string>> {
    return this.read<Record<string, string>>(HEADS_KEY, {});
  }

  /** Qaysi bo'lim: rahbar — faqat o'ziniki (so'ralgani e'tiborsiz); administrator / kuzatuvchi — so'ralgani */
  private async templateFor(actor: KpiActor, requested?: string): Promise<KpiTemplate> {
    if (actor.role === UserRole.BOLIM_RAHBARI) {
      const key = (await this.heads())[actor.id];
      const t = key ? templateOf(key) : null;
      if (!t) throw new ForbiddenException("Sizga bo'lim biriktirilmagan — administratorga murojaat qiling");
      return t;
    }
    const t = templateOf(String(requested ?? ''));
    if (!t) throw new NotFoundException("Bo'lim (KPI shabloni) topilmadi");
    return t;
  }

  private canEdit(actor: KpiActor) {
    return actor.role === UserRole.ADMIN || actor.role === UserRole.BOLIM_RAHBARI;
  }

  private async department(t: KpiTemplate) {
    const d = await this.prisma.department.findFirst({ where: { name: t.department }, select: { id: true, name: true } });
    if (!d) throw new NotFoundException(`«${t.department}» bo'limi topilmadi`);
    return d;
  }

  private checkPeriod(p: unknown): string {
    if (typeof p !== 'string' || !PERIOD_RE.test(p)) throw new BadRequestException("Oy noto'g'ri (YYYY-MM)");
    return p;
  }

  private async month(t: KpiTemplate, period: string): Promise<MonthStore> {
    const v = await this.read<Partial<MonthStore>>(evalKey(t.key, period), {});
    return { employees: v.employees && typeof v.employees === 'object' ? v.employees : {}, submittedAt: v.submittedAt ?? null, submittedBy: v.submittedBy ?? null };
  }

  private async actorName(actor: KpiActor) {
    return actor.fullName ?? (await this.prisma.user.findUnique({ where: { id: actor.id }, select: { fullName: true } }))?.fullName ?? '';
  }

  /** Bo'lim xodimlari (shu oyda ishlaganlar) */
  private async employees(depId: string, period: string) {
    const [y, m] = period.split('-').map(Number) as [number, number];
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1));
    const list = await this.prisma.employee.findMany({ where: { departmentId: depId }, select: { pinfl: true, fullName: true, position: true, hiredAt: true, firedAt: true, isActive: true }, orderBy: { fullName: 'asc' } });
    return list.filter((e) => (!e.hiredAt || e.hiredAt < end) && (!e.firedAt || e.firedAt >= start) && (e.isActive || e.firedAt));
  }

  // ─────────── Rahbar ish stoli ───────────

  /** Shablon va kirish ma'lumoti: rahbar — o'z bo'limi; administrator — tanlash ro'yxati */
  async me(actor: KpiActor, requested?: string) {
    const all = KPI_TEMPLATES.map((t) => ({ key: t.key, department: t.department }));
    if (actor.role !== UserRole.BOLIM_RAHBARI && !requested) return { template: null, templates: all, canEdit: this.canEdit(actor), isHead: false };
    const t = await this.templateFor(actor, requested);
    return { template: t, templates: actor.role === UserRole.BOLIM_RAHBARI ? [] : all, canEdit: this.canEdit(actor), isHead: actor.role === UserRole.BOLIM_RAHBARI };
  }

  /** Oy varag'i: bo'lim xodimlari, har birining bahosi va oy holati */
  async sheet(actor: KpiActor, requested: string | undefined, periodRaw: unknown) {
    const period = this.checkPeriod(periodRaw);
    const t = await this.templateFor(actor, requested);
    const dep = await this.department(t);
    const [emps, m] = await Promise.all([this.employees(dep.id, period), this.month(t, period)]);
    return {
      key: t.key,
      department: dep.name,
      period,
      submittedAt: m.submittedAt,
      submittedBy: m.submittedBy,
      canEdit: this.canEdit(actor) && !m.submittedAt,
      employees: emps.map((e) => {
        const ev = m.employees[e.pinfl];
        return { pinfl: e.pinfl, fullName: e.fullName, position: e.position, evaluation: ev ?? null };
      }),
    };
  }

  /** Baholash (har o'zgarishda o'zi saqlanadi): tanlovlar → ball shablondan */
  async save(actor: KpiActor, body: { b?: unknown; period?: unknown; pinfl?: unknown; picks?: unknown }) {
    if (!this.canEdit(actor)) throw new ForbiddenException("Baholash huquqi yo'q");
    const period = this.checkPeriod(body?.period);
    const t = await this.templateFor(actor, typeof body?.b === 'string' ? body.b : undefined);
    const dep = await this.department(t);
    const pinfl = typeof body?.pinfl === 'string' ? body.pinfl : '';
    if (!(await this.employees(dep.id, period)).some((e) => e.pinfl === pinfl)) throw new NotFoundException("Xodim shu bo'limda topilmadi");
    const picks = cleanPicks(t, body?.picks);
    const s = score(t, picks);
    const by = await this.actorName(actor);
    const entry: EvalEntry = { picks, points: Object.fromEntries(s.items.filter((x) => x.points).map((x) => [x.id, x.points])), bonus: s.bonus, penalty: s.penalty, total: s.total, savedAt: new Date().toISOString(), savedBy: by };
    await runExclusive(`setting:${evalKey(t.key, period)}`, async () => {
      const m = await this.month(t, period);
      if (m.submittedAt) throw new BadRequestException("Bu oy baholari yuborilgan — o'zgartirish uchun administrator qaytarishi kerak");
      if (Object.keys(picks).length) m.employees[pinfl] = entry;
      else delete m.employees[pinfl];
      await this.write(evalKey(t.key, period), m);
    });
    return { evaluation: Object.keys(picks).length ? entry : null };
  }

  /** Oy baholarini yuborish (qulflanadi) */
  async submit(actor: KpiActor, body: { b?: unknown; period?: unknown }) {
    if (!this.canEdit(actor)) throw new ForbiddenException("Yuborish huquqi yo'q");
    const period = this.checkPeriod(body?.period);
    const t = await this.templateFor(actor, typeof body?.b === 'string' ? body.b : undefined);
    const by = await this.actorName(actor);
    const n = await runExclusive(`setting:${evalKey(t.key, period)}`, async () => {
      const m = await this.month(t, period);
      if (m.submittedAt) throw new BadRequestException('Allaqachon yuborilgan');
      const count = Object.keys(m.employees).length;
      if (!count) throw new BadRequestException('Hali hech kim baholanmagan');
      m.submittedAt = new Date().toISOString();
      m.submittedBy = by;
      await this.write(evalKey(t.key, period), m);
      return count;
    });
    await this.audit.log({ userId: actor.id, action: 'UPDATE', entity: 'kpi', entityId: `${t.key}.${period}`, summary: `KPI: ${t.department}, ${period} — ${n} ta xodim bahosi yuborildi` });
    return { submitted: n };
  }

  /** Yuborilgan oyni qaytarish (faqat administrator) */
  async reopen(actor: KpiActor, body: { b?: unknown; period?: unknown }) {
    if (actor.role !== UserRole.ADMIN) throw new ForbiddenException('Faqat administrator');
    const period = this.checkPeriod(body?.period);
    const t = await this.templateFor(actor, typeof body?.b === 'string' ? body.b : undefined);
    await runExclusive(`setting:${evalKey(t.key, period)}`, async () => {
      const m = await this.month(t, period);
      m.submittedAt = null;
      m.submittedBy = null;
      await this.write(evalKey(t.key, period), m);
    });
    await this.audit.log({ userId: actor.id, action: 'UPDATE', entity: 'kpi', entityId: `${t.key}.${period}`, summary: `KPI: ${t.department}, ${period} — tahrirga qaytarildi` });
    return { reopened: true };
  }

  // ─────────── Rahbarlar (administrator) ───────────

  async headsList() {
    const [map, users] = await Promise.all([this.heads(), this.prisma.user.findMany({ where: { role: UserRole.BOLIM_RAHBARI }, select: { id: true, fullName: true, loginCode: true, isActive: true }, orderBy: { fullName: 'asc' } })]);
    return { users: users.map((u) => ({ ...u, template: map[u.id] ?? null })), templates: KPI_TEMPLATES.map((t) => ({ key: t.key, department: t.department })) };
  }

  async setHead(actor: KpiActor, body: { userId?: unknown; b?: unknown }) {
    const userId = typeof body?.userId === 'string' ? body.userId : '';
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, fullName: true } });
    if (!u || u.role !== UserRole.BOLIM_RAHBARI) throw new NotFoundException("Bo'lim rahbari topilmadi");
    const key = body?.b === null ? null : templateOf(String(body?.b ?? ''))?.key;
    if (key === undefined) throw new NotFoundException("Bo'lim topilmadi");
    await runExclusive(`setting:${HEADS_KEY}`, async () => {
      const m = await this.heads();
      if (key) m[userId] = key;
      else delete m[userId];
      await this.write(HEADS_KEY, m);
    });
    await this.audit.log({ userId: actor.id, action: 'UPDATE', entity: 'kpi', entityId: userId, summary: `KPI: ${u.fullName} — ${key ? `${templateOf(key)!.department} bo'limi rahbari` : "bo'lim olib tashlandi"}` });
    return { saved: true };
  }

  // ─────────── Rol sahifasi (Rollar › KPI: bo'lim) ───────────

  /**
   * Bitta bo'lim KPI dashbordi (umumiy hudud): rahbar(lar), yil oylari — baholangan / o'rtacha / yuborilgan,
   * joriy oy holati, eng yuqori va eng past ball, so'nggi harakatlar (kim, qachon, kimni baholadi), diqqat.
   */
  async departmentOverview(requested: unknown, yearRaw?: unknown) {
    const t = templateOf(String(requested ?? ''));
    if (!t) throw new NotFoundException("Bo'lim (KPI shabloni) topilmadi");
    const now = new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 7);
    const year = typeof yearRaw === 'string' && /^\d{4}$/.test(yearRaw) ? yearRaw : now.slice(0, 4);
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`).filter((p) => p <= now);
    const dep = await this.department(t);
    const [map, heads, rows, emps] = await Promise.all([
      this.heads(),
      this.prisma.user.findMany({ where: { role: UserRole.BOLIM_RAHBARI }, select: { id: true, fullName: true, loginCode: true, isActive: true, mustChangePin: true, lastLoginAt: true, lockedUntil: true } }),
      this.prisma.setting.findMany({ where: { key: { in: months.map((p) => evalKey(t.key, p)) } }, select: { key: true, value: true } }),
      this.employees(dep.id, now),
    ]);
    const byKey = new Map(rows.map((r) => [r.key, r.value as Partial<MonthStore>]));
    const names = new Map((await this.prisma.employee.findMany({ where: { departmentId: dep.id }, select: { pinfl: true, fullName: true } })).map((e) => [e.pinfl, e.fullName]));
    const monthRows = months.map((p) => {
      const m = byKey.get(evalKey(t.key, p));
      const list = Object.values(m?.employees ?? {});
      return { period: p, count: list.length, average: list.length ? Math.round((list.reduce((s, e) => s + e.total, 0) / list.length) * 10) / 10 : null, submittedAt: m?.submittedAt ?? null, submittedBy: m?.submittedBy ?? null };
    });
    const cur = byKey.get(evalKey(t.key, now));
    // Oxirgi baholangan oy — eng yuqori va eng past
    const lastP = [...monthRows].reverse().find((m) => m.count)?.period ?? null;
    const lastList = lastP ? Object.entries(byKey.get(evalKey(t.key, lastP))?.employees ?? {}).map(([pinfl, e]) => ({ pinfl, fullName: names.get(pinfl) ?? pinfl, total: e.total, bonus: e.bonus, penalty: e.penalty })) : [];
    lastList.sort((a, b) => b.total - a.total);
    // So'nggi harakatlar (saqlash vaqti bo'yicha)
    const activity = months
      .flatMap((p) => Object.entries(byKey.get(evalKey(t.key, p))?.employees ?? {}).map(([pinfl, e]) => ({ period: p, pinfl, fullName: names.get(pinfl) ?? pinfl, total: e.total, savedAt: e.savedAt, savedBy: e.savedBy })))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
      .slice(0, 30);
    const myHeads = heads.filter((h) => map[h.id] === t.key).map((h) => ({ ...h, locked: Boolean(h.lockedUntil && h.lockedUntil > new Date()) }));
    // Diqqat
    const alerts: { tone: 'red' | 'amber'; text: string }[] = [];
    if (!myHeads.length) alerts.push({ tone: 'red', text: "Bo'limga rahbar biriktirilmagan — Yig'ma KPI › Bo'lim rahbarlari" });
    for (const h of myHeads.filter((x) => x.isActive && x.mustChangePin)) alerts.push({ tone: 'amber', text: `${h.fullName}: hali kirmagan (birinchi kirishda PIN o'rnatadi)` });
    for (const h of myHeads.filter((x) => x.locked)) alerts.push({ tone: 'red', text: `${h.fullName}: xato PIN tufayli vaqtincha yopilgan` });
    const prev = months.length > 1 ? monthRows[monthRows.length - 2]! : null;
    if (prev && !prev.submittedAt) alerts.push({ tone: prev.count ? 'amber' : 'red', text: `${periodLabel(prev.period)} baholari ${prev.count ? `${prev.count} ta kiritilgan, lekin yuborilmagan` : 'kiritilmagan'}` });
    const curCount = Object.keys(cur?.employees ?? {}).length;
    if (emps.length && curCount < emps.length) alerts.push({ tone: 'amber', text: `${periodLabel(now)}: ${emps.length - curCount} ta xodim hali baholanmagan` });
    return {
      key: t.key,
      department: dep.name,
      title: t.title,
      source: t.source,
      year,
      now,
      employees: emps.length,
      current: { period: now, count: curCount, submittedAt: cur?.submittedAt ?? null, average: monthRows.find((m) => m.period === now)?.average ?? null },
      heads: myHeads.map(({ lockedUntil: _l, ...h }) => h),
      months: monthRows,
      last: lastP ? { period: lastP, top: lastList.slice(0, 5), bottom: lastList.length > 5 ? lastList.slice(-5).reverse() : [] } : null,
      activity,
      alerts,
      criteria: t.criteria.map((c) => ({ id: c.id, no: c.no, kind: c.kind, title: c.title, max: c.max })),
    };
  }

  // ─────────── Yig'ma KPI ───────────

  /** Hamma bo'limlar: oylar × xodimlar — baholar (mezonlar bilan), yuborilganmi */
  async summary(fromRaw: unknown, toRaw: unknown) {
    const from = this.checkPeriod(fromRaw);
    const to = this.checkPeriod(toRaw);
    const months = monthsBetween(from, to);
    if (!months.length || months.length > 24) throw new BadRequestException('Davr 1–24 oy');
    const keys = KPI_TEMPLATES.flatMap((t) => months.map((p) => evalKey(t.key, p)));
    const rows = await this.prisma.setting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
    const byKey = new Map(rows.map((r) => [r.key, r.value as Partial<MonthStore>]));
    const pinfls = new Set<string>();
    for (const r of rows) for (const p of Object.keys((r.value as Partial<MonthStore>)?.employees ?? {})) pinfls.add(p);
    const names = new Map((await this.prisma.employee.findMany({ where: { pinfl: { in: [...pinfls] } }, select: { pinfl: true, fullName: true, position: true } })).map((e) => [e.pinfl, e]));
    const departments = KPI_TEMPLATES.map((t) => {
      const monthsOut = months.map((p) => {
        const m = byKey.get(evalKey(t.key, p));
        return { period: p, submittedAt: m?.submittedAt ?? null, submittedBy: m?.submittedBy ?? null, count: Object.keys(m?.employees ?? {}).length };
      });
      const emp = new Map<string, { pinfl: string; fullName: string; position: string | null; months: Record<string, { bonus: number; penalty: number; total: number; submitted: boolean; points: Record<string, number> }> }>();
      for (const p of months) {
        const m = byKey.get(evalKey(t.key, p));
        for (const [pinfl, ev] of Object.entries(m?.employees ?? {})) {
          const x = emp.get(pinfl) ?? { pinfl, fullName: names.get(pinfl)?.fullName ?? pinfl, position: names.get(pinfl)?.position ?? null, months: {} };
          x.months[p] = { bonus: ev.bonus, penalty: ev.penalty, total: ev.total, submitted: Boolean(m?.submittedAt), points: ev.points ?? {} };
          emp.set(pinfl, x);
        }
      }
      const employees = [...emp.values()].map((e) => {
        const vals = Object.values(e.months);
        return { ...e, average: vals.length ? Math.round((vals.reduce((s, v) => s + v.total, 0) / vals.length) * 10) / 10 : null };
      });
      employees.sort((a, b) => (b.average ?? 0) - (a.average ?? 0) || a.fullName.localeCompare(b.fullName));
      return { key: t.key, department: t.department, criteria: t.criteria.map((c) => ({ id: c.id, no: c.no, kind: c.kind, title: c.title, max: c.max })), months: monthsOut, employees };
    });
    return { from, to, months, departments };
  }

  /** Yig'ma KPI hisoboti (Excel / PDF): bo'limlar → xodimlar × oylar, mezonlar bo'yicha tafsilot */
  async export(fromRaw: unknown, toRaw: unknown, formatRaw: unknown): Promise<{ buffer: Buffer; filename: string; mime: string }> {
    const format = formatRaw === 'pdf' ? 'pdf' : 'xlsx';
    const s = await this.summary(fromRaw, toRaw);
    const sections: ReportSection[] = [];
    const avgOf = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
    sections.push({
      title: "Bo'limlar bo'yicha",
      sheet: "Bo'limlar",
      blocks: [
        {
          type: 'table',
          columns: [{ label: "Bo'lim", width: 1.8 }, { label: 'Baholangan xodimlar', format: 'int' }, { label: "O'rtacha ball", format: 'decimal' }, { label: 'Yuborilgan oylar', width: 1.4 }],
          rows: s.departments.map((d) => [d.department, d.employees.length, avgOf(d.employees.map((e) => e.average ?? 0).filter((_, i) => d.employees[i]!.average !== null)), `${d.months.filter((m) => m.submittedAt).length} / ${d.months.length}`] as Cell[]),
        },
      ],
    });
    for (const d of s.departments) {
      sections.push({
        title: d.department,
        sheet: d.department,
        intro: `Yuborilgan: ${d.months.map((m) => `${periodLabel(m.period)} — ${m.submittedAt ? 'ha' : "yo'q"}`).join('; ')}.`,
        blocks: d.employees.length
          ? [
              {
                type: 'table',
                title: "Yakuniy ball (0–100) oyma-oy",
                freeze: true,
                filter: true,
                columns: [{ label: 'Xodim', width: 2.2 }, { label: 'Lavozim', width: 1.6 }, ...s.months.map((p) => ({ label: periodLabel(p), format: 'decimal' as const })), { label: "O'rtacha", format: 'decimal' }],
                rows: d.employees.map((e) => [e.fullName, e.position ?? '', ...s.months.map((p) => e.months[p]?.total ?? null), e.average] as Cell[]),
              },
              {
                type: 'table',
                title: "Mezonlar bo'yicha (davr bo'yicha jami ball; kamaytiruvchi — chegirma)",
                filter: true,
                columns: [{ label: 'Xodim', width: 2.2 }, ...d.criteria.map((c) => ({ label: `${c.kind === 'BONUS' ? '+' : '−'}${c.no}. ${c.title.slice(0, 40)}`, format: 'decimal' as const }))],
                rows: d.employees.map((e) => [e.fullName, ...d.criteria.map((c) => Object.values(e.months).reduce((t, m) => t + (m.points[c.id] ?? 0), 0))] as Cell[]),
              },
            ]
          : [{ type: 'notes', items: ['Bu davrda baholash kiritilmagan.'] }],
      });
    }
    const doc: ReportDoc = {
      kind: "Yig'ma KPI",
      title: "Yig'ma KPI",
      subtitle: `${periodLabel(s.from)} — ${periodLabel(s.to)}`,
      meta: [`${s.departments.length} bo'lim`, `${s.months.length} oy`],
      highlights: s.departments.map((d) => `${d.department}: ${d.employees.length} xodim baholangan, yuborilgan ${d.months.filter((m) => m.submittedAt).length}/${d.months.length} oy.`),
      sections,
      fileBase: safeFile(`Yigma KPI - ${s.from}_${s.to}`),
      generatedAt: new Date().toISOString(),
      coverSheet: 'Xulosa',
      ownMethodology: true,
    };
    const buffer = format === 'xlsx' ? await renderExcel(doc) : await renderPdf(doc);
    return { buffer, filename: `${doc.fileBase}.${FORMAT_INFO[format].ext}`, mime: FORMAT_INFO[format].mime };
  }
}
