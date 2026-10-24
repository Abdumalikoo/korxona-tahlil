'use client';

import { Button } from '@/components/ui/button';
import { IconAlert, IconTrash } from '@/components/ui/icons';
import { api, type ApiResponse } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatTiyin } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useRef, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Yagona «O'chirish» tugmasi — hamma bo'lim va rollarda bir xil ko'rinish va bir xil tartib:
//   Nimani: belgilangan qatorlar · bitta kun · bitta oy · sana oralig'i · hammasi (daromad/xarajat — barcha davrlar).
//   «Hammasi» yoki 50 tadan ortiq yozuv — o'chirish paroli so'raladi (Sozlamalar › Xavfsizlik).
//   Avval ko'rib chiqish (nechta yozuv, qancha summa, qaysi oy/hudud/manba) → «Tushundim» → o'chirish.
//   Daromad/xarajat savatga tushadi (15 kun tiklanadi); vedomost va natijalar — bekor qilinadi.
// Backend: /api/bulk-delete/preview, /api/bulk-delete/execute (administrator va Hududchi).
// ═══════════════════════════════════════════════════════════

export type DeleteTarget = 'INCOME' | 'EXPENSE' | 'PAYROLL' | 'RESULTS' | 'LEASE' | 'COMPOSITION' | 'CASHBOOK' | 'ASSET' | 'TAX';
/** Faqat administrator o'chiradi */
const ADMIN_ONLY: DeleteTarget[] = ['LEASE', 'COMPOSITION', 'CASHBOOK', 'ASSET', 'TAX'];
type Mode = 'ids' | 'day' | 'month' | 'range' | 'all';
/** «Hammasi» (barcha davrlar) — faqat daromad va xarajat */
const ALL_TARGETS: DeleteTarget[] = ['INCOME', 'EXPENSE'];

export interface DeleteScope {
  regional?: boolean;
  regionCode?: number;
  districtId?: string;
  sources?: string[];
  section?: 'DOIMIY' | 'BOSHQA';
  categoryCode?: string;
  /** Kiritish bo'limi (CENTER, REGION, TAX_FREE … QOMITA) — faqat shu bo'lim yozuvlari */
  unit?: string;
}

interface Group {
  key: string;
  label: string;
  count: number;
  totalTiyin: string;
}

interface Preview {
  periodLabel: string;
  count: number;
  totalTiyin: string;
  byMonth: Group[];
  byRegion: Group[];
  bySource: Group[];
  locked: (Group & { where: string })[];
  closedMonths: string[];
  sample: { id: string; date: string; label: string; region: string; amountTiyin: string }[];
  restorable: boolean;
  allowed: boolean;
  reason: string | null;
  /** O'chirishdan oldin parol so'raladi («Hammasi» yoki 50 tadan ortiq) */
  needsPassword?: boolean;
}

interface Body {
  target: DeleteTarget;
  mode: Mode;
  ids?: string[];
  day?: string;
  month?: string;
  from?: string;
  to?: string;
  scope?: DeleteScope;
  password?: string;
}

const deleteApi = {
  preview: (b: Body) => api.post<ApiResponse<Preview>>('/bulk-delete/preview', b),
  execute: (b: Body) => api.post<ApiResponse<{ count: number; totalTiyin: string; restorable: boolean; periodLabel: string }>>('/bulk-delete/execute', b),
};

