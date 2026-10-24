'use client';

import { SearchInput } from '@/components/shared/search-input';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { IconUsers } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { formatDate, formatDateTime, formatPeriod, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { hrSheetsApi, type HrPersonCard } from './api';

// ═══════════════════════════════════════════════════════════
// Xodimlar › Miya — JShShIR (yoki F.I.Sh.) bo'yicha xodimning hamma ma'lumoti bir joyda:
//   ma'lumotnomalar (10/16/37/51-jadval), Xodimlar bazasi, hozirgi bo'limi va ko'chishlari, ish haqi.
//   Pasport va aloqa ma'lumotlari — «Ko'rsatish» bosilgandagina ochiladi.
// ═══════════════════════════════════════════════════════════

const SOURCE_LABEL: Record<string, string> = { J10: '10-jadval', J16: '16-jadval', J37: '37-jadval', J51: '51-jadval' };
const STAFF_SOURCE: Record<string, string> = { REGISTRY: "baza / ma'lumotnoma", UPLOAD: 'vedomostdan', MANUAL: "qo'lda", MOVE: "ko'chib kelgan" };
const PRIVATE_GROUPS = new Set(['pasport', 'aloqa']);

export function MiyaView({ pinfl, onPinfl }: { pinfl: string | null; onPinfl: (pinfl: string | null) => void }) {
  const [q, setQ] = useState('');
  const hits = useAsync(() => (q.trim().length >= 3 ? hrSheetsApi.search(q) : Promise.resolve(null)), [q]);
  const list = hits.data?.data ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <Card className="flex max-h-[calc(100vh-14rem)] flex-col overflow-hidden">
        <div className="space-y-2 border-b border-(--color-line) p-4">
          <p className="text-sm font-semibold text-heading">Xodimni topish</p>
          <SearchInput value={q} onChange={setQ} placeholder="JShShIR yoki F.I.Sh." className="w-full" />
          <p className="text-[11px] text-(--color-text-muted)">JShShIR — kamida 4 raqam, ism — kamida 3 harf. Ma&apos;lumotnomalar va Xodimlar bazasidan qidiriladi.</p>
        </div>
        <div className="flex-1 overflow-auto">
          {q.trim().length < 3 ? (
            <p className="px-4 py-6 text-center text-xs text-(--color-text-muted)">Qidirish uchun yozing</p>
          ) : hits.loading ? (
            <LoadingState />
          ) : !list?.length ? (
            <p className="px-4 py-6 text-center text-xs text-(--color-text-muted)">Topilmadi</p>
          ) : (
            <ul>
              {list.map((h) => (
                <li key={h.pinfl}>
                  <button
                    type="button"
                    onClick={() => onPinfl(h.pinfl)}
                    className={cn('w-full border-b border-(--color-line) px-4 py-2.5 text-left hover:bg-brand-50/50', pinfl === h.pinfl && 'bg-brand-50')}
                  >
                    <p className="truncate text-sm font-medium text-heading">{h.fullName}</p>
                    <p className="truncate text-xs text-(--color-text-muted)">
                      <span className="money">{h.pinfl}</span>
                      {h.position ? ` · ${h.position}` : ''}
                    </p>
                    <p className="mt-1 flex flex-wrap gap-1">
                      {h.unitLabel && <Badge tone="brand">{h.unitLabel}</Badge>}
                      {h.inRegistry && <Badge tone="income">Bazada</Badge>}
                      {h.sources.map((s) => (
                        <span key={s} className="rounded bg-(--color-surface-muted) px-1.5 py-0.5 text-[10px] text-(--color-text-muted)">
                          {SOURCE_LABEL[s] ?? s}
                        </span>
                      ))}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <div className="min-w-0">
        {pinfl ? (
          <PersonPanel key={pinfl} pinfl={pinfl} />
        ) : (
          <Card>
            <EmptyState
              icon={<IconUsers className="size-10" strokeWidth={1.5} />}
              title="Xodimni tanlang"
              description="Chapdan qidiring yoki Ma'lumotnomalar jadvalida qatorni bosing — xodimning hamma ma'lumoti shu yerda ochiladi"
            />
          </Card>
        )}
      </div>
    </div>
  );
}

function PersonPanel({ pinfl }: { pinfl: string }) {
  const res = useAsync(() => hrSheetsApi.person(pinfl), [pinfl]);
  if (res.loading) return <LoadingState />;
  if (res.error) return <ErrorState message={res.error} onRetry={res.reload} />;
  const p = res.data?.data;
  return p ? <PersonCard p={p} /> : null;
}

export function PersonCard({ p }: { p: HrPersonCard }) {
  const [shown, setShown] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setShown((s) => {
      const x = new Set(s);
      if (x.has(k)) x.delete(k);
      else x.add(k);
      return x;
    });

  return (
    <div className="space-y-4">
      {/* Bosh qism */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start gap-4 bg-gradient-to-r from-brand-50 to-white px-5 py-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-600 text-lg font-bold text-white">
            {p.fullName
              .split(/\s+/)
              .slice(0, 2)
              .map((w) => w[0])
              .join('')}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold text-heading">{p.fullName}</p>
            <p className="text-sm text-(--color-text-muted)">
              <span className="money">{p.pinfl}</span>
              {p.position ? ` · ${p.position}` : ''}
            </p>
            {p.place && <p className="mt-0.5 text-xs text-(--color-text-muted)">{p.place}</p>}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone={p.working ? 'income' : 'neutral'}>{p.status ?? (p.working ? 'faol' : 'faol emas')}</Badge>
              {p.miya.unitLabel && <Badge tone="brand">Bo&apos;lim: {p.miya.unitLabel}</Badge>}
              {p.registry ? <Badge tone="income">Xodimlar bazasida</Badge> : <Badge tone="warn">Xodimlar bazasida yo&apos;q</Badge>}
              {p.sources.map((s) => (
                <span key={s} className="rounded bg-white px-1.5 py-0.5 text-[11px] text-(--color-text-muted) ring-1 ring-(--color-line)">
                  {SOURCE_LABEL[s] ?? s}
                </span>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Miya */}
        <Card className="overflow-hidden">
          <CardHeader title="Miya — bo'limi" description={`${formatPeriod(p.miya.period)} holatiga`} />
          <div className="space-y-3 px-5 pb-4 text-sm">
            <Row label="Hozirgi bo'limi" value={p.miya.unitLabel ?? 'aniqlanmagan'} strong />
            <Row label="Tuzilmasi bo'yicha (ma'lumotnoma)" value={p.hrUnitLabel ?? '—'} />
            <Row label="Bo'lim ro'yxatlarida" value={p.miya.staffIn.length ? p.miya.staffIn.map((s) => `${s.label} (${STAFF_SOURCE[s.source] ?? s.source})`).join(', ') : '—'} />
            <div>
              <p className="text-xs text-(--color-text-muted)">Bo&apos;limlar o&apos;rtasida ko&apos;chishlar</p>
              {p.miya.moves.length ? (
                <ul className="mt-1 space-y-1">
                  {p.miya.moves.map((m) => (
                    <li key={m.id} className="rounded-(--radius-control) bg-(--color-surface-muted) px-2.5 py-1.5 text-xs">
                      <b>{formatPeriod(m.from)}</b>dan: {m.fromUnitLabel ? `${m.fromUnitLabel} → ` : ''}
                      <b>{m.unitLabel}</b>
                      <span className="text-(--color-text-muted)">
                        {' '}
                        · {m.source === 'UPLOAD' ? 'vedomostdan' : "qo'lda"}
                        {m.note ? ` · ${m.note}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-(--color-text-faint)">yo&apos;q</p>
              )}
            </div>
          </div>
        </Card>

        {/* Xodimlar bazasi */}
        <Card className="overflow-hidden">
          <CardHeader title="Xodimlar bazasi" description={p.registry ? (p.registry.isActive ? 'faol' : 'arxivda') : "bu JShShIR bazada yo'q"} />
          <div className="space-y-2 px-5 pb-4 text-sm">
            {p.registry ? (
              <>
                <Row label="Joylashuv" value={[p.registry.region, p.registry.district, p.registry.department].filter(Boolean).join(' · ') || '—'} />
                <Row label="Lavozim" value={p.registry.position ?? '—'} />
                <Row label="Ish turi" value={p.registry.employmentType === 'SHTAT' ? 'Shtat' : 'Shartnoma'} />
                <Row label="Ishga kirgan" value={p.registry.hiredAt ? formatDate(p.registry.hiredAt) : '—'} />
                {p.registry.firedAt && <Row label="Bo'shagan" value={formatDate(p.registry.firedAt)} />}
              </>
            ) : (
              <p className="text-xs text-(--color-text-muted)">Ma&apos;lumot faqat ma&apos;lumotnomalardan. Xodimlar › Ro&apos;yxat › «Yangi xodim» bilan bazaga qo&apos;shish mumkin.</p>
            )}
          </div>
        </Card>
      </div>

      {/* Ma'lumotnomalar */}
      {p.sheets.map((s) => (
        <Card key={s.code} className="overflow-hidden">
          <CardHeader title={s.label} description={`${s.fileName} · ${formatDateTime(s.uploadedAt)}${s.records.length > 1 ? ` · ${s.records.length} ta yozuv` : ''}`} />
          <div className="space-y-4 px-5 pb-4">
            {s.records.map((r, ri) => (
              <div key={ri} className={cn(s.records.length > 1 && 'rounded-(--radius-control) border border-(--color-line) p-3')}>
                {s.records.length > 1 && <p className="mb-2 text-xs font-semibold text-(--color-text-muted)">{ri + 1}-yozuv</p>}
                <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
                  {r.groups.map((g) => {
                    const key = `${s.code}:${ri}:${g.group}`;
                    const hidden = PRIVATE_GROUPS.has(g.group) && !shown.has(key);
                    return (
                      <div key={g.group}>
                        <p className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
                          {g.label}
                          {PRIVATE_GROUPS.has(g.group) && (
                            <button type="button" onClick={() => toggle(key)} className="rounded px-1.5 py-0.5 text-[10px] font-semibold normal-case text-brand-700 hover:bg-brand-50">
                              {hidden ? "Ko'rsatish" : 'Yashirish'}
                            </button>
                          )}
                        </p>
                        <dl className="space-y-1">
                          {g.fields.map((f) => (
                            <div key={f.label} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-2 text-xs">
                              <dt className="text-(--color-text-muted)">{f.label}</dt>
                              <dd className={cn('break-words text-heading', hidden && 'select-none blur-[5px]')}>{hidden ? '•••••••••' : f.value}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}

      {/* Ish haqi */}
      <Card className="overflow-hidden">
        <CardHeader title="Ish haqi" description="Umumiy vedomost va bo'limlar vedomostlari (so'nggi oylar)" />
        {p.payroll.months.length === 0 && p.payroll.units.length === 0 ? (
          <p className="px-5 pb-4 text-xs text-(--color-text-muted)">Ish haqi yozuvi yo&apos;q</p>
        ) : (
          <div className="grid gap-4 px-5 pb-4 md:grid-cols-2">
            <MiniTable title="Umumiy vedomost" rows={p.payroll.months.map((m) => ({ k: m.period, a: formatPeriod(m.period), b: formatTiyin(m.totalTiyin) }))} />
            <MiniTable title="Bo'limlar vedomosti" rows={p.payroll.units.map((u) => ({ k: `${u.unit}${u.period}`, a: `${formatPeriod(u.period)} · ${u.label}`, b: formatTiyin(u.amountTiyin) }))} />
          </div>
        )}
      </Card>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)] gap-2">
      <span className="text-xs text-(--color-text-muted)">{label}</span>
      <span className={cn('text-sm', strong ? 'font-semibold text-heading' : 'text-heading')}>{value}</span>
    </div>
  );
}

function MiniTable({ title, rows }: { title: string; rows: { k: string; a: string; b: string }[] }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">{title}</p>
      {rows.length ? (
        <table className="w-full text-xs">
          <tbody>
            {rows.map((r) => (
              <tr key={r.k} className="border-b border-(--color-line)">
                <td className="py-1 text-(--color-text-muted)">{r.a}</td>
                <td className="money py-1 text-right text-heading">{r.b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-xs text-(--color-text-faint)">yo&apos;q</p>
      )}
    </div>
  );
}