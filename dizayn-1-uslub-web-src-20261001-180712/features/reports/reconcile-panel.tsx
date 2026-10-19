'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { expensesApi } from '@/features/expenses/api';
import { incomesApi } from '@/features/incomes/api';
import { formatTiyin } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';
import { reportsApi, type ReconcileCheck, type ReconcileResult } from './api';

// ═══════════════════════════════════════════════════════════
// Raqamlar tekshiruvi: har bir bo'lim (Hisobotlar, Tahlil, Solishtirma, Bosh sahifa,
// Katta modellar, Nazorat) hisoblagan raqamlar bazadagi to'g'ridan-to'g'ri yig'indilar bilan.
// Bosh sahifa kartalari (Daromadlar / Xarajatlar ro'yxati jamisi) — shu yerda, brauzerdan tekshiriladi.
// ═══════════════════════════════════════════════════════════

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)';

function money(tiyin: string | null): string {
  return tiyin === null ? '—' : formatTiyin(tiyin, { decimals: 2 });
}

/** Bosh sahifa kartalari va ro'yxatlar jamisi — shu API lar orqali */
async function listChecks(r: ReconcileResult): Promise<ReconcileCheck[]> {
  const base = { dateFrom: r.range.from, dateTo: r.range.to, limit: 1 };
  const [inc, exp, incD, expD] = await Promise.all([
    incomesApi.list(base),
    expensesApi.list(base),
    incomesApi.list({ ...base, section: 'DOIMIY' }),
    expensesApi.list({ ...base, section: 'DOIMIY' }),
  ]);
  const check = (name: string, expected: string, actual: string | undefined, detail?: string): ReconcileCheck => ({
    area: "Bosh sahifa va ro'yxatlar",
    name,
    expectedTiyin: expected,
    actualTiyin: actual ?? null,
    ok: actual !== undefined && BigInt(expected) === BigInt(actual),
    ...(detail ? { detail } : {}),
  });
  return [
    check('Daromad kartasi (Daromadlar ro\'yxati jami)', r.baseline.incomeTiyin, inc.meta?.sumTiyin),
    check('Xarajat kartasi (Xarajatlar ro\'yxati jami)', r.baseline.expenseTiyin, exp.meta?.sumTiyin),
    check('Daromadlar ro\'yxati: Doimiy', r.baseline.incomeDoimiyTiyin, incD.meta?.sumTiyin),
    check('Xarajatlar ro\'yxati: Doimiy', r.baseline.expenseDoimiyTiyin, expD.meta?.sumTiyin),
    check(
      "Daromadlar ro'yxati: tushmagan summa",
      r.baseline.receivableTiyin,
      inc.meta?.receivableTiyin,
      "Hisobotlar qoidasi: To'lanmagan — butun summa, Qisman — summa − to'langan, To'langan — 0. Farq bo'lsa, ro'yxat boshqa qoida bilan hisoblaydi",
    ),
  ];
}

