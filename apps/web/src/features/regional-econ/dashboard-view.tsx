'use client';

import { DiffCell, ExcelButton, Field, FilterBar, GroupTh, MoneyCell, NameCell, ReportCard, RTable, SelectBox, StatTiles, STICKY_NAME, STICKY_NO, sum, TableNote, Td, Th, Tr, type StatTile } from '@/components/report/report';
import { NotesList, SubTitle } from '@/components/report/report-extra-b';
import { EmptyNote, LoadingCard } from '@/components/report/report-extra-c';
import { compact } from '@/features/structure/api';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { type ReactNode, useMemo, useState } from 'react';
import { type Dashboard, dashApi, type DashRow, type Explain, LIGHT, type Light, RELIABILITY, share } from './api';

// ═══════════════════════════════════════════════════════════
// Solishtirma › Hududlar › Hududlar paneli (J): barcha hudud modellari bitta jadvalda — natija, salohiyat,
// prognoz, KPI, holat (svetofor) sabablari bilan; avtomatik izoh; «Nega o'zgardi?» omillarga ajratish.
// Ko'rinish — hisobot uslubida (kartalar, filtrlar qatori, bitta katta jadval).
// ═══════════════════════════════════════════════════════════

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

/** Summa yonidagi o'sish: «(+9,1%)» — yashil/qizil */
function Growth({ x }: { x: number | null }) {
  if (x === null) return null;
  return <span className={cn('ml-1 whitespace-nowrap text-[11px] font-semibold', x < 0 ? 'text-(--color-expense)' : 'text-(--color-income)')}>({share(x, true)})</span>;
}

/** Katakcha ostidagi kichik izoh */
function Sub({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('block whitespace-nowrap text-[11px] font-normal text-(--color-text-muted)', className)}>{children}</span>;
}

export function DashboardView() {
  const { month } = usePeriod();
  const res = useAsync(() => dashApi.dashboard(month).then((r) => r.data), [month]);
  const [filter, setFilter] = useState<Filter>('all');
  const [sel, setSel] = useState<number | null>(null);
  const d = res.data;
  if (!d) return <LoadingCard label="Modellar yig'ilmoqda" error={res.error} onRetry={res.reload} />;
  const t = d.totals;
  const tiles: StatTile[] = [
    { label: `Hududlar daromadi · ${d.lastLabel}`, value: n(t.revenueTiyin), tone: 'green', note: `oldingi oyga ${share(t.revenueGrowth, true)}` },
    { label: `Daromad · ${d.ytdLabel}`, value: n(t.ytdRevenueTiyin), tone: 'cyan', note: `yil boshidan o'sish ${share(t.ytdGrowth, true)}` },
    { label: 'Natija (Markaz ulushi bilan)', value: n(t.adjustedTiyin), signed: true, tone: 'blue', note: `operatsion ${compact(t.resultTiyin)}` },
    { label: `Keyingi oy · ${d.nextLabel}`, value: n(t.forecastResultTiyin), signed: true, tone: 'purple', note: `daromad prognozi ${compact(t.forecastRevenueTiyin)}` },
    { label: "Holat: e'tibor · kuzatish · yaxshi", value: 0, text: `${d.lights.red} · ${d.lights.amber} · ${d.lights.green}`, tone: 'orange', note: 'qizil · sariq · yashil' },
  ];
  const exportCsv = () =>
    downloadCsv(
      `Hududlar-paneli-${d.lastActual}.csv`,
      ['Hudud', 'Holat', 'Sabablar', 'Daromad', "O'sish %", 'Natija (Markaz bilan)', 'Rentabellik %', 'Foydalanish %', `Natija prognozi ${d.nextLabel}`, 'Zarar ehtimoli %', 'Daromad KPI bajarilishi %'],
      d.rows.map((r) => [r.name, LIGHT[r.light].label, r.reasons.join('; '), csvSom(r.revenueTiyin), pc(r.revenueGrowth), csvSom(r.adjustedTiyin), pc(r.adjustedMargin), pc(r.utilization), r.forecastResultNext ? csvSom(r.forecastResultNext.meanTiyin) : '', pc(r.lossProb), pc(r.kpi.revenueAchievement)]),
      [],
    );
  return (
    <div className="space-y-4">
      <StatTiles items={tiles} />
      <FilterBar>
        <Field label="Holat">
          <SelectBox
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `Hammasi (${d.rows.length})` },
              { value: 'red', label: `E'tibor (${d.lights.red})` },
              { value: 'amber', label: `Kuzatish (${d.lights.amber})` },
              { value: 'green', label: `Yaxshi (${d.lights.green})` },
            ]}
          />
        </Field>
      </FilterBar>
      <ReportCard title="Hududlar paneli: barcha hudud modellari" badge={`${d.lastLabel} yakuni · keyingi oy: ${d.nextLabel}`} actions={<ExcelButton onClick={exportCsv} />}>
        <ScoreTable d={d} filter={filter} sel={sel} onSel={setSel} />
        <TableNote>
          Qatorni bosing — «Nega o&apos;zgardi?» (oldingi oydan joriy oyga omillar). Korxona natijasi: {sum(t.companyResultTiyin)} so&apos;m; hududlar operatsion natijasi (Markaz ulushisiz): {sum(t.resultTiyin)} so&apos;m; keyingi oy daromad salohiyati: {sum(t.potentialTiyin)} so&apos;m.
        </TableNote>
      </ReportCard>
      {sel !== null && <ExplainPanel code={sel} period={d.lastActual} />}
      <Story d={d} />
      <ReportCard title="Qanday hisoblanadi">
        <NotesList notes={d.method} />
      </ReportCard>
    </div>
  );
}

