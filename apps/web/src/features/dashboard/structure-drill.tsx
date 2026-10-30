'use client';

import { DiffCell, changeOf, MoneyCell, NameCell, PctCell, RTable, STICKY_NAME, STICKY_NO, Td, Th, Tr } from '@/components/report/report';
import { IconSpinner } from '@/components/ui/icons';
import type { DateRange } from '@/components/shared/date-range-picker';
import { DrillProvider, useDrill } from '@/features/explore/drill';
import { partOpens, statsOf, type RegionUnit } from '@/features/regions/api';
import { partNodes, unitTree, type Ctx, type TNode } from '@/features/regions/overall-tree';
import { SEGMENTS } from '@/lib/segments';
import { cn } from '@/lib/utils';
import { useState, type ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════
// Bosh sahifa: daromad / xarajat tarkibi — shu sahifaning o'zida ichma-ich, OXIRIGACHA (yozuvlargacha):
//   Markaz → bo'limlar → tarkib / xodimlar → oylar; manbalar, o'z xarajati, hududlar uchun to'langan → modda → kontragent → yozuvlar
//   Hudud → viloyatlar → tumanlar → xizmatlar / xarajat tarkibi / xodimlar → oylar; viloyat tarkibi → modda → … → yozuvlar
//          yoki «xizmat turlari (moddalar) bo'yicha» → viloyatlar → yozuvlar
//   Yo'nalishlar (Tax free, Marksheyder, Fermer, Buxgalteriya) → tuzilmalar / xizmat turlari → … → oylar → yozuvlar
// Daraxt — Solishtirma › Umumiy bilan bir xil (overall-tree), faqat tanlangan tomon (daromad yoki xarajat) ko'rsatiladi.
// ═══════════════════════════════════════════════════════════

type Kind = 'income' | 'expense';
type Amount = { cur: number; prev: number };

const amountOf = (u: RegionUnit, kind: Kind): Amount =>
  kind === 'income' ? { cur: Number(u.incomeTiyin), prev: Number(u.previousIncomeTiyin) } : { cur: Number(u.expenseTiyin), prev: Number(u.previousExpenseTiyin) };
const add = (a: Amount, b: Amount): Amount => ({ cur: a.cur + b.cur, prev: a.prev + b.prev });
const ZERO: Amount = { cur: 0, prev: 0 };

/** Daraxt guruhlari tomoni (overall-tree id'lari bo'yicha): daromad — «:i», «:inc», «:s» (xizmatlar); xarajat — «:x», «:exp», «:e», «:own», «:reg», «:out» */
const INCOME_GROUP = /(:i|:inc|:s)$|^u:income$/;
const EXPENSE_GROUP = /(:x|:exp|:e|:own|:reg|:out)$|^u:expense$/;

/** Faqat tanlangan tomon: boshqa tomon guruhlari va shu tomonda summasi yo'q qatorlar tushiriladi (ichkarisi ham — yuklanganda) */
function onSide(list: TNode[], side: Kind): TNode[] {
  const out: TNode[] = [];
  for (const nd of list) {
    if (nd.group) {
      if (side === 'income' ? EXPENSE_GROUP.test(nd.id) : INCOME_GROUP.test(nd.id)) continue;
    } else {
      const v = nd[side] ?? 0;
      const pv = (side === 'income' ? nd.prevIncome : nd.prevExpense) ?? 0;
      if (!v && !pv) continue;
    }
    const load = nd.load;
    out.push({ ...nd, children: nd.children ? onSide(nd.children, side) : undefined, load: load ? async () => onSide(await load(), side) : undefined });
  }
  return out;
}

/** Ma'lumot qatori (jamiga qo'shilmaydi): masalan, xarajatda «Qo'mita pullarining sarfi» — ish haqi sifatida allaqachon xarajatda */
export interface DrillInfoRow {
  label: string;
  sub: string;
  cur: number;
  prev: number | null;
  onClick: () => void;
}

export function StructureDrill(props: { units: RegionUnit[]; kind: Kind; cmpOn: boolean; info?: DrillInfoRow | null; range: DateRange }) {
  return (
    <DrillProvider range={{ from: props.range.from, to: props.range.to }}>
      <Tree {...props} />
    </DrillProvider>
  );
}

function Tree({ units, kind, cmpOn, info, range }: { units: RegionUnit[]; kind: Kind; cmpOn: boolean; info?: DrillInfoRow | null; range: DateRange }) {
  const { open: openRecords } = useDrill();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState<Map<string, TNode[]>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [regionMode, setRegionMode] = useState<'regions' | 'parts'>('regions');
  const c: Ctx = { range, section: 'ALL', compare: 'prev' };
  const prevKey = kind === 'income' ? 'prevIncome' : 'prevExpense';
  const word = kind === 'income' ? 'xizmat' : 'modda';

  const center = units.find((u) => u.kind === 'center') ?? null;
  const regions = units.filter((u) => u.kind === 'region').sort((a, b) => amountOf(b, kind).cur - amountOf(a, kind).cur);
  const order = SEGMENTS.map((s) => s.code as string);
  const segments = units.filter((u) => u.kind === 'segment').sort((a, b) => order.indexOf(a.segment ?? '') - order.indexOf(b.segment ?? ''));
  const unassigned = units.find((u) => u.kind === 'unassigned') ?? null;
  const total = units.reduce((a, u) => add(a, amountOf(u, kind)), ZERO);
  const regionTotal = regions.reduce((a, u) => add(a, amountOf(u, kind)), ZERO);

  const unitNode = (u: RegionUnit, id: string, label: string, sub: string): TNode => {
    const a = amountOf(u, kind);
    return { id, label, sub, [kind]: a.cur, [prevKey]: a.prev, load: async () => onSide(unitTree(statsOf(u), c), kind) };
  };

  // Hudud — xizmat turlari (moddalar) bo'yicha: viloyatlar qismlari yig'indisi → viloyatlar → (yozuvlar / modda ichi)
  const regionParts = (() => {
    const m = new Map<string, { key: string; label: string; cur: number; prev: number; byRegion: { unit: RegionUnit; cur: number; prev: number }[] }>();
    for (const r of regions)
      for (const p of kind === 'income' ? r.incomeParts : r.expenseParts) {
        const cur = Number(p.amountTiyin);
        const prev = Number(p.previousTiyin);
        if (!cur && !prev) continue;
        const x = m.get(p.key) ?? { key: p.key, label: p.label, cur: 0, prev: 0, byRegion: [] };
        x.cur += cur;
        x.prev += prev;
        x.byRegion.push({ unit: r, cur, prev });
        m.set(p.key, x);
      }
    return [...m.values()].sort((a, b) => b.cur - a.cur || b.prev - a.prev);
  })();
  const regionChildren: TNode[] =
    regionMode === 'regions'
      ? regions.map((r) => unitNode(r, `h:r:${r.key}`, r.name, kind === 'income' ? 'tumanlar · xizmatlar' : 'tumanlar · moddalar · xodimlar'))
      : regionParts.map((p) => ({
          id: `h:p:${p.key}`,
          label: p.label,
          sub: 'viloyatlar bo‘yicha',
          [kind]: p.cur,
          [prevKey]: p.prev,
          children: p.byRegion
            .sort((a, b) => b.cur - a.cur)
            .map((x) => {
              const id = `h:p:${p.key}:${x.unit.key}`;
              return {
                id,
                label: x.unit.name,
                [kind]: x.cur,
                [prevKey]: x.prev,
                ...(kind === 'income'
                  ? { records: { kind: 'income' as const, f: { unit: x.unit.key, cats: [p.key] }, title: `${x.unit.name} › ${p.label}` } }
                  : partOpens(x.unit.key, p.key)
                    ? { load: () => partNodes(id, x.unit.key, p.key, c) }
                    : {}),
              } as TNode;
            }),
        }));

  const roots: TNode[] = [];
  if (center && (amountOf(center, kind).cur || amountOf(center, kind).prev))
    roots.push(unitNode(center, 'h:center', 'Markaz', kind === 'income' ? "bo'limlar · daromad manbalari" : "bo'limlar · o'z xarajati · hududlar uchun to'langan"));
  if (regions.length)
    roots.push({ id: 'h:regions', label: `Hudud · ${regions.length} viloyat`, sub: regionMode === 'regions' ? 'viloyatlar bo‘yicha' : `${word} turlari bo‘yicha`, [kind]: regionTotal.cur, [prevKey]: regionTotal.prev, children: regionChildren });
  for (const s of segments) {
    const a = amountOf(s, kind);
    if (order.indexOf(s.segment ?? '') >= 4 && !a.cur && !a.prev) continue;
    roots.push(unitNode(s, `h:s:${s.key}`, s.name, kind === 'income' ? "yo'nalish · xizmat turlari" : "yo'nalish · tuzilmalar"));
  }
  if (unassigned && (amountOf(unassigned, kind).cur || amountOf(unassigned, kind).prev)) roots.push(unitNode(unassigned, 'h:none', unassigned.name, 'hudud belgilanmagan yozuvlar'));

  const kidsOf = (nd: TNode) => nd.children ?? loaded.get(nd.id);
  const toggle = async (nd: TNode) => {
    if (open.has(nd.id)) {
      setOpen((s) => {
        const x = new Set(s);
        x.delete(nd.id);
        return x;
      });
      return;
    }
    setOpen((s) => new Set(s).add(nd.id));
    if (kidsOf(nd) || !nd.load) return;
    setLoading((s) => new Set(s).add(nd.id));
    try {
      const kids = await nd.load();
      setLoaded((m) => new Map(m).set(nd.id, kids));
    } catch (e) {
      setErrors((m) => new Map(m).set(nd.id, e instanceof Error ? e.message : "Yuklab bo'lmadi"));
    } finally {
      setLoading((s) => {
        const x = new Set(s);
        x.delete(nd.id);
        return x;
      });
    }
  };

  const columns = 3 + (cmpOn ? 3 : 1);
  const rows: ReactNode[] = [];
  let num = 0;
  const walk = (list: TNode[], depth: number) => {
    for (const nd of list) {
      const expandable = Boolean(nd.load || nd.children?.length);
      const isOpen = open.has(nd.id);
      const cur = nd.group ? null : (nd[kind] ?? 0);
      const prev = nd.group ? null : (nd[prevKey] ?? 0);
      rows.push(
        <Tr key={nd.id} onClick={expandable ? () => void toggle(nd) : undefined} className={cn(nd.group ? 'bg-[#eef2fb]' : depth > 0 && 'bg-(--color-surface-muted)/40')}>
          <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{depth === 0 ? ++num : ''}</Td>
          <NameCell
            sub={nd.sub}
            className={cn(depth === 0 && 'font-semibold text-heading', nd.group && 'text-[11px] font-bold uppercase tracking-wide text-brand-700')}
            before={
              <span className="flex shrink-0 items-center" style={{ paddingLeft: depth * 18 }}>
                {loading.has(nd.id) ? (
                  <IconSpinner className="size-3.5 text-brand-600" />
                ) : (
                  <span className={cn('inline-block w-3.5 text-center text-(--color-text-faint)', !expandable && 'invisible')}>{isOpen ? '▾' : '▸'}</span>
                )}
              </span>
            }
          >
            <span className="flex flex-wrap items-center gap-2">
              {nd.label}
              {nd.records && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openRecords({ ...nd.records!, expected: cur ?? undefined });
                  }}
                  className="rounded px-1.5 py-0.5 text-[10.5px] font-medium normal-case tracking-normal text-brand-700 hover:bg-brand-50 hover:underline"
                  title="Shu summani tashkil qilgan yozuvlar"
                >
                  yozuvlar
                </button>
              )}
            </span>
          </NameCell>
          {cmpOn && (prev === null ? <Td /> : <MoneyCell value={prev} />)}
          {cur === null ? <Td /> : <MoneyCell value={cur} strong={depth === 0} />}
          {cmpOn && (cur === null || prev === null ? <Td /> : <DiffCell value={cur - prev} pct={changeOf(cur, prev)} growthGood={kind === 'income'} />)}
          {cur === null ? <Td /> : <PctCell value={total.cur > 0 ? (cur / total.cur) * 100 : null} plain className="font-normal text-(--color-text-muted)" />}
        </Tr>,
      );
      if (!isOpen) continue;
      // Hudud — ko'rinishni tanlash (viloyatlar yoki xizmat turlari / moddalar bo'yicha)
      if (nd.id === 'h:regions')
        rows.push(
          <tr key="regions-mode" className="bg-brand-50/50">
            <td colSpan={columns} className="border-b border-(--color-line) px-3 py-2">
              <span className="sticky left-3 inline-flex items-center gap-2 pl-8 text-xs">
                <span className="text-(--color-text-muted)">Ko&apos;rinish:</span>
                <span className="inline-flex rounded-lg border border-(--color-line-strong) bg-white p-0.5 shadow-sm" role="tablist">
                  {(
                    [
                      ['regions', 'Viloyatlar bo‘yicha'],
                      ['parts', kind === 'income' ? 'Xizmat turlari bo‘yicha' : 'Moddalar bo‘yicha'],
                    ] as const
                  ).map(([m, t]) => (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={regionMode === m}
                      onClick={() => setRegionMode(m)}
                      className={cn('rounded-md px-3 py-1 font-medium transition-colors', regionMode === m ? 'bg-brand-600 text-white' : 'text-(--color-text-muted) hover:bg-(--color-surface-muted) hover:text-heading')}
                    >
                      {t}
                    </button>
                  ))}
                </span>
              </span>
            </td>
          </tr>,
        );
      const err = errors.get(nd.id);
      const kids = kidsOf(nd);
      if (err)
        rows.push(
          <tr key={`${nd.id}:err`}>
            <td colSpan={columns} className="border-b border-(--color-line) px-3 py-2 text-xs text-(--color-expense)" style={{ paddingLeft: `${1 + (depth + 1) * 1.1}rem` }}>
              {err}
            </td>
          </tr>,
        );
      else if (kids && !kids.length && !loading.has(nd.id))
        rows.push(
          <tr key={`${nd.id}:empty`}>
            <td colSpan={columns} className="border-b border-(--color-line) px-3 py-2 text-xs text-(--color-text-faint)" style={{ paddingLeft: `${1 + (depth + 1) * 1.1}rem` }}>
              Bu davrda {kind === 'income' ? 'daromad' : 'xarajat'} yo&apos;q
            </td>
          </tr>,
        );
      if (kids) walk(kids, depth + 1);
    }
  };
  walk(roots, 0);

  // Ma'lumot qatori — jamiga kirmaydi (bosilsa — o'z sahifasi)
  if (info)
    rows.push(
      <Tr key="info" muted onClick={info.onClick} title="Ma'lumot uchun — jami xarajatga qo'shilmagan">
        <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{++num}</Td>
        <NameCell drill sub={info.sub}>
          {info.label}
        </NameCell>
        {cmpOn && (info.prev === null ? <Td /> : <MoneyCell value={info.prev} className="text-(--color-text-muted)" />)}
        <MoneyCell value={info.cur} className="text-(--color-text-muted)" />
        {cmpOn ? info.prev === null ? <Td /> : <DiffCell value={info.cur - info.prev} pct={changeOf(info.cur, info.prev)} growthGood={false} /> : null}
        <Td className="text-xs text-(--color-text-faint)">—</Td>
      </Tr>,
    );

  return (
    <RTable minWidth={cmpOn ? 860 : 660}>
      <thead>
        <tr>
          <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
          <Th className={cn(STICKY_NAME, 'z-[2] min-w-72 text-left')}>{kind === 'income' ? 'Daromad manbai' : 'Xarajat joyi'}</Th>
          {cmpOn && <Th>O&apos;tgan davr</Th>}
          <Th>Joriy davr</Th>
          {cmpOn && <Th>Farqi, foizda</Th>}
          <Th>Ulushi</Th>
        </tr>
      </thead>
      <tbody>
        <Tr total>
          <Td className={STICKY_NO} />
          <NameCell>{kind === 'income' ? 'Jami daromad' : 'Jami xarajat'}</NameCell>
          {cmpOn && <MoneyCell value={total.prev} />}
          <MoneyCell value={total.cur} />
          {cmpOn && <DiffCell value={total.cur - total.prev} pct={changeOf(total.cur, total.prev)} growthGood={kind === 'income'} />}
          <PctCell value={total.cur > 0 ? 100 : null} plain className="font-normal text-(--color-text-muted)" />
        </Tr>
        {rows}
      </tbody>
    </RTable>
  );
}
