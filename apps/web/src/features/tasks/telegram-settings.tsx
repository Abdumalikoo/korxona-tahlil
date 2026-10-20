'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { useAsync } from '@/lib/use-async';
import { fmtWhen, tasksApi, telegramApi, type TaskEmployee } from './api';
import { ActsArchiveCard } from './acts-archive-card';
import { InviteDialog } from './invite-dialog';
import { TgDot } from './task-form';

/**
 * Sozlamalar › Telegram: bot tokeni, xodimlarni botga ulash, sinov xabari.
 */
export function TelegramSettings() {
  const { isAdmin, ready } = useAuth();
  const router = useRouter();
  const status = useAsync(() => telegramApi.status(), []);
  const links = useAsync(() => telegramApi.links(), []);
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askClear, setAskClear] = useState(false);
  const [unlink, setUnlink] = useState<{ pinfl: string; fullName: string } | null>(null);
  const [invite, setInvite] = useState<{ pinfl: string; fullName: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [search, setSearch] = useState('');
  const [people, setPeople] = useState<TaskEmployee[]>([]);

  useEffect(() => {
    if (ready && !isAdmin) router.replace('/');
  }, [ready, isAdmin, router]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      tasksApi
        .employees(search.trim())
        .then((r) => setPeople(r.data))
        .catch(() => setPeople([]));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [search, links.data]);

  if (!ready || !isAdmin) return <LoadingState />;

  const st = status.data?.data;

  async function saveToken() {
    setError(null);
    setSaving(true);
    try {
      const r = await telegramApi.setToken(token.trim());
      setToken('');
      setToast({ text: `Bot ulandi: @${r.data.username ?? ''}`, tone: 'success' });
      status.reload();
    } catch (e) {
      setError(errorMessage(e, "Tokenni saqlab bo'lmadi"));
    } finally {
      setSaving(false);
    }
  }

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      setToast({ text: ok, tone: 'success' });
    } catch (e) {
      setToast({ text: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(null);
      status.reload();
      links.reload();
    }
  }

  return (
    <>
      <PageHeader title="Telegram" description="Topshiriq va eslatmalarni xodimlarga avtomatik yetkazish" />

      <div className="space-y-4 p-4 md:p-6">
        {/* Bot */}
        <Card>
          <CardHeader title="1. Bot" description="Korxona nomidan xabar yuboradigan Telegram bot" />
          <CardBody>
            {status.loading && !st ? (
              <LoadingState />
            ) : st?.configured ? (
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex size-11 items-center justify-center rounded-full bg-sky-50 text-sky-600">
                  <svg viewBox="0 0 24 24" className="size-6" fill="currentColor" aria-hidden>
                    <path d="M21.9 4.3 18.6 20c-.2 1.1-.9 1.4-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.2-8.3c.4-.4-.1-.6-.6-.2L6 13.6l-4.9-1.5c-1.1-.3-1.1-1.1.2-1.6L20.5 3c.9-.3 1.7.2 1.4 1.3z" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    Ulangan:{' '}
                    <a href={`https://t.me/${st.username ?? ''}`} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
                      @{st.username}
                    </a>
                  </p>
                  <p className="text-sm text-(--color-text-muted)">
                    {st.lastError ? <span className="text-red-600">Aloqa yo&apos;q: {st.lastError}</span> : st.polling ? 'Ishlayapti — xabarlar avtomatik yuboriladi' : "To'xtagan"}
                    {' · '}
                    {st.linked} ta xodim ulangan
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setAskClear(true)}>
                  Botni uzish
                </Button>
              </div>
            ) : (
              <div className="grid gap-5 lg:grid-cols-2">
                <ol className="space-y-2 text-sm">
                  <li>
                    1. Telegramda{' '}
                    <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="font-semibold text-brand-700 hover:underline">
                      @BotFather
                    </a>{' '}
                    ni oching va <code className="rounded bg-(--color-surface-sunken) px-1">/newbot</code> yozing.
                  </li>
                  <li>2. Bot nomini yozing (masalan: <i>Korxona topshiriqlari</i>).</li>
                  <li>
                    3. Bot manzilini yozing — oxiri <code className="rounded bg-(--color-surface-sunken) px-1">bot</code> bilan tugasin (masalan: <i>korxona_ishlar_bot</i>).
                  </li>
                  <li>4. BotFather bergan <b>token</b>ni (123456789:AAH… ko&apos;rinishida) shu yerga qo&apos;ying.</li>
                  <li className="text-xs text-(--color-text-muted)">Server api.telegram.org ga internet orqali chiqa olishi kerak. Tashqaridan kirish yoki domen shart emas.</li>
                </ol>
                <div className="space-y-3">
                  <Input label="Bot tokeni" value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456789:AAH..." autoComplete="off" spellCheck={false} />
                  {error && <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">{error}</p>}
                  <Button onClick={() => void saveToken()} loading={saving} disabled={token.trim().length < 20}>
                    Tekshirish va ulash
                  </Button>
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Xodimlarni ulash */}
        <Card>
          <CardHeader
            title="2. Xodimlarni ulash"
            description="Har xodim bir marta o'z havolasini ochib «Start» bosadi — shundan keyin topshiriqlar unga keladi"
          />
          <CardBody>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Xodim ismi, lavozimi yoki JSHSHIR" />
            {people.length === 0 ? (
              <p className="mt-3 text-sm text-(--color-text-muted)">Xodim topilmadi</p>
            ) : (
              <ul className="mt-3 divide-y divide-(--color-line) rounded-(--radius-control) border border-(--color-line)">
                {people.map((p) => (
                  <li key={p.pinfl} className="flex items-center gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.fullName}</span>
                      {p.position && <span className="block truncate text-xs text-(--color-text-muted)">{p.position}</span>}
                    </span>
                    <TgDot linked={p.linked} />
                    <Button size="sm" variant={p.linked ? 'ghost' : 'secondary'} disabled={!st?.configured} onClick={() => setInvite(p)}>
                      {p.linked ? 'Yangi havola' : 'Havola olish'}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {!st?.configured && <p className="mt-2 text-xs text-(--color-text-muted)">Avval botni ulang.</p>}
          </CardBody>
        </Card>

        {/* Dalolatnomalar arxivi (Ombor › imzolangan nusxalar) */}
        <ActsArchiveCard configured={Boolean(st?.configured)} />

        {/* Ulanganlar */}
        <Card className="overflow-hidden">
          <CardHeader title="Ulangan xodimlar" description="Sinov xabari yuborib, xodimga yetib borishini tekshiring" />
          {links.loading && !links.data ? (
            <LoadingState />
          ) : (links.data?.data.length ?? 0) === 0 ? (
            <EmptyState title="Hali hech kim ulanmagan" description="Yuqorida xodim uchun havola oling va unga yuboring" />
          ) : (
            <ul className="divide-y divide-(--color-line)">
              {links.data!.data.map((l) => (
                <li key={l.pinfl} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{l.fullName}</span>
                    <span className="block text-xs text-(--color-text-muted)">
                      {[l.position, l.username ? `@${l.username}` : l.firstName, `ulangan ${fmtWhen(l.linkedAt)}`].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <Button size="sm" variant="secondary" loading={busy === `t:${l.pinfl}`} disabled={!st?.configured} onClick={() => void act(`t:${l.pinfl}`, () => telegramApi.test(l.pinfl), 'Sinov xabari yuborildi')}>
                    Sinov xabari
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setUnlink(l)}>
                    Uzish
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <InviteDialog
        person={invite}
        onClose={() => {
          setInvite(null);
          links.reload();
        }}
      />

      <ConfirmDialog
        open={askClear}
        title="Botni uzish"
        message="Bot uzilsa, topshiriq eslatmalari yuborilmaydi. Xodimlarning ulanishi saqlanib qoladi (shu botni qayta ulasangiz ishlayveradi)."
        confirmLabel="Uzish"
        danger
        loading={busy === 'clear'}
        onConfirm={() => void act('clear', () => telegramApi.clearToken(), 'Bot uzildi').then(() => setAskClear(false))}
        onCancel={() => setAskClear(false)}
      />

      <ConfirmDialog
        open={Boolean(unlink)}
        title="Xodimni uzish"
        message={unlink ? `${unlink.fullName} ga Telegram xabarlari boshqa yuborilmaydi. Qayta ulash uchun yangi havola kerak bo'ladi.` : ''}
        confirmLabel="Uzish"
        danger
        loading={busy === 'u'}
        onConfirm={() => unlink && void act('u', () => telegramApi.unlink(unlink.pinfl), 'Xodim uzildi').then(() => setUnlink(null))}
        onCancel={() => setUnlink(null)}
      />

      {toast && <Toast message={toast.text} tone={toast.tone} onClose={() => setToast(null)} />}
    </>
  );
}