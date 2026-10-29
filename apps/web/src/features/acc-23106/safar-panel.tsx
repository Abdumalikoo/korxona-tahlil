'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconAlert, IconSearch } from '@/components/ui/icons';
import { ModdaPicker } from '@/components/shared/modda-picker';
import { Money } from '@/components/ui/money';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { choiceReady, EMPTY_CHOICE, PlacePicker, useChoiceLabel, type MoveChoice } from '@/features/unit-payroll/place-picker';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatDateTime, formatPeriod, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';
import { safarApi, type SafarConfirmItem, type SafarPost, type SafarRow } from './api';

// ═══════════════════════════════════════════════════════════
// 23106 › Xizmat safari — bo'limlarga yo'naltirish.
// Xizmat safari pullari soliq hisobotida ham, ish haqi tarkibida ham yo'q — yagona manba shu ko'chirma.
// Saqlangan ko'chirmadan safar to'lovlari ajratiladi → har biri xodimning to'langan oydagi joyiga (bo'limiga)
// bog'lanadi → foydalanuvchi tekshiradi (joyini o'zgartirishi mumkin) → TASDIQLAYDI → shu joyga xarajat bo'lib yoziladi.
// ═══════════════════════════════════════════════════════════

type Filter = 'ALL' | 'PENDING' | 'ISSUE' | 'POSTED';
const PAGE = 100;
const rowId = (r: SafarRow) => `${r.period}|${r.key}`;

