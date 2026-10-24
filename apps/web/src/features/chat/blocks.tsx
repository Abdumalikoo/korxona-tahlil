'use client';

import { PersonCard } from '@/features/hr-sheets/miya-view';
import { cn } from '@/lib/utils';
import type { ChatBlock } from './api';

// ═══════════════════════════════════════════════════════════
// Manba chati javob bloklari: matn, ko'rsatkichlar, jadval, ustunli diagramma, xodim kartasi, tanlash.
// ═══════════════════════════════════════════════════════════

const TONE: Record<string, string> = {
  income: 'text-emerald-700',
  expense: 'text-(--color-expense)',
  warn: 'text-amber-700',
  brand: 'text-brand-700',
};

export function ChatBlocks({ blocks, onAsk }: { blocks: ChatBlock[]; onAsk: (text: string) => void }) {
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => (
        <Block key={i} b={b} onAsk={onAsk} />
      ))}
    </div>
  );
}

function Block({ b, onAsk }: { b: ChatBlock; onAsk: (text: string) => void }) {
  switch (b.type) {
    case 'text':
      return (
        <p className={cn('text-sm leading-relaxed', b.tone === 'warn' ? 'rounded-(--radius-control) border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900' : b.tone === 'muted' ? 'text-(--color-text-muted)' : 'text-heading')}>
          {b.text}
        </p>
      );
    case 'metrics':
      return (
        <div className={cn('grid gap-2', b.items.length >= 4 ? 'sm:grid-cols-2 xl:grid-cols-4' : b.items.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
          {b.items.map((m) => (
            <div key={m.label} className="rounded-(--radius-control) border border-(--color-line) bg-white px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-(--color-text-muted)">{m.label}</p>
              <p className={cn('money mt-0.5 text-base font-semibold', m.tone ? TONE[m.tone] : 'text-heading')}>{m.value}</p>
              {m.sub && <p className="text-[11px] text-(--color-text-muted)">{m.sub}</p>}
            </div>
          ))}
        </div>
      );
    case 'table':
      return (
        <div className="overflow-hidden rounded-(--radius-control) border border-(--color-line) bg-white">
          {b.title && <p className="border-b border-(--color-line) bg-(--color-surface-muted) px-3 py-1.5 text-xs font-semibold text-heading">{b.title}</p>}
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full border-separate border-spacing-0 text-xs">
              <thead className="sticky top-0 bg-white">
                <tr>
                  {b.columns.map((c) => (
                    <th key={c.key} className={cn('border-b border-(--color-line) px-3 py-1.5 font-semibold whitespace-nowrap text-(--color-text-muted)', c.align === 'right' ? 'text-right' : 'text-left')}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, i) => (
                  <tr key={i} className="hover:bg-brand-50/40">
                    {b.columns.map((c) => (
                      <td key={c.key} className={cn('border-b border-(--color-line) px-3 py-1.5 align-top', c.align === 'right' ? 'money text-right whitespace-nowrap' : 'text-heading')}>
                        {r[c.key] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {b.total && (
                <tfoot className="sticky bottom-0 bg-(--color-surface-muted) font-semibold">
                  <tr>
                    {b.columns.map((c) => (
                      <td key={c.key} className={cn('px-3 py-1.5', c.align === 'right' ? 'money text-right whitespace-nowrap' : 'text-heading')}>
                        {b.total![c.key] ?? ''}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {b.note && <p className="border-t border-(--color-line) px-3 py-1.5 text-[11px] text-(--color-text-muted)">{b.note}</p>}
        </div>
      );
    case 'bars': {
      const max = Math.max(1, ...b.items.map((x) => Math.abs(x.value)));
      return (
        <div className="rounded-(--radius-control) border border-(--color-line) bg-white p-3">
          {b.title && <p className="mb-2 text-xs font-semibold text-heading">{b.title}</p>}
          <ul className="space-y-1.5">
            {b.items.map((x) => (
              <li key={x.label} className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] items-center gap-3 text-xs">
                <span className="truncate text-heading" title={x.label}>
                  {x.label}
                </span>
                <span className="h-2.5 overflow-hidden rounded-full bg-(--color-surface-muted)">
                  <span className="block h-full rounded-full bg-brand-500" style={{ width: `${Math.max(2, (Math.abs(x.value) / max) * 100)}%` }} />
                </span>
                <span className="text-right whitespace-nowrap">
                  <span className="money font-semibold text-heading">{x.display}</span>
                  {x.sub && <span className="ml-1.5 text-(--color-text-muted)">{x.sub}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case 'person':
      return <PersonCard p={b.data} />;
    case 'choices':
      return (
        <div className="rounded-(--radius-control) border border-(--color-line) bg-white p-3">
          <p className="mb-2 text-sm font-medium text-heading">{b.title}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {b.items.map((x) => (
              <button
                key={x.ask}
                type="button"
                onClick={() => onAsk(x.ask)}
                className="rounded-(--radius-control) border border-(--color-line) px-3 py-2 text-left transition-colors hover:border-brand-500 hover:bg-brand-50"
              >
                <span className="block text-sm font-medium text-heading">{x.label}</span>
                {x.sub && <span className="block text-[11px] text-(--color-text-muted)">{x.sub}</span>}
              </button>
            ))}
          </div>
        </div>
      );
    default:
      return null;
  }
}