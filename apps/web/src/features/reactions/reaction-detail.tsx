'use client';

import { CalcValue } from '@/components/ui/calc';
import { actualCalc, changeCalc, countCalc, effectCalc, expectedCalc, gainCalc, perDayCalc, verdictCalc } from './calcs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Drawer } from '@/components/ui/drawer';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { compact, num, pct, TONE } from '@/features/structure/api';
import { Legend, LineChart } from '@/features/structure/charts';
import { Findings, GroupTitle, KpiStrip, PanelHeader, SmallButton } from '@/features/structure/parts';
import { formatPeriod, formatPeriodShort } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useBrief } from '@/lib/view-mode';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useState } from 'react';
import { downloadReactionFile, reactionsApi, type ItemEvaluation, type ReactionDetail, type Verdict } from './api';
import { AssigneePicker, type PickedAssignee } from './assignee-picker';
import { KindBadge } from './reaction-bar';
import { DueBar, signedSom, StatusBadge, uzDate } from './reaction-list';

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)';
const FIELD = 'h-9 w-full rounded-(--radius-control) border border-(--color-line) bg-white px-2.5 text-sm outline-none focus:border-slate-500';
const LABEL = 'mb-1 block text-xs font-medium text-(--color-text-muted)';

const VERDICT_TONE: Record<Verdict, string> = {
  better: 'bg-(--color-income-soft) text-(--color-income)',
  worse: 'bg-(--color-expense-soft) text-(--color-expense)',
  same: 'bg-(--color-surface-sunken) text-(--color-text-muted)',
  nodata: 'bg-(--color-surface-sunken) text-(--color-text-faint)',
};

function effectText(item: ItemEvaluation): { text: string; tone: string } {
  const effect = Number(item.effectTiyin);
  if (effect === 0) return { text: '0', tone: 'text-(--color-text-muted)' };
  const good = item.kind === 'EXPENSE' ? effect < 0 : effect > 0;
  return { text: signedSom(effect), tone: good ? 'text-(--color-income)' : 'text-(--color-expense)' };
}

// ═══════════════════════════════════════════════════════════
// Modda tafsiloti (qator ochilganda)
// ═══════════════════════════════════════════════════════════

