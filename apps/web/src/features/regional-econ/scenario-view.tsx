'use client';

import { DiffCell, ExcelButton, MoneyCell, NameCell, PillTabs, ReportCard, RTable, StatTiles, STICKY_NAME, STICKY_NO, TableNote, Td, Th, Tr, type TileTone } from '@/components/report/report';
import { NotesList } from '@/components/report/report-extra-b';
import { LoadingCard } from '@/components/report/report-extra-c';
import { compact } from '@/features/structure/api';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { dashApi, type Levers, type ScenarioResult, share } from './api';

// ═══════════════════════════════════════════════════════════
// Katta modellar › Hudud stsenariysi (I): «agar … bo'lsa» — tarif, hajm, maosh, xodimlar, xarajat, Markaz.
// Asos — Hudud prognozi. Hech narsa saqlanmaydi: faqat hisob.
// Ko'rinish — hisobot uslubida (Solishtirma kabi): dastaklar kartasi, ko'rsatkich kartalari, jadval.
// ═══════════════════════════════════════════════════════════

const n = (t: string | null | undefined) => (t ? Number(t) : 0);
const HORIZONS = [
  { value: '3', label: '3 oy' },
  { value: '6', label: '6 oy' },
  { value: '12', label: '12 oy' },
];
/** Kiritish maydoni — hisobot uslubidagi filtrlar kabi */
const INPUT = 'h-10 w-full rounded-lg border border-(--color-line-strong) bg-white px-3 text-sm text-(--color-text) outline-none placeholder:text-(--color-text-faint) focus:border-brand-500';
const CHIP = 'whitespace-nowrap rounded-lg border border-brand-300 bg-white px-3 py-1.5 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-50';

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
      <ReportCard title="Hudud stsenariysi" badge="Dastaklarni o'zgartiring — natija prognoz ustida darhol qayta hisoblanadi" actions={<PillTabs value={h} onChange={setH} options={HORIZONS} />}>
        <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
          <span className="text-xs font-medium text-(--color-text-muted)">Tayyor stsenariylar:</span>
          {PRESETS.map((p) => (
            <button key={p.label} type="button" className={CHIP} onClick={() => setForm({ ...EMPTY, regionCode: form.regionCode, start: form.start, ...p.form })}>
              {p.label}
            </button>
          ))}
          <button type="button" className={cn(CHIP, 'border-(--color-line-strong) text-(--color-text-muted)')} onClick={() => setForm(EMPTY)}>
            Tozalash
          </button>
        </div>
        <div className="grid gap-x-4 gap-y-3 border-t border-(--color-line) px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Hudud">
            <select value={form.regionCode} onChange={set('regionCode')} className={INPUT}>
              <option value="">Barcha hududlar</option>
              {d?.regions.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Qaysi oydan">
            <select value={form.start} onChange={set('start')} className={INPUT}>
              {(d?.periodLabels ?? []).map((p, i) => (
                <option key={p} value={i}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tarif, %" hint="+10 — 10% oshirish">
            <input value={form.tariff} onChange={set('tariff')} inputMode="decimal" placeholder="0" className={INPUT} />
          </Field>
          <Field label="Qaysi xizmat tarifi">
            <select value={form.tariffService} onChange={set('tariffService')} className={INPUT}>
              <option value="">Barcha xizmatlar</option>
              {d?.services.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Talab elastikligi" hint="−0,3: narx +10% → hajm −3%">
            <input value={form.elasticity} onChange={set('elasticity')} inputMode="decimal" placeholder="0" className={INPUT} />
          </Field>
          <Field label="Xizmatlar hajmi, %">
            <input value={form.volume} onChange={set('volume')} inputMode="decimal" placeholder="0" className={INPUT} />
          </Field>
          <Field label="Maosh indeksatsiyasi, %">
            <input value={form.wage} onChange={set('wage')} inputMode="decimal" placeholder="0" className={INPUT} />
          </Field>
          <Field label="Xodimlar soni ±" hint="hudud o'rtacha ish haqi bilan">
            <input value={form.headcount} onChange={set('headcount')} inputMode="numeric" placeholder="0" className={INPUT} />
          </Field>
          <Field label="Xarajat, %">
            <input value={form.opex} onChange={set('opex')} inputMode="decimal" placeholder="0" className={INPUT} />
          </Field>
          <Field label="Bir martalik xarajat, so'm" hint="boshlanish oyiga, har tanlangan hududga">
            <input value={form.oneTime} onChange={set('oneTime')} inputMode="decimal" placeholder="0" className={INPUT} />
          </Field>
          <Field label="Markaz xarajati, %">
            <input value={form.central} onChange={set('central')} inputMode="decimal" placeholder="0" className={INPUT} />
          </Field>
        </div>
      </ReportCard>

      {res.error || !d ? <LoadingCard label="Hisoblanmoqda" error={res.error} onRetry={res.reload} /> : <Results d={d} />}
    </div>
  );
}

/** Dastak maydoni: nom, kiritish, izoh (hisobot uslubidagi Field kabi) */
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-(--color-text-muted)">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-(--color-text-faint)">{hint}</span>}
    </label>
  );
}

