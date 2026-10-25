'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { IconAlert, IconDownload, IconSearch, IconSpinner } from '@/components/ui/icons';
import { Money } from '@/components/ui/money';
import { Table, TBody, Td, TFoot, Th, THead, Tr } from '@/components/ui/table';
import { errorMessage } from '@/lib/error-message';
import { formatTiyin } from '@/lib/format';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { downloadMissing } from './api';
import { PAYROLL_UNITS, planApi, targetLabel, type PlanAnalysis, type PlanInputRow, type PlanRow, type PlanSummary, type PlanTarget } from './plan-api';

// ═══════════════════════════════════════════════════════════
// Umumiy vedomost tahlili — bo'limlar bilan birga:
//  • bo'limlarga avval yuklanganlar — olinmaydi (ogohlantirish);
//  • bo'lim xodimlari — o'z bo'limiga avtomatik;
//  • har xodimning bo'limini o'zgartirish yoki olib tashlash; jamilar darhol qayta hisoblanadi.
// ═══════════════════════════════════════════════════════════

type Filter = 'ALL' | 'GENERAL' | 'UNITS' | 'SKIP' | 'LOCKED' | 'CHANGED' | 'PROBLEM';
const PAGE = 100;
const TARGETS: PlanTarget[] = ['GENERAL', ...PAYROLL_UNITS.map((u) => u.code), 'SKIP'];
const unitSlug = (code: string) => PAYROLL_UNITS.find((u) => u.code === code)?.slug ?? '';

