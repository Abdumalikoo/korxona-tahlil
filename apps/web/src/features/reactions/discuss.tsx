'use client';

import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AssigneePicker, type PickedAssignee } from './assignee-picker';
import { markKey, reactionsApi, type MarkItem } from './api';
import { useReactionSelect } from './select-context';

// ═══════════════════════════════════════════════════════════
// «Muhokamaga qo'yish» — istalgan detaldan darhol munosabat ochish.
//  DiscussDrawer — nomi, muddat, izoh, mas'ullar (bitta yoki bir nechta modda)
//  DiscussMenu   — tugma; bir nechta variant bo'lsa (yozuv, mijoz, xizmat turi...) — ro'yxatdan tanlanadi
// Munosabat ochish — administrator huquqi (backend ham shuni tekshiradi).
// ═══════════════════════════════════════════════════════════

const FIELD = 'h-9 w-full rounded-(--radius-control) border border-(--color-line) bg-white px-2.5 text-sm outline-none focus:border-brand-400';
const LABEL = 'mb-1 block text-xs font-medium text-(--color-text-muted)';

const KIND_CHIP: Record<MarkItem['kind'], { label: string; className: string }> = {
  INCOME: { label: 'Daromad', className: 'bg-(--color-income-soft) text-(--color-income)' },
  EXPENSE: { label: 'Xarajat', className: 'bg-(--color-expense-soft) text-(--color-expense)' },
  RESULT: { label: 'Natija', className: 'bg-brand-50 text-brand-700' },
};

export function plusDays(days: number): string {
  return new Date(Date.now() + 5 * 3600_000 + days * 86_400_000).toISOString().slice(0, 10);
}

export function KindChip({ kind }: { kind: MarkItem['kind'] }) {
  const chip = KIND_CHIP[kind];
  return <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold', chip.className)}>{chip.label}</span>;
}

