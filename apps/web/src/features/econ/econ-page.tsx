'use client';

import { formatPeriod } from '@/lib/format';
import { useAsOf } from '@/lib/period';
import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { ViewTabs } from '@/features/structure/parts';
import { useAsync } from '@/lib/use-async';
import { SmallButton } from '@/features/structure/parts';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { downloadEconFile, econApi } from './api';
import { DataStatus } from './data-status';
import { FactorsView } from './factors-view';
import { ForecastView } from './forecast-view';
import { ScenarioView } from './scenario-view';

type Tab = 'forecast' | 'factors' | 'scenario' | 'data';
const ALL_TABS: Tab[] = ['forecast', 'factors', 'scenario', 'data'];

/**
 * Hududlarga tegishli modellar (panel, hudud natijasi, Markaz xarajati, prognoz, salohiyat, KPI, stsenariy, DEA, zararsizlik)
 * Solishtirma › Hududlar sahifasiga ko'chirildi — eski havolalar (?tab=…) o'sha yerga yo'naltiriladi.
 */
const MOVED: Record<string, string> = {
  panel: 'panel',
  regions: 'perf',
  overhead: 'overhead',
  rforecast: 'rforecast',
  potential: 'potential',
  kpi: 'kpi',
  rscenario: 'rscenario',
  efficiency: 'efficiency',
  breakeven: 'breakeven',
};

/** Katta modellar sahifasi: korxona modellari (yorliqlar) */
export function EconPage() {
  /** Umumiy «Davr» oyi: o'tgan oy bo'lsa — o'sha oy oxiridagi holat */
  const asOf = useAsOf();
  const overview = useAsync(() => econApi.overview(asOf).then((r) => r.data), [asOf]);
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('forecast');
  // Manzildan ochish: /katta-modellar?tab=factors; hududiy model — Solishtirma › Hududlar ga
  useEffect(() => {
    try {
      const t = new URLSearchParams(window.location.search).get('tab');
      if (t && MOVED[t]) router.replace(`/solishtirma?m=${MOVED[t]}`);
      else if (t && ALL_TABS.includes(t as Tab)) setTab(t as Tab);
    } catch {
      /* e'tiborsiz */
    }
  }, [router]);
  const [downloading, setDownloading] = useState<'report' | 'slides' | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  if (overview.error) {
    return (
      <Card>
        <ErrorState message={overview.error} onRetry={overview.reload} />
      </Card>
    );
  }
  if (!overview.data) {
    return (
      <Card>
        <LoadingState label="Ma'lumot yig'ilmoqda" />
      </Card>
    );
  }
  const data = overview.data;
  const warns = data.warnings.filter((w) => w.level === 'warn').length;

  return (
    <div className="space-y-4">
      {/* Tarixiy ko'rinish: yuqori paneldagi oy o'tgan oy bo'lsa */}
      {data.asOf && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-(--radius-card) border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm">
          <span className="rounded-md bg-amber-500 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">Tarixiy</span>
          <span className="text-heading">
            Modellar <b>{formatPeriod(data.asOf)}</b> oxirida turgandek hisoblangan: keyingi oylar yozuvlari olinmagan, prognoz{' '}
            {formatPeriod(data.currentPeriod)} dan boshlanadi.
          </span>
          <span className="text-xs text-(--color-text-muted)">Bugungi holat uchun yuqoridagi oyni joriy oyga qo&apos;ying.</span>
        </div>
      )}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-(--color-line) px-5 py-2.5">
          <p className="text-xs text-(--color-text-muted)">
            Barcha modellar bo&apos;yicha avtomatik hisobot —{' '}
            {data.asOf ? `${formatPeriod(data.asOf)} oxiridagi holat bilan` : 'joriy ma\'lumot bilan'}
          </p>
          <div className="flex items-center gap-2">
            {downloadError && <span className="text-xs text-(--color-expense)">{downloadError}</span>}
            {(['report', 'slides'] as const).map((kind) => (
              <SmallButton
                key={kind}
                disabled={downloading !== null}
                onClick={async () => {
                  setDownloading(kind);
                  setDownloadError(null);
                  try {
                    await downloadEconFile(kind, asOf);
                  } catch (e) {
                    setDownloadError(e instanceof Error ? e.message : 'Yuklab bo\'lmadi');
                  } finally {
                    setDownloading(null);
                  }
                }}
              >
                {downloading === kind ? 'Tayyorlanmoqda…' : kind === 'report' ? 'Excel hisobot' : 'Slaydlar (PowerPoint)'}
              </SmallButton>
            ))}
          </div>
        </div>
        <p className="px-5 pt-3 text-xs text-(--color-text-muted)">Hududlar modellari (panel, prognoz, salohiyat, KPI, samaradorlik, zararsizlik …) — Solishtirma › Hududlar sahifasida.</p>
        <ViewTabs
          value={tab}
          onChange={setTab}
          options={[
            { value: 'forecast', label: 'Prognoz', hint: 'Kelgusi oylar: daromad, xarajat, natija, ish haqi' },
            { value: 'factors', label: 'Omillar', hint: "Daromad nimalarga bog'liq: regressiya, elastiklik, Kobb-Duglas" },
            { value: 'scenario', label: 'Stsenariy va risk', hint: "«Agar … bo'lsa» hisobi va zararga tushish ehtimoli" },
            { value: 'data', label: warns ? `Ma'lumot holati (${warns} ogohlantirish)` : "Ma'lumot holati", hint: "Qancha ma'lumot bor va qaysi model tayyor" },
          ]}
        />
      </Card>
      {tab === 'forecast' && <ForecastView overview={data} />}
      {tab === 'factors' && <FactorsView />}
      {tab === 'scenario' && <ScenarioView overview={data} />}
      {tab === 'data' && <DataStatus overview={data} />}
    </div>
  );
}