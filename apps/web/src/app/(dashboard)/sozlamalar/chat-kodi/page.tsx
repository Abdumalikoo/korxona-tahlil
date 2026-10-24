'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { IconAlert, IconCheck } from '@/components/ui/icons';
import { LoadingState } from '@/components/ui/states';
import { chatPinApi, cleanMsg, setChatToken, type ChatPinRequire } from '@/features/chat/api';
import { weakCode } from '@/features/chat/pin-pad';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { useEffect, useState, type FormEvent } from 'react';

// ═══════════════════════════════════════════════════════════
// Sozlamalar › Chat kodi — Manba chatini himoyalash.
//  • Qayerda so'raladi: chatga kirish (vaqtinchalik ruxsat bilan), saqlash (☆ va Excel), yangi suhbat (har safar).
//  • Kirish ruxsati muddati (daqiqa) — shu vaqt ichida kod qayta so'ralmaydi (shu brauzer oynasida).
//  • Standart kod hammaga ma'lum: u bilan faqat yangi kod (6–8 raqam) o'rnatiladi, chat esa yopiq turadi.
//    Har o'zgarish joriy kod bilan tasdiqlanadi. Bazada faqat xesh saqlanadi.
// ═══════════════════════════════════════════════════════════

const REQ: { key: keyof ChatPinRequire; label: string; hint: string }[] = [
  { key: 'use', label: 'Chatga kirish', hint: 'Chat ochilganda kod so‘raladi; keyin belgilangan muddat davomida qayta so‘ralmaydi' },
  { key: 'save', label: 'Saqlash', hint: '☆ «Saqlash» va Excel’ga yuklab olishda — har safar' },
  { key: 'newChat', label: 'Yangi suhbat', hint: '«Yangi suhbat» ochishda — har safar' },
];
const TTL = [15, 30, 60, 120, 240, 480, 1440];

