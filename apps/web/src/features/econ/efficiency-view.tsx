'use client';

import { useAsOf } from '@/lib/period';
import { CalcValue } from '@/components/ui/calc';
import { calcDivide, calcSum, Q } from '@/lib/calc';
import { breakevenCalc, efficiencyCalc, potentialCalc, roiCalc } from './calcs';
import { Card } from '@/components/ui/card';
import { ExcelButton, Field, FilterBar, GroupTh, MoneyCell, NameCell, ReportCard, RTable, SelectBox, StatTiles, STICKY_NAME, STICKY_NO, sum, TableNote, Td, Th, Tr } from '@/components/report/report';
import { NotesList, StatusBadge } from '@/components/report/report-extra-b';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Mark } from '@/features/reactions/mark';
import { compact, pct } from '@/features/structure/api';
import { Findings, KpiStrip, ModelCard, PanelHeader, Segmented, SmallButton } from '@/features/structure/parts';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useState } from 'react';
import { econApi, incomeMark, type BreakevenUnit, type EfficiencyMode, type EfficiencyUnit } from './api';
import { BreakevenChart, MarginBar } from './efficiency-charts';

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)';
type Window = '3' | '6' | '12' | '24' | 'all';

const WINDOWS: { value: Window; label: string }[] = [
  { value: '3', label: '3 oy' },
  { value: '6', label: '6 oy' },
  { value: '12', label: '12 oy' },
  { value: '24', label: '24 oy' },
  { value: 'all', label: 'Hammasi' },
];

const EFF_STATUS: Record<EfficiencyUnit['status'], string> = {
  frontier: 'Chegarada',
  near: 'Yaqin (90%+)',
  mid: "O'rtacha (70–90%)",
  low: 'Orqada (70% dan past)',
};

const pctOf = (v: number) => `${Math.round(v * 100)}%`;

function periodText(from: string | null, to: string | null, months: number): string {
  return from && to ? `${formatPeriod(from)} – ${formatPeriod(to)} (${months} oy)` : `${months} oy`;
}

// ═══════════════════════════════════════════════════════════
// Samaradorlik chegarasi (DEA)
// ═══════════════════════════════════════════════════════════

const EFF_TONE: Record<EfficiencyUnit['status'], 'green' | 'blue' | 'amber' | 'red'> = {
  frontier: 'green',
  near: 'blue',
  mid: 'amber',
  low: 'red',
};

