'use client';

import { CalcValue } from '@/components/ui/calc';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { IconChevronRight } from '@/components/ui/icons';
import { Change, Money } from '@/components/ui/money';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { structureApi, type StructureKind, type StructureNode, type StructureRecord, type StructureTree } from '@/features/structure/api';
import { calcChange, calcDiff, calcDivide, calcRecords, calcShare, Q, type Calc } from '@/lib/calc';
import { formatDate, formatTiyin } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import type { DateRange } from '@/components/shared/date-range-picker';
import { useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Qisqa (rahbar) ko'rinishi — Daromad va Xarajat uchun BITTA qolip.
// Ikkala sahifa aynan bir xil bloklardan iborat, faqat so'zlar va rang farq qiladi:
//   1. To'rtta kartochka: jami, o'tgan teng davrga nisbatan, eng katta modda, o'rtacha yozuv
//   2. «Qanday daromadlar / xarajatlar» — bosilganda ichi ochiladi: tur → joy → aniq yozuvlar
//   3. Eng ko'p o'zgarganlar (o'tgan teng davrga nisbatan, so'mda)
// Grafiklar — faqat To'liq rejimda (Tahlil › Daromad / Xarajat).
// Ma'lumot: /structure/:kind/tree?flat=1 — Daromadlar va Xarajatlar yozuvlaridan.
// ═══════════════════════════════════════════════════════════

interface KindText {
  /** "Daromad" */
  word: string;
  /** "daromad" */
  lower: string;
  /** Ro'yxat sarlavhasi */
  listTitle: string;
  listHint: string;
  /** Birinchi daraja nomi: "Daromad turi" */
  itemWord: string;
  source: string;
  color: string;
  /** O'sish yaxshimi */
  growthGood: boolean;
}

const TEXT: Record<StructureKind, KindText> = {
  income: {
    word: 'Daromad',
    lower: 'daromad',
    listTitle: 'Qanday daromadlar',
    listHint: "Qaysi turdan qancha tushgan. Qatorni bosing — qayerdan kelgani va aniq yozuvlari ochiladi",
    itemWord: 'Daromad turi',
    source: "Daromadlar ro'yxati",
    color: 'var(--color-income)',
    growthGood: true,
  },
  expense: {
    word: 'Xarajat',
    lower: 'xarajat',
    listTitle: 'Qanday xarajatlar',
    listHint: "Nimaga qancha sarflangan. Qatorni bosing — qaysi turlar, qayerda va aniq yozuvlari ochiladi",
    itemWord: "Xarajat yo'nalishi",
    source: "Xarajatlar ro'yxati",
    color: 'var(--color-expense)',
    growthGood: false,
  },
};

/** Ichki darajalarda dastlab nechta qator ko'rinadi */
const CHILD_LIMIT = 8;
const RECORD_LIMIT = 10;
const RECORD_MAX = 50;

function rangeText(r: DateRange): string {
  return `${formatDate(r.from)} — ${formatDate(r.to)}`;
}

function signedMoney(tiyin: number): string {
  return `${tiyin > 0 ? '+' : tiyin < 0 ? '−' : ''}${formatTiyin(Math.abs(tiyin))}`;
}

/** O'zgarish yaxshimi (daromadda o'sish, xarajatda kamayish) */
function goodTone(kind: StructureKind, delta: number): string {
  if (delta === 0) return 'text-(--color-text-muted)';
  return (delta > 0) === TEXT[kind].growthGood ? 'text-(--color-income)' : 'text-(--color-expense)';
}

function loadTree(kind: StructureKind, range: DateRange, path: string[]) {
  return structureApi.tree(kind, range, 'ALL', path, 'prev', true).then((r) => r.data);
}

// ═══════════════════════════════════════════════════════════
// Sahifa
// ═══════════════════════════════════════════════════════════

export function BriefAnalysis({ kind }: { kind: StructureKind }) {
  const { range } = usePeriod();
  const root = useAsync(() => loadTree(kind, range, []), [kind, range.from, range.to]);
  const t = TEXT[kind];

  if (root.loading && !root.data) {
    return (
      <Card>
        <LoadingState />
      </Card>
    );
  }
  if (root.error) {
    return (
      <Card>
        <ErrorState message={root.error} onRetry={root.reload} />
      </Card>
    );
  }
  const tree = root.data;
  if (!tree) return null;

  if (Number(tree.totalTiyin) === 0 && Number(tree.previousTotalTiyin) === 0) {
    return (
      <Card>
        <EmptyState title={`Bu davrda ${t.lower} yo'q`} description="Davrni yuqori paneldagi «Davr» tugmasidan o'zgartiring" />
      </Card>
    );
  }

  return (
    <div className={cn('space-y-4 transition-opacity', root.loading && 'opacity-60')}>
      <Kpis kind={kind} tree={tree} />
      {/* Qisqa rejim: grafiklar yo'q — faqat asosiy moddalar va eng ko'p o'zgarganlar (grafik — To'liq rejimda) */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <ItemsCard kind={kind} tree={tree} />
        </div>
        <div className="lg:col-span-2">
          <DriversCard kind={kind} tree={tree} />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 1. Kartochkalar
// ═══════════════════════════════════════════════════════════

function KpiCard({ label, children, sub, calc }: { label: string; children: React.ReactNode; sub?: React.ReactNode; calc?: Calc | null }) {
  return (
    <div className="rounded-(--radius-card) border border-(--color-line) bg-white p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">{label}</p>
      <div className="mt-2 min-h-8 text-xl font-semibold">{calc ? <CalcValue calc={calc}>{children}</CalcValue> : children}</div>
      {sub && <div className="mt-1 text-xs text-(--color-text-muted)">{sub}</div>}
    </div>
  );
}

function Kpis({ kind, tree }: { kind: StructureKind; tree: StructureTree }) {
  const t = TEXT[kind];
  const total = Number(tree.totalTiyin);
  const previous = Number(tree.previousTotalTiyin);
  const delta = total - previous;
  const nowText = rangeText(tree.range);
  const prevText = rangeText(tree.previousRange);
  const top = [...tree.nodes].sort((a, b) => Number(b.amountTiyin) - Number(a.amountTiyin))[0];

  const totalCalc = calcRecords(`Jami ${t.lower}`, total, tree.count, nowText, t.source);
  const changeCalc = calcChange(`${t.word}: o'zgarish`, Q.money(`Joriy davr (${nowText})`, total, t.source), Q.money(`O'tgan teng davr (${prevText})`, previous, t.source), {
    growthGood: t.growthGood,
  });
  const deltaCalc = calcDiff(`${t.word}: farq`, Q.money('Joriy davr', total), Q.money("O'tgan teng davr", previous), { note: `${nowText} va ${prevText}` });
  const topCalc = top ? calcShare(`«${top.label}» ulushi`, Q.money(top.label, top.amountTiyin, t.source), Q.money(`Jami ${t.lower}`, total)) : null;
  const avgCalc = calcDivide(`O'rtacha bitta yozuv`, Q.money(`Jami ${t.lower}`, total, t.source), Q.count('Yozuvlar soni', tree.count, t.source), 'money', { note: nowText });

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label={`Jami ${t.lower}`} calc={totalCalc} sub={`${tree.count.toLocaleString('ru-RU').replace(/,/g, ' ')} ta yozuv · ${nowText}`}>
        <Money tiyin={tree.totalTiyin} tone={kind} />
      </KpiCard>

      <KpiCard
        label="O'tgan teng davrga nisbatan"
        sub={
          <>
            <CalcValue calc={deltaCalc}>
              <span className={cn('money font-semibold', goodTone(kind, delta))}>{signedMoney(delta)}</span>
            </CalcValue>{' '}
            · avval {formatTiyin(previous)} ({prevText})
          </>
        }
      >
        <Change percent={tree.changePercent} positiveIsGood={t.growthGood} calc={changeCalc} className="text-xl" />
      </KpiCard>

      <KpiCard label={`Eng katta: ${t.itemWord.toLowerCase()}`} calc={topCalc} sub={top ? <Money tiyin={top.amountTiyin} /> : undefined}>
        {top ? (
          <span className="block truncate text-base" title={top.label}>
            {top.label} <span className="money text-sm text-(--color-text-muted)">{top.sharePercent.toFixed(1).replace('.', ',')}%</span>
          </span>
        ) : (
          <span className="text-(--color-text-faint)">—</span>
        )}
      </KpiCard>

      <KpiCard label="O'rtacha bitta yozuv" calc={avgCalc} sub={`Jami ÷ ${tree.count} ta yozuv`}>
        {tree.count > 0 ? <Money tiyin={String(Math.round(total / tree.count))} /> : <span className="text-(--color-text-faint)">—</span>}
      </KpiCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 2. «Qanday daromadlar / xarajatlar» — bosilganda ichi ochiladi
// ═══════════════════════════════════════════════════════════

function ItemsCard({ kind, tree }: { kind: StructureKind; tree: StructureTree }) {
  const t = TEXT[kind];
  const sorted = [...tree.nodes].sort((a, b) => Number(b.amountTiyin) - Number(a.amountTiyin));
  const nodes = sorted.slice(0, ITEMS_LIMIT);
  const rest = sorted.slice(ITEMS_LIMIT);
  const restSum = rest.reduce((s, n) => s + Number(n.amountTiyin), 0);
  return (
    <Card className="overflow-hidden">
      <CardHeader title={t.listTitle} description={t.listHint} />
      <HeadRow />
      {nodes.length === 0 ? (
        <EmptyState title="Bu davrda yozuv yo'q" hint="period" />
      ) : (
        <div className="divide-y divide-(--color-line)">
          {nodes.map((node) => (
            <NodeRow key={node.key} kind={kind} node={node} path={[]} depth={0} parentLabel={`Jami ${t.lower}`} parentTotal={Number(tree.totalTiyin)} />
          ))}
          {rest.length > 0 && (
            <div className="flex items-center justify-between px-4 py-2.5 text-sm text-(--color-text-muted)">
              <span className="pl-7">Yana {rest.length} ta (batafsil — To&apos;liq rejimda)</span>
              <Money tiyin={String(restSum)} />
            </div>
          )}
        </div>
      )}
      <div className="flex items-center justify-between border-t border-(--color-line) bg-(--color-surface-muted) px-4 py-2.5 text-sm font-semibold">
        <span>Jami</span>
        <Money tiyin={tree.totalTiyin} tone={kind} />
      </div>
    </Card>
  );
}

/** Qisqa rejimda ro'yxatda nechta modda ko'rinadi */
const ITEMS_LIMIT = 8;

function HeadRow() {
  return (
    <div className="hidden grid-cols-[1fr_4rem_10rem_6rem] gap-3 border-y border-(--color-line) bg-(--color-surface-muted) px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted) md:grid">
      <span>Nomi</span>
      <span>Ulushi</span>
      <span className="text-right">Summa</span>
      <span className="text-right">O&apos;zgarish</span>
    </div>
  );
}

function NodeRow({
  kind,
  node,
  path,
  depth,
  parentLabel,
  parentTotal,
}: {
  kind: StructureKind;
  node: StructureNode;
  path: string[];
  depth: number;
  parentLabel: string;
  parentTotal: number;
}) {
  const t = TEXT[kind];
  const [open, setOpen] = useState(false);
  const amount = Number(node.amountTiyin);
  const previous = Number(node.previousTiyin);
  const share = parentTotal > 0 ? (amount / parentTotal) * 100 : 0;
  const shareCalc = calcShare(`«${node.label}» ulushi`, Q.money(node.label, amount, t.source), Q.money(parentLabel, parentTotal));
  const changeCalc = calcChange(`«${node.label}»: o'zgarish`, Q.money('Joriy davr', amount, t.source), Q.money("O'tgan teng davr", previous, t.source), {
    growthGood: t.growthGood,
  });

  const label = (
    <span className="flex min-w-0 items-center gap-2" style={{ paddingLeft: depth * 20 }}>
      <span className={cn('flex size-5 shrink-0 items-center justify-center text-(--color-text-muted) transition-transform', open && 'rotate-90', !node.drillable && 'invisible')}>
        <IconChevronRight className="size-4" />
      </span>
      <span className={cn('min-w-0', depth === 0 ? 'font-semibold text-heading' : 'text-(--color-text)')}>
        <span className="block truncate" title={node.label}>
          {node.label}
        </span>
        <span className="block text-[11px] font-normal text-(--color-text-muted)">{node.count} ta yozuv</span>
      </span>
    </span>
  );

  return (
    <>
      <div
        className={cn(
          'grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm md:grid-cols-[1fr_4rem_10rem_6rem]',
          node.drillable && 'cursor-pointer hover:bg-brand-50/60',
          open && 'bg-brand-50/40',
        )}
        onClick={node.drillable ? () => setOpen((v) => !v) : undefined}
        role={node.drillable ? 'button' : undefined}
        aria-expanded={node.drillable ? open : undefined}
      >
        {label}
        <span className="hidden md:block" onClick={(e) => e.stopPropagation()}>
          <CalcValue calc={shareCalc}>
            <span className="money block text-xs text-(--color-text-muted)">{share.toFixed(1).replace('.', ',')}%</span>
          </CalcValue>
        </span>
        <span className="text-right">
          <Money tiyin={node.amountTiyin} className={depth === 0 ? 'font-semibold' : undefined} />
        </span>
        <span className="col-span-2 text-right md:col-span-1" onClick={(e) => e.stopPropagation()}>
          <Change percent={node.changePercent} positiveIsGood={t.growthGood} calc={changeCalc} className="text-xs" />
        </span>
      </div>
      {open && <Children kind={kind} path={[...path, node.key]} depth={depth + 1} parentLabel={node.label} parentTotal={amount} />}
    </>
  );
}

function Children({ kind, path, depth, parentLabel, parentTotal }: { kind: StructureKind; path: string[]; depth: number; parentLabel: string; parentTotal: number }) {
  const { range } = usePeriod();
  const data = useAsync(() => loadTree(kind, range, path), [kind, range.from, range.to, path.join('~')]);
  const [all, setAll] = useState(false);

  if (data.loading && !data.data) {
    return <p className="bg-(--color-surface-muted)/50 px-4 py-2 text-xs text-(--color-text-muted)" style={{ paddingLeft: 16 + depth * 20 + 28 }}>Yuklanmoqda…</p>;
  }
  if (data.error || !data.data) {
    return <p className="px-4 py-2 text-xs text-(--color-expense)" style={{ paddingLeft: 16 + depth * 20 + 28 }}>{data.error ?? "Ma'lumot yo'q"}</p>;
  }
  const tree = data.data;

  // Eng oxirgi daraja — aniq yozuvlar
  if (tree.records) {
    return <Records kind={kind} records={tree.records} total={tree.recordsTotal} depth={depth} levelLabel={tree.levelLabel} />;
  }

  const nodes = [...tree.nodes].sort((a, b) => Number(b.amountTiyin) - Number(a.amountTiyin));
  const shown = all ? nodes : nodes.slice(0, CHILD_LIMIT);
  return (
    <div className="divide-y divide-(--color-line) bg-(--color-surface-muted)/40">
      <p className="px-4 pt-2 text-[11px] font-semibold uppercase tracking-wide text-(--color-text-faint)" style={{ paddingLeft: 16 + depth * 20 + 28 }}>
        {tree.levelLabel} bo&apos;yicha
      </p>
      {shown.map((node) => (
        <NodeRow key={node.key} kind={kind} node={node} path={path} depth={depth} parentLabel={parentLabel} parentTotal={parentTotal} />
      ))}
      {nodes.length > CHILD_LIMIT && (
        <button type="button" onClick={() => setAll((v) => !v)} className="w-full px-4 py-2 text-left text-xs font-semibold text-brand-700 hover:bg-brand-50" style={{ paddingLeft: 16 + depth * 20 + 28 }}>
          {all ? 'Kamroq ko‘rsatish' : `Yana ${nodes.length - CHILD_LIMIT} tasini ko‘rsatish`}
        </button>
      )}
    </div>
  );
}

function Records({ kind, records, total, depth, levelLabel }: { kind: StructureKind; records: StructureRecord[]; total: number; depth: number; levelLabel: string }) {
  const [more, setMore] = useState(false);
  const shown = records.slice(0, more ? RECORD_MAX : RECORD_LIMIT);
  const pad = 16 + depth * 20 + 28;
  return (
    <div className="bg-(--color-surface-muted)/40 py-1">
      <p className="px-4 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-(--color-text-faint)" style={{ paddingLeft: pad }}>
        {levelLabel}: {total} ta, eng kattasidan
      </p>
      <div className="overflow-x-auto" style={{ paddingLeft: pad - 16 }}>
        <table className="w-full min-w-[34rem] text-xs">
          <thead>
            <tr className="text-left text-(--color-text-muted)">
              <th className="px-4 py-1.5 font-medium">Sana</th>
              <th className="px-2 py-1.5 font-medium">Nima</th>
              <th className="px-2 py-1.5 font-medium">{kind === 'income' ? 'Kimdan' : 'Kimga'}</th>
              <th className="px-2 py-1.5 font-medium">Joy</th>
              <th className="px-4 py-1.5 text-right font-medium">Summa</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-(--color-line)">
            {shown.map((r) => (
              <tr key={r.id} className="bg-white/70">
                <td className="money whitespace-nowrap px-4 py-1.5 text-(--color-text-muted)">{formatDate(r.date)}</td>
                <td className="max-w-[16rem] truncate px-2 py-1.5 text-heading" title={r.label}>
                  {r.label}
                </td>
                <td className="max-w-[12rem] truncate px-2 py-1.5" title={r.detail ?? ''}>
                  {r.detail ?? '—'}
                </td>
                <td className="max-w-[10rem] truncate px-2 py-1.5 text-(--color-text-muted)" title={r.place}>
                  {r.place}
                </td>
                <td className="whitespace-nowrap px-4 py-1.5 text-right">
                  <Money tiyin={r.amountTiyin} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {records.length > RECORD_LIMIT && (
        <button type="button" onClick={() => setMore((v) => !v)} className="px-4 py-2 text-xs font-semibold text-brand-700 hover:underline" style={{ paddingLeft: pad }}>
          {more ? 'Kamroq ko‘rsatish' : `Yana ${Math.min(records.length, RECORD_MAX) - RECORD_LIMIT} tasini ko‘rsatish`}
        </button>
      )}
      {more && total > RECORD_MAX && (
        <p className="px-4 pb-2 text-[11px] text-(--color-text-muted)" style={{ paddingLeft: pad }}>
          Qolgan {total - RECORD_MAX} ta yozuv — Manba bo&apos;limidagi ro&apos;yxatda.
        </p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 4. Eng ko'p o'zgarganlar
// ═══════════════════════════════════════════════════════════

function DriversCard({ kind, tree }: { kind: StructureKind; tree: StructureTree }) {
  const t = TEXT[kind];
  const byKey = new Map(tree.nodes.map((n) => [n.key, n]));
  const drivers = (tree.insights?.drivers ?? []).filter((d) => d.key !== 'rest' && Number(d.deltaTiyin) !== 0);
  const up = drivers.filter((d) => Number(d.deltaTiyin) > 0).slice(0, 3);
  const down = drivers.filter((d) => Number(d.deltaTiyin) < 0).slice(0, 3);
  const totalDelta = Number(tree.totalTiyin) - Number(tree.previousTotalTiyin);
  const prevText = rangeText(tree.previousRange);

  const row = (d: { key: string; label: string; deltaTiyin: string }) => {
    const n = byKey.get(d.key);
    const delta = Number(d.deltaTiyin);
    const calc = n
      ? calcDiff(`«${d.label}»: farq`, Q.money('Joriy davr', n.amountTiyin, t.source), Q.money(`O'tgan teng davr (${prevText})`, n.previousTiyin, t.source))
      : null;
    return (
      <li key={d.key} className="flex items-center justify-between gap-3 py-1.5 text-sm">
        <span className="min-w-0 truncate" title={d.label}>
          {d.label}
        </span>
        <span className={cn('money shrink-0 font-semibold', goodTone(kind, delta))}>
          {calc ? <CalcValue calc={calc}>{signedMoney(delta)}</CalcValue> : signedMoney(delta)}
        </span>
      </li>
    );
  };

  return (
    <Card className="h-full">
      <CardHeader title="Eng ko'p o'zgarganlar" description={`O'tgan teng davrga nisbatan (${prevText}), so'mda`} />
      <CardBody className="space-y-4">
        {drivers.length === 0 ? (
          <p className="text-sm text-(--color-text-muted)">O&apos;tgan teng davrga nisbatan o&apos;zgarish yo&apos;q.</p>
        ) : (
          <>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-(--color-text-muted)">▲ Oshganlar</p>
              {up.length ? <ul className="divide-y divide-(--color-line)">{up.map(row)}</ul> : <p className="text-sm text-(--color-text-faint)">Yo&apos;q</p>}
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-(--color-text-muted)">▼ Kamayganlar</p>
              {down.length ? <ul className="divide-y divide-(--color-line)">{down.map(row)}</ul> : <p className="text-sm text-(--color-text-faint)">Yo&apos;q</p>}
            </div>
          </>
        )}
        <div className="flex items-center justify-between rounded-lg bg-(--color-surface-muted) px-3 py-2 text-sm">
          <span className="font-medium">Jami o&apos;zgarish</span>
          <span className={cn('money font-semibold', goodTone(kind, totalDelta))}>{signedMoney(totalDelta)}</span>
        </div>
      </CardBody>
    </Card>
  );
}