'use client';

import { integrityApi, type IntegrityIssue } from '@/features/shared/integrity-api';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { IconAlert, IconCheck } from '@/components/ui/icons';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { Toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

const tabs = [
  { href: '/sozlamalar/xarajat', label: 'Xarajat' },
  { href: '/sozlamalar/savat', label: 'Savat' },
  { href: '/sozlamalar/tarix', label: 'Tarix' },
  { href: '/sozlamalar/tekshiruv', label: 'Tekshiruv' },
];

const severityStyles = {
  error: {
    border: 'border-[--color-expense]',
    bg: 'bg-[--color-expense-soft]',
    text: 'text-[--color-expense]',
    label: 'Xato',
  },
  warning: {
    border: 'border-[--color-warn]',
    bg: 'bg-[--color-warn-soft]',
    text: 'text-[--color-warn]',
    label: 'Ogohlantirish',
  },
  info: {
    border: 'border-[--color-line-strong]',
    bg: 'bg-[--color-surface-muted]',
    text: 'text-[--color-text-muted]',
    label: "Ma'lumot",
  },
};

export default function IntegrityPage() {
  const { isAdmin, ready } = useAuth();
  const router = useRouter();

  const [fixing, setFixing] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const check = useAsync(() => integrityApi.check(), []);

  useEffect(() => {
    if (ready && !isAdmin) router.replace('/');
  }, [ready, isAdmin, router]);

  async function handleFix(code: string) {
    setFixing(code);

    try {
      const result = await integrityApi.fix(code);
      setToast(result.data.message);
      check.reload();
    } catch (err) {
      setToast(err instanceof ApiError ? err.message : 'Tuzatishda xatolik');
    } finally {
      setFixing(null);
    }
  }

  if (!ready || !isAdmin) return <LoadingState />;

  const data = check.data?.data;
  const issues = data?.issues ?? [];

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;

  return (
    <>
      <PageHeader
        title="Sozlamalar"
        description="Ma'lumotlar yaxlitligini tekshirish"
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={check.reload}
            loading={check.loading}
          >
            Qayta tekshirish
          </Button>
        }
      />

      <Tabs items={tabs} className="bg-white px-6" />

      <div className="space-y-4 p-6">
        {check.loading ? (
          <LoadingState label="Tekshirilmoqda" />
        ) : check.error ? (
          <ErrorState message={check.error} onRetry={check.reload} />
        ) : (
          <>
            {/* Umumiy holat */}
            <Card>
              <CardBody>
                <div className="flex items-center gap-4">
                  <div
                    className={cn(
                      'flex size-12 shrink-0 items-center justify-center rounded-full',
                      issues.length === 0
                        ? 'bg-[--color-income-soft]'
                        : errors > 0
                          ? 'bg-[--color-expense-soft]'
                          : 'bg-[--color-warn-soft]',
                    )}
                  >
                    {issues.length === 0 ? (
                      <IconCheck className="size-6 text-[--color-income]" />
                    ) : (
                      <IconAlert
                        className={cn(
                          'size-6',
                          errors > 0
                            ? 'text-[--color-expense]'
                            : 'text-[--color-warn]',
                        )}
                      />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold">
                      {issues.length === 0
                        ? "Ma'lumotlar tartibda"
                        : `${issues.length} ta muammo topildi`}
                    </p>

                    <p className="mt-0.5 text-sm text-[--color-text-muted]">
                      {issues.length === 0
                        ? 'Hech qanday nomuvofiqlik aniqlanmadi'
                        : [
                            errors > 0 ? `${errors} ta xato` : '',
                            warnings > 0 ? `${warnings} ta ogohlantirish` : '',
                          ]
                            .filter(Boolean)
                            .join(', ')}
                    </p>

                    {data && (
                      <p className="mt-1 text-xs text-[--color-text-faint]">
                        Tekshirilgan: {formatDateTime(data.checkedAt)}
                      </p>
                    )}
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* Muammolar */}
            {issues.map((issue) => (
              <IssueCard
                key={issue.code}
                issue={issue}
                fixing={fixing === issue.code}
                onFix={() => void handleFix(issue.code)}
              />
            ))}
          </>
        )}
      </div>

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </>
  );
}

function IssueCard({
  issue,
  fixing,
  onFix,
}: {
  issue: IntegrityIssue;
  fixing: boolean;
  onFix: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const style = severityStyles[issue.severity];

  return (
    <div
      className={cn(
        'rounded-[--radius-card] border p-4',
        style.border,
        style.bg,
      )}
    >
      <div className="flex items-start gap-3">
        <IconAlert className={cn('mt-0.5 size-5 shrink-0', style.text)} />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={cn('text-sm font-medium', style.text)}>
                {issue.title}
                <span className="ml-2 text-xs opacity-70">
                  {issue.count} ta
                </span>
              </p>

              <p className="mt-1 text-sm text-[--color-text-muted]">
                {issue.description}
              </p>
            </div>

            {issue.fixable && (
              <Button size="sm" onClick={onFix} loading={fixing}>
                Tuzatish
              </Button>
            )}
          </div>

          {issue.details && issue.details.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setExpanded((state) => !state)}
                className="text-xs font-medium text-[--color-text-muted] hover:text-[--color-text]"
              >
                {expanded ? 'Yashirish' : 'Tafsilotlarni ko\u2018rish'}
              </button>

              {expanded && (
                <ul className="mt-2 space-y-1 rounded-[--radius-control] bg-white px-3 py-2">
                  {issue.details.map((detail, index) => (
                    <li
                      key={index}
                      className="money text-xs text-[--color-text-muted]"
                    >
                      {detail}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
