'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useAsync } from '@/lib/use-async';
import { useState } from 'react';
import { exploreApi, pct, share, som, UNIT_COLOR } from './api';
import { ChartCard, foldSeries, ShareBars, StackedMonths, type Series } from './charts';
import { DrillProvider } from './drill';
import { DrillTable, type ExtraCol } from './drill-table';
import { MatrixTable } from './matrix-table';
import { ChangesTable, Kpi, leafCategories, SectionTitle, SpansNote, Switch, TopRecords } from './parts';
import { SalaryStructureCard } from '@/features/salary-composition/salary-structure';

// ═══════════════════════════════════════════════════════════
// Bosh sahifa › Xarajat (to'liq rejim):
//  ko'rsatkichlar → xarajat moddalari daraxti (guruh → modda → Markaz / hududlar)
//  → kesimlar (hududlar, bo'limlar, kontragentlar) → oylar kesimi → eng katta yozuvlar → grafiklar.
// ═══════════════════════════════════════════════════════════

type Cut = 'regions' | 'departments' | 'parties';
const ROOT = 'Xarajat';

const BASE_COLS: ExtraCol[] = [
  { key: 'center', label: 'Markaz', hint: 'Shu moddaning Markazga tegishli qismi', get: (n) => n.x?.center ?? 0, drill: (n) => ({ ...n.f, unit: 'center' }), tone: 'muted' },
  { key: 'regions', label: 'Hududlar', hint: 'Shu moddaning hududlarga tegishli qismi', get: (n) => n.x?.regions ?? 0, drill: (n) => ({ ...n.f, unit: 'regions' }), tone: 'muted' },
];
const OPEN_COL: ExtraCol = { key: 'open', label: "To'lanmagan", hint: "Kreditorlik: to'lanmagan yoki qisman to'langan yozuvlar", get: (n) => n.x?.open ?? 0, drill: (n) => ({ ...n.f, unpaid: true }), tone: 'expense' };