function Results({ d }: { d: ScenarioResult }) {
  const tb = (k: 'revenue' | 'payroll' | 'opex' | 'overhead' | 'result') => d.months.reduce((s, m) => s + n(m.base[k]), 0);
  const delta = (k: 'revenue' | 'payroll' | 'opex' | 'overhead' | 'result') => n(d.delta[k]);
  const rows = [...d.regions].sort((a, b) => n(a.deltaTiyin) - n(b.deltaTiyin));
  return (
    <>
      <StatTiles
        items={(['revenue', 'payroll', 'opex', 'result'] as const).map((k) => {
          const v = delta(k);
          const good = (k === 'revenue' || k === 'result') === v > 0;
          const tone: TileTone = v === 0 ? 'blue' : good ? 'green' : 'red';
          return {
            label: { revenue: 'Daromad', payroll: 'Ish haqi', opex: 'Xarajat', result: 'Natija (Markaz bilan)' }[k] + ` · ${d.horizon} oy`,
            value: v,
            text: `${v > 0 ? '+' : ''}${compact(String(v))}`,
            tone,
            note: `asos ${compact(String(tb(k)))} → ${compact(String(tb(k) + v))}`,
          };
        })}
      />
      <ReportCard
        title="Hududlar bo'yicha stsenariy"
        badge={`${d.horizon} oy · eng ko'p yutqazgan hudud tepada`}
        actions={
          <ExcelButton
            label="CSV"
            onClick={() =>
              downloadCsv(
                `Stsenariy-${d.lastActual}.csv`,
                ['Hudud', ...d.periodLabels.flatMap((p) => [`Asos ${p}`, `Stsenariy ${p}`]), "O'zgarish"],
                d.regions.map((r) => [r.name, ...d.periods.flatMap((_, i) => [csvSom(r.baseResult[i]!), csvSom(r.scenResult[i]!)]), csvSom(r.deltaTiyin)]),
                [],
              )
            }
          />
        }
      >
        <RTable minWidth={900}>
          <thead>
            <tr>
              <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
              <Th className={cn(STICKY_NAME, 'z-[2] min-w-44 text-left')}>Hudud</Th>
              <Th>Asos natija</Th>
              <Th>Stsenariy</Th>
              <Th>O&apos;zgarish</Th>
              <Th>Zarar ehtimoli</Th>
              <Th>Zararsizlik tarifi</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const b = r.baseResult.reduce((s, v) => s + n(v), 0);
              const s = r.scenResult.reduce((s2, v) => s2 + n(v), 0);
              const maxB = Math.max(...r.baseLoss.map((x) => x ?? 0));
              const maxS = Math.max(...r.scenLoss.map((x) => x ?? 0));
              const be = r.breakEvenTariff.filter((x): x is number => x !== null);
              return (
                <Tr key={r.code} muted={!r.touched} className={cn(!r.touched && 'text-(--color-text-muted)')}>
                  <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{idx + 1}</Td>
                  <NameCell>{r.name}</NameCell>
                  <MoneyCell value={b} className={cn(b < 0 && 'text-(--color-expense)')} />
                  <MoneyCell value={s} strong className={cn(s < 0 && 'text-(--color-expense)')} />
                  {n(r.deltaTiyin) ? <DiffCell value={n(r.deltaTiyin)} /> : <Td className="text-(--color-text-faint)">—</Td>}
                  <Td className="whitespace-nowrap">
                    {share(maxB)} → <b className={cn(maxS >= 0.3 ? 'text-(--color-expense)' : 'text-heading')}>{share(maxS)}</b>
                  </Td>
                  <Td className="whitespace-nowrap">{be.length ? `+${(Math.max(...be) * 100).toFixed(1).replace('.', ',')}%` : '—'}</Td>
                </Tr>
              );
            })}
          </tbody>
        </RTable>
        <TableNote>
          Hududlar: davr natijasi (so&apos;mda), zarar ehtimoli (eng yuqori oy: asos → stsenariy) va zararsizlik uchun kerakli tarif. Kulrang qatorlar — stsenariy tegmagan hududlar.
        </TableNote>
      </ReportCard>
      {d.narrative.length > 0 && (
        <ReportCard title="Stsenariy natijasi">
          <NotesList notes={d.narrative} />
        </ReportCard>
      )}
      <ReportCard title="Natija oylar bo'yicha: asos va stsenariy" badge={`${d.horizon} oy`}>
        <div className="px-4 pb-4">
          <Bars d={d} />
        </div>
      </ReportCard>
      <ReportCard title="Qanday hisoblanadi">
        <NotesList notes={d.method} />
      </ReportCard>
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