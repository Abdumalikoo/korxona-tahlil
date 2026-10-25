'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconSearch } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { reconcileApi, type ReconAllocateItem } from '@/features/salary-composition/api';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatDateTime, formatTiyin } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';
import { solishtirmaApi, type BankMonthMode, type GroupKey, type SolishtirmaSettings, type SolRow, type SolState, type SolTab, type SolView } from './api';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › Ish haqi solishtirma: FOT (FAQAT soliq hisoboti) − daromad solig'i − kasaba uyushmasi (faqat shtat) = 23106.
// Ikki tablo:
//  • Markaz — Markaz xodimlari va yo'nalishlar: yonida ish haqi tarkibi; tarkib soliq hisobotidan farq qilsa —
//    farqni shu yerda komponentga yo'naltirish (bayram puli, mukofot …), tarkib soliq hisobotiga tenglashadi;
//  • Hududlar — faqat soliq hisoboti bo'yicha.
// Mos kelganlar — kategoriyalar bo'yicha jamlanadi va bitta tugma bilan «to'g'ri» deb tasdiqlanadi.
// ═══════════════════════════════════════════════════════════

const STATE: Record<SolState, { label: string; tone: 'income' | 'expense' | 'warn' | 'neutral' }> = {
  OK: { label: 'Mos', tone: 'income' },
  LESS: { label: 'Bankdan kam', tone: 'expense' },
  MORE: { label: "Bankdan ko'p", tone: 'warn' },
  NO_BANK: { label: "23106 da yo'q", tone: 'expense' },
  NO_FOT: { label: "Soliq hisobotida yo'q", tone: 'warn' },
};

type StateFilter = 'PROBLEM' | 'TARKIB' | 'UNCONFIRMED' | SolState | 'ALL';
type Choice = { code: string; amount: string };
const PAGE = 100;

/** Xavfsiz BigInt: maydon yo'q yoki noto'g'ri bo'lsa — 0 (sahifa yiqilmasin) */
function big(x: string | null | undefined): bigint {
  if (x === null || x === undefined || x === '') return 0n;
  try {
    return BigInt(x);
  } catch {
    return 0n;
  }
}

/** Tiyin → kiritish maydoni (so'm) */
function toInput(tiyin: string): string {
  const v = big(tiyin);
  const a = v < 0n ? -v : v;
  return (v < 0n ? '-' : '') + (a / 100n).toString() + (a % 100n ? `.${String(a % 100n).padStart(2, '0')}` : '');
}

