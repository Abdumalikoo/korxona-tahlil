'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconCheck, IconEdit, IconPlus } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { fmtWhen, leftLabel, reminderLabel, tasksApi, telegramApi, type Task, type TaskFilter } from './api';
import { InviteDialog } from './invite-dialog';
import { TaskForm, TgDot } from './task-form';

const FILTERS: { key: TaskFilter; label: string }[] = [
  { key: 'active', label: 'Faol' },
  { key: 'overdue', label: "Muddati o'tgan" },
  { key: 'done', label: 'Bajarilgan' },
  { key: 'cancelled', label: 'Bekor qilingan' },
];

/**
 * Topshiriqlar — xodimga muddatli ish beriladi, dastur belgilangan soatlarda uni
 * Telegramga avtomatik yuboradi. Bajarilganini rahbar shu yerda belgilaydi.
 */
export function TasksPage() {
  const { isAdmin } = useAuth();
  const [filter, setFilter] = useState<TaskFilter>('active');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [invite, setInvite] = useState<{ pinfl: string; fullName: string } | null>(null);
  const [confirm, setConfirm] = useState<{ task: Task; kind: 'cancel' | 'delete' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [, setTick] = useState(0);

  const list = useAsync(() => tasksApi.list(filter), [filter]);
  const counts = useAsync(() => Promise.all([tasksApi.list('active'), tasksApi.list('overdue')]), [list.data]);
  const status = useAsync(() => telegramApi.status(), []);

  // «qoldi» yozuvlari har daqiqada yangilanadi
  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const botReady = Boolean(status.data?.data.configured);
  const tasks = list.data?.data ?? [];
  const active = counts.data?.[0].data ?? [];
  const overdue = counts.data?.[1].data.length ?? 0;
  const dueToday = active.filter((t) => !t.overdue && new Date(t.deadline).getTime() - Date.now() < 24 * 3_600_000).length;
  const unlinked = new Set(active.filter((t) => !t.linked).map((t) => t.pinfl)).size;

  const run = useCallback(
    async (task: Task, action: 'done' | 'cancel' | 'reopen' | 'remind' | 'delete') => {
      setBusy(`${task.id}:${action}`);
      try {
        if (action === 'delete') await tasksApi.remove(task.id);
        else await tasksApi[action](task.id);
        const text = {
          done: 'Bajarildi deb belgilandi',
          cancel: 'Topshiriq bekor qilindi',
          reopen: 'Topshiriq qayta ochildi',
          remind: 'Telegramga yuborildi',
          delete: "Topshiriq o'chirildi",
        }[action];
        setToast({ text, tone: 'success' });
        list.reload();
      } catch (e) {
        setToast({ text: errorMessage(e), tone: 'error' });
        list.reload();
      } finally {
        setBusy(null);
        setConfirm(null);
      }
    },
    [list],
  );

  return (
    <>
      <PageHeader
        title="Topshiriqlar"
        description="Xodimga muddatli ish — Telegramga avtomatik eslatma"
        actions={
          isAdmin && (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <IconPlus className="size-4" />
              Yangi topshiriq
            </Button>
          )
        }
      />

      <div className="space-y-4 p-4 md:p-6">
        {/* Bot holati */}
        {status.data && !botReady && (
          <div className="flex flex-wrap items-center gap-3 rounded-(--radius-card) border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span className="min-w-0 flex-1">
              <b>Telegram bot hali ulanmagan.</b> Topshiriqlar saqlanadi, lekin xabar ketmaydi.
            </span>
            {isAdmin && (
              <Link href="/sozlamalar/telegram" className="font-semibold text-amber-900 underline">
                Botni ulash →
              </Link>
            )}
          </div>
        )}
        {status.data?.data.lastError && botReady && (
          <div className="rounded-(--radius-card) border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            Telegram bilan aloqa yo&apos;q: {status.data.data.lastError}
          </div>
        )}

        {/* Raqamlar */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Faol topshiriqlar" value={active.length} />
          <Stat label="24 soat ichida muddati" value={dueToday} tone={dueToday ? 'warn' : undefined} />
          <Stat label="Muddati o'tgan" value={overdue} tone={overdue ? 'bad' : undefined} />
          <Stat label="Telegramga ulanmagan xodim" value={unlinked} tone={unlinked ? 'warn' : undefined} hint={unlinked ? "«Ulash» tugmasi bilan havola yuboring" : undefined} />
        </div>

        {/* Filtr */}
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
                filter === f.key ? 'border-brand-600 bg-brand-600 text-white' : 'border-(--color-line-strong) bg-white hover:border-brand-300 hover:bg-brand-50',
              )}
            >
              {f.label}
              {f.key === 'overdue' && overdue > 0 && <span className={cn('ml-1.5 rounded-full px-1.5 text-xs', filter === f.key ? 'bg-white/25' : 'bg-red-100 text-red-700')}>{overdue}</span>}
            </button>
          ))}
        </div>

        <Card className="overflow-hidden">
          {list.loading && !list.data ? (
            <LoadingState />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : tasks.length === 0 ? (
            <EmptyState
              title={filter === 'active' ? "Faol topshiriq yo'q" : "Bu ro'yxat bo'sh"}
              description={filter === 'active' ? "«Yangi topshiriq» — xodimga muddatli ish bering, eslatma Telegramga o'zi boradi" : undefined}
            />
          ) : (
            <ul className="divide-y divide-(--color-line)">
              {tasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  admin={isAdmin}
                  botReady={botReady}
                  busy={busy}
                  onAction={(a) => (a === 'cancel' || a === 'delete' ? setConfirm({ task: t, kind: a }) : void run(t, a))}
                  onEdit={() => {
                    setEditing(t);
                    setFormOpen(true);
                  }}
                  onInvite={() => setInvite({ pinfl: t.pinfl, fullName: t.employeeName })}
                />
              ))}
            </ul>
          )}
        </Card>
      </div>

      <TaskForm
        open={formOpen}
        task={editing}
        botReady={botReady}
        onClose={() => setFormOpen(false)}
        onSaved={(task, created) => {
          setFormOpen(false);
          const sent = task.reminders.some((r) => r.hoursBefore < 0 && r.sentAt);
          setToast({ text: created ? (sent ? `Topshiriq berildi va ${task.employeeName}ga Telegramda yuborildi` : 'Topshiriq saqlandi') : "O'zgarishlar saqlandi", tone: 'success' });
          if (filter !== 'active') setFilter('active');
          else list.reload();
        }}
      />

      <InviteDialog person={invite} onClose={() => setInvite(null)} />

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.kind === 'delete' ? "Topshiriqni o'chirish" : 'Topshiriqni bekor qilish'}
        message={
          confirm
            ? confirm.kind === 'delete'
              ? `«${confirm.task.title}» butunlay o'chiriladi.`
              : `«${confirm.task.title}» bekor qilinadi, eslatmalar boshqa yuborilmaydi.`
            : ''
        }
        confirmLabel={confirm?.kind === 'delete' ? "O'chirish" : 'Bekor qilish'}
        cancelLabel="Ortga"
        danger
        loading={Boolean(busy)}
        onConfirm={() => confirm && void run(confirm.task, confirm.kind)}
        onCancel={() => setConfirm(null)}
      />

      {toast && <Toast message={toast.text} tone={toast.tone} onClose={() => setToast(null)} />}
    </>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: number; tone?: 'warn' | 'bad'; hint?: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs text-(--color-text-muted)">{label}</p>
      <p className={cn('money mt-1 text-2xl font-semibold', tone === 'bad' && 'text-red-600', tone === 'warn' && 'text-amber-600')}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-(--color-text-faint)">{hint}</p>}
    </Card>
  );
}

