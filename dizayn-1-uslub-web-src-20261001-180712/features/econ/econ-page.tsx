'use client';

import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { ViewTabs } from '@/features/structure/parts';
import { useAsync } from '@/lib/use-async';
import { SmallButton } from '@/features/structure/parts';
import { useState } from 'react';
import { downloadEconFile, econApi } from './api';
import { DataStatus } from './data-status';
import { BreakevenView, EfficiencyView } from './efficiency-view';
import { FactorsView } from './factors-view';
import { ForecastView } from './forecast-view';
import { ScenarioView } from './scenario-view';

type Tab = 'forecast' | 'factors' | 'efficiency' | 'breakeven' | 'scenario' | 'data';

/** Katta modellar sahifasi: bo'limlar (yorliqlar) */
export function EconPage() {
  const overview = useAsync(() => econApi.overview().then((r) => r.data), []);
  const [tab, setTab] = useState<Tab>('forecast');
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
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-(--color-line) px-5 py-2.5">
          <p className="text-xs text-(--color-text-muted)">Barcha modellar bo&apos;yicha avtomatik hisobot — joriy ma&apos;lumot bilan</p>
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
                    await downloadEconFile(kind);
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
      </Card>
      {tab === 'forecast' && <ForecastView overview={data} />}
      {tab === 'factors' && <FactorsView />}
      {tab === 'efficiency' && <EfficiencyView />}
      {tab === 'breakeven' && <BreakevenView />}
      {tab === 'scenario' && <ScenarioView overview={data} />}
      {tab === 'data' && <DataStatus overview={data} />}
    </div>
  );
}