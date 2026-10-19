'use client';

import { IconSearch, IconSpinner } from '@/components/ui/icons';
import { entryHref, searchApi, type SearchEntry, type SearchResult } from '@/features/search/api';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { pageIndex } from './nav-config';

// ═══════════════════════════════════════════════════════════
// Global qidiruv: Ctrl+K (yoki yuqoridagi "Qidirish").
// Sahifalar — darhol (brauzerda); xodimlar, mijozlar, kontragentlar, mashinalar,
// ijara, munosabat va nazorat — serverdan (yozish to'xtagach 250 ms).
// ↑ ↓ — tanlash, Enter — ochish, Esc — yopish.
// ═══════════════════════════════════════════════════════════

type Group = keyof Omit<SearchResult, 'query'>;

const GROUPS: { key: Group; label: string }[] = [
  { key: 'employees', label: 'Xodimlar' },
  { key: 'incomes', label: 'Daromadlar (mijoz, izoh, shartnoma)' },
  { key: 'expenses', label: 'Xarajatlar (kontragent, izoh, hujjat)' },
  { key: 'vehicles', label: 'Mashinalar' },
  { key: 'leases', label: 'Ijara shartnomalari' },
  { key: 'reactions', label: 'Munosabat' },
  { key: 'controls', label: 'Nazorat' },
];

interface Hit {
  group: string;
  title: string;
  subtitle?: string;
  href: string;
}

/** Katta-kichik harf va o'zbekcha apostroflarni farqlamay solishtirish */
function norm(text: string): string {
  return text.toLowerCase().replace(/[ʻʼ‘’`']/g, "'");
}

export function GlobalSearch() {
  const router = useRouter();
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [server, setServer] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const pages = useMemo(() => pageIndex(isAdmin), [isAdmin]);

  // Ochish: Ctrl+K / ⌘K yoki "global-search:open" hodisasi
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('global-search:open', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('global-search:open', onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ('');
      setServer(null);
      setSel(0);
      setError(null);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  // Serverdan qidirish (oxirgi so'rov natijasi qoladi)
  useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 2) {
      setServer(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchApi.query(term);
        if (alive) {
          setServer(res.data);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Qidiruvda xato');
      } finally {
        if (alive) setLoading(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q, open]);

  const hits: Hit[] = useMemo(() => {
    const term = norm(q.trim());
    const pageHits = pages
      .filter((p) => !term || norm(`${p.trail} ${p.description ?? ''}`).includes(term))
      .slice(0, term ? 8 : 12)
      .map((p) => ({ group: 'Sahifalar', title: p.trail, subtitle: p.description, href: p.href }));
    const dataHits = server && server.query === q.trim()
      ? GROUPS.flatMap((g) => (server[g.key] as SearchEntry[]).map((e) => ({ group: g.label, title: e.title, subtitle: e.subtitle, href: entryHref(g.key, e, server.query) })))
      : [];
    return [...pageHits, ...dataHits];
  }, [q, pages, server]);

  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(0, hits.length - 1)));
  }, [hits.length]);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!open) return null;

  const go = (hit: Hit | undefined) => {
    if (!hit) return;
    setOpen(false);
    router.push(hit.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(hits.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(hits[sel]);
    }
  };

  let lastGroup = '';
  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/40 p-4 backdrop-blur-sm" onMouseDown={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Qidiruv">
      <div className="mx-auto mt-[8vh] max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-(--color-line) px-4">
          {loading ? <IconSpinner className="size-5 text-brand-600" /> : <IconSearch className="size-5 text-brand-600" />}
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={onKeyDown}
            className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-(--color-text-faint)"
            placeholder="Sahifa, xodim, mijoz, kontragent, mashina, shartnoma…"
          />
          <kbd className="rounded bg-(--color-surface-sunken) px-1.5 text-[11px] text-(--color-text-muted)">Esc</kbd>
        </div>

        <div ref={list} className="max-h-[60vh] overflow-y-auto p-2">
          {hits.length === 0 && !loading && <p className="p-6 text-center text-sm text-(--color-text-muted)">Hech narsa topilmadi</p>}
          {hits.map((hit, i) => {
            const header = hit.group !== lastGroup;
            lastGroup = hit.group;
            return (
              <div key={`${hit.group}-${hit.href}-${i}`}>
                {header && <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-faint)">{hit.group}</p>}
                <button
                  type="button"
                  data-index={i}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => go(hit)}
                  className={cn('flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left', i === sel ? 'bg-brand-600 text-white' : 'hover:bg-brand-50')}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{hit.title}</span>
                    {hit.subtitle && <span className={cn('block truncate text-xs', i === sel ? 'text-blue-100' : 'text-(--color-text-muted)')}>{hit.subtitle}</span>}
                  </span>
                  <span className={cn('shrink-0 text-xs', i === sel ? 'text-blue-100' : 'text-(--color-text-faint)')}>ochish ›</span>
                </button>
              </div>
            );
          })}
          {error && <p className="px-3 py-2 text-xs text-(--color-expense)">{error}</p>}
          {q.trim().length === 1 && <p className="px-3 py-2 text-xs text-(--color-text-faint)">Ma&apos;lumotlardan qidirish uchun kamida 2 ta harf yozing.</p>}
        </div>

        <div className="flex flex-wrap gap-4 border-t border-(--color-line) bg-(--color-surface-muted) px-4 py-2 text-[11px] text-(--color-text-muted)">
          <span>↑ ↓ — tanlash</span>
          <span>Enter — ochish</span>
          <span>Esc — yopish</span>
        </div>
      </div>
    </div>
  );
}