/** Kiritilgan so'm → tiyin (null — noto'g'ri yoki nol) */
function parseSum(raw: string): string | null {
  const s = raw.replace(/[\s ]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const neg = s.startsWith('-');
  const [i, f = ''] = s.replace('-', '').split('.');
  const v = BigInt(i!) * 100n + BigInt((f + '00').slice(0, 2));
  return v === 0n ? null : (neg ? -v : v).toString();
}

export function SolishtirmaView() {
  const { isAdmin } = useAuth();
  const { month: period } = usePeriod();
  const [tab, setTab] = useState<SolTab>('CENTER');
  const [mode, setMode] = useState<BankMonthMode>('ACCRUAL');
  const data = useAsync(() => solishtirmaApi.view(period, mode, tab).then((r) => r.data), [period, mode, tab]);
  const v = data.data;
  const [group, setGroup] = useState<GroupKey | 'ALL'>('ALL');
  const [state, setState] = useState<StateFilter>('PROBLEM');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{ taxPct: string; unionPct: string; toleranceSum: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  // Tarkib farqini yo'naltirish
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [askAllocate, setAskAllocate] = useState(false);
  // Tasdiq
  const [askConfirm, setAskConfirm] = useState(false);
  const [askCancel, setAskCancel] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Yangi ma'lumot: tanlovlar — tavsiya (bo'lsa) va farq summasi
  const [seen, setSeen] = useState<SolView | null>(null);
  if (v && v !== seen) {
    setSeen(v);
    const c: Record<string, Choice> = {};
    for (const r of v.rows) if (r.tarkibFix?.canAllocate) c[r.pinfl] = { code: r.tarkibFix.suggestion?.componentCode ?? '', amount: toInput(r.tarkibFix.diffTiyin) };
    setChoices(c);
    setPicked(new Set());
  }

  function switchTab(t: SolTab) {
    setTab(t);
    setGroup('ALL');
    setState('PROBLEM');
    setQ('');
    setPage(1);
  }

  const shown = useMemo(() => {
    if (!v) return [];
    const t = q.trim().toLowerCase();
    return v.rows.filter((r) => {
      if (group !== 'ALL' && r.group !== group) return false;
      if (state === 'PROBLEM' && r.state === 'OK' && !r.tarkibFix?.canAllocate) return false;
      if (state === 'TARKIB' && !r.tarkibFix?.canAllocate) return false;
      if (state === 'UNCONFIRMED' && (!r.confirmable || r.confirm === 'CONFIRMED')) return false;
      if (state !== 'PROBLEM' && state !== 'ALL' && state !== 'TARKIB' && state !== 'UNCONFIRMED' && r.state !== state) return false;
      return !t || r.fullName.toLowerCase().includes(t) || r.pinfl.includes(t) || (r.regionName ?? '').toLowerCase().includes(t) || (r.unitLabel ?? '').toLowerCase().includes(t);
    });
  }, [v, group, state, q]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const slice = shown.slice((page - 1) * PAGE, page * PAGE);

  async function saveSettings() {
    if (!editing) return;
    const toNum = (x: string) => Number(x.replace(',', '.').replace(/\s/g, ''));
    const s: SolishtirmaSettings = { taxPct: toNum(editing.taxPct), unionPct: toNum(editing.unionPct), toleranceSum: toNum(editing.toleranceSum) };
    setSaving(true);
    try {
      await solishtirmaApi.saveSettings(s);
      setToast({ message: 'Sozlamalar saqlandi — solishtirma qayta hisoblandi', tone: 'success' });
      setEditing(null);
      data.reload();
    } catch (err) {
      setToast({ message: errorMessage(err, 'Saqlashda xatolik'), tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  const ready = (r: SolRow) => {
    const c = choices[r.pinfl];
    return Boolean(r.tarkibFix?.canAllocate && c?.code && parseSum(c.amount));
  };
  const toItem = (r: SolRow): ReconAllocateItem => {
    const c = choices[r.pinfl]!;
    const amountTiyin = parseSum(c.amount)!;
    const s = r.tarkibFix?.suggestion;
    return { pinfl: r.pinfl, componentCode: c.code, amountTiyin, source: s && s.componentCode === c.code && s.amountTiyin === amountTiyin ? 'SUGGESTION' : 'MANUAL' };
  };

  /** Yo'naltirish: bo'lim (Markaz / yo'nalish) bo'yicha alohida so'rov */
  async function allocate(list: SolRow[], one?: string) {
    if (!list.length) return;
    if (one) setBusy(one);
    else setSaving(true);
    try {
      const byUnit = new Map<string, SolRow[]>();
      for (const r of list) {
        const k = r.tarkibFix?.unit ?? '';
        byUnit.set(k, [...(byUnit.get(k) ?? []), r]);
      }
      let count = 0;
      let total = 0n;
      for (const [u, rows] of byUnit) {
        const res = (await reconcileApi.allocate(period, rows.map(toItem), u || undefined)).data;
        count += res.count;
        total += big(res.totalTiyin);
      }
      setToast({ message: `Yo'naltirildi: ${count} xodim · ${formatTiyin(total.toString())} so'm — tarkib soliq hisobotiga tenglashdi`, tone: 'success' });
      data.reload();
    } catch (err) {
      setToast({ message: errorMessage(err, "Yo'naltirishda xatolik"), tone: 'error' });
      data.reload();
    } finally {
      setBusy(null);
      setSaving(false);
      setAskAllocate(false);
    }
  }

  async function doConfirm() {
    setConfirming(true);
    try {
      const r = (await solishtirmaApi.confirm(period, tab, mode)).data;
      setToast({ message: `Tasdiqlandi: ${r.confirmed} xodim «to'g'ri» (jami tasdiqlangan ${r.total})`, tone: 'success' });
      data.reload();
    } catch (err) {
      setToast({ message: errorMessage(err, 'Tasdiqlashda xatolik'), tone: 'error' });
    } finally {
      setConfirming(false);
      setAskConfirm(false);
    }
  }

  async function doCancel() {
    setConfirming(true);
    try {
      const r = (await solishtirmaApi.cancelConfirm(period, tab)).data;
      setToast({ message: `Tasdiq bekor qilindi (${r.removed} xodim)`, tone: 'success' });
      data.reload();
    } catch (err) {
      setToast({ message: errorMessage(err, 'Bekor qilishda xatolik'), tone: 'error' });
    } finally {
      setConfirming(false);
      setAskCancel(false);
    }
  }

  if (data.loading && !v) return <Card><LoadingState /></Card>;
  if (data.error) return <Card><ErrorState message={data.error} onRetry={data.reload} /></Card>;
  if (!v) return null;
  const st = v.settings;
  const s = v.summary;
  const apiStale = v.tab === undefined;
  const isCenter = tab === 'CENTER';
  const tol = BigInt(Math.round(st.toleranceSum * 100));
  const components = v.components ?? [];
  const byCategory = [...new Map(components.map((c) => [c.categoryLabel, components.filter((x) => x.categoryLabel === c.categoryLabel)])).entries()];
  const fixRows = v.rows.filter((r) => r.tarkibFix?.canAllocate);
  const chosen = fixRows.filter((r) => picked.has(r.pinfl) && ready(r));
  const chosenTotal = chosen.reduce((x, r) => x + big(parseSum(choices[r.pinfl]!.amount)), 0n);
  const strong = fixRows.filter((r) => r.tarkibFix?.suggestion?.confidence === 'STRONG' && ready(r));
  const m = v.matched;
  const counts = (k: StateFilter) => {
    const list = group === 'ALL' ? v.rows : v.rows.filter((r) => r.group === group);
    if (k === 'ALL') return list.length;
    if (k === 'PROBLEM') return list.filter((r) => r.state !== 'OK' || r.tarkibFix?.canAllocate).length;
    if (k === 'TARKIB') return list.filter((r) => r.tarkibFix?.canAllocate).length;
    if (k === 'UNCONFIRMED') return list.filter((r) => r.confirmable && r.confirm !== 'CONFIRMED').length;
    return list.filter((r) => r.state === k).length;
  };
  const chips: StateFilter[] = isCenter ? ['PROBLEM', 'TARKIB', 'LESS', 'MORE', 'NO_BANK', 'NO_FOT', 'UNCONFIRMED', 'OK', 'ALL'] : ['PROBLEM', 'LESS', 'MORE', 'NO_BANK', 'NO_FOT', 'UNCONFIRMED', 'OK', 'ALL'];
  const chipLabel = (k: StateFilter) => (k === 'PROBLEM' ? 'Farq chiqqanlar' : k === 'TARKIB' ? 'Tarkib farqi' : k === 'UNCONFIRMED' ? 'Tasdiqlanmagan' : k === 'ALL' ? 'Hammasi' : STATE[k].label);
  const colCount = isCenter ? 9 : 8;

  return (
    <>
      {/* Qoida va sozlamalar */}
      <Card>
        <CardHeader title={`Ish haqi solishtirma · ${v.label}`} description="FOT — soliq hisobotidagi summa (asosiy manba): undan ortiq ham, kam ham olinmaydi. FOT − daromad solig‘i − kasaba uyushmasi (faqat asosiy shtat) = 23106 dan qo‘lga to‘langan" />
        <CardBody className="space-y-4">
          {apiStale && (
            <p className="rounded-(--radius-control) border border-(--color-warn) bg-(--color-warn-soft) px-3 py-2 text-sm text-(--color-warn)">
              API eski versiyada ishlayapti — tablolar va yo‘naltirish ishlamaydi. API’ni qayta yig‘ib ishga tushiring: <code>pnpm --filter api build</code>, keyin <code>node dist\main.js</code>.
            </p>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <Rule title="Asosiy shtat (Markaz va hududlar)" formula={`FOT − ${st.taxPct}% soliq − ${st.unionPct}% kasaba = 23106`} example={`10 000 000 − ${formatTiyin(String(Math.round(10_000_000 * st.taxPct)))} − ${formatTiyin(String(Math.round(10_000_000 * st.unionPct)))} = ${formatTiyin(String(Math.round(10_000_000 * (100 - st.taxPct - st.unionPct))))}`} />
            <Rule title="Shartnoma asosida" formula={`FOT − ${st.taxPct}% soliq = 23106`} example={`10 000 000 − ${formatTiyin(String(Math.round(10_000_000 * st.taxPct)))} = ${formatTiyin(String(Math.round(10_000_000 * (100 - st.taxPct))))}`} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Source ok={v.sources.soliq} label="Soliq hisoboti" />
            <Source ok={v.sources.tarkib} label="Ish haqi tarkibi" />
            <Source ok={v.sources.bank} label="23106 ko‘chirmasi" />
            <span className="ml-auto flex items-center gap-1 rounded-full border border-(--color-line) bg-white p-0.5">
              <span className="pl-2 text-(--color-text-muted)">23106:</span>
              <ModeBtn active={mode === 'ACCRUAL'} onClick={() => setMode('ACCRUAL')} title="Izohdagi «… oyi uchun» (bo‘lmasa buyruq oyi): avans shu oyda, qoldiq keyingi oyda to‘lansa ham — shu oyga">
                Qaysi oy uchun to‘langan
              </ModeBtn>
              <ModeBtn active={mode === 'PAID'} onClick={() => setMode('PAID')} title="Bankda shu oy to‘langan hamma pul">
                Shu oy to‘langan
              </ModeBtn>
            </span>
          </div>
          {isAdmin &&
            (editing ? (
              <div className="flex flex-wrap items-end gap-3 rounded-(--radius-control) border border-(--color-line) bg-(--color-surface-muted) px-3 py-2.5 text-sm">
                <Num label="Daromad solig‘i, %" value={editing.taxPct} onChange={(x) => setEditing({ ...editing, taxPct: x })} />
                <Num label="Kasaba uyushmasi, % (shtat)" value={editing.unionPct} onChange={(x) => setEditing({ ...editing, unionPct: x })} />
                <Num label="Ruxsat etilgan farq, so‘m" value={editing.toleranceSum} onChange={(x) => setEditing({ ...editing, toleranceSum: x })} />
                <Button size="sm" onClick={() => void saveSettings()} loading={saving}>
                  Saqlash
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
                  Bekor
                </Button>
              </div>
            ) : (
              <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setEditing({ taxPct: String(st.taxPct), unionPct: String(st.unionPct), toleranceSum: String(st.toleranceSum) })}>
                Foizlarni o‘zgartirish (soliq {st.taxPct}%, kasaba {st.unionPct}%, farq chegarasi {st.toleranceSum.toLocaleString('uz-UZ')} so‘m)
              </button>
            ))}
        </CardBody>
      </Card>

      {/* Ikki tablo */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['CENTER', 'Markaz', 'Markaz xodimlari va yo‘nalishlar · tarkib bilan'],
            ['REGION', 'Hududlar', 'faqat soliq hisoboti bo‘yicha'],
          ] as [SolTab, string, string][]
        ).map(([k, label, sub]) => {
          const t = v.tabs?.[k];
          return (
            <button
              key={k}
              type="button"
              onClick={() => switchTab(k)}
              className={cn('min-w-[15rem] rounded-(--radius-card) border px-4 py-3 text-left transition-colors', tab === k ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-(--color-line) bg-white hover:border-brand-400')}
            >
              <span className="flex items-center gap-2">
                <span className="text-base font-semibold text-heading">{label}</span>
                {t && (t.problems ? <Badge tone="expense">{t.problems} farq</Badge> : <Badge tone="income">mos</Badge>)}
                {k === 'CENTER' && t?.tarkibDiff ? <Badge tone="warn">{t.tarkibDiff} tarkib farqi</Badge> : null}
              </span>
              <span className="mt-0.5 block text-xs text-(--color-text-muted)">
                {sub}
                {t ? ` · ${t.employees} xodim` : ''}
              </span>
            </button>
          );
        })}
      </div>

      {!v.rows.length ? (
        <Card>
          <EmptyState title={`${v.label}: ${isCenter ? 'Markaz' : 'Hududlar'} bo‘yicha ma'lumot yo'q`} description="Shu oy soliq hisobotini va 23106 ko‘chirmasini yuklang" />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Box label="Mos" value={String(s.ok)} sub={`${s.employees} xodimdan`} tone="income" />
            <Box label="Bankdan kam" value={String(s.less)} sub="23106 kutilganidan kam" tone={s.less ? 'expense' : 'neutral'} />
            <Box label="Bankdan ko‘p" value={String(s.more)} sub="23106 kutilganidan ko‘p" tone={s.more ? 'warn' : 'neutral'} />
            <Box label="23106 da yo‘q" value={String(s.noBank)} sub="soliq hisobotida bor, to‘lov yo‘q" tone={s.noBank ? 'expense' : 'neutral'} />
            <Box label="Soliq hisobotida yo‘q" value={String(s.noFot)} sub="to‘lov yoki tarkib bor, soliqda yo‘q" tone={s.noFot ? 'warn' : 'neutral'} />
          </div>

          {/* Mos kelganlar: kategoriyalar va tasdiq */}
          {m && (
            <Card>
              <CardHeader
                title={isCenter ? 'Mos kelganlar: tarkib = soliq hisoboti' : 'Mos kelganlar: 23106 = kutilgan'}
                description={`${m.count} xodim · soliq hisoboti ${formatTiyin(m.soliqTiyin)} so'm${isCenter ? ` · 23106 ham mos: ${m.bankOk}` : ''}`}
              />
              <CardBody className="space-y-3">
                {isCenter && m.categories.length > 0 && <CategoryBars cats={m.categories} />}
                {!isCenter && m.byGroup.length > 0 && (
                  <div className="flex flex-wrap gap-2 text-xs">
                    {m.byGroup.map((g) => (
                      <span key={g.key} className="rounded-full border border-(--color-line) bg-white px-3 py-1">
                        <b className="text-heading">{g.label}</b> · {g.count} xodim · <span className="money">{formatTiyin(g.soliqTiyin)}</span>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3 rounded-(--radius-control) bg-(--color-surface-muted) px-3 py-2.5 text-sm">
                  {m.confirmed ? (
                    <span>
                      <Badge tone="income">tasdiqlangan</Badge> {m.confirmed.count} xodim · <span className="money">{formatTiyin(m.confirmed.totalTiyin)}</span> so‘m · {formatDateTime(m.confirmed.at)} · {m.confirmed.by}
                      {m.confirmed.changed > 0 && <span className="text-(--color-warn)"> · {m.confirmed.changed} tasi keyin o‘zgargan — qayta tekshiring</span>}
                      {m.confirmed.missing > 0 && <span className="text-(--color-text-muted)"> · {m.confirmed.missing} tasi endi ro‘yxatda yo‘q</span>}
                    </span>
                  ) : (
                    <span className="text-(--color-text-muted)">Hali tasdiqlanmagan</span>
                  )}
                  {isAdmin && (
                    <span className="ml-auto flex gap-2">
                      {m.confirmed && (
                        <Button size="sm" variant="ghost" className="text-(--color-text-muted) hover:text-(--color-expense)" onClick={() => setAskCancel(true)} disabled={confirming}>
                          Tasdiqni bekor qilish
                        </Button>
                      )}
                      <Button size="sm" onClick={() => setAskConfirm(true)} disabled={!m.unconfirmed || confirming} loading={confirming && askConfirm}>
                        {m.unconfirmed ? `Mos kelganlarni «to‘g‘ri» deb tasdiqlash (${m.unconfirmed})` : 'Hammasi tasdiqlangan'}
                      </Button>
                    </span>
                  )}
                </div>
              </CardBody>
            </Card>
          )}

          {/* Bo'limchalar */}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {v.groups.map((g) => {
              const diff = big(g.diffTiyin);
              return (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => {
                    setGroup(group === g.key ? 'ALL' : g.key);
                    setPage(1);
                  }}
                  className={cn('rounded-(--radius-card) border bg-white p-4 text-left transition-colors hover:border-brand-400', group === g.key ? 'border-brand-600 ring-1 ring-brand-600' : 'border-(--color-line)')}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-heading">{g.label}</p>
                    {g.problems ? <Badge tone="expense">{g.problems} farq</Badge> : <Badge tone="income">mos</Badge>}
                  </div>
                  <p className="mt-0.5 text-[11px] text-(--color-text-muted)">{g.rule} · {g.employees} xodim</p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                    <dt className="text-(--color-text-muted)">Soliq hisoboti</dt>
                    <dd className="money text-right">{formatTiyin(g.fotTiyin)}</dd>
                    {isCenter && (
                      <>
                        <dt className="text-(--color-text-muted)">Ish haqi tarkibi</dt>
                        <dd className={cn('money text-right', (() => { const d = big(g.tarkibTiyin) - big(g.fotTiyin); const t = tol * BigInt(Math.max(1, g.employees)); return d > t || d < -t; })() && 'text-(--color-warn)')}>{formatTiyin(g.tarkibTiyin ?? '0')}</dd>
                      </>
                    )}
                    <dt className="text-(--color-text-muted)">Kutilgan (qo‘lga)</dt>
                    <dd className="money text-right">{formatTiyin(g.expectedTiyin)}</dd>
                    <dt className="text-(--color-text-muted)">23106</dt>
                    <dd className="money text-right">{formatTiyin(g.bankTiyin)}</dd>
                    <dt className="text-(--color-text-muted)">Farq</dt>
                    <dd className={cn('money text-right font-semibold', diff === 0n ? 'text-(--color-income)' : diff < 0n ? 'text-(--color-expense)' : 'text-(--color-warn)')}>
                      {diff > 0n ? '+' : ''}
                      {formatTiyin(g.diffTiyin)}
                    </dd>
                  </dl>
                </button>
              );
            })}
          </div>

          {!isCenter && v.regions.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader title="Hududlar kesimida" description="Kutilgan (soliq hisobotidan) va 23106 dan to‘langan" />
              <div className="max-h-80 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-(--color-surface-muted) text-[11px] uppercase tracking-wide text-(--color-text-muted)">
                    <tr>
                      <th className="px-5 py-2 text-left font-semibold">Hudud</th>
                      <th className="w-24 px-2 py-2 text-right font-semibold">Xodim</th>
                      <th className="w-24 px-2 py-2 text-right font-semibold">Farqli</th>
                      <th className="w-40 px-2 py-2 text-right font-semibold">Kutilgan</th>
                      <th className="w-40 px-2 py-2 text-right font-semibold">23106</th>
                      <th className="w-40 px-5 py-2 text-right font-semibold">Farq</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.regions.map((x) => (
                      <tr key={x.name} className="border-t border-(--color-line)">
                        <td className="px-5 py-1.5 font-medium">
                          <button
                            type="button"
                            className="hover:text-brand-700 hover:underline"
                            onClick={() => {
                              setQ(x.name);
                              setPage(1);
                            }}
                          >
                            {x.name}
                          </button>
                        </td>
                        <td className="money px-2 py-1.5 text-right">{x.employees}</td>
                        <td className={cn('money px-2 py-1.5 text-right', x.problems && 'text-(--color-expense)')}>{x.problems}</td>
                        <td className="money px-2 py-1.5 text-right">{formatTiyin(x.expectedTiyin)}</td>
                        <td className="money px-2 py-1.5 text-right">{formatTiyin(x.bankTiyin)}</td>
                        <td className={cn('money px-5 py-1.5 text-right', big(x.diffTiyin) < 0n ? 'text-(--color-expense)' : big(x.diffTiyin) > 0n ? 'text-(--color-warn)' : 'text-(--color-income)')}>{formatTiyin(x.diffTiyin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Xodimlar */}
          <Card className="overflow-hidden">
            <CardHeader
              title={group === 'ALL' ? `Xodimlar — ${isCenter ? 'Markaz' : 'Hududlar'}` : (v.groups.find((g) => g.key === group)?.label ?? 'Xodimlar')}
              description={`${shown.length} ta${s.unknownType ? ` · ${s.unknownType} xodimning turi (shtat/shartnoma) bazada yo‘q — shtat deb olindi` : ''}`}
            />
            <div className="flex flex-wrap items-center gap-2 border-b border-(--color-line) px-5 py-2.5">
              {chips.map((k) => (
                <Chip
                  key={k}
                  active={state === k}
                  onClick={() => {
                    setState(k);
                    setPage(1);
                  }}
                >
                  {chipLabel(k)} <span className="money opacity-70">{counts(k)}</span>
                </Chip>
              ))}
              {isAdmin && isCenter && strong.length > 0 && (
                <Button size="sm" variant="secondary" onClick={() => setPicked(new Set(strong.map((r) => r.pinfl)))}>
                  Ishonchli tavsiyalarni belgilash ({strong.length})
                </Button>
              )}
              {group !== 'ALL' && (
                <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => setGroup('ALL')}>
                  barcha bo‘limchalar
                </button>
              )}
              <label className="relative ml-auto">
                <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-(--color-text-faint)" />
                <input
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                  }}
                  placeholder={isCenter ? 'F.I.Sh., PINFL, bo‘lim' : 'F.I.Sh., PINFL, hudud'}
                  className="h-8 w-56 rounded-(--radius-control) border border-(--color-line-strong) bg-white pr-3 pl-8 text-sm focus:border-brand-600 focus:outline-none"
                />
              </label>
            </div>
            <div className="max-h-[720px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-[1] bg-(--color-surface-muted) text-[11px] uppercase tracking-wide text-(--color-text-muted)">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Xodim</th>
                    <th className="w-36 px-2 py-2 text-right font-semibold" title="Soliq hisobotidagi «hisobot davrida hisoblangan» summa — hisob shu summadan">Soliq hisoboti</th>
                    {isCenter && <th className="w-32 px-2 py-2 text-right font-semibold">Ish haqi tarkibi</th>}
                    <th className="w-28 px-2 py-2 text-right font-semibold">Soliq {st.taxPct}%</th>
                    <th className="w-28 px-2 py-2 text-right font-semibold">Kasaba</th>
                    <th className="w-32 px-2 py-2 text-right font-semibold">Kutilgan</th>
                    <th className="w-52 px-2 py-2 text-right font-semibold">23106</th>
                    <th className="w-32 px-2 py-2 text-right font-semibold">Farq</th>
                    <th className="w-64 px-3 py-2 text-left font-semibold">Holat</th>
                  </tr>
                </thead>
                <tbody>
                  {slice.map((r) => (
                    <PersonRows
                      key={r.pinfl}
                      r={r}
                      isCenter={isCenter}
                      tol={tol}
                      canAct={isAdmin}
                      colCount={colCount}
                      choice={choices[r.pinfl]}
                      onChoice={(patch) => setChoices((c) => ({ ...c, [r.pinfl]: { code: c[r.pinfl]?.code ?? '', amount: c[r.pinfl]?.amount ?? '', ...patch } }))}
                      picked={picked.has(r.pinfl) && ready(r)}
                      onPick={() =>
                        setPicked((p) => {
                          const n = new Set(p);
                          if (n.has(r.pinfl)) n.delete(r.pinfl);
                          else n.add(r.pinfl);
                          return n;
                        })
                      }
                      ready={ready(r)}
                      busy={busy === r.pinfl}
                      disabled={saving}
                      byCategory={byCategory}
                      onAllocate={() => void allocate([r], r.pinfl)}
                    />
                  ))}
                  {!slice.length && (
                    <tr>
                      <td colSpan={colCount} className="py-6 text-center text-sm text-(--color-text-muted)">
                        {state === 'PROBLEM' ? 'Farq yo‘q — hammasi qoidaga mos' : 'Bu tanlovda xodim yo‘q'}
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
            {isAdmin && isCenter && fixRows.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 border-t border-(--color-line) bg-(--color-surface-muted) px-5 py-3">
                <span className="text-sm text-(--color-text-muted)">
                  Tarkib farqi: <b className="text-heading">{fixRows.length}</b> xodim · belgilangan <b className="text-heading">{chosen.length}</b> · <span className="money font-semibold text-heading">{formatTiyin(chosenTotal.toString())}</span> so‘m
                </span>
                <Button className="ml-auto" onClick={() => setAskAllocate(true)} disabled={!chosen.length} loading={saving}>
                  Belgilanganlarni yo‘naltirish
                </Button>
              </div>
            )}
          </Card>
        </>
      )}

      <ConfirmDialog
        open={askAllocate}
        title="Tarkib farqini yo‘naltirish"
        message={`${chosen.length} xodim farqi (${formatTiyin(chosenTotal.toString())} so'm) tanlangan komponentlarga qo'shiladi: ${[...new Set(chosen.map((r) => components.find((c) => c.code === choices[r.pinfl]?.code)?.name ?? choices[r.pinfl]?.code))].join(', ')}. Tarkib soliq hisobotiga tenglashadi; har birini «Ish haqi tarkibi» sahifasida bekor qilish mumkin.`}
        confirmLabel="Yo‘naltirish"
        loading={saving}
        onConfirm={() => void allocate(chosen)}
        onCancel={() => setAskAllocate(false)}
      />
      <ConfirmDialog
        open={askConfirm}
        title="«To‘g‘ri» deb tasdiqlash"
        message={`${m?.unconfirmed ?? 0} xodim (${isCenter ? 'tarkib = soliq hisoboti' : '23106 = kutilgan'}) shu oy uchun to'g'ri deb tasdiqlanadi. Keyin summalari o'zgarsa — «o'zgargan» deb ko'rsatiladi.`}
        confirmLabel="Tasdiqlash"
        loading={confirming}
        onConfirm={() => void doConfirm()}
        onCancel={() => setAskConfirm(false)}
      />
      <ConfirmDialog
        open={askCancel}
        title="Tasdiqni bekor qilish"
        message={`${isCenter ? 'Markaz' : 'Hududlar'} tablosining shu oy tasdig'i bekor qilinadi (${m?.confirmed?.count ?? 0} xodim).`}
        confirmLabel="Bekor qilish"
        danger
        loading={confirming}
        onConfirm={() => void doCancel()}
        onCancel={() => setAskCancel(false)}
      />
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </>
  );
}

function PersonRows({
  r,
  isCenter,
  tol,
  canAct,
  colCount,
  choice,
  onChoice,
  picked,
  onPick,
  ready,
  busy,
  disabled,
  byCategory,
  onAllocate,
}: {
  r: SolRow;
  isCenter: boolean;
  tol: bigint;
  canAct: boolean;
  colCount: number;
  choice: Choice | undefined;
  onChoice: (patch: Partial<Choice>) => void;
  picked: boolean;
  onPick: () => void;
  ready: boolean;
  busy: boolean;
  disabled: boolean;
  byCategory: [string, { code: string; name: string }[]][];
  onAllocate: () => void;
}) {
  const st = STATE[r.state];
  const diff = r.diffTiyin === null || r.diffTiyin === undefined ? null : big(r.diffTiyin);
  const dash = <span className="text-(--color-text-faint)">—</span>;
  const fix = r.tarkibFix ?? null;
  const tsd = big(r.tarkibSoliqDiffTiyin);
  const tarkibDiffers = tsd > tol || tsd < -tol;
  const amountOk = choice ? Boolean(parseSum(choice.amount)) : false;
  return (
    <>
      <tr className={cn('border-t border-(--color-line) align-top', r.state === 'LESS' || r.state === 'NO_BANK' ? 'bg-(--color-expense-soft)/20' : r.state === 'MORE' || r.state === 'NO_FOT' ? 'bg-(--color-warn-soft)/30' : '')}>
        <td className="px-3 py-2">
          <span className="block font-medium text-heading">{r.fullName}</span>
          <span className="flex flex-wrap items-center gap-1 text-[11px] text-(--color-text-muted)">
            <span className="money">{r.pinfl}</span>
            {(r.typeKnown || r.fotTiyin !== null) && (
              <span title={r.typeKnown ? undefined : "Turi bazada yo'q — shtat deb olindi"}>
                <Badge tone={r.employmentType === 'SHTAT' ? 'brand' : 'neutral'} className="px-1.5 py-0 text-[10px]">
                  {r.employmentType === 'SHTAT' ? 'shtat' : 'shartnoma'}
                  {!r.typeKnown ? '?' : ''}
                </Badge>
              </span>
            )}
            <span>· {r.unitLabel ?? r.regionName ?? 'joyi noma’lum'}</span>
          </span>
          {isCenter && (r.categories?.length ?? 0) > 0 && (
            <span className="mt-0.5 block text-[10px] text-(--color-text-faint)">{r.categories!.map((c) => `${c.label.toLowerCase()} ${formatTiyin(c.tiyin)}`).join(' · ')}</span>
          )}
        </td>
        <td className="money px-2 py-2 text-right font-medium">
          {r.fotTiyin === null ? dash : formatTiyin(r.fotTiyin)}
          {r.unit && r.fotTiyin !== null && <span className="block text-[10px] font-normal text-(--color-text-faint)">bo‘lim ish haqidan</span>}
        </td>
        {isCenter && (
          <td className="money px-2 py-2 text-right">
            {r.tarkibTiyin === null ? (
              <span className="text-[11px] text-(--color-text-faint)">ish haqi tarkibida yo‘q</span>
            ) : (
              <span className={tarkibDiffers ? 'text-(--color-warn)' : 'text-(--color-text-muted)'}>{formatTiyin(r.tarkibTiyin)}</span>
            )}
            {tarkibDiffers && (
              <span className="block text-[10px] text-(--color-warn)">
                {tsd > 0n ? 'kam ' : 'ortiq '}
                {formatTiyin((tsd > 0n ? tsd : -tsd).toString())}
              </span>
            )}
          </td>
        )}
        <td className="money px-2 py-2 text-right text-(--color-text-muted)">{r.taxTiyin === null ? dash : formatTiyin(r.taxTiyin)}</td>
        <td className="money px-2 py-2 text-right text-(--color-text-muted)">{r.unionTiyin === null ? dash : r.unionTiyin === '0' ? <span className="text-(--color-text-faint)">ushlanmaydi</span> : formatTiyin(r.unionTiyin)}</td>
        <td className="money px-2 py-2 text-right font-medium text-heading">{r.expectedTiyin === null ? dash : formatTiyin(r.expectedTiyin)}</td>
        <td className="px-2 py-2 text-right">
          <span className="money font-medium text-heading">{r.bank.length ? formatTiyin(r.bankTiyin) : dash}</span>
          {r.bank.length > 0 && (
            <span className="block text-[10px] text-(--color-text-muted)" title={r.bank.map((b) => `${b.label}: ${b.dates.map(formatDate).join(', ')}`).join(' · ')}>
              {r.bank.map((b) => `${b.label.toLowerCase()} ${formatTiyin(b.netTiyin)}${b.count > 1 ? ` (${b.count} ta)` : ''}`).join(' · ')}
            </span>
          )}
        </td>
        <td className={cn('money px-2 py-2 text-right font-semibold', diff === null ? '' : r.state === 'OK' ? 'text-(--color-income)' : diff < 0n ? 'text-(--color-expense)' : 'text-(--color-warn)')}>
          {diff === null ? dash : `${diff > 0n ? '+' : ''}${formatTiyin(r.diffTiyin!)}`}
        </td>
        <td className="px-3 py-2">
          <span className="flex flex-wrap items-center gap-1">
            <Badge tone={st.tone}>{st.label}</Badge>
            {r.confirm === 'CONFIRMED' && <Badge tone="income">✓ tasdiqlangan</Badge>}
            {r.confirm === 'CHANGED' && (
              <span title="Tasdiqdan keyin soliq hisoboti, tarkib yoki 23106 summasi o'zgargan">
                <Badge tone="warn">tasdiqdan keyin o‘zgargan</Badge>
              </span>
            )}
          </span>
          {r.hint && <p className="mt-0.5 text-[11px] leading-snug text-(--color-text-muted)">{r.hint}</p>}
        </td>
      </tr>
      {isCenter && fix && (fix.canAllocate || fix.adjustments.length > 0) && (
        <tr className="bg-(--color-surface-muted)/60">
          <td colSpan={colCount} className="px-3 pt-1 pb-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {fix.canAllocate && canAct && <input type="checkbox" aria-label="Yo'naltirishga belgilash" className="size-4 accent-brand-600" disabled={!ready} checked={picked} onChange={onPick} />}
              {fix.canAllocate ? (
                <>
                  <span className="text-(--color-text-muted)">
                    Tarkib soliq hisobotidan <b className={big(fix.diffTiyin) > 0n ? 'text-(--color-expense)' : 'text-(--color-warn)'}>{big(fix.diffTiyin) > 0n ? 'kam' : 'ortiq'} {formatTiyin((big(fix.diffTiyin) < 0n ? -big(fix.diffTiyin) : big(fix.diffTiyin)).toString())}</b> → qayerga:
                  </span>
                  {canAct ? (
                    <>
                      <select
                        aria-label="Komponent"
                        value={choice?.code ?? ''}
                        onChange={(e) => onChoice({ code: e.target.value })}
                        className={cn('h-8 max-w-[14rem] rounded-(--radius-control) border bg-white px-2 text-xs focus:border-brand-600 focus:outline-none', choice?.code ? 'border-(--color-line-strong)' : 'border-brand-600')}
                      >
                        <option value="">Kategoriya / komponentni tanlang…</option>
                        {byCategory.map(([label, list]) => (
                          <optgroup key={label} label={label}>
                            {list.map((x) => (
                              <option key={x.code} value={x.code}>
                                {x.name}
                                {fix.suggestion?.componentCode === x.code ? ' — tavsiya' : ''}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <input
                        aria-label="Summa (so'm)"
                        value={choice?.amount ?? ''}
                        onChange={(e) => onChoice({ amount: e.target.value })}
                        inputMode="decimal"
                        className={cn('money h-8 w-32 rounded-(--radius-control) border bg-white px-2 text-right text-xs focus:border-brand-600 focus:outline-none', amountOk ? 'border-(--color-line-strong)' : 'border-(--color-expense)')}
                      />
                      <Button size="sm" disabled={!ready || disabled} loading={busy} onClick={onAllocate}>
                        Yo‘naltirish
                      </Button>
                    </>
                  ) : null}
                  {fix.suggestion ? (
                    <span className={fix.suggestion.confidence === 'STRONG' ? 'text-(--color-income)' : 'text-(--color-warn)'}>
                      {fix.suggestion.confidence === 'STRONG' ? 'Ishonchli tavsiya' : 'Taxminiy tavsiya'}: «{fix.suggestion.componentName}» — {fix.suggestion.reason}
                    </span>
                  ) : (
                    <span className="text-(--color-text-muted)">{big(fix.diffTiyin) < 0n ? 'Tarkibda ortiqcha — qaysi komponentdan ayirishni tanlang (manfiy summa)' : '23106 da mos to‘lov topilmadi — kategoriyani o‘zingiz tanlang'}</span>
                  )}
                </>
              ) : null}
              {fix.adjustments.length > 0 && (
                <span className="text-(--color-income)">
                  yo‘naltirilgan: {fix.adjustments.map((a) => `${a.componentName} ${big(a.amountTiyin) > 0n ? '+' : ''}${formatTiyin(a.amountTiyin)}`).join(', ')}
                </span>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function CategoryBars({ cats }: { cats: { category: string; label: string; tiyin: string }[] }) {
  const total = cats.reduce((x, c) => x + (big(c.tiyin) > 0n ? big(c.tiyin) : 0n), 0n);
  return (
    <div className="space-y-1.5">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-(--color-surface-sunken)">
        {cats
          .filter((c) => big(c.tiyin) > 0n)
          .map((c, i) => (
            <span key={c.category} title={`${c.label}: ${formatTiyin(c.tiyin)}`} className={cn('h-full', ['bg-brand-600', 'bg-brand-400', 'bg-(--color-income)', 'bg-(--color-warn)', 'bg-brand-300', 'bg-brand-800'][i % 6])} style={{ width: `${total ? Number((big(c.tiyin) * 10000n) / total) / 100 : 0}%` }} />
          ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {cats.map((c, i) => (
          <span key={c.category} className="flex items-center gap-1.5">
            <span className={cn('size-2 rounded-full', big(c.tiyin) > 0n ? ['bg-brand-600', 'bg-brand-400', 'bg-(--color-income)', 'bg-(--color-warn)', 'bg-brand-300', 'bg-brand-800'][i % 6] : 'bg-(--color-expense)')} />
            <span className="text-(--color-text-muted)">{c.label}</span>
            <span className="money font-medium text-heading">{formatTiyin(c.tiyin)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Rule({ title, formula, example }: { title: string; formula: string; example: string }) {
  return (
    <div className="rounded-(--radius-control) border border-(--color-line) px-3 py-2.5">
      <p className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">{title}</p>
      <p className="mt-1 font-semibold text-heading">{formula}</p>
      <p className="money mt-0.5 text-xs text-(--color-text-muted)">Masalan: {example}</p>
    </div>
  );
}

function Source({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1', ok ? 'border-(--color-line) bg-white' : 'border-(--color-warn) bg-(--color-warn-soft)')}>
      <span className={cn('size-2 rounded-full', ok ? 'bg-(--color-income)' : 'bg-(--color-warn)')} />
      <span className="font-medium text-heading">{label}</span>
      <span className="text-(--color-text-muted)">{ok ? 'yuklangan' : 'yuklanmagan'}</span>
    </span>
  );
}

function ModeBtn({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button type="button" title={title} onClick={onClick} className={cn('rounded-full px-3 py-1 font-medium', active ? 'bg-brand-600 text-white' : 'text-(--color-text-muted) hover:text-heading')}>
      {children}
    </button>
  );
}

function Num({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-(--color-text-muted)">
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" className="money h-8 w-36 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-right text-sm text-heading focus:border-brand-600 focus:outline-none" />
    </label>
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

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn('rounded-full border px-3 py-1 text-xs font-medium', active ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-(--color-line) bg-white text-(--color-text-muted) hover:text-heading')}>
      {children}
    </button>
  );
}
