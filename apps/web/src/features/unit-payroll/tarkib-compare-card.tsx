'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconSearch } from '@/components/ui/icons';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { compositionApi, type UnitPlaceRow, type UnitPlaceStatus } from '@/features/salary-composition/api';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime, formatPeriod, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { Fragment, useMemo, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Bo'lim sahifasi (Tax free …) › «Manba va ish haqi tarkibi»: tanlangan oy uchun har xodim qatori ikkiga bo'linadi —
// «Manbada» (miyadagi asl joyi) va «Ish haqi tarkibida» (yuklangan tarkibda yozilgan bo'lim).
// Farq bo'lsa — shu yerning o'zidan shu oy uchun tarkibdagidek o'tkazish (yoki qaytarish).
// ═══════════════════════════════════════════════════════════

type Filter = 'ALL' | 'FARQ' | 'FIXED' | 'MOS' | 'OTHER';

const STATUS: Record<UnitPlaceStatus, { label: string; tone: 'income' | 'warn' | 'brand' | 'neutral' | 'expense' }> = {
  MOS: { label: 'mos', tone: 'income' },
  FARQ: { label: 'farq', tone: 'warn' },
  FIXED: { label: 'o‘tkazilgan', tone: 'brand' },
  NO_TARKIB: { label: 'tarkibda yo‘q', tone: 'neutral' },
  UNKNOWN: { label: 'bo‘lim tanlanmagan', tone: 'neutral' },
};

const place = (unit: string | null, unitLabel: string | null, dept: string | null) => (!unit ? '—' : unit === 'CENTER' ? `Markaz › ${dept ?? 'bo‘limsiz'}` : (unitLabel ?? unit));

