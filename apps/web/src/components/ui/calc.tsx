'use client';

import Link from 'next/link';
import { calcToLines, qFull, type Calc } from '@/lib/calc';
import { cn } from '@/lib/utils';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// ═══════════════════════════════════════════════════════════
// «Qanday hisoblandi?» oynasi.
//  <CalcValue calc={…}>88,2 mln</CalcValue> — raqamning o'zi bosiladi (nuqtali tagchiziq)
//  <CalcButton calc={…} />                  — kichik «ƒx» belgisi (kartochka sarlavhasi yonida)
// Oynada: formula → sonlar (qayerdan olingani) → ishlanishi qadamma-qadam → javob.
// ═══════════════════════════════════════════════════════════

const PANEL_W = 380;

function CalcPanel({ calc, anchor, onClose }: { calc: Calc; anchor: DOMRect; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: anchor.left, top: anchor.bottom + 6 });
  const [copied, setCopied] = useState(false);

  // Ekrandan chiqib ketmasin: pastga sig'masa — tepaga
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(PANEL_W, vw - 16);
    const left = Math.max(8, Math.min(anchor.left, vw - w - 8));
    const below = anchor.bottom + 6;
    const top = below + h > vh - 8 && anchor.top - h - 6 > 8 ? anchor.top - h - 6 : Math.max(8, Math.min(below, vh - h - 8));
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onScroll = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(calcToLines(calc).join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // nusxa olib bo'lmasa — jim
    }
  };

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`Qanday hisoblandi: ${calc.title}`}
      style={{ left: pos.left, top: pos.top, width: `min(${PANEL_W}px, calc(100vw - 16px))` }}
      className="fixed z-[60] max-h-[70vh] overflow-y-auto rounded-2xl border border-(--color-line) bg-white text-left shadow-2xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3 border-b border-(--color-line) bg-brand-50/60 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-700">Qanday hisoblandi?</p>
          <p className="text-sm font-bold text-heading">{calc.title}</p>
        </div>
        <button type="button" onClick={onClose} className="-mr-1 rounded p-1 text-(--color-text-muted) hover:bg-white hover:text-heading" aria-label="Yopish">
          ✕
        </button>
      </div>

      <div className="space-y-3 px-4 py-3 text-sm">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-(--color-text-faint)">1. Formula</p>
          <p className="rounded-lg bg-(--color-surface-muted) px-3 py-2 font-medium text-heading">{calc.formula}</p>
        </div>

        {calc.inputs.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-(--color-text-faint)">2. Sonlar</p>
            <ul className="divide-y divide-(--color-line) rounded-lg border border-(--color-line)">
              {calc.inputs.map((q, i) => (
                <li key={`${q.label}-${i}`} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                  <span className="min-w-0 text-(--color-text-muted)">
                    {q.label}
                    {q.source && <span className="block text-[10px] text-(--color-text-faint)">{q.source}</span>}
                  </span>
                  <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums text-heading">{qFull(q)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-(--color-text-faint)">3. Ishlanishi</p>
          <ol className="space-y-1">
            {calc.steps.map((step, i) => (
              <li key={i} className="flex gap-2 tabular-nums">
                <span className="w-4 shrink-0 text-right text-xs text-(--color-text-faint)">{i + 1})</span>
                <span className="text-heading">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex items-baseline justify-between gap-3 rounded-lg bg-brand-600 px-3 py-2 text-white">
          <span className="text-xs font-medium opacity-90">Javob</span>
          <span className="text-right font-bold tabular-nums">{calc.result}</span>
        </div>

        {calc.note && <p className="text-xs leading-relaxed text-(--color-text-muted)">{calc.note}</p>}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-(--color-line) px-4 py-2">
        {/* Hamma formulalar sahifasi (formula ma'lum bo'lsa — to'g'ridan-to'g'ri o'shanga) */}
        <Link href={`/formulalar${calc.formulaId ? `#${calc.formulaId}` : ''}`} onClick={onClose} className="text-xs font-medium text-(--color-text-muted) hover:text-brand-700 hover:underline">
          Barcha formulalar →
        </Link>
        <button type="button" onClick={copy} className="text-xs font-medium text-brand-700 hover:underline">
          {copied ? 'Nusxa olindi ✓' : 'Hisobni nusxalash'}
        </button>
      </div>
    </div>,
    document.body,
  );
}

function useCalcPopover() {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  const toggle = (el: HTMLElement) => setAnchor((a) => (a ? null : el.getBoundingClientRect()));
  return { anchor, close, toggle };
}

/** Raqamning o'zi bosiladi: nuqtali tagchiziq, ustiga kelganda ko'k */
export function CalcValue({ calc, children, className }: { calc: Calc | null | undefined; children: ReactNode; className?: string }) {
  const { anchor, close, toggle } = useCalcPopover();
  if (!calc) return <>{children}</>;
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggle(e.currentTarget);
        }}
        title="Qanday hisoblandi? — bosing"
        className={cn(
          'cursor-help rounded-sm text-inherit underline decoration-current/35 decoration-dotted underline-offset-[3px] transition-colors hover:bg-brand-50 hover:decoration-brand-500',
          anchor && 'bg-brand-50 decoration-brand-500',
          className,
        )}
      >
        {children}
      </button>
      {anchor && <CalcPanel calc={calc} anchor={anchor} onClose={close} />}
    </>
  );
}

/** Kichik «ƒx» belgisi */
export function CalcButton({ calc, className }: { calc: Calc | null | undefined; className?: string }) {
  const { anchor, close, toggle } = useCalcPopover();
  if (!calc) return null;
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggle(e.currentTarget);
        }}
        title={`Qanday hisoblandi: ${calc.title}`}
        aria-label={`Qanday hisoblandi: ${calc.title}`}
        className={cn(
          'inline-flex h-5 shrink-0 items-center justify-center rounded-md border px-1.5 font-serif text-[11px] font-semibold italic leading-none transition-colors',
          anchor ? 'border-brand-500 bg-brand-600 text-white' : 'border-brand-200 bg-brand-50 text-brand-700 hover:border-brand-400',
          className,
        )}
      >
        ƒx
      </button>
      {anchor && <CalcPanel calc={calc} anchor={anchor} onClose={close} />}
    </>
  );
}