const WHAT: Record<DeleteTarget, { one: string; unit: string }> = {
  INCOME: { one: 'daromad', unit: 'ta yozuv' },
  EXPENSE: { one: 'xarajat', unit: 'ta yozuv' },
  PAYROLL: { one: 'ish haqi vedomosti', unit: 'ta vedomost' },
  RESULTS: { one: 'xodim natijasi', unit: 'ta natija' },
  LEASE: { one: 'ijara', unit: 'ta (shartnoma yoki oy hisobi)' },
  COMPOSITION: { one: 'ish haqi tarkibi', unit: 'ta yuklama' },
  CASHBOOK: { one: "kunlik tushum ma'lumotnomasi", unit: 'ta kun' },
  ASSET: { one: 'asosiy vosita', unit: 'ta vosita' },
  TAX: { one: 'soliq', unit: 'ta yozuv' },
};
const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
const som = (t: string) => `${formatTiyin(t)} so'm`;
const todayIso = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
function shiftMonth(p: string, d: number): string {
  const [y, m] = p.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + d, 1)).toISOString().slice(0, 7);
}
const monthLabel = (p: string) => `${MONTHS[Number(p.slice(5)) - 1] ?? p} ${p.slice(0, 4)}`;

function Groups({ title, items }: { title: string; items: Group[] }) {
  if (items.length <= 1) return null;
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">{title}</p>
      <ul className="space-y-0.5 text-xs">
        {items.slice(0, 8).map((g) => (
          <li key={g.key} className="flex justify-between gap-3">
            <span className="truncate text-heading">{g.label}</span>
            <span className="whitespace-nowrap tabular-nums text-(--color-text-muted)">
              {g.count} · {formatTiyin(g.totalTiyin)}
            </span>
          </li>
        ))}
        {items.length > 8 && <li className="text-(--color-text-faint)">yana {items.length - 8} ta…</li>}
      </ul>
    </div>
  );
}

export interface DeleteDataProps {
  target: DeleteTarget;
  /** Sahifa doirasi (masalan Hududchi: { regional: true }; Daromadlar › Doimiy: { section: 'DOIMIY' }) */
  scope?: DeleteScope;
  /** Jadvalda belgilangan qatorlar (ish haqi va natijalar uchun — yuklash/vedomost id lari) */
  selectedIds?: string[];
  /** Oyna ochilganda tanlangan oy (sahifadagi oy; berilmasa — yuqori paneldagi davr) */
  month?: string;
  /** Tugma matni (standart: «O'chirish») */
  label?: string;
  /** Oyna ochilganda tanlangan usul (masalan «Hammasini o'chirish» tugmasi — 'all') */
  defaultMode?: Mode;
  /** Sahifa nomi — oynada ko'rinadi: «Daromadlar › Doimiy» */
  place?: string;
  /** O'chirilgandan keyin (ro'yxatni yangilash, belgilashni tozalash) */
  onDone?: (r: { count: number }) => void;
  size?: 'sm' | 'md';
  className?: string;
}

