import type { TiyinInput } from '@/lib/format';
import { formatCompact, formatPercent, formatTiyin } from '@/lib/format';
import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'income' | 'expense' | 'auto';

interface MoneyProps {
  tiyin: TiyinInput;
  tone?: Tone;
  compact?: boolean;
  currency?: boolean;
  decimals?: number;
  className?: string;
}

const tones: Record<Exclude<Tone, 'auto'>, string> = {
  neutral: 'text-[--color-text]',
  income: 'text-[--color-income]',
  expense: 'text-[--color-expense]',
};

/**
 * Pul summasini korsatadi.
 *
 * tone="auto" - musbat yashil, manfiy qizil.
 * Foyda korsatkichlarida ishlatiladi.
 */
export function Money({
  tiyin,
  tone = 'neutral',
  compact = false,
  currency = false,
  decimals = 0,
  className,
}: MoneyProps) {
  const value = BigInt(tiyin.toString());

  const resolved: Exclude<Tone, 'auto'> =
    tone === 'auto' ? (value < 0n ? 'expense' : value > 0n ? 'income' : 'neutral') : tone;

  const text = compact ? formatCompact(tiyin) : formatTiyin(tiyin, { decimals, currency });

  return <span className={cn('money', tones[resolved], className)}>{text}</span>;
}

interface ChangeProps {
  /** Foiz ozgarish; null - hisoblab bolmaydi */
  percent: number | null | undefined;
  /**
   * Osish yaxshimi.
   * Daromadda osish yaxshi, xarajatda yomon.
   */
  positiveIsGood?: boolean;
  className?: string;
}

/**
 * Ozgarish foizini rang bilan korsatadi: "+12,3%" / "-5,1%"
 *
 * Xarajat osgani yashil bolmasligi kerak - shuning uchun
 * positiveIsGood={false} bilan ranglar almashadi.
 */
export function Change({ percent, positiveIsGood = true, className }: ChangeProps) {
  if (percent === null || percent === undefined) {
    return <span className={cn('text-[--color-text-faint]', className)}>-</span>;
  }

  const isGood = percent === 0 ? null : percent > 0 === positiveIsGood;

  const color =
    isGood === null
      ? 'text-[--color-text-muted]'
      : isGood
        ? 'text-[--color-income]'
        : 'text-[--color-expense]';

  return (
    <span className={cn('money text-sm', color, className)}>
      {formatPercent(percent, { sign: true })}
    </span>
  );
}
