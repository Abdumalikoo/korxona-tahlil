'use client';

import { changeOf, DiffCell, MoneyCell, NameCell, PctCell, ReportCard, RTable, TableNote, Td, Th, Tr } from '@/components/report/report';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { expensesApi } from '@/features/expenses/api';
import { useAsync } from '@/lib/use-async';
import type { Span } from './api';

// ═══════════════════════════════════════════════════════════
// Xarajat › Xarajat xulqi: modda turi bo'yicha — doimiy (hajmdan qat'i nazar to'lanadi),
// o'zgaruvchan (faoliyatga bog'liq) va aralash; joriy va o'tgan davr. Manba — xarajat yozuvlari
// (modda kartasidagi «turi»). Eski «Xarajatlar › Tahlil» sahifasidan ko'chirildi.
// ═══════════════════════════════════════════════════════════

const ROWS = [
  { key: 'fixedTiyin', label: 'Doimiy', sub: "hajmdan qat'i nazar to'lanadi (ijara, ish haqi …)" },
  { key: 'variableTiyin', label: "O'zgaruvchan", sub: "faoliyat hajmiga bog'liq" },
  { key: 'mixedTiyin', label: 'Aralash', sub: 'qisman doimiy, qisman o‘zgaruvchan' },
] as const;

export function BehaviorCard({ cur, prev }: { cur: Span; prev: Span }) {
  const now = useAsync(() => expensesApi.summaryByBehavior({ dateFrom: cur.from, dateTo: cur.to }).then((r) => r.data), [cur.from, cur.to]);
  const before = useAsync(() => expensesApi.summaryByBehavior({ dateFrom: prev.from, dateTo: prev.to }).then((r) => r.data), [prev.from, prev.to]);

  const a = now.data;
  const b = before.data;
  const total = a ? Number(a.totalTiyin) : 0;
  const prevTotal = b ? Number(b.totalTiyin) : 0;

  return (
    <ReportCard title="Xarajat xulqi: doimiy, o'zgaruvchan, aralash" badge="modda turi bo'yicha · o'tgan davr bilan">
      {now.error ? (
        <ErrorState message={now.error} onRetry={now.reload} />
      ) : !a ? (
        <LoadingState />
      ) : (
        <>
          <RTable minWidth={760}>
            <thead>
              <tr>
                <Th className="min-w-56 text-left">Turi</Th>
                <Th>O&apos;tgan davr</Th>
                <Th>Joriy davr</Th>
                <Th>Farqi, foizda</Th>
                <Th>Ulushi</Th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => {
                const v = Number(a[r.key]);
                const p = b ? Number(b[r.key]) : 0;
                return (
                  <Tr key={r.key}>
                    <NameCell sticky={false} sub={r.sub}>
                      {r.label}
                    </NameCell>
                    <MoneyCell value={p} />
                    <MoneyCell value={v} strong />
                    <DiffCell value={v - p} pct={changeOf(v, p)} growthGood={false} />
                    <PctCell value={total > 0 ? (v / total) * 100 : null} plain className="font-normal text-(--color-text-muted)" />
                  </Tr>
                );
              })}
              <Tr total>
                <NameCell sticky={false}>Jami</NameCell>
                <MoneyCell value={prevTotal} />
                <MoneyCell value={total} />
                <DiffCell value={total - prevTotal} pct={changeOf(total, prevTotal)} growthGood={false} />
                <Td />
              </Tr>
            </tbody>
          </RTable>
          <TableNote>
            Turi — har xarajat moddasining sozlamasi (Sozlamalar › Xarajat moddalari). Jami — xarajat yozuvlari bo&apos;yicha; ish haqi, bank va boshqa manbalardan
            hisoblangan summalar yuqoridagi jadvallarda bo&apos;lgani uchun bu yerdagi jami ulardan farq qilishi mumkin.
          </TableNote>
        </>
      )}
    </ReportCard>
  );
}
