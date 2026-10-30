'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import {
  changeOf,
  ExcelButton,
  MoneyCell,
  NameCell,
  PctBadge,
  PctInline,
  PillTabs,
  ReportCard,
  RTable,
  SearchInput,
  StatTiles,
  STICKY_NAME,
  STICKY_NO,
  sum,
  TableNote,
  Td,
  Th,
  Tr,
  type StatTile,
} from '@/components/report/report';
import { EmptyNote, LoadingCard } from '@/components/report/report-extra-c';
import { IconArrowRight } from '@/components/ui/icons';
import { monthLabel } from '@/features/explore/api';
import { DrillProvider, useDrill } from '@/features/explore/drill';
import { type CompareMode, type SectionFilter } from '@/features/structure/api';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { unitByCode, type EntryUnit } from '@/lib/segments';
import { useAsync } from '@/lib/use-async';
import { cn, cap } from '@/lib/utils';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { segmentApi, type DrillNode, type SegFlow, type SegmentView } from './segment-api';
import { HisobPanel } from '@/features/qomita/qomita-hisob';
import { SegmentSides } from './segment-sides';

// ═══════════════════════════════════════════════════════════
// Solishtirma › Tax free / Marksheyder / Fermer xo'jaligi / Buxgalteriya xizmatlari / Qo'mita —
// Markaz bo'limi kabi: kartalar → yorliqlar (daromad manbalari, xarajat tarkibi — ichma-ich; oylar kesimida; siyosat oqimlari).
// Qo'mita — oxirida «Qo'mita pullari sarfi (3802)»: qaysi bo'limga qancha kelgani, qoplangani, sarfi va xodimlar.
// Istalgan summa bosilsa — o'sha summani tashkil qilgan yozuvlar ochiladi.
// ═══════════════════════════════════════════════════════════

const n = (s: string) => Number(s);

type View = 'both' | 'income' | 'expense' | 'months' | 'flows' | 'qomita';

export function SegmentSolishtirma({ unit, range }: { unit: EntryUnit; range: DateRange }) {
  // Doim: barcha yozuvlar, o'tgan teng davr bilan («Yozuvlar» / «Solishtirish» tanlovlari olib tashlangan)
  const section: SectionFilter = 'ALL';
  const compare: CompareMode = 'prev';
  const res = useAsync(() => segmentApi.view(unit.code, range, section, compare).then((r) => r.data), [unit.code, range.from, range.to, section, compare]);

  return (
    <DrillProvider range={{ from: range.from, to: range.to }}>
      <div className="space-y-4">
        {!res.data ? <LoadingCard label="Hisoblanmoqda" error={res.error} onRetry={res.reload} /> : <Body d={res.data} unit={unit} range={range} />}
      </div>
    </DrillProvider>
  );
}

function fmtRange(r: { from: string; to: string }) {
  const f = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
  return `${f(r.from)} — ${f(r.to)}`;
}

