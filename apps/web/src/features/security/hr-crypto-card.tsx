'use client';

import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconAlert, IconCheck } from '@/components/ui/icons';
import { LoadingState } from '@/components/ui/states';
import { api, type ApiResponse } from '@/lib/api';
import { errorMessage } from '@/lib/error-message';
import { useAsync } from '@/lib/use-async';
import { useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Sozlamalar › Xavfsizlik — ma'lumotnomalardagi shaxsiy maydonlarni (pasport, telefon, manzil …) bazada shifrlash.
//  • Kalit (APP_ENCRYPTION_KEY) bo'lsa, yangi yuklangan jadvallar o'zi shifrlanadi.
//  • «Hozir shifrlash» — avval yuklanganlarini ham (oldin zaxira olinadi).
//  • «Shifrdan chiqarish» — orqaga qaytarish, o'chirish paroli bilan.
// ═══════════════════════════════════════════════════════════

interface HrCrypto {
  ready: boolean;
  sealed: number;
  plain: number;
  unreadable: number;
}

const hrCryptoApi = {
  status: () => api.get<ApiResponse<HrCrypto>>('/security/hr-crypto'),
  seal: () => api.post<ApiResponse<HrCrypto & { done: number; backup: string }>>('/security/hr-crypto/seal'),
  unseal: (password: string) => api.post<ApiResponse<HrCrypto & { done: number }>>('/security/hr-crypto/unseal', { password }),
};

const fmt = (n: number) => n.toLocaleString('ru-RU').replace(/,/g, ' ');

export function HrCryptoCard({ onChanged }: { onChanged?: () => void }) {
  const st = useAsync(() => hrCryptoApi.status(), []);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [unsealOpen, setUnsealOpen] = useState(false);
  const [password, setPassword] = useState('');

  const d = st.data?.data;
  const total = d ? d.sealed + d.plain : 0;

  const seal = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = (await hrCryptoApi.seal()).data;
      setMsg({ ok: true, text: r.done ? `${fmt(r.done)} ta qiymat shifrlandi. Oldin olingan zaxira: ${r.backup}` : "Shifrlanadigan yangi qiymat yo'q" });
      st.reload();
      onChanged?.();
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err, "Shifrlab bo'lmadi") });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  const unseal = async () => {
    if (!password) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = (await hrCryptoApi.unseal(password)).data;
      setMsg({ ok: true, text: `${fmt(r.done)} ta qiymat shifrdan chiqarildi (bazada endi ochiq)` });
      setPassword('');
      setUnsealOpen(false);
      st.reload();
      onChanged?.();
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err, "Shifrdan chiqarib bo'lmadi") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader title="Xodimlarning shaxsiy ma'lumotlari bazada" description="Ma'lumotnomalar (10 va 16-jadval): pasport, telefon, e-pochta, IP, diplom raqami, yashash manzili" />
      <CardBody className="space-y-3 text-sm">
        <p className="text-(--color-text)">
          Shifrlangan maydonlar bazada o&apos;qib bo&apos;lmaydigan ko&apos;rinishda saqlanadi — bazaga yoki uning nusxasiga kirgan odam ularni ko&apos;ra olmaydi. Xodim kartasida va eksportda administrator avvalgidek
          to&apos;liq ko&apos;radi. F.I.Sh., JShShIR, lavozim, ish haqi shifrlanmaydi.
        </p>
        {st.loading && !d ? (
          <LoadingState />
        ) : d ? (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                { label: 'Shifrlangan', value: d.sealed, tone: 'ok' },
                { label: 'Hali ochiq', value: d.plain, tone: d.plain ? 'warn' : 'ok' },
                { label: "Ochib bo'lmaydi", value: d.unreadable, tone: d.unreadable ? 'bad' : 'ok' },
              ].map((x) => (
                <div key={x.label} className="rounded-(--radius-control) border border-(--color-line) px-3 py-2">
                  <p className="text-xs text-(--color-text-muted)">{x.label}</p>
                  <p className={x.tone === 'bad' ? 'money text-lg font-semibold text-(--color-expense)' : x.tone === 'warn' ? 'money text-lg font-semibold text-(--color-warn)' : 'money text-lg font-semibold text-heading'}>{fmt(x.value)}</p>
                </div>
              ))}
            </div>
            {!d.ready && (
              <p className="flex items-start gap-2 rounded-(--radius-control) bg-(--color-warn-soft) px-3 py-2 text-xs text-(--color-warn)">
                <IconAlert className="mt-0.5 size-4 shrink-0" />
                Serverda <code className="money">APP_ENCRYPTION_KEY</code> sozlanmagan. Uni <code className="money">.env</code> ga qo&apos;shing (kamida 32 belgi), API&apos;ni qayta ishga tushiring — keyin shifrlash mumkin.
                Kalit nusxasini server tashqarisida saqlang: yo&apos;qolsa, shifrlangan maydonlar faqat Excel fayllarni qayta yuklab tiklanadi.
              </p>
            )}
            {d.unreadable > 0 && d.ready && (
              <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-xs text-(--color-expense)">
                Ba&apos;zi qiymatlar boshqa kalit bilan shifrlangan — serverdagi kalit almashtirilganmi? Avvalgi kalitni qaytaring yoki jadvallarni qayta yuklang.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => setConfirm(true)} disabled={!d.ready || d.plain === 0 || busy} loading={busy && confirm}>
                Hozir shifrlash{d.plain ? ` (${fmt(d.plain)})` : ''}
              </Button>
              {d.sealed > 0 && d.ready && (
                <Button variant="ghost" size="sm" onClick={() => setUnsealOpen((x) => !x)} disabled={busy}>
                  Shifrdan chiqarish…
                </Button>
              )}
              {total === 0 && <span className="text-xs text-(--color-text-muted)">Ma&apos;lumotnomalar hali yuklanmagan</span>}
            </div>
            {unsealOpen && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void unseal();
                }}
                className="flex flex-wrap items-end gap-2 rounded-(--radius-control) border border-(--color-line) p-3"
              >
                <label className="block text-xs font-medium text-(--color-text-muted)">
                  O&apos;chirish paroli (orqaga qaytarish uchun)
                  <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 block h-9 w-56 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-3 text-sm focus:border-brand-600 focus:outline-none" />
                </label>
                <Button type="submit" variant="secondary" size="sm" loading={busy && !confirm} disabled={!password}>
                  Ochiq holga qaytarish
                </Button>
                <p className="w-full text-xs text-(--color-text-muted)">Shundan keyin pasport, telefon va manzil bazada yana ochiq saqlanadi. Amal tarixga yoziladi.</p>
              </form>
            )}
          </>
        ) : null}
        {msg && (
          <p className={msg.ok ? 'flex items-center gap-2 rounded-(--radius-control) bg-emerald-50 px-3 py-2 text-sm text-emerald-800' : 'flex items-start gap-2 rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)'}>
            {msg.ok ? <IconCheck className="size-4" /> : <IconAlert className="mt-0.5 size-4 shrink-0" />}
            {msg.text}
          </p>
        )}
      </CardBody>
      <ConfirmDialog
        open={confirm}
        title="Shaxsiy ma'lumotlarni shifrlash"
        message={`Avval bazaning zaxirasi olinadi (olinmasa — hech narsa o'zgarmaydi). Keyin ${d ? fmt(d.plain) : ''} ta qiymat (pasport, telefon, manzil …) shifrlanadi; har biri darhol tekshiriladi. Ekranda hech narsa o'zgarmaydi.`}
        confirmLabel="Shifrlash"
        loading={busy}
        onConfirm={() => void seal()}
        onCancel={() => setConfirm(false)}
      />
    </Card>
  );
}