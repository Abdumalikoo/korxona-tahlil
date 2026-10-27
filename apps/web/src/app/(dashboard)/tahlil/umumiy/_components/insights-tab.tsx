'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import { changeOf, DiffCell, MoneyCell, NameCell, PctCell, ReportCard, RTable, StatTiles, TableNote, Td, Th, Tr } from '@/components/report/report';
import { EmptyNote, NotesList, pctPlain, ppText, StatusBadge, SubTitle } from '@/components/report/report-extra-b';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { econApi } from '@/features/econ/api';
import { regionsApi, statsOf } from '@/features/regions/api';
import { structureApi, type StructureNode } from '@/features/structure/api';
import { flowFigures, flowNotes } from '@/features/structure/structure-overview';
import { formatDate } from '@/lib/format';
import { useAsOf } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import type { ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════
// Xulosa — bir sahifada eng muhim raqamlar va tizim chiqargan xulosalar.
// Faqat haqiqiy ma'lumot: pul oqimi, daromad/xarajat tarkibi, hududlar va samaradorlik
// API'laridan qaytgan raqamlar va izohlar. O'zidan hech narsa to'qilmaydi.
// ═══════════════════════════════════════════════════════════

const cap = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

export function InsightsTab({ range }: { range: DateRange }) {
  const asOf = useAsOf();
  const flow = useAsync(() => structureApi.flow(range, 'ALL', 'prev').then((r) => r.data), [range.from, range.to]);
  const income = useAsync(() => structureApi.tree('income', range, 'ALL', [], 'prev', true).then((r) => r.data), [range.from, range.to]);
  const expense = useAsync(() => structureApi.tree('expense', range, 'ALL', [], 'prev', true).then((r) => r.data), [range.from, range.to]);
  const regions = useAsync(() => regionsApi.compare(range, 'ALL', 'prev').then((r) => r.data), [range.from, range.to]);
  const efficiency = useAsync(() => econApi.efficiency('12', 'resources', asOf).then((r) => r.data), [asOf]);

  const f = flow.data;
  if (flow.error) {
    return (
      <ReportCard title="Xulosa">
        <ErrorState message={flow.error} onRetry={flow.reload} />
      </ReportCard>
    );
  }
  if (!f) {
    return (
      <ReportCard title="Xulosa">
        <LoadingState label="Xulosa tayyorlanmoqda" />
      </ReportCard>
    );
  }

  const d = flowFigures(f);
  const previousProfit = Number(f.previousProfitTiyin);
  const marginDelta = f.marginPercent !== null && f.previousMarginPercent !== null ? f.marginPercent - f.previousMarginPercent : null;

  // Hududlar: foyda, Markaz xarajati, qoplash
  const r = regions.data;
  const units = r ? r.units.map(statsOf) : [];
  const reg = units.filter((s) => s.unit.kind === 'region');
  const active = reg.filter((s) => s.income !== 0 || s.expense !== 0);
  const rProfit = reg.reduce((a, s) => a + s.profit, 0);
  const rPrevProfit = reg.reduce((a, s) => a + s.previousProfit, 0);
  const center = units.find((s) => s.unit.kind === 'center') ?? null;
  const centerNet = center ? center.expense - center.income : 0;
  const coverage = centerNet > 0 ? (rProfit / centerNet) * 100 : null;

  // Eng katta o'zgarishlar: daromad turlari va xarajat guruhlari
  const movers = [
    ...(income.data?.nodes ?? []).map((n) => ({ n, side: 'Daromad' as const })),
    ...(expense.data?.nodes ?? []).map((n) => ({ n, side: 'Xarajat' as const })),
  ]
    .map((x) => ({ ...x, d: Number(x.n.amountTiyin) - Number(x.n.previousTiyin) }))
    .filter((x) => x.d !== 0)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, 10);

  const sections: { title: string; notes: string[]; state: ReactNode }[] = [
    { title: 'Umumiy natija', notes: flowNotes(f), state: null },
    { title: 'Daromad tarkibi', notes: income.data?.insights?.notes ?? [], state: sectionState(income.loading && !income.data, income.error) },
    { title: 'Xarajat tarkibi', notes: expense.data?.insights?.notes ?? [], state: sectionState(expense.loading && !expense.data, expense.error) },
    { title: 'Hududlar', notes: r?.notes ?? [], state: sectionState(regions.loading && !r, regions.error) },
    { title: 'Samaradorlik (12 oy)', notes: efficiency.data ? [...efficiency.data.notes, ...efficiency.data.warnings] : [], state: sectionState(efficiency.loading && !efficiency.data, efficiency.error) },
  ];

  const period = `Joriy: ${formatDate(f.range.from)} — ${formatDate(f.range.to)} · ${f.compareLabel}: ${formatDate(f.previousRange.from)} — ${formatDate(f.previousRange.to)}`;

  return (
    <div className="space-y-4">
      <StatTiles
        compareLabel="Avval"
        items={[
          { label: 'Daromad', value: d.income, previous: d.prevIncome, tone: 'green' },
          { label: 'Xarajat', value: d.expense, previous: d.prevExpense, growthGood: false, tone: 'red' },
          { label: d.profit >= 0 ? 'Sof foyda' : 'Zarar', value: d.profit, previous: previousProfit, signed: true, tone: 'blue' },
          { label: 'Rentabellik', value: 0, text: pctPlain(f.marginPercent), tone: 'purple', note: `avval ${pctPlain(f.previousMarginPercent)} · ${ppText(marginDelta)}` },
        ]}
      />

      <ReportCard title="Asosiy ko'rsatkichlar" badge={period}>
        <RTable minWidth={860}>
          <thead>
            <tr>
              <Th className="min-w-64 text-left">Ko&apos;rsatkich</Th>
              <Th>{cap(f.compareLabel)}</Th>
              <Th>Joriy davr</Th>
              <Th>Farqi, foizda</Th>
            </tr>
          </thead>
          <tbody>
            <Tr>
              <NameCell sticky={false}>Daromad</NameCell>
              <MoneyCell value={d.prevIncome} />
              <MoneyCell value={d.income} strong />
              <DiffCell value={d.income - d.prevIncome} pct={changeOf(d.income, d.prevIncome)} />
            </Tr>
            <Tr>
              <NameCell sticky={false}>Xarajat</NameCell>
              <MoneyCell value={d.prevExpense} />
              <MoneyCell value={d.expense} strong />
              <DiffCell value={d.expense - d.prevExpense} pct={changeOf(d.expense, d.prevExpense)} growthGood={false} />
            </Tr>
            <Tr total>
              <NameCell sticky={false}>{d.profit >= 0 ? 'Sof foyda' : 'Zarar'}</NameCell>
              <MoneyCell value={previousProfit} signedColor />
              <MoneyCell value={d.profit} signedColor />
              <DiffCell value={d.profit - previousProfit} />
            </Tr>
            <Tr>
              <NameCell sticky={false} sub="foyda ÷ daromad">
                Rentabellik
              </NameCell>
              <Td>{pctPlain(f.previousMarginPercent)}</Td>
              <Td className="font-semibold">{pctPlain(f.marginPercent)}</Td>
              <Td className="font-semibold">{ppText(marginDelta)}</Td>
            </Tr>
            <Tr>
              <NameCell sticky={false} sub="100 dan yuqori — zarar">
                100 so&apos;m daromadga xarajat
              </NameCell>
              <Td>{d.prevRatio === null ? '' : `${Math.round(d.prevRatio)} so'm`}</Td>
              <Td className="font-semibold">{d.ratio === null ? '' : `${Math.round(d.ratio)} so'm`}</Td>
              <PctCell value={d.ratio !== null && d.prevRatio !== null ? changeOf(d.ratio, d.prevRatio) : null} growthGood={false} />
            </Tr>
            <Tr>
              <NameCell sticky={false} sub="doimiy daromad ÷ doimiy xarajat">
                Doimiy qoplash
              </NameCell>
              <Td>{pctPlain(d.prevCoverage)}</Td>
              <Td className="font-semibold">{pctPlain(d.coverage)}</Td>
              <Td className="font-semibold">{d.coverage !== null && d.prevCoverage !== null ? ppText(d.coverage - d.prevCoverage) : ''}</Td>
            </Tr>
            {r && (
              <>
                <Tr>
                  <NameCell sticky={false} sub={`${active.length} ta faol hudud`}>
                    Hududlar foydasi
                  </NameCell>
                  <MoneyCell value={rPrevProfit} signedColor />
                  <MoneyCell value={rProfit} signedColor strong />
                  <DiffCell value={rProfit - rPrevProfit} />
                </Tr>
                {center && (
                  <Tr>
                    <NameCell sticky={false}>Markaz xarajati</NameCell>
                    <MoneyCell value={center.previousExpense} />
                    <MoneyCell value={center.expense} strong />
                    <DiffCell value={center.expense - center.previousExpense} pct={changeOf(center.expense, center.previousExpense)} growthGood={false} />
                  </Tr>
                )}
                <Tr>
                  <NameCell sticky={false} sub="hududlar foydasi ÷ Markaz sof xarajati">
                    Markazni qoplash
                  </NameCell>
                  <Td className="text-(--color-text-faint)"></Td>
                  <Td>{coverage === null ? '' : <StatusBadge tone={coverage >= 100 ? 'green' : 'red'}>{pctPlain(coverage)}</StatusBadge>}</Td>
                  <Td className="text-(--color-text-faint)"></Td>
                </Tr>
                <Tr>
                  <NameCell sticky={false}>Foydada ishlayotgan hududlar</NameCell>
                  <Td>{`${reg.filter((s) => s.previousProfit > 0).length} / ${reg.filter((s) => s.previousIncome !== 0 || s.previousExpense !== 0).length}`}</Td>
                  <Td className="font-semibold">{`${active.filter((s) => s.profit > 0).length} / ${active.length}`}</Td>
                  <Td />
                </Tr>
              </>
            )}
          </tbody>
        </RTable>
      </ReportCard>

      <ReportCard title="Eng katta o'zgarishlar" badge="daromad turlari va xarajat guruhlari — so'mda eng ko'p o'zgarganlari">
        {income.loading && expense.loading && movers.length === 0 ? (
          <LoadingState />
        ) : movers.length === 0 ? (
          <EmptyNote>O&apos;zgarish yo&apos;q</EmptyNote>
        ) : (
          <RTable minWidth={900}>
            <thead>
              <tr>
                <Th className="w-12">№</Th>
                <Th className="min-w-64 text-left">Modda</Th>
                <Th>Turi</Th>
                <Th>{cap(f.compareLabel)}</Th>
                <Th>Joriy davr</Th>
                <Th>Farqi, foizda</Th>
              </tr>
            </thead>
            <tbody>
              {movers.map(({ n, side, d: delta }, i) => (
                <MoverRow key={`${side}-${n.key}`} index={i + 1} node={n} side={side} delta={delta} />
              ))}
            </tbody>
          </RTable>
        )}
        <TableNote>Daromadda o&apos;sish — yashil, xarajatda o&apos;sish — qizil. Batafsil — «Daromad tarkibi» va «Xarajat tarkibi» yorliqlarida.</TableNote>
      </ReportCard>

      <ReportCard title="Xulosalar" badge="tizim hisoblagan raqamlardan">
        {sections.map((s) => (
          <div key={s.title} className="border-t border-(--color-line) pt-3 first:border-t-0 first:pt-0">
            <SubTitle>{s.title}</SubTitle>
            {s.state ?? (s.notes.length > 0 ? <NotesList notes={s.notes} /> : <EmptyNote>Bu bo&apos;lim bo&apos;yicha xulosa yo&apos;q</EmptyNote>)}
          </div>
        ))}
      </ReportCard>
    </div>
  );
}

function sectionState(loading: boolean, error: string | null): ReactNode {
  if (error) return <p className="px-5 pb-4 text-sm text-(--color-expense)">{error}</p>;
  if (loading) return <p className="px-5 pb-4 text-sm text-(--color-text-muted)">Yuklanmoqda…</p>;
  return null;
}

function MoverRow({ index, node, side, delta }: { index: number; node: StructureNode; side: 'Daromad' | 'Xarajat'; delta: number }) {
  const income = side === 'Daromad';
  const previous = Number(node.previousTiyin);
  return (
    <Tr>
      <Td className="text-(--color-text-faint)">{index}</Td>
      <NameCell sticky={false}>{node.label}</NameCell>
      <Td>
        <StatusBadge tone={income ? 'green' : 'red'}>{side}</StatusBadge>
      </Td>
      <MoneyCell value={previous} />
      <MoneyCell value={Number(node.amountTiyin)} strong />
      <DiffCell value={delta} pct={previous === 0 ? null : changeOf(Number(node.amountTiyin), previous)} growthGood={income} />
    </Tr>
  );
}
