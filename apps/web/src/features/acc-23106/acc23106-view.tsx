'use client';

import { SourceActions } from '@/components/shared/source-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconAlert, IconSearch, IconSpinner, IconUpload } from '@/components/ui/icons';
import { Money } from '@/components/ui/money';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { MonthRangeCard, useMonthRange } from '@/features/units/month-range';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatDateTime, formatPeriod, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useRef, useState } from 'react';
import { acc23106Api, analyzeAcc23106, downloadAcc23106Template, type ControlState, type PayoutAnalysis, type PayoutBatch, type PayoutKind, type PayoutRow, type PayoutSummary } from './api';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › 23106 — xodimlarga to'lovlar hisob raqami ko'chirmasi.
// Yuklash → har to'lov: xodim (PINFL yoki izohdagi F.I.Sh.), sana, nima uchun (izohdan), buyruq, hisoblangan oy →
// nazorat (ish haqi tarkibi va soliq hisoboti bilan) → saqlash. Xarajat yozuvi yaratilmaydi (ish haqida hisoblangan).
// ═══════════════════════════════════════════════════════════

type ToastState = { message: string; tone: 'success' | 'error' } | null;

const CONTROL: Record<ControlState, { label: string; tone: 'income' | 'expense' | 'warn' | 'neutral'; hint: string }> = {
  OK: { label: 'Tarkibga mos', tone: 'income', hint: "Ish haqi tarkibida shu oy shu turdagi summa bor, to'langani undan oshmagan" },
  OVER: { label: "Tarkibdan ko'p", tone: 'expense', hint: "To'langani tarkibda hisoblanganidan ko'p — tekshiring" },
  NOT_IN_TARKIB: { label: "Tarkibda yo'q", tone: 'warn', hint: "Shu oy ish haqi tarkibida bu xodimga bunday summa hisoblanmagan" },
  NO_TARKIB: { label: 'Tarkib yuklanmagan', tone: 'neutral', hint: 'Hisoblangan oy uchun ish haqi tarkibi hali yuklanmagan' },
  NA: { label: '—', tone: 'neutral', hint: "Bu tur (xizmat safari, ish haqi, boshqa) tarkib bilan solishtirilmaydi yoki xodim aniqlanmagan" },
};

const MATCH: Record<'PINFL' | 'NAME' | 'NONE', { label: string; tone: 'income' | 'warn' | 'expense' }> = {
  PINFL: { label: 'PINFL', tone: 'income' },
  NAME: { label: "Ism bo'yicha", tone: 'warn' },
  NONE: { label: 'Topilmadi', tone: 'expense' },
};

