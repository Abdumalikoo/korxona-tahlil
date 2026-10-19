'use client';

import {
    CATEGORY_COLORS,
    type CategoryTotal,
    type CheckPerson,
    type CheckSummary,
    type ComponentTotal,
    type RowState,
} from '@/features/salary-composition/api';
import { formatPercent, formatTiyin } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { IconAlert, IconCheck, IconChevronDown } from '@/components/ui/icons';
import { Money } from '@/components/ui/money';

// ═══════════════════════════════════════════════════════════
// Yig'indi kartochkasi
// ═══════════════════════════════════════════════════════════

export function SummaryBox({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'income' | 'expense' | 'warn';
}) {
  const colors = {
    neutral: 'text-(--color-text)',
    income: 'text-(--color-income)',
    expense: 'text-(--color-expense)',
    warn: 'text-(--color-warn)',
  };

  return (
    <div className="rounded-(--radius-card) border border-(--color-line) bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">
        {label}
      </p>
      <p className={cn('money mt-2 text-xl font-semibold', colors[tone])}>{value}</p>
      {hint && <p className="mt-1 text-xs text-(--color-text-muted)">{hint}</p>}
    </div>
  );
}

/** Tarkib va soliq hisoboti bo'yicha 4 ta asosiy raqam */
export function CheckSummaryBoxes({ check }: { check: CheckSummary }) {
  const diff = BigInt(check.diffTiyin);
  const hasDiff = check.payrollUploaded && (diff > 100n || diff < -100n);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <SummaryBox label="Xodimlar" value={String(check.employees)} />
      <SummaryBox label="Tarkib jami" value={formatTiyin(check.compositionTiyin)} />
      <SummaryBox
        label="Soliq hisoboti"
        value={check.payrollUploaded ? formatTiyin(check.payrollTiyin) : '—'}
        hint={check.payrollUploaded ? undefined : 'Bu oy uchun yuklanmagan'}
        tone={check.payrollUploaded ? 'neutral' : 'warn'}
      />
      <SummaryBox
        label="Farq"
        value={check.payrollUploaded ? formatTiyin(check.diffTiyin) : '—'}
        tone={!check.payrollUploaded ? 'neutral' : hasDiff ? 'expense' : 'income'}
        hint={
          check.payrollUploaded
            ? check.mismatchCount > 0
              ? `${check.mismatchCount} ta xodimda farq`
              : 'Har bir xodim mos'
            : undefined
        }
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Holat banneri
// ═══════════════════════════════════════════════════════════

export function StatusBanner({ check }: { check: CheckSummary }) {
  const config = {
    MATCHED: {
      box: 'border-(--color-income) bg-(--color-income-soft)',
      text: 'text-(--color-income)',
      title: 'Tarkib soliq hisobotiga to‘liq mos',
      description: `${check.employees} xodimning har birida komponentlar yig'indisi soliq hisobotidagi summaga teng`,
      icon: 'check' as const,
    },
    MISMATCH: {
      box: 'border-(--color-expense) bg-(--color-expense-soft)',
      text: 'text-(--color-expense)',
      title: `Tarkib soliq hisobotiga mos emas — ${check.mismatchCount} ta farq`,
      description: 'Rasmiy summa soliq hisobotidan olinadi. Farqlar ro‘yxati quyida',
      icon: 'alert' as const,
    },
    NO_PAYROLL: {
      box: 'border-(--color-warn) bg-(--color-warn-soft)',
      text: 'text-(--color-warn)',
      title: 'Bu oy uchun soliq hisoboti (Ish haqi) yuklanmagan',
      description: 'Tarkib saqlangan, lekin solishtirib bo‘lmaydi. Avval Ish haqi bo‘limida yuklang',
      icon: 'alert' as const,
    },
    NOT_UPLOADED: {
      box: 'border-(--color-line-strong) bg-(--color-surface-muted)',
      text: 'text-(--color-text-muted)',
      title: 'Bu oy uchun ish haqi tarkibi yuklanmagan',
      description: check.payrollUploaded
        ? 'Soliq hisoboti bor. Shablonni yuklab oling, to‘ldiring va shu yerga yuklang'
        : 'Shablonni yuklab oling, to‘ldiring va shu yerga yuklang',
      icon: 'alert' as const,
    },
  }[check.state];

  return (
    <div className={cn('rounded-(--radius-card) border px-4 py-3', config.box)}>
      <div className="flex items-start gap-2.5">
        {config.icon === 'check' ? (
          <IconCheck className={cn('mt-0.5 size-4 shrink-0', config.text)} />
        ) : (
          <IconAlert className={cn('mt-0.5 size-4 shrink-0', config.text)} />
        )}
        <div className="min-w-0">
          <p className={cn('text-sm font-medium', config.text)}>{config.title}</p>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">{config.description}</p>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Qator holati belgisi
// ═══════════════════════════════════════════════════════════

export function RowStateBadge({ state }: { state: RowState }) {
  const map: Record<RowState, { label: string; tone: 'income' | 'expense' | 'warn' | 'neutral' }> = {
    ok: { label: 'Mos', tone: 'income' },
    diff: { label: 'Farq', tone: 'expense' },
    not_in_payroll: { label: 'Soliqda yo‘q', tone: 'expense' },
    no_payroll: { label: 'Tekshirilmagan', tone: 'neutral' },
  };
  const config = map[state];
  return <Badge tone={config.tone}>{config.label}</Badge>;
}

// ═══════════════════════════════════════════════════════════
// Tarkib tuzilishi (guruhlar va komponentlar)
// ═══════════════════════════════════════════════════════════

export function StructureCard({
  byCategory,
  byComponent,
  description,
}: {
  byCategory: CategoryTotal[];
  byComponent: ComponentTotal[];
  description?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);

  const positive = byCategory.filter((c) => BigInt(c.totalTiyin) > 0n);

  return (
    <Card className="overflow-hidden">
      <CardHeader title="Ish haqi tarkibi" description={description ?? 'Guruhlar bo‘yicha'} />

      <CardBody className="space-y-4">
        {/* Ulushlar chizig'i */}
        {positive.length > 0 && (
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-(--color-surface-sunken)">
            {positive.map((category) => (
              <div
                key={category.category}
                title={`${category.label}: ${formatPercent(category.sharePercent)}`}
                style={{
                  width: `${category.sharePercent ?? 0}%`,
                  backgroundColor: CATEGORY_COLORS[category.category],
                }}
              />
            ))}
          </div>
        )}

        {/* Guruhlar ro'yxati */}
        <div className="divide-y divide-(--color-line) rounded-(--radius-control) border border-(--color-line)">
          {byCategory.map((category) => {
            const items = byComponent.filter((c) => c.category === category.category);
            const expanded = open === category.category;

            return (
              <div key={category.category}>
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : category.category)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-(--color-surface-muted)"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: CATEGORY_COLORS[category.category] }}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {category.label}
                  </span>
                  <span className="w-16 shrink-0 text-right text-xs text-(--color-text-muted)">
                    {formatPercent(category.sharePercent)}
                  </span>
                  <span className="w-40 shrink-0 text-right">
                    <Money
                      tiyin={category.totalTiyin}
                      tone={BigInt(category.totalTiyin) < 0n ? 'expense' : 'neutral'}
                    />
                  </span>
                  <IconChevronDown
                    className={cn(
                      'size-4 shrink-0 text-(--color-text-faint) transition-transform',
                      expanded && 'rotate-180',
                    )}
                  />
                </button>

                {expanded && (
                  <div className="bg-(--color-surface-muted) px-4 py-2">
                    {items.map((item) => (
                      <div
                        key={item.code}
                        className="flex items-center gap-3 py-1.5 pl-5 text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate text-(--color-text-muted)">
                          {item.name}
                        </span>
                        <span className="w-24 shrink-0 text-right text-xs text-(--color-text-muted)">
                          {item.employees} xodim
                        </span>
                        <span className="w-40 shrink-0 text-right">
                          <Money
                            tiyin={item.totalTiyin}
                            tone={item.sign < 0 ? 'expense' : 'neutral'}
                          />
                        </span>
                        <span className="w-4 shrink-0" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════
// Farqlar ro'yxati
// ═══════════════════════════════════════════════════════════

export function CheckLists({ check }: { check: CheckSummary }) {
  const blocks: { key: string; title: string; description: string; people: CheckPerson[] }[] = [
    {
      key: 'mismatches',
      title: 'Summasi farq qiladi',
      description: 'Komponentlar yig‘indisi soliq hisobotidagi summaga teng emas',
      people: check.mismatches,
    },
    {
      key: 'missing',
      title: 'Tarkibda yo‘q',
      description: 'Soliq hisobotida ish haqi bor, tarkib faylida bu xodim yo‘q',
      people: check.missingInComposition,
    },
    {
      key: 'extra',
      title: 'Soliq hisobotida yo‘q',
      description: 'Tarkibda summa bor, soliq hisobotida bu xodim yo‘q',
      people: check.notInPayroll,
    },
  ].filter((block) => block.people.length > 0);

  if (blocks.length === 0) return null;

  return (
    <div className="space-y-4">
      {blocks.map((block) => (
        <PeopleBlock
          key={block.key}
          title={block.title}
          description={block.description}
          people={block.people}
        />
      ))}
    </div>
  );
}

function PeopleBlock({
  title,
  description,
  people,
}: {
  title: string;
  description: string;
  people: CheckPerson[];
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? people : people.slice(0, 8);

  return (
    <Card className="overflow-hidden">
      <CardHeader title={`${title} — ${people.length} ta`} description={description} />

      <div className="divide-y divide-(--color-line)">
        <div className="flex items-center gap-3 bg-(--color-surface-muted) px-4 py-2 text-xs font-semibold uppercase tracking-wide text-(--color-text-muted)">
          <span className="min-w-0 flex-1">Xodim</span>
          <span className="w-36 shrink-0 text-right">Tarkib</span>
          <span className="w-36 shrink-0 text-right">Soliq hisoboti</span>
          <span className="w-32 shrink-0 text-right">Farq</span>
        </div>

        {visible.map((person) => (
          <div key={person.pinfl} className="flex items-center gap-3 px-4 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{person.fullName}</span>
              <span className="money text-xs text-(--color-text-muted)">{person.pinfl}</span>
            </span>
            <span className="w-36 shrink-0 text-right">
              <Money tiyin={person.compositionTiyin} />
            </span>
            <span className="w-36 shrink-0 text-right">
              <Money tiyin={person.payrollTiyin} />
            </span>
            <span className="w-32 shrink-0 text-right">
              <Money tiyin={person.diffTiyin} tone="expense" className="font-medium" />
            </span>
          </div>
        ))}
      </div>

      {people.length > 8 && (
        <div className="border-t border-(--color-line) px-4 py-2 text-center">
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            className="text-xs font-medium text-brand-700 hover:underline"
          >
            {showAll ? 'Qisqartirish' : `Hammasini ko‘rsatish (${people.length})`}
          </button>
        </div>
      )}
    </Card>
  );
}
