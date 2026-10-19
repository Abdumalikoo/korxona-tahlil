'use client';

import { Button } from '@/components/ui/button';
import { IconChart } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

export default function LoginPage() {
  const { login, user, ready } = useAuth();
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /**
   * Foydalanuvchi aniqlangach bosh sahifaga o'tamiz.
   * Bu ham kirishdan keyin, ham allaqachon kirgan holatda ishlaydi.
   */
  useEffect(() => {
    if (ready && user) {
      router.replace('/');
    }
  }, [ready, user, router]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await login(username.trim(), password);
      // Muvaffaqiyat - yuqoridagi useEffect yo'naltiradi.
      // loading true qoladi, chunki sahifa almashadi.
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Ulanishda xatolik. Qaytadan urinib ko\u2018ring',
      );
      setLoading(false);
    }
  }

  if (!ready) {
    return <div className="min-h-screen bg-[--color-surface-muted]" />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[--color-surface-muted] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-brand-800">
            <IconChart className="size-6 text-white" />
          </div>
          <h1 className="text-xl font-semibold text-[--color-text]">Korxona tahlil</h1>
          <p className="mt-1 text-sm text-[--color-text-muted]">
            Daromad va xarajatlarni kuzatish tizimi
          </p>
        </div>

        <div className="rounded-[--radius-card] border border-[--color-line] bg-white p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
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

            {error && (
              <div className="rounded-[--radius-control] bg-[--color-expense-soft] px-3 py-2.5 text-sm text-[--color-expense]">
                {error}
              </div>
            )}

            <Button type="submit" loading={loading} fullWidth size="lg">
              Kirish
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-[--color-text-faint]">
          Ichki tizim &middot; Faqat vakolatli foydalanuvchilar uchun
        </p>
      </div>
    </div>
  );
}
