'use client';

import { Card } from '@/components/ui/card';
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
import { BreakevenChart, EFF_COLOR, EfficiencyBars, FrontierChart, MarginBar } from './efficiency-charts';

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[--color-text-muted]';
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

export function EfficiencyView({ showModelsLink = false }: { showModelsLink?: boolean }) {
  const [win, setWin] = useState<Window>('12');
  const [mode, setMode] = useState<EfficiencyMode>('resources');
  const [selected, setSelected] = useState<string | null>(null);
  const result = useAsync(() => econApi.efficiency(win, mode).then((r) => r.data), [win, mode]);
  const data = result.data;

  const header = (
    <PanelHeader
      title="Samaradorlik"
      description="Qaysi hudud o'z resurslari (xodimlar, xarajatlar) bilan eng ko'p daromad oladi va qolganlar ulardan qancha orqada"
      actions={
        showModelsLink ? (
          <Link href="/katta-modellar" className="text-xs text-brand-700 hover:underline">
            Katta modellar →
          </Link>
        ) : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="flex items-center gap-2">
          <span className="text-xs text-[--color-text-muted]">Davr:</span>
          <Segmented value={win} options={WINDOWS} onChange={setWin} size="sm" />
        </span>
        <span className="flex items-center gap-2">
          <span className="text-xs text-[--color-text-muted]">Resurslar:</span>
          <Segmented
            value={mode}
            onChange={setMode}
            size="sm"
            options={[
              { value: 'resources', label: 'Xodimlar + xarajat', hint: 'Xodimlar soni va ish haqidan tashqari xarajatlar' },
              { value: 'money', label: "Faqat so'm", hint: 'Ish haqi va boshqa xarajatlar' },
            ]}
          />
        </span>
      </div>
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
          <LoadingState label="Samaradorlik hisoblanmoqda" />
        </Card>
      </div>
    );
  }
  if (data.units.length === 0) {
    return (
      <div className="space-y-4">
        {header}
        <Findings title="Natija" notes={[...data.notes, ...data.warnings]} />
      </div>
    );
  }

  const units = data.units;
  const avg = units.reduce((s, u) => s + u.crs, 0) / units.length;
  const gap = units.reduce((s, u) => s + Number(u.gapTiyin), 0);
  const income = units.reduce((s, u) => s + Number(u.incomeTiyin), 0);
  const worst = units[units.length - 1]!;
  const current = units.find((u) => u.key === selected) ?? null;

  return (
    <div className="space-y-4">
      {header}

      <KpiStrip
        items={[
          { label: 'Chegarada', value: `${data.frontier.length} ta hudud`, valueClass: 'text-[--color-income]', sub: data.frontier.join(', ') },
          { label: "O'rtacha samaradorlik", value: pctOf(avg), sub: `${units.length} ta hudud · ${periodText(data.periodFrom, data.periodTo, data.months)}` },
          { label: 'Eng orqada', value: worst.name, valueClass: 'text-[--color-expense]', sub: `${pctOf(worst.crs)} — chegaradan ${pctOf(1 - worst.crs)} past`, mark: <Mark item={incomeMark(worst, 'Samaradorlik')} /> },
          { label: 'Yashirin imkoniyat', value: `+${compact(gap)}`, sub: `oyiga (+${pct((gap / Math.max(1, income)) * 100)}), hamma chegaradagidek ishlasa` },
        ]}
      />

      <Findings title="Samaradorlik xulosasi" notes={data.notes} />
      {data.warnings.length > 0 && (
        <Card className="border-l-2 border-l-amber-500">
          <ul className="space-y-1.5 px-5 py-3.5 text-sm">
            {data.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <ModelCard
          index={1}
          title="Samaradorlik reytingi (DEA)"
          question="Har bir hudud eng yaxshilardan necha foiz orqada?"
          howTo="Ustun — samaradorlik: 100% — chegarada (eng yaxshilar qatorida). 80% — shu daromadni resurslarning 80% i bilan olish mumkin edi. Qora chiziq — hududning kattaligi hisobga olingandagi samaradorlik: u 100% da, ustun esa past bo'lsa — muammo boshqaruvda emas, hajmda. Hududni bosing — tafsiloti chiqadi."
        >
          <EfficiencyBars units={units} onSelect={setSelected} selected={selected} />
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[--color-text-muted]">
            {(Object.keys(EFF_STATUS) as EfficiencyUnit['status'][]).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-[2px]" style={{ background: EFF_COLOR[s] }} />
                {EFF_STATUS[s]}
              </span>
            ))}
          </div>
        </ModelCard>

        <ModelCard
          index={2}
          title="Samaradorlik chegarasi"
          question="Bir xil daromad olish uchun har bir hudud qancha resurs sarflaydi?"
          howTo="Pastki-chap burchak — yaxshi (kam resurs bilan ko'p daromad). Yashil chiziq — eng yaxshilar tutashgan chegara. Chegaradan uzoqdagi hudud resurslarni ko'proq sarflaydi. Nuqtani bosing."
        >
          <FrontierChart data={data} selected={selected} onSelect={setSelected} />
        </ModelCard>
      </div>

      {current && (
        <Card className="border-l-2" style={{ borderLeftColor: EFF_COLOR[current.status] }}>
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[--color-text-faint]">
                {current.rank}-o&apos;rin · {EFF_STATUS[current.status]}
              </p>
              <h3 className="mt-0.5 text-base font-semibold">
                {current.name}: {pctOf(current.crs)}
              </h3>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed">
                {current.status === 'frontier'
                  ? "Bu hudud samaradorlik chegarasida — boshqalar uchun namuna. Uning ish uslubini (mijozlar bilan ishlash, xarajat nazorati) boshqa hududlarga o'tkazish foydali."
                  : `Namuna hududlar: ${current.peers.map((p) => p.name).join(', ')}. Ular kabi ishlaganda ${current.name} hozirgi resurslar bilan oyiga ~${compact(current.potentialIncomeTiyin)} so'm daromad olardi (hozir ${compact(current.incomeTiyin)}, farq +${compact(current.gapTiyin)}). Yoki shu daromadni resurslarning ${pctOf(current.crs)} i bilan olish mumkin edi.`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Mark item={incomeMark(current, 'Samaradorlik')} label="Munosabatga" />
              <SmallButton onClick={() => setSelected(null)}>Yopish</SmallButton>
            </div>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5">
          <div>
            <h3 className="text-sm font-semibold">Hududlar jadvali (oylik o&apos;rtacha)</h3>
            <p className="mt-0.5 text-xs text-[--color-text-muted]">{periodText(data.periodFrom, data.periodTo, data.months)}. Qatorni bosing — tafsiloti.</p>
          </div>
          <SmallButton
            onClick={() =>
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
              )
            }
          >
            CSV yuklab olish
          </SmallButton>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y border-[--color-line] bg-[--color-surface-muted]">
              <tr>
                <th className={cn(TH, 'pl-5 text-left')}>Hudud</th>
                <th className={cn(TH, 'text-right')}>Samaradorlik</th>
                <th className={cn(TH, 'text-right')}>Daromad</th>
                <th className={cn(TH, 'text-right')}>Xarajat</th>
                <th className={cn(TH, 'text-right')}>Xodimlar</th>
                <th className={cn(TH, 'text-right')}>1 xodimga</th>
                <th className={cn(TH, 'text-right')}>Daromad / xarajat</th>
                <th className={cn(TH, 'text-right')}>Imkoniyat</th>
                <th className={cn(TH, 'pr-5 text-left')}>Namuna</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[--color-line]">
              {units.map((u) => (
                <tr key={u.key} onClick={() => setSelected(u.key)} className={cn('cursor-pointer hover:bg-[--color-surface-muted]', selected === u.key && 'bg-[--color-surface-muted]')}>
                  <td className="py-2.5 pl-5 pr-3">
                    <span className="flex items-center gap-2">
                      <Mark item={incomeMark(u, 'Samaradorlik')} />
                      <span className="w-5 text-right text-xs tabular-nums text-[--color-text-faint]">{u.rank}.</span>
                      {u.name}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums" style={{ color: EFF_COLOR[u.status] }}>
                    {pctOf(u.crs)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{compact(u.incomeTiyin)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[--color-text-muted]">{compact(u.expenseTiyin)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{u.headcount.toFixed(u.headcount % 1 ? 1 : 0).replace('.', ',')}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{u.incomePerHeadTiyin ? compact(u.incomePerHeadTiyin) : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{u.roi === null ? '—' : u.roi.toFixed(2).replace('.', ',')}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[--color-income]">{Number(u.gapTiyin) > 0 ? `+${compact(u.gapTiyin)}` : '—'}</td>
                  <td className="max-w-[14rem] truncate py-2.5 pl-3 pr-5 text-xs text-[--color-text-muted]" title={u.peers.map((p) => p.name).join(', ')}>
                    {u.status === 'frontier' ? "o'zi namuna" : u.peers.map((p) => p.name).join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-[--color-line] px-5 py-2.5 text-xs leading-relaxed text-[--color-text-muted]">
          Usul: DEA (ma&apos;lumotlarni qamrab olish tahlili) — hududlar faqat bir-biri bilan solishtiriladi, tashqi me&apos;yor kerak emas. Resurslar: {data.inputs.join(', ').toLowerCase()}; natija: daromad.
          «Imkoniyat» — namuna hududlar kabi ishlaganda qo&apos;shimcha oylik daromad (yuqori chegara).
        </p>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Zararsizlik nuqtasi
// ═══════════════════════════════════════════════════════════

const BE_STATUS: Record<BreakevenUnit['status'], { label: string; tone: string }> = {
  safe: { label: 'Xavfsiz', tone: 'bg-[--color-income-soft] text-[--color-income]' },
  thin: { label: 'Chegarada', tone: 'bg-amber-100 text-amber-800' },
  loss: { label: 'Zararda', tone: 'bg-[--color-expense-soft] text-[--color-expense]' },
  na: { label: '—', tone: 'bg-[--color-surface-sunken] text-[--color-text-muted]' },
};

export function BreakevenView() {
  const [win, setWin] = useState<Window>('12');
  const [selected, setSelected] = useState('all');
  const result = useAsync(() => econApi.breakeven(win).then((r) => r.data), [win]);
  const data = result.data;

  const header = (
    <PanelHeader title="Zararsizlik nuqtasi" description="Har bir hudud va korxona zararsiz ishlashi uchun oyiga qancha daromad kerak va hozir qancha zaxira bor">
      <span className="flex items-center gap-2">
        <span className="text-xs text-[--color-text-muted]">Davr:</span>
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
            value: total?.breakevenTiyin ? compact(total.breakevenTiyin) : '—',
            sub: total ? `oyiga; o'rtacha daromad ${compact(total.avgIncomeTiyin)}` : undefined,
          },
          {
            label: 'Xavfsizlik zaxirasi',
            value: total?.safetyMargin != null ? pct(total.safetyMargin * 100, true) : '—',
            valueClass: total?.safetyMargin != null ? (total.safetyMargin < 0 ? 'text-[--color-expense]' : total.safetyMargin < 0.1 ? 'text-amber-700' : 'text-[--color-income]') : undefined,
            sub: "daromad shuncha tushsa ham zarar yo'q",
          },
          {
            label: 'Zararda / chegarada',
            value: `${losing} / ${thin}`,
            valueClass: losing ? 'text-[--color-expense]' : undefined,
            sub: `${regions.length} ta hududdan`,
          },
          {
            label: 'Markazni qoplash',
            value: data.center?.coverage != null ? pct(data.center.coverage * 100) : '—',
            valueClass: data.center?.coverage != null && data.center.coverage < 1 ? 'text-[--color-expense]' : undefined,
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
                className="h-7 rounded-[--radius-control] border border-[--color-line] bg-white px-1.5 text-xs outline-none"
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
              <p className="text-sm text-[--color-text-muted]">{unit?.text}</p>
            )}
          </ModelCard>
        </div>
        <div className="xl:col-span-2">
          <Card className="h-full">
            <div className="border-b border-[--color-line] px-5 py-3.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[--color-text-faint]">Markaz</p>
              <h3 className="mt-0.5 text-sm font-semibold">Markaz xarajatini kim qoplaydi</h3>
            </div>
            <div className="space-y-3 px-5 py-4 text-sm">
              {data.center ? (
                <>
                  <p>
                    Markazning o&apos;z daromadi yo&apos;q: uning oylik sof xarajati (<b>{compact(data.center.netExpenseTiyin)}</b>) hududlar foydasidan qoplanishi kerak.
                  </p>
                  <div>
                    <div className="flex justify-between text-xs text-[--color-text-muted]">
                      <span>Hududlarning oylik foydasi</span>
                      <span className="font-semibold tabular-nums text-[--color-text]">{compact(data.center.regionsProfitTiyin)}</span>
                    </div>
                    <div className="relative mt-1.5 h-3 bg-[--color-surface-sunken]">
                      <div
                        className={cn('h-full', (data.center.coverage ?? 0) >= 1 ? 'bg-[--color-income]' : 'bg-[--color-expense]')}
                        style={{ width: `${Math.min(100, Math.max(0, ((data.center.coverage ?? 0) / Math.max(1, data.center.coverage ?? 1)) * 100))}%` }}
                      />
                      <span
                        className="absolute inset-y-[-3px] w-0.5 bg-[--color-text]"
                        style={{ left: `${Math.min(100, (1 / Math.max(1, data.center.coverage ?? 1)) * 100)}%` }}
                        title="Markaz xarajati"
                      />
                    </div>
                    <p className="mt-1 text-xs text-[--color-text-muted]">
                      Qora chiziq — Markaz xarajati. {data.center.coverage != null && data.center.coverage >= 1 ? "Hududlar foydasi uni to'liq qoplaydi." : 'Hududlar foydasi yetmayapti.'}
                    </p>
                  </div>
                  {center && <p className="text-xs text-[--color-text-muted]">{center.text}</p>}
                </>
              ) : (
                <p className="text-[--color-text-muted]">Markaz ma&apos;lumoti yo&apos;q.</p>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5">
          <div>
            <h3 className="text-sm font-semibold">Hududlar bo&apos;yicha zararsizlik (oylik)</h3>
            <p className="mt-0.5 text-xs text-[--color-text-muted]">{periodText(data.periodFrom, data.periodTo, data.months)}. Qatorni bosing — grafik shu hududga o&apos;tadi.</p>
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
                  u.method === 'regression' ? 'regressiya' : u.method === 'fixed' ? 'hammasi doimiy' : '—',
                ]),
              )
            }
          >
            CSV yuklab olish
          </SmallButton>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y border-[--color-line] bg-[--color-surface-muted]">
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
            <tbody className="divide-y divide-[--color-line]">
              {data.units
                .filter((u) => u.kind !== 'center')
                .map((u) => (
                  <tr
                    key={u.key}
                    onClick={() => setSelected(u.key)}
                    className={cn('cursor-pointer hover:bg-[--color-surface-muted]', u.kind === 'total' && 'font-medium', unit?.key === u.key && 'bg-[--color-surface-muted]')}
                    title={u.text}
                  >
                    <td className="py-2.5 pl-5 pr-3">
                      <span className="flex items-center gap-2">
                        {u.kind === 'region' && <Mark item={incomeMark(u, 'Zararsizlik')} />}
                        {u.name}
                        {u.method === 'fixed' && <span className="text-[10px] text-[--color-text-faint]" title="Xarajat daromad bilan birga o'zgarmagan — hammasi doimiy deb olindi">doimiy</span>}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{compact(u.avgIncomeTiyin)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[--color-text-muted]">{compact(u.avgExpenseTiyin)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums">{u.breakevenTiyin ? compact(u.breakevenTiyin) : '—'}</td>
                    <td className="px-3 py-2.5">
                      <MarginBar value={u.safetyMargin} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{u.leverage === null ? '—' : `×${u.leverage.toFixed(1).replace('.', ',')}`}</td>
                    <td className="py-2.5 pl-3 pr-5 text-right">
                      <span className={cn('inline-flex rounded px-2 py-0.5 text-[11px] font-semibold', BE_STATUS[u.status].tone)}>{BE_STATUS[u.status].label}</span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-[--color-line] px-5 py-2.5 text-xs leading-relaxed text-[--color-text-muted]">
          Zaxira — o&apos;rtacha daromad zararsizlik nuqtasidan necha foiz yuqori. Leverej — daromad 1% o&apos;zgarsa, foyda necha foiz o&apos;zgaradi (katta bo&apos;lsa — foyda daromad tushishiga juda
          sezgir). «doimiy» belgisi — xarajat daromad bilan birga o&apos;zgarmagan, hammasi doimiy deb olingan.
        </p>
      </Card>
    </div>
  );
}