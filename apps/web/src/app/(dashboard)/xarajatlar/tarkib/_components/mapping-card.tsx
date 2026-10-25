'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { IconAlert, IconCheck } from '@/components/ui/icons';
import { SKIP_CODE, type CompositionMapping, type CompositionSuggestions, type MappingColumn, type MappingSource, type SalaryComponent } from '@/features/salary-composition/api';
import { formatTiyin } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Ustunlar moslashi: fayldagi har summa ustuni qaysi komponentga yoziladi — dastur taklif qiladi,
// siz tasdiqlaysiz yoki o'zgartirasiz («Qayta hisoblash»). Saqlanganda tanlov eslab qolinadi.
// Soliq hisoboti bilan farq bo'lsa — qaysi ustun farqni yopishi taklif qilinadi.
// ═══════════════════════════════════════════════════════════

const SOURCE: Record<MappingSource, { label: string; tone: 'income' | 'brand' | 'neutral' | 'warn' | 'expense'; hint: string }> = {
  user: { label: 'Siz tanladingiz', tone: 'brand', hint: 'Shu yuklashda tanlangan' },
  learned: { label: "O'rgatilgan", tone: 'income', hint: 'Avval shu sarlavha uchun tanlangan — eslab qolingan' },
  rule: { label: 'Tanish shakl', tone: 'income', hint: 'Buxgalteriya vedomosti / dastur shabloni qoidasi' },
  name: { label: 'Nomi mos', tone: 'income', hint: 'Sarlavha komponent nomi bilan bir xil' },
  similar: { label: 'Taxmin', tone: 'warn', hint: "Sarlavha o'xshashligi bo'yicha — tekshiring" },
  none: { label: 'Tanilmadi', tone: 'expense', hint: 'Komponentni tanlang yoki «Hisobga olinmasin»' },
};

const KIND_LABEL: Record<string, string> = {
  total: 'Jami (ФОТ) — tarkibga qo‘shilmaydi, tekshiruv uchun',
  deduct: 'Ushlanma / to‘lov — hisoblangan ish haqi emas',
  qualifier: 'Foiz, kun, soni — summa emas',
  info: 'Ma’lumot',
};

