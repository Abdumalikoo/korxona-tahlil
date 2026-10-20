'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import { Drawer } from '@/components/ui/drawer';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { compact, pct, som, TONE, type SectionFilter } from '@/features/structure/api';
import { SearchBox, SmallButton } from '@/features/structure/parts';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { formatDate, formatPeriodShort } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { regionsApi, SOURCE_LABELS, type UnassignedGroup, type UnassignedItem, type UnassignedResult, type UnassignedSide } from './api';

// ═══════════════════════════════════════════════════════════
// «Hududga biriktirilmagan» — ichida nima bor.
// Yozuvlarda hudud ham, Markaz bo'limi ham ko'rsatilmagan. Panel:
//   • jami xarajat / daromad, oylar bo'yicha;
//   • nimadan iborat: moddalar, manba (qo'lda / fayldan / …), fayllar — bosilsa ro'yxat shu bo'yicha saralanadi;
//   • yozuvlar ro'yxati: sana, modda, kontragent / izoh, manba, summa — qidiruv va CSV bilan.
// Raqamlar Solishtirmadagi «Biriktirilmagan» qatori bilan aynan bir xil (bir xil tanlov).
// ═══════════════════════════════════════════════════════════

type Side = 'expense' | 'income';
type Facet = { kind: 'category' | 'source' | 'file'; key: string; label: string } | null;

const PAGE = 100;

export function UnassignedDrawer({ open, onClose, range, section }: { open: boolean; onClose: () => void; range: DateRange; section: SectionFilter }) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title="Hududga biriktirilmagan yozuvlar"
      description={`${formatDate(range.from)} — ${formatDate(range.to)} · hududi ham, Markaz bo'limi ham ko'rsatilmagan`}
    >
      {open && <Body range={range} section={section} />}
    </Drawer>
  );
}

function Body({ range, section }: { range: DateRange; section: SectionFilter }) {
  const result = useAsync(() => regionsApi.unassigned(range, section).then((r) => r.data), [range.from, range.to, section]);
  const data = result.data;
  if (result.error) return <ErrorState message={result.error} onRetry={result.reload} />;
  if (!data) return <LoadingState label="Yozuvlar yuklanmoqda" />;
  return <Content data={data} />;
}

