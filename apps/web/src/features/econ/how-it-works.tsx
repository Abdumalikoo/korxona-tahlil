'use client';

import { Card } from '@/components/ui/card';
import { compact, pct } from '@/features/structure/api';
import { formatPeriod } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import type { ForecastHow, ForecastResult } from './api';

// ═══════════════════════════════════════════════════════════
// «Model qanday ishlaydi» — prognozning har bir raqami qayerdan kelgani:
// bosqichlar, sinalgan modellar va ularning xatosi, har oy prognozi tarkibi,
// ehtimol oralig'i va o'tmishdagi sinov.
// ═══════════════════════════════════════════════════════════

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)';

function signed(tiyin: string | number): string {
  const v = Number(tiyin);
  if (v === 0) return '0';
  return `${v > 0 ? '+' : '−'}${compact(Math.abs(v))}`;
}

function errText(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : pct(v * 100);
}

/** Xato chizig'i: qanchalik kichik bo'lsa, shuncha yaxshi */
function ErrorBar({ value, max, chosen }: { value: number | null; max: number; chosen: boolean }) {
  if (value === null) return <span className="text-(--color-text-faint)">—</span>;
  const w = max > 0 ? Math.max(4, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-20 bg-(--color-surface-sunken) sm:block">
        <span className={cn('block h-full', chosen ? 'bg-(--color-income)' : 'bg-slate-400')} style={{ width: `${w}%` }} />
      </span>
      <span className={cn('tabular-nums', chosen && 'font-semibold text-(--color-text)')}>{errText(value)}</span>
    </span>
  );
}