/** Yagona o'chirish tugmasi — dizayni hamma joyda bir xil */
export function DeleteDataButton(props: DeleteDataProps) {
  const { isAdmin, user } = useAuth();
  const [open, setOpen] = useState(false);
  // Administrator — hamma joyda; Hududchi — hududlar sahifalarida (server ham tekshiradi)
  const canDelete = isAdmin || (String(user?.role ?? '') === 'HUDUDCHI' && !ADMIN_ONLY.includes(props.target));
  if (!canDelete) return null;
  const n = props.selectedIds?.length ?? 0;
  return (
    <>
      <Button variant={n > 0 ? 'danger' : 'secondary'} size={props.size ?? 'md'} className={cn(n === 0 && 'text-(--color-expense)', props.className)} onClick={() => setOpen(true)}>
        <IconTrash className="size-4" />
        {props.label ?? "O'chirish"}
        {n > 0 && <span className="rounded bg-white/25 px-1.5 text-xs tabular-nums">{n}</span>}
      </Button>
      {open && <DeleteDataDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function DeleteDataDialog({ target, scope, selectedIds, place, month: givenMonth, defaultMode, onDone, onClose }: DeleteDataProps & { onClose: () => void }) {
  const { month: periodMonth } = usePeriod();
  const pageMonth = givenMonth ?? periodMonth;
  const monthly = target === 'PAYROLL' || target === 'RESULTS' || target === 'LEASE' || target === 'COMPOSITION';
  const hasIds = (selectedIds?.length ?? 0) > 0;
  const modes: { key: Mode; label: string }[] = [
    ...(hasIds ? [{ key: 'ids' as const, label: `Belgilanganlar (${selectedIds!.length})` }] : []),
    ...(monthly ? [] : [{ key: 'day' as const, label: 'Kun' }]),
    { key: 'month', label: 'Oy' },
    { key: 'range', label: 'Sana oralig\'i' },
    ...(ALL_TARGETS.includes(target) ? [{ key: 'all' as const, label: 'Hammasi' }] : []),
  ];
  const [mode, setMode] = useState<Mode>(defaultMode && modes.some((m) => m.key === defaultMode) ? defaultMode : hasIds ? 'ids' : 'month');
  const [password, setPassword] = useState('');
  /** O'chirish xatosi (masalan, parol noto'g'ri) — ko'rib chiqish natijasi ekranda qoladi */
  const [runError, setRunError] = useState<string | null>(null);
  const [day, setDay] = useState(todayIso());
  const [month, setMonth] = useState(pageMonth || todayIso().slice(0, 7));
  const [from, setFrom] = useState(`${(pageMonth || todayIso()).slice(0, 7)}-01`);
  const [to, setTo] = useState(todayIso());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ count: number; totalTiyin: string; restorable: boolean; periodLabel: string } | null>(null);
  const seq = useRef(0);

  const body = useMemo<Body>(() => {
    const b: Body = { target, mode, scope };
    if (mode === 'ids') b.ids = selectedIds;
    if (mode === 'day') b.day = day;
    if (mode === 'month') b.month = month;
    if (mode === 'range') {
      b.from = from;
      b.to = to;
    }
    return b;
  }, [target, mode, scope, selectedIds, day, month, from, to]);

  // Tanlov o'zgarsa — darhol qayta ko'rib chiqish
  useEffect(() => {
    const my = ++seq.current;
    setAgree(false);
    setPassword('');
    setRunError(null);
    setError(null);
    setLoading(true);
    const t = setTimeout(() => {
      deleteApi
        .preview(body)
        .then((r) => my === seq.current && setPreview(r.data))
        .catch((e) => {
          if (my !== seq.current) return;
          setPreview(null);
          setError(errorMessage(e));
        })
        .finally(() => my === seq.current && setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [body]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const run = async () => {
    setBusy(true);
    setRunError(null);
    try {
      const r = await deleteApi.execute(preview?.needsPassword ? { ...body, password } : body);
      setDone(r.data);
      onDone?.({ count: r.data.count });
    } catch (e) {
      setRunError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const w = WHAT[target];
  const input = 'h-9 rounded-lg border border-(--color-line) bg-white px-2.5 text-sm text-heading focus:border-brand-500 focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={busy ? undefined : onClose} aria-hidden />
      <div role="dialog" aria-modal="true" className="relative flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-(--radius-card) bg-white shadow-2xl">
        {/* Sarlavha */}
        <div className="flex items-start gap-3 border-b border-(--color-line) px-5 py-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-(--color-expense-soft)">
            <IconTrash className="size-5 text-(--color-expense)" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-heading">O&apos;chirish — {w.one}</h3>
            <p className="text-xs text-(--color-text-muted)">
              {place ? `${place} · ` : ''}
              {scope?.regional ? 'faqat hududlar ma\'lumoti' : 'xato kiritilgan yoki yuklangan ma\'lumotni o\'chirish'}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-2 py-1 text-lg text-(--color-text-faint) hover:bg-(--color-surface-muted)" aria-label="Yopish">
            ×
          </button>
        </div>

        {done ? (
          <div className="space-y-4 px-5 py-6 text-center">
            <p className="text-lg font-bold text-heading">
              {done.count} {w.unit} o&apos;chirildi
            </p>
            <p className="text-sm text-(--color-text-muted)">
              {done.periodLabel} · {som(done.totalTiyin)}
            </p>
            <p className={cn('rounded-lg px-3 py-2 text-xs', done.restorable ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900')}>
              {done.restorable ? "Yozuvlar savatga tushdi — 15 kun ichida Sozlamalar › Savatdan tiklash mumkin." : 'Bekor qilindi. Kerak bo\'lsa faylni qaytadan yuklang.'}
            </p>
            <Button onClick={onClose}>Yopish</Button>
          </div>
        ) : (
          <>
            <div className="space-y-4 overflow-y-auto px-5 py-4">
              {/* 1. Qanday tanlanadi */}
              <div>
                <p className="mb-1.5 text-xs font-semibold text-(--color-text-muted)">1. Nimani o&apos;chiramiz</p>
                <div className="flex flex-wrap gap-1 rounded-xl bg-(--color-surface-muted) p-1">
                  {modes.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setMode(m.key)}
                      className={cn('flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold', mode === m.key ? 'bg-white text-heading shadow-sm' : 'text-(--color-text-muted) hover:text-heading')}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 2. Sana / oy */}
              <div>
                <p className="mb-1.5 text-xs font-semibold text-(--color-text-muted)">2. {mode === 'ids' ? 'Belgilangan qatorlar' : mode === 'day' ? 'Qaysi kun' : mode === 'month' ? 'Qaysi oy' : mode === 'all' ? 'Barcha davrlar' : 'Qaysi oraliq'}</p>
                {mode === 'ids' && <p className="text-sm text-heading">Jadvalda belgilangan {selectedIds!.length} ta qator.</p>}
                {mode === 'all' && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">
                    {place ? <b>{place}</b> : 'Shu bo\'lim'}dagi <b>hamma {w.one} yozuvlari</b> — barcha oylar va yillar. O&apos;chirishdan oldin parol so&apos;raladi.
                  </p>
                )}
                {mode === 'day' && <input type="date" className={input} value={day} max={todayIso()} onChange={(e) => setDay(e.target.value)} />}
                {mode === 'month' && (
                  <div className="inline-flex items-center gap-1 rounded-xl border border-(--color-line) bg-white p-1">
                    <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} className="flex size-8 items-center justify-center rounded-lg text-lg hover:bg-brand-50" aria-label="Oldingi oy">
                      ‹
                    </button>
                    <span className="min-w-32 text-center text-sm font-bold text-heading">{monthLabel(month)}</span>
                    <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} className="flex size-8 items-center justify-center rounded-lg text-lg hover:bg-brand-50" aria-label="Keyingi oy">
                      ›
                    </button>
                  </div>
                )}
                {mode === 'range' && (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <input type="date" className={input} value={from} onChange={(e) => setFrom(e.target.value)} />
                    <span className="text-(--color-text-muted)">—</span>
                    <input type="date" className={input} value={to} onChange={(e) => setTo(e.target.value)} />
                  </div>
                )}
              </div>

              {/* 3. Ko'rib chiqish */}
              <div>
                <p className="mb-1.5 text-xs font-semibold text-(--color-text-muted)">3. Nima o&apos;chadi</p>
                <div className={cn('rounded-xl border px-4 py-3 transition-opacity', loading && 'opacity-60', preview && !preview.allowed ? 'border-amber-200 bg-amber-50' : 'border-(--color-line) bg-(--color-surface-muted)')}>
                  {error ? (
                    <p className="text-sm text-(--color-expense)">{error}</p>
                  ) : !preview ? (
                    <p className="text-sm text-(--color-text-muted)">Hisoblanmoqda…</p>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-2xl font-bold tabular-nums text-heading">
                          {preview.count} <span className="text-sm font-semibold text-(--color-text-muted)">{w.unit}</span>
                        </p>
                        <p className="text-lg font-bold tabular-nums text-(--color-expense)">{som(preview.totalTiyin)}</p>
                      </div>
                      <p className="text-xs text-(--color-text-muted)">{preview.periodLabel}</p>
                      {preview.reason && (
                        <p className="flex items-start gap-2 text-sm text-amber-900">
                          <IconAlert className="mt-0.5 size-4 shrink-0" />
                          {preview.reason}
                        </p>
                      )}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Groups title="Oylar" items={preview.byMonth} />
                        <Groups title="Hududlar" items={preview.byRegion} />
                        <Groups title="Manba" items={preview.bySource} />
                      </div>
                      {preview.sample.length > 0 && (
                        <div>
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">Masalan</p>
                          <ul className="divide-y divide-(--color-line) rounded-lg bg-white text-xs">
                            {preview.sample.map((s) => (
                              <li key={s.id} className="flex items-center gap-3 px-3 py-1.5">
                                <span className="w-20 shrink-0 tabular-nums text-(--color-text-muted)">{s.date.length === 10 ? s.date.split('-').reverse().join('.') : s.date}</span>
                                <span className="min-w-0 flex-1 truncate text-heading">{s.label}</span>
                                <span className="hidden shrink-0 text-(--color-text-faint) sm:inline">{s.region}</span>
                                <span className="shrink-0 font-semibold tabular-nums">{formatTiyin(s.amountTiyin)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {preview.locked.length > 0 && (
                        <div className="rounded-lg bg-white px-3 py-2 text-xs">
                          <p className="font-semibold text-heading">Bu yerda o&apos;chirilmaydi (boshqa hujjatdan kelgan):</p>
                          <ul className="mt-1 space-y-1">
                            {preview.locked.map((l) => (
                              <li key={l.key}>
                                <b>{l.label}</b> — {l.count} ta, {formatTiyin(l.totalTiyin)}. <span className="text-(--color-text-muted)">{l.where}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {preview?.allowed && (
                <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-(--color-line) px-4 py-3 text-sm">
                  <input type="checkbox" className="mt-0.5 size-4 accent-red-600" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                  <span>
                    Tushundim: <b>{preview.count} {w.unit}</b> ({som(preview.totalTiyin)}) o&apos;chiriladi.{' '}
                    <span className="text-(--color-text-muted)">
                      {preview.restorable ? 'Savatga tushadi, 15 kun ichida tiklash mumkin.' : 'Bekor qilinadi — kerak bo\'lsa faylni qaytadan yuklaysiz.'}
                    </span>
                  </span>
                </label>
              )}

              {preview?.allowed && preview.needsPassword && agree && (
                <div className="rounded-xl border border-red-200 bg-red-50/60 px-4 py-3">
                  <label className="block text-sm font-semibold text-heading" htmlFor="delete-password">
                    O&apos;chirish paroli
                  </label>
                  <p className="mb-2 text-xs text-(--color-text-muted)">
                    {mode === 'all' ? '«Hammasi» tanlangan' : `${preview.count} ta yozuv (50 tadan ortiq)`} — davom etish uchun parolni kiriting. Parolni administrator Sozlamalar › Xavfsizlik bo&apos;limida o&apos;zgartiradi.
                  </p>
                  <input
                    id="delete-password"
                    type="password"
                    autoComplete="off"
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && password && !busy) void run();
                    }}
                    maxLength={64}
                    className="h-10 w-full max-w-xs rounded-lg border border-(--color-line-strong) bg-white px-3 text-sm tracking-widest focus:border-red-500 focus:outline-none"
                  />
                </div>
              )}
              {runError && (
                <p className="flex items-start gap-2 rounded-lg bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">
                  <IconAlert className="mt-0.5 size-4 shrink-0" />
                  {runError}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-(--color-line) bg-(--color-surface-muted) px-5 py-3">
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Bekor qilish
              </Button>
              <Button variant="danger" onClick={() => void run()} loading={busy} disabled={!preview?.allowed || !agree || loading || (Boolean(preview?.needsPassword) && !password)}>
                <IconTrash className="size-4" />
                {preview?.allowed ? `${preview.count} ${w.unit}ni o'chirish` : "O'chirish"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}