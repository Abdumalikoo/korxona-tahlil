'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Drawer } from '@/components/ui/drawer';
import { IconSearch } from '@/components/ui/icons';
import { Money } from '@/components/ui/money';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { MonthRangeCard, useMonthRange } from '@/features/units/month-range';
import { formatDate, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useState } from 'react';
import { counterpartiesApi, type Counterparty, type CpIssue, type CpRole } from './api';

// ═══════════════════════════════════════════════════════════
// Kontragentlar — yagona «miya»: har tashkilot (INN) bo'yicha schyot-fakturada hisoblangan va bankdan to'langan,
// bizga nima beradi (IKPU xizmatlari), farq (to'lanmagan / oldindan to'langan), shartnomalar, filiallar.
// Faqat ko'rish (nazorat) — xarajat / daromadga yozilmaydi.
// ═══════════════════════════════════════════════════════════

const ROLE_LABEL: Record<CpRole, string> = { SUPPLIER: 'Yetkazib beruvchi', CLIENT: 'Mijoz' };
const ISSUE_LABEL: Record<CpIssue, string> = { UNPAID: "To'lanmagan farqi bor", NO_INVOICE: 'Fakturasiz (faqat bank)', NO_BANK: "To'lovsiz (faqat faktura)" };
const PAGE = 80;

