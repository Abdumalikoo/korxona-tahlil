'use client';

import { Button } from '@/components/ui/button';
import { DeleteDataButton, type DeleteDataProps } from '@/components/shared/delete-data';
import { IconArrowRight, IconChevronDown, IconDownload, IconInbox, IconPlus, IconTrash, IconUpload } from '@/components/ui/icons';
import { flowFor } from '@/features/help/flow';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════
// Manba bo'limidagi hamma sahifa uchun BITTA amallar paneli — har doim bir xil joyda (sarlavha ostida):
//   chapda  — asosiy amal (ko'k): «+ Yangi …» yoki — qo'shish bo'lmagan sahifada — «Faylni yuklash»;
//             so'ng ikkinchi darajali (oq): «Excel'dan yuklash», «Shablon», «Excel'ga yuklab olish», qo'shimchalar
//   o'ngda  — «O'chirish» (qatorlar belgilanganda faol, nechta ekani yoziladi)
//   ostida  — «Bu ma'lumot qayerda ko'rinadi» (features/help/flow.ts): havolalar bilan
// Qo'shish, yuklash va o'chirish — administrator (va o'z bo'limida — ishchi rol, masalan Omborchi).
// ═══════════════════════════════════════════════════════════

export interface SourceAction {
  label: string;
  onClick?: () => void;
  /** Tugma o'rniga havola (masalan, «Yangi xarajat» alohida sahifada) */
  href?: string;
  loading?: boolean;
  disabled?: boolean;
  /** Sichqoncha olib borilganda izoh */
  hint?: string;
}

export interface SourceRemove {
  /** Belgilangan qatorlar soni (0 — tugma nofaol, «qatorlarni belgilang» deyiladi) */
  count: number;
  onClick: () => void;
  /** Masalan: «Belgilangan yozuvlarni o'chirish» */
  label?: string;
  /** count = 0 bo'lganda tushuntirish */
  hint?: string;
  loading?: boolean;
}

function ActionButton({ action, icon, variant }: { action: SourceAction; icon: ReactNode; variant: 'primary' | 'secondary' }) {
  const body = (
    <>
      {icon}
      {action.label}
    </>
  );
  if (action.href && !action.disabled) {
    return (
      <Link
        href={action.href}
        title={action.hint}
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-(--radius-control) px-3.5 text-sm font-medium transition-colors',
          variant === 'primary'
            ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/25 hover:bg-brand-700'
            : 'border border-(--color-line-strong) bg-white text-(--color-text) hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700',
        )}
      >
        {body}
      </Link>
    );
  }
  return (
    <Button size="sm" variant={variant} onClick={action.onClick} loading={action.loading} disabled={action.disabled} title={action.hint}>
      {body}
    </Button>
  );
}