function Content({ data }: { data: UnassignedResult }) {
  const expense = Number(data.expense.totalTiyin);
  const income = Number(data.income.totalTiyin);
  const [side, setSide] = useState<Side>(expense > 0 || income === 0 ? 'expense' : 'income');
  const [facet, setFacet] = useState<Facet>(null);
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const current: UnassignedSide = data[side];
  const policy = Number(data.policyExcludedTiyin);

  const switchSide = (s: Side) => {
    setSide(s);
    setFacet(null);
    setQuery('');
    setShown(PAGE);
  };
  const pick = (f: Facet) => {
    setFacet((old) => (old && f && old.kind === f.kind && old.key === f.key ? null : f));
    setShown(PAGE);
  };

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return current.items.filter((it) => {
      if (facet?.kind === 'category' && it.categoryCode !== facet.key) return false;
      if (facet?.kind === 'source' && it.source !== facet.key) return false;
      if (facet?.kind === 'file' && it.fileName !== facet.label) return false;
      if (!q) return true;
      return [it.categoryLabel, it.counterparty, it.description, it.documentNo, it.fileName, formatDate(it.date)].some((v) => v && v.toLowerCase().includes(q));
    });
  }, [current, facet, query]);
  const itemsTotal = items.reduce((a, it) => a + Number(it.amountTiyin), 0);

  const csv = () => {
    downloadCsv(
      `biriktirilmagan-${side === 'expense' ? 'xarajat' : 'daromad'}_${data.range.from}_${data.range.to}.csv`,
      ['Sana', 'Modda', side === 'expense' ? 'Kontragent' : 'Mijoz', 'Izoh', side === 'expense' ? 'Hujjat №' : 'Shartnoma №', 'Manba', 'Fayl', "Bo'lim", "Summa (so'm)"],
      items.map((it) => [it.date, it.categoryLabel, it.counterparty, it.description, it.documentNo, SOURCE_LABELS[it.source] ?? it.source, it.fileName, it.section === 'BOSHQA' ? 'Boshqa' : 'Doimiy', csvSom(it.amountTiyin)]),
    );
  };

  if (data.expense.count === 0 && data.income.count === 0) {
    return (
      <div className="rounded-xl border border-dashed border-(--color-line) px-6 py-10 text-center">
        <p className="text-base font-semibold text-heading">Bu davrda biriktirilmagan yozuv yo&apos;q</p>
        <p className="mt-1 text-sm text-(--color-text-muted)">Barcha daromad va xarajatlar hududga yoki Markazga yozilgan.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Jami */}
      <div className="grid gap-3 sm:grid-cols-2">
        <SideTile active={side === 'expense'} onClick={() => switchSide('expense')} label="Xarajat" total={expense} count={data.expense.count} color={TONE.expense} soft={TONE.expenseSoft} />
        <SideTile active={side === 'income'} onClick={() => switchSide('income')} label="Daromad" total={income} count={data.income.count} color={TONE.income} soft={TONE.incomeSoft} />
      </div>

      <div className="rounded-lg bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900 ring-1 ring-amber-200">
        Bu yozuvlarda <b>hudud</b> ham, <b>Markaz bo&apos;limi</b> ham ko&apos;rsatilmagan — shuning uchun hech bir hudud yoki Markaz hisobiga tushmagan, faqat korxona jamida
        turibdi. To&apos;g&apos;rilash uchun yozuvni{' '}
        <Link href={side === 'expense' ? '/xarajatlar' : '/daromadlar'} className="font-semibold underline">
          {side === 'expense' ? 'Xarajatlar' : 'Daromadlar'}
        </Link>{' '}
        ro&apos;yxatida oching va hududini tanlang.
        {policy > 0 && (
          <span className="mt-1 block text-amber-800/80">
            Hududsiz yozilgan yana {compact(policy)} xarajat bu ro&apos;yxatda yo&apos;q — u Xarajatlar siyosati bo&apos;yicha Markaz xarajatiga o&apos;tgan.
          </span>
        )}
      </div>

      {current.count > 0 && (
        <>
          {data.months.length > 1 && <Months data={data} side={side} />}

          {/* Nimadan iborat */}
          <section>
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">Nimadan iborat — moddalar</h4>
            <GroupBars groups={current.byCategory} total={Number(current.totalTiyin)} color={side === 'expense' ? TONE.expense : TONE.income} active={facet?.kind === 'category' ? facet.key : null} onPick={(g) => pick({ kind: 'category', key: g.key, label: g.label })} />
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">Qayerdan kelgan</h4>
              <Chips groups={current.bySource.map((g) => ({ ...g, label: SOURCE_LABELS[g.key] ?? g.label }))} active={facet?.kind === 'source' ? facet.key : null} onPick={(g) => pick({ kind: 'source', key: g.key, label: g.label })} />
            </div>
            {current.byFile.length > 0 && (
              <div>
                <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">Fayllar</h4>
                <Chips groups={current.byFile} active={facet?.kind === 'file' ? facet.key : null} onPick={(g) => pick({ kind: 'file', key: g.key, label: g.label })} />
              </div>
            )}
          </section>

          {/* Ro'yxat */}
          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">
                Yozuvlar {facet && <span className="normal-case tracking-normal text-(--color-text)">· {facet.label}</span>}
              </h4>
              <div className="flex items-center gap-2">
                {facet && <SmallButton onClick={() => setFacet(null)}>Filtrni olib tashlash ×</SmallButton>}
                <SmallButton onClick={csv}>CSV</SmallButton>
              </div>
            </div>
            <SearchBox skipFocus value={query} onChange={(v) => { setQuery(v); setShown(PAGE); }} placeholder={side === 'expense' ? 'Modda, kontragent, izoh, hujjat…' : 'Modda, mijoz, izoh, shartnoma…'} />
            <p className="mt-2 text-xs text-(--color-text-muted)">
              {items.length} ta yozuv · <b className="tabular-nums text-(--color-text)">{som(itemsTotal)}</b>
              {current.truncated && !facet && !query && ` · eng katta ${current.items.length} tasi ko'rsatilgan (jami ${current.count} ta)`}
            </p>
            <ItemsTable items={items.slice(0, shown)} side={side} />
            {items.length > shown && (
              <div className="mt-2 text-center">
                <SmallButton onClick={() => setShown((n) => n + PAGE)}>Yana {Math.min(PAGE, items.length - shown)} ta ko&apos;rsatish</SmallButton>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function SideTile({ active, onClick, label, total, count, color, soft }: { active: boolean; onClick: () => void; label: string; total: number; count: number; color: string; soft: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('rounded-xl border px-4 py-3 text-left transition-all', active ? 'shadow-sm' : 'border-(--color-line) opacity-80 hover:opacity-100')}
      style={active ? { borderColor: color, background: soft } : undefined}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color }}>
        {label}
      </span>
      <span className="mt-0.5 block text-2xl font-bold tabular-nums tracking-tight text-heading" title={som(total)}>
        {compact(total)}
      </span>
      <span className="text-xs text-(--color-text-muted)">{count} ta yozuv</span>
    </button>
  );
}

function GroupBars({ groups, total, color, active, onPick }: { groups: UnassignedGroup[]; total: number; color: string; active: string | null; onPick: (g: UnassignedGroup) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? groups : groups.slice(0, 8);
  const max = Math.max(1, ...groups.map((g) => Number(g.totalTiyin)));
  return (
    <div className="space-y-1">
      {shown.map((g) => {
        const v = Number(g.totalTiyin);
        const on = active === g.key;
        return (
          <button
            type="button"
            key={g.key}
            onClick={() => onPick(g)}
            className={cn('grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-(--color-surface-muted)', on && 'bg-(--color-surface-muted) ring-1 ring-(--color-line-strong)')}
            title={`${g.label}: ${som(v)} · ${g.count} ta yozuv`}
          >
            <span className="min-w-0">
              <span className={cn('block truncate', on && 'font-semibold')}>{g.label}</span>
              <span className="mt-1 flex items-center gap-2">
                <span className="h-1.5 max-w-[16rem] flex-1 overflow-hidden rounded-full bg-(--color-surface-muted)">
                  <span className="block h-full rounded-full" style={{ width: `${(Math.max(0, v) / max) * 100}%`, background: color, opacity: on ? 1 : 0.7 }} />
                </span>
                <span className="shrink-0 text-[11px] text-(--color-text-faint)">{g.count} ta yozuv</span>
              </span>
            </span>
            <span className="text-right tabular-nums">
              <b className="font-semibold">{compact(v)}</b>
              <span className="ml-1.5 inline-block w-11 text-[11px] text-(--color-text-faint)">{total > 0 ? pct((v / total) * 100) : ''}</span>
            </span>
          </button>
        );
      })}
      {groups.length > 8 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="px-2 text-xs font-medium text-brand-700 hover:underline">
          {all ? 'Qisqartirish' : `Yana ${groups.length - 8} ta modda`}
        </button>
      )}
    </div>
  );
}

function Chips({ groups, active, onPick }: { groups: UnassignedGroup[]; active: string | null; onPick: (g: UnassignedGroup) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {groups.map((g) => (
        <button
          type="button"
          key={g.key}
          onClick={() => onPick(g)}
          className={cn(
            'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
            active === g.key ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-(--color-line) hover:border-brand-300 hover:bg-brand-50/50',
          )}
          title={`${g.label}: ${som(g.totalTiyin)}`}
        >
          <span className="truncate">{g.label}</span>
          <b className="tabular-nums">{compact(g.totalTiyin)}</b>
          <span className="text-(--color-text-faint)">· {g.count}</span>
        </button>
      ))}
    </div>
  );
}

function Months({ data, side }: { data: UnassignedResult; side: Side }) {
  const key = side === 'expense' ? 'expenseTiyin' : 'incomeTiyin';
  const max = Math.max(1, ...data.months.map((m) => Number(m[key])));
  const color = side === 'expense' ? TONE.expense : TONE.income;
  return (
    <section>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">Oylar bo&apos;yicha</h4>
      <div className="flex h-24 items-end gap-1">
        {data.months.map((m) => {
          const v = Number(m[key]);
          return (
            <div key={m.period} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${formatPeriodShort(m.period)}: ${som(v)}`}>
              <span className="text-[10px] tabular-nums text-(--color-text-faint)">{v > 0 ? compact(v) : ''}</span>
              <span className="w-full max-w-10 rounded-t" style={{ height: `${Math.max(v > 0 ? 3 : 0, (v / max) * 56)}px`, background: color, opacity: 0.75 }} />
              <span className="truncate text-[10px] text-(--color-text-muted)">{formatPeriodShort(m.period).split(' ')[0]}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ItemsTable({ items, side }: { items: UnassignedItem[]; side: Side }) {
  if (items.length === 0) return <p className="mt-3 rounded-lg border border-dashed border-(--color-line) px-4 py-6 text-center text-sm text-(--color-text-muted)">Mos yozuv topilmadi</p>;
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-(--color-line)">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="bg-(--color-surface-muted) text-left text-[10.5px] font-semibold uppercase tracking-wider text-(--color-text-muted)">
            <th className="px-3 py-2">Sana</th>
            <th className="px-3 py-2">Modda</th>
            <th className="px-3 py-2">{side === 'expense' ? 'Kontragent / izoh' : 'Mijoz / izoh'}</th>
            <th className="px-3 py-2">Manba</th>
            <th className="px-3 py-2 text-right">Summa</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-t border-(--color-line) align-top hover:bg-(--color-surface-muted)/60">
              <td className="whitespace-nowrap px-3 py-2 tabular-nums text-(--color-text-muted)">{formatDate(it.date)}</td>
              <td className="max-w-[14rem] px-3 py-2">
                <span className="line-clamp-2">{it.categoryLabel}</span>
                {it.section === 'BOSHQA' && <span className="text-[10.5px] text-(--color-text-faint)">Boshqa</span>}
              </td>
              <td className="max-w-[16rem] px-3 py-2">
                {it.counterparty && <span className="block truncate font-medium" title={it.counterparty}>{it.counterparty}</span>}
                {it.description && <span className="line-clamp-2 text-xs text-(--color-text-muted)" title={it.description}>{it.description}</span>}
                {it.documentNo && <span className="block text-[10.5px] text-(--color-text-faint)">№ {it.documentNo}</span>}
                {!it.counterparty && !it.description && !it.documentNo && <span className="text-(--color-text-faint)">—</span>}
              </td>
              <td className="px-3 py-2 text-xs">
                <span className="whitespace-nowrap">{SOURCE_LABELS[it.source] ?? it.source}</span>
                {it.fileName && <span className="block max-w-[10rem] truncate text-[10.5px] text-(--color-text-faint)" title={it.fileName}>{it.fileName}</span>}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums" title={som(it.amountTiyin)}>
                {compact(it.amountTiyin)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}