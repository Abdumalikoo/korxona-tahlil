'use client';

import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { compact } from '@/features/structure/api';
import { Findings, SearchBox, SmallButton } from '@/features/structure/parts';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { formatDate, formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useBrief } from '@/lib/view-mode';
import { useMemo, useState } from 'react';
import { changesApi, type ChangeKind, type ChangePerson } from './changes-api';
import { PinflText } from './pinfl-text';

// ═══════════════════════════════════════════════════════════
// Solishtirma › O'zgarishlar: bu oy nechta xodimga oylik hisoblandi (hududlar / Markaz),
// o'tgan oyga nisbatan — ishga olindi, qaytdi, bo'shatildi, ishlamadi, ko'chdi, oyligi keskin o'zgardi.
// Manba — ish haqi vedomostlari, xodimlar reestri (ishga kirgan / bo'shagan sana) va hudud tarixi.
// ═══════════════════════════════════════════════════════════

const KIND: Record<ChangeKind, { label: string; hint: string; cls: string; sign: string }> = {
  hired: { label: 'Ishga olindi', hint: "bu oy oylik bor, o'tgan oy yo'q — yangi xodim", cls: 'bg-emerald-50 text-emerald-700', sign: '+' },
  hiredUnpaid: { label: 'Ishga olindi (oylik hali yo\'q)', hint: "shu oy ishga kirgan, vedomostda hali yo'q", cls: 'bg-emerald-50/60 text-emerald-700', sign: '+' },
  returned: { label: 'Qaytdi', hint: "o'tgan oy oyligi yo'q edi (ta'til, dekret …), bu oy bor", cls: 'bg-sky-50 text-sky-700', sign: '+' },
  fired: { label: "Bo'shatildi", hint: "o'tgan oy oylik bor edi, ishdan bo'shagan", cls: 'bg-red-50 text-red-700', sign: '−' },
  idle: { label: 'Bu oy ishlamadi', hint: "o'tgan oy oylik bor edi, bu oy yo'q — lekin bo'shamagan", cls: 'bg-amber-50 text-amber-800', sign: '−' },
  moved: { label: "Ko'chdi", hint: 'boshqa hudud yoki Markazga o\'tgan', cls: 'bg-violet-50 text-violet-700', sign: '↔' },
  up: { label: 'Oyligi oshdi', hint: "20% dan ko'p", cls: 'bg-(--color-surface-sunken) text-heading', sign: '↑' },
  down: { label: 'Oyligi kamaydi', hint: "20% dan ko'p", cls: 'bg-(--color-surface-sunken) text-heading', sign: '↓' },
};
const ORDER: ChangeKind[] = ['hired', 'hiredUnpaid', 'returned', 'fired', 'idle', 'moved', 'up', 'down'];

function Delta({ cur, prev, money }: { cur: number; prev: number; money?: boolean }) {
  const d = cur - prev;
  if (d === 0) return <span className="text-(--color-text-faint)">0</span>;
  return (
    <span className={cn('font-semibold tabular-nums', d > 0 ? 'text-(--color-income)' : 'text-(--color-expense)')}>
      {d > 0 ? '+' : '−'}
      {money ? compact(Math.abs(d)) : Math.abs(d)}
    </span>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="px-5 py-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-(--color-text-muted)">{label}</p>
      <p className={cn('mt-1.5 text-xl font-bold tabular-nums tracking-tight text-heading', tone)}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-(--color-text-muted)">{sub}</p>}
    </div>
  );
}

