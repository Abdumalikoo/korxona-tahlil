'use client';

import { ExcelButton, Field, FilterBar, MoneyCell, NameCell, ReportCard, RTable, SelectBox, StatTiles, STICKY_NAME, STICKY_NO, sum, TableNote, Td, Th, Tr } from '@/components/report/report';
import { NotesList } from '@/components/report/report-extra-b';
import { LoadingCard } from '@/components/report/report-extra-c';
import { compact } from '@/features/structure/api';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { formatPeriodShort } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { Fragment, useState } from 'react';
import { type Insight, potApi, type PotentialResult, type RegionPotential, type ServicePotential, share } from './api';

// ═══════════════════════════════════════════════════════════
// Katta modellar › Salohiyat (C): har hudud va xizmat uchun barqaror oynadagi o'rtacha qiymat va
// o'rtacha o'sishdan kelib chiqqan salohiyat; prognoz va fakt bilan solishtiruv; hisob ochiq ko'rinadi.
// Ko'rinish — hisobot uslubida (Solishtirma kabi): ko'rsatkich kartalari, filtrlar qatori, jadvallar.
// ═══════════════════════════════════════════════════════════

const HORIZONS: { value: '3' | '6' | '12'; label: string }[] = [
  { value: '3', label: '3 oy' },
  { value: '6', label: '6 oy' },
  { value: '12', label: '12 oy' },
];
const n = (t: string | null | undefined) => (t ? Number(t) : 0);
const num = (x: number, d = 2) => x.toFixed(d).replace('.', ',');

function UtilBar({ u }: { u: number | null }) {
  if (u === null) return <span className="text-(--color-text-faint)">—</span>;
  const w = Math.max(0, Math.min(1.3, u)) / 1.3;
  return (
    <div className="flex items-center justify-center gap-2">
      <div className="relative h-2 w-20 rounded bg-(--color-surface-muted)">
        <div className={cn('h-2 rounded', u < 0.9 ? 'bg-amber-400' : u > 1.1 ? 'bg-emerald-500' : 'bg-brand-500')} style={{ width: `${w * 100}%` }} />
        <div className="absolute top-[-2px] h-3 w-px bg-slate-500" style={{ left: `${(1 / 1.3) * 100}%` }} />
      </div>
      <span className={cn('w-14 text-right font-semibold', u < 0.9 ? 'text-amber-700' : u > 1.1 ? 'text-(--color-income)' : 'text-heading')}>{share(u)}</span>
    </div>
  );
}

/** Avtomatik xulosalar — hisobot kartasida */
function Insights({ items }: { items: Insight[] }) {
  if (!items.length) return null;
  const cls = {
    bad: 'border-red-200 bg-red-50 text-red-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    good: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    info: 'border-sky-100 bg-sky-50/60 text-sky-900',
  };
  const icon = { bad: '▼', warn: '!', good: '▲', info: 'i' };
  return (
    <ReportCard title="Avtomatik xulosalar" badge={`${items.length} ta`}>
      <ul className="grid gap-2 px-5 pb-5 lg:grid-cols-2">
        {items.map((it, i) => (
          <li key={i} className={cn('flex gap-2.5 rounded-xl border px-3 py-2 text-sm leading-snug', cls[it.level])}>
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-white/70 text-[10px] font-bold">{icon[it.level]}</span>
            <span>{it.text}</span>
          </li>
        ))}
      </ul>
    </ReportCard>
  );
}

