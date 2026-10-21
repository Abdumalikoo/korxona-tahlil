'use client';

import { buttonClass } from '@/components/ui/button';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { hpApi, monthName, nextMonth, periodAdd, PLAN_CLS, RELIABILITY, SOURCE_LABEL, type PlanStatus, type RunMeta } from './api';

// ═══════════════════════════════════════════════════════════
// Hudud uchun reja — sahifalar uchun umumiy holat va bo'laklar.
// Prognoz oyi ?period= da (bo'lim yorliqlari orasida saqlanadi), hudud ?hudud= da,
// tanlangan hisob — brauzer seansida (har prognoz oyi uchun alohida).
// ═══════════════════════════════════════════════════════════

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const RUN_KEY = 'hp_run_';

function readRun(target: string): string | null {
  try {
    return window.sessionStorage.getItem(RUN_KEY + target);
  } catch {
    return null;
  }
}
function writeRun(target: string, id: string) {
  try {
    window.sessionStorage.setItem(RUN_KEY + target, id);
  } catch {
    // eslab qolinmasa ham ishlaydi
  }
}

export interface HpState {
  target: string;
  region: number | null;
  setParams: (patch: Record<string, string | null>) => void;
  runs: RunMeta[];
  runsLoading: boolean;
  runsError: string | null;
  /** Tanlangan (yoki eng so'nggi muvaffaqiyatli) hisob */
  run: RunMeta | null;
  running: RunMeta | null;
  failed: RunMeta | null;
  pick: (id: string) => void;
  reload: () => void;
  /** Ixtiyoriy hisob tugaganda ko'rinish yangilanishi uchun */
  tick: number;
}

export function useHp(): HpState {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = sp.get('period');
  const target = raw && PERIOD.test(raw) ? raw : nextMonth();
  const hr = sp.get('hudud');
  const region = hr && /^\d+$/.test(hr) ? Number(hr) : null;
  const [tick, setTick] = useState(0);
  const runsQ = useAsync(() => hpApi.runs(target).then((r) => r.data), [target, tick]);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(readRun(target)), [target]);

  const runs = useMemo(() => runsQ.data ?? [], [runsQ.data]);
  const done = runs.filter((r) => r.status === 'DONE');
  const run = done.find((r) => r.id === picked) ?? done[0] ?? null;
  const running = runs.find((r) => r.status === 'RUNNING') ?? null;
  const failed = runs[0]?.status === 'FAILED' ? runs[0] : null;

  // Hisob ketayotganda ro'yxat har 2,5 soniyada yangilanadi
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((x) => x + 1), 2500);
    return () => clearInterval(t);
  }, [running?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const q = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') q.delete(k);
        else q.set(k, v);
      }
      const s = q.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [sp, router, pathname],
  );

  const pick = useCallback(
    (id: string) => {
      writeRun(target, id);
      setPicked(id);
    },
    [target],
  );

  return { target, region, setParams, runs, runsLoading: runsQ.loading, runsError: runsQ.error, run, running, failed, pick, reload: () => setTick((x) => x + 1), tick };
}

/** Sahifalar orasidagi havola: prognoz oyi (va hudud) saqlanadi */
export function hpHref(path: string, target: string, extra: Record<string, string | number | null | undefined> = {}): string {
  const q = new URLSearchParams({ period: target });
  for (const [k, v] of Object.entries(extra)) if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
  return `${path}?${q.toString()}`;
}

