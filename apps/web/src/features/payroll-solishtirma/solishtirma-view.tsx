'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { IconSearch } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatTiyin } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';
import { solishtirmaApi, type BankMonthMode, type FotMode, type GroupKey, type SolishtirmaSettings, type SolRow, type SolState } from './api';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › Ish haqi solishtirma: FOT − daromad solig'i − kasaba uyushmasi (faqat shtat) = 23106.
// Bo'limchalar: Markaz shtat / shartnoma, Hududlar shtat / shartnoma, yo'nalishlar — har biri o'z qoidasi bilan.
// Farq chiqqan har xodimga — sabab taxmini (kasaba ushlanmagan, qoldiq boshqa oyda …).
// ═══════════════════════════════════════════════════════════

const STATE: Record<SolState, { label: string; tone: 'income' | 'expense' | 'warn' | 'neutral' }> = {
  OK: { label: 'Mos', tone: 'income' },
  LESS: { label: 'Bankdan kam', tone: 'expense' },
  MORE: { label: "Bankdan ko'p", tone: 'warn' },
  NO_BANK: { label: "23106 da yo'q", tone: 'expense' },
  NO_FOT: { label: "FOT'da yo'q", tone: 'warn' },
};

type StateFilter = 'PROBLEM' | SolState | 'ALL';
const PAGE = 100;

