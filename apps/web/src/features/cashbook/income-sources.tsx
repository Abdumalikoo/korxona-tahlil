'use client';

import { ExcelButton, MoneyCell, NameCell, PillTabs, ReportCard, RTable, SearchInput, StatTiles, STICKY_NAME, STICKY_NO, TableNote, Td, Th, ToggleAllButton, Tr } from '@/components/report/report';
import { EmptyNote, LoadingCard } from '@/components/report/report-extra-c';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { formatDate, formatPeriod, formatPeriodShort } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { centerIncomeApi, MODE_LABEL, OWNER_LABEL, type CenterRow, type CenterYear } from './center-api';

// ═══════════════════════════════════════════════════════════
// Bosh sahifa › Daromad manbalari — «Kunlik tushum va qoldiq» hisobotidagi har bir tushum qatori (manba) oyma-oy.
//  • Oy summasi — o'sha oyning oxirgi ma'lumotnomasidagi «Oy boshidan» − o'tgan oy oxiridagi (Markaz daromadi bilan bir hisob;
//    sahifa uni faqat ko'rsatadi, raqamlarni o'zgartirmaydi).
//  • Daraxt: hisobotdagi tartib va daraja. Guruh summasi = o'zi (tushum qatori bo'lsa) + ichidagi qatorlar; tushum qatori
//    ichida boshqa qatorlar bo'lsa — uning o'z summasi «qatorning o'zi» bo'lib alohida ko'rsatiladi.
//  • Yorliqlar — qator turi: «Daromad» (Markaz + Boshqa; Qo'mita qatorlarisiz) yig'indisi har oy Markaz daromadiga teng.
//  • Davr — yuqoridagi «Davr» paneli (yil — davr oxiridan, ustunlar — davr oylari).
// ═══════════════════════════════════════════════════════════

type Filter = 'INCOME' | 'DOIMIY' | 'BOSHQA' | 'QOMITA' | 'REGION' | 'NONE' | 'ALL';
const FILTERS: { value: Filter; label: string; hint: string; test: (r: CenterRow) => boolean }[] = [
  { value: 'INCOME', label: 'Daromad', hint: "Markaz daromadi + boshqa daromad — Daromadlarga Markaz daromadi bo'lib yoziladigan qatorlar", test: (r) => (r.mode === 'DOIMIY' || r.mode === 'BOSHQA') && !r.qomitaCode },
  { value: 'DOIMIY', label: MODE_LABEL.DOIMIY, hint: 'Doimiy Markaz daromadi', test: (r) => r.mode === 'DOIMIY' && !r.qomitaCode },
  { value: 'BOSHQA', label: MODE_LABEL.BOSHQA, hint: 'Bir martalik va boshqa daromad', test: (r) => r.mode === 'BOSHQA' && !r.qomitaCode },
  { value: 'QOMITA', label: "Qo'mita (kassa)", hint: "Qo'mita mablag'lari bilan bitta pul — Markaz daromadiga kirmaydi", test: (r) => Boolean(r.qomitaCode) },
  { value: 'REGION', label: MODE_LABEL.REGION, hint: 'Hududiy bo‘limlar — faqat hisobot uchun, tahlilga kirmaydi', test: (r) => r.mode === 'REGION' && !r.qomitaCode },
  { value: 'NONE', label: MODE_LABEL.NONE, hint: "Qaytarilgan, noto'g'ri tushgan, fuqarolarga to'lanadigan pul", test: (r) => r.mode === 'NONE' && !r.qomitaCode },
  { value: 'ALL', label: 'Hammasi', hint: "Hisobotdagi hamma tushum qatorlari (daromad emaslari bilan)", test: (r) => r.mode !== null },
];
const n = (s: string | null | undefined) => (s ? Number(s) : 0);

