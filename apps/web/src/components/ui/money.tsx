import type { Calc } from '@/lib/calc';
import type { TiyinInput } from '@/lib/format';
import { CalcValue } from './calc';
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
  neutral: 'text-(--color-text)',
  income: 'text-(--color-income)',
  expense: 'text-(--color-expense)',
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
  /** «Qanday hisoblandi?» — bosilganda ishlanishi */
  calc?: Calc | null;
}

/**
 * Ozgarish foizini rang bilan korsatadi: "+12,3%" / "-5,1%"
 *
 * Xarajat osgani yashil bolmasligi kerak - shuning uchun
 * positiveIsGood={false} bilan ranglar almashadi.
 */
export function Change({ percent, positiveIsGood = true, className, calc }: ChangeProps) {
  if (percent === null || percent === undefined) {
    const dash = <span className={cn('text-(--color-text-faint)', className)}>-</span>;
    return calc ? <CalcValue calc={calc}>{dash}</CalcValue> : dash;
  }

  const isGood = percent === 0 ? null : percent > 0 === positiveIsGood;

  const color =
    isGood === null
      ? 'text-(--color-text-muted)'
      : isGood
        ? 'text-(--color-income)'
        : 'text-(--color-expense)';

  // O'sish ▲, kamayish ▼ — rang esa yaxshi/yomonligini bildiradi
  const arrow = percent > 0 ? '\u25B2' : percent < 0 ? '\u25BC' : '';

  const body = (
    <span className={cn('money inline-flex items-center gap-0.5 text-sm font-semibold', color, className)}>
      {arrow && <span className="text-[0.7em] leading-none">{arrow}</span>}
      {formatPercent(Math.abs(percent))}
    </span>
  );
  return calc ? <CalcValue calc={calc}>{body}</CalcValue> : body;
}