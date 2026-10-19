'use client';

import { useAsOf } from '@/lib/period';
import { CalcValue } from '@/components/ui/calc';
import { coefCalc, unitEffectCalc } from './calcs';
import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Mark } from '@/features/reactions/mark';
import { compact, pct } from '@/features/structure/api';
import { Findings, KpiStrip, ModelCard, PanelHeader } from '@/features/structure/parts';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { econApi, incomeMark, METHOD_LABEL, SIGNIFICANCE, type FactorCoef, type FactorKey, type FactorsResult, type ModelTable } from './api';
import { CorrMatrix, EffectBars, FactorScatter, ForestPlot, ScaleGauge, TfpBars } from './factors-charts';

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)';
const ORIGIN = 'Katta modellar · Omillar';

const dec = (v: number, d = 2) => v.toFixed(d).replace('.', ',');

function SignificancePill({ value }: { value: FactorCoef['significance'] }) {
  const s = SIGNIFICANCE[value];
  return (
    <span title={s.hint} className={cn('inline-flex whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-semibold', s.tone)}>
      {s.label}
    </span>
  );
}

/** Koeffitsient o'z birligida: xodim — so'm/kishi, pul — 1 mln so'mga */
function effectText(c: FactorCoef, unit: 'kishi' | 'som', value = c.value): string {
  const sign = value >= 0 ? '+' : '−';
  if (unit === 'kishi') return `${sign}${compact(Math.abs(value) * 100)}`;
  return `${sign}${compact(Math.abs(value) * 1e6 * 100)}`;
}

function stars(p: number): string {
  return p < 0.01 ? '***' : p < 0.05 ? '**' : p < 0.1 ? '*' : '';
}

// ═══════════════════════════════════════════════════════════
// Omil tanlash
// ═══════════════════════════════════════════════════════════

function FactorPicker({ data, value, onChange }: { data: FactorsResult['available']; value: FactorKey[]; onChange: (next: FactorKey[]) => void }) {
  const toggle = (key: FactorKey) => {
    let next = value.includes(key) ? value.filter((k) => k !== key) : [...value, key];
    // "Ish haqidan tashqari" bilan uning qismlari birga tanlanmaydi
    if (key === 'nonpayroll' && next.includes('nonpayroll')) next = next.filter((k) => k !== 'vehicle' && k !== 'lease' && k !== 'other');
    if (['vehicle', 'lease', 'other'].includes(key) && next.includes(key)) next = next.filter((k) => k !== 'nonpayroll');
    if (next.length === 0 || next.length > 4) return;
    onChange(data.map((d) => d.key).filter((k) => next.includes(k)));
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-(--color-text-muted)">Omillar:</span>
      {data.map((f) => {
        const on = value.includes(f.key);
        return (
          <button
            key={f.key}
            type="button"
            onClick={() => toggle(f.key)}
            aria-pressed={on}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs transition-colors',
              on ? 'border-slate-800 bg-slate-800 font-medium text-white' : 'border-(--color-line) bg-white text-(--color-text-muted) hover:text-(--color-text)',
            )}
          >
            {on ? '✓ ' : '+ '}
            {f.label}
          </button>
        );
      })}
      <span className="ml-1 text-[11px] text-(--color-text-faint)">1–4 ta; daromadga ta&apos;siri o&apos;lchanadi</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Asosiy natija jadvali
// ═══════════════════════════════════════════════════════════

