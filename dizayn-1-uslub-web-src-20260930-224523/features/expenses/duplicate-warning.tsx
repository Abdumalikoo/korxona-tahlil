'use client';

import { formatDate, formatTiyin } from '@/lib/format';
import { IconAlert } from '@/components/ui/icons';
import type { Expense } from '@/lib/types';

interface DuplicateWarningProps {
  items: Expense[];
}

/**
 * Bir xil sana, summa va kategoriyali yozuvlar haqida ogohlantiradi.
 *
 * Bu to'siq emas — saqlashga ruxsat beriladi. Bir kunda ikkita
 * bir xil xarajat chindan ham bo'lishi mumkin.
 */
export function DuplicateWarning({ items }: DuplicateWarningProps) {
  if (items.length === 0) return null;

  return (
    <div className="rounded-[--radius-control] border border-[--color-warn] bg-[--color-warn-soft] px-4 py-3">
      <div className="flex items-start gap-2.5">
        <IconAlert className="mt-0.5 size-4 shrink-0 text-[--color-warn]" />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[--color-warn]">
            {items.length === 1
              ? "Shunday yozuv allaqachon bor"
              : `Shunday ${items.length} ta yozuv bor`}
          </p>

          <div className="mt-2 space-y-1">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 text-xs text-[--color-text-muted]"
              >
                <span className="money">{formatDate(item.date)}</span>
                <span>&middot;</span>
                <span className="money">{formatTiyin(item.amountTiyin)}</span>
                <span>&middot;</span>
                <span className="truncate">
                  {item.department?.name ?? 'Umumkorxona'}
                </span>
                {item.createdBy && (
                  <>
                    <span>&middot;</span>
                    <span className="truncate">{item.createdBy.fullName}</span>
                  </>
                )}
              </div>
            ))}
          </div>

          <p className="mt-2 text-xs text-[--color-text-muted]">
            Agar bu boshqa xarajat bo&rsquo;lsa, saqlashda davom eting.
          </p>
        </div>
      </div>
    </div>
  );
}
