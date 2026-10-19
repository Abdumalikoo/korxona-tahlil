'use client';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { useBrief, useViewMode } from '@/lib/view-mode';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════
// Faqat To'liq rejimda ochiladigan bo'lim (modellar, formulalar …).
// Qisqa rejimda — o'rniga qisqa izoh: bo'lim nima va qayerda ko'rish mumkin.
// ═══════════════════════════════════════════════════════════

export function FullOnly({ title, what, children }: { title: string; what: string; children: ReactNode }) {
  const brief = useBrief();
  if (!brief) return <>{children}</>;
  return <FullOnlyNotice title={title} what={what} />;
}

export function FullOnlyNotice({ title, what }: { title: string; what: string }) {
  const { isAdmin } = useAuth();
  const { setMode } = useViewMode();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-(--radius-card) border border-(--color-line) bg-white p-8 text-center shadow-card">
        <span className="inline-block rounded-md bg-brand-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">Qisqa rejim</span>
        <h1 className="mt-3 text-xl font-semibold text-heading">{title}</h1>
        <p className="mt-2 text-sm text-(--color-text-muted)">{what}</p>
        <p className="mt-1 text-sm text-(--color-text-muted)">Bu bo&apos;lim faqat To&apos;liq rejimda ko&apos;rinadi.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link href="/" className="inline-flex h-10 items-center rounded-lg border border-(--color-line) px-4 text-sm font-semibold text-heading hover:bg-brand-50">
            Bosh sahifa
          </Link>
          {isAdmin && (
            <Button
              loading={busy}
              onClick={() => {
                setBusy(true);
                void setMode('full').finally(() => setBusy(false));
              }}
            >
              To&apos;liq rejimga o&apos;tish
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}