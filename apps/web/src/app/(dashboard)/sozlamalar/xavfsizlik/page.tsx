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
// Sozlamalar › Xavfsizlik — o'chirish paroli va kuzatuvchi huquqlari.
// Parol so'raladi: «Hammasi» (barcha davrlar) o'chirilganda va 50 tadan ortiq yozuv o'chirilganda.
// Standart parol hammaga ma'lum — u almashtirilmaguncha ko'p yozuvni o'chirish yopiq. Bazada faqat xeshi saqlanadi.
// Kuzatuvchi: shaxsiy ma'lumotlar (xodimlar ro'yxati, JShShIR, shaxsiy ish haqi) standart bo'yicha yopiq.
// ═══════════════════════════════════════════════════════════

interface PasswordInfo {
  isDefault: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  threshold: number;
}

interface SecurityStatus {
  viewerPersonal: boolean;
  deletePasswordDefault: boolean;
  chatCodeDefault: boolean;
  warnings: string[];
}

const securityApi = {
  status: () => api.get<ApiResponse<SecurityStatus>>('/security/status'),
  setViewerPersonal: (enabled: boolean) => api.patch<ApiResponse<SecurityStatus>>('/security/viewer-personal', { enabled }),
};

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
  const sec = useAsync(() => (isAdmin ? securityApi.status() : Promise.resolve(null)), [isAdmin]);
  const [secBusy, setSecBusy] = useState(false);
  const [secError, setSecError] = useState<string | null>(null);
  const toggleViewer = async (enabled: boolean) => {
    setSecBusy(true);
    setSecError(null);
    try {
      await securityApi.setViewerPersonal(enabled);
      sec.reload();
    } catch (err) {
      setSecError(errorMessage(err, "Sozlamani saqlab bo'lmadi"));
    } finally {
      setSecBusy(false);
    }
  };
  const viewerOpen = sec.data?.data?.viewerPersonal ?? false;

  const mismatch = repeat.length > 0 && next !== repeat;
  const tooShort = next.length > 0 && next.length < 6;
  const canSave = current.length > 0 && next.length >= 6 && next === repeat && !busy;

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
      sec.reload();
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
      <PageHeader title="Sozlamalar" description="Xavfsizlik — o'chirish paroli va kuzatuvchi huquqlari" />
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
                      <span className="text-(--color-warn)">
                        Hozir <b>standart parol</b> turibdi — u hammaga ma&apos;lum. Yangi parol o&apos;rnatilmaguncha ko&apos;p yozuvni o&apos;chirish <b>yopiq</b>. Joriy parol maydoniga standart parolni yozib, yangisini o&apos;rnating.
                      </span>
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
                    Yangi parol (6–32 belgi, oddiy ketma-ketlik emas)
                    <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} maxLength={32} className={input} />
                  </label>
                  <label className="block text-xs font-medium text-(--color-text-muted)">
                    Yangi parolni takrorlang
                    <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} maxLength={32} className={input} />
                  </label>
                  {(mismatch || tooShort) && (
                    <p className="text-xs text-(--color-expense)">{tooShort ? "Kamida 6 belgi bo'lsin" : 'Yangi parollar bir xil emas'}</p>
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

            <Card className="lg:col-span-2">
              <CardHeader title="Kuzatuvchi va shaxsiy ma'lumotlar" description="Kuzatuvchi (faqat ko'radigan) rol uchun" />
              <CardBody className="space-y-3 text-sm">
                <p className="text-(--color-text)">
                  Standart bo&apos;yicha kuzatuvchiga <b>yopiq</b>: xodimlar ro&apos;yxati va kartasi, JShShIR, ko&apos;chishlar, shaxsiy ish haqi va tarkibi, oy natijalari (xodim bo&apos;yicha). Tuman va
                  bo&apos;lim tahlilida xodimlar ko&apos;rinadi, lekin JShShIR yashiriladi (oxirgi 4 raqami qoladi). Umumiy summalar va hisobotlar ochiq.
                </p>
                {sec.loading && !sec.data ? (
                  <LoadingState />
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={viewerOpen ? 'rounded-full bg-(--color-warn-soft) px-3 py-1 text-xs font-semibold text-(--color-warn)' : 'rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800'}>
                      {viewerOpen ? "Hozir: kuzatuvchi shaxsiy ma'lumotlarni ko'radi" : "Hozir: kuzatuvchiga yopiq"}
                    </span>
                    <Button variant="secondary" loading={secBusy} onClick={() => void toggleViewer(!viewerOpen)}>
                      {viewerOpen ? 'Yopish' : 'Kuzatuvchiga ochish'}
                    </Button>
                  </div>
                )}
                {secError && <p className="text-xs text-(--color-expense)">{secError}</p>}
                <p className="text-xs text-(--color-text-muted)">O&apos;zgarish 30 soniya ichida kuchga kiradi va tarixga yoziladi.</p>
              </CardBody>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}