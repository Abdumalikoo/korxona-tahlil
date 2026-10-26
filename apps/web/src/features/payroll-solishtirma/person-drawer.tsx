'use client';

import { Badge } from '@/components/ui/badge';
import { Drawer } from '@/components/ui/drawer';
import { LoadingState } from '@/components/ui/states';
import { formatDate, formatDateTime, formatPeriod, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { sourceHref, unitPayrollHref } from '@/lib/source-links';
import Link from 'next/link';
import { useEffect } from 'react';
import { solishtirmaApi, type BankMonthMode, type SolPerson } from './api';

// ═══════════════════════════════════════════════════════════
// Ish haqi solishtirma › bitta xodim: manbada yuklangan HAMMA narsa — faqat shu xodimniki.
//  • Soliq hisoboti — qaysi faylda, qayerda (umumiy / bo'lim), qancha;
//  • Ish haqi tarkibi — komponentlar (kategoriya bo'yicha), yo'naltirilganlar;
//  • 23106 — har to'lov: sana, hujjat №, summa, turi, izoh; shu oyga olinganmi va nega olinmagan.
// ═══════════════════════════════════════════════════════════

export type PersonFocus = 'soliq' | 'tarkib' | 'bank';

export function PersonDrawer({ period, mode, pinfl, focus, onClose }: { period: string; mode: BankMonthMode; pinfl: string | null; focus: PersonFocus; onClose: () => void }) {
  const data = useAsync(() => (pinfl ? solishtirmaApi.person(period, pinfl, mode).then((r) => r.data) : Promise.resolve(null)), [period, mode, pinfl]);
  const v = data.data;

  useEffect(() => {
    if (v) document.getElementById(`sol-person-${focus}`)?.scrollIntoView({ block: 'start' });
  }, [v, focus]);

  const r = v?.row ?? null;
  const counted = v?.bank.filter((b) => b.counted) ?? [];
  const other = v?.bank.filter((b) => !b.counted) ?? [];

  return (
    <Drawer open={pinfl !== null} onClose={onClose} width="xl" title={v ? v.fullName : 'Xodim'} description={v ? `${v.pinfl} · ${formatPeriod(period)} · manbada yuklangan hamma ma’lumot` : undefined}>
      {data.loading && !v ? (
        <LoadingState />
      ) : data.error ? (
        <p className="text-sm text-(--color-expense)">{data.error}</p>
      ) : v ? (
        <div className="space-y-5 text-sm">
          {v.employee && (
            <p className="text-xs text-(--color-text-muted)">
              {[v.employee.department, v.employee.position, v.employee.employmentType === 'SHARTNOMA' ? 'shartnoma' : 'shtat'].filter(Boolean).join(' · ')}
            </p>
          )}

          {/* Hisob-kitob */}
          {r && (
            <div className="grid grid-cols-2 gap-2 rounded-(--radius-control) border border-(--color-line) bg-(--color-surface-muted) p-3 sm:grid-cols-4">
              <Fig label="Soliq hisoboti (FOT)" value={r.fotTiyin} />
              <Fig label="Ushlanma (soliq, kasaba)" value={r.taxTiyin === null ? null : (BigInt(r.taxTiyin) + BigInt(r.unionTiyin ?? '0')).toString()} minus />
              <Fig label="Bankdan kutilgan" value={r.expectedTiyin} />
              <Fig label={`23106 (${mode === 'PAID' ? 'to‘langan oy' : 'hisoblangan oy'})`} value={r.bankTiyin} tone={r.state === 'OK' ? 'income' : 'warn'} sub={r.diffTiyin && r.diffTiyin !== '0' ? `farq ${BigInt(r.diffTiyin) > 0n ? '+' : ''}${formatTiyin(r.diffTiyin)}` : 'mos'} />
            </div>
          )}

          {/* Soliq hisoboti */}
          <section id="sol-person-soliq" className="scroll-mt-2">
            <H title="Soliq hisoboti" total={v.soliqTiyin} active={focus === 'soliq'} href={(r?.unit && unitPayrollHref(r.unit, period)) || sourceHref.soliq(period)} />
            {v.soliq.length === 0 ? (
              <Empty>Shu oy soliq hisobotida yo‘q</Empty>
            ) : (
              <ul className="divide-y divide-(--color-line) rounded-(--radius-control) border border-(--color-line)">
                {v.soliq.map((s, i) => (
                  <li key={i} className={cn('flex flex-wrap items-start justify-between gap-2 px-3 py-2', !s.counted && 'opacity-60')}>
                    <span>
                      <span className="block font-medium text-heading">{s.where}</span>
                      <span className="text-xs text-(--color-text-muted)">
                        «{s.fileName}»{s.at ? ` · ${formatDateTime(s.at)}` : ''}
                        {s.note ? ` · ${s.note}` : ''}
                      </span>
                    </span>
                    <span className="money font-medium">{formatTiyin(s.tiyin)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Ish haqi tarkibi */}
          <section id="sol-person-tarkib" className="scroll-mt-2">
            <H title="Ish haqi tarkibi" total={v.tarkib.reduce((x, t) => x + BigInt(t.totalTiyin), 0n).toString()} active={focus === 'tarkib'} href={sourceHref.tarkib(period)} />
            {v.tarkib.length === 0 ? (
              <Empty>Shu oy ish haqi tarkibida yo‘q</Empty>
            ) : (
              v.tarkib.map((t, i) => (
                <div key={i} className="mb-2 rounded-(--radius-control) border border-(--color-line)">
                  <p className="border-b border-(--color-line) bg-(--color-surface-muted) px-3 py-1.5 text-xs text-(--color-text-muted)">
                    <b className="text-heading">{t.where}</b> · «{t.fileName}»{t.at ? ` · ${formatDateTime(t.at)}` : ''}
                  </p>
                  <table className="w-full text-sm">
                    <tbody>
                      {t.items
                        .filter((x) => x.tiyin !== '0')
                        .map((x) => (
                          <tr key={x.code} className="border-t border-(--color-line) first:border-t-0">
                            <td className="px-3 py-1">{x.name}</td>
                            <td className="px-3 py-1 text-xs text-(--color-text-muted)">{x.categoryLabel}</td>
                            <td className={cn('money px-3 py-1 text-right', x.sign < 0 && 'text-(--color-expense)')}>
                              {x.sign < 0 ? '−' : ''}
                              {formatTiyin(x.tiyin)}
                            </td>
                          </tr>
                        ))}
                      <tr className="border-t border-(--color-line-strong) font-semibold">
                        <td className="px-3 py-1" colSpan={2}>
                          Jami
                        </td>
                        <td className="money px-3 py-1 text-right">{formatTiyin(t.totalTiyin)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ))
            )}
            {v.adjustments.length > 0 && (
              <p className="text-xs text-(--color-income)">
                Farqdan yo‘naltirilgan: {v.adjustments.map((a) => `${a.componentName} ${BigInt(a.tiyin) > 0n ? '+' : ''}${formatTiyin(a.tiyin)}${a.by ? ` (${a.by}, ${formatDate(a.at)})` : ''}`).join('; ')}
              </p>
            )}
          </section>

          {/* 23106 */}
          <section id="sol-person-bank" className="scroll-mt-2">
            <H title={`23106 — ${formatPeriod(period)} uchun olinganlar`} total={v.bankCountedTiyin} active={focus === 'bank'} href={sourceHref.bank(period)} />
            {counted.length === 0 ? <Empty>Bu oy uchun to‘lov yo‘q</Empty> : <BankList rows={counted} />}
            {other.length > 0 && (
              <>
                <p className="mt-3 mb-1 text-xs font-semibold uppercase tracking-wide text-(--color-text-muted)">Shu xodimning boshqa to‘lovlari (bu oyga olinmagan)</p>
                <BankList rows={other} muted />
              </>
            )}
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}

function BankList({ rows, muted = false }: { rows: SolPerson['bank']; muted?: boolean }) {
  return (
    <ul className={cn('divide-y divide-(--color-line) rounded-(--radius-control) border border-(--color-line)', muted && 'bg-(--color-surface-muted)/50')}>
      {rows.map((b, i) => (
        <li key={`${b.docNo}-${i}`} className="px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex flex-wrap items-center gap-1.5">
              <b className="text-heading">{formatDate(b.docDate)}</b>
              <Badge tone={b.kind === 'SAFAR' ? 'neutral' : 'brand'}>{b.kindLabel}</Badge>
              <span className="text-xs text-(--color-text-muted)">№ {b.docNo}</span>
              {b.orderNo && <span className="text-xs text-(--color-text-muted)">· buyruq № {b.orderNo}{b.orderDate ? ` (${formatDate(b.orderDate)})` : ''}</span>}
            </span>
            <span className={cn('money font-medium', muted && 'text-(--color-text-muted)')}>{formatTiyin(b.tiyin)}</span>
          </div>
          <p className="mt-0.5 text-xs leading-snug text-(--color-text-muted)">{b.purpose || '—'}</p>
          <p className="mt-0.5 text-[11px] text-(--color-text-faint)">
            {b.forMonth ? `${formatPeriod(b.forMonth)} uchun` : ''} · «{b.fileName}» · {b.account}
            {b.matchBy === 'NAME' ? ' · ism bo‘yicha topilgan' : ''}
            {b.reason && !b.counted ? <span className="text-(--color-warn)"> · {b.reason}</span> : null}
          </p>
        </li>
      ))}
    </ul>
  );
}

function H({ title, total, active, href }: { title: string; total: string; active: boolean; href?: string }) {
  return (
    <div className={cn('mb-2 flex items-baseline justify-between gap-2 border-b pb-1', active ? 'border-brand-600' : 'border-(--color-line)')}>
      <h3 className={cn('text-sm font-semibold', active ? 'text-brand-700' : 'text-heading')}>
        {title}
        {href && (
          <Link href={href} className="ml-2 text-xs font-normal text-brand-700 hover:underline">
            sahifasi →
          </Link>
        )}
      </h3>
      <span className="money font-semibold text-heading">{formatTiyin(total)}</span>
    </div>
  );
}

function Fig({ label, value, minus = false, tone, sub }: { label: string; value: string | null; minus?: boolean; tone?: 'income' | 'warn'; sub?: string }) {
  return (
    <div>
      <p className="text-[11px] text-(--color-text-muted)">{label}</p>
      <p className={cn('money font-semibold', tone === 'income' ? 'text-(--color-income)' : tone === 'warn' ? 'text-(--color-warn)' : 'text-heading')}>
        {value === null ? '—' : `${minus ? '−' : ''}${formatTiyin(value)}`}
      </p>
      {sub && <p className="text-[11px] text-(--color-text-muted)">{sub}</p>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-(--radius-control) border border-dashed border-(--color-line) px-3 py-2 text-xs text-(--color-text-muted)">{children}</p>;
}
