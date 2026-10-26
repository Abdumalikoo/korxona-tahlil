'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { compositionApi, readCompositionDepts, type PlaceOption, type UnitPlaceRow, type UnitPlaces, type UnitPlaceStatus } from '@/features/salary-composition/api';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime, formatPeriod, formatTiyin } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useRef, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Bo'lim sahifasi (Tax free …) › «Saqlangan ish haqi» jadvali ichida: har xodim qatori ikkiga bo'linadi —
// «Manbada» (miyadagi asl joyi) va «Ish haqi tarkibida» (saqlangan tarkibdagi bo'lim).
// Eski tarkib yuklamalarida bo'lim ustuni saqlanmagan — o'sha fayldan faqat bo'limlar o'qiladi (tarkib qayta saqlanmaydi).
// ═══════════════════════════════════════════════════════════

export type PlaceFilter = 'ALL' | 'FARQ' | 'FIXED' | 'MOS' | 'OTHER';

type Toast = (t: { message: string; tone?: 'success' | 'error' }) => void;

export const PLACE_STATUS: Record<UnitPlaceStatus, { label: string; tone: 'income' | 'warn' | 'brand' | 'neutral' }> = {
  MOS: { label: 'mos', tone: 'income' },
  FARQ: { label: 'farq', tone: 'warn' },
  FIXED: { label: 'o‘tkazilgan', tone: 'brand' },
  NO_TARKIB: { label: 'tarkibda yo‘q', tone: 'neutral' },
  UNKNOWN: { label: 'bo‘lim tanlanmagan', tone: 'neutral' },
};

export const placeText = (unit: string | null, unitLabel: string | null, dept: string | null) => (!unit ? '—' : unit === 'CENTER' ? `Markaz › ${dept ?? 'bo‘limsiz'}` : (unitLabel ?? unit));

export function placeFilterMatch(r: UnitPlaceRow | undefined, f: PlaceFilter): boolean {
  if (f === 'ALL') return true;
  const s = r?.status ?? 'NO_TARKIB';
  if (f === 'OTHER') return s === 'NO_TARKIB' || s === 'UNKNOWN';
  return s === f;
}

function statusOf(r: UnitPlaceRow) {
  return r.status === 'UNKNOWN' && r.tarkib?.skipped ? { label: 'hisobga olinmaydi', tone: 'neutral' as const } : PLACE_STATUS[r.status];
}

/** «Manbada» katakchasi */
export function ManbaCell({ row, unitCode }: { row: UnitPlaceRow | undefined; unitCode: string }) {
  if (!row) return <span className="text-xs text-(--color-text-muted)">—</span>;
  return <span className={cn('text-xs', row.manba.unit === unitCode ? 'text-heading' : 'text-(--color-text-muted)')}>{placeText(row.manba.unit, row.manba.unitLabel, row.manba.departmentName)}</span>;
}

/** «Ish haqi tarkibida» katakchasi */
export function TarkibCell({ row }: { row: UnitPlaceRow | undefined }) {
  if (!row || !row.tarkib) return <span className="text-xs text-(--color-text-muted)">tarkibda yo‘q</span>;
  const diff = row.status === 'FARQ';
  const st = statusOf(row);
  return (
    <span className="block text-xs">
      <span className={cn('mr-1.5', diff ? 'font-semibold text-(--color-warn)' : 'text-heading')}>{row.tarkib.unit ? placeText(row.tarkib.unit, row.tarkib.unitLabel, row.tarkib.departmentName) : `«${row.tarkib.deptName}»`}</span>
      <Badge tone={st.tone} className="whitespace-nowrap">
        {st.label}
      </Badge>
      {row.tarkib.unit && (
        <span className="block text-[10.5px] text-(--color-text-muted)">
          {row.tarkib.source === 'UNIT' ? `${row.tarkib.deptName}da` : `umumiy tarkibda: «${row.tarkib.deptName}»`}
          {row.tarkib.guessed ? ' · taxminiy' : ''}
          {row.tarkibTiyin ? ` · ${formatTiyin(row.tarkibTiyin)}` : ''}
        </span>
      )}
      {row.fix && <span className="block text-[10.5px] text-brand-700">shu oy → {row.fix.placeLabel ?? placeText(row.fix.unit, row.fix.unitLabel, row.fix.departmentName)}{row.fix.manual ? ' (qo‘lda)' : ''}</span>}
    </span>
  );
}