export function ChangesView({ to }: { to: string }) {
  const brief = useBrief();
  const [month, setMonth] = useState<string | null>(null);
  const res = useAsync(() => changesApi.month(month ? { month } : { to }).then((r) => r.data), [month, to]);
  const [kind, setKind] = useState<ChangeKind | 'all'>('all');
  const [unit, setUnit] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const data = res.data;

  const people = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.people ?? []).filter(
      (p) => (kind === 'all' || p.kind === kind) && (!unit || p.unitKey === unit || p.fromUnitKey === unit) && (!q || `${p.fullName} ${p.pinfl} ${p.unitName} ${p.position ?? ''}`.toLowerCase().includes(q)),
    );
  }, [data, kind, unit, query]);

  if (res.loading && !data) return <LoadingState label="O'zgarishlar yuklanmoqda" />;
  if (res.error) return <ErrorState message={res.error} onRetry={res.reload} />;
  if (!data) return null;
  const t = data.totals;
  const prevLabel = formatPeriod(data.previousPeriod);
  const exportCsv = () =>
    downloadCsv(
      `solishtirma-ozgarishlar-${data.period}`,
      ['Holat', 'Xodim', 'JShShIR', 'Lavozim', 'Hudud / Markaz', 'Qayerdan', `${prevLabel}, so'm`, `${formatPeriod(data.period)}, so'm`, 'Ishga kirgan', "Bo'shagan"],
      people.map((p) => [KIND[p.kind].label, p.fullName, p.pinfl, p.position ?? '', p.unitName, p.fromUnitName ?? '', csvSom(p.previousTiyin), csvSom(p.currentTiyin), p.hiredAt ? formatDate(p.hiredAt) : '', p.firedAt ? formatDate(p.firedAt) : '']),
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-heading">Oy:</span>
        <select
          className="rounded-(--radius-control) border border-(--color-line) bg-white px-3 py-1.5 text-sm font-semibold text-heading"
          value={data.period}
          onChange={(e) => {
            setMonth(e.target.value);
            setUnit(null);
          }}
        >
          {[...new Set([data.period, ...data.periods])].sort().reverse().map((p) => (
            <option key={p} value={p}>
              {formatPeriod(p)}
            </option>
          ))}
        </select>
        <span className="text-xs text-(--color-text-muted)">
          {prevLabel}ga nisbatan · ish haqi vedomostlari, xodimlar reestri va hudud tarixidan
        </span>
      </div>

      {!data.hasCurrent ? (
        <Card className="px-5 py-8 text-center text-sm text-(--color-text-muted)">{formatPeriod(data.period)} uchun ish haqi vedomosti yuklanmagan — oyni tanlang yoki Xarajatlar › Ish haqidan yuklang.</Card>
      ) : (
        <>
          <Card className="grid divide-y divide-(--color-line) sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 xl:divide-x">
            <Stat label="Oylik hisoblandi" value={`${t.currentCount} xodim`} sub={<>{compact(t.currentTiyin)} · {data.hasPrevious ? <>o&apos;tgan oy {t.previousCount} (<Delta cur={t.currentCount} prev={t.previousCount} />)</> : "o'tgan oy yuklanmagan"}</>} />
            <Stat label="Hududlardan" value={`${t.regionsCount} xodim`} sub={<>{compact(t.regionsTiyin)} · <Delta cur={t.regionsCount} prev={t.previousRegionsCount} />{BigInt(t.centerPartTiyin) > 0n ? ` · bayram/choraklik ${compact(t.centerPartTiyin)} Markaz hisobidan` : ''}</>} />
            <Stat label="Markazdan" value={`${t.centerCount} xodim`} sub={<>{compact(t.centerTiyin)} · <Delta cur={t.centerCount} prev={t.previousCenterCount} /></>} />
            <Stat
              label="Harakat"
              value={`+${data.counts.hired + data.counts.returned} / −${data.counts.fired + data.counts.idle}`}
              sub={`ishga olindi ${data.counts.hired}, qaytdi ${data.counts.returned}, bo'shatildi ${data.counts.fired}, ishlamadi ${data.counts.idle}, ko'chdi ${data.counts.moved}`}
            />
          </Card>

          <Findings title="Bu oy nima o'zgardi" notes={brief ? data.notes.slice(0, 3) : data.notes} />

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-(--color-line) px-5 py-3">
              <div>
                <p className="text-sm font-semibold text-heading">Hududlar va Markaz bo&apos;yicha</p>
                <p className="text-xs text-(--color-text-muted)">Qatorni bosing — pastdagi ro&apos;yxat shu hudud bo&apos;yicha</p>
              </div>
              {unit && (
                <SmallButton className="ml-auto" onClick={() => setUnit(null)}>
                  Hammasi
                </SmallButton>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="border-b border-(--color-line) bg-(--color-surface-muted) text-left text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">
                  <tr>
                    <th className="px-5 py-2">Hudud</th>
                    <th className="px-3 py-2 text-right">{prevLabel}</th>
                    <th className="px-3 py-2 text-right">Bu oy</th>
                    <th className="px-3 py-2 text-right">Farq</th>
                    <th className="px-3 py-2 text-right">Ishga olindi</th>
                    <th className="px-3 py-2 text-right">Qaytdi</th>
                    <th className="px-3 py-2 text-right">Bo&apos;shatildi</th>
                    <th className="px-3 py-2 text-right">Ishlamadi</th>
                    <th className="px-3 py-2 text-right">Ko&apos;chdi (+/−)</th>
                    <th className="px-3 py-2 text-right">Oylik (bu oy)</th>
                    <th className="px-5 py-2 text-right">Oylik farqi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-(--color-line)">
                  {data.units.map((u) => (
                    <tr key={u.key} className={cn('cursor-pointer hover:bg-brand-50/50', unit === u.key && 'bg-brand-50/70', u.kind === 'center' && 'font-medium')} onClick={() => setUnit(unit === u.key ? null : u.key)}>
                      <td className="px-5 py-2 text-heading">{u.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-(--color-text-muted)">{u.previousCount}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{u.currentCount}</td>
                      <td className="px-3 py-2 text-right">
                        <Delta cur={u.currentCount} prev={u.previousCount} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{u.hired || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{u.returned || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{u.fired || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{u.idle || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{u.movedIn || u.movedOut ? `+${u.movedIn} / −${u.movedOut}` : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{compact(u.currentTiyin)}</td>
                      <td className="px-5 py-2 text-right">
                        <Delta cur={Number(u.currentTiyin)} prev={Number(u.previousTiyin)} money />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-(--color-line) bg-(--color-surface-muted) font-semibold">
                  <tr>
                    <td className="px-5 py-2 text-heading">Jami</td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.previousCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.currentCount}</td>
                    <td className="px-3 py-2 text-right">
                      <Delta cur={t.currentCount} prev={t.previousCount} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{data.counts.hired}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{data.counts.returned}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{data.counts.fired}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{data.counts.idle}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{data.counts.moved}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{compact(t.currentTiyin)}</td>
                    <td className="px-5 py-2 text-right">
                      <Delta cur={Number(t.currentTiyin)} prev={Number(t.previousTiyin)} money />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-(--color-line) px-5 py-3">
              <p className="mr-2 text-sm font-semibold text-heading">
                Xodimlar{unit ? ` · ${data.units.find((u) => u.key === unit)?.name ?? ''}` : ''}
              </p>
              <button type="button" onClick={() => setKind('all')} className={cn('rounded-full px-3 py-1 text-xs font-semibold', kind === 'all' ? 'bg-heading text-white' : 'bg-(--color-surface-sunken) text-heading hover:bg-brand-50')}>
                Hammasi · {data.people.length}
              </button>
              {ORDER.filter((k) => data.counts[k] > 0).map((k) => (
                <button key={k} type="button" title={KIND[k].hint} onClick={() => setKind(k)} className={cn('rounded-full px-3 py-1 text-xs font-semibold', kind === k ? 'bg-heading text-white' : KIND[k].cls)}>
                  {KIND[k].label} · {data.counts[k]}
                </button>
              ))}
              {!brief && (
                <span className="ml-auto flex items-center gap-2">
                  <SearchBox value={query} onChange={setQuery} placeholder="Xodim, JShShIR…" />
                  <SmallButton onClick={exportCsv}>Excel (CSV)</SmallButton>
                </span>
              )}
            </div>
            {!data.hasPrevious ? (
              <p className="px-5 py-6 text-center text-sm text-(--color-text-muted)">{prevLabel} uchun ish haqi yuklanmagan — taqqoslab bo&apos;lmaydi.</p>
            ) : people.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-(--color-text-muted)">O&apos;zgarish yo&apos;q</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="border-b border-(--color-line) bg-(--color-surface-muted) text-left text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">
                    <tr>
                      <th className="px-5 py-2">Xodim</th>
                      <th className="px-3 py-2">Holat</th>
                      <th className="px-3 py-2">Hudud</th>
                      <th className="px-3 py-2 text-right">{prevLabel}</th>
                      <th className="px-3 py-2 text-right">Bu oy</th>
                      <th className="px-5 py-2">Sana</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-(--color-line)">
                    {people.slice(0, brief ? 30 : 500).map((p: ChangePerson) => (
                      <tr key={`${p.kind}-${p.pinfl}`}>
                        <td className="px-5 py-2">
                          <span className="font-medium text-heading">{p.fullName}</span>
                          <span className="block text-[11px] text-(--color-text-muted)">
                            <PinflText pinfl={p.pinfl} />
                            {p.position ? ` · ${p.position}` : ''}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold', KIND[p.kind].cls)} title={KIND[p.kind].hint}>
                            {KIND[p.kind].sign} {KIND[p.kind].label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-(--color-text-muted)">{p.fromUnitName ? `${p.fromUnitName} → ${p.unitName}` : p.unitName}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-(--color-text-muted)">{p.previousTiyin === '0' ? '—' : compact(p.previousTiyin)}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{p.currentTiyin === '0' ? '—' : compact(p.currentTiyin)}</td>
                        <td className="whitespace-nowrap px-5 py-2 text-xs text-(--color-text-muted)">
                          {p.kind === 'fired' && p.firedAt ? `bo'shagan ${formatDate(p.firedAt)}` : (p.kind === 'hired' || p.kind === 'hiredUnpaid') && p.hiredAt ? `ishga kirgan ${formatDate(p.hiredAt)}` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {brief && people.length > 30 && <p className="border-t border-(--color-line) px-5 py-2 text-xs text-(--color-text-muted)">Birinchi 30 tasi — hammasi To&apos;liq rejimda</p>}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}