function Body({ d, unit, range }: { d: SegmentView; unit: EntryUnit; range: DateRange }) {
  const t = d.totals;
  const ROOT = d.label;
  const income = n(t.incomeTiyin);
  const expense = n(t.expenseTiyin);
  const result = n(t.resultTiyin);
  const empty = !income && !expense && !n(t.previousIncomeTiyin) && !n(t.previousExpenseTiyin);
  const isQomita = unit.code === 'QOMITA';
  const [view, setView] = useState<View>('both');
  const policyHref = `/xarajatlar/bolim/${unit.slug}/siyosat`;
  const hasFlows = d.incoming.length > 0 || d.outgoing.length > 0;
  const pctText = (v: number | null) => (v === null ? '' : `${(v * 100).toFixed(1).replace('.', ',')}%`);

  const tiles: StatTile[] = [
    { label: 'Daromad', value: income, previous: n(t.previousIncomeTiyin), tone: 'green' },
    { label: 'Xarajat', value: expense, previous: n(t.previousExpenseTiyin), growthGood: false, tone: 'red' },
    { label: result >= 0 ? 'Natija (foyda)' : 'Natija (zarar)', value: result, previous: n(t.previousResultTiyin), signed: true, tone: 'blue' },
    { label: 'Rentabellik', value: 0, text: pctText(t.margin), note: `Avval ${pctText(t.previousMargin)} · natija ÷ daromad`, tone: 'purple' },
    {
      label: "Korxonadagi ulushi",
      value: 0,
      text: pctText(t.incomeShare),
      note: `${t.incomeCount} ta daromad · ${t.expenseCount} ta xarajat yozuvi`,
      tone: 'cyan',
    },
  ];

  // Avval — daromad va xarajat yonma-yon; so'ng Markaz bo'limi tartibida: daromad manbalari → xarajat tarkibi → oylar;
  // siyosat oqimlari, Qo'mitada — Qo'mita pullari sarfi (3802 va Marksheyder)
  const views: { value: View; label: string }[] = [
    { value: 'both', label: 'Daromad va xarajat' },
    { value: 'income', label: 'Daromad manbalari' },
    { value: 'expense', label: 'Xarajat tarkibi' },
    { value: 'months', label: 'Oylar kesimida' },
    ...(hasFlows ? [{ value: 'flows' as const, label: 'Siyosat oqimlari' }] : []),
    ...(isQomita ? [{ value: 'qomita' as const, label: "Qo'mita pullari sarfi (3802 va Marksheyder)" }] : []),
  ];

  return (
    <>
      <StatTiles items={tiles} compareLabel="Avval" />

      {empty && !isQomita ? (
        <div className="rounded-2xl bg-white px-6 py-12 text-center shadow-card">
          <p className="text-sm font-semibold text-heading">Bu davrda «{d.label}» bo&apos;yicha yozuv yo&apos;q</p>
          <p className="mt-1 text-xs text-(--color-text-muted)">
            Daromad va xarajat «{d.label}» bo&apos;limida kiritilgach shu yerda chiqadi:{' '}
            <Link href={`/xarajatlar/bolim/${unit.slug}`} className="font-semibold text-brand-700 hover:underline">
              Xarajatlar › {d.label}
            </Link>
          </p>
        </div>
      ) : (
        <>
          <PillTabs value={view} onChange={setView} options={views} />

          {view === 'both' && <SegmentSides d={d} isQomita={isQomita} />}

          {view === 'expense' && (
            <TreeCard
              title={`${d.label}: xarajat tarkibi`}
              hint="Tuzilma → xodim / filial / to'lov oluvchi / modda → oylar → yozuvlar"
              nodes={d.tree.expense}
              months={d.tree.months}
              total={expense}
              kind="expense"
              root={`${ROOT} › Xarajat`}
              compareLabel={d.compareLabel}
              badge={`Joriy: ${fmtRange(d.range)} · ${d.compareLabel}: ${fmtRange(d.previousRange)}`}
              footer={
                <>
                  Ish haqi {sum(n(t.payrollTiyin))} so&apos;m.
                  {n(t.incomingTiyin) || n(t.outgoingTiyin) ? ` Siyosat: +${sum(n(t.incomingTiyin))} kelgan, −${sum(n(t.outgoingTiyin))} o'tgan.` : ''} Qaysi modda kim hisobida —{' '}
                  <Link href={policyHref} className="font-semibold text-brand-700 hover:underline">
                    Xarajatlar › {d.label} › Xarajatlar siyosati
                  </Link>
                </>
              }
            />
          )}
          {view === 'income' && (
            <TreeCard
              title={`${d.label}: daromad manbalari`}
              hint="Xizmat turi → mijoz → oylar → yozuvlar"
              nodes={d.tree.income}
              months={d.tree.months}
              total={income}
              kind="income"
              root={`${ROOT} › Daromad`}
              compareLabel={d.compareLabel}
              badge={`Joriy: ${fmtRange(d.range)} · ${d.compareLabel}: ${fmtRange(d.previousRange)}`}
            />
          )}
          {view === 'flows' && (
            <>
              <FlowCard title={`Boshqa bo'limlardan «${d.label}» hisobiga`} hint="Xarajatlar siyosati bo'yicha — xarajatga qo'shilgan" flows={d.incoming} dir="in" root={ROOT} />
              <FlowCard title={`«${d.label}»dan boshqa bo'lim hisobiga`} hint="Shu yerda yozilgan, lekin xarajatga kirmaydi" flows={d.outgoing} dir="out" root={ROOT} />
            </>
          )}
          {view === 'months' && <MonthsCard d={d} />}
          {view === 'qomita' && (
            // Qo'mita pullari: 3802 va Marksheyder — kelgan → sarflangan → qoldiq, ichma-ich (Bosh sahifa › Qo'mita pullari sarfi bilan bir xil).
            // Solishtirmada faqat ko'rish: o'zgartirish — «3802 — Qo'mita qoplashi» sahifasida
            <HisobPanel from={range.from.slice(0, 7)} to={range.to.slice(0, 7)} isAdmin={false} onToast={() => undefined} />
          )}
        </>
      )}
    </>
  );
}