/** Qator ostidagilar: keyingi, darajasi kattaroq qatorlardan eng yaqin darajadagilari */
function childrenOf(rows: CenterRow[]): Map<string, CenterRow[]> {
  const out = new Map<string, CenterRow[]>();
  rows.forEach((r, i) => {
    const run: CenterRow[] = [];
    for (let j = i + 1; j < rows.length && rows[j]!.level > r.level; j++) run.push(rows[j]!);
    const min = Math.min(...run.map((x) => x.level));
    out.set(r.id, run.filter((x) => x.level === min));
  });
  return out;
}

export function IncomeSources({ range }: { range: { from: string; to: string } }) {
  const year = Number(range.to.slice(0, 4));
  const res = useAsync(() => centerIncomeApi.year(year), [year]);
  if (!res.data) return <LoadingCard label="Kunlik hisobot ma'lumotlari yuklanmoqda" error={res.error} onRetry={res.reload} />;
  return <Body d={res.data} range={range} loading={res.loading} />;
}

function Body({ d, range, loading }: { d: CenterYear; range: { from: string; to: string }; loading: boolean }) {
  const [filter, setFilter] = useState<Filter>('INCOME');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  // Ustunlar — davr oylari (shu yil ichida); yil oxiridagi hisobotsiz oylar ko'rsatilmaydi
  const inRange = d.months.filter((m) => m.period >= range.from.slice(0, 7) && m.period <= range.to.slice(0, 7));
  const last = d.months.reduce((x, m, i) => (m.reports ? i : x), -1);
  const months = (inRange.length ? inRange : d.months).filter((m) => d.months.indexOf(m) <= last || m.reports > 0);
  const periods = months.map((m) => m.period);

  const kids = childrenOf(d.rows);
  const child = new Set([...kids.values()].flat().map((r) => r.id));
  const test = FILTERS.find((f) => f.value === filter)!.test;
  const q = query.trim().toLowerCase();
  /** Manba shu yorliq va qidiruvga mosmi (qidiruv — o'zi yoki ota guruhi nomi bo'yicha) */
  const self = (r: CenterRow, hit: boolean) => r.mode !== null && test(r) && (hit || !q || `${r.code ?? ''} ${r.name}`.toLowerCase().includes(q));
  const hitOf = (r: CenterRow, hit: boolean) => hit || (q !== '' && `${r.code ?? ''} ${r.name}`.toLowerCase().includes(q));
  /** Guruh summasi: o'zi (mos bo'lsa) + ichidagilar */
  const value = (r: CenterRow, p: string, hit = false): number => (self(r, hit) ? n(r.months[p]) : 0) + (kids.get(r.id) ?? []).reduce((s, k) => s + value(k, p, hitOf(r, hit)), 0);
  const visible = (r: CenterRow, hit = false): boolean => self(r, hit) || (kids.get(r.id) ?? []).some((k) => visible(k, hitOf(r, hit)));
  const total = (r: CenterRow, hit = false) => periods.reduce((s, p) => s + value(r, p, hit), 0);
  const tops = d.rows.filter((r) => !child.has(r.id) && visible(r));
  const colTotal = (p: string) => tops.reduce((s, r) => s + value(r, p), 0);
  const groups = d.rows.filter((r) => (kids.get(r.id)?.length ?? 0) > 0);
  const counts = (f: Filter) => d.rows.filter((r) => r.mode !== null && FILTERS.find((x) => x.value === f)!.test(r)).length;
  const sumOf = (k: 'markazTiyin' | 'segmentsTiyin' | 'qomitaKassaTiyin' | 'regionsTiyin') => months.reduce((s, m) => s + n(m[k]), 0);

  const toggle = (id: string) =>
    setOpen((x) => {
      const nx = new Set(x);
      if (nx.has(id)) nx.delete(id);
      else nx.add(id);
      return nx;
    });

  const cells = (get: (p: string) => number, strong: boolean, muted = false) => (
    <>
      {periods.map((p) => {
        const v = get(p);
        return <MoneyCell key={p} value={v} strong={strong} className={cn((!v || muted) && 'text-(--color-text-muted)', !v && 'text-(--color-text-faint)', v < 0 && 'text-(--color-expense)')} />;
      })}
      <MoneyCell value={periods.reduce((s, p) => s + get(p), 0)} strong />
    </>
  );
  const chevron = (isOpen: boolean, can: boolean, depth: number) => (
    <span className="flex shrink-0 items-center" style={{ paddingLeft: depth * 18 }}>
      <span className={cn('inline-block w-3.5 text-center text-(--color-text-faint)', !can && 'invisible')}>{isOpen ? '▾' : '▸'}</span>
    </span>
  );
  const subOf = (r: CenterRow, ks: CenterRow[]) =>
    [r.mode ? MODE_LABEL[r.mode] : null, r.owner && r.owner !== 'CENTER' ? OWNER_LABEL[r.owner] : null, r.qomitaCode ? "Qo'mita mablag'lari bilan bitta pul" : null, ks.length ? `${ks.length} ta qator` : null].filter(Boolean).join(' · ') || undefined;

  const lines: ReactNode[] = [];
  const draw = (r: CenterRow, depth: number, hit: boolean) => {
    const h = hitOf(r, hit);
    const ks = (kids.get(r.id) ?? []).filter((k) => visible(k, h));
    const own = ks.length > 0 && self(r, hit);
    const can = ks.length > 0;
    const isOpen = can && (open.has(r.id) || (q !== '' && !hitOf(r, false)));
    lines.push(
      <Tr key={r.id} onClick={can ? () => toggle(r.id) : undefined} className={cn(depth === 0 && can && 'bg-brand-50/50', depth >= 2 && 'bg-(--color-surface-muted)/40')}>
        <Td className={cn(STICKY_NO, 'text-xs text-(--color-text-faint)')}>{r.code ?? ''}</Td>
        <NameCell className={cn(depth === 0 && can && 'font-semibold text-heading')} sub={subOf(r, ks)} before={chevron(isOpen, can, depth)}>
          {r.name}
        </NameCell>
        {cells((p) => value(r, p, hit), depth === 0 && can)}
      </Tr>,
    );
    if (!isOpen) return;
    // Tushum qatori bo'lib, ichida ham qatorlar bor — uning o'z summasi alohida
    if (own)
      lines.push(
        <Tr key={`${r.id}:own`} className="bg-(--color-surface-muted)/40">
          <Td className={STICKY_NO} />
          <NameCell className="font-normal text-(--color-text-muted)" before={chevron(false, false, depth + 1)}>
            «{r.name}» qatorining o&apos;zi
          </NameCell>
          {cells((p) => n(r.months[p]), false, true)}
        </Tr>,
      );
    for (const k of ks) draw(k, depth + 1, h);
  };
  for (const r of tops) draw(r, 0, false);

  const exportCsv = () => {
    const out: (string | number)[][] = [];
    const walk = (r: CenterRow, depth: number, hit: boolean) => {
      const h = hitOf(r, hit);
      if (!visible(r, hit)) return;
      const ks = (kids.get(r.id) ?? []).filter((k) => visible(k, h));
      out.push([r.code ?? '', `${'  '.repeat(depth)}${r.name}`, r.mode ? MODE_LABEL[r.mode] : 'Guruh', r.owner ? OWNER_LABEL[r.owner] : '', ...periods.map((p) => csvSom(value(r, p, hit))), csvSom(total(r, hit))]);
      if (ks.length && self(r, hit)) out.push(['', `${'  '.repeat(depth + 1)}«${r.name}» qatorining o'zi`, MODE_LABEL[r.mode!], '', ...periods.map((p) => csvSom(n(r.months[p]))), csvSom(periods.reduce((s, p) => s + n(r.months[p]), 0))]);
      for (const k of ks) walk(k, depth + 1, h);
    };
    for (const r of tops) walk(r, 0, false);
    downloadCsv(
      `daromad-manbalari-${filter.toLowerCase()}-${periods[0] ?? d.year}_${periods[periods.length - 1] ?? ''}`,
      ['Kod', 'Manba', 'Turi', 'Kimniki', ...periods.map(formatPeriod), "Jami, so'm"],
      [...out, ['', `Jami · ${FILTERS.find((f) => f.value === filter)!.label}`, '', '', ...periods.map((p) => csvSom(colTotal(p))), csvSom(periods.reduce((s, p) => s + colTotal(p), 0))]],
    );
  };

  return (
    <div className={cn('space-y-4', loading && 'opacity-70')}>
      <StatTiles
        items={[
          { label: 'Daromad (Markaz + boshqa)', value: sumOf('markazTiyin'), tone: 'green', note: `${counts('INCOME')} ta manba · davr oylari` },
          { label: "Shundan yo'nalishlarga", value: sumOf('segmentsTiyin'), tone: 'purple', note: 'Tax free, Marksheyder … (qator egasi bo‘yicha)' },
          { label: "Qo'mita (kassa)", value: sumOf('qomitaKassaTiyin'), tone: 'cyan', note: "Qo'mita mablag'lari bilan bitta pul" },
          { label: 'Hududlar (hisobot uchun)', value: sumOf('regionsTiyin'), tone: 'orange', note: 'tahlilga kirmaydi' },
          { label: 'Oxirgi kunlik hisobot', value: 0, text: d.latestDate ? formatDate(d.latestDate) : '—', tone: 'blue', note: `davrda ${months.reduce((s, m) => s + m.reports, 0)} ta hisobot` },
        ]}
      />

      <PillTabs value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f.value, label: f.label, hint: f.hint, count: f.value === 'ALL' ? undefined : counts(f.value) }))} />

      <ReportCard
        title="Daromad manbalari oyma-oy (kunlik hisobot)"
        badge={months.length ? `${formatPeriod(months[0]!.period)} — ${formatPeriod(months[months.length - 1]!.period)}` : String(d.year)}
        actions={
          <>
            <SearchInput value={query} onChange={setQuery} placeholder="Manba nomi yoki kodi…" />
            <ExcelButton onClick={exportCsv} />
            <ToggleAllButton open={open.size > 0} onClick={() => setOpen(open.size ? new Set() : new Set(groups.map((r) => r.id)))} />
          </>
        }
      >
        {tops.length && periods.length ? (
          <RTable minWidth={420 + periods.length * 120}>
            <thead>
              <tr>
                <Th className={cn(STICKY_NO, 'z-[2]')}>Kod</Th>
                <Th className={cn(STICKY_NAME, 'z-[2] min-w-72 text-left')}>Manba (tushum qatori)</Th>
                {months.map((m) => (
                  <Th key={m.period} title={m.reportDate ? `Oxirgi kunlik hisobot: ${formatDate(m.reportDate)} (${m.reports} ta)` : "Kunlik hisobot yo'q"}>
                    {formatPeriodShort(m.period)}
                    {!m.reports && <span className="block text-[10px] font-normal text-(--color-text-faint)">hisobot yo&apos;q</span>}
                  </Th>
                ))}
                <Th>Jami</Th>
              </tr>
            </thead>
            <tbody>
              <Tr total>
                <Td className={STICKY_NO} />
                <NameCell>Jami · {FILTERS.find((f) => f.value === filter)!.label}</NameCell>
                {cells(colTotal, true)}
              </Tr>
              {lines}
            </tbody>
          </RTable>
        ) : (
          <EmptyNote>Bu davrda kunlik hisobot yo&apos;q yoki qidiruv bo&apos;yicha manba topilmadi</EmptyNote>
        )}
        <TableNote>
          Qatorni bosing — ichi ochiladi. Oy summasi — o&apos;sha oyning oxirgi kunlik hisobotidagi «Oy boshidan» − o&apos;tgan oy oxiridagi qiymat. «Daromad»
          yorlig&apos;ining jamisi har oy Markaz daromadiga teng (Daromadlar, Solishtirma va Bosh sahifadagi bilan bir xil). Qator turi va egasi —{' '}
          <Link href="/daromadlar/markaz" className="font-medium text-brand-700 hover:underline">
            Daromadlar › Markaz tushumi
          </Link>{' '}
          sahifasida belgilanadi; kunlik hisobot ham o&apos;sha yerda kiritiladi yoki yuklanadi.
        </TableNote>
      </ReportCard>
    </div>
  );
}
