'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { api, type ApiResponse } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatTiyin } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Moddalar boshqaruvi › Xarajatlar tarkibiy tuzilishi — haqiqiy ishlayotgan tuzilma, birlik bo'yicha (juda sodda):
//  chapda — birliklar (Markaz bo'limlari, hududlar, yo'nalishlar); o'ngda — tanlangan birlikning
//  • DAROMAD tomoni: shu birlikka yozilgan daromad moddalari; Markaz bo'limi uchun — kunlik tushum qatorlari
//    («Quyoshli xonadon», «Keshbek» …) — «shu bo'limniki» belgisi bilan bog'lanadi;
//  • XARAJAT tomoni: moddalar (yozuvlar soni, summa); modda bosilsa — yozuvlari: belgilab boshqa modda / birlikka
//    ko'chirish yoki shu yerning o'zida yangi modda ochib ko'chirish;
//  • «Boshqa xarajatni shu yerga olib kelish» — qidiruv (bank to'lovi maqsadi, kontragent, INN …) → belgilab ko'chirish.
// Yozuvlar bazada shu joyga yoziladi — dashbordlar o'zi yangilanadi. O'zgartirish — faqat administrator.
// ═══════════════════════════════════════════════════════════

interface UnitOpt {
  key: string;
  label: string;
}
interface UnitsResult {
  departments: UnitOpt[];
  regions: UnitOpt[];
  segments: UnitOpt[];
}
interface UnitView {
  unit: { key: string; label: string };
  income: { totalTiyin: string; parts: { code: string; label: string; count: number; totalTiyin: string }[]; cashLines: { id: string; code: string | null; name: string; departmentId: string | null; totalTiyin: string }[] };
  expense: { totalTiyin: string; items: { code: string; label: string; group: string | null; parentCode: string | null; count: number; totalTiyin: string; locked: number }[] };
}
interface FoundRow {
  id: string;
  date: string;
  amountTiyin: string;
  categoryCode: string;
  categoryLabel: string;
  place: string;
  text: string;
  counterparty: string | null;
  locked: string | null;
}
interface Leaf {
  code: string;
  label: string;
}

const csApi = {
  units: () => api.get<ApiResponse<UnitsResult>>('/cost-structure/units'),
  unit: (unit: string, from: string, to: string) => api.get<ApiResponse<UnitView>>('/cost-structure/unit', { params: { unit, from, to } }),
  search: (p: { text?: string; unit?: string; categoryCode?: string; from: string; to: string }) => api.get<ApiResponse<FoundRow[]>>('/cost-structure/search', { params: p }),
  move: (ids: string[], unit: string | null, categoryCode: string | null) => api.post<ApiResponse<{ moved: number; movedTiyin: string; skippedCount: number; skipped: { id: string; reason: string }[] }>>('/cost-structure/move', { ids, unit: unit ?? undefined, categoryCode: categoryCode ?? undefined }),
  leaves: () => api.get<ApiResponse<Leaf[]>>('/categories/leaves'),
  createItem: (label: string, parentCode: string | null) => api.post<ApiResponse<{ code: string; label: string }>>('/categories', { label, parentCode }),
  linkLine: (lineId: string, departmentId: string) => api.patch<ApiResponse<unknown>>('/cashbook/center-income/modes', { departments: { [lineId]: departmentId } }),
};

