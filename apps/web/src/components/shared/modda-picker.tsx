'use client';

import { QuickCategoryDialog } from '@/components/shared/quick-category-dialog';
import { IconChevronDown, IconClose, IconPlus, IconSearch } from '@/components/ui/icons';
import { referencesApi } from '@/features/shared/references';
import type { Category, CategoryTree } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useRef, useState } from 'react';

export interface ModdaOption {
  code: string;
  label: string;
  /** Guruh (ota-modda) nomi — ro'yxatda sarlavha, qidiruvda ham hisobga olinadi */
  group?: string | null;
  keywords?: string[];
}

type ExpenseGroups = { top: { code: string; label: string }[]; labels: Map<string, string> };
let groupsCache: Promise<ExpenseGroups> | null = null;

/** Xarajat guruhlari (moddalar daraxtidan, bir marta yuklanadi): yuqori guruhlar — yangi modda uchun, hamma ota-moddalar nomi — sarlavha uchun */
export function useExpenseGroups(): ExpenseGroups | null {
  const [groups, setGroups] = useState<ExpenseGroups | null>(null);
  useEffect(() => {
    let alive = true;
    groupsCache ??= referencesApi.expenseTree().then((r) => {
      const labels = new Map<string, string>();
      const walk = (nodes: CategoryTree[]) => {
        for (const n of nodes) {
          if (n.isLeaf) continue;
          labels.set(n.code, n.label);
          walk(n.children);
        }
      };
      walk(r.data);
      return { top: r.data.map((g) => ({ code: g.code, label: g.label })), labels };
    });
    groupsCache.then((g) => alive && setGroups(g)).catch(() => {
      groupsCache = null;
    });
    return () => {
      alive = false;
    };
  }, []);
  return groups;
}

interface ModdaPickerProps {
  options: ModdaOption[];
  value: string;
  onChange: (code: string) => void;
  label?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Bo'sh tanlov bandi (masalan, «Avtomatik») — berilsa ro'yxat boshida turadi */
  emptyLabel?: string;
  size?: 'md' | 'sm';
  className?: string;
  hint?: string;
  /** «+» — yangi modda (sukut bo'yicha bor; false — faqat tanlash) */
  creatable?: boolean;
  /** Yangi modda yaratilgach (doimiy ro'yxatga yozilgan, tanlangan) — ro'yxatni qayta yuklash va h.k. */
  onCreated?: (category: Category) => void | Promise<void>;
  /** Yangi modda uchun guruhlar; berilmasa — barcha xarajat guruhlari */
  createGroups?: { code: string; label: string }[];
  /** «+» ni o'zi boshqaradigan forma uchun (o'z dialogi bor) — yozilgan matn uzatiladi */
  onCreateNew?: (query: string) => void;
}

/**
 * Xarajat moddasi tanlagich — hamma joyda bir xil.
 *
 * Yopiq holatda — tanlangan modda nomi va «+» (yangi modda).
 * Ochiq holatda — qidiruv: yozilganda nom, kalit so'z va guruh bo'yicha avtomatik izlanadi;
 * mos modda bo'lmasa — «"…" — yangi modda» bilan shu nom bilan yaratiladi.
 * Yangi modda doimiy moddalar ro'yxatiga yoziladi (manbada qoladi) va darhol tanlanadi.
 */
