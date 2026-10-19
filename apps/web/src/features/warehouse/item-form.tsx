'use client';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatTiyin } from '@/lib/format';
import { useEffect, useId, useState } from 'react';
import { ITEM_KIND_LABELS, qtyText, warehouseApi, type ItemKind, type WarehouseItem, type WarehouseLookups } from './api';
import { Field } from './bits';

// ═══════════════════════════════════════════════════════════
// Buyum (ma'lumotnoma) formasi: nomi, turi (TMZ / asosiy vosita), o'lchov, guruh,
// xarajat moddasi (kirim shu moddaga yoziladi), minimal qoldiq.
// O'chirish: hujjatda ishlatilgan bo'lsa — arxivga o'tadi (tarix saqlanadi).
// ═══════════════════════════════════════════════════════════

export function ItemForm({
  open,
  item,
  lookups,
  defaultKind = 'TMZ',
  initialName,
  onClose,
  onSaved,
  onCreated,
}: {
  open: boolean;
  /** null — yangi buyum */
  item: WarehouseItem | null;
  lookups: WarehouseLookups | null;
  defaultKind?: ItemKind;
  /** Kirim formasidan «+ Yangi buyum» bosilganda — yozilgan nom */
  initialName?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
  /** Yangi buyum yaratilganda (kirim qatoriga darhol qo'yish uchun) */
  onCreated?: (item: WarehouseItem) => void;
}) {
  const { canWrite } = useAuth();
  /** Kiritish huquqi: administrator yoki Omborchi */
  const isAdmin = canWrite('/ombor');
  const groupListId = useId();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ItemKind>(defaultKind);
  const [unit, setUnit] = useState('dona');
  const [group, setGroup] = useState('');
  const [categoryCode, setCategoryCode] = useState('');
  const [minQty, setMinQty] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categories = lookups?.categories ?? [];
  const warehouseCats = categories.filter((c) => c.parentCode === 'WAREHOUSE');

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(item?.name ?? initialName ?? '');
    setKind(item?.kind ?? defaultKind);
    setUnit(item?.unit ?? 'dona');
    setGroup(item?.group ?? '');
    setCategoryCode(item?.categoryCode ?? '');
    setMinQty(item?.minQty != null ? String(item.minQty) : '');
    setNote(item?.note ?? '');
  }, [open, item, defaultKind, initialName]);

  // Turi o'zgarganda — mos ombor moddasi tavsiya qilinadi
  useEffect(() => {
    if (!open || item || categoryCode) return;
    const guess = kind === 'ASSET' ? 'WH_COMPUTER' : 'WH_STATIONERY';
    if (warehouseCats.some((c) => c.code === guess)) setCategoryCode(guess);
  }, [open, item, kind, categoryCode, warehouseCats]);

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError('Nomini yozing');
    if (!categoryCode) return setError('Xarajat moddasini tanlang');
    const min = minQty.trim() ? Number(minQty.replace(',', '.')) : null;
    if (min !== null && (!Number.isFinite(min) || min < 0)) return setError("Minimal qoldiq noto'g'ri");
    setSaving(true);
    try {
      const payload = { name: name.trim(), kind, unit, group: group.trim() || null, categoryCode, minQty: min, note: note.trim() || null };
      if (item) {
        await warehouseApi.updateItem(item.id, payload);
        onSaved(`«${payload.name}» saqlandi`);
      } else {
        const r = await warehouseApi.createItem(payload);
        onCreated?.(r.data);
        onSaved(`«${r.data.name}» qo'shildi (${r.data.code})`);
      }
    } catch (err) {
      setError(errorMessage(err, "Saqlab bo'lmadi"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!item) return;
    setRemoving(true);
    try {
      const r = await warehouseApi.removeItem(item.id);
      setConfirm(false);
      onSaved(r.data.archived ? `«${item.name}» hujjatlarda ishlatilgan — arxivga o'tkazildi` : `«${item.name}» o'chirildi`);
    } catch (err) {
      setConfirm(false);
      setError(errorMessage(err, "O'chirib bo'lmadi"));
    } finally {
      setRemoving(false);
    }
  };

  const restore = async () => {
    if (!item) return;
    setSaving(true);
    try {
      await warehouseApi.updateItem(item.id, { isActive: true });
      onSaved(`«${item.name}» qayta faollashtirildi`);
    } catch (err) {
      setError(errorMessage(err, "Saqlab bo'lmadi"));
    } finally {
      setSaving(false);
    }
  };

  const categoryOptions = [
    { value: '', label: '— moddani tanlang —' },
    ...warehouseCats.map((c) => ({ value: c.code, label: `Ombor › ${c.label}` })),
    ...categories.filter((c) => c.parentCode !== 'WAREHOUSE').map((c) => ({ value: c.code, label: c.label })),
  ];

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={item ? `${item.code} · ${item.name}` : 'Yangi buyum'}
        description="Ma'lumotnoma: bir marta kiritiladi, keyin kirim va chiqim hujjatlarida tanlanadi."
        footer={
          isAdmin ? (
            <>
              {item && item.isActive && (
                <Button variant="ghost" className="mr-auto text-(--color-expense)" onClick={() => setConfirm(true)}>
                  O&apos;chirish
                </Button>
              )}
              {item && !item.isActive && (
                <Button variant="ghost" className="mr-auto" onClick={() => void restore()} disabled={saving}>
                  Qayta faollashtirish
                </Button>
              )}
              <Button variant="secondary" onClick={onClose} disabled={saving}>
                Bekor qilish
              </Button>
              <Button onClick={() => void submit()} loading={saving}>
                Saqlash
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={onClose}>
              Yopish
            </Button>
          )
        }
      >
        <div className="space-y-4">
          {item && (
            <div className="grid grid-cols-3 gap-3 rounded-(--radius-control) bg-(--color-surface-muted) p-3">
              <Field label="Omborda">
                {qtyText(item.inStock)} {item.unit}
              </Field>
              <Field label={item.kind === 'ASSET' ? 'Foydalanishda' : "O'rtacha narx"}>
                {item.kind === 'ASSET' ? `${item.inUse} dona` : `${formatTiyin(item.avgPriceTiyin)} so'm`}
              </Field>
              <Field label="Qoldiq qiymati">
                <span className="money">{formatTiyin(item.stockValueTiyin)} so&apos;m</span>
              </Field>
            </div>
          )}

          <Input label="Nomi" value={name} onChange={(e) => setName(e.target.value)} placeholder="Masalan: A4 qog'oz «Svetocopy»" required disabled={!isAdmin} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Turi"
              value={kind}
              disabled={Boolean(item) || !isAdmin}
              onChange={(e) => {
                const next = e.target.value as ItemKind;
                setKind(next);
                if (next === 'ASSET') setUnit('dona');
              }}
              options={(['TMZ', 'ASSET'] as const).map((k) => ({ value: k, label: ITEM_KIND_LABELS[k] }))}
              hint={kind === 'ASSET' ? 'Har donasiga inventar raqami beriladi, kimda turgani kuzatiladi' : 'Sarflanadigan buyum: qog\'oz, kartrij, xo\'jalik mollari…'}
            />
            <Select
              label="O'lchov birligi"
              value={unit}
              disabled={kind === 'ASSET' || !isAdmin}
              onChange={(e) => setUnit(e.target.value)}
              options={(lookups?.units ?? ['dona']).map((u) => ({ value: u, label: u }))}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Input label="Guruh" value={group} onChange={(e) => setGroup(e.target.value)} list={groupListId} placeholder="Kompyuter texnikasi, mebel…" disabled={!isAdmin} />
              <datalist id={groupListId}>
                {(lookups?.groups ?? []).map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>
            <Input
              label="Minimal qoldiq"
              value={minQty}
              onChange={(e) => setMinQty(e.target.value)}
              inputMode="decimal"
              suffix={unit}
              hint="Shundan kamaysa — «Kam qolgan» ro'yxatida chiqadi"
              disabled={!isAdmin}
            />
          </div>

          <Select
            label="Xarajat moddasi"
            value={categoryCode}
            onChange={(e) => setCategoryCode(e.target.value)}
            options={categoryOptions}
            hint="Kirim summasi Xarajatlarga shu modda bilan yoziladi"
            disabled={!isAdmin}
          />

          <Input label="Izoh" value={note} onChange={(e) => setNote(e.target.value)} disabled={!isAdmin} />

          {error && <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">{error}</p>}
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirm}
        danger
        loading={removing}
        title="Buyumni o'chirish"
        message="Hujjatlarda ishlatilmagan bo'lsa — o'chiriladi. Ishlatilgan bo'lsa — arxivga o'tadi: tarix va qoldiq saqlanadi, yangi kirimda tanlanmaydi."
        confirmLabel="O'chirish"
        onConfirm={() => void remove()}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}