'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useAuth } from '@/lib/auth-context';
import { formatDateLong, formatDateTime, todayInput } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { cashApi, dmy, weekday, type CashOverview } from './api';
import { tiyinToThousands } from './calc';

// ═══════════════════════════════════════════════════════════
// Buxgalteriya › Ish stoli: bugungi ma'lumotnoma kiritildimi, tezkor tugmalar,
// oxirgi kunlar va kiritilmagan ish kunlari. Tahlil emas — bugungi ish.
// ═══════════════════════════════════════════════════════════

function hello(): string {
  const h = new Date().getHours();
  return h < 6 ? 'Xayrli tun' : h < 12 ? 'Xayrli tong' : h < 18 ? 'Xayrli kun' : 'Xayrli kech';
}

export const th = (v: string | null | undefined) => (v === null || v === undefined ? '—' : tiyinToThousands(BigInt(v)));

/** Oxirgi kunlar: kunlik tushum ustunlari (jami va hududlar) */
export function CashBars({ series, height = 'h-40', href }: { series: CashOverview['series']; height?: string; href?: (date: string) => string }) {
  const max = Math.max(1, ...series.map((s) => Number(s.daily ?? 0)));
  if (series.length === 0) return <p className="py-8 text-center text-sm text-(--color-text-muted)">Hali kun saqlanmagan</p>;
  return (
    <div>
      <div className={cn('flex items-end gap-1', height)}>
        {series.map((s) => {
          const total = Number(s.daily ?? 0);
          const reg = Math.min(total, Number(s.regions ?? 0));
          const bar = (
            <div className="flex h-full w-full flex-col justify-end overflow-hidden rounded-t" title={`${dmy(s.date)}: ${th(s.daily)} ming so'm (hududlardan ${th(s.regions)})`}>
              <div className="bg-brand-500 transition-colors group-hover:bg-brand-600" style={{ height: `${((total - reg) / max) * 100}%` }} />
              <div className="bg-emerald-500" style={{ height: `${(reg / max) * 100}%` }} />
            </div>
          );
          return (
            <div key={s.date} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end">
              {href ? (
                <Link href={href(s.date)} className="flex h-full w-full max-w-8 flex-col justify-end">
                  {bar}
                </Link>
              ) : (
                <div className="flex h-full w-full max-w-8 flex-col justify-end">{bar}</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-(--color-text-muted)">
        <span>{dmy(series[0]!.date).slice(0, 5)}</span>
        <span>{dmy(series[series.length - 1]!.date).slice(0, 5)}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-(--color-text-muted)">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-brand-500" />
          Markaziy hisobraqamlar
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-emerald-500" />
          Hududiy bo&apos;limlar
        </span>
      </div>
    </div>
  );
}

export function CashDesk() {
  const { user } = useAuth();
  const today = todayInput();
  const ov = useAsync(() => cashApi.overview(), []);
  const recent = useAsync(() => cashApi.reports(), []);
  const o = ov.data?.data;
  const firstName = (user?.fullName ?? '').split(/\s+/)[1] ?? user?.fullName ?? '';
  const last = o?.latest ?? null;
  const rows = (recent.data?.data ?? []).slice(0, 7);

  return (
    <>
      <PageHeader title="Ish stoli" description={`${hello()}${firstName ? `, ${firstName}` : ''} · ${formatDateLong(today)}`} />
      <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
        {ov.loading && !o ? (
          <LoadingState />
        ) : ov.error || !o ? (
          <ErrorState message={ov.error ?? "Ma'lumot yo'q"} onRetry={ov.reload} />
        ) : (
          <>
            {/* ── Bugungi ish ── */}
            {o.todaySaved ? (
              <Link
                href={`/buxgalteriya/kunlik?sana=${today}`}
                className="group flex flex-wrap items-center gap-4 rounded-(--radius-card) border-2 border-emerald-200 bg-gradient-to-r from-emerald-50 to-white p-5 shadow-card transition-all hover:-translate-y-0.5 hover:border-emerald-300"
              >
                <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-3xl text-white shadow-md">✓</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xl font-bold text-heading">Bugungi ma&apos;lumotnoma saqlangan</p>
                  <p className="text-sm text-(--color-text-muted)">
                    Kunlik tushum: <b className="money text-heading">{th(last?.date === today ? last.daily : null)}</b> ming so&apos;m · tuzatish kerak bo&apos;lsa — oching
                  </p>
                </div>
                <span className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-emerald-700 shadow-sm group-hover:bg-emerald-600 group-hover:text-white">Ochish →</span>
              </Link>
            ) : (
              <Link
                href={`/buxgalteriya/kunlik?sana=${today}`}
                className="group relative flex flex-wrap items-center gap-4 overflow-hidden rounded-(--radius-card) bg-gradient-to-br from-brand-600 via-brand-700 to-indigo-800 p-6 text-white shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl"
              >
                <span className="pointer-events-none absolute -right-10 -top-16 size-56 rounded-full bg-white/10" />
                <span className="pointer-events-none absolute -bottom-20 right-24 size-40 rounded-full bg-white/5" />
                <div className="relative min-w-0 flex-1">
                  <p className="text-sm font-semibold uppercase tracking-wide text-white/75">Bugun · {dmy(today)} · {weekday(today)}</p>
                  <p className="mt-1 text-2xl font-bold md:text-3xl">Kunlik tushumni kiritish</p>
                  <p className="mt-1 text-sm text-white/80">
                    {o.latestDate ? `Yil va oy boshidan, qoldiq — ${dmy(o.latestDate)} kunidan o'zi o'tadi. Faqat bugungi tushumni yozasiz.` : "Birinchi kun: yil va oy boshidan qiymatlarni ham kiriting (yoki Excel'dan to'ldiring)."}
                  </p>
                </div>
                <span className="relative rounded-xl bg-white px-5 py-3 text-base font-bold text-brand-700 shadow-md transition-transform group-hover:scale-105">Boshlash →</span>
              </Link>
            )}

            {/* ── Tezkor tugmalar ── */}
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {[
                { href: `/buxgalteriya/kunlik?sana=${today}`, title: 'Kunlik tushum', hint: 'Jadvalni ochish', tone: 'from-brand-500 to-brand-700' },
                { href: '/buxgalteriya/kunlik?sana=' + today + '&import=1', title: "Excel'dan to'ldirish", hint: "To'ldirilgan shablonni yuklash", tone: 'from-emerald-500 to-emerald-700' },
                { href: '/buxgalteriya/tarix', title: 'Tarix', hint: 'Saqlangan kunlar, Excel', tone: 'from-slate-500 to-slate-700' },
                { href: '/buxgalteriya/hisobraqamlar', title: 'Hisobraqamlar', hint: "Qo'shish, nomi, raqami", tone: 'from-amber-500 to-orange-600' },
              ].map((a) => (
                <Link key={a.title} href={a.href} className={cn('rounded-(--radius-card) bg-gradient-to-br p-4 text-white shadow-card transition-all hover:-translate-y-0.5 hover:shadow-lg', a.tone)}>
                  <p className="text-lg font-bold">{a.title}</p>
                  <p className="mt-1 text-xs text-white/85">{a.hint}</p>
                </Link>
              ))}
            </div>

            {/* ── Kiritilmagan kunlar ── */}
            {o.missing.filter((m) => m !== today).length > 0 && (
              <div className="rounded-(--radius-card) border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900">Shu oyda kiritilmagan ish kunlari ({o.missing.filter((m) => m !== today).length} ta)</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {o.missing
                    .filter((m) => m !== today)
                    .map((m) => (
                      <Link key={m} href={`/buxgalteriya/kunlik?sana=${m}`} className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-amber-800 shadow-sm ring-1 ring-amber-200 hover:bg-amber-100">
                        {dmy(m)} <span className="font-normal text-amber-600">· {weekday(m).slice(0, 3)}</span>
                      </Link>
                    ))}
                </div>
              </div>
            )}

            {/* ── Oxirgi kun raqamlari ── */}
            {last && (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  { label: `Kunlik tushum · ${dmy(last.date)}`, value: th(last.daily) },
                  { label: "Hududiy bo'limlardan", value: th(last.regions) },
                  { label: 'Oy boshidan (bugun bilan)', value: th(last.mtdAfter) },
                  { label: 'Yil boshidan (bugun bilan)', value: th(last.ytdAfter) },
                ].map((s) => (
                  <div key={s.label} className="rounded-(--radius-card) bg-white p-4 shadow-card">
                    <p className="text-xs font-medium text-(--color-text-muted)">{s.label}</p>
                    <p className="money mt-1 text-xl font-bold text-heading md:text-2xl">{s.value}</p>
                    <p className="text-[11px] text-(--color-text-muted)">ming so&apos;m</p>
                  </div>
                ))}
              </div>
            )}

            <div className="grid gap-5 lg:grid-cols-5">
              <Card className="lg:col-span-2">
                <CardHeader title="Oxirgi kunlar" description="Kunlik tushum, ming so'm" />
                <div className="p-5">
                  <CashBars series={o.series} href={(dt) => `/buxgalteriya/kunlik?sana=${dt}`} />
                </div>
              </Card>
              <Card className="overflow-hidden lg:col-span-3">
                <CardHeader
                  title="So'nggi saqlanganlar"
                  actions={
                    <Link href="/buxgalteriya/tarix" className="text-sm font-semibold text-brand-700 hover:underline">
                      Hammasi →
                    </Link>
                  }
                />
                {rows.length === 0 ? (
                  <EmptyState title="Hali kun saqlanmagan" description="Kunlik tushumni kiriting — shu yerda ko'rinadi" />
                ) : (
                  <ul className="divide-y divide-(--color-line)">
                    {rows.map((r) => (
                      <li key={r.date}>
                        <Link href={`/buxgalteriya/kunlik?sana=${r.date}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-brand-50/50">
                          <span className="w-24 font-semibold text-heading">{dmy(r.date)}</span>
                          <span className="w-20 text-xs text-(--color-text-muted)">{weekday(r.date)}</span>
                          <span className="money ml-auto text-sm font-bold text-heading">{th(r.daily)}</span>
                          <span className="w-44 truncate text-right text-xs text-(--color-text-muted)">
                            {r.savedBy ?? '—'} · {formatDateTime(r.updatedAt).slice(-5)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </>
        )}
      </div>
    </>
  );
}