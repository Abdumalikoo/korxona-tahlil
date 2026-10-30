'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import { IconChevronRight, IconSpinner } from '@/components/ui/icons';
import { useDrill, type DrillTarget } from '@/features/explore/drill';
import { compact, pct, som, type CompareMode, type SectionFilter } from '@/features/structure/api';
import { formatPeriod, formatPeriodShort } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { partDetailApi, partOpens, regionsApi, safarCostsApi, statsOf, vehicleCostsApi, type UnitPart, type UnitStats } from './api';
import { centerDrillApi, drillApi, type MoneyPart } from './drill-api';
import { money, type Fmt } from './overall-tables';
import { segmentApi, type DrillNode } from './segment-api';
import { ToggleAllButton } from '@/components/report/report';

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

export interface Ctx {
  range: DateRange;
  section: SectionFilter;
  compare: CompareMode;
}

const n = (s: string | null | undefined) => Number(s ?? 0);

function parts(prefix: string, list: (UnitPart | MoneyPart)[], side: 'income' | 'expense', vehicles?: { unit: string; c: Ctx }): TNode[] {
  return list
    .filter((p) => n(p.amountTiyin) !== 0 || n(p.previousTiyin) !== 0)
    .map((p) => ({
      id: `${prefix}:${p.key}`,
      label: p.label,
      [side]: n(p.amountTiyin),
      [side === 'income' ? 'prevIncome' : 'prevExpense']: n(p.previousTiyin),
      // Daromad qismi → yozuvlar (birlik va xizmat bo'yicha; Markaz bo'limi — dep bilan)
      ...(vehicles && side === 'income' ? { records: { kind: 'income' as const, f: { unit: vehicles.unit.startsWith('dep:') ? 'center' : vehicles.unit, ...(vehicles.unit.startsWith('dep:') ? { dep: vehicles.unit.slice(4) } : {}), cats: [p.key] }, title: p.label } } : {}),
      ...(vehicles && side === 'expense' && p.key === 'VEHICLE' ? { load: () => vehicleNodes(`${prefix}:${p.key}`, vehicles.unit, vehicles.c) } : {}),
      ...(vehicles && side === 'expense' && p.key === 'SAFAR' ? { load: () => safarNodes(`${prefix}:${p.key}`, vehicles.unit, vehicles.c) } : {}),
      ...(vehicles && side === 'expense' && partOpens(vehicles.unit, p.key) ? { load: () => partNodes(`${prefix}:${p.key}`, vehicles.unit, p.key, vehicles.c) } : {}),
    }));
}

/** Boshqa moddalar ichi — ichma-ich: guruh → moddalar → kontragent / joy (kalitli qator yana ochiladi) */
export async function partNodes(prefix: string, unit: string, key: string, c: Ctx): Promise<TNode[]> {
  const d = (await partDetailApi.detail({ unit, key, range: c.range, compare: c.compare, section: c.section })).data;
  return d.items.map((v, i) => {
    const id = `${prefix}:p:${v.key ?? i}`;
    const next = v.key;
    return {
      id,
      label: v.label,
      sub: [v.count ? `${v.count} ta yozuv` : '', v.sub ? `Izoh: ${v.sub}` : ''].filter(Boolean).join(' · ') || undefined,
      expense: n(v.amountTiyin),
      prevExpense: n(v.previousTiyin),
      ...(next ? { load: () => partNodes(id, unit, next, c) } : {}),
    };
  });
}

/** «Mashina xarajatlari» ichi: mashina (raqam · rusum, izoh) → turlari (yoqilg'i, ta'mirlash …) */
/** «Xizmat safari» ichi: xodim (ishlagan joyi) → oylar */
async function safarNodes(prefix: string, unit: string, c: Ctx): Promise<TNode[]> {
  const d = (await safarCostsApi.costs({ unit, range: c.range, compare: c.compare, section: c.section })).data;
  return d.items.map((v) => {
    const id = `${prefix}:x:${v.key}`;
    return {
      id,
      label: v.fullName,
      sub: [v.placeLabel, v.count > 1 ? `${v.count} ta to'lov` : ''].filter(Boolean).join(' · ') || undefined,
      expense: n(v.amountTiyin),
      prevExpense: n(v.previousTiyin),
      children: Object.entries(v.months).map(([m, t]) => ({ id: `${id}:${m}`, label: formatPeriod(m), expense: n(t) })),
    };
  });
}

