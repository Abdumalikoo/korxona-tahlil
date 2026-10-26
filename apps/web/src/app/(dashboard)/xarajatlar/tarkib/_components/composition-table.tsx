'use client';

import {
    CATEGORY_COLORS,
    CATEGORY_LABELS,
    CATEGORY_ORDER,
    sumByCategory,
    type ComponentCategory,
    type CompositionView,
} from '@/features/salary-composition/api';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';

import { Card, CardHeader } from '@/components/ui/card';
import { IconSearch } from '@/components/ui/icons';
import { Money } from '@/components/ui/money';
import { EmptyState } from '@/components/ui/states';
import { Table, TBody, Td, TFoot, Th, THead, Tr } from '@/components/ui/table';
import { RowStateBadge } from './shared';

type Mode = 'groups' | 'components';
type Filter = 'all' | 'problems';
type Sort = 'name' | 'total';

interface Column {
  key: string;
  label: string;
  color?: string;
  negative: boolean;
  /** Qatordagi qiymat (tiyin, belgisi bilan) */
  value: (row: CompositionView['rows'][number], byCategory: Record<ComponentCategory, bigint>) => bigint;
}

/** Saqlangan tarkib — xodimlar jadvali */
export function CompositionTable({
  view,
  onSelect,
}: {
  view: CompositionView;
  onSelect: (pinfl: string) => void;
}) {
  const [mode, setMode] = useState<Mode>('groups');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('name');
  const [query, setQuery] = useState('');

  // ─── Ustunlar: guruhlar yoki komponentlar ───
  const columns: Column[] = useMemo(() => {
    if (mode === 'groups') {
      const present = new Set(view.byCategory.map((c) => c.category));
      return CATEGORY_ORDER.filter((category) => present.has(category)).map((category) => ({
        key: category,
        label: CATEGORY_LABELS[category],
        color: CATEGORY_COLORS[category],
        negative: category === 'JARIMA',
        value: (_row, byCategory) => byCategory[category],
      }));
    }

    const used = new Set(view.byComponent.map((c) => c.code));
    return view.components
      .filter((component) => used.has(component.code))
      .map((component) => ({
        key: component.code,
        label: component.name,
        negative: component.sign < 0,
        value: (row) => {
          const amount = BigInt(row.items[component.code] ?? '0');
          return component.sign < 0 ? -amount : amount;
        },
      }));
  }, [mode, view]);

  // ─── Qatorlar: qidiruv, filtr, saralash ───
  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();

    const list = view.rows
      .filter((row) => (filter === 'problems' ? row.state === 'diff' || row.state === 'not_in_payroll' : true))
      .filter(
        (row) =>
          !text ||
          row.fullName.toLowerCase().includes(text) ||
          row.pinfl.includes(text) ||
          (row.unitName ?? '').toLowerCase().includes(text),
      )
      .map((row) => ({ row, byCategory: sumByCategory(row.items, view.components) }));

    if (sort === 'total') {
      list.sort((a, b) => {
        const diff = BigInt(b.row.totalTiyin) - BigInt(a.row.totalTiyin);
        return diff > 0n ? 1 : diff < 0n ? -1 : 0;
      });
    }
    return list;
  }, [view, filter, query, sort]);

  // ─── Jami qatori ───
  const totals = useMemo(() => {
    const byColumn = columns.map((column) =>
      rows.reduce((sum, item) => sum + column.value(item.row, item.byCategory), 0n),
    );
    const total = rows.reduce((sum, item) => sum + BigInt(item.row.totalTiyin), 0n);
    const payroll = rows.reduce((sum, item) => sum + BigInt(item.row.payrollTiyin ?? '0'), 0n);
    const diff = rows.reduce((sum, item) => sum + BigInt(item.row.diffTiyin ?? '0'), 0n);
    return { byColumn, total, payroll, diff };
  }, [columns, rows]);

  const problems = view.rows.filter((row) => row.state === 'diff' || row.state === 'not_in_payroll').length;

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Xodimlar bo'yicha"
        description="Qatorni bosing — xodimning oylar bo'yicha tarkibi ochiladi"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'groups', label: 'Guruhlar' },
                { value: 'components', label: 'Komponentlar' },
              ]}
            />
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'Hammasi' },
                { value: 'problems', label: `Farqlilar${problems > 0 ? ` (${problems})` : ''}` },
              ]}
            />
            <Segmented
              value={sort}
              onChange={setSort}
              options={[
                { value: 'name', label: 'A–Z' },
                { value: 'total', label: 'Summa ↓' },
              ]}
            />
            <div className="relative">
              <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-(--color-text-faint)" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Ism, PINFL, bo'lim"
                className="h-8 w-52 rounded-(--radius-control) border border-(--color-line-strong) bg-white pl-8 pr-2 text-sm outline-none focus:border-brand-600"
              />
            </div>
          </div>
        }
      />

      {rows.length === 0 ? (
        <EmptyState title="Mos xodim topilmadi" hint="search" />
      ) : (
        <div className="max-h-[70vh] overflow-auto">
          <Table>
            <THead className="sticky top-0 z-10">
              <Tr>
                <Th className="min-w-[16rem]">Xodim</Th>
                <Th align="center" className="w-16">
                  Kun
                </Th>
                {columns.map((column) => (
                  <Th key={column.key} align="right" className="min-w-[8.5rem] whitespace-nowrap normal-case">
                    <span className="inline-flex items-center gap-1.5">
                      {column.color && (
                        <span className="size-2 rounded-full" style={{ backgroundColor: column.color }} />
                      )}
                      {column.label}
                    </span>
                  </Th>
                ))}
                <Th align="right" className="min-w-[9rem]">
                  Jami
                </Th>
                <Th align="right" className="min-w-[9rem]">
                  Soliq hisoboti
                </Th>
                <Th align="right" className="min-w-[8rem]">
                  Farq
                </Th>
                <Th className="w-32">Holat</Th>
              </Tr>
            </THead>

            <TBody>
              {rows.map(({ row, byCategory }) => {
                const hasProblem = row.state === 'diff' || row.state === 'not_in_payroll';
                return (
                  <Tr
                    key={row.pinfl}
                    clickable
                    onClick={() => onSelect(row.pinfl)}
                    className={cn(hasProblem && 'bg-(--color-expense-soft)')}
                  >
                    <Td>
                      <span className="block truncate font-medium">{row.fullName}</span>
                      <span className="text-xs text-(--color-text-muted)">
                        {row.unitName ?? (row.inRegistry ? '' : 'Reestrda yo‘q')}
                        {row.unitName || !row.inRegistry ? ' · ' : ''}
                        <span className="money">{row.pinfl}</span>
                        {row.fromGeneral && <span className="ml-1.5 rounded-full bg-brand-50 px-1.5 py-px text-[10px] font-medium text-brand-700">umumiy tarkibdan</span>}
                      </span>
                    </Td>
                    <Td align="center" className="money text-(--color-text-muted)">
                      {row.workedDays ?? '—'}
                    </Td>
                    {columns.map((column) => {
                      const value = column.value(row, byCategory);
                      return (
                        <Td key={column.key} money>
                          {value === 0n ? (
                            <span className="text-(--color-text-faint)">&mdash;</span>
                          ) : (
                            <Money tiyin={value} tone={value < 0n ? 'expense' : 'neutral'} />
                          )}
                        </Td>
                      );
                    })}
                    <Td money>
                      <Money tiyin={row.totalTiyin} className="font-medium" />
                    </Td>
                    <Td money>
                      {row.payrollTiyin === null ? (
                        <span className="text-(--color-text-faint)">&mdash;</span>
                      ) : (
                        <Money tiyin={row.payrollTiyin} className="text-(--color-text-muted)" />
                      )}
                    </Td>
                    <Td money>
                      {row.diffTiyin === null || !hasProblem ? (
                        <span className="text-(--color-text-faint)">&mdash;</span>
                      ) : (
                        <Money tiyin={row.diffTiyin} tone="expense" className="font-medium" />
                      )}
                    </Td>
                    <Td>
                      <RowStateBadge state={row.state} />
                    </Td>
                  </Tr>
                );
              })}
            </TBody>

            <TFoot>
              <Tr>
                <Td>Jami &middot; {rows.length} xodim</Td>
                <Td />
                {columns.map((column, index) => (
                  <Td key={column.key} money>
                    <Money
                      tiyin={totals.byColumn[index] ?? 0n}
                      tone={(totals.byColumn[index] ?? 0n) < 0n ? 'expense' : 'neutral'}
                    />
                  </Td>
                ))}
                <Td money>
                  <Money tiyin={totals.total} />
                </Td>
                <Td money>
                  <Money tiyin={totals.payroll} />
                </Td>
                <Td money>
                  <Money tiyin={totals.diff} tone={totals.diff === 0n ? 'neutral' : 'expense'} />
                </Td>
                <Td />
              </Tr>
            </TFoot>
          </Table>
        </div>
      )}
    </Card>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-(--radius-control) border border-(--color-line-strong) bg-white p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            'h-7 rounded-[calc(var(--radius-control)-2px)] px-2.5 text-xs font-medium transition-colors',
            value === option.value
              ? 'bg-brand-800 text-white'
              : 'text-(--color-text-muted) hover:text-(--color-text)',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}