export function EfficiencyView({ showModelsLink = false }: { showModelsLink?: boolean }) {
  const [win, setWin] = useState<Window>('12');
  const [mode, setMode] = useState<EfficiencyMode>('resources');
  const [selected, setSelected] = useState<string | null>(null);
  /** Umumiy «Davr» oyi: o'tgan oy bo'lsa — o'sha oy oxiridagi holat */
  const asOf = useAsOf();
  const result = useAsync(() => econApi.efficiency(win, mode, asOf).then((r) => r.data), [win, mode, asOf]);
  const data = result.data;

  const units = data?.units ?? [];
  const exportCsv = () =>
    data &&
    downloadCsv(
      `samaradorlik-${data.mode}`,
      ['#', 'Hudud', 'Samaradorlik %', 'Hajm hisobga olingan %', 'Miqyos %', 'Daromad (oy)', 'Xarajat (oy)', 'Xodimlar', 'Bir xodimga daromad', 'Daromad/xarajat', 'Imkoniyat (oy)', 'Namuna'],
      units.map((u) => [
        u.rank,
        u.name,
        Math.round(u.crs * 1000) / 10,
        Math.round(u.vrs * 1000) / 10,
        Math.round(u.scale * 1000) / 10,
        csvSom(u.incomeTiyin),
        csvSom(u.expenseTiyin),
        u.headcount,
        u.incomePerHeadTiyin === null ? null : csvSom(u.incomePerHeadTiyin),
        u.roi === null ? null : Math.round(u.roi * 100) / 100,
        csvSom(u.gapTiyin),
        u.peers.map((p) => p.name).join(', '),
      ]),
    );

  const filters = (
    <FilterBar
      actions={
        <>
          {showModelsLink && (
            <Link href="/katta-modellar" className="text-sm font-semibold text-brand-700 hover:underline">
              Katta modellar →
            </Link>
          )}
          {data && units.length > 0 && <ExcelButton onClick={exportCsv} />}
        </>
      }
    >
      <Field label="Davr">
        <SelectBox value={win} options={WINDOWS} onChange={setWin} />
      </Field>
      <Field label="Resurslar">
        <SelectBox
          value={mode}
          onChange={setMode}
          options={[
            { value: 'resources', label: 'Xodimlar + xarajat' },
            { value: 'money', label: "Faqat so'm (ish haqi va xarajat)" },
          ]}
        />
      </Field>
    </FilterBar>
  );

  if (result.error) {
    return (
      <div className="space-y-4">
        {filters}
        <Card>
          <ErrorState message={result.error} onRetry={result.reload} />
        </Card>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-4">
        {filters}
        <Card>
          <LoadingState label="Samaradorlik hisoblanmoqda" />
        </Card>
      </div>
    );
  }
  if (units.length === 0) {
    return (
      <div className="space-y-4">
        {filters}
        <ReportCard title="Samaradorlik">
          <NotesList notes={[...data.notes, ...data.warnings]} />
        </ReportCard>
      </div>
    );
  }

  const avg = units.reduce((s, u) => s + u.crs, 0) / units.length;
  const gap = units.reduce((s, u) => s + Number(u.gapTiyin), 0);
  const income = units.reduce((s, u) => s + Number(u.incomeTiyin), 0);
  const expense = units.reduce((s, u) => s + Number(u.expenseTiyin), 0);
  const heads = units.reduce((s, u) => s + u.headcount, 0);
  const worst = units[units.length - 1]!;
  const current = units.find((u) => u.key === selected) ?? null;
  const period = periodText(data.periodFrom, data.periodTo, data.months);

  return (
    <div className="space-y-4">
      <StatTiles
        items={[
          { label: 'Chegarada (namuna)', value: 0, text: `${data.frontier.length} ta hudud`, tone: 'green', note: data.frontier.join(', ') || '' },
          { label: "O'rtacha samaradorlik", value: 0, text: pctOf(avg), tone: 'blue', note: `${units.length} ta hudud bo'yicha` },
          { label: 'Eng orqada', value: 0, text: worst.name, tone: 'red', note: `${pctOf(worst.crs)} — chegaradan ${pctOf(1 - worst.crs)} past`, onClick: () => setSelected(worst.key) },
          {
            label: "Yashirin imkoniyat (oyiga)",
            value: gap,
            tone: 'orange',
            calc: calcSum('Yashirin imkoniyat', units.map((u) => Q.money(u.name, u.gapTiyin)), { note: 'Har hudud farqi = Daromad ÷ Samaradorlik − Daromad' }),
            note: `hozirgi oylik daromad ${sum(income)} so'm`,
          },
        ]}
      />

      {filters}

      <ReportCard title="Hududlar samaradorligi (oylik o'rtacha)" badge={`${period} · resurslar: ${data.inputs.join(', ').toLowerCase()}`}>
        <RTable minWidth={1120}>
          <thead>
            <tr>
              <Th rowSpan={2} className={cn(STICKY_NO, 'z-[2]')}>№</Th>
              <Th rowSpan={2} className={cn(STICKY_NAME, 'z-[2] min-w-36 text-left')}>Hudud</Th>
              <Th rowSpan={2}>Samaradorlik</Th>
              <GroupTh span={4}>Oylik o&apos;rtacha</GroupTh>
              <Th rowSpan={2}>Daromad ÷ xarajat</Th>
              <GroupTh span={2}>Imkoniyat</GroupTh>
            </tr>
            <tr>
              <Th className="first:border-l">Daromad</Th>
              <Th>Xarajat</Th>
              <Th>Xodimlar</Th>
              <Th>1 xodimga daromad</Th>
              <Th>Qo&apos;shimcha daromad</Th>
              <Th className="min-w-44">Namuna hududlar</Th>
            </tr>
          </thead>
          <tbody>
            <Tr total>
              <Td className={STICKY_NO} />
              <NameCell>Jami · {units.length} ta hudud</NameCell>
              <Td>{pctOf(avg)}</Td>
              <MoneyCell value={income} />
              <MoneyCell value={expense} />
              <Td>{Math.round(heads)}</Td>
              <MoneyCell value={heads > 0 ? income / heads : 0} />
              <Td>{expense > 0 ? (income / expense).toFixed(2).replace('.', ',') : ''}</Td>
              <MoneyCell value={gap} className="text-(--color-income)" />
              <Td />
            </Tr>
            {units.map((u) => (
              <Tr key={u.key} onClick={() => setSelected(selected === u.key ? null : u.key)} className={cn(selected === u.key && 'bg-brand-50!')}>
                <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{u.rank}</Td>
                <NameCell drill before={<Mark item={incomeMark(u, 'Samaradorlik')} />} sub={EFF_STATUS[u.status]}>
                  {u.name}
                </NameCell>
                <Td>
                  <CalcValue calc={efficiencyCalc(u)} className="no-underline">
                    <StatusBadge tone={EFF_TONE[u.status]}>{pctOf(u.crs)}</StatusBadge>
                  </CalcValue>
                </Td>
                <MoneyCell value={Number(u.incomeTiyin)} strong />
                <MoneyCell value={Number(u.expenseTiyin)} />
                <Td>{u.headcount.toFixed(u.headcount % 1 ? 1 : 0).replace('.', ',')}</Td>
                {u.incomePerHeadTiyin && u.headcount > 0 ? (
                  <MoneyCell
                    value={Number(u.incomePerHeadTiyin)}
                    calc={calcDivide(`${u.name}: bir xodimga daromad`, Q.money('Oylik daromad', u.incomeTiyin), { label: 'Xodimlar', value: u.headcount, kind: 'ratio' }, 'money', { formulaId: 'perHead' })}
                  />
                ) : (
                  <Td></Td>
                )}
                <Td>{u.roi === null ? '' : <CalcValue calc={roiCalc(u)} className="no-underline">{u.roi.toFixed(2).replace('.', ',')}</CalcValue>}</Td>
                {Number(u.gapTiyin) > 0 ? <MoneyCell value={Number(u.gapTiyin)} calc={potentialCalc(u)} className="font-semibold text-(--color-income)" /> : <Td className="text-(--color-text-faint)"></Td>}
                <Td className="max-w-56 truncate text-left text-xs text-(--color-text-muted)" title={u.peers.map((p) => p.name).join(', ')}>
                  {u.status === 'frontier' ? "o'zi namuna" : u.peers.map((p) => p.name).join(', ')}
                </Td>
              </Tr>
            ))}
          </tbody>
        </RTable>
        {current && (
          <div className="mx-4 mb-4 rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-3 text-sm leading-relaxed">
            <p className="font-semibold text-heading">
              {current.rank}-o&apos;rin · {current.name}: {pctOf(current.crs)} ({EFF_STATUS[current.status].toLowerCase()})
            </p>
            <p className="mt-1">
              {current.status === 'frontier'
                ? "Bu hudud samaradorlik chegarasida — boshqalar uchun namuna. Uning ish uslubini (mijozlar bilan ishlash, xarajat nazorati) boshqa hududlarga o'tkazish foydali."
                : `Namuna hududlar: ${current.peers.map((p) => p.name).join(', ')}. Ular kabi ishlaganda ${current.name} hozirgi resurslar bilan oyiga ~${compact(current.potentialIncomeTiyin)} so'm daromad olardi (hozir ${compact(current.incomeTiyin)}).`}
            </p>
          </div>
        )}
        <TableNote>
          Samaradorlik — DEA usuli: hududlar faqat bir-biri bilan solishtiriladi. 100% — chegarada (eng yaxshilar qatorida); 80% — shu daromadni resurslarning 80% i bilan olish mumkin edi.
          «Qo&apos;shimcha daromad» — namuna hududlar kabi ishlaganda olinadigan oylik daromad (yuqori chegara). Qatorni bosing — izoh.
        </TableNote>
      </ReportCard>

      {(data.notes.length > 0 || data.warnings.length > 0) && (
        <ReportCard title="Samaradorlik xulosasi">
          <NotesList notes={[...data.notes, ...data.warnings]} />
        </ReportCard>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Zararsizlik nuqtasi
// ═══════════════════════════════════════════════════════════

const BE_STATUS: Record<BreakevenUnit['status'], { label: string; tone: string }> = {
  safe: { label: 'Xavfsiz', tone: 'bg-(--color-income-soft) text-(--color-income)' },
  thin: { label: 'Chegarada', tone: 'bg-amber-100 text-amber-800' },
  loss: { label: 'Zararda', tone: 'bg-(--color-expense-soft) text-(--color-expense)' },
  na: { label: '', tone: 'bg-(--color-surface-sunken) text-(--color-text-muted)' },
};

export function BreakevenView() {
  const [win, setWin] = useState<Window>('12');
  const [selected, setSelected] = useState('all');
  /** Umumiy «Davr» oyi: o'tgan oy bo'lsa — o'sha oy oxiridagi holat */
  const asOf = useAsOf();
  const result = useAsync(() => econApi.breakeven(win, asOf).then((r) => r.data), [win, asOf]);
  const data = result.data;

  const header = (
    <PanelHeader title="Zararsizlik nuqtasi" description="Har bir hudud va korxona zararsiz ishlashi uchun oyiga qancha daromad kerak va hozir qancha zaxira bor">
      <span className="flex items-center gap-2">
        <span className="text-xs text-(--color-text-muted)">Davr:</span>
        <Segmented value={win} options={WINDOWS.filter((w) => w.value !== '3')} onChange={setWin} size="sm" />
      </span>
    </PanelHeader>
  );

  if (result.error) {
    return (
      <div className="space-y-4">
        {header}
        <Card>
          <ErrorState message={result.error} onRetry={result.reload} />
        </Card>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-4">
        {header}
        <Card>
          <LoadingState label="Zararsizlik hisoblanmoqda" />
        </Card>
      </div>
    );
  }

  const total = data.units.find((u) => u.kind === 'total');
  const regions = data.units.filter((u) => u.kind === 'region');
  const center = data.units.find((u) => u.kind === 'center');
  const unit = data.units.find((u) => u.key === selected) ?? total ?? data.units[0];
  const losing = regions.filter((u) => u.status === 'loss').length;
  const thin = regions.filter((u) => u.status === 'thin').length;

  return (
    <div className="space-y-4">
      {header}

      <KpiStrip
        items={[
          {
            label: 'Korxona zararsizligi',
            value: total?.breakevenTiyin ? compact(total.breakevenTiyin) : '',
            calc: total ? breakevenCalc(total) : null,
            sub: total ? `oyiga; o'rtacha daromad ${compact(total.avgIncomeTiyin)}` : undefined,
          },
          {
            label: 'Xavfsizlik zaxirasi',
            value: total?.safetyMargin != null ? pct(total.safetyMargin * 100, true) : '',
            calc: total ? breakevenCalc(total) : null,
            valueClass: total?.safetyMargin != null ? (total.safetyMargin < 0 ? 'text-(--color-expense)' : total.safetyMargin < 0.1 ? 'text-amber-700' : 'text-(--color-income)') : undefined,
            sub: "daromad shuncha tushsa ham zarar yo'q",
          },
          {
            label: 'Zararda / chegarada',
            value: `${losing} / ${thin}`,
            valueClass: losing ? 'text-(--color-expense)' : undefined,
            sub: `${regions.length} ta hududdan`,
          },
          {
            label: 'Markazni qoplash',
            value: data.center?.coverage != null ? pct(data.center.coverage * 100) : '',
            calc: data.center
              ? calcDivide('Markazni qoplash', Q.money('Hududlar foydasi (oyiga)', data.center.regionsProfitTiyin), Q.money('Markaz sof xarajati (oyiga)', data.center.netExpenseTiyin), 'pct', {
                  note: "100% va undan yuqori — hududlar foydasi Markaz xarajatini to'liq qoplaydi.",
                })
              : null,
            valueClass: data.center?.coverage != null && data.center.coverage < 1 ? 'text-(--color-expense)' : undefined,
            sub: data.center ? `Markaz ${compact(data.center.netExpenseTiyin)} / oy, hududlar foydasi ${compact(data.center.regionsProfitTiyin)}` : undefined,
          },
        ]}
      />

      <Findings title="Zararsizlik xulosasi" notes={data.notes} />

      <div className="grid gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <ModelCard
            index={1}
            title={`Zararsizlik grafigi — ${unit?.name ?? ''}`}
            question="Qaysi daromad darajasida xarajat qoplanadi?"
            howTo="Yashil chiziq — daromad, qizil — xarajat (doimiy qism + daromadga bog'liq qism). Kesishgan joy — zararsizlik nuqtasi: undan o'ngda foyda (yashil soha), chapda zarar. Nuqtalar — haqiqiy oylar. Ko'k uzuq chiziq — o'rtacha oylik daromad."
            aside={
              <select
                value={unit?.key ?? 'all'}
                onChange={(e) => setSelected(e.target.value)}
                className="h-7 rounded-(--radius-control) border border-(--color-line) bg-white px-1.5 text-xs outline-none"
              >
                {data.units
                  .filter((u) => u.kind !== 'center')
                  .map((u) => (
                    <option key={u.key} value={u.key}>
                      {u.name}
                    </option>
                  ))}
              </select>
            }
          >
            {unit && unit.status !== 'na' ? (
              <>
                <BreakevenChart unit={unit} />
                <p className="mt-2 text-sm leading-relaxed">{unit.text}</p>
              </>
            ) : (
              <p className="text-sm text-(--color-text-muted)">{unit?.text}</p>
            )}
          </ModelCard>
        </div>
        <div className="xl:col-span-2">
          <Card className="h-full">
            <div className="border-b border-(--color-line) px-5 py-3.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-faint)">Markaz</p>
              <h3 className="mt-0.5 text-sm font-semibold">Markaz xarajatini kim qoplaydi</h3>
            </div>
            <div className="space-y-3 px-5 py-4 text-sm">
              {data.center ? (
                <>
                  <p>
                    Markazning o&apos;z daromadi yo&apos;q: uning oylik sof xarajati (<b>{compact(data.center.netExpenseTiyin)}</b>) hududlar foydasidan qoplanishi kerak.
                  </p>
                  <div>
                    <div className="flex justify-between text-xs text-(--color-text-muted)">
                      <span>Hududlarning oylik foydasi</span>
                      <span className="font-semibold tabular-nums text-(--color-text)">{compact(data.center.regionsProfitTiyin)}</span>
                    </div>
                    <div className="relative mt-1.5 h-3 bg-(--color-surface-sunken)">
                      <div
                        className={cn('h-full', (data.center.coverage ?? 0) >= 1 ? 'bg-(--color-income)' : 'bg-(--color-expense)')}
                        style={{ width: `${Math.min(100, Math.max(0, ((data.center.coverage ?? 0) / Math.max(1, data.center.coverage ?? 1)) * 100))}%` }}
                      />
                      <span
                        className="absolute inset-y-[-3px] w-0.5 bg-(--color-text)"
                        style={{ left: `${Math.min(100, (1 / Math.max(1, data.center.coverage ?? 1)) * 100)}%` }}
                        title="Markaz xarajati"
                      />
                    </div>
                    <p className="mt-1 text-xs text-(--color-text-muted)">
                      Qora chiziq — Markaz xarajati. {data.center.coverage != null && data.center.coverage >= 1 ? "Hududlar foydasi uni to'liq qoplaydi." : 'Hududlar foydasi yetmayapti.'}
                    </p>
                  </div>
                  {center && <p className="text-xs text-(--color-text-muted)">{center.text}</p>}
                </>
              ) : (
                <p className="text-(--color-text-muted)">Markaz ma&apos;lumoti yo&apos;q.</p>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5">
          <div>
            <h3 className="text-sm font-semibold">Hududlar bo&apos;yicha zararsizlik (oylik)</h3>
            <p className="mt-0.5 text-xs text-(--color-text-muted)">{periodText(data.periodFrom, data.periodTo, data.months)}. Qatorni bosing — grafik shu hududga o&apos;tadi.</p>
          </div>
          <SmallButton
            onClick={() =>
              downloadCsv(
                'zararsizlik',
                ['Hudud', "O'rtacha daromad", "O'rtacha xarajat", 'Doimiy xarajat', "O'zgaruvchan ulush %", 'Zararsizlik daromadi', 'Zaxira %', 'Leverej', 'Holat', 'Usul'],
                data.units.map((u) => [
                  u.name,
                  csvSom(u.avgIncomeTiyin),
                  csvSom(u.avgExpenseTiyin),
                  u.fixedTiyin === null ? null : csvSom(u.fixedTiyin),
                  u.variableRate === null ? null : Math.round(u.variableRate * 1000) / 10,
                  u.breakevenTiyin === null ? null : csvSom(u.breakevenTiyin),
                  u.safetyMargin === null ? null : Math.round(u.safetyMargin * 1000) / 10,
                  u.leverage === null ? null : Math.round(u.leverage * 10) / 10,
                  BE_STATUS[u.status].label,
                  u.method === 'regression' ? 'regressiya' : u.method === 'fixed' ? 'hammasi doimiy' : '',
                ]),
              )
            }
          >
            CSV yuklab olish
          </SmallButton>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y border-(--color-line) bg-(--color-surface-muted)">
              <tr>
                <th className={cn(TH, 'pl-5 text-left')}>Hudud</th>
                <th className={cn(TH, 'text-right')}>O&apos;rtacha daromad</th>
                <th className={cn(TH, 'text-right')}>O&apos;rtacha xarajat</th>
                <th className={cn(TH, 'text-right')}>Zararsizlik</th>
                <th className={cn(TH, 'text-left')}>Zaxira</th>
                <th className={cn(TH, 'text-right')}>Leverej</th>
                <th className={cn(TH, 'pr-5 text-right')}>Holat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--color-line)">
              {data.units
                .filter((u) => u.kind !== 'center')
                .map((u) => (
                  <tr
                    key={u.key}
                    onClick={() => setSelected(u.key)}
                    className={cn('cursor-pointer hover:bg-(--color-surface-muted)', u.kind === 'total' && 'font-medium', unit?.key === u.key && 'bg-(--color-surface-muted)')}
                    title={u.text}
                  >
                    <td className="py-2.5 pl-5 pr-3">
                      <span className="flex items-center gap-2">
                        {u.kind === 'region' && <Mark item={incomeMark(u, 'Zararsizlik')} />}
                        {u.name}
                        {u.method === 'fixed' && <span className="text-[10px] text-(--color-text-faint)" title="Xarajat daromad bilan birga o'zgarmagan — hammasi doimiy deb olindi">doimiy</span>}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{compact(u.avgIncomeTiyin)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-(--color-text-muted)">{compact(u.avgExpenseTiyin)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums">
                      {u.breakevenTiyin ? <CalcValue calc={breakevenCalc(u)}>{compact(u.breakevenTiyin)}</CalcValue> : ''}
                    </td>
                    <td className="px-3 py-2.5">
                      <MarginBar value={u.safetyMargin} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                      {u.leverage === null ? '' : <CalcValue calc={breakevenCalc(u)}>{`×${u.leverage.toFixed(1).replace('.', ',')}`}</CalcValue>}
                    </td>
                    <td className="py-2.5 pl-3 pr-5 text-right">
                      <span className={cn('inline-flex rounded px-2 py-0.5 text-[11px] font-semibold', BE_STATUS[u.status].tone)}>{BE_STATUS[u.status].label}</span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-(--color-line) px-5 py-2.5 text-xs leading-relaxed text-(--color-text-muted)">
          Zaxira — o&apos;rtacha daromad zararsizlik nuqtasidan necha foiz yuqori. Leverej — daromad 1% o&apos;zgarsa, foyda necha foiz o&apos;zgaradi (katta bo&apos;lsa — foyda daromad tushishiga juda
          sezgir). «doimiy» belgisi — xarajat daromad bilan birga o&apos;zgarmagan, hammasi doimiy deb olingan.
        </p>
      </Card>
    </div>
  );
}