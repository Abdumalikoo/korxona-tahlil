'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconPlus, IconSearch, IconTrash } from '@/components/ui/icons';
import { ExpandBox } from '@/components/report/nested';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { referencesApi } from '@/features/shared/references';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import type { EntryUnit } from '@/lib/segments';
import { useAsync } from '@/lib/use-async';
import type { CategoryTree } from '@/lib/types';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { unitCategoriesApi, useUnitCategories, type EntryKind } from './api';

// ═══════════════════════════════════════════════════════════
// Bo'lim moddalari — har bo'lim (Markaz, Hududlar, Tax free, Marksheyder, Fermer xo'jaligi, Buxgalteriya xizmatlari)
// ALOHIDA hudud: o'z xarajat moddalari / daromad turlari. Boshida bo'sh, moddalar birma-bir qo'shiladi:
//  • yangisi yaratiladi (xarajatda: guruh → guruh ichida modda) — faqat shu bo'limda ko'rinadi;
//  • yoki mavjud moddalardan tanlanadi (masalan, ikki bo'limda bir xil «Ish haqi»).
// «Olib tashlash» — moddani shu bo'lim ro'yxatidan chiqaradi (modda va eski yozuvlar o'chmaydi).
// ═══════════════════════════════════════════════════════════

interface Node {
  code: string;
  label: string;
  /** Guruh (xarajat moddalarining ota moddasi) */
  group: boolean;
  children: Node[];
}

function toNodes(tree: CategoryTree[]): Node[] {
  return tree.filter((c) => c.isActive).map((c) => ({ code: c.code, label: c.label, group: !c.isLeaf || (c.children ?? []).length > 0, children: toNodes(c.children ?? []) }));
}

/** Kichik matn kiritish shakli (guruh / modda / xizmat turi nomi) */
function AddForm({ placeholder, onSubmit, onCancel, busy }: { placeholder: string; onSubmit: (label: string) => Promise<boolean>; onCancel?: () => void; busy: boolean }) {
  const [text, setText] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const label = text.trim();
    if (label.length < 2) return;
    if (await onSubmit(label)) setText('');
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-center gap-2">
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        maxLength={120}
        className="h-9 min-w-[16rem] flex-1 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-3 text-sm focus:border-brand-600"
      />
      <Button type="submit" size="sm" loading={busy} disabled={text.trim().length < 2}>
        Qo&apos;shish
      </Button>
      {onCancel && (
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Bekor
        </Button>
      )}
    </form>
  );
}

