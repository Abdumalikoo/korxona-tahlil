'use client';

import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { LoadingState } from '@/components/ui/states';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActPaper } from '../act-paper';
import { warehouseApi, type DocPayload, type SignDraft, type SignStatus, type WarehouseDoc } from '../api';
import { SignatureProof } from '../sign-panel';

// ═══════════════════════════════════════════════════════════
// Saqlashdan oldin tasdiq:
//   «Tasdiqlash» → dalolatnoma tayyorlanadi va QR kod chiqadi (hujjat hali saqlanmagan) →
//   qabul qiluvchi xodim telefonda skaner qilib imzo chizadi yoki yuz suratini oladi →
//   «Saqlash» ochiladi → hujjat bazaga yoziladi, imzoli nusxa arxivga va Telegram'ga (2 nusxa) ketadi.
// Oluvchi xodim bo'lmasa (bo'limga berilsa) — oddiy saqlash, dalolatnoma qog'ozda imzolanadi.
// ═══════════════════════════════════════════════════════════

/** Imzolangan, lekin oyna yopilib saqlanmay qolgan tasdiqlar: o'sha hujjat qayta ochilsa — qayta imzolatmaymiz */
const signedDrafts = new Map<string, string>();

type State =
  | { step: 'loading' }
  | { step: 'error'; message: string }
  | { step: 'nosign'; reason: string }
  | { step: 'draft'; draft: SignDraft };