type Action = 'done' | 'cancel' | 'reopen' | 'remind' | 'delete';

function TaskRow({
  task: t,
  admin,
  botReady,
  busy,
  onAction,
  onEdit,
  onInvite,
}: {
  task: Task;
  admin: boolean;
  botReady: boolean;
  busy: string | null;
  onAction: (a: Action) => void;
  onEdit: () => void;
  onInvite: () => void;
}) {
  const open = t.status === 'OPEN';
  const left = leftLabel(t.deadline);
  const is = (a: Action) => busy === `${t.id}:${a}`;

  return (
    <li className={cn('flex flex-col gap-3 px-4 py-4 md:flex-row md:items-start md:gap-5 md:px-5', t.overdue && 'bg-red-50/40')}>
      {/* Topshiriq */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={cn('font-semibold', !open && 'text-(--color-text-muted) line-through decoration-1')}>{t.title}</p>
          {t.status === 'DONE' && <span className="rounded-full bg-(--color-income-soft) px-2 py-0.5 text-[11px] font-semibold text-(--color-income)">Bajarildi</span>}
          {t.status === 'CANCELLED' && <span className="rounded-full bg-(--color-surface-sunken) px-2 py-0.5 text-[11px] font-semibold text-(--color-text-muted)">Bekor</span>}
        </div>
        {t.description && <p className="mt-0.5 line-clamp-2 text-sm text-(--color-text-muted)">{t.description}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{t.employeeName}</span>
          {t.position && <span className="text-(--color-text-faint)">· {t.position}</span>}
          <TgDot linked={t.linked} />
          {!t.linked && admin && open && (
            <button type="button" onClick={onInvite} className="text-xs font-semibold text-brand-700 hover:underline">
              Ulash
            </button>
          )}
        </div>
        {/* Eslatmalar */}
        {t.reminders.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {t.reminders.map((r) => (
              <span
                key={r.id}
                title={r.sentAt ? `Yuborildi: ${fmtWhen(r.sentAt)}` : r.error ? `${r.error} (${r.attempts} urinish)` : `Yuboriladi: ${fmtWhen(r.dueAt)}`}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                  r.sentAt ? 'bg-(--color-income-soft) text-(--color-income)' : r.error ? 'bg-amber-50 text-amber-700' : 'bg-(--color-surface-sunken) text-(--color-text-muted)',
                )}
              >
                {r.sentAt ? '✓' : r.error ? '⚠' : '⏳'} {reminderLabel(r.hoursBefore)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Muddat */}
      <div className="shrink-0 md:w-44 md:text-right">
        <p className="money text-sm font-medium">{fmtWhen(t.deadline)}</p>
        {open ? (
          <p className={cn('text-xs font-semibold', left.tone === 'late' ? 'text-red-600' : left.tone === 'soon' ? 'text-amber-600' : 'text-(--color-text-muted)')}>{left.text}</p>
        ) : (
          t.doneAt && <p className="text-xs text-(--color-text-muted)">Bajarildi: {fmtWhen(t.doneAt)}</p>
        )}
        {t.createdByName && <p className="mt-0.5 text-[11px] text-(--color-text-faint)">Berdi: {t.createdByName}</p>}
      </div>

      {/* Amallar */}
      {admin && (
        <div className="flex shrink-0 flex-wrap gap-1.5 md:w-56 md:justify-end">
          {open ? (
            <>
              <Button size="sm" onClick={() => onAction('done')} loading={is('done')}>
                <IconCheck className="size-4" />
                Bajarildi
              </Button>
              <Button size="sm" variant="secondary" onClick={() => onAction('remind')} loading={is('remind')} disabled={!botReady || !t.linked} title={!t.linked ? 'Xodim Telegramga ulanmagan' : 'Hozir Telegramga yuborish'}>
                Yuborish
              </Button>
              <Button size="sm" variant="ghost" onClick={onEdit} aria-label="Tahrirlash" title="Tahrirlash">
                <IconEdit className="size-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onAction('cancel')} title="Bekor qilish">
                Bekor
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={() => onAction('reopen')} loading={is('reopen')}>
                Qayta ochish
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onAction('delete')}>
                O&apos;chirish
              </Button>
            </>
          )}
        </div>
      )}
    </li>
  );
}