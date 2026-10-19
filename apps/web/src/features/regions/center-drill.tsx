'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import { CalcValue } from '@/components/ui/calc';
import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { compact, num, pct, type CompareMode, type SectionFilter } from '@/features/structure/api';
import { Findings, KpiStrip, SearchBox, SmallButton } from '@/features/structure/parts';
import { changePct, csvSom, downloadCsv } from '@/features/structure/stats';
import { calcChange, calcDivide, calcResult, calcShare, calcSum, Q } from '@/lib/calc';
import { formatDate, formatPeriod, formatPeriodShort } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useBrief } from '@/lib/view-mode';
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { centerDrillApi, type CenterDetailResult, type DepartmentDetailResult, type DepartmentRow, type MoneyPart } from './drill-api';
import { PinflText } from './pinfl-text';
import type { MarkItem } from '@/features/reactions/api';
import { DiscussMenu } from '@/features/reactions/discuss';
import { Mark } from '@/features/reactions/mark';
import { centerMark, centerPartMark, compactMarks, departmentMark, departmentPartMark, employeeMark } from '@/features/reactions/marks';

// ═══════════════════════════════════════════════════════════
// Solishtirma › Markaz — hududlar kabi ichkariga kirish (reja/tushum yo'q):
//   Markaz (daromad manbalari, o'z xarajati, hududlar uchun to'langan) → Bo'limlar → Bo'lim xodimlari → Xodim.
// Qisqa rejimda: kartalar, xulosalar va jadvallar; grafiklar va CSV — To'liq rejimda.
// ═══════════════════════════════════════════════════════════

function Delta({ current, previous, growthGood, what }: { current: number; previous: number; growthGood: boolean; what?: string }) {
  const d = changePct(current, previous);
  const calc = what ? calcChange(`${what}: o'zgarish`, { label: 'Joriy davr', value: current, kind: 'money' }, { label: 'Oldingi davr', value: previous, kind: 'money' }, { growthGood }) : null;
  let body: ReactNode;
  if (d === null) body = <span className="text-[11px] text-(--color-text-faint)">{current !== 0 ? 'yangi' : '—'}</span>;
  else if (Math.abs(d) < 0.05) body = <span className="text-[11px] text-(--color-text-muted)">0%</span>;
  else {
    const good = d > 0 === growthGood;
    body = (
      <span className={cn('inline-flex items-center gap-0.5 whitespace-nowrap text-[11px] font-semibold tabular-nums', good ? 'text-(--color-income)' : 'text-(--color-expense)')}>
        <span className="text-[0.75em]">{d > 0 ? '▲' : '▼'}</span>
        {pct(Math.abs(d))}
      </span>
    );
  }
  return calc ? <CalcValue calc={calc}>{body}</CalcValue> : body;
}

function Money({ tiyin, className }: { tiyin: string | number; className?: string }) {
  return <span className={cn('whitespace-nowrap tabular-nums', className)}>{num(tiyin)}</span>;
}

function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cn('px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)', className)}>{children}</th>;
}

function Section({ title, description, actions, children, className }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-(--color-line) px-5 py-3.5">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold text-heading">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-(--color-text-muted)">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </Card>
  );
}

function Loading({ label, error, onRetry }: { label: string; error: string | null; onRetry: () => void }) {
  return <Card>{error ? <ErrorState message={error} onRetry={onRetry} /> : <LoadingState label={label} />}</Card>;
}

