'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconArrowRight, IconSearch, IconSpinner } from '@/components/ui/icons';
import { ErrorState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { MonthRangeCard, useMonthRange } from '@/features/units/month-range';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatTiyin } from '@/lib/format';
import { ENTRY_UNITS, type EntryUnit } from '@/lib/segments';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { unitPolicyApi, type UnitPolicyCategory } from './api';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › <bo'lim> › Xarajatlar siyosati — shu bo'limda yozilgan xarajat moddasi qaysi bo'lim hisobida.
//  • Har modda (yoki guruh — ichkilari bilan) uchun: «Umumiy siyosat bo'yicha», «Shu bo'limda qoladi»,
//    yoki «Markaz / Tax free / Marksheyder … hisobiga».
//  • Yozuvlar joyida qoladi — Solishtirma, hisobotlar va Markaz xarajatida tanlangan bo'lim hisobida ko'rinadi.
//  • O'zgarishlar oldindan ko'rinadi (jami summalar darhol qayta hisoblanadi) — «Saqlash» bilan kuchga kiradi.
// ═══════════════════════════════════════════════════════════

type ToastState = { message: string; tone?: 'success' | 'error' } | null;

const unitName = (code: string) => ENTRY_UNITS.find((u) => u.code === code)?.label ?? code;
const big = (s: string) => BigInt(s || '0');
const norm = (s: string) => s.toLowerCase().replace(/[«»"'`ʻʼ‘’“”]/g, '').replace(/\s+/g, ' ').trim();

const ORIGIN: Record<UnitPolicyCategory['effective']['origin'], string> = {
  unit: "Bo'lim qoidasi",
  parent: 'Guruh qoidasi',
  global: 'Umumiy siyosat',
  none: 'Yozilgan joyida',
};

export function UnitPolicyView({ unit }: { unit: EntryUnit }) {
  const { isAdmin } = useAuth();
  const range = useMonthRange();
  const { from, to, error: rangeError, text: rangeText } = range;
  const res = useAsync(() => (rangeError ? Promise.resolve(null) : unitPolicyApi.view(unit.code, from, to)), [unit.code, from, to, rangeError]);
  const data = res.data?.data ?? null;

  const saved = useMemo(() => Object.fromEntries((data?.categories ?? []).filter((c) => c.rule).map((c) => [c.code, c.rule!])) as Record<string, string>, [data]);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const rules = draft ?? saved;
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState('');
  const [search, setSearch] = useState('');
  const [onlyRules, setOnlyRules] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    setDraft(null);
    setChecked(new Set());
  }, [unit.code]);

  const cats = data?.categories ?? [];
  const parent = useMemo(() => new Map(cats.map((c) => [c.code, c.parentCode])), [cats]);
  const children = useMemo(() => {
    const m = new Map<string | null, UnitPolicyCategory[]>();
    for (const c of cats) m.set(c.parentCode, [...(m.get(c.parentCode) ?? []), c]);
    return m;
  }, [cats]);
  const stayLabel = unit.code === 'REGION' ? 'Hududda qoladi' : "Shu bo'limda qoladi";

  /** Qoralama bo'yicha amaldagi: eng yaqin qoida (o'zi, so'ng guruhlari), bo'lmasa — umumiy siyosat */
  /** Guruhlaridan meros qoida (bo'lmasa — undefined) */
  function inherited(code: string): string | undefined {
    let p = parent.get(code) ?? null;
    for (let d = 0; p && d < 20; d += 1) {
      if (rules[p]) return rules[p];
      p = parent.get(p) ?? null;
    }
    return undefined;
  }
  function effective(c: UnitPolicyCategory): { target: string; origin: UnitPolicyCategory['effective']['origin'] } {
    if (rules[c.code]) return { target: rules[c.code]!, origin: 'unit' };
    const fromGroup = inherited(c.code);
    if (fromGroup) return { target: fromGroup, origin: 'parent' };
    return { target: c.globalTarget, origin: c.globalTarget !== unit.code ? 'global' : 'none' };
  }
  const dest = (t: string) => (t === unit.code ? stayLabel.toLowerCase() : `→ ${unitName(t)}`);

  const dirty = draft !== null && JSON.stringify(Object.entries(draft).sort()) !== JSON.stringify(Object.entries(saved).sort());

  // Jami — qoralama bo'yicha darhol
  const preview = useMemo(() => {
    let written = 0n;
    let out = 0n;
    const outBy = new Map<string, bigint>();
    for (const c of cats) {
      const t = big(c.totalTiyin);
      written += t;
      const e = effective(c);
      if (e.target !== unit.code && t > 0n) {
        out += t;
        outBy.set(e.target, (outBy.get(e.target) ?? 0n) + t);
      }
    }
    const incoming = big(data?.totals.incomingTiyin ?? '0');
    return { written, out, stays: written - out, incoming, result: written - out + incoming, outBy: [...outBy.entries()].sort((a, b) => (b[1] > a[1] ? 1 : -1)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cats, rules, data, unit.code]);

  function setRule(code: string, target: string) {
    setDraft((d) => {
      const next = { ...(d ?? saved) };
      if (target) next[code] = target;
      else delete next[code];
      return next;
    });
  }

  function applyBulk() {
    if (!checked.size) return;
    setDraft((d) => {
      const next = { ...(d ?? saved) };
      for (const code of checked) {
        if (bulk) next[code] = bulk;
        else delete next[code];
      }
      return next;
    });
    setToast({ message: `${checked.size} ta moddaga qo'llandi — «Saqlash» bosing` });
    setChecked(new Set());
  }

  async function handleSave() {
    setSaving(true);
    try {
      const r = await unitPolicyApi.save(unit.code, rules);
      setDraft(null);
      res.reload();
      setToast({ message: `Saqlandi: ${r.data.changed} ta o'zgarish — hisobotlarda darhol kuchga kirdi` });
    } catch (err) {
      setToast({ message: errorMessage(err, "Saqlab bo'lmadi"), tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  // Ko'rinadigan qatorlar (daraxt tartibida); qidiruv — mos modda va uning guruhlari
  const q = norm(search);
  const match = (c: UnitPolicyCategory): boolean =>
    (!q || norm(c.label).includes(q) || norm(c.code).includes(q)) && (!onlyRules || Boolean(rules[c.code]) || effective(c).target !== unit.code);
  const visible = new Set<string>();
  for (const c of cats) {
    if (!match(c)) continue;
    visible.add(c.code);
    let p = c.parentCode;
    for (let d = 0; p && d < 20; d += 1) {
      visible.add(p);
      p = parent.get(p) ?? null;
    }
  }
  const ordered: { c: UnitPolicyCategory; depth: number }[] = [];
  const walk = (p: string | null, depth: number) => {
    for (const c of children.get(p) ?? []) {
      if (visible.has(c.code)) ordered.push({ c, depth });
      walk(c.code, depth + 1);
    }
  };
  walk(null, 0);

  const targets = data?.targets ?? [];
  const sel = 'h-9 w-full rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-sm text-heading disabled:bg-(--color-surface-sunken) disabled:text-(--color-text-muted)';

  return (
    <div className="space-y-4">
      <MonthRangeCard range={range} />

      <Card className="border-l-4 border-l-brand-500 p-4">
        <p className="text-sm font-semibold text-heading">«{unit.label}» bo&apos;limi xarajatlari kim hisobida</p>
        <p className="mt-1 text-sm text-(--color-text-muted)">
          Shu bo&apos;limda yozilgan xarajat moddasini boshqa bo&apos;lim hisobiga o&apos;tkazing (masalan, «Internet» — Markaz hisobiga). Guruhga berilgan qoida ichidagi
          moddalarga ham o&apos;tadi. Yozuvlar joyida qoladi — Solishtirma, hisobotlar va Markaz xarajatida tanlangan bo&apos;lim hisobida ko&apos;rinadi; qoida olib tashlansa,
          hammasi avvalgidek. Bo&apos;lim qoidasi{' '}
          <Link href="/xarajatlar/siyosat" className="font-semibold text-brand-700 hover:underline">
            umumiy siyosat
          </Link>
          dan ustun.
        </p>
      </Card>

      {res.error ? (
        <ErrorState message={res.error} onRetry={res.reload} />
      ) : !data ? (
        <Card className="flex items-center justify-center gap-2 p-10 text-sm text-(--color-text-muted)">
          <IconSpinner className="size-4" /> Yuklanmoqda
        </Card>
      ) : (
        <>
          {/* Xulosa */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: `Yozilgan · ${rangeText}`, value: preview.written, tone: 'text-heading' },
              { label: "Boshqa bo'limlar hisobiga", value: preview.out, tone: 'text-(--color-expense)', sign: '−' },
              { label: "Boshqa bo'limlardan kelgan", value: preview.incoming, tone: 'text-(--color-income)', sign: '+' },
              { label: "Bo'lim hisobidagi xarajat", value: preview.result, tone: 'text-brand-700', strong: true },
            ].map((k) => (
              <Card key={k.label} className={cn('p-4', k.strong && 'ring-2 ring-brand-200')}>
                <p className="text-xs font-medium text-(--color-text-muted)">{k.label}</p>
                <p className={cn('mt-1 text-xl font-bold tabular-nums', k.tone)}>
                  {k.sign && k.value > 0n ? `${k.sign} ` : ''}
                  {formatTiyin(k.value.toString(), { currency: true })}
                </p>
              </Card>
            ))}
          </div>
          {preview.outBy.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-(--color-text-muted)">O&apos;tadi:</span>
              {preview.outBy.map(([code, t]) => (
                <span key={code} className="inline-flex items-center gap-1.5 rounded-full border border-(--color-line) bg-white px-3 py-1">
                  <IconArrowRight className="size-3.5 text-brand-600" />
                  <b className="text-heading">{unitName(code)}</b>
                  <span className="tabular-nums text-(--color-text-muted)">{formatTiyin(t.toString())}</span>
                </span>
              ))}
              {dirty && <Badge tone="warn">saqlanmagan o&apos;zgarish bilan</Badge>}
            </div>
          )}

          {/* Qoidalar jadvali */}
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-(--color-line) px-4 py-3">
              <p className="text-sm font-semibold text-heading">Moddalar</p>
              <Badge tone="brand">{Object.keys(rules).length} ta qoida</Badge>
              {res.loading && <IconSpinner className="size-4 text-brand-600" />}
              <label className="ml-auto flex items-center gap-2 text-sm text-(--color-text-muted)">
                <input type="checkbox" checked={onlyRules} onChange={(e) => setOnlyRules(e.target.checked)} />
                Faqat o&apos;tadiganlar
              </label>
              <label className="relative block w-full max-w-xs">
                <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-(--color-text-faint)" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Modda qidirish…" className="h-9 w-full rounded-(--radius-control) border border-(--color-line-strong) bg-white pl-8 pr-2 text-sm" />
              </label>
            </div>

            {isAdmin && checked.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b border-(--color-line) bg-brand-50 px-4 py-2.5 text-sm">
                <b className="text-heading">{checked.size} ta belgilandi</b>
                <span className="text-(--color-text-muted)">→</span>
                <select value={bulk} onChange={(e) => setBulk(e.target.value)} className={cn(sel, 'w-64')}>
                  <option value="">Umumiy siyosat bo&apos;yicha (qoidasiz)</option>
                  <option value={unit.code}>{stayLabel}</option>
                  {targets.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.label} hisobiga
                    </option>
                  ))}
                </select>
                <Button size="sm" onClick={applyBulk}>
                  Qo&apos;llash
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setChecked(new Set())}>
                  Bekor
                </Button>
              </div>
            )}

            {!cats.length ? (
              <p className="px-4 py-10 text-center text-sm text-(--color-text-muted)">
                Bu bo&apos;limda hali modda yo&apos;q: xarajat yozilgach yoki bo&apos;lim moddalari qo&apos;shilgach shu yerda chiqadi.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-(--color-surface-sunken) text-left text-xs font-semibold text-(--color-text-muted)">
                      <th className="w-10 px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label="Hammasini belgilash"
                          disabled={!isAdmin}
                          checked={ordered.length > 0 && ordered.every((o) => checked.has(o.c.code))}
                          onChange={(e) => setChecked(e.target.checked ? new Set(ordered.map((o) => o.c.code)) : new Set())}
                        />
                      </th>
                      <th className="px-3 py-2">Modda</th>
                      <th className="px-3 py-2 text-right whitespace-nowrap">Yozilgan ({rangeText})</th>
                      <th className="px-3 py-2">Kim hisobida</th>
                      <th className="w-72 px-3 py-2">Qoida</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordered.map(({ c, depth }) => {
                      const e = effective(c);
                      const moved = e.target !== unit.code;
                      const changed = draft !== null && (draft[c.code] ?? '') !== (saved[c.code] ?? '');
                      return (
                        <tr key={c.code} className={cn('border-t border-(--color-line)', changed ? 'bg-amber-50/70' : c.group ? 'bg-(--color-surface-sunken)/40' : 'hover:bg-brand-50/30')}>
                          <td className="px-3 py-2">
                            <input type="checkbox" aria-label="Belgilash" disabled={!isAdmin} checked={checked.has(c.code)} onChange={() => setChecked((s) => {
                              const n = new Set(s);
                              if (n.has(c.code)) n.delete(c.code);
                              else n.add(c.code);
                              return n;
                            })} />
                          </td>
                          <td className="px-3 py-2" style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}>
                            <span className={cn('text-heading', c.group && 'font-semibold')}>{c.label}</span>
                            {c.group && <span className="ml-1.5 text-xs text-(--color-text-faint)">guruh</span>}
                            {!c.listed && !c.group && <span className="ml-1.5 text-xs text-(--color-text-faint)" title="Bo'lim moddalari ro'yxatida yo'q, lekin shu bo'limda yozilgan">ro&apos;yxatda yo&apos;q</span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {big(c.totalTiyin) > 0n ? (
                              <>
                                {formatTiyin(c.totalTiyin)} <span className="text-xs text-(--color-text-faint)">· {c.count}</span>
                              </>
                            ) : (
                              <span className="text-(--color-text-faint)">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge tone={moved ? 'brand' : 'neutral'}>{moved ? `→ ${unitName(e.target)}` : unit.code === 'REGION' ? 'Hududda' : "Shu bo'limda"}</Badge>
                              <span className="text-xs text-(--color-text-faint)">{ORIGIN[e.origin]}</span>
                            </div>
                          </td>
                          <td className="px-3 py-1.5">
                            <select value={rules[c.code] ?? ''} disabled={!isAdmin} onChange={(ev) => setRule(c.code, ev.target.value)} className={cn(sel, rules[c.code] && 'border-brand-400 font-medium')}>
                              <option value="">
                                {inherited(c.code) ? `Guruh bo‘yicha (${dest(inherited(c.code)!)})` : `Umumiy siyosat bo‘yicha${c.globalTarget !== unit.code ? ` (→ ${unitName(c.globalTarget)})` : ''}`}
                              </option>
                              <option value={unit.code}>{stayLabel}</option>
                              {targets.map((t) => (
                                <option key={t.code} value={t.code}>
                                  {t.label} hisobiga
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                    {!ordered.length && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-sm text-(--color-text-muted)">
                          Topilmadi
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Boshqa bo'limlardan kelganlar */}
          <Card className="overflow-hidden">
            <div className="border-b border-(--color-line) px-4 py-3">
              <p className="text-sm font-semibold text-heading">Boshqa bo&apos;limlardan «{unit.label}» hisobiga</p>
              <p className="text-xs text-(--color-text-muted)">O&apos;sha bo&apos;limlarning siyosati yoki umumiy siyosat bo&apos;yicha · {rangeText}</p>
            </div>
            {data.incoming.length ? (
              <table className="w-full text-sm">
                <tbody>
                  {data.incoming.map((i) => (
                    <tr key={`${i.source}-${i.code}`} className="border-t border-(--color-line) first:border-t-0">
                      <td className="px-4 py-2 text-(--color-text-muted)">{i.sourceLabel}</td>
                      <td className="px-4 py-2 text-heading">{i.label}</td>
                      <td className="px-4 py-2 text-right text-xs text-(--color-text-faint)">{i.count} ta</td>
                      <td className="px-4 py-2 text-right font-medium tabular-nums text-heading">{formatTiyin(i.totalTiyin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-4 py-6 text-sm text-(--color-text-muted)">Bu davrda boshqa bo&apos;limlardan o&apos;tgan xarajat yo&apos;q.</p>
            )}
          </Card>
        </>
      )}

      {dirty && isAdmin && (
        <div className="sticky bottom-3 z-20">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 rounded-(--radius-card) border border-(--color-line-strong) bg-white px-4 py-3 shadow-lg">
            <p className="text-sm text-heading">
              Saqlanmagan o&apos;zgarish · bo&apos;lim hisobida: <b className="tabular-nums">{formatTiyin(preview.result.toString(), { currency: true })}</b>
            </p>
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setDraft(null)} disabled={saving}>
                Bekor qilish
              </Button>
              <Button size="sm" onClick={() => void handleSave()} loading={saving}>
                Saqlash
              </Button>
            </div>
          </div>
        </div>
      )}
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </div>
  );
}