const pc = (x: number | null) => (x === null ? '' : (x * 100).toFixed(1).replace('.', ','));

function Story({ d }: { d: Dashboard }) {
  if (!d.story.length) return null;
  return (
    <ReportCard title="Avtomatik izoh">
      <div className="grid gap-3 px-5 pb-5 lg:grid-cols-2">
        {d.story.map((s) => (
          <div key={s.title} className={cn('rounded-r-xl border-l-4 bg-[#f8f9fc] px-4 py-3', TONE[s.tone])}>
            <p className="text-sm font-semibold text-heading">{s.title}</p>
            <p className="mt-0.5 text-sm leading-relaxed text-(--color-text)">{s.text}</p>
          </div>
        ))}
      </div>
    </ReportCard>
  );
}

function ScoreTable({ d, filter, sel, onSel }: { d: Dashboard; filter: Filter; sel: number | null; onSel: (c: number | null) => void }) {
  const rows = useMemo(() => d.rows.filter((r) => filter === 'all' || r.light === filter).sort((a, b) => LIGHT_ORDER[a.light] - LIGHT_ORDER[b.light] || n(a.adjustedTiyin) - n(b.adjustedTiyin)), [d, filter]);
  const t = d.totals;
  return (
    <RTable minWidth={1280}>
      <thead>
        <tr>
          <Th rowSpan={2} className={cn(STICKY_NO, 'z-[2]')}>
            №
          </Th>
          <Th rowSpan={2} className={cn(STICKY_NAME, 'z-[2] min-w-40 text-left')}>
            Hudud
          </Th>
          <GroupTh span={2}>{d.lastLabel}</GroupTh>
          <GroupTh span={2}>{d.ytdLabel}</GroupTh>
          <Th rowSpan={2}>Salohiyatdan foydalanish</Th>
          <GroupTh span={2}>{d.nextLabel} prognozi</GroupTh>
          <Th rowSpan={2}>KPI (daromad)</Th>
          <Th rowSpan={2} className="min-w-56">
            Sabab
          </Th>
        </tr>
        <tr>
          <Th className="first:border-l">Daromad</Th>
          <Th>Natija (Markaz bilan)</Th>
          <Th>Daromad</Th>
          <Th>Natija</Th>
          <Th>Natija</Th>
          <Th>Zarar ehtimoli</Th>
        </tr>
      </thead>
      <tbody>
        <Tr total>
          <Td className={STICKY_NO} />
          <NameCell sub="barcha hududlar">Hududlar jami</NameCell>
          <Td className="whitespace-nowrap">
            {sum(t.revenueTiyin)}
            <Growth x={t.revenueGrowth} />
          </Td>
          <MoneyCell value={n(t.adjustedTiyin)} strong signedColor />
          <Td className="whitespace-nowrap">
            {sum(t.ytdRevenueTiyin)}
            <Growth x={t.ytdGrowth} />
          </Td>
          <Td />
          <Td>{share(t.utilization)}</Td>
          <MoneyCell value={n(t.forecastResultTiyin)} strong signedColor />
          <Td />
          <Td />
          <Td className="text-left text-xs">
            {d.lights.red} e&apos;tibor · {d.lights.amber} kuzatish · {d.lights.green} yaxshi
          </Td>
        </Tr>
        {rows.map((r, i) => (
          <Row key={r.code} r={r} index={i + 1} active={sel === r.code} onClick={() => onSel(sel === r.code ? null : r.code)} />
        ))}
        {!rows.length && (
          <tr>
            <td colSpan={11}>
              <EmptyNote>Bu holatda hudud yo&apos;q</EmptyNote>
            </td>
          </tr>
        )}
      </tbody>
    </RTable>
  );
}

