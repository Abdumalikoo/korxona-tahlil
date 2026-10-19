'use client';

import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { IconLogout } from '@/components/ui/icons';
import { NavLogo } from '@/components/layout/nav-icons';
import { api, type ApiResponse } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import type { LoginResult } from '@/lib/types';
import { cn } from '@/lib/utils';
import { forwardRef, useEffect, useId, useState, type FormEvent, type InputHTMLAttributes } from 'react';

// ═══════════════════════════════════════════════════════════
// PIN: kiritish maydoni, qoidalar (serverdagi bilan bir xil), o'zgartirish formasi.
//  • PinSetupScreen — admin bergan PIN bilan birinchi kirishda: o'z PIN'ini o'rnatmaguncha boshqa hech narsa ochilmaydi
//  • PinChangeDialog — istalgan vaqtda (menyudan)
// ═══════════════════════════════════════════════════════════

/** Oson topiladigan PIN — sababi; yaxshi bo'lsa null (server ham shu qoidalar bilan tekshiradi) */
export function weakPinReason(pin: string): string | null {
  if (!/^\d{6}$/.test(pin)) return "PIN 6 ta raqamdan iborat bo'lishi kerak";
  const d = pin.split('').map(Number);
  if (d.every((x) => x === d[0])) return "Bir xil raqamlardan iborat PIN oson topiladi";
  const steps = d.slice(1).map((x, i) => x - d[i]!);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return 'Ketma-ket raqamlar (123456, 654321) oson topiladi';
  if (pin.slice(0, 2).repeat(3) === pin || pin.slice(0, 3).repeat(2) === pin) return 'Takrorlanuvchi PIN (121212, 123123) oson topiladi';
  if (d[0] === d[1] && d[2] === d[3] && d[4] === d[5] && d[2] === d[0]! + 1 && d[4] === d[2]! + 1) return 'Bunday PIN (112233) oson topiladi';
  return null;
}

type PinInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
};

/** 6 xonali PIN maydoni: faqat raqam, yashirin, katta harflar oralig'i bilan */
export const PinInput = forwardRef<HTMLInputElement, PinInputProps>(function PinInput({ label, value, onChange, hint, error, className, ...rest }, ref) {
  const id = useId();
  const [show, setShow] = useState(false);
  return (
    <div className="w-full">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-(--color-text)">
        {label}
      </label>
      <div className="relative">
        <input
          ref={ref}
          id={id}
          type={show ? 'text' : 'password'}
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
          className={cn(
            'h-12 w-full rounded-(--radius-control) border bg-white px-4 pr-20 text-center font-mono text-xl tracking-[0.6em] transition-colors focus:border-brand-600 disabled:bg-(--color-surface-sunken)',
            error ? 'border-(--color-expense)' : 'border-(--color-line-strong)',
            className,
          )}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute inset-y-0 right-2 my-auto h-8 rounded-md px-2 text-xs font-medium text-(--color-text-muted) hover:bg-(--color-surface-muted) hover:text-heading"
          tabIndex={-1}
        >
          {show ? 'Yashirish' : "Ko'rsatish"}
        </button>
      </div>
      {error ? <p className="mt-1 text-xs text-(--color-expense)">{error}</p> : hint ? <p className="mt-1 text-xs text-(--color-text-muted)">{hint}</p> : null}
    </div>
  );
});

/** Joriy PIN → yangi PIN → takrorlash. Muvaffaqiyatda sessiya yangi token bilan davom etadi. */
function PinChangeForm({ forced, onDone, onCancel }: { forced: boolean; onDone: () => void; onCancel?: () => void }) {
  const { applySession } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weak = next.length === 6 ? weakPinReason(next) : null;
  const same = next.length === 6 && next === current;
  const mismatch = repeat.length === 6 && repeat !== next;
  const ok = current.length === 6 && next.length === 6 && !weak && !same && repeat === next;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      const r = await api.post<ApiResponse<LoginResult>>('/auth/change-pin', { currentPin: current, newPin: next });
      applySession(r.data);
      onDone();
    } catch (err) {
      setError(errorMessage(err, "PIN o'zgartirilmadi"));
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <PinInput label={forced ? 'Administrator bergan PIN' : 'Joriy PIN'} value={current} onChange={setCurrent} autoFocus disabled={saving} />
      <PinInput
        label="Yangi PIN"
        value={next}
        onChange={setNext}
        disabled={saving}
        error={weak ?? (same ? 'Yangi PIN eskisidan farq qilishi kerak' : null)}
        hint="6 ta raqam. 111111, 123456, 121212 kabi oson PIN qabul qilinmaydi"
      />
      <PinInput label="Yangi PIN (takror)" value={repeat} onChange={setRepeat} disabled={saving} error={mismatch ? 'PIN mos kelmadi' : null} />
      {error && <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2.5 text-sm text-(--color-expense)">{error}</p>}
      <div className="flex gap-2">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
            Bekor qilish
          </Button>
        )}
        <Button type="submit" loading={saving} disabled={!ok} fullWidth={!onCancel} size="lg" className={onCancel ? 'flex-1' : undefined}>
          PIN&apos;ni saqlash
        </Button>
      </div>
    </form>
  );
}

/** Birinchi kirish: o'z PIN'ini o'rnatmaguncha dastur ochilmaydi */
export function PinSetupScreen() {
  const { user, logout } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-(--color-surface-muted) px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-brand-600 text-white">
            <NavLogo className="size-6" />
          </div>
          <h1 className="text-xl font-bold text-heading">O&apos;z PIN kodingizni o&apos;rnating</h1>
          <p className="mt-1 text-sm text-(--color-text-muted)">
            {user?.fullName} · <span className="font-mono font-semibold">{user?.loginCode}</span> · {user?.roleLabel}
          </p>
        </div>
        <div className="rounded-(--radius-card) border border-(--color-line) bg-white p-6 shadow-card">
          <p className="mb-4 rounded-(--radius-control) bg-brand-50 px-3 py-2.5 text-sm text-heading">
            Administrator bergan PIN vaqtinchalik. Faqat o&apos;zingiz biladigan yangi PIN o&apos;rnating — keyin u bilan kirasiz.
          </p>
          <PinChangeForm forced onDone={() => undefined} />
        </div>
        <button type="button" onClick={logout} className="mx-auto mt-5 flex items-center gap-1.5 text-sm text-(--color-text-muted) hover:text-heading">
          <IconLogout className="size-4" />
          Chiqish
        </button>
      </div>
    </div>
  );
}

/** Menyudan: PIN'ni o'zgartirish */
export function PinChangeDialog({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (open) setKey((k) => k + 1);
  }, [open]);
  return (
    <Drawer open={open} onClose={onClose} title="PIN kodni o'zgartirish" description="Yangi PIN darhol kuchga kiradi; boshqa kompyuterlardagi ochiq oynalar yopiladi.">
      <PinChangeForm
        key={key}
        forced={false}
        onCancel={onClose}
        onDone={() => {
          onChanged();
          onClose();
        }}
      />
    </Drawer>
  );
}