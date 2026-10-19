'use client';

import { IconChevronDown, IconClose, IconPlus, IconSearch } from '@/components/ui/icons';
import type { Category } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useRef, useState } from 'react';

interface CategoryPickerProps {
  categories: Category[];
  value: string;
  onChange: (code: string) => void;
  label?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Royxat pastida yangi kategoriya qoshish tugmasi */
  onCreateNew?: (query: string) => void;
}

/**
 * Kategoriya tanlagich.
 *
 * Yopiq holatda - tanlangan kategoriya nomi.
 * Ochiq holatda - qidiruv maydoni va guruhlangan ro'yxat.
 * Yozilganda ro'yxat filtrlanadi, kalit so'zlar ham hisobga olinadi.
 */
export function CategoryPicker({
  categories,
  value,
  onChange,
  label,
  error,
  required,
  disabled,
  placeholder = 'Kategoriya tanlang',
  onCreateNew,
}: CategoryPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = categories.find((item) => item.code === value);

  // Tashqariga bosilganda yopamiz
  useEffect(() => {
    if (!open) return;

    function handleClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        setQuery('');
      }
    }

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  // Ochilganda qidiruvga fokus
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  /** Ota-kategoriya nomlari - guruh sarlavhalari uchun */
  const parentLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of categories) {
      if (!item.isLeaf) map.set(item.code, item.label);
    }
    return map;
  }, [categories]);

  /** Qidiruvga mos barg kategoriyalar, guruhlar bo'yicha */
  const groups = useMemo(() => {
    const term = query.trim().toLowerCase();

    const leaves = categories.filter((item) => {
      if (!item.isLeaf || !item.isActive) return false;
      if (!term) return true;

      const inLabel = item.label.toLowerCase().includes(term);
      const inKeywords = item.keywords.some((word) => word.toLowerCase().includes(term));
      const parentLabel = item.parentCode
        ? (parentLabels.get(item.parentCode)?.toLowerCase() ?? '')
        : '';
      const inParent = parentLabel.includes(term);

      return inLabel || inKeywords || inParent;
    });

    const result = new Map<string, { code: string; title: string; items: Category[] }>();

    for (const leaf of leaves) {
      const parentCode = leaf.parentCode ?? 'OTHER';
      if (!result.has(parentCode)) {
        result.set(parentCode, {
          code: parentCode,
          title: parentLabels.get(parentCode) ?? 'Boshqa',
          items: [],
        });
      }
      result.get(parentCode)?.items.push(leaf);
    }

    return [...result.values()];
  }, [categories, query, parentLabels]);

  const totalFound = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <div className="w-full" ref={containerRef}>
      {label && (
        <label className="mb-1.5 block text-sm font-medium text-[--color-text]">
          {label}
          {required && <span className="ml-0.5 text-[--color-expense]">*</span>}
        </label>
      )}

      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((state) => !state)}
          className={cn(
            'flex h-10 w-full items-center justify-between gap-2 rounded-[--radius-control]',
            'border bg-white px-3 text-left text-sm transition-colors',
            'disabled:cursor-not-allowed disabled:bg-[--color-surface-sunken]',
            error
              ? 'border-[--color-expense]'
              : open
                ? 'border-brand-600'
                : 'border-[--color-line-strong]',
          )}
        >
          <span className={cn('truncate', !selected && 'text-[--color-text-faint]')}>
            {selected ? selected.label : placeholder}
          </span>
          <IconChevronDown
            className={cn(
              'size-4 shrink-0 text-[--color-text-muted] transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>

        {open && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-[--radius-card] border border-[--color-line-strong] bg-white shadow-lg">
            {/* Qidiruv */}
            <div className="relative border-b border-[--color-line] p-2">
              <IconSearch className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[--color-text-faint]" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Qidirish"
                className="h-8 w-full rounded border-0 bg-[--color-surface-sunken] pl-8 pr-8 text-sm placeholder:text-[--color-text-faint] focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[--color-text-faint] hover:text-[--color-text]"
                >
                  <IconClose className="size-3.5" />
                </button>
              )}
            </div>

            {/* Ro'yxat */}
            <div className="max-h-72 overflow-y-auto py-1">
              {totalFound === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-[--color-text-muted]">
                  Hech narsa topilmadi
                </p>
              ) : (
                groups.map((group) => (
                  <div key={group.code}>
                    <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[--color-text-faint]">
                      {group.title}
                    </p>
                    {group.items.map((item) => (
                      <button
                        key={item.code}
                        type="button"
                        onClick={() => {
                          onChange(item.code);
                          setOpen(false);
                          setQuery('');
                        }}
                        className={cn(
                          'block w-full px-3 py-2 text-left text-sm transition-colors',
                          item.code === value
                            ? 'bg-brand-50 font-medium text-brand-800'
                            : 'text-[--color-text] hover:bg-[--color-surface-sunken]',
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>

            {onCreateNew && (
              <button
                type="button"
                onClick={() => {
                  onCreateNew(query.trim());
                  setOpen(false);
                  setQuery('');
                }}
                className="flex w-full items-center gap-2 border-t border-[--color-line] px-3 py-2.5 text-left text-sm font-medium text-brand-700 transition-colors hover:bg-brand-50"
              >
                <IconPlus className="size-4" />
                {query.trim() ? `"${query.trim()}" qoshish` : 'Yangi kategoriya'}
              </button>
            )}
          </div>
        )}
      </div>

      {error && <p className="mt-1 text-xs text-[--color-expense]">{error}</p>}
    </div>
  );
}