export function ModdaPicker({
  options,
  value,
  onChange,
  label,
  error,
  required,
  disabled,
  placeholder = 'Xarajat moddasi',
  emptyLabel,
  size = 'md',
  className,
  hint,
  creatable = true,
  onCreated,
  createGroups,
  onCreateNew,
}: ModdaPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<string | null>(null);
  const tree = useExpenseGroups();
  // Yaratilgan, lekin ota-ro'yxat hali qayta yuklanmagan moddalar — nomi darhol ko'rinsin
  const [created, setCreated] = useState<ModdaOption[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const groups = createGroups ?? tree?.top ?? [];

  const all = useMemo(() => [...options, ...created.filter((c) => !options.some((o) => o.code === c.code))], [options, created]);
  const selected = all.find((item) => item.code === value);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      setQuery('');
    };
    const handleClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  /** Qidiruvga mos moddalar, guruhlar bo'yicha (guruhsizlari — «Boshqa») */
  const found = useMemo(() => {
    const term = query.trim().toLowerCase();
    const result = new Map<string, ModdaOption[]>();
    for (const item of all) {
      const hit = !term || item.label.toLowerCase().includes(term) || (item.group ?? '').toLowerCase().includes(term) || (item.keywords ?? []).some((w) => w.toLowerCase().includes(term));
      if (!hit) continue;
      const g = item.group || 'Boshqa';
      result.set(g, [...(result.get(g) ?? []), item]);
    }
    return [...result.entries()];
  }, [all, query]);
  const totalFound = found.reduce((sum, [, items]) => sum + items.length, 0);

  function pick(code: string) {
    onChange(code);
    setOpen(false);
    setQuery('');
  }

  function startCreate(text: string) {
    setOpen(false);
    setQuery('');
    if (onCreateNew) return onCreateNew(text);
    setDialog(text);
  }

  const h = size === 'sm' ? 'h-8' : 'h-10';

  return (
    <div className={cn('min-w-0', size === 'md' && 'w-full', className)} ref={containerRef}>
      {label && (
        <label className="mb-1.5 block text-sm font-medium text-(--color-text)">
          {label}
          {required && <span className="ml-0.5 text-(--color-expense)">*</span>}
        </label>
      )}

      <div className="relative flex gap-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((state) => !state)}
          className={cn(
            'flex min-w-0 flex-1 items-center justify-between gap-2 rounded-(--radius-control) border bg-white px-3 text-left text-sm transition-colors',
            'disabled:cursor-not-allowed disabled:bg-(--color-surface-sunken)',
            h,
            error ? 'border-(--color-expense)' : open ? 'border-brand-600' : 'border-(--color-line-strong)',
          )}
        >
          <span className={cn('truncate', !selected && !emptyLabel && 'text-(--color-text-faint)')}>{selected ? selected.label : (emptyLabel ?? placeholder)}</span>
          <IconChevronDown className={cn('size-4 shrink-0 text-(--color-text-muted) transition-transform', open && 'rotate-180')} />
        </button>
        {creatable && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => startCreate('')}
            title="Ro'yxatda yo'q modda — yangi qo'shish (doimiy moddalar ro'yxatida qoladi)"
            aria-label="Yangi xarajat moddasi"
            className={cn('flex shrink-0 items-center justify-center rounded-(--radius-control) border border-(--color-line-strong) bg-white text-brand-700 hover:border-brand-600 hover:bg-brand-50 disabled:opacity-50', h, size === 'sm' ? 'w-8' : 'w-10')}
          >
            <IconPlus className="size-4" />
          </button>
        )}

        {open && (
          <div className="absolute top-full left-0 z-30 mt-1 w-full min-w-64 overflow-hidden rounded-(--radius-card) border border-(--color-line-strong) bg-white shadow-lg">
            <div className="relative border-b border-(--color-line) p-2">
              <IconSearch className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-(--color-text-faint)" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  // Enter — bitta topilgan bo'lsa tanlanadi, hech narsa topilmasa — yangi modda
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  if (totalFound === 1) pick(found[0]![1][0]!.code);
                  else if (!totalFound && creatable && query.trim()) startCreate(query.trim());
                }}
                placeholder="Qidirish: modda nomi yoki guruhi"
                className="h-8 w-full rounded border-0 bg-(--color-surface-sunken) pr-8 pl-8 text-sm placeholder:text-(--color-text-faint) focus:outline-none"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} className="absolute top-1/2 right-4 -translate-y-1/2 text-(--color-text-faint) hover:text-(--color-text)" aria-label="Tozalash">
                  <IconClose className="size-3.5" />
                </button>
              )}
            </div>

            <div className="max-h-72 overflow-y-auto py-1">
              {emptyLabel && !query && (
                <button type="button" onClick={() => pick('')} className={cn('block w-full px-3 py-2 text-left text-sm hover:bg-(--color-surface-sunken)', !value && 'bg-brand-50 font-medium text-brand-800')}>
                  {emptyLabel}
                </button>
              )}
              {totalFound === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-(--color-text-muted)">Hech narsa topilmadi</p>
              ) : (
                found.map(([group, items]) => (
                  <div key={group}>
                    <p className="px-3 py-1.5 text-xs font-semibold tracking-wide text-(--color-text-faint) uppercase">{group}</p>
                    {items.map((item) => (
                      <button
                        key={item.code}
                        type="button"
                        onClick={() => pick(item.code)}
                        className={cn('block w-full px-3 py-2 text-left text-sm transition-colors', item.code === value ? 'bg-brand-50 font-medium text-brand-800' : 'text-(--color-text) hover:bg-(--color-surface-sunken)')}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>

            {creatable && (
              <button
                type="button"
                onClick={() => startCreate(query.trim())}
                className="flex w-full items-center gap-2 border-t border-(--color-line) px-3 py-2.5 text-left text-sm font-medium text-brand-700 transition-colors hover:bg-brand-50"
              >
                <IconPlus className="size-4" />
                {query.trim() ? `«${query.trim()}» — yangi modda` : 'Yangi modda'}
              </button>
            )}
          </div>
        )}
      </div>

      {error ? <p className="mt-1 text-xs text-(--color-expense)">{error}</p> : hint && <p className="mt-1 text-xs text-(--color-text-muted)">{hint}</p>}

      {creatable && !onCreateNew && (
        <QuickCategoryDialog
          open={dialog !== null}
          groups={groups}
          initialLabel={dialog ?? ''}
          onClose={() => setDialog(null)}
          onCreated={(category) => {
            setCreated((list) => [...list, { code: category.code, label: category.label, group: groups.find((g) => g.code === category.parentCode)?.label ?? null }]);
            onChange(category.code);
            void onCreated?.(category);
          }}
        />
      )}
    </div>
  );
}
