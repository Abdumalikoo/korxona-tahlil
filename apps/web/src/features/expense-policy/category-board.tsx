'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconChevronRight, IconSearch } from '@/components/ui/icons';
import { formatDate, formatSum, tiyinToSum } from '@/lib/format';
import { SEGMENTS, segmentLabel } from '@/lib/segments';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CategoryAmount, PolicyCategory, PolicyData } from './api';

// ═══════════════════════════════════════════════════════════
// Xarajatlar siyosati › Moddalar: har bir xarajat moddasi KIM HISOBIDAN.
//  • «Yozilgan joyida» — qayerda yozilgan bo'lsa (hudud, Markaz, yo'nalish), o'sha yerda qoladi;
//  • «Markaz» — qayerda yozilgan bo'lsa ham Markaz xarajati;
//  • Yo'nalish (Tax free, Marksheyder, Fermer xo'jaligi, Buxgalteriya xizmatlari) — qayerda yozilgan bo'lsa ham o'sha yo'nalish xarajati.
//  • Ota moddaga berilgan tanlov ichki moddalarga ham o'tadi; ichki moddada alohida tanlash mumkin (eng yaqini qaror qiladi).
//  • Ro'yxat dasturdagi xarajat moddalaridan o'zi shakllanadi; har qatorda davrdagi summa — o'tkazish nimani o'zgartirishi darhol ko'rinadi.
// ═══════════════════════════════════════════════════════════

/** 'region' — yozilgan joyida, 'center' — Markaz, yoki yo'nalish kodi */
type Payer = string;
type State = Payer | 'mixed';
type View = 'all' | 'region' | 'center' | 'segment' | 'used';

const REGION = 'region';
const CENTER = 'center';

interface Amt {
  region: number;
  other: number;
  count: number;
}
const ZERO: Amt = { region: 0, other: 0, count: 0 };
const addAmt = (a: Amt, b: Amt): Amt => ({ region: a.region + b.region, other: a.other + b.other, count: a.count + b.count });

function som(tiyin: number): string {
  return tiyin ? formatSum(tiyinToSum(Math.round(tiyin))) : '—';
}

/** To'lovchi tanlovlari (tartib bilan) */
const PAYERS: { code: Payer; label: string; short: string }[] = [
  { code: REGION, label: 'Yozilgan joyida', short: 'Joyida' },
  { code: CENTER, label: 'Markaz hisobidan', short: 'Markaz' },
  ...SEGMENTS.map((s) => ({ code: s.code as Payer, label: `${s.label} hisobidan`, short: s.label })),
];

const payerName = (p: Payer) => (p === REGION ? 'Yozilgan joyida' : p === CENTER ? 'Markaz' : segmentLabel(p));

/** Rang: joyida — yashil, Markaz — ko'k, yo'nalishlar — binafsha */
function payerTone(p: State): string {
  if (p === 'mixed') return 'border-amber-300 bg-amber-50 text-amber-900';
  if (p === REGION) return 'border-emerald-300 bg-emerald-50 text-emerald-800';
  if (p === CENTER) return 'border-brand-300 bg-brand-50 text-brand-800';
  return 'border-violet-300 bg-violet-50 text-violet-800';
}