function OptionSelect({ value, options, onChange }: { value: string; options: PlaceOption[]; onChange: (v: string) => void }) {
  const groups = [...new Set(options.map((o) => o.unitLabel))].sort((a, b) => (a === 'Markaz' ? -1 : b === 'Markaz' ? 1 : a.localeCompare(b)));
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-7 max-w-[18rem] rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-xs focus:border-brand-600 focus:outline-none">
      <option value="">Bo‘limni tanlang…</option>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {options
            .filter((o) => o.unitLabel === g)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
        </optgroup>
      ))}
      <option value="SKIP">— hisobga olinmasin</option>
    </select>
  );
}

/** Jadval ustidagi satr: tarkib bilan holat (filtr), eski fayldan bo'limlarni o'qish, tanilmagan nomlar */
export function PlacesBar({ period, places, isAdmin, filter, onFilter, onChanged, onToast }: { period: string; places: UnitPlaces | null; isAdmin: boolean; filter: PlaceFilter; onFilter: (f: PlaceFilter) => void; onChanged: () => void; onToast: Toast }) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  if (!places) return null;

  async function read(file: File) {
    setReading(true);
    try {
      const r = await readCompositionDepts(period, file);
      onToast({
        message: `Bo‘limlar bog‘landi: ${r.matched} xodim («${r.column.label}» ustuni, ${r.departments} ta bo‘lim)${r.notInTarkib ? ` · ${r.notInTarkib} tasi saqlangan tarkibda yo‘q` : ''}${r.unknown.length ? ` · tanilmagan: ${r.unknown.length} ta nom` : ''}. Tarkib va summalar o‘zgarmadi.`,
        tone: 'success',
      });
      onChanged();
    } catch (err) {
      onToast({ message: errorMessage(err, 'Bo‘limlarni o‘qib bo‘lmadi'), tone: 'error' });
    } finally {
      setReading(false);
      if (input.current) input.current.value = '';
    }
  }

  async function saveNames() {
    const map = Object.fromEntries(Object.entries(names).filter(([, v]) => v));
    if (!Object.keys(map).length) return;
    setSaving(true);
    try {
      await compositionApi.learnPlaceNames(map);
      onToast({ message: `${Object.keys(map).length} ta nom bo‘limga bog‘landi (keyingi oylarda ham o‘zi taniladi)`, tone: 'success' });
      setNames({});
      onChanged();
    } catch (err) {
      onToast({ message: errorMessage(err, 'Saqlab bo‘lmadi'), tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  const fileBtn = isAdmin && (
    <>
      <input ref={input} type="file" accept=".xlsx,.xltx" className="hidden" onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
      <Button size="sm" variant={places.hasTarkib ? 'ghost' : 'secondary'} loading={reading} onClick={() => input.current?.click()} title="Oldin yuklangan ish haqi tarkibi fayli — faqat bo‘lim ustuni o‘qiladi, tarkib qayta saqlanmaydi">
        Bo‘limlarni fayldan o‘qish
      </Button>
    </>
  );

  if (!places.hasTarkib) {
    return (
      <div className="flex flex-wrap items-center gap-3 border-b border-(--color-line) bg-(--color-surface-sunken) px-5 py-2.5 text-xs text-(--color-text-muted)">
        <span className="min-w-0 flex-1">
          <b className="text-heading">Manbada | Ish haqi tarkibida</b> —{' '}
          {places.batch
            ? `${formatPeriod(period)} ish haqi tarkibida${places.batch.fileName ? ` («${places.batch.fileName}», ${formatDateTime(places.batch.createdAt)})` : ''} xodimlarning bo‘limi yo‘q: bu tarkib fayllar arxividan oldin yuklangan, fayli saqlanmagan. O‘sha faylni bir marta tanlang — faqat bo‘lim ustuni o‘qiladi (tarkib va summalar o‘zgarmaydi), fayl shu tarkib bilan arxivga olinadi va boshqa so‘ralmaydi.`
            : `${formatPeriod(period)} uchun ish haqi tarkibi yuklanmagan (Xarajatlar › Ish haqi tarkibi) — yuklangach, har xodimning tarkibdagi bo‘limi shu jadvalda chiqadi.`}
        </span>
        {places.batch && fileBtn}
      </div>
    );
  }

  const c = places.counts;
  const chips: { key: PlaceFilter; label: string; n: number }[] = [
    { key: 'ALL', label: 'Hammasi', n: c.total },
    { key: 'FARQ', label: 'Farq', n: c.farq },
    { key: 'FIXED', label: 'O‘tkazilgan', n: c.fixed },
    { key: 'MOS', label: 'Mos', n: c.mos },
    { key: 'OTHER', label: 'Tarkibda yo‘q', n: c.noTarkib + c.unknown },
  ];
  return (
    <div className="space-y-2 border-b border-(--color-line) px-5 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="mr-1 text-(--color-text-muted)">Ish haqi tarkibi bilan:</span>
        {chips.map((ch) => (
          <button
            key={ch.key}
            type="button"
            onClick={() => onFilter(ch.key)}
            className={cn('rounded-full border px-2.5 py-0.5', filter === ch.key ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-(--color-line) bg-white text-(--color-text-muted) hover:border-(--color-line-strong)', ch.key === 'FARQ' && ch.n > 0 && filter !== ch.key && 'border-(--color-warn) text-(--color-warn)')}
          >
            {ch.label} <span className="money font-semibold">{ch.n}</span>
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2 text-[11px] text-(--color-text-faint)">
          {places.batch?.fileName ? `tarkib: «${places.batch.fileName}»` : ''}{places.tarkibAt ? ` · ${formatDateTime(places.tarkibAt)}` : ''}
        </span>
      </div>
      {isAdmin && places.unmapped.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-(--radius-control) border border-(--color-line) bg-(--color-warn-soft) px-3 py-2 text-xs">
          <span className="text-heading">Tarkibdagi tanilmagan nomlar:</span>
          {places.unmapped.map((u) => (
            <span key={u.name} className="inline-flex items-center gap-1.5">
              «{u.name}» <span className="text-(--color-text-muted)">{u.count}</span>
              <OptionSelect value={names[u.name] ?? ''} options={places.options} onChange={(v) => setNames((x) => ({ ...x, [u.name]: v }))} />
            </span>
          ))}
          <Button size="sm" className="ml-auto" loading={saving} disabled={!Object.values(names).some(Boolean)} onClick={() => void saveNames()}>
            Saqlash
          </Button>
        </div>
      )}
    </div>
  );
}

/** Shu oy shu bo'limdan boshqa joyga o'tkazilganlar — o'sha joyda turibdi; qaytarish mumkin */
export function MovedOutRows({ period, unitLabel, rows, isAdmin, colSpan, onChanged, onToast }: { period: string; unitLabel: string; rows: UnitPlaceRow[]; isAdmin: boolean; colSpan: number; onChanged: () => void; onToast: Toast }) {
  const [target, setTarget] = useState<{ pinfls: string[]; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!rows.length) return null;

  async function run() {
    if (!target) return;
    setBusy(true);
    try {
      const r = (await compositionApi.revertPlaces(period, target.pinfls)).data;
      onToast({ message: `${r.reverted} xodim yana ${unitLabel}da${r.redistributed ? ' · ish haqi qayta taqsimlandi' : ''}`, tone: 'success' });
      onChanged();
    } catch (err) {
      onToast({ message: errorMessage(err, 'Qaytarib bo‘lmadi'), tone: 'error' });
    } finally {
      setBusy(false);
      setTarget(null);
    }
  }

  return (
    <>
      <tr className="border-t border-(--color-line) bg-brand-50/50">
        <td colSpan={colSpan} className="px-3 py-1.5 text-xs">
          <span className="font-semibold text-heading">
            {formatPeriod(period)}da boshqa joyga o‘tkazilganlar: {rows.length} ta
          </span>
          <span className="text-(--color-text-muted)"> · ish haqi o‘sha joyda hisoblangan (bu jadvalda va jamida yo‘q)</span>
        </td>
      </tr>
      {rows.map((r, i) => (
        <tr key={r.pinfl} className="border-t border-(--color-line) text-(--color-text-muted)">
          <td className="px-3 py-1.5" />
          <td className="px-1 py-1.5 text-right text-xs text-(--color-text-faint)">{i + 1}</td>
          <td className="px-2 py-1.5">
            <p>{r.fullName}</p>
            <p className="money text-xs">{r.pinfl}</p>
          </td>
          <td colSpan={colSpan - 4} className="px-2 py-1.5 text-xs">
            → <b className="text-brand-700">{r.fix?.placeLabel ?? placeText(r.fix?.unit ?? null, r.fix?.unitLabel ?? null, r.fix?.departmentName ?? null)}</b>
            {r.fix?.manual ? ' · qo‘lda' : ' · ish haqi tarkibi bo‘yicha'}
            {r.fix?.by ? ` · ${r.fix.by}` : ''}
            {r.soliqTiyin && r.soliqTiyin !== '0' ? ` · ${formatTiyin(r.soliqTiyin)} so‘m` : ''}
          </td>
          <td className="px-2 py-1.5 text-right">
            {isAdmin && (
              <button type="button" onClick={() => setTarget({ pinfls: [r.pinfl], label: r.fullName })} className="rounded px-1.5 py-0.5 text-xs text-(--color-text-muted) hover:bg-(--color-expense-soft) hover:text-(--color-expense)">
                Qaytarish
              </button>
            )}
          </td>
        </tr>
      ))}
      <ConfirmDialog
        open={target !== null}
        title={`${unitLabel}ga qaytarish`}
        message={`${target?.label ?? ''}: ${formatPeriod(period)} uchun yana ${unitLabel}da; ish haqi xarajati qayta taqsimlanadi.`}
        confirmLabel="Qaytarish"
        danger
        loading={busy}
        onConfirm={() => void run()}
        onCancel={() => setTarget(null)}
      />
    </>
  );
}

/** Jadval ostida: tarkibda shu bo'limda, lekin bu ro'yxatda yo'q (manbada boshqa joyda) — shu oyga o'tkazish */
export function TarkibHereRows({ period, unitCode, unitLabel, rows, isAdmin, colSpan, onChanged, onToast }: { period: string; unitCode: string; unitLabel: string; rows: UnitPlaceRow[]; isAdmin: boolean; colSpan: number; onChanged: () => void; onToast: Toast }) {
  const [target, setTarget] = useState<{ kind: 'fix' | 'revert'; pinfls: string[]; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!rows.length) return null;
  const fixable = rows.filter((r) => r.status === 'FARQ' && r.tarkib?.source === 'GENERAL');

  async function run() {
    if (!target) return;
    setBusy(true);
    try {
      if (target.kind === 'fix') {
        const r = (await compositionApi.fixPlaces(period, target.pinfls)).data;
        onToast({ message: `${r.fixed} xodim ${formatPeriod(period)} uchun ${unitLabel}ga o‘tkazildi${r.redistributed ? ' · ish haqi qayta taqsimlandi' : ''}${r.warnings.length ? ` · ${r.warnings.join('; ')}` : ''}`, tone: 'success' });
      } else {
        const r = (await compositionApi.revertPlaces(period, target.pinfls)).data;
        onToast({ message: `${r.reverted} xodim manbadagi joyiga qaytarildi${r.redistributed ? ' · ish haqi qayta taqsimlandi' : ''}`, tone: 'success' });
      }
      onChanged();
    } catch (err) {
      onToast({ message: errorMessage(err, 'Saqlashda xatolik'), tone: 'error' });
    } finally {
      setBusy(false);
      setTarget(null);
    }
  }

  return (
    <>
      <tr className="border-t border-(--color-line) bg-(--color-warn-soft)/60">
        <td colSpan={colSpan} className="px-3 py-1.5 text-xs">
          <span className="font-semibold text-heading">
            Ish haqi tarkibida — {unitLabel}, manbada boshqa joyda: {rows.length} ta
          </span>
          <span className="text-(--color-text-muted)"> · ish haqi umumiy soliq hisobotida manbadagi joyida hisoblangan</span>
          {isAdmin && fixable.length > 1 && (
            <button type="button" onClick={() => setTarget({ kind: 'fix', pinfls: fixable.map((r) => r.pinfl), label: `${fixable.length} xodim` })} className="ml-2 rounded px-1.5 py-0.5 font-medium text-brand-700 hover:bg-brand-50">
              Hammasini {unitLabel}ga o‘tkazish
            </button>
          )}
        </td>
      </tr>
      {rows.map((r, i) => (
        <tr key={r.pinfl} className="border-t border-(--color-line) bg-(--color-warn-soft)/20">
          <td className="px-3 py-1.5" />
          <td className="px-1 py-1.5 text-right text-xs text-(--color-text-faint)">{i + 1}</td>
          <td className="px-2 py-1.5">
            <p className="text-heading">{r.fullName}</p>
            <p className="money text-xs text-(--color-text-muted)">{r.pinfl}</p>
          </td>
          <td className="px-2 py-1.5">
            <ManbaCell row={r} unitCode={unitCode} />
          </td>
          <td className="px-2 py-1.5">
            <TarkibCell row={r} />
          </td>
          <td className="px-2 py-1.5 text-right">
            {r.soliqTiyin && r.soliqTiyin !== '0' ? (
              <>
                <span className="money block">{formatTiyin(r.soliqTiyin)}</span>
                <span className="block text-[10.5px] text-(--color-text-muted)">umumiy soliq hisobotida</span>
              </>
            ) : (
              <span className="text-xs text-(--color-text-muted)">—</span>
            )}
          </td>
          <td className="px-2 py-1.5 text-right">
            {isAdmin && r.status === 'FARQ' && r.tarkib?.source === 'GENERAL' && (
              <button type="button" onClick={() => setTarget({ kind: 'fix', pinfls: [r.pinfl], label: r.fullName })} className="rounded px-1.5 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50" title={`Shu oy uchun ${unitLabel}ga (tarkibdagidek)`}>
                O‘tkazish
              </button>
            )}
            {isAdmin && r.status === 'FIXED' && (
              <button type="button" onClick={() => setTarget({ kind: 'revert', pinfls: [r.pinfl], label: r.fullName })} className="rounded px-1.5 py-0.5 text-xs text-(--color-text-muted) hover:bg-(--color-expense-soft) hover:text-(--color-expense)">
                Qaytarish
              </button>
            )}
          </td>
        </tr>
      ))}
      <ConfirmDialog
        open={target !== null}
        title={target?.kind === 'revert' ? 'Manbadagi joyiga qaytarish' : `${unitLabel}ga o‘tkazish`}
        message={
          target?.kind === 'revert'
            ? `${target?.label ?? ''}: ${formatPeriod(period)} uchun joyi manbadagi holatiga qaytadi; ish haqi xarajati ham qayta taqsimlanadi.`
            : `${target?.label ?? ''}: faqat ${formatPeriod(period)} uchun ${unitLabel}da (ish haqi tarkibidagidek), keyingi oydan — manbadagi joyida. Umumiy vedomostdagi ish haqi xarajati qayta taqsimlanadi, summa o‘zgarmaydi.`
        }
        confirmLabel={target?.kind === 'revert' ? 'Qaytarish' : 'O‘tkazish'}
        danger={target?.kind === 'revert'}
        loading={busy}
        onConfirm={() => void run()}
        onCancel={() => setTarget(null)}
      />
    </>
  );
}