export default function ChatPinSettingsPage() {
  const { isAdmin } = useAuth();
  const cfg = useAsync(() => (isAdmin ? chatPinApi.config() : Promise.resolve(null)), [isAdmin]);
  const d = cfg.data?.data;
  const [req, setReq] = useState<ChatPinRequire>({ use: true, save: true, newChat: true });
  const [ttl, setTtl] = useState(120);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    if (d) {
      setReq(d.require);
      setTtl(d.ttlMinutes);
    }
  }, [d]);

  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 8);
  const changingCode = next.length > 0 || repeat.length > 0;
  const codeProblem = !changingCode
    ? d?.isDefault
      ? "Standart kod turibdi — avval yangi kod kiriting"
      : null
    : next.length < 6
      ? "Kamida 6 ta raqam bo'lsin"
      : weakCode(next)
        ? 'Kod juda oddiy — bir xil yoki ketma-ket raqamlar bo‘lmasin'
        : next !== repeat
          ? 'Yangi kodlar bir xil emas'
          : null;
  const codeBad = Boolean(codeProblem);
  const dirty = Boolean(d) && (changingCode || req.use !== d!.require.use || req.save !== d!.require.save || req.newChat !== d!.require.newChat || ttl !== d!.ttlMinutes);
  const canSave = current.length >= 4 && dirty && !codeBad && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSave || !d) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await chatPinApi.update({
        currentCode: current,
        ...(changingCode ? { newCode: next } : {}),
        require: req,
        ...(ttl !== d.ttlMinutes ? { ttlMinutes: ttl } : {}),
      });
      if (changingCode) setChatToken(null); // yangi kod bilan qayta kirish
      setCurrent('');
      setNext('');
      setRepeat('');
      setOk(changingCode ? "Kod o'zgartirildi — chatga yangi kod bilan kiriladi" : 'Sozlama saqlandi');
      cfg.reload();
    } catch (err) {
      setError(cleanMsg(errorMessage(err, "Saqlab bo'lmadi")));
    } finally {
      setBusy(false);
    }
  };

  const input = 'mt-1 block h-10 w-full max-w-xs rounded-(--radius-control) border border-(--color-line-strong) bg-white px-3 text-lg tracking-[0.4em] focus:border-brand-600 focus:outline-none';

  return (
    <>
      <PageHeader title="Sozlamalar" description="Chat kodi — Manba chatini himoyalash" />
      <div className="space-y-4 p-4 md:p-6">
        {!isAdmin ? (
          <p className="rounded-(--radius-control) bg-(--color-warn-soft) px-4 py-2.5 text-sm text-(--color-warn)">Bu sozlamani faqat administrator o&apos;zgartiradi.</p>
        ) : cfg.loading && !d ? (
          <LoadingState />
        ) : d ? (
          <form onSubmit={(e) => void submit(e)} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader title="Kod qayerda so'raladi" description="Belgilanganlarda chat kodi talab qilinadi" />
              <CardBody className="space-y-3 text-sm">
                {REQ.map((r) => (
                  <label key={r.key} className="flex cursor-pointer items-start gap-3 rounded-(--radius-control) border border-(--color-line) px-3 py-2.5 hover:bg-(--color-surface-muted)">
                    <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={req[r.key]} onChange={() => setReq((x) => ({ ...x, [r.key]: !x[r.key] }))} />
                    <span>
                      <span className="block font-medium text-heading">{r.label}</span>
                      <span className="block text-xs text-(--color-text-muted)">{r.hint}</span>
                    </span>
                  </label>
                ))}
                <label className="block text-xs font-medium text-(--color-text-muted)">
                  Kirish ruxsati muddati
                  <select value={ttl} onChange={(e) => setTtl(Number(e.target.value))} disabled={!req.use} className="mt-1 block h-10 w-full max-w-xs rounded-(--radius-control) border border-(--color-line-strong) bg-white px-3 text-sm">
                    {TTL.map((t) => (
                      <option key={t} value={t}>
                        {t < 60 ? `${t} daqiqa` : t === 1440 ? '1 kun' : `${t / 60} soat`}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="rounded-(--radius-control) bg-(--color-surface-muted) px-3 py-2 text-xs text-(--color-text-muted)">
                  {d.isDefault ? (
                    <span className="text-(--color-warn)">
                      Hozir <b>standart kod</b> turibdi — u hammaga ma&apos;lum, shuning uchun chat <b>yopiq</b>. Joriy kod maydoniga standart kodni yozib, yangi kod o&apos;rnating.
                    </span>
                  ) : (
                    <>
                      Kod o&apos;zgartirilgan: <b className="text-heading">{d.updatedAt ? formatDateTime(d.updatedAt) : '—'}</b>
                    </>
                  )}{' '}
                  Noto&apos;g&apos;ri kod 5 marta kiritilsa — 5 daqiqa kutiladi. Bazada kodning o&apos;zi emas, faqat shifrlangan izi saqlanadi.
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Kodni o'zgartirish va tasdiqlash" description="Har qanday o'zgarish joriy kod bilan saqlanadi" />
              <CardBody className="space-y-3">
                <label className="block text-xs font-medium text-(--color-text-muted)">
                  Joriy kod
                  <input type="password" inputMode="numeric" autoComplete="off" value={current} onChange={(e) => setCurrent(digits(e.target.value))} className={input} />
                </label>
                <label className="block text-xs font-medium text-(--color-text-muted)">
                  {d?.isDefault ? 'Yangi kod (6–8 raqam) — majburiy' : <>Yangi kod (6–8 raqam) — o&apos;zgartirmasangiz bo&apos;sh qoldiring</>}
                  <input type="password" inputMode="numeric" autoComplete="new-password" value={next} onChange={(e) => setNext(digits(e.target.value))} className={input} />
                </label>
                <label className="block text-xs font-medium text-(--color-text-muted)">
                  Yangi kodni takrorlang
                  <input type="password" inputMode="numeric" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(digits(e.target.value))} className={input} />
                </label>
                {codeBad && (changingCode || current.length > 0) && <p className="text-xs text-(--color-expense)">{codeProblem}</p>}
                {error && (
                  <p className="flex items-start gap-2 rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">
                    <IconAlert className="mt-0.5 size-4 shrink-0" />
                    {error}
                  </p>
                )}
                {ok && (
                  <p className="flex items-center gap-2 rounded-(--radius-control) bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    <IconCheck className="size-4" />
                    {ok}
                  </p>
                )}
                <Button type="submit" loading={busy} disabled={!canSave}>
                  Saqlash
                </Button>
              </CardBody>
            </Card>
          </form>
        ) : null}
      </div>
    </>
  );
}