function ItemPanel({ item, canEdit, onRemove }: { item: ItemEvaluation; canEdit: boolean; onRemove: () => void }) {
  /** Qisqa rejim: 12 oylik grafik yashiriladi */
  const brief = useBrief();
  const months = item.months.slice(-12);
  const values = item.monthly.slice(-12).map(Number);
  const yearAgo = item.monthly.length >= 24 ? item.monthly.slice(-24, -12).map(Number) : null;
  const color = item.kind === 'INCOME' ? TONE.income : item.kind === 'EXPENSE' ? TONE.expense : '#23426a';
  return (
    <div className={cn('grid gap-5 bg-(--color-surface-muted) px-5 py-4', !brief && 'lg:grid-cols-[3fr_2fr]')}>
      {!brief && (
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">So&apos;nggi 12 oy</p>
        <div className="rounded-(--radius-control) bg-white p-2">
          <LineChart
            width={640}
            height={230}
            labels={months.map((m) => formatPeriodShort(m).split(' ')[0]!)}
            tooltipLabels={months.map((m) => formatPeriod(m))}
            series={[
              ...(yearAgo ? [{ label: 'Bir yil oldin', color: TONE.axis, values: yearAgo, dashed: true, width: 1.5 }] : []),
              { label: "So'nggi 12 oy", color, values },
            ]}
          />
        </div>
        <div className="mt-1.5">
          <Legend items={[{ color, label: "So'nggi 12 oy", line: true }, ...(yearAgo ? [{ color: TONE.axis, label: 'Bir yil oldin', line: true }] : [])]} />
        </div>
      </div>
      )}
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">Izoh</p>
          <ul className="space-y-1.5 text-sm leading-relaxed">
            {item.notes.map((n) => (
              <li key={n} className="flex gap-2">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-slate-500" />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </div>
        {item.topRecords.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">Kuzatuv davridagi eng katta yozuvlar</p>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-(--color-line)">
                {item.topRecords.slice(0, 6).map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums text-(--color-text-muted)">{uzDate(r.date)}</td>
                    <td className="max-w-[12rem] truncate py-1.5 pr-2" title={r.label}>{r.label}</td>
                    <td className="max-w-[7rem] truncate py-1.5 pr-2 text-(--color-text-muted)">{r.place}</td>
                    <td className="whitespace-nowrap py-1.5 text-right font-medium tabular-nums">{compact(r.amountTiyin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canEdit && (
          <button type="button" onClick={onRemove} className="text-xs text-(--color-text-muted) underline-offset-2 hover:text-(--color-expense) hover:underline">
            Moddani munosabatdan olib tashlash
          </button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Tahrirlash
// ═══════════════════════════════════════════════════════════

function EditDrawer({ data, open, onClose, onSaved }: { data: ReactionDetail; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(data.title);
  const [note, setNote] = useState(data.note ?? '');
  const [dueDate, setDueDate] = useState(data.dueDate);
  const [assignees, setAssignees] = useState<PickedAssignee[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(data.title);
    setNote(data.note ?? '');
    setDueDate(data.dueDate);
    setAssignees(data.assignees.map((a) => ({ pinfl: a.pinfl, fullName: a.fullName, position: a.position, role: a.role })));
    setError(null);
  }, [open, data]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await reactionsApi.update(data.id, {
        title: title.trim(),
        note: note.trim() || null,
        dueDate,
        assignees: assignees.map((a) => ({ pinfl: a.pinfl, role: a.role })),
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Saqlanmadi');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Munosabatni tahrirlash"
      description={data.title}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button size="sm" loading={saving} disabled={!title.trim() || dueDate < data.startDate} onClick={save}>
            Saqlash
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className={LABEL}>Nomi</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} className={FIELD} />
        </label>
        <label className="block">
          <span className={LABEL}>Muddat (kuzatuv {uzDate(data.startDate)} dan boshlangan)</span>
          <input type="date" value={dueDate} min={data.startDate} onChange={(e) => setDueDate(e.target.value)} className={FIELD} />
          <span className="mt-1 block text-xs text-(--color-text-muted)">Muddat o&apos;zgarsa, solishtirish bazasi ham yangi uzunlikka moslashadi.</span>
        </label>
        <div>
          <span className={LABEL}>Mas&apos;ul xodimlar</span>
          <AssigneePicker value={assignees} onChange={setAssignees} />
        </div>
        <label className="block">
          <span className={LABEL}>Vazifa / izoh</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            maxLength={2000}
            className="w-full rounded-(--radius-control) border border-(--color-line) bg-white px-2.5 py-2 text-sm outline-none focus:border-slate-500"
          />
        </label>
        {error && <p className="text-sm text-(--color-expense)">{error}</p>}
      </div>
    </Drawer>
  );
}

// ═══════════════════════════════════════════════════════════
// Nazoratga o'tkazish
// ═══════════════════════════════════════════════════════════

function ControlDrawer({ data, open, onClose, onDone }: { data: ReactionDetail; open: boolean; onClose: () => void; onDone: () => void }) {
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{ itemId: string; label: string; kind: ItemEvaluation['kind']; suggestedTiyin: string }[] | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDone(false);
    setError(null);
    reactionsApi
      .controlPreview(data.id)
      .then((r) => {
        setPreview(r.data);
        setLimits(Object.fromEntries(r.data.map((p) => [p.itemId, String(Math.round(Number(p.suggestedTiyin) / 100))])));
      })
      .catch((e: Error) => setError(e.message));
  }, [open, data.id]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, number> = {};
      for (const [id, value] of Object.entries(limits)) {
        const n = Number(value.replace(/\s/g, '').replace(',', '.'));
        if (!Number.isFinite(n)) throw new Error("Chegara noto'g'ri kiritilgan");
        payload[id] = n;
      }
      await reactionsApi.toControl(data.id, { limits: payload, note: note.trim() || undefined });
      setDone(true);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "O'tkazilmadi");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Nazoratga o'tkazish"
      description="Har bir modda uchun oylik chegara — tizim har oy avtomatik tekshiradi"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {done ? 'Yopish' : 'Bekor qilish'}
          </Button>
          {!done && (
            <Button size="sm" loading={saving} disabled={!preview} onClick={submit}>
              Nazoratga o&apos;tkazish
            </Button>
          )}
        </div>
      }
    >
      {done ? (
        <div className="space-y-3">
          <p className="text-sm">Munosabat Nazoratga o&apos;tkazildi. Endi har bir modda har oy avtomatik hisoblanib, chegara bilan solishtiriladi.</p>
          <Link href="/nazorat" className="text-sm font-medium text-brand-700 hover:underline">
            Nazorat bo&apos;limini ochish →
          </Link>
        </div>
      ) : !preview ? (
        error ? <p className="text-sm text-(--color-expense)">{error}</p> : <p className="text-sm text-(--color-text-muted)">Taklif hisoblanmoqda…</p>
      ) : (
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-(--color-text-muted)">
            Taklif — so&apos;nggi 3 to&apos;liq oy o&apos;rtachasi. Xarajat uchun — <b>oshmasligi kerak bo&apos;lgan</b> oylik summa, daromad va natija uchun — <b>kamida</b> shuncha
            bo&apos;lishi kerak. O&apos;zingiz o&apos;zgartirishingiz mumkin (so&apos;mda).
          </p>
          <ul className="space-y-3">
            {preview.map((p) => (
              <li key={p.itemId}>
                <span className="mb-1 flex items-center gap-2 text-sm">
                  <KindBadge kind={p.kind} />
                  <span className="truncate">{p.label}</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-xs text-(--color-text-muted)">{p.kind === 'EXPENSE' ? 'ko\'pi bilan' : 'kamida'}</span>
                  <input
                    value={limits[p.itemId] ?? ''}
                    onChange={(e) => setLimits((l) => ({ ...l, [p.itemId]: e.target.value }))}
                    inputMode="decimal"
                    className={cn(FIELD, 'text-right tabular-nums')}
                  />
                  <span className="text-xs text-(--color-text-muted)">so&apos;m/oy</span>
                </div>
                <span className="mt-0.5 block text-[11px] text-(--color-text-faint)">taklif: {num(p.suggestedTiyin)} so&apos;m</span>
              </li>
            ))}
          </ul>
          <label className="block">
            <span className={LABEL}>Izoh (ixtiyoriy)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full rounded-(--radius-control) border border-(--color-line) bg-white px-2.5 py-2 text-sm outline-none focus:border-slate-500"
            />
          </label>
          {error && <p className="text-sm text-(--color-expense)">{error}</p>}
        </div>
      )}
    </Drawer>
  );
}

// ═══════════════════════════════════════════════════════════
// Asosiy sahifa
// ═══════════════════════════════════════════════════════════

export function ReactionDetailView({ id }: { id: string }) {
  const router = useRouter();
  const result = useAsync(() => reactionsApi.detail(id).then((r) => r.data), [id]);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<'edit' | 'control' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = result.data;

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bajarilmadi');
    } finally {
      setBusy(null);
    }
  };

  if (result.error) {
    return (
      <Card>
        <ErrorState message={result.error} onRetry={result.reload} />
      </Card>
    );
  }
  if (!data) {
    return (
      <Card>
        <LoadingState label="Munosabat hisoblanmoqda" />
      </Card>
    );
  }

  const gain = Number(data.gainTiyin);
  const canEdit = data.status === 'OPEN';

  return (
    <div className="space-y-4">
      <PanelHeader
        title={data.title}
        description={data.note ?? `Yaratilgan: ${uzDate(data.createdAt.slice(0, 10))}`}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <StatusBadge reaction={data} />
            <SmallButton disabled={busy !== null} onClick={() => run('report', () => downloadReactionFile(data.id, 'report'))}>
              {busy === 'report' ? 'Tayyorlanmoqda…' : 'Excel hisobot'}
            </SmallButton>
            <SmallButton disabled={busy !== null} onClick={() => run('slides', () => downloadReactionFile(data.id, 'slides'))}>
              {busy === 'slides' ? 'Tayyorlanmoqda…' : 'Slaydlar'}
            </SmallButton>
          </div>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <DueBar reaction={data} />
          <p className="text-xs text-(--color-text-muted)">
            Solishtirish bazasi: {uzDate(data.baseFrom)} — {uzDate(data.baseTo)} (belgilashdan oldingi {data.daysTotal} kun)
          </p>
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <>
                <SmallButton onClick={() => setDrawer('edit')}>Tahrirlash</SmallButton>
                <button
                  type="button"
                  onClick={() => setDrawer('control')}
                  className="inline-flex items-center whitespace-nowrap rounded-(--radius-control) bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700"
                >
                  Nazoratga o&apos;tkazish
                </button>
                <SmallButton disabled={busy !== null} onClick={() => run('close', async () => { await reactionsApi.update(data.id, { status: 'CLOSED' }); result.reload(); })}>
                  Yopish
                </SmallButton>
              </>
            )}
            {data.status === 'CLOSED' && (
              <SmallButton disabled={busy !== null} onClick={() => run('open', async () => { await reactionsApi.update(data.id, { status: 'OPEN' }); result.reload(); })}>
                Qayta ochish
              </SmallButton>
            )}
            {data.status === 'CONTROL' && (
              <Link href="/nazorat" className="inline-flex items-center rounded-(--radius-control) border border-(--color-line) bg-white px-2.5 py-1 text-xs font-medium hover:bg-(--color-surface-muted)">
                Nazoratda ({data.controlCount}) →
              </Link>
            )}
            <SmallButton
              disabled={busy !== null}
              className="text-(--color-expense)"
              onClick={() => {
                if (!window.confirm(`«${data.title}» munosabati butunlay o'chirilsinmi?`)) return;
                void run('delete', async () => {
                  await reactionsApi.remove(data.id);
                  router.push('/munosabat');
                });
              }}
            >
              O&apos;chirish
            </SmallButton>
          </div>
        </div>
      </PanelHeader>

      {error && <p className="text-sm text-(--color-expense)">{error}</p>}

      <KpiStrip
        items={[
          { label: 'Moddalar', value: String(data.itemCount), sub: `kuzatuvning ${data.daysPassed}-kuni (jami ${data.daysTotal})` },
          { label: 'Yaxshilandi', value: String(data.better), valueClass: data.better ? 'text-(--color-income)' : undefined, sub: `${data.same} ta o'zgarishsiz`, calc: countCalc(data.items, 'better') },
          { label: 'Yomonlashdi', value: String(data.worse), valueClass: data.worse ? 'text-(--color-expense)' : undefined, sub: data.worse ? "e'tibor talab qiladi" : 'yomonlashgan yo\'q', calc: countCalc(data.items, 'worse') },
          {
            label: "Umumiy ta'sir",
            value: signedSom(gain),
            valueClass: gain > 0 ? 'text-(--color-income)' : gain < 0 ? 'text-(--color-expense)' : undefined,
            sub: "tejalgan xarajat + qo'shimcha daromad",
            calc: gainCalc(data.items, gain),
          },
        ]}
      />

      <Findings notes={data.conclusions} />

      <GroupTitle title="Moddalar" description="Kunlik sur'at: belgilashdan oldingi davr va kuzatuv davri. Qatorni bosing — grafik va tafsilot." />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-(--color-line) bg-(--color-surface-muted)">
              <tr>
                <th className={cn(TH, 'pl-5 text-left')}>Modda</th>
                <th className={cn(TH, 'text-right')}>Avval, kuniga</th>
                <th className={cn(TH, 'text-right')}>Hozir, kuniga</th>
                <th className={cn(TH, 'text-right')}>O&apos;zgarish</th>
                <th className={cn(TH, 'hidden text-right lg:table-cell')}>Kutilgan</th>
                <th className={cn(TH, 'hidden text-right lg:table-cell')}>Haqiqiy</th>
                <th className={cn(TH, 'text-right')}>Ta&apos;sir</th>
                <th className={cn(TH, 'pr-5 text-center')}>Holat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--color-line)">
              {data.items.map((item) => {
                const effect = effectText(item);
                const isOpen = openItem === item.id;
                return (
                  <Fragment key={item.id}>
                    <tr className={cn('cursor-pointer hover:bg-(--color-surface-muted)', isOpen && 'bg-(--color-surface-muted)')} onClick={() => setOpenItem(isOpen ? null : item.id)}>
                      <td className="py-2.5 pl-5 pr-3">
                        <span className="flex items-center gap-2">
                          <span className={cn('text-[10px] text-(--color-text-faint) transition-transform', isOpen && 'rotate-90')}>▶</span>
                          <KindBadge kind={item.kind} />
                          <span className="min-w-0">
                            <span className="block max-w-[22rem] truncate" title={item.label}>{item.label}</span>
                            {item.origin && <span className="text-xs text-(--color-text-faint)">{item.origin}</span>}
                          </span>
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-(--color-text-muted)">
                        <CalcValue calc={perDayCalc(item, 'base')}>{compact(item.base.perDayTiyin)}</CalcValue>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums">
                        {item.track.days ? <CalcValue calc={perDayCalc(item, 'track')}>{compact(item.track.perDayTiyin)}</CalcValue> : '—'}
                      </td>
                      <td className={cn('whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums', VERDICT_TONE[item.verdict].split(' ')[1])}>
                        <CalcValue calc={changeCalc(item)}>{pct(item.changePercent, true)}</CalcValue>
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-(--color-text-muted) lg:table-cell">
                        <CalcValue calc={expectedCalc(item)}>{compact(item.expectedTiyin)}</CalcValue>
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums lg:table-cell">
                        <CalcValue calc={actualCalc(item)}>{compact(item.track.sumTiyin)}</CalcValue>
                      </td>
                      <td className={cn('whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums', effect.tone)}>
                        <CalcValue calc={effectCalc(item)}>{effect.text}</CalcValue>
                      </td>
                      <td className="whitespace-nowrap py-2.5 pl-3 pr-5 text-center">
                        <CalcValue calc={verdictCalc(item)}>
                          <span className={cn('inline-flex rounded px-2 py-0.5 text-[11px] font-semibold', VERDICT_TONE[item.verdict])}>{item.verdictText.split(' (')[0]}</span>
                        </CalcValue>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={8} className="p-0">
                          <ItemPanel
                            item={item}
                            canEdit={canEdit && data.items.length > 1}
                            onRemove={() => {
                              if (!window.confirm(`«${item.label}» munosabatdan olib tashlansinmi?`)) return;
                              void run('remove-item', async () => {
                                await reactionsApi.update(data.id, { removeItemIds: [item.id] });
                                setOpenItem(null);
                                result.reload();
                              });
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-(--color-line) px-5 py-2.5 text-xs leading-relaxed text-(--color-text-muted)">
          Kutilgan — avvalgi kunlik sur&apos;at davom etganda hozirgacha bo&apos;ladigan summa. Ta&apos;sir — haqiqiy minus kutilgan: xarajatda manfiy (yashil) — tejalgan,
          daromadda musbat (yashil) — qo&apos;shimcha tushum. Ish haqi kabi oyda bir marta yoziladigan xarajatlar qisqa davrda keskin ko&apos;rinishi mumkin.
        </p>
      </Card>

      <Card>
        <div className="px-5 py-3.5">
          <h3 className="text-sm font-semibold">Mas&apos;ul xodimlar</h3>
        </div>
        {data.assignees.length === 0 ? (
          <p className="px-5 pb-4 text-sm text-(--color-expense)">
            Mas&apos;ul biriktirilmagan.{' '}
            {canEdit && (
              <button type="button" onClick={() => setDrawer('edit')} className="font-medium underline">
                Biriktirish
              </button>
            )}
          </p>
        ) : (
          <ul className="divide-y divide-(--color-line) border-t border-(--color-line)">
            {data.assignees.map((a) => (
              <li key={a.pinfl} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <span>
                  <span className="font-medium">{a.fullName}</span>
                  {a.position && <span className="ml-2 text-xs text-(--color-text-muted)">{a.position}</span>}
                </span>
                <span className="rounded bg-(--color-surface-sunken) px-2 py-0.5 text-xs text-(--color-text-muted)">{a.role}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <EditDrawer data={data} open={drawer === 'edit'} onClose={() => setDrawer(null)} onSaved={result.reload} />
      <ControlDrawer data={data} open={drawer === 'control'} onClose={() => setDrawer(null)} onDone={result.reload} />
    </div>
  );
}