/** Moddalar ro'yxati: nomi, ulushi, summa, o'zgarish */
function PartsList({ parts, total, growthGood, limit, empty, markOf }: { parts: MoneyPart[]; total: number; growthGood: boolean; limit?: number; empty: string; markOf?: (p: MoneyPart) => MarkItem | null }) {
  const shown = limit ? parts.slice(0, limit) : parts;
  const rest = limit ? parts.slice(limit) : [];
  const restSum = rest.reduce((s, p) => s + Number(p.amountTiyin), 0);
  if (!parts.length) return <p className="px-5 py-6 text-center text-sm text-(--color-text-muted)">{empty}</p>;
  return (
    <ul className="divide-y divide-(--color-line)">
      {shown.map((p) => {
        const amount = Number(p.amountTiyin);
        const share = total > 0 ? (amount / total) * 100 : 0;
        return (
          <li key={p.key} className="grid grid-cols-[1fr_auto_auto_4.5rem] items-center gap-3 px-5 py-2 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              {markOf && <Mark item={markOf(p)} />}
              <span className="min-w-0 truncate" title={p.label}>
                {p.label}
              </span>
            </span>
            <span className="text-xs tabular-nums text-(--color-text-muted)">{share.toFixed(1).replace('.', ',')}%</span>
            <Money tiyin={amount} className="font-semibold" />
            <span className="text-right">
              <Delta current={amount} previous={Number(p.previousTiyin)} growthGood={growthGood} what={p.label} />
            </span>
          </li>
        );
      })}
      {rest.length > 0 && (
        <li className="grid grid-cols-[1fr_auto] gap-3 px-5 py-2 text-sm text-(--color-text-muted)">
          <span>Yana {rest.length} ta (batafsil — To&apos;liq rejimda)</span>
          <Money tiyin={restSum} />
        </li>
      )}
    </ul>
  );
}

