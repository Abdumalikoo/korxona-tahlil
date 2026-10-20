'use client';

import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { errorMessage } from '@/lib/error-message';
import { useAsync } from '@/lib/use-async';
import { useEffect, useState } from 'react';
import { fmtWhen, telegramApi, type TelegramArchiveCode } from './api';

/**
 * Sozlamalar › Telegram › Dalolatnomalar arxivi.
 * Xodim telefonda imzolagan har bir dalolatnoma (Word) 2 nusxada yuboriladi:
 * 1) xodimning o'ziga (botga ulangan bo'lsa), 2) shu arxiv guruhiga.
 */
export function ActsArchiveCard({ configured }: { configured: boolean }) {
  const arch = useAsync(() => telegramApi.archive(), []);
  const [code, setCode] = useState<TelegramArchiveCode | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = arch.data?.data ?? null;

  const reload = arch.reload;
  // Kod berilgan bo'lsa — guruh ulanishini kutib, har 4 soniyada tekshiramiz
  useEffect(() => {
    if (!code) return;
    const t = window.setInterval(reload, 4000);
    return () => window.clearInterval(t);
  }, [code, reload]);

  // Kod berilgandan keyin guruh ulandi — yo'riqnomani yopamiz
  useEffect(() => {
    if (code && current?.setAt && new Date(current.setAt).getTime() >= new Date(code.expiresAt).getTime() - 30 * 60_000) setCode(null);
  }, [code, current]);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader title="3. Dalolatnomalar arxivi" description="Imzolangan dalolatnomaning 2-nusxasi shu guruhga tushadi (1-nusxa — xodimning o'ziga)" />
      <CardBody>
        {current ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid size-9 place-items-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">✓</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{current.title ?? 'Guruh'}</span>
              <span className="block text-xs text-(--color-text-muted)">
                Chat ID {current.chatId}
                {current.setAt ? ` · ulangan ${fmtWhen(current.setAt)}` : ''}
              </span>
            </span>
            <Button size="sm" variant="secondary" disabled={!configured} loading={busy === 'code'} onClick={() => void run('code', async () => setCode((await telegramApi.archiveCode()).data))}>
              Boshqa guruhga o&apos;tkazish
            </Button>
            <Button size="sm" variant="ghost" loading={busy === 'clear'} onClick={() => void run('clear', async () => { await telegramApi.clearArchive(); setCode(null); arch.reload(); })}>
              Uzish
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-(--color-text-muted)">Arxiv guruhi belgilanmagan — imzolangan nusxalar faqat dasturda va xodimning o&apos;zida saqlanadi.</p>
            <Button size="sm" disabled={!configured} loading={busy === 'code'} onClick={() => void run('code', async () => setCode((await telegramApi.archiveCode()).data))}>
              Guruhni ulash
            </Button>
          </div>
        )}

        {code && (
          <ol className="mt-4 list-decimal space-y-1.5 rounded-xl bg-brand-50/60 py-3 pr-4 pl-9 text-sm ring-1 ring-brand-100">
            <li>Telegramda arxiv uchun guruh oching (yoki mavjudini tanlang).</li>
            <li>
              Guruhga botni qo&apos;shing{code.botUsername ? (
                <>
                  : <b>@{code.botUsername}</b>
                </>
              ) : null}
              .
            </li>
            <li>
              Guruhga shu buyruqni yozing:{' '}
              <code className="rounded bg-white px-2 py-0.5 font-mono text-base font-semibold ring-1 ring-brand-200 select-all">{code.command}</code>
            </li>
            <li className="text-xs text-(--color-text-muted)">Kod {fmtWhen(code.expiresAt)} gacha amal qiladi. Guruh ulanishi bilan bu yerda o&apos;zi ko&apos;rinadi.</li>
          </ol>
        )}
        {!configured && <p className="mt-2 text-xs text-(--color-text-muted)">Avval botni ulang.</p>}
        {error && <p className="mt-2 text-sm text-(--color-expense)">{error}</p>}
      </CardBody>
    </Card>
  );
}