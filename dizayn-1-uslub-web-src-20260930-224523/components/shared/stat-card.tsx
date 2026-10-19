import { Change, Money } from '@/components/ui/money';
import type { TiyinInput } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  tiyin: TiyinInput;
  /** O'tgan davrga nisbatan o'zgarish foizi */
  changePercent?: number | null;
  /** O'sish yaxshimi - xarajatda yo'q, daromadda ha */
  positiveIsGood?: boolean;
  /** Qo'shimcha izoh - masalan "127 ta yozuv" */
  hint?: string;
  tone?: 'neutral' | 'income' | 'expense';
  icon?: ReactNode;
  className?: string;
}

export function StatCard({
  label,
  tiyin,
  changePercent,
  positiveIsGood = true,
  hint,
  tone = 'neutral',
  icon,
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        'rounded-[--radius-card] border border-[--color-line] bg-white p-4',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-[--color-text-muted]">
          {label}
        </p>
        {icon && <div className="text-[--color-text-faint]">{icon}</div>}
      </div>

      <div className="mt-2">
        <Money tiyin={tiyin} tone={tone} className="text-xl font-semibold" />
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        {changePercent !== undefined && (
          <Change percent={changePercent} positiveIsGood={positiveIsGood} />
        )}
        {hint && <span className="text-xs text-[--color-text-muted]">{hint}</span>}
      </div>
    </div>
  );
}
