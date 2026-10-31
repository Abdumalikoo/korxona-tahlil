'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { IconDownload, IconSearch } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { errorMessage } from '@/lib/error-message';
import { formatCompact, formatPeriodShort, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useState } from 'react';
import { PATTERN_LABEL, PIVOT_LEVEL_LABEL, type BankDir, type BankPattern, type PivotLevel, type PivotNode, type PivotParams } from './api';
import { useSource } from './source';
import { ToggleAllButton } from '@/components/report/report';
import { ExpandBox, NestedRow, nestHead } from '@/components/report/nested';

// ═══════════════════════════════════════════════════════════
// Hisobot (bank va faktura uchun bir xil): modda › kontragent (nomi, INN) › xizmat (izohi bilan),
// ustunlarda — Umumiy, oylar, Umumiy. Filtrlar: yo'nalish, tur, modda, takrorlanish, qidiruv (nom, INN, izoh),
// eng kam summa; darajalar tartibi. Qatorlarni moddaga birdan biriktirish; Excel (shu ko'rinishda).
// ═══════════════════════════════════════════════════════════

type Toast = (t: { message: string; tone: 'success' | 'error' } | null) => void;
const PRESETS: { label: string; levels: PivotLevel[] }[] = [
  { label: 'Modda › kontragent › xizmat', levels: ['category', 'counterparty', 'service'] },
  { label: 'Kontragent › xizmat', levels: ['counterparty', 'service'] },
  { label: 'Tur › kontragent', levels: ['kind', 'counterparty'] },
  { label: 'Modda › xizmat', levels: ['category', 'service'] },
  { label: 'Faqat kontragentlar', levels: ['counterparty'] },
];
const INPUT = 'h-8 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-sm focus:border-brand-600 focus:outline-none';

