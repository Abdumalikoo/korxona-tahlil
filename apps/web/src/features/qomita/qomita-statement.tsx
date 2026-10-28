'use client';

import { ReportCard, RTable, TableNote, Td, Th, sum } from '@/components/report/report';
import { FileCheck } from '@/components/shared/file-check';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useRef, useState } from 'react';
import { qomitaStatementApi, type QomitaStatementAnalysis, type QomitaStatementRow, type QomitaUploadView, type StatementTarget } from './api';

// ═══════════════════════════════════════════════════════════
// Daromadlar › Qo'mita mablag'lari › Bank ko'chirmasidan yuklash.
//  1) Fayl tanlanadi — Qo'mitadan kelgan kirimlar chiqadi, har biriga taklif: qaysi bo'lim, qaysi oy uchun va nega
//     (faylga yozilgan izoh, avvalgi tanlov yoki to'lov maqsadidagi so'zlar); allaqachon yozilgani belgilanadi;
//  2) foydalanuvchi tekshiradi / o'zgartiradi — «Daromadga yozish»;
//  3) pastda — yuklashlar ro'yxati, har birini yozuvlari bilan o'chirish mumkin.
// Depozit va qarz qaytishi daromad emas — yozilmaydi (tanlov eslab qolinadi).
// ═══════════════════════════════════════════════════════════

type ToastState = { message: string; tone: 'success' | 'error' } | null;

const NOT_INCOME: { value: StatementTarget; label: string }[] = [
  { value: 'DEPOSIT', label: 'Depozit — daromad emas' },
  { value: 'LOAN', label: 'Qarz qaytishi — daromad emas' },
  { value: 'SKIP', label: "O'tkazib yuborish" },
];
const CONF: Record<QomitaStatementRow['confidence'], { label: string; cls: string }> = {
  HIGH: { label: 'aniq', cls: 'bg-(--color-income-soft) text-(--color-income)' },
  MEDIUM: { label: 'taxminiy', cls: 'bg-amber-50 text-amber-800' },
  LOW: { label: 'tanlang', cls: 'bg-(--color-expense-soft) text-(--color-expense)' },
};
const day = (d: string) => d.split('-').reverse().join('.');

