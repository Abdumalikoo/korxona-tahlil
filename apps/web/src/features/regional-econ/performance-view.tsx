'use client';

import { ExcelButton, Field, FilterBar, GroupTh, NameCell, ReportCard, RTable, SelectBox, StatTiles, STICKY_NAME, STICKY_NO, sum, TableNote, Td, Th, Tr, type StatTile } from '@/components/report/report';
import { NotesList, SubTitle } from '@/components/report/report-extra-b';
import { EmptyNote, LoadingCard } from '@/components/report/report-extra-c';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { type ReactNode, useMemo, useState } from 'react';
import { type Insight, type PerfRow, RANGE_OPTIONS, type RangeMode, reApi, share } from './api';

// ═══════════════════════════════════════════════════════════
// Solishtirma › Hududlar › Hudud natijasi (G): har hudud daromadi, xarajati, natijasi,
// Markaz ulushi bilan tuzatilgan natija, nisbatlar, o'sish, reja, tengdoshlar guruhi.
// Ko'rinish — hisobot uslubida (kartalar, filtrlar qatori, bitta katta jadval).
// ═══════════════════════════════════════════════════════════

type SortKey = 'adjusted' | 'adjustedMargin' | 'revenue' | 'growth' | 'coverage' | 'perHead';

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'adjusted', label: 'Tuzatilgan natija' },
  { value: 'adjustedMargin', label: 'Rentabellik' },
  { value: 'revenue', label: 'Daromad' },
  { value: 'growth', label: "O'sish" },
  { value: 'coverage', label: 'Qoplash' },
  { value: 'perHead', label: '1 xodimga' },
];

const PEER: Record<'A' | 'B' | 'C', { label: string; cls: string }> = {
  A: { label: 'Katta', cls: 'bg-brand-100 text-brand-800' },
  B: { label: "O'rta", cls: 'bg-sky-100 text-sky-800' },
  C: { label: 'Kichik', cls: 'bg-slate-100 text-slate-700' },
};

const tone = (t: string | bigint) => (BigInt(t) < 0n ? 'text-(--color-expense)' : 'text-heading');
const num = (t: string | null) => (t === null ? -Infinity : Number(t));

/** Summa yonidagi kichik foiz: «(12,3%)» */
function Pct({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('ml-1 whitespace-nowrap text-[11px] font-semibold text-(--color-text-muted)', className)}>({children})</span>;
}

export function InsightList({ items }: { items: Insight[] }) {
  if (!items.length) return null;
  const cls = {
    bad: 'border-l-red-500',
    warn: 'border-l-amber-400',
    good: 'border-l-emerald-500',
    info: 'border-l-brand-500',
  };
  const iconCls = {
    bad: 'bg-[#fdecec] text-[#c22f34]',
    warn: 'bg-[#fff3df] text-[#b45309]',
    good: 'bg-[#e3f5ea] text-[#0b7a3b]',
    info: 'bg-brand-50 text-brand-700',
  };
  const icon = { bad: '▼', warn: '!', good: '▲', info: 'i' };
  return (
    <ReportCard title="Avtomatik xulosalar" badge={`${items.length} ta`}>
      <ul className="grid gap-2.5 px-5 pb-5 lg:grid-cols-2">
        {items.map((it, i) => (
          <li key={i} className={cn('flex gap-3 rounded-r-xl border-l-4 bg-[#f8f9fc] px-3.5 py-2.5 text-sm leading-snug text-(--color-text)', cls[it.level])}>
            <span className={cn('mt-px flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold', iconCls[it.level])}>{icon[it.level]}</span>
            <span>{it.text}</span>
          </li>
        ))}
      </ul>
    </ReportCard>
  );
}

export function RangeBar({ mode, onMode }: { mode: RangeMode; onMode: (m: RangeMode) => void }) {
  return <SelectBox value={mode} onChange={onMode} options={RANGE_OPTIONS} />;
}