function time(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const SOURCE_SHORT: Record<string, string> = { merged: 'Birlashtirilgan', system: 'Dasturdagi', import: 'Yuklangan' };

export function runLabel(r: RunMeta, index?: number): string {
  const approved = r.approvedRegions?.length ? ` · ✓ ${r.approvedRegions.length} hudud tasdiqlangan` : '';
  return `${index !== undefined ? `№${index} · ` : ''}${time(r.createdAt)} · ${SOURCE_SHORT[r.params.source] ?? r.params.source} · test ${r.params.backtestMonths} oy${approved}`;
}

/** Yuqori qator: prognoz oyi, hisob tanlash, (ixtiyoriy) hudud */
export function HpBar({ hp, regions, children, showRun = true }: { hp: HpState; regions?: { code: number; name: string }[]; children?: ReactNode; showRun?: boolean }) {
  const done = hp.runs.filter((r) => r.status === 'DONE');
  const total = done.length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-(--radius-card) bg-white p-2 shadow-card">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => hp.setParams({ period: periodAdd(hp.target, -1) })} className="flex size-9 items-center justify-center rounded-lg text-xl hover:bg-brand-50" aria-label="Oldingi oy">
            ‹
          </button>
          <div className="min-w-44 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">Prognoz oyi</p>
            <p className="text-[15px] font-bold leading-tight text-heading">{monthName(hp.target)}</p>
          </div>
          <button type="button" onClick={() => hp.setParams({ period: periodAdd(hp.target, 1) })} disabled={hp.target >= periodAdd(nextMonth(), 0)} className="flex size-9 items-center justify-center rounded-lg text-xl hover:bg-brand-50 disabled:opacity-30" aria-label="Keyingi oy">
            ›
          </button>
        </div>
        {showRun && (
          <label className="flex min-w-0 flex-1 items-center gap-2 border-l border-(--color-border) pl-3 text-sm">
            <span className="shrink-0 text-(--color-text-muted)">Hisob</span>
            {total === 0 ? (
              <span className="text-(--color-text-muted)">{hp.runsLoading ? 'yuklanmoqda…' : 'bu oy uchun hali hisoblanmagan'}</span>
            ) : (
              <select value={hp.run?.id ?? ''} onChange={(e) => hp.pick(e.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-(--color-border) bg-white px-2 text-sm">
                {done.map((r, i) => (
                  <option key={r.id} value={r.id}>
                    {runLabel(r, total - i)}
                    {i === 0 ? ' (eng so‘nggi)' : ''}
                  </option>
                ))}
              </select>
            )}
          </label>
        )}
        {regions && (
          <label className="flex items-center gap-2 border-l border-(--color-border) pl-3 text-sm">
            <span className="text-(--color-text-muted)">Hudud</span>
            <select value={hp.region ?? ''} onChange={(e) => hp.setParams({ hudud: e.target.value || null })} className="h-9 rounded-lg border border-(--color-border) bg-white px-2 text-sm">
              <option value="">Barcha hududlar</option>
              {regions.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
      </div>
      {hp.running && (
        <Banner tone="info">
          <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-sky-500" />
          Prognoz hisoblanmoqda ({time(hp.running.createdAt)} da boshlangan). Tugagach, natijalar shu yerda avtomatik paydo bo‘ladi.
        </Banner>
      )}
      {hp.failed && !hp.running && (
        <Banner tone="bad">
          So‘nggi hisob xato bilan tugadi: {hp.failed.error ?? 'noma’lum xato'}. {hp.run ? 'Quyida oldingi muvaffaqiyatli hisob ko‘rsatilmoqda.' : ''}
        </Banner>
      )}
      {hp.run && hp.run.params.source !== 'merged' && <Banner tone="info">Bu hisobda ma’lumot manbasi: {SOURCE_LABEL[hp.run.params.source]}.</Banner>}
    </div>
  );
}

export function Banner({ tone, children }: { tone: 'info' | 'warn' | 'bad' | 'ok'; children: ReactNode }) {
  const cls = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    bad: 'border-red-200 bg-red-50 text-red-900',
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  }[tone];
  return <div className={cn('rounded-(--radius-card) border px-4 py-2.5 text-sm', cls)}>{children}</div>;
}

/** Hisob yo'q — Prognozlash sahifasiga yo'naltiradi */
export function NoRun({ hp, what }: { hp: HpState; what: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-(--radius-card) bg-white px-6 py-14 text-center shadow-card">
      <span className="flex size-12 items-center justify-center rounded-full bg-brand-50 text-xl text-brand-700">∿</span>
      <p className="text-lg font-bold text-heading">{monthName(hp.target)} uchun prognoz hali hisoblanmagan</p>
      <p className="max-w-lg text-sm text-(--color-text-muted)">
        {what} prognoz hisoblangandan keyin ko‘rinadi. Avval tarixiy ma’lumotlar yuklanganini tekshiring, so‘ng «Prognozlash» sahifasida hisoblang.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Link href={hpHref('/hudud-reja/prognoz', hp.target)} className={buttonClass('primary')}>
          Prognozlash
        </Link>
        <Link href={hpHref('/hudud-reja/yuklash', hp.target)} className={buttonClass('secondary')}>
          Ma’lumotlarni yuklash
        </Link>
      </div>
    </div>
  );
}

export function Kpi({ label, value, hint, tone = 'plain', foot }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'brand' | 'plain' | 'warn' | 'bad' | 'ok'; foot?: ReactNode }) {
  const dark = tone === 'brand';
  return (
    <div className={cn('flex min-w-0 flex-col rounded-(--radius-card) p-4 shadow-card', dark ? 'bg-gradient-to-br from-brand-600 to-brand-800 text-white' : 'bg-white')}>
      <p className={cn('text-xs font-semibold', dark ? 'text-white/80' : 'text-(--color-text-muted)')}>{label}</p>
      <p className={cn('money mt-1 truncate text-[22px] font-bold leading-tight', dark ? 'text-white' : tone === 'warn' ? 'text-amber-600' : tone === 'bad' ? 'text-(--color-expense)' : tone === 'ok' ? 'text-(--color-income)' : 'text-heading')}>{value}</p>
      {hint && <p className={cn('mt-0.5 text-xs', dark ? 'text-white/75' : 'text-(--color-text-muted)')}>{hint}</p>}
      {foot && <div className="mt-auto pt-2">{foot}</div>}
    </div>
  );
}

export function Panel({ title, description, actions, children, className, flush }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={cn('rounded-(--radius-card) bg-white shadow-card', className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-(--color-border) px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold text-heading">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-(--color-text-muted)">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className={flush ? '' : 'p-5'}>{children}</div>
    </section>
  );
}

export function PlanPill({ plan }: { plan: PlanStatus }) {
  return <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', PLAN_CLS[plan.status])}>{plan.label}</span>;
}

export function ReliabilityPill({ value }: { value: string | null | undefined }) {
  const r = RELIABILITY[value ?? 'none'] ?? RELIABILITY.none!;
  return <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', r.cls)}>{r.label}</span>;
}

/** Ishonchlilik taqsimoti (bir nechta hudud/xizmat uchun) */
export function ReliabilityMix({ mix }: { mix: Record<string, number> }) {
  const order = ['high', 'medium', 'low', 'none'];
  return (
    <span className="flex flex-wrap gap-1">
      {order
        .filter((k) => mix[k])
        .map((k) => (
          <span key={k} className={cn('rounded-full px-1.5 py-0.5 text-[11px] font-semibold', RELIABILITY[k]!.cls)}>
            {RELIABILITY[k]!.label} {mix[k]}
          </span>
        ))}
    </span>
  );
}

export function Insufficient({ text = 'Ma’lumot yetarli emas' }: { text?: string }) {
  return <span className="text-xs font-medium text-(--color-text-muted)">{text}</span>;
}

/** O'zgarish (foiz) — rangli */
export function Change({ value, digits = 1 }: { value: number | null | undefined; digits?: number }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="text-(--color-text-muted)">—</span>;
  const t = `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(digits).replace('.', ',')}%`;
  return <span className={cn('money font-semibold', value > 0.05 ? 'text-(--color-income)' : value < -0.05 ? 'text-(--color-expense)' : 'text-(--color-text-muted)')}>{t}</span>;
}

/** Jadval qatorlarini saralash */
export function useSort<T>(rows: T[], initial: { key: string; dir: 'asc' | 'desc' }, get: (row: T, key: string) => number | string | null) {
  const [sort, setSort] = useState(initial);
  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => {
      const x = get(a, sort.key);
      const y = get(b, sort.key);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      const c = typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y), 'uz') : x - y;
      return sort.dir === 'asc' ? c : -c;
    });
    return out;
  }, [rows, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (key: string) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' || key === 'serviceName' ? 'asc' : 'desc' }));
  return { sorted, sort, toggle };
}

export function SortTh({ label, k, sort, onSort, align = 'right', className, title }: { label: ReactNode; k: string; sort: { key: string; dir: 'asc' | 'desc' }; onSort: (k: string) => void; align?: 'left' | 'right'; className?: string; title?: string }) {
  const active = sort.key === k;
  return (
    <th className={cn('whitespace-nowrap px-3 py-2.5 text-xs font-semibold text-(--color-text-muted)', align === 'right' ? 'text-right' : 'text-left', className)} title={title}>
      <button type="button" onClick={() => onSort(k)} className={cn('inline-flex items-center gap-1 hover:text-heading', active && 'text-heading')}>
        {label}
        <span className="text-[10px]">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}

export const thCls = 'whitespace-nowrap px-3 py-2.5 text-xs font-semibold text-(--color-text-muted)';
export const tdCls = 'px-3 py-2.5';