function Row({ r, index, active, onClick }: { r: DashRow; index: number; active: boolean; onClick: () => void }) {
  const f = r.forecastResultNext;
  const kState = r.kpi.revenueState;
  return (
    <Tr onClick={onClick} className={cn('align-top', active && 'bg-brand-50')}>
      <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{index}</Td>
      <NameCell drill before={<LightDot l={r.light} />} sub={`${r.headcount} xodim`}>
        {r.name}
      </NameCell>
      <Td className="whitespace-nowrap">
        {sum(r.revenueTiyin)}
        <Growth x={r.revenueGrowth} />
      </Td>
      <Td className={cn('whitespace-nowrap font-semibold', n(r.adjustedTiyin) < 0 ? 'text-(--color-expense)' : 'text-heading')}>
        {sum(r.adjustedTiyin)}
        <Sub>rentabellik {share(r.adjustedMargin)}</Sub>
      </Td>
      <Td className="whitespace-nowrap">
        {sum(r.ytdRevenueTiyin)}
        <Growth x={r.ytdRevenueGrowth} />
      </Td>
      <Td className={cn('whitespace-nowrap', n(r.ytdAdjustedTiyin) < 0 && 'text-(--color-expense)')}>{sum(r.ytdAdjustedTiyin)}</Td>
      <Td className={cn('whitespace-nowrap font-semibold', r.utilization !== null && r.utilization < 0.9 ? 'text-amber-700' : 'text-heading')}>{share(r.utilization)}</Td>
      <Td className="whitespace-nowrap">
        {f ? (
          <>
            <span className={cn('font-semibold', n(f.meanTiyin) < 0 ? 'text-(--color-expense)' : 'text-heading')}>{sum(f.meanTiyin)}</span>
            <Sub>
              <span className={cn('rounded px-1', RELIABILITY[r.reliability].cls)}>{RELIABILITY[r.reliability].label}</span>
            </Sub>
          </>
        ) : (
          <span className="text-(--color-text-faint)">—</span>
        )}
      </Td>
      <Td className="whitespace-nowrap">{f ? share(r.lossProb) : <span className="text-(--color-text-faint)">—</span>}</Td>
      <Td className={cn('whitespace-nowrap font-semibold', kState === 'met' ? 'text-(--color-income)' : kState === 'near' ? 'text-amber-700' : kState === 'missed' ? 'text-(--color-expense)' : 'text-(--color-text-faint)')}>
        {r.kpi.revenueAchievement !== null ? share(r.kpi.revenueAchievement) : '—'}
      </Td>
      <Td className={cn('max-w-[280px] text-left text-xs', LIGHT[r.light].text)}>{r.reasons.length ? r.reasons.join('; ') : r.light === 'green' ? 'muammo yo\'q' : ''}</Td>
    </Tr>
  );
}

