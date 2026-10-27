'use client';

import { ReportCard } from '@/components/report/report';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/error-message';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';
import { qomitaApi, type QomitaConfigView, type QomitaItemView } from './api';

// Qoplanadigan bo'limlar: har bo'lim uchun Qo'mita nimani qoplaydi — ish haqi qismlari va boshqa moddalar.

type ToastState = { message: string; tone: 'success' | 'error' } | null;

export function QomitaSettingsCard({ config, isAdmin, onSaved, setToast }: { config: QomitaConfigView; isAdmin: boolean; onSaved: () => void; setToast: (t: ToastState) => void }) {
  const [edit, setEdit] = useState<QomitaItemView | 'new' | null>(null);
  const [removing, setRemoving] = useState<QomitaItemView | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      const r = (await qomitaApi.removeItem(removing.departmentId)).data;
      setToast({ message: r.warning ?? `${removing.departmentName} — Qo'mita ro'yxatidan olib tashlandi (ish haqi bo'limga qaytdi)`, tone: r.warning ? 'error' : 'success' });
      setRemoving(null);
      onSaved();
    } catch (err) {
      setToast({ message: errorMessage(err, "Olib tashlab bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ReportCard
      title="Qoplanadigan bo'limlar"
      badge={`${config.items.length} ta bo'lim`}
      actions={
        isAdmin ? (
          <Button size="sm" variant="secondary" onClick={() => setEdit('new')}>
            + Bo&apos;lim qo&apos;shish
          </Button>
        ) : undefined
      }
    >
      {config.items.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-(--color-text-muted)">
          Qo&apos;mita qaysi bo&apos;lim xarajatini qoplashini belgilang: masalan, <b>Call-markaz</b> — «Oklad» va «Oklad ustamasi 40%», kerak bo&apos;lsa boshqa moddalar ham.
        </p>
      ) : (
        <ul className="divide-y divide-(--color-line)">
          {config.items.map((i) => (
            <li key={i.departmentId} className="flex flex-wrap items-start gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-heading">{i.departmentName}</p>
                <p className="mt-0.5 text-[11px] text-(--color-text-faint)">Daromad turi: {i.incomeLabel}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {i.components.map((c) => (
                    <span key={c.code} className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-800">
                      ish haqi: {c.name}
                    </span>
                  ))}
                  {i.categories.map((c) => (
                    <span key={c.code} className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                      {c.label}
                    </span>
                  ))}
                  {!i.components.length && !i.categories.length && <span className="text-[11px] text-(--color-text-faint)">hech narsa belgilanmagan</span>}
                </div>
                {i.note && <p className="mt-1 text-xs text-(--color-text-muted)">💬 {i.note}</p>}
              </div>
              {isAdmin && (
                <div className="flex gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => setEdit(i)}>
                    O&apos;zgartirish
                  </Button>
                  <Button size="sm" variant="ghost" className="hover:bg-red-50 hover:text-(--color-expense)" onClick={() => setRemoving(i)}>
                    O&apos;chirish
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {edit !== null && (
        <ItemEditor
          config={config}
          item={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={(msg, warn) => {
            setEdit(null);
            setToast({ message: msg, tone: warn ? 'error' : 'success' });
            onSaved();
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title="Bo'limni Qo'mita ro'yxatidan olib tashlash"
        message={`${removing?.departmentName ?? ''}: ish haqi qismlari bo'lim ish haqiga qaytadi, moddalar umumiy siyosatga o'tadi. Kiritilgan ajratmalar (daromad) o'chirilmaydi.`}
        confirmLabel="Olib tashlash"
        danger
        loading={busy}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </ReportCard>
  );
}

function ItemEditor({ config, item, onClose, onSaved }: { config: QomitaConfigView; item: QomitaItemView | null; onClose: () => void; onSaved: (message: string, warn: boolean) => void }) {
  const used = new Set(config.items.map((i) => i.departmentId));
  const deps = config.departments.filter((d) => !used.has(d.id) || d.id === item?.departmentId);
  const [dep, setDep] = useState(item?.departmentId ?? '');
  const [comps, setComps] = useState<Set<string>>(() => new Set(item?.components.map((c) => c.code) ?? []));
  const [cats, setCats] = useState<Set<string>>(() => new Set(item?.categories.map((c) => c.code) ?? []));
  const [note, setNote] = useState(item?.note ?? '');
  const [find, setFind] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flip = (set: Set<string>, setter: (s: Set<string>) => void, code: string) => {
    const next = new Set(set);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setter(next);
  };
  const catList = useMemo(() => {
    const f = find.trim().toLowerCase();
    const list = config.categories.filter((c) => !f || `${c.label} ${c.group ?? ''} ${c.code}`.toLowerCase().includes(f));
    return [...list.filter((c) => cats.has(c.code)), ...list.filter((c) => !cats.has(c.code))].slice(0, 200);
  }, [config.categories, find, cats]);

  async function save() {
    setError(null);
    if (!dep) return setError("Bo'limni tanlang");
    if (!comps.size && !cats.size) return setError('Nima qoplanadi — ish haqi qismi yoki moddani belgilang');
    setSaving(true);
    try {
      const r = (await qomitaApi.saveItem({ departmentId: dep, components: [...comps], categories: [...cats], note: note.trim() || undefined })).data;
      const name = config.departments.find((d) => d.id === dep)?.name ?? '';
      onSaved(r.warning ?? `${name}: saqlandi${r.recalculated ? " — ish haqi qayta hisoblandi" : ''}`, Boolean(r.warning));
    } catch (err) {
      setError(errorMessage(err, "Saqlab bo'lmadi"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      width="lg"
      onClose={onClose}
      title={item ? `${item.departmentName}: Qo'mita nimani qoplaydi` : "Qoplanadigan bo'lim qo'shish"}
      description="Belgilangan ish haqi qismlari bo'lim ish haqidan ajratilib Qo'mita hisobiga o'tadi; moddalar — bo'lim siyosati orqali"
      footer={
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-(--color-text-muted)">Ish haqi qismlari o&apos;zgarsa — hamma oylar qayta hisoblanadi (biroz vaqt oladi)</span>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Bekor
          </Button>
          <Button data-save onClick={() => void save()} loading={saving}>
            Saqlash
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Select label="Bo'lim (Markaz)" required value={dep} disabled={Boolean(item)} onChange={(e) => setDep(e.target.value)} placeholder="Tanlang…" options={deps.map((d) => ({ value: d.id, label: d.name }))} />

        <section>
          <h4 className="text-sm font-semibold text-heading">Ish haqi qismlari</h4>
          <p className="mb-2 text-xs text-(--color-text-muted)">Shu bo&apos;lim xodimlarining ish haqi tarkibidan har oy olinadi (masalan, Oklad va Oklad ustamasi 40%).</p>
          <div className="grid gap-1 sm:grid-cols-2">
            {config.components.map((c) => (
              <label key={c.code} className={cn('flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm', comps.has(c.code) ? 'border-brand-500 bg-brand-50 font-medium text-brand-900' : 'border-(--color-line) hover:bg-[#f7f9fc]')}>
                <input type="checkbox" checked={comps.has(c.code)} onChange={() => flip(comps, setComps, c.code)} className="size-3.5" />
                {c.name}
              </label>
            ))}
            {!config.components.length && <p className="text-xs text-(--color-text-faint)">Ish haqi tarkibi komponentlari yo&apos;q</p>}
          </div>
        </section>

        <section>
          <h4 className="text-sm font-semibold text-heading">Boshqa moddalar {cats.size > 0 && <span className="font-normal text-(--color-text-muted)">· {cats.size} ta tanlangan</span>}</h4>
          <p className="mb-2 text-xs text-(--color-text-muted)">Shu bo&apos;limda yozilgan bu moddalardagi xarajat Qo&apos;mita hisobidan bo&apos;ladi (guruh tanlansa — ichidagilar ham).</p>
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Moddani qidirish…" data-skip-focus className="mb-2 h-8 w-full rounded-md border border-(--color-line-strong) bg-white px-2 text-sm" />
          <div className="max-h-72 space-y-0.5 overflow-y-auto rounded-lg border border-(--color-line) p-1.5">
            {catList.map((c) => (
              <label key={c.code} className={cn('flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm', cats.has(c.code) ? 'bg-amber-50 font-medium text-amber-900' : 'hover:bg-[#f7f9fc]')}>
                <input type="checkbox" checked={cats.has(c.code)} onChange={() => flip(cats, setCats, c.code)} className="size-3.5" />
                <span className={cn('min-w-0 flex-1', !c.isLeaf && 'font-semibold')}>{c.label}</span>
                {c.group && <span className="truncate text-[11px] text-(--color-text-faint)">{c.group}</span>}
              </label>
            ))}
            {!catList.length && <p className="px-2 py-1 text-xs text-(--color-text-faint)">Topilmadi</p>}
          </div>
        </section>

        <Input label="Izoh" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Masalan: Qo'mita qarori № …" maxLength={300} />
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-(--color-expense)">{error}</p>}
      </div>
    </Drawer>
  );
}
