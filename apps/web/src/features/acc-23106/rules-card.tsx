'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Money } from '@/components/ui/money';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { useState } from 'react';
import { acc23106Api, type KindRuleRow, type ReclassifyResult } from './api';

// ═══════════════════════════════════════════════════════════
// 23106 › Guruhlash qoidalari: «izohida shu matn bo'lsa — shu guruh» ro'yxati, har biri qancha to'lovga tushgani;
// o'chirilsa — to'lovlar dastur aniqlagan guruhga qaytadi. Qo'lda belgilanganlar soni ham ko'rsatiladi.
// ═══════════════════════════════════════════════════════════

export function RulesCard({ isAdmin, reloadKey, onChanged }: { isAdmin: boolean; reloadKey: number; onChanged: (r: ReclassifyResult, what: string) => void }) {
  const data = useAsync(() => acc23106Api.rules().then((r) => r.data), [reloadKey]);
  const [target, setTarget] = useState<KindRuleRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = data.data;
  if (!d || (!d.rules.length && !d.manual.keys)) return null;

  async function remove() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const r = (await acc23106Api.deleteRule(target.id)).data;
      onChanged(r, `Qoida o'chirildi: «${target.text}»`);
      setTarget(null);
      data.reload();
    } catch (err) {
      setError(errorMessage(err, "O'chirib bo'lmadi"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={`Guruhlash qoidalari · ${d.rules.length} ta`}
        description={`Izohida shu matn bo'lsa — to'lov shu guruhga o'tadi (saqlanganlarga ham, keyingi yuklashlarga ham).${d.manual.keys ? ` Qo'lda belgilangan: ${d.manual.count} ta to'lov · ${formatTiyin(d.manual.totalTiyin)} so'm.` : ''}`}
      />
      {d.rules.length > 0 && (
        <ul className="divide-y divide-(--color-line) text-sm">
          {d.rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="text-(--color-text-muted)">izohida </span>
                <b className="text-heading">«{r.text}»</b>
                <span className="text-(--color-text-muted)"> → </span>
                <Badge tone="brand">{r.kindLabel}</Badge>
              </span>
              <span className="text-xs text-(--color-text-muted)">{r.count} ta to&apos;lov</span>
              <Money tiyin={r.totalTiyin} />
              <span className="text-xs text-(--color-text-faint)">
                {formatDateTime(r.createdAt)}
                {r.createdBy ? ` · ${r.createdBy}` : ''}
              </span>
              {isAdmin && (
                <Button size="sm" variant="ghost" className="text-(--color-text-muted) hover:text-(--color-expense)" onClick={() => setTarget(r)}>
                  O&apos;chirish
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="px-5 pb-3 text-xs text-(--color-expense)">{error}</p>}
      <ConfirmDialog
        open={target !== null}
        title="Qoidani o'chirish"
        message={`«${target?.text ?? ''}» qoidasi o'chiriladi — ${target?.count ?? 0} ta to'lov dastur aniqlagan guruhga qaytadi.`}
        confirmLabel="O'chirish"
        danger
        loading={busy}
        onConfirm={() => void remove()}
        onCancel={() => setTarget(null)}
      />
    </Card>
  );
}
