'use client';

import { PageHeader } from '@/components/layout/page-header';
import { sum } from '@/components/report/report';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { MonthRangeCard, useMonthRange } from '@/features/units/month-range';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatDateTime, formatPeriod, parseSum, sumToTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { useState } from 'react';
import { downloadExcluded, excludedApi, type ExcludedItem, type ExcludedKind } from './api';

// ═══════════════════════════════════════════════════════════
// Daromadlar › Hisobga olinmaydigan tushumlar: depozitga yo'naltirilgan mablag'lar va ustav fondini shakllantirish.
// Shu yerda ko'rinadi va kiritiladi, lekin DAROMAD EMAS — jami daromad, natija, rentabellik va hisobotlarga qo'shilmaydi.
// ═══════════════════════════════════════════════════════════

type ToastState = { message: string; tone: 'success' | 'error' } | null;

const KIND_OPTIONS: { value: ExcludedKind; label: string }[] = [
  { value: 'DEPOZIT', label: "Depozitga yo'naltirilgan mablag'lar" },
  { value: 'USTAV_FONDI', label: 'Ustav fondini shakllantirish' },
];
const kindLabel = (k: ExcludedKind) => KIND_OPTIONS.find((o) => o.value === k)?.label ?? k;
const today = () => new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);

export function ExcludedIncomesPage() {
  const { isAdmin } = useAuth();
  const range = useMonthRange('year');
  const res = useAsync(() => (range.error ? Promise.resolve(null) : excludedApi.list(range.from, range.to).then((r) => r.data)), [range.from, range.to, range.error]);
  const [editing, setEditing] = useState<ExcludedItem | 'new' | null>(null);
  const [removing, setRemoving] = useState<ExcludedItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  async function download() {
    setBusy(true);
    try {
      await downloadExcluded(range.from, range.to);
    } catch (err) {
      setToast({ message: errorMessage(err, "Yuklab bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await excludedApi.remove(removing.id);
      setToast({ message: "Yozuv o'chirildi", tone: 'success' });
      setRemoving(null);
      res.reload();
    } catch (err) {
      setToast({ message: errorMessage(err, "O'chirib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const d = res.data;
  return (
    <>
      <PageHeader title="Hisobga olinmaydigan tushumlar" description="Depozit va ustav fondi — ko'rinadi, lekin daromadga qo'shilmaydi" />
      <div className="space-y-4 p-4 md:p-6">
        <div className="rounded-(--radius-card) border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Bu summalar <b>daromad emas</b>: jami daromad, natija, rentabellik, hisobotlar va prognozlarga qo&apos;shilmaydi. Faqat shu yerda va Daromadlar
          sahifasidagi «Hisobga olinmaydi» qatorida ko&apos;rinadi.
        </div>
        <MonthRangeCard range={range} />
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && <Button onClick={() => setEditing('new')}>+ Tushum kiritish</Button>}
          <Button variant="secondary" onClick={() => void download()} loading={busy && !removing} disabled={Boolean(range.error) || busy}>
            Excel
          </Button>
        </div>
        {res.error ? (
          <ErrorState message={res.error} onRetry={res.reload} />
        ) : !d ? (
          <LoadingState label="Tushumlar yuklanmoqda" />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Card className="p-4">
                <p className="text-xs font-semibold text-(--color-text-muted)">Jami (hisobga olinmaydi)</p>
                <p className="money mt-1.5 text-[26px] leading-tight font-bold text-heading">{sum(d.totalTiyin)}</p>
                <p className="mt-1 text-xs text-(--color-text-muted)">so&apos;m · {d.items.length} ta yozuv</p>
              </Card>
              {d.kinds.map((k) => (
                <Card key={k.code} className="p-4">
                  <p className="text-xs font-semibold text-(--color-text-muted)">{k.label}</p>
                  <p className="money mt-1.5 text-[26px] leading-tight font-bold text-heading">{sum(k.totalTiyin)}</p>
                  <p className="mt-1 text-xs text-(--color-text-muted)">so&apos;m</p>
                </Card>
              ))}
            </div>

            <Card className="overflow-hidden">
              <CardHeader title="Oyma-oy" description="Tur bo'yicha, so'm" />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-(--color-surface-muted) text-[10.5px] tracking-wide text-(--color-text-muted) uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Oy</th>
                      {d.kinds.map((k) => (
                        <th key={k.code} className="px-3 py-2 text-right font-semibold">
                          {k.label}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right font-semibold">Jami</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.months.map((m) => (
                      <tr key={m.period} className="border-t border-(--color-line)">
                        <td className="px-3 py-1.5 font-medium text-heading">{formatPeriod(m.period)}</td>
                        {d.kinds.map((k) => (
                          <td key={k.code} className="money px-3 py-1.5 text-right">
                            {m.byKind[k.code] !== '0' ? sum(m.byKind[k.code]) : <span className="text-(--color-text-faint)">—</span>}
                          </td>
                        ))}
                        <td className="money px-3 py-1.5 text-right font-semibold">{m.totalTiyin !== '0' ? sum(m.totalTiyin) : <span className="text-(--color-text-faint)">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="overflow-hidden">
              <CardHeader title="Yozuvlar" description="Kim, qachon kiritgani bilan" />
              {d.items.length ? (
                <ul className="divide-y divide-(--color-line) text-sm">
                  {d.items.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
                      <span className="w-24 text-xs text-(--color-text-muted) tabular-nums">{formatDate(i.date)}</span>
                      <Badge tone={i.kind === 'DEPOZIT' ? 'neutral' : 'warn'}>{kindLabel(i.kind)}</Badge>
                      <span className="min-w-0 flex-1 truncate text-(--color-text-muted)" title={i.note ?? ''}>
                        {i.note ?? ''}
                      </span>
                      <span className="text-xs text-(--color-text-faint)" title={i.updatedAt ? `O'zgartirgan: ${i.updatedBy} · ${formatDateTime(i.updatedAt)}` : undefined}>
                        {i.createdBy} · {formatDateTime(i.createdAt)}
                        {i.updatedAt ? ' · tahrirlangan' : ''}
                      </span>
                      <span className="money w-36 text-right font-semibold text-heading">{sum(i.amountTiyin)}</span>
                      {isAdmin && (
                        <span className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setEditing(i)}>
                            Tahrirlash
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setRemoving(i)}>
                            O&apos;chirish
                          </Button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <CardBody className="text-sm text-(--color-text-muted)">Bu davrda yozuv yo&apos;q.</CardBody>
              )}
            </Card>
          </>
        )}
      </div>

      {editing && (
        <ExcludedDrawer
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setToast({ message, tone: 'success' });
            res.reload();
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        title="Yozuvni o'chirish"
        message={removing ? `${kindLabel(removing.kind)}, ${formatDate(removing.date)} — ${sum(removing.amountTiyin)} so'm. O'chirilsinmi?` : ''}
        confirmLabel="O'chirish"
        danger
        loading={busy}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </>
  );
}

function ExcludedDrawer({ item, onClose, onSaved }: { item: ExcludedItem | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [kind, setKind] = useState<ExcludedKind>(item?.kind ?? 'DEPOZIT');
  const [date, setDate] = useState(item?.date ?? today());
  const [amount, setAmount] = useState(item ? String(Number(item.amountTiyin) / 100) : '');
  const [note, setNote] = useState(item?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError('Sanani tanlang');
    const value = parseSum(amount);
    if (!value || value.lte(0)) return setError('Summani kiriting');
    const body = { kind, date, amountTiyin: String(sumToTiyin(value)), note: note.trim() || undefined };
    setSaving(true);
    try {
      if (item) await excludedApi.update(item.id, body);
      else await excludedApi.create(body);
      onSaved(`${item ? "O'zgartirildi" : 'Yozildi'}: ${kindLabel(kind)} — ${sum(body.amountTiyin)} so'm (daromadga qo'shilmaydi)`);
    } catch (err) {
      setError(errorMessage(err, "Saqlab bo'lmadi"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={item ? 'Tushumni tahrirlash' : 'Hisobga olinmaydigan tushum'}
      description="Daromadlarda ko'rinadi, lekin jami daromad va natijaga qo'shilmaydi"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Bekor
          </Button>
          <Button data-save onClick={() => void save()} loading={saving}>
            Saqlash
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Select label="Turi" required value={kind} onChange={(e) => setKind(e.target.value as ExcludedKind)} options={KIND_OPTIONS} />
        <Input label="Sana" required type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Input label="Summa" required money inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} suffix="so'm" placeholder="0" />
        <Input label="Izoh" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Masalan: bank depozitiga 6 oyga" maxLength={500} />
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-(--color-expense)">{error}</p>}
      </div>
    </Drawer>
  );
}