export function StructureView() {
  const { isAdmin } = useAuth();
  const { range } = usePeriod();
  const units = useAsync(() => csApi.units().then((r) => r.data), []);
  const leaves = useAsync(() => csApi.leaves().then((r) => r.data), []);
  const [unit, setUnit] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const [reload, setReload] = useState(0);
  const view = useAsync(() => (unit ? csApi.unit(unit, range.from, range.to).then((r) => r.data) : Promise.resolve(null)), [unit, range.from, range.to, reload]);

  const allUnits = useMemo(() => (units.data ? [...units.data.departments, ...units.data.regions, ...units.data.segments] : []), [units.data]);
  const unitLabel = (k: string) => allUnits.find((u) => u.key === k)?.label ?? k;

  const done = (message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone });
    if (tone === 'success') setReload((x) => x + 1);
  };

  if (units.loading && !units.data) return <LoadingState />;
  if (units.error) return <ErrorState message={units.error} onRetry={units.reload} />;
  const groups: [string, UnitOpt[]][] = units.data
    ? [
        ["Markaz bo'limlari", units.data.departments],
        ['Hududlar', units.data.regions],
        ["Yo'nalishlar", units.data.segments],
      ]
    : [];
  const term = filter.trim().toLowerCase();

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card className="max-h-[78vh] overflow-auto p-3">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Birlikni qidirish…"
          className="mb-2 h-9 w-full rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-sm focus:border-brand-600 focus:outline-none"
        />
        {groups.map(([title, list]) => {
          const shown = list.filter((u) => !term || u.label.toLowerCase().includes(term));
          if (!shown.length) return null;
          return (
            <div key={title} className="mb-3">
              <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-(--color-text-muted)">{title}</p>
              {shown.map((u) => (
                <button
                  key={u.key}
                  type="button"
                  onClick={() => setUnit(u.key)}
                  className={cn('block w-full truncate rounded-md px-2 py-1.5 text-left text-sm', unit === u.key ? 'bg-brand-600 font-semibold text-white' : 'text-heading hover:bg-brand-50')}
                >
                  {u.label}
                </button>
              ))}
            </div>
          );
        })}
      </Card>

      <div className="min-w-0 space-y-4">
        {!unit ? (
          <Card className="p-6 text-sm text-(--color-text-muted)">Chapdan birlikni tanlang (masalan, Call markaz) — uning daromad va xarajat tomoni shu yerda ochiladi.</Card>
        ) : view.loading && !view.data ? (
          <LoadingState />
        ) : view.error ? (
          <ErrorState message={view.error} onRetry={view.reload} />
        ) : view.data ? (
          <>
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="text-lg font-bold text-heading">{view.data.unit.label}</h2>
              <span className="text-sm text-(--color-text-muted)">
                {formatDate(range.from)} — {formatDate(range.to)} · daromad <b className="text-(--color-income)">{formatTiyin(view.data.income.totalTiyin)}</b> · xarajat <b className="text-(--color-expense)">{formatTiyin(view.data.expense.totalTiyin)}</b>
              </span>
            </div>
            <IncomeSide v={view.data} unit={unit} isAdmin={isAdmin} onDone={done} />
            <ExpenseSide v={view.data} unit={unit} isAdmin={isAdmin} leaves={leaves.data ?? []} units={allUnits} unitLabel={unitLabel} range={range} onDone={done} />
            <BringHere unit={unit} unitName={view.data.unit.label} isAdmin={isAdmin} range={range} onDone={done} />
          </>
        ) : null}
      </div>
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </div>
  );
}

