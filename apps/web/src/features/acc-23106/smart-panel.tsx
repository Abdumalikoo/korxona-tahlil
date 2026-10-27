'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Money } from '@/components/ui/money';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatPeriod, formatTiyin } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';
import { KIND_LABEL, purposePattern, type PayoutKind, type PayoutRow, type ReanalyzePreview } from './api';

// ═══════════════════════════════════════════════════════════
// 23106 › Aqlli tahlil paneli:
//  • Qayta tahlil alohida bosilmaydi — ko'chirma YUKLANGANDA tahlil oynasida eski oylarda nima o'zgarishi ko'rsatiladi
//    (ReanalyzeMoves) va «Saqlash» bilan birga qo'llanadi. Qo'lda belgilanganlar va qoidalar ustun qoladi.
//  • «Tekshirish kerak» — dastur ikkilangan izohlar (faqat taxminiy moslik yoki ikki guruh deyarli teng):
//    bir bosishda «to'g'ri» yoki taklif qilingan guruhga o'tkazish.
// ═══════════════════════════════════════════════════════════

interface ReviewGroup {
  id: string;
  example: string;
  kind: PayoutKind;
  alt: PayoutKind | null;
  hits: string[];
  count: number;
  total: number;
  keys: string[];
}

const keyOf = (r: PayoutRow) => r.key ?? `${r.docDate}|${r.docNo}|${r.debitTiyin}|${r.inn}`;
const REVIEW_PAGE = 20;