export function SolishtirmaView() {
  const { isAdmin } = useAuth();
  const { month: period } = usePeriod();
  const [mode, setMode] = useState<BankMonthMode>('ACCRUAL');
  const [fotMode, setFotMode] = useState<FotMode>('TARKIB');
  const data = useAsync(() => solishtirmaApi.view(period, mode, fotMode).then((r) => r.data), [period, mode, fotMode]);
  const v = data.data;
  const [group, setGroup] = useState<GroupKey | 'ALL'>('ALL');
  const [state, setState] = useState<StateFilter>('PROBLEM');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{ taxPct: string; unionPct: string; toleranceSum: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  const shown = useMemo(() => {
    if (!v) return [];
    const t = q.trim().toLowerCase();
    return v.rows.filter((r) => {
      if (group !== 'ALL' && r.group !== group) return false;
      if (state === 'PROBLEM' && r.state === 'OK') return false;
      if (state !== 'PROBLEM' && state !== 'ALL' && r.state !== state) return false;
      return !t || r.fullName.toLowerCase().includes(t) || r.pinfl.includes(t) || (r.regionName ?? '').toLowerCase().includes(t);
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

  if (data.loading && !v) return <Card><LoadingState /></Card>;
  if (data.error) return <Card><ErrorState message={data.error} onRetry={data.reload} /></Card>;
  if (!v) return null;
  const st = v.settings;
  const s = v.summary;
  const problems = s.less + s.more + s.noBank + s.noFot;
  const stateCounts = (k: StateFilter) => {
    const list = group === 'ALL' ? v.rows : v.rows.filter((r) => r.group === group);
    return k === 'ALL' ? list.length : k === 'PROBLEM' ? list.filter((r) => r.state !== 'OK').length : list.filter((r) => r.state === k).length;
  };

  return (
    <>
      {/* Qoida va sozlamalar */}
      <Card>
        <CardHeader
          title={`Ish haqi solishtirma · ${v.label}`}
          description="Har xodim: ish haqi fondi (FOT) − daromad solig‘i − kasaba uyushmasi (faqat asosiy shtat) = 23106 dan qo‘lga to‘langan summa"
        />
        <CardBody className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Rule title="Asosiy shtat (Markaz va hududlar)" formula={`FOT − ${st.taxPct}% soliq − ${st.unionPct}% kasaba = 23106`} example={`10 000 000 − ${formatTiyin(String(Math.round(10_000_000 * st.taxPct)))} − ${formatTiyin(String(Math.round(10_000_000 * st.unionPct)))} = ${formatTiyin(String(Math.round(10_000_000 * (100 - st.taxPct - st.unionPct))))}`} />
            <Rule title="Shartnoma asosida" formula={`FOT − ${st.taxPct}% soliq = 23106`} example={`10 000 000 − ${formatTiyin(String(Math.round(10_000_000 * st.taxPct)))} = ${formatTiyin(String(Math.round(10_000_000 * (100 - st.taxPct))))}`} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Source ok={v.sources.tarkib} label="Ish haqi tarkibi" />
            <Source ok={v.sources.soliq} label="Soliq hisoboti" />
            <Source ok={v.sources.bank} label="23106 ko‘chirmasi" />
            <span className="ml-auto flex items-center gap-1 rounded-full border border-(--color-line) bg-white p-0.5">
              <span className="pl-2 text-(--color-text-muted)">FOT:</span>
              <ModeBtn active={fotMode === 'TARKIB'} onClick={() => setFotMode('TARKIB')} title="FOT — ish haqi tarkibidagi jami (tarkib bo‘lmasa — soliq hisobotidagi summa)">
                Ish haqi tarkibi
              </ModeBtn>
              <ModeBtn active={fotMode === 'SOLIQ'} onClick={() => setFotMode('SOLIQ')} title="FOT — soliq hisobotidagi «hisobot davrida hisoblangan» summa (bo‘lmasa — tarkib)">
                Soliq hisoboti
              </ModeBtn>
            </span>
            <span className="flex items-center gap-1 rounded-full border border-(--color-line) bg-white p-0.5">
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

      {!v.rows.length ? (
        <Card>
          <EmptyState title={`${v.label}: solishtirish uchun ma'lumot yo'q`} description="Shu oy ish haqi tarkibi yoki soliq hisobotini va 23106 ko‘chirmasini yuklang" />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Box label="Mos" value={String(s.ok)} sub={`${s.employees} xodimdan`} tone="income" />
            <Box label="Bankdan kam" value={String(s.less)} sub="23106 kutilganidan kam" tone={s.less ? 'expense' : 'neutral'} />
            <Box label="Bankdan ko‘p" value={String(s.more)} sub="23106 kutilganidan ko‘p" tone={s.more ? 'warn' : 'neutral'} />
            <Box label="23106 da yo‘q" value={String(s.noBank)} sub="FOT bor, to‘lov topilmadi" tone={s.noBank ? 'expense' : 'neutral'} />
            <Box label="FOT’da yo‘q" value={String(s.noFot)} sub="to‘lov bor, FOT yo‘q" tone={s.noFot ? 'warn' : 'neutral'} />
          </div>

          {/* Bo'limchalar */}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {v.groups.map((g) => {
              const diff = BigInt(g.diffTiyin);
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
                    <dt className="text-(--color-text-muted)">FOT ({v.fotMode === 'TARKIB' ? 'tarkib' : 'soliq hisoboti'})</dt>
                    <dd className="money text-right">{formatTiyin(g.fotTiyin)}</dd>
                    <dt className="text-(--color-text-muted)">{v.fotMode === 'TARKIB' ? 'Soliq hisobotida' : 'Tarkibda'}</dt>
                    <dd className={cn('money text-right', (() => { const d = BigInt(v.fotMode === 'TARKIB' ? g.soliqTiyin : g.tarkibTiyin) - BigInt(g.fotTiyin); const t = BigInt(Math.round(st.toleranceSum * 100)) * BigInt(g.employees); return d > t || d < -t; })() && 'text-(--color-warn)')}>{formatTiyin(v.fotMode === 'TARKIB' ? g.soliqTiyin : g.tarkibTiyin)}</dd>
                    <dt className="text-(--color-text-muted)">Kutilgan (qo‘lga)</dt>
                    <dd className="money text-right">{formatTiyin(g.expectedTiyin)}</dd>
                    <dt className="text-(--color-text-muted)">23106</dt>
                    <dd className="money text-right">{formatTiyin(g.bankTiyin)}</dd>
                    <dt className="text-(--color-text-muted)">Farq</dt>
                    <dd className={cn('money text-right font-semibold', diff === 0n ? 'text-(--color-income)' : diff < 0n ? 'text-(--color-expense)' : 'text-(--color-warn)')}>{diff > 0n ? '+' : ''}{formatTiyin(g.diffTiyin)}</dd>
                  </dl>
                </button>
              );
            })}
          </div>

          {v.regions.length > 0 && (group === 'ALL' || group === 'REGION_SHTAT' || group === 'REGION_SHARTNOMA') && (
            <Card className="overflow-hidden">
              <CardHeader title="Hududlar kesimida" description="Hudud xodimlari (shtat va shartnoma): kutilgan va 23106 dan to‘langan" />
              <div className="max-h-72 overflow-auto">
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
                          <button type="button" className="hover:text-brand-700 hover:underline" onClick={() => { setQ(x.name); setPage(1); }}>
                            {x.name}
                          </button>
                        </td>
                        <td className="money px-2 py-1.5 text-right">{x.employees}</td>
                        <td className={cn('money px-2 py-1.5 text-right', x.problems && 'text-(--color-expense)')}>{x.problems}</td>
                        <td className="money px-2 py-1.5 text-right">{formatTiyin(x.expectedTiyin)}</td>
                        <td className="money px-2 py-1.5 text-right">{formatTiyin(x.bankTiyin)}</td>
                        <td className={cn('money px-5 py-1.5 text-right', BigInt(x.diffTiyin) < 0n ? 'text-(--color-expense)' : BigInt(x.diffTiyin) > 0n ? 'text-(--color-warn)' : 'text-(--color-income)')}>{formatTiyin(x.diffTiyin)}</td>
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
              title={group === 'ALL' ? 'Xodimlar' : (v.groups.find((g) => g.key === group)?.label ?? 'Xodimlar')}
              description={`${shown.length} ta${s.tarkibSoliqDiff ? ` · ${s.tarkibSoliqDiff} xodimda tarkib soliq hisobotidan farq qiladi` : ''}${s.unknownType ? ` · ${s.unknownType} xodimning turi (shtat/shartnoma) bazada yo‘q — shtat deb olindi` : ''}`}
            />
            <div className="flex flex-wrap items-center gap-2 border-b border-(--color-line) px-5 py-2.5">
              {(['PROBLEM', 'LESS', 'MORE', 'NO_BANK', 'NO_FOT', 'OK', 'ALL'] as StateFilter[]).map((k) => (
                <Chip
                  key={k}
                  active={state === k}
                  onClick={() => {
                    setState(k);
                    setPage(1);
                  }}
                >
                  {k === 'PROBLEM' ? 'Farq chiqqanlar' : k === 'ALL' ? 'Hammasi' : STATE[k].label} <span className="money opacity-70">{stateCounts(k)}</span>
                </Chip>
              ))}
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
                  placeholder="F.I.Sh., PINFL, hudud"
                  className="h-8 w-56 rounded-(--radius-control) border border-(--color-line-strong) bg-white pr-3 pl-8 text-sm focus:border-brand-600 focus:outline-none"
                />
              </label>
            </div>
            <div className="max-h-[680px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-[1] bg-(--color-surface-muted) text-[11px] uppercase tracking-wide text-(--color-text-muted)">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Xodim</th>
                    <th className="w-32 px-2 py-2 text-right font-semibold">FOT ({v.fotMode === 'TARKIB' ? 'tarkib' : 'soliq'})</th>
                    <th className="w-32 px-2 py-2 text-right font-semibold">{v.fotMode === 'TARKIB' ? 'Soliq hisoboti' : 'Tarkib'}</th>
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
                    <PersonRow key={r.pinfl} r={r} fotMode={v.fotMode} tol={BigInt(Math.round(st.toleranceSum * 100))} />
                  ))}
                  {!slice.length && (
                    <tr>
                      <td colSpan={9} className="py-6 text-center text-sm text-(--color-text-muted)">
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
          </Card>
          {problems === 0 && <p className="text-center text-xs text-(--color-income)">Hamma xodimda FOT − ushlanmalar = 23106 ✓</p>}
        </>
      )}
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </>
  );
}

function PersonRow({ r, fotMode, tol }: { r: SolRow; fotMode: FotMode; tol: bigint }) {
  const st = STATE[r.state];
  const diff = r.diffTiyin === null ? null : BigInt(r.diffTiyin);
  const dash = <span className="text-(--color-text-faint)">—</span>;
  return (
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
      </td>
      <td className="money px-2 py-2 text-right">
        {r.fotTiyin === null ? dash : formatTiyin(r.fotTiyin)}
        {r.fotSource && <span className="block text-[10px] text-(--color-text-faint)">{r.fotSource === 'TARKIB' ? 'tarkibdan' : r.unit ? 'bo‘lim ish haqidan' : 'soliq hisobotidan'}</span>}
      </td>
      <td className="money px-2 py-2 text-right">
        {(() => {
          const other = fotMode === 'TARKIB' ? r.soliqTiyin : r.tarkibTiyin;
          if (other === null) return <span className="text-[11px] text-(--color-text-faint)">{fotMode === 'TARKIB' ? 'yo‘q' : 'tarkib yo‘q'}</span>;
          // Ko'rsatilgan ustun − FOT: tarkib rejimida (soliq − tarkib), soliq rejimida (tarkib − soliq)
          const raw = r.tarkibSoliqDiffTiyin === null ? 0n : BigInt(r.tarkibSoliqDiffTiyin);
          const d = fotMode === 'TARKIB' ? raw : -raw;
          const differs = d > tol || d < -tol;
          return (
            <>
              <span className={differs ? 'text-(--color-warn)' : 'text-(--color-text-muted)'}>{formatTiyin(other)}</span>
              {differs && <span className="block text-[10px] text-(--color-warn)">{fotMode === 'TARKIB' ? 'tarkibdan' : 'soliqdan'} {d > 0n ? '+' : ''}{formatTiyin(d.toString())}</span>}
            </>
          );
        })()}
      </td>
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
        <Badge tone={st.tone}>{st.label}</Badge>
        {r.hint && <p className="mt-0.5 text-[11px] leading-snug text-(--color-text-muted)">{r.hint}</p>}
      </td>
    </tr>
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