function FlowCard({ title, hint, flows, dir, root }: { title: string; hint: string; flows: SegFlow[]; dir: 'in' | 'out'; root: string }) {
  const { open } = useDrill();
  const total = flows.reduce((s, f) => s + n(f.amountTiyin), 0);
  return (
    <ReportCard title={title} badge={hint}>
      {flows.length ? (
        <RTable minWidth={760}>
          <thead>
            <tr>
              <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
              <Th className={cn(STICKY_NAME, 'z-[2] min-w-36 text-left')}>Yo&apos;nalish</Th>
              <Th className="text-left">Modda</Th>
              <Th>Summasi</Th>
              <Th>Yozuvlar</Th>
            </tr>
          </thead>
          <tbody>
            <Tr total>
              <Td className={STICKY_NO} />
              <NameCell>Jami</NameCell>
              <Td />
              <Td className={cn('whitespace-nowrap', dir === 'in' ? 'text-(--color-expense)' : 'text-(--color-income)')}>
                {dir === 'in' ? '+' : '−'}
                {sum(total)}
              </Td>
              <Td>{flows.reduce((s, f) => s + f.count, 0)}</Td>
            </Tr>
            {flows.map((f, i) => (
              <Tr key={`${f.unit}-${f.code}`}>
                <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                <NameCell>
                  <span className="inline-flex items-center gap-1 text-(--color-text-muted)">
                    {dir === 'in' ? f.unitLabel : root}
                    <IconArrowRight className="size-3 text-brand-600" />
                    {dir === 'in' ? root : f.unitLabel}
                  </span>
                </NameCell>
                <Td className="text-left text-heading">{f.label}</Td>
                <Td className="whitespace-nowrap">
                  <button
                    type="button"
                    disabled={!n(f.amountTiyin)}
                    onClick={() => open({ kind: 'expense', f: f.f, title: `${f.unitLabel} › ${f.label}`, expected: n(f.amountTiyin) })}
                    className="font-semibold text-heading hover:text-brand-700 hover:underline disabled:text-(--color-text-faint)"
                  >
                    {n(f.amountTiyin) ? sum(n(f.amountTiyin)) : ''}
                  </button>
                </Td>
                <Td className="text-(--color-text-muted)">{f.count}</Td>
              </Tr>
            ))}
          </tbody>
        </RTable>
      ) : (
        <EmptyNote>Yo&apos;q</EmptyNote>
      )}
    </ReportCard>
  );
}