/** «Nega o'zgardi?» — oldingi oydan joriy oyga natija zinapoyasi va omillar */
export function ExplainPanel({ code, period }: { code: number; period: string }) {
  const res = useAsync(() => dashApi.explain(code, period).then((r) => r.data), [code, period]);
  const x = res.data;
  if (!x) return <LoadingCard label="Omillar hisoblanmoqda" error={res.error} onRetry={res.reload} />;
  return (
    <ReportCard
      title={
        <>
          Nega o&apos;zgardi? {x.region.name}
        </>
      }
      badge={`${x.prevLabel} → ${x.periodLabel}`}
    >
      <div className="px-5 pb-3">
        <p className="text-sm font-semibold text-heading">{x.headline}</p>
        {x.parts.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-sm text-(--color-text)">
            {x.parts.map((p) => (
              <li key={p}>• {p}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="px-5 pb-4">
        <div className="rounded-xl border border-(--color-line) px-3 py-2">
          <Waterfall x={x} />
        </div>
      </div>
      <div className="grid gap-x-2 lg:grid-cols-2">
        <div>
          <SubTitle>Daromad — xizmatlar</SubTitle>
          <RTable minWidth={560}>
            <thead>
              <tr>
                <Th className="text-left">Xizmat</Th>
                <Th>{x.prevLabel}</Th>
                <Th>{x.periodLabel}</Th>
                <Th>O&apos;zgarish</Th>
                <Th>Hajm / narx</Th>
              </tr>
            </thead>
            <tbody>
              {x.services.slice(0, 8).map((s) => (
                <Tr key={s.key}>
                  <NameCell sticky={false}>{s.label}</NameCell>
                  <MoneyCell value={n(s.prevTiyin)} />
                  <MoneyCell value={n(s.curTiyin)} />
                  <DiffCell value={n(s.deltaTiyin)} />
                  <Td className="whitespace-nowrap">{s.volumeEffectTiyin !== null ? `${sgn(s.volumeEffectTiyin)} / ${sgn(s.priceEffectTiyin!)}` : '—'}</Td>
                </Tr>
              ))}
              {!x.services.length && <NoRows span={5} />}
            </tbody>
          </RTable>
        </div>
        <div>
          <SubTitle>Xarajat — moddalar (ish haqisiz)</SubTitle>
          <RTable minWidth={460}>
            <thead>
              <tr>
                <Th className="text-left">Modda</Th>
                <Th>{x.prevLabel}</Th>
                <Th>{x.periodLabel}</Th>
                <Th>O&apos;zgarish</Th>
              </tr>
            </thead>
            <tbody>
              {x.opex.slice(0, 8).map((o) => (
                <Tr key={o.key}>
                  <NameCell sticky={false}>{o.label}</NameCell>
                  <MoneyCell value={n(o.prevTiyin)} />
                  <MoneyCell value={n(o.curTiyin)} />
                  <DiffCell value={n(o.deltaTiyin)} growthGood={false} />
                </Tr>
              ))}
              {!x.opex.length && <NoRows span={4} />}
            </tbody>
          </RTable>
        </div>
      </div>
      <TableNote>
        Ish haqi: {sum(x.payroll.prevTiyin)} → {sum(x.payroll.curTiyin)}; xodimlar {x.payroll.h0} → {x.payroll.h1} ({sgn(x.payroll.headEffectTiyin)}), o&apos;rtacha {sum(x.payroll.avg0Tiyin)} → {sum(x.payroll.avg1Tiyin)} ({sgn(x.payroll.avgEffectTiyin)}).{' '}
        {x.check.ok ? <span className="font-semibold text-(--color-income)">✓ Omillar yig&apos;indisi natija o&apos;zgarishiga teng.</span> : ''}
      </TableNote>
    </ReportCard>
  );
}

const sgn = (t: string) => `${n(t) > 0 ? '+' : ''}${sum(t)}`;

function NoRows({ span }: { span: number }) {
  return (
    <tr>
      <td colSpan={span} className="px-3 py-2 text-center text-xs text-(--color-text-faint)">
        yozuv yo&apos;q
      </td>
    </tr>
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