export function PotentialView() {
  const { month } = usePeriod();
  const [h, setH] = useState<'3' | '6' | '12'>('3');
  const [region, setRegion] = useState<number | null>(null);
  const res = useAsync(() => potApi.potential(month, Number(h)).then((r) => r.data), [month, h]);
  const d = res.data;
  const header = (
    <FilterBar>
      <Field label="Ufq (oldinga)">
        <SelectBox value={h} onChange={setH} options={HORIZONS} className="min-w-28" />
      </Field>
      {d && (
        <Field label="Hudud">
          <SelectBox
            value={region === null ? '' : String(region)}
            onChange={(v) => setRegion(v ? Number(v) : null)}
            options={[{ value: '', label: 'Barcha hududlar' }, ...d.regions.map((r) => ({ value: String(r.code), label: r.name }))]}
            className="w-60"
          />
        </Field>
      )}
      <p className="max-w-xl pb-2 text-xs leading-relaxed text-(--color-text-muted)">
        {d ? `${d.lastLabel} gacha yuklangan daromad asosida · barqaror oyna o'rtachasi × o'rtacha o'sish` : "Hududlar qancha daromad keltira oladi — yuklangan ma'lumotdan"}
      </p>
    </FilterBar>
  );
  if (res.error || !d) {
    return (
      <div className="space-y-4">
        {header}
        <LoadingCard label="Barqaror oynalar va uzilishlar aniqlanmoqda" error={res.error} onRetry={res.reload} />
      </div>
    );
  }
  const sel = region === null ? null : (d.regions.find((r) => r.code === region) ?? null);
  const t = sel ? { actual: sel.actualLastTiyin, fitted: sel.fittedLastTiyin, util: sel.utilization, ahead: sel.aheadSeasonal, annual: sel.ahead, forecast: sel.forecast } : { actual: d.total.actualLastTiyin, fitted: d.total.fittedLastTiyin, util: d.total.utilization, ahead: d.total.aheadSeasonal, annual: d.total.ahead, forecast: d.total.forecast };
  const below = d.regions.filter((r) => r.utilization !== null && r.utilization < 0.9).length;
  const gap0 = n(t.forecast[0]) - n(t.ahead[0]);
  return (
    <div className="space-y-4">
      <StatTiles
        items={[
          {
            label: `Salohiyat · ${d.periodLabels[0]}`,
            value: n(t.ahead[0]),
            tone: 'blue',
            note: `davr jami ${compact(String(t.ahead.reduce((s, v) => s + n(v), 0)))}${t.annual[0] !== t.ahead[0] ? ` · mavsumsiz ${compact(t.annual[0]!)}` : ''}`,
          },
          { label: `Prognoz · ${d.periodLabels[0]}`, value: n(t.forecast[0]), tone: gap0 < 0 ? 'orange' : 'purple', note: `salohiyatga nisbatan ${share(n(t.ahead[0]) ? gap0 / n(t.ahead[0]) : null, true)}` },
          { label: `Fakt · ${d.lastLabel}`, value: n(t.actual), tone: 'green', note: `barqaror daraja ${compact(t.fitted)}` },
          { label: 'Foydalanish', value: 0, text: share(t.util), tone: t.util !== null && t.util < 0.9 ? 'orange' : 'cyan', note: sel ? 'fakt ÷ barqaror daraja' : `${below} ta hudud 90% dan past` },
        ]}
      />
      {header}
      <Insights items={sel ? d.insights.filter((i) => i.regionCode === sel.code || i.regionCode === null) : d.insights} />
      {sel ? <RegionServices d={d} r={sel} /> : <RegionTable d={d} onSelect={setRegion} />}
      <ReportCard title="Qanday hisoblanadi">
        <NotesList notes={d.method} />
      </ReportCard>
    </div>
  );
}

