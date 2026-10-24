'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconChevronRight, IconSearch } from '@/components/ui/icons';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { referencesApi } from '@/features/shared/references';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import type { EntryUnit } from '@/lib/segments';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import type { CategoryTree } from '@/lib/types';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { unitCategoriesApi, useUnitCategories, type EntryKind } from './api';

// ═══════════════════════════════════════════════════════════
// Bo'lim moddalari: shu bo'limda (Markaz, Hududlar, Tax free …) qaysi xarajat moddalari / daromad turlari ishlatiladi.
//  • «Umumiy» — hamma moddalar ochiq (keyin qo'shilganlari ham). Boshida hamma bo'lim shunday.
//  • «Faqat belgilanganlar» — kiritishda faqat shu moddalar chiqadi; ota modda to'liq belgilansa,
//    keyin uning ichiga qo'shilgan moddalar ham avtomatik kiradi.
// ═══════════════════════════════════════════════════════════

interface Node {
  code: string;
  label: string;
  children: Node[];
}

function toNodes(tree: CategoryTree[]): Node[] {
  return tree.filter((c) => c.isActive).map((c) => ({ code: c.code, label: c.label, children: toNodes(c.children ?? []) }));
}

/** Tugunning barcha barglari (o'zi barg bo'lsa — o'zi) */
function leavesOf(n: Node): string[] {
  return n.children.length ? n.children.flatMap(leavesOf) : [n.code];
}

