'use client';

import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { IconAlert } from '@/components/ui/icons';
import { formatPeriod, formatTiyin } from '@/lib/format';
import type { NdflSummary } from './plan-api';

// ═══════════════════════════════════════════════════════════
// Soliq hisoboti — nima o'qildi: har ilova (varaq) bo'yicha shu oy summasi, odamlar soni,
// yil boshidan jami (ma'lumot uchun, olinmaydi), ikkala ilovada bor xodimlar.
// ═══════════════════════════════════════════════════════════

export function NdflSummaryCard({ ndfl, period }: { ndfl: NdflSummary; period: string }) {
  const total = BigInt(ndfl.salaryTiyin) + BigInt(ndfl.otherTiyin);
  return (
    <Card>
      <CardHeader
        title="Soliq hisobotidan o'qildi"
        description={`${ndfl.people} xodim · shu oy jami ${formatTiyin(total.toString())} so'm${ndfl.inBoth ? ` · ${ndfl.inBoth} tasi ikkala ilovada (oylik va boshqa daromad qo'shildi)` : ''}`}
      />
      <CardBody className="space-y-3">
        {ndfl.periodMismatch && ndfl.periodHint && (
          <div className="flex items-start gap-2 rounded-(--radius-control) border border-(--color-warn) bg-(--color-warn-soft) px-3 py-2 text-sm text-(--color-warn)">
            <IconAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              Fayl nomida <b>{formatPeriod(ndfl.periodHint)}</b>, tanlangan oy esa <b>{formatPeriod(period)}</b>. To&apos;g&apos;ri oyni tanlaganingizga ishonch hosil qiling (yuqoridagi «Davr»).
            </span>
          </div>
        )}
        <div className="grid gap-2 md:grid-cols-2">
          {ndfl.sheets.map((s) => (
            <div key={s.name} className="rounded-(--radius-control) border border-(--color-line) px-3 py-2.5">
              <p className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">
                {s.name} · {s.label}
              </p>
              <p className="money mt-1 text-lg font-semibold text-heading">{formatTiyin(s.monthTiyin)} so&apos;m</p>
              <p className="text-xs text-(--color-text-muted)">
                shu oy (hisobot davrida) · {s.rows} qator, {s.people} xodim
                {s.zeroMonth ? ` · ${s.zeroMonth} tasiga shu oy hisoblanmagan` : ''}
              </p>
              {s.types.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-xs">
                  {s.types.map((t) => (
                    <li key={t.code} className="flex justify-between gap-3">
                      <span>{t.label} <span className="text-(--color-text-faint)">({t.rows})</span></span>
                      <span className="money">{formatTiyin(t.monthTiyin)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1.5 text-[11px] text-(--color-text-faint)">
                Yil boshidan jami: <span className="money">{formatTiyin(s.cumulativeTiyin)}</span> (o&apos;sib boruvchi — olinmaydi) · daromad solig&apos;i shu oy:{' '}
                <span className="money">{formatTiyin(s.taxMonthTiyin)}</span>
                {s.corrected ? ` · ${s.corrected} ta PINFL soliq idorasi to'g'rilagani bo'yicha olindi` : ''}
              </p>
            </div>
          ))}
        </div>
        {(ndfl.outside ?? 0) > 0 && (
          <p className="rounded-(--radius-control) bg-(--color-surface-muted) px-3 py-2 text-xs text-(--color-text-muted)">
            <b className="text-heading">{ndfl.outside}</b> xodim (<span className="money">{formatTiyin(ndfl.outsideTiyin ?? '0')}</span> so&apos;m) bu bo&apos;limniki emas — Markaz, hududlar yoki boshqa bo&apos;lim xodimlari, olinmadi.
            Butun tashkilot hisobotini Xarajatlar › Soliq hisoboti orqali yuklasangiz, har kim o&apos;z joyiga avtomatik yoziladi.
          </p>
        )}
        {ndfl.monthOverCumulative > 0 && (
          <p className="text-xs text-(--color-warn)">{ndfl.monthOverCumulative} ta qatorda shu oy summasi yil boshidan jamidan katta — faylni tekshiring.</p>
        )}
      </CardBody>
    </Card>
  );
}