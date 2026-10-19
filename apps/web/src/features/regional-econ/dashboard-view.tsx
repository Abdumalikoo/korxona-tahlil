'use client';

import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { compact } from '@/features/structure/api';
import { KpiStrip, PanelHeader, Segmented, SmallButton } from '@/features/structure/parts';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';
import { type Dashboard, dashApi, type DashRow, type Explain, LIGHT, type Light, RELIABILITY, share } from './api';

// ═══════════════════════════════════════════════════════════
// Katta modellar › Hududlar paneli (J): barcha hudud modellari bitta jadvalda — natija, salohiyat,
// prognoz, KPI, holat (svetofor) sabablari bilan; avtomatik izoh; «Nega o'zgardi?» omillarga ajratish.
// ═══════════════════════════════════════════════════════════

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)';
const n = (t: string | null | undefined) => (t ? Number(t) : 0);
const TONE = {
  good: 'border-l-emerald-500',
  info: 'border-l-brand-500',
  warn: 'border-l-amber-400',
  bad: 'border-l-red-500',
};
type Filter = 'all' | Light;
const LIGHT_ORDER: Record<Light, number> = { red: 0, amber: 1, green: 2, none: 3 };

export function LightDot({ l, title }: { l: Light; title?: string }) {
  return <span className={cn('inline-block size-2.5 shrink-0 rounded-full', LIGHT[l].dot)} title={title ?? LIGHT[l].label} />;
}

export function DashboardView() {
  const { month } = usePeriod();
  const res = useAsync(() => dashApi.dashboard(month).then((r) => r.data), [month]);
  const [filter, setFilter] = useState<Filter>('all');
  const [sel, setSel] = useState<number | null>(null);
  const d = res.data;
  const header = <PanelHeader title="Hududlar paneli" description={d ? `${d.lastLabel} yakuni · keyingi oy: ${d.nextLabel} · barcha hudud modellari bir joyda` : 'Barcha hudud modellari bir joyda'} />;
  if (res.error) return <div className="space-y-4">{header}<Card><ErrorState message={res.error} onRetry={res.reload} /></Card></div>;
  if (!d) return <div className="space-y-4">{header}<Card><LoadingState label="Modellar yig'ilmoqda" /></Card></div>;
  const t = d.totals;
  return (
    <div className="space-y-4">
      {header}
      <KpiStrip
        items={[
          { label: `Hududlar daromadi · ${d.lastLabel}`, value: `${compact(t.revenueTiyin)} so'm`, sub: `oldingi oyga ${share(t.revenueGrowth, true)} · yil boshidan ${compact(t.ytdRevenueTiyin)} (${share(t.ytdGrowth, true)})` },
          { label: 'Natija (Markaz ulushi bilan)', value: `${compact(t.adjustedTiyin)} so'm`, valueClass: n(t.adjustedTiyin) < 0 ? 'text-(--color-expense)' : 'text-heading', sub: `operatsion ${compact(t.resultTiyin)} · korxona ${compact(t.companyResultTiyin)}` },
          { label: `Keyingi oy · ${d.nextLabel}`, value: `${compact(t.forecastResultTiyin)} so'm`, valueClass: n(t.forecastResultTiyin) < 0 ? 'text-(--color-expense)' : 'text-heading', sub: `daromad prognozi ${compact(t.forecastRevenueTiyin)} · salohiyat ${compact(t.potentialTiyin)}` },
          {
            label: 'Holat',
            value: `${d.lights.red} · ${d.lights.amber} · ${d.lights.green}`,
            sub: (
              <span className="flex flex-wrap gap-x-3">
                <span className="flex items-center gap-1"><LightDot l="red" /> e&apos;tibor</span>
                <span className="flex items-center gap-1"><LightDot l="amber" /> kuzatish</span>
                <span className="flex items-center gap-1"><LightDot l="green" /> yaxshi</span>
              </span>
            ),
          },
        ]}
      />
      <Story d={d} />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-(--color-line) px-5 py-2.5">
          <Segmented
            value={filter}
            onChange={setFilter}
            size="sm"
            options={[
              { value: 'all', label: `Hammasi (${d.rows.length})` },
              { value: 'red', label: `E'tibor (${d.lights.red})` },
              { value: 'amber', label: `Kuzatish (${d.lights.amber})` },
              { value: 'green', label: `Yaxshi (${d.lights.green})` },
            ]}
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-(--color-text-muted)">Qatorni bosing — «Nega o&apos;zgardi?»</span>
            <SmallButton
              onClick={() =>
                downloadCsv(
                  `Hududlar-paneli-${d.lastActual}.csv`,
                  ['Hudud', 'Holat', 'Sabablar', 'Daromad', "O'sish %", 'Natija (Markaz bilan)', 'Rentabellik %', 'Foydalanish %', `Natija prognozi ${d.nextLabel}`, 'Zarar ehtimoli %', 'Daromad KPI bajarilishi %'],
                  d.rows.map((r) => [r.name, LIGHT[r.light].label, r.reasons.join('; '), csvSom(r.revenueTiyin), pc(r.revenueGrowth), csvSom(r.adjustedTiyin), pc(r.adjustedMargin), pc(r.utilization), r.forecastResultNext ? csvSom(r.forecastResultNext.meanTiyin) : '', pc(r.lossProb), pc(r.kpi.revenueAchievement)]),
                  [],
                )
              }
            >
              CSV
            </SmallButton>
          </div>
        </div>
        <ScoreTable d={d} filter={filter} sel={sel} onSel={setSel} />
      </Card>
      {sel !== null && <ExplainPanel code={sel} period={d.lastActual} />}
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
    </div>
  );
}