export function UnitCategories({ kind, unit }: { kind: EntryKind; unit: EntryUnit }) {
  const { isAdmin } = useAuth();
  const lists = useUnitCategories(kind);
  const source = useAsync(() => (kind === 'expense' ? referencesApi.expenseTree() : referencesApi.incomeCategories()), [kind]);

  const nodes: Node[] = useMemo(() => {
    const raw = source.data?.data as unknown;
    if (!Array.isArray(raw)) return [];
    if (kind === 'expense') return toNodes(raw as CategoryTree[]);
    return (raw as { code: string; label: string; isActive: boolean }[]).filter((c) => c.isActive).map((c) => ({ code: c.code, label: c.label, group: false, children: [] }));
  }, [source.data, kind]);

  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'error' } | null>(null);

  if (lists.error || source.error) return <ErrorState message={lists.error ?? source.error ?? 'Xato'} onRetry={() => { lists.reload(); source.reload(); }} />;
  if (!lists.data || !source.data) return <Card><LoadingState label="Yuklanmoqda" /></Card>;

  const own = new Set(lists.lists.get(unit.code) ?? []);
  const noun = kind === 'expense' ? 'modda' : 'xizmat turi';
  const page = kind === 'expense' ? 'xarajat moddalari' : 'daromad turlari';

  /** Bo'lim daraxti: o'z guruhlari va ichidagi o'z moddalari (modda boshqa guruhdan olingan bo'lsa — guruh nomi sarlavha) */
  const unitTree: Node[] = kind === 'expense'
    ? nodes
        .map((g) => ({ ...g, children: g.children.filter((c) => own.has(c.code)) }))
        .filter((g) => own.has(g.code) || g.children.length > 0)
    : nodes.filter((n) => own.has(n.code));
  const leafCount = kind === 'expense' ? unitTree.reduce((s, g) => s + g.children.length, 0) : unitTree.length;

  const run = async (key: string, fn: () => Promise<string | null>) => {
    setBusy(key);
    try {
      const msg = await fn();
      if (msg) setToast({ message: msg });
      lists.reload();
      source.reload();
      return true;
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const addNew = (label: string, parentCode: string | null) =>
    run(`add:${parentCode ?? 'root'}`, async () => {
      // Boshqa joydan olingan guruh ichiga yangi modda — avval guruhning o'zi bo'limga qo'shiladi
      if (parentCode && !own.has(parentCode)) await unitCategoriesApi.set(kind, unit.code, [...own, parentCode]);
      await unitCategoriesApi.addItem(kind, unit.code, label, parentCode);
      return `«${label}» — «${unit.label}» bo'limiga qo'shildi`;
    });

  const removeCodes = (codes: string[], label: string) =>
    run(`rm:${codes[0]}`, async () => {
      const drop = new Set(codes);
      await unitCategoriesApi.set(kind, unit.code, [...own].filter((c) => !drop.has(c)));
      return `«${label}» bo'lim ro'yxatidan olib tashlandi (modda va eski yozuvlar o'chmadi)`;
    });

  const addPicked = () =>
    run('pick', async () => {
      const add = new Set(picked);
      // Xarajatda: tanlangan moddaning guruhi ham bo'limga (daraxtda ko'rinishi va yangi modda qo'shish uchun)
      if (kind === 'expense') for (const g of nodes) if (g.children.some((c) => add.has(c.code))) add.add(g.code);
      await unitCategoriesApi.set(kind, unit.code, [...new Set([...own, ...add])]);
      setPicked(new Set());
      setPicker(false);
      return `${picked.size} ta ${noun} «${unit.label}» bo'limiga qo'shildi`;
    });

  // ─────────── Bo'lim ro'yxati ───────────
  const rows: ReactNode[] = [];
  if (kind === 'expense') {
    for (const g of unitTree) {
      const open = !closed.has(g.code);
      rows.push(
        <li key={g.code} className="border-t border-(--color-line) bg-(--color-surface-muted)/60">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2">
            <ExpandBox open={open} onClick={() => setClosed((s) => { const x = new Set(s); if (x.has(g.code)) x.delete(g.code); else x.add(g.code); return x; })} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-heading">{g.label}</span>
            <span className="text-[11px] text-(--color-text-faint)">{g.children.length} ta modda</span>
            {isAdmin && (
              <>
                <Button size="sm" variant="secondary" onClick={() => setAdding(g.code)}>
                  <IconPlus className="size-3.5" />
                  Modda
                </Button>
                <button
                  type="button"
                  title="Guruhni bo'lim ro'yxatidan olib tashlash"
                  aria-label={`${g.label} — olib tashlash`}
                  disabled={busy !== null}
                  onClick={() => void removeCodes([g.code, ...g.children.map((c) => c.code)], g.label)}
                  className="flex size-8 items-center justify-center rounded-md text-(--color-text-muted) hover:bg-(--color-expense-soft) hover:text-(--color-expense)"
                >
                  <IconTrash className="size-4" />
                </button>
              </>
            )}
          </div>
          {adding === g.code && (
            <div className="border-t border-(--color-line) bg-white px-3 py-2 pl-11">
              <AddForm placeholder={`«${g.label}» ichiga yangi modda nomi`} busy={busy === `add:${g.code}`} onSubmit={(label) => addNew(label, g.code)} onCancel={() => setAdding(null)} />
            </div>
          )}
          {open && (
            <ul className="bg-white">
              {g.children.length === 0 && <li className="border-t border-(--color-line) px-3 py-2 pl-11 text-xs text-(--color-text-muted)">Hali modda yo&apos;q — «+ Modda» bilan qo&apos;shing</li>}
              {g.children.map((c) => (
                <li key={c.code} className="flex items-center gap-2 border-t border-(--color-line) px-3 py-1.5 pl-11">
                  <span className="size-1.5 shrink-0 rounded-full bg-brand-500" />
                  <span className="min-w-0 flex-1 truncate text-sm text-heading">{c.label}</span>
                  {isAdmin && (
                    <button
                      type="button"
                      aria-label={`${c.label} — olib tashlash`}
                      disabled={busy !== null}
                      onClick={() => void removeCodes([c.code], c.label)}
                      className="rounded-md px-2 py-1 text-xs font-medium text-(--color-text-muted) hover:bg-(--color-expense-soft) hover:text-(--color-expense)"
                    >
                      Olib tashlash
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </li>,
      );
    }
  } else {
    for (const n of unitTree) {
      rows.push(
        <li key={n.code} className="flex items-center gap-2 border-t border-(--color-line) px-4 py-2">
          <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
          <span className="min-w-0 flex-1 truncate text-sm text-heading">{n.label}</span>
          {isAdmin && (
            <button
              type="button"
              aria-label={`${n.label} — olib tashlash`}
              disabled={busy !== null}
              onClick={() => void removeCodes([n.code], n.label)}
              className="rounded-md px-2 py-1 text-xs font-medium text-(--color-text-muted) hover:bg-(--color-expense-soft) hover:text-(--color-expense)"
            >
              Olib tashlash
            </button>
          )}
        </li>,
      );
    }
  }

  // ─────────── Mavjud moddalardan tanlash ───────────
  const term = q.trim().toLowerCase();
  const hit = (n: Node) => !term || n.label.toLowerCase().includes(term) || n.code.toLowerCase().includes(term);
  const pickRows: ReactNode[] = [];
  if (picker) {
    const leaves = kind === 'expense' ? nodes : [{ code: '', label: '', group: true, children: nodes }];
    for (const g of leaves) {
      const items = g.children.filter((c) => !own.has(c.code) && !c.group && (hit(c) || (kind === 'expense' && hit(g))));
      if (!items.length) continue;
      if (kind === 'expense') pickRows.push(<li key={`h-${g.code}`} className="sticky top-0 z-[1] bg-(--color-surface-muted) px-3 py-1.5 text-xs font-semibold text-heading">{g.label}</li>);
      for (const c of items) {
        pickRows.push(
          <li key={c.code}>
            <label className="flex cursor-pointer items-center gap-2 border-t border-(--color-line) px-3 py-1.5 pl-6 text-sm hover:bg-brand-50/50">
              <input
                type="checkbox"
                className="size-4 accent-brand-600"
                checked={picked.has(c.code)}
                onChange={() => setPicked((s) => { const x = new Set(s); if (x.has(c.code)) x.delete(c.code); else x.add(c.code); return x; })}
              />
              <span className="truncate text-heading">{c.label}</span>
            </label>
          </li>,
        );
      }
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <Card className="overflow-hidden">
        <div className="space-y-3 border-b border-(--color-line) px-5 py-4">
          <div>
            <p className="text-base font-bold text-heading">
              «{unit.label}» bo&apos;limi {page}
            </p>
            <p className="mt-0.5 text-xs text-(--color-text-muted)">
              Bu bo&apos;lim alohida: bu yerdagi {noun}lar boshqa bo&apos;limlarda ko&apos;rinmaydi va shu bo&apos;limga faqat ular kiritiladi.
              {kind === 'expense' ? ' Avval guruh yarating (masalan, «Ofis xarajatlari»), keyin ichiga moddalar qo‘shing.' : ''}
            </p>
          </div>
          {isAdmin && (
            <div className="space-y-2">
              {adding === 'root' ? (
                <AddForm
                  placeholder={kind === 'expense' ? 'Yangi guruh nomi (masalan, «Ofis xarajatlari»)' : 'Yangi xizmat turi nomi'}
                  busy={busy === 'add:root'}
                  onSubmit={(label) => addNew(label, null)}
                  onCancel={() => setAdding(null)}
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setAdding('root')}>
                    <IconPlus className="size-4" />
                    {kind === 'expense' ? 'Yangi guruh' : 'Yangi xizmat turi'}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setPicker((v) => !v)}>
                    Mavjudlardan tanlash
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {rows.length ? (
          <ul className="max-h-[620px] overflow-auto">{rows}</ul>
        ) : (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-semibold text-heading">Hali {noun} yo&apos;q</p>
            <p className="mt-1 text-xs text-(--color-text-muted)">
              {kind === 'expense'
                ? "«Yangi guruh» bilan boshlang, keyin guruh ichiga moddalarni birma-bir qo'shing — yoki «Mavjudlardan tanlash»."
                : "«Yangi xizmat turi» bilan qo'shing — yoki «Mavjudlardan tanlash»."}
            </p>
          </div>
        )}
        <div className="border-t border-(--color-line) bg-(--color-surface-muted) px-5 py-2.5 text-xs text-(--color-text-muted)">
          Jami: <b className="text-heading">{leafCount}</b> ta {noun}
          {kind === 'expense' && unitTree.length ? `, ${unitTree.length} ta guruh` : ''}
        </div>
      </Card>

      {picker && (
        <Card className="flex max-h-[720px] flex-col overflow-hidden">
          <div className="space-y-2 border-b border-(--color-line) px-4 py-3">
            <p className="text-sm font-bold text-heading">Mavjud {noun}lardan tanlash</p>
            <p className="text-xs text-(--color-text-muted)">Boshqa bo&apos;limlarda yoki umumiy ro&apos;yxatda bor {noun}lar. Tanlanganlari shu bo&apos;limga ham qo&apos;shiladi.</p>
            <label className="relative block">
              <IconSearch className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-(--color-text-faint)" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Qidirish" className="h-8 w-full rounded-(--radius-control) border border-(--color-line) pr-2 pl-7 text-sm" />
            </label>
          </div>
          <ul className="min-h-0 flex-1 overflow-auto">{pickRows.length ? pickRows : <li className="px-4 py-6 text-center text-xs text-(--color-text-muted)">Topilmadi</li>}</ul>
          <div className="flex items-center gap-2 border-t border-(--color-line) bg-(--color-surface-muted) px-4 py-2.5">
            <span className="text-xs text-(--color-text-muted)">{picked.size} ta tanlandi</span>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => { setPicker(false); setPicked(new Set()); }}>
              Yopish
            </Button>
            <Button size="sm" loading={busy === 'pick'} disabled={!picked.size} onClick={() => void addPicked()}>
              Qo&apos;shish
            </Button>
          </div>
        </Card>
      )}
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </div>
  );
}