function IncomeSide({ v, unit, isAdmin, onDone }: { v: UnitView; unit: string; isAdmin: boolean; onDone: (m: string, t?: 'success' | 'error') => void }) {
  const depId = unit.startsWith('dep:') ? unit.slice(4) : null;
  const [busy, setBusy] = useState<string | null>(null);
  const toggle = async (lineId: string, on: boolean, name: string) => {
    setBusy(lineId);
    try {
      await csApi.linkLine(lineId, on ? depId! : '');
      onDone(on ? `«${name}» daromadi endi shu bo‘limniki` : `«${name}» shu bo‘limdan olindi (Markaz › Umumiy)`);
    } catch (e) {
      onDone(errorMessage(e, 'Saqlab bo‘lmadi'), 'error');
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-(--color-line) bg-(--color-income-soft)/40 px-4 py-2.5">
        <p className="font-semibold text-heading">Daromad tomoni</p>
        <p className="text-xs text-(--color-text-muted)">Shu birlikka yozilgan daromad{depId ? '; kunlik tushum qatorlarini belgilang — o‘sha pul shu bo‘lim daromadi bo‘ladi' : ''}</p>
      </div>
      <ul className="divide-y divide-(--color-line) text-sm">
        {v.income.parts.map((p) => (
          <li key={p.code} className="flex items-center gap-3 px-4 py-2">
            <span className="min-w-0 flex-1 text-heading">{p.label}</span>
            <span className="text-xs text-(--color-text-muted)">{p.count} ta</span>
            <span className="w-36 text-right font-semibold tabular-nums text-(--color-income)">{formatTiyin(p.totalTiyin)}</span>
          </li>
        ))}
        {!v.income.parts.length && <li className="px-4 py-3 text-(--color-text-muted)">Bu davrda shu birlikka daromad yozilmagan</li>}
      </ul>
      {depId && v.income.cashLines.length > 0 && (
        <div className="border-t border-(--color-line) px-4 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-(--color-text-muted)">Kunlik tushum qatorlari (Markaz) — qaysi biri shu bo‘limniki</p>
          <div className="grid gap-1 sm:grid-cols-2">
            {v.income.cashLines.map((l) => {
              const mine = l.departmentId === depId;
              const other = l.departmentId && !mine;
              return (
                <label key={l.id} className={cn('flex items-center gap-2 rounded-md px-2 py-1 text-sm', mine && 'bg-(--color-income-soft)/50')}>
                  <input type="checkbox" className="size-4 accent-brand-600" checked={mine} disabled={!isAdmin || busy === l.id} onChange={(e) => void toggle(l.id, e.target.checked, l.name)} />
                  <span className="min-w-0 flex-1 truncate text-heading">
                    {l.code ? `${l.code}. ` : ''}
                    {l.name}
                  </span>
                  {other && <span className="text-[11px] text-(--color-warn)">boshqa bo‘limda</span>}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

function ExpenseSide({
  v,
  unit,
  isAdmin,
  leaves,
  units,
  unitLabel,
  range,
  onDone,
}: {
  v: UnitView;
  unit: string;
  isAdmin: boolean;
  leaves: Leaf[];
  units: UnitOpt[];
  unitLabel: (k: string) => string;
  range: { from: string; to: string };
  onDone: (m: string, t?: 'success' | 'error') => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-(--color-line) bg-(--color-expense-soft)/40 px-4 py-2.5">
        <p className="font-semibold text-heading">Xarajat tomoni — moddalar</p>
        <p className="text-xs text-(--color-text-muted)">Moddani bosing — yozuvlari ochiladi: belgilab boshqa modda yoki birlikka ko‘chiring, yoki shu yerda yangi modda oching</p>
      </div>
      <ul className="divide-y divide-(--color-line) text-sm">
        {v.expense.items.map((i) => (
          <li key={i.code}>
            <button type="button" onClick={() => setOpen(open === i.code ? null : i.code)} className={cn('flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-(--color-surface-muted)', open === i.code && 'bg-brand-50')}>
              <span className={cn('inline-block w-3 text-xs text-(--color-text-faint) transition-transform', open === i.code && 'rotate-90')}>▸</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium text-heading">{i.label}</span>
                {i.group && <span className="ml-2 text-xs text-(--color-text-muted)">{i.group}</span>}
                {i.locked > 0 && <span className="ml-2 text-[11px] text-(--color-text-faint)">avtomatik</span>}
              </span>
              <span className="text-xs text-(--color-text-muted)">{i.count} ta</span>
              <span className="w-36 text-right font-semibold tabular-nums text-(--color-expense)">{formatTiyin(i.totalTiyin)}</span>
            </button>
            {open === i.code && <RecordsPanel unit={unit} categoryCode={i.code} parentCode={i.parentCode} isAdmin={isAdmin} leaves={leaves} units={units} unitLabel={unitLabel} range={range} onDone={onDone} />}
          </li>
        ))}
        {!v.expense.items.length && <li className="px-4 py-3 text-(--color-text-muted)">Bu davrda shu birlikka xarajat yozilmagan</li>}
      </ul>
    </Card>
  );
}

/** Yozuvlar ro'yxati (belgilash) va ko'chirish paneli — modda ichida ham, qidiruvda ham */
function RecordsPanel({
  unit,
  categoryCode,
  parentCode,
  isAdmin,
  leaves,
  units,
  unitLabel,
  range,
  onDone,
}: {
  unit: string;
  categoryCode: string;
  parentCode: string | null;
  isAdmin: boolean;
  leaves: Leaf[];
  units: UnitOpt[];
  unitLabel: (k: string) => string;
  range: { from: string; to: string };
  onDone: (m: string, t?: 'success' | 'error') => void;
}) {
  const rows = useAsync(() => csApi.search({ unit, categoryCode, from: range.from, to: range.to }).then((r) => r.data), [unit, categoryCode, range.from, range.to]);
  if (rows.loading && !rows.data) return <div className="px-4 py-3"><LoadingState /></div>;
  if (rows.error) return <div className="px-4 py-3 text-sm text-(--color-expense)">{rows.error}</div>;
  return <MoveTable rows={rows.data ?? []} defaultUnit={unit} defaultCategory={categoryCode} parentCode={parentCode} isAdmin={isAdmin} leaves={leaves} units={units} unitLabel={unitLabel} onDone={onDone} />;
}

function MoveTable({
  rows,
  defaultUnit,
  defaultCategory,
  parentCode,
  isAdmin,
  leaves,
  units,
  unitLabel,
  onDone,
}: {
  rows: FoundRow[];
  defaultUnit: string;
  defaultCategory: string | null;
  parentCode: string | null;
  isAdmin: boolean;
  leaves: Leaf[];
  units: UnitOpt[];
  unitLabel: (k: string) => string;
  onDone: (m: string, t?: 'success' | 'error') => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [toUnit, setToUnit] = useState(defaultUnit);
  const [toCat, setToCat] = useState(defaultCategory ?? '');
  const [newItem, setNewItem] = useState('');
  const [busy, setBusy] = useState(false);
  const movable = rows.filter((r) => !r.locked);
  const sel = movable.filter((r) => picked.has(r.id));
  const selTotal = sel.reduce((s, r) => s + BigInt(r.amountTiyin), 0n);

  const doMove = async () => {
    if (!sel.length) return;
    setBusy(true);
    try {
      let cat: string | null = toCat || null;
      if (toCat === '__new') {
        const label = newItem.replace(/\s+/g, ' ').trim();
        if (!label) throw new Error('Yangi modda nomini yozing');
        cat = (await csApi.createItem(label, parentCode)).data.code;
      }
      const r = (await csApi.move(sel.map((x) => x.id), toUnit !== defaultUnit || !defaultCategory ? toUnit : null, cat && cat !== defaultCategory ? cat : null)).data;
      onDone(`${r.moved} ta yozuv (${formatTiyin(r.movedTiyin)} so‘m) → ${unitLabel(toUnit)}${r.skippedCount ? ` · ${r.skippedCount} tasi o‘tkazilmadi: ${r.skipped[0]?.reason ?? ''}` : ''}`);
      setPicked(new Set());
    } catch (e) {
      onDone(errorMessage(e, 'Ko‘chirib bo‘lmadi'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-(--color-line) bg-(--color-surface-muted)/50">
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={cn('border-b border-(--color-line) align-top', r.locked && 'opacity-60')}>
                <td className="w-8 px-3 py-1.5">
                  {isAdmin && !r.locked && (
                    <input
                      type="checkbox"
                      className="size-4 accent-brand-600"
                      checked={picked.has(r.id)}
                      onChange={() =>
                        setPicked((s) => {
                          const n = new Set(s);
                          if (n.has(r.id)) n.delete(r.id);
                          else n.add(r.id);
                          return n;
                        })
                      }
                    />
                  )}
                </td>
                <td className="w-24 whitespace-nowrap px-2 py-1.5 text-xs text-(--color-text-muted)">{formatDate(r.date)}</td>
                <td className="px-2 py-1.5">
                  <span className="block text-heading">{r.counterparty || r.categoryLabel}</span>
                  <span className="block text-[11px] text-(--color-text-muted)">
                    {r.place} · {r.categoryLabel}
                    {r.text ? ` · ${r.text}` : ''}
                  </span>
                  {r.locked && <span className="block text-[11px] text-(--color-warn)">{r.locked}</span>}
                </td>
                <td className="w-36 whitespace-nowrap px-3 py-1.5 text-right font-semibold tabular-nums">{formatTiyin(r.amountTiyin)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-sm text-(--color-text-muted)">
                  Yozuv topilmadi
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {isAdmin && movable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-(--color-line) px-3 py-2 text-sm">
          <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setPicked(picked.size === movable.length ? new Set() : new Set(movable.map((r) => r.id)))}>
            {picked.size === movable.length ? 'Belgini olish' : 'Hammasini belgilash'}
          </button>
          <span className="text-(--color-text-muted)">Qayerga:</span>
          <select value={toUnit} onChange={(e) => setToUnit(e.target.value)} className="h-9 max-w-56 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-sm">
            {units.map((u) => (
              <option key={u.key} value={u.key}>
                {u.label}
              </option>
            ))}
          </select>
          <select value={toCat} onChange={(e) => setToCat(e.target.value)} className="h-9 max-w-64 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-sm">
            {defaultCategory ? <option value={defaultCategory}>— modda o‘zgarmasin —</option> : <option value="">— modda o‘zgarmasin —</option>}
            <option value="__new">+ Yangi modda ochish…</option>
            {leaves.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          {toCat === '__new' && (
            <input value={newItem} onChange={(e) => setNewItem(e.target.value)} maxLength={100} placeholder="Yangi modda nomi, masalan: Soliqlar" className="h-9 w-56 rounded-(--radius-control) border border-brand-400 bg-white px-2 text-sm focus:outline-none" />
          )}
          <span className="ml-auto text-(--color-text-muted)">
            Belgilangan: <b className="text-heading">{sel.length}</b> · <span className="font-semibold tabular-nums text-heading">{formatTiyin(selTotal.toString())}</span>
          </span>
          <Button size="sm" onClick={() => void doMove()} loading={busy} disabled={!sel.length}>
            Ko&apos;chirish
          </Button>
        </div>
      )}
    </div>
  );
}

/** Boshqa joydagi xarajatni (masalan, bank to'lovi) qidirib, shu birlikka olib kelish */
function BringHere({ unit, unitName, isAdmin, range, onDone }: { unit: string; unitName: string; isAdmin: boolean; range: { from: string; to: string }; onDone: (m: string, t?: 'success' | 'error') => void }) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const found = useAsync(() => (query ? csApi.search({ text: query, from: range.from, to: range.to }).then((r) => r.data) : Promise.resolve(null)), [query, range.from, range.to]);
  if (!isAdmin) return null;
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-(--color-line) px-4 py-2.5">
        <p className="font-semibold text-heading">Boshqa xarajatni shu yerga olib kelish</p>
        <p className="text-xs text-(--color-text-muted)">Bank to‘lovi maqsadi, kontragent, INN yoki hujjat raqamini yozing → toping → belgilab «{unitName}»ga ko‘chiring</p>
      </div>
      <form
        className="flex flex-wrap items-center gap-2 px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(text.trim());
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Masalan: internet, Uzcard, 301234567 …" className="h-9 w-80 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-sm focus:border-brand-600 focus:outline-none" />
        <Button size="sm" type="submit" disabled={!text.trim()}>
          Qidirish
        </Button>
        {found.loading && <span className="text-xs text-(--color-text-muted)">qidirilmoqda…</span>}
      </form>
      {query && found.data && <MoveTable rows={found.data} defaultUnit={unit} defaultCategory={null} parentCode={null} isAdmin={isAdmin} leaves={[]} units={[{ key: unit, label: unitName }]} unitLabel={() => unitName} onDone={onDone} />}
      {found.error && <p className="px-4 pb-3 text-sm text-(--color-expense)">{found.error}</p>}
    </Card>
  );
}
