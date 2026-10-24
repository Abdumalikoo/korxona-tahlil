'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import { IconChevronRight, IconSpinner } from '@/components/ui/icons';
import { useDrill, type DrillTarget } from '@/features/explore/drill';
import { compact, pct, som, type CompareMode, type SectionFilter } from '@/features/structure/api';
import { formatPeriod } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { regionsApi, type UnitPart, type UnitStats } from './api';
import { centerDrillApi, drillApi, type MoneyPart } from './drill-api';
import { money, type Fmt } from './overall-tables';
import { segmentApi, type DrillNode } from './segment-api';

// ═══════════════════════════════════════════════════════════
// Solishtirma › Umumiy — qator bosilganda JOYIDA kengayadigan to'liq daraxt (boshqa sahifaga o'tmaydi).
//  • Hudud: tumanlar → tuman (xizmatlar, xarajat tarkibi, xodimlar) → xodim → oylar.
//  • Markaz: daromad manbalari, o'z xarajati, hududlar uchun to'langan, bo'limlar → bo'lim (tarkib, xodimlar) → xodim → oylar.
//  • Yo'nalish (Tax free, Qo'mita …): xarajat tuzilmalari → xodim / filial / modda → oylar; daromad → mijoz → oylar;
//    siyosat bo'yicha kelgan / o'tgan.
//  • Biriktirilmagan: moddalar → yozuvlar.
// Ichki darajalar bosilganda yuklanadi; «Hammasini ochish» — 3 darajagacha birdan ochadi.
// Summa bosilsa (yozuvlar filtri bo'lsa) — o'sha yozuvlar ro'yxati.
// ═══════════════════════════════════════════════════════════

export interface TNode {
  id: string;
  label: string;
  sub?: string;
  /** Guruh sarlavhasi (Tumanlar, Xodimlar …) */
  group?: boolean;
  income?: number | null;
  expense?: number | null;
  prevIncome?: number | null;
  prevExpense?: number | null;
  headcount?: number | null;
  children?: TNode[];
  load?: () => Promise<TNode[]>;
  records?: { kind: 'income' | 'expense'; f: DrillTarget['f']; title: string };
}

interface Ctx {
  range: DateRange;
  section: SectionFilter;
  compare: CompareMode;
}

const n = (s: string | null | undefined) => Number(s ?? 0);

function parts(prefix: string, list: (UnitPart | MoneyPart)[], side: 'income' | 'expense'): TNode[] {
  return list
    .filter((p) => n(p.amountTiyin) !== 0 || n(p.previousTiyin) !== 0)
    .map((p) => ({ id: `${prefix}:${p.key}`, label: p.label, [side]: n(p.amountTiyin), [side === 'income' ? 'prevIncome' : 'prevExpense']: n(p.previousTiyin) }));
}

function group(id: string, label: string, kids: TNode[] | (() => Promise<TNode[]>), extra: Partial<TNode> = {}): TNode {
  return { id, label, group: true, ...(typeof kids === 'function' ? { load: kids } : { children: kids }), ...extra };
}

/** Xodim → oylar (ish haqi, reja, tushum) */
function employeeNode(prefix: string, e: { pinfl: string; fullName: string; position: string | null; salaryTiyin: string; previousSalaryTiyin: string }, c: Ctx): TNode {
  return {
    id: `${prefix}:e:${e.pinfl}`,
    label: e.fullName,
    sub: e.position ?? undefined,
    expense: n(e.salaryTiyin),
    prevExpense: n(e.previousSalaryTiyin),
    load: async () => {
      const d = (await drillApi.employee(e.pinfl, c.range)).data;
      return d.months.map((m) => ({
        id: `${prefix}:e:${e.pinfl}:${m.period}`,
        label: formatPeriod(m.period),
        sub: [m.districtName ?? m.regionName, n(m.planTiyin) ? `reja ${compact(n(m.planTiyin))}` : '', n(m.factTiyin) ? `tushum ${compact(n(m.factTiyin))}` : ''].filter(Boolean).join(' · '),
        expense: n(m.salaryTiyin),
        income: n(m.factTiyin) || null,
      }));
    },
  };
}