function MonthsCard({ d }: { d: SegmentView }) {
  const rows = d.months.map((m, i) => ({ m, inc: n(d.trend.income[i] ?? '0'), exp: n(d.trend.expense[i] ?? '0'), res: n(d.trend.result[i] ?? '0') })).filter((r) => r.inc || r.exp || r.res);
  const ti = rows.reduce((a, r) => a + r.inc, 0);
  const te = rows.reduce((a, r) => a + r.exp, 0);
  const tr = rows.reduce((a, r) => a + r.res, 0);
  const exportCsv = () =>
    downloadCsv(
      `solishtirma-${d.label}-oylar`,
      ['Oy', "Daromad, so'm", "Xarajat, so'm", "Natija, so'm"],
      rows.map((r) => [monthLabel(r.m), csvSom(r.inc), csvSom(r.exp), csvSom(r.res)]),
    );
  return (
    <ReportCard
      title={`${d.label}: so'nggi ${d.months.length} oy`}
      badge="Daromad, xarajat va natija oyma-oy"
      actions={rows.length ? <ExcelButton onClick={exportCsv} /> : undefined}
    >
      {rows.length === 0 ? (
        <EmptyNote>Ma&apos;lumot yo&apos;q</EmptyNote>
      ) : (
        <RTable minWidth={640}>
          <thead>
            <tr>
              <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
              <Th className={cn(STICKY_NAME, 'z-[2] min-w-40 text-left')}>Oy</Th>
              <Th>Daromad</Th>
              <Th>Xarajat</Th>
              <Th>Natija</Th>
              <Th>Rentabellik</Th>
            </tr>
          </thead>
          <tbody>
            <Tr total>
              <Td className={STICKY_NO} />
              <NameCell>Jami · {rows.length} oy</NameCell>
              <MoneyCell value={ti} />
              <MoneyCell value={te} />
              <MoneyCell value={tr} strong signedColor />
              <Td>
                <PctBadge value={ti > 0 ? (tr / ti) * 100 : null} plain />
              </Td>
            </Tr>
            {[...rows].reverse().map((r, i) => (
              <Tr key={r.m}>
                <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                <NameCell>{monthLabel(r.m)}</NameCell>
                <MoneyCell value={r.inc} className="text-(--color-income)" />
                <MoneyCell value={r.exp} className="text-(--color-expense)" />
                <MoneyCell value={r.res} strong signedColor />
                <Td>
                  <PctBadge value={r.inc > 0 ? (r.res / r.inc) * 100 : null} plain />
                </Td>
              </Tr>
            ))}
          </tbody>
        </RTable>
      )}
    </ReportCard>
  );
}

/** Slug bo'yicha yo'nalish (faqat 4 ta yo'nalish: Markaz va Hududlar — o'z sahifalarida) */
export function segmentUnit(code: string | null | undefined): EntryUnit | null {
  const u = unitByCode(code);
  return u && u.code !== 'CENTER' && u.code !== 'REGION' ? u : null;
}

const HEAD = 'border-b border-l border-(--color-line) bg-[#f3f6fd] px-2 py-2.5 text-center text-xs font-bold text-heading first:border-l-0';
const CELL = 'border-b border-l border-(--color-line) px-2 py-1.5 text-center text-[13px] tabular-nums first:border-l-0';