export function PivotReport({ from, to, account, defaultDir, isAdmin, onToast, onOpenGroup, reloadKey }: { from: string; to: string; account: string | null; defaultDir: BankDir; isAdmin: boolean; onToast: Toast; onOpenGroup: (key: string) => void; reloadKey: number }) {
  const { api, dirLabel } = useSource();
  const [dir, setDir] = useState<BankDir>(defaultDir);
  const [levels, setLevels] = useState<PivotLevel[]>(PRESETS[0]!.levels);
  const [kinds, setKinds] = useState<string[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [patterns, setPatterns] = useState<BankPattern[]>([]);
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [min, setMin] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [allOpen, setAllOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [localKey, setLocalKey] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setQd(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const params: PivotParams = { from, to, account, dir, levels, kinds, categories: cats, patterns, q: qd, min: min.replace(/\s/g, '') };
  const data = useAsync(() => api.pivot(params).then((r) => r.data), [api, from, to, account, dir, levels.join(','), kinds.join(','), cats.join(','), patterns.join(','), qd, min, reloadKey, localKey]);
  const known = useAsync(() => api.categories().then((r) => r.data), [api, reloadKey, localKey]);
  const p = data.data;
  const pickedKeys = useMemo(() => {
    const out = new Set<string>();
    const walk = (n: PivotNode) => {
      if (picked.has(n.id)) n.keys.forEach((k) => out.add(k));
      else n.children.forEach(walk);
    };
    p?.rows.forEach(walk);
    return [...out];
  }, [p, picked]);

  const toggleOpen = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const isOpen = (id: string) => allOpen !== open.has(id);
  const togglePick = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function assign(clear = false) {
    if (!pickedKeys.length) return;
    setBusy('cat');
    try {
      const r = (await api.groupCategory(pickedKeys, clear ? '' : category.trim())).data;
      onToast({ message: clear ? `${r.count} ta guruhdan modda olib tashlandi` : `${r.count} ta guruh «${r.category}» moddasiga biriktirildi — keyingi oylarda ham`, tone: 'success' });
      setPicked(new Set());
      setLocalKey((k) => k + 1);
    } catch (err) {
      onToast({ message: errorMessage(err, 'Saqlab bo‘lmadi'), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function excel() {
    setBusy('xl');
    try {
      await api.pivotExcel(params);
    } catch (err) {
      onToast({ message: errorMessage(err, "Excel'ni yuklab bo‘lmadi"), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  const toggleIn = <T extends string>(list: T[], v: T, set: (x: T[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const filtered = kinds.length + cats.length + patterns.length + (qd ? 1 : 0) + (min ? 1 : 0);

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Hisobot"
        description="Modda › kontragent (nomi, INN) › xizmat — oylar kesimida. Xizmat qatorini bossangiz — to'lovlari ochiladi (nom, izoh, yo'naltirish)"
        actions={
          <Button size="sm" variant="secondary" loading={busy === 'xl'} disabled={!p?.rows.length} onClick={() => void excel()}>
            <IconDownload className="size-4" />
            Excel
          </Button>
        }
      />
      {/* Filtrlar */}
      <div className="space-y-2 border-b border-(--color-line) px-5 py-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex rounded-(--radius-control) border border-(--color-line) bg-white p-0.5">
            {(['OUT', 'IN'] as const).map((d) => (
              <button key={d} type="button" onClick={() => { setDir(d); setKinds([]); setCats([]); setPicked(new Set()); }} className={cn('rounded px-2.5 py-1 font-medium', dir === d ? (d === 'OUT' ? 'bg-(--color-expense) text-white' : 'bg-(--color-income) text-white') : 'text-(--color-text-muted) hover:text-heading')}>
                {dirLabel[d]}
              </button>
            ))}
          </span>
          <select value={levels.join(',')} onChange={(e) => { setLevels(e.target.value.split(',') as PivotLevel[]); setOpen(new Set()); setPicked(new Set()); }} className={INPUT} aria-label="Darajalar">
            {PRESETS.map((x) => (
              <option key={x.label} value={x.levels.join(',')}>
                {x.label}
              </option>
            ))}
          </select>
          <label className="relative">
            <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-(--color-text-faint)" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nomi, INN, izoh, modda" className={cn(INPUT, 'w-56 pl-8')} />
          </label>
          <input value={min} onChange={(e) => setMin(e.target.value.replace(/[^\d\s]/g, ''))} placeholder="Eng kam summa, so'm" className={cn(INPUT, 'w-40')} inputMode="numeric" aria-label="Eng kam summa" />
          <span className="ml-auto flex items-center gap-2">
            <ToggleAllButton open={allOpen} onClick={() => { setAllOpen((x) => !x); setOpen(new Set()); }} />
            {filtered > 0 && (
              <button type="button" className="font-medium text-(--color-text-muted) hover:text-heading" onClick={() => { setKinds([]); setCats([]); setPatterns([]); setQ(''); setMin(''); }}>
                Filtrlarni tozalash ({filtered})
              </button>
            )}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-(--color-text-faint)">Takrorlanishi:</span>
          {(['REGULAR', 'IRREGULAR', 'ONCE'] as const).map((x) => (
            <Chip key={x} active={patterns.includes(x)} onClick={() => toggleIn(patterns, x, setPatterns)}>
              {PATTERN_LABEL[x]}
            </Chip>
          ))}
          {(p?.facets.kinds.length ?? 0) > 0 && <span className="ml-2 text-(--color-text-faint)">Tur:</span>}
          {p?.facets.kinds.map((k) => (
            <Chip key={k.code} active={kinds.includes(k.code)} onClick={() => toggleIn(kinds, k.code, setKinds)}>
              {k.label}
            </Chip>
          ))}
        </div>
        {(p?.facets.categories.length ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-(--color-text-faint)">Modda:</span>
            {p!.facets.categories.map((c) => (
              <Chip key={c} active={cats.includes(c)} onClick={() => toggleIn(cats, c, setCats)}>
                {c}
              </Chip>
            ))}
          </div>
        )}
        {isAdmin && (
          <div className={cn('flex flex-wrap items-center gap-2 rounded-(--radius-control) px-2 py-1.5', pickedKeys.length ? 'bg-brand-50' : '')}>
            <span className="text-(--color-text-muted)">{pickedKeys.length ? `Tanlangan: ${pickedKeys.length} ta guruh →` : 'Qatorlarni belgilab, o‘z moddangizga biriktiring:'}</span>
            <input list="pivot-categories" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={120} placeholder="Modda (masalan: Moshina uchun xarajatlar)" className={cn(INPUT, 'w-72')} />
            <datalist id="pivot-categories">
              {(known.data ?? []).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <Button size="sm" loading={busy === 'cat'} disabled={!pickedKeys.length || !category.trim()} onClick={() => void assign()}>
              Biriktirish
            </Button>
            {pickedKeys.length > 0 && (
              <Button size="sm" variant="ghost" disabled={busy === 'cat'} onClick={() => void assign(true)}>
                Moddadan olib tashlash
              </Button>
            )}
          </div>
        )}
      </div>

      {data.loading && !p ? (
        <LoadingState />
      ) : data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : !p?.rows.length ? (
        <EmptyState title="Bu tanlovda ma'lumot yo'q" description="Filtrlarni o'zgartiring yoki davrni kengaytiring" />
      ) : (
        <div className="max-h-[760px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-[2] bg-(--color-surface-muted) text-[10px] uppercase tracking-wide text-(--color-text-muted)">
              <tr>
                <th className="w-12 px-2 py-2 text-center font-semibold">T/p</th>
                <th className="sticky left-0 z-[3] min-w-96 bg-(--color-surface-muted) px-2 py-2 text-left font-semibold">{levels.map((l) => PIVOT_LEVEL_LABEL[l]).join(' › ')}</th>
                <th className="px-3 py-2 text-right font-semibold text-(--color-expense)">Umumiy</th>
                {p.months.map((m) => (
                  <th key={m} className="px-2 py-2 text-right font-semibold whitespace-nowrap">
                    {formatPeriodShort(m)}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-semibold text-(--color-expense)">Umumiy</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((n, i) => (
                <Node key={n.id} n={n} depth={0} no={String(i + 1)} months={p.months} levels={levels} isOpen={isOpen} onToggle={toggleOpen} picked={picked} onPick={isAdmin ? togglePick : null} onOpenGroup={onOpenGroup} />
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 z-[2] bg-(--color-surface-muted) text-xs font-semibold">
              <tr>
                <td />
                <td className="sticky left-0 z-[3] bg-(--color-surface-muted) px-2 py-2">
                  JAMI <span className="font-normal text-(--color-text-muted)">· {p.total.groups} guruh · {p.total.count} ta</span>
                </td>
                <td className="money px-3 py-2 text-right whitespace-nowrap text-(--color-expense)">{formatTiyin(p.total.totalTiyin)}</td>
                {p.months.map((m) => (
                  <td key={m} className="money px-2 py-2 text-right whitespace-nowrap">
                    {p.total.byMonth[m] && p.total.byMonth[m] !== '0' ? formatCompact(p.total.byMonth[m]!) : '—'}
                  </td>
                ))}
                <td className="money px-3 py-2 text-right whitespace-nowrap text-(--color-expense)">{formatTiyin(p.total.totalTiyin)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

// Qator bolalari — qator tagidagi alohida panelda: o'z sarlavhasi (keyingi daraja nomi) va o'z raqamlashi (1, 2, 3 …)
function SubTable({ list, depth, months, levels, isOpen, onToggle, picked, onPick, onOpenGroup }: { list: PivotNode[]; depth: number; months: string[]; levels: PivotLevel[]; isOpen: (id: string) => boolean; onToggle: (id: string) => void; picked: Set<string>; onPick: ((id: string) => void) | null; onOpenGroup: (key: string) => void }) {
  const head = nestHead(depth);
  const level = levels[depth];
  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          <th className={cn(head, 'w-12 text-center')}>T/p</th>
          <th className={cn(head, 'min-w-80 text-left')}>{level ? PIVOT_LEVEL_LABEL[level] : 'Nomi'}</th>
          <th className={cn(head, 'text-right text-(--color-expense)')}>Umumiy</th>
          {months.map((m) => (
            <th key={m} className={cn(head, 'text-right')}>
              {formatPeriodShort(m)}
            </th>
          ))}
          <th className={cn(head, 'text-right text-(--color-expense)')}>Umumiy</th>
        </tr>
      </thead>
      <tbody>
        {list.map((c, i) => (
          <Node key={c.id} n={c} depth={depth} no={String(i + 1)} months={months} levels={levels} isOpen={isOpen} onToggle={onToggle} picked={picked} onPick={onPick} onOpenGroup={onOpenGroup} />
        ))}
      </tbody>
    </table>
  );
}

function Node({ n, depth, no, months, levels, isOpen, onToggle, picked, onPick, onOpenGroup }: { n: PivotNode; depth: number; no: string; months: string[]; levels: PivotLevel[]; isOpen: (id: string) => boolean; onToggle: (id: string) => void; picked: Set<string>; onPick: ((id: string) => void) | null; onOpenGroup: (key: string) => void }) {
  const has = n.children.length > 0;
  const opened = has && isOpen(n.id);
  const leafOpen = !has && n.groupKey;
  return (
    <>
      <tr className={cn('border-t border-(--color-line) align-top', depth === 0 ? 'bg-white font-semibold' : 'bg-white', picked.has(n.id) && 'bg-brand-50/60', (has || leafOpen) && 'cursor-pointer hover:bg-(--color-surface-muted)')} onClick={() => (has ? onToggle(n.id) : leafOpen ? onOpenGroup(n.groupKey!) : undefined)}>
        <td className="px-2 py-1.5 text-center text-xs text-(--color-text-muted)">{no}</td>
        <td className={cn('max-w-[34rem] bg-inherit px-2 py-1.5', depth === 0 && 'sticky left-0 z-[1]')}>
          <span className="flex items-start gap-1.5">
            {onPick && (
              <input type="checkbox" className="mt-1 size-3.5 shrink-0 accent-brand-600" checked={picked.has(n.id)} onClick={(e) => e.stopPropagation()} onChange={() => onPick(n.id)} aria-label="Tanlash" />
            )}
            <ExpandBox open={opened} hidden={!has} onClick={() => onToggle(n.id)} />
            <span className="min-w-0">
              <span className={cn('block truncate', depth === 0 ? 'text-heading' : depth === 1 ? 'font-medium text-heading' : 'text-(--color-text)', leafOpen && 'underline decoration-(--color-line-strong) decoration-dotted underline-offset-2')} title={n.label}>
                {n.label}
              </span>
              {(n.inn || n.comment || depth > 0) && (
                <span className="flex flex-wrap items-center gap-x-2 text-[11px] font-normal text-(--color-text-muted)">
                  {n.inn && <span className="money">INN {n.inn}</span>}
                  {n.comment && (
                    <span className="max-w-[28rem] truncate" title={n.comment}>
                      {n.comment}
                    </span>
                  )}
                  {has && depth > 0 && <span className="text-(--color-text-faint)">{n.children.length} ta</span>}
                  {!has && n.groups > 1 && <Badge tone="neutral" className="px-1.5 py-0 text-[10px]">{n.groups} guruh</Badge>}
                </span>
              )}
            </span>
          </span>
        </td>
        <td className={cn('money px-3 py-1.5 text-right whitespace-nowrap text-(--color-expense)', depth > 0 && 'italic')}>{formatTiyin(n.totalTiyin)}</td>
        {months.map((m) => (
          <td key={m} className="money px-2 py-1.5 text-right text-xs whitespace-nowrap">
            {n.byMonth[m] && n.byMonth[m] !== '0' ? formatCompact(n.byMonth[m]!) : <span className="text-(--color-text-faint)">—</span>}
          </td>
        ))}
        <td className={cn('money px-3 py-1.5 text-right whitespace-nowrap text-(--color-expense)', depth > 0 && 'italic')}>{formatTiyin(n.totalTiyin)}</td>
      </tr>
      {opened && (
        <NestedRow colSpan={months.length + 4} level={depth + 1}>
          <SubTable list={n.children} depth={depth + 1} months={months} levels={levels} isOpen={isOpen} onToggle={onToggle} picked={picked} onPick={onPick} onOpenGroup={onOpenGroup} />
        </NestedRow>
      )}
    </>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn('rounded-full border px-2.5 py-0.5 text-xs font-medium', active ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-(--color-line) bg-white text-(--color-text-muted) hover:text-heading')}>
      {children}
    </button>
  );
}