/** Qatordagi to'lovchi tanlovi */
function PayerSelect({ state, disabled, onChange, label }: { state: State; disabled?: boolean; onChange: (p: Payer) => void; label: string }) {
  return (
    <select
      value={state === 'mixed' ? '' : state}
      disabled={disabled}
      aria-label={`${label} — kim hisobidan`}
      onChange={(e) => e.target.value && onChange(e.target.value)}
      className={cn('h-8 w-full rounded-(--radius-control) border px-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-70', payerTone(state))}
    >
      {state === 'mixed' && (
        <option value="" disabled>
          Aralash
        </option>
      )}
      {PAYERS.map((p) => (
        <option key={p.code} value={p.code}>
          {p.label}
        </option>
      ))}
    </select>
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
  onSave: (include: string[], exclude: string[], payers: Record<string, string>) => void;
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

  /** Saqlangan holat: har modda kim hisobidan (server hisoblagan) */
  const initial = useMemo(() => {
    const m = new Map<string, Payer>();
    for (const c of cats) m.set(c.code, c.locked ? CENTER : (c.payer ?? (c.selected || c.inherited ? CENTER : REGION)));
    return m;
  }, [cats]);
  const [eff, setEff] = useState<Map<string, Payer>>(initial);
  useEffect(() => setEff(initial), [initial]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<Payer>(CENTER);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [view, setView] = useState<View>('all');

  const payerOf = (code: string): Payer => eff.get(code) ?? REGION;

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

  // Summalar (ota moddada — ichkilari bilan): hududlarda yozilgan va boshqa joylarda (Markaz, yo'nalishlar, ko'rsatilmagan)
  const own = useMemo(() => {
    const m = new Map<string, Amt>();
    for (const a of amounts ?? []) m.set(a.code, { region: Number(a.regionTiyin), other: Number(a.centerTiyin) + Number(a.noneTiyin) + Number(a.segmentTiyin ?? 0), count: a.count });
    return m;
  }, [amounts]);
  const total = (code: string): Amt => subtree(code).reduce((acc, c) => addAmt(acc, own.get(c) ?? ZERO), ZERO);

  const stateOf = (code: string): State => {
    const set = new Set(subtree(code).map(payerOf));
    return set.size === 1 ? [...set][0]! : 'mixed';
  };

  const setNodes = (codes: string[], payer: Payer) => {
    const next = new Map(eff);
    for (const code of codes)
      for (const c of subtree(code)) {
        if (byCode.get(c)?.locked) continue;
        next.set(c, payer);
      }
    setEff(next);
  };

  /**
   * Saqlash uchun siqish: eng yaqin belgi qaror qiladi — faqat ota-onasidan farq qiladigan moddalar yoziladi.
   * include — boshqa hisobga o'tadiganlar (Markaz yoki yo'nalish), exclude — ota modda o'tgan bo'lsa ham joyida qoladiganlar,
   * payers — include ichidagi yo'nalish hisobidagilar.
   */
  const compress = (): { include: string[]; exclude: string[]; payers: Record<string, string> } => {
    const include: string[] = [];
    const exclude: string[] = [];
    const payers: Record<string, string> = {};
    const walk = (list: PolicyCategory[], inherited: Payer) => {
      for (const c of list) {
        const p = payerOf(c.code);
        if (!c.locked && p !== inherited) {
          if (p === REGION) exclude.push(c.code);
          else {
            include.push(c.code);
            if (p !== CENTER) payers[c.code] = p;
          }
        }
        walk(children.get(c.code) ?? [], c.locked ? inherited : p);
      }
    };
    walk(children.get(null) ?? [], REGION);
    return { include, exclude, payers };
  };

  const changed = cats.filter((c) => payerOf(c.code) !== initial.get(c.code));

  // Ta'sir: hududlarda yozilgan xarajatdan qanchasi boshqa hisobga o'tadi (kimga)
  let moved = 0;
  let stays = 0;
  let movedSaved = 0;
  const byPayer = new Map<Payer, number>();
  for (const [code, a] of own) {
    const p = payerOf(code);
    if (p !== REGION) {
      moved += a.region;
      byPayer.set(p, (byPayer.get(p) ?? 0) + a.region);
    } else stays += a.region;
    if ((initial.get(code) ?? REGION) !== REGION) movedSaved += a.region;
  }
  const delta = moved - movedSaved;

  const term = q.trim().toLowerCase();
  const matches = (c: PolicyCategory): boolean => {
    const st = stateOf(c.code);
    const okView =
      view === 'all' ||
      (view === 'used'
        ? total(c.code).count > 0
        : view === 'region'
          ? st === REGION || st === 'mixed'
          : view === 'center'
            ? st === CENTER || st === 'mixed'
            : st === 'mixed' || (st !== REGION && st !== CENTER));
    const okTerm = !term || c.label.toLowerCase().includes(term) || c.code.toLowerCase().includes(term);
    return (okView && okTerm) || (children.get(c.code) ?? []).some(matches);
  };

  const togglePick = (code: string) => {
    const next = new Set(picked);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setPicked(next);
  };

  const resultText = (st: State, a: Amt, excludedUnderParent: boolean): ReactNode => {
    if (st === 'mixed') return <span className="text-amber-800">Aralash — ichki moddalarga qarang</span>;
    if (st === REGION) return <span className="text-emerald-700">{excludedUnderParent ? 'Yozilgan joyida qoladi (ota modda boshqa hisobda bo‘lsa ham)' : 'Yozilgan joyida qoladi'}</span>;
    const who = st === CENTER ? 'Markaz' : segmentLabel(st);
    return a.region ? (
      <span className={st === CENTER ? 'text-brand-700' : 'text-violet-700'}>
        Hududlardagi <b className="money">{som(a.region)}</b> → {who} xarajati
      </span>
    ) : (
      <span className={st === CENTER ? 'text-brand-700' : 'text-violet-700'}>{who} hisobidan</span>
    );
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
      const excludedUnderParent = payerOf(c.code) === REGION && Boolean(c.parentCode) && payerOf(c.parentCode!) !== REGION;
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
                  onClick={() =>
                    setClosed((s) => {
                      const n = new Set(s);
                      if (n.has(c.code)) n.delete(c.code);
                      else n.add(c.code);
                      return n;
                    })
                  }
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
              {payerOf(c.code) !== initial.get(c.code) && <span className="shrink-0 rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800">o&apos;zgardi</span>}
            </div>
          </td>
          <td className="money px-2 py-2 text-right whitespace-nowrap">{som(a.region)}</td>
          <td className="money px-2 py-2 text-right whitespace-nowrap text-(--color-text-muted)">{som(a.other)}</td>
          <td className="w-52 px-2 py-2">
            {lockedHere ? (
              <span className="inline-block rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800" title={c.lockedReason}>
                Markaz · qulflangan
              </span>
            ) : (
              <PayerSelect state={st} disabled={!isAdmin} label={c.label} onChange={(p) => setNodes([c.code], p)} />
            )}
          </td>
          <td className="px-3 py-2 text-xs">{lockedHere ? <span className="text-(--color-text-muted)">{c.lockedReason ?? 'Har doim Markaz hisobidan'}</span> : resultText(st, a, excludedUnderParent)}</td>
        </tr>,
      );
      if (kids && isOpen) walk(c.code, depth + 1);
    }
  };
  walk(null, 0);

  const pickedList = [...picked];
  const counts = new Map<Payer, number>();
  for (const c of cats) counts.set(payerOf(c.code), (counts.get(payerOf(c.code)) ?? 0) + 1);

  return (
    <Card className="overflow-hidden">
      <div className="space-y-3 border-b border-(--color-line) px-5 py-4">
        <div className="min-w-0">
          <p className="text-base font-bold text-heading">Xarajat moddalari — kim hisobidan</p>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            Ro&apos;yxat dasturdagi barcha xarajat moddalaridan o&apos;zi shakllanadi. <b className="text-emerald-700">Yozilgan joyida</b> — qayerda yozilgan bo&apos;lsa, o&apos;sha yerda qoladi;{' '}
            <b className="text-brand-700">Markaz</b> yoki <b className="text-violet-700">yo&apos;nalish</b> (Tax free, Marksheyder, Fermer xo&apos;jaligi, Buxgalteriya xizmatlari) — qayerda yozilgan bo&apos;lsa ham shu hisobga o&apos;tadi.
            Summalar: {formatDate(range.from)} — {formatDate(range.to)}.
          </p>
        </div>

        {/* Belgilanganlarni bir bosishda o'tkazish */}
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
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              disabled={!isAdmin}
              aria-label="Kim hisobiga o'tkazish"
              className={cn('h-8 rounded-(--radius-control) border px-2 text-sm font-semibold', payerTone(bulk))}
            >
              {PAYERS.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.label}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={!isAdmin || !picked.size}
              onClick={() => {
                setNodes(pickedList, bulk);
                setPicked(new Set());
              }}
            >
              → O&apos;tkazish
            </Button>
            {picked.size > 0 && (
              <button type="button" onClick={() => setPicked(new Set())} className="text-xs font-semibold text-(--color-text-muted) hover:text-heading">
                Bekor qilish
              </button>
            )}
          </div>
        </div>

        {/* Ta'sir */}
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-brand-200 bg-brand-50/50 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">Hududlardan boshqa hisobga o&apos;tadi</p>
            <p className="money text-lg font-bold text-heading">{som(moved)}</p>
            {delta !== 0 && (
              <p className={cn('money text-xs font-semibold', delta > 0 ? 'text-brand-700' : 'text-emerald-700')}>
                saqlanganga nisbatan {delta > 0 ? '+' : '−'}
                {som(Math.abs(delta))}
              </p>
            )}
            {[...byPayer.entries()].filter(([, v]) => v).length > 0 && (
              <p className="mt-0.5 text-[11px] text-(--color-text-muted)">
                {[...byPayer.entries()]
                  .filter(([, v]) => v)
                  .map(([p, v]) => `${payerName(p)}: ${som(v)}`)
                  .join(' · ')}
              </p>
            )}
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Hududlarda qoladi</p>
            <p className="money text-lg font-bold text-heading">{som(stays)}</p>
          </div>
          <div className="rounded-lg border border-(--color-line) bg-white px-3 py-2 text-xs text-(--color-text-muted)">
            {PAYERS.filter((p) => counts.get(p.code)).map((p) => (
              <p key={p.code}>
                {payerName(p.code)}: <b className="text-heading">{counts.get(p.code)}</b> ta modda
              </p>
            ))}
            {!amounts && <p className="text-(--color-text-faint)">Summalar yuklanmoqda…</p>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap gap-0.5 rounded-(--radius-control) bg-(--color-surface-sunken) p-0.5 text-xs font-medium">
            {(
              [
                ['all', 'Hammasi'],
                ['region', 'Yozilgan joyida'],
                ['center', 'Markaz'],
                ['segment', "Yo'nalishlar"],
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
        <table className="w-full min-w-[980px] text-sm">
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
              <th className="w-36 px-2 py-2 text-right font-semibold" title="Markazda, yo'nalishlarda yoki joyi ko'rsatilmagan holda yozilgan (davrda)">
                Boshqa joylarda
              </th>
              <th className="w-52 px-2 py-2 text-left font-semibold">Kim hisobidan</th>
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
                <b className="text-amber-800">{changed.length} ta modda o&apos;zgardi</b> — saqlansa, Solishtirma, Markaz va yo&apos;nalishlar xarajati hamda hisobotlar shu bo&apos;yicha qayta hisoblanadi
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
              const { include, exclude, payers } = compress();
              onSave(include, exclude, payers);
            }}
          >
            Saqlash
          </Button>
        </div>
      )}
    </Card>
  );
}