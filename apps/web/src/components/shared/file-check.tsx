'use client';

import { IconAlert, IconCheck } from '@/components/ui/icons';
import { formatTiyin } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

/**
 * Fayl tekshiruvi (yuklashdan oldin): o'qilgan summa fayldagi «Итого» / qoldiq (bank ko'chirmasi) yoki
 * faktura jami / qator summalari (schyot-faktura) bilan solishtiriladi. API — parseBankStatement / parseInvoiceRows.
 */
export interface StatementChecks {
  ok: boolean;
  items: { code: 'TOTAL_DEBIT' | 'TOTAL_CREDIT' | 'BALANCE'; status: 'OK' | 'MISMATCH' | 'ABSENT'; fileTiyin: string | null; readTiyin: string | null }[];
  columns: { found: string[]; missing: string[] };
  headerRows: number[];
}

export interface InvoiceChecks {
  ok: boolean;
  invoices: number;
  totalsChecked: number;
  totalMismatch: { number: string; date: string; row: number; fileTiyin: string; readTiyin: string }[];
  totalMismatchCount: number;
  itemMismatch: { number: string; row: number; costTiyin: string; vatTiyin: string; totalTiyin: string }[];
  itemMismatchCount: number;
  columns: { found: string[]; missing: string[] };
}

const LABEL: Record<StatementChecks['items'][number]['code'], string> = {
  TOTAL_DEBIT: 'Chiqim (debet) jami — «Итого» bilan',
  TOTAL_CREDIT: 'Kirim (kredit) jami — «Итого» bilan',
  BALANCE: "Qoldiq: kirish + kirim − chiqim = chiqish",
};

/** Ko'chirma ustunlari (o'zbekcha nomi) — topilmaganini ko'rsatish uchun */
const COLUMN: Record<string, string> = {
  no: 'Tartib raqami',
  docDate: 'Hujjat sanasi',
  procDate: 'Ishlov berish sanasi',
  docNo: 'Hujjat raqami',
  accountName: 'Hisob nomi',
  inn: 'INN',
  account: 'Hisob raqami',
  mfo: 'MFO',
  debit: 'Debet',
  credit: 'Kredit',
  purpose: "To'lov maqsadi",
};

function Line({ ok, warn, children }: { ok: boolean; warn?: boolean; children: ReactNode }) {
  return (
    <li className={cn('flex items-start gap-1.5', ok ? 'text-(--color-text-muted)' : warn ? 'text-(--color-text-muted)' : 'text-(--color-expense)')}>
      {ok ? <IconCheck className="mt-0.5 size-3.5 shrink-0 text-(--color-income)" /> : <IconAlert className={cn('mt-0.5 size-3.5 shrink-0', !warn && 'text-(--color-expense)')} />}
      <span>{children}</span>
    </li>
  );
}

export function FileCheck({ checks, invalidCount = 0 }: { checks?: StatementChecks | null; invalidCount?: number }) {
  if (!checks) return null;
  const missing = checks.columns.missing.filter((c) => c !== 'no' && c !== 'procDate');
  return (
    <div className={cn('rounded-(--radius-control) border px-3 py-2 text-xs', checks.ok ? 'border-(--color-line) bg-(--color-surface-muted)' : 'border-(--color-expense)/30 bg-(--color-expense-soft)')}>
      <p className="mb-1 font-medium text-heading">{checks.ok ? 'Fayl tekshiruvi: hammasi mos' : 'Fayl tekshiruvi: diqqat'}</p>
      <ul className="space-y-0.5">
        {checks.items.map((i) =>
          i.status === 'ABSENT' ? (
            <Line key={i.code} ok={false} warn>
              {LABEL[i.code]} — faylda solishtirish uchun qiymat yo&apos;q
            </Line>
          ) : (
            <Line key={i.code} ok={i.status === 'OK'}>
              {LABEL[i.code]}
              {i.status === 'OK' ? (
                <>
                  : <span className="money">{formatTiyin(i.fileTiyin ?? '0')}</span>
                </>
              ) : (
                <>
                  : faylda <span className="money">{formatTiyin(i.fileTiyin ?? '0')}</span>, o&apos;qildi <span className="money">{formatTiyin(i.readTiyin ?? '0')}</span> — fayl to&apos;liq o&apos;qilmagan bo&apos;lishi mumkin
                </>
              )}
            </Line>
          ),
        )}
        {invalidCount > 0 && <Line ok={false}>O&apos;qilmagan qatorlar: {invalidCount} ta</Line>}
        {missing.length > 0 && (
          <Line ok={false} warn>
            Topilmagan ustunlar: {missing.map((c) => COLUMN[c] ?? c).join(', ')}
          </Line>
        )}
        {checks.headerRows.length > 1 && <Line ok>Sarlavha ikki qatorli ({checks.headerRows.join('–')}-qatorlar) — to&apos;g&apos;ri o&apos;qildi</Line>}
      </ul>
    </div>
  );
}

export function InvoiceFileCheck({ checks, invalidCount = 0 }: { checks?: InvoiceChecks | null; invalidCount?: number }) {
  if (!checks) return null;
  return (
    <div className={cn('rounded-(--radius-control) border px-3 py-2 text-xs', checks.ok ? 'border-(--color-line) bg-(--color-surface-muted)' : 'border-(--color-expense)/30 bg-(--color-expense-soft)')}>
      <p className="mb-1 font-medium text-heading">{checks.ok ? 'Fayl tekshiruvi: hammasi mos' : 'Fayl tekshiruvi: diqqat'}</p>
      <ul className="space-y-0.5">
        <Line ok={checks.totalMismatchCount === 0} warn={checks.totalsChecked === 0}>
          {checks.totalsChecked === 0
            ? "Faktura jami («Общ.») qatorlari yo'q — solishtirilmadi"
            : checks.totalMismatchCount === 0
              ? `Faktura jami tovar qatorlari yig'indisiga teng: ${checks.totalsChecked} ta faktura`
              : `Faktura jami tovar qatorlari yig'indisiga teng emas: ${checks.totalMismatchCount} ta — ${checks.totalMismatch.map((m) => `№${m.number} (${m.row}-qator)`).join(', ')}`}
        </Line>
        <Line ok={checks.itemMismatchCount === 0}>
          {checks.itemMismatchCount === 0
            ? "Har qatorda qiymat + QQS = QQS bilan qiymat"
            : `Qiymat + QQS ≠ QQS bilan qiymat: ${checks.itemMismatchCount} ta qator — ${checks.itemMismatch.map((m) => `${m.row}-qator`).join(', ')}`}
        </Line>
        {invalidCount > 0 && <Line ok={false}>O&apos;qilmagan qatorlar: {invalidCount} ta</Line>}
      </ul>
    </div>
  );
}
