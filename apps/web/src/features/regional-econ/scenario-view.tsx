'use client';

import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { FIELD } from '@/features/purchases/bits';
import { compact } from '@/features/structure/api';
import { KpiStrip, PanelHeader, Segmented, SmallButton } from '@/features/structure/parts';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { dashApi, type Levers, type ScenarioResult, share } from './api';

// ═══════════════════════════════════════════════════════════
// Katta modellar › Hudud stsenariysi (I): «agar … bo'lsa» — tarif, hajm, maosh, xodimlar, xarajat, Markaz.
// Asos — Hudud prognozi. Hech narsa saqlanmaydi: faqat hisob.
// ═══════════════════════════════════════════════════════════

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)';
const n = (t: string | null | undefined) => (t ? Number(t) : 0);
const HORIZONS = [
  { value: '3', label: '3 oy' },
  { value: '6', label: '6 oy' },
  { value: '12', label: '12 oy' },
];

/** Formadagi qiymatlar (foizlar — foizda, pul — so'mda) */
interface Form {
  regionCode: string;
  start: string;
  tariff: string;
  tariffService: string;
  elasticity: string;
  volume: string;
  wage: string;
  headcount: string;
  opex: string;
  oneTime: string;
  central: string;
}
const EMPTY: Form = { regionCode: '', start: '0', tariff: '', tariffService: '', elasticity: '', volume: '', wage: '', headcount: '', opex: '', oneTime: '', central: '' };

const PRESETS: { label: string; form: Partial<Form> }[] = [
  { label: 'Tarif +10%', form: { tariff: '10' } },
  { label: 'Tarif +10%, talab −0,3', form: { tariff: '10', elasticity: '-0,3' } },
  { label: 'Maosh indeksatsiyasi +15%', form: { wage: '15' } },
  { label: 'Hajm −10% (inqiroz)', form: { volume: '-10' } },
  { label: 'Markaz xarajati −10%', form: { central: '-10' } },
];

const num = (s: string) => {
  const v = Number(s.replace(/\s/g, '').replace(',', '.'));
  return s.trim() === '' || !Number.isFinite(v) ? 0 : v;
};

function toLevers(f: Form): Partial<Levers> {
  return {
    regionCode: f.regionCode ? Number(f.regionCode) : null,
    start: Number(f.start) || 0,
    tariffPct: num(f.tariff) / 100,
    tariffService: f.tariffService || null,
    elasticity: num(f.elasticity),
    volumePct: num(f.volume) / 100,
    wagePct: num(f.wage) / 100,
    headcount: Math.round(num(f.headcount)),
    opexPct: num(f.opex) / 100,
    oneTimeTiyin: Math.round(num(f.oneTime) * 100),
    centralPct: num(f.central) / 100,
  };
}

