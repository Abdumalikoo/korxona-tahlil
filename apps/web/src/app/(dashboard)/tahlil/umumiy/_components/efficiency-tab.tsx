'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import { EfficiencyView } from '@/features/econ/efficiency-view';

/** Vaqtincha - keyingi qadamda to'ldiriladi */
export function EfficiencyTab(_props: { range: DateRange }) {
  return <EfficiencyView showModelsLink />;
}