export function SmartPanel({
  rows,
  isAdmin,
  move,
}: {
  rows: PayoutRow[];
  isAdmin: boolean;
  /** Qo'lda guruhga o'tkazish (keys → kind) */
  move?: (keys: string[], kind: PayoutKind) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [limit, setLimit] = useState(REVIEW_PAGE);

  /** Aqlli tahlil saqlangan turdan farq qiladigan to'lovlar (qayta tahlil qo'llanmagan) */
  const pending = useMemo(() => rows.filter((r) => r.kindSource === 'AUTO' && r.smartKind && r.smartKind !== r.kind), [rows]);
  /** Tekshirish kerak: aqlli tahlilning o'zi ikkilangan */
  const review = useMemo(() => {
    const map = new Map<string, ReviewGroup>();
    for (const r of rows) {
      if (r.kindSource !== 'AUTO' || r.confidence !== 'LOW' || (r.smartKind && r.smartKind !== r.kind)) continue;
      const id = `${r.kind}|${r.alt ?? ''}|${purposePattern(r.purpose)}`;
      const g = map.get(id) ?? { id, example: (r.purpose ?? '').replace(/\s+/g, ' ').trim(), kind: r.kind, alt: r.alt ?? null, hits: r.hits ?? [], count: 0, total: 0, keys: [] };
      g.count += 1;
      g.total += Number(r.debitTiyin);
      g.keys.push(keyOf(r));
      map.set(id, g);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [rows]);

  if (!pending.length && !review.length) return null;

  async function act(g: ReviewGroup, kind: PayoutKind) {
    if (!move) return;
    setBusy(g.id);
    setError(null);
    try {
      await move(g.keys, kind);
    } catch (err) {
      setError(errorMessage(err, "Saqlab bo'lmadi"));
    } finally {
      setBusy(null);
    }
  }

  async function acceptAll() {
    if (!move) return;
    setBusy('*');
    setError(null);
    try {
      // Taklif qilingan guruh bo'yicha jamlab — har guruhga bitta so'rov
      const byKind = new Map<PayoutKind, string[]>();
      for (const g of review) byKind.set(g.kind, [...(byKind.get(g.kind) ?? []), ...g.keys]);
      for (const [kind, keys] of byKind) await move(keys, kind);
    } catch (err) {
      setError(errorMessage(err, "Saqlab bo'lmadi"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Aqlli tahlil"
        description="Izohlar ruscha / o'zbekcha, kirill / lotin, o↔a, x↔h almashgan va xato yozilgan bo'lsa ham o'qiladi. Xodim ismi hisobga olinmaydi."
      />

      {/* ── Eski yozuvlar: keyingi yuklashda avtomatik yangilanadi ── */}
      {pending.length > 0 && (
        <div className="border-t border-(--color-line) bg-[#f5f8ff] px-5 py-3 text-sm">
          Bu davrda avval saqlangan <b className="text-heading">{pending.length} ta to&apos;lovni</b> aqlli tahlil boshqacha aniqlaydi (
          {[...new Set(pending.map((r) => `${KIND_LABEL[r.kind]} → ${KIND_LABEL[r.smartKind!]}`))].slice(0, 3).join(', ')} ·{' '}
          <span className="money">{formatTiyin(String(pending.reduce((s, r) => s + Number(r.debitTiyin), 0)))}</span> so&apos;m). Keyingi ko&apos;chirma yuklanib saqlanganda
          avtomatik yangilanadi — yuklash oynasida oldindan ko&apos;rsatiladi.
        </div>
      )}

      {/* ── Tekshirish kerak ── */}
      {review.length > 0 && (
        <div className="border-t border-(--color-line)">
          <div className="flex flex-wrap items-center gap-3 px-5 py-2.5">
            <span className="min-w-0 flex-1 text-sm">
              <b className="text-heading">Tekshirish kerak · {review.reduce((s, g) => s + g.count, 0)} ta to&apos;lov</b>
              <span className="text-(--color-text-muted)"> — dastur ikkilandi: so&apos;z xato bilan topilgan yoki izohda ikki xil guruh bor</span>
            </span>
            {isAdmin && move && (
              <Button size="sm" variant="secondary" onClick={() => void acceptAll()} loading={busy === '*'}>
                Hammasini taklif bo&apos;yicha tasdiqlash
              </Button>
            )}
          </div>
          <ul className="divide-y divide-(--color-line) text-sm">
            {review.slice(0, limit).map((g) => (
              <li key={g.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-2.5">
                <div className="min-w-64 flex-1">
                  <p className="text-[12.5px] leading-snug text-heading">{g.example}</p>
                  <p className="mt-0.5 text-[11px] text-(--color-text-muted)">
                    Dastur: <b className="text-heading">{KIND_LABEL[g.kind]}</b>
                    {g.alt && (
                      <>
                        {' '}
                        yoki <b className="text-heading">{KIND_LABEL[g.alt]}</b>
                      </>
                    )}
                    {g.hits.length > 0 && <> · topilgan: «{g.hits.join('», «')}»</>}
                  </p>
                </div>
                <div className="whitespace-nowrap text-right">
                  <span className="block text-[13px] font-semibold tabular-nums">{formatTiyin(String(g.total))} so&apos;m</span>
                  <span className="block text-[11px] text-(--color-text-muted)">{g.count} ta</span>
                </div>
                {isAdmin && move && (
                  <div className={cn('flex flex-wrap gap-1.5 self-center', busy === g.id && 'pointer-events-none opacity-60')}>
                    <button type="button" onClick={() => void act(g, g.kind)} className="rounded-md border border-(--color-income) bg-white px-2.5 py-1 text-xs font-semibold text-(--color-income) hover:bg-green-50">
                      ✓ {KIND_LABEL[g.kind]}
                    </button>
                    {g.alt && (
                      <button type="button" onClick={() => void act(g, g.alt!)} className="rounded-md border border-brand-300 bg-white px-2.5 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-50">
                        → {KIND_LABEL[g.alt]}
                      </button>
                    )}
                    {g.kind !== 'BOSHQA' && g.alt !== 'BOSHQA' && (
                      <button type="button" onClick={() => void act(g, 'BOSHQA')} className="rounded-md border border-(--color-line) bg-white px-2.5 py-1 text-xs font-medium text-(--color-text-muted) hover:text-heading">
                        Boshqa
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {review.length > limit && (
            <div className="border-t border-(--color-line) px-5 py-2 text-center">
              <button type="button" onClick={() => setLimit((n) => n + REVIEW_PAGE)} className="text-xs font-semibold text-brand-700 hover:underline">
                Yana {Math.min(REVIEW_PAGE, review.length - limit)} ta ko&apos;rsatish ({review.length - limit} qoldi)
              </button>
            </div>
          )}
        </div>
      )}
      {error && <p className="border-t border-(--color-line) px-5 py-2 text-xs text-(--color-expense)">{error}</p>}
    </Card>
  );
}

/** Ko'chirma tahlili oynasida: saqlashda avval saqlangan oylarda nima o'zgaradi (aqlli tahlil) */
export function ReanalyzeMoves({ preview }: { preview: ReanalyzePreview }) {
  if (!preview.changed) return null;
  return (
    <div className="space-y-2 rounded-lg border border-brand-200 bg-[#f5f8ff] px-4 py-3 text-sm">
      <p>
        <b className="text-heading">Aqlli tahlil:</b> saqlash bilan birga avval saqlangan oylardagi <b className="text-heading">{preview.changed} ta to&apos;lovning guruhi yangilanadi</b> ·{' '}
        <span className="money">{formatTiyin(preview.changedTiyin)}</span> so&apos;m
        {preview.months.length ? ` (${preview.months.map(formatPeriod).join(', ')})` : ''}. Qo&apos;lda belgilaganlaringiz va qoidalaringiz o&apos;zgarmaydi.
      </p>
      {preview.leftSafar > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {preview.leftSafar} ta to&apos;lov xizmat safaridan chiqadi — tasdiqlangan bo&apos;lsa, o&apos;sha tasdiqlar va xarajat yozuvlari bekor qilinadi.
        </p>
      )}
      <ul className="divide-y divide-(--color-line) rounded-lg border border-(--color-line) bg-white">
        {preview.moves.map((m) => (
          <li key={`${m.from}>${m.to}`} className="px-3 py-2">
            <details>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                <Badge tone="neutral">{m.fromLabel}</Badge>
                <span className="text-(--color-text-faint)">→</span>
                <Badge tone="brand">{m.toLabel}</Badge>
                <span className="text-xs text-(--color-text-muted)">{m.count} ta</span>
                <span className="ml-auto">
                  <Money tiyin={m.totalTiyin} />
                </span>
              </summary>
              <ul className="mt-2 space-y-1.5 pl-1 text-xs">
                {m.samples.map((x, i) => (
                  <li key={i} className="leading-snug">
                    <span className="money text-(--color-text-muted)">{formatDate(x.docDate)}</span> · {x.purpose}
                    {x.hits.length > 0 && <span className="text-(--color-text-faint)"> — topilgan: {x.hits.join(', ')}</span>}
                  </li>
                ))}
                {m.count > m.samples.length && <li className="text-(--color-text-faint)">… yana {m.count - m.samples.length} ta</li>}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
