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
import { ChangesTable, SpansNote, Switch, TopRecords } from './parts';

// ═══════════════════════════════════════════════════════════
// Bosh sahifa › Daromad:
//  ko'rsatkichlar → daromad tarkibi (Markaz / Hududlar → moddalar → bo'limlar / hududlar)
//  → kesimlar (moddalar, hududlar, bo'limlar, mijozlar) → oylar kesimi → eng katta yozuvlar.
//  Grafiklar yo'q — hammasi jadvallarda, har bir summa bosiladi.
// ═══════════════════════════════════════════════════════════

type Cut = 'categories' | 'regions' | 'departments' | 'clients';
const ROOT = 'Daromad';

const OPEN_COL: ExtraCol = { key: 'open', label: "To'lanmagan", hint: 'Debitorlik: hisoblangan, lekin hali tushmagan', get: (n) => n.x?.open ?? 0, drill: (n) => ({ ...n.f, unpaid: true }), tone: 'expense' };

export function IncomeExplorer({ range }: { range: DateRange }) {
  const res = useAsync(() => exploreApi.income(range.from, range.to).then((r) => r.data), [range.from, range.to]);
  const [cut, setCut] = useState<Cut>('categories');
  // Hudud ichi: viloyatlar → xizmatlar yoki xizmat turlari → viloyatlar
  const [regionBy, setRegionBy] = useState<'regions' | 'parts'>('regions');
  if (res.loading && !res.data) return <LoadingState />;
  if (res.error) return <ErrorState message={res.error} onRetry={res.reload} />;
  const d = res.data!;
  const t = d.totals;

  const cuts = {
    categories: { nodes: d.categories, name: 'Modda', desc: "Har bir modda ichida — Markaz, hududlar va yo'nalishlar bo'yicha" },
    regions: { nodes: d.regions, name: 'Birlik', desc: "Markaz, har bir hudud va yo'nalish (Tax free …) ichida — moddalar bo'yicha" },
    departments: { nodes: d.departments, name: "Bo'lim", desc: "Bo'lim ko'rsatilgan yozuvlar (asosan Markaz) — moddalar bo'yicha" },
    clients: { nodes: d.clients.rows, name: 'Mijoz', desc: `Eng katta ${Math.min(30, d.clients.total)} ta mijoz (jami ${d.clients.total} ta nomli mijoz)` },
  }[cut];

  const none = t.none.cur || t.none.prev || t.none.ly;

  return (
    <DrillProvider range={range}>
      <div className="space-y-4">
        <SpansNote cur={d.cur} prev={d.prev} ly={d.ly} />

        <IncomeTiles d={d} />
        {none ? (
          <p className="rounded-2xl bg-(--color-warn-soft) px-5 py-3 text-sm text-(--color-warn) shadow-card">
            {som(t.none.cur)} so&apos;m daromadda hudud, bo&apos;lim yoki yo&apos;nalish (Tax free …) ko&apos;rsatilmagan («Biriktirilmagan» qatori). Ularni Markaz, hudud yoki yo&apos;nalishga biriktirsangiz, tahlil aniqroq bo&apos;ladi.
          </p>
        ) : null}

        <DrillTable
          key={regionBy}
          nodes={regionBy === 'parts' && d.treeByPart ? d.treeByPart : d.tree}
          title="Daromad tarkibi: qayerdan keldi"
          description={regionBy === 'parts' ? "Markaz → xizmatlar → bo'limlar; Hududlar → xizmat turlari → viloyatlar; yo'nalishlar. › bosilsa ichi ochiladi, summa bosilsa — yozuvlar" : "Markaz → xizmatlar → bo'limlar; Hududlar → viloyatlar → xizmatlar; yo'nalishlar. › bosilsa ichi ochiladi, summa bosilsa — yozuvlar"}
          root={ROOT}
          openDepth={1}
          extra={[OPEN_COL]}
          total={t}
          csv="Daromad tarkibi"
          actions={
            <Switch
              value={regionBy}
              onChange={setRegionBy}
              options={[
                { value: 'regions', label: 'Hudud: viloyatlar bo‘yicha' },
                { value: 'parts', label: 'Xizmat turlari bo‘yicha' },
              ]}
            />
          }
        />

        <DrillTable
          key={cut}
          nodes={cuts.nodes}
          title={`Kesimlar: ${cuts.desc}`}
          nameHeader={cuts.name}
          root={ROOT}
          extra={[OPEN_COL]}
          total={cut === 'clients' || cut === 'departments' ? undefined : t}
          csv={`Daromad — ${cut}`}
          limit={cut === 'clients' ? 15 : 20}
          actions={
            <Switch
              value={cut}
              onChange={setCut}
              options={[
                { value: 'categories', label: 'Moddalar', count: d.categories.length },
                { value: 'regions', label: 'Hududlar', count: d.regions.length },
                { value: 'departments', label: "Bo'limlar", count: d.departments.length },
                { value: 'clients', label: 'Mijozlar', count: d.clients.total },
              ]}
            />
          }
          note={
            cut === 'clients' && d.clients.others.parties ? (
              <>
                Qolgan {d.clients.others.parties} ta mijoz: <b className="money">{som(d.clients.others.cur)}</b> so&apos;m ({d.clients.others.count} ta yozuv). «Jami» — ro&apos;yxatdagilar yig&apos;indisi.
              </>
            ) : cut === 'departments' ? (
              "Hududlar daromadida odatda bo'lim ko'rsatilmaydi — ular «Bo'lim ko'rsatilmagan» qatorida."
            ) : undefined
          }
        />

        <MatrixTable data={d.months} months={d.monthList} title="Oylar kesimida: moddalar × oylar" root={ROOT} csv="Daromad — oylar" />

        <ChangesTable nodes={d.categories} kind="income" root={ROOT} title="Eng ko'p o'zgargan daromad moddalari" />

        <TopRecords rows={d.top} kind="income" title="Eng katta daromad yozuvlari" />

      </div>
    </DrillProvider>
  );
}

