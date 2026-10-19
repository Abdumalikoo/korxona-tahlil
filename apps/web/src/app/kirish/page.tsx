'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NavLogo } from '@/components/layout/nav-icons';
import { PinInput } from '@/features/auth/pin';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

// ═══════════════════════════════════════════════════════════
// Kirish: ikki usul —
//  • «Login va parol» — administrator va kuzatuvchi
//  • «ID kod bilan» — ishchi rollar (Omborchi …): ID kod (SK-0001) va 6 xonali PIN
// Tanlangan usul brauzerda eslab qolinadi (ombor kompyuterida har safar ID kod oynasi ochiladi).
// ═══════════════════════════════════════════════════════════

type Mode = 'password' | 'code';
const MODE_KEY = 'korxona_login_mode';

function readMode(): Mode {
  try {
    return window.localStorage.getItem(MODE_KEY) === 'code' ? 'code' : 'password';
  } catch {
    return 'password';
  }
}

function saveMode(mode: Mode) {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // eslab qolinmasa ham ishlayveradi
  }
}

export default function LoginPage() {
  const { login, codeLogin, user, ready, home } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => setMode(readMode()), []);

  /**
   * Foydalanuvchi aniqlangach o'z bo'limiga o'tamiz:
   * administrator — bosh sahifa, omborchi — Ombor.
   */
  useEffect(() => {
    if (ready && user) {
      router.replace(home);
    }
  }, [ready, user, home, router]);

  const switchMode = (next: Mode) => {
    setMode(next);
    saveMode(next);
    setError(null);
  };

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'password') await login(username.trim(), password);
      else await codeLogin(code.trim(), pin);
      // Muvaffaqiyat - yuqoridagi useEffect yo'naltiradi.
      // loading true qoladi, chunki sahifa almashadi.
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Ulanishda xatolik. Qaytadan urinib ko‘ring',
      );
      if (mode === 'code') setPin('');
      setLoading(false);
    }
  }

  if (!ready) {
    return <div className="min-h-screen bg-(--color-surface-muted)" />;
  }

  const codeOk = /^\s*[A-Za-z]{2,4}-?\d{1,6}\s*$/.test(code) && pin.length === 6;

  return (
    <div className="flex min-h-screen items-center justify-center bg-(--color-surface-muted) px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-brand-600 text-white">
            <NavLogo className="size-6" />
          </div>
          <h1 className="text-xl font-semibold text-(--color-text)">Korxona tahlil</h1>
          <p className="mt-1 text-sm text-(--color-text-muted)">
            Daromad va xarajatlarni kuzatish tizimi
          </p>
        </div>

        <div className="overflow-hidden rounded-(--radius-card) border border-(--color-line) bg-white">
          {/* Kirish usuli */}
          <div className="grid grid-cols-2 border-b border-(--color-line)" role="tablist">
            {(
              [
                { key: 'password', label: 'Login va parol' },
                { key: 'code', label: 'ID kod bilan' },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={mode === t.key}
                onClick={() => switchMode(t.key)}
                disabled={loading}
                className={cn(
                  'relative py-3 text-sm transition-colors',
                  mode === t.key ? 'font-semibold text-brand-700' : 'text-(--color-text-muted) hover:text-heading',
                )}
              >
                {t.label}
                {mode === t.key && <span className="absolute inset-x-6 -bottom-px h-0.5 rounded bg-brand-600" />}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 p-6">
            {mode === 'password' ? (
              <>
                <Input
                  label="Foydalanuvchi nomi"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  autoFocus
                  required
                  disabled={loading}
                />

                <Input
                  label="Parol"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                  disabled={loading}
                />
              </>
            ) : (
              <>
                <Input
                  label="ID kod"
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  placeholder="SK-0001"
                  autoComplete="username"
                  autoFocus
                  required
                  disabled={loading}
                  className="font-mono uppercase tracking-wider"
                  hint="Administrator bergan kod"
                />
                <PinInput label="PIN (6 raqam)" value={pin} onChange={setPin} disabled={loading} />
              </>
            )}

            {error && (
              <div className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2.5 text-sm text-(--color-expense)">
                {error}
              </div>
            )}

            <Button type="submit" loading={loading} disabled={mode === 'code' && !codeOk} fullWidth size="lg">
              Kirish
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-(--color-text-faint)">
          {mode === 'code'
            ? 'PIN 5 marta xato kiritilsa — hisob 15 daqiqaga yopiladi'
            : <>Ichki tizim &middot; Faqat vakolatli foydalanuvchilar uchun</>}
        </p>
      </div>
    </div>
  );
}