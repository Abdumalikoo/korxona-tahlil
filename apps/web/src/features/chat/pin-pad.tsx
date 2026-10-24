'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Chat kodi kiritish: qulf ekrani (chatga kirish) va oyna (saqlash, yangi suhbat).
// Kod ekranda yashirin (nuqtalar), faqat raqamlar; Enter — tasdiqlash, Esc — bekor.
// ═══════════════════════════════════════════════════════════

function IconLock({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

function CodeInput({ onSubmit, busy, error, autoFocus = true }: { onSubmit: (code: string) => void; busy?: boolean; error?: string | null; autoFocus?: boolean }) {
  const [code, setCode] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (error) {
      setCode('');
      ref.current?.focus();
    }
  }, [error]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length >= 4) onSubmit(code);
      }}
      className="space-y-3"
    >
      <div className="relative mx-auto w-56">
        <input
          ref={ref}
          autoFocus={autoFocus}
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={8}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
          aria-label="Kod"
          className={cn(
            'h-12 w-full rounded-(--radius-control) border bg-white text-center text-2xl tracking-[0.5em] focus:outline-none',
            error ? 'border-(--color-expense)' : 'border-(--color-line-strong) focus:border-brand-500',
          )}
          placeholder="••••"
        />
      </div>
      {error && <p className="text-center text-xs text-(--color-expense)">{error}</p>}
      <Button type="submit" className="w-full" loading={busy} disabled={code.length < 4}>
        Tasdiqlash
      </Button>
    </form>
  );
}

/** Qulf ekrani — chatga kirish uchun kod */
export function ChatLock({ onUnlock, busy, error }: { onUnlock: (code: string) => void; busy?: boolean; error?: string | null }) {
  return (
    <div className="flex min-h-[520px] items-center justify-center rounded-(--radius-card) border border-(--color-line) bg-white p-6">
      <div className="w-full max-w-xs text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow">
          <IconLock className="size-7" />
        </div>
        <h2 className="mt-4 text-lg font-bold text-heading">Chat himoyalangan</h2>
        <p className="mt-1 mb-5 text-sm text-(--color-text-muted)">Davom etish uchun chat kodini kiriting. Kod Sozlamalar › Chat kodi bo&apos;limida o&apos;zgartiriladi.</p>
        <CodeInput onSubmit={onUnlock} busy={busy} error={error} />
      </div>
    </div>
  );
}

/** Juda oddiy kod: bir xil yoki ketma-ket raqamlar (serverdagi tekshiruv bilan bir xil) */
export function weakCode(code: string): boolean {
  if (/^(\d)\1+$/.test(code)) return true;
  return '01234567890123456789'.includes(code) || '98765432109876543210'.includes(code);
}

/**
 * Birinchi sozlash — standart kod hammaga ma'lum, shuning uchun u bilan chat ishlamaydi.
 * Standart kod va yangi kod (6–8 raqam, ikki marta) kiritiladi.
 */
export function ChatSetup({ onSubmit, busy, error }: { onSubmit: (current: string, next: string) => void; busy?: boolean; error?: string | null }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 8);
  const local =
    next.length > 0 && next.length < 6
      ? 'Yangi kod kamida 6 raqam'
      : next.length >= 6 && weakCode(next)
        ? 'Kod juda oddiy — bir xil yoki ketma-ket raqamlar bo‘lmasin'
        : repeat.length > 0 && repeat !== next
          ? 'Takror mos kelmadi'
          : null;
  const ok = current.length >= 4 && next.length >= 6 && repeat === next && !local;
  const field = 'h-11 w-full rounded-(--radius-control) border border-(--color-line-strong) bg-white text-center text-lg tracking-[0.35em] focus:border-brand-500 focus:outline-none';
  return (
    <div className="flex min-h-[520px] items-center justify-center rounded-(--radius-card) border border-(--color-line) bg-white p-6">
      <form
        className="w-full max-w-xs text-center"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onSubmit(current, next);
        }}
      >
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-amber-500 text-white shadow">
          <IconLock className="size-7" />
        </div>
        <h2 className="mt-4 text-lg font-bold text-heading">Chat kodini o&apos;rnating</h2>
        <p className="mt-1 mb-5 text-sm text-(--color-text-muted)">Standart kod hammaga ma&apos;lum, shuning uchun u bilan chat ishlamaydi. Bir marta o&apos;z kodingizni qo&apos;ying.</p>
        <div className="space-y-2.5 text-left">
          <label className="block text-xs font-medium text-(--color-text-muted)">
            Standart (joriy) kod
            <input autoFocus type="password" inputMode="numeric" autoComplete="off" value={current} onChange={(e) => setCurrent(digits(e.target.value))} className={cn(field, 'mt-1')} placeholder="••••" />
          </label>
          <label className="block text-xs font-medium text-(--color-text-muted)">
            Yangi kod (6–8 raqam)
            <input type="password" inputMode="numeric" autoComplete="new-password" value={next} onChange={(e) => setNext(digits(e.target.value))} className={cn(field, 'mt-1')} placeholder="••••••" />
          </label>
          <label className="block text-xs font-medium text-(--color-text-muted)">
            Yangi kodni takrorlang
            <input type="password" inputMode="numeric" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(digits(e.target.value))} className={cn(field, 'mt-1')} placeholder="••••••" />
          </label>
        </div>
        {(local || error) && <p className="mt-3 text-center text-xs text-(--color-expense)">{local ?? error}</p>}
        <Button type="submit" className="mt-4 w-full" loading={busy} disabled={!ok}>
          Saqlash va kirish
        </Button>
      </form>
    </div>
  );
}

/** Oyna — saqlash yoki yangi suhbat uchun kod */
export function CodeDialog({ title, description, onSubmit, onCancel, busy, error }: { title: string; description?: string; onSubmit: (code: string) => void; onCancel: () => void; busy?: boolean; error?: string | null }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-(--radius-card) bg-white p-6 text-center shadow-xl">
        <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <IconLock className="size-6" />
        </div>
        <h3 className="mt-3 text-base font-bold text-heading">{title}</h3>
        <p className="mt-1 mb-4 text-xs text-(--color-text-muted)">{description ?? 'Chat kodini kiriting'}</p>
        <CodeInput onSubmit={onSubmit} busy={busy} error={error} />
        <button type="button" onClick={onCancel} className="mt-2 text-xs text-(--color-text-muted) hover:text-heading">
          Bekor qilish
        </button>
      </div>
    </div>
  );
}