export function CounterpartiesView({ defaultRole = null, sourcesHref }: { defaultRole?: CpRole | null; sourcesHref: { invoice: string; bank: string } }) {
  const range = useMonthRange('year');
  const [role, setRole] = useState<CpRole | null>(defaultRole);
  const [issue, setIssue] = useState<CpIssue | null>(null);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const list = useAsync(() => (range.error ? Promise.resolve(null) : counterpartiesApi.list({ from: range.from, to: range.to, q: debounced, role, issue }).then((r) => r.data)), [range.from, range.to, range.error, debounced, role, issue]);
  const v = list.data;
  const supplier = role !== 'CLIENT';

  return (
    <>
      <Card>
        <div className="space-y-1 px-5 py-4 text-sm text-(--color-text-muted)">
          <p>
            Har tashkilot (INN) bo&apos;yicha <b className="text-heading">ikki manba birga</b>: <Link href={sourcesHref.invoice} className="font-medium text-brand-700 hover:underline">schyot-fakturalar</Link> (hisoblangan) va{' '}
            <Link href={sourcesHref.bank} className="font-medium text-brand-700 hover:underline">bank ko&apos;chirmasi</Link> (to&apos;langan). Bizga nima beradi, oyma-oy farq (to&apos;lanmagan yoki oldindan to&apos;langan), shartnomalar.
            Faqat nazorat — xarajat va daromadga yozilmaydi. Manba chatida ham so&apos;rash mumkin: «300000001 kontragent».
          </p>
        </div>
      </Card>
      <MonthRangeCard range={range} />
      {v && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Box label="Fakturada (bizga)" value={formatTiyin(v.totals.invoicedOutTiyin)} tone="expense" />
          <Box label="Bankdan to'langan" value={formatTiyin(v.totals.paidOutTiyin)} />
          <Box label="Fakturada (biz unga)" value={formatTiyin(v.totals.invoicedInTiyin)} tone="income" />
          <Box label="Bankka tushgan" value={formatTiyin(v.totals.receivedInTiyin)} />
        </div>
      )}
      <Card className="overflow-hidden">
        <CardHeader title={`Kontragentlar${v ? ` · ${v.count}` : ''}`} description="Qatorni bosing — karta: oyma-oy faktura ↔ bank, xizmatlar, shartnomalar, hujjatlar" />
        <div className="flex flex-wrap items-center gap-2 border-b border-(--color-line) px-5 py-2.5">
          <Chip active={!role} onClick={() => setRole(null)}>
            Hammasi
          </Chip>
          {(['SUPPLIER', 'CLIENT'] as const).map((r) => (
            <Chip key={r} active={role === r} onClick={() => setRole(role === r ? null : r)}>
              {ROLE_LABEL[r]}lar
            </Chip>
          ))}
          <span className="mx-1 h-5 w-px bg-(--color-line)" />
          {(['UNPAID', 'NO_INVOICE', 'NO_BANK'] as const).map((x) => (
            <Chip key={x} active={issue === x} onClick={() => setIssue(issue === x ? null : x)}>
              {ISSUE_LABEL[x]}
            </Chip>
          ))}
          <label className="relative ml-auto">
            <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-(--color-text-faint)" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder="Nomi, INN, xizmat" className="h-8 w-60 rounded-(--radius-control) border border-(--color-line-strong) bg-white pr-3 pl-8 text-sm focus:border-brand-600 focus:outline-none" />
          </label>
        </div>
        {list.loading && !v ? (
          <LoadingState />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : !v?.rows.length ? (
          <EmptyState title="Kontragent topilmadi" description="Schyot-faktura reyestri yoki bank ko'chirmasini yuklang — kontragentlar o'zi to'planadi" />
        ) : (
          <div className="max-h-[720px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-[1] bg-(--color-surface-muted) text-[10px] uppercase tracking-wide text-(--color-text-muted)">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Kontragent</th>
                  <th className="px-3 py-2 text-left font-semibold">Nima beradi / oladi</th>
                  <th className="px-3 py-2 text-right font-semibold">{supplier ? 'Fakturada' : 'Fakturada (biz)'}</th>
                  <th className="px-3 py-2 text-right font-semibold">{supplier ? "To'langan" : 'Tushgan'}</th>
                  <th className="px-4 py-2 text-right font-semibold">Farq</th>
                </tr>
              </thead>
              <tbody>
                {v.rows.slice(0, limit).map((r) => (
                  <Row key={r.inn} r={r} supplier={supplier} onOpen={() => setOpen(r.inn)} />
                ))}
              </tbody>
            </table>
            {v.rows.length > limit && (
              <div className="border-t border-(--color-line) px-5 py-2 text-center">
                <Button size="sm" variant="ghost" onClick={() => setLimit((x) => x + PAGE)}>
                  Yana ({v.rows.length - limit} qoldi)
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
      <CardDrawer inn={open} from={range.from} to={range.to} onClose={() => setOpen(null)} />
    </>
  );
}

function Row({ r, supplier, onOpen }: { r: Counterparty; supplier: boolean; onOpen: () => void }) {
  const showOut = supplier ? r.roles.includes('SUPPLIER') || !r.roles.includes('CLIENT') : !r.roles.includes('CLIENT');
  const inv = showOut ? r.invoicedOutTiyin : r.invoicedInTiyin;
  const paid = showOut ? r.paidOutTiyin : r.receivedInTiyin;
  const bal = BigInt(showOut ? r.balanceOutTiyin : r.balanceInTiyin);
  return (
    <tr className="cursor-pointer border-t border-(--color-line) align-top hover:bg-(--color-surface-muted)" onClick={onOpen}>
      <td className="max-w-80 px-4 py-2">
        <span className="block truncate font-medium text-heading" title={r.name}>
          {r.alias ?? r.name}
        </span>
        <span className="flex flex-wrap items-center gap-1 text-[11px] text-(--color-text-muted)">
          {r.alias && <span className="truncate">{r.name} ·</span>}
          <span className="money">INN {r.inn}</span>
          {r.roles.map((x) => (
            <Badge key={x} tone={x === 'SUPPLIER' ? 'expense' : 'income'} className="px-1.5 py-0 text-[10px]">
              {ROLE_LABEL[x]}
            </Badge>
          ))}
          {r.sources.length < 2 && (
            <Badge tone="warn" className="px-1.5 py-0 text-[10px]">
              faqat {r.sources[0] === 'INVOICE' ? 'faktura' : 'bank'}
            </Badge>
          )}
        </span>
      </td>
      <td className="max-w-96 px-3 py-2 text-xs">
        <Badge tone="brand" className="px-1.5 py-0 text-[10px]">
          {r.kindLabel}
        </Badge>
        <span className="mt-0.5 block truncate text-(--color-text-muted)" title={r.services.map((s) => s.label).join('\n')}>
          {r.services[0]?.label ?? '—'}
          {r.services.length > 1 ? ` · +${r.services.length - 1}` : ''}
        </span>
      </td>
      <td className="money px-3 py-2 text-right whitespace-nowrap">{inv !== '0' ? <Money tiyin={inv} /> : <span className="text-(--color-text-faint)">—</span>}</td>
      <td className="money px-3 py-2 text-right whitespace-nowrap">{paid !== '0' ? <Money tiyin={paid} /> : <span className="text-(--color-text-faint)">—</span>}</td>
      <td className={cn('money px-4 py-2 text-right whitespace-nowrap', bal > 100n ? 'text-(--color-warn)' : bal < -100n ? 'text-(--color-income)' : 'text-(--color-text-faint)')}>
        {bal > 100n || bal < -100n ? (
          <>
            {formatTiyin((bal < 0n ? -bal : bal).toString())}
            <span className="block text-[10px] font-normal">{bal > 0n ? (showOut ? "to'lanmagan" : 'tushmagan') : 'oldindan'}</span>
          </>
        ) : (
          '—'
        )}
      </td>
    </tr>
  );
}

function CardDrawer({ inn, from, to, onClose }: { inn: string | null; from: string; to: string; onClose: () => void }) {
  const data = useAsync(() => (inn ? counterpartiesApi.card(inn, from, to).then((r) => r.data) : Promise.resolve(null)), [inn, from, to]);
  const [src, setSrc] = useState<'ALL' | 'INVOICE' | 'BANK'>('ALL');
  const c = data.data;
  const docs = useMemo(() => (c?.documents ?? []).filter((d) => src === 'ALL' || d.src === src), [c, src]);
  const hasOut = Boolean(c && (c.invoicedOutTiyin !== '0' || c.paidOutTiyin !== '0'));
  const hasIn = Boolean(c && (c.invoicedInTiyin !== '0' || c.receivedInTiyin !== '0'));
  return (
    <Drawer open={inn !== null} onClose={onClose} title={c ? (c.alias ?? c.name) : inn ?? ''} description={c ? `${c.alias ? `${c.name} · ` : ''}INN ${c.inn} · ${c.kindLabel}${c.firstDate ? ` · ${formatDate(c.firstDate)} – ${formatDate(c.lastDate!)}` : ''}` : undefined} width="xl">
      {data.loading && !c ? (
        <LoadingState />
      ) : data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : c ? (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {hasOut && <Mini label="Fakturada (bizga)" value={formatTiyin(c.invoicedOutTiyin)} sub={`${c.invoices} ta faktura`} />}
            {hasOut && <Mini label="Bankdan to'langan" value={formatTiyin(c.paidOutTiyin)} sub={`${c.payments} ta to'lov`} />}
            {hasOut && <Mini label={BigInt(c.balanceOutTiyin) >= 0n ? "To'lanmagan" : "Oldindan to'langan"} value={formatTiyin((BigInt(c.balanceOutTiyin) < 0n ? -BigInt(c.balanceOutTiyin) : BigInt(c.balanceOutTiyin)).toString())} warn={BigInt(c.balanceOutTiyin) > 100n} />}
            {hasIn && <Mini label="Fakturada (biz unga)" value={formatTiyin(c.invoicedInTiyin)} />}
            {hasIn && <Mini label="Bankka tushgan" value={formatTiyin(c.receivedInTiyin)} />}
            {hasIn && <Mini label={BigInt(c.balanceInTiyin) >= 0n ? 'Tushmagan' : 'Oldindan tushgan'} value={formatTiyin((BigInt(c.balanceInTiyin) < 0n ? -BigInt(c.balanceInTiyin) : BigInt(c.balanceInTiyin)).toString())} warn={BigInt(c.balanceInTiyin) > 100n} />}
          </div>

          <Section title={c.roles.includes('SUPPLIER') ? 'Bizga nima beradi' : 'Biz unga nima beramiz'}>
            <ul className="divide-y divide-(--color-line) text-xs">
              {c.services.map((s, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <span className="min-w-0 flex-1">
                    {s.label} <span className="text-(--color-text-faint)">· {s.kindLabel} · {s.src === 'INVOICE' ? 'faktura' : 'bank'}</span>
                  </span>
                  <Money tiyin={s.totalTiyin} />
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Oyma-oy: faktura ↔ bank">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-(--color-surface-muted) text-[10px] uppercase tracking-wide text-(--color-text-muted)">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-semibold">Oy</th>
                    {hasOut && <th className="px-2 py-1.5 text-right font-semibold">Fakturada</th>}
                    {hasOut && <th className="px-2 py-1.5 text-right font-semibold">To&apos;langan</th>}
                    {hasOut && <th className="px-2 py-1.5 text-right font-semibold">Qoldiq (o&apos;sib boruvchi)</th>}
                    {hasIn && <th className="px-2 py-1.5 text-right font-semibold">Biz yozgan</th>}
                    {hasIn && <th className="px-2 py-1.5 text-right font-semibold">Tushgan</th>}
                    {hasIn && <th className="px-2 py-1.5 text-right font-semibold">Qoldiq</th>}
                  </tr>
                </thead>
                <tbody>
                  {c.byMonth.map((m) => (
                    <tr key={m.period} className="border-t border-(--color-line)">
                      <td className="px-2 py-1">{m.label}</td>
                      {hasOut && <td className="money px-2 py-1 text-right">{m.invoicedOutTiyin !== '0' ? formatTiyin(m.invoicedOutTiyin) : '—'}</td>}
                      {hasOut && <td className="money px-2 py-1 text-right">{m.paidOutTiyin !== '0' ? formatTiyin(m.paidOutTiyin) : '—'}</td>}
                      {hasOut && <td className={cn('money px-2 py-1 text-right', BigInt(m.balanceOutTiyin) > 100n && 'text-(--color-warn)')}>{formatTiyin(m.balanceOutTiyin)}</td>}
                      {hasIn && <td className="money px-2 py-1 text-right">{m.invoicedInTiyin !== '0' ? formatTiyin(m.invoicedInTiyin) : '—'}</td>}
                      {hasIn && <td className="money px-2 py-1 text-right">{m.receivedInTiyin !== '0' ? formatTiyin(m.receivedInTiyin) : '—'}</td>}
                      {hasIn && <td className="money px-2 py-1 text-right">{formatTiyin(m.balanceInTiyin)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {(c.contracts.length > 0 || c.branches.length > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {c.contracts.length > 0 && (
                <Section title="Shartnomalar">
                  <ul className="divide-y divide-(--color-line) text-xs">
                    {c.contracts.map((x) => (
                      <li key={x.number} className="flex justify-between gap-2 px-3 py-1.5">
                        <span>
                          <b className="text-heading">{x.number}</b>
                          {x.date ? ` · ${formatDate(x.date)}` : ''} <span className="text-(--color-text-faint)">· {x.invoices} faktura</span>
                        </span>
                        <Money tiyin={x.totalTiyin} />
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {c.branches.length > 0 && (
                <Section title="Bizdagi filiallar (fakturada)">
                  <ul className="divide-y divide-(--color-line) text-xs">
                    {c.branches.map((b) => (
                      <li key={b.name} className="flex justify-between gap-2 px-3 py-1.5">
                        <span>{b.name}</span>
                        <Money tiyin={b.totalTiyin} />
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </div>
          )}

          <Section
            title={`Hujjatlar · ${docs.length}`}
            actions={
              <span className="flex gap-1">
                {(['ALL', 'INVOICE', 'BANK'] as const).map((s) => (
                  <Chip key={s} active={src === s} onClick={() => setSrc(s)}>
                    {s === 'ALL' ? 'Hammasi' : s === 'INVOICE' ? 'Fakturalar' : "Bank to'lovlari"}
                  </Chip>
                ))}
              </span>
            }
          >
            <ul className="max-h-[420px] divide-y divide-(--color-line) overflow-auto text-xs">
              {docs.map((d, i) => (
                <li key={i} className="px-3 py-1.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={d.src === 'INVOICE' ? 'brand' : 'neutral'} className="px-1.5 py-0 text-[10px]">
                      {d.src === 'INVOICE' ? 'faktura' : 'bank'}
                    </Badge>
                    <span className="money font-medium">{formatDate(d.date)}</span>
                    <span className="money text-(--color-text-muted)">№ {d.number || '—'}</span>
                    {d.status && <span className="text-(--color-text-muted)">{d.status}</span>}
                    {d.contract && <span className="text-(--color-text-muted)">shartnoma {d.contract}</span>}
                    <span className="flex-1" />
                    <Money tiyin={d.amountTiyin} tone={d.dir === 'OUT' ? 'expense' : 'income'} />
                  </span>
                  <p className="mt-0.5 text-(--color-text)">{d.text}</p>
                  {d.ikpu && <p className="text-[11px] text-(--color-text-faint)">{d.ikpu}</p>}
                </li>
              ))}
            </ul>
          </Section>
        </div>
      ) : null}
    </Drawer>
  );
}

function Section({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-(--radius-control) border border-(--color-line)">
      <div className="flex items-center justify-between gap-2 bg-(--color-surface-muted) px-3 py-1.5 text-xs font-semibold text-heading">
        <span>{title}</span>
        {actions}
      </div>
      {children}
    </div>
  );
}

function Box({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'income' | 'expense' }) {
  const c = { neutral: 'text-(--color-text)', income: 'text-(--color-income)', expense: 'text-(--color-expense)' }[tone];
  return (
    <div className="rounded-(--radius-card) border border-(--color-line) bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">{label}</p>
      <p className={cn('money mt-1.5 text-xl font-semibold', c)}>{value}</p>
    </div>
  );
}

function Mini({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="rounded-(--radius-control) border border-(--color-line) px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-(--color-text-muted)">{label}</p>
      <p className={cn('money mt-0.5 font-semibold', warn ? 'text-(--color-warn)' : 'text-heading')}>{value}</p>
      {sub && <p className="text-[10px] text-(--color-text-faint)">{sub}</p>}
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
