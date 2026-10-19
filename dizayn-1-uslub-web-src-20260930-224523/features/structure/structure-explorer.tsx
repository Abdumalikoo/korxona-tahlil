'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import { Card } from '@/components/ui/card';
import { IconChevronRight } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { formatDate, formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';
import {
  changeTone,
  compact,
  KIND_TEXT,
  LEVEL_HINTS,
  pct,
  rampColor,
  som,
  structureApi,
  TONE,
  type CompareMode,
  type SectionFilter,
  type StructureKind,
  type StructureNode,
} from './api';
import { Sparkline, Treemap } from './charts';
import { Models } from './explorer-models';
import {
  CompareView,
  exportNodes,
  MAX_COMPARE,
  MonthsView,
  NodeTable,
  RecordsTable,
  SharesView,
  sortNodes,
  SplitView,
  type SortKey,
} from './explorer-views';
import { NodeCard } from './node-card';
import { Mark } from '@/features/reactions/mark';
import { structureMark, structurePathMark } from '@/features/reactions/filters';
import { CompareToggle, KpiStrip, PanelHeader, SearchBox, SectionToggle, SmallButton, ViewTabs } from './parts';
import { changePct, lastN, toNums } from './stats';

interface Step {
  key: string;
  label: string;
}

type View = 'composition' | 'compare' | 'months' | 'shares' | 'split';

// ═══════════════════════════════════════════════════════════
// Yo'l (breadcrumb) + daraja
// ═══════════════════════════════════════════════════════════

function PathBar({
  root,
  steps,
  levelLabel,
  nextHint,
  onJump,
}: {
  root: string;
  steps: Step[];
  levelLabel?: string;
  nextHint: string | null;
  onJump: (depth: number) => void;
}) {
  const all = [{ key: '__root', label: root }, ...steps];
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <nav className="flex min-w-0 flex-wrap items-center gap-0.5 text-sm" aria-label="Yo'l">
        {all.map((step, i) => {
          const last = i === all.length - 1;
          return (
            <span key={`${step.key}-${i}`} className="inline-flex items-center gap-0.5">
              {i > 0 && <IconChevronRight className="size-3.5 text-[--color-text-faint]" />}
              <button
                type="button"
                disabled={last}
                onClick={() => onJump(i)}
                title={step.label}
                className={cn(
                  'max-w-[16rem] truncate rounded px-1.5 py-0.5',
                  last ? 'font-semibold text-[--color-text]' : 'text-[--color-text-muted] underline-offset-2 hover:text-[--color-text] hover:underline',
                )}
              >
                {step.label}
              </button>
            </span>
          );
        })}
      </nav>
      <div className="flex items-center gap-3">
        {steps.length > 0 && (
          <SmallButton onClick={() => onJump(steps.length - 1)} title="Bir daraja yuqoriga">
            ← Orqaga
          </SmallButton>
        )}
        <p className="text-xs text-[--color-text-muted]">
          Daraja {steps.length + 1}
          {levelLabel ? ` · ${levelLabel}` : ''}
          {nextHint ? ` → keyingisi: ${nextHint.toLowerCase()}` : ' · eng quyi daraja'}
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Asosiy komponent
// ═══════════════════════════════════════════════════════════

/**
 * Daromad yoki xarajat tarkibi:
 * ichma-ich kirish, 5 xil ko'rinish (tarkib, solishtirish, oylar, ulush o'zgarishi, doimiy/boshqa),
 * modda kartasi va tahliliy modellar.
 */
export function StructureExplorer({ kind, range }: { kind: StructureKind; range: DateRange }) {
  const [section, setSection] = useState<SectionFilter>('ALL');
  const [compare, setCompare] = useState<CompareMode>('prev');
  const [steps, setSteps] = useState<Step[]>([]);
  const [view, setView] = useState<View>('composition');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'amount', dir: 'desc' });
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[] | null>(null);
  const [cardKey, setCardKey] = useState<string | null>(null);
  const text = KIND_TEXT[kind];

  const resetLocal = () => {
    setPicked(null);
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

  // Rang — summa bo'yicha o'rin: eng kattasi eng to'q
  const colors = useMemo(() => {
    const map = new Map<string, string>();
    const nodes = data?.nodes ?? [];
    [...nodes]
      .sort((a, b) => Number(b.amountTiyin) - Number(a.amountTiyin))
      .forEach((node, i) => map.set(node.key, rampColor(i, nodes.length)));
    return map;
  }, [data]);

  const visibleNodes = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (data?.nodes ?? []).filter((n) => !q || n.label.toLowerCase().includes(q));
    return sortNodes(list, sort.key, sort.dir);
  }, [data, query, sort]);

  // Solishtirish uchun tanlanganlar: foydalanuvchi tanlamagan bo'lsa — eng katta 3 tasi
  const selected = useMemo(() => {
    const nodes = data?.nodes ?? [];
    if (picked === null) return nodes.slice(0, 3).map((n) => n.key);
    const keys = new Set(nodes.map((n) => n.key));
    return picked.filter((k) => keys.has(k));
  }, [picked, data]);

  const toggle = (key: string) => {
    if (selected.includes(key)) setPicked(selected.filter((k) => k !== key));
    else if (selected.length < MAX_COMPARE) setPicked([...selected, key]);
  };

  const drill = (node: { key: string; label: string; drillable?: boolean }) => {
    if (node.drillable === false) return;
    setSteps((prev) => [...prev, { key: node.key, label: node.label }]);
    resetLocal();
  };
  const jump = (depth: number) => {
    setSteps((prev) => prev.slice(0, depth));
    resetLocal();
  };
  const onSort = (key: SortKey) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'label' ? 'asc' : 'desc' }));

  const nextHint = data?.nextLevel ? LEVEL_HINTS[data.nextLevel] : null;
  const delta = data ? Number(data.totalTiyin) - Number(data.previousTotalTiyin) : 0;
  const pathText = [text.root, ...steps.map((s) => s.label)].join(' › ');
  const cardNode = cardKey && data ? (data.nodes.find((n) => n.key === cardKey) ?? null) : null;
  // Bo'lim darajasida (Doimiy/Boshqa tugunlari) bu ko'rinish ma'nosiz
  const showSplit = section === 'ALL' && data?.level !== 'section';

  const views: { value: View; label: string; hint: string }[] = [
    { value: 'composition', label: 'Tarkib', hint: 'Treemap va jadval' },
    { value: 'compare', label: `Solishtirish (${selected.length})`, hint: 'Tanlangan moddalar 12 oyda bitta grafikda' },
    { value: 'months', label: 'Oylar jadvali', hint: 'Moddalar × 12 oy' },
    { value: 'shares', label: "Ulush o'zgarishi", hint: 'Avvalgi va hozirgi ulush' },
    ...(showSplit ? [{ value: 'split' as const, label: 'Doimiy / Boshqa', hint: 'Har modda ichida muntazam va bir martalik qism' }] : []),
  ];
  const activeView: View = view === 'split' && !showSplit ? 'composition' : view;

  // So'nggi oy va bir yil oldingi xuddi shu oy
  const trend = data ? toNums(data.totalTrend) : [];
  const lastMonth = trend[trend.length - 1] ?? 0;
  const yearAgoMonth = trend.length >= 13 ? trend[trend.length - 13]! : null;

  return (
    <div className="space-y-4">
      <PanelHeader
        title={text.title}
        description={
          data
            ? `${formatDate(data.range.from)} — ${formatDate(data.range.to)} · solishtirish: ${data.compareLabel} (${formatDate(data.previousRange.from)} — ${formatDate(data.previousRange.to)})`
            : 'Tanlangan davr avvalgi davr bilan solishtiriladi'
        }
        actions={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <CompareToggle value={compare} onChange={setCompare} />
            <SectionToggle value={section} onChange={changeSection} />
          </div>
        }
      >
        <PathBar
          root={text.root}
          steps={steps}
          levelLabel={data?.records ? 'Yozuvlar' : data?.levelLabel}
          nextHint={data?.records ? null : nextHint}
          onJump={jump}
        />
      </PanelHeader>

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
          <KpiStrip
            items={[
              {
                label: steps.length ? `Jami · ${steps[steps.length - 1]!.label}` : `Jami ${text.word}`,
                value: som(data.totalTiyin),
                sub: `${data.count.toLocaleString('ru-RU')} ta yozuv`,
              },
              {
                label: data.compareLabel,
                value: som(data.previousTotalTiyin),
                sub: `${formatDate(data.previousRange.from)} — ${formatDate(data.previousRange.to)}`,
              },
              {
                label: "O'zgarish",
                value: pct(data.changePercent, true),
                valueClass: changeTone(kind, data.changePercent),
                sub: `${delta >= 0 ? '+' : ''}${som(delta)}`,
              },
              {
                label: `So'nggi oy · ${formatPeriod(data.months[data.months.length - 1] ?? '')}`,
                value: som(lastMonth),
                sub: (
                  <span className="flex flex-wrap items-center gap-x-2">
                    <Sparkline values={lastN(data.totalTrend, 12)} color={TONE.slate} width={90} height={20} />
                    {yearAgoMonth !== null && yearAgoMonth > 0 ? (
                      <span>
                        bir yil oldin {compact(yearAgoMonth)}{' '}
                        <b className={cn('font-medium', changeTone(kind, changePct(lastMonth, yearAgoMonth)))}>{pct(changePct(lastMonth, yearAgoMonth), true)}</b>
                      </span>
                    ) : (
                      <span>12 oy</span>
                    )}
                  </span>
                ),
              },
            ]}
          />

          {data.records ? (
            <RecordsTable tree={data} pathText={pathText} />
          ) : data.nodes.length === 0 ? (
            <Card>
              <EmptyState title={`Bu davrda ${text.word} yo'q`} description="Davrni yoki bo'limni o'zgartirib ko'ring" />
            </Card>
          ) : (
            <>
              <Card className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold">
                      {data.levelLabel} bo&apos;yicha tarkib · {data.nodes.length} ta
                    </h3>
                    <p className="mt-0.5 text-xs text-[--color-text-muted]">
                      {activeView === 'composition'
                        ? `Blok maydoni — summa ulushi; to'qroq rang — kattaroq summa.${nextHint ? ` Blok yoki nomni bosing — ichiga kirasiz (${nextHint.toLowerCase()}).` : ''} «Batafsil» — modda kartasi.`
                        : "Ko'rinishni yorliqlardan almashtiring. Qidiruv va saralash barcha ko'rinishlarga ta'sir qiladi."}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mark item={structurePathMark(kind, section, steps, text.root, text.title)} label="Shu darajani belgilash" />
                    <SearchBox value={query} onChange={setQuery} placeholder={`${data.levelLabel} nomi bo'yicha…`} />
                    <SmallButton onClick={() => exportNodes(kind, data, pathText)} title="Joriy darajani Excel'da ochiladigan CSV faylga yuklab olish">
                      Excel (CSV)
                    </SmallButton>
                  </div>
                </div>
                <ViewTabs value={activeView} options={views} onChange={setView} />

                {activeView === 'composition' && (
                  <>
                    <div className="px-5 py-4">
                      <Treemap
                        items={visibleNodes.map((node) => ({
                          key: node.key,
                          label: node.label,
                          value: Number(node.amountTiyin),
                          sharePercent: node.sharePercent,
                          color: colors.get(node.key) ?? TONE.rest,
                          drillable: node.drillable,
                        }))}
                        onSelect={(key) => {
                          const node = data.nodes.find((n) => n.key === key);
                          if (node) drill(node);
                        }}
                      />
                    </div>
                    <NodeTable
                      kind={kind}
                      tree={data}
                      nodes={visibleNodes}
                      colors={colors}
                      sort={sort}
                      onSort={onSort}
                      selected={selected}
                      onToggle={toggle}
                      onDrill={drill}
                      onOpen={(node) => setCardKey(node.key)}
                      markOf={(node) => structureMark(kind, section, steps, node, text.title)}
                    />
                    <p className="border-t border-[--color-line] px-5 py-2.5 text-xs text-[--color-text-muted]">
                      Chapdagi belgi — moddani «Solishtirish» yorlig&apos;iga qo&apos;shadi (5 tagacha). Ustun sarlavhasini bosing — jadval shu ustun bo&apos;yicha saralanadi.
                    </p>
                  </>
                )}
                {activeView === 'compare' && (
                  <CompareView kind={kind} tree={data} selected={selected} onToggle={toggle} onOpen={(node: StructureNode) => setCardKey(node.key)} />
                )}
                {activeView === 'months' && <MonthsView tree={data} nodes={visibleNodes} onDrill={drill} />}
                {activeView === 'shares' && <SharesView tree={data} nodes={visibleNodes} />}
                {activeView === 'split' && <SplitView tree={data} nodes={visibleNodes} />}
              </Card>

              <Models kind={kind} tree={data} onOpen={(node) => setCardKey(node.key)} />
            </>
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