function regionTree(s: UnitStats, c: Ctx): TNode[] {
  const code = s.unit.code!;
  return [
    group(`r${code}:d`, 'Tumanlar', async () => {
      const d = (await drillApi.region(code, c.range, c.section, c.compare)).data;
      return d.districts.map((t) => ({
        id: `r${code}:d:${t.id}`,
        label: t.name,
        sub: t.unassigned ? "tumanga bo'linmagan" : undefined,
        income: n(t.incomeTiyin),
        expense: n(t.expenseTiyin),
        prevIncome: n(t.previousIncomeTiyin),
        prevExpense: n(t.previousExpenseTiyin),
        headcount: t.headcount,
        load: async () => {
          const x = (await drillApi.district(t.id, code, c.range, c.section, c.compare)).data;
          const p = `r${code}:d:${t.id}`;
          return [
            group(
              `${p}:s`,
              'Xizmatlar (daromad)',
              x.services.map((sv) => ({ id: `${p}:s:${sv.code}`, label: sv.label, sub: sv.quantity ? `${sv.quantity} ta` : undefined, income: n(sv.amountTiyin), prevIncome: n(sv.previousTiyin) })),
            ),
            group(`${p}:x`, 'Xarajat tarkibi', parts(`${p}:x`, x.expenseParts, 'expense')),
            group(`${p}:e`, `Xodimlar · ${x.employees.length}`, x.employees.map((e) => employeeNode(p, e, c))),
          ].filter((g) => g.children!.length);
        },
      }));
    }),
    group(`r${code}:inc`, 'Daromad tarkibi', parts(`r${code}:inc`, s.unit.incomeParts, 'income'), { records: { kind: 'income', f: { unit: s.unit.key }, title: `${s.unit.name} › Daromad` } }),
    group(`r${code}:exp`, 'Xarajat tarkibi', parts(`r${code}:exp`, s.unit.expenseParts, 'expense')),
  ];
}

function centerTree(s: UnitStats, c: Ctx): TNode[] {
  // Bitta so'rov — hamma guruhlar
  let cache: Promise<Awaited<ReturnType<typeof centerDrillApi.center>>['data']> | null = null;
  const data = () => (cache ??= centerDrillApi.center(c.range, c.section, c.compare).then((r) => r.data));
  return [
    group('c:dep', "Bo'limlar", async () =>
      (await data()).departments.map((d) => ({
        id: `c:dep:${d.id}`,
        label: d.name,
        sub: d.unassigned ? "bo'limga biriktirilmagan" : undefined,
        income: n(d.incomeTiyin),
        expense: n(d.expenseTiyin),
        prevIncome: n(d.previousIncomeTiyin),
        prevExpense: n(d.previousExpenseTiyin),
        headcount: d.headcount,
        load: async () => {
          const x = (await centerDrillApi.department(d.id, c.range, c.section, c.compare)).data;
          const p = `c:dep:${d.id}`;
          return [
            group(`${p}:i`, 'Daromad tarkibi', parts(`${p}:i`, x.incomeParts, 'income')),
            group(`${p}:x`, 'Xarajat tarkibi', parts(`${p}:x`, x.expenseParts, 'expense')),
            group(`${p}:e`, `Xodimlar · ${x.employees.length}`, x.employees.map((e) => employeeNode(p, e, c))),
          ].filter((g) => g.children!.length);
        },
      })),
    ),
    group('c:inc', 'Daromad manbalari', async () => parts('c:inc', (await data()).incomeParts, 'income'), { records: { kind: 'income', f: { unit: 'center' }, title: 'Markaz › Daromad' } }),
    group('c:own', "O'z xarajati", async () => parts('c:own', (await data()).ownParts, 'expense')),
    group('c:reg', 'Hududlar uchun to‘langan (siyosat bo‘yicha)', async () => {
      const d = await data();
      return [
        ...parts('c:reg', d.regionalParts, 'expense'),
        ...(d.regionalBy.length
          ? [group('c:regby', 'Qaysi hudud uchun', d.regionalBy.map((r) => ({ id: `c:regby:${r.regionCode ?? '-'}`, label: r.name, expense: n(r.amountTiyin) })))]
          : []),
      ];
    }),
  ];
}

function mapDrill(list: DrillNode[], side: 'income' | 'expense', months: string[], prefix: string, root: string): TNode[] {
  return list.map((d) => {
    const id = `${prefix}:${d.key}`;
    const kids = d.children?.length
      ? mapDrill(d.children, side, months, id, `${root} › ${d.label}`)
      : months.length > 1
        ? months
            .map((m, i) => ({ m, v: n(d.values[i]) }))
            .filter((x) => x.v !== 0)
            .map(({ m, v }) => ({
              id: `${id}@${m}`,
              label: formatPeriod(m),
              [side]: v,
              ...(d.f ? { records: { kind: side, f: { ...d.f, month: m }, title: `${root} › ${d.label} › ${formatPeriod(m)}` } } : {}),
            }))
        : [];
    return {
      id,
      label: d.label,
      sub: d.hint,
      [side]: n(d.amountTiyin),
      [side === 'income' ? 'prevIncome' : 'prevExpense']: n(d.previousTiyin),
      ...(kids.length ? { children: kids } : {}),
      ...(d.f ? { records: { kind: side, f: d.f, title: `${root} › ${d.label}` } } : {}),
    } as TNode;
  });
}

