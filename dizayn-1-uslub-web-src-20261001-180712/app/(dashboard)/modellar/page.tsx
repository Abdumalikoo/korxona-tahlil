'use client';

import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { PeriodPicker } from '@/components/shared/period-picker';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Select, type SelectOption } from '@/components/ui/select';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Badge } from '@/components/ui/badge';
import {
  modelingApi,
  monthsBetween,
  PARAM_INPUT,
  type FormulaInfo,
  type FormulaParam,
  type ModelCatalog,
  type RunInput,
} from '@/features/modeling/api';
import { FormulaMath, FormulaSymbols } from '@/features/modeling/formula-math';
import { ResultView } from '@/features/modeling/result-view';
import { currentPeriod, shiftPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';

// ═══════════════════════════════════════════════════════════
// Davr tanlash
// ═══════════════════════════════════════════════════════════

interface Range {
  start: string;
  end: string;
}

const PRESETS: { label: string; months: number | null }[] = [
  { label: "Ma'lumot bor davr", months: null },
  { label: '6 oy', months: 6 },
  { label: '12 oy', months: 12 },
  { label: '24 oy', months: 24 },
];

function RangePicker({
  value,
  onChange,
  dataRange,
}: {
  value: Range;
  onChange: (range: Range) => void;
  dataRange: Range;
}) {
  const applyPreset = (months: number | null) => {
    if (months === null) return onChange(dataRange);
    onChange({ start: shiftPeriod(dataRange.end, -(months - 1)), end: dataRange.end });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <PeriodPicker value={value.start} onChange={(start) => onChange({ ...value, start })} />
      <span className="text-sm text-(--color-text-muted)">—</span>
      <PeriodPicker value={value.end} onChange={(end) => onChange({ ...value, end })} />
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((preset) => (
          <Button key={preset.label} size="sm" variant="ghost" onClick={() => applyPreset(preset.months)}>
            {preset.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Formula ro'yxati
// ═══════════════════════════════════════════════════════════

function FormulaList({
  formulas,
  selected,
  onSelect,
}: {
  formulas: FormulaInfo[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, FormulaInfo[]>();
    for (const formula of formulas) {
      const list = map.get(formula.category) ?? [];
      list.push(formula);
      map.set(formula.category, list);
    }
    return [...map.entries()];
  }, [formulas]);

  return (
    <nav className="space-y-4">
      {groups.map(([category, items]) => (
        <div key={category}>
          <p className="mb-1.5 px-3 text-xs font-medium uppercase tracking-wide text-(--color-text-faint)">
            {category}
          </p>
          <ul className="space-y-0.5">
            {items.map((formula) => (
              <li key={formula.id}>
                <button
                  type="button"
                  onClick={() => onSelect(formula.id)}
                  className={cn(
                    'w-full rounded-(--radius-control) px-3 py-2 text-left text-sm transition-colors',
                    formula.id === selected
                      ? 'bg-brand-50 font-medium text-brand-800'
                      : 'text-(--color-text) hover:bg-(--color-surface-sunken)',
                  )}
                >
                  {formula.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

// ═══════════════════════════════════════════════════════════
// Parametrlar
// ═══════════════════════════════════════════════════════════

function paramOptions(param: FormulaParam, catalog: ModelCatalog): SelectOption[] {
  if (param.kind === 'metric') {
    const allowed = param.options ? new Set(param.options) : null;
    return catalog.metrics
      .filter((metric) => !allowed || allowed.has(metric.key))
      .map((metric) => ({ value: metric.key, label: metric.label }));
  }
  const allowed = param.options ?? catalog.groups.map((group) => group.key);
  return allowed.map((key) => ({
    value: key,
    label: catalog.groups.find((group) => group.key === key)?.label ?? key,
  }));
}

// ═══════════════════════════════════════════════════════════
// Sahifa
// ═══════════════════════════════════════════════════════════

export default function ModellarPage() {
  const catalog = useAsync(() => modelingApi.catalog().then((r) => r.data), []);
  const health = useAsync(() => modelingApi.health().then((r) => r.data), []);

  const [formulaId, setFormulaId] = useState<string>('');
  /** Har formula uchun tanlangan parametrlar: "growth.metric" → "expense_total" */
  const [values, setValues] = useState<Record<string, string>>({});
  const [range, setRange] = useState<Range | null>(null);

  // Ma'lumot bor davr: bazadagi birinchi va oxirgi oy
  const dataRange = useMemo<Range>(() => {
    const end = health.data?.database.last_period ?? currentPeriod();
    const first = health.data?.database.first_period ?? shiftPeriod(end, -11);
    return { start: first <= end ? first : end, end };
  }, [health.data]);

  useEffect(() => {
    if (!range && health.data) setRange(dataRange);
  }, [health.data, dataRange, range]);

  useEffect(() => {
    if (!formulaId && catalog.data?.formulas[0]) setFormulaId(catalog.data.formulas[0].id);
  }, [catalog.data, formulaId]);

  const formula = catalog.data?.formulas.find((item) => item.id === formulaId) ?? null;
  const activeRange = range ?? dataRange;
  const months = monthsBetween(activeRange.start, activeRange.end);

  const paramValue = (param: FormulaParam) => values[`${formulaId}.${param.key}`] ?? param.default;

  const input = useMemo<RunInput | null>(() => {
    if (!formula) return null;
    const body: RunInput = { start: activeRange.start, end: activeRange.end };
    for (const param of formula.params) {
      body[PARAM_INPUT[param.key]] = values[`${formula.id}.${param.key}`] ?? param.default;
    }
    return body;
  }, [formula, activeRange.start, activeRange.end, values]);

  const rangeError =
    activeRange.start > activeRange.end
      ? 'Boshlanish oyi tugash oyidan keyin bo‘lmasligi kerak'
      : formula && months < formula.minPeriods
        ? `Bu formula uchun kamida ${formula.minPeriods} oy tanlang (hozir ${months} oy)`
        : null;

  const run = useAsync(
    () =>
      formula && input && !rangeError && (range || health.data || health.error)
        ? modelingApi.run(formula.id, input).then((r) => r.data)
        : Promise.resolve(null),
    [formula?.id, JSON.stringify(input), rangeError, Boolean(range || health.data || health.error)],
  );

  // ─── Holatlar ───

  if (catalog.loading && !catalog.data) {
    return (
      <>
        <PageHeader title="Modellar" description="Matematik va ekonometrik tahlil" />
        <LoadingState label="Formulalar yuklanmoqda" />
      </>
    );
  }

  if (catalog.error || !catalog.data) {
    return (
      <>
        <PageHeader title="Modellar" description="Matematik va ekonometrik tahlil" />
        <div className="p-6">
          <Card>
            <ErrorState
              message={catalog.error ?? 'Tahlil xizmati javob bermadi'}
              onRetry={() => {
                catalog.reload();
                health.reload();
              }}
            />
          </Card>
        </div>
      </>
    );
  }

  const status = health.data;

  return (
    <>
      <PageHeader
        title="Modellar"
        description="Matematik va ekonometrik tahlil — formulalar korxona ma'lumotlari ustida hisoblanadi"
        actions={
          status ? (
            <Badge tone={status.ok ? 'income' : 'expense'}>
              {status.ok ? `Python ${status.python} · ${status.formulas} formula` : 'Baza bilan aloqa yo‘q'}
            </Badge>
          ) : null
        }
      />

      <div className="grid gap-6 p-6 lg:grid-cols-[15rem_1fr]">
        {/* Chap: formulalar */}
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardBody className="p-3">
              <FormulaList formulas={catalog.data.formulas} selected={formulaId} onSelect={setFormulaId} />
            </CardBody>
          </Card>
        </aside>

        {/* O'ng: formula va natija */}
        <section className="min-w-0 space-y-4">
          {formula && (
            <Card>
              <CardBody className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold text-(--color-text)">{formula.title}</h2>
                      <Badge tone="brand">{formula.category}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-(--color-text-muted)">{formula.description}</p>
                  </div>
                  <Badge>kamida {formula.minPeriods} oy</Badge>
                </div>

                <div className="rounded-(--radius-control) border border-(--color-line) bg-(--color-surface-muted) px-4 py-3 text-(--color-text)">
                  <FormulaMath latex={formula.latex} className="text-lg" />
                </div>

                <FormulaSymbols symbols={formula.symbols} />

                <div className="space-y-3 border-t border-(--color-line) pt-4">
                  {formula.params.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {formula.params.map((param) => (
                        <Select
                          key={param.key}
                          label={param.label}
                          value={paramValue(param)}
                          options={paramOptions(param, catalog.data!)}
                          onChange={(event) =>
                            setValues((prev) => ({ ...prev, [`${formula.id}.${param.key}`]: event.target.value }))
                          }
                        />
                      ))}
                    </div>
                  )}

                  <div>
                    <p className="mb-1.5 text-sm font-medium text-(--color-text)">Davr</p>
                    <RangePicker value={activeRange} onChange={setRange} dataRange={dataRange} />
                    {rangeError && <p className="mt-1.5 text-xs text-(--color-expense)">{rangeError}</p>}
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          {rangeError ? null : run.error ? (
            <Card>
              <ErrorState message={run.error} onRetry={run.reload} />
            </Card>
          ) : run.data ? (
            <ResultView result={run.data.result} tookMs={run.data.tookMs} loading={run.loading} />
          ) : (
            <Card>
              <LoadingState label="Hisoblanmoqda" />
            </Card>
          )}
        </section>
      </div>
    </>
  );
}