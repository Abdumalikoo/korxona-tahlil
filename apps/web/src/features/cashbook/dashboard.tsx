'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { RoleTabs } from '@/features/roles/role-tabs';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useBrief } from '@/lib/view-mode';
import Link from 'next/link';
import { cashApi, dmy, weekday } from './api';
import { CashBars, th } from './desk';
import { CashHistory } from './history';

// ═══════════════════════════════════════════════════════════
// Umumiy hudud › Buxgalteriya dashbordi: buxgalter kiritgan kunlik tushumning tahlili.
// Kun ochilsa — o'sha jadval (administrator xatoni tuzata oladi). Kiritish — buxgalterda.
// ═══════════════════════════════════════════════════════════

const DAY = '/dashbord/buxgalteriya/kun';

export function CashDashboard() {
  /** Qisqa rejim (Dashbord): grafik ko'rsatilmaydi */
  const brief = useBrief();
  const ov = useAsync(() => cashApi.overview(), []);
  const o = ov.data?.data;
  if (ov.loading && !o) return <LoadingState />;
  if (ov.error || !o) return <ErrorState message={ov.error ?? "Ma'lumot yo'q"} onRetry={ov.reload} />;
  const last = o.latest;
  const regMax = Math.max(1, ...o.regions.map((r) => Number(r.daily ?? 0)));
  const regions = [...o.regions].sort((a, b) => Number(b.daily ?? 0) - Number(a.daily ?? 0));
  const missing = o.missing.filter((m) => m !== o.today);

  return (
    <>
      <PageHeader title="Kunlik tushum" description="Buxgalter kiritgan hisobraqamlar bo'yicha kunlik tushum va qoldiq · ming so'mda. Kunni ochib xatoni tuzatasiz" />
      <div className="space-y-6 p-4 md:p-6">
        <RoleTabs />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: last ? `Kunlik tushum · ${dmy(last.date)}` : 'Kunlik tushum', value: th(last?.daily), hint: o.todaySaved ? 'Bugungi kun saqlangan' : 'Bugungi kun hali kiritilmagan', tone: o.todaySaved ? 'text-heading' : 'text-amber-600' },
            { label: "Hududiy bo'limlardan", value: th(last?.regions), hint: 'oxirgi kun', tone: 'text-heading' },
            { label: 'Oy boshidan', value: th(last?.mtdAfter), hint: 'oxirgi kun bilan birga', tone: 'text-heading' },
            { label: 'Yil boshidan', value: th(last?.ytdAfter), hint: 'oxirgi kun bilan birga', tone: 'text-heading' },
          ].map((t) => (
            <div key={t.label} className="rounded-(--radius-card) bg-white p-4 shadow-card">
              <p className="text-xs font-semibold text-(--color-text-muted)">{t.label}</p>
              <p className={cn('money mt-1.5 text-[26px] font-bold leading-tight', t.tone)}>{t.value}</p>
              <p className="mt-1 text-xs text-(--color-text-muted)">{t.hint}</p>
            </div>
          ))}
        </div>

        {missing.length > 0 && (
          <div className="rounded-(--radius-card) border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Shu oyda kiritilmagan ish kunlari: {missing.map((m) => dmy(m).slice(0, 5)).join(', ')}
          </div>
        )}

        <div className={cn('grid gap-5', !brief && 'xl:grid-cols-3')}>
          {!brief && (
          <Card className="xl:col-span-2">
            <CardHeader title="Oxirgi 30 kun" description="Kunlik tushum — ustunni bosing, o'sha kun ochiladi" />
            <div className="p-5">
              <CashBars series={o.series} height="h-52" href={(d) => `${DAY}?sana=${d}`} />
            </div>
          </Card>
          )}
          <Card className="overflow-hidden">
            <CardHeader title="Bo'limlar" description={last ? `${dmy(last.date)} · ${weekday(last.date)}` : ''} />
            <ul className="divide-y divide-(--color-line)">
              {o.sections.map((s) => (
                <li key={s.id} className="flex items-start gap-3 px-4 py-3">
                  <span className="mt-0.5 w-8 shrink-0 text-center text-sm font-bold text-brand-700">{s.code}</span>
                  <span className="min-w-0 flex-1 text-sm leading-snug text-heading">{s.name}</span>
                  <span className="shrink-0 text-right">
                    <span className="money block text-sm font-bold text-heading">{th(s.daily)}</span>
                    <span className="money block text-[11px] text-(--color-text-muted)">qoldiq {th(s.balance)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        {regions.length > 0 && (
          <Card>
            <CardHeader title="Hududiy bo'limlar" description={last ? `Kunlik tushum, ${dmy(last.date)} · o'ngda — oy boshidan (bugun bilan)` : ''} />
            <div className="grid gap-x-8 gap-y-2 p-5 md:grid-cols-2">
              {regions.map((r) => (
                <div key={r.id} className="flex items-center gap-3 text-sm">
                  <span className="w-28 shrink-0 truncate font-medium text-heading">{r.name}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(Number(r.daily ?? 0) / regMax) * 100}%` }} />
                  </div>
                  <span className="money w-24 text-right font-semibold">{th(r.daily)}</span>
                  <span className="money hidden w-28 text-right text-xs text-(--color-text-muted) sm:inline">{th(r.mtdAfter)}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold text-heading">Saqlangan kunlar</h2>
            {last && (
              <Link href={`${DAY}?sana=${last.date}`} className="text-sm font-semibold text-brand-700 hover:underline">
                Oxirgi kunni ochish →
              </Link>
            )}
          </div>
          <CashHistory base={DAY} embedded />
        </div>
      </div>
    </>
  );
}