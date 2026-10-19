import { Badge } from '@/components/ui/badge';
import type { AssetStatus, DocKind } from './api';
import { ASSET_STATUS_LABELS, DOC_KIND_LABELS } from './api';

// Ombor sahifalari uchun kichik umumiy bo'laklar

const DOC_TONES: Record<DocKind, 'income' | 'expense' | 'warn' | 'brand' | 'neutral'> = {
  RECEIPT: 'income',
  ISSUE: 'brand',
  RETURN: 'neutral',
  TRANSFER: 'warn',
  WRITE_OFF: 'expense',
};

export function DocKindBadge({ kind }: { kind: DocKind }) {
  return <Badge tone={DOC_TONES[kind]} className="whitespace-nowrap">{DOC_KIND_LABELS[kind]}</Badge>;
}

const STATUS_TONES: Record<AssetStatus, 'income' | 'brand' | 'neutral'> = {
  IN_STOCK: 'income',
  IN_USE: 'brand',
  WRITTEN_OFF: 'neutral',
};

export function AssetStatusBadge({ status }: { status: AssetStatus }) {
  return <Badge tone={STATUS_TONES[status]} className="whitespace-nowrap">{ASSET_STATUS_LABELS[status]}</Badge>;
}

/** Kichik yorliq-qiymat qatori (oynalar ichida) */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-(--color-text-muted)">{label}</p>
      <div className="mt-0.5 break-words text-sm font-medium text-heading">{children || '—'}</div>
    </div>
  );
}