export function MappingCard({
  mapping,
  suggestions,
  components,
  busy,
  onApply,
}: {
  mapping: CompositionMapping;
  suggestions: CompositionSuggestions | null | undefined;
  components: SalaryComponent[];
  busy: boolean;
  /** Tanlangan moslash bilan qayta o'qish: { ustun harfi: kod | 'SKIP' } */
  onApply: (choice: Record<string, string>) => void;
}) {
  const amount = mapping.columns.filter((c) => c.kind === 'amount');
  const other = mapping.columns.filter((c) => c.kind !== 'amount');
  const initial = useMemo(() => Object.fromEntries(amount.map((c) => [c.letter, c.code ?? SKIP_CODE])), [mapping]); // eslint-disable-line react-hooks/exhaustive-deps
  const [choice, setChoice] = useState<Record<string, string>>(initial);
  const [showAll, setShowAll] = useState(false);
  const [showOther, setShowOther] = useState(false);
  const changed = amount.filter((c) => (choice[c.letter] ?? '') !== (c.code ?? SKIP_CODE));
  const attention = amount.filter((c) => (c.source === 'none' || c.source === 'similar') && c.nonZero > 0);
  const list = showAll ? amount : amount.filter((c) => c.nonZero > 0 || c.source === 'none' || c.source === 'similar');
  const groups = useMemo(() => {
    const g = new Map<string, SalaryComponent[]>();
    for (const c of components.filter((x) => x.isActive)) g.set(c.groupLabel, [...(g.get(c.groupLabel) ?? []), c]);
    return [...g.entries()];
  }, [components]);

  const apply = (patch?: Record<string, string>) => {
    const next = { ...choice, ...(patch ?? {}) };
    setChoice(next);
    // Faqat taklifdan farqli tanlovlar (va taxminlar — tasdiqlash) yuboriladi
    const out: Record<string, string> = {};
    for (const c of amount) {
      const v = next[c.letter];
      if (v === undefined) continue;
      if (v !== (c.code ?? SKIP_CODE) || c.source === 'user') out[c.letter] = v;
    }
    onApply(out);
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Ustunlar va komponentlar"
        description={`Sarlavha ${mapping.headerRows[0] === mapping.headerRows[1] ? `${mapping.headerRows[0]}-qator` : `${mapping.headerRows[0]}–${mapping.headerRows[1]}-qatorlar`} · PINFL — ${mapping.pinflColumn} ustun${mapping.totalColumn ? ` · jami (ФОТ) — ${mapping.totalColumn} ustun` : ''} · ${amount.length} ta summa ustuni`}
        actions={
          attention.length ? (
            <Badge tone="warn">{attention.length} ta ustunni tekshiring</Badge>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-(--color-income)">
              <IconCheck className="size-3.5" /> hammasi tanildi
            </span>
          )
        }
      />

      {/* Farqni yopish takliflari */}
      {suggestions && suggestions.mismatched > 0 && (
        <div className="border-b border-(--color-line) bg-(--color-warn-soft) px-5 py-3 text-sm">
          <p className="flex items-start gap-2 font-medium text-(--color-warn)">
            <IconAlert className="mt-0.5 size-4 shrink-0" />
            {suggestions.mismatched} ta xodimning tarkibi {suggestions.against === 'SOLIQ' ? 'soliq hisobotidagi summaga' : 'fayldagi jami (ФОТ) ustuniga'} mos emas.
            {suggestions.items.length ? ' Dastur qaysi ustun farqni yopishini topdi:' : suggestions.unmappedColumns ? '' : ' Ustunlar moslashini tekshiring.'}
          </p>
          {suggestions.items.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {suggestions.items.slice(0, 6).map((s) => (
                <li key={`${s.letter}-${s.action}`} className="flex flex-wrap items-center gap-2 rounded-(--radius-control) bg-white px-3 py-2">
                  <span className="money font-semibold text-heading">{s.letter}</span>
                  <span className="min-w-0 flex-1 truncate text-(--color-text)" title={s.label}>
                    {s.label.split(' › ').slice(-2).join(' › ')}
                  </span>
                  <span className="text-xs text-(--color-text-muted)">
                    {s.action === 'SKIP'
                      ? `olib tashlansa — ${s.rows} xodimda farq yo'qoladi (ikki marta sanalgan / jami ustun)`
                      : `${s.action === 'ADD_NEG' ? 'ayirilsa' : "qo'shilsa"} — ${s.rows} xodimda farq yopiladi · ${formatTiyin(s.tiyin)}`}
                  </span>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => apply({ [s.letter]: s.code ?? SKIP_CODE })}>
                    {s.action === 'SKIP' ? 'Hisobga olinmasin' : `«${s.codeName ?? s.code}» deb olish`}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {suggestions.allUnmapped > 0 && (
            <p className="mt-1.5 text-xs text-(--color-text-muted)">{suggestions.allUnmapped} ta xodimda farq tanilmagan ustunlarning hammasi birgalikda qo&apos;shilsa yopiladi.</p>
          )}
        </div>
      )}

      <div className="max-h-[460px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-[1] bg-(--color-surface-muted) text-[11px] uppercase tracking-wide text-(--color-text-muted)">
            <tr>
              <th className="w-12 px-3 py-2 text-left font-semibold">Ustun</th>
              <th className="px-2 py-2 text-left font-semibold">Sarlavha</th>
              <th className="w-20 px-2 py-2 text-right font-semibold">Xodim</th>
              <th className="w-36 px-2 py-2 text-right font-semibold">Jami</th>
              <th className="w-72 px-3 py-2 text-left font-semibold">Komponent</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <Row key={c.letter} c={c} value={choice[c.letter] ?? SKIP_CODE} groups={groups} onChange={(v) => setChoice((s) => ({ ...s, [c.letter]: v }))} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-(--color-line) bg-(--color-surface-muted) px-5 py-2.5 text-xs">
        {amount.length > list.length && (
          <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setShowAll((x) => !x)}>
            {showAll ? 'Faqat summasi borlar' : `Hammasi (${amount.length})`}
          </button>
        )}
        {other.length > 0 && (
          <button type="button" className="font-medium text-(--color-text-muted) hover:text-heading" onClick={() => setShowOther((x) => !x)}>
            {showOther ? 'Boshqa ustunlarni yashirish' : `Boshqa ustunlar (${other.length}): jami, ushlanma, foiz…`}
          </button>
        )}
        <span className="text-(--color-text-faint)">Saqlanganda tanlovingiz eslab qolinadi — keyingi oy shu sarlavhalar o&apos;zi taniladi.</span>
        <Button size="sm" className="ml-auto" loading={busy} disabled={!changed.length} onClick={() => apply()}>
          {changed.length ? `Qayta hisoblash (${changed.length} ta o'zgarish)` : 'Qayta hisoblash'}
        </Button>
      </div>

      {showOther && (
        <ul className="max-h-56 space-y-0.5 overflow-y-auto border-t border-(--color-line) px-5 py-2 text-xs text-(--color-text-muted)">
          {other.map((c) => (
            <li key={c.letter} className="flex gap-2">
              <span className="money w-8 shrink-0 font-semibold text-(--color-text)">{c.letter}</span>
              <span className="min-w-0 flex-1 truncate" title={c.label}>
                {c.label.split(' › ').slice(-2).join(' › ')}
              </span>
              <span className="shrink-0">{KIND_LABEL[c.kind] ?? c.kind}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Row({ c, value, groups, onChange }: { c: MappingColumn; value: string; groups: [string, SalaryComponent[]][]; onChange: (v: string) => void }) {
  const src = SOURCE[c.source];
  const edited = value !== (c.code ?? SKIP_CODE);
  return (
    <tr className={cn('border-t border-(--color-line)', c.source === 'none' && c.nonZero > 0 && 'bg-(--color-expense-soft)/40', c.source === 'similar' && 'bg-(--color-warn-soft)/40')}>
      <td className="money px-3 py-1.5 font-semibold text-heading">{c.letter}</td>
      <td className="px-2 py-1.5">
        <span className="block truncate" title={c.label}>
          {c.label.split(' › ').slice(-2).join(' › ')}
        </span>
        <span className="text-[11px] text-(--color-text-muted)">
          <Badge tone={src.tone} className="mr-1 px-1.5 py-0 text-[10px]">
            {src.label}
            {c.source === 'similar' ? ` ${Math.round(c.score * 100)}%` : ''}
          </Badge>
          {c.reason && c.source !== 'none' ? c.reason : src.hint}
        </span>
      </td>
      <td className="money px-2 py-1.5 text-right text-(--color-text-muted)">{c.nonZero}</td>
      <td className="money px-2 py-1.5 text-right">{formatTiyin(c.sumTiyin)}</td>
      <td className="px-3 py-1.5">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn('h-8 w-full rounded-(--radius-control) border bg-white px-2 text-xs focus:outline-none', edited ? 'border-brand-600 text-brand-800' : 'border-(--color-line-strong)', value === SKIP_CODE && 'text-(--color-text-muted)')}
        >
          <option value={SKIP_CODE}>— Hisobga olinmasin</option>
          {groups.map(([g, list]) => (
            <optgroup key={g} label={g}>
              {list.map((x) => (
                <option key={x.code} value={x.code}>
                  {x.name}
                  {x.sign < 0 ? ' (−)' : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </td>
    </tr>
  );
}