export function SafarPanel({ from, to, rangeText, disabled, isAdmin, reloadKey, onToast }: { from: string; to: string; rangeText: string; disabled: boolean; isAdmin: boolean; reloadKey: number; onToast: (t: { message: string; tone: 'success' | 'error' }) => void }) {
  const data = useAsync(() => (disabled ? Promise.resolve(null) : safarApi.view(from, to).then((r) => r.data)), [from, to, disabled, reloadKey]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [places, setPlaces] = useState<Record<string, MoveChoice>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [filter, setFilter] = useState<Filter>('PENDING');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<SafarPost | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const v = data.data;
  // Yangi ma'lumot: joyi aniqlangan, tasdiqlanmagan to'lovlar — belgilangan; qo'lda tanlovlar tozalanadi
  const [seen, setSeen] = useState<typeof v>(null);
  if (v && v !== seen) {
    setSeen(v);
    setPicked(new Set(v.rows.filter((r) => !r.posted && r.place).map(rowId)));
    setPlaces({});
    setEditing(null);
    setCategory((c) => (c && v.categories.options.some((o) => o.code === c) ? c : v.categories.defaultCode));
    setPage(1);
  }

  const ready = (r: SafarRow) => !r.posted && (Boolean(r.place) || (places[rowId(r)] ? choiceReady(places[rowId(r)]!) : false));
  const selected = v ? v.rows.filter((r) => picked.has(rowId(r)) && ready(r)) : [];
  const selectedTotal = selected.reduce((s, r) => s + BigInt(r.amountTiyin), 0n);

  const shown = useMemo(() => {
    if (!v) return [];
    const t = q.trim().toLowerCase();
    return v.rows.filter((r) => {
      if (filter === 'PENDING' && r.posted) return false;
      if (filter === 'ISSUE' && (r.posted || r.place)) return false;
      if (filter === 'POSTED' && !r.posted) return false;
      if (!t) return true;
      return (r.fullName ?? r.commentName ?? r.accountName).toLowerCase().includes(t) || (r.pinfl ?? '').includes(t) || (r.orderNo ?? '').toLowerCase().includes(t) || (r.posted?.place.label ?? r.place?.label ?? '').toLowerCase().includes(t);
    });
  }, [v, filter, q]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const slice = shown.slice((page - 1) * PAGE, page * PAGE);

  function toggle(r: SafarRow) {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(rowId(r))) n.delete(rowId(r));
      else n.add(rowId(r));
      return n;
    });
  }

  function choose(r: SafarRow, c: MoveChoice) {
    setPlaces((p) => ({ ...p, [rowId(r)]: c }));
    if (choiceReady(c)) {
      setPicked((s) => new Set(s).add(rowId(r)));
      if (r.place) setEditing(null);
    }
  }

  function resetPlace(r: SafarRow) {
    setPlaces((p) => {
      const n = { ...p };
      delete n[rowId(r)];
      return n;
    });
    setEditing(null);
    if (!r.place) setPicked((s) => {
      const n = new Set(s);
      n.delete(rowId(r));
      return n;
    });
  }

  // Tanlanganlar — joylar kesimida (tasdiqlash oynasi uchun)
  const selectedByPlace = new Set(
    selected.map((r) => {
      const c = places[rowId(r)];
      const p = c && choiceReady(c) ? { unit: c.target, departmentId: c.place.departmentId, regionCode: c.place.regionCode, districtId: c.place.districtId } : r.place!;
      return p.unit === 'CENTER' ? `CENTER|${p.departmentId ?? ''}` : p.unit === 'REGION' ? `REGION|${p.regionCode ?? ''}|${p.districtId ?? ''}` : p.unit;
    }),
  ).size;

  async function handleConfirm() {
    if (!selected.length) return;
    setSaving(true);
    try {
      const items: SafarConfirmItem[] = selected.map((r) => {
        const c = places[rowId(r)];
        return c && choiceReady(c) ? { key: r.key, period: r.period, place: { unit: c.target, ...c.place } } : { key: r.key, period: r.period };
      });
      const res = (await safarApi.confirm({ items, categoryCode: category })).data;
      onToast({ message: `Tasdiqlandi: ${res.count} ta to'lov · ${formatTiyin(res.totalTiyin)} so'm · ${res.units} ta joyga xarajat bo'lib yozildi`, tone: 'success' });
      data.reload();
    } catch (err) {
      onToast({ message: errorMessage(err, 'Tasdiqlashda xatolik'), tone: 'error' });
    } finally {
      setSaving(false);
      setAsking(false);
    }
  }

  async function handleCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      const r = (await safarApi.cancel(cancelTarget.id)).data;
      onToast({ message: `Tasdiq bekor qilindi — ${r.expenses} ta xarajat yozuvi o'chirildi`, tone: 'success' });
      data.reload();
    } catch (err) {
      onToast({ message: errorMessage(err, 'Bekor qilishda xatolik'), tone: 'error' });
    } finally {
      setCancelling(false);
      setCancelTarget(null);
    }
  }

  if (disabled) return null;
  if (data.loading && !v) return <LoadingState />;
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />;
  if (!v || !v.rows.length) {
    return (
      <Card>
        <CardHeader title="Xizmat safari — bo'limlarga yo'naltirish" description={`${rangeText || 'Tanlangan davr'}: saqlangan ko'chirmada xizmat safari to'lovi yo'q`} />
      </Card>
    );
  }
  const s = v.summary;
  const counts: Record<Filter, number> = { ALL: v.rows.length, PENDING: v.rows.filter((r) => !r.posted).length, ISSUE: v.rows.filter((r) => !r.posted && !r.place).length, POSTED: s.postedCount };

  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader
          title="Xizmat safari — bo'limlarga yo'naltirish"
          description="Bu pullar soliq hisobotida ham, ish haqi tarkibida ham yo'q — yagona manba shu ko'chirma. Har to'lov xodimning to'langan oydagi joyiga bog'landi: tekshiring, kerak bo'lsa joyini o'zgartiring va tasdiqlang. Tasdiqlangandan keyingina bo'limlarga xarajat bo'lib yoziladi."
        />
        <CardBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Box label="Xizmat safari" value={String(s.count)} sub={`${formatTiyin(s.totalTiyin)} so'm${s.advanceCount ? ` · ${s.advanceCount} tasi avans («bunak»)` : ''}`} />
            <Box label="Tasdiqlangan" value={String(s.postedCount)} sub={`${formatTiyin(s.postedTiyin)} so'm — xarajatda`} tone={s.postedCount ? 'income' : 'neutral'} />
            <Box label="Tasdiqlashga tayyor" value={String(s.readyCount)} sub={`${formatTiyin(s.readyTiyin)} so'm — joyi aniqlangan`} tone={s.readyCount ? 'warn' : 'neutral'} />
            <Box label="Joyi aniqlanmagan" value={String(s.issueCount)} sub={s.issueCount ? `${formatTiyin(s.issueTiyin)} so'm — joyini qo'lda tanlang` : "hammasining joyi bor"} tone={s.issueCount ? 'expense' : 'income'} />
          </div>

          <div className="rounded-(--radius-control) border border-(--color-line)">
            <p className="border-b border-(--color-line) px-3 py-2 text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">Joylar kesimida</p>
            <ul className="divide-y divide-(--color-line) text-sm">
              {v.byUnit.map((u) => (
                <li key={u.label} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
                  <span className={cn('min-w-0 flex-1 font-medium', u.label.startsWith('—') ? 'text-(--color-expense)' : 'text-heading')}>{u.label}</span>
                  <span className="text-xs text-(--color-text-muted)">{u.count} ta</span>
                  {u.postedTiyin !== '0' && <span className="text-xs text-(--color-income)">tasdiqlangan <span className="money">{formatTiyin(u.postedTiyin)}</span></span>}
                  {u.pendingTiyin !== '0' && <span className="text-xs text-(--color-warn)">kutmoqda <span className="money">{formatTiyin(u.pendingTiyin)}</span></span>}
                  <Money tiyin={u.totalTiyin} tone="expense" />
                </li>
              ))}
            </ul>
          </div>
        </CardBody>

        <div className="flex flex-wrap items-center gap-2 border-y border-(--color-line) px-5 py-2.5">
          {(
            [
              ['PENDING', 'Tasdiqlanmagan'],
              ['ISSUE', 'Joyi aniqlanmagan'],
              ['POSTED', 'Tasdiqlangan'],
              ['ALL', 'Hammasi'],
            ] as [Filter, string][]
          ).map(([k, label]) => (
            <Chip
              key={k}
              active={filter === k}
              onClick={() => {
                setFilter(k);
                setPage(1);
              }}
            >
              {label} <span className="money opacity-70">{counts[k]}</span>
            </Chip>
          ))}
          <label className="relative ml-auto">
            <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-(--color-text-faint)" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="F.I.Sh., PINFL, buyruq, joy"
              className="h-8 w-60 rounded-(--radius-control) border border-(--color-line-strong) bg-white pr-3 pl-8 text-sm focus:border-brand-600 focus:outline-none"
            />
          </label>
        </div>

        <div className="max-h-[620px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-[1] bg-(--color-surface-muted) text-[11px] uppercase tracking-wide text-(--color-text-muted)">
              <tr>
                {isAdmin && <th className="w-10 px-3 py-2" />}
                <th className="w-28 px-3 py-2 text-left font-semibold">Sana</th>
                <th className="px-2 py-2 text-left font-semibold">Xodim</th>
                <th className="w-36 px-2 py-2 text-right font-semibold">Summa</th>
                <th className="px-3 py-2 text-left font-semibold">Qayerga (bo&apos;lim)</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((r) => {
                const id = rowId(r);
                const choice = places[id];
                const manual = choice && choiceReady(choice);
                const can = isAdmin && !r.posted;
                return (
                  <tr key={id} className={cn('border-t border-(--color-line) align-top', r.posted && 'bg-(--color-income-soft)/20', !r.posted && !r.place && !manual && 'bg-(--color-expense-soft)/20')}>
                    {isAdmin && (
                      <td className="px-3 py-2.5">
                        {can && <input type="checkbox" aria-label="Tasdiqlashga belgilash" className="size-4 accent-brand-600" checked={picked.has(id) && ready(r)} disabled={!ready(r)} onChange={() => toggle(r)} />}
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <span className="money block">{formatDate(r.docDate)}</span>
                      <span className="money text-[11px] text-(--color-text-muted)">№ {r.docNo}</span>
                    </td>
                    <td className="px-2 py-2">
                      <span className="block font-medium text-heading">{r.fullName ?? r.commentName ?? r.accountName}</span>
                      <span className="flex flex-wrap items-center gap-1 text-[11px] text-(--color-text-muted)">
                        {r.pinfl && <span className="money">{r.pinfl}</span>}
                        {r.advance && (
                          <Badge tone="brand" className="px-1.5 py-0 text-[10px]">
                            avans
                          </Badge>
                        )}
                        {(r.orderNo || r.orderDate) && <span>· buyruq {r.orderDate ? formatDate(r.orderDate) : ''}{r.orderNo ? ` № ${r.orderNo}` : ''}</span>}
                      </span>
                    </td>
                    <td className="money px-2 py-2 text-right">
                      <Money tiyin={r.amountTiyin} tone="expense" />
                    </td>
                    <td className="px-3 py-2">
                      {r.posted ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-heading">{r.posted.place.label}</span>
                          <Badge tone="income">tasdiqlangan</Badge>
                          {!r.posted.auto && <span className="text-[11px] text-(--color-text-muted)">qo&apos;lda tanlangan</span>}
                        </span>
                      ) : editing === id || (!r.place && can) ? (
                        <div className="space-y-1">
                          {!r.place && r.issueText && (
                            <p className="flex items-center gap-1 text-[11px] text-(--color-expense)">
                              <IconAlert className="size-3.5 shrink-0" />
                              {r.issueText}
                            </p>
                          )}
                          <PlacePicker value={choice ?? EMPTY_CHOICE} onChange={(c) => choose(r, c)} />
                          {(r.place || choice) && (
                            <button type="button" className="text-[11px] font-medium text-(--color-text-muted) hover:text-heading" onClick={() => resetPlace(r)}>
                              {r.place ? `Dastur aniqlaganiga qaytarish (${r.place.label})` : 'Tanlovni tozalash'}
                            </button>
                          )}
                        </div>
                      ) : manual ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <ChoiceText c={choice} />
                          <Badge tone="warn">qo&apos;lda</Badge>
                          {can && (
                            <button type="button" className="text-[11px] font-medium text-brand-700 hover:underline" onClick={() => setEditing(id)}>
                              o&apos;zgartirish
                            </button>
                          )}
                        </span>
                      ) : r.place ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-heading">{r.place.label}</span>
                          {can && (
                            <button type="button" className="text-[11px] font-medium text-brand-700 hover:underline" onClick={() => setEditing(id)}>
                              o&apos;zgartirish
                            </button>
                          )}
                        </span>
                      ) : (
                        <span className="text-[11px] text-(--color-expense)">{r.issueText}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!slice.length && (
                <tr>
                  <td colSpan={isAdmin ? 5 : 4} className="py-6 text-center text-sm text-(--color-text-muted)">
                    Bu tanlovda to&apos;lov yo&apos;q
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-(--color-line) px-4 py-2 text-xs text-(--color-text-muted)">
            <span>
              {shown.length} tadan {(page - 1) * PAGE + 1}–{Math.min(page * PAGE, shown.length)}
            </span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Oldingi
              </Button>
              <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Keyingi
              </Button>
            </div>
          </div>
        )}

        {isAdmin && counts.PENDING > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-t border-(--color-line) bg-(--color-surface-muted) px-5 py-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-(--color-text-muted)">Modda:</span>
              <ModdaPicker size="sm" className="w-72" options={v.categories.options} value={category} onChange={setCategory} />
            </div>
            <span className="ml-auto text-sm text-(--color-text-muted)">
              Belgilangan: <b className="text-heading">{selected.length}</b> ta · <span className="money font-semibold text-heading">{formatTiyin(selectedTotal.toString())}</span> so&apos;m
            </span>
            <Button onClick={() => setAsking(true)} disabled={!selected.length} loading={saving}>
              Tasdiqlash va bo&apos;limlarga yozish
            </Button>
          </div>
        )}
      </Card>

      {v.posts.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader title="Xizmat safari tasdiqlari" description="Har oy — alohida tasdiq. Ko'chirma almashtirilsa yoki bekor qilinsa, o'sha oy tasdig'i ham bekor bo'ladi (qayta tasdiqlanadi)" />
          <ul className="divide-y divide-(--color-line) text-sm">
            {v.posts.slice(0, 30).map((p) => (
              <li key={p.id} className={cn('flex flex-wrap items-center gap-3 px-5 py-2.5', p.status === 'CANCELLED' && 'opacity-50')}>
                <span className="min-w-0 flex-1 font-medium">{p.months.map(formatPeriod).join(', ')}</span>
                <span className="text-xs text-(--color-text-muted)">{p.count} ta</span>
                <Money tiyin={p.totalTiyin} tone="expense" />
                <span className="text-xs text-(--color-text-muted)">
                  {formatDateTime(p.createdAt)} · {p.createdBy}
                </span>
                {p.status === 'CANCELLED' ? (
                  <Badge tone="neutral">bekor qilingan{p.cancelReason ? ` — ${p.cancelReason}` : ''}</Badge>
                ) : isAdmin ? (
                  <Button size="sm" variant="ghost" className="text-(--color-text-muted) hover:text-(--color-expense)" onClick={() => setCancelTarget(p)}>
                    Bekor qilish
                  </Button>
                ) : (
                  <Badge tone="income">xarajatda</Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ConfirmDialog
        open={asking}
        title="Xizmat safarini tasdiqlash"
        message={`${selected.length} ta to'lov (${formatTiyin(selectedTotal.toString())} so'm) ${selectedByPlace} ta joyga «${v.categories.options.find((o) => o.code === category)?.label.replace(' — yangi modda yaratiladi', '') ?? category}» moddasi bo'yicha xarajat bo'lib yoziladi. Oy — to'langan sana oyi. Keyin bekor qilish mumkin.`}
        confirmLabel="Tasdiqlash"
        loading={saving}
        onConfirm={() => void handleConfirm()}
        onCancel={() => setAsking(false)}
      />
      <ConfirmDialog
        open={cancelTarget !== null}
        title="Tasdiqni bekor qilish"
        message={`${cancelTarget ? cancelTarget.months.map(formatPeriod).join(', ') : ''}: ${cancelTarget?.count ?? 0} ta xizmat safari xarajati o'chiriladi. To'lovlar ko'chirmada qoladi — keyin qayta tasdiqlash mumkin.`}
        confirmLabel="Bekor qilish"
        danger
        loading={cancelling}
        onConfirm={() => void handleCancel()}
        onCancel={() => setCancelTarget(null)}
      />
    </>
  );
}

function ChoiceText({ c }: { c: MoveChoice }) {
  const label = useChoiceLabel(c);
  return <span className="font-medium text-heading">{label}</span>;
}

function Box({ label, value, sub, tone = 'neutral' }: { label: string; value: string; sub: string; tone?: 'neutral' | 'income' | 'expense' | 'warn' }) {
  const c = { neutral: 'text-(--color-text)', income: 'text-(--color-income)', expense: 'text-(--color-expense)', warn: 'text-(--color-warn)' }[tone];
  return (
    <div className="rounded-(--radius-card) border border-(--color-line) bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">{label}</p>
      <p className={cn('money mt-1.5 text-xl font-semibold', c)}>{value}</p>
      <p className="mt-0.5 text-xs text-(--color-text-muted)">{sub}</p>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn('rounded-full border px-3 py-1 text-xs font-medium', active ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-(--color-line) bg-white text-(--color-text-muted) hover:text-heading')}>
      {children}
    </button>
  );
}
