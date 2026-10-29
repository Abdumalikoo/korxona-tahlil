'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useAsync } from '@/lib/use-async';
import { useState } from 'react';
import { StatTiles, type StatTile } from '@/components/report/report';
import { exploreApi, pct, share, short, som } from './api';
import { DrillProvider, useDrill } from './drill';
import { DrillTable, type ExtraCol } from './drill-table';
import { MatrixTable } from './matrix-table';
import { SpansNote, Switch, TopRecords } from './parts';
import { BehaviorCard } from './behavior-card';
import { SalaryStructureCard } from '@/features/salary-composition/salary-structure';

// ═══════════════════════════════════════════════════════════
// Bosh sahifa › Xarajat:
//  ko'rsatkichlar → xarajat moddalari daraxti (guruh → modda → Markaz / hududlar)
//  → kesimlar (hududlar, bo'limlar, kontragentlar) → oylar kesimi → eng katta yozuvlar.
//  Grafiklar yo'q — hammasi jadvallarda, har bir summa bosiladi.
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
  // Hudud ichi: viloyatlar → moddalar yoki moddalar → viloyatlar
  const [regionBy, setRegionBy] = useState<'regions' | 'parts'>('regions');
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
  const none = t.none.cur || t.none.prev || t.none.ly;

  return (
    <DrillProvider range={range}>
      <div className="space-y-4">
        <SpansNote cur={d.cur} prev={d.prev} ly={d.ly} />

        <ExpenseTiles d={d} />
        {none ? (
          <p className="rounded-2xl bg-(--color-warn-soft) px-5 py-3 text-sm text-(--color-warn) shadow-card">
            {som(t.none.cur)} so&apos;m xarajatda hudud, bo&apos;lim yoki yo&apos;nalish (Tax free …) ko&apos;rsatilmagan — ular Markaz, Hududlar va yo&apos;nalishlar ustunlariga kirmaydi.
          </p>
        ) : null}

        {/* Birliklar bo'yicha: Markaz, Hudud (viloyatlar / moddalar tugmasi), yo'nalishlar */}
        {d.unitTree && (
          <DrillTable
            key={`unit-${regionBy}`}
            nodes={regionBy === 'parts' && d.unitTreeByPart ? d.unitTreeByPart : d.unitTree}
            title="Xarajat tarkibi: qayerga ketdi"
            description={regionBy === 'parts' ? "Markaz → moddalar; Hududlar → moddalar → viloyatlar; yo'nalishlar. › bosilsa ichi ochiladi, summa bosilsa — yozuvlar" : "Markaz → moddalar; Hududlar → viloyatlar → moddalar; yo'nalishlar. › bosilsa ichi ochiladi, summa bosilsa — yozuvlar"}
            root={ROOT}
           
            total={t}
            csv="Xarajat tarkibi"
            actions={
              <Switch
                value={regionBy}
                onChange={setRegionBy}
                options={[
                  { value: 'regions', label: 'Hudud: viloyatlar bo‘yicha' },
                  { value: 'parts', label: 'Moddalar bo‘yicha' },
                ]}
              />
            }
          />
        )}

        <DrillTable nodes={d.tree} title="Xarajat moddalari: pul nimaga sarflandi" description="Guruh → ichki moddalar. › bosilsa ichi ochiladi; Markaz / Hududlar / yo'nalishlar ustunlari ham bosiladi" nameHeader="Modda" root={ROOT} extra={unitCols} total={t} csv="Xarajat moddalari" note="To‘lanmagan summalar — «Kesimlar» jadvalida va yuqoridagi «To‘lanmagan» kartochkasida." />

        <DrillTable
          key={cut}
          nodes={cuts.nodes}
          title={`Kesimlar: ${cuts.desc}`}
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

        <MatrixTable data={d.months} months={d.monthList} title="Oylar kesimida: xarajat guruhlari × oylar" root={ROOT} csv="Xarajat — oylar" />

        <BehaviorCard cur={d.cur} prev={d.prev} />

        <SalaryStructureCard range={range} compact />

        <TopRecords rows={d.top} kind="expense" title="Eng katta xarajat yozuvlari" />

      </div>
    </DrillProvider>
  );
}

/** Tepadagi kartalar: jami, Markaz, hududlar, yo'nalishlar, to'lanmagan — bosilsa yozuvlar */
function ExpenseTiles({ d }: { d: NonNullable<Awaited<ReturnType<typeof exploreApi.expense>>['data']> }) {
  const { open } = useDrill();
  const t = d.totals;
  const items: StatTile[] = [
    {
      label: 'Jami xarajat',
      value: t.cur,
      previous: t.prev,
      growthGood: false,
      tone: 'red',
      onClick: () => open({ kind: 'expense', f: {}, title: `${ROOT} › Jami`, expected: t.cur }),
    },
    {
      label: `Markaz · ${pct(share(t.center.cur, t.cur))}`,
      value: t.center.cur,
      previous: t.center.prev,
      growthGood: false,
      tone: 'blue',
      onClick: () => open({ kind: 'expense', f: { unit: 'center' }, title: `${ROOT} › Markaz`, expected: t.center.cur }),
    },
    {
      label: `Hududlar · ${pct(share(t.regions.cur, t.cur))}`,
      value: t.regions.cur,
      previous: t.regions.prev,
      growthGood: false,
      tone: 'cyan',
      onClick: () => open({ kind: 'expense', f: { unit: 'regions' }, title: `${ROOT} › Hududlar`, expected: t.regions.cur }),
    },
    ...(t.segments && (t.segments.cur || t.segments.prev)
      ? [
          {
            label: `Yo'nalishlar · ${pct(share(t.segments.cur, t.cur))}`,
            value: t.segments.cur,
            previous: t.segments.prev,
            growthGood: false,
            tone: 'purple' as const,
            onClick: () => open({ kind: 'expense', f: { unit: 'segments' }, title: `${ROOT} › Yo'nalishlar`, expected: t.segments!.cur }),
          },
        ]
      : []),
    {
      label: "To'lanmagan (kreditor)",
      value: t.open,
      note: `${t.unpaidCount} ta yozuv · to'langan ${pct(share(t.paid, t.cur))}`,
      tone: t.open ? 'red' : 'orange',
      onClick: () => open({ kind: 'expense', f: { unpaid: true }, title: `${ROOT} › To'lanmagan`, expected: t.open }),
    },
  ];
  return (
    <div className="space-y-2">
      <StatTiles items={items} compareLabel="Avval" />
      <p className="text-xs text-(--color-text-muted)">
        {t.count.toLocaleString('uz')} ta yozuv
        {(t.bySegment ?? []).length ? ` · yo'nalishlar: ${(t.bySegment ?? []).map((sg) => `${sg.label} ${short(sg.cur)}`).join(', ')}` : ''}
      </p>
    </div>
  );
}
