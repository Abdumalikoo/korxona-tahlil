'use client';

import { Button } from '@/components/ui/button';
import { IconDownload } from '@/components/ui/icons';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadSignedAct, warehouseApi, type SignStatus, type WarehouseDoc } from './api';

// ═══════════════════════════════════════════════════════════
// Elektron tasdiq: «Rasmiylashtirish» → dalolatnomaga QR kod tushadi →
// qabul qiluvchi xodim telefonda skaner qilib imzo chizadi →
// imzoli nusxa saqlanadi va Telegramga 2 nusxa (xodimga + arxivga) ketadi.
// ═══════════════════════════════════════════════════════════

export function SignPanel({ doc, canWrite, onChanged }: { doc: WarehouseDoc; canWrite: boolean; onChanged: () => void }) {
  const [s, setS] = useState<SignStatus | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const last = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await warehouseApi.signStatus(doc.id);
      setS(r.data);
      const key = r.data ? `${r.data.status}:${r.data.signedAt ?? ''}` : 'none';
      if (last.current !== null && last.current !== key) onChanged();
      last.current = key;
    } catch (e) {
      setS(null);
      setErr(errorMessage(e, "Tasdiq holatini olib bo'lmadi"));
    }
  }, [doc.id, onChanged]);

  useEffect(() => {
    last.current = null;
    setS(undefined);
    setErr(null);
    void load();
  }, [load]);

  // Imzo kutilayotganda — har 5 soniyada tekshiramiz (xodim telefonda imzolaganini darhol ko'rish uchun)
  useEffect(() => {
    if (s?.status !== 'PENDING') return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [s?.status, load]);

  const run = async (name: string, fn: () => Promise<{ data: SignStatus | null }>) => {
    setBusy(name);
    setErr(null);
    try {
      const r = await fn();
      setS(r.data);
      last.current = r.data ? `${r.data.status}:${r.data.signedAt ?? ''}` : 'none';
      onChanged();
    } catch (e) {
      setErr(errorMessage(e, 'Amalni bajarib bo‘lmadi'));
    } finally {
      setBusy(null);
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* nusxalab bo'lmasa — havola ko'rinib turibdi */
    }
  };

  const download = async () => {
    setBusy('download');
    setErr(null);
    try {
      await downloadSignedAct(doc);
    } catch (e) {
      setErr(errorMessage(e, "Imzoli nusxani yuklab bo'lmadi"));
    } finally {
      setBusy(null);
    }
  };

  if (s === undefined) return <div className="h-16 animate-pulse rounded-xl bg-(--color-surface-muted)" />;

  const live = s && s.status !== 'CANCELLED' ? s : null;

  return (
    <section
      className={cn(
        'rounded-xl border p-4',
        live?.status === 'SIGNED' ? 'border-emerald-200 bg-emerald-50/60' : live ? 'border-brand-200 bg-brand-50/50' : 'border-dashed border-(--color-line-strong) bg-white',
      )}
    >
      {!live ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-(--color-surface-muted) text-lg" aria-hidden>
            ▦
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-heading">Elektron tasdiq</p>
            <p className="text-xs text-(--color-text-muted)">
              Rasmiylashtirilgach dalolatnomaga QR kod tushadi. {signerHint(doc)} telefonida skaner qilib, imzo chizadi — imzoli nusxa saqlanadi va Telegramga yuboriladi.
            </p>
          </div>
          {canWrite && (
            <Button onClick={() => void run('start', () => warehouseApi.startSign(doc.id))} loading={busy === 'start'}>
              Rasmiylashtirish (QR kod)
            </Button>
          )}
        </div>
      ) : live.status === 'PENDING' ? (
        <div className="flex flex-col gap-4 sm:flex-row">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={live.qr} alt="Imzo uchun QR kod" className="mx-auto size-40 shrink-0 rounded-lg bg-white p-1.5 ring-1 ring-brand-200 sm:mx-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="flex items-center gap-2 text-sm font-semibold text-heading">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex size-2.5 rounded-full bg-amber-500" />
              </span>
              Imzo kutilmoqda — {live.signerName}
            </p>
            <p className="text-xs text-(--color-text-muted)">Xodim telefon kamerasi bilan QR kodni skaner qiladi, JShShIRining oxirgi 4 raqamini kiritib imzo chizadi. Imzolanishi bilan bu yerda o&apos;zi yangilanadi.</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-white px-2 py-1 text-[11px] ring-1 ring-(--color-line)">{live.url}</code>
              <button type="button" onClick={() => void copy(live.url)} className="shrink-0 text-xs font-semibold text-brand-700 hover:underline">
                {copied ? 'Nusxalandi ✓' : 'Nusxalash'}
              </button>
            </div>
            {live.localOnly && (
              <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 ring-1 ring-amber-200">
                Havola «localhost» — telefon uni ocha olmaydi. Dasturni kompyuter IP manzili orqali oching yoki serverda SIGN_PUBLIC_URL ni belgilang.
              </p>
            )}
            {canWrite && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="secondary" onClick={() => void load()} loading={busy === 'refresh'}>
                  Tekshirish
                </Button>
                <Button size="sm" variant="ghost" className="text-(--color-expense)" onClick={() => void run('cancel', () => warehouseApi.cancelSign(doc.id))} loading={busy === 'cancel'}>
                  QR kodni bekor qilish
                </Button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <SignatureProof s={live} />
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-sm font-semibold text-emerald-800">
              ✓ {live.method === 'PHOTO' ? 'Yuz surati bilan tasdiqlangan' : 'Imzolangan'} — {live.signerName}
            </p>
            <p className="text-xs text-(--color-text-muted)">
              {live.signedAt ? formatDateTime(live.signedAt) : ''}
              {live.signedIp ? ` · IP ${live.signedIp}` : ''}
            </p>
            <div className="flex flex-wrap gap-1.5 pt-0.5 text-[11px]">
              <TgChip label="Xodimga" v={live.telegram?.employee} />
              <TgChip label="Arxivga" v={live.telegram?.archive} />
            </div>
            <div className="flex flex-wrap gap-2 pt-1.5">
              {live.hasArchive && (
                <Button size="sm" onClick={() => void download()} loading={busy === 'download'}>
                  <IconDownload className="size-4" />
                  Imzolangan nusxa (Word)
                </Button>
              )}
              {canWrite && (
                <Button size="sm" variant="secondary" onClick={() => void run('resend', () => warehouseApi.resendSign(doc.id))} loading={busy === 'resend'}>
                  Telegramga qayta
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
      {err && <p className="mt-3 rounded-md bg-(--color-expense-soft) px-2 py-1.5 text-xs text-(--color-expense)">{err}</p>}
    </section>
  );
}

/** Imzo rasmi yoki yuz surati — tasdiq isboti */
export function SignatureProof({ s, large }: { s: Pick<SignStatus, 'signature' | 'photo' | 'method'>; large?: boolean }) {
  return (
    <div className="shrink-0 rounded-lg bg-white p-2 ring-1 ring-emerald-200">
      {s.method === 'PHOTO' && s.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={s.photo} alt="Xodimning yuz surati" className={cn('rounded-md object-cover', large ? 'size-36' : 'size-20')} />
      ) : s.signature ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={s.signature} alt="Xodim imzosi" className={cn('object-contain', large ? 'h-28 w-56' : 'h-20 w-40')} />
      ) : (
        <div className="grid h-20 w-40 place-items-center text-xs text-(--color-text-muted)">imzo</div>
      )}
    </div>
  );
}

function signerHint(doc: WarehouseDoc): string {
  return doc.kind === 'RETURN' ? 'Topshiruvchi xodim' : 'Qabul qiluvchi xodim';
}

export function TgChip({ label, v }: { label: string; v?: string }) {
  const ok = v === 'yuborildi';
  return (
    <span className={cn('rounded-full px-2 py-0.5 font-medium ring-1', ok ? 'bg-white text-emerald-700 ring-emerald-200' : 'bg-white text-amber-700 ring-amber-200')} title={v}>
      Telegram · {label}: {v ?? '—'}
    </span>
  );
}