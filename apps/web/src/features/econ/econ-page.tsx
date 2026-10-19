'use client';

import { formatPeriod } from '@/lib/format';
import { useAsOf } from '@/lib/period';
import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Segmented, ViewTabs } from '@/features/structure/parts';
import { useAsync } from '@/lib/use-async';
import { SmallButton } from '@/features/structure/parts';
import { useEffect, useState } from 'react';
import { downloadEconFile, econApi } from './api';
import { DataStatus } from './data-status';
import { BreakevenView, EfficiencyView } from './efficiency-view';
import { FactorsView } from './factors-view';
import { ForecastView } from './forecast-view';
import { ScenarioView } from './scenario-view';
import { OverheadView } from '@/features/regional-econ/overhead-view';
import { PerformanceView } from '@/features/regional-econ/performance-view';
import { RegionalForecastView } from '@/features/regional-econ/forecast-view';
import { PotentialView } from '@/features/regional-econ/potential-view';
import { KpiView } from '@/features/regional-econ/kpi-view';
import { DashboardView } from '@/features/regional-econ/dashboard-view';
import { RegionScenarioView } from '@/features/regional-econ/scenario-view';
import { RegionalDemoPanel } from '@/features/regional-econ/demo-panel';

type Tab = 'forecast' | 'factors' | 'efficiency' | 'breakeven' | 'scenario' | 'data' | 'panel' | 'regions' | 'overhead' | 'rforecast' | 'potential' | 'kpi' | 'rscenario';
type Group = 'regions' | 'company';

/** Hududlar modellari (Solishtirma kuchaytirilgan qismi) */
const REGION_TABS: Tab[] = ['panel', 'regions', 'overhead', 'rforecast', 'potential', 'kpi', 'rscenario'];
const groupOf = (t: Tab): Group => (REGION_TABS.includes(t) ? 'regions' : 'company');
const ALL_TABS: Tab[] = ['forecast', 'factors', 'efficiency', 'breakeven', 'scenario', 'data', ...REGION_TABS];

/** Katta modellar sahifasi: bo'limlar (yorliqlar) */
export function EconPage() {
  /** Umumiy «Davr» oyi: o'tgan oy bo'lsa — o'sha oy oxiridagi holat */
  const asOf = useAsOf();
  const overview = useAsync(() => econApi.overview(asOf).then((r) => r.data), [asOf]);
  const [tab, setTab] = useState<Tab>('panel');
  // Manzildan ochish: /katta-modellar?tab=panel
  useEffect(() => {
    try {
      const t = new URLSearchParams(window.location.search).get('tab') as Tab | null;
      if (t && ALL_TABS.includes(t)) setTab(t);
    } catch {
      /* e'tiborsiz */
    }
  }, []);
  const group = groupOf(tab);
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
        <div className="flex flex-wrap items-center gap-3 px-5 pt-3">
          <Segmented
            value={group}
            onChange={(g) => setTab(g === 'regions' ? 'panel' : 'forecast')}
            options={[
              { value: 'regions', label: 'Hududlar modellari', hint: "Hudud natijasi, Markaz ulushi, prognoz, salohiyat, KPI, stsenariy — Hududchi ma'lumotlari asosida" },
              { value: 'company', label: 'Korxona modellari', hint: 'Korxona va birliklar bo‘yicha ekonometrik modellar' },
            ]}
          />
        </div>
        {group === 'regions' ? (
          <ViewTabs
            value={tab}
            onChange={setTab}
            options={[
              { value: 'panel', label: 'Hududlar paneli', hint: 'Barcha hudud modellari bir joyda: holat, sabablar, avtomatik izoh, «nega o‘zgardi?»' },
              { value: 'regions', label: 'Hudud natijasi', hint: "Har hudud daromadi, xarajati, Markaz ulushi bilan tuzatilgan natijasi va nisbatlari" },
              { value: 'overhead', label: 'Markaz xarajati', hint: "Markaz bo'limlari xarajatini hududlarga taqsimlash: qoidalar, drayverlar, tekshiruv" },
              { value: 'rforecast', label: 'Hudud prognozi', hint: "Hududlar bo'yicha daromad (xizmatlar), ish haqi (xodimlar), xarajat va natija prognozi; aniqlik va versiyalar" },
              { value: 'potential', label: 'Salohiyat', hint: "Barqaror oyna o'rtachasi × o'rtacha o'sish: hudud va xizmatlar salohiyati, foydalanish darajasi" },
              { value: 'kpi', label: 'KPI', hint: "Hududlar uchun oylik maqsadlar: model taklifi, tasdiqlash, fakt va bajarilish" },
              { value: 'rscenario', label: 'Stsenariy', hint: "«Agar … bo'lsa»: tarif, hajm, maosh, xodimlar, xarajat, Markaz" },
            ]}
          />
        ) : (
          <ViewTabs
            value={tab}
            onChange={setTab}
            options={[
              { value: 'forecast', label: 'Prognoz', hint: 'Kelgusi oylar: daromad, xarajat, natija, ish haqi' },
              { value: 'factors', label: 'Omillar', hint: "Daromad nimalarga bog'liq: regressiya, elastiklik, Kobb-Duglas" },
              { value: 'efficiency', label: 'Samaradorlik', hint: 'Samaradorlik chegarasi (DEA): hududlar bir-biriga nisbatan' },
              { value: 'breakeven', label: 'Zararsizlik', hint: 'Zararsizlik nuqtasi, xavfsizlik zaxirasi, Markazni qoplash' },
              { value: 'scenario', label: 'Stsenariy va risk', hint: "«Agar … bo'lsa» hisobi va zararga tushish ehtimoli" },
              { value: 'data', label: warns ? `Ma'lumot holati (${warns} ogohlantirish)` : "Ma'lumot holati", hint: "Qancha ma'lumot bor va qaysi model tayyor" },
            ]}
          />
        )}
      </Card>
      {tab === 'forecast' && <ForecastView overview={data} />}
      {tab === 'factors' && <FactorsView />}
      {tab === 'efficiency' && <EfficiencyView />}
      {tab === 'breakeven' && <BreakevenView />}
      {tab === 'scenario' && <ScenarioView overview={data} />}
      {group === 'regions' && <RegionalDemoPanel />}
      {tab === 'panel' && <DashboardView />}
      {tab === 'regions' && <PerformanceView />}
      {tab === 'overhead' && <OverheadView />}
      {tab === 'rforecast' && <RegionalForecastView />}
      {tab === 'potential' && <PotentialView />}
      {tab === 'kpi' && <KpiView />}
      {tab === 'rscenario' && <RegionScenarioView />}
      {tab === 'data' && <DataStatus overview={data} />}
    </div>
  );
}