function segmentTree(s: UnitStats, c: Ctx): TNode[] {
  const code = s.unit.segment ?? s.unit.key.slice(2);
  let cache: ReturnType<typeof segmentApi.view> | null = null;
  const data = async () => (await (cache ??= segmentApi.view(code, c.range, c.section, c.compare))).data;
  return [
    group(`s:${code}:x`, 'Xarajat — tuzilmalar bo‘yicha', async () => {
      const d = await data();
      return mapDrill(d.tree.expense, 'expense', d.tree.months, `s:${code}:x`, `${s.unit.name} › Xarajat`);
    }),
    group(
      `s:${code}:i`,
      'Daromad — xizmat turlari bo‘yicha',
      async () => {
        const d = await data();
        return mapDrill(d.tree.income, 'income', d.tree.months, `s:${code}:i`, `${s.unit.name} › Daromad`);
      },
      { records: { kind: 'income', f: { unit: s.unit.key }, title: `${s.unit.name} › Daromad` } },
    ),
    group(`s:${code}:out`, "Shu bo'limdan boshqa bo'lim hisobiga (siyosat)", async () =>
      (await data()).outgoing.map((f) => ({
        id: `s:${code}:out:${f.unit}:${f.code}`,
        label: f.label,
        sub: `→ ${f.unitLabel} · xarajatga kirmaydi`,
        expense: n(f.amountTiyin),
        prevExpense: n(f.previousTiyin),
        records: { kind: 'expense' as const, f: f.f, title: `${s.unit.name} › ${f.label} → ${f.unitLabel}` },
      })),
    ),
  ];
}

function unassignedTree(c: Ctx): TNode[] {
  let cache: ReturnType<typeof regionsApi.unassigned> | null = null;
  const data = async () => (await (cache ??= regionsApi.unassigned(c.range, c.section))).data;
  const side = (key: 'income' | 'expense', label: string): TNode =>
    group(`u:${key}`, label, async () => {
      const d = (await data())[key];
      return d.byCategory.map((g) => ({
        id: `u:${key}:${g.key}`,
        label: g.label,
        sub: `${g.count} ta yozuv`,
        [key]: n(g.totalTiyin),
        children: d.items
          .filter((i) => i.categoryCode === g.key)
          .map((i) => ({ id: `u:${key}:${g.key}:${i.id}`, label: `${i.date.slice(8, 10)}.${i.date.slice(5, 7)}.${i.date.slice(0, 4)} · ${i.counterparty ?? i.description ?? '—'}`, sub: [i.documentNo, i.fileName].filter(Boolean).join(' · ') || undefined, [key]: n(i.amountTiyin) })),
      }));
    });
  return [side('income', 'Daromad — moddalar → yozuvlar'), side('expense', 'Xarajat — moddalar → yozuvlar')];
}

export function unitTree(s: UnitStats, c: Ctx): TNode[] {
  if (s.unit.kind === 'region' && s.unit.code !== null) return regionTree(s, c);
  if (s.unit.kind === 'center') return centerTree(s, c);
  if (s.unit.kind === 'segment') return segmentTree(s, c);
  return unassignedTree(c);
}

const MAX_AUTO_LOADS = 60;