export function PlanView({
  analysis,
  period,
  replacePrevious,
  onReplaceChange,
  onSave,
  onCancel,
  saving,
  onError,
}: {
  analysis: PlanAnalysis;
  period: string;
  replacePrevious: boolean;
  onReplaceChange: (v: boolean) => void;
  onSave: (rows: PlanInputRow[]) => void;
  onCancel: () => void;
  saving: boolean;
  onError: (message: string) => void;
}) {
  const [rows, setRows] = useState<PlanRow[]>(analysis.rows);
  const [summary, setSummary] = useState<PlanSummary>(analysis.summary);
  const [recalc, setRecalc] = useState(false);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [showLocked, setShowLocked] = useState(false);
  const dirty = useRef(false);
  const seq = useRef(0);

  const input = (list: PlanRow[]): PlanInputRow[] => list.map((r) => ({ pinfl: r.pinfl, amountTiyin: r.amountTiyin, target: r.target, fullName: r.fullName, rowIndex: r.rowIndex }));

  // O'zgarishdan keyin — serverda qayta hisoblash (umumiy qism guruhlari, muammolar)
  useEffect(() => {
    if (!dirty.current) return;
    const my = ++seq.current;
    const t = setTimeout(() => {
      setRecalc(true);
      planApi
        .preview(period, input(rows))
        .then((r) => {
          if (my !== seq.current) return;
          setSummary(r.data.summary);
          // Server taklifi va muammolari yangilanadi, tanlov va kiritilgan ism saqlanadi
          const by = new Map(r.data.rows.map((x) => [x.pinfl, x]));
          setRows((cur) => cur.map((x) => ({ ...x, ...(by.get(x.pinfl) ?? {}), fullName: x.fullName ?? by.get(x.pinfl)?.fullName ?? null })));
        })
        .catch((err) => onError(errorMessage(err, "Qayta hisoblab bo'lmadi")))
        .finally(() => my === seq.current && setRecalc(false));
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.map((r) => `${r.target}|${r.fullName ?? ''}`).join(',')]);

  const change = (pinfl: string, patch: Partial<PlanRow>) => {
    dirty.current = true;
    setRows((cur) => cur.map((r) => (r.pinfl === pinfl ? { ...r, ...patch } : r)));
  };
  const bulk = (pred: (r: PlanRow) => boolean, target: PlanTarget) => {
    dirty.current = true;
    setRows((cur) => cur.map((r) => (!r.locked && pred(r) ? { ...r, target } : r)));
  };

  const counts = useMemo(
    () => ({
      ALL: rows.length,
      GENERAL: rows.filter((r) => r.target === 'GENERAL').length,
      UNITS: rows.filter((r) => PAYROLL_UNITS.some((u) => u.code === r.target)).length,
      SKIP: rows.filter((r) => r.target === 'SKIP' && !r.locked).length,
      LOCKED: rows.filter((r) => r.locked).length,
      CHANGED: rows.filter((r) => !r.locked && r.target !== r.suggested).length,
      PROBLEM: rows.filter((r) => r.problem && !r.locked).length,
    }),
    [rows],
  );

  const shown = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const qd = q.replace(/\D/g, '');
    return rows.filter((r) => {
      if (filter === 'GENERAL' && r.target !== 'GENERAL') return false;
      if (filter === 'UNITS' && !PAYROLL_UNITS.some((u) => u.code === r.target)) return false;
      if (filter === 'SKIP' && !(r.target === 'SKIP' && !r.locked)) return false;
      if (filter === 'LOCKED' && !r.locked) return false;
      if (filter === 'CHANGED' && (r.locked || r.target === r.suggested)) return false;
      if (filter === 'PROBLEM' && !(r.problem && !r.locked)) return false;
      if (!qq) return true;
      if (qd.length >= 4 && r.pinfl.includes(qd)) return true;
      return (r.fullName ?? '').toLowerCase().includes(qq) || (r.place ?? '').toLowerCase().includes(qq);
    });
  }, [rows, filter, q]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const slice = shown.slice((page - 1) * PAGE, page * PAGE);
  useEffect(() => setPage(1), [filter, q]);

  const missing = rows.filter((r) => r.target === 'SKIP' && !r.locked && !r.inRegistry);
  const s = summary;
  const unitsUsed = s.units.filter((u) => u.count > 0);
  const nothing = s.general.count === 0 && unitsUsed.length === 0;

  return (
    <div className="space-y-4">
      {/* Yig'indi */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Box label="Faylda" value={String(s.total)} sub={formatTiyin(s.totalTiyin)} />
        <Box label="Umumiy vedomostga" value={String(s.general.count)} sub={formatTiyin(s.general.totalTiyin)} tone="income" />
        <Box label="Bo'limlarga" value={String(unitsUsed.reduce((a, u) => a + u.count, 0))} sub={formatTiyin(String(unitsUsed.reduce((a, u) => a + BigInt(u.totalTiyin), 0n)))} tone="brand" />
        <Box label="Avval yuklangan" value={String(s.locked.count)} sub={s.locked.count ? 'olinmaydi' : '—'} tone={s.locked.count ? 'warn' : 'neutral'} />
        <Box label="Olinmaydi" value={String(s.skipped.count)} sub={formatTiyin(s.skipped.totalTiyin)} tone={s.skipped.count ? 'expense' : 'neutral'} />
      </div>

      {/* Bo'limlarga avval yuklanganlar */}
      {s.locked.count > 0 && (
        <div className="rounded-(--radius-card) border border-(--color-warn) bg-(--color-warn-soft) px-4 py-3">
          <div className="flex items-start gap-2.5">
            <IconAlert className="mt-0.5 size-4 shrink-0 text-(--color-warn)" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold text-(--color-warn)">
                {s.locked.count} ta xodim shu oy bo&apos;limlarga allaqachon yuklangan — umumiy vedomostdan olinmaydi (ish haqi ikki marta sanalmasin)
              </p>
              <ul className="mt-1.5 space-y-0.5 text-(--color-text)">
                {s.locked.byUnit.map((u) => (
                  <li key={u.unit}>
                    <Link href={`/xarajatlar/bolim/${unitSlug(u.unit)}/ish-haqi`} className="font-medium text-brand-700 hover:underline">
                      {u.label}
                    </Link>
                    : {u.count} xodim · faylda <span className="money">{formatTiyin(u.fileTiyin)}</span>, bo&apos;limda yuklangan <span className="money">{formatTiyin(u.uploadedTiyin)}</span>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => setShowLocked((x) => !x)} className="mt-1 text-xs font-medium text-(--color-text-muted) hover:text-heading">
                {showLocked ? 'Yashirish' : "Ro'yxatni ko'rish"}
              </button>
              {showLocked && (
                <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                  {rows
                    .filter((r) => r.locked)
                    .map((r) => (
                      <div key={r.pinfl} className="flex items-center justify-between gap-3 rounded-(--radius-control) bg-white px-3 py-1.5 text-xs">
                        <span className="min-w-0 flex-1 truncate font-medium">{r.fullName ?? r.pinfl}</span>
                        <span className="shrink-0 text-(--color-text-muted)">{r.locked!.label}</span>
                        <span className="money w-28 shrink-0 text-right">{formatTiyin(r.amountTiyin)}</span>
                      </div>
                    ))}
                </div>
              )}
              <p className="mt-1.5 text-xs text-(--color-text-muted)">Bo&apos;limdagi yuklashni almashtirmoqchi bo&apos;lsangiz — avval o&apos;sha bo&apos;lim sahifasida bekor qiling.</p>
            </div>
          </div>
        </div>
      )}

      {/* Bo'limlarga avtomatik */}
      {unitsUsed.length > 0 && (
        <Card>
          <CardHeader title="Bo'limlarga yoziladi" description="Bo'lim xodimlari («miya» bo'yicha) — har bo'lim ish haqiga alohida yuklash bo'lib tushadi (manbasi: umumiy vedomost)" />
          <CardBody className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {unitsUsed.map((u) => (
              <div key={u.unit} className="rounded-(--radius-control) border border-(--color-line) px-3 py-2">
                <p className="text-sm font-semibold text-heading">{u.label}</p>
                <p className="money text-lg font-semibold">{formatTiyin(u.totalTiyin)}</p>
                <p className="text-xs text-(--color-text-muted)">
                  {u.count} xodim{u.zeroCount ? ` · ${u.zeroCount} tasiga hisoblanmagan` : ''}
                  {u.unnamed ? <span className="text-(--color-expense)"> · {u.unnamed} tasining F.I.Sh. yo&apos;q</span> : null}
                </p>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {/* Xodimlar va qayerga */}
      <Card className="overflow-hidden">
        <CardHeader
          title="Xodimlar va bo'limi"
          description="Bo'limini o'zgartirish yoki olib tashlash mumkin. O'zgartirilsa — xodim shu oydan yangi bo'limida turadi («miya»ga yoziladi)"
          actions={recalc ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-(--color-text-muted)">
              <IconSpinner className="size-3.5 animate-spin" />
              Hisoblanmoqda
            </span>
          ) : undefined}
        />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ['ALL', 'Hammasi'],
                ['GENERAL', 'Umumiy'],
                ['UNITS', "Bo'limlarga"],
                ['SKIP', 'Olinmaydi'],
                ['LOCKED', 'Avval yuklangan'],
                ['CHANGED', "O'zgartirilgan"],
                ['PROBLEM', 'Muammoli'],
              ] as [Filter, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={cn('rounded-full border px-3 py-1 text-xs font-medium', filter === k ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-(--color-line) bg-white text-(--color-text-muted) hover:text-heading')}
              >
                {label} <span className="money opacity-70">{counts[k]}</span>
              </button>
            ))}
            <label className="relative ml-auto">
              <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-(--color-text-faint)" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="F.I.Sh., JShShIR yoki joyi" className="h-8 w-60 rounded-(--radius-control) border border-(--color-line-strong) bg-white pr-3 pl-8 text-sm focus:border-brand-600 focus:outline-none" />
            </label>
          </div>
          {filter === 'PROBLEM' && counts.PROBLEM > 0 && (
            <div className="flex flex-wrap gap-2 text-xs">
              <Button size="sm" variant="secondary" onClick={() => bulk((r) => Boolean(r.problem), 'SKIP')}>
                Muammolilarni olib tashlash
              </Button>
            </div>
          )}
        </CardBody>
        <Table>
          <THead>
            <Tr>
              <Th>Xodim</Th>
              <Th className="w-56">Hozirgi joyi</Th>
              <Th align="right" className="w-36">
                Summa
              </Th>
              <Th className="w-60">Qayerga yoziladi</Th>
            </Tr>
          </THead>
          <TBody>
            {slice.map((r) => {
              const changed = !r.locked && r.target !== r.suggested;
              const needName = PAYROLL_UNITS.some((u) => u.code === r.target) && !r.fullName;
              return (
                <Tr key={r.pinfl} className={cn(r.locked && 'opacity-60', r.target === 'SKIP' && !r.locked && 'bg-(--color-surface-muted)')}>
                  <Td>
                    {needName ? (
                      <input
                        placeholder="F.I.Sh. kiriting"
                        onBlur={(e) => e.target.value.trim() && change(r.pinfl, { fullName: e.target.value.trim() })}
                        className="h-8 w-full rounded-(--radius-control) border border-(--color-expense) bg-white px-2 text-sm focus:outline-none"
                      />
                    ) : (
                      <span className="font-medium">{r.fullName ?? '—'}</span>
                    )}
                    <span className="money block text-xs text-(--color-text-muted)">
                      {r.pinfl}
                      {r.rowIndex ? ` · ${r.rowIndex}-qator` : ''}
                    </span>
                    {r.problem && !r.locked && <span className="block text-xs text-(--color-expense)">{r.problem}</span>}
                  </Td>
                  <Td className="text-xs text-(--color-text-muted)">
                    {r.unitNowLabel && <span className="block font-medium text-(--color-text)">{r.unitNowLabel}</span>}
                    {r.place ?? (r.inRegistry ? '' : 'Reestrda yo‘q')}
                  </Td>
                  <Td money>
                    {r.amountTiyin === '0' ? <span className="text-(--color-warn)">hisoblanmagan</span> : <Money tiyin={r.amountTiyin} tone="expense" />}
                    {r.parts && r.parts.otherTiyin !== '0' && (
                      <span className="block text-[11px] text-(--color-text-muted)" title="Soliq hisoboti: 4-ilova (oylik) + 5-ilova (boshqa daromadlar)">
                        oylik {formatTiyin(r.parts.salaryTiyin)} + boshqa {formatTiyin(r.parts.otherTiyin)}
                      </span>
                    )}
                  </Td>
                  <Td>
                    {r.locked ? (
                      <Badge tone="neutral">{r.locked.label} bo&apos;limida bor — olinmaydi</Badge>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <select
                          value={r.target}
                          onChange={(e) => change(r.pinfl, { target: e.target.value as PlanTarget })}
                          className={cn(
                            'h-8 min-w-0 flex-1 rounded-(--radius-control) border bg-white px-2 text-sm focus:outline-none',
                            changed ? 'border-brand-600 text-brand-800' : 'border-(--color-line-strong)',
                            r.target === 'SKIP' && 'text-(--color-expense)',
                          )}
                        >
                          {TARGETS.map((t) => (
                            <option key={t} value={t} disabled={t === 'GENERAL' && !r.inRegistry}>
                              {targetLabel(t)}
                              {t === r.suggested ? ' ★' : ''}
                            </option>
                          ))}
                        </select>
                        {changed && (
                          <button type="button" title="Taklifga qaytarish" onClick={() => change(r.pinfl, { target: r.suggested })} className="text-xs text-(--color-text-muted) hover:text-heading">
                            ↺
                          </button>
                        )}
                      </div>
                    )}
                  </Td>
                </Tr>
              );
            })}
            {!slice.length && (
              <Tr>
                <Td colSpan={4} className="py-6 text-center text-sm text-(--color-text-muted)">
                  Bu tanlovda xodim yo&apos;q
                </Td>
              </Tr>
            )}
          </TBody>
        </Table>
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
        <p className="border-t border-(--color-line) px-4 py-2 text-xs text-(--color-text-faint)">★ — tizim taklifi («miya» bo&apos;yicha shu oydagi bo&apos;limi). Reestrda yo&apos;q xodimni umumiy vedomostga yozib bo&apos;lmaydi — bo&apos;limni tanlang.</p>
      </Card>

      {/* Reestrda topilmaganlar va xato qatorlar */}
      {missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-(--color-text-muted)">
          <span>
            Reestrda yo&apos;q va olinmaydigan: <b className="text-(--color-expense)">{missing.length}</b>
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              void downloadMissing(
                period,
                missing.map((r) => ({ rowIndex: r.rowIndex ?? 0, pinfl: r.pinfl })),
              ).catch((err) => onError(errorMessage(err, "Faylni yuklab bo'lmadi")))
            }
          >
            <IconDownload className="size-4" />
            Excel
          </Button>
        </div>
      )}
      {analysis.invalidRows.length > 0 && (
        <p className="text-xs text-(--color-text-muted)">
          Xato qatorlar (o&apos;tkazib yuboriladi): {analysis.invalidRows.slice(0, 10).map((r) => `${r.rowIndex}-qator — ${r.reason}`).join('; ')}
          {analysis.invalidRows.length > 10 ? ' …' : ''}
        </p>
      )}
      {analysis.duplicates.length > 0 && <p className="text-xs text-(--color-text-muted)">{analysis.duplicates.length} ta xodim faylda bir necha marta uchradi — summalari qo&apos;shildi.</p>}

      {/* Oldingi yuklash */}
      {analysis.hasPrevious && (
        <div className="rounded-(--radius-card) border border-(--color-warn) bg-(--color-warn-soft) px-4 py-3">
          <p className="text-sm font-medium text-(--color-warn)">Bu oy uchun {analysis.previousCount} ta umumiy yuklash allaqachon saqlangan</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Choice checked={!replacePrevious} onChange={() => onReplaceChange(false)} title="Qo'shish" description="Eski yuklash qoladi, bu ham qo'shiladi (masalan mukofot)" />
            <Choice checked={replacePrevious} onChange={() => onReplaceChange(true)} title="Almashtirish" description="Eski umumiy yuklash va undan bo'limlarga yozilganlar bekor qilinadi, faqat bu qoladi" />
          </div>
        </div>
      )}

      {/* Shakllanadigan xarajatlar */}
      <Card className="overflow-hidden">
        <CardHeader title="Shakllanadigan xarajatlar" description="Saqlanganda shu yozuvlar yaratiladi" />
        <Table>
          <THead>
            <Tr>
              <Th>Guruh</Th>
              <Th align="center" className="w-24">
                Xodim
              </Th>
              <Th align="center" className="w-32">
                Hisoblanmagan
              </Th>
              <Th align="right" className="w-44">
                Summa
              </Th>
            </Tr>
          </THead>
          <TBody>
            {s.general.groups.map((g) => (
              <Tr key={`g-${g.label}`}>
                <Td>{g.label}</Td>
                <Td align="center" className="money text-(--color-text-muted)">
                  {g.count}
                </Td>
                <Td align="center" className="money">
                  {g.zeroCount > 0 ? <span className="text-(--color-warn)">{g.zeroCount}</span> : <span className="text-(--color-text-faint)">&mdash;</span>}
                </Td>
                <Td money>
                  <Money tiyin={g.totalTiyin} tone="expense" />
                </Td>
              </Tr>
            ))}
            {unitsUsed.map((u) => (
              <Tr key={`u-${u.unit}`}>
                <Td>
                  Ish haqi — {u.label} <span className="text-xs text-(--color-text-muted)">(bo&apos;lim)</span>
                </Td>
                <Td align="center" className="money text-(--color-text-muted)">
                  {u.count}
                </Td>
                <Td align="center" className="money">
                  {u.zeroCount > 0 ? <span className="text-(--color-warn)">{u.zeroCount}</span> : <span className="text-(--color-text-faint)">&mdash;</span>}
                </Td>
                <Td money>
                  <Money tiyin={u.totalTiyin} tone="expense" />
                </Td>
              </Tr>
            ))}
          </TBody>
          <TFoot>
            <Tr>
              <Td colSpan={3}>Jami</Td>
              <Td money>
                <Money tiyin={String(BigInt(s.general.totalTiyin) + unitsUsed.reduce((a, u) => a + BigInt(u.totalTiyin), 0n))} tone="expense" className="font-semibold" />
              </Td>
            </Tr>
          </TFoot>
        </Table>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {s.blocking > 0 && <span className="text-xs text-(--color-expense)">{s.blocking} ta xodimning F.I.Sh. kiritilmagan</span>}
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Boshqa fayl
        </Button>
        <Button onClick={() => onSave(input(rows))} loading={saving} disabled={nothing || s.blocking > 0 || recalc}>
          Saqlash
        </Button>
      </div>
    </div>
  );
}

function Box({ label, value, sub, tone = 'neutral' }: { label: string; value: string; sub?: string; tone?: 'neutral' | 'income' | 'expense' | 'warn' | 'brand' }) {
  const c = { neutral: 'text-(--color-text)', income: 'text-(--color-income)', expense: 'text-(--color-expense)', warn: 'text-(--color-warn)', brand: 'text-brand-700' }[tone];
  return (
    <div className="rounded-(--radius-card) border border-(--color-line) bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">{label}</p>
      <p className={cn('money mt-1.5 text-xl font-semibold', c)}>{value}</p>
      {sub && <p className="money mt-0.5 text-xs text-(--color-text-muted)">{sub}</p>}
    </div>
  );
}

function Choice({ checked, onChange, title, description }: { checked: boolean; onChange: () => void; title: string; description: string }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2.5 rounded-(--radius-control) border bg-white px-3 py-2.5', checked ? 'border-brand-600' : 'border-transparent')}>
      <input type="radio" checked={checked} onChange={onChange} className="mt-0.5 size-4" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-(--color-text-muted)">{description}</span>
      </span>
    </label>
  );
}