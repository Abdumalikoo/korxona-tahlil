'use client';

import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  downloadReactionFile,
  KIND_LABEL,
  markKey,
  reactionsApi,
  type EmployeeOption,
  type ItemKind,
  type ReactionSummary,
} from './api';
import { useItemBuilder } from './item-builder';
import { useReactionSelect, type Basket } from './select-context';

const TASHKENT_MS = 5 * 3600_000;

function todayIso(): string {
  return new Date(Date.now() + TASHKENT_MS).toISOString().slice(0, 10);
}

function plusDays(days: number): string {
  return new Date(Date.now() + TASHKENT_MS + days * 86_400_000).toISOString().slice(0, 10);
}

function uzDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

const KIND_TONE: Record<ItemKind, string> = {
  INCOME: 'bg-(--color-income-soft) text-(--color-income)',
  EXPENSE: 'bg-(--color-expense-soft) text-(--color-expense)',
  RESULT: 'bg-slate-100 text-slate-700',
};

const FIELD = 'h-9 w-full rounded-(--radius-control) border border-(--color-line) bg-white px-2.5 text-sm outline-none focus:border-slate-500';
const LABEL = 'mb-1 block text-xs font-medium text-(--color-text-muted)';

export function KindBadge({ kind }: { kind: ItemKind }) {
  return <span className={cn('inline-flex shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold', KIND_TONE[kind])}>{KIND_LABEL[kind]}</span>;
}

// ═══════════════════════════════════════════════════════════
// Savat tarkibi
// ═══════════════════════════════════════════════════════════

