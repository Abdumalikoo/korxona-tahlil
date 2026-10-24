'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { IconAlert, IconCheck } from '@/components/ui/icons';
import { LoadingState } from '@/components/ui/states';
import { api, type ApiResponse } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { useState, type FormEvent } from 'react';

// ═══════════════════════════════════════════════════════════
// Sozlamalar › Xavfsizlik — o'chirish paroli.
// Parol so'raladi: «Hammasi» (barcha davrlar) o'chirilganda va 50 tadan ortiq yozuv o'chirilganda.
// Standart parol — 3642. Bazada faqat xeshi saqlanadi.
// ═══════════════════════════════════════════════════════════

interface PasswordInfo {
  isDefault: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  threshold: number;
}

const passwordApi = {
  info: () => api.get<ApiResponse<PasswordInfo>>('/bulk-delete/password'),
  change: (current: string, next: string) => api.patch<ApiResponse<PasswordInfo>>('/bulk-delete/password', { current, next }),
};

export default function SecuritySettingsPage() {
  const { isAdmin } = useAuth();
  const info = useAsync(() => (isAdmin ? passwordApi.info() : Promise.resolve(null)), [isAdmin]);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const mismatch = repeat.length > 0 && next !== repeat;
  const tooShort = next.length > 0 && next.length < 4;
  const canSave = current.length > 0 && next.length >= 4 && next === repeat && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    setOk(false);
    try {
      await passwordApi.change(current, next);
      setCurrent('');
      setNext('');
      setRepeat('');
      setOk(true);
      info.reload();
    } catch (err) {
      setError(errorMessage(err, "Parolni o'zgartirib bo'lmadi"));
    } finally {
      setBusy(false);
    }
  };

  const d = info.data?.data;
  const input = 'mt-1 block h-10 w-full max-w-sm rounded-(--radius-control) border border-(--color-line-strong) bg-white px-3 text-sm focus:border-brand-600 focus:outline-none';

  return (
    <>
      <PageHeader title="Sozlamalar" description="Xavfsizlik — o'chirish paroli" />
      <div className="space-y-4 p-4 md:p-6">
        {!isAdmin ? (
          <p className="rounded-(--radius-control) bg-(--color-warn-soft) px-4 py-2.5 text-sm text-(--color-warn)">Bu sozlamani faqat administrator o&apos;zgartiradi.</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader title="O'chirish paroli" description="Ko'p yozuvni birdan o'chirishdan oldin so'raladi" />
              <CardBody className="space-y-3 text-sm">
                <ul className="list-disc space-y-1 pl-5 text-(--color-text)">
                  <li>
                    Daromadlar yoki Xarajatlarda <b>«Hammasi»</b> (barcha davrlar) o&apos;chirilganda;
                  </li>
                  <li>
                    bir martada <b>{d?.threshold ?? 50} tadan ortiq</b> yozuv o&apos;chirilganda (oy, oraliq yoki belgilanganlar).
                  </li>
                </ul>
                {info.loading && !d ? (
                  <LoadingState />
                ) : d ? (
                  <p className="rounded-(--radius-control) bg-(--color-surface-muted) px-3 py-2 text-xs text-(--color-text-muted)">
                    {d.isDefault ? (
                      <>
                        Hozir <b className="text-heading">standart parol</b> ishlayapti. Xavfsizlik uchun uni o&apos;zgartiring.
                      </>
                    ) : (
                      <>
                        Parol o&apos;zgartirilgan: <b className="text-heading">{d.updatedAt ? formatDateTime(d.updatedAt) : '—'}</b>
                        {d.updatedBy ? ` · ${d.updatedBy}` : ''}
                      </>
                    )}
                  </p>
                ) : null}
                <p className="text-xs text-(--color-text-muted)">
                  Parol 5 marta noto&apos;g&apos;ri kiritilsa — 5 daqiqa kutiladi. Bazada parolning o&apos;zi emas, faqat shifrlangan izi saqlanadi.
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Parolni o'zgartirish" />
              <CardBody>
                <form onSubmit={(e) => void submit(e)} className="space-y-3">
                  <label className="block text-xs font-medium text-(--color-text-muted)">
                    Joriy parol
                    <input type="password" autoComplete="off" value={current} onChange={(e) => setCurrent(e.target.value)} maxLength={64} className={input} />
                  </label>
                  <label className="block text-xs font-medium text-(--color-text-muted)">
                    Yangi parol (4–32 belgi)
                    <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} maxLength={32} className={input} />
                  </label>
                  <label className="block text-xs font-medium text-(--color-text-muted)">
                    Yangi parolni takrorlang
                    <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} maxLength={32} className={input} />
                  </label>
                  {(mismatch || tooShort) && (
                    <p className="text-xs text-(--color-expense)">{tooShort ? "Kamida 4 belgi bo'lsin" : 'Yangi parollar bir xil emas'}</p>
                  )}
                  {error && (
                    <p className="flex items-start gap-2 rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">
                      <IconAlert className="mt-0.5 size-4 shrink-0" />
                      {error}
                    </p>
                  )}
                  {ok && (
                    <p className="flex items-center gap-2 rounded-(--radius-control) bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                      <IconCheck className="size-4" />
                      Parol o&apos;zgartirildi
                    </p>
                  )}
                  <Button type="submit" loading={busy} disabled={!canSave}>
                    Saqlash
                  </Button>
                </form>
              </CardBody>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}