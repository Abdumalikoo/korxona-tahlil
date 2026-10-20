'use client';

import { ActPaper } from '@/features/warehouse/act-paper';
import type { ActModel } from '@/features/warehouse/api';
import { cn } from '@/lib/utils';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Telefonda imzo: xodim QR kodni skaner qiladi → shu sahifa ochiladi.
// Kirish (login) shart emas: havolaning o'zi + JShShIRning oxirgi 4 raqami + chizilgan imzo.
// So'rovlar shu saytning /imzo/api/… vositachisi orqali API ga boradi.
// ═══════════════════════════════════════════════════════════

interface PublicAct {
  status: 'PENDING' | 'SIGNED' | 'CANCELLED';
  number: string;
  kindLabel: string;
  date: string;
  signerName: string;
  signedAt: string | null;
  locked: boolean;
  act: ActModel;
}

async function call<T>(token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/imzo/api/${encodeURIComponent(token)}`, { cache: 'no-store', ...init });
  const json = (await res.json().catch(() => null)) as { data?: T; message?: string | string[] } | null;
  if (!res.ok || !json || json.data === undefined) {
    const m = json?.message;
    throw new Error((Array.isArray(m) ? m[0] : m) ?? 'Xatolik — qayta urinib ko‘ring');
  }
  return json.data;
}

function when(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function SignPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicAct | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [agree, setAgree] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const pad = useRef<SignaturePadHandle>(null);

  const load = useCallback(() => {
    setLoadError(null);
    call<PublicAct>(token)
      .then(setData)
      .catch((e: Error) => setLoadError(e.message));
  }, [token]);

  useEffect(() => {
    document.title = 'Dalolatnomani imzolash';
    load();
  }, [load]);

  const submit = async () => {
    setError(null);
    if (pin.replace(/\D/g, '').length !== 4) return setError('JShShIRning oxirgi 4 raqamini kiriting');
    const signature = pad.current?.png();
    if (!signature || !hasInk) return setError('Pastdagi maydonga imzo chizing');
    if (!agree) return setError('Dalolatnoma bilan tanishganingizni belgilang');
    setSending(true);
    try {
      const r = await call<{ ok: true; signedAt: string }>(token, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pinfl4: pin, signature, agree }),
      });
      setDone(r.signedAt);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="min-h-dvh bg-[#f3f5f8] pb-10 text-[#1b2430]">
      <header className="sticky top-0 z-10 border-b border-black/5 bg-white/90 px-4 py-3 backdrop-blur">
        <p className="text-[11px] font-semibold tracking-wide text-[#5b6b7f] uppercase">Korxona tahlil · Ombor</p>
        <h1 className="text-base font-semibold">{data ? `${data.kindLabel} № ${data.number}` : 'Dalolatnoma'}</h1>
      </header>

      <div className="mx-auto max-w-xl space-y-4 px-4 pt-4">
        {loadError ? (
          <Card>
            <p className="text-sm font-semibold text-red-700">{loadError}</p>
            <button type="button" onClick={load} className="mt-3 h-11 w-full rounded-xl bg-[#1b2430] text-sm font-semibold text-white">
              Qayta urinish
            </button>
          </Card>
        ) : !data ? (
          <Card>
            <div className="h-5 w-2/3 animate-pulse rounded bg-black/10" />
            <div className="mt-3 h-40 animate-pulse rounded bg-black/5" />
          </Card>
        ) : (
          <>
            {data.status === 'SIGNED' ? (
              <Card className="border-emerald-200 bg-emerald-50">
                <p className="text-lg font-semibold text-emerald-800">✓ {done ? 'Imzolandi' : 'Allaqachon imzolangan'}</p>
                <p className="mt-1 text-sm text-emerald-900/80">
                  {data.signerName}
                  {data.signedAt ? ` · ${when(data.signedAt)}` : ''}
                </p>
                <p className="mt-2 text-xs text-emerald-900/70">Imzoli nusxa saqlandi. Telegram botga ulangan bo&apos;lsangiz — nusxa sizga ham yuborildi.</p>
              </Card>
            ) : data.status === 'CANCELLED' ? (
              <Card className="border-red-200 bg-red-50">
                <p className="font-semibold text-red-800">Bu havola bekor qilingan</p>
                <p className="mt-1 text-sm text-red-900/80">Omborchidan yangi QR kod so&apos;rang.</p>
              </Card>
            ) : (
              <Card>
                <p className="text-sm text-[#5b6b7f]">Imzolovchi</p>
                <p className="text-lg font-semibold">{data.signerName}</p>
                <p className="mt-1 text-xs text-[#5b6b7f]">Quyidagi dalolatnomani o&apos;qib chiqing, so&apos;ng pastda tasdiqlang.</p>
              </Card>
            )}

            <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
              <div className="overflow-x-auto">
                <ActPaper m={data.act} className="max-w-none px-4 py-5 text-[12px] shadow-none ring-0 sm:px-8" />
              </div>
            </div>

            {data.status === 'PENDING' && (
              <Card>
                <p className="text-base font-semibold">Tasdiqlash</p>
                {data.locked ? (
                  <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">Ko&apos;p marta noto&apos;g&apos;ri kiritildi — 15 daqiqadan keyin qayta urinib ko&apos;ring.</p>
                ) : (
                  <div className="mt-3 space-y-4">
                    <label className="block">
                      <span className="text-sm font-medium">JShShIRingizning oxirgi 4 raqami</span>
                      <input
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={4}
                        value={pin}
                        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        className="mt-1.5 h-14 w-full rounded-xl border border-black/15 bg-white text-center text-2xl font-semibold tracking-[0.6em] focus:border-[#2563eb] focus:outline-none"
                        placeholder="••••"
                      />
                    </label>

                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Imzongiz</span>
                        <button
                          type="button"
                          onClick={() => {
                            pad.current?.clear();
                            setHasInk(false);
                          }}
                          className="text-sm font-semibold text-[#2563eb]"
                        >
                          Tozalash
                        </button>
                      </div>
                      <SignaturePadInner handle={pad} onInk={() => setHasInk(true)} />
                      <p className="mt-1 text-xs text-[#5b6b7f]">Barmog&apos;ingiz bilan chizing</p>
                    </div>

                    <label className="flex items-start gap-3 rounded-xl bg-[#f3f5f8] p-3">
                      <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[#2563eb]" />
                      <span className="text-sm">Dalolatnoma bilan tanishdim, unda ko&apos;rsatilgan mol-mulkni {data.act.kind === 'RETURN' ? 'topshirdim' : 'qabul qildim'} va unga moddiy javobgarligimni tasdiqlayman.</span>
                    </label>

                    {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{error}</p>}

                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => void submit()}
                      className="h-14 w-full rounded-xl bg-[#2563eb] text-base font-semibold text-white shadow-sm active:scale-[0.99] disabled:opacity-60"
                    >
                      {sending ? 'Yuborilmoqda…' : 'Imzolash va tasdiqlash'}
                    </button>
                  </div>
                )}
              </Card>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn('rounded-2xl border border-black/5 bg-white p-4 shadow-sm', className)}>{children}</section>;
}

// ── Imzo chizish maydoni (barmoq / sichqoncha / qalam) ───────────────

interface SignaturePadHandle {
  png: () => string | null;
  clear: () => void;
}

function SignaturePadInner({ onInk, handle }: { onInk: () => void; handle: React.Ref<SignaturePadHandle> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const ink = useRef(0);
  const last = useRef<{ x: number; y: number } | null>(null);

  const setup = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = Math.round(w * ratio);
    c.height = Math.round(h * ratio);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0b2a6b';
    ctx.lineWidth = 2.4;
    ink.current = 0;
  }, []);

  useEffect(() => {
    setup();
  }, [setup]);

  const assign = useCallback(
    (v: SignaturePadHandle) => {
      if (typeof handle === 'function') handle(v);
      else if (handle && typeof handle === 'object') (handle as React.MutableRefObject<SignaturePadHandle | null>).current = v;
    },
    [handle],
  );

  useEffect(() => {
    assign({
      png: () => (canvas.current && ink.current > 0 ? canvas.current.toDataURL('image/png') : null),
      clear: () => {
        const c = canvas.current;
        c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
        setup();
      },
    });
  }, [assign, setup]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <canvas
      ref={canvas}
      className="mt-1.5 h-44 w-full touch-none rounded-xl border-2 border-dashed border-black/15 bg-white"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drawing.current = true;
        last.current = point(e);
        const ctx = e.currentTarget.getContext('2d');
        if (ctx && last.current) {
          ctx.beginPath();
          ctx.arc(last.current.x, last.current.y, 1.1, 0, Math.PI * 2);
          ctx.fillStyle = '#0b2a6b';
          ctx.fill();
        }
      }}
      onPointerMove={(e) => {
        if (!drawing.current || !last.current) return;
        const ctx = e.currentTarget.getContext('2d');
        const p = point(e);
        if (!ctx) return;
        ctx.beginPath();
        ctx.moveTo(last.current.x, last.current.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ink.current += Math.hypot(p.x - last.current.x, p.y - last.current.y);
        last.current = p;
        if (ink.current > 40) onInk();
      }}
      onPointerUp={() => {
        drawing.current = false;
        last.current = null;
      }}
      onPointerCancel={() => {
        drawing.current = false;
        last.current = null;
      }}
    />
  );
}