export function SignDialog({
  payload,
  title,
  onClose,
  onSaved,
}: {
  /** Saqlanadigan hujjat; null — oyna yopiq */
  payload: DocPayload | null;
  title: string;
  onClose: () => void;
  onSaved: (doc: WarehouseDoc, sign: SignStatus | null) => void;
}) {
  const [state, setState] = useState<State>({ step: 'loading' });
  const [busy, setBusy] = useState<'save' | 'retry' | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showAct, setShowAct] = useState(false);
  const [copied, setCopied] = useState(false);
  const key = payload ? JSON.stringify(payload) : '';
  const draftRef = useRef<SignDraft | null>(null);

  const start = useCallback(async () => {
    if (!payload) return;
    setState({ step: 'loading' });
    setSaveError(null);
    try {
      const keep = signedDrafts.get(key);
      if (keep) {
        const r = await warehouseApi.signDraft(keep).catch(() => null);
        if (r && r.data.status === 'SIGNED' && !r.data.saved) {
          draftRef.current = r.data;
          setState({ step: 'draft', draft: r.data });
          return;
        }
        signedDrafts.delete(key);
      }
      const r = await warehouseApi.createSignDraft(payload);
      if ('needsSign' in r.data) setState({ step: 'nosign', reason: r.data.reason });
      else {
        draftRef.current = r.data;
        setState({ step: 'draft', draft: r.data });
      }
    } catch (e) {
      setState({ step: 'error', message: errorMessage(e, "Dalolatnomani tayyorlab bo'lmadi") });
    }
  }, [payload, key]);

  useEffect(() => {
    if (!payload) return;
    setShowAct(false);
    void start();
  }, [payload, start]);

  const draft = state.step === 'draft' ? state.draft : null;
  const waiting = draft?.status === 'PENDING' && !draft.expired;

  // Xodim imzolashini kutamiz — har 3 soniyada tekshiramiz
  useEffect(() => {
    if (!waiting || !draft) return;
    const id = draft.id;
    const t = window.setInterval(() => {
      warehouseApi
        .signDraft(id)
        .then((r) => {
          draftRef.current = r.data;
          if (r.data.status === 'SIGNED') signedDrafts.set(key, id);
          setState((s) => (s.step === 'draft' && s.draft.id === id ? { step: 'draft', draft: r.data } : s));
        })
        .catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(t);
  }, [waiting, draft, key]);

  const close = () => {
    // Imzo kutilayotgan QR — bekor (imzolangani saqlanib turadi: qayta ochilsa qayta imzolatilmaydi)
    const d = draftRef.current;
    if (d && d.status === 'PENDING' && !d.saved) void warehouseApi.cancelSignDraft(d.id).catch(() => undefined);
    draftRef.current = null;
    onClose();
  };

  const save = async () => {
    if (!payload) return;
    setBusy('save');
    setSaveError(null);
    try {
      if (state.step === 'nosign') {
        const r = await warehouseApi.createDoc(payload);
        onSaved(r.data, null);
      } else if (draft) {
        const r = await warehouseApi.commitSignDraft(draft.id);
        signedDrafts.delete(key);
        draftRef.current = null;
        onSaved(r.data.doc, r.data.sign);
      }
    } catch (e) {
      setSaveError(errorMessage(e, "Saqlab bo'lmadi"));
      // Holat o'zgargan bo'lsa (qayta imzo kerak) — yangilaymiz
      if (draft) warehouseApi.signDraft(draft.id).then((r) => setState({ step: 'draft', draft: r.data })).catch(() => undefined);
    } finally {
      setBusy(null);
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
  const canSave = state.step === 'nosign' || signed;

  return (
    <Drawer
      open={Boolean(payload)}
      onClose={close}
      width="lg"
      title={`${title}: tasdiqlash`}
      description="Hujjat xodim tasdiqlagandan keyin saqlanadi"
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={close} disabled={busy === 'save'}>
            {signed ? 'Yopish' : 'Bekor qilish'}
          </Button>
          <Button size="lg" onClick={() => void save()} loading={busy === 'save'} disabled={!canSave} title={canSave ? undefined : 'Avval xodim QR kod orqali tasdiqlasin'}>
            {state.step === 'nosign' ? "Saqlash (qog'ozda imzolanadi)" : signed ? 'Saqlash' : 'Saqlash — imzo kutilmoqda'}
          </Button>
        </>
      }
    >
      {state.step === 'loading' ? (
        <LoadingState label="Dalolatnoma tayyorlanmoqda" />
      ) : state.step === 'error' ? (
        <div className="space-y-3">
          <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm font-semibold text-(--color-expense)">{state.message}</p>
          <p className="text-xs text-(--color-text-muted)">Formaga qaytib to&apos;g&apos;rilang va yana «Tasdiqlash» bosing.</p>
        </div>
      ) : state.step === 'nosign' ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Elektron imzo qo&apos;yadigan xodim yo&apos;q</p>
          <p className="mt-1">{state.reason}.</p>
          <p className="mt-2 text-xs">Xodim imzolashi kerak bo&apos;lsa — formada oluvchini Xodimlar ro&apos;yxatidan tanlang.</p>
        </div>
      ) : draft ? (
        <div className="space-y-4">
          <Steps signed={signed} />

          {dead ? (
            <div className="rounded-xl border border-(--color-line-strong) bg-(--color-surface-muted) p-4 text-sm">
              <p className="font-semibold text-heading">{draft.expired ? 'QR kod muddati tugagan' : 'QR kod bekor qilingan'}</p>
              {saveError && <p className="mt-1 text-(--color-expense)">{saveError}</p>}
              <Button className="mt-3" onClick={() => void start()}>
                Qaytadan tasdiqlash (yangi QR)
              </Button>
            </div>
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
                  Endi <b>«Saqlash»</b> bosing — hujjat bazaga yoziladi, imzoli dalolatnoma arxivga va Telegram&apos;ga (xodimga va arxiv guruhiga) yuboriladi.
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
                <ol className="list-decimal space-y-1 pl-5 text-sm text-(--color-text)">
                  <li>Xodim telefon kamerasi bilan QR kodni skaner qiladi.</li>
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
              </div>
            </section>
          )}

          {saveError && !dead && <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">{saveError}</p>}

          <div>
            <button type="button" onClick={() => setShowAct((v) => !v)} className="text-sm font-semibold text-brand-700 hover:underline">
              {showAct ? 'Dalolatnomani yashirish ▴' : 'Dalolatnomani ko‘rish ▾'}
            </button>
            {showAct && (
              <div className="mt-2 rounded-xl bg-(--color-surface-muted) p-3">
                <ActPaper m={draft.act} />
              </div>
            )}
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}

export function Steps({ signed, labels = ['Tasdiqlash', 'Xodim imzosi', 'Saqlash'] }: { signed: boolean; labels?: string[] }) {
  const steps = labels;
  const at = signed ? 2 : 1;
  return (
    <ol className="flex items-center gap-2 text-xs font-semibold">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span className={cn('grid size-6 place-items-center rounded-full', i < at ? 'bg-emerald-600 text-white' : i === at ? 'bg-brand-600 text-white' : 'bg-(--color-surface-sunken) text-(--color-text-muted)')}>
            {i < at ? '✓' : i + 1}
          </span>
          <span className={i === at ? 'text-heading' : 'text-(--color-text-muted)'}>{s}</span>
          {i < steps.length - 1 && <span className="h-px w-6 bg-(--color-line-strong)" />}
        </li>
      ))}
    </ol>
  );
}