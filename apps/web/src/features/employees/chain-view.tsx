'use client';

import { ExcelButton, NameCell, PillTabs, ReportCard, RTable, SearchInput, SelectBox, StatTiles, STICKY_NAME, STICKY_NO, TableNote, Td, Th, Tr } from '@/components/report/report';
import { EmptyNote, LoadingCard } from '@/components/report/report-extra-c';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Toast } from '@/components/ui/toast';
import { downloadCsv } from '@/features/structure/stats';
import { MonthRangeCard, useMonthRange } from '@/features/units/month-range';
import { errorMessage } from '@/lib/error-message';
import { formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { chainApi, SOURCE_LABEL, type ChainIssueType, type ChainReport } from './chain-api';

// ═══════════════════════════════════════════════════════════
// Xodimlar › Harakat zanjiri: har xodim har oy qayerda bo'lgani (Markaz bo'limi yoki hudud/tuman), qaysi manba
// aytgani, kim qayerdan qayerga o'tgani va «Nazorat» — manbalar zid, joyi ko'rsatilmagan, ish davridan tashqari
// ish haqi, reestr eskirgan. Tuzatish — xodim kartasidagi «Joylashuv davrlari»da; «Ko'rib chiqildi» — belgi.
// ═══════════════════════════════════════════════════════════

type ToastState = { message: string; tone: 'success' | 'error' } | null;
const ISSUE_TONE: Record<ChainIssueType, string> = {
  CONFLICT: 'bg-red-50 text-red-700',
  NO_PLACE: 'bg-amber-50 text-amber-800',
  OUT_OF_RANGE: 'bg-violet-50 text-violet-700',
  REGISTRY_STALE: 'bg-sky-50 text-sky-800',
};

export function ChainView({ isAdmin, onOpenEmployee }: { isAdmin: boolean; onOpenEmployee: (pinfl: string) => void }) {
  const range = useMonthRange('year');
  const res = useAsync(() => (range.error ? Promise.resolve(null) : chainApi.report(range.from, range.to).then((r) => r.data)), [range.from, range.to, range.error]);
  const [toast, setToast] = useState<ToastState>(null);
  const [timeline, setTimeline] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <MonthRangeCard range={range} />
      {range.error ? null : !res.data ? (
        <LoadingCard label="Harakat zanjiri tuzilmoqda" error={res.error} onRetry={res.reload} />
      ) : (
        <Body d={res.data} loading={res.loading} reload={res.reload} isAdmin={isAdmin} onTimeline={setTimeline} setToast={setToast} />
      )}
      {timeline && !range.error && (
        <TimelineDrawer
          pinfl={timeline}
          from={range.from}
          to={range.to}
          onClose={() => setTimeline(null)}
          onOpenEmployee={(p) => {
            setTimeline(null);
            onOpenEmployee(p);
          }}
        />
      )}
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </div>
  );
}