export function QomitaStatementCard({ isAdmin, onSaved, setToast }: { isAdmin: boolean; onSaved: () => void; setToast: (t: ToastState) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [all, setAll] = useState(false);
  const [res, setRes] = useState<QomitaStatementAnalysis | null>(null);
  const [choice, setChoice] = useState<Record<number, { target: StatementTarget; period: string }>>({});
  const [busy, setBusy] = useState<'read' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploads = useAsync(() => qomitaStatementApi.uploads().then((r) => r.data), []);
  const [removing, setRemoving] = useState<QomitaUploadView | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  async function read(f: File, withAll: boolean) {
    setBusy('read');
    setError(null);
    try {
      const a = await qomitaStatementApi.analyze(f, withAll);
      setRes(a);
      setChoice(Object.fromEntries(a.rows.map((r) => [r.rowIndex, { target: r.target, period: r.period }])));
    } catch (err) {
      setRes(null);
      setError(errorMessage(err, "Faylni o'qib bo'lmadi"));
    } finally {
      setBusy(null);
    }
  }

  function pick(f: File | undefined) {
    if (!f) return;
    setFile(f);
    void read(f, all);
    if (input.current) input.current.value = '';
  }

  const rows = res?.rows ?? [];
  const depName = new Map((res?.departments ?? []).map((d) => [`dep:${d.id}`, d.name]));
  const chosen = rows.filter((r) => choice[r.rowIndex]?.target.startsWith('dep:') && !r.duplicate);
  const chosenSum = chosen.reduce((s, r) => s + Number(r.amountTiyin), 0);
  const notIncome = rows.filter((r) => ['DEPOSIT', 'LOAN'].includes(choice[r.rowIndex]?.target ?? ''));
  const badPeriod = chosen.some((r) => !/^\d{4}-\d{2}$/.test(choice[r.rowIndex]?.period ?? ''));

  async function save() {
    if (!file || !res) return;
    setBusy('save');
    try {
      const r = await qomitaStatementApi.commit(
        file,
        rows.map((x) => ({ rowIndex: x.rowIndex, target: x.duplicate ? 'SKIP' : (choice[x.rowIndex]?.target ?? 'SKIP'), period: choice[x.rowIndex]?.period ?? x.period })),
      );
      setToast({ message: `${r.written} ta ajratma yozildi: ${sum(Number(r.totalTiyin))} so'm${r.notIncome ? ` · daromad emas: ${r.notIncome}` : ''}${r.skipped ? ` · o'tkazildi: ${r.skipped}` : ''}`, tone: 'success' });
      setRes(null);
      setFile(null);
      uploads.reload();
      onSaved();
    } catch (err) {
      setToast({ message: errorMessage(err, "Yozib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function removeUpload() {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      const r = (await qomitaStatementApi.removeUpload(removing.id)).data;
      setToast({ message: `Yuklash o'chirildi: ${r.removed} ta yozuv`, tone: 'success' });
      setRemoving(null);
      uploads.reload();
      onSaved();
    } catch (err) {
      setToast({ message: errorMessage(err, "O'chirib bo'lmadi"), tone: 'error' });
    } finally {
      setRemoveBusy(false);
    }
  }

  const set = (rowIndex: number, patch: Partial<{ target: StatementTarget; period: string }>) => setChoice((c) => ({ ...c, [rowIndex]: { ...c[rowIndex]!, ...patch } }));
  const live = (uploads.data ?? []).filter((u) => !u.removedAt);

  return (
    <ReportCard
      title="Bank ko'chirmasidan yuklash"
      badge={res ? `${res.fileName} · Qo'mitadan ${res.qomitaCount} ta (jami kirim ${res.incomingTotal})` : undefined}
      actions={
        isAdmin ? (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-(--color-text-muted)" title="Qo'mitadan bo'lmagan kirimlar ham ko'rsatilsin">
              <input
                type="checkbox"
                checked={all}
                onChange={(e) => {
                  setAll(e.target.checked);
                  if (file) void read(file, e.target.checked);
                }}
                className="size-3.5"
              />
              hamma kirimlar
            </label>
            <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
            <Button size="sm" onClick={() => input.current?.click()} loading={busy === 'read'}>
              {res ? 'Boshqa fayl' : 'Fayl tanlash (.xlsx)'}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-3 px-4 pb-4">
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-(--color-expense)">{error}</p>}
        {!res && !error && (
          <p className="text-sm text-(--color-text-muted)">
            Bank ko&apos;chirmasini (Выписка лицевых счетов) tanlang: Qo&apos;mitadan kelgan kirimlar chiqadi. Izoh ustuni bo&apos;lsa («Marksheyder oylik», «3802 Call Markaz»,
            «Depozit») — shunga qarab bo&apos;lim taklif qilinadi; bo&apos;lmasa — to&apos;lov maqsadi va avvalgi tanlovlaringizdan. Hech narsa o&apos;zi yozilmaydi — siz tasdiqlaysiz.
          </p>
        )}
        {res && (
          <>
            <FileCheck checks={res.checks} />
            {!res.commentColumn && <p className="text-xs text-(--color-text-muted)">Faylda izoh ustuni topilmadi — taklif to&apos;lov maqsadidan.</p>}
            {!rows.length ? (
              <p className="text-sm text-(--color-text-muted)">Qo&apos;mitadan kelgan kirim topilmadi. «hamma kirimlar»ni belgilab ko&apos;ring.</p>
            ) : (
              <RTable minWidth={1180}>
                <thead>
                  <tr>
                    <Th>Sana</Th>
                    <Th className="text-left">To&apos;lovchi · izoh</Th>
                    <Th className="min-w-72 text-left">To&apos;lov maqsadi</Th>
                    <Th>Summa</Th>
                    <Th className="text-left">Qayerga</Th>
                    <Th className="text-left">Qaysi oy uchun</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const c = choice[r.rowIndex] ?? { target: r.target, period: r.period };
                    const isDep = c.target.startsWith('dep:');
                    return (
                      <tr key={r.rowIndex} className={cn(r.duplicate ? 'opacity-60' : isDep ? 'bg-brand-50/40' : '', 'align-top')}>
                        <Td className="whitespace-nowrap text-xs">
                          {day(r.docDate)}
                          {r.docNo && <span className="block text-[10.5px] text-(--color-text-faint)">№ {r.docNo}</span>}
                        </Td>
                        <Td className="max-w-56 text-left text-xs">
                          <span className="block truncate font-medium text-heading" title={r.payer}>
                            {r.payer || '—'}
                          </span>
                          {r.comment && <span className="mt-0.5 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">«{r.comment}»</span>}
                        </Td>
                        <Td className="text-left text-xs text-(--color-text-muted)">
                          <span className="line-clamp-2" title={r.purpose}>
                            {r.purpose}
                          </span>
                        </Td>
                        <Td className="whitespace-nowrap font-semibold text-(--color-income)">{sum(Number(r.amountTiyin))}</Td>
                        <Td className="text-left text-xs">
                          {r.duplicate ? (
                            <span className="rounded bg-(--color-surface-muted) px-1.5 py-0.5 text-[11px] font-medium text-(--color-text-muted)" title="Shu sana va summada Qo'mita daromadi bor">
                              allaqachon yozilgan
                            </span>
                          ) : (
                            <>
                              <select
                                value={c.target}
                                disabled={!isAdmin}
                                onChange={(e) => set(r.rowIndex, { target: e.target.value })}
                                className={cn('h-8 w-56 rounded-md border bg-white px-2 text-xs', c.target === 'SKIP' ? 'border-(--color-line-strong) text-(--color-text-muted)' : 'border-brand-300 font-medium text-heading')}
                              >
                                <optgroup label="Bo'lim ajratmasi (daromad)">
                                  {res.departments.map((d) => (
                                    <option key={d.id} value={`dep:${d.id}`}>
                                      {d.name}
                                    </option>
                                  ))}
                                </optgroup>
                                <optgroup label="Boshqa">
                                  {NOT_INCOME.map((o) => (
                                    <option key={o.value} value={o.value}>
                                      {o.label}
                                    </option>
                                  ))}
                                </optgroup>
                              </select>
                              <span className="mt-1 flex flex-wrap items-center gap-1 text-[10.5px] text-(--color-text-faint)">
                                <span className={cn('rounded px-1 font-semibold', CONF[r.confidence].cls)}>{CONF[r.confidence].label}</span>
                                {r.target === c.target ? r.reasons.join('; ') : 'siz tanladingiz'}
                              </span>
                            </>
                          )}
                        </Td>
                        <Td className="text-left text-xs">
                          {isDep && !r.duplicate ? (
                            <>
                              <input type="month" value={c.period} disabled={!isAdmin} onChange={(e) => set(r.rowIndex, { period: e.target.value })} className="h-8 rounded-md border border-(--color-line-strong) bg-white px-2 text-xs" />
                              <span className="mt-1 block text-[10.5px] text-(--color-text-faint)">{c.period === r.period ? r.periodReason : 'siz tanladingiz'}</span>
                            </>
                          ) : (
                            <span className="text-(--color-text-faint)">—</span>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </RTable>
            )}
            {isAdmin && rows.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl bg-[#f7f9fc] px-3 py-2.5">
                <span className="text-sm text-heading">
                  Daromadga: <b>{chosen.length}</b> ta · <b>{sum(chosenSum)}</b> so&apos;m
                  {chosen.length > 0 && <span className="text-(--color-text-muted)"> ({[...new Set(chosen.map((r) => depName.get(choice[r.rowIndex]!.target) ?? ''))].join(', ')})</span>}
                  {notIncome.length > 0 && <span className="text-(--color-text-muted)"> · daromad emas: {notIncome.length} ta</span>}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => {
                    setRes(null);
                    setFile(null);
                  }}
                  disabled={busy === 'save'}
                >
                  Bekor
                </Button>
                <Button size="sm" disabled={(!chosen.length && !notIncome.length) || badPeriod} loading={busy === 'save'} onClick={() => void save()}>
                  Daromadga yozish
                </Button>
              </div>
            )}
          </>
        )}

        {/* Yuklashlar */}
        {live.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-(--color-text-muted)">Yuklangan ko&apos;chirmalar</p>
            <div className="divide-y divide-(--color-line) rounded-xl border border-(--color-line)">
              {live.map((u) => (
                <div key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
                  <span className="min-w-0 flex-1 truncate font-medium text-heading" title={u.fileName}>
                    {u.fileName}
                  </span>
                  <span className="text-(--color-text-muted)">
                    {formatDateTime(u.at)} · {u.by}
                  </span>
                  <span className="text-(--color-text-muted)">
                    {u.liveCount} ta ajratma{u.liveCount !== u.written ? ` (yozilgan ${u.written})` : ''}
                    {u.notIncome ? ` · daromad emas ${u.notIncome}` : ''}
                  </span>
                  <span className="font-semibold text-(--color-income)">{sum(Number(u.liveTiyin))}</span>
                  {isAdmin && u.liveCount > 0 && (
                    <button type="button" onClick={() => setRemoving(u)} className="rounded px-1.5 py-0.5 text-(--color-text-faint) hover:bg-red-50 hover:text-(--color-expense)" title="Shu fayldan yozilgan hamma ajratmani o'chirish">
                      O&apos;chirish
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        <TableNote>
          Bir xil sana va summadagi kirim ikkinchi marta yozilmaydi. Bitta yozuvni o&apos;chirish — yuqoridagi jadvalda bo&apos;lim › «Ajratmalar» ichida (✕).
        </TableNote>
      </div>
      <ConfirmDialog
        open={Boolean(removing)}
        danger
        title="Yuklashni o'chirish"
        message={removing ? `«${removing.fileName}» faylidan yozilgan ${removing.liveCount} ta ajratma (${sum(Number(removing.liveTiyin))} so'm) o'chiriladi.` : ''}
        confirmLabel="O'chirish"
        loading={removeBusy}
        onConfirm={() => void removeUpload()}
        onCancel={() => setRemoving(null)}
      />
    </ReportCard>
  );
}
