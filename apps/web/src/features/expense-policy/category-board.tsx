'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconChevronRight, IconSearch } from '@/components/ui/icons';
import { formatDate, formatSum, tiyinToSum } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CategoryAmount, PolicyCategory, PolicyData } from './api';

// ═══════════════════════════════════════════════════════════
// Xarajatlar siyosati › Moddalar: har bir xarajat moddasi kim hisobidan — Markaz yoki Hudud.
//  • Ro'yxat dasturdagi xarajat moddalaridan (Sozlamalar › Moddalar) o'zi shakllanadi — yangi modda qo'shilsa, shu yerda paydo bo'ladi;
//    Markazga o'tkazilgan ota moddaga keyin qo'shilgan ichki modda ham avtomatik Markaz hisobida bo'ladi.
//  • Tepada ikki tugma: belgilangan moddalarni bir bosishda Markazga yoki Hududga o'tkazish; har qatorda ham shu ikki tugma.
//  • «Markaz» — modda qaysi hududda yozilgan bo'lsa ham Markaz xarajati; «Hudud» — qayerda yozilgan bo'lsa, o'sha yerda qoladi.
//  • Har qatorda davrdagi summa: hududlarda va Markazda yozilgani — o'tkazish nimani o'zgartirishi darhol ko'rinadi.
// ═══════════════════════════════════════════════════════════

type State = 'center' | 'region' | 'mixed';
type View = 'all' | 'center' | 'region' | 'used';

interface Amt {
  region: number;
  center: number;
  none: number;
  count: number;
}
const ZERO: Amt = { region: 0, center: 0, none: 0, count: 0 };
const addAmt = (a: Amt, b: Amt): Amt => ({ region: a.region + b.region, center: a.center + b.center, none: a.none + b.none, count: a.count + b.count });

function som(tiyin: number): string {
  return tiyin ? formatSum(tiyinToSum(Math.round(tiyin))) : '—';
}

const CENTER_CLS = 'bg-brand-600 text-white';
const REGION_CLS = 'bg-emerald-600 text-white';

/** Bir qatordagi «Markaz | Hudud» tugmalari */
function Toggle({ state, disabled, onChange, small }: { state: State; disabled?: boolean; onChange: (toCenter: boolean) => void; small?: boolean }) {
  const btn = (on: boolean, label: string, cls: string, toCenter: boolean) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(toCenter)}
      aria-pressed={on}
      className={cn(
        'rounded-[calc(var(--radius-control)-2px)] font-semibold transition-colors disabled:cursor-not-allowed',
        small ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs',
        on ? cls : 'text-(--color-text-muted) hover:bg-white hover:text-heading',
      )}
    >
      {label}
    </button>
  );
  return (
    <div className={cn('inline-flex gap-0.5 rounded-(--radius-control) bg-(--color-surface-sunken) p-0.5', state === 'mixed' && 'ring-1 ring-amber-300')} title={state === 'mixed' ? "Aralash: ichki moddalarning bir qismi Markazda, bir qismi hududda" : undefined}>
      {btn(state === 'center', 'Markaz', CENTER_CLS, true)}
      {btn(state === 'region', 'Hudud', REGION_CLS, false)}
    </div>
  );
}

