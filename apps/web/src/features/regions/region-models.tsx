'use client';

import { BreakevenView, EfficiencyView } from '@/features/econ/efficiency-view';
import { DashboardView } from '@/features/regional-econ/dashboard-view';
import { RegionalDemoPanel } from '@/features/regional-econ/demo-panel';
import { RegionalForecastView } from '@/features/regional-econ/forecast-view';
import { KpiView } from '@/features/regional-econ/kpi-view';
import { PerformanceView } from '@/features/regional-econ/performance-view';
import { PotentialView } from '@/features/regional-econ/potential-view';
import { RegionScenarioView } from '@/features/regional-econ/scenario-view';

// ═══════════════════════════════════════════════════════════
// Solishtirma › Hududlar — hududlarga tegishli modellar (avval «Katta modellar › Hududlar modellari»da edi):
// panel, hudud natijasi, prognoz, salohiyat, KPI, stsenariy, samaradorlik (DEA), zararsizlik.
// ═══════════════════════════════════════════════════════════

export type RegionModelTab = 'panel' | 'perf' | 'rforecast' | 'potential' | 'kpi' | 'rscenario' | 'efficiency' | 'breakeven';

export const REGION_MODEL_TABS: { value: RegionModelTab; label: string; hint: string }[] = [
  { value: 'panel', label: 'Hududlar paneli', hint: 'Barcha hudud modellari bir joyda: holat, sabablar, avtomatik izoh, «nega o‘zgardi?»' },
  { value: 'perf', label: 'Hudud natijasi', hint: 'Har hudud daromadi, xarajati, Markaz ulushi bilan tuzatilgan natijasi va nisbatlari' },
  { value: 'rforecast', label: 'Prognoz', hint: "Hududlar bo'yicha daromad (xizmatlar), ish haqi (xodimlar), xarajat va natija prognozi; aniqlik va versiyalar" },
  { value: 'potential', label: 'Salohiyat', hint: "Barqaror oyna o'rtachasi × o'rtacha o'sish: hudud va xizmatlar salohiyati, foydalanish darajasi" },
  { value: 'kpi', label: 'KPI', hint: 'Hududlar uchun oylik maqsadlar: model taklifi, tasdiqlash, fakt va bajarilish' },
  { value: 'rscenario', label: 'Stsenariy', hint: "«Agar … bo'lsa»: tarif, hajm, maosh, xodimlar, xarajat, Markaz" },
  { value: 'efficiency', label: 'Samaradorlik (DEA)', hint: 'Samaradorlik chegarasi: hududlar bir-biriga nisbatan' },
  { value: 'breakeven', label: 'Zararsizlik', hint: 'Har hudud zararsizlik nuqtasi, xavfsizlik zaxirasi, Markazni qoplash' },
];

export const isRegionModelTab = (v: string): v is RegionModelTab => REGION_MODEL_TABS.some((t) => t.value === v);

export function RegionModel({ tab }: { tab: RegionModelTab }) {
  return (
    <div className="space-y-4">
      {tab === 'panel' && <DashboardView />}
      {tab === 'perf' && <PerformanceView />}
      {tab === 'rforecast' && <RegionalForecastView />}
      {tab === 'potential' && <PotentialView />}
      {tab === 'kpi' && <KpiView />}
      {tab === 'rscenario' && <RegionScenarioView />}
      {tab === 'efficiency' && <EfficiencyView />}
      {tab === 'breakeven' && <BreakevenView />}
      {/* Avval jadval, qolgani pastda: demo (faqat administrator) — oxirida */}
      {tab !== 'efficiency' && tab !== 'breakeven' && <RegionalDemoPanel />}
    </div>
  );
}