export function ReconcilePanel({ range }: { range: { from: string; to: string } }) {
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [checks, setChecks] = useState<ReconcileCheck[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = (await reportsApi.reconcile(range.from, range.to)).data;
      let extra: ReconcileCheck[] = [];
      try {
        extra = await listChecks(r);
      } catch (e) {
        extra = [{ area: "Bosh sahifa va ro'yxatlar", name: "Ro'yxatlar jamisini olib bo'lmadi", expectedTiyin: null, actualTiyin: null, ok: false, detail: e instanceof Error ? e.message : String(e) }];
      }
      setResult(r);
      setChecks([...extra, ...r.checks]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Tekshiruv bajarilmadi');
    } finally {
      setBusy(false);
    }
  };

  const areas = useMemo(() => {
    const map = new Map<string, { ok: number; bad: number }>();
    for (const c of checks) {
      const x = map.get(c.area) ?? { ok: 0, bad: 0 };
      if (c.ok) x.ok += 1;
      else x.bad += 1;
      map.set(c.area, x);
    }
    return [...map.entries()];
  }, [checks]);
  const failed = checks.filter((c) => !c.ok);
  const shown = showAll ? checks : failed;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
        <div>
          <h3 className="text-sm font-semibold">Raqamlar tekshiruvi</h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            Tanlangan davr bo&apos;yicha har bir bo&apos;lim hisoblagan raqam bazadagi yig&apos;indi bilan tiyingacha solishtiriladi: bosh sahifa, Tahlil,
            Solishtirma, Katta modellar, Nazorat va hisobotlar.
          </p>
        </div>
        <Button loading={busy} onClick={run}>
          {busy ? 'Tekshirilmoqda…' : 'Tekshirish'}
        </Button>
      </div>
      {error && <p className="px-5 pb-4 text-sm text-(--color-expense)">{error}</p>}
      {result && (
        <div className="border-t border-(--color-line)">
          <div className="flex flex-wrap items-center gap-2 px-5 py-3">
            <span
              className={cn(
                'rounded-full px-2.5 py-1 text-xs font-semibold',
                failed.length ? 'bg-(--color-expense-soft) text-(--color-expense)' : 'bg-(--color-income-soft) text-(--color-income)',
              )}
            >
              {failed.length ? `${failed.length} ta farq topildi` : `Hammasi mos: ${checks.length} ta tekshiruv`}
            </span>
            <span className="text-xs text-(--color-text-muted)">{result.rangeText}</span>
            {areas.map(([area, x]) => (
              <span key={area} className="rounded border border-(--color-line) px-2 py-0.5 text-[11px] text-(--color-text-muted)">
                {area}: <b className="text-(--color-income)">{x.ok} ✓</b>
                {x.bad > 0 && <b className="ml-1 text-(--color-expense)">{x.bad} ✗</b>}
              </span>
            ))}
            <button type="button" className="ml-auto text-xs font-medium text-brand-700 hover:underline" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Faqat farqlarni ko'rsatish" : `Barcha ${checks.length} ta tekshiruvni ko'rsatish`}
            </button>
          </div>
          {shown.length > 0 && (
            <div className="max-h-[28rem] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-y border-(--color-line) bg-(--color-surface-muted)">
                  <tr>
                    <th className={cn(TH, 'pl-5 text-left')}>Bo&apos;lim</th>
                    <th className={cn(TH, 'text-left')}>Ko&apos;rsatkich</th>
                    <th className={cn(TH, 'text-right')}>Bazada</th>
                    <th className={cn(TH, 'text-right')}>Bo&apos;limda</th>
                    <th className={cn(TH, 'text-right')}>Farq</th>
                    <th className={cn(TH, 'pr-5 text-center')}>Holat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-(--color-line)">
                  {shown.map((c, i) => {
                    const diff = c.expectedTiyin !== null && c.actualTiyin !== null ? (BigInt(c.actualTiyin) - BigInt(c.expectedTiyin)).toString() : null;
                    const count = c.detail === 'soni (tiyin emas)';
                    return (
                      <tr key={`${c.area}-${c.name}-${i}`}>
                        <td className="whitespace-nowrap py-2 pl-5 pr-3 text-(--color-text-muted)">{c.area}</td>
                        <td className="px-3 py-2">
                          {c.name}
                          {c.detail && !count && <span className="block text-[11px] text-(--color-text-faint)">{c.detail}</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{count ? c.expectedTiyin : money(c.expectedTiyin)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{count ? c.actualTiyin : money(c.actualTiyin)}</td>
                        <td className={cn('whitespace-nowrap px-3 py-2 text-right tabular-nums', diff && diff !== '0' && 'text-(--color-expense)')}>
                          {diff === null ? '—' : count ? diff : money(diff)}
                        </td>
                        <td className={cn('py-2 pl-3 pr-5 text-center font-semibold', c.ok ? 'text-(--color-income)' : 'text-(--color-expense)')}>{c.ok ? '✓' : '✗'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}