const pc = (x: number | null) => (x === null ? '' : (x * 100).toFixed(1).replace('.', ','));

function Story({ d }: { d: Dashboard }) {
  return (
    <Card>
      <div className="px-5 py-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">Avtomatik izoh</h3>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {d.story.map((s) => (
            <div key={s.title} className={cn('rounded-r-lg border-l-4 bg-(--color-surface-muted) px-3.5 py-2.5', TONE[s.tone])}>
              <p className="text-xs font-semibold text-heading">{s.title}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-(--color-text)">{s.text}</p>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function ScoreTable({ d, filter, sel, onSel }: { d: Dashboard; filter: Filter; sel: number | null; onSel: (c: number | null) => void }) {
  const rows = useMemo(() => d.rows.filter((r) => filter === 'all' || r.light === filter).sort((a, b) => LIGHT_ORDER[a.light] - LIGHT_ORDER[b.light] || n(a.adjustedTiyin) - n(b.adjustedTiyin)), [d, filter]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1100px] text-sm">
        <thead className="bg-(--color-surface-muted) text-left">
          <tr>
            <th className={TH}>Hudud</th>
            <th className={cn(TH, 'text-right')}>Daromad</th>
            <th className={cn(TH, 'text-right')}>Natija (Markaz bilan)</th>
            <th className={cn(TH, 'text-right')}>Yil boshidan</th>
            <th className={cn(TH, 'text-right')}>Salohiyatdan foydalanish</th>
            <th className={cn(TH, 'text-right')}>{d.nextLabel} prognozi</th>
            <th className={cn(TH, 'text-right')}>KPI (daromad)</th>
            <th className={TH}>Sabab</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row key={r.code} r={r} active={sel === r.code} onClick={() => onSel(sel === r.code ? null : r.code)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ r, active, onClick }: { r: DashRow; active: boolean; onClick: () => void }) {
  const f = r.forecastResultNext;
  const kState = r.kpi.revenueState;
  return (
    <tr onClick={onClick} className={cn('cursor-pointer border-t border-(--color-line) align-top hover:bg-brand-50/40', active && 'bg-brand-50/70')}>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <LightDot l={r.light} />
          <span className="font-medium text-heading">{r.name}</span>
        </div>
        <div className="pl-[18px] text-[11px] text-(--color-text-muted)">{r.headcount} xodim</div>
      </td>
      <td className="money px-3 py-2 text-right">
        {compact(r.revenueTiyin)}
        {r.revenueGrowth !== null && <div className={cn('text-[11px]', r.revenueGrowth < 0 ? 'text-(--color-expense)' : 'text-(--color-income)')}>{share(r.revenueGrowth, true)}</div>}
      </td>
      <td className={cn('money px-3 py-2 text-right font-semibold', n(r.adjustedTiyin) < 0 ? 'text-(--color-expense)' : 'text-heading')}>
        {compact(r.adjustedTiyin)}
        <div className="text-[11px] font-normal text-(--color-text-muted)">{share(r.adjustedMargin)}</div>
      </td>
      <td className="money px-3 py-2 text-right">
        {compact(r.ytdRevenueTiyin)}
        <div className={cn('text-[11px]', n(r.ytdAdjustedTiyin) < 0 ? 'text-(--color-expense)' : 'text-(--color-text-muted)')}>natija {compact(r.ytdAdjustedTiyin)}</div>
      </td>
      <td className={cn('money px-3 py-2 text-right', r.utilization !== null && r.utilization < 0.9 ? 'text-amber-700' : 'text-heading')}>{share(r.utilization)}</td>
      <td className="money px-3 py-2 text-right">
        {f ? (
          <>
            <span className={cn('font-semibold', n(f.meanTiyin) < 0 ? 'text-(--color-expense)' : 'text-heading')}>{compact(f.meanTiyin)}</span>
            <div className="text-[11px] text-(--color-text-muted)">
              zarar ehtimoli {share(r.lossProb)} · <span className={cn('rounded px-1', RELIABILITY[r.reliability].cls)}>{RELIABILITY[r.reliability].label}</span>
            </div>
          </>
        ) : (
          '—'
        )}
      </td>
      <td className={cn('money px-3 py-2 text-right', kState === 'met' ? 'text-(--color-income)' : kState === 'near' ? 'text-amber-700' : kState === 'missed' ? 'text-(--color-expense)' : 'text-(--color-text-faint)')}>
        {r.kpi.revenueAchievement !== null ? share(r.kpi.revenueAchievement) : '—'}
      </td>
      <td className={cn('max-w-[260px] px-3 py-2 text-xs', LIGHT[r.light].text)}>{r.reasons.length ? r.reasons.join('; ') : r.light === 'green' ? 'muammo yo\'q' : ''}</td>
    </tr>
  );
}

/** «Nega o'zgardi?» — oldingi oydan joriy oyga natija zinapoyasi va omillar */
export function ExplainPanel({ code, period }: { code: number; period: string }) {
  const res = useAsync(() => dashApi.explain(code, period).then((r) => r.data), [code, period]);
  const x = res.data;
  if (res.error) return <Card><ErrorState message={res.error} onRetry={res.reload} /></Card>;
  if (!x) return <Card><LoadingState /></Card>;
  return (
    <Card>
      <div className="space-y-4 px-5 py-4">
        <div>
          <h3 className="text-sm font-bold text-heading">Nega o&apos;zgardi? {x.region.name}: {x.prevLabel} → {x.periodLabel}</h3>
          <p className="mt-1 text-sm text-heading">{x.headline}</p>
          <ul className="mt-1 space-y-0.5 text-sm text-(--color-text)">
            {x.parts.map((p) => (
              <li key={p}>• {p}</li>
            ))}
          </ul>
        </div>
        <Waterfall x={x} />
        <div className="grid gap-4 lg:grid-cols-2">
          <MiniTable
            title="Daromad — xizmatlar"
            head={['Xizmat', x.prevLabel, x.periodLabel, "O'zgarish", 'Hajm / narx']}
            rows={x.services.slice(0, 8).map((s) => [s.label, compact(s.prevTiyin), compact(s.curTiyin), <Delta key="d" t={s.deltaTiyin} />, s.volumeEffectTiyin !== null ? `${sgn(s.volumeEffectTiyin)} / ${sgn(s.priceEffectTiyin!)}` : '—'])}
          />
          <MiniTable
            title="Xarajat — moddalar (ish haqisiz)"
            head={['Modda', x.prevLabel, x.periodLabel, "O'zgarish"]}
            rows={x.opex.slice(0, 8).map((o) => [o.label, compact(o.prevTiyin), compact(o.curTiyin), <Delta key="d" t={o.deltaTiyin} invert />])}
          />
        </div>
        <p className="text-xs text-(--color-text-muted)">
          Ish haqi: {compact(x.payroll.prevTiyin)} → {compact(x.payroll.curTiyin)}; xodimlar {x.payroll.h0} → {x.payroll.h1} ({sgn(x.payroll.headEffectTiyin)}), o&apos;rtacha {compact(x.payroll.avg0Tiyin)} → {compact(x.payroll.avg1Tiyin)} ({sgn(x.payroll.avgEffectTiyin)}). {x.check.ok ? '✓ Omillar yig\'indisi natija o\'zgarishiga teng.' : ''}
        </p>
      </div>
    </Card>
  );
}

const sgn = (t: string) => `${n(t) > 0 ? '+' : ''}${compact(t)}`;

function Delta({ t, invert }: { t: string; invert?: boolean }) {
  const v = n(t);
  const good = invert ? v < 0 : v > 0;
  return <span className={cn(v === 0 ? 'text-(--color-text-muted)' : good ? 'text-(--color-income)' : 'text-(--color-expense)')}>{sgn(t)}</span>;
}

function MiniTable({ title, head, rows }: { title: string; head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-heading">{title}</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-(--color-text-muted)">
            {head.map((h, i) => (
              <th key={h} className={cn('py-1', i > 0 && 'pl-3 text-right')}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-(--color-line)">
              {r.map((c, j) => (
                <td key={j} className={cn('py-1.5', j > 0 && 'money whitespace-nowrap pl-3 text-right')}>{c}</td>
              ))}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={head.length} className="py-2 text-(--color-text-faint)">yozuv yo&apos;q</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Zinapoya: boshlanish → omillar → yakun */
function Waterfall({ x }: { x: Explain }) {
  const W = 900;
  const H = 200;
  const pad = { l: 10, r: 10, t: 22, b: 34 };
  const vals = x.steps.map((s) => n(s.valueTiyin));
  // Kumulyativ chegaralar
  const bars: { lo: number; hi: number; v: number; total: boolean }[] = [];
  let run = 0;
  vals.forEach((v, i) => {
    if (i === 0 || i === vals.length - 1) {
      bars.push({ lo: Math.min(0, v), hi: Math.max(0, v), v, total: true });
      run = v;
    } else {
      bars.push({ lo: Math.min(run, run + v), hi: Math.max(run, run + v), v, total: false });
      run += v;
    }
  });
  const min = Math.min(0, ...bars.map((b) => b.lo));
  const max = Math.max(0, ...bars.map((b) => b.hi));
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min || 1)) * (H - pad.t - pad.b);
  const bw = (W - pad.l - pad.r) / bars.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Natija o'zgarishi zinapoyasi">
      <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="#cbd5e1" />
      {bars.map((b, i) => {
        const color = b.total ? (b.v < 0 ? '#b3423b' : '#4a78dd') : b.v >= 0 ? '#2f7a57' : '#e07a72';
        const x0 = pad.l + i * bw + bw * 0.18;
        return (
          <g key={i}>
            <rect x={x0} y={y(b.hi)} width={bw * 0.64} height={Math.max(1, y(b.lo) - y(b.hi))} fill={color} rx={3} />
            <text x={x0 + bw * 0.32} y={y(b.hi) - 6} textAnchor="middle" fontSize="12" fontWeight={600} fill="#0f172a">
              {b.total ? compact(String(b.v)) : `${b.v > 0 ? '+' : ''}${compact(String(b.v))}`}
            </text>
            <text x={x0 + bw * 0.32} y={H - 12} textAnchor="middle" fontSize="11" fill="#64748b">
              {x.steps[i]!.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}