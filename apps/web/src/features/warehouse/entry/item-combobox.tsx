'use client';

import { formatTiyin } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useRef, useState } from 'react';
import { qtyText, type WarehouseItem } from '../api';

// ═══════════════════════════════════════════════════════════
// Buyum tanlash: yozasiz — ro'yxat qisqaradi (nomi, kodi, guruhi bo'yicha, har so'z alohida).
// ↑ ↓ — tanlash, Enter — olish, Esc — yopish. Topilmasa — «+ Yangi buyum» (kirimda).
// ═══════════════════════════════════════════════════════════

function matches(item: WarehouseItem, words: string[]): boolean {
  const hay = `${item.name} ${item.code} ${item.group ?? ''}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function ItemCombobox({
  items,
  value,
  initialSearch,
  onPick,
  onCreate,
  showStock,
  lineKey,
  invalid,
}: {
  items: WarehouseItem[];
  value: string;
  /** Excel'dan qo'yilgan, topilmagan nom */
  initialSearch?: string;
  onPick: (item: WarehouseItem | null) => void;
  /** Ro'yxatda yo'q — yangi buyum qo'shish (faqat kirimda) */
  onCreate?: (name: string) => void;
  /** Ombordagi qoldiqni ko'rsatish (chiqim, hisobdan chiqarish) */
  showStock?: boolean;
  lineKey: number;
  invalid?: boolean;
}) {
  const selected = items.find((i) => i.id === value) ?? null;
  const [text, setText] = useState(initialSearch ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const found = useMemo(() => {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    const list = words.length ? items.filter((i) => matches(i, words)) : items;
    return list.slice(0, 40);
  }, [items, text]);

  useEffect(() => setActive(0), [text]);

  const pick = (item: WarehouseItem) => {
    onPick(item);
    setText('');
    setOpen(false);
    // Keyingi maydon — miqdor
    setTimeout(() => document.querySelector<HTMLInputElement>(`[data-line="${lineKey}"][data-field="qty"]`)?.focus(), 0);
  };

  const canCreate = Boolean(onCreate) && text.trim().length >= 2 && !items.some((i) => i.name.toLowerCase() === text.trim().toLowerCase());
  const total = found.length + (canCreate ? 1 : 0);

  if (selected) {
    return (
      <div className="flex h-10 min-w-0 items-center justify-between gap-2 rounded-(--radius-control) border border-(--color-line) bg-(--color-surface-muted)/60 px-3">
        <span className="min-w-0 truncate text-sm">
          <b className="text-heading">{selected.name}</b>
          <span className="ml-2 text-xs text-(--color-text-muted)">
            {selected.code}
            {selected.kind === 'ASSET' ? ' · asosiy vosita' : ''}
          </span>
        </span>
        <button
          type="button"
          onClick={() => {
            onPick(null);
            setTimeout(() => document.querySelector<HTMLInputElement>(`[data-line="${lineKey}"][data-field="item"]`)?.focus(), 0);
          }}
          className="shrink-0 rounded px-1.5 text-xs text-(--color-text-muted) hover:bg-white hover:text-heading"
          title="Boshqa buyum tanlash"
        >
          almashtirish
        </button>
      </div>
    );
  }

  return (
    <div ref={box} className="relative min-w-0">
      <input
        data-line={lineKey}
        data-field="item"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={(e) => {
          setOpen(true);
          // Pastda bo'lsa — ro'yxat ochilishi uchun o'rtaga suriladi
          const el = e.currentTarget;
          setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(total - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (active < found.length && found[active]) pick(found[active]!);
            else if (canCreate) onCreate?.(text.trim());
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder="Buyum nomi yoki kodi…"
        className={cn(
          'h-10 w-full rounded-(--radius-control) border bg-white px-3 text-sm focus:border-brand-600',
          invalid ? 'border-(--color-expense)' : initialSearch && text ? 'border-amber-400 bg-amber-50' : 'border-(--color-line-strong)',
        )}
      />
      {initialSearch && text && !open && <p className="mt-0.5 text-[11px] text-amber-700">Ro&apos;yxatda topilmadi — tanlang yoki yangi buyum qo&apos;shing</p>}
      {open && (
        <div className="absolute z-30 mt-1 max-h-72 w-full min-w-[22rem] overflow-y-auto rounded-(--radius-control) border border-(--color-line) bg-white py-1 shadow-xl">
          {found.length === 0 && !canCreate && <p className="px-3 py-2 text-xs text-(--color-text-muted)">Topilmadi</p>}
          {found.map((item, i) => (
            <button
              key={item.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(item)}
              onMouseEnter={() => setActive(i)}
              className={cn('flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm', i === active ? 'bg-brand-50' : 'hover:bg-brand-50/60')}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-heading">{item.name}</span>
                <span className="block truncate text-[11px] text-(--color-text-muted)">
                  {item.code}
                  {item.group ? ` · ${item.group}` : ''}
                  {item.kind === 'ASSET' ? ' · asosiy vosita' : ''}
                </span>
              </span>
              <span className="shrink-0 text-right text-[11px] text-(--color-text-muted)">
                {showStock || item.inStock > 0 ? (
                  <span className={cn('block font-semibold', item.inStock <= 0 ? 'text-(--color-expense)' : item.low ? 'text-amber-600' : 'text-heading')}>
                    {qtyText(item.inStock)} {item.unit}
                  </span>
                ) : (
                  <span className="block">{item.unit}</span>
                )}
                {item.lastPriceTiyin && <span className="block">{formatTiyin(item.lastPriceTiyin)} so&apos;m</span>}
              </span>
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onCreate?.(text.trim())}
              className={cn('block w-full border-t border-(--color-line) px-3 py-2 text-left text-sm font-semibold text-brand-700', active === found.length ? 'bg-brand-50' : 'hover:bg-brand-50/60')}
            >
              + Yangi buyum: «{text.trim()}»
            </button>
          )}
        </div>
      )}
    </div>
  );
}