'use client';

import { PageHeader } from '@/components/layout/page-header';
import { MoneyInput } from '@/components/shared/money-input';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconTrash } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Table, TBody, Td, TFoot, Th, THead, Tr } from '@/components/ui/table';
import { Toast } from '@/components/ui/toast';
import { warehouseApi, type PostalPayment } from '@/features/warehouse/api';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatTiyin, todayInput } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { useEffect, useRef, useState, type FormEvent } from 'react';

// ═══════════════════════════════════════════════════════════
// Ombor › Pochta: qaysi pochta korxonasiga, qancha, qachon to'landi — tamom.
// Har to'lov Xarajatlarga yoziladi (modda: «Ombor: pochta xizmatlari», manba: Ombor).
// Korxona va to'lov usuli eslab qolinadi — keyingi safar faqat summa yoziladi.
// ═══════════════════════════════════════════════════════════

const KEY = 'korxona_postal_last';
const METHODS = [
  { value: 'CASH', label: 'Naqd' },
  { value: 'BANK', label: "Bank (o'tkazma)" },
  { value: 'CARD', label: 'Karta' },
  { value: 'OTHER', label: 'Boshqa' },
];
const METHOD_LABEL: Record<string, string> = Object.fromEntries(METHODS.map((m) => [m.value, m.label]));

