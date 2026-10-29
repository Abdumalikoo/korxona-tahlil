'use client';

import { IconPlus } from '@/components/ui/icons';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { openQuickAdd, QUICK_TONES, quickGroups, type QuickAction } from './quick-actions';

// ═══════════════════════════════════════════════════════════
// «+ Kiritish» — har qanday sahifadan istalgan yozuvni kiritishni boshlash.
// Ochish: yuqori paneldagi tugma yoki N tugmasi (matn yozilmayotganda).
// Ichida: yozib qidirish, ↑ ↓ bilan tanlash, Enter — ochish, Esc — yopish.
// ═══════════════════════════════════════════════════════════

const norm = (s: string) => s.toLowerCase().replace(/[ʻʼ‘’`']/g, "'");

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Yuqori paneldagi tugma */
export function QuickAddButton() {
  const { canWrite } = useAuth();
  const any = useMemo(() => quickGroups(canWrite).length > 0, [canWrite]);
  if (!any) return null;
  return (
    <button
      type="button"
      onClick={openQuickAdd}
      title="Yangi yozuv kiritish (N)"
      className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 text-sm font-semibold text-white shadow-sm shadow-brand-600/25 transition-colors hover:bg-brand-700"
    >
      <IconPlus className="size-4" />
      <span className="hidden sm:inline">Kiritish</span>
      <kbd className="ml-1 hidden rounded bg-white/20 px-1.5 font-sans text-[11px] font-medium lg:inline">N</kbd>
    </button>
  );
}

/** Oynaning o'zi (layout'da bir marta) */
export function QuickAddDialog() {
  const router = useRouter();
  const { canWrite, ready } = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => (ready ? quickGroups(canWrite) : []), [canWrite, ready]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'n' || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      setOpen(true);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('quick-add:open', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('quick-add:open', onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const term = norm(q.trim());
    return groups
      .map((g) => ({ ...g, actions: g.actions.filter((a) => !term || norm(`${a.label} ${a.hint} ${a.words ?? ''} ${g.title}`).includes(term)) }))
      .filter((g) => g.actions.length > 0);
  }, [groups, q]);
  const flat = useMemo(() => filtered.flatMap((g) => g.actions), [filtered]);

  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(0, flat.length - 1)));
  }, [flat.length]);

  if (!open || groups.length === 0) return null;

  const go = (a: QuickAction | undefined) => {
    if (!a) return;
    setOpen(false);
    router.push(a.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      setSel((s) => Math.min(flat.length - 1, s + 1));
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(flat[sel]);
    }
  };

  // Har guruh birinchi tugmasining umumiy tartib raqami (klaviatura bilan tanlash uchun)
  const groupStart: number[] = [];
  let count = 0;
  for (const g of filtered) {
    groupStart.push(count);
    count += g.actions.length;
  }
  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/40 p-4 backdrop-blur-sm" onMouseDown={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Yangi yozuv kiritish">
      <div className="mx-auto mt-[6vh] max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-(--color-line) px-4">
          <IconPlus className="size-5 text-brand-600" />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={onKeyDown}
            className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-(--color-text-faint)"
            placeholder="Nima kiritamiz? Masalan: benzin, kirim, pochta, oylik…"
          />
          <kbd className="rounded bg-(--color-surface-sunken) px-1.5 text-[11px] text-(--color-text-muted)">Esc</kbd>
        </div>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto p-4">
          {filtered.length === 0 && <p className="p-6 text-center text-sm text-(--color-text-muted)">Bunday kiritish turi yo&apos;q. Boshqacha yozib ko&apos;ring.</p>}
          {filtered.map((g, gi) => (
            <section key={g.title}>
              <div className="mb-2 flex flex-wrap items-baseline gap-x-2 px-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-heading">{g.title}</p>
                <p className="text-[11px] text-(--color-text-faint)">{g.note}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {g.actions.map((a, ai) => {
                  const i = groupStart[gi]! + ai;
                  const tone = QUICK_TONES[a.tone];
                  return (
                    <button
                      key={a.key}
                      type="button"
                      onMouseEnter={() => setSel(i)}
                      onClick={() => go(a)}
                      className={cn(
                        'flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                        i === sel ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-(--color-line) hover:border-brand-300',
                      )}
                    >
                      <span className={cn('mt-1 size-2.5 shrink-0 rounded-full', tone.dot)} />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-heading">{a.label}</span>
                        <span className="block truncate text-xs text-(--color-text-muted)">{a.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-4 border-t border-(--color-line) bg-(--color-surface-muted) px-4 py-2 text-[11px] text-(--color-text-muted)">
          <span>Yozing — qidirish</span>
          <span>↑ ↓ — tanlash</span>
          <span>Enter — ochish</span>
          <span>N — istalgan sahifadan shu oyna</span>
          <Link href="/kiritish" onClick={() => setOpen(false)} className="ml-auto font-semibold text-brand-700 hover:underline">
            Tez kiritish sahifasi →
          </Link>
        </div>
      </div>
    </div>
  );
}