export function UnitCategories({ kind, unit }: { kind: EntryKind; unit: EntryUnit }) {
  const { isAdmin } = useAuth();
  const lists = useUnitCategories(kind);
  const tree = useAsync(() => (kind === 'expense' ? referencesApi.expenseTree() : referencesApi.incomeCategories()), [kind]);

  /** Moddalar daraxti (daromadda — tekis ro'yxat) */
  const nodes: Node[] = useMemo(() => {
    const raw = tree.data?.data as unknown;
    if (!Array.isArray(raw)) return [];
    if (kind === 'expense') return toNodes(raw as CategoryTree[]);
    return (raw as { code: string; label: string; isActive: boolean }[]).filter((c) => c.isActive).map((c) => ({ code: c.code, label: c.label, children: [] }));
  }, [tree.data, kind]);

  const allLeaves = useMemo(() => nodes.flatMap(leavesOf), [nodes]);
  const saved = lists.loading ? undefined : (lists.lists.get(unit.code) ?? null);

  // Saqlangan ro'yxat → belgilangan barglar (ota modda saqlangan bo'lsa — uning hamma barglari)
  const savedLeaves = useMemo(() => {
    if (saved === undefined) return null;
    if (saved === null) return new Set(allLeaves);
    const set = new Set(saved);
    const out = new Set<string>();
    const walk = (n: Node, inherited: boolean) => {
      const on = inherited || set.has(n.code);
      if (!n.children.length) {
        if (on) out.add(n.code);
        return;
      }
      for (const c of n.children) walk(c, on);
    };
    for (const n of nodes) walk(n, false);
    return out;
  }, [saved, nodes, allLeaves]);

  const [mode, setMode] = useState<'all' | 'list'>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'error' } | null>(null);

  // Saqlangan holat o'zgarganda (yuklanganda yoki saqlangandan keyin) — tanlov shunga qaytadi.
  // Kalit — qiymatlarning o'zi (obyekt havolasi har yangilanishda o'zgarishi mumkin)
  const savedKey = savedLeaves ? `${saved === null ? '*' : (saved ?? []).join(',')}|${allLeaves.join(',')}` : '';
  useEffect(() => {
    if (!savedLeaves) return;
    setMode(saved === null ? 'all' : 'list');
    setPicked(new Set(savedLeaves));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  if (lists.error || tree.error) return <ErrorState message={lists.error ?? tree.error ?? 'Xato'} onRetry={() => { lists.reload(); tree.reload(); }} />;
  if (!savedLeaves) return <Card><LoadingState label="Yuklanmoqda" /></Card>;

  const noun = kind === 'expense' ? 'modda' : 'xizmat turi';
  const stateOf = (n: Node): 'on' | 'off' | 'some' => {
    const l = leavesOf(n);
    const c = l.filter((x) => picked.has(x)).length;
    return c === l.length ? 'on' : c === 0 ? 'off' : 'some';
  };
  const toggle = (n: Node) => {
    const next = new Set(picked);
    const on = stateOf(n) !== 'on';
    for (const l of leavesOf(n)) {
      if (on) next.add(l);
      else next.delete(l);
    }
    setPicked(next);
    setMode('list');
  };

  /** Saqlash: to'liq belgilangan ota modda — o'zi (keyin qo'shiladigan ichki moddalar ham kirsin), aks holda ichkilari */
  const compress = (): string[] => {
    const out: string[] = [];
    const walk = (n: Node) => {
      const st = stateOf(n);
      if (st === 'on') out.push(n.code);
      else if (st === 'some') n.children.forEach(walk);
    };
    nodes.forEach(walk);
    return out;
  };

  const dirty = mode !== (saved === null ? 'all' : 'list') || (mode === 'list' && (picked.size !== savedLeaves.size || [...picked].some((c) => !savedLeaves.has(c))));

  const save = async () => {
    setSaving(true);
    try {
      await unitCategoriesApi.set(kind, unit.code, mode === 'all' ? null : compress());
      setToast({ message: mode === 'all' ? `«${unit.label}» — umumiy: hamma ${noun}lar ochiq` : `«${unit.label}» — ${picked.size} ta ${noun} saqlandi` });
      lists.reload();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const term = q.trim().toLowerCase();
  const matches = (n: Node): boolean => !term || n.label.toLowerCase().includes(term) || n.code.toLowerCase().includes(term) || n.children.some(matches);

  const rows: ReactNode[] = [];
  const walk = (list: Node[], depth: number) => {
    for (const n of list) {
      if (!matches(n)) continue;
      const kids = n.children.length > 0;
      const open = Boolean(term) || !closed.has(n.code);
      const st = mode === 'all' ? 'on' : stateOf(n);
      rows.push(
        <li key={n.code} className="flex items-center gap-2 border-t border-(--color-line) py-1.5 pr-3" style={{ paddingLeft: 12 + depth * 22 }}>
          {kids ? (
            <button
              type="button"
              aria-expanded={open}
              aria-label={open ? 'Yopish' : 'Ochish'}
              onClick={() =>
                setClosed((s) => {
                  const x = new Set(s);
                  if (x.has(n.code)) x.delete(n.code);
                  else x.add(n.code);
                  return x;
                })
              }
              className="flex size-6 shrink-0 items-center justify-center rounded text-(--color-text-muted) hover:bg-brand-50"
            >
              <IconChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
            </button>
          ) : (
            <span className="size-6 shrink-0" />
          )}
          <input
            type="checkbox"
            className="size-4 accent-brand-600"
            checked={st === 'on'}
            ref={(el) => {
              if (el) el.indeterminate = st === 'some';
            }}
            disabled={!isAdmin}
            onChange={() => toggle(n)}
            aria-label={`${n.label} — ${unit.label} bo'limiga`}
          />
          <span className={cn('min-w-0 truncate text-sm', kids ? 'font-semibold text-heading' : 'text-heading', st === 'off' && 'text-(--color-text-muted)')}>{n.label}</span>
          {kids && <span className="shrink-0 text-[11px] text-(--color-text-faint)">{leavesOf(n).length}</span>}
        </li>,
      );
      if (kids && open) walk(n.children, depth + 1);
    }
  };
  walk(nodes, 0);

  return (
    <Card className="overflow-hidden">
      <div className="space-y-3 border-b border-(--color-line) px-5 py-4">
        <div>
          <p className="text-base font-bold text-heading">
            «{unit.label}» bo&apos;limi {kind === 'expense' ? 'xarajat moddalari' : 'daromad turlari'}
          </p>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            Shu bo&apos;limga {kind === 'expense' ? 'xarajat' : 'daromad'} kiritilganda faqat belgilangan {noun}lar chiqadi. «Umumiy» — hamma {noun}lar (keyin qo&apos;shilganlari ham). Ota modda to&apos;liq belgilansa, unga keyin qo&apos;shiladigan ichki moddalar ham o&apos;zi kiradi.
          </p>
        </div>
        <div role="radiogroup" aria-label="Ro'yxat turi" className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ['all', `Umumiy — hamma ${noun}lar`, `${allLeaves.length} ta, yangilari ham avtomatik`],
              ['list', 'Faqat belgilanganlar', `${picked.size} ta belgilangan`],
            ] as const
          ).map(([k, title, text]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={mode === k}
              disabled={!isAdmin}
              onClick={() => {
                setMode(k);
                if (k === 'list' && picked.size === 0) setPicked(new Set(allLeaves));
              }}
              className={cn('rounded-(--radius-control) border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed', mode === k ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-(--color-line-strong) bg-white hover:bg-(--color-surface-muted)')}
            >
              <span className="block text-sm font-semibold text-heading">{title}</span>
              <span className="block text-xs text-(--color-text-muted)">{text}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <IconSearch className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-(--color-text-faint)" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${noun[0]!.toUpperCase()}${noun.slice(1)} qidirish`} className="h-8 w-56 rounded-(--radius-control) border border-(--color-line) pr-2 pl-7 text-sm" />
          </label>
          {isAdmin && (
            <>
              <Button variant="ghost" size="sm" onClick={() => { setPicked(new Set(allLeaves)); setMode('list'); }}>
                Hammasini belgilash
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setPicked(new Set()); setMode('list'); }}>
                Hammasini olib tashlash
              </Button>
            </>
          )}
          {kind === 'expense' && (
            <button type="button" onClick={() => setClosed(closed.size ? new Set() : new Set(nodes.flatMap(function all(n): string[] { return n.children.length ? [n.code, ...n.children.flatMap(all)] : []; })))} className="ml-auto h-8 rounded-(--radius-control) border border-(--color-line) px-2.5 text-xs font-medium text-heading hover:bg-brand-50">
              {closed.size ? 'Hammasini ochish' : 'Hammasini yopish'}
            </button>
          )}
        </div>
      </div>

      <ul className={cn('max-h-[560px] overflow-auto', mode === 'all' && 'opacity-60')}>{rows.length ? rows : <li className="px-5 py-8 text-center text-sm text-(--color-text-muted)">Topilmadi</li>}</ul>

      {isAdmin && (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-(--color-line) bg-(--color-surface-muted) px-5 py-3">
          <span className="text-xs text-(--color-text-muted)">
            {dirty ? <b className="text-amber-800">O&apos;zgarish saqlanmagan</b> : saved === null ? `Hozir: umumiy (hamma ${noun}lar)` : `Hozir: ${savedLeaves.size} ta ${noun}`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={!dirty || saving}
            onClick={() => {
              setMode(saved === null ? 'all' : 'list');
              setPicked(new Set(savedLeaves));
            }}
          >
            Bekor qilish
          </Button>
          <Button loading={saving} disabled={!dirty || (mode === 'list' && picked.size === 0)} onClick={() => void save()} title={mode === 'list' && picked.size === 0 ? `Kamida bitta ${noun} belgilang` : undefined}>
            Saqlash
          </Button>
        </div>
      )}
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </Card>
  );
}