export function SourceActions({
  add,
  upload,
  template,
  download,
  extra,
  remove,
  deleteData,
  note,
  className,
}: {
  add?: SourceAction;
  upload?: SourceAction;
  template?: SourceAction;
  download?: SourceAction;
  /** Qo'shimcha tugmalar (chap tomonda, standartlardan keyin) */
  extra?: ReactNode;
  remove?: SourceRemove;
  /** Yagona o'chirish tugmasi (belgilanganlar · kun · oy · oraliq) — «remove» o'rniga */
  deleteData?: DeleteDataProps;
  /** Tugmalar ostidagi qisqa izoh (masalan: qaysi fayl, qaysi oy) */
  note?: ReactNode;
  className?: string;
}) {
  const { canWrite, canView } = useAuth();
  const pathname = usePathname() ?? '/';
  /** Kiritish huquqi: administrator — hamma joyda, ishchi rol (Omborchi …) — o'z bo'limida */
  const isAdmin = canWrite(pathname);
  // Ishchi rolga faqat o'zi ochadigan joylar ko'rsatiladi
  const flow = flowFor(pathname).filter((t) => canView(t.href));
  const [details, setDetails] = useState(false);

  const showAdd = isAdmin && add;
  const showUpload = isAdmin && upload;
  const showRemove = isAdmin && remove && !deleteData;
  const showDelete = isAdmin && deleteData;
  const hasButtons = showAdd || showUpload || template || download || extra || showRemove || showDelete;

  return (
    <div className={cn('no-print overflow-hidden rounded-(--radius-card) border border-(--color-line) bg-white shadow-card', className)}>
      {hasButtons && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {showAdd && <ActionButton action={add} variant="primary" icon={<IconPlus className="size-4" />} />}
            {showUpload && <ActionButton action={upload} variant={showAdd ? 'secondary' : 'primary'} icon={<IconUpload className="size-4" />} />}
            {template && <ActionButton action={template} variant="secondary" icon={<IconInbox className="size-4" />} />}
            {download && <ActionButton action={download} variant="secondary" icon={<IconDownload className="size-4" />} />}
            {extra}
          </div>

          {showDelete && <DeleteDataButton size="sm" {...deleteData} />}
          {showRemove && (
            <div className="flex items-center gap-2">
              {remove.count === 0 && (
                <span className="hidden text-xs text-(--color-text-muted) 2xl:inline">Avval qatorlarni belgilang →</span>
              )}
              <Button
                size="sm"
                variant={remove.count > 0 ? 'danger' : 'secondary'}
                disabled={remove.count === 0}
                loading={remove.loading}
                onClick={remove.onClick}
                title={remove.count === 0 ? (remove.hint ?? "Avval jadvalda qatorlarni belgilang") : undefined}
              >
                <IconTrash className="size-4" />
                {remove.label ?? "O'chirish"}
                {remove.count > 0 && <span className="rounded bg-white/25 px-1.5 text-xs tabular-nums">{remove.count}</span>}
              </Button>
            </div>
          )}
        </div>
      )}

      {note && <div className={cn('px-4 py-2 text-xs text-(--color-text-muted)', hasButtons && 'border-t border-(--color-line)')}>{note}</div>}

      {!isAdmin && (add || upload || remove) && (
        <p className={cn('px-4 py-2 text-xs text-(--color-text-muted)', hasButtons && 'border-t border-(--color-line)')}>
          Ma&apos;lumot qo&apos;shish, yuklash va o&apos;chirish — faqat administrator uchun.
        </p>
      )}

      {flow.length > 0 && (
        <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1.5 bg-(--color-surface-muted)/60 px-4 py-2.5', (hasButtons || !isAdmin) && 'border-t border-(--color-line)')}>
          <span className="text-xs font-semibold text-(--color-text-muted)">Bu ma&apos;lumot qayerda ko&apos;rinadi:</span>
          {flow.map((t) => (
            <Link
              key={`${t.href}-${t.label}`}
              href={t.href}
              title={t.what}
              className="group inline-flex items-center gap-1 rounded-full border border-(--color-line) bg-white px-2.5 py-1 text-xs text-heading transition-colors hover:border-brand-300 hover:text-brand-700"
            >
              {t.label}
              <IconArrowRight className="size-3 text-(--color-text-faint) group-hover:text-brand-600" />
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setDetails((v) => !v)}
            className="inline-flex items-center gap-0.5 text-xs font-medium text-brand-700 hover:underline"
            aria-expanded={details}
          >
            {details ? 'Yopish' : 'Batafsil'}
            <IconChevronDown className={cn('size-3.5 transition-transform', details && 'rotate-180')} />
          </button>
        </div>
      )}

      {/* Batafsil: har bir joyda aynan nima sifatida ko'rinadi */}
      {details && flow.length > 0 && (
        <ul className="grid gap-x-6 gap-y-1.5 border-t border-(--color-line) bg-(--color-surface-muted)/60 px-4 py-3 text-xs sm:grid-cols-2">
          {flow.map((t) => (
            <li key={`d-${t.href}-${t.label}`} className="flex gap-2">
              <Link href={t.href} className="shrink-0 font-semibold text-heading hover:text-brand-700 hover:underline">
                {t.label} →
              </Link>
              <span className="text-(--color-text-muted)">{t.what}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}