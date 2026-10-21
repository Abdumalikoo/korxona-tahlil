'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useAsync } from '@/lib/use-async';
import { useState } from 'react';
import { exploreApi, pct, share, short, som, UNIT_COLOR, type MatrixRow } from './api';
import { ChartCard, ShareBars, StackedMonths, type Series } from './charts';
import { DrillProvider } from './drill';
import { DrillTable, type ExtraCol } from './drill-table';
import { MatrixTable } from './matrix-table';
import { ChangesTable, Kpi, SectionTitle, SpansNote, Switch, TopRecords } from './parts';

// ═══════════════════════════════════════════════════════════
// Bosh sahifa › Daromad (to'liq rejim):
//  ko'rsatkichlar → daromad tarkibi (Markaz / Hududlar → moddalar → bo'limlar / hududlar)
//  → kesimlar (moddalar, hududlar, bo'limlar, mijozlar) → oylar kesimi → eng katta yozuvlar → grafiklar.
// ═══════════════════════════════════════════════════════════

type Cut = 'categories' | 'regions' | 'departments' | 'clients';
const ROOT = 'Daromad';

const OPEN_COL: ExtraCol = { key: 'open', label: "To'lanmagan", hint: 'Debitorlik: hisoblangan, lekin hali tushmagan', get: (n) => n.x?.open ?? 0, drill: (n) => ({ ...n.f, unpaid: true }), tone: 'expense' };

export function IncomeExplorer({ range }: { range: DateRange }) {
  const res = useAsync(() => exploreApi.income(range.from, range.to).then((r) => r.data), [range.from, range.to]);
  const [cut, setCut] = useState<Cut>('categories');
  if (res.loading && !res.data) return <LoadingState />;
  if (res.error) return <ErrorState message={res.error} onRetry={res.reload} />;
  const d = res.data!;
  const t = d.totals;

  const cuts = {
    categories: { nodes: d.categories, name: 'Modda', desc: "Har bir modda ichida — Markaz va hududlar bo'yicha" },
    regions: { nodes: d.regions, name: 'Hudud', desc: "Markaz va har bir hudud ichida — moddalar bo'yicha" },
    departments: { nodes: d.departments, name: "Bo'lim", desc: "Bo'lim ko'rsatilgan yozuvlar (asosan Markaz) — moddalar bo'yicha" },
    clients: { nodes: d.clients.rows, name: 'Mijoz', desc: `Eng katta ${Math.min(30, d.clients.total)} ta mijoz (jami ${d.clients.total} ta nomli mijoz)` },
  }[cut];

  const none = t.none.cur || t.none.prev || t.none.ly;
  const noneRow: MatrixRow = { key: 'none', label: 'Biriktirilmagan', kind: 'income', f: { unit: 'none' }, values: d.months.total.values.map((v, i) => v - (d.months.units[0]?.values[i] ?? 0) - (d.months.units[1]?.values[i] ?? 0)), total: t.none.cur };
  const unitSeries: Series[] = [...d.months.units, ...(none ? [noneRow] : [])].map((u) => ({ key: u.key, label: u.label, color: UNIT_COLOR[u.key] ?? '#a3a29c', values: u.values, kind: 'income', f: u.f }));

  return (
    <DrillProvider range={range}>
      <div className="space-y-4">
        <SpansNote cur={d.cur} prev={d.prev} ly={d.ly} />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Jami daromad" cur={t.cur} prev={t.prev} ly={t.ly} kind="income" drill={{ kind: 'income', f: {}, title: `${ROOT} › Jami` }} sub={`${t.count.toLocaleString('uz')} ta yozuv${t.quantity ? ` · ${t.quantity.toLocaleString('uz')} ta xizmat · o'rtacha ${short(t.cur / t.quantity)}` : ''}`} />
          <Kpi label="Markaz" cur={t.center.cur} prev={t.center.prev} ly={t.center.ly} kind="income" drill={{ kind: 'income', f: { unit: 'center' }, title: `${ROOT} › Markaz` }} sub={`Ulushi ${pct(share(t.center.cur, t.cur))} · ${t.center.count} ta yozuv`} />
          <Kpi label="Hududlar" cur={t.regions.cur} prev={t.regions.prev} ly={t.regions.ly} kind="income" drill={{ kind: 'income', f: { unit: 'regions' }, title: `${ROOT} › Hududlar` }} sub={`Ulushi ${pct(share(t.regions.cur, t.cur))} · ${t.regions.count} ta yozuv`} />
          <Kpi label="To'lanmagan (debitorlik)" cur={t.open} kind="expense" tone={t.open ? 'expense' : undefined} drill={{ kind: 'income', f: { unpaid: true }, title: `${ROOT} › To'lanmagan` }} sub={<>Tushgan: <b className="money text-heading">{som(t.received)}</b> ({pct(share(t.received, t.cur))})</>} />
        </div>
        {none ? (
          <p className="rounded-(--radius-control) bg-(--color-warn-soft) px-3 py-2 text-xs text-(--color-warn)">
            {som(t.none.cur)} so&apos;m daromadda hudud ham, bo&apos;lim ham ko&apos;rsatilmagan («Biriktirilmagan» qatori). Ularni Markaz yoki hududga biriktirsangiz, tahlil aniqroq bo&apos;ladi.
          </p>
        ) : null}

        <SectionTitle hint="Markaz → moddalar → bo'limlar; Hududlar → moddalar → hududlar">Daromad tarkibi</SectionTitle>
        <DrillTable nodes={d.tree} title="Daromad qayerdan keldi" description="▸ bosilsa ichi ochiladi; summa bosilsa — yozuvlar" root={ROOT} openDepth={1} extra={[OPEN_COL]} total={t} csv="Daromad tarkibi" />

        <SectionTitle hint="Bir xil daromad — boshqa tomondan">Kesimlar</SectionTitle>
        <DrillTable
          key={cut}
          nodes={cuts.nodes}
          title={cuts.desc}
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

        <SectionTitle hint="Katak bosilsa — o'sha oy yozuvlari">Oylar kesimida</SectionTitle>
        <MatrixTable data={d.months} months={d.monthList} title="Moddalar × oylar" root={ROOT} csv="Daromad — oylar" />

        <ChangesTable nodes={d.categories} kind="income" root={ROOT} title="Eng ko'p o'zgargan daromad moddalari" />

        <TopRecords rows={d.top} kind="income" title="Eng katta daromad yozuvlari" />

        <SectionTitle hint="Jadvallar bilan bir xil ma'lumot; ustun yoki chiziq bosilsa — yozuvlar">Grafiklar</SectionTitle>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Oylar bo'yicha daromad" description="Markaz va hududlar ulushi" legend={unitSeries.map((s) => ({ label: s.label, color: s.color }))}>
            <StackedMonths months={d.monthList} series={unitSeries} root={ROOT} />
          </ChartCard>
          <ChartCard title="Eng katta 10 modda" description="Joriy davr, jami daromaddagi ulushi bilan">
            <ShareBars items={d.categories} total={t.cur} root={ROOT} />
          </ChartCard>
        </div>
      </div>
    </DrillProvider>
  );
}