export default function PostalPage() {
  const { canWrite } = useAuth();
  const editable = canWrite('/ombor');
  const { range } = usePeriod();
  const list = useAsync(() => warehouseApi.postal(range.from, range.to), [range.from, range.to]);

  const [date, setDate] = useState(todayInput());
  const [company, setCompany] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState('CASH');
  const [documentNo, setDocumentNo] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [cancel, setCancel] = useState<PostalPayment | null>(null);
  const [busy, setBusy] = useState(false);
  const amountBox = useRef<HTMLDivElement>(null);

  // Oxirgi korxona va to'lov usuli
  useEffect(() => {
    try {
      const p = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as { company?: string; method?: string };
      if (p.company) setCompany(p.company);
      if (p.method) setMethod(p.method);
    } catch {
      // eslab qolinmagan
    }
  }, []);

  const data = list.data?.data;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    if (!company.trim()) return setError('Pochta korxonasini yozing');
    if (!amount || amount <= 0) return setError('Summani kiriting');
    setSaving(true);
    try {
      const r = await warehouseApi.createPostal({
        date,
        company: company.trim(),
        amountTiyin: String(Math.round(amount * 100)),
        paymentMethod: method,
        documentNo: documentNo.trim() || null,
        note: note.trim() || null,
      });
      try {
        window.localStorage.setItem(KEY, JSON.stringify({ company: company.trim(), method }));
      } catch {
        // eslab qolinmasa ham bo'ladi
      }
      setToast(`${r.data.company}: ${formatTiyin(r.data.amountTiyin)} so'm saqlandi`);
      setAmount(null);
      setDocumentNo('');
      setNote('');
      list.reload();
      setTimeout(() => amountBox.current?.querySelector('input')?.focus(), 50);
    } catch (err) {
      setError(errorMessage(err, "Saqlab bo'lmadi"));
    } finally {
      setSaving(false);
    }
  };

  const doCancel = async () => {
    if (!cancel) return;
    setBusy(true);
    try {
      await warehouseApi.cancelPostal(cancel.id);
      setToast("To'lov bekor qilindi");
      setCancel(null);
      list.reload();
    } catch (err) {
      setError(errorMessage(err, "Bekor qilib bo'lmadi"));
      setCancel(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Pochta" description={`Pochta korxonalariga to'lovlar · ${formatDate(range.from)} – ${formatDate(range.to)}`} />

      <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
        {editable && (
          <Card className="p-5">
            <form onSubmit={(e) => void submit(e)} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[9rem_1fr_11rem_10rem]">
                <Input label="Sana" type="date" value={date} max={todayInput()} onChange={(e) => setDate(e.target.value)} />
                <div>
                  <Input label="Pochta korxonasi" value={company} onChange={(e) => setCompany(e.target.value)} list="postal-companies" placeholder="O'zbekiston pochtasi" />
                  <datalist id="postal-companies">
                    {(data?.companies ?? []).map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
                <div ref={amountBox}>
                  <MoneyInput label="Summa, so'm" value={amount} onChange={setAmount} autoFocus={Boolean(company)} />
                </div>
                <Select label="To'lov usuli" value={method} onChange={(e) => setMethod(e.target.value)} options={METHODS} />
              </div>
              <div className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
                <Input label="Kvitansiya № (ixtiyoriy)" value={documentNo} onChange={(e) => setDocumentNo(e.target.value)} />
                <Input label="Izoh (ixtiyoriy)" value={note} onChange={(e) => setNote(e.target.value)} />
                <Button type="submit" size="lg" loading={saving}>
                  Saqlash
                </Button>
              </div>
              {error && <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">{error}</p>}
              <p className="text-xs text-(--color-text-muted)">Xarajatlarga «Ombor: pochta xizmatlari» moddasi bilan yoziladi. Korxona va to&apos;lov usuli eslab qolinadi.</p>
            </form>
          </Card>
        )}

        {data && data.byCompany.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {data.byCompany.map((c) => (
              <span key={c.company} className="rounded-full border border-(--color-line) bg-white px-3 py-1 text-xs">
                <b className="text-heading">{c.company}</b> · {c.count} ta · <span className="money">{formatTiyin(c.totalTiyin)}</span>
              </span>
            ))}
          </div>
        )}

        <Card className="overflow-hidden">
          <CardHeader title="To'lovlar" description="Davr — yuqoridagi «Davr» tugmasidan" />
          {list.loading && !list.data ? (
            <TableSkeleton rows={4} cols={5} />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : !data || data.items.length === 0 ? (
            <EmptyState title="Bu davrda pochta to'lovi yo'q" hint="period" />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th className="w-28">Sana</Th>
                  <Th>Korxona</Th>
                  <Th className="w-32">To&apos;lov</Th>
                  <Th className="w-44">Kiritdi</Th>
                  <Th className="w-40" align="right">
                    Summa, so&apos;m
                  </Th>
                  {editable && <Th className="w-12" />}
                </Tr>
              </THead>
              <TBody>
                {data.items.map((p) => (
                  <Tr key={p.id}>
                    <Td>{formatDate(p.date)}</Td>
                    <Td>
                      <span className="font-medium text-heading">{p.company}</span>
                      {(p.documentNo || p.note) && <p className="text-xs text-(--color-text-muted)">{[p.documentNo && `№ ${p.documentNo}`, p.note].filter(Boolean).join(' · ')}</p>}
                    </Td>
                    <Td className="text-(--color-text-muted)">{METHOD_LABEL[p.paymentMethod] ?? p.paymentMethod}</Td>
                    <Td className="truncate text-xs text-(--color-text-muted)">{p.createdByName ?? '—'}</Td>
                    <Td align="right" money className="font-semibold">
                      {formatTiyin(p.amountTiyin)}
                    </Td>
                    {editable && (
                      <Td className="pr-3 text-right">
                        <button type="button" onClick={() => setCancel(p)} className="rounded p-1.5 text-(--color-text-muted) hover:bg-red-50 hover:text-red-600" title="Bekor qilish">
                          <IconTrash className="size-4" />
                        </button>
                      </Td>
                    )}
                  </Tr>
                ))}
              </TBody>
              <TFoot>
                <Tr>
                  <Td colSpan={4} className="font-semibold">
                    Jami: {data.items.length} ta to&apos;lov
                  </Td>
                  <Td align="right" money className="font-bold">
                    {formatTiyin(data.totalTiyin)}
                  </Td>
                  {editable && <Td />}
                </Tr>
              </TFoot>
            </Table>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={Boolean(cancel)}
        danger
        loading={busy}
        title="To'lovni bekor qilish"
        message={cancel ? `${cancel.company} — ${formatTiyin(cancel.amountTiyin)} so'm (${formatDate(cancel.date)}). Xarajatlardagi yozuvi ham bekor bo'ladi.` : ''}
        confirmLabel="Bekor qilish"
        cancelLabel="Yo'q"
        onConfirm={() => void doCancel()}
        onCancel={() => setCancel(null)}
      />
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </>
  );
}