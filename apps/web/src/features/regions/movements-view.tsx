'use client';

import { ExcelButton, NameCell, ReportCard, RTable, SearchInput, SelectBox, StatTiles, STICKY_NAME, STICKY_NO, TableNote, Td, Th, Tr } from '@/components/report/report';
import { EmptyNote, LoadingCard } from '@/components/report/report-extra-c';
import { chainApi, type ChainGrid } from '@/features/employees/chain-api';
import { downloadCsv } from '@/features/structure/stats';
import { MonthRangeCard, useMonthRange } from '@/features/units/month-range';
import { formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Solishtirma › O'zgarishlar › Xodimlar harakati: tanlangan davrda har xodim har oy qayerda ishlagani (Markaz bo'limi
// yoki hudud/tuman — hisoblar ishlatadigan amaldagi joy). Joy almashgan oy — ajratilgan; o'rtada kelgan / ketgani
// belgilangan. Standart — faqat o'zgarganlar; «Hammasi» — davrdagi hamma xodim.
// ═══════════════════════════════════════════════════════════

type Show = 'changed' | 'moved' | 'all';
/** Ekranda ko'pi bilan shuncha qator (qolgani — qidiruv / filtr yoki Excel) */
const LIMIT = 500;

export function MovementsView() {
  const range = useMonthRange('year');
  const res = useAsync(() => (range.error ? Promise.resolve(null) : chainApi.grid(range.from, range.to).then((r) => r.data)), [range.from, range.to, range.error]);
  return (
    <div className="space-y-4">
      <MonthRangeCard range={range} />
      {range.error ? null : !res.data ? <LoadingCard label="Xodimlar harakati tuzilmoqda" error={res.error} onRetry={res.reload} /> : <Grid d={res.data} />}
    </div>
  );
}

function Grid({ d }: { d: ChainGrid }) {
  const [show, setShow] = useState<Show>('changed');
  const [unit, setUnit] = useState('ALL');
  const [query, setQuery] = useState('');

  const units = useMemo(() => {
    const set = new Set<string>();
    for (const r of d.rows) for (const u of r.units) set.add(u);
    return [...set].sort((a, b) => (a === 'Markaz' ? -1 : b === 'Markaz' ? 1 : a.localeCompare(b)));
  }, [d.rows]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return d.rows.filter((r) => {
      if (show === 'moved' && !r.moves) return false;
      if (show === 'changed' && !r.moves && !r.started && !r.stopped) return false;
      if (unit !== 'ALL' && !r.units.includes(unit)) return false;
      if (q && !r.fullName.toLowerCase().includes(q) && !r.pinfl.includes(q) && !r.cells.some((c) => c.l >= 0 && d.labels[c.l]!.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [d, show, unit, query]);

  const moved = d.rows.filter((r) => r.moves).length;
  const started = d.rows.filter((r) => r.started).length;
  const stopped = d.rows.filter((r) => r.stopped).length;
  const place = (l: number) => (l < 0 ? '' : d.labels[l]!);

  const exportCsv = () =>
    downloadCsv(
      `xodimlar-harakati-${d.from}_${d.to}`,
      ['Xodim', 'JShShIR', 'Lavozim', ...d.months.map((m) => formatPeriod(m.period)), "Ko'chishlar soni", 'Holat'],
      rows.map((r) => [r.fullName, r.pinfl, r.position ?? '', ...r.cells.map((c) => place(c.l)), r.moves, status(r)]),
    );

  return (
    <>
      <StatTiles
        items={[
          { label: 'Davrdagi xodimlar', value: 0, text: String(d.rows.length), note: `${formatPeriod(d.from)} — ${formatPeriod(d.to)}`, tone: 'blue' },
          { label: "Joyi o'zgargan", value: 0, text: String(moved), note: "bo'lim yoki hudud almashgan", tone: 'orange' },
          { label: 'Davr ichida kelgan', value: 0, text: String(started), note: 'birinchi oyda yo‘q edi', tone: 'green' },
          { label: 'Davr ichida ketgan', value: 0, text: String(stopped), note: "keyingi oylarda yo'q", tone: 'red' },
        ]}
      />
      <ReportCard
        title="Xodimlar harakati — har oy qayerda ishlagani"
        badge={`${rows.length} xodim`}
        actions={
          <>
            <SelectBox
              value={show}
              onChange={setShow}
              options={[
                { value: 'changed', label: "O'zgarganlar (ko'chgan, kelgan, ketgan)" },
                { value: 'moved', label: "Faqat joyi o'zgarganlar" },
                { value: 'all', label: 'Hammasi' },
              ]}
            />
            <SelectBox value={unit} onChange={setUnit} options={[{ value: 'ALL', label: 'Hamma birliklar' }, ...units.map((u) => ({ value: u, label: u }))]} />
            <SearchInput value={query} onChange={setQuery} placeholder="Xodim, JShShIR yoki joy…" />
            <ExcelButton onClick={exportCsv} />
          </>
        }
      >
        {rows.length ? (
          <RTable minWidth={420 + d.months.length * 170}>
            <thead>
              <tr>
                <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
                <Th className={cn(STICKY_NAME, 'z-[2] min-w-56 text-left')}>Xodim</Th>
                {d.months.map((m) => (
                  <Th key={m.period} className="min-w-40 text-left" title={`${m.placed} xodim · ko'chgan ${m.moved} · kelgan ${m.started} · ketgan ${m.stopped}`}>
                    {formatPeriod(m.period)}
                    {m.moved > 0 && <span className="ml-1 text-[11px] font-semibold text-amber-700">↔{m.moved}</span>}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, LIMIT).map((r, i) => (
                <Tr key={r.pinfl}>
                  <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                  <NameCell sub={[r.position, status(r)].filter(Boolean).join(' · ')}>
                    <span className="font-medium text-heading">{r.fullName}</span>
                  </NameCell>
                  {r.cells.map((c, k) => {
                    const before = k > 0 ? place(r.cells[k - 1]!.l) : '';
                    const text = place(c.l);
                    const arrived = c.l >= 0 && k > 0 && r.cells[k - 1]!.l < 0 && r.cells.slice(0, k).every((x) => x.l < 0);
                    return (
                      <Td
                        key={d.months[k]!.period}
                        className={cn('max-w-56 text-left text-xs', c.move ? 'bg-amber-50 font-semibold text-amber-900' : arrived ? 'bg-emerald-50 text-emerald-800' : c.l < 0 ? 'text-(--color-text-faint)' : 'text-(--color-text)', c.l >= 0 && !c.paid && 'italic')}
                        title={c.move ? `Ko'chdi: ${before} → ${text}` : c.l >= 0 && !c.paid ? `${text} (shu oy ish haqi yo'q)` : text || undefined}
                      >
                        {c.l < 0 ? '—' : `${c.move ? '↔ ' : arrived ? '+ ' : ''}${text}`}
                      </Td>
                    );
                  })}
                </Tr>
              ))}
            </tbody>
          </RTable>
        ) : (
          <EmptyNote>{show === 'all' ? "Bu davrda xodim yo'q" : "Bu davrda o'zgarish yo'q"}</EmptyNote>
        )}
        <TableNote>
          {rows.length > LIMIT ? `Ekranda birinchi ${LIMIT} ta xodim — qolganini qidiruv / filtr bilan toping yoki Excelga yuklang. ` : ''}
          Sariq «↔» — shu oy joyi o&apos;zgargan (sichqoncha ustida: qayerdan → qayerga); yashil «+» — davr ichida kelgan; «—» — shu oy hech qayerda emas (ishlamagan yoki ketgan); qiya yozuv — joyi bor, ish haqi yo&apos;q. Joy — hisoblar ishlatadigan tartibda: ish haqi tarkibi tuzatishi → joylashuv davri → natijalar fayli → xodimlar reestri.
        </TableNote>
      </ReportCard>
    </>
  );
}

function status(r: ChainGrid['rows'][number]): string {
  return [r.moves ? `${r.moves} marta ko'chgan` : '', r.started ? 'kelgan' : '', r.stopped ? 'ketgan' : ''].filter(Boolean).join(', ');
}