function BasketDrawer({ basket, open, onClose }: { basket: Basket | null; open: boolean; onClose: () => void }) {
  const select = useReactionSelect();
  if (!select || !basket) return null;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={basket.name}
      description={`${basket.items.length} ta belgilangan modda`}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (window.confirm(`«${basket.name}» savati o'chirilsinmi?`)) {
                select.removeBasket(basket.id);
                onClose();
              }
            }}
          >
            Savatni o&apos;chirish
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Yopish
          </Button>
        </div>
      }
    >
      {basket.items.length === 0 ? (
        <p className="py-10 text-center text-sm text-(--color-text-muted)">
          Savat bo&apos;sh. Sahifalardagi sariq <b>+</b> belgilarini bosing yoki «Qo&apos;lda qo&apos;shish» dan foydalaning.
        </p>
      ) : (
        <ul className="divide-y divide-(--color-line)">
          {basket.items.map((item) => (
            <li key={markKey(item)} className="flex items-start gap-3 py-2.5">
              <KindBadge kind={item.kind} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-(--color-text)">{item.label}</span>
                {item.origin && <span className="text-xs text-(--color-text-faint)">{item.origin}</span>}
              </span>
              <button
                type="button"
                onClick={() => select.removeItem(basket.id, markKey(item))}
                className="rounded px-1.5 text-lg leading-none text-(--color-text-faint) hover:bg-(--color-surface-sunken) hover:text-(--color-expense)"
                title="Olib tashlash"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

// ═══════════════════════════════════════════════════════════
// Qo'lda qo'shish: hudud + tur + guruh/kategoriya
// ═══════════════════════════════════════════════════════════

function ManualDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const select = useReactionSelect();
  const builder = useItemBuilder("Qo'lda qo'shilgan");
  const [added, setAdded] = useState<string | null>(null);
  const item = builder.item;

  if (!select) return null;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Qo'lda modda qo'shish"
      description="Sahifada belgisi bo'lmagan moddani tanlab, joriy savatga qo'shing"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Yopish
          </Button>
          <Button
            size="sm"
            disabled={!item}
            onClick={() => {
              if (!item) return;
              select.add(item);
              setAdded(item.label);
            }}
          >
            Savatga qo&apos;shish
          </Button>
        </div>
      }
    >
      {builder.error ? (
        <p className="text-sm text-(--color-expense)">{builder.error}</p>
      ) : builder.loading ? (
        <p className="text-sm text-(--color-text-muted)">Yuklanmoqda…</p>
      ) : (
        <div className="space-y-4">
          {builder.fields}
          {item && (
            <div className="rounded-(--radius-control) border border-(--color-line) bg-(--color-surface-muted) p-3">
              <p className="text-xs text-(--color-text-muted)">Savatga qo&apos;shiladi:</p>
              <p className="mt-1 flex items-center gap-2 text-sm font-medium">
                <KindBadge kind={item.kind} />
                {item.label}
              </p>
            </div>
          )}
          {added && <p className="text-xs text-(--color-income)">Qo&apos;shildi: {added}. Yana tanlashingiz mumkin.</p>}
        </div>
      )}
    </Drawer>
  );
}

// ═══════════════════════════════════════════════════════════
// Munosabat yaratish
// ═══════════════════════════════════════════════════════════

const DUE_PRESETS = [
  { days: 7, label: '1 hafta' },
  { days: 15, label: '15 kun' },
  { days: 30, label: '1 oy' },
  { days: 60, label: '2 oy' },
  { days: 90, label: '3 oy' },
];

function CreateDrawer({ basket, open, onClose }: { basket: Basket | null; open: boolean; onClose: () => void }) {
  const select = useReactionSelect();
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [startDate, setStartDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState(plusDays(30));
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<EmployeeOption[]>([]);
  const [assignees, setAssignees] = useState<(EmployeeOption & { role: string })[]>([]);
  const [existing, setExisting] = useState<ReactionSummary[] | null>(null);
  const [targetId, setTargetId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; title: string } | null>(null);

  useEffect(() => {
    if (open && basket) {
      setTitle(basket.name);
      setDone(null);
      setError(null);
    }
  }, [open, basket]);

  // Xodim qidirish (Xodimlar bo'limidan)
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      reactionsApi
        .employees(search)
        .then((r) => setFound(r.data))
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [search, open]);

  useEffect(() => {
    if (!open || mode !== 'existing' || existing) return;
    reactionsApi
      .list('OPEN')
      .then((r) => setExisting(r.data))
      .catch((e: Error) => setError(e.message));
  }, [open, mode, existing]);

  if (!select || !basket) return null;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      if (mode === 'new') {
        const result = await reactionsApi.create({
          title: title.trim(),
          note: note.trim() || undefined,
          startDate,
          dueDate,
          items: basket.items,
          assignees: assignees.map((a) => ({ pinfl: a.pinfl, role: a.role })),
        });
        setDone({ id: result.data.id, title: result.data.title });
      } else {
        if (!targetId) throw new Error('Munosabatni tanlang');
        const result = await reactionsApi.update(targetId, { addItems: basket.items });
        setDone({ id: result.data.id, title: result.data.title });
      }
      select.removeBasket(basket.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Saqlanmadi');
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <Drawer
        open={open}
        onClose={onClose}
        title="Munosabat tayyor"
        description={done.title}
        footer={
          <div className="flex w-full justify-end">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Yopish
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-(--color-text)">
            Munosabat saqlandi. Hisobot va slaydlar avtomatik tayyorlanadi — kuzatuv davomida raqamlar har kuni yangilanadi.
          </p>
          <div className="grid gap-2">
            <Button variant="secondary" onClick={() => downloadReactionFile(done.id, 'report').catch((e: Error) => setError(e.message))}>
              Excel hisobotni yuklab olish
            </Button>
            <Button variant="secondary" onClick={() => downloadReactionFile(done.id, 'slides').catch((e: Error) => setError(e.message))}>
              Slaydlarni yuklab olish (PowerPoint)
            </Button>
            <Link href={`/munosabat/${done.id}`} className="text-center text-sm font-medium text-brand-700 hover:underline" onClick={onClose}>
              Munosabat sahifasini ochish →
            </Link>
          </div>
          {error && <p className="text-sm text-(--color-expense)">{error}</p>}
        </div>
      </Drawer>
    );
  }

  const canSubmit = basket.items.length > 0 && (mode === 'existing' ? Boolean(targetId) : title.trim().length > 0 && dueDate >= startDate);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Munosabat yaratish"
      description={`«${basket.name}» · ${basket.items.length} ta modda`}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button size="sm" disabled={!canSubmit || saving} loading={saving} onClick={submit}>
            {mode === 'new' ? 'Yaratish' : "Qo'shish"}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-1.5">
          {(['new', 'existing'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                'rounded-(--radius-control) border px-2 py-2 text-sm',
                mode === m ? 'border-slate-800 bg-slate-800 font-medium text-white' : 'border-(--color-line) bg-white text-(--color-text-muted) hover:bg-(--color-surface-muted)',
              )}
            >
              {m === 'new' ? 'Yangi munosabat' : "Mavjudiga qo'shish"}
            </button>
          ))}
        </div>

        {mode === 'existing' ? (
          <label className="block">
            <span className={LABEL}>Ochiq munosabat</span>
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className={FIELD}>
              <option value="">— tanlang —</option>
              {(existing ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} · {r.itemCount} ta · muddat {uzDate(r.dueDate)}
                </option>
              ))}
            </select>
            {existing && existing.length === 0 && <span className="mt-1 block text-xs text-(--color-text-muted)">Ochiq munosabat yo&apos;q — yangisini yarating.</span>}
          </label>
        ) : (
          <>
            <label className="block">
              <span className={LABEL}>Nomi</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} className={FIELD} placeholder="Masalan: Toshkent va Farg'ona mashina xarajatlari" />
            </label>

            <div>
              <span className={LABEL}>Muddat</span>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {DUE_PRESETS.map((p) => {
                  const value = new Date(Date.parse(`${startDate}T00:00:00Z`) + p.days * 86_400_000).toISOString().slice(0, 10);
                  return (
                    <button
                      key={p.days}
                      type="button"
                      onClick={() => setDueDate(value)}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs',
                        dueDate === value ? 'border-slate-800 bg-slate-800 text-white' : 'border-(--color-line) text-(--color-text-muted) hover:border-slate-400',
                      )}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-(--color-text-faint)">Boshlanishi</span>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={FIELD} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-(--color-text-faint)">Tugashi (muddat)</span>
                  <input type="date" value={dueDate} min={startDate} onChange={(e) => setDueDate(e.target.value)} className={FIELD} />
                </label>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-(--color-text-muted)">
                Kuzatuv davri boshlanishdan muddatgacha. Solishtirish uchun undan oldingi xuddi shuncha kun olinadi.
              </p>
            </div>

            <div>
              <span className={LABEL}>Mas&apos;ul xodimlar</span>
              {assignees.length > 0 && (
                <ul className="mb-2 space-y-1.5">
                  {assignees.map((a) => (
                    <li key={a.pinfl} className="flex items-center gap-2 rounded-(--radius-control) border border-(--color-line) px-2.5 py-1.5 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{a.fullName}</span>
                        <span className="block truncate text-xs text-(--color-text-muted)">{[a.position, a.place].filter(Boolean).join(' · ')}</span>
                      </span>
                      <select
                        value={a.role}
                        onChange={(e) => setAssignees((list) => list.map((x) => (x.pinfl === a.pinfl ? { ...x, role: e.target.value } : x)))}
                        className="h-7 rounded border border-(--color-line) bg-white px-1 text-xs"
                      >
                        <option>Mas&apos;ul</option>
                        <option>Ijrochi</option>
                        <option>Nazoratchi</option>
                      </select>
                      <button type="button" onClick={() => setAssignees((list) => list.filter((x) => x.pinfl !== a.pinfl))} className="px-1 text-lg leading-none text-(--color-text-faint) hover:text-(--color-expense)">
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <input value={search} onChange={(e) => setSearch(e.target.value)} className={FIELD} placeholder="Ism, lavozim yoki PINFL bo'yicha qidirish…" />
              <ul className="mt-1 max-h-44 overflow-auto rounded-(--radius-control) border border-(--color-line)">
                {found
                  .filter((e) => !assignees.some((a) => a.pinfl === e.pinfl))
                  .map((e) => (
                    <li key={e.pinfl}>
                      <button
                        type="button"
                        onClick={() => setAssignees((list) => [...list, { ...e, role: list.length === 0 ? "Mas'ul" : 'Ijrochi' }])}
                        className="block w-full px-2.5 py-1.5 text-left text-sm hover:bg-(--color-surface-muted)"
                      >
                        <span className="font-medium">{e.fullName}</span>
                        <span className="ml-2 text-xs text-(--color-text-muted)">{[e.position, e.place].filter(Boolean).join(' · ')}</span>
                      </button>
                    </li>
                  ))}
                {found.length === 0 && <li className="px-2.5 py-2 text-xs text-(--color-text-faint)">Xodim topilmadi</li>}
              </ul>
            </div>

            <label className="block">
              <span className={LABEL}>Vazifa / izoh</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={2000}
                className="w-full rounded-(--radius-control) border border-(--color-line) bg-white px-2.5 py-2 text-sm outline-none focus:border-slate-500"
                placeholder="Masalan: yoqilg'i xarajatini 20% qisqartirish, sabablarini aniqlash"
              />
            </label>
          </>
        )}

        <div>
          <span className={LABEL}>Moddalar ({basket.items.length})</span>
          <ul className="max-h-48 space-y-1 overflow-auto">
            {basket.items.map((item) => (
              <li key={markKey(item)} className="flex items-center gap-2 text-sm">
                <KindBadge kind={item.kind} />
                <span className="truncate">{item.label}</span>
              </li>
            ))}
          </ul>
        </div>

        {error && <p className="text-sm text-(--color-expense)">{error}</p>}
      </div>
    </Drawer>
  );
}

// ═══════════════════════════════════════════════════════════
// Yuqoridagi panel — barcha sahifalarda
// ═══════════════════════════════════════════════════════════

export function ReactionBar() {
  const select = useReactionSelect();
  const [panel, setPanel] = useState<'basket' | 'manual' | 'create' | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  if (!select) return null;
  const { active, baskets, current } = select;
  const total = baskets.reduce((s, b) => s + b.items.length, 0);

  if (!active) {
    return (
      <div className="flex items-center justify-end gap-3 border-b border-(--color-line) bg-white px-6 py-1.5">
        {baskets.length > 0 && (
          <span className="text-xs text-(--color-text-muted)">
            {baskets.length} ta savat · {total} ta modda
          </span>
        )}
        <Link href="/munosabat" className="text-xs font-medium text-(--color-text-muted) hover:text-(--color-text)">
          Munosabatlar
        </Link>
        <Link href="/nazorat" className="text-xs font-medium text-(--color-text-muted) hover:text-(--color-text)">
          Nazorat
        </Link>
        <button
          type="button"
          onClick={() => select.setActive(true)}
          className="inline-flex items-center gap-1.5 rounded-(--radius-control) border border-amber-500 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
          title="Belgilash rejimini yoqish: sahifalardagi moddalarni savatga yig'ing"
        >
          <span className="text-sm leading-none">+</span>
          Munosabat
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="sticky top-0 z-30 border-b border-amber-600 bg-amber-50/95 px-6 py-2 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-800">
            <span className="size-2 animate-pulse rounded-full bg-amber-500" />
            Belgilash rejimi
          </span>

          <span className="h-5 w-px bg-amber-300" />

          <label className="flex items-center gap-1.5 text-xs text-amber-900">
            Savat:
            <select
              value={current?.id ?? ''}
              onChange={(e) => {
                if (e.target.value === '__new') setNaming('');
                else select.selectBasket(e.target.value);
              }}
              className="h-8 max-w-[14rem] rounded-(--radius-control) border border-amber-300 bg-white px-2 text-sm text-(--color-text)"
            >
              {baskets.length === 0 && <option value="">— yangi savat —</option>}
              {baskets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.items.length})
                </option>
              ))}
              <option value="__new">+ Yangi savat…</option>
            </select>
          </label>

          {naming !== null ? (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                select.createBasket(naming);
                setNaming(null);
              }}
            >
              <input
                autoFocus
                value={naming}
                onChange={(e) => setNaming(e.target.value)}
                placeholder="Savat nomi, masalan: Mashina xarajatlari"
                maxLength={120}
                className="h-8 w-64 rounded-(--radius-control) border border-amber-400 bg-white px-2 text-sm outline-none"
              />
              <Button size="sm" type="submit">
                Yaratish
              </Button>
              <button type="button" onClick={() => setNaming(null)} className="text-xs text-amber-800 hover:underline">
                bekor
              </button>
            </form>
          ) : (
            current && (
              <button
                type="button"
                onClick={() => {
                  const name = window.prompt('Savat nomi', current.name);
                  if (name) select.renameBasket(current.id, name);
                }}
                className="text-xs text-amber-800 underline-offset-2 hover:underline"
              >
                nomini o&apos;zgartirish
              </button>
            )
          )}

          <span className="text-sm font-semibold text-amber-900">{current?.items.length ?? 0} ta belgilangan</span>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPanel('manual')}>
              Qo&apos;lda qo&apos;shish
            </Button>
            <Button variant="secondary" size="sm" disabled={!current} onClick={() => setPanel('basket')}>
              Savatni ko&apos;rish
            </Button>
            <Button size="sm" disabled={!current || current.items.length === 0} onClick={() => setPanel('create')}>
              Munosabat yaratish
            </Button>
            <Button variant="ghost" size="sm" onClick={() => select.setActive(false)}>
              Tugatish
            </Button>
          </div>
        </div>
        <p className="mt-1 text-xs text-amber-800">
          Sahifalardagi sariq <b>+</b> belgilarini bosing — modda joriy savatga tushadi. Boshqa sahifaga o&apos;tsangiz ham savat saqlanadi.
        </p>
      </div>

      <BasketDrawer basket={current} open={panel === 'basket'} onClose={() => setPanel(null)} />
      <ManualDrawer open={panel === 'manual'} onClose={() => setPanel(null)} />
      <CreateDrawer basket={current} open={panel === 'create'} onClose={() => setPanel(null)} />
    </>
  );
}