function EffectTable({ model, units }: { model: ModelTable; units: Record<string, 'kishi' | 'som'> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-y border-(--color-line) bg-(--color-surface-muted)">
          <tr>
            <th className={cn(TH, 'pl-5 text-left')}>Omil</th>
            <th className={cn(TH, 'text-right')}>Ta&apos;sir</th>
            <th className={cn(TH, 'text-right')}>95% oraliq</th>
            <th className={cn(TH, 'text-right')}>p</th>
            <th className={cn(TH, 'text-left')}>Ishonch</th>
            <th className={cn(TH, 'pr-5 text-left')}>Ma&apos;nosi</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-(--color-line)">
          {model.coefficients.map((c) => {
            const u = units[c.key] ?? 'som';
            return (
              <tr key={c.key} className="align-top">
                <td className="py-2.5 pl-5 pr-3 font-medium">
                  {c.label}
                  <span className="block text-[11px] font-normal text-(--color-text-faint)">{u === 'kishi' ? "1 kishiga, so'm/oy" : "1 mln so'mga"}</span>
                </td>
                <td className={cn('whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums', c.significance === 'none' ? 'text-(--color-text-muted)' : c.value >= 0 ? 'text-(--color-income)' : 'text-(--color-expense)')}>
                  <CalcValue calc={coefCalc(c, (v) => effectText(c, u, v), u === 'kishi' ? "so'm/oy har 1 kishiga" : "so'm har 1 mln so'mga")}>{effectText(c, u)}</CalcValue>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-(--color-text-muted)">
                  {effectText(c, u, c.lo95)} … {effectText(c, u, c.hi95)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{c.p < 0.001 ? '<0,001' : dec(c.p, 3)}</td>
                <td className="px-3 py-2.5">
                  <SignificancePill value={c.significance} />
                </td>
                <td className="max-w-[28rem] py-2.5 pl-3 pr-5 text-xs leading-relaxed text-(--color-text-muted)">{c.meaning}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Modellar solishtirmasi
// ═══════════════════════════════════════════════════════════

function CompareTable({ data, units }: { data: FactorsResult; units: Record<string, 'kishi' | 'som'> }) {
  const models = (['pooled', 'fixed', 'random'] as const).map((k) => ({ k, m: data[k] })).filter((x): x is { k: 'pooled' | 'fixed' | 'random'; m: ModelTable } => x.m !== null);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-y border-(--color-line) bg-(--color-surface-muted)">
          <tr>
            <th className={cn(TH, 'pl-5 text-left')}>Omil</th>
            {models.map(({ k }) => (
              <th key={k} className={cn(TH, 'text-right', data.preferred === k && 'text-(--color-text)')}>
                {METHOD_LABEL[k]}
                {data.preferred === k && <span className="ml-1 rounded bg-slate-800 px-1 py-px text-[9px] text-white">asosiy</span>}
              </th>
            ))}
            {data.elasticity && <th className={cn(TH, 'pr-5 text-right')}>Elastiklik</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-(--color-line)">
          {data.factors.map((f) => (
            <tr key={f.key}>
              <td className="py-2 pl-5 pr-3">{f.label}</td>
              {models.map(({ k, m }) => {
                const c = m.coefficients.find((x) => x.key === f.key);
                return (
                  <td key={k} className={cn('whitespace-nowrap px-3 py-2 text-right tabular-nums', data.preferred === k && 'bg-(--color-surface-muted) font-semibold')}>
                    {c ? (
                      <>
                        {effectText(c, units[f.key] ?? 'som')}
                        <span className="ml-0.5 text-(--color-expense)">{stars(c.p)}</span>
                        <span className="block text-[11px] font-normal text-(--color-text-faint)">± {effectText(c, units[f.key] ?? 'som', c.se).slice(1)}</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                );
              })}
              {data.elasticity && (
                <td className="whitespace-nowrap py-2 pl-3 pr-5 text-right tabular-nums">
                  {(() => {
                    const c = data.elasticity.coefficients.find((x) => x.key === f.key);
                    return c ? (
                      <>
                        {c.value >= 0 ? '+' : '−'}
                        {dec(Math.abs(c.value))}%<span className="ml-0.5 text-(--color-expense)">{stars(c.p)}</span>
                      </>
                    ) : (
                      '—'
                    );
                  })()}
                </td>
              )}
            </tr>
          ))}
          <tr className="text-xs text-(--color-text-muted)">
            <td className="py-2 pl-5 pr-3">R² {data.fixed ? '(FE — hudud ichida)' : ''}</td>
            {models.map(({ k, m }) => (
              <td key={k} className="px-3 py-2 text-right tabular-nums">
                {dec((m.withinR2 ?? m.r2) * 100, 1)}%
              </td>
            ))}
            {data.elasticity && <td className="py-2 pl-3 pr-5 text-right tabular-nums">{dec((data.elasticity.withinR2 ?? data.elasticity.r2) * 100, 1)}%</td>}
          </tr>
          <tr className="text-xs text-(--color-text-muted)">
            <td className="py-2 pl-5 pr-3">Kuzatuvlar / hududlar</td>
            {models.map(({ k, m }) => (
              <td key={k} className="px-3 py-2 text-right tabular-nums">
                {m.n} / {m.groups}
              </td>
            ))}
            {data.elasticity && (
              <td className="py-2 pl-3 pr-5 text-right tabular-nums">
                {data.elasticity.n} / {data.elasticity.groups}
              </td>
            )}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Omillar bo'limi
// ═══════════════════════════════════════════════════════════

export function FactorsView() {
  const [factors, setFactors] = useState<FactorKey[]>(['headcount', 'nonpayroll']);
  const [scatterFactor, setScatterFactor] = useState<FactorKey>('headcount');
  /** Umumiy «Davr» oyi: o'tgan oy bo'lsa — o'sha oy oxiridagi holat */
  const asOf = useAsOf();
  const result = useAsync(() => econApi.factors(factors, asOf).then((r) => r.data), [factors.join(','), asOf]);
  const data = result.data;

  if (result.error) {
    return (
      <Card>
        <ErrorState message={result.error} onRetry={result.reload} />
      </Card>
    );
  }
  if (!data) {
    return (
      <Card>
        <LoadingState label="Modellar hisoblanmoqda" />
      </Card>
    );
  }

  const units: Record<string, 'kishi' | 'som'> = Object.fromEntries(data.available.map((a) => [a.key, a.unit]));
  const main = data.preferred ? data[data.preferred] : null;
  const strongest = main
    ? [...main.coefficients].filter((c) => c.significance !== 'none').sort((a, b) => a.p - b.p)[0] ?? null
    : null;
  const cd = data.cobbDouglas;
  const scatterUnit = units[scatterFactor] ?? 'som';

  const header = (
    <PanelHeader
      title="Omillar tahlili"
      description="Daromad nimalarga bog'liq: xodimlar, ish haqi, xarajatlar — hududlar va oylar bo'yicha, mavsum va trend hisobga olingan holda"
    >
      <FactorPicker data={data.available} value={factors} onChange={setFactors} />
    </PanelHeader>
  );

  if (!main) {
    return (
      <div className="space-y-4">
        {header}
        <Findings title="Natija" notes={[...data.notes, ...data.warnings]} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header}

      <KpiStrip
        items={[
          {
            label: 'Kuzatuvlar',
            value: String(data.observations),
            sub: `${data.units} hudud × ${data.months} oy${data.periodFrom && data.periodTo ? ` (${formatPeriod(data.periodFrom)} – ${formatPeriod(data.periodTo)})` : ''}`,
          },
          {
            label: 'Asosiy model',
            value: data.preferred ? METHOD_LABEL[data.preferred] : '—',
            sub: data.hausman ? `Xausman testi: p = ${dec(data.hausman.p, 3)}` : 'Xausman testi hisoblanmadi',
          },
          {
            label: 'Eng ishonchli omil',
            value: strongest ? strongest.label : "Yo'q",
            valueClass: strongest ? undefined : 'text-(--color-text-muted)',
            sub: strongest ? `${effectText(strongest, units[strongest.key] ?? 'som')} ${units[strongest.key] === 'kishi' ? 'har 1 kishiga' : "har 1 mln so'mga"}` : "ta'siri ishonchli aniqlangan omil yo'q",
          },
          {
            label: 'Miqyos samarasi',
            value: cd ? (cd.returns === 'increasing' ? "O'suvchi" : cd.returns === 'decreasing' ? 'Kamayuvchi' : 'Doimiy') : '—',
            valueClass: cd?.returns === 'increasing' ? 'text-(--color-income)' : cd?.returns === 'decreasing' ? 'text-(--color-expense)' : undefined,
            sub: cd ? `α + β = ${dec(cd.sum)} (Kobb-Duglas)` : "ma'lumot yetarli emas",
            calc: cd
              ? {
                  title: 'Miqyos samarasi (Kobb-Duglas)',
                  formula: "ln(Daromad) = ln A + α×ln(Xodimlar) + β×ln(Xarajat) + trend×oy; α + β > 1 — o'suvchi, ≈ 1 — doimiy, < 1 — kamayuvchi",
                  inputs: [
                    { label: 'α (xodimlar)', value: cd.alpha.value, kind: 'ratio' },
                    { label: 'β (xarajat)', value: cd.beta.value, kind: 'ratio' },
                  ],
                  steps: [
                    `α + β = ${dec(cd.alpha.value)} + ${dec(cd.beta.value)} = ${dec(cd.sum)}`,
                    `Standart xato = ${dec(cd.sumSe)}; «= 1» gipotezasi uchun p = ${dec(cd.sumP, 3)}`,
                    cd.sumP >= 0.05 ? "p ≥ 0,05 — 1 dan farqi ishonchli emas → doimiy" : cd.sum > 1 ? "p < 0,05 va α + β > 1 → o'suvchi" : 'p < 0,05 va α + β < 1 → kamayuvchi',
                  ],
                  result: cd.returns === 'increasing' ? "O'suvchi" : cd.returns === 'decreasing' ? 'Kamayuvchi' : 'Doimiy',
                  note: `${cd.n} ta kuzatuv, R² = ${dec(cd.r2 * 100, 1)}%.`,
                }
              : null,
          },
        ]}
      />

      <Findings title="Omillar bo'yicha xulosa" notes={data.notes} />
      {data.warnings.length > 0 && (
        <Card className="border-l-2 border-l-amber-500">
          <ul className="space-y-1.5 px-5 py-3.5 text-sm">
            {data.warnings.map((w) => (
              <li key={w} className="flex gap-2">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-amber-500" />
                {w}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-faint)">Model 1 · {main.name}</p>
            <h3 className="mt-0.5 text-sm font-semibold">Har bir omil daromadni qanchaga o&apos;zgartiradi</h3>
            <p className="mt-0.5 text-xs text-(--color-text-muted)">Boshqa omillar, mavsum va umumiy trend o&apos;zgarmagan holda.</p>
          </div>
        </div>
        <EffectTable model={main} units={units} />
        <div className="border-t border-(--color-line) bg-(--color-surface-muted) px-5 py-2.5 text-xs leading-relaxed text-(--color-text-muted)">
          <span className="font-semibold text-(--color-text)">Qanday o&apos;qiladi: </span>
          «Ta&apos;sir» — omil bir birlikka o&apos;zgarganda oylik daromad o&apos;rtacha qanchaga o&apos;zgargani. 95% oraliq nolni kesib o&apos;tsa — ta&apos;sirni tasodifdan ajratib bo&apos;lmaydi.
          Standart xatolar hududlar bo&apos;yicha klasterlangan (bir hududning oylari o&apos;zaro bog&apos;liq bo&apos;lishi hisobga olingan).
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <ModelCard
          index={2}
          title="Uch xil yondashuv solishtirmasi"
          question="Natija usulga bog'liqmi — hududlar orasidagi farqmi yoki hudud ichidagi o'zgarishmi?"
          howTo={
            <>
              <b>OLS</b> — barcha hudud-oylar birga: katta hudud ko&apos;p xodim va ko&apos;p daromadga ega bo&apos;lgani uchun ta&apos;sir kattaroq chiqishi mumkin. <b>FE</b> — faqat har bir hudud
              ichidagi o&apos;zgarish: «shu hududga xodim qo&apos;shilsa». <b>RE</b> — ikkalasining o&apos;rtasi, aniqroq, lekin hudud xususiyatlari omillar bilan bog&apos;liq bo&apos;lmasa to&apos;g&apos;ri.
              Xausman testi qaysi biriga ishonishni aytadi. Yulduzcha: * p&lt;0,10, ** p&lt;0,05, *** p&lt;0,01.
            </>
          }
        >
          <div className="-mx-5 -my-4">
            <CompareTable data={data} units={units} />
          </div>
          {data.hausman && <p className="mt-6 text-sm">{data.hausman.text}</p>}
          {data.random?.rho !== undefined && (
            <p className="mt-1 text-xs text-(--color-text-muted)">
              Daromad tebranishining {pct(data.random.rho * 100)} i hududlar orasidagi doimiy farqlardan, qolgani oyma-oy o&apos;zgarishdan.
            </p>
          )}
        </ModelCard>

        <ModelCard
          index={3}
          title="Elastiklik"
          question="Omil 1% ko'paysa, daromad necha foizga o'zgaradi?"
          howTo="Nuqta — baho, chiziq — 95% ishonch oralig'i. Chiziq 0 ni kesib o'tsa, ta'sir aniqlanmagan. 1 dan katta — daromad omildan tezroq o'sadi. Hudud ichidagi o'zgarish (FE) bo'yicha."
        >
          {data.elasticity ? (
            <>
              <ForestPlot rows={data.elasticity.coefficients} />
              {data.elasticity.note && <p className="mt-2 text-xs text-(--color-text-muted)">{data.elasticity.note}</p>}
            </>
          ) : (
            <p className="text-sm text-(--color-text-muted)">Elastiklik uchun omillar va daromad musbat bo&apos;lgan kamida 30 ta kuzatuv kerak.</p>
          )}
        </ModelCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ModelCard
          index={4}
          title="Hudud effekti"
          question="Resurslariga (xodimlar, xarajatlar) nisbatan qaysi hudud kutilganidan ko'p yoki kam daromad oladi?"
          howTo="Yashil — hudud o'z resurslari bilan o'rtachadan ko'proq daromad oladi (yaxshi boshqaruv, bozor, mijozlar). Qizil — kutilganidan kam: sababini o'rganish kerak. Oyiga, so'mda. Munosabat rejimida hududni belgilash mumkin."
          aside={
            <button
              type="button"
              className="text-xs text-(--color-text-muted) underline hover:text-(--color-text)"
              onClick={() =>
                downloadCsv(
                  'hudud-effekti',
                  ['Hudud', "Haqiqiy o'rtacha daromad (oy)", 'Kutilgan', 'Farq', 'Oylar'],
                  data.unitEffects.map((u) => [u.name, csvSom(u.actualTiyin), csvSom(u.expectedTiyin), csvSom(u.effectTiyin), u.months]),
                )
              }
            >
              CSV
            </button>
          }
        >
          {data.unitEffects.length ? (
            <>
              <EffectBars rows={data.unitEffects} />
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-(--color-text-faint)">Har hudud hisobi (bosing)</p>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                {data.unitEffects.map((u) => (
                  <CalcValue key={u.key} calc={unitEffectCalc(u)} className={Number(u.effectTiyin) >= 0 ? 'text-(--color-income)' : 'text-(--color-expense)'}>
                    {u.name}: {Number(u.effectTiyin) >= 0 ? '+' : '−'}
                    {compact(Math.abs(Number(u.effectTiyin)))}
                  </CalcValue>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {data.unitEffects
                  .filter((u) => Number(u.effectTiyin) < 0)
                  .slice(-5)
                  .reverse()
                  .map((u) => (
                    <Mark key={u.key} item={incomeMark(u, ORIGIN)} label={u.name} />
                  ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-(--color-text-muted)">FE modeli hisoblanmadi.</p>
          )}
        </ModelCard>

        <ModelCard
          index={5}
          title="Kobb-Duglas ishlab chiqarish funksiyasi"
          question="Daromad = A · Xodimlar^α · Xarajat^β — kattalashish foyda beradimi?"
          howTo="α — xodimlar 1% ko'paysa daromad necha % o'sadi, β — ish haqidan tashqari xarajat uchun. α + β > 1 — o'suvchi, = 1 — doimiy, < 1 — kamayuvchi miqyos samarasi. TFP — bir xil resurs bilan hudud qancha daromad oladi (100 — o'rtacha)."
        >
          {cd ? (
            <div className="space-y-4">
              <dl className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-(--color-text-muted)">α (xodimlar)</dt>
                  <dd className="text-lg font-semibold tabular-nums">{dec(cd.alpha.value)}</dd>
                  <dd className="text-[11px] text-(--color-text-faint)">
                    95%: {dec(cd.alpha.lo95)} … {dec(cd.alpha.hi95)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-(--color-text-muted)">β (xarajat)</dt>
                  <dd className="text-lg font-semibold tabular-nums">{dec(cd.beta.value)}</dd>
                  <dd className="text-[11px] text-(--color-text-faint)">
                    95%: {dec(cd.beta.lo95)} … {dec(cd.beta.hi95)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-(--color-text-muted)">Samaradorlik o&apos;sishi</dt>
                  <dd className={cn('text-lg font-semibold tabular-nums', cd.tfpGrowthYear >= 0 ? 'text-(--color-income)' : 'text-(--color-expense)')}>
                    {pct(cd.tfpGrowthYear, true)}
                  </dd>
                  <dd className="text-[11px] text-(--color-text-faint)">yiliga (TFP trendi)</dd>
                </div>
              </dl>
              <ScaleGauge sum={cd.sum} se={cd.sumSe} />
              <p className="text-sm leading-relaxed">{cd.text}</p>
              <div>
                <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">Hududlar umumiy samaradorligi (TFP)</h4>
                <TfpBars rows={cd.tfp} />
              </div>
            </div>
          ) : (
            <p className="text-sm text-(--color-text-muted)">Kobb-Duglas uchun daromad va xarajat musbat bo&apos;lgan kamida 30 ta kuzatuv kerak.</p>
          )}
        </ModelCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ModelCard
          index={6}
          title="Daromad va omil: nuqtali grafik"
          question="Omil ko'p bo'lgan joyda daromad ham ko'pmi?"
          howTo="Och nuqta — bitta hudud-oy, to'q nuqta — hududning o'rtachasi. Uzuq chiziq — oddiy chiziqli bog'liqlik (mavsum va hudud farqlari hisobga olinmagan)."
          aside={
            <select
              value={scatterFactor}
              onChange={(e) => setScatterFactor(e.target.value as FactorKey)}
              className="h-7 rounded-(--radius-control) border border-(--color-line) bg-white px-1.5 text-xs outline-none"
            >
              {data.available.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
          }
        >
          <FactorScatter data={data} factor={scatterFactor} unit={scatterUnit} />
        </ModelCard>

        <ModelCard
          index={7}
          title="Bog'liqlik matritsasi (korrelyatsiya)"
          question="Qaysi ko'rsatkichlar birga o'zgaradi?"
          howTo="+1 ga yaqin (yashil) — birga o'sadi, −1 ga yaqin (qizil) — biri o'ssa boshqasi kamayadi, 0 — bog'liqlik yo'q. Ikki omil o'zaro juda bog'liq bo'lsa (0,9 dan yuqori), ularni birga modelga qo'yish natijani noaniq qiladi."
        >
          {data.correlation ? <CorrMatrix data={data.correlation} /> : null}
        </ModelCard>
      </div>
    </div>
  );
}