'use client';

import { IconSpinner } from '@/components/ui/icons';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════
// Ichma-ich jadvallar — yagona ko'rinish: qator chapida [+] / [−] kvadrati; bosilsa qator tagida chapdan surilgan
// alohida panel ochiladi — o'z sarlavhasi, o'z raqamlashi bilan; panel ichidagi qator ham shu tarzda ochiladi.
// Sarlavha rangi pog'onaga qarab: 1 — och ko'k, 2 — och kulrang, 3+ — oq-kulrang.
// ═══════════════════════════════════════════════════════════

/** Ochib-yopish kvadrati: [+] yopiq, [−] ochiq; bolasi yo'q — bo'sh joy (ustun tekis qolsin) */
export function ExpandBox({ open, onClick, loading, hidden, title }: { open: boolean; onClick?: () => void; loading?: boolean; hidden?: boolean; title?: string }) {
  if (hidden) return <span className="inline-block size-[18px] shrink-0" aria-hidden />;
  if (loading) return <IconSpinner className="size-[18px] shrink-0 p-0.5 text-brand-600" />;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      aria-expanded={open}
      title={title ?? (open ? 'Yopish' : 'Ochish')}
      className={cn(
        'inline-flex size-[18px] shrink-0 items-center justify-center rounded-[4px] border text-[13px] font-bold leading-none transition-colors',
        open ? 'border-brand-600 bg-brand-600 text-white hover:bg-brand-700' : 'border-(--color-line-strong) bg-white text-(--color-text-muted) hover:border-brand-400 hover:text-brand-700',
      )}
    >
      {open ? '−' : '+'}
    </button>
  );
}

/** Ichki panel sarlavhasi uslubi (pog'ona bo'yicha) */
export function nestHead(level: number): string {
  return cn(
    'border-b border-(--color-line) px-2 py-2 text-xs font-semibold whitespace-nowrap',
    level <= 1 ? 'bg-[#eef3fb] text-[#3d4b6e]' : level === 2 ? 'bg-[#f2f4f7] text-[#4a5368]' : 'bg-[#f8f9fb] text-[#566079]',
  );
}

/** Ichki panel katagi */
export const NEST_CELL = 'border-b border-(--color-line) px-2 py-2 text-[12.5px] tabular-nums';

/**
 * Qator tagidagi panel: jadvalning butun kengligida (colSpan), chapdan surilgan, chegarali oq quti. Ichiga odatda o'z
 * sarlavhali jadval qo'yiladi.
 */
export function NestedRow({ colSpan, level = 1, children }: { colSpan: number; level?: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="border-b border-(--color-line) bg-[#f7f9fc] p-0">
        <div className={cn('my-2 mr-2 overflow-x-auto rounded-lg border border-(--color-line) bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]', level <= 1 ? 'ml-10' : 'ml-8')}>{children}</div>
      </td>
    </tr>
  );
}