function RegionTable({ d, onSelect }: { d: PotentialResult; onSelect: (c: number) => void }) {
  return (
    <ReportCard
      title="Hududlar salohiyati"
      badge={`${formatPeriodShort(d.lastActual)} fakt · ${d.periods.length} oy oldinga`}
      actions={
        <ExcelButton
          label="CSV"
          onClick={() =>
            downloadCsv(
              `Salohiyat-${d.lastActual}.csv`,
              ['Hudud', `Fakt ${d.lastLabel}`, 'Barqaror daraja', 'Foydalanish %', ...d.periodLabels.map((p) => `Salohiyat ${p}`), ...d.periodLabels.map((p) => `Prognoz ${p}`)],
              d.regions.map((r) => [r.name, csvSom(r.actualLastTiyin), csvSom(r.fittedLastTiyin), r.utilization === null ? '' : (r.utilization * 100).toFixed(1).replace('.', ','), ...r.aheadSeasonal.map(csvSom), ...r.forecast.map(csvSom)]),
              [],
            )
          }
        />
      }
    >
      <RTable minWidth={1040}>
        <thead>
          <tr>
            <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
            <Th className={cn(STICKY_NAME, 'z-[2] min-w-44 text-left')}>Hudud</Th>
            <Th>{formatPeriodShort(d.lastActual)} fakt</Th>
            <Th>Barqaror daraja</Th>
            <Th>Foydalanish</Th>
            {d.periods.map((p) => (
              <Th key={p}>Salohiyat {formatPeriodShort(p)}</Th>
            ))}
            <Th>Prognoz {formatPeriodShort(d.periods[0]!)}</Th>
            <Th>Uzilishlar</Th>
          </tr>
        </thead>
        <tbody>
          {d.regions.map((r, idx) => {
            const det = r.services.reduce((s, x) => s + x.breaks.filter((b) => b.source === 'DETECTED').length, 0);
            const ev = r.services.reduce((s, x) => s + x.breaks.filter((b) => b.source === 'EVENT').length, 0);
            const gap = n(r.forecast[0]) - n(r.aheadSeasonal[0]);
            return (
              <Tr key={r.code} onClick={() => onSelect(r.code)} className={cn(!r.hasData && 'opacity-50')}>
                <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{idx + 1}</Td>
                <NameCell drill>{r.name}</NameCell>
                <MoneyCell value={n(r.actualLastTiyin)} />
                <MoneyCell value={n(r.fittedLastTiyin)} className="text-(--color-text-muted)" />
                <Td>
                  <UtilBar u={r.utilization} />
                </Td>
                {r.aheadSeasonal.map((v, i) => (
                  <Td key={i} className={cn('whitespace-nowrap', i === 0 && 'font-semibold')} title={`Yillik daraja (mavsumsiz): ${sum(n(r.ahead[i]))}`}>
                    {sum(n(v))}
                    {v !== r.ahead[i] && <div className="text-[10px] font-normal text-(--color-text-muted)">mavsumsiz {sum(n(r.ahead[i]))}</div>}
                  </Td>
                ))}
                <Td className="whitespace-nowrap">
                  {sum(n(r.forecast[0]))}
                  {n(r.aheadSeasonal[0]) > 0 && <div className={cn('text-[11px] font-semibold', gap < 0 ? 'text-amber-700' : 'text-(--color-income)')}>{share(gap / n(r.aheadSeasonal[0]), true)}</div>}
                </Td>
                <Td className="whitespace-nowrap text-xs text-(--color-text-muted)">
                  {ev > 0 && <span className="mr-1.5 rounded-full bg-slate-100 px-2 py-0.5">jurnal: {ev}</span>}
                  {det > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">avtomatik: {det}</span>}
                  {!ev && !det && '—'}
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </RTable>
      <TableNote>Summalar — so&apos;mda. Foydalanish — fakt ÷ barqaror daraja (chiziq — 100%). Prognoz ostida — salohiyatga nisbatan farq. Qatorni bosing — xizmatlar va hisob ochiladi.</TableNote>
    </ReportCard>
  );
}

function RegionServices({ d, r }: { d: PotentialResult; r: RegionPotential }) {
  const [open, setOpen] = useState<string | null>(r.services[0]?.key ?? null);
  return (
    <ReportCard title={`${r.name}: xizmatlar bo'yicha salohiyat`} badge="Qatorni bosing — hisob bosqichma-bosqich ochiladi">
      <RTable minWidth={1120}>
        <thead>
          <tr>
            <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
            <Th className={cn(STICKY_NAME, 'z-[2] min-w-48 text-left')}>Xizmat</Th>
            <Th>Barqaror oyna</Th>
            <Th>Ȳ (o&apos;rtacha)</Th>
            <Th>g (oyiga)</Th>
            <Th title="Variatsiya koeffitsienti σ ÷ Ȳ">Tebranish</Th>
            <Th>Foydalanish</Th>
            {d.periods.map((p) => (
              <Th key={p}>{formatPeriodShort(p)}</Th>
            ))}
            <Th>Prognoz</Th>
          </tr>
        </thead>
        <tbody>
          {r.services.map((s, idx) => (
            <Fragment key={s.key}>
              <Tr onClick={() => setOpen(open === s.key ? null : s.key)} className={cn(open === s.key && 'bg-brand-50!')}>
                <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{idx + 1}</Td>
                <NameCell drill>{s.label}</NameCell>
                <Td className="min-w-[170px] text-xs">
                  <span className="whitespace-nowrap">
                    {formatPeriodShort(s.window.from)} – {formatPeriodShort(s.window.to)} · {s.window.n} oy
                  </span>
                  <div className={cn('text-[11px]', s.window.reason === 'DETECTED' ? 'text-amber-700' : 'text-(--color-text-muted)')}>{s.window.reasonText}</div>
                </Td>
                <MoneyCell value={n(s.meanTiyin)} />
                <Td className={cn('whitespace-nowrap font-semibold', s.growth < 0 ? 'text-(--color-expense)' : 'text-heading')}>{share(s.growth, true)}</Td>
                <Td className={cn('whitespace-nowrap', !s.stable && 'font-semibold text-amber-700')}>{s.cv === null ? '—' : share(s.cv)}</Td>
                <Td>
                  <UtilBar u={s.utilization} />
                </Td>
                {s.aheadSeasonal.map((v, i) => (
                  <Td key={i} className={cn('whitespace-nowrap', i === 0 && 'font-semibold')} title={s.seasonal ? `Mavsum indeksi ${s.seasonal.ahead[i]!.toFixed(2).replace('.', ',')}; yillik daraja ${sum(n(s.ahead[i]))}` : undefined}>
                    {sum(n(v))}
                    {s.seasonal && <div className="text-[10px] font-normal text-(--color-text-muted)">×{s.seasonal.ahead[i]!.toFixed(2).replace('.', ',')}</div>}
                  </Td>
                ))}
                <MoneyCell value={n(s.forecast[0])} className="text-(--color-text-muted)" />
              </Tr>
              {open === s.key && (
                <Tr muted>
                  <Td colSpan={8 + d.periods.length} className="px-5 py-3 text-left text-sm">
                    <Workings s={s} d={d} />
                  </Td>
                </Tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </RTable>
      <TableNote>Summalar — so&apos;mda. Ȳ — barqaror oynadagi o&apos;rtacha oylik daromad, g — o&apos;rtacha oylik o&apos;sish; sariq tebranish — beqaror xizmat. Oy ustunlari ostida — mavsum indeksi.</TableNote>
    </ReportCard>
  );
}

/** Hisob: oyna qiymatlari → Ȳ → g → salohiyat */
function Workings({ s, d }: { s: ServicePotential; d: PotentialResult }) {
  const vals = s.windowValues.map((v) => n(v.valueTiyin));
  const max = Math.max(...vals, 1);
  const growths = vals.slice(1).map((v, i) => (vals[i]! > 0 ? v / vals[i]! - 1 : null));
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
      <div>
        <p className="mb-2 text-xs font-semibold text-heading">Barqaror oyna ({s.window.n} oy)</p>
        <div className="flex h-24 items-end gap-1">
          {s.windowValues.map((v) => (
            <div key={v.period} className="flex flex-1 flex-col items-center gap-1" title={`${formatPeriodShort(v.period)}: ${compact(v.valueTiyin)}`}>
              <div className="w-full rounded-t bg-brand-400" style={{ height: `${(n(v.valueTiyin) / max) * 80}px` }} />
              <span className="text-[9px] text-(--color-text-muted)">{formatPeriodShort(v.period)}</span>
            </div>
          ))}
        </div>
        {s.breaks.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-[11px]">
            {s.breaks.map((b) => (
              <li key={b.period + b.source} className={b.source === 'DETECTED' ? 'text-amber-800' : 'text-(--color-text-muted)'}>
                {formatPeriodShort(b.period)}: {b.source === 'DETECTED' ? 'avtomatik uzilish' : 'jurnal'} — {b.text}
              </li>
            ))}
          </ul>
        )}
        {s.notes.map((x) => (
          <p key={x} className="mt-1 text-[11px] text-sky-800">↳ {x}</p>
        ))}
      </div>
      <div className="space-y-1.5 text-xs leading-relaxed">
        <p>
          <b>Ȳ</b> = ({s.windowValues.map((v) => compact(v.valueTiyin)).join(' + ')}) ÷ {s.window.n} = <b>{compact(s.meanTiyin)}</b>
        </p>
        <p>
          <b>g</b> ={' '}
          {s.growthMethod === 'YOY'
            ? "(oxirgi 12 oy ÷ oldingi 12 oy)^(1/12) − 1 — mavsumdan xoli yillik solishtiruv"
            : s.growthMethod === 'TREND'
              ? "log-chiziqli trend bo'yicha o'rtacha oylik o'zgarish"
              : "oy-oy o'sishlar o'rtachasi"}{' '}
          = <b>{share(s.growth, true)}</b> oyiga
          <span className="text-(--color-text-muted)"> (oy-oy: {growths.map((g) => (g === null ? '—' : share(g, true))).join('; ') || '—'})</span>
        </p>
        <p>
          Ȳ oynaning o&apos;rtasiga ({num(s.exponent, 1)}-oy) tegishli, shuning uchun {d.periodLabels[0]} uchun daraja ko&apos;rsatkichi {num(s.exponent, 1)}:
        </p>
        <p>
          <b>Salohiyat</b> = {compact(s.meanTiyin)} × (1 {s.growth < 0 ? '−' : '+'} {num(Math.abs(s.growth) * 100, 2)}%)<sup>{num(s.exponent, 1)}</sup> = <b>{compact(s.ahead[0]!)}</b>
          {s.seasonal ? ' (yillik daraja)' : ''}
        </p>
        {s.seasonal && (
          <p>
            <b>Mavsum</b>: {d.periodLabels[0]} indeksi {num(s.seasonal.ahead[0]!, 2)} (oxirgi ikki yilda shu oy ÷ yil o&apos;rtachasi) → shu oy uchun salohiyat ={' '}
            <b>
              {compact(s.ahead[0]!)} × {num(s.seasonal.ahead[0]!, 2)} = {compact(s.aheadSeasonal[0]!)}
            </b>
          </p>
        )}
        <p className="text-(--color-text-muted)">
          {d.lastLabel} uchun barqaror daraja {compact(s.fittedLastSeasonalTiyin)}{s.seasonal ? ` (mavsum ×${num(s.seasonal.last, 2)})` : ''}, fakt {compact(s.actualLastTiyin)} → foydalanish {share(s.utilization)}. Tebranish {s.cv === null ? '—' : share(s.cv)}
          {s.stable ? ' — barqaror.' : " — beqaror, salohiyat ehtiyotkorlik bilan."}
        </p>
      </div>
    </div>
  );
}