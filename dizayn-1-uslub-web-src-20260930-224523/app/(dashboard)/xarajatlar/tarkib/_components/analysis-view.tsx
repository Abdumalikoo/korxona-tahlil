'use client';

import type { CompositionAnalysis } from '@/features/salary-composition/api';
import { formatTiyin } from '@/lib/format';

import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { IconAlert } from '@/components/ui/icons';
import { CheckLists, CheckSummaryBoxes, StatusBanner, StructureCard } from './shared';

/** Yuklangan fayl tahlili — hali hech narsa saqlanmagan */
export function AnalysisView({
  analysis,
  saving,
  onSave,
  onCancel,
}: {
  analysis: CompositionAnalysis;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { check } = analysis;
  const skipped = analysis.invalidRows.length + analysis.duplicates.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[--color-text-muted]">
          <span className="font-medium text-[--color-text]">{analysis.fileName}</span>
          {' · '}
          {analysis.validRows} ta xodim o&rsquo;qildi
          {skipped > 0 && `, ${skipped} ta qator o‘tkazib yuboriladi`}
          {' · '}
          {analysis.columns.length} ta komponent ustuni topildi
        </p>
      </div>

      <StatusBanner check={check} />
      <CheckSummaryBoxes check={check} />

      {/* Oldingi tarkib almashtiriladi */}
      {analysis.hasPrevious && (
        <div className="rounded-[--radius-card] border border-[--color-warn] bg-[--color-warn-soft] px-4 py-3">
          <div className="flex items-start gap-2.5">
            <IconAlert className="mt-0.5 size-4 shrink-0 text-[--color-warn]" />
            <p className="text-sm text-[--color-warn]">
              Bu oy uchun tarkib allaqachon saqlangan &mdash; saqlasangiz, eskisi yangisi bilan
              almashtiriladi.
            </p>
          </div>
        </div>
      )}

      {/* Xato qatorlar */}
      {analysis.invalidRows.length > 0 && (
        <IssueCard
          title={`Xato qatorlar — ${analysis.invalidRows.length} ta`}
          description="Saqlanmaydi. Faylda tuzatib, qayta yuklang"
          items={analysis.invalidRows.map((row) => ({
            key: String(row.rowIndex),
            label: `${row.rowIndex}-qator`,
            text: row.reason,
          }))}
        />
      )}

      {/* Takroriy PINFL */}
      {analysis.duplicates.length > 0 && (
        <IssueCard
          title={`Takrorlangan PINFL — ${analysis.duplicates.length} ta`}
          description="Faqat birinchi qatori olinadi, qolganlari o'tkazib yuboriladi"
          items={analysis.duplicates.map((row) => ({
            key: `${row.rowIndex}-${row.pinfl}`,
            label: `${row.rowIndex}-qator`,
            text: row.pinfl,
          }))}
        />
      )}

      {/* JAMI ustuni mos emas */}
      {analysis.totalMismatches.length > 0 && (
        <IssueCard
          title={`Fayldagi JAMI ustuni mos emas — ${analysis.totalMismatches.length} ta`}
          description="Tizim komponentlarni o'zi qo'shib hisoblaydi — fayldagi JAMI e'tiborga olinmaydi"
          items={analysis.totalMismatches.map((row) => ({
            key: `${row.rowIndex}-${row.pinfl}`,
            label: `${row.rowIndex}-qator`,
            text: `faylda ${formatTiyin(row.fileTiyin)}, hisoblangan ${formatTiyin(row.computedTiyin)}`,
          }))}
        />
      )}

      {/* Reestrda yo'q */}
      {analysis.unknownEmployees.length > 0 && (
        <IssueCard
          title={`Xodimlar reestrida yo'q — ${analysis.unknownEmployees.length} ta`}
          description="Saqlanadi, lekin bo'lim/hudud ko'rsatilmaydi. Xodimni reestrga qo'shish tavsiya etiladi"
          items={analysis.unknownEmployees.map((row) => ({
            key: `${row.rowIndex}-${row.pinfl}`,
            label: row.pinfl,
            text: row.fileName || `${row.rowIndex}-qator`,
          }))}
        />
      )}

      {/* Faylda yo'q ustunlar */}
      {analysis.missingColumns.length > 0 && (
        <p className="text-xs text-[--color-text-muted]">
          Faylda yo&rsquo;q komponentlar (0 deb olinadi):{' '}
          {analysis.missingColumns.map((column) => column.name).join(', ')}
        </p>
      )}

      <CheckLists check={check} />

      {analysis.byCategory.length > 0 && (
        <StructureCard
          byCategory={analysis.byCategory}
          byComponent={analysis.byComponent}
          description="Fayldagi summalar bo'yicha"
        />
      )}

      {/* Amallar */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {check.state === 'MISMATCH' && (
          <p className="text-xs text-[--color-expense]">
            Farqlar bilan saqlanadi &mdash; &ldquo;Mos emas&rdquo; holati bilan belgilanadi
          </p>
        )}
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Boshqa fayl
        </Button>
        <Button onClick={onSave} loading={saving} disabled={analysis.validRows === 0}>
          Saqlash
        </Button>
      </div>
    </div>
  );
}

function IssueCard({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: { key: string; label: string; text: string }[];
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} description={description} />
      <CardBody className="max-h-48 overflow-y-auto">
        <ul className="space-y-1 text-sm text-[--color-text-muted]">
          {items.map((item) => (
            <li key={item.key}>
              <span className="money text-[--color-text]">{item.label}</span> &mdash; {item.text}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