export function PerformanceView() {
  const { month } = usePeriod();
  const [mode, setMode] = useState<RangeMode>('M');
  const [sort, setSort] = useState<SortKey>('adjusted');
  const [selected, setSelected] = useState<number | null>(null);
  const res = useAsync(() => reApi.performance(month, mode).then((r) => r.data), [month, mode]);
  const d = res.data;

  const rows = useMemo(() => {
    if (!d) return [];
    const key = (r: PerfRow): number => {
      switch (sort) {
        case 'adjusted': return Number(r.adjustedTiyin);
        case 'adjustedMargin': return r.adjustedMargin ?? -Infinity;
        case 'revenue': return Number(r.revenueTiyin);
        case 'growth': return r.revenueGrowth ?? -Infinity;
        case 'coverage': return r.coverage ?? -Infinity;
        case 'perHead': return num(r.revenuePerHeadTiyin);
      }
    };
    return [...d.rows].sort((a, b) => Number(b.hasData) - Number(a.hasData) || key(b) - key(a));
  }, [d, sort]);

  const exportCsv = () => {
    if (!d) return;
    downloadCsv(
      `Hudud-natijasi-${d.range.from}_${d.range.to}.csv`,
      ['Hudud', 'Guruh', 'Daromad', 'Ish haqi', 'Boshqa xarajat', 'Operatsion natija', 'Rentabellik %', 'Markaz ulushi', 'Tuzatilgan natija', 'Tuzatilgan rentabellik %', 'Qoplash', 'Xodimlar', 'Stavkalar', '1 xodimga oyiga', "Daromad o'sishi %", 'Reja', 'Fakt (reja oylari)'],
      d.rows.map((r) => [
        r.name,
        r.peer ? PEER[r.peer].label : '',
        csvSom(r.revenueTiyin),
        csvSom(r.payrollTiyin),
        csvSom(r.opexTiyin),
        csvSom(r.resultTiyin),
        r.margin === null ? '' : (r.margin * 100).toFixed(1).replace('.', ','),
        csvSom(r.allocatedTiyin),
        csvSom(r.adjustedTiyin),
        r.adjustedMargin === null ? '' : (r.adjustedMargin * 100).toFixed(1).replace('.', ','),
        r.coverage === null ? '' : r.coverage.toFixed(2).replace('.', ','),
        r.headcount,
        r.fte,
        r.revenuePerHeadTiyin === null ? '' : csvSom(r.revenuePerHeadTiyin),
        r.revenueGrowth === null ? '' : (r.revenueGrowth * 100).toFixed(1).replace('.', ','),
        r.budget ? csvSom(r.budget.planTiyin) : '',
        r.budget ? csvSom(r.budget.factTiyin) : '',
      ]),
      [],
    );
  };

  // Filtrlar qatori — yuklanayotganda ham ko'rinadi (davrni almashtirish mumkin bo'lsin)
  const filters = (
    <FilterBar>
      <Field label="Davr">
        <RangeBar mode={mode} onMode={setMode} />
      </Field>
      <Field label="Saralash">
        <SelectBox value={sort} onChange={setSort} options={SORTS} />
      </Field>
    </FilterBar>
  );

  if (!d) {
    return (
      <div className="space-y-4">
        {filters}
        <LoadingCard label="Hisoblanmoqda" error={res.error} onRetry={res.reload} />
      </div>
    );
  }

  const active = d.rows.filter((r) => r.hasData);
  const sumT = (f: (r: PerfRow) => string) => active.reduce((s, r) => s + BigInt(f(r)), 0n);
  const rev = sumT((r) => r.revenueTiyin);
  const res0 = sumT((r) => r.resultTiyin);
  const alloc = sumT((r) => r.allocatedTiyin);
  const adj = sumT((r) => r.adjustedTiyin);
  const lossCount = active.filter((r) => BigInt(r.adjustedTiyin) < 0n).length;
  const sel = d.rows.find((r) => r.code === selected) ?? null;

  const tiles: StatTile[] = [
    { label: 'Hududlar daromadi', value: Number(rev), tone: 'green', note: `Korxona daromadining ${share(d.company.regionsRevenueShare)} qismi` },
    { label: 'Operatsion natija', value: Number(res0), signed: true, tone: 'blue', note: `Rentabellik ${share(rev ? Number(res0) / Number(rev) : null)}` },
    { label: 'Markaz ulushi', value: Number(alloc), tone: 'purple', note: 'Markaz xarajatidan hududlarga taqsimlangan' },
    { label: 'Tuzatilgan natija', value: Number(adj), signed: true, tone: adj < 0n ? 'red' : 'cyan', note: lossCount ? `${lossCount} ta hudud zararda` : "Hamma hudud o'zini qoplaydi" },
  ];

  return (
    <div className="space-y-4">
      <StatTiles items={tiles} />
      {filters}
      {d.openPeriods.length > 0 && (
        <p className="rounded-2xl bg-[#fff3df] px-4 py-2.5 text-xs font-medium text-[#b45309]">Yopilmagan oy(lar) bor — Hududchi oyni yopgach raqamlar qat&apos;iylashadi.</p>
      )}
      <ReportCard title="Hudud natijasi: o'z xarajati va Markaz ulushini qoplash" badge={`${d.range.label} · taqqoslash: ${d.range.prevLabel}`} actions={<ExcelButton onClick={exportCsv} />}>
        <RTable minWidth={1320}>
          <thead>
            <tr>
              <Th rowSpan={2} className={cn(STICKY_NO, 'z-[2]')}>
                №
              </Th>
              <Th rowSpan={2} className={cn(STICKY_NAME, 'z-[2] min-w-44 text-left')}>
                Hudud
              </Th>
              <Th rowSpan={2}>Daromad</Th>
              <GroupTh span={2}>Xarajat</GroupTh>
              <GroupTh span={3}>Natija</GroupTh>
              <GroupTh span={4}>Ko&apos;rsatkichlar</GroupTh>
            </tr>
            <tr>
              <Th className="first:border-l">Ish haqi</Th>
              <Th>Boshqa xarajat</Th>
              <Th>Operatsion natija</Th>
              <Th>Markaz ulushi</Th>
              <Th>Tuzatilgan natija</Th>
              <Th title="Daromad ÷ o'z xarajati">Qoplash</Th>
              <Th title="O'rtacha xodimlar / shtat birligi">Xodim</Th>
              <Th title="Oyiga bir xodimga daromad">1 xodimga</Th>
              <Th title="Xarajat rejasi bajarilishi">Reja</Th>
            </tr>
          </thead>
          <tbody>
            <Tr total>
              <Td className={STICKY_NO} />
              <NameCell sub={<span className={d.reconciliation.ok ? 'text-(--color-income)' : 'text-(--color-expense)'}>{d.reconciliation.ok ? '✓ Hududlar + Markaz = korxona (tiyingacha mos)' : `✗ Farq: ${sum(d.reconciliation.diffTiyin)}`}</span>}>
                Korxona jami
              </NameCell>
              <Td className="whitespace-nowrap">{sum(d.company.incomeTiyin)}</Td>
              <Td colSpan={2} className="whitespace-nowrap">
                {sum(d.company.expenseTiyin)}
              </Td>
              <Td colSpan={2} />
              <Td className={cn('whitespace-nowrap', tone(d.company.resultTiyin))}>{sum(d.company.resultTiyin)}</Td>
              <Td colSpan={4} />
            </Tr>
            {rows.map((r, i) => (
              <Tr key={r.code} onClick={() => setSelected(selected === r.code ? null : r.code)} className={cn('align-top', selected === r.code && 'bg-brand-50', !r.hasData && 'opacity-50')}>
                <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                <NameCell
                  drill
                  sub={
                    r.peer ? (
                      <span className={cn('mt-0.5 inline-block whitespace-nowrap rounded px-1.5 py-px text-[10px] font-semibold', PEER[r.peer].cls)} title="Daromad bo'yicha guruh; o'rni — tuzatilgan rentabellik bo'yicha">
                        {PEER[r.peer].label} guruh · {r.peerRank}-o&apos;rin / {r.peerSize}
                      </span>
                    ) : undefined
                  }
                >
                  {r.name}
                </NameCell>
                <Td className="whitespace-nowrap">
                  {sum(r.revenueTiyin)}
                  {r.revenueGrowth !== null && <Pct className={r.revenueGrowth < 0 ? 'text-(--color-expense)' : 'text-(--color-income)'}>{share(r.revenueGrowth, true)}</Pct>}
                </Td>
                <Td className="whitespace-nowrap">
                  {sum(r.payrollTiyin)}
                  <Pct>{share(r.payrollShare)}</Pct>
                </Td>
                <Td className="whitespace-nowrap">
                  {sum(r.opexTiyin)}
                  <Pct>{share(r.opexShare)}</Pct>
                </Td>
                <Td className={cn('whitespace-nowrap font-semibold', tone(r.resultTiyin))}>
                  {sum(r.resultTiyin)}
                  <Pct>{share(r.margin)}</Pct>
                </Td>
                <Td className="whitespace-nowrap text-(--color-text-muted)">{BigInt(r.allocatedTiyin) ? `−${sum(r.allocatedTiyin)}` : '—'}</Td>
                <Td className={cn('whitespace-nowrap font-bold', tone(r.adjustedTiyin))}>
                  {sum(r.adjustedTiyin)}
                  <Pct>{share(r.adjustedMargin)}</Pct>
                </Td>
                <Td className={cn('whitespace-nowrap', r.coverage !== null && r.coverage < 1 && 'text-(--color-expense)')}>{r.coverage === null ? '—' : r.coverage.toFixed(2).replace('.', ',')}</Td>
                <Td className="whitespace-nowrap">
                  {r.headcount || '—'}
                  {r.fte !== r.headcount && r.fte > 0 && <span className="block text-[11px] text-(--color-text-muted)">{r.fte} st.</span>}
                </Td>
                <Td className="whitespace-nowrap">{r.revenuePerHeadTiyin ? sum(r.revenuePerHeadTiyin) : '—'}</Td>
                <Td className="whitespace-nowrap">
                  {r.budget ? (
                    <span className={cn('font-semibold', r.budget.variance !== null && r.budget.variance > 0.1 ? 'text-(--color-expense)' : 'text-heading')} title={`Reja ${sum(r.budget.planTiyin)}, fakt ${sum(r.budget.factTiyin)} (${r.budget.months} oy)`}>
                      {share(r.budget.variance, true)}
                    </span>
                  ) : (
                    <span className="text-(--color-text-faint)">yo&apos;q</span>
                  )}
                </Td>
              </Tr>
            ))}
            <Tr muted>
              <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{rows.length + 1}</Td>
              <NameCell sub="Hududlarga berilgan ulush Markaz xarajatidan chiqarildi" className="font-semibold text-heading">
                Markaz
              </NameCell>
              <Td className="whitespace-nowrap">{sum(d.center.incomeTiyin)}</Td>
              <Td colSpan={2} className="whitespace-nowrap">
                {sum(d.center.expenseTiyin)}
              </Td>
              <Td className={cn('whitespace-nowrap font-semibold', tone(d.center.resultTiyin))}>{sum(d.center.resultTiyin)}</Td>
              <Td className="whitespace-nowrap text-(--color-income)">{BigInt(d.center.allocatedOutTiyin) ? `+${sum(d.center.allocatedOutTiyin)}` : '—'}</Td>
              <Td className={cn('whitespace-nowrap font-bold', tone(d.center.adjustedTiyin))}>{sum(d.center.adjustedTiyin)}</Td>
              <Td colSpan={4} />
            </Tr>
            {d.unassigned && (
              <Tr muted className="bg-[#fff8ec]">
                <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{rows.length + 2}</Td>
                <NameCell sub="Hudud ham, bo'lim ham ko'rsatilmagan yozuvlar" className="font-semibold text-[#b45309]">
                  Biriktirilmagan
                </NameCell>
                <Td className="whitespace-nowrap">{sum(d.unassigned.incomeTiyin)}</Td>
                <Td colSpan={2} className="whitespace-nowrap">
                  {sum(d.unassigned.expenseTiyin)}
                </Td>
                <Td colSpan={2} />
                <Td className={cn('whitespace-nowrap font-bold', tone(d.unassigned.adjustedTiyin))}>{sum(d.unassigned.adjustedTiyin)}</Td>
                <Td colSpan={4} />
              </Tr>
            )}
          </tbody>
        </RTable>
        <TableNote>
          Qatorni bosing — hudud natijasi bosqichma-bosqich ochiladi. Qavsda: daromad yonida — o&apos;sish, xarajat yonida — daromaddagi ulushi, natija yonida — rentabellik. Markaz ulushi
          hudud natijasidan ayriladi (−), Markazga qaytadi (+).
        </TableNote>
      </ReportCard>

      {sel && <RegionBreakdown row={sel} prevLabel={d.range.prevLabel} />}

      <InsightList items={d.insights} />

      <ReportCard title="Qanday hisoblanadi">
        <NotesList notes={[...d.method, `${d.reconciliation.formula}.`]} />
      </ReportCard>
    </div>
  );
}