export function RegionScenarioView() {
  const { month } = usePeriod();
  const [h, setH] = useState('6');
  const [form, setForm] = useState<Form>(EMPTY);
  const [applied, setApplied] = useState<Form>(EMPTY);
  // Kiritish to'xtagach 0,6 soniyada qayta hisoblash
  useEffect(() => {
    const t = setTimeout(() => setApplied(form), 600);
    return () => clearTimeout(t);
  }, [form]);
  const levers = JSON.stringify(toLevers(applied));
  const res = useAsync(() => dashApi.scenario(month, Number(h), JSON.parse(levers) as Partial<Levers>).then((r) => r.data), [month, h, levers]);
  const d = res.data;
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((s) => ({ ...s, [k]: e.target.value }));
  return (
    <div className="space-y-4">
      <PanelHeader
        title="Hudud stsenariysi"
        description="«Agar … bo'lsa» — dastaklarni o'zgartiring, natija prognoz ustida darhol qayta hisoblanadi"
        actions={<Segmented value={h} onChange={setH} options={HORIZONS} size="sm" />}
      >
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <SmallButton key={p.label} onClick={() => setForm({ ...EMPTY, regionCode: form.regionCode, start: form.start, ...p.form })}>
              {p.label}
            </SmallButton>
          ))}
          <SmallButton onClick={() => setForm(EMPTY)}>Tozalash</SmallButton>
        </div>
      </PanelHeader>

      <Card>
        <div className="grid gap-x-4 gap-y-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Hudud">
            <select value={form.regionCode} onChange={set('regionCode')} className={FIELD}>
              <option value="">Barcha hududlar</option>
              {d?.regions.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Qaysi oydan">
            <select value={form.start} onChange={set('start')} className={FIELD}>
              {(d?.periodLabels ?? []).map((p, i) => (
                <option key={p} value={i}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tarif, %" hint="+10 — 10% oshirish">
            <input value={form.tariff} onChange={set('tariff')} inputMode="decimal" placeholder="0" className={FIELD} />
          </Field>
          <Field label="Qaysi xizmat tarifi">
            <select value={form.tariffService} onChange={set('tariffService')} className={FIELD}>
              <option value="">Barcha xizmatlar</option>
              {d?.services.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Talab elastikligi" hint="−0,3: narx +10% → hajm −3%">
            <input value={form.elasticity} onChange={set('elasticity')} inputMode="decimal" placeholder="0" className={FIELD} />
          </Field>
          <Field label="Xizmatlar hajmi, %">
            <input value={form.volume} onChange={set('volume')} inputMode="decimal" placeholder="0" className={FIELD} />
          </Field>
          <Field label="Maosh indeksatsiyasi, %">
            <input value={form.wage} onChange={set('wage')} inputMode="decimal" placeholder="0" className={FIELD} />
          </Field>
          <Field label="Xodimlar soni ±" hint="hudud o'rtacha ish haqi bilan">
            <input value={form.headcount} onChange={set('headcount')} inputMode="numeric" placeholder="0" className={FIELD} />
          </Field>
          <Field label="Xarajat, %">
            <input value={form.opex} onChange={set('opex')} inputMode="decimal" placeholder="0" className={FIELD} />
          </Field>
          <Field label="Bir martalik xarajat, so'm" hint="boshlanish oyiga, har tanlangan hududga">
            <input value={form.oneTime} onChange={set('oneTime')} inputMode="decimal" placeholder="0" className={FIELD} />
          </Field>
          <Field label="Markaz xarajati, %">
            <input value={form.central} onChange={set('central')} inputMode="decimal" placeholder="0" className={FIELD} />
          </Field>
        </div>
      </Card>

      {res.error ? (
        <Card><ErrorState message={res.error} onRetry={res.reload} /></Card>
      ) : !d ? (
        <Card><LoadingState label="Hisoblanmoqda" /></Card>
      ) : (
        <Results d={d} />
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-heading">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-(--color-text-muted)">{hint}</span>}
    </label>
  );
}

function Results({ d }: { d: ScenarioResult }) {
  const tb = (k: 'revenue' | 'payroll' | 'opex' | 'overhead' | 'result') => d.months.reduce((s, m) => s + n(m.base[k]), 0);
  const delta = (k: 'revenue' | 'payroll' | 'opex' | 'overhead' | 'result') => n(d.delta[k]);
  const rows = [...d.regions].sort((a, b) => n(a.deltaTiyin) - n(b.deltaTiyin));
  return (
    <>
      <Card className="border-l-4 border-l-brand-500">
        <div className="space-y-1 px-5 py-3 text-sm">
          {d.narrative.map((x) => (
            <p key={x}>{x}</p>
          ))}
        </div>
      </Card>
      <KpiStrip
        items={(['revenue', 'payroll', 'opex', 'result'] as const).map((k) => ({
          label: { revenue: 'Daromad', payroll: 'Ish haqi', opex: 'Xarajat', result: 'Natija (Markaz bilan)' }[k] + ` · ${d.horizon} oy`,
          value: `${delta(k) > 0 ? '+' : ''}${compact(String(delta(k)))}`,
          valueClass: delta(k) === 0 ? 'text-heading' : (k === 'revenue' || k === 'result' ? delta(k) > 0 : delta(k) < 0) ? 'text-(--color-income)' : 'text-(--color-expense)',
          sub: `asos ${compact(String(tb(k)))} → ${compact(String(tb(k) + delta(k)))}`,
        }))}
      />
      <Card>
        <div className="px-5 pt-4">
          <h3 className="text-sm font-bold text-heading">Natija oylar bo&apos;yicha: asos va stsenariy</h3>
        </div>
        <div className="px-3 pb-3">
          <Bars d={d} />
        </div>
      </Card>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-(--color-line) px-5 py-2.5">
          <p className="text-xs text-(--color-text-muted)">Hududlar: davr natijasi, zarar ehtimoli (eng yuqori oy) va zararsizlik uchun kerakli tarif</p>
          <SmallButton
            onClick={() =>
              downloadCsv(
                `Stsenariy-${d.lastActual}.csv`,
                ['Hudud', ...d.periodLabels.flatMap((p) => [`Asos ${p}`, `Stsenariy ${p}`]), "O'zgarish"],
                d.regions.map((r) => [r.name, ...d.periods.flatMap((_, i) => [csvSom(r.baseResult[i]!), csvSom(r.scenResult[i]!)]), csvSom(r.deltaTiyin)]),
                [],
              )
            }
          >
            CSV
          </SmallButton>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-(--color-surface-muted) text-left">
              <tr>
                <th className={TH}>Hudud</th>
                <th className={cn(TH, 'text-right')}>Asos natija</th>
                <th className={cn(TH, 'text-right')}>Stsenariy</th>
                <th className={cn(TH, 'text-right')}>O&apos;zgarish</th>
                <th className={cn(TH, 'text-right')}>Zarar ehtimoli</th>
                <th className={cn(TH, 'text-right')}>Zararsizlik tarifi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const b = r.baseResult.reduce((s, v) => s + n(v), 0);
                const s = r.scenResult.reduce((s2, v) => s2 + n(v), 0);
                const maxB = Math.max(...r.baseLoss.map((x) => x ?? 0));
                const maxS = Math.max(...r.scenLoss.map((x) => x ?? 0));
                const be = r.breakEvenTariff.filter((x): x is number => x !== null);
                return (
                  <tr key={r.code} className={cn('border-t border-(--color-line)', !r.touched && 'text-(--color-text-muted)')}>
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className={cn('money px-3 py-2 text-right', b < 0 && 'text-(--color-expense)')}>{compact(String(b))}</td>
                    <td className={cn('money px-3 py-2 text-right font-semibold', s < 0 && 'text-(--color-expense)')}>{compact(String(s))}</td>
                    <td className={cn('money px-3 py-2 text-right', n(r.deltaTiyin) > 0 ? 'text-(--color-income)' : n(r.deltaTiyin) < 0 ? 'text-(--color-expense)' : '')}>{n(r.deltaTiyin) ? `${n(r.deltaTiyin) > 0 ? '+' : ''}${compact(r.deltaTiyin)}` : '—'}</td>
                    <td className="money px-3 py-2 text-right">
                      {share(maxB)} → <b className={cn(maxS >= 0.3 ? 'text-(--color-expense)' : 'text-heading')}>{share(maxS)}</b>
                    </td>
                    <td className="money px-3 py-2 text-right">{be.length ? `+${(Math.max(...be) * 100).toFixed(1).replace('.', ',')}%` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <div className="px-5 py-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">Qanday hisoblanadi</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {d.method.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      </Card>
    </>
  );
}

function Bars({ d }: { d: ScenarioResult }) {
  const W = 960;
  const H = 240;
  const pad = { l: 70, r: 10, t: 14, b: 28 };
  const base = d.months.map((m) => n(m.base.result));
  const scen = d.months.map((m) => n(m.scen.result));
  const min = Math.min(0, ...base, ...scen);
  const max = Math.max(0, ...base, ...scen) || 1;
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min || 1)) * (H - pad.t - pad.b);
  const gw = (W - pad.l - pad.r) / d.months.length;
  const ticks = [min, (min + max) / 2, max];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Asos va stsenariy natijasi">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#e5e7eb" />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#94a3b8">{compact(String(t))}</text>
          </g>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="#94a3b8" />
        {d.months.map((m, i) => {
          const x0 = pad.l + i * gw;
          const bw = gw * 0.32;
          const bar = (v: number, x: number, color: string, label: string) => (
            <rect x={x} y={Math.min(y(v), y(0))} width={bw} height={Math.max(1, Math.abs(y(v) - y(0)))} fill={color} rx={2}>
              <title>{`${m.label}, ${label}: ${compact(String(v))}`}</title>
            </rect>
          );
          return (
            <g key={m.period}>
              {bar(base[i]!, x0 + gw * 0.16, '#c9d6e6', 'asos')}
              {bar(scen[i]!, x0 + gw * 0.16 + bw + 2, scen[i]! < 0 ? '#b3423b' : '#4a78dd', 'stsenariy')}
              <text x={x0 + gw / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="#64748b">{m.label.replace(' 20', ' ’')}</text>
            </g>
          );
        })}
      </svg>
      <div className="flex gap-4 px-1 text-xs text-(--color-text-muted)">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: "#c9d6e6" }} /> asos (prognoz)</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-brand-500" /> stsenariy</span>
      </div>
    </div>
  );
}