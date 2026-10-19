'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import { SalaryStructureCard } from '@/features/salary-composition/salary-structure';

/**
 * Xarajat tarkibi — "Pul qayerga ketmoqda?"
 * Hozircha: ish haqi tuzilmasi (eng katta xarajat moddasi).
 */
export function ExpensesTab({ range }: { range: DateRange }) {
  return (
    <div className="space-y-4">
      <SalaryStructureCard range={range} />
    </div>
  );
}