/** Tanlangan hudud: daromaddan tuzatilgan natijagacha zinapoya va oldingi davr bilan taqqoslash */
function RegionBreakdown({ row, prevLabel }: { row: PerfRow; prevLabel: string }) {
  const steps = [
    { label: 'Daromad', value: BigInt(row.revenueTiyin), kind: 'in' as const },
    { label: 'Ish haqi', value: -BigInt(row.payrollTiyin), kind: 'out' as const },
    { label: 'Boshqa xarajat', value: -BigInt(row.opexTiyin), kind: 'out' as const },
    { label: 'Operatsion natija', value: BigInt(row.resultTiyin), kind: 'total' as const },
    { label: 'Markaz ulushi', value: -BigInt(row.allocatedTiyin), kind: 'out' as const },
    { label: 'Tuzatilgan natija', value: BigInt(row.adjustedTiyin), kind: 'total' as const },
  ];
  const max = steps.reduce((m, s) => (s.value < 0n ? (-s.value > m ? -s.value : m) : s.value > m ? s.value : m), 1n);
  const w = (v: bigint) => `${Math.max(1, Math.round((Number(v < 0n ? -v : v) / Number(max)) * 100))}%`;
  const prevRows = [
    { label: 'Daromad', cur: row.revenueTiyin, prev: row.prev.revenueTiyin, g: row.revenueGrowth, good: 1 },
    { label: 'Xarajat', cur: row.expenseTiyin, prev: row.prev.expenseTiyin, g: row.expenseGrowth, good: -1 },
    { label: 'Operatsion natija', cur: row.resultTiyin, prev: row.prev.resultTiyin, g: row.resultGrowth, good: 1 },
  ];
  return (
    <ReportCard title={`${row.name}: daromaddan natijagacha`} badge={row.peer ? `${PEER[row.peer].label} guruh · ${row.peerRank}-o‘rin / ${row.peerSize}` : undefined}>
      <div className="grid gap-x-4 gap-y-2 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <SubTitle>Zinapoya</SubTitle>
          <div className="space-y-1.5 px-5">
            {steps.map((s) => (
              <div key={s.label} className="grid grid-cols-[140px_1fr_140px] items-center gap-3 text-sm">
                <span className={cn(s.kind === 'total' ? 'font-semibold text-heading' : 'text-(--color-text-muted)')}>{s.label}</span>
                <div className="h-4 rounded bg-(--color-surface-muted)">
                  <div
                    className={cn('h-4 rounded', s.kind === 'in' ? 'bg-emerald-400' : s.kind === 'out' ? 'bg-rose-300' : s.value < 0n ? 'bg-rose-500' : 'bg-brand-500')}
                    style={{ width: w(s.value) }}
                  />
                </div>
                <span className={cn('whitespace-nowrap text-right tabular-nums', s.kind === 'total' && 'font-bold', s.value < 0n && s.kind === 'total' && 'text-(--color-expense)')}>
                  {s.kind === 'out' && s.value !== 0n ? '−' : ''}
                  {sum((s.value < 0n && s.kind === 'out' ? -s.value : s.value).toString())}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <SubTitle>Taqqoslash: {prevLabel}</SubTitle>
          {row.prev.hasData ? (
            <RTable minWidth={380}>
              <thead>
                <tr>
                  <Th className="text-left">Ko&apos;rsatkich</Th>
                  <Th>Oldin</Th>
                  <Th>Hozir</Th>
                  <Th>O&apos;zgarish</Th>
                </tr>
              </thead>
              <tbody>
                {prevRows.map((p) => (
                  <Tr key={p.label}>
                    <NameCell sticky={false}>{p.label}</NameCell>
                    <Td className="whitespace-nowrap">{sum(p.prev)}</Td>
                    <Td className="whitespace-nowrap">{sum(p.cur)}</Td>
                    <Td className={cn('whitespace-nowrap font-semibold', p.g === null ? 'text-(--color-text-faint)' : p.g * p.good >= 0 ? 'text-(--color-income)' : 'text-(--color-expense)')}>{share(p.g, true)}</Td>
                  </Tr>
                ))}
              </tbody>
            </RTable>
          ) : (
            <EmptyNote>Oldingi davr uchun ma&apos;lumot yo&apos;q — o&apos;sish hisoblanmadi.</EmptyNote>
          )}
        </div>
      </div>
      <TableNote>
        Xodimlar: o&apos;rtacha {row.headcount} kishi, {row.fte} shtat birligi
        {row.fteMissing > 0 && ` (${row.fteMissing} tasining stavkasi kiritilmagan — 1 deb olindi)`}. Qoplash Markaz ulushi bilan:{' '}
        {row.coverageFull === null ? '—' : row.coverageFull.toFixed(2).replace('.', ',')}.
      </TableNote>
    </ReportCard>
  );
}