/** Ichma-ich jadval: ▸ — ichiga; summa — yozuvlar; «Oylar kesimida» — har oy ustuni (katak bosilsa — o'sha oy yozuvlari) */
function TreeCard({
  title,
  hint,
  nodes,
  months,
  total,
  kind,
  root,
  compareLabel,
  badge,
  footer,
}: {
  title: string;
  hint: string;
  nodes: DrillNode[];
  months: string[];
  total: number;
  kind: 'income' | 'expense';
  root: string;
  compareLabel: string;
  badge: string;
  footer?: ReactNode;
}) {
  const { open } = useDrill();
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [byMonth, setByMonth] = useState(false);
  // Qidirish (nomi yoki ichidagi qatorlar nomi bo'yicha) va Excelga eksport — Markaz va Hududlar kabi
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const hit = (nd: DrillNode): boolean => nd.label.toLowerCase().includes(q) || (nd.children ?? []).some(hit);
  const shown = q ? nodes.filter(hit) : nodes;
  const exportCsv = () => {
    const out: (string | number)[][] = [];
    const flat = (list: DrillNode[], depth: number) => {
      for (const nd of list) {
        out.push([`${'  '.repeat(depth)}${nd.label}`, csvSom(n(nd.previousTiyin)), csvSom(n(nd.amountTiyin)), ...months.map((_, i) => csvSom(n(nd.values[i] ?? '0')))]);
        flat(nd.children ?? [], depth + 1);
      }
    };
    flat(shown, 0);
    downloadCsv(`solishtirma-${root}`.replace(/[^\p{L}\p{N}._-]+/gu, '_'), ['Nomi', `${compareLabel}, so'm`, "Joriy davr, so'm", ...months.map((m) => `${monthLabel(m)}, so'm`)], out);
  };
  const toggle = (id: string) =>
    setOpened((s) => {
      const x = new Set(s);
      if (x.has(id)) x.delete(id);
      else x.add(id);
      return x;
    });
  const drill = (node: DrillNode, path: string[], month?: string, value?: number) =>
    node.f && open({ kind, f: { ...node.f, ...(month ? { month } : {}) }, title: [root, ...path, ...(month ? [monthLabel(month)] : [])].join(' › '), expected: value });
  const many = months.length > 1;
  const growthGood = kind === 'income';
  const prevTotal = nodes.reduce((s, nd) => s + n(nd.previousTiyin), 0);

  const rows: ReactNode[] = [];
  const walk = (list: DrillNode[], depth: number, parentId: string, path: string[]) => {
    for (const nd of list) {
      const id = `${parentId}/${nd.key}`;
      const cur = n(nd.amountTiyin);
      const prev = n(nd.previousTiyin);
      const diff = cur - prev;
      const kids = nd.children ?? [];
      const monthKids = !kids.length && many ? months.map((m, i) => ({ m, v: n(nd.values[i] ?? '0') })).filter((x) => x.v !== 0) : [];
      const expandable = kids.length > 0 || monthKids.length > 1;
      const isOpen = opened.has(id);
      const p = [...path, nd.label];
      const good = Math.round(diff / 100) === 0 ? null : diff > 0 === growthGood;
      rows.push(
        <tr key={id} className={cn(depth === 0 ? 'bg-white font-medium' : depth === 1 ? 'bg-[#fafbfe]' : 'bg-[#f4f6fb]', expandable && 'cursor-pointer hover:bg-brand-50')} onClick={expandable ? () => toggle(id) : undefined}>
          <td className={cn(CELL, 'text-left')} style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}>
            <span className="flex items-center gap-1.5">
              <span className={cn('inline-block w-3 text-xs text-(--color-text-faint) transition-transform', isOpen && 'rotate-90', !expandable && 'invisible')}>▸</span>
              <span className={cn('text-heading', depth === 0 && 'font-semibold')} title={nd.hint}>
                {nd.label}
              </span>
              {kids.length > 0 && <span className="text-xs text-(--color-text-faint)">{kids.length}</span>}
              {nd.count ? <span className="text-[11px] text-(--color-text-faint)">· {nd.count} ta</span> : null}
            </span>
          </td>
          {!byMonth && (
            <>
              <td className={cn(CELL, 'whitespace-nowrap text-(--color-text-muted)')}>{prev ? sum(prev) : ''}</td>
              <td className={cn(CELL, 'whitespace-nowrap')}>
                {nd.f && cur ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      drill(nd, p, undefined, cur);
                    }}
                    className="text-heading hover:text-brand-700 hover:underline"
                  >
                    {sum(cur)}
                  </button>
                ) : (
                  <span className={cn(cur < 0 ? 'text-(--color-expense)' : cur ? 'text-heading' : 'text-(--color-text-faint)')}>{cur ? sum(cur) : ''}</span>
                )}
              </td>
              <td className={cn(CELL, 'whitespace-nowrap font-semibold', good === null ? 'text-(--color-text-faint)' : good ? 'text-(--color-income)' : 'text-(--color-expense)')}>
                {diff > 0 ? '+' : ''}
                {sum(diff)}
                <PctInline value={changeOf(cur, prev)} growthGood={growthGood} />
              </td>
              <td className={CELL}>{total ? <PctBadge value={(cur / total) * 100} plain /> : ''}</td>
            </>
          )}
          {byMonth &&
            months.map((m, i) => {
              const v = n(nd.values[i] ?? '0');
              return (
                <td key={m} className={cn(CELL, 'whitespace-nowrap')}>
                  {v && nd.f ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        drill(nd, p, m, v);
                      }}
                      className="text-heading hover:text-brand-700 hover:underline"
                    >
                      {sum(v)}
                    </button>
                  ) : (
                    <span className={cn(v < 0 ? 'text-(--color-expense)' : v ? 'text-heading' : 'text-(--color-text-faint)')}>{v ? sum(v) : '·'}</span>
                  )}
                </td>
              );
            })}
        </tr>,
      );
      if (!isOpen) continue;
      if (kids.length) walk(kids, depth + 1, id, p);
      else
        for (const { m, v } of monthKids)
          rows.push(
            <tr key={`${id}@${m}`} className="bg-brand-50/40 text-xs">
              <td className={cn(CELL, 'text-left text-(--color-text-muted)')} style={{ paddingLeft: `${0.5 + (depth + 1) * 1.25 + 1}rem` }}>
                {monthLabel(m)}
              </td>
              {!byMonth && <td className={CELL} />}
              <td className={CELL}>
                {nd.f ? (
                  <button type="button" onClick={() => drill(nd, p, m, v)} className="text-heading hover:text-brand-700 hover:underline">
                    {sum(v)}
                  </button>
                ) : (
                  <span className="text-heading">{sum(v)}</span>
                )}
              </td>
              {!byMonth && (
                <>
                  <td className={CELL} />
                  <td className={CELL} />
                </>
              )}
              {byMonth && months.slice(1).map((x) => <td key={x} className={CELL} />)}
            </tr>,
          );
    }
  };
  walk(shown, 0, '', []);
  const allIds = (list: DrillNode[], parentId: string): string[] => list.flatMap((nd) => [`${parentId}/${nd.key}`, ...allIds(nd.children ?? [], `${parentId}/${nd.key}`)]);

  return (
    <ReportCard
      title={title}
      badge={badge}
      actions={
        <>
          <SearchInput value={query} onChange={setQuery} placeholder="Qidirish…" />
          <ExcelButton onClick={exportCsv} />
          <button type="button" onClick={() => setOpened(opened.size ? new Set() : new Set(allIds(nodes, '')))} className="rounded-lg border border-brand-300 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50">
            {opened.size ? 'Hammasini yopish' : 'Hammasini ochish'}
          </button>
          {many && (
            <PillTabs
              value={byMonth ? 'months' : 'compare'}
              onChange={(v) => setByMonth(v === 'months')}
              options={[
                { value: 'compare', label: 'Solishtirma' },
                { value: 'months', label: 'Oylar kesimida' },
              ]}
            />
          )}
        </>
      }
    >
      {nodes.length ? (
        <div className="overflow-x-auto px-4 pb-2">
          <table className="w-full border-separate border-spacing-0 overflow-hidden rounded-xl border border-(--color-line) text-sm" style={{ minWidth: byMonth ? 320 + months.length * 110 : 900 }}>
            <thead>
              <tr>
                <th className={cn(HEAD, 'min-w-72 text-left')}>Nomi</th>
                {!byMonth && (
                  <>
                    <th className={HEAD}>{cap(compareLabel)}</th>
                    <th className={HEAD}>Joriy davr</th>
                    <th className={HEAD}>Farqi, foizda</th>
                    <th className={HEAD}>Ulushi</th>
                  </>
                )}
                {byMonth &&
                  months.map((m) => (
                    <th key={m} className={cn(HEAD, 'whitespace-nowrap')}>
                      {monthLabel(m)}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {!byMonth && (
                <tr className="bg-[#eaf0fd] font-bold text-heading">
                  <td className={cn(CELL, 'text-left')}>Jami</td>
                  <td className={cn(CELL, 'whitespace-nowrap')}>{sum(prevTotal)}</td>
                  <td className={cn(CELL, 'whitespace-nowrap')}>{sum(total)}</td>
                  <td className={cn(CELL, 'whitespace-nowrap')}>
                    {total - prevTotal > 0 ? '+' : ''}
                    {sum(total - prevTotal)}
                    <PctInline value={changeOf(total, prevTotal)} growthGood={growthGood} />
                  </td>
                  <td className={CELL}>
                    <PctBadge value={100} plain />
                  </td>
                </tr>
              )}
              {rows}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyNote>Bu davrda yo&apos;q</EmptyNote>
      )}
      <TableNote>
        {hint}. Qatorni bosing — ichiga; summani bosing — yozuvlar ochiladi.{footer ? <> {footer}</> : null}
      </TableNote>
    </ReportCard>
  );
}
