'use client';

import type { CompositionAnalysis, SalaryComponent } from '@/features/salary-composition/api';
import { formatTiyin } from '@/lib/format';

import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { IconAlert } from '@/components/ui/icons';
import { MappingCard } from './mapping-card';
import { PlacesCard, type PlaceState } from './places-card';
import { CheckLists, CheckSummaryBoxes, StatusBanner, StructureCard } from './shared';

/** Yuklangan fayl tahlili — hali hech narsa saqlanmagan */
export function AnalysisView({
  analysis,
  saving,
  onSave,
  onCancel,
  onSheet,
  components,
  remapping = false,
  onRemap,
  placeState,
  onPlaceState,
}: {
  analysis: CompositionAnalysis;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  /** Boshqa varaqni o'qish (fayl qayta yuklanmaydi) */
  onSheet?: (sheet: string) => void;
  /** Komponentlar ro'yxati (moslash uchun) */
  components?: SalaryComponent[];
  remapping?: boolean;
  /** Tanlangan ustun moslashi bilan qayta o'qish */
  onRemap?: (mapping: Record<string, string>) => void;
  /** Tarkibdagi bo'limlar: moslik va farqlar tanlovi */
  placeState?: PlaceState | null;
  onPlaceState?: (v: PlaceState) => void;
}) {
  const { check } = analysis;
  const skipped = analysis.invalidRows.length + analysis.duplicates.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-(--color-text-muted)">
          <span className="font-medium text-(--color-text)">{analysis.fileName}</span>
          {' · '}
          {analysis.validRows} ta xodim o&rsquo;qildi
          {skipped > 0 && `, ${skipped} ta qator o‘tkazib yuboriladi`}
          {' · '}
          {analysis.columns.length} ta komponent ustuni topildi
        </p>
      </div>

      {/* Varaq: buxgalteriya vedomostida har oy alohida varaq */}
      {analysis.sheets && analysis.sheets.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 rounded-(--radius-card) bg-(--color-surface-muted) px-4 py-2.5 text-sm">
          <span className="text-(--color-text-muted)">O&rsquo;qilgan varaq:</span>
          <select
            value={analysis.sheetName}
            disabled={!onSheet}
            onChange={(e) => onSheet?.(e.target.value)}
            className="h-9 max-w-full rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-sm font-medium"
          >
            {analysis.sheets.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <span className="text-xs text-(--color-text-muted)">oy nomi bo&rsquo;yicha o&rsquo;zi tanlandi — boshqa oy bo&rsquo;lsa, almashtiring</span>
        </div>
      )}

      <StatusBanner check={check} />
      <CheckSummaryBoxes check={check} />

      {/* Ustunlar → komponentlar: taklif, tasdiqlash, farqni yopish */}
      {analysis.mapping && onRemap && (
        <MappingCard
          key={analysis.mapping.columns.map((c) => `${c.letter}:${c.code ?? '-'}:${c.source}`).join('|') + (analysis.suggestions?.mismatched ?? 0)}
          mapping={analysis.mapping}
          suggestions={analysis.suggestions}
          components={components ?? []}
          busy={remapping}
          onApply={onRemap}
        />
      )}

      {/* Tarkibdagi bo'limlar: xodim shu oy qaysi bo'limda — «miya» bilan farqlar */}
      {analysis.places && analysis.places.rows.length > 0 && placeState && onPlaceState && <PlacesCard places={analysis.places} period={analysis.period} value={placeState} onChange={onPlaceState} />}

      {/* Oldingi tarkib almashtiriladi */}
      {analysis.hasPrevious && (
        <div className="rounded-(--radius-card) border border-(--color-warn) bg-(--color-warn-soft) px-4 py-3">
          <div className="flex items-start gap-2.5">
            <IconAlert className="mt-0.5 size-4 shrink-0 text-(--color-warn)" />
            <p className="text-sm text-(--color-warn)">
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

      {/* Vedomost: ФОТ ga qo'lda qo'shilgan / ayirilgan summa */}
      {analysis.fotAdjustments && analysis.fotAdjustments.length > 0 && (
        <IssueCard
          title={`ФОТ ustunlar yig'indisidan farq qiladi — ${analysis.fotAdjustments.length} ta xodim (jami ${formatTiyin(analysis.fotAdjustments.reduce((s, x) => s + Number(x.diffTiyin), 0))})`}
          description="Vedomostda «Бир ойлик иш ҳақи фонди (ФОТ)» formulasiga ustunsiz summa qo'shilgan yoki ayirilgan. Tarkib ФОТ ga teng bo'lsin deb farq «Vedomost farqi» komponentiga yozildi — buxgalteriyada tekshirib ko'ring"
          items={analysis.fotAdjustments.map((row) => ({
            key: `${row.rowIndex}-${row.pinfl}`,
            label: `${row.rowIndex}-qator`,
            text: `${row.fileName || row.pinfl}: ФОТ ${formatTiyin(row.fileTiyin)}, ustunlar ${formatTiyin(row.computedTiyin)} → farq ${Number(row.diffTiyin) > 0 ? '+' : ''}${formatTiyin(row.diffTiyin)}`,
          }))}
        />
      )}

      {/* Bir xodim ikki qatorda */}
      {analysis.mergedRows && analysis.mergedRows.length > 0 && (
        <IssueCard
          title={`Bir xodim ikki qatorda — ${analysis.mergedRows.length} ta`}
          description="Summalari qo'shildi (masalan ikkinchi lavozim)"
          items={analysis.mergedRows.map((row) => ({
            key: `${row.rowIndex}-${row.pinfl}`,
            label: `${row.rowIndex}-qator`,
            text: `${row.pinfl} → ${row.intoRow}-qatorga qo'shildi`,
          }))}
        />
      )}

      {/* O'qilmagan summa ustunlari */}
      {!analysis.mapping && analysis.skippedColumns && analysis.skippedColumns.length > 0 && (
        <IssueCard
          title={`O'qilmagan ustunlar — ${analysis.skippedColumns.length} ta`}
          description="Summa bor, lekin ФОТ ga kirmaydi yoki boshqa ustun ichida — tarkibga qo'shilmadi"
          items={analysis.skippedColumns.map((c) => ({
            key: c.column,
            label: `${c.column} ustun`,
            text: `${c.label.split(' › ').slice(-2).join(' › ')} — ${c.reason}`,
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
        <p className="text-xs text-(--color-text-muted)">
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
          <p className="text-xs text-(--color-expense)">
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
        <ul className="space-y-1 text-sm text-(--color-text-muted)">
          {items.map((item) => (
            <li key={item.key}>
              <span className="money text-(--color-text)">{item.label}</span> &mdash; {item.text}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}