export function TarkibCompareCard({ unitCode, period, isAdmin, stamp, onChanged, onToast }: { unitCode: string; period: string; isAdmin: boolean; stamp: unknown; onChanged: () => void; onToast: (t: { message: string; tone: 'success' | 'error' }) => void }) {
  const data = useAsync(() => compositionApi.unitPlaces(period, unitCode).then((r) => r.data), [period, unitCode, stamp]);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<{ kind: 'fix' | 'revert'; pinfls: string[]; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const v = data.data;

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (v?.rows ?? []).filter((r) => {
      if (s && !r.fullName.toLowerCase().includes(s) && !r.pinfl.includes(s)) return false;
      if (filter === 'FARQ') return r.status === 'FARQ';
      if (filter === 'FIXED') return r.status === 'FIXED';
      if (filter === 'MOS') return r.status === 'MOS';
      if (filter === 'OTHER') return r.status === 'NO_TARKIB' || r.status === 'UNKNOWN';
      return true;
    });
  }, [v, q, filter]);

  if (data.error || !v) return null;
  const c = v.counts;
  const groups: { key: UnitPlaceRow['group']; title: string; rows: UnitPlaceRow[] }[] = [
    { key: 'HERE', title: `Manbada — ${v.label}`, rows: rows.filter((r) => r.group === 'HERE') },
    { key: 'TARKIB_HERE', title: `Ish haqi tarkibida — ${v.label}, manbada boshqa joyda`, rows: rows.filter((r) => r.group === 'TARKIB_HERE') },
  ];
  const fixable = rows.filter((r) => r.status === 'FARQ');
  const pickedRows = fixable.filter((r) => picked.has(r.pinfl));

  function toggle(p: string) {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  }

  async function run() {
    if (!target) return;
    setBusy(true);
    try {
      if (target.kind === 'fix') {
        const r = (await compositionApi.fixPlaces(period, target.pinfls)).data;
        onToast({ message: `${r.fixed} xodim ${formatPeriod(period)} uchun tarkibdagidek o‘tkazildi${r.redistributed ? ' · ish haqi qayta taqsimlandi' : ''}${r.warnings.length ? ` · ${r.warnings.join('; ')}` : ''}`, tone: 'success' });
      } else {
        const r = (await compositionApi.revertPlaces(period, target.pinfls)).data;
        onToast({ message: `${r.reverted} xodim manbadagi joyiga qaytarildi${r.redistributed ? ' · ish haqi qayta taqsimlandi' : ''}`, tone: 'success' });
      }
      setPicked(new Set());
      data.reload();
      onChanged();
    } catch (err) {
      onToast({ message: errorMessage(err, 'Saqlashda xatolik'), tone: 'error' });
    } finally {
      setBusy(false);
      setTarget(null);
    }
  }

  const chips: { key: Filter; label: string; n: number }[] = [
    { key: 'ALL', label: 'Hammasi', n: c.total },
    { key: 'FARQ', label: 'Farq', n: c.farq },
    { key: 'FIXED', label: 'O‘tkazilgan', n: c.fixed },
    { key: 'MOS', label: 'Mos', n: c.mos },
    { key: 'OTHER', label: 'Tarkibda yo‘q / tanlanmagan', n: c.noTarkib + c.unknown },
  ];

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={`Manba va ish haqi tarkibi · ${formatPeriod(period)}`}
        description={
          v.hasTarkib
            ? `Har xodim: manbada (miyada) qayerda va yuklangan ish haqi tarkibida qaysi bo‘limda${v.tarkibAt ? ` · tarkib ${formatDateTime(v.tarkibAt)}` : ''}. O‘tkazish faqat shu oy uchun.`
            : `${formatPeriod(period)} uchun bo‘limlari yozilgan ish haqi tarkibi yuklanmagan — Xarajatlar › Ish haqi tarkibi sahifasida yuklang`
        }
      />
      {v.hasTarkib && (
        <>
          <div className="flex flex-wrap items-center gap-2 border-t border-(--color-line) px-5 py-3">
            {chips.map((ch) => (
              <button
                key={ch.key}
                type="button"
                onClick={() => setFilter(ch.key)}
                className={cn('rounded-full border px-3 py-1 text-xs', filter === ch.key ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-(--color-line) bg-white text-(--color-text-muted) hover:border-(--color-line-strong)', ch.key === 'FARQ' && ch.n > 0 && filter !== ch.key && 'border-(--color-warn) text-(--color-warn)')}
              >
                {ch.label} <span className="money font-semibold">{ch.n}</span>
              </button>
            ))}
            <label className="relative ml-auto w-full max-w-xs">
              <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-(--color-text-muted)" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ism yoki PINFL" className="h-8 w-full rounded-(--radius-control) border border-(--color-line) bg-white pr-2 pl-8 text-sm focus:border-brand-600 focus:outline-none" />
            </label>
          </div>
          {isAdmin && fixable.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-t border-(--color-line) bg-(--color-warn-soft) px-5 py-2 text-sm">
              <span className="text-heading">
                Farq: <b>{fixable.length}</b> xodim · belgilangan: <b>{pickedRows.length}</b>
              </span>
              <Button size="sm" variant="ghost" onClick={() => setPicked(pickedRows.length === fixable.length ? new Set() : new Set(fixable.map((r) => r.pinfl)))}>
                {pickedRows.length === fixable.length ? 'Belgini olish' : 'Hammasini belgilash'}
              </Button>
              <Button size="sm" className="ml-auto" disabled={!pickedRows.length} onClick={() => setTarget({ kind: 'fix', pinfls: pickedRows.map((r) => r.pinfl), label: `${pickedRows.length} xodim` })}>
                Belgilanganlarni tarkibdagidek o‘tkazish
              </Button>
            </div>
          )}
          {rows.length === 0 ? (
            <p className="border-t border-(--color-line) px-5 py-6 text-center text-sm text-(--color-text-muted)">Bu filtrda xodim yo‘q</p>
          ) : (
            <div className="max-h-[36rem] overflow-auto border-t border-(--color-line)">
              <Table>
                <THead>
                  <Tr>
                    {isAdmin && <Th className="w-8" />}
                    <Th className="w-10">№</Th>
                    <Th>Xodim</Th>
                    <Th className="w-[22%]">Manbada</Th>
                    <Th className="w-[26%]">Ish haqi tarkibida</Th>
                    <Th align="right" className="w-32">
                      Ish haqi
                    </Th>
                    <Th className="w-44" />
                  </Tr>
                </THead>
                <TBody>
                  {groups
                    .filter((g) => g.rows.length)
                    .map((g) => (
                      <Fragment key={g.key}>
                        <Tr>
                          <Td colSpan={isAdmin ? 7 : 6} className="bg-(--color-surface-sunken) py-1.5 text-xs font-semibold text-heading">
                            {g.title}: {g.rows.length} ta
                          </Td>
                        </Tr>
                        {g.rows.map((r, i) => {
                          const st = r.status === 'UNKNOWN' && r.tarkib?.skipped ? { label: 'hisobga olinmaydi', tone: 'neutral' as const } : STATUS[r.status];
                          const diff = r.status === 'FARQ';
                          return (
                            <Tr key={r.pinfl} className={cn(diff && 'bg-(--color-warn-soft)/50')}>
                              {isAdmin && <Td>{diff && <input type="checkbox" className="size-4 accent-brand-600" checked={picked.has(r.pinfl)} onChange={() => toggle(r.pinfl)} aria-label="Belgilash" />}</Td>}
                              <Td className="text-(--color-text-muted)">{i + 1}</Td>
                              <Td>
                                <span className="block font-medium text-heading">{r.fullName}</span>
                                <span className="money text-[11px] text-(--color-text-muted)">{r.pinfl}</span>
                              </Td>
                              <Td>
                                <span className={cn('block', r.manba.unit === unitCode ? 'text-heading' : 'text-(--color-text-muted)')}>{place(r.manba.unit, r.manba.unitLabel, r.manba.departmentName)}</span>
                              </Td>
                              <Td>
                                {r.tarkib ? (
                                  <>
                                    <span className={cn('block', diff ? 'font-semibold text-(--color-warn)' : 'text-heading')}>{r.tarkib.unit ? place(r.tarkib.unit, r.tarkib.unitLabel, r.tarkib.departmentName) : '—'}</span>
                                    <span className="block text-[11px] text-(--color-text-muted)">
                                      tarkibda: «{r.tarkib.deptName}»{r.tarkib.skipped ? ' · hisobga olinmaydi' : r.tarkib.guessed ? ' · taxminiy moslik' : ''}
                                    </span>
                                  </>
                                ) : (
                                  <span className="text-(--color-text-muted)">—</span>
                                )}
                                {r.fix && <span className="block text-[11px] text-brand-700">shu oy → {place(r.fix.unit, r.fix.unitLabel, r.fix.departmentName)}{r.fix.by ? ` · ${r.fix.by}` : ''}</span>}
                              </Td>
                              <Td align="right" className="money">
                                {r.amountTiyin && r.amountTiyin !== '0' ? formatTiyin(r.amountTiyin) : <span className="text-(--color-text-muted)">—</span>}
                              </Td>
                              <Td>
                                <div className="flex items-center justify-end gap-2">
                                  <Badge tone={st.tone} className="whitespace-nowrap">{st.label}</Badge>
                                  {isAdmin && diff && (
                                    <Button size="sm" variant="ghost" onClick={() => setTarget({ kind: 'fix', pinfls: [r.pinfl], label: r.fullName })}>
                                      O‘tkazish
                                    </Button>
                                  )}
                                  {isAdmin && r.status === 'FIXED' && (
                                    <Button size="sm" variant="ghost" className="text-(--color-text-muted) hover:text-(--color-expense)" onClick={() => setTarget({ kind: 'revert', pinfls: [r.pinfl], label: r.fullName })}>
                                      Qaytarish
                                    </Button>
                                  )}
                                </div>
                              </Td>
                            </Tr>
                          );
                        })}
                      </Fragment>
                    ))}
                </TBody>
              </Table>
            </div>
          )}
        </>
      )}
      <ConfirmDialog
        open={target !== null}
        title={target?.kind === 'revert' ? 'Manbadagi joyiga qaytarish' : 'Tarkibdagidek o‘tkazish'}
        message={
          target?.kind === 'revert'
            ? `${target?.label ?? ''}: ${formatPeriod(period)} uchun joyi manbadagi holatiga qaytadi; ish haqi xarajati ham qayta taqsimlanadi.`
            : `${target?.label ?? ''}: faqat ${formatPeriod(period)} uchun joyi ish haqi tarkibidagi bo‘limga o‘tadi (keyingi oydan — manbadagi joyida). Ish haqi xarajati qayta taqsimlanadi, summa o‘zgarmaydi.`
        }
        confirmLabel={target?.kind === 'revert' ? 'Qaytarish' : 'O‘tkazish'}
        danger={target?.kind === 'revert'}
        loading={busy}
        onConfirm={() => void run()}
        onCancel={() => setTarget(null)}
      />
    </Card>
  );
}
