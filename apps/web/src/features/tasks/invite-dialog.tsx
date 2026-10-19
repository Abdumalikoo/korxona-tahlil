'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { IconClose } from '@/components/ui/icons';
import { errorMessage } from '@/lib/error-message';
import { fmtWhen, telegramApi, type TelegramInvite } from './api';

/**
 * Xodim uchun shaxsiy Telegram havolasi.
 * Xodim havolani ochib «Start» bosadi — shundan keyin topshiriqlar unga avtomatik keladi.
 */
export function InviteDialog({ person, onClose }: { person: { pinfl: string; fullName: string } | null; onClose: () => void }) {
  const [invite, setInvite] = useState<TelegramInvite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!person) return;
    setInvite(null);
    setError(null);
    setCopied(false);
    telegramApi
      .invite(person.pinfl)
      .then((r) => setInvite(r.data))
      .catch((e: unknown) => setError(errorMessage(e, "Havola yaratib bo'lmadi")));
  }, [person]);

  useEffect(() => {
    if (!person) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [person, onClose]);

  if (!person) return null;

  const message = invite
    ? `Assalomu alaykum, ${person.fullName}! Korxona topshiriqlari va muddat eslatmalari Telegramga keladi. Quyidagi havolani oching va «Start» tugmasini bosing:\n${invite.url}`
    : '';

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label="Telegram havola" className="relative w-full max-w-md rounded-(--radius-card) bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Telegramga ulash</h2>
            <p className="mt-0.5 text-sm text-(--color-text-muted)">{person.fullName}</p>
          </div>
          <button type="button" onClick={onClose} className="flex size-8 items-center justify-center rounded-(--radius-control) text-(--color-text-muted) hover:bg-(--color-surface-sunken)" aria-label="Yopish">
            <IconClose className="size-4" />
          </button>
        </div>

        {error ? (
          <p className="mt-4 rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">{error}</p>
        ) : !invite ? (
          <p className="mt-4 text-sm text-(--color-text-muted)">Havola tayyorlanmoqda…</p>
        ) : (
          <>
            <ol className="mt-4 space-y-1.5 text-sm text-(--color-text)">
              <li>1. Quyidagi xabarni xodimga yuboring (Telegram, SMS yoki qog&apos;ozda).</li>
              <li>2. Xodim havolani ochib, <b>«Start»</b> tugmasini bosadi.</li>
              <li>3. Tayyor — topshiriqlar unga avtomatik keladi.</li>
            </ol>
            <div className="mt-3 rounded-(--radius-control) border border-(--color-line) bg-(--color-surface-muted) p-3">
              <p className="money break-all text-sm text-brand-700">{invite.url}</p>
            </div>
            <p className="mt-2 text-xs text-(--color-text-faint)">Havola {fmtWhen(invite.expiresAt)} gacha amal qiladi va faqat shu xodim uchun.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={onClose}>
                Yopish
              </Button>
              <Button size="sm" onClick={() => void copy()}>
                {copied ? 'Nusxa olindi ✓' : 'Xabarni nusxalash'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}