'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import { ExcelButton, Field, FilterBar, PillTabs, ReportCard, SearchInput, SelectBox, StatTiles } from '@/components/report/report';
import { EmptyNote, PathCrumbs } from '@/components/report/report-extra-b';
import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { formatDate, formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { COMPARE_OPTIONS, KIND_TEXT, LEVEL_HINTS, SECTION_OPTIONS, structureApi, type CompareMode, type SectionFilter, type StructureKind } from './api';
import { Models } from './explorer-models';
import { exportNodes, MonthsView, NodeTable, RecordsTable, SORT_OPTIONS, sortNodes, SplitView, type SortKey } from './explorer-views';
import { NodeCard } from './node-card';
import { Mark } from '@/features/reactions/mark';
import { structureMark, structurePathMark } from '@/features/reactions/filters';
import { toNums } from './stats';

interface Step {
  key: string;
  label: string;
}

type View = 'composition' | 'months' | 'split' | 'analysis';

/**
 * Daromad yoki xarajat tarkibi (hisobot ko'rinishi, grafiklarsiz):
 * tepada — ko'rsatkich kartalari, filtrlar; jadval — o'tgan / joriy / farq / ulush;
 * modda nomini bosib ichiga kiriladi, «Batafsil» — modda kartasi (12 oy jadvali, prognoz, xulosa).
 */
/** fixedView — faqat shu ko'rinish (Chuqur tahlil: «Tahliliy jadvallar»), ko'rinish tanlovi yashiriladi */
export function StructureExplorer({ kind, range, fixedView }: { kind: StructureKind; range: DateRange; fixedView?: View }) {
  const [section, setSection] = useState<SectionFilter>('ALL');
  const [compare, setCompare] = useState<CompareMode>('prev');
  const [steps, setSteps] = useState<Step[]>([]);
  const [view, setView] = useState<View>(fixedView ?? 'composition');
  const [sort, setSort] = useState<SortKey>('amount');
  const [query, setQuery] = useState('');
  const [cardKey, setCardKey] = useState<string | null>(null);
  const text = KIND_TEXT[kind];
  const growthGood = kind === 'income';

  const resetLocal = () => {
    setQuery('');
    setCardKey(null);
  };
  // Bo'lim o'zgarsa — yuqoridan boshlanadi (darajalar ketma-ketligi o'zgaradi)
  const changeSection = (value: SectionFilter) => {
    setSection(value);
    setSteps([]);
    resetLocal();
  };

  const pathKey = steps.map((s) => s.key).join('~');
  const tree = useAsync(
    () => structureApi.tree(kind, range, section, steps.map((s) => s.key), compare).then((r) => r.data),
    [kind, range.from, range.to, section, compare, pathKey],
  );
  const data = tree.data;

  const q = query.trim().toLowerCase();
  const visibleNodes = sortNodes((data?.nodes ?? []).filter((n) => !q || n.label.toLowerCase().includes(q)), sort, sort === 'label' ? 'asc' : 'desc');

  const drill = (node: { key: string; label: string; drillable?: boolean }) => {
    if (node.drillable === false) return;
    setSteps((prev) => [...prev, { key: node.key, label: node.label }]);
    resetLocal();
  };
  const jump = (depth: number) => {
    setSteps((prev) => prev.slice(0, depth));
    resetLocal();
  };

  const nextHint = data?.nextLevel ? LEVEL_HINTS[data.nextLevel] : null;
  const pathText = [text.root, ...steps.map((s) => s.label)].join(' › ');
  const cardNode = cardKey && data ? (data.nodes.find((n) => n.key === cardKey) ?? null) : null;
  // Bo'lim darajasida (Doimiy/Boshqa tugunlari) bu ko'rinish ma'nosiz
  const showSplit = section === 'ALL' && data?.level !== 'section';
  const activeView: View = view === 'split' && !showSplit ? 'composition' : view;

  // So'nggi oy va bir yil oldingi xuddi shu oy
  const trend = data ? toNums(data.totalTrend) : [];
  const lastMonth = trend[trend.length - 1] ?? 0;
  const yearAgoMonth = trend.length >= 13 ? trend[trend.length - 13]! : null;
  const top = data ? [...data.nodes].sort((a, b) => Number(b.amountTiyin) - Number(a.amountTiyin))[0] : undefined;

  const period = data ? `Joriy: ${formatDate(data.range.from)} — ${formatDate(data.range.to)} · ${data.compareLabel}: ${formatDate(data.previousRange.from)} — ${formatDate(data.previousRange.to)}` : undefined;

  return (
    <div className="space-y-4">
      {tree.error ? (
        <Card>
          <ErrorState message={tree.error} onRetry={tree.reload} />
        </Card>
      ) : !data ? (
        <Card>
          <LoadingState label="Tarkib hisoblanmoqda" />
        </Card>
      ) : (
        <div className={cn('space-y-4 transition-opacity', tree.loading && 'opacity-60')}>
          <StatTiles
            compareLabel="Avval"
            items={[
              {
                label: steps.length ? `Jami · ${steps[steps.length - 1]!.label}` : `Jami ${text.word}`,
                value: Number(data.totalTiyin),
                previous: Number(data.previousTotalTiyin),
                growthGood,
                tone: growthGood ? 'green' : 'red',
              },
              {
                label: `So'nggi oy · ${formatPeriod(data.months[data.months.length - 1] ?? '')}`,
                value: lastMonth,
                previous: yearAgoMonth !== null && yearAgoMonth > 0 ? yearAgoMonth : null,
                growthGood,
                tone: 'blue',
                note: yearAgoMonth !== null && yearAgoMonth > 0 ? undefined : "bir yil oldingi oy ma'lumoti yo'q",
              },
              {
                label: "Eng katta modda",
                value: top ? Number(top.amountTiyin) : 0,
                tone: 'purple',
                note: top ? `${top.label} · ${top.sharePercent.toFixed(1).replace('.', ',')}%` : '',
              },
              {
                label: 'Moddalar va yozuvlar',
                value: 0,
                text: `${data.nodes.length} ta modda`,
                tone: 'orange',
                note: `${data.count.toLocaleString('ru-RU')} ta yozuv`,
              },
            ]}
          />

          <FilterBar
            actions={
              <>
                <Mark item={structurePathMark(kind, section, steps, text.root, text.title)} label="Shu darajani belgilash" />
                <ExcelButton onClick={() => exportNodes(kind, data, pathText)} />
              </>
            }
          >
            <Field label="Yozuvlar">
              <SelectBox value={section} options={SECTION_OPTIONS} onChange={changeSection} />
            </Field>
            <Field label="Solishtirish">
              <SelectBox value={compare} options={COMPARE_OPTIONS} onChange={setCompare} />
            </Field>
            <Field label="Tartib">
              <SelectBox value={sort} options={SORT_OPTIONS} onChange={setSort} />
            </Field>
            <Field label={data.levelLabel}>
              <SearchInput value={query} onChange={setQuery} placeholder={`${data.levelLabel} nomi…`} />
            </Field>
          </FilterBar>

          {!data.records && !fixedView && (
            <PillTabs
              value={activeView}
              onChange={setView}
              options={[
                { value: 'composition', label: 'Tarkib', hint: "O'tgan va joriy davr, farq, ulush" },
                { value: 'months', label: 'Oylar kesimida', hint: 'Moddalar × so‘nggi 12 oy' },
                ...(showSplit ? [{ value: 'split' as const, label: 'Doimiy / Boshqa', hint: 'Har modda ichida muntazam va bir martalik qism' }] : []),
                { value: 'analysis', label: 'Tahliliy jadvallar', hint: "O'zgarish omillari, ABC, g'ayrioddiy oylar, prognoz" },
              ]}
            />
          )}

          {data.records ? (
            <>
              <ReportCard title={text.title} badge={period}>
                <PathCrumbs items={[text.root, ...steps.map((s) => s.label)]} onJump={jump} hint="Eng quyi daraja — yozuvlar" />
              </ReportCard>
              <RecordsTable tree={data} pathText={pathText} />
            </>
          ) : activeView === 'analysis' ? (
            <>
              <ReportCard title={text.title} badge={period}>
                <PathCrumbs items={[text.root, ...steps.map((s) => s.label)]} onJump={jump} hint={`${data.levelLabel} darajasi`} />
              </ReportCard>
              <Models kind={kind} tree={data} onOpen={(node) => setCardKey(node.key)} />
            </>
          ) : (
            <ReportCard title={`${data.levelLabel} bo'yicha ${text.word}`} badge={period}>
              <PathCrumbs
                items={[text.root, ...steps.map((s) => s.label)]}
                onJump={jump}
                hint={nextHint ? `Nomni bosing — ichiga kirasiz (${nextHint.toLowerCase()})` : 'Eng quyi daraja'}
              />
              <div className="pt-4">
                {data.nodes.length === 0 ? (
                  <EmptyNote>Bu davrda {text.word} yo&apos;q — davrni yoki yozuvlar turini o&apos;zgartirib ko&apos;ring</EmptyNote>
                ) : activeView === 'months' ? (
                  <MonthsView tree={data} nodes={visibleNodes} onDrill={drill} />
                ) : activeView === 'split' ? (
                  <SplitView tree={data} nodes={visibleNodes} />
                ) : (
                  <NodeTable
                    kind={kind}
                    tree={data}
                    nodes={visibleNodes}
                    onDrill={drill}
                    onOpen={(node) => setCardKey(node.key)}
                    markOf={(node) => structureMark(kind, section, steps, node, text.title)}
                  />
                )}
              </div>
            </ReportCard>
          )}

          <NodeCard
            kind={kind}
            tree={data}
            node={cardNode}
            onClose={() => setCardKey(null)}
            onDrill={(node) => {
              setCardKey(null);
              drill(node);
            }}
          />
        </div>
      )}
    </div>
  );
}
