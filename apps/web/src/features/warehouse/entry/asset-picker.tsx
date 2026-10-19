'use client';

import { IconTrash } from '@/components/ui/icons';
import { formatTiyin } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CONDITION_OPTIONS, type WarehouseAsset } from '../api';

// ═══════════════════════════════════════════════════════════
// Asosiy vositalarni qo'shish: inventar raqamini yozib Enter
// («15» ham bo'ladi → INV-000015) yoki nomi / seriyasi / kimdaligi bo'yicha qidirib tanlash.
// Tanlanganlar pastda jadval: hozir qayerda, holati (dalolatnomaga), qiymati, olib tashlash.
// ═══════════════════════════════════════════════════════════

function normalizeInv(raw: string): string | null {
  const t = raw.trim().toUpperCase();
  const digits = /^(?:INV-?)?(\d{1,6})$/.exec(t);
  return digits ? `INV-${digits[1]!.padStart(6, '0')}` : null;
}

export function AssetPicker({
  candidates,
  selected,
  onChange,
  emptyText,
  title,
  wrongState,
  conditions,
  onConditionChange,
}: {
  /** Shu hujjatga mos vositalar (berishda — omborda, ko'chirishda — foydalanishda …) */
  candidates: WarehouseAsset[];
  selected: string[];
  onChange: (ids: string[]) => void;
  emptyText: string;
  title: string;
  /** Mos kelmaydigan holatdagi vosita yozilsa — tushuntirish (masalan, «hozir omborda emas») */
  wrongState?: string;
  /** Dalolatnomaning «Ҳолати» ustuni (bo'sh — shablondagi standart, odatda «Янги») */
  conditions?: Record<string, string>;
  onConditionChange?: (id: string, value: string) => void;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map(candidates.map((a) => [a.id, a])), [candidates]);

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
    return candidates
      .filter((a) => !selected.includes(a.id))
      .filter((a) => words.every((w) => `${a.inventoryNo} ${a.name} ${a.serialNo ?? ''} ${a.place.text}`.toLowerCase().includes(w)))
      .slice(0, 30);
  }, [candidates, selected, text]);

  useEffect(() => setActive(0), [text]);

  const add = (a: WarehouseAsset) => {
    onChange([...selected, a.id]);
    setText('');
    setMessage(null);
  };

  const enter = () => {
    // Asl raqam bilan to'liq mos (masalan Excel'dan kelgan «000004167»)
    const raw = text.trim().toUpperCase();
    const same = raw ? candidates.find((a) => a.inventoryNo.toUpperCase() === raw) : undefined;
    if (same) {
      if (selected.includes(same.id)) setMessage(`${same.inventoryNo} allaqachon qo'shilgan`);
      else add(same);
      return;
    }
    const inv = normalizeInv(text);
    if (inv) {
      const exact = candidates.find((a) => a.inventoryNo === inv);
      if (exact) {
        if (selected.includes(exact.id)) setMessage(`${inv} allaqachon qo'shilgan`);
        else add(exact);
        return;
      }
      setMessage(`${inv} — ${wrongState ?? 'bu hujjat uchun mos emas yoki topilmadi'}`);
      return;
    }
    if (found[active]) add(found[active]!);
  };

  const chosen = selected.map((id) => byId.get(id)).filter((a): a is WarehouseAsset => Boolean(a));
  const total = chosen.reduce((s, a) => s + Number(a.priceTiyin), 0);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p className="text-sm font-semibold text-heading">
          {title} <span className="font-normal text-(--color-text-muted)">· {chosen.length} ta</span>
        </p>
        <div ref={box} className="relative w-full sm:w-96">
          <input
            data-field="asset"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
              setMessage(null);
            }}
            onFocus={(e) => {
          setOpen(true);
          // Pastda bo'lsa — ro'yxat ochilishi uchun o'rtaga suriladi
          const el = e.currentTarget;
          setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 0);
        }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                enter();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setOpen(true);
                setActive((x) => Math.min(found.length - 1, x + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((x) => Math.max(0, x - 1));
              } else if (e.key === 'Escape') setOpen(false);
            }}
            placeholder="Inventar raqami (masalan 15) yoki nomi — Enter"
            className="h-10 w-full rounded-(--radius-control) border border-(--color-line-strong) bg-white px-3 font-mono text-sm focus:border-brand-600"
          />
          {open && found.length > 0 && (
            <div className="absolute right-0 z-30 mt-1 max-h-72 w-full min-w-[26rem] overflow-y-auto rounded-(--radius-control) border border-(--color-line) bg-white py-1 shadow-xl">
              {found.map((a, i) => (
                <button
                  key={a.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => add(a)}
                  onMouseEnter={() => setActive(i)}
                  className={cn('flex w-full items-center gap-3 px-3 py-2 text-left text-sm', i === active ? 'bg-brand-50' : 'hover:bg-brand-50/60')}
                >
                  <span className="w-24 shrink-0 font-mono text-xs font-semibold text-brand-700">{a.inventoryNo}</span>
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  <span className="max-w-[11rem] shrink-0 truncate text-[11px] text-(--color-text-muted)">{a.place.text}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {message && <p className="rounded-(--radius-control) bg-(--color-warn-soft) px-3 py-1.5 text-xs text-(--color-warn)">{message}</p>}

      {onConditionChange && (
        <datalist id="asset-condition-options">
          {CONDITION_OPTIONS.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
      <div className="overflow-hidden rounded-(--radius-control) border border-(--color-line)">
        {chosen.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-(--color-text-muted)">{emptyText}</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {chosen.map((a) => (
                <tr key={a.id} className="border-b border-(--color-line) last:border-b-0">
                  <td className="w-28 px-3 py-2 font-mono text-xs font-semibold text-brand-700">{a.inventoryNo}</td>
                  <td className="px-3 py-2">
                    <span className="font-medium text-heading">{a.name}</span>
                    {a.serialNo && <span className="ml-2 text-xs text-(--color-text-muted)">S/N {a.serialNo}</span>}
                  </td>
                  <td className="hidden px-3 py-2 text-xs text-(--color-text-muted) md:table-cell">hozir: {a.place.text}</td>
                  {onConditionChange && (
                    <td className="w-48 px-2 py-1.5">
                      <input
                        list="asset-condition-options"
                        value={conditions?.[a.id] ?? ''}
                        onChange={(e) => onConditionChange(a.id, e.target.value)}
                        placeholder="Holati: Янги"
                        title="Dalolatnomaning «Ҳолати» ustuni. Bo'sh qolsa — shablondagi standart (Янги)"
                        maxLength={120}
                        className="h-8 w-full rounded-md border border-(--color-line) bg-white px-2 text-xs focus:border-brand-600"
                      />
                    </td>
                  )}
                  <td className="money w-32 px-3 py-2 text-right">{formatTiyin(a.priceTiyin)}</td>
                  <td className="w-10 px-2 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onChange(selected.filter((x) => x !== a.id))}
                      className="rounded p-1 text-(--color-text-muted) hover:bg-red-50 hover:text-red-600"
                      aria-label="Olib tashlash"
                    >
                      <IconTrash className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="bg-(--color-surface-muted)/60">
                <td colSpan={onConditionChange ? 4 : 3} className="px-3 py-2 text-xs font-semibold text-(--color-text-muted)">
                  Jami {chosen.length} ta
                </td>
                <td className="money px-3 py-2 text-right font-semibold">{formatTiyin(total)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}