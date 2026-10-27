'use client';

import { MoneyCell, STICKY_NAME, STICKY_NO, Td, sum } from '@/components/report/report';
import { choiceReady, EMPTY_CHOICE, PlacePicker, type MoveChoice } from '@/features/unit-payroll/place-picker';
import { referencesApi } from '@/features/shared/references';
import { policyApi } from '@/features/expense-policy/api';
import { formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { errorMessage } from '@/lib/error-message';
import { cn } from '@/lib/utils';
import { Fragment, useMemo, useState } from 'react';
import type { PayoutKind, PayoutRow, PlaceRow, SafarConfirmItem } from './api';

// ═══════════════════════════════════════════════════════════
// 23106 tahlili › tur ichida «Bo'limlar / hududlar bo'yicha»: pul qayerga ketgan —
//   Markaz › bo'lim › xodim;  Hudud (viloyat) › tuman › xodim;  yo'nalish (Tax free …) › xodim;  joyi aniqlanmagan.
// Joy — xodimning TO'LANGAN OYDAGI joyi (bo'lim ko'chishlari, yo'nalish ro'yxatlari, Xodimlar bazasi).
// Har darajada oyma-oy summa. Faqat XIZMAT SAFARI uchun: xarajatga o'tgani / kutayotgani va
// «Xarajatga o'tkazish» — oynada QAYSI MODDAGA (istalgan xarajat moddasi) va QAYERGA (har xodim o'z joyiga yoki
// hammasi bitta tanlangan joyga) tanlanadi; har to'lov o'z oyiga (to'langan sana) xarajat bo'ladi.
// ═══════════════════════════════════════════════════════════

interface Node {
  id: string;
  label: string;
  sub?: string;
  level: 1 | 2 | 3;
  total: number;
  count: number;
  people: Set<string>;
  months: Map<string, number>;
  /** Xizmat safari holati */
  posted: number;
  pending: number;
  issue: number;
  ready: { key: string; period: string }[];
  /** Joyi aniqlanmagan (bitta joy tanlansa — ular ham o'tadi) */
  unplaced: { key: string; period: string; amount: number }[];
  /** Kutayotganlar oylari */
  pendingMonths: Map<string, number>;
  children: Map<string, Node>;
}

const newNode = (id: string, label: string, level: 1 | 2 | 3, sub?: string): Node => ({ id, label, sub, level, total: 0, count: 0, people: new Set(), months: new Map(), posted: 0, pending: 0, issue: 0, ready: [], unplaced: [], pendingMonths: new Map(), children: new Map() });

const keyOf = (r: PayoutRow) => r.key ?? `${r.docDate}|${r.docNo}|${r.debitTiyin}|${r.inn}`;
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1).replace('.', ',')}%` : '');

/** Joydan 1- va 2-daraja: Markaz › bo'lim; Hudud › tuman; yo'nalish; aniqlanmagan */
function levelsOf(p: PlaceRow | undefined): { l1: [string, string, string?]; l2: [string, string] | null } {
  const place = p?.place;
  if (!place) return { l1: ['none', '— Joyi aniqlanmagan', p?.issueText ?? "xodim yoki uning bo'limi aniqlanmadi"], l2: null };
  const parts = place.label.split(' › ');
  if (place.unit === 'CENTER') return { l1: ['CENTER', 'Markaz', "bo'limlar"], l2: place.departmentId ? [`d:${place.departmentId}`, parts[1] ?? "Bo'lim"] : ['d:-', "Bo'limi aniqlanmagan"] };
  if (place.unit === 'REGION') {
    return {
      l1: [`r:${place.regionCode ?? '-'}`, parts[1] ?? 'Hudud', 'hudud · tumanlar'],
      l2: place.districtId ? [`t:${place.districtId}`, parts[2] ?? 'Tuman'] : ['t:-', "Tumanga bo'linmagan"],
    };
  }
  return { l1: [`s:${place.unit}`, place.label, "yo'nalish"], l2: null };
}

export function UnitsBreakdown({
  kind,
  rows,
  places,
  months,
  showMonths,
  monthOf,
  cols,
  kindTotal,
  safarPost,
}: {
  kind: PayoutKind;
  rows: PayoutRow[];
  places: Map<string, PlaceRow>;
  months: string[];
  showMonths: boolean;
  monthOf: (r: PayoutRow) => string;
  cols: number;
  kindTotal: number;
  /** Faqat xizmat safari: kutayotgan to'lovlarni xarajatga o'tkazish */
  safarPost?: (items: SafarConfirmItem[], categoryCode: string) => Promise<void>;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [posting, setPosting] = useState<string | null>(null);
  const isSafar = kind === 'SAFAR';

  const tree = useMemo(() => {
    const root = new Map<string, Node>();
    const add = (n: Node, r: PayoutRow, p: PlaceRow | undefined, person: string) => {
      const v = Number(r.debitTiyin);
      const m = monthOf(r);
      n.total += v;
      n.count += 1;
      n.people.add(person);
      n.months.set(m, (n.months.get(m) ?? 0) + v);
      if (isSafar) {
        if (p?.posted) n.posted += v;
        else if (p?.place) {
          n.pending += v;
          n.ready.push({ key: p.safarKey, period: p.period });
          n.pendingMonths.set(p.period, (n.pendingMonths.get(p.period) ?? 0) + v);
        } else {
          n.issue += v;
          if (p) n.unplaced.push({ key: p.safarKey, period: p.period, amount: v });
        }
      }
    };
    for (const r of rows.filter((x) => x.kind === kind)) {
      const p = places.get(keyOf(r));
      const { l1, l2 } = levelsOf(p);
      const person = p?.pinfl ?? r.pinfl ?? (r.fullName ?? r.commentName ?? r.accountName).toUpperCase();
      const personName = p?.fullName ?? r.fullName ?? r.commentName ?? r.accountName;
      let n1 = root.get(l1[0]);
      if (!n1) root.set(l1[0], (n1 = newNode(l1[0], l1[1], 1, l1[2])));
      add(n1, r, p, person);
      let parent = n1;
      if (l2) {
        const id2 = `${l1[0]}|${l2[0]}`;
        let n2 = n1.children.get(id2);
        if (!n2) n1.children.set(id2, (n2 = newNode(id2, l2[1], 2)));
        add(n2, r, p, person);
        parent = n2;
      }
      const id3 = `${parent.id}|${person}`;
      let n3 = parent.children.get(id3);
      if (!n3) parent.children.set(id3, (n3 = newNode(id3, personName, 3, p?.pinfl ?? r.pinfl ?? undefined)));
      add(n3, r, p, person);
    }
    const sortTree = (m: Map<string, Node>): Node[] => [...m.values()].sort((a, b) => b.total - a.total);
    return sortTree(root).map((n) => ({ n, kids: sortTree(n.children).map((k) => ({ n: k, kids: sortTree(k.children) })) }));
  }, [rows, places, kind, monthOf, isSafar]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const row = (n: Node, hasKids: boolean) => {
    const isOpen = open.has(n.id);
    const pad = n.level === 1 ? 'pl-4' : n.level === 2 ? 'pl-8' : 'pl-12';
    return (
      <Fragment key={n.id}>
      <tr className={cn('[&>td]:bg-inherit', n.level === 1 ? 'bg-[#f2f6ff]' : n.level === 2 ? 'bg-[#f8faff]' : 'bg-white')}>
        <Td className={STICKY_NO} />
        <td
          className={cn('border-b border-l border-(--color-line) px-1.5 py-1.5 text-left text-[12.5px]', STICKY_NAME, hasKids && 'cursor-pointer select-none')}
          onClick={hasKids ? () => toggle(n.id) : undefined}
        >
          <span className={cn('flex items-start gap-1.5', pad)}>
            {hasKids ? <span className={cn('mt-0.5 inline-block w-3 text-xs text-(--color-text-faint) transition-transform', isOpen && 'rotate-90')}>▸</span> : <span className="inline-block w-3" />}
            <span className="min-w-0">
              <span className={cn('block', n.level === 1 ? 'font-semibold text-heading' : n.level === 2 ? 'font-medium text-heading' : 'text-heading')}>{n.label}</span>
              {n.sub && <span className={cn('block text-[10.5px] text-(--color-text-faint)', n.level === 3 && 'font-mono')}>{n.sub}</span>}
              {isSafar && (n.level < 3 || n.pending + n.issue > 0) && (
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px]">
                  {n.posted > 0 && <span className="text-(--color-income)">xarajatda {sum(n.posted)}</span>}
                  {n.pending > 0 && <span className="text-amber-700">kutmoqda {sum(n.pending)}</span>}
                  {n.issue > 0 && <span className="text-(--color-expense)">joyi yo&apos;q {sum(n.issue)}</span>}
                  {safarPost && n.ready.length + n.unplaced.length > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPosting(posting === n.id ? null : n.id);
                      }}
                      className={cn('rounded border px-1.5 py-px font-semibold', posting === n.id ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-brand-300 bg-white text-brand-700 hover:bg-brand-50')}
                    >
                      Xarajatga o&apos;tkazish ({n.ready.length + n.unplaced.length}) {posting === n.id ? '▴' : '▾'}
                    </button>
                  )}
                </span>
              )}
            </span>
          </span>
        </td>
        <MoneyCell value={n.total} strong={n.level === 1} />
        <Td className="whitespace-nowrap text-xs text-(--color-text-muted)">{pct(n.total, kindTotal)}</Td>
        <Td className="text-xs">{n.count}</Td>
        <Td className="text-xs">{n.level < 3 ? n.people.size : ''}</Td>
        {showMonths && months.map((m) => <MoneyCell key={m} value={n.months.get(m) ?? 0} className={cn('text-xs', n.months.get(m) ? '' : 'text-(--color-text-faint)')} />)}
      </tr>
      {posting === n.id && safarPost && (
        <tr className="bg-[#f5f8ff] [&>td]:bg-inherit">
          <td colSpan={cols} className="border-b border-(--color-line) p-0">
            <div className="sticky left-0 max-w-[calc(100vw-8rem)] px-4 py-3">
              <PostPanel node={n} onCancel={() => setPosting(null)} onPost={async (items, code) => { await safarPost(items, code); setPosting(null); }} />
            </div>
          </td>
        </tr>
      )}
      </Fragment>
    );
  };

  return (
    <>
      {tree.map(({ n, kids }) => (
        <Fragment key={n.id}>
          {row(n, kids.length > 0)}
          {open.has(n.id) &&
            kids.map(({ n: k, kids: grand }) => (
              <Fragment key={k.id}>
                {row(k, grand.length > 0)}
                {open.has(k.id) && grand.map((g) => row(g, false))}
              </Fragment>
            ))}
        </Fragment>
      ))}
    </>
  );
}

/**
 * Xizmat safarini xarajatga o'tkazish oynasi: modda (istalgan faol xarajat moddasi, «Xizmat safari» birinchi) va joy
 * (har xodim o'z joyiga — dastur aniqlagani, yoki hammasi bitta tanlangan joyga — joyi aniqlanmaganlar ham).
 */
function PostPanel({ node, onCancel, onPost }: { node: Node; onCancel: () => void; onPost: (items: SafarConfirmItem[], categoryCode: string) => Promise<void> }) {
  const cats = useAsync(() => referencesApi.expenseCategories().then((r) => r.data), []);
  const policy = useAsync(() => policyApi.get().then((r) => r.data), []);
  const [code, setCode] = useState('HM_SAFAR');
  const [payerBusy, setPayerBusy] = useState(false);
  const [payerMsg, setPayerMsg] = useState<string | null>(null);
  const pc = policy.data?.categories.find((c) => c.code === code) ?? null;
  const payer = pc ? (pc.payer ?? 'region') : null;

  /** Kim hisobidan — shu modda uchun Xarajatlar siyosati (avvalgi yozuvlarga ham qo'llanadi) */
  async function changePayer(next: string) {
    setPayerBusy(true);
    setPayerMsg(null);
    try {
      await policyApi.setPayer(code, next);
      policy.reload();
      setPayerMsg(next === 'region' ? "Saqlandi: har joy o'zi to'laydi" : next === 'center' ? 'Saqlandi: Markaz to‘laydi (Solishtirmada — «Hududlar uchun to‘langan»)' : 'Saqlandi');
    } catch (err) {
      setPayerMsg(errorMessage(err, "Saqlab bo'lmadi"));
    } finally {
      setPayerBusy(false);
    }
  }
  const [mode, setMode] = useState<'own' | 'one'>(node.ready.length ? 'own' : 'one');
  const [choice, setChoice] = useState<MoveChoice>(EMPTY_CHOICE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Moddalar: guruh bo'yicha; xizmat safari / komandirovka moddalari tepada */
  const groups = useMemo(() => {
    const list = cats.data ?? [];
    const label = new Map(list.map((c) => [c.code, c.label]));
    const leaves = list.filter((c) => c.isLeaf && c.isActive);
    const safar = leaves.filter((c) => c.code === 'HM_SAFAR' || /safar|komandir|сафар|командир/i.test(c.label));
    const rest = new Map<string, { code: string; label: string }[]>();
    for (const c of leaves) {
      if (safar.includes(c)) continue;
      const g = c.parentCode ? (label.get(c.parentCode) ?? c.parentCode) : 'Boshqa';
      rest.set(g, [...(rest.get(g) ?? []), { code: c.code, label: c.label }]);
    }
    const hasDefault = leaves.some((c) => c.code === 'HM_SAFAR');
    return {
      safar: [...(hasDefault ? [] : [{ code: 'HM_SAFAR', label: 'Xizmat safari (komandirovka) — yangi modda yaratiladi' }]), ...safar.map((c) => ({ code: c.code, label: c.label }))],
      rest: [...rest.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    };
  }, [cats.data]);

  const items: SafarConfirmItem[] =
    mode === 'own'
      ? node.ready.map((x) => ({ key: x.key, period: x.period }))
      : choiceReady(choice)
        ? [...node.ready, ...node.unplaced].map((x) => ({ key: x.key, period: x.period, place: { unit: choice.target, ...choice.place } }))
        : [];
  const amount = mode === 'own' ? node.pending : node.pending + node.unplaced.reduce((s, x) => s + x.amount, 0);
  const months = [...new Set([...node.ready, ...(mode === 'one' ? node.unplaced : [])].map((x) => x.period))].sort();

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onPost(items, code);
    } catch (err) {
      setError(errorMessage(err, "Xarajatga o'tkazib bo'lmadi"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-brand-200 bg-white p-3 text-xs">
      <p className="text-sm font-semibold text-heading">«{node.label}» — xizmat safarini xarajatga o&apos;tkazish</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-28 font-medium text-heading">Qaysi moddaga:</span>
        <select value={code} onChange={(e) => setCode(e.target.value)} className="h-8 min-w-72 rounded-md border border-(--color-line-strong) bg-white px-2 text-sm" disabled={!cats.data}>
          {!cats.data && <option value="HM_SAFAR">Yuklanmoqda…</option>}
          {cats.data && (
            <>
              <optgroup label="Xizmat safari">
                {groups.safar.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
              {groups.rest.map(([g, list]) => (
                <optgroup key={g} label={g}>
                  {list.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </>
          )}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-28 font-medium text-heading">Kim hisobidan:</span>
        {!pc ? (
          <span className="text-(--color-text-muted)">{policy.data || policy.error ? 'Yangi modda — birinchi o‘tkazishdan keyin tanlash mumkin (hozircha har joy o‘zi)' : 'Yuklanmoqda…'}</span>
        ) : pc.locked ? (
          <span className="text-(--color-text-muted)">{pc.lockedReason ?? 'Markaz hisobidan'} — o&apos;zgartirib bo&apos;lmaydi</span>
        ) : (
          <>
            <select value={payer ?? 'region'} disabled={payerBusy} onChange={(e) => void changePayer(e.target.value)} className="h-8 min-w-72 rounded-md border border-(--color-line-strong) bg-white px-2 text-sm">
              <option value="region">Har joy o&apos;zi (hudud — hudud hisobidan, bo&apos;lim — bo&apos;lim)</option>
              <option value="center">Markaz to&apos;laydi (hududlar uchun ham)</option>
              {(policy.data?.payerOptions ?? [])
                .filter((o) => o.code !== 'center')
                .map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label} hisobidan
                  </option>
                ))}
            </select>
            <span className="text-(--color-text-muted)">shu moddaning hamma yozuvlariga (oldingilariga ham) qo&apos;llanadi</span>
          </>
        )}
        {payerMsg && <span className="w-full pl-30 text-(--color-income)">{payerMsg}</span>}
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <span className="w-28 pt-1 font-medium text-heading">Qayerga yoziladi:</span>
        <div className="space-y-1.5">
          <label className={cn('flex cursor-pointer items-start gap-2', !node.ready.length && 'opacity-50')}>
            <input type="radio" className="mt-0.5 accent-brand-600" checked={mode === 'own'} disabled={!node.ready.length} onChange={() => setMode('own')} />
            <span>
              <span className="font-medium text-heading">Har xodim o&apos;z joyiga</span>
              <span className="block text-(--color-text-muted)">
                dastur aniqlagan bo&apos;lim / hudud — {node.ready.length} ta to&apos;lov
                {node.unplaced.length ? ` (joyi aniqlanmagan ${node.unplaced.length} tasi o'tmaydi)` : ''}
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2">
            <input type="radio" className="mt-0.5 accent-brand-600" checked={mode === 'one'} onChange={() => setMode('one')} />
            <span>
              <span className="font-medium text-heading">Hammasi bitta joyga</span>
              <span className="block text-(--color-text-muted)">
                {node.ready.length + node.unplaced.length} ta to&apos;lov{node.unplaced.length ? ', joyi aniqlanmaganlari ham' : ''}
              </span>
            </span>
          </label>
          {mode === 'one' && (
            <div className="pl-6">
              <PlacePicker value={choice} onChange={setChoice} />
            </div>
          )}
        </div>
      </div>
      <p className="text-(--color-text-muted)">
        {items.length ? (
          <>
            <b className="text-heading">{items.length} ta to&apos;lov · {sum(amount)} so&apos;m</b> — har biri to&apos;langan oyiga yoziladi
            {months.length ? ` (${months.map(formatPeriod).join(', ')})` : ''}. Keyin «Xizmat safari» bo&apos;limida bekor qilish mumkin.
          </>
        ) : (
          'Joyni tanlang'
        )}
      </p>
      {error && <p className="text-(--color-expense)">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-md px-3 py-1.5 font-medium text-(--color-text-muted) hover:text-heading">
          Bekor
        </button>
        <button type="button" onClick={() => void submit()} disabled={busy || !items.length} className="rounded-md bg-brand-600 px-4 py-1.5 font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
          {busy ? 'Yozilmoqda…' : "Xarajatga o'tkazish"}
        </button>
      </div>
    </div>
  );
}