/** Munosabat ochish oynasi */
export function DiscussDrawer({
  items,
  open,
  onClose,
  onCreated,
  defaultTitle,
  defaultNote,
}: {
  items: MarkItem[];
  open: boolean;
  onClose: () => void;
  /** Munosabat ochilgandan keyin (masalan, ogohlantirishni yashirish) */
  onCreated?: (reactionId: string) => void | Promise<void>;
  defaultTitle?: string;
  defaultNote?: string;
}) {
  const [title, setTitle] = useState(defaultTitle ?? items[0]?.label ?? '');
  const [due, setDue] = useState(plusDays(30));
  const [note, setNote] = useState(defaultNote ?? '');
  const [assignees, setAssignees] = useState<PickedAssignee[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const submit = async () => {
    if (items.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const created = await reactionsApi.create({
        title: title.trim() || items[0]!.label,
        note: note.trim() || undefined,
        dueDate: due,
        items,
        assignees: assignees.map((a) => ({ pinfl: a.pinfl, role: a.role })),
      });
      setCreatedId(created.data.id);
      await onCreated?.(created.data.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Munosabat ochilmadi');
    } finally {
      setBusy(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <Drawer
      open={open}
      onClose={onClose}
      title="Muhokamaga qo'yish"
      description={items.length === 1 ? `Modda: ${items[0]!.label}` : `${items.length} ta modda bitta munosabatda`}
      footer={
        createdId ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Yopish
            </Button>
            <Link
              href={`/munosabat/${createdId}`}
              className="inline-flex h-9 items-center rounded-(--radius-control) bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Munosabatni ochish →
            </Link>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Bekor qilish
            </Button>
            <Button onClick={submit} loading={busy} disabled={!due || items.length === 0}>
              Munosabat ochish
            </Button>
          </>
        )
      }
    >
      {createdId ? (
        <div className="space-y-3">
          <p className="rounded-(--radius-control) bg-(--color-income-soft) px-4 py-3 text-sm text-(--color-income)">
            Munosabat ochildi. Baza davri hisoblandi — muddat tugaganda natija o&apos;zi baholanadi.
          </p>
          <ItemList items={items} />
        </div>
      ) : (
        <div className="space-y-4">
          <ItemList items={items} />
          <label className="block">
            <span className={LABEL}>Nomi</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={FIELD} maxLength={160} />
          </label>
          <label className="block">
            <span className={LABEL}>Muddat (natija shu kungacha kuzatiladi)</span>
            <input type="date" value={due} min={plusDays(1)} onChange={(e) => setDue(e.target.value)} className={FIELD} />
          </label>
          <label className="block">
            <span className={LABEL}>Izoh</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={2000} className={cn(FIELD, 'h-auto py-2')} />
          </label>
          <div>
            <span className={LABEL}>Mas&apos;ullar (ixtiyoriy)</span>
            <AssigneePicker value={assignees} onChange={setAssignees} />
          </div>
          <p className="rounded-(--radius-control) bg-(--color-surface-muted) px-3 py-2 text-xs text-(--color-text-muted)">
            Baza — bugungacha bo&apos;lgan teng davr. Muddat tugaganda tizim moddaning yaxshilangan yoki yomonlashganini o&apos;zi hisoblaydi.
          </p>
          {error && <p className="text-sm text-(--color-expense)">{error}</p>}
        </div>
      )}
    </Drawer>,
    document.body,
  );
}

function ItemList({ items }: { items: MarkItem[] }) {
  return (
    <ul className="divide-y divide-(--color-line) rounded-(--radius-control) border border-(--color-line)">
      {items.map((item) => (
        <li key={markKey(item)} className="flex items-center gap-2 px-3 py-2 text-sm">
          <KindChip kind={item.kind} />
          <span className="min-w-0 truncate text-heading" title={item.label}>
            {item.label}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
      <path d="M8.5 12h.01M12 12h.01M15.5 12h.01" />
    </svg>
  );
}

/**
 * «Muhokamaga qo'yish» tugmasi. Variantlar bitta bo'lsa — darhol oyna ochiladi,
 * bir nechta bo'lsa — ro'yxat: har birini muhokamaga qo'yish yoki savatga qo'shish mumkin.
 */
export function DiscussMenu({
  items,
  label = "Muhokamaga qo'yish",
  size = 'sm',
  align = 'right',
  direction = 'down',
  className,
}: {
  items: (MarkItem | null | undefined)[];
  label?: string;
  size?: 'xs' | 'sm';
  align?: 'left' | 'right';
  /** Ro'yxat qayerga ochiladi (oyna pastida bo'lsa — 'up') */
  direction?: 'down' | 'up';
  className?: string;
}) {
  const { isAdmin } = useAuth();
  const select = useReactionSelect();
  const options = items.filter((i): i is MarkItem => Boolean(i));
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<MarkItem[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  if (!isAdmin || options.length === 0) return null;

  const start = (list: MarkItem[]) => {
    setOpen(false);
    setChosen(list);
  };

  return (
    <div ref={ref} className={cn('relative inline-flex', className)} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => (options.length === 1 ? start(options) : setOpen((v) => !v))}
        className={cn(
          'inline-flex items-center gap-1.5 whitespace-nowrap rounded-(--radius-control) border border-brand-200 bg-brand-50 font-semibold text-brand-700 transition-colors hover:border-brand-400 hover:bg-brand-100',
          size === 'xs' ? 'h-7 px-2 text-[11px]' : 'h-8 px-3 text-xs',
        )}
        title={options.length === 1 ? `Muhokamaga qo'yish: ${options[0]!.label}` : "Nimani muhokamaga qo'yishni tanlang"}
        aria-haspopup={options.length > 1 ? 'menu' : undefined}
        aria-expanded={options.length > 1 ? open : undefined}
      >
        <ChatIcon className="size-3.5" />
        {label}
        {options.length > 1 && <span className="text-[0.8em]">▾</span>}
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute z-50 w-[26rem] max-w-[90vw] overflow-hidden rounded-xl border border-(--color-line) bg-white text-left shadow-xl',
            align === 'right' ? 'right-0' : 'left-0',
            direction === 'down' ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
          )}
        >
          <p className="border-b border-(--color-line) px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-(--color-text-faint)">Nimani muhokamaga qo&apos;yamiz?</p>
          <ul className="max-h-72 overflow-y-auto py-1">
            {options.map((item) => {
              const inBasket = select?.isMarked(item) ?? false;
              return (
                <li key={markKey(item)} className="flex items-center gap-2 px-3 py-1.5 hover:bg-brand-50/60">
                  <button type="button" role="menuitem" onClick={() => start([item])} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-heading">
                    <KindChip kind={item.kind} />
                    <span className="truncate" title={item.label}>
                      {item.label}
                    </span>
                  </button>
                  {select && (
                    <button
                      type="button"
                      onClick={() => {
                        select.toggle(item);
                        if (!select.active) select.setActive(true);
                      }}
                      className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold',
                        inBasket ? 'bg-amber-500 text-white' : 'border border-amber-400 text-amber-700 hover:bg-amber-50',
                      )}
                      title="Bir nechta moddani bitta munosabatga yig'ish"
                    >
                      {inBasket ? 'Savatda ✓' : '+ Savat'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {options.length > 1 && (
            <button
              type="button"
              onClick={() => start(options)}
              className="block w-full border-t border-(--color-line) bg-(--color-surface-muted) px-3 py-2 text-center text-xs font-semibold text-brand-700 hover:bg-brand-50"
            >
              Hammasini bitta munosabatga ({options.length})
            </button>
          )}
        </div>
      )}

      {chosen && <DiscussDrawer items={chosen} open onClose={() => setChosen(null)} />}
    </div>
  );
}