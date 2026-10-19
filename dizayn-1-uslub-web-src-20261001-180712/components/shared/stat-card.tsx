import { IconChart, IconTrendUp, IconWallet } from '@/components/ui/icons';
import { Change, Money } from '@/components/ui/money';
import type { TiyinInput } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export type TileColor = 'blue' | 'green' | 'orange' | 'purple' | 'red' | 'cyan';

/** Rangli kvadrat belgi foni */
export const TILE_BG: Record<TileColor, string> = {
  blue: 'bg-tile-blue',
  green: 'bg-tile-green',
  orange: 'bg-tile-orange',
  purple: 'bg-tile-purple',
  red: 'bg-tile-red',
  cyan: 'bg-tile-cyan',
};

/** Katta raqam rangi (belgi bilan bir xil) */
export const TILE_TEXT: Record<TileColor, string> = {
  blue: 'text-tile-blue',
  green: 'text-tile-green',
  orange: 'text-tile-orange',
  purple: 'text-tile-purple',
  red: 'text-tile-red',
  cyan: 'text-tile-cyan',
};

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
  /** Belgi rangi (berilmasa — tone bo'yicha: daromad yashil, xarajat qizil, qolgani ko'k) */
  color?: TileColor;
  icon?: ReactNode;
  className?: string;
}

const TONE_COLOR: Record<NonNullable<StatCardProps['tone']>, TileColor> = {
  neutral: 'blue',
  income: 'green',
  expense: 'red',
};

/**
 * Ko'rsatkich kartasi: chapda rangli kvadrat belgi, o'ngda katta summa va nomi,
 * pastda o'tgan davrga nisbatan o'zgarish.
 */
export function StatCard({
  label,
  tiyin,
  changePercent,
  positiveIsGood = true,
  hint,
  tone = 'neutral',
  color,
  icon,
  className,
}: StatCardProps) {
  const tile = color ?? TONE_COLOR[tone];
  const fallbackIcon =
    tone === 'income' ? <IconTrendUp className="size-6" /> : tone === 'expense' ? <IconWallet className="size-6" /> : <IconChart className="size-6" />;

  return (
    <div className={cn('flex items-center gap-4 rounded-(--radius-card) bg-white p-4 shadow-card', className)}>
      <div className={cn('flex size-14 shrink-0 items-center justify-center rounded-xl text-white shadow-md [&_svg]:size-6', TILE_BG[tile])}>
        {icon ?? fallbackIcon}
      </div>

      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-semibold leading-snug text-heading">{label}</p>
        <Money tiyin={tiyin} tone={tone} className="mt-1 block text-lg font-bold leading-tight 2xl:text-xl" />
        {(changePercent !== undefined || hint) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {changePercent !== undefined && <Change percent={changePercent} positiveIsGood={positiveIsGood} />}
            {hint && <span className="text-xs text-(--color-text-muted)">{hint}</span>}
          </div>
        )}
      </div>
    </div>
  );
}