function Steps({ how }: { how: ForecastHow }) {
  return (
    <ol className="grid gap-x-6 gap-y-3 md:grid-cols-2">
      {how.steps.map((s, i) => (
        <li key={s.title} className="flex gap-3">
          <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-800 text-[11px] font-bold text-white">{i + 1}</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{s.title}</span>
            <span className="mt-0.5 block text-sm leading-relaxed text-(--color-text-muted)">{s.text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function Candidates({ how }: { how: ForecastHow }) {
  if (how.candidates.length === 0) return null;
  const max = Math.max(0.0001, ...how.candidates.flatMap((c) => [c.wape ?? 0, ...c.byHorizon.map((v) => v ?? 0)]));
  return (
    <div className="overflow-x-auto rounded-(--radius-control) border border-(--color-line)">
      <table className="w-full text-sm">
        <thead className="border-b border-(--color-line) bg-(--color-surface-muted)">
          <tr>
            <th className={cn(TH, 'pl-4 text-left')}>Sinalgan model</th>
            <th className={cn(TH, 'text-right')}>1 oy oldinga</th>
            <th className={cn(TH, 'text-right')}>2 oy</th>
            <th className={cn(TH, 'text-right')}>3 oy</th>
            <th className={cn(TH, 'pr-4 text-right')}>O&apos;rtacha xato</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-(--color-line)">
          {how.candidates.map((c) => (
            <tr key={c.kind} className={cn(c.chosen && 'bg-(--color-income-soft)/50')}>
              <td className="py-2 pl-4 pr-3">
                <span className="font-medium">{c.name}</span>
                {c.chosen && <span className="ml-2 inline-flex rounded bg-(--color-income) px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">tanlandi</span>}
              </td>
              {[0, 1, 2].map((h) => (
                <td key={h} className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-(--color-text-muted)">
                  {errText(c.byHorizon[h])}
                </td>
              ))}
              <td className="whitespace-nowrap py-2 pl-3 pr-4 text-right">
                <ErrorBar value={c.wape} max={max} chosen={c.chosen} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-(--color-line) px-4 py-2 text-xs text-(--color-text-muted)">
        {how.chosenBy === 'test'
          ? "Xato — o'tmishdagi oylarga model faqat oldingi ma'lumotni ko'rib aytgan qiymat haqiqatdan qancha farq qilgani (Σ|xato| ÷ Σ|haqiqiy|). Murakkabroq model oddiyidan kamida 3% aniqroq bo'lsagina tanlanadi."
          : "Sinash uchun ma'lumot hali kam — modellar aniqlik va soddalik muvozanati (AICc) bo'yicha solishtirildi."}
      </p>
    </div>
  );
}

function Breakdown({ data, how }: { data: ForecastResult; how: ForecastHow }) {
  const { columns, rows } = how.breakdown;
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-(--radius-control) border border-(--color-line)">
      <table className="w-full text-sm">
        <thead className="border-b border-(--color-line) bg-(--color-surface-muted)">
          <tr>
            <th className={cn(TH, 'pl-4 text-left')}>Oy</th>
            {columns.map((c, i) => (
              <th key={c.key} className={cn(TH, 'text-right')} title={c.hint}>
                {i > 0 && c.key !== 'expense' ? '+ ' : ''}
                {c.label}
              </th>
            ))}
            <th className={cn(TH, 'pr-4 text-right')}>= Prognoz</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-(--color-line)">
          {rows.map((r) => (
            <tr key={r.period}>
              <td className="whitespace-nowrap py-2 pl-4 pr-3">{formatPeriod(r.period)}</td>
              {columns.map((c, i) => {
                const v = r.values[c.key] ?? '0';
                return (
                  <td key={c.key} className={cn('whitespace-nowrap px-3 py-2 text-right tabular-nums', i === 0 ? '' : 'text-(--color-text-muted)')}>
                    {i === 0 ? compact(v) : signed(v)}
                  </td>
                );
              })}
              <td className="whitespace-nowrap py-2 pl-3 pr-4 text-right font-semibold tabular-nums">
                {compact(r.meanTiyin)}
                {r.note && <span className="block max-w-[16rem] whitespace-normal text-[11px] font-normal text-amber-700">{r.note}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-(--color-line) px-4 py-2 text-xs text-(--color-text-muted)">
        {data.model.kind === 'combined'
          ? 'Natija = daromad prognozi − xarajat prognozi. Har bir tomon qanday yig\'ilgani — «Daromad» va «Xarajat» tanlovlarida.'
          : columns.map((c) => `${c.label} — ${c.hint.charAt(0).toLowerCase()}${c.hint.slice(1)}`).join('. ') + '.'}
      </p>
    </div>
  );
}

function Trust({ how }: { how: ForecastHow }) {
  const hs = how.horizon.filter((h) => h.points > 0);
  if (hs.length === 0 && !how.intervals) return null;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {hs.length > 0 && (
        <div className="rounded-(--radius-control) border border-(--color-line) p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-(--color-text-muted)">O&apos;tmishda sinov: qancha oldinga — qancha xato</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {hs.map((h) => (
              <div key={h.h} className="rounded-(--radius-control) bg-(--color-surface-muted) px-3 py-2">
                <p className="text-[11px] text-(--color-text-muted)">{h.h} oy oldinga</p>
                <p className="text-lg font-semibold tabular-nums">{errText(h.wape)}</p>
                <p className="text-[11px] text-(--color-text-faint)">{h.points} marta sinaldi</p>
              </div>
            ))}
          </div>
          {how.coverage && (
            <p className="mt-3 text-sm">
              80% oraliq: <b>{how.coverage.total}</b> oydan <b>{how.coverage.inside}</b> tasida haqiqiy qiymat oraliq ichida bo&apos;ldi
              <span className="text-(--color-text-muted)"> (kutilgani ~{Math.round(how.coverage.total * 0.8)})</span>.
            </p>
          )}
          <p className="mt-2 text-xs text-(--color-text-muted)">Uzoqroq oy — noaniqroq: shuning uchun prognoz oralig&apos;i ham oylar o&apos;tgan sari kengayadi.</p>
        </div>
      )}
      {how.intervals && (
        <div className="rounded-(--radius-control) border border-(--color-line) p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-(--color-text-muted)">Ehtimol oralig&apos;i qanday topiladi</p>
          <p className="mt-2 text-sm leading-relaxed">{how.intervals.text}</p>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div>
              <dt className="text-(--color-text-muted)">Model ichidagi σ</dt>
              <dd className="font-semibold tabular-nums">{compact(how.intervals.modelSigmaTiyin)}</dd>
            </div>
            <div>
              <dt className="text-(--color-text-muted)">Sinovdagi σ</dt>
              <dd className="font-semibold tabular-nums">{how.intervals.testSigmaTiyin ? compact(how.intervals.testSigmaTiyin) : '—'}</dd>
            </div>
            <div>
              <dt className="text-(--color-text-muted)">Ishlatilgani</dt>
              <dd className="font-semibold tabular-nums">{compact(how.intervals.usedSigmaTiyin)}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}

function Cleaned({ how }: { how: ForecastHow }) {
  if (how.cleaned.length === 0) return null;
  return (
    <div className="rounded-(--radius-control) border border-amber-300 bg-amber-50/60 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">Bir martalik sakrashlar — o&apos;rgatishda yumshatildi</p>
      <ul className="mt-2 space-y-1 text-sm">
        {how.cleaned.map((c) => (
          <li key={c.period} className="flex flex-wrap gap-x-2">
            <span className="font-medium">{formatPeriod(c.period)}:</span>
            <span>
              haqiqiy {compact(c.actualTiyin)} → model uchun {compact(c.usedTiyin)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-amber-900/80">
        Haqiqiy yozuvlar o&apos;zgarmaydi — faqat model qonuniyatni o&apos;rganayotganda bu oylar qo&apos;shni oylar darajasida olinadi, aks holda bitta
        g&apos;ayrioddiy oy prognozni surib yuborardi.
      </p>
    </div>
  );
}

/** Asosiy karta: ochiladigan bo'limlar bilan */
export function HowItWorks({ data }: { data: ForecastResult }) {
  const how = data.how;
  const [open, setOpen] = useState(true);
  if (!how) return null;
  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-3 border-b border-(--color-line) px-5 py-3.5 text-left hover:bg-(--color-surface-muted)"
        aria-expanded={open}
      >
        <span>
          <span className="block text-sm font-semibold">Model qanday ishlaydi va kelajakni qanday aytadi</span>
          <span className="mt-0.5 block text-xs text-(--color-text-muted)">
            Bosqichma-bosqich: qaysi ma&apos;lumot olindi, qaysi modellar sinaldi va nega shu tanlandi, har oy prognozi nimalardan yig&apos;iladi, oraliq
            qanday topiladi
          </span>
        </span>
        <span className="mt-0.5 text-xs font-semibold text-brand-700">{open ? 'Yopish ▲' : 'Ochish ▼'}</span>
      </button>
      {open && (
        <div className="space-y-5 px-5 py-4">
          <Steps how={how} />
          <Cleaned how={how} />
          {how.candidates.length > 0 && (
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">Modellar musobaqasi: o&apos;tmishni kim to&apos;g&apos;riroq aytdi</h4>
              <Candidates how={how} />
            </section>
          )}
          <section className="space-y-2">
            <h4 className="text-sm font-semibold">Har oy prognozi qanday yig&apos;iladi</h4>
            <Breakdown data={data} how={how} />
          </section>
          <Trust how={how} />
        </div>
      )}
    </Card>
  );
}