export function Acc23106View() {
  const { isAdmin } = useAuth();
  const range = useMonthRange('year');
  const [analysis, setAnalysis] = useState<PayoutAnalysis | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<PayoutBatch | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const view = useAsync(() => (range.error ? Promise.resolve(null) : acc23106Api.view(range.from, range.to).then((r) => r.data)), [range.from, range.to, range.error]);
  const batches = useAsync(() => acc23106Api.batches().then((r) => r.data), []);

  function reset() {
    setAnalysis(null);
    setPicked(new Set());
    if (inputRef.current) inputRef.current.value = '';
  }

  async function handleFile(file: File) {
    if (!/\.(xlsx|xltx)$/i.test(file.name)) {
      setToast({ message: 'Faqat Excel (.xlsx yoki .xltx) fayl yuklang', tone: 'error' });
      return;
    }
    setUploading(true);
    setAnalysis(null);
    try {
      const a = await analyzeAcc23106(file);
      setAnalysis(a);
      setPicked(new Set(a.months.map((m) => m.period)));
    } catch (err) {
      setToast({ message: errorMessage(err, "Faylni o'qib bo'lmadi"), tone: 'error' });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleSave() {
    if (!analysis || !picked.size) return;
    setSaving(true);
    try {
      const months = [...picked];
      const rows = analysis.rows.filter((r) => picked.has(r.docDate.slice(0, 7)));
      const r = (await acc23106Api.commit({ fileName: analysis.fileName, months, rows })).data;
      setToast({ message: `Saqlandi: ${r.saved} ta to'lov · ${formatTiyin(r.totalTiyin)} so'm${r.replacedMonths ? ` · ${r.replacedMonths} oyning oldingi ko'chirmasi almashtirildi` : ''}`, tone: 'success' });
      range.include(months);
      reset();
      view.reload();
      batches.reload();
    } catch (err) {
      setToast({ message: errorMessage(err, 'Saqlashda xatolik'), tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await acc23106Api.cancel(cancelTarget.id);
      setToast({ message: "Ko'chirma bekor qilindi", tone: 'success' });
      view.reload();
      batches.reload();
    } catch (err) {
      setToast({ message: errorMessage(err, 'Bekor qilishda xatolik'), tone: 'error' });
    } finally {
      setCancelling(false);
      setCancelTarget(null);
    }
  }

  return (
    <>
      <SourceActions
        upload={isAdmin ? { label: "Ko'chirmani yuklash", onClick: () => inputRef.current?.click(), loading: uploading, disabled: Boolean(analysis), hint: analysis ? 'Avval joriy tahlilni saqlang yoki bekor qiling' : "23106 hisob raqami ko'chirmasi (bank «выписка»)" } : undefined}
        template={{ label: 'Shablon', onClick: () => void (async () => {
          setDownloading(true);
          try {
            await downloadAcc23106Template();
          } catch (err) {
            setToast({ message: errorMessage(err, "Shablonni yuklab bo'lmadi"), tone: 'error' });
          } finally {
            setDownloading(false);
          }
        })(), loading: downloading, hint: "Bank ko'chirmasi ustunlari: №пп … Назначение платежа" }}
        note={
          <>
            Har to&apos;lov uchun dastur <b className="text-heading">xodimni</b> (ИНН ustunidagi PINFL, bo&apos;lmasa izohdagi F.I.Sh.), <b className="text-heading">sanani</b> va{' '}
            <b className="text-heading">nima uchun to&apos;langanini</b> (izohdan: bayram puli, mukofot, xizmat safari …, buyruq raqami) aniqlaydi va ish haqi tarkibi hamda soliq hisoboti bilan solishtiradi.
            Xarajat yozuvi yaratilmaydi — bu to&apos;lovlar ish haqida hisoblangan.
          </>
        }
      />
      <input ref={inputRef} type="file" accept=".xlsx,.xltx" className="hidden" onChange={(e) => e.target.files?.[0] && void handleFile(e.target.files[0])} />

      {isAdmin && !analysis && (
        <Card>
          <CardBody>
            <div
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files[0];
                if (f) void handleFile(f);
              }}
              onClick={() => inputRef.current?.click()}
              className={cn('flex cursor-pointer flex-col items-center justify-center gap-2 rounded-(--radius-card) border-2 border-dashed px-6 py-10 transition-colors', dragging ? 'border-brand-600 bg-brand-50' : 'border-(--color-line-strong) hover:border-brand-400 hover:bg-(--color-surface-muted)')}
            >
              {uploading ? (
                <>
                  <IconSpinner className="size-8 animate-spin text-brand-700" />
                  <p className="text-sm text-(--color-text-muted)">O&apos;qilmoqda…</p>
                </>
              ) : (
                <>
                  <IconUpload className="size-8 text-(--color-text-faint)" strokeWidth={1.5} />
                  <p className="text-sm font-medium">23106 ko&apos;chirmasini shu yerga tashlang</p>
                  <p className="text-xs text-(--color-text-muted)">yoki bosib tanlang · bankdan olingan Excel (.xlsx, .xltx)</p>
                </>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {analysis && (
        <div className="space-y-4">
          <SummaryBoxes s={analysis.summary} />
          <Card>
            <CardHeader title={`${analysis.fileName} · ${analysis.sheetName}`} description="Saqlanadigan oylar (to'lov sanasi bo'yicha). Shu oy avval saqlangan bo'lsa — almashtiriladi" />
            <CardBody className="flex flex-wrap gap-2">
              {analysis.months.map((m) => (
                <label key={m.period} className={cn('flex cursor-pointer items-center gap-2 rounded-(--radius-control) border px-3 py-2 text-sm', picked.has(m.period) ? 'border-brand-600 bg-brand-50/50' : 'border-(--color-line)')}>
                  <input
                    type="checkbox"
                    className="size-4 accent-brand-600"
                    checked={picked.has(m.period)}
                    onChange={() =>
                      setPicked((s) => {
                        const n = new Set(s);
                        if (n.has(m.period)) n.delete(m.period);
                        else n.add(m.period);
                        return n;
                      })
                    }
                  />
                  <span className="font-medium text-heading">{m.label}</span>
                  <span className="text-xs text-(--color-text-muted)">
                    {m.count} ta · <span className="money">{formatTiyin(m.totalTiyin)}</span>
                  </span>
                  {m.saved && <Badge tone="warn">avval saqlangan ({m.saved.count}) — almashtiriladi</Badge>}
                </label>
              ))}
              {analysis.inflow.count > 0 && (
                <span className="self-center text-xs text-(--color-text-muted)">
                  {analysis.inflow.count} ta kirim (kredit) qatori — to&apos;lov emas, olinmadi ({formatTiyin(analysis.inflow.totalTiyin)})
                </span>
              )}
              {analysis.invalid.length > 0 && (
                <span className="flex items-center gap-1 self-center text-xs text-(--color-expense)">
                  <IconAlert className="size-3.5" />
                  Xato qatorlar: {analysis.invalid.slice(0, 5).map((x) => `${x.rowIndex}-qator — ${x.reason}`).join('; ')}
                </span>
              )}
            </CardBody>
          </Card>
          <PayoutTable rows={analysis.rows} title="Ko'chirmadagi to'lovlar" />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={reset} disabled={saving}>
              Boshqa fayl
            </Button>
            <Button onClick={() => void handleSave()} loading={saving} disabled={!picked.size}>
              Saqlash
            </Button>
          </div>
        </div>
      )}

      {/* Saqlangan */}
      <MonthRangeCard range={range} />
      {view.loading && !view.data ? (
        <LoadingState />
      ) : view.error ? (
        <ErrorState message={view.error} onRetry={view.reload} />
      ) : view.data && view.data.rows.length ? (
        <>
          <SummaryBoxes s={view.data.summary} />
          <PayoutTable rows={view.data.rows} title={`Saqlangan to'lovlar · ${range.text}`} />
        </>
      ) : (
        <EmptyState title={`${range.text || 'Tanlangan davr'} uchun ko'chirma saqlanmagan`} hint="upload" />
      )}

      {/* Tarix */}
      {(batches.data?.length ?? 0) > 0 && (
        <Card className="overflow-hidden">
          <CardHeader title="Yuklashlar tarixi" />
          <ul className="divide-y divide-(--color-line) text-sm">
            {batches.data!.slice(0, 30).map((b) => (
              <li key={b.id} className={cn('flex flex-wrap items-center gap-3 px-5 py-2.5', b.status === 'CANCELLED' && 'opacity-50')}>
                <span className="min-w-0 flex-1 truncate font-medium">{b.fileName}</span>
                <span className="text-xs text-(--color-text-muted)">{b.months.map(formatPeriod).join(', ')}</span>
                <span className="text-xs text-(--color-text-muted)">{b.rows} ta</span>
                <Money tiyin={b.totalTiyin} tone="expense" />
                <span className="text-xs text-(--color-text-muted)">
                  {formatDateTime(b.createdAt)} · {b.uploadedBy}
                </span>
                {b.status === 'CANCELLED' ? (
                  <Badge tone="neutral">bekor qilingan</Badge>
                ) : isAdmin ? (
                  <Button size="sm" variant="ghost" className="text-(--color-text-muted) hover:text-(--color-expense)" onClick={() => setCancelTarget(b)}>
                    Bekor qilish
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ConfirmDialog
        open={cancelTarget !== null}
        title="Ko'chirmani bekor qilish"
        message={`${cancelTarget?.fileName ?? ''} bekor qilinadi — shu yuklashdan saqlangan oylar o'chiriladi.`}
        confirmLabel="Bekor qilish"
        danger
        loading={cancelling}
        onConfirm={() => void handleCancel()}
        onCancel={() => setCancelTarget(null)}
      />
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </>
  );
}

function SummaryBoxes({ s }: { s: PayoutSummary }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Box label="To'lovlar" value={String(s.count)} sub={`${formatTiyin(s.totalTiyin)} so'm · ${s.people} xodim`} />
      <Box label="Xodim aniqlandi" value={`${s.matched.pinfl + s.matched.name}`} sub={`PINFL ${s.matched.pinfl} · ism bo'yicha ${s.matched.name}${s.matched.none ? ` · topilmadi ${s.matched.none}` : ''}`} tone={s.matched.none ? 'warn' : 'income'} />
      <Box
        label="Nazorat (tarkib bilan)"
        value={`${s.control.ok} mos`}
        sub={[s.control.over ? `${s.control.over} ko'p` : '', s.control.notInTarkib ? `${s.control.notInTarkib} tarkibda yo'q` : '', s.control.noTarkib ? `${s.control.noTarkib} tarkib yuklanmagan` : '', s.control.na ? `${s.control.na} solishtirilmaydi` : ''].filter(Boolean).join(' · ') || '—'}
        tone={s.control.over || s.control.notInTarkib ? 'expense' : 'income'}
      />
      <div className="rounded-(--radius-card) border border-(--color-line) bg-white p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">Nima uchun</p>
        <ul className="mt-1.5 space-y-0.5 text-xs">
          {s.byKind.slice(0, 5).map((k) => (
            <li key={k.kind} className="flex justify-between gap-2">
              <span>
                {k.label} <span className="text-(--color-text-faint)">({k.count})</span>
              </span>
              <span className="money">{formatTiyin(k.totalTiyin)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Box({ label, value, sub, tone = 'neutral' }: { label: string; value: string; sub: string; tone?: 'neutral' | 'income' | 'expense' | 'warn' }) {
  const c = { neutral: 'text-(--color-text)', income: 'text-(--color-income)', expense: 'text-(--color-expense)', warn: 'text-(--color-warn)' }[tone];
  return (
    <div className="rounded-(--radius-card) border border-(--color-line) bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">{label}</p>
      <p className={cn('money mt-1.5 text-xl font-semibold', c)}>{value}</p>
      <p className="mt-0.5 text-xs text-(--color-text-muted)">{sub}</p>
    </div>
  );
}

const PAGE = 100;

function PayoutTable({ rows, title }: { rows: PayoutRow[]; title: string }) {
  const [kind, setKind] = useState<PayoutKind | 'ALL'>('ALL');
  const [control, setControl] = useState<ControlState | 'ALL' | 'PROBLEM'>('ALL');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const kinds = useMemo(() => [...new Map(rows.map((r) => [r.kind, r.kindLabel])).entries()], [rows]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (kind !== 'ALL' && r.kind !== kind) return false;
      if (control === 'PROBLEM' && !(r.control === 'OVER' || r.control === 'NOT_IN_TARKIB' || !r.matchBy)) return false;
      if (control !== 'ALL' && control !== 'PROBLEM' && r.control !== control) return false;
      if (!t) return true;
      return (r.fullName ?? r.commentName ?? r.accountName).toLowerCase().includes(t) || (r.pinfl ?? '').includes(t) || r.purpose.toLowerCase().includes(t) || (r.orderNo ?? '').toLowerCase().includes(t);
    });
  }, [rows, kind, control, q]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const slice = shown.slice((page - 1) * PAGE, page * PAGE);
  const total = shown.reduce((s, r) => s + BigInt(r.debitTiyin), 0n);
  const problems = rows.filter((r) => r.control === 'OVER' || r.control === 'NOT_IN_TARKIB' || !r.matchBy).length;

  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} description={`${shown.length} ta · ${formatTiyin(total.toString())} so'm`} />
      <div className="flex flex-wrap items-center gap-2 border-b border-(--color-line) px-5 py-2.5">
        <Chip active={kind === 'ALL'} onClick={() => setKind('ALL')}>
          Hammasi
        </Chip>
        {kinds.map(([k, label]) => (
          <Chip key={k} active={kind === k} onClick={() => setKind(k)}>
            {label}
          </Chip>
        ))}
        <span className="mx-1 h-5 w-px bg-(--color-line)" />
        <Chip active={control === 'PROBLEM'} onClick={() => setControl(control === 'PROBLEM' ? 'ALL' : 'PROBLEM')}>
          Muammoli <span className="money opacity-70">{problems}</span>
        </Chip>
        <label className="relative ml-auto">
          <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-(--color-text-faint)" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="F.I.Sh., PINFL, buyruq, izoh"
            className="h-8 w-60 rounded-(--radius-control) border border-(--color-line-strong) bg-white pr-3 pl-8 text-sm focus:border-brand-600 focus:outline-none"
          />
        </label>
      </div>
      <div className="max-h-[620px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-[1] bg-(--color-surface-muted) text-[11px] uppercase tracking-wide text-(--color-text-muted)">
            <tr>
              <th className="w-28 px-3 py-2 text-left font-semibold">Sana</th>
              <th className="px-2 py-2 text-left font-semibold">Xodim</th>
              <th className="w-64 px-2 py-2 text-left font-semibold">Nima uchun</th>
              <th className="w-36 px-2 py-2 text-right font-semibold">Summa</th>
              <th className="w-52 px-3 py-2 text-left font-semibold">Nazorat</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((r, i) => {
              const id = `${r.docDate}|${r.docNo}|${i}`;
              const c = CONTROL[r.control];
              const m = MATCH[r.matchBy ?? 'NONE'];
              return (
                <tr key={id} className={cn('border-t border-(--color-line) align-top', r.control === 'OVER' && 'bg-(--color-expense-soft)/30')}>
                  <td className="px-3 py-2">
                    <span className="money block">{formatDate(r.docDate)}</span>
                    <span className="money text-[11px] text-(--color-text-muted)">№ {r.docNo}</span>
                  </td>
                  <td className="px-2 py-2">
                    <span className="block font-medium text-heading">{r.fullName ?? r.commentName ?? r.accountName}</span>
                    <span className="flex flex-wrap items-center gap-1 text-[11px] text-(--color-text-muted)">
                      <Badge tone={m.tone} className="px-1.5 py-0 text-[10px]">
                        {m.label}
                      </Badge>
                      {r.pinfl && <span className="money">{r.pinfl}</span>}
                      {r.inSoliq && <span className="text-(--color-income)">· soliq hisobotida bor</span>}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <Badge tone="brand" className="px-1.5 py-0 text-[11px]">
                      {r.kindLabel}
                    </Badge>
                    <span className="mt-0.5 block text-[11px] text-(--color-text-muted)">
                      {r.orderNo || r.orderDate ? `Buyruq ${r.orderDate ? formatDate(r.orderDate) : ''}${r.orderNo ? ` № ${r.orderNo}` : ''} · ` : ''}
                      hisoblangan oy: {formatPeriod(r.accrual)}
                    </span>
                    <button type="button" className="text-[11px] font-medium text-brand-700 hover:underline" onClick={() => setOpen(open === id ? null : id)}>
                      {open === id ? 'Izohni yashirish' : 'Izoh'}
                    </button>
                    {open === id && <p className="mt-1 max-w-md text-[11px] leading-snug text-(--color-text)">{r.purpose}</p>}
                  </td>
                  <td className="money px-2 py-2 text-right">
                    <Money tiyin={r.debitTiyin} tone="expense" />
                  </td>
                  <td className="px-3 py-2">
                    <span title={c.hint}>
                      <Badge tone={c.tone}>{c.label}</Badge>
                    </span>
                    {r.tarkibTiyin !== null && (
                      <span className="mt-0.5 block text-[11px] text-(--color-text-muted)">
                        tarkibda <span className="money">{formatTiyin(r.tarkibTiyin)}</span>
                        {r.paidGroupTiyin !== r.debitTiyin ? (
                          <>
                            {' '}
                            · to&apos;langan jami <span className="money">{formatTiyin(r.paidGroupTiyin)}</span>
                          </>
                        ) : null}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!slice.length && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-sm text-(--color-text-muted)">
                  Bu tanlovda to&apos;lov yo&apos;q
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-between border-t border-(--color-line) px-4 py-2 text-xs text-(--color-text-muted)">
          <span>
            {shown.length} tadan {(page - 1) * PAGE + 1}–{Math.min(page * PAGE, shown.length)}
          </span>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Oldingi
            </Button>
            <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Keyingi
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn('rounded-full border px-3 py-1 text-xs font-medium', active ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-(--color-line) bg-white text-(--color-text-muted) hover:text-heading')}>
      {children}
    </button>
  );
}