/** Kengayadigan daraxt jadvali (Umumiy jadvaldagi qator ichida) */
export function UnitTree({ s, range, section, compare, fmt }: { s: UnitStats; range: DateRange; section: SectionFilter; compare: CompareMode; fmt: Fmt }) {
  const { open: openRecords } = useDrill();
  const [roots] = useState(() => unitTree(s, { range, section, compare }));
  const [opened, setOpened] = useState<Set<string>>(() => new Set(roots.slice(0, 1).map((r) => r.id)));
  const [loaded, setLoaded] = useState<Map<string, TNode[]>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [busyAll, setBusyAll] = useState(false);
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;

  const kidsOf = useCallback((nd: TNode) => nd.children ?? loadedRef.current.get(nd.id), []);

  const ensure = useCallback(async (nd: TNode): Promise<TNode[]> => {
    const have = nd.children ?? loadedRef.current.get(nd.id);
    if (have) return have;
    if (!nd.load) return [];
    setLoading((x) => new Set(x).add(nd.id));
    try {
      const kids = await nd.load();
      setLoaded((m) => {
        const next = new Map(m).set(nd.id, kids);
        loadedRef.current = next;
        return next;
      });
      return kids;
    } catch (e) {
      setErrors((m) => new Map(m).set(nd.id, e instanceof Error ? e.message : "Yuklab bo'lmadi"));
      return [];
    } finally {
      setLoading((x) => {
        const y = new Set(x);
        y.delete(nd.id);
        return y;
      });
    }
  }, []);

  // Birinchi guruh — darhol ochiq (yuklanadi)
  useEffect(() => {
    if (roots[0]) void ensure(roots[0]);
  }, [roots, ensure]);

  const toggle = (nd: TNode) => {
    setOpened((o) => {
      const x = new Set(o);
      if (x.has(nd.id)) x.delete(nd.id);
      else {
        x.add(nd.id);
        void ensure(nd);
      }
      return x;
    });
  };

  /** 3 darajagacha hammasini ochish (yuklanadigan tugunlar soni cheklangan) */
  async function expandAll() {
    setBusyAll(true);
    const ids = new Set<string>();
    let loads = 0;
    let level: TNode[] = roots;
    for (let depth = 0; depth < 3 && level.length; depth += 1) {
      const next: TNode[] = [];
      for (const nd of level) {
        const expandable = nd.children?.length || nd.load;
        if (!expandable) continue;
        if (!nd.children && !loadedRef.current.get(nd.id)) {
          if (loads >= MAX_AUTO_LOADS) continue;
          loads += 1;
        }
        ids.add(nd.id);
        next.push(...(await ensure(nd)));
      }
      level = next;
    }
    setOpened(ids);
    setBusyAll(false);
  }

  const rows: ReactNode[] = [];
  const walk = (list: TNode[], depth: number) => {
    for (const nd of list) {
      const kids = kidsOf(nd);
      const expandable = Boolean(nd.children?.length || nd.load);
      const isOpen = opened.has(nd.id);
      const has = (v: number | null | undefined) => v !== null && v !== undefined;
      const result = has(nd.income) || has(nd.expense) ? (nd.income ?? 0) - (nd.expense ?? 0) : null;
      const prevResult = has(nd.prevIncome) || has(nd.prevExpense) ? (nd.prevIncome ?? 0) - (nd.prevExpense ?? 0) : null;
      // O'zgarish: natija (ikkala tomon bo'lsa) yoki bitta summa
      const cur = has(nd.income) && has(nd.expense) ? result : (nd.income ?? nd.expense ?? null);
      const prev = has(nd.prevIncome) && has(nd.prevExpense) ? prevResult : (nd.prevIncome ?? nd.prevExpense ?? null);
      const delta = cur !== null && prev ? ((cur - prev) / Math.abs(prev)) * 100 : null;
      const upGood = !has(nd.expense) || has(nd.income);
      rows.push(
        <tr
          key={nd.id}
          onClick={expandable ? () => toggle(nd) : undefined}
          className={cn('border-t border-(--color-line)/70', expandable && 'cursor-pointer hover:bg-brand-50/50', nd.group ? 'bg-white' : depth % 2 ? 'bg-(--color-surface-muted)/40' : 'bg-white/70')}
        >
          <td className="py-1.5 pr-2" style={{ paddingLeft: `${0.25 + depth * 1.15}rem` }}>
            <span className="flex items-center gap-1.5">
              {expandable ? (
                loading.has(nd.id) ? (
                  <IconSpinner className="size-3.5 shrink-0 text-brand-600" />
                ) : (
                  <IconChevronRight className={cn('size-3.5 shrink-0 text-(--color-text-muted) transition-transform', isOpen && 'rotate-90')} />
                )
              ) : (
                <span className="size-3.5 shrink-0" />
              )}
              <span className="min-w-0">
                <span className={cn('block truncate', nd.group ? 'text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)' : 'text-heading')}>{nd.label}</span>
                {nd.sub && <span className="block truncate text-[10.5px] text-(--color-text-faint)">{nd.sub}</span>}
              </span>
              {nd.records && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openRecords({ ...nd.records!, expected: nd.records!.kind === 'income' ? (nd.income ?? undefined) : (nd.expense ?? undefined) });
                  }}
                  className="ml-1 shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-medium text-brand-700 hover:bg-brand-50 hover:underline"
                  title="Shu summani tashkil qilgan yozuvlar"
                >
                  yozuvlar
                </button>
              )}
            </span>
          </td>
          <td className="px-2 py-1.5 text-right tabular-nums" title={has(nd.income) ? som(nd.income!) : undefined}>
            {has(nd.income) ? money(nd.income!, fmt) : ''}
          </td>
          <td className="px-2 py-1.5 text-right tabular-nums" title={has(nd.expense) ? som(nd.expense!) : undefined}>
            {has(nd.expense) ? money(nd.expense!, fmt) : ''}
          </td>
          <td className={cn('px-2 py-1.5 text-right font-medium tabular-nums', result === null ? '' : result >= 0 ? 'text-(--color-income)' : 'text-(--color-expense)')}>
            {has(nd.income) && has(nd.expense) && result !== null ? money(result, fmt) : ''}
          </td>
          <td className="px-2 py-1.5 text-right text-xs tabular-nums">
            {prev !== null && prev !== 0 ? <span className="text-(--color-text-muted)">{money(prev, fmt)}</span> : ''}
            {delta !== null && (
              <span className={cn('ml-1.5 font-semibold', delta === 0 ? 'text-(--color-text-faint)' : delta > 0 === upGood ? 'text-(--color-income)' : 'text-(--color-expense)')}>
                {delta > 0 ? '+' : ''}
                {pct(delta)}
              </span>
            )}
          </td>
          <td className="px-2 py-1.5 text-right tabular-nums">{nd.headcount ? nd.headcount : ''}</td>
        </tr>,
      );
      if (!isOpen) continue;
      const err = errors.get(nd.id);
      if (err)
        rows.push(
          <tr key={`${nd.id}!`}>
            <td colSpan={6} className="py-1.5 text-xs text-(--color-expense)" style={{ paddingLeft: `${1.4 + (depth + 1) * 1.15}rem` }}>
              {err}
            </td>
          </tr>,
        );
      else if (kids) {
        if (!kids.length)
          rows.push(
            <tr key={`${nd.id}~`}>
              <td colSpan={6} className="py-1.5 text-xs text-(--color-text-faint)" style={{ paddingLeft: `${1.4 + (depth + 1) * 1.15}rem` }}>
                Bu davrda yo&apos;q
              </td>
            </tr>,
          );
        else walk(kids, depth + 1);
      }
    }
  };
  walk(roots, 0);

  return (
    <div className="overflow-hidden rounded-(--radius-card) border border-(--color-line) bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-(--color-line) px-3 py-2">
        <p className="text-xs font-semibold text-heading">«{s.unit.name}» — to&apos;liq tarkib</p>
        <span className="text-[11px] text-(--color-text-faint)">qatorni bosing — ochiladi; «yozuvlar» — o&apos;sha summa yozuvlari</span>
        <button type="button" onClick={() => void expandAll()} disabled={busyAll} className="ml-auto rounded-(--radius-control) border border-(--color-line) px-2.5 py-1 text-xs font-medium text-heading hover:bg-brand-50 disabled:opacity-60">
          {busyAll ? 'Ochilmoqda…' : 'Hammasini ochish'}
        </button>
        <button type="button" onClick={() => setOpened(new Set())} className="rounded-(--radius-control) border border-(--color-line) px-2.5 py-1 text-xs font-medium text-heading hover:bg-brand-50">
          Yopish
        </button>
      </div>
      <div className="max-h-[38rem] overflow-auto">
        <table className="w-full min-w-[760px] text-[13px]">
          <thead className="sticky top-0 z-[2] bg-(--color-surface-muted) text-[10.5px] uppercase tracking-wider text-(--color-text-muted)">
            <tr>
              <th className="px-2 py-1.5 text-left font-semibold">Nomi</th>
              <th className="w-32 px-2 py-1.5 text-right font-semibold">Daromad</th>
              <th className="w-32 px-2 py-1.5 text-right font-semibold">Xarajat</th>
              <th className="w-32 px-2 py-1.5 text-right font-semibold">Natija</th>
              <th className="w-40 px-2 py-1.5 text-right font-semibold">O&apos;tgan davr · o&apos;zgarish</th>
              <th className="w-16 px-2 py-1.5 text-right font-semibold">Xodim</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    </div>
  );
}