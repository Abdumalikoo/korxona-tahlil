'use client';

import { useAsOf } from '@/lib/period';
import { CalcValue } from '@/components/ui/calc';
import { calcDivide, calcSum, Q } from '@/lib/calc';
import { breakevenCalc, efficiencyCalc, potentialCalc, roiCalc } from './calcs';
import { ExcelButton, Field, FilterBar, GroupTh, MoneyCell, NameCell, ReportCard, RTable, SelectBox, StatTiles, STICKY_NAME, STICKY_NO, sum, TableNote, Td, Th, Tr } from '@/components/report/report';
import { NotesList, StatusBadge } from '@/components/report/report-extra-b';
import { LoadingCard } from '@/components/report/report-extra-c';
import { Mark } from '@/features/reactions/mark';
import { compact, pct } from '@/features/structure/api';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useState } from 'react';
import { econApi, incomeMark, type BreakevenUnit, type EfficiencyMode, type EfficiencyUnit } from './api';
import { BreakevenChart, MarginBar } from './efficiency-charts';

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

  if (result.error || !data) {
    return (
      <div className="space-y-4">
        {filters}
        <LoadingCard label="Samaradorlik hisoblanmoqda" error={result.error} onRetry={result.reload} />
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

const BE_STATUS: Record<BreakevenUnit['status'], { label: string; tone: 'green' | 'amber' | 'red' | 'muted' }> = {
  safe: { label: 'Xavfsiz', tone: 'green' },
  thin: { label: 'Chegarada', tone: 'amber' },
  loss: { label: 'Zararda', tone: 'red' },
  na: { label: '', tone: 'muted' },
};

export function BreakevenView() {
  const [win, setWin] = useState<Window>('12');
  const [selected, setSelected] = useState('all');
  /** Umumiy «Davr» oyi: o'tgan oy bo'lsa — o'sha oy oxiridagi holat */
  const asOf = useAsOf();
  const result = useAsync(() => econApi.breakeven(win, asOf).then((r) => r.data), [win, asOf]);
  const data = result.data;

  const exportCsv = () =>
    data &&
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
    );

  const filters = (
    <FilterBar actions={data && data.units.length > 0 ? <ExcelButton onClick={exportCsv} label="CSV yuklab olish" /> : undefined}>
      <Field label="Davr">
        <SelectBox value={win} options={WINDOWS.filter((w) => w.value !== '3')} onChange={setWin} />
      </Field>
      <p className="max-w-xl pb-2 text-xs leading-relaxed text-(--color-text-muted)">Har bir hudud va korxona zararsiz ishlashi uchun oyiga qancha daromad kerak va hozir qancha zaxira bor</p>
    </FilterBar>
  );

  if (result.error || !data) {
    return (
      <div className="space-y-4">
        {filters}
        <LoadingCard label="Zararsizlik hisoblanmoqda" error={result.error} onRetry={result.reload} />
      </div>
    );
  }

  const total = data.units.find((u) => u.kind === 'total');
  const regions = data.units.filter((u) => u.kind === 'region');
  const center = data.units.find((u) => u.kind === 'center');
  const unit = data.units.find((u) => u.key === selected) ?? total ?? data.units[0];
  const losing = regions.filter((u) => u.status === 'loss').length;
  const thin = regions.filter((u) => u.status === 'thin').length;
  const margin = total?.safetyMargin ?? null;
  const coverage = data.center?.coverage ?? null;
  let no = 0;

  return (
    <div className="space-y-4">
      <StatTiles
        items={[
          {
            label: 'Korxona zararsizligi',
            value: total?.breakevenTiyin ? Number(total.breakevenTiyin) : 0,
            text: total?.breakevenTiyin ? undefined : '',
            calc: total ? breakevenCalc(total) : null,
            tone: 'blue',
            note: total ? `oyiga; o'rtacha daromad ${compact(total.avgIncomeTiyin)}` : undefined,
          },
          {
            label: 'Xavfsizlik zaxirasi',
            value: 0,
            text: margin != null ? pct(margin * 100, true) : '',
            calc: total ? breakevenCalc(total) : null,
            tone: margin == null ? 'cyan' : margin < 0 ? 'red' : margin < 0.1 ? 'orange' : 'green',
            note: "daromad shuncha tushsa ham zarar yo'q",
          },
          {
            label: 'Zararda / chegarada',
            value: 0,
            text: `${losing} / ${thin}`,
            tone: losing ? 'red' : 'purple',
            note: `${regions.length} ta hududdan`,
          },
          {
            label: 'Markazni qoplash',
            value: 0,
            text: coverage != null ? pct(coverage * 100) : '',
            calc: data.center
              ? calcDivide('Markazni qoplash', Q.money('Hududlar foydasi (oyiga)', data.center.regionsProfitTiyin), Q.money('Markaz sof xarajati (oyiga)', data.center.netExpenseTiyin), 'pct', {
                  note: "100% va undan yuqori — hududlar foydasi Markaz xarajatini to'liq qoplaydi.",
                })
              : null,
            tone: coverage != null && coverage < 1 ? 'red' : 'green',
            note: data.center ? `Markaz ${compact(data.center.netExpenseTiyin)} / oy, hududlar foydasi ${compact(data.center.regionsProfitTiyin)}` : undefined,
          },
        ]}
      />

      {filters}

      {data.notes.length > 0 && (
        <ReportCard title="Zararsizlik xulosasi">
          <NotesList notes={data.notes} />
        </ReportCard>
      )}

      <div className="grid gap-4 xl:grid-cols-5">
        <ReportCard
          className="xl:col-span-3"
          title={`Zararsizlik grafigi — ${unit?.name ?? ''}`}
          badge="Qaysi daromad darajasida xarajat qoplanadi?"
          actions={
            <SelectBox
              value={unit?.key ?? 'all'}
              onChange={setSelected}
              options={data.units.filter((u) => u.kind !== 'center').map((u) => ({ value: u.key, label: u.name }))}
              className="h-9 min-w-36"
            />
          }
        >
          <div className="px-5 pb-3">
            {unit && unit.status !== 'na' ? (
              <>
                <BreakevenChart unit={unit} />
                <p className="mt-2 text-sm leading-relaxed">{unit.text}</p>
              </>
            ) : (
              <p className="text-sm text-(--color-text-muted)">{unit?.text}</p>
            )}
          </div>
          <TableNote>
            Yashil chiziq — daromad, qizil — xarajat (doimiy qism + daromadga bog&apos;liq qism). Kesishgan joy — zararsizlik nuqtasi: undan o&apos;ngda foyda (yashil soha), chapda zarar. Nuqtalar — haqiqiy oylar. Ko&apos;k
            uzuq chiziq — o&apos;rtacha oylik daromad.
          </TableNote>
        </ReportCard>
        <ReportCard className="xl:col-span-2" title="Markaz xarajatini kim qoplaydi" badge="Markaz">
          <div className="space-y-3 px-5 pb-5 text-sm">
            {data.center ? (
              <>
                <p>
                  Markazning o&apos;z daromadi yo&apos;q: uning oylik sof xarajati (<b>{compact(data.center.netExpenseTiyin)}</b>) hududlar foydasidan qoplanishi kerak.
                </p>
                <div className="rounded-xl border border-(--color-line) bg-[#fafbfe] px-4 py-3">
                  <div className="flex justify-between text-xs text-(--color-text-muted)">
                    <span>Hududlarning oylik foydasi</span>
                    <span className="font-semibold tabular-nums text-(--color-text)">{compact(data.center.regionsProfitTiyin)}</span>
                  </div>
                  <div className="relative mt-1.5 h-3 rounded-full bg-(--color-surface-sunken)">
                    <div
                      className={cn('h-full rounded-full', (data.center.coverage ?? 0) >= 1 ? 'bg-(--color-income)' : 'bg-(--color-expense)')}
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
        </ReportCard>
      </div>

      <ReportCard title="Hududlar bo'yicha zararsizlik (oylik)" badge={periodText(data.periodFrom, data.periodTo, data.months)}>
        <RTable minWidth={960}>
          <thead>
            <tr>
              <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
              <Th className={cn(STICKY_NAME, 'z-[2] min-w-44 text-left')}>Hudud</Th>
              <Th>O&apos;rtacha daromad</Th>
              <Th>O&apos;rtacha xarajat</Th>
              <Th>Zararsizlik</Th>
              <Th>Zaxira</Th>
              <Th>Leverej</Th>
              <Th>Holat</Th>
            </tr>
          </thead>
          <tbody>
            {data.units
              .filter((u) => u.kind !== 'center')
              .map((u) => (
                <Tr key={u.key} total={u.kind === 'total'} onClick={() => setSelected(u.key)} className={cn(unit?.key === u.key && u.kind !== 'total' && 'bg-brand-50!')} title={u.text}>
                  <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{u.kind === 'total' ? '' : ++no}</Td>
                  <NameCell
                    drill
                    before={u.kind === 'region' ? <Mark item={incomeMark(u, 'Zararsizlik')} /> : undefined}
                    sub={u.method === 'fixed' ? <span title="Xarajat daromad bilan birga o'zgarmagan — hammasi doimiy deb olindi">doimiy</span> : undefined}
                  >
                    {u.name}
                  </NameCell>
                  <MoneyCell value={Number(u.avgIncomeTiyin)} />
                  <MoneyCell value={Number(u.avgExpenseTiyin)} className={cn(u.kind !== 'total' && 'text-(--color-text-muted)')} />
                  {u.breakevenTiyin ? <MoneyCell value={Number(u.breakevenTiyin)} calc={breakevenCalc(u)} strong /> : <Td />}
                  <Td>
                    <span className="flex justify-center">
                      <MarginBar value={u.safetyMargin} />
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap">{u.leverage === null ? '' : <CalcValue calc={breakevenCalc(u)} className="no-underline">{`×${u.leverage.toFixed(1).replace('.', ',')}`}</CalcValue>}</Td>
                  <Td>{BE_STATUS[u.status].label && <StatusBadge tone={BE_STATUS[u.status].tone}>{BE_STATUS[u.status].label}</StatusBadge>}</Td>
                </Tr>
              ))}
          </tbody>
        </RTable>
        <TableNote>
          Summalar — so&apos;mda, oylik o&apos;rtacha. Zaxira — o&apos;rtacha daromad zararsizlik nuqtasidan necha foiz yuqori. Leverej — daromad 1% o&apos;zgarsa, foyda necha foiz o&apos;zgaradi (katta bo&apos;lsa — foyda
          daromad tushishiga juda sezgir). «doimiy» belgisi — xarajat daromad bilan birga o&apos;zgarmagan, hammasi doimiy deb olingan. Qatorni bosing — grafik shu hududga o&apos;tadi.
        </TableNote>
      </ReportCard>
    </div>
  );
}