function Body({ d, loading, reload, isAdmin, onTimeline, setToast }: { d: ChainReport; loading: boolean; reload: () => void; isAdmin: boolean; onTimeline: (pinfl: string) => void; setToast: (t: ToastState) => void }) {
  const [tab, setTab] = useState<'issues' | 'moves'>('issues');
  const [type, setType] = useState<'ALL' | ChainIssueType>('ALL');
  const [state, setState] = useState<'open' | 'reviewed' | 'all'>('open');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const open = Object.values(d.summary).reduce((s, x) => s + x.open, 0);

  const issues = d.issues.filter((x) => (type === 'ALL' || x.type === type) && (state === 'all' || (state === 'open' ? !x.reviewed : Boolean(x.reviewed))) && (!q || x.fullName.toLowerCase().includes(q) || x.pinfl.includes(q)));
  const moves = d.moves.filter((x) => !q || x.fullName.toLowerCase().includes(q) || x.pinfl.includes(q) || x.from.toLowerCase().includes(q) || x.to.toLowerCase().includes(q));

  const review = async (x: ChainReport['issues'][number], undo: boolean) => {
    const note = undo ? undefined : (window.prompt("Izoh (ixtiyoriy): nima uchun to'g'ri — masalan, buyruq raqami") ?? null);
    if (note === null) return;
    const k = `${x.pinfl}|${x.period}|${x.type}`;
    setBusy(k);
    try {
      await chainApi.review({ pinfl: x.pinfl, period: x.period, type: x.type, note: note || undefined, undo });
      setToast({ message: undo ? 'Qayta ochildi' : "Ko'rib chiqildi deb belgilandi", tone: 'success' });
      reload();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = () =>
    tab === 'issues'
      ? downloadCsv(`harakat-nazorat-${d.from}_${d.to}`, ['Xodim', 'Oy', 'Muammo', 'Tafsilot', 'Amaldagi joy', 'Holat'], issues.map((x) => [x.fullName, x.period, d.summary[x.type].label, x.detail, x.effective ?? '', x.reviewed ? `ko'rib chiqildi (${x.reviewed.note ?? ''})` : 'ochiq']))
      : downloadCsv(`harakatlar-${d.from}_${d.to}`, ['Oy', 'Xodim', 'Qayerdan', 'Qayerga', 'Manba'], moves.map((x) => [x.period, x.fullName, x.from, x.to, x.source ? SOURCE_LABEL[x.source] : '']));

  return (
    <div className={cn('space-y-4', loading && 'opacity-70')}>
      <StatTiles
        compareLabel="Avval"
        items={[
          { label: 'Ochiq muammolar', value: 0, text: String(open), note: 'hal qilinishi kerak', tone: open ? 'red' : 'green' },
          { label: d.summary.CONFLICT.label, value: 0, text: String(d.summary.CONFLICT.open), note: 'natijalar fayli ↔ qo‘lda kiritilgan joy', tone: 'red' },
          { label: d.summary.NO_PLACE.label, value: 0, text: String(d.summary.NO_PLACE.open), note: 'ish haqi bor, joy yo‘q', tone: 'orange' },
          { label: d.summary.OUT_OF_RANGE.label, value: 0, text: String(d.summary.OUT_OF_RANGE.open), note: 'ishga kirishdan oldin / bo‘shagandan keyin', tone: 'purple' },
          { label: d.summary.REGISTRY_STALE.label, value: 0, text: String(d.summary.REGISTRY_STALE.open), note: 'reestrdagi joy eski', tone: 'cyan' },
          { label: 'Harakatlar', value: 0, text: String(d.totals.moves), note: 'joy o‘zgargan holatlar', tone: 'blue' },
        ]}
      />

      <PillTabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'issues', label: `Nazorat (${open} ochiq)`, hint: 'Manbalar zid yoki joy aniq emas — hal qilish' },
          { value: 'moves', label: `Harakatlar (${d.totals.moves})`, hint: 'Kim, qachon, qayerdan qayerga o‘tdi' },
        ]}
      />

      {tab === 'issues' ? (
        <ReportCard
          title="Nazorat: xodim joyi bo'yicha muammolar"
          badge={`${formatPeriod(d.from)} — ${formatPeriod(d.to)} · ${issues.length} ta`}
          actions={
            <>
              <SelectBox value={type} onChange={setType} options={[{ value: 'ALL', label: 'Hamma turlar' }, ...(Object.keys(d.summary) as ChainIssueType[]).map((t) => ({ value: t, label: `${d.summary[t].label} (${d.summary[t].open})` }))]} />
              <SelectBox value={state} onChange={setState} options={[{ value: 'open', label: 'Ochiq' }, { value: 'reviewed', label: "Ko'rib chiqilgan" }, { value: 'all', label: 'Hammasi' }]} />
              <SearchInput value={query} onChange={setQuery} placeholder="Xodim qidirish…" />
              <ExcelButton onClick={exportCsv} />
            </>
          }
        >
          {issues.length ? (
            <RTable minWidth={1080}>
              <thead>
                <tr>
                  <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
                  <Th className={cn(STICKY_NAME, 'z-[2] min-w-56 text-left')}>Xodim</Th>
                  <Th>Oy</Th>
                  <Th className="text-left">Muammo</Th>
                  <Th className="min-w-80 text-left">Tafsilot</Th>
                  <Th className="text-left">Hisobda olinayotgan joy</Th>
                  <Th className="text-left">Amal</Th>
                </tr>
              </thead>
              <tbody>
                {issues.map((x, i) => {
                  const k = `${x.pinfl}|${x.period}|${x.type}`;
                  return (
                    <Tr key={k} muted={Boolean(x.reviewed)}>
                      <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                      <NameCell drill sub={x.reviewed ? `ko'rib chiqildi: ${x.reviewed.by}${x.reviewed.note ? ` — ${x.reviewed.note}` : ''}` : undefined}>
                        <button type="button" className="text-left hover:text-brand-700 hover:underline" onClick={() => onTimeline(x.pinfl)}>
                          {x.fullName}
                        </button>
                      </NameCell>
                      <Td className="whitespace-nowrap">{formatPeriod(x.period)}</Td>
                      <Td className="text-left">
                        <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', ISSUE_TONE[x.type])}>{d.summary[x.type].label}</span>
                      </Td>
                      <Td className="text-left text-xs text-(--color-text-muted)">{x.detail}</Td>
                      <Td className="text-left text-xs">{x.effective ?? '—'}</Td>
                      <Td className="whitespace-nowrap text-left text-xs">
                        <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => onTimeline(x.pinfl)}>
                          Tarix
                        </button>
                        {isAdmin && (
                          <button type="button" disabled={busy === k} className="ml-3 text-(--color-text-muted) hover:text-heading hover:underline disabled:opacity-50" onClick={() => void review(x, Boolean(x.reviewed))}>
                            {x.reviewed ? 'Qayta ochish' : "Ko'rib chiqildi"}
                          </button>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </RTable>
          ) : (
            <EmptyNote>{state === 'open' ? "Ochiq muammo yo'q — zanjir to'g'ri" : "Bu filtr bo'yicha yozuv yo'q"}</EmptyNote>
          )}
          <TableNote>
            Hisobda olinayotgan joy — ish haqi, Solishtirma va Markaz bo&apos;limlari ishlatadigan tartibda: ish haqi tarkibi tuzatishi → joylashuv davri → natijalar fayli →
            xodimlar reestri. Tuzatish — «Tarix» › «Xodim kartasi» › Joylashuv davrlari (shu oydan shu oygacha shu joyda). «Ko&apos;rib chiqildi» — joy to&apos;g&apos;ri
            ekani tasdiqlangan (izoh bilan), zanjir o&apos;zgarmaydi.
          </TableNote>
        </ReportCard>
      ) : (
        <ReportCard
          title="Harakatlar: kim, qachon, qayerdan qayerga"
          badge={`${formatPeriod(d.from)} — ${formatPeriod(d.to)} · ${moves.length} ta`}
          actions={
            <>
              <SearchInput value={query} onChange={setQuery} placeholder="Xodim yoki joy qidirish…" />
              <ExcelButton onClick={exportCsv} />
            </>
          }
        >
          {moves.length ? (
            <RTable minWidth={960}>
              <thead>
                <tr>
                  <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
                  <Th className={cn(STICKY_NAME, 'z-[2] min-w-56 text-left')}>Xodim</Th>
                  <Th>Oy</Th>
                  <Th className="text-left">Qayerdan</Th>
                  <Th className="text-left">Qayerga</Th>
                  <Th className="text-left">Manba</Th>
                </tr>
              </thead>
              <tbody>
                {moves.map((x, i) => (
                  <Tr key={`${x.pinfl}|${x.period}`} onClick={() => onTimeline(x.pinfl)}>
                    <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                    <NameCell drill>{x.fullName}</NameCell>
                    <Td className="whitespace-nowrap">{formatPeriod(x.period)}</Td>
                    <Td className="text-left text-xs text-(--color-text-muted)">{x.from}</Td>
                    <Td className="text-left text-xs font-semibold text-heading">→ {x.to}</Td>
                    <Td className="text-left text-xs text-(--color-text-muted)">{x.source ? SOURCE_LABEL[x.source] : ''}</Td>
                  </Tr>
                ))}
              </tbody>
            </RTable>
          ) : (
            <EmptyNote>Bu davrda harakat yo&apos;q</EmptyNote>
          )}
          <TableNote>Qatorni bosing — xodimning to&apos;liq harakat tarixi (vaqt chizig&apos;i va har oy qaysi manba nima ko&apos;rsatgani).</TableNote>
        </ReportCard>
      )}
    </div>
  );
}

function TimelineDrawer({ pinfl, from, to, onClose, onOpenEmployee }: { pinfl: string; from: string; to: string; onClose: () => void; onOpenEmployee: (pinfl: string) => void }) {
  const res = useAsync(() => chainApi.timeline(pinfl, from, to).then((r) => r.data), [pinfl, from, to]);
  const t = res.data;
  return (
    <Drawer
      open
      onClose={onClose}
      width="xl"
      title={t ? `Harakat tarixi: ${t.fullName}` : 'Harakat tarixi'}
      description={t ? [t.position, t.hired ? `ishga kirgan: ${formatPeriod(t.hired)}` : null, t.fired ? `bo'shagan: ${formatPeriod(t.fired)}` : t.isActive ? 'ishlayapti' : 'faol emas', `reestrda: ${t.registry}`].filter(Boolean).join(' · ') : undefined}
      footer={
        <div className="flex w-full justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Yopish
          </Button>
          <Button size="sm" onClick={() => onOpenEmployee(pinfl)} title="Xodim kartasi — «Joylashuv davrlari»da shu oydan shu oygacha joyni tuzatish">
            Xodim kartasi (joyni tuzatish)
          </Button>
        </div>
      }
    >
      {!t ? (
        <LoadingCard label="Yuklanmoqda" error={res.error} onRetry={res.reload} />
      ) : (
        <div className="space-y-5">
          {/* Vaqt chizig'i: uzluksiz davrlar */}
          <div>
            <p className="mb-2 text-sm font-semibold text-heading">Vaqt chizig&apos;i</p>
            {t.segments.length ? (
              <ol className="relative space-y-2 border-l-2 border-brand-200 pl-5">
                {t.segments.map((s, i) => (
                  <li key={`${s.from}-${i}`} className="relative">
                    <span className="absolute -left-[27px] top-1.5 size-3 rounded-full border-2 border-white bg-brand-600 shadow" />
                    <p className="text-sm font-semibold text-heading">{s.place}</p>
                    <p className="text-xs text-(--color-text-muted)">
                      {formatPeriod(s.from)} — {formatPeriod(s.to)} · {s.months} oy · manba: {s.sources.map((x) => SOURCE_LABEL[x]).join(', ')}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyNote>Bu davrda joy ma&apos;lumoti yo&apos;q</EmptyNote>
            )}
          </div>
          {/* Har oy: manbalar */}
          <div className="overflow-x-auto">
            <p className="mb-2 text-sm font-semibold text-heading">Har oy: qaysi manba nima ko&apos;rsatadi</p>
            <table className="w-full min-w-[860px] text-[13px]">
              <thead>
                <tr className="border-b border-(--color-line) text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
                  <th className="px-2 py-2">Oy</th>
                  <th className="px-2 py-2">Ish haqi</th>
                  <th className="px-2 py-2">Natijalar fayli</th>
                  <th className="px-2 py-2">Joylashuv davri</th>
                  <th className="px-2 py-2">Tarkib tuzatishi</th>
                  <th className="px-2 py-2">Hisobdagi joy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-line)">
                {t.rows.map((r) => (
                  <tr key={r.period} className={cn(r.issues.some((x) => !x.reviewed) && 'bg-red-50/40')}>
                    <td className="whitespace-nowrap px-2 py-1.5 font-medium text-heading">{formatPeriod(r.period)}</td>
                    <td className="px-2 py-1.5">{r.paid ? '✓' : <span className="text-(--color-text-faint)">—</span>}</td>
                    <td className="px-2 py-1.5">{r.results ?? <span className="text-(--color-text-faint)">—</span>}</td>
                    <td className="px-2 py-1.5">{r.placement ?? <span className="text-(--color-text-faint)">—</span>}</td>
                    <td className="px-2 py-1.5">{r.fix ?? <span className="text-(--color-text-faint)">—</span>}</td>
                    <td className="px-2 py-1.5">
                      <span className="font-semibold text-heading">{r.effective ?? '—'}</span>
                      {r.source && <span className="block text-[11px] text-(--color-text-muted)">{SOURCE_LABEL[r.source]}</span>}
                      {r.issues.map((x) => (
                        <span key={x.type} className={cn('mt-0.5 block text-[11px]', x.reviewed ? 'text-(--color-text-faint)' : 'text-red-700')}>
                          {x.detail}
                          {x.reviewed ? " (ko'rib chiqilgan)" : ''}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Drawer>
  );
}
