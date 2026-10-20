'use client';

import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { LoadingState } from '@/components/ui/states';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { useEffect, useRef, useState } from 'react';
import { ActPaper, EmployeePick } from './act-paper';
import { warehouseApi, type ActTemplate, type SignDraft, type SignStatus } from './api';
import { Steps } from './entry/sign-dialog';
import { SignatureProof } from './sign-panel';

// ═══════════════════════════════════════════════════════════
// Dalolatnoma shablonini saqlash — faqat rahbar tasdiqlagandan keyin:
//   «Tasdiqlash (QR kod)» → shablon namunasi va QR (shablon hali saqlanmagan) →
//   tasdiqlovchi telefonda skaner qilib imzo chizadi yoki yuz suratini oladi →
//   «Saqlash» ochiladi → shablon bazaga, tasdiqlangan namuna (Word) arxivga va Telegram'ga (2 nusxa).
// ═══════════════════════════════════════════════════════════

export function TemplateApproveDialog({
  template,
  onClose,
  onSaved,
}: {
  /** Saqlanadigan shablon; null — oyna yopiq */
  template: ActTemplate | null;
  onClose: () => void;
  onSaved: (t: ActTemplate, sign: SignStatus) => void;
}) {
  const [signer, setSigner] = useState<{ pinfl: string | null; name: string }>({ pinfl: null, name: '' });
  const [draft, setDraft] = useState<SignDraft | null>(null);
  const [step, setStep] = useState<'pick' | 'loading' | 'draft'>('pick');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showAct, setShowAct] = useState(false);
  const [copied, setCopied] = useState(false);
  const draftRef = useRef<SignDraft | null>(null);

  const start = async (pinfl: string | null) => {
    if (!template) return;
    setStep('loading');
    setErr(null);
    try {
      const r = await warehouseApi.createTemplateApproval(template, pinfl);
      draftRef.current = r.data;
      setDraft(r.data);
      setStep('draft');
    } catch (e) {
      setErr(errorMessage(e, "QR kodni tayyorlab bo'lmadi"));
      setStep('pick');
    }
  };

  // Ochilganda: shablondagi rahbar tanlangan bo'lsa — darhol QR
  useEffect(() => {
    if (!template) return;
    setDraft(null);
    draftRef.current = null;
    setShowAct(false);
    setErr(null);
    setSigner({ pinfl: template.approverPinfl, name: template.approverName });
    if (template.approverPinfl) void start(template.approverPinfl);
    else setStep('pick');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);

  const waiting = step === 'draft' && draft?.status === 'PENDING' && !draft.expired;
  useEffect(() => {
    if (!waiting || !draft) return;
    const id = draft.id;
    const t = window.setInterval(() => {
      warehouseApi
        .signDraft(id)
        .then((r) => {
          draftRef.current = r.data;
          setDraft((d) => (d && d.id === id ? r.data : d));
        })
        .catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(t);
  }, [waiting, draft]);

  const close = () => {
    const d = draftRef.current;
    if (d && d.status === 'PENDING' && !d.saved) void warehouseApi.cancelSignDraft(d.id).catch(() => undefined);
    draftRef.current = null;
    onClose();
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await warehouseApi.commitSignDraft(draft.id);
      draftRef.current = null;
      if (r.data.template) onSaved(r.data.template, r.data.sign);
    } catch (e) {
      setErr(errorMessage(e, "Saqlab bo'lmadi"));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* havola ko'rinib turibdi */
    }
  };

  const signed = draft?.status === 'SIGNED';
  const dead = !!draft && (draft.status === 'CANCELLED' || draft.expired);

  return (
    <Drawer
      open={Boolean(template)}
      onClose={close}
      width="lg"
      title="Shablonni tasdiqlash"
      description="Shablon rahbar tasdiqlagandan keyin saqlanadi"
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={close} disabled={busy}>
            {signed ? 'Yopish' : 'Bekor qilish'}
          </Button>
          <Button size="lg" onClick={() => void save()} loading={busy} disabled={!signed} title={signed ? undefined : 'Avval tasdiqlovchi QR kod orqali tasdiqlasin'}>
            {signed ? 'Saqlash' : 'Saqlash — tasdiq kutilmoqda'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Steps signed={signed} labels={['Tasdiqlash', 'Rahbar imzosi', 'Saqlash']} />

        {step === 'loading' ? (
          <LoadingState label="Shablon namunasi tayyorlanmoqda" />
        ) : step === 'pick' || !draft ? (
          <section className="space-y-3 rounded-xl border border-(--color-line) p-4">
            <p className="text-sm font-semibold text-heading">Kim tasdiqlaydi?</p>
            <p className="text-xs text-(--color-text-muted)">Odatda — shablondagi «ТАСДИҚЛАЙМАН» rahbari. Xodimlar bo&apos;limidan tanlang (JShShIR bilan tasdiqlaydi).</p>
            <EmployeePick
              pinfl={signer.pinfl}
              name={signer.name}
              onPick={(e) => setSigner({ pinfl: e.pinfl, name: e.fullName })}
              onClear={() => setSigner({ pinfl: null, name: '' })}
              placeholder="Tasdiqlovchi — ism yoki JShShIR"
            />
            <Button disabled={!signer.pinfl} onClick={() => void start(signer.pinfl)}>
              QR kod chiqarish
            </Button>
          </section>
        ) : dead ? (
          <section className="rounded-xl border border-(--color-line-strong) bg-(--color-surface-muted) p-4 text-sm">
            <p className="font-semibold text-heading">{draft.expired ? 'QR kod muddati tugagan' : 'QR kod bekor qilingan'}</p>
            <Button className="mt-3" onClick={() => void start(draft.signerPinfl)}>
              Yangi QR kod
            </Button>
          </section>
        ) : signed ? (
          <section className="flex flex-col gap-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 sm:flex-row sm:items-center">
            <SignatureProof s={draft} large />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-base font-semibold text-emerald-800">
                ✓ {draft.method === 'PHOTO' ? 'Yuz surati bilan tasdiqladi' : 'Imzoladi'}: {draft.signerName}
              </p>
              <p className="text-xs text-(--color-text-muted)">
                {draft.signedAt ? formatDateTime(draft.signedAt) : ''}
                {draft.signedIp ? ` · IP ${draft.signedIp}` : ''}
              </p>
              <p className="pt-1 text-sm text-heading">
                Endi <b>«Saqlash»</b> bosing — shablon bazaga yoziladi, tasdiqlangan namuna arxivga va Telegram&apos;ga (tasdiqlovchiga va arxiv guruhiga) yuboriladi.
              </p>
            </div>
          </section>
        ) : (
          <section className="flex flex-col gap-5 rounded-xl border border-brand-200 bg-brand-50/50 p-4 sm:flex-row">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={draft.qr} alt="Tasdiqlash uchun QR kod" className="mx-auto size-56 shrink-0 rounded-xl bg-white p-2 ring-1 ring-brand-200 sm:mx-0" />
            <div className="min-w-0 flex-1 space-y-2.5">
              <p className="flex items-center gap-2 text-base font-semibold text-heading">
                <span className="relative flex size-2.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-amber-500" />
                </span>
                {draft.signerName} tasdiqlashi kutilmoqda
              </p>
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                <li>Telefon kamerasi bilan QR kodni skaner qiladi.</li>
                <li>JShShIRining oxirgi 4 raqamini kiritadi.</li>
                <li>Imzo chizadi yoki yuz suratini oladi.</li>
              </ol>
              <p className="text-xs text-(--color-text-muted)">Tasdiqlanishi bilan bu yerda o&apos;zi yangilanadi va «Saqlash» ochiladi.</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md bg-white px-2 py-1 text-[11px] ring-1 ring-(--color-line)">{draft.url}</code>
                <button type="button" onClick={() => void copy(draft.url)} className="shrink-0 text-xs font-semibold text-brand-700 hover:underline">
                  {copied ? 'Nusxalandi ✓' : 'Nusxalash'}
                </button>
              </div>
              {draft.localOnly && (
                <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 ring-1 ring-amber-200">
                  Havola «localhost» — telefon uni ocha olmaydi. Dasturni kompyuter IP manzili orqali oching yoki serverda SIGN_PUBLIC_URL ni belgilang.
                </p>
              )}
              <button type="button" onClick={() => setStep('pick')} className="text-xs font-semibold text-brand-700 hover:underline">
                Boshqa tasdiqlovchi tanlash
              </button>
            </div>
          </section>
        )}

        {err && <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">{err}</p>}

        {draft && step === 'draft' && (
          <div>
            <button type="button" onClick={() => setShowAct((v) => !v)} className="text-sm font-semibold text-brand-700 hover:underline">
              {showAct ? 'Namunani yashirish ▴' : 'Shablon namunasini ko‘rish ▾'}
            </button>
            {showAct && (
              <div className="mt-2 rounded-xl bg-(--color-surface-muted) p-3">
                <ActPaper m={draft.act} />
              </div>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}