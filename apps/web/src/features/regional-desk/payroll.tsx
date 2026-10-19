'use client';

import { PageHeader } from '@/components/layout/page-header';
import { DeleteDataButton } from '@/components/shared/delete-data';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime, todayInput } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { useState } from 'react';
import { analyzePayrollFile, downloadPayrollTemplate, monthLabel, rdApi, type RdBatch, type RdPayrollAnalysis } from './api';
import { Dropzone, MonthPicker, Notice, Stat, som } from './bits';

// ═══════════════════════════════════════════════════════════
// Hududchi › Ish haqi: hudud xodimlari oylik vedomosti (PINFL · Summa) — umumiy tizimdagidek.
//   • markaz xodimlari kirmaydi (ular — administratorning umumiy vedomostida);
//   • shu oy umumiy vedomostda bor xodimlar ham kirmaydi — ish haqi ikki marta sanalmaydi;
//   • saqlanganda har viloyat bo'yicha «Ish haqi» xarajati yoziladi; qayta yuklash — almashtiradi.
// ═══════════════════════════════════════════════════════════

export function RegionalPayroll() {
  const [period, setPeriod] = useState(todayInput().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [a, setA] = useState<RdPayrollAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'error' } | null>(null);
  const [cancel, setCancel] = useState<RdBatch | null>(null);
  const batches = useAsync(() => rdApi.batches(), []);

  const analyze = async (f: File) => {
    setBusy(true);
    setError(null);
    try {
      setA(await analyzePayrollFile(f, period));
    } catch (e) {
      setA(null);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!a) return;
    setSaving(true);
    try {
      const r = await rdApi.commitPayroll(a);
      setToast({ message: `${monthLabel(a.period)}: ${r.data.employees} xodim, ${som(r.data.totalTiyin)} so'm saqlandi${r.data.replacedPrevious ? ' (oldingisi almashtirildi)' : ''}` });
      setA(null);
      batches.reload();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const doCancel = async () => {
    if (!cancel) return;
    try {
      await rdApi.cancelPayroll(cancel.id);
      setToast({ message: `${monthLabel(cancel.period)} vedomosti bekor qilindi` });
      batches.reload();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setCancel(null);
    }
  };

  const list = batches.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Ish haqi (hududlar)"
        description="Hudud xodimlarining oylik vedomosti: PINFL · Summa. Markaz xodimlari — umumiy vedomostda"
        actions={
          <>
            <Button variant="secondary" onClick={() => void downloadPayrollTemplate(period).catch((e) => setToast({ message: errorMessage(e), tone: 'error' }))}>
              Shablon ({monthLabel(period)})
            </Button>
            <DeleteDataButton
              target="PAYROLL"
              scope={{ regional: true }}
              month={period}
              place="Hududlar ish haqi"
              onDone={({ count }) => {
                setToast({ message: `${count} ta vedomost bekor qilindi` });
                batches.reload();
              }}
            />
          </>
        }
      />
      <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-heading">Qaysi oy:</span>
          <MonthPicker
            value={period}
            onChange={(p) => {
              setPeriod(p);
              setA(null);
            }}
            max={todayInput().slice(0, 7)}
          />
        </div>

        {!a && (
          <>
            <Dropzone
              tone="emerald"
              busy={busy}
              onFile={(f) => void analyze(f)}
              title={`${monthLabel(period)} vedomostini tashlang`}
              hint={
                <>
                  Birinchi varaq: <b>A — PINFL</b> (14 raqam), <b>B — Summa</b> (so&apos;m). Shablonda hudud xodimlari ro&apos;yxati ham bor (2-varaq).
                </>
              }
            />
            {error && <Notice tone="bad">{error}</Notice>}
          </>
        )}

        {a && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat tone="ok" label={`${a.periodLabel} — jami`} value={som(a.totalTiyin)} hint={`so'm · ${a.matchedRows} xodim`} />
              <Stat label="Hududlar" value={a.regions.length} hint="ish haqi xarajati yoziladi" />
              <Stat label="Reestrda topilmadi" value={a.missingRows} tone={a.missingRows ? 'warn' : 'plain'} hint="PINFL xodimlar ro'yxatida yo'q" />
              <Stat label="Kirmaydi" value={a.central.length + a.general.length} tone={a.central.length + a.general.length ? 'warn' : 'plain'} hint="markaz yoki umumiy vedomostda" />
            </div>

            {a.previous.length > 0 && (
              <Notice tone="info">
                {a.periodLabel} uchun hudud vedomosti avval saqlangan (<b className="money">{som(a.previous[0]!.totalTiyin)}</b> so&apos;m, {a.previous[0]!.employees} xodim). Saqlasangiz —{' '}
                <b>almashtiriladi</b>.
              </Notice>
            )}
            {a.central.length > 0 && (
              <Notice tone="warn">
                <b>{a.central.length} ta markaz xodimi</b> — hudud vedomostiga kirmaydi (umumiy vedomostda yuklanadi): {a.central.slice(0, 6).map((c) => c.fullName || c.pinfl).join(', ')}
                {a.central.length > 6 ? '…' : ''}
              </Notice>
            )}
            {a.general.length > 0 && (
              <Notice tone="warn">
                <b>{a.general.length} ta xodim</b> shu oy umumiy vedomostda allaqachon bor — ikki marta sanalmasligi uchun kirmaydi: {a.general.slice(0, 6).map((c) => c.fullName || c.pinfl).join(', ')}
              </Notice>
            )}
            {(a.missing.length > 0 || a.invalidRows.length > 0) && (
              <Notice tone="warn">
                {a.missing.length > 0 && (
                  <p>
                    Reestrda yo&apos;q PINFL ({a.missing.length}): {a.missing.slice(0, 8).map((m) => `${m.pinfl} (${m.rowIndex}-qator)`).join(', ')}
                    {a.missing.length > 8 ? '…' : ''} — avval Xodimlar ro&apos;yxatiga qo&apos;shilishi kerak.
                  </p>
                )}
                {a.invalidRows.length > 0 && <p>Noto&apos;g&apos;ri qatorlar: {a.invalidRows.slice(0, 8).map((r) => `${r.rowIndex} (${r.reason})`).join(', ')}</p>}
              </Notice>
            )}

            <div className="overflow-hidden rounded-(--radius-card) bg-white shadow-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
                    <th className="px-4 py-2.5">Hudud</th>
                    <th className="px-3 py-2.5 text-right">Xodimlar</th>
                    <th className="px-3 py-2.5 text-right">Summa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-(--color-line)">
                  {a.regions.map((r) => (
                    <tr key={r.regionCode}>
                      <td className="px-4 py-2 font-medium text-heading">{r.name}</td>
                      <td className="px-3 py-2 text-right">
                        {r.count}
                        {r.zero > 0 && <span className="ml-1 text-xs text-amber-600">({r.zero} tasi 0)</span>}
                      </td>
                      <td className="money px-3 py-2 text-right font-bold">{som(r.totalTiyin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-3 border-t border-(--color-line) bg-white/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
              <span className="text-sm text-(--color-text-muted)">
                {a.fileName} · {a.matchedRows} xodim
              </span>
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" onClick={() => setA(null)}>
                  Bekor qilish
                </Button>
                <Button size="lg" onClick={() => void save()} loading={saving} disabled={a.rows.length === 0} className="min-w-[200px]">
                  Saqlash — {a.periodLabel}
                </Button>
              </div>
            </div>
          </>
        )}

        <div className="overflow-hidden rounded-(--radius-card) bg-white shadow-card">
          <div className="border-b border-(--color-line) px-4 py-3">
            <p className="font-semibold text-heading">Yuklangan vedomostlar</p>
          </div>
          {list.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-(--color-text-muted)">Hali hudud vedomosti yuklanmagan</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-(--color-line)">
                {list.map((b) => (
                  <tr key={b.id} className={b.status === 'CANCELLED' ? 'opacity-50' : ''}>
                    <td className="px-4 py-2.5 font-semibold text-heading">{monthLabel(b.period)}</td>
                    <td className="px-3 py-2.5 text-xs text-(--color-text-muted)">
                      {b.fileName}
                      <br />
                      {b.by ?? '—'} · {b.committedAt ? formatDateTime(b.committedAt) : ''}
                    </td>
                    <td className="px-3 py-2.5 text-right">{b.employees} xodim</td>
                    <td className="money px-3 py-2.5 text-right font-bold">{som(b.totalTiyin)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {b.status === 'COMMITTED' ? (
                        <button type="button" onClick={() => setCancel(b)} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-(--color-expense) hover:bg-red-50">
                          Bekor qilish
                        </button>
                      ) : (
                        <Badge tone="neutral">Bekor qilingan</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={cancel !== null}
        title="Vedomostni bekor qilish"
        message={cancel ? `${monthLabel(cancel.period)} hudud vedomosti va undan yozilgan ish haqi xarajatlari o'chiriladi.` : ''}
        confirmLabel="Bekor qilish"
        cancelLabel="Qolsin"
        danger
        onConfirm={() => void doCancel()}
        onCancel={() => setCancel(null)}
      />
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} duration={toast.tone === 'error' ? 6000 : 4000} />}
    </>
  );
}