export function ExpenseExplorer({ range }: { range: DateRange }) {
  const res = useAsync(() => exploreApi.expense(range.from, range.to).then((r) => r.data), [range.from, range.to]);
  const [cut, setCut] = useState<Cut>('regions');
  if (res.loading && !res.data) return <LoadingState />;
  if (res.error) return <ErrorState message={res.error} onRetry={res.reload} />;
  const d = res.data!;
  const t = d.totals;
  const cuts = {
    regions: { nodes: d.regions, name: 'Birlik', desc: "Markaz, har bir hudud va yo'nalish (Tax free …) — xarajat guruhlari bo'yicha" },
    departments: { nodes: d.departments, name: "Bo'lim", desc: "Bo'limlar — xarajat guruhlari bo'yicha" },
    parties: { nodes: d.counterparties.rows, name: 'Kontragent', desc: `Eng katta ${Math.min(30, d.counterparties.total)} ta kontragent (jami ${d.counterparties.total} ta)` },
  }[cut];
  // Ustunlar: Markaz, Hududlar va yozuvi bor har bir yo'nalish (Tax free …) — o'z bo'limi sifatida
  const segCols: ExtraCol[] = (t.bySegment ?? []).map((sg) => ({ key: sg.key, label: sg.label, hint: `Shu moddaning «${sg.label}» bo'limiga tegishli qismi`, get: (n) => n.x?.[sg.key] ?? 0, drill: (n) => ({ ...n.f, unit: sg.key }), tone: 'muted' }));
  const unitCols = [...BASE_COLS, ...segCols];
  const groupSeries: Series[] = foldSeries(d.months.rows, 5);
  const unitSeries: Series[] = d.months.units.map((u) => ({ key: u.key, label: u.label, color: UNIT_COLOR[u.key] ?? '#a3a29c', values: u.values, kind: 'expense', f: u.f }));
  const none = t.none.cur || t.none.prev || t.none.ly;

  return (
    <DrillProvider range={range}>
      <div className="space-y-4">
        <SpansNote cur={d.cur} prev={d.prev} ly={d.ly} />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Jami xarajat" cur={t.cur} prev={t.prev} ly={t.ly} kind="expense" drill={{ kind: 'expense', f: {}, title: `${ROOT} › Jami` }} sub={`${t.count.toLocaleString('uz')} ta yozuv`} />
          <Kpi label="Markaz" cur={t.center.cur} prev={t.center.prev} ly={t.center.ly} kind="expense" drill={{ kind: 'expense', f: { unit: 'center' }, title: `${ROOT} › Markaz` }} sub={`Ulushi ${pct(share(t.center.cur, t.cur))} · ${t.center.count} ta yozuv`} />
          <Kpi label="Hududlar" cur={t.regions.cur} prev={t.regions.prev} ly={t.regions.ly} kind="expense" drill={{ kind: 'expense', f: { unit: 'regions' }, title: `${ROOT} › Hududlar` }} sub={`Ulushi ${pct(share(t.regions.cur, t.cur))} · ${t.regions.count} ta yozuv`} />
          {(t.bySegment ?? []).map((sg) => (
            <Kpi key={sg.key} label={sg.label} cur={sg.cur} prev={sg.prev} ly={sg.ly} kind="expense" drill={{ kind: 'expense', f: { unit: sg.key }, title: `${ROOT} › ${sg.label}` }} sub={`Ulushi ${pct(share(sg.cur, t.cur))} · ${sg.count} ta yozuv`} />
          ))}
          <Kpi label="To'lanmagan (kreditorlik)" cur={t.open} kind="expense" tone={t.open ? 'expense' : undefined} drill={{ kind: 'expense', f: { unpaid: true }, title: `${ROOT} › To'lanmagan` }} sub={`${t.unpaidCount} ta yozuv · to'langan ${pct(share(t.paid, t.cur))}`} />
        </div>
        {none ? (
          <p className="rounded-(--radius-control) bg-(--color-warn-soft) px-3 py-2 text-xs text-(--color-warn)">
            {som(t.none.cur)} so&apos;m xarajatda hudud, bo&apos;lim yoki yo&apos;nalish (Tax free …) ko&apos;rsatilmagan — ular Markaz, Hududlar va yo&apos;nalishlar ustunlariga kirmaydi.
          </p>
        ) : null}

        <SectionTitle hint="Guruh → ichki moddalar → Markaz / hududlar">Xarajat moddalari</SectionTitle>
        <DrillTable nodes={d.tree} title="Pul nimaga sarflandi" description="▸ bosilsa ichi ochiladi; Markaz / Hududlar / yo'nalishlar ustunlari ham bosiladi" nameHeader="Modda" root={ROOT} openDepth={1} extra={unitCols} total={t} csv="Xarajat moddalari" note="To‘lanmagan summalar — «Kesimlar» jadvalida va yuqoridagi «To‘lanmagan» kartochkasida." />

        <SectionTitle hint="Bir xil xarajat — boshqa tomondan">Kesimlar</SectionTitle>
        <DrillTable
          key={cut}
          nodes={cuts.nodes}
          title={cuts.desc}
          nameHeader={cuts.name}
          root={ROOT}
          extra={[OPEN_COL]}
          total={cut === 'parties' ? undefined : t}
          csv={`Xarajat — ${cut}`}
          limit={cut === 'parties' ? 15 : 20}
          actions={
            <Switch
              value={cut}
              onChange={setCut}
              options={[
                { value: 'regions', label: 'Hududlar', count: d.regions.length },
                { value: 'departments', label: "Bo'limlar", count: d.departments.length },
                { value: 'parties', label: 'Kontragentlar', count: d.counterparties.total },
              ]}
            />
          }
          note={
            cut === 'parties' && d.counterparties.others.parties ? (
              <>
                Qolgan {d.counterparties.others.parties} ta kontragent: <b className="money">{som(d.counterparties.others.cur)}</b> so&apos;m ({d.counterparties.others.count} ta yozuv). «Jami» — ro&apos;yxatdagilar yig&apos;indisi.
              </>
            ) : undefined
          }
        />

        <SectionTitle hint="Guruh ▸ bosilsa ichki moddalar; katak bosilsa — o'sha oy yozuvlari">Oylar kesimida</SectionTitle>
        <MatrixTable data={d.months} months={d.monthList} title="Xarajat guruhlari × oylar" root={ROOT} csv="Xarajat — oylar" />

        <ChangesTable nodes={leafCategories(d.tree)} kind="expense" root={ROOT} title="Eng ko'p o'zgargan xarajat moddalari" />

        <SalaryStructureCard range={range} compact />

        <TopRecords rows={d.top} kind="expense" title="Eng katta xarajat yozuvlari" />

        <SectionTitle hint="Jadvallar bilan bir xil ma'lumot; ustun yoki chiziq bosilsa — yozuvlar">Grafiklar</SectionTitle>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Oylar bo'yicha: xarajat guruhlari" description="Eng katta 5 guruh, qolganlari — «Boshqalar»" legend={groupSeries.map((s) => ({ label: s.label, color: s.color }))}>
            <StackedMonths months={d.monthList} series={groupSeries} root={ROOT} />
          </ChartCard>
          <ChartCard title="Oylar bo'yicha: Markaz, hududlar va yo'nalishlar" legend={unitSeries.map((s) => ({ label: s.label, color: s.color }))}>
            <StackedMonths months={d.monthList} series={unitSeries} root={ROOT} />
          </ChartCard>
          <ChartCard title="Eng katta 10 guruh" description="Joriy davr, jami xarajatdagi ulushi bilan">
            <ShareBars items={d.tree} total={t.cur} root={ROOT} />
          </ChartCard>
        </div>
      </div>
    </DrillProvider>
  );
}