/** Tepadagi kartalar: jami, Markaz, hududlar, yo'nalishlar, to'lanmagan — bosilsa yozuvlar */
function IncomeTiles({ d }: { d: NonNullable<Awaited<ReturnType<typeof exploreApi.income>>['data']> }) {
  const { open } = useDrill();
  const t = d.totals;
  const items: StatTile[] = [
    {
      label: 'Jami daromad',
      value: t.cur,
      previous: t.prev,
      tone: 'green',
      onClick: () => open({ kind: 'income', f: {}, title: `${ROOT} › Jami`, expected: t.cur }),
    },
    {
      label: `Markaz · ${pct(share(t.center.cur, t.cur))}`,
      value: t.center.cur,
      previous: t.center.prev,
      tone: 'blue',
      onClick: () => open({ kind: 'income', f: { unit: 'center' }, title: `${ROOT} › Markaz`, expected: t.center.cur }),
    },
    {
      label: `Hududlar · ${pct(share(t.regions.cur, t.cur))}`,
      value: t.regions.cur,
      previous: t.regions.prev,
      tone: 'cyan',
      onClick: () => open({ kind: 'income', f: { unit: 'regions' }, title: `${ROOT} › Hududlar`, expected: t.regions.cur }),
    },
    ...(t.segments && (t.segments.cur || t.segments.prev)
      ? [
          {
            label: `Yo'nalishlar · ${pct(share(t.segments.cur, t.cur))}`,
            value: t.segments.cur,
            previous: t.segments.prev,
            tone: 'purple' as const,
            onClick: () => open({ kind: 'income', f: { unit: 'segments' }, title: `${ROOT} › Yo'nalishlar`, expected: t.segments!.cur }),
          },
        ]
      : []),
    {
      label: "To'lanmagan (debitor)",
      value: t.open,
      note: `Tushgan ${som(t.received)} so'm (${pct(share(t.received, t.cur))})`,
      tone: t.open ? 'red' : 'orange',
      onClick: () => open({ kind: 'income', f: { unpaid: true }, title: `${ROOT} › To'lanmagan`, expected: t.open }),
    },
  ];
  return (
    <div className="space-y-2">
      <StatTiles items={items} compareLabel="Avval" />
      <p className="text-xs text-(--color-text-muted)">
        {t.count.toLocaleString('uz')} ta yozuv
        {t.quantity ? ` · ${t.quantity.toLocaleString('uz')} ta xizmat · bir xizmat o'rtacha ${short(t.cur / t.quantity)}` : ''}
        {(t.bySegment ?? []).length ? ` · yo'nalishlar: ${(t.bySegment ?? []).map((sg) => `${sg.label} ${short(sg.cur)}`).join(', ')}` : ''}
      </p>
    </div>
  );
}