async function vehicleNodes(prefix: string, unit: string, c: Ctx): Promise<TNode[]> {
  const d = (await vehicleCostsApi.costs({ unit, range: c.range, compare: c.compare, section: c.section })).data;
  return d.items.map((v) => {
    const id = `${prefix}:v:${v.vehicleId ?? '-'}`;
    return {
      id,
      label: [v.plateNumber, v.model].filter(Boolean).join(' · '),
      sub: [v.comment ? `Izoh: ${v.comment}` : '', v.driverName ? `haydovchi ${v.driverName}` : '', v.count ? `${v.count} ta yozuv` : ''].filter(Boolean).join(' · ') || undefined,
      expense: n(v.amountTiyin),
      prevExpense: n(v.previousTiyin),
      children: v.kinds.map((k) => ({ id: `${id}:k:${k.kind}`, label: k.label, expense: n(k.amountTiyin), prevExpense: n(k.previousTiyin) })),
    };
  });
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

/** Birlik statistikasi shu davr uchun (butun davr yoki bitta oy) — oylar ustunlari to'g'ri bo'lishi uchun; davr bo'yicha bir marta */
const unitsCache = new Map<string, Promise<UnitStats[]>>();
function unitAt(key: string, c: Ctx): Promise<UnitStats | null> {
  const k = [c.range.from, c.range.to, c.section, c.compare].join('|');
  let p = unitsCache.get(k);
  if (!p) {
    p = regionsApi.compare(c.range, c.section, c.compare).then((r) => r.data.units.map(statsOf));
    p.catch(() => unitsCache.delete(k));
    unitsCache.set(k, p);
  }
  return p.then((list) => list.find((x) => x.unit.key === key) ?? null);
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
            group(`${p}:x`, 'Xarajat tarkibi', parts(`${p}:x`, x.expenseParts, 'expense', { unit: t.unassigned ? `rnd:${code}` : `dist:${t.id}`, c })),
            group(`${p}:e`, `Xodimlar · ${x.employees.length}`, x.employees.map((e) => employeeNode(p, e, c))),
          ].filter((g) => g.children!.length);
        },
      }));
    }),
    // Viloyat bo'yicha tarkib — shu davr (oy) statistikasidan: oylar ustunida o'sha oyning summasi (jami takrorlanmaydi)
    group(`r${code}:inc`, "Daromad tarkibi (viloyat bo'yicha)", async () => parts(`r${code}:inc`, (await unitAt(s.unit.key, c))?.unit.incomeParts ?? [], 'income', { unit: s.unit.key, c }), { records: { kind: 'income', f: { unit: s.unit.key }, title: `${s.unit.name} › Daromad` } }),
    group(`r${code}:exp`, "Xarajat tarkibi (viloyat bo'yicha, barcha tumanlar)", async () => parts(`r${code}:exp`, (await unitAt(s.unit.key, c))?.unit.expenseParts ?? [], 'expense', { unit: `r:${code}`, c })),
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
            group(`${p}:i`, 'Daromad tarkibi', parts(`${p}:i`, x.incomeParts, 'income', { unit: `dep:${d.id}`, c })),
            group(`${p}:x`, 'Xarajat tarkibi', parts(`${p}:x`, x.expenseParts, 'expense', { unit: d.unassigned ? 'cnd' : `dep:${d.id}`, c })),
            group(`${p}:e`, `Xodimlar · ${x.employees.length}`, [
              ...x.employees.map((e) => employeeNode(p, e, c)),
              // Tekshiruv: bo'lim ish haqi − ro'yxatdagilar jami (0 bo'lmasa — ko'rinib tursin)
              ...(x.payrollTiyin !== undefined && n(x.payrollTiyin) - n(x.listedPayrollTiyin) !== 0
                ? [
                    {
                      id: `${p}:e:gap`,
                      label: n(x.payrollTiyin) > n(x.listedPayrollTiyin) ? 'Xodimga bog‘lanmagan ish haqi' : 'Siyosat bo‘yicha boshqa hisobga o‘tgan',
                      sub: `bo‘lim ish haqi ${som(n(x.payrollTiyin))} · ro‘yxatda ${som(n(x.listedPayrollTiyin))}`,
                      expense: n(x.payrollTiyin) - n(x.listedPayrollTiyin),
                    },
                  ]
                : []),
            ]),
          ].filter((g) => g.children!.length);
        },
      })),
    ),
    group('c:inc', 'Daromad manbalari', async () => parts('c:inc', (await data()).incomeParts, 'income', { unit: 'center', c }), { records: { kind: 'income', f: { unit: 'center' }, title: 'Markaz › Daromad' } }),
    group('c:own', "O'z xarajati", async () => parts('c:own', (await data()).ownParts, 'expense', { unit: 'center', c })),
    group('c:reg', 'Hududlar uchun to‘langan (siyosat bo‘yicha)', async () => {
      const d = await data();
      return [
        ...parts('c:reg', d.regionalParts, 'expense', { unit: 'center:regional', c }),
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
          .map((i) => ({ id: `u:${key}:${g.key}:${i.id}`, label: `${i.date.slice(8, 10)}.${i.date.slice(5, 7)}.${i.date.slice(0, 4)} · ${i.counterparty ?? i.description ?? ''}`, sub: [i.documentNo, i.fileName].filter(Boolean).join(' · ') || undefined, [key]: n(i.amountTiyin) })),
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
/** Oylar ustunlari: davr 2–12 oy bo'lsa (ko'p bo'lsa — jadval juda kengayadi) */
const MAX_MONTH_COLS = 12;

const pad2 = (x: number) => String(x).padStart(2, '0');

/** Davr ichidagi oylar: «2026-01» … (har biri davr chegarasida kesilgan oraliq bilan) */
function monthsOf(range: DateRange): { period: string; range: DateRange }[] {
  const out: { period: string; range: DateRange }[] = [];
  let y = Number(range.from.slice(0, 4));
  let m = Number(range.from.slice(5, 7));
  const endY = Number(range.to.slice(0, 4));
  const endM = Number(range.to.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    const period = `${y}-${pad2(m)}`;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const from = `${period}-01` < range.from ? range.from : `${period}-01`;
    const to = `${period}-${pad2(last)}` > range.to ? range.to : `${period}-${pad2(last)}`;
    out.push({ period, range: { from, to } });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 60) break;
  }
  return out;
}

/** Ichi oylardan iborat tugunlar (xodim oylari, «@oy») — ular uchun oylar ustuni kerak emas */
const isMonthLeafParent = (id: string) => /:e:[^:]+$/.test(id);

const HEAD = 'border-b border-l border-(--color-line) bg-[#f3f6fd] px-2 py-2 text-center text-xs font-bold text-heading first:border-l-0';
const CELL = 'border-b border-l border-(--color-line) px-2 py-1.5 text-right text-[12.5px] tabular-nums first:border-l-0';

/**
 * Kengayadigan daraxt jadvali (Umumiy jadvaldagi qator ichida).
 * Davr bir necha oy bo'lsa — har qator oylarga bo'linadi (har oy ustunida: natija yoki summa),
 * ochilgan har daraja ham oylar bo'yicha yuklanadi.
 */
export function UnitTree({ s, range, section, compare, fmt }: { s: UnitStats; range: DateRange; section: SectionFilter; compare: CompareMode; fmt: Fmt }) {
  const { open: openRecords } = useDrill();
  const [roots] = useState(() => unitTree(s, { range, section, compare }));
  const [months] = useState(() => {
    const list = monthsOf(range);
    return list.length > 1 && list.length <= MAX_MONTH_COLS ? list : [];
  });
  /** Har oy uchun alohida daraxt (shu oy oralig'i bilan) va tugunlar ro'yxati (id bo'yicha) */
  const monthIndex = useRef<Map<string, Map<string, TNode>> | null>(null);
  if (monthIndex.current === null) {
    const idx = new Map<string, Map<string, TNode>>();
    const register = (map: Map<string, TNode>, list: TNode[]) => {
      for (const nd of list) {
        map.set(nd.id, nd);
        if (nd.children) register(map, nd.children);
      }
    };
    for (const m of months) {
      const map = new Map<string, TNode>();
      register(map, unitTree(s, { range: m.range, section, compare }));
      idx.set(m.period, map);
    }
    monthIndex.current = idx;
  }
  const [monthTick, setMonthTick] = useState(0);
  const [opened, setOpened] = useState<Set<string>>(() => new Set(roots.slice(0, 1).map((r) => r.id)));
  const [loaded, setLoaded] = useState<Map<string, TNode[]>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [busyAll, setBusyAll] = useState(false);
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;

  const kidsOf = useCallback((nd: TNode) => nd.children ?? loadedRef.current.get(nd.id), []);

  /** Shu tugunning ichini har oy daraxtida ham yuklaydi (oylar ustunlari uchun) */
  const ensureMonths = useCallback(async (nd: TNode) => {
    const idx = monthIndex.current;
    if (!idx || !idx.size || isMonthLeafParent(nd.id)) return;
    await Promise.all(
      [...idx.values()].map(async (map) => {
        const twin = map.get(nd.id);
        if (!twin || twin.children || !twin.load) return;
        try {
          const kids = await twin.load();
          twin.children = kids;
          const register = (list: TNode[]) => {
            for (const k of list) {
              map.set(k.id, k);
              if (k.children) register(k.children);
            }
          };
          register(kids);
        } catch {
          // Oy yuklanmasa — o'sha oy ustuni bo'sh qoladi
        }
      }),
    );
    setMonthTick((x) => x + 1);
  }, []);

  const ensure = useCallback(
    async (nd: TNode): Promise<TNode[]> => {
      const have = nd.children ?? loadedRef.current.get(nd.id);
      if (have) {
        void ensureMonths(nd);
        return have;
      }
      if (!nd.load) return [];
      setLoading((x) => new Set(x).add(nd.id));
      try {
        const [kids] = await Promise.all([nd.load(), ensureMonths(nd)]);
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
    },
    [ensureMonths],
  );

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

  const has = (v: number | null | undefined): v is number => v !== null && v !== undefined;
  /** Oy qiymati: daromad ham, xarajat ham bo'lsa — natija; bittasi bo'lsa — o'sha summa (bo'limlar — xarajati) */
  const valueOf = (nd: TNode | undefined) => {
    if (!nd) return null;
    const inc = nd.income ?? 0;
    const exp = nd.expense ?? 0;
    if (inc !== 0 && exp !== 0) return { v: inc - exp, kind: 'result' as const, nd };
    if (inc !== 0) return { v: inc, kind: 'income' as const, nd };
    if (exp !== 0) return { v: exp, kind: 'expense' as const, nd };
    return null;
  };
  void monthTick;

  const cols = 6 + months.length;
  const rows: ReactNode[] = [];
  const walk = (list: TNode[], depth: number) => {
    for (const nd of list) {
      const kids = kidsOf(nd);
      const expandable = Boolean(nd.children?.length || nd.load);
      const isOpen = opened.has(nd.id);
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
          className={cn('[&>td]:bg-inherit', expandable && 'cursor-pointer hover:bg-brand-50', nd.group ? 'bg-[#eef2fb]' : depth % 2 ? 'bg-[#fafbfe]' : 'bg-white')}
        >
          <td className={cn(CELL, 'sticky left-0 z-[1] min-w-64 text-left shadow-[1px_0_0_var(--color-line)]')} style={{ paddingLeft: `${0.4 + depth * 1.1}rem` }}>
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
                <span className={cn('block leading-snug', nd.group ? 'text-[11px] font-bold uppercase tracking-wide text-brand-700' : 'text-heading')}>{nd.label}</span>
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
          <td className={CELL} title={has(nd.income) ? som(nd.income) : undefined}>
            {has(nd.income) ? money(nd.income, fmt) : ''}
          </td>
          <td className={CELL} title={has(nd.expense) ? som(nd.expense) : undefined}>
            {has(nd.expense) ? money(nd.expense, fmt) : ''}
          </td>
          <td className={cn(CELL, 'font-semibold', result === null ? '' : result >= 0 ? 'text-(--color-income)' : 'text-(--color-expense)')}>
            {has(nd.income) && has(nd.expense) && result !== null ? money(result, fmt) : ''}
          </td>
          {months.map((m) => {
            const x = nd.group ? null : valueOf(monthIndex.current?.get(m.period)?.get(nd.id));
            return (
              <td
                key={m.period}
                className={cn(CELL, 'whitespace-nowrap', x?.kind === 'result' && (x.v >= 0 ? 'text-(--color-income)' : 'text-(--color-expense)'))}
                title={x ? `${formatPeriod(m.period)}: ${[has(x.nd.income) ? `daromad ${som(x.nd.income)}` : '', has(x.nd.expense) ? `xarajat ${som(x.nd.expense)}` : ''].filter(Boolean).join(' · ')}` : undefined}
              >
                {x ? money(x.v, fmt) : ''}
              </td>
            );
          })}
          <td className={cn(CELL, 'whitespace-nowrap text-xs')}>
            {delta !== null && (
              <span className={cn('font-semibold', delta === 0 ? 'text-(--color-text-faint)' : delta > 0 === upGood ? 'text-(--color-income)' : 'text-(--color-expense)')} title={prev !== null ? `O'tgan davr: ${som(prev)}` : undefined}>
                {delta > 0 ? '+' : ''}
                {pct(delta)}
              </span>
            )}
          </td>
          <td className={CELL}>{nd.headcount ? nd.headcount : ''}</td>
        </tr>,
      );
      if (!isOpen) continue;
      const err = errors.get(nd.id);
      if (err)
        rows.push(
          <tr key={`${nd.id}!`}>
            <td colSpan={cols} className="border-b border-(--color-line) py-1.5 text-xs text-(--color-expense)" style={{ paddingLeft: `${1.4 + (depth + 1) * 1.1}rem` }}>
              {err}
            </td>
          </tr>,
        );
      else if (kids) {
        if (!kids.length)
          rows.push(
            <tr key={`${nd.id}~`}>
              <td colSpan={cols} className="border-b border-(--color-line) py-1.5 text-xs text-(--color-text-faint)" style={{ paddingLeft: `${1.4 + (depth + 1) * 1.1}rem` }}>
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
    <div className="overflow-hidden rounded-xl border border-(--color-line) bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-(--color-line) px-3 py-2">
        <p className="text-sm font-bold text-heading">«{s.unit.name}» — to&apos;liq tarkib</p>
        <span className="text-[11px] text-(--color-text-faint)">
          {months.length ? 'oylar: daromad va xarajat bo‘lsa — natija, aks holda — summa' : 'qatorni bosing — ochiladi; «yozuvlar» — o‘sha summa yozuvlari'}
        </span>
        <span className="ml-auto">
          <ToggleAllButton open={opened.size > 0} busy={busyAll} onClick={() => (opened.size ? setOpened(new Set()) : void expandAll())} />
        </span>
      </div>
      <div className="max-h-[38rem] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-[13px]" style={{ minWidth: 640 + months.length * 110 }}>
          <thead className="sticky top-0 z-[2]">
            <tr>
              <th rowSpan={2} className={cn(HEAD, 'sticky left-0 z-[3] text-left')}>
                Nomi
              </th>
              <th colSpan={3} className={cn(HEAD, 'uppercase tracking-wider')}>
                Jami davr
              </th>
              {months.length > 0 && (
                <th colSpan={months.length} className={cn(HEAD, 'uppercase tracking-wider')}>
                  Oylar bo&apos;yicha
                </th>
              )}
              <th rowSpan={2} className={HEAD} title="O'tgan davrga nisbatan o'zgarish (natija yoki summa)">
                O&apos;zgarish
              </th>
              <th rowSpan={2} className={HEAD}>
                Xodim
              </th>
            </tr>
            <tr>
              <th className={cn(HEAD, 'first:border-l')}>Daromad</th>
              <th className={HEAD}>Xarajat</th>
              <th className={HEAD}>Natija</th>
              {months.map((m) => (
                <th key={m.period} className={cn(HEAD, 'whitespace-nowrap')}>
                  {formatPeriodShort(m.period)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
    </div>
  );
}