/** 12 oy: daromad (yashil) va xarajat (qizil, ichida — hududlar uchun och, asosiy vositalar sarfi — sariq) */
function MonthBars({ months, income, own, regional, assets = [] }: { months: string[]; income: string[]; own: string[]; regional: string[]; assets?: string[] }) {
  const max = Math.max(1, ...months.map((_, i) => Math.max(Number(income[i] ?? 0), Number(own[i] ?? 0) + Number(regional[i] ?? 0) + Number(assets[i] ?? 0))));
  return (
    <div className="px-5 py-4">
      <div className="flex h-44 items-end gap-1.5">
        {months.map((m, i) => {
          const inc = Number(income[i] ?? 0);
          const o = Number(own[i] ?? 0);
          const r = Number(regional[i] ?? 0);
          const a = Number(assets[i] ?? 0);
          const x = o + r + a;
          return (
            <div key={m} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${formatPeriod(m)}: daromad ${compact(inc)}, xarajat ${compact(x)} (hududlar uchun ${compact(r)}${a ? `, asosiy vositalar sarfi ${compact(a)}` : ''})`}>
              <div className="flex h-full w-full items-end justify-center gap-0.5">
                <div className="w-1/2 max-w-4 rounded-t-sm bg-(--color-income)" style={{ height: `${(inc / max) * 100}%` }} />
                <div className="flex w-1/2 max-w-4 flex-col justify-end" style={{ height: `${(x / max) * 100}%` }}>
                  <div className="rounded-t-sm" style={{ height: x > 0 ? `${(a / x) * 100}%` : 0, background: '#d69e2e' }} />
                  <div className="bg-(--color-expense)/40" style={{ height: x > 0 ? `${(r / x) * 100}%` : 0 }} />
                  <div className="bg-(--color-expense)" style={{ height: x > 0 ? `${(o / x) * 100}%` : 0 }} />
                </div>
              </div>
              <span className="text-[10px] text-(--color-text-muted)">{formatPeriodShort(m).split(' ')[0]}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-(--color-text-muted)">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-(--color-income)" />Daromad</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-(--color-expense)" />O&apos;z xarajati</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-(--color-expense)/40" />Hududlar uchun</span>
        {assets.some((v) => Number(v) !== 0) && <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: '#d69e2e' }} />Asosiy vositalar sarfi</span>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Markaz
// ═══════════════════════════════════════════════════════════

export function CenterDrill({
  range,
  section,
  compare,
  coverage,
  onDepartment,
}: {
  range: DateRange;
  section: SectionFilter;
  compare: CompareMode;
  /** Hududlar foydasi ÷ Markaz sof xarajati, % (Solishtirmadan) */
  coverage: number | null;
  onDepartment: (row: DepartmentRow) => void;
}) {
  const result = useAsync(() => centerDrillApi.center(range, section, compare).then((r) => r.data), [range.from, range.to, section, compare]);
  if (!result.data) return <Loading label="Markaz hisoblanmoqda" error={result.error} onRetry={result.reload} />;
  return <CenterBody data={result.data} coverage={coverage} onDepartment={onDepartment} />;
}

function CenterBody({ data, coverage, onDepartment }: { data: CenterDetailResult; coverage: number | null; onDepartment: (row: DepartmentRow) => void }) {
  const brief = useBrief();
  const [query, setQuery] = useState('');
  const t = data.totals;
  const income = Number(t.incomeTiyin);
  const own = Number(t.ownExpenseTiyin);
  const regional = Number(t.regionalExpenseTiyin);
  /** 2-guruh: asosiy vositalar sarfi (xarid balansda) */
  const assets = Number(t.assetsExpenseTiyin ?? 0);
  const currentExp = own + regional;
  const expense = Number(t.expenseTiyin);
  const net = income - expense;
  const prevNet = Number(t.previousIncomeTiyin) - Number(t.previousExpenseTiyin);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.departments.filter((d) => !q || d.name.toLowerCase().includes(q));
  }, [data.departments, query]);
  const max = Math.max(1, ...data.departments.map((d) => Number(d.expenseTiyin)));

  const exportCsv = () =>
    downloadCsv(
      `solishtirma-markaz-bolimlar-${data.range.from}_${data.range.to}`,
      ["Bo'lim", 'Xodimlar', "Ish haqi, so'm", "Boshqa xarajat, so'm", "Xarajat, so'm", `${data.compareLabel}: xarajat, so'm`, "Bir xodimga, so'm", "Daromad, so'm"],
      data.departments.map((d) => [d.name, d.headcount, csvSom(d.payrollTiyin), csvSom(d.otherTiyin), csvSom(d.expenseTiyin), csvSom(d.previousExpenseTiyin), d.perHeadTiyin ? csvSom(d.perHeadTiyin) : '', csvSom(d.incomeTiyin)]),
    );

  return (
    <div className="space-y-4">
      {(() => {
        const items = compactMarks([
          centerMark(data.center.name, 'RESULT', data.section),
          centerMark(data.center.name, 'EXPENSE', data.section),
          centerMark(data.center.name, 'INCOME', data.section),
          ...data.departments.map((d) => departmentMark(d.id, d.name, 'EXPENSE', data.section)),
          ...data.incomeParts.map((p) => centerPartMark('INCOME', p, data.section)),
          ...data.ownParts.map((p) => centerPartMark('EXPENSE', p, data.section)),
          ...data.regionalParts.map((p) => centerPartMark('EXPENSE', p, data.section, true)),
        ]);
        return (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-(--radius-card) border border-brand-100 bg-brand-50/50 px-4 py-2.5">
            <p className="text-xs text-(--color-text-muted)">
              <b className="text-heading">{data.center.name}</b> — natijasi, xarajati, daromadi, istalgan bo&apos;lim, daromad manbai yoki xarajat moddasini Munosabatga belgilash mumkin.
            </p>
            <DiscussMenu items={items} />
          </div>
        );
      })()}
      <KpiStrip
        items={[
          {
            label: 'Markaz daromadi',
            value: compact(income),
            valueClass: 'text-(--color-income)',
            sub: <Delta what="Markaz daromadi" current={income} previous={Number(t.previousIncomeTiyin)} growthGood />,
            calc: calcSum('Markaz daromadi', data.incomeParts.map((p) => Q.money(p.label, p.amountTiyin, 'Daromadlar'))),
          },
          {
            label: '1. Joriy xarajatlar',
            value: compact(currentExp),
            valueClass: 'text-(--color-expense)',
            sub: (
              <>
                <Delta what="Markaz joriy xarajati" current={currentExp} previous={Number(t.previousOwnExpenseTiyin) + Number(t.previousRegionalExpenseTiyin)} growthGood={false} /> · o&apos;ziniki {compact(own)} (ish haqi{' '}
                {compact(t.payrollTiyin)}) + hududlar uchun {compact(regional)}
              </>
            ),
            calc: calcSum('Joriy xarajatlar', [
              ...data.ownParts.map((p) => Q.money(p.label, p.amountTiyin, "O'ziniki")),
              ...data.regionalParts.map((p) => Q.money(`Hududlar uchun: ${p.label}`, p.amountTiyin, 'Xarajatlar siyosati')),
            ]),
          },
          {
            label: '2. Asosiy vositalar sarfi',
            value: compact(assets),
            valueClass: assets ? 'text-amber-700' : undefined,
            sub: (
              <>
                {assets ? <Delta what="Asosiy vositalar sarfi" current={assets} previous={Number(t.previousAssetsExpenseTiyin ?? 0)} growthGood={false} /> : null}
                {assets ? ' · ' : ''}xarid balansda, xarajatga oylik sarf ·{' '}
                <Link href="/xarajatlar/asosiy-vositalar" className="font-semibold text-brand-700 underline">
                  batafsil
                </Link>
              </>
            ),
          },
          {
            label: net >= 0 ? 'Markaz natijasi' : 'Markaz sof xarajati',
            value: compact(net),
            valueClass: net >= 0 ? 'text-(--color-income)' : 'text-(--color-expense)',
            sub: coverage !== null ? `hududlar foydasi qoplaydi: ${pct(coverage)}` : `${data.compareLabel}: ${compact(prevNet)}`,
            calc: calcResult(income, expense, { title: 'Markaz natijasi', note: `Xarajat = o'z xarajati ${compact(own)} + hududlar uchun ${compact(regional)}${assets ? ` + asosiy vositalar sarfi ${compact(assets)}` : ''}` }),
          },
        ]}
      />

      <Findings title="Asosiy xulosalar" notes={brief ? data.notes.slice(0, 3) : data.notes} />

      {/* Daromad manbalari va xarajat tarkibi — To'liq rejimda */}
      {!brief && (
      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Daromad manbalari" description={`Markazga yozilgan daromad · o'zgarish: ${data.compareLabel}ga nisbatan`}>
          <PartsList parts={data.incomeParts} total={income} growthGood limit={brief ? 6 : undefined} empty="Bu davrda Markazga yozilgan daromad yo'q (Daromadlar › Markaz tushumi)" markOf={(p) => centerPartMark('INCOME', p, data.section)} />
        </Section>
        <Section title="Xarajat tarkibi" description="1. Joriy: o'ziniki va hududlar uchun · 2. Asosiy vositalar sarfi">
          <p className="border-b border-(--color-line) bg-(--color-surface-muted) px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">
            1a. O&apos;z xarajati · {compact(own)}
          </p>
          <PartsList parts={data.ownParts} total={own} growthGood={false} limit={brief ? 5 : undefined} empty="O'z xarajati yo'q" markOf={(p) => centerPartMark('EXPENSE', p, data.section)} />
          <p className="border-y border-(--color-line) bg-(--color-surface-muted) px-5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">
            1b. Hududlar uchun to&apos;langan · {compact(regional)}
          </p>
          <PartsList parts={data.regionalParts} total={regional} growthGood={false} limit={brief ? 5 : undefined} empty="Xarajatlar siyosatida Markaz hisobidan moddalar yo'q yoki bu davrda yozilmagan" markOf={(p) => centerPartMark('EXPENSE', p, data.section, true)} />
          <div className="flex items-center justify-between gap-3 border-t border-(--color-line) bg-amber-50/50 px-5 py-2.5 text-sm">
            <span>
              <b className="text-heading">2. Asosiy vositalar sarfi · {compact(assets)}</b>
              <span className="block text-xs text-(--color-text-muted)">Xarid balansda turadi — xarajatga har oy faqat sarfi (eskirishi) o&apos;tadi</span>
            </span>
            <Link href="/xarajatlar/asosiy-vositalar" className="whitespace-nowrap text-xs font-semibold text-brand-700 underline">
              Asosiy vositalar →
            </Link>
          </div>
        </Section>
      </div>
      )}

      <Section
        title="Markaz bo'limlari"
        description={`${formatDate(data.range.from)} — ${formatDate(data.range.to)} · ${t.headcount} xodim · bo'limni bosing — xodimlari ochiladi`}
        actions={
          !brief ? (
            <>
              <SearchBox value={query} onChange={setQuery} placeholder="Bo'lim qidirish…" />
              <SmallButton onClick={exportCsv}>Excel (CSV)</SmallButton>
            </>
          ) : undefined
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-(--color-line) bg-(--color-surface-muted) text-left">
              <tr>
                <Th className="pl-5">Bo&apos;lim</Th>
                <Th className="text-right">Xodim</Th>
                <Th className="text-right">Ish haqi</Th>
                {!brief && <Th className="text-right">Boshqa</Th>}
                <Th className="text-right">Xarajat</Th>
                <Th className="text-right">O&apos;zgarish</Th>
                <Th className={cn('text-right', brief && 'pr-5')}>Bir xodimga</Th>
                {!brief && <Th className="pr-5">Asosiy moddalar</Th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-(--color-line)">
              {rows.map((d) => {
                const exp = Number(d.expenseTiyin);
                return (
                  <tr key={d.id} className={cn('group cursor-pointer hover:bg-(--color-surface-muted)', d.unassigned && 'bg-slate-50')} onClick={() => onDepartment(d)}>
                    <td className="py-2.5 pl-5 pr-3">
                      <span className="flex items-center gap-2">
                        <Mark item={departmentMark(d.id, d.name, 'EXPENSE', data.section)} />
                        <span className={cn('font-medium group-hover:underline', d.unassigned && 'italic text-(--color-text-muted)')}>{d.name}</span>
                      </span>
                      {!brief && (
                        <span className="mt-1 block h-1 w-full max-w-48 overflow-hidden rounded-full bg-(--color-surface-sunken)">
                          <span className="block h-full rounded-full bg-(--color-expense)" style={{ width: `${(exp / max) * 100}%` }} />
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{d.headcount || '—'}</td>
                    <td className="px-3 py-2.5 text-right">{Number(d.payrollTiyin) ? <Money tiyin={d.payrollTiyin} /> : '—'}</td>
                    {!brief && <td className="px-3 py-2.5 text-right">{Number(d.otherTiyin) ? <Money tiyin={d.otherTiyin} /> : '—'}</td>}
                    <td className="px-3 py-2.5 text-right font-semibold">
                      <Money tiyin={d.expenseTiyin} className="text-(--color-expense)" />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Delta what={`${d.name} xarajati`} current={exp} previous={Number(d.previousExpenseTiyin)} growthGood={false} />
                    </td>
                    <td className={cn('px-3 py-2.5 text-right', brief && 'pr-5')}>
                      {d.perHeadTiyin ? (
                        <CalcValue calc={calcDivide(`${d.name}: bir xodimga xarajat`, Q.money('Xarajat', d.expenseTiyin), { label: 'Xodimlar', value: d.headcount, kind: 'ratio' }, 'money', { formulaId: 'perHead' })}>
                          {compact(d.perHeadTiyin)}
                        </CalcValue>
                      ) : (
                        '—'
                      )}
                    </td>
                    {!brief && (
                      <td className="py-2.5 pl-3 pr-5 text-xs text-(--color-text-muted)">
                        {d.topParts.length ? d.topParts.map((p) => `${p.label} ${compact(p.amountTiyin)}`).join(' · ') : '—'}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-(--color-line-strong) bg-(--color-surface-muted) font-semibold">
              <tr>
                <td className="py-2.5 pl-5 pr-3">O&apos;z xarajati jami</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{t.headcount}</td>
                <td className="px-3 py-2.5 text-right">
                  <Money tiyin={t.payrollTiyin} />
                </td>
                {!brief && (
                  <td className="px-3 py-2.5 text-right">
                    <Money tiyin={own - Number(t.payrollTiyin)} />
                  </td>
                )}
                <td className="px-3 py-2.5 text-right">
                  <CalcValue calc={calcSum("O'z xarajati", data.departments.map((d) => Q.money(d.name, d.expenseTiyin)))}>
                    <Money tiyin={own} className="text-(--color-expense)" />
                  </CalcValue>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Delta current={own} previous={Number(t.previousOwnExpenseTiyin)} growthGood={false} />
                </td>
                <td className={cn('px-3 py-2.5 text-right', brief && 'pr-5')}>{t.headcount > 0 ? compact(own / t.headcount) : '—'}</td>
                {!brief && <td className="pr-5" />}
              </tr>
            </tfoot>
          </table>
        </div>
      </Section>

      {!brief && (
        <div className="grid gap-4 xl:grid-cols-5">
          <Section title="Oxirgi 12 oy" description="Markaz daromadi va xarajati" className="xl:col-span-3">
            <MonthBars months={data.months} income={data.trend.income} own={data.trend.own} regional={data.trend.regional} assets={data.trend.assets} />
          </Section>
          <Section title="Hududlar uchun — kimga" description="Markaz hisobidan to'langan moddalar qaysi hudud uchun" className="xl:col-span-2">
            {data.regionalBy.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-(--color-text-muted)">Bu davrda yo&apos;q</p>
            ) : (
              <ul className="divide-y divide-(--color-line)">
                {data.regionalBy.map((r) => (
                  <li key={String(r.regionCode)} className="flex items-center justify-between gap-3 px-5 py-2 text-sm">
                    <span className="min-w-0 truncate">{r.name}</span>
                    <CalcValue calc={calcShare(`${r.name} ulushi`, Q.money(r.name, r.amountTiyin), Q.money("Hududlar uchun jami", regional))}>
                      <Money tiyin={r.amountTiyin} className="font-semibold" />
                    </CalcValue>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Bo'lim
// ═══════════════════════════════════════════════════════════

export function CenterDepartmentDrill({
  id,
  range,
  section,
  compare,
  onEmployee,
}: {
  id: string;
  range: DateRange;
  section: SectionFilter;
  compare: CompareMode;
  onEmployee: (pinfl: string, name: string) => void;
}) {
  const result = useAsync(() => centerDrillApi.department(id, range, section, compare).then((r) => r.data), [id, range.from, range.to, section, compare]);
  if (!result.data) return <Loading label="Bo'lim hisoblanmoqda" error={result.error} onRetry={result.reload} />;
  return <DepartmentBody data={result.data} onEmployee={onEmployee} />;
}

function DepartmentBody({ data, onEmployee }: { data: DepartmentDetailResult; onEmployee: (pinfl: string, name: string) => void }) {
  const brief = useBrief();
  const [query, setQuery] = useState('');
  const s = data.summary;
  const expense = Number(s.expenseTiyin);
  const payroll = Number(s.payrollTiyin);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.employees.filter((e) => !q || e.fullName.toLowerCase().includes(q) || e.pinfl.includes(q));
  }, [data.employees, query]);
  const exportCsv = () =>
    downloadCsv(
      `solishtirma-markaz-${data.department.name}-xodimlar-${data.range.from}_${data.range.to}`,
      ['F.I.Sh', 'PINFL', 'Lavozim', 'Turi', "Ish haqi, so'm", `${data.compareLabel}: ish haqi, so'm`, 'Oylar'],
      data.employees.map((e) => [e.fullName, e.pinfl, e.position ?? '', e.employmentType === 'SHARTNOMA' ? 'Shartnoma' : 'Shtat', csvSom(e.salaryTiyin), csvSom(e.previousSalaryTiyin), e.paidMonths]),
    );

  return (
    <div className="space-y-4">
      {!data.department.unassigned && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-(--radius-card) border border-brand-100 bg-brand-50/50 px-4 py-2.5">
          <p className="text-xs text-(--color-text-muted)">
            <b className="text-heading">{data.department.name}</b> — bo&apos;lim xarajati, istalgan moddasi yoki xodimi ish haqini Munosabatga belgilash mumkin.
          </p>
          <DiscussMenu
            items={compactMarks([
              departmentMark(data.department.id, data.department.name, 'EXPENSE', data.section),
              ...data.expenseParts.map((p) => departmentPartMark(data.department.id, data.department.name, p, data.section)),
              ...data.employees.map((e) => employeeMark(e.pinfl, e.fullName, 'EXPENSE', 'Solishtirma › Markaz xodimi')),
            ])}
          />
        </div>
      )}
      <KpiStrip
        items={[
          {
            label: "Bo'lim xarajati",
            value: compact(expense),
            valueClass: 'text-(--color-expense)',
            sub: <Delta what="Bo'lim xarajati" current={expense} previous={Number(s.previousExpenseTiyin)} growthGood={false} />,
            calc: calcSum("Bo'lim xarajati", data.expenseParts.map((p) => Q.money(p.label, p.amountTiyin))),
          },
          {
            label: 'Ish haqi',
            value: compact(payroll),
            sub: <Delta what="Bo'lim ish haqi" current={payroll} previous={Number(s.previousPayrollTiyin)} growthGood={false} />,
            calc: calcSum('Ish haqi', data.employees.filter((e) => Number(e.salaryTiyin)).map((e) => Q.money(e.fullName, e.salaryTiyin, 'Ish haqi qaydnomasi'))),
          },
          { label: 'Xodimlar', value: `${s.headcount} ta`, sub: `${data.employees.filter((e) => Number(e.salaryTiyin) > 0).length} tasiga ish haqi yozilgan` },
          {
            label: 'Bir xodimga',
            value: s.perHeadTiyin ? compact(s.perHeadTiyin) : '—',
            sub: Number(s.incomeTiyin) ? `bo'lim daromadi ${compact(s.incomeTiyin)}` : 'xarajat ÷ xodimlar',
            calc: s.perHeadTiyin ? calcDivide('Bir xodimga xarajat', Q.money('Xarajat', s.expenseTiyin), { label: 'Xodimlar', value: s.headcount, kind: 'ratio' }, 'money', { formulaId: 'perHead' }) : null,
          },
        ]}
      />

      <Findings title="Asosiy xulosalar" notes={data.notes} />

      <div className={cn('grid gap-4', data.incomeParts.length > 0 && 'xl:grid-cols-2')}>
        <Section title="Xarajat tarkibi" description={`O'zgarish: ${data.compareLabel}ga nisbatan`}>
          <PartsList parts={data.expenseParts} total={expense} growthGood={false} limit={brief ? 6 : undefined} empty="Bu davrda xarajat yo'q" markOf={(p) => departmentPartMark(data.department.id, data.department.name, p, data.section)} />
        </Section>
        {data.incomeParts.length > 0 && (
          <Section title="Bo'lim daromadi" description="Shu bo'limga yozilgan daromad">
            <PartsList parts={data.incomeParts} total={Number(s.incomeTiyin)} growthGood limit={brief ? 6 : undefined} empty="" />
          </Section>
        )}
      </div>

      <Section
        title={`Xodimlar — ${data.employees.length} ta`}
        description="Xodimni bosing — oylar bo'yicha ish haqi ochiladi"
        actions={
          !brief ? (
            <>
              <SearchBox value={query} onChange={setQuery} placeholder="F.I.Sh yoki PINFL…" />
              <SmallButton onClick={exportCsv}>Excel (CSV)</SmallButton>
            </>
          ) : undefined
        }
      >
        {list.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-(--color-text-muted)">Bo&apos;limda xodim yo&apos;q</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-(--color-line) bg-(--color-surface-muted) text-left">
                <tr>
                  <Th className="pl-5">Xodim</Th>
                  <Th>Lavozim</Th>
                  <Th className="text-right">Ish haqi</Th>
                  <Th className="text-right">O&apos;zgarish</Th>
                  <Th className="pr-5 text-right">Oylar</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-line)">
                {list.map((e) => (
                  <tr key={e.pinfl} className="group cursor-pointer hover:bg-(--color-surface-muted)" onClick={() => onEmployee(e.pinfl, e.fullName)}>
                    <td className="py-2.5 pl-5 pr-3">
                      <span className="flex items-center gap-2">
                        <Mark item={employeeMark(e.pinfl, e.fullName, 'EXPENSE', "Solishtirma › Markaz xodimi")} />
                        <span className="block font-medium group-hover:underline">{e.fullName}</span>
                      </span>
                      <span className="text-xs text-(--color-text-faint)">
                        <PinflText pinfl={e.pinfl} />
                        {e.employmentType === 'SHARTNOMA' ? ' · shartnoma' : ''}
                        {!e.isActive ? ' · ishdan ketgan' : ''}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-(--color-text-muted)">{e.position ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right">{Number(e.salaryTiyin) ? <Money tiyin={e.salaryTiyin} className="text-(--color-expense)" /> : <span className="text-xs text-amber-700">yozilmagan</span>}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Delta current={Number(e.salaryTiyin)} previous={Number(e.previousSalaryTiyin)} growthGood={false} />
                    </td>
                    <td className="py-2.5 pl-3 pr-5 text-right tabular-nums text-(--color-text-muted)">{e.paidMonths || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}