export function CategoryBoard({
  data,
  amounts,
  range,
  isAdmin,
  saving,
  onSave,
}: {
  data: PolicyData;
  amounts: CategoryAmount[] | null;
  range: { from: string; to: string };
  isAdmin: boolean;
  saving: boolean;
  onSave: (include: string[], exclude: string[]) => void;
}) {
  const cats = data.categories;
  const byCode = useMemo(() => new Map(cats.map((c) => [c.code, c])), [cats]);
  const children = useMemo(() => {
    const m = new Map<string | null, PolicyCategory[]>();
    for (const c of cats) {
      const k = c.parentCode && byCode.has(c.parentCode) ? c.parentCode : null;
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return m;
  }, [cats, byCode]);

  /** Saqlangan holat: Markaz hisobidagi moddalar */
  const initial = useMemo(() => new Set(cats.filter((c) => c.selected || c.inherited || c.locked).map((c) => c.code)), [cats]);
  const [eff, setEff] = useState<Set<string>>(initial);
  useEffect(() => setEff(initial), [initial]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [view, setView] = useState<View>('all');

  // Modda va uning barcha ichki moddalari
  const subtree = useMemo(() => {
    const memo = new Map<string, string[]>();
    const walk = (code: string, depth: number): string[] => {
      const hit = memo.get(code);
      if (hit) return hit;
      const out = [code, ...(depth > 20 ? [] : (children.get(code) ?? []).flatMap((c) => walk(c.code, depth + 1)))];
      memo.set(code, out);
      return out;
    };
    return (code: string) => walk(code, 0);
  }, [children]);

  // Summalar (ota moddada — ichkilari bilan)
  const own = useMemo(() => {
    const m = new Map<string, Amt>();
    for (const a of amounts ?? []) m.set(a.code, { region: Number(a.regionTiyin), center: Number(a.centerTiyin), none: Number(a.noneTiyin), count: a.count });
    return m;
  }, [amounts]);
  const total = (code: string): Amt => subtree(code).reduce((acc, c) => addAmt(acc, own.get(c) ?? ZERO), ZERO);

  const stateOf = (code: string): State => {
    const list = subtree(code);
    const n = list.filter((c) => eff.has(c)).length;
    return n === list.length ? 'center' : n === 0 ? 'region' : 'mixed';
  };

  const setNodes = (codes: string[], toCenter: boolean) => {
    const next = new Set(eff);
    for (const code of codes)
      for (const c of subtree(code)) {
        if (byCode.get(c)?.locked) continue;
        if (toCenter) next.add(c);
        else next.delete(c);
      }
    setEff(next);
  };

  /** Saqlash uchun: eng yaqin belgi qaror qiladi — faqat ota-onasidan farq qiladigan moddalar yoziladi */
  const compress = (): { include: string[]; exclude: string[] } => {
    const include: string[] = [];
    const exclude: string[] = [];
    const walk = (list: PolicyCategory[], inherited: boolean) => {
      for (const c of list) {
        const on = eff.has(c.code);
        if (!c.locked && on !== inherited) (on ? include : exclude).push(c.code);
        walk(children.get(c.code) ?? [], c.locked ? inherited : on);
      }
    };
    walk(children.get(null) ?? [], false);
    return { include, exclude };
  };

  const changed = cats.filter((c) => eff.has(c.code) !== initial.has(c.code));

  // Umumiy ta'sir: hududlarda yozilgan xarajatdan qancha Markazga o'tadi
  let toCenter = 0;
  let stays = 0;
  let toCenterSaved = 0;
  for (const [code, a] of own) {
    if (eff.has(code)) toCenter += a.region;
    else stays += a.region;
    if (initial.has(code)) toCenterSaved += a.region;
  }
  const delta = toCenter - toCenterSaved;

  const term = q.trim().toLowerCase();
  const matches = (c: PolicyCategory): boolean => {
    const st = stateOf(c.code);
    const okView = view === 'all' || (view === 'center' ? st !== 'region' : view === 'region' ? st !== 'center' : total(c.code).count > 0);
    const okTerm = !term || c.label.toLowerCase().includes(term) || c.code.toLowerCase().includes(term);
    return (okView && okTerm) || (children.get(c.code) ?? []).some(matches);
  };

  const togglePick = (code: string) => {
    const next = new Set(picked);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setPicked(next);
  };

  const rows: ReactNode[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const c of children.get(parent) ?? []) {
      if (!matches(c)) continue;
      const kids = (children.get(c.code) ?? []).length > 0;
      const isOpen = Boolean(term) || !closed.has(c.code);
      const st = stateOf(c.code);
      const a = total(c.code);
      const lockedHere = c.locked || subtree(c.code).every((x) => byCode.get(x)?.locked);
      const excludedUnderCenter = !eff.has(c.code) && c.parentCode && eff.has(c.parentCode);
      rows.push(
        <tr key={c.code} className={cn('border-t border-(--color-line)', picked.has(c.code) && 'bg-brand-50/60', !c.isActive && 'opacity-60', depth === 0 && !picked.has(c.code) && 'bg-white')}>
          <td className="w-10 px-3 py-2">
            <input type="checkbox" className="size-4 accent-brand-600" checked={picked.has(c.code)} disabled={!isAdmin || lockedHere} onChange={() => togglePick(c.code)} aria-label={`${c.label} — tanlash`} />
          </td>
          <td className="py-2 pr-2" style={{ paddingLeft: 4 + depth * 22 }}>
            <div className="flex min-w-0 items-center gap-1.5">
              {kids ? (
                <button
                  type="button"
                  onClick={() => setClosed((s) => { const n = new Set(s); if (n.has(c.code)) n.delete(c.code); else n.add(c.code); return n; })}
                  className="flex size-6 shrink-0 items-center justify-center rounded text-(--color-text-muted) hover:bg-brand-50"
                  aria-expanded={isOpen}
                >
                  <IconChevronRight className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')} />
                </button>
              ) : (
                <span className="size-6 shrink-0" />
              )}
              <span className={cn('min-w-0 truncate', kids ? 'font-semibold text-heading' : 'text-heading')} title={c.label}>
                {c.label}
              </span>
              {kids && <span className="shrink-0 text-[11px] text-(--color-text-faint)">{subtree(c.code).length - 1}</span>}
              {!c.isActive && <span className="shrink-0 rounded bg-(--color-surface-sunken) px-1.5 text-[10px] text-(--color-text-muted)">nofaol</span>}
              {eff.has(c.code) !== initial.has(c.code) && <span className="shrink-0 rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800">o&apos;zgardi</span>}
            </div>
          </td>
          <td className="money px-2 py-2 text-right whitespace-nowrap">{som(a.region)}</td>
          <td className="money px-2 py-2 text-right whitespace-nowrap text-(--color-text-muted)">{som(a.center + a.none)}</td>
          <td className="px-2 py-2 text-center">
            {lockedHere ? (
              <span className="inline-block rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800" title={c.lockedReason}>
                Markaz · qulflangan
              </span>
            ) : (
              <Toggle state={st} disabled={!isAdmin} small={depth > 0} onChange={(v) => setNodes([c.code], v)} />
            )}
          </td>
          <td className="px-3 py-2 text-xs">
            {lockedHere ? (
              <span className="text-(--color-text-muted)">{c.lockedReason ?? 'Har doim Markaz hisobidan'}</span>
            ) : st === 'mixed' ? (
              <span className="text-amber-800">Aralash — ichki moddalarga qarang</span>
            ) : st === 'center' ? (
              a.region ? (
                <span className="text-brand-700">
                  Hududlardagi <b className="money">{som(a.region)}</b> → Markaz xarajati
                </span>
              ) : (
                <span className="text-brand-700">Markaz hisobidan</span>
              )
            ) : (
              <span className="text-emerald-700">{excludedUnderCenter ? 'Hududda qoladi (ota modda Markazda bo‘lsa ham)' : 'Yozilgan joyida qoladi'}</span>
            )}
          </td>
        </tr>,
      );
      if (kids && isOpen) walk(c.code, depth + 1);
    }
  };
  walk(null, 0);

  const pickedList = [...picked];
  const counts = { center: cats.filter((c) => eff.has(c.code)).length, region: cats.filter((c) => !eff.has(c.code)).length };

  return (
    <Card className="overflow-hidden">
      <div className="space-y-3 border-b border-(--color-line) px-5 py-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-heading">Xarajat moddalari — kim hisobidan</p>
            <p className="mt-0.5 text-xs text-(--color-text-muted)">
              Ro&apos;yxat dasturdagi barcha xarajat moddalaridan o&apos;zi shakllanadi. <b className="text-brand-700">Markaz</b> — qaysi hududda yozilgan bo&apos;lsa ham Markaz xarajati;{' '}
              <b className="text-emerald-700">Hudud</b> — yozilgan joyida qoladi. Summalar: {formatDate(range.from)} — {formatDate(range.to)}.
            </p>
          </div>
        </div>

        {/* Tepadagi ikki tugma: belgilanganlarni o'tkazish */}
        <div className="flex flex-wrap items-center gap-2 rounded-(--radius-card) border border-(--color-line) bg-(--color-surface-muted) px-3 py-2.5">
          <span className="text-sm text-(--color-text-muted)">
            {picked.size ? (
              <>
                <b className="text-heading">{picked.size} ta</b> modda belgilandi
              </>
            ) : (
              'Moddalarni belgilang va o‘tkazing:'
            )}
          </span>
          <Button
            size="sm"
            className="ml-auto"
            disabled={!isAdmin || !picked.size}
            onClick={() => {
              setNodes(pickedList, true);
              setPicked(new Set());
            }}
          >
            → Markazga o&apos;tkazish
          </Button>
          <button
            type="button"
            disabled={!isAdmin || !picked.size}
            onClick={() => {
              setNodes(pickedList, false);
              setPicked(new Set());
            }}
            className="h-8 rounded-(--radius-control) bg-emerald-600 px-3 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            → Hududga o&apos;tkazish
          </button>
          {picked.size > 0 && (
            <button type="button" onClick={() => setPicked(new Set())} className="text-xs font-semibold text-(--color-text-muted) hover:text-heading">
              Bekor qilish
            </button>
          )}
        </div>

        {/* Ta'sir */}
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-brand-200 bg-brand-50/50 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">Hududlardan Markazga o&apos;tadi</p>
            <p className="money text-lg font-bold text-heading">{som(toCenter)}</p>
            {delta !== 0 && (
              <p className={cn('money text-xs font-semibold', delta > 0 ? 'text-brand-700' : 'text-emerald-700')}>
                saqlanganga nisbatan {delta > 0 ? '+' : '−'}
                {som(Math.abs(delta))}
              </p>
            )}
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Hududlarda qoladi</p>
            <p className="money text-lg font-bold text-heading">{som(stays)}</p>
          </div>
          <div className="rounded-lg border border-(--color-line) bg-white px-3 py-2 text-xs text-(--color-text-muted)">
            <p>
              Markaz hisobida: <b className="text-heading">{counts.center}</b> ta modda
            </p>
            <p>
              Hududda: <b className="text-heading">{counts.region}</b> ta modda
            </p>
            {!amounts && <p className="text-(--color-text-faint)">Summalar yuklanmoqda…</p>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex gap-0.5 rounded-(--radius-control) bg-(--color-surface-sunken) p-0.5 text-xs font-medium">
            {(
              [
                ['all', 'Hammasi'],
                ['center', 'Markaz'],
                ['region', 'Hudud'],
                ['used', 'Davrda xarajati bor'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setView(k)} className={view === k ? 'rounded-[calc(var(--radius-control)-2px)] bg-white px-3 py-1.5 text-heading shadow-sm' : 'px-3 py-1.5 text-(--color-text-muted) hover:text-heading'}>
                {l}
              </button>
            ))}
          </div>
          <label className="relative ml-auto">
            <IconSearch className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-(--color-text-faint)" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Modda qidirish" className="h-8 w-52 rounded-(--radius-control) border border-(--color-line) pr-2 pl-7 text-sm" />
          </label>
          <button
            type="button"
            onClick={() => setClosed(closed.size ? new Set() : new Set(cats.filter((c) => (children.get(c.code) ?? []).length).map((c) => c.code)))}
            className="h-8 rounded-(--radius-control) border border-(--color-line) px-2.5 text-xs font-medium text-heading hover:bg-brand-50"
          >
            {closed.size ? 'Hammasini ochish' : 'Hammasini yopish'}
          </button>
        </div>
      </div>

      <div className="max-h-[640px] overflow-auto">
        <table className="w-full min-w-[920px] text-sm">
          <thead className="sticky top-0 z-10 bg-(--color-surface-muted) text-[11px] uppercase tracking-wide text-(--color-text-muted)">
            <tr>
              <th className="w-10 px-3 py-2 text-left">
                <input
                  type="checkbox"
                  className="size-4 accent-brand-600"
                  disabled={!isAdmin}
                  aria-label="Ko'rinayotganlarning hammasini tanlash"
                  checked={picked.size > 0 && cats.filter((c) => matches(c) && !c.locked).every((c) => picked.has(c.code))}
                  onChange={(e) => setPicked(e.target.checked ? new Set(cats.filter((c) => matches(c) && !c.locked).map((c) => c.code)) : new Set())}
                />
              </th>
              <th className="px-2 py-2 text-left font-semibold">Modda</th>
              <th className="w-36 px-2 py-2 text-right font-semibold" title="Hududlarda yozilgan xarajat (davrda)">
                Hududlarda yozilgan
              </th>
              <th className="w-36 px-2 py-2 text-right font-semibold" title="Markazda yozilgan xarajat (davrda)">
                Markazda yozilgan
              </th>
              <th className="w-44 px-2 py-2 text-center font-semibold">Kim hisobidan</th>
              <th className="px-3 py-2 text-left font-semibold">Natija</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-(--color-text-muted)">
                  Topilmadi
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-(--color-line) bg-(--color-surface-muted) px-5 py-3">
          <span className="text-xs text-(--color-text-muted)">
            {changed.length ? (
              <>
                <b className="text-amber-800">{changed.length} ta modda o&apos;zgardi</b> — saqlansa, Solishtirma, Markaz xarajati va hisobotlar shu bo&apos;yicha qayta hisoblanadi
              </>
            ) : (
              "O'zgarish yo'q"
            )}
          </span>
          <Button variant="ghost" size="sm" className="ml-auto" disabled={!changed.length || saving} onClick={() => setEff(initial)}>
            Bekor qilish
          </Button>
          <Button
            loading={saving}
            disabled={!changed.length}
            onClick={() => {
              const { include, exclude } = compress();
              onSave(include, exclude);
            }}
          >
            Saqlash
          </Button>
        </div>
      )}
    </Card>
  );
}