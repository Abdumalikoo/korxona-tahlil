'use client';

import { ExcelButton, GroupTh, MoneyCell, NameCell, PillTabs, ReportCard, RTable, STICKY_NAME, STICKY_NO, TableNote, Td, Th, Tr, sum } from '@/components/report/report';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { formatPeriod, formatPeriodShort } from '@/lib/format';
import { errorMessage } from '@/lib/error-message';
import { cn } from '@/lib/utils';
import { Fragment, useMemo, useState } from 'react';
import { KIND_LABEL, KIND_OPTIONS, normMatch, purposeHead, purposePattern, type PayoutKind, type PayoutRow, type PlaceRow, type SafarConfirmItem } from './api';
import { UnitsBreakdown } from './units-breakdown';
import { useAsync } from '@/lib/use-async';

// ═══════════════════════════════════════════════════════════
// 23106 tahlili: tanlangan davrda (yoki yuklangan faylda) pul NIMA UCHUN chiqqan —
// xizmat safari, mukofot, bayram puli, ish haqi … har tur bo'yicha oyma-oy summa, ulush, to'lovlar va xodimlar soni.
// Tur qatori bosilsa — tagida ochiladi: «Xodimlar» (kimga qancha) yoki «Bank izohlari» (asl izoh matnlari, bir xil
// mazmundagilari guruhlangan). Izoh guruhini boshqa guruhga o'tkazish mumkin: faqat shu to'lovlar (qo'lda) yoki
// qoida — «izohida shu matn bo'lsa — doim shu guruh» (keyingi yuklashlarda ham).
// «Ro'yxatda ko'rsatish» — pastdagi jadval shu turga filtrlanadi.
// ═══════════════════════════════════════════════════════════

/** Guruhga o'tkazish (admin): natija matni qaytadi (xabar uchun) */
export interface KindMover {
  move: (keys: string[], kind: PayoutKind) => Promise<void>;
  rule: (text: string, kind: PayoutKind) => Promise<void>;
}

type PanelMode = 'units' | 'people' | 'comments';

interface CommentGroup {
  id: string;
  /** Asl izohlar (har xil yozilishi, 3 tagacha) */
  examples: string[];
  variants: number;
  head: string;
  count: number;
  total: number;
  keys: string[];
  sources: Set<string>;
  /** Dastur ikkilangan (tekshirish kerak) to'lovlar soni */
  low: number;
  hits: string[];
}

const keyOf = (r: PayoutRow) => r.key ?? `${r.docDate}|${r.docNo}|${r.debitTiyin}|${r.inn}`;

/**
 * Qoida matni uchun taklif: izohning ismsiz qismidan boshidagi sana, «даги …-son буйрукка асосан» kabi
 * har to'lovda o'zgaradigan qismlar va oxiridagi «от 'TASHKILOT'» olib tashlanadi. Qoida — izohning ichidagi
 * yaxlit bo'lak bo'lishi kerak, shuning uchun faqat boshi va oxiri qisqartiriladi.
 */
const LEAD = /^(?:\S*\d\S*|даги|dagi|йилдаги|yildagi|йил|yil|й\.|y\.|-?son\S*|-?сон\S*|буйру\S*|buyru\S*|асосан|asosan|га|ga|[.,:;№#\-–])\s+/i;
function suggestText(head: string): string {
  let t = head.split(/\s(?:от|ot)\s/i)[0] ?? head;
  t = t.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 12 && LEAD.test(`${t} `); i++) t = `${t} `.replace(LEAD, '').trim();
  return t.slice(0, 120);
}

type MonthBy = 'paid' | 'accrual';

const TOP_PEOPLE = 15;
const MAX_MONTH_COLS = 12;

interface KindRow {
  kind: PayoutKind;
  label: string;
  total: number;
  count: number;
  people: number;
  months: Map<string, number>;
  /** Xodimlar: kalit (PINFL yoki ism) → yig'indi */
  byPerson: { key: string; name: string; pinfl: string | null; total: number; count: number; months: Map<string, number> }[];
}

const personKey = (r: PayoutRow) => r.pinfl ?? (r.fullName ?? r.commentName ?? r.accountName).trim().toUpperCase();
const personName = (r: PayoutRow) => r.fullName ?? r.commentName ?? r.accountName;
/** Tiyin → so'm (son) — summalar katta, BigInt'dan Number'ga xavfsiz (≤ 9e15) */
const tiyin = (s: string) => Number(s);

export function KindAnalysis({
  rows,
  title,
  onShow,
  mover,
  placesLoader,
  placesKey,
  safarPost,
}: {
  rows: PayoutRow[];
  title: string;
  onShow?: (kind: PayoutKind) => void;
  mover?: KindMover;
  /** Saqlangan to'lovlar joyi (bo'lim / hudud) — berilsa «Bo'limlar bo'yicha» ko'rinishi ishlaydi */
  placesLoader?: () => Promise<PlaceRow[]>;
  /** O'zgarsa — joylar qayta yuklanadi (davr, xarajatga o'tkazish) */
  placesKey?: string;
  /** Faqat xizmat safari: kutayotganlarni xarajatga o'tkazish */
  safarPost?: (items: SafarConfirmItem[], categoryCode: string) => Promise<void>;
}) {
  const [by, setBy] = useState<MonthBy>('paid');
  const [open, setOpen] = useState<Set<PayoutKind>>(() => new Set());
  const [modes, setModes] = useState<Map<PayoutKind, PanelMode>>(() => new Map());
  const [editing, setEditing] = useState<string | null>(null);
  const modeOf = (k: PayoutKind): PanelMode => modes.get(k) ?? (k === 'BOSHQA' ? 'comments' : 'people');
  const setMode = (k: PayoutKind, m: PanelMode) => setModes((prev) => new Map(prev).set(k, m));
  /** Ikki marta bosish — tur ochiladi va pul qaysi bo'lim / hududga ketgani ko'rsatiladi */
  const openUnits = (k: PayoutKind) => {
    setOpen((prev) => new Set(prev).add(k));
    setMode(k, placesLoader ? 'units' : modeOf(k));
  };
  const unitsOn = Boolean(placesLoader) && [...open].some((k) => modes.get(k) === 'units');
  const placesQ = useAsync(() => (unitsOn && placesLoader ? placesLoader() : Promise.resolve(null)), [unitsOn, placesKey ?? '']);
  const placeMap = useMemo(() => new Map((placesQ.data ?? []).map((p) => [p.key, p])), [placesQ.data]);
  const monthOfRow = useMemo(() => (by === 'paid' ? (r: PayoutRow) => r.docDate.slice(0, 7) : (r: PayoutRow) => r.accrual), [by]);

  /** Har tur ichida — bank izohlari guruhlari (ism va raqamlarsiz bir xil mazmun) */
  const comments = useMemo(() => {
    const out = new Map<PayoutKind, CommentGroup[]>();
    const acc = new Map<PayoutKind, Map<string, CommentGroup & { seen: Set<string> }>>();
    for (const r of rows) {
      const pat = purposePattern(r.purpose) || '—';
      const kindMap = acc.get(r.kind) ?? new Map<string, CommentGroup & { seen: Set<string> }>();
      acc.set(r.kind, kindMap);
      let g = kindMap.get(pat);
      if (!g) {
        g = { id: `${r.kind}:${pat}`, examples: [], variants: 0, head: purposeHead(r.purpose), count: 0, total: 0, keys: [], sources: new Set(), seen: new Set(), low: 0, hits: r.hits ?? [] };
        kindMap.set(pat, g);
      }
      g.count += 1;
      g.total += tiyin(r.debitTiyin);
      g.keys.push(keyOf(r));
      g.sources.add(r.kindSource ?? 'AUTO');
      if (r.kindSource === 'AUTO' && r.confidence === 'LOW') g.low += 1;
      const text = (r.purpose ?? '').replace(/\s+/g, ' ').trim();
      if (!g.seen.has(text)) {
        g.seen.add(text);
        g.variants += 1;
        if (g.examples.length < 3) g.examples.push(text);
      }
    }
    for (const [k, m] of acc) out.set(k, [...m.values()].sort((a, b) => b.total - a.total));
    return out;
  }, [rows]);

  const { kinds, months, total, people, count } = useMemo(() => {
    const monthOf = (r: PayoutRow) => (by === 'paid' ? r.docDate.slice(0, 7) : r.accrual);
    const map = new Map<PayoutKind, { label: string; total: number; count: number; months: Map<string, number>; persons: Map<string, { name: string; pinfl: string | null; total: number; count: number; months: Map<string, number> }> }>();
    const allPeople = new Set<string>();
    const allMonths = new Set<string>();
    let sumAll = 0;
    for (const r of rows) {
      const amount = tiyin(r.debitTiyin);
      const m = monthOf(r);
      allMonths.add(m);
      sumAll += amount;
      const pk = personKey(r);
      allPeople.add(pk);
      let k = map.get(r.kind);
      if (!k) {
        k = { label: r.kindLabel, total: 0, count: 0, months: new Map(), persons: new Map() };
        map.set(r.kind, k);
      }
      k.total += amount;
      k.count += 1;
      k.months.set(m, (k.months.get(m) ?? 0) + amount);
      const p = k.persons.get(pk) ?? { name: personName(r), pinfl: r.pinfl, total: 0, count: 0, months: new Map<string, number>() };
      p.total += amount;
      p.months.set(m, (p.months.get(m) ?? 0) + amount);
      p.count += 1;
      k.persons.set(pk, p);
    }
    const list: KindRow[] = [...map.entries()]
      .map(([kind, k]) => ({
        kind,
        label: k.label,
        total: k.total,
        count: k.count,
        people: k.persons.size,
        months: k.months,
        byPerson: [...k.persons.entries()].map(([key, p]) => ({ key, ...p })).sort((a, b) => b.total - a.total),
      }))
      .sort((a, b) => b.total - a.total);
    return { kinds: list, months: [...allMonths].sort(), total: sumAll, people: allPeople.size, count: rows.length };
  }, [rows, by]);

  const showMonths = months.length > 1 && months.length <= MAX_MONTH_COLS;
  const monthTotals = useMemo(() => months.map((m) => kinds.reduce((s, k) => s + (k.months.get(m) ?? 0), 0)), [months, kinds]);
  const cols = 2 + (showMonths ? months.length : 0) + 4;

  const toggle = (k: PayoutKind) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const exportCsv = () =>
    downloadCsv(
      `23106-tahlil-${months[0] ?? ''}_${months[months.length - 1] ?? ''}`,
      ['Nima uchun', ...months.map((m) => `${formatPeriod(m)}, so'm`), "Jami, so'm", 'Ulushi, %', "To'lovlar soni", 'Xodimlar soni'],
      [
        ...kinds.map((k) => [k.label, ...months.map((m) => csvSom(k.months.get(m) ?? 0)), csvSom(k.total), total ? ((k.total / total) * 100).toFixed(1).replace('.', ',') : '', String(k.count), String(k.people)]),
        ['Jami', ...monthTotals.map((v) => csvSom(v)), csvSom(total), '100', String(count), String(people)],
        [],
        [by === 'paid' ? "Oylar — to'langan sana bo'yicha" : "Oylar — hisoblangan oy bo'yicha (izoh / buyruqdan)"],
      ],
    );

  if (!rows.length) return null;
  const top = kinds[0];

  return (
    <ReportCard
      title={title}
      badge={`${count} ta to'lov · ${people} xodim · ${sum(total)} so'm${top ? ` · eng kattasi: ${top.label} (${total ? ((top.total / total) * 100).toFixed(1).replace('.', ',') : 0}%)` : ''}`}
      actions={<ExcelButton onClick={exportCsv} />}
    >
      {/* Turlar — qisqa ko'rinish: har tur ulushi chizig'i */}
      <div className="grid gap-2 border-b border-(--color-line) px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
        {kinds.map((k) => {
          const share = total ? (k.total / total) * 100 : 0;
          return (
            <button
              key={k.kind}
              type="button"
              onClick={() => toggle(k.kind)}
              className={cn('rounded-lg border bg-white px-3 py-2 text-left transition-colors hover:border-brand-400', open.has(k.kind) ? 'border-brand-500 bg-brand-50/40' : 'border-(--color-line)')}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[13px] font-medium text-heading">{k.label}</span>
                <span className="text-[11px] font-semibold text-(--color-text-muted)">{share.toFixed(1).replace('.', ',')}%</span>
              </span>
              <span className="mt-0.5 block text-base font-bold tabular-nums text-heading">
                {sum(k.total)} <span className="text-xs font-semibold">so&apos;m</span>
              </span>
              <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-(--color-surface-muted)">
                <span className="block h-full rounded-full bg-brand-500" style={{ width: `${Math.max(share, 0.5)}%` }} />
              </span>
              <span className="mt-1 block text-[11px] text-(--color-text-muted)">
                {k.count} ta to&apos;lov · {k.people} xodim
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 px-4 pt-3">
        <PillTabs
          value={by}
          onChange={setBy}
          options={[
            { value: 'paid', label: "To'langan oy", hint: "Bank ko'chirmasidagi to'lov sanasi bo'yicha" },
            { value: 'accrual', label: 'Hisoblangan oy', hint: "Izoh yoki buyruqdan aniqlangan oy (qaysi oy uchun to'langan)" },
          ]}
        />
        {!showMonths && months.length > MAX_MONTH_COLS && <span className="text-xs text-(--color-text-muted)">{months.length} oy — oylar ustuni ko&apos;rsatilmadi (12 oydan ko&apos;p)</span>}
      </div>

      <div className="p-4">
        <RTable minWidth={showMonths ? 620 + months.length * 120 : 760}>
          <thead>
            <tr>
              <Th rowSpan={showMonths ? 2 : 1} className={cn(STICKY_NO, 'z-[2]')}>
                №
              </Th>
              <Th rowSpan={showMonths ? 2 : 1} className={cn(STICKY_NAME, 'z-[2] min-w-48 text-left')}>
                Nima uchun
              </Th>
              <Th rowSpan={showMonths ? 2 : 1}>Jami</Th>
              <Th rowSpan={showMonths ? 2 : 1}>Ulushi</Th>
              <Th rowSpan={showMonths ? 2 : 1}>To&apos;lovlar</Th>
              <Th rowSpan={showMonths ? 2 : 1}>Xodimlar</Th>
              {showMonths && <GroupTh span={months.length}>{by === 'paid' ? "To'langan oy" : 'Hisoblangan oy'}</GroupTh>}
            </tr>
            {showMonths && (
              <tr>
                {months.map((m) => (
                  <Th key={m} className="first:border-l">
                    {formatPeriodShort(m)}
                  </Th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            <Tr total>
              <Td className={STICKY_NO} />
              <NameCell>Jami</NameCell>
              <MoneyCell value={total} strong />
              <Td>100%</Td>
              <Td>{count}</Td>
              <Td>{people}</Td>
              {showMonths && monthTotals.map((v, i) => <MoneyCell key={months[i]} value={v} />)}
            </Tr>
            {kinds.map((k, i) => {
              const isOpen = open.has(k.kind);
              const share = total ? (k.total / total) * 100 : 0;
              return (
                <Fragment key={k.kind}>
                  <Tr onClick={() => toggle(k.kind)} onDoubleClick={() => openUnits(k.kind)} title={placesLoader ? "Bosing — ochiladi · ikki marta bosing — bo'limlar / hududlar bo'yicha" : undefined} className={cn('select-none', isOpen && 'bg-brand-50')}>
                    <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                    <NameCell
                      before={<span className={cn('inline-block w-3 text-xs text-(--color-text-faint) transition-transform', isOpen && 'rotate-90')}>▸</span>}
                      sub={isOpen ? 'yopish uchun bosing' : placesLoader ? "2 marta bosing — bo'limlar / hududlar bo'yicha" : k.kind === 'BOSHQA' ? 'bosing — bank izohlari' : 'bosing — kimga qancha, izohlar'}
                      className="font-medium text-heading"
                    >
                      {k.label}
                    </NameCell>
                    <MoneyCell value={k.total} strong />
                    <Td className="whitespace-nowrap text-(--color-text-muted)">{share.toFixed(1).replace('.', ',')}%</Td>
                    <Td>{k.count}</Td>
                    <Td>{k.people}</Td>
                    {showMonths && months.map((m) => <MoneyCell key={m} value={k.months.get(m) ?? 0} className={k.months.get(m) ? '' : 'text-(--color-text-faint)'} />)}
                  </Tr>
                  {isOpen && (
                    <>
                      <tr className="bg-[#fffaf0] [&>td]:bg-inherit">
                        <td colSpan={cols} className="border-b border-(--color-line) px-4 py-1.5">
                          <span className="sticky left-4 inline-flex gap-1.5">
                            {(
                              [
                                ...(placesLoader ? ([['units', k.kind === 'SAFAR' ? "Bo'limlar / hududlar · xarajatga" : "Bo'limlar / hududlar bo'yicha"]] as [PanelMode, string][]) : []),
                                ['people', `Xodimlar bo'yicha · ${k.people}`],
                                ['comments', `Bank izohlari · ${comments.get(k.kind)?.length ?? 0} xil`],
                              ] as [PanelMode, string][]
                            ).map(([m, label]) => (
                              <button
                                key={m}
                                type="button"
                                onClick={() => setMode(k.kind, m)}
                                className={cn('rounded-full border px-3 py-0.5 text-xs font-medium', modeOf(k.kind) === m ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-(--color-line) bg-white text-(--color-text-muted) hover:text-heading')}
                              >
                                {label}
                              </button>
                            ))}
                          </span>
                        </td>
                      </tr>
                      {modeOf(k.kind) === 'units' &&
                        (placesQ.error ? (
                          <tr>
                            <td colSpan={cols} className="border-b border-(--color-line) bg-red-50 px-4 py-2 text-xs text-(--color-expense)">
                              {placesQ.error}
                            </td>
                          </tr>
                        ) : !placesQ.data ? (
                          <tr>
                            <td colSpan={cols} className="border-b border-(--color-line) px-4 py-2 text-xs text-(--color-text-muted)">
                              Bo&apos;limlar aniqlanmoqda…
                            </td>
                          </tr>
                        ) : (
                          <UnitsBreakdown
                            kind={k.kind}
                            rows={rows}
                            places={placeMap}
                            months={months}
                            showMonths={showMonths}
                            monthOf={monthOfRow}
                            cols={cols}
                            kindTotal={k.total}
                            safarPost={k.kind === 'SAFAR' ? safarPost : undefined}
                          />
                        ))}
                      {modeOf(k.kind) === 'comments' &&
                        (comments.get(k.kind) ?? []).map((g) => (
                          <tr key={g.id} className="bg-[#fffaf0] [&>td]:bg-inherit">
                            <td colSpan={cols} className="border-b border-(--color-line) p-0">
                              <div className="sticky left-0 max-w-[calc(100vw-8rem)] px-4 py-2.5">
                                <div className="flex flex-wrap items-start gap-x-4 gap-y-1.5">
                                  <div className="min-w-64 flex-1">
                                    <p className="text-[12.5px] leading-snug text-heading">{g.examples[0]}</p>
                                    {g.variants > 1 && (
                                      <details className="mt-0.5 text-[11px] text-(--color-text-muted)">
                                        <summary className="cursor-pointer select-none">
                                          yana {g.variants - 1} xil yozilishi (faqat ism, sana yoki raqam farq qiladi)
                                        </summary>
                                        {g.examples.slice(1).map((e) => (
                                          <p key={e} className="mt-0.5 leading-snug">
                                            {e}
                                          </p>
                                        ))}
                                      </details>
                                    )}
                                  </div>
                                  <div className="whitespace-nowrap text-right">
                                    <span className="block text-[13px] font-semibold tabular-nums text-heading">{sum(g.total)} so&apos;m</span>
                                    <span className="block text-[11px] text-(--color-text-muted)">
                                      {g.count} ta · {k.total ? ((g.total / k.total) * 100).toFixed(1).replace('.', ',') : 0}%
                                      {g.sources.has('MANUAL') ? " · qo'lda" : g.sources.has('RULE') ? ' · qoida bilan' : ''}
                                    </span>
                                    {g.low > 0 && <span className="block text-[11px] font-medium text-amber-700">⚠ tekshirish kerak · {g.low} ta</span>}
                                    {g.hits.length > 0 && k.kind !== 'BOSHQA' && <span className="block max-w-56 truncate text-[10.5px] text-(--color-text-faint)">topilgan: {g.hits.join(', ')}</span>}
                                  </div>
                                  {mover && (
                                    <button
                                      type="button"
                                      onClick={() => setEditing(editing === g.id ? null : g.id)}
                                      className={cn('self-center rounded-md border px-3 py-1 text-xs font-semibold', editing === g.id ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-brand-300 bg-white text-brand-700 hover:bg-brand-50')}
                                    >
                                      Guruhga o&apos;tkazish {editing === g.id ? '▴' : '▾'}
                                    </button>
                                  )}
                                </div>
                                {mover && editing === g.id && <MoveEditor group={g} from={k.kind} rows={rows} mover={mover} onDone={() => setEditing(null)} />}
                              </div>
                            </td>
                          </tr>
                        ))}
                      {modeOf(k.kind) === 'people' && k.byPerson.slice(0, TOP_PEOPLE).map((p, j) => (
                        <tr key={p.key} className="bg-[#fffaf0] [&>td]:bg-inherit">
                          <Td className={cn(STICKY_NO, 'text-[11px] text-(--color-text-faint)')}>{j + 1}</Td>
                          <td className={cn('border-b border-l border-(--color-line) px-1.5 py-1.5 text-left text-[12.5px]', STICKY_NAME)}>
                            <span className="block pl-4 text-heading">{p.name}</span>
                            {p.pinfl && <span className="block pl-4 font-mono text-[10.5px] text-(--color-text-faint)">{p.pinfl}</span>}
                          </td>
                          <MoneyCell value={p.total} />
                          <Td className="whitespace-nowrap text-xs text-(--color-text-muted)">{k.total ? `${((p.total / k.total) * 100).toFixed(1).replace('.', ',')}%` : ''}</Td>
                          <Td className="text-xs">{p.count}</Td>
                          <Td />
                          {showMonths && months.map((m) => <MoneyCell key={m} value={p.months.get(m) ?? 0} className={cn('text-xs', p.months.get(m) ? 'text-(--color-text-muted)' : 'text-(--color-text-faint)')} />)}
                        </tr>
                      ))}
                      {(onShow || (modeOf(k.kind) === 'people' && k.byPerson.length > TOP_PEOPLE)) && (
                      <tr className="bg-[#fffaf0] [&>td]:bg-inherit">
                        <td colSpan={cols} className="border-b border-(--color-line) px-4 py-2 text-xs text-(--color-text-muted)">
                          <span className="sticky left-4 inline-flex flex-wrap items-center gap-3">
                            {modeOf(k.kind) === 'people' && k.byPerson.length > TOP_PEOPLE && (
                              <span>
                                Yana {k.byPerson.length - TOP_PEOPLE} xodim · {sum(k.byPerson.slice(TOP_PEOPLE).reduce((s, p) => s + p.total, 0))} so&apos;m
                              </span>
                            )}
                            {onShow && (
                              <button type="button" onClick={() => onShow(k.kind)} className="rounded-md border border-brand-300 bg-white px-3 py-1 font-semibold text-brand-700 hover:bg-brand-50">
                                Ro&apos;yxatda ko&apos;rsatish ›
                              </button>
                            )}
                          </span>
                        </td>
                      </tr>
                      )}
                    </>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </RTable>
        <TableNote>
          Tur qatorini bosing — tagida xodimlar va bankdagi asl izohlar ochiladi (izohni boshqa guruhga o&apos;tkazish mumkin); ikki marta bosing — pul qaysi bo&apos;lim / hududga ketgani (bo&apos;lim › xodim, oyma-oy). Xizmat safarini shu yerdan bo&apos;lim bo&apos;yicha xarajatga o&apos;tkazish mumkin — har to&apos;lov o&apos;z oyiga yoziladi. «To&apos;langan oy» — bank to&apos;lov sanasi, «Hisoblangan oy» — izohdagi
          oy yoki buyruq sanasi. Tur (xizmat safari, mukofot …) to&apos;lov izohidan aniqlanadi.
        </TableNote>
      </div>
    </ReportCard>
  );
}

/** Izoh guruhini boshqa guruhga o'tkazish: faqat shu to'lovlar (qo'lda) yoki qoida (doim, keyingi yuklashlarda ham) */
function MoveEditor({ group, from, rows, mover, onDone }: { group: CommentGroup; from: PayoutKind; rows: PayoutRow[]; mover: KindMover; onDone: () => void }) {
  const [kind, setKind] = useState<PayoutKind>(from === 'BOSHQA' ? 'MUKOFOT' : 'BOSHQA');
  const [how, setHow] = useState<'rule' | 'only'>('rule');
  const [text, setText] = useState(() => suggestText(group.head));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const norm = normMatch(text);
  /** Qoida qaysi to'lovlarga tushadi (shu ro'yxatda) */
  const hit = useMemo(() => {
    if (norm.length < 3) return null;
    let count = 0;
    let total = 0;
    const kinds = new Map<PayoutKind, number>();
    for (const r of rows) {
      if (!normMatch(r.purpose).includes(norm)) continue;
      count += 1;
      total += tiyin(r.debitTiyin);
      kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1);
    }
    return { count, total, kinds: [...kinds.entries()].sort((a, b) => b[1] - a[1]) };
  }, [rows, norm]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (how === 'only') await mover.move(group.keys, kind);
      else await mover.rule(text, kind);
      onDone();
    } catch (err) {
      setError(errorMessage(err, "Saqlab bo'lmadi"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-brand-200 bg-white p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-heading">Qaysi guruhga:</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as PayoutKind)} className="h-8 rounded-md border border-(--color-line-strong) bg-white px-2 text-sm">
          {KIND_OPTIONS.filter((o) => o.kind !== from).map((o) => (
            <option key={o.kind} value={o.kind}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <label className="flex cursor-pointer items-start gap-2">
        <input type="radio" className="mt-0.5 accent-brand-600" checked={how === 'rule'} onChange={() => setHow('rule')} />
        <span className="min-w-0 flex-1">
          <span className="font-medium text-heading">Qoida — izohida shu matn bo&apos;lsa, doim «{KIND_LABEL[kind]}»</span>
          <span className="block text-(--color-text-muted)">saqlangan to&apos;lovlarga ham, keyingi yuklashlarga ham qo&apos;llanadi. Matnni qisqartirib, asosiy so&apos;zlarni qoldiring.</span>
          {how === 'rule' && (
            <>
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="mt-1.5 h-8 w-full max-w-xl rounded-md border border-(--color-line-strong) px-2 text-sm focus:border-brand-600 focus:outline-none"
                placeholder="masalan: ozuqa puli"
              />
              <span className={cn('mt-1 block', hit && hit.count ? 'text-(--color-text-muted)' : 'text-(--color-expense)')}>
                {!hit
                  ? 'Kamida 3 harf yozing (raqamlar hisobga olinmaydi)'
                  : hit.count
                    ? `Shu ro'yxatda ${hit.count} ta to'lovga tushadi · ${sum(hit.total)} so'm (hozir: ${hit.kinds.map(([k, n]) => `${KIND_LABEL[k]} ${n}`).join(', ')})`
                    : "Shu ro'yxatda bu matnli izoh yo'q — matnni tekshiring"}
              </span>
            </>
          )}
        </span>
      </label>
      <label className="flex cursor-pointer items-start gap-2">
        <input type="radio" className="mt-0.5 accent-brand-600" checked={how === 'only'} onChange={() => setHow('only')} />
        <span>
          <span className="font-medium text-heading">Faqat shu {group.count} ta to&apos;lov</span>
          <span className="block text-(--color-text-muted)">qo&apos;lda belgilanadi (fayl qayta yuklansa ham eslab qolinadi), boshqa izohlarga ta&apos;sir qilmaydi</span>
        </span>
      </label>
      {error && <p className="text-(--color-expense)">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="rounded-md px-3 py-1.5 font-medium text-(--color-text-muted) hover:text-heading" disabled={busy}>
          Bekor
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || (how === 'rule' && (!hit || !hit.count))}
          className="rounded-md bg-brand-600 px-4 py-1.5 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? 'Saqlanmoqda…' : `«${KIND_LABEL[kind]}»ga o'tkazish`}
        </button>
      </div>
    </div>
  );
}
