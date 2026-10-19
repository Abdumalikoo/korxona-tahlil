'use client';

import { useAsOf } from '@/lib/period';
import { Button } from '@/components/ui/button';
import { CalcValue } from '@/components/ui/calc';
import { breachesCalc, controlStatusCalc, limitDiffCalc, projectionCalc, usageCalc } from './calcs';
import { Card } from '@/components/ui/card';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { compact, num, TONE } from '@/features/structure/api';
import { Findings, KpiStrip, Segmented, SmallButton } from '@/features/structure/parts';
import { formatPeriod, formatPeriodShort } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useBrief } from '@/lib/view-mode';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { controlsApi, type ControlMonth, type ControlView } from './api';
import { AssigneePicker, type PickedAssignee } from './assignee-picker';
import { useItemBuilder } from './item-builder';
import { KindBadge } from './reaction-bar';

type Filter = 'all' | 'breach' | 'risk' | 'ok' | 'paused';

const FIELD = 'h-9 w-full rounded-(--radius-control) border border-(--color-line) bg-white px-2.5 text-sm outline-none focus:border-slate-500';
const LABEL = 'mb-1 block text-xs font-medium text-(--color-text-muted)';
const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)';

const STATUS: Record<ControlView['status'], { label: string; tone: string }> = {
  breach: { label: 'Chegara buzildi', tone: 'bg-(--color-expense-soft) text-(--color-expense)' },
  risk: { label: 'Xavf ostida', tone: 'bg-amber-100 text-amber-800' },
  ok: { label: 'Me\'yorda', tone: 'bg-(--color-income-soft) text-(--color-income)' },
  nodata: { label: "To'xtatilgan", tone: 'bg-(--color-surface-sunken) text-(--color-text-muted)' },
};

function StatusPill({ control }: { control: ControlView }) {
  const s = STATUS[control.status];
  return <span className={cn('inline-flex whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-semibold', s.tone)}>{s.label}</span>;
}

function parseSom(text: string): number | null {
  const n = Number(text.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// ═══════════════════════════════════════════════════════════
// Oylar grafigi: ustun — oy summasi, uzuq chiziq — chegara
// ═══════════════════════════════════════════════════════════

export function ControlChart({ control, height = 200, compactMode = false }: { control: ControlView; height?: number; compactMode?: boolean }) {
  const W = compactMode ? 240 : 720;
  const H = height;
  const pad = compactMode ? { l: 2, r: 2, t: 6, b: 4 } : { l: 64, r: 12, t: 14, b: 26 };
  const months = control.months;
  const limit = Number(control.limitTiyin);
  const values = months.map((m) => Number(m.projectedTiyin ?? m.valueTiyin));
  const actual = months.map((m) => Number(m.valueTiyin));
  // Katta grafikda: keyingi 3 oy prognozi (uzuq ustun + 80% oraliq)
  const outlook = !compactMode && control.outlook ? control.outlook.months : [];
  const fHi = outlook.map((o) => Number(o.hi80Tiyin));
  const fLo = outlook.map((o) => Number(o.lo80Tiyin));
  const hi = Math.max(...values, ...actual, ...fHi, limit, 1) * 1.08;
  const lo = Math.min(0, ...values, ...actual, ...fLo, limit);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / (hi - lo || 1));
  const slot = (W - pad.l - pad.r) / (months.length + outlook.length);
  const bw = slot * 0.62;
  const isMax = control.kind === 'EXPENSE';
  const colorOf = (m: ControlMonth, i: number) => {
    if (m.period < control.startPeriod) return '#cbd5e1';
    const v = values[i]!;
    const bad = isMax ? v > limit : v < limit;
    if (m.partial) return bad ? '#e7b4af' : '#b9d8c7';
    return bad ? TONE.expense : TONE.income;
  };
  const ticks = compactMode ? [] : [lo, (lo + hi) / 2, hi].map((v) => Math.round(v));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" aria-hidden={compactMode}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={TONE.grid} />
          <text x={pad.l - 8} y={y(t) + 3.5} fontSize={10.5} fill={TONE.axis} textAnchor="end">{compact(t)}</text>
        </g>
      ))}
      {!compactMode && lo < 0 && <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke={TONE.axis} />}
      {months.map((m, i) => {
        const x = pad.l + i * slot + (slot - bw) / 2;
        const v = actual[i]!;
        const top = y(Math.max(v, 0));
        const bottom = y(Math.min(v, 0));
        return (
          <g key={m.period}>
            <title>{`${formatPeriod(m.period)}\nSumma: ${compact(v)} so'm${m.projectedTiyin ? `\nOy oxirigacha taxmin: ${compact(m.projectedTiyin)} so'm` : ''}\nChegara: ${compact(limit)} so'm${m.period < control.startPeriod ? '\n(nazoratdan oldin)' : ''}`}</title>
            {m.partial && m.projectedTiyin && (
              <rect
                x={x}
                y={y(Math.max(Number(m.projectedTiyin), 0))}
                width={bw}
                height={Math.max(0, y(0) - y(Math.max(Number(m.projectedTiyin), 0)))}
                fill="none"
                stroke={colorOf(m, i)}
                strokeDasharray="3 2"
              />
            )}
            <rect x={x} y={top} width={bw} height={Math.max(1, bottom - top)} fill={colorOf(m, i)} />
            {!compactMode && (
              <text x={x + bw / 2} y={H - 8} fontSize={10.5} fill="#6b7280" textAnchor="middle">
                {formatPeriodShort(m.period).split(' ')[0]}
              </text>
            )}
          </g>
        );
      })}
      {outlook.length > 0 && (
        <line x1={pad.l + months.length * slot} x2={pad.l + months.length * slot} y1={pad.t} y2={H - pad.b} stroke={TONE.axis} strokeDasharray="2 3" />
      )}
      {outlook.map((o, k) => {
        const i = months.length + k;
        const x = pad.l + i * slot + (slot - bw) / 2;
        const mean = Number(o.meanTiyin);
        const bad = o.breachProbability >= 0.6;
        const stroke = bad ? TONE.expense : o.breachProbability >= 0.4 ? '#b45309' : TONE.income;
        const top = y(Math.max(mean, 0));
        const bottom = y(Math.min(mean, 0));
        return (
          <g key={o.period}>
            <title>{`${formatPeriod(o.period)} — prognoz\nKutilmoqda: ${compact(mean)} so'm\n80%: ${compact(o.lo80Tiyin)} – ${compact(o.hi80Tiyin)}\n${isMax ? 'Chegaradan oshish' : 'Rejadan kam bo\'lish'} ehtimoli: ${Math.round(o.breachProbability * 100)}%`}</title>
            <rect x={x} y={top} width={bw} height={Math.max(1, bottom - top)} fill="#fff" stroke={stroke} strokeWidth={1.4} strokeDasharray="4 3" />
            <line x1={x + bw / 2} x2={x + bw / 2} y1={y(Number(o.hi80Tiyin))} y2={y(Number(o.lo80Tiyin))} stroke={stroke} strokeWidth={1.2} />
            <line x1={x + bw * 0.3} x2={x + bw * 0.7} y1={y(Number(o.hi80Tiyin))} y2={y(Number(o.hi80Tiyin))} stroke={stroke} strokeWidth={1.2} />
            <line x1={x + bw * 0.3} x2={x + bw * 0.7} y1={y(Number(o.lo80Tiyin))} y2={y(Number(o.lo80Tiyin))} stroke={stroke} strokeWidth={1.2} />
            <text x={x + bw / 2} y={H - 8} fontSize={10.5} fill={TONE.slate} fontWeight={600} textAnchor="middle">
              {formatPeriodShort(o.period).split(' ')[0]}
            </text>
          </g>
        );
      })}
      <line x1={pad.l} x2={W - pad.r} y1={y(limit)} y2={y(limit)} stroke={TONE.ink} strokeWidth={compactMode ? 1 : 1.5} strokeDasharray="5 3" />
      {!compactMode && (
        <text x={outlook.length ? pad.l + months.length * slot - 6 : W - pad.r} y={y(limit) - 5} fontSize={10.5} fill={TONE.ink} textAnchor="end" fontWeight={600}>
          chegara {compact(limit)}
        </text>
      )}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════
// Nazorat tafsiloti va sozlamalari
// ═══════════════════════════════════════════════════════════

function ProbabilityBar({ value }: { value: number }) {
  const percent = Math.round(value * 100);
  const color = value >= 0.6 ? TONE.expense : value >= 0.4 ? '#b45309' : TONE.income;
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-16 bg-(--color-surface-sunken)">
        <div className="h-full" style={{ width: `${percent}%`, background: color }} />
      </div>
      <span className="w-9 text-right text-xs font-semibold tabular-nums" style={{ color }}>
        {percent}%
      </span>
    </div>
  );
}

/** Keyingi 3 oy prognozi va chegarani buzish ehtimoli */
function OutlookSection({ control }: { control: ControlView }) {
  const outlook = control.outlook;
  if (!outlook) return null;
  const isMax = control.kind === 'EXPENSE';
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">Prognoz: keyingi 3 oy</h4>
        <Link href="/katta-modellar" className="text-xs text-brand-700 hover:underline">
          Katta modellar →
        </Link>
      </div>
      <p className="text-sm leading-relaxed">{outlook.text}</p>
      <table className="mt-2 w-full text-sm">
        <thead className="border-b border-(--color-line)">
          <tr>
            <th className={cn(TH, 'pl-0 text-left')}>Oy</th>
            <th className={cn(TH, 'text-right')}>Kutilmoqda</th>
            <th className={cn(TH, 'text-right')}>80% oraliq</th>
            <th className={cn(TH, 'pr-0 text-right')}>{isMax ? 'Oshish ehtimoli' : 'Kam bo\'lish ehtimoli'}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-(--color-line)">
          {outlook.months.map((m) => (
            <tr key={m.period}>
              <td className="py-1.5 pr-2">{formatPeriod(m.period)}</td>
              <td className="whitespace-nowrap py-1.5 text-right font-medium tabular-nums">{compact(m.meanTiyin)}</td>
              <td className="whitespace-nowrap py-1.5 text-right tabular-nums text-(--color-text-muted)">
                {compact(m.lo80Tiyin)} – {compact(m.hi80Tiyin)}
              </td>
              <td className="py-1.5 pl-2">
                <ProbabilityBar value={m.breachProbability} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1.5 text-xs text-(--color-text-faint)">
        Model {outlook.historyMonths} oylik tarixdan o&apos;rgangan
        {outlook.wape !== null ? `, sinovda o'rtacha xato ${Math.round(outlook.wape * 1000) / 10}%`.replace('.', ',') : ''}. Ehtimol — 2000 ta mumkin bo&apos;lgan
        kelajak yo&apos;lidan nechtasida chegara buzilgani.
      </p>
    </section>
  );
}

function ControlDrawer({ control, onClose, onChanged }: { control: ControlView | null; onClose: () => void; onChanged: () => void }) {
  /** Qisqa rejim: grafik va uning izohi yashiriladi */
  const brief = useBrief();
  const [limit, setLimit] = useState('');
  const [note, setNote] = useState('');
  const [assignees, setAssignees] = useState<PickedAssignee[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!control) return;
    setLimit(String(Math.round(Number(control.limitTiyin) / 100)));
    setNote(control.note ?? '');
    setAssignees(control.assignees.map((a) => ({ pinfl: a.pinfl, fullName: a.fullName, position: a.position, role: a.role })));
    setError(null);
  }, [control]);

  if (!control) return null;
  const isMax = control.kind === 'EXPENSE';
  const limitNum = Number(control.limitTiyin);

  const act = async (action: () => Promise<unknown>, close = false) => {
    setSaving(true);
    setError(null);
    try {
      await action();
      onChanged();
      if (close) onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bajarilmadi');
    } finally {
      setSaving(false);
    }
  };

  const checked = control.months.filter((m) => m.period >= control.startPeriod);

  return (
    <Drawer
      open
      onClose={onClose}
      title={control.label}
      description={`${control.title} · nazorat ${formatPeriod(control.startPeriod)} dan`}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => {
              if (window.confirm(`«${control.label}» nazorati o'chirilsinmi?`)) void act(() => controlsApi.remove(control.id), true);
            }}
          >
            O&apos;chirish
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={saving} onClick={() => act(() => controlsApi.update(control.id, { isActive: !control.isActive }))}>
              {control.isActive ? "To'xtatish" : 'Qayta yoqish'}
            </Button>
            <Button
              size="sm"
              loading={saving}
              onClick={() => {
                const value = parseSom(limit);
                if (value === null) {
                  setError("Chegara noto'g'ri");
                  return;
                }
                void act(() => controlsApi.update(control.id, { limitSom: value, note: note.trim() || null, assignees: assignees.map((a) => ({ pinfl: a.pinfl })) }));
              }}
            >
              Saqlash
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        <section className="flex flex-wrap items-center gap-2">
          <KindBadge kind={control.kind} />
          <StatusPill control={control} />
          {control.reactionId && (
            <Link href={`/munosabat/${control.reactionId}`} className="text-xs text-brand-700 hover:underline">
              Munosabat: {control.reactionTitle} →
            </Link>
          )}
        </section>

        <section>
          <p className="text-sm font-medium" style={{ color: control.status === 'breach' ? TONE.expense : control.status === 'risk' ? '#92400e' : undefined }}>
            <CalcValue calc={controlStatusCalc(control)}>{control.statusText}</CalcValue>
          </p>
          {!brief && (
          <>
          <div className="mt-3 rounded-(--radius-control) border border-(--color-line) p-2">
            <ControlChart control={control} height={210} />
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-(--color-text-muted)">
            Ustun — oy summasi (yashil — me&apos;yorda, qizil — chegara buzilgan, kulrang — nazoratdan oldingi oylar). Joriy oyda uzuq to&apos;rtburchak — oy oxirigacha taxmin. Uzuq chiziq —
            chegara ({isMax ? 'oshmasligi kerak' : 'kamida shuncha bo\'lishi kerak'}).
            {control.outlook && ' O\'ngdagi oq uzuq ustunlar — keyingi 3 oy prognozi, ingichka chiziq — 80% ehtimol oralig\'i.'}
          </p>
          </>
          )}
        </section>

        {control.outlook && <OutlookSection control={control} />}

        <section>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">Nazorat oylari</h4>
          {checked.length === 0 ? (
            <p className="text-sm text-(--color-text-muted)">Hali to&apos;liq oy o&apos;tmagan.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-(--color-line)">
                <tr>
                  <th className={cn(TH, 'pl-0 text-left')}>Oy</th>
                  <th className={cn(TH, 'text-right')}>Summa</th>
                  <th className={cn(TH, 'text-right')}>Farq</th>
                  <th className={cn(TH, 'pr-0 text-right')}>Holat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-line)">
                {[...checked].reverse().map((m) => {
                  const v = Number(m.projectedTiyin ?? m.valueTiyin);
                  const diff = v - limitNum;
                  const bad = isMax ? diff > 0 : diff < 0;
                  return (
                    <tr key={m.period}>
                      <td className="py-1.5 pr-2">
                        {formatPeriod(m.period)}
                        {m.partial && <span className="ml-1 text-xs text-(--color-text-faint)">(taxmin)</span>}
                      </td>
                      <td className="whitespace-nowrap py-1.5 text-right tabular-nums">
                        <CalcValue calc={projectionCalc(m)}>{compact(v)}</CalcValue>
                      </td>
                      <td className={cn('whitespace-nowrap py-1.5 text-right tabular-nums', bad ? 'text-(--color-expense)' : 'text-(--color-income)')}>
                        <CalcValue calc={limitDiffCalc(control, m)}>
                          {diff > 0 ? '+' : diff < 0 ? '−' : ''}
                          {compact(Math.abs(diff))}
                        </CalcValue>
                      </td>
                      <td className="py-1.5 pl-2 text-right text-xs font-semibold">
                        <span className={bad ? 'text-(--color-expense)' : 'text-(--color-income)'}>{bad ? (m.partial ? 'xavf' : 'buzildi') : "me'yorda"}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="space-y-4">
          <label className="block">
            <span className={LABEL}>Oylik chegara, so&apos;m ({isMax ? "ko'pi bilan" : 'kamida'})</span>
            <input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" className={cn(FIELD, 'text-right tabular-nums')} />
            <span className="mt-1 block text-xs text-(--color-text-faint)">
              Taklif (so&apos;nggi 3 oy o&apos;rtachasi): {num(control.suggestedTiyin)} so&apos;m ·{' '}
              <button type="button" className="underline" onClick={() => setLimit(String(Math.round(Number(control.suggestedTiyin) / 100)))}>
                qo&apos;llash
              </button>
            </span>
            {control.forecastSuggestedTiyin && (
              <span className="mt-0.5 block text-xs text-(--color-text-faint)">
                Prognoz asosida (keyingi 3 oy o&apos;rtachasi): {num(control.forecastSuggestedTiyin)} so&apos;m ·{' '}
                <button type="button" className="underline" onClick={() => setLimit(String(Math.round(Number(control.forecastSuggestedTiyin) / 100)))}>
                  qo&apos;llash
                </button>
              </span>
            )}
          </label>
          <div>
            <span className={LABEL}>Mas&apos;ul xodimlar</span>
            <AssigneePicker value={assignees} onChange={setAssignees} />
          </div>
          <label className="block">
            <span className={LABEL}>Izoh</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="w-full rounded-(--radius-control) border border-(--color-line) bg-white px-2.5 py-2 text-sm outline-none focus:border-slate-500"
            />
          </label>
          {error && <p className="text-sm text-(--color-expense)">{error}</p>}
        </section>
      </div>
    </Drawer>
  );
}

// ═══════════════════════════════════════════════════════════
// Yangi nazorat (to'g'ridan-to'g'ri, munosabatsiz)
// ═══════════════════════════════════════════════════════════

function CreateControlDrawer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const builder = useItemBuilder('Nazorat');
  const [title, setTitle] = useState('');
  const [limit, setLimit] = useState('');
  const [assignees, setAssignees] = useState<PickedAssignee[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!builder.item) return;
    setSaving(true);
    setError(null);
    try {
      const limitSom = limit.trim() ? parseSom(limit) : null;
      if (limit.trim() && limitSom === null) throw new Error("Chegara noto'g'ri");
      await controlsApi.create({
        title: title.trim() || builder.item.label,
        kind: builder.item.kind,
        label: builder.item.label,
        filter: builder.item.filter,
        // Bo'sh qoldirilsa — backend taklif qilingan chegarani qo'yadi (so'nggi 3 oy o'rtachasi)
        limitSom: limitSom ?? undefined,
        assignees: assignees.map((a) => ({ pinfl: a.pinfl })),
      });
      onCreated();
      onClose();
      setTitle('');
      setLimit('');
      setAssignees([]);
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
      title="Yangi nazorat"
      description="Modda har oy avtomatik hisoblanib, chegara bilan solishtiriladi"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button size="sm" loading={saving} disabled={!builder.item} onClick={submit}>
            Yaratish
          </Button>
        </div>
      }
    >
      {builder.error ? (
        <p className="text-sm text-(--color-expense)">{builder.error}</p>
      ) : builder.loading ? (
        <p className="text-sm text-(--color-text-muted)">Yuklanmoqda…</p>
      ) : (
        <div className="space-y-4">
          {builder.fields}
          <label className="block">
            <span className={LABEL}>Nomi (ixtiyoriy)</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} className={FIELD} placeholder={builder.item?.label ?? ''} />
          </label>
          <label className="block">
            <span className={LABEL}>Oylik chegara, so&apos;m</span>
            <input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" className={cn(FIELD, 'text-right tabular-nums')} placeholder="bo'sh — so'nggi 3 oy o'rtachasi" />
            <span className="mt-1 block text-xs text-(--color-text-faint)">
              {builder.item?.kind === 'EXPENSE' ? 'Xarajat shu summadan oshmasligi kerak.' : "Daromad (natija) kamida shuncha bo'lishi kerak."}
            </span>
          </label>
          <div>
            <span className={LABEL}>Mas&apos;ul xodimlar</span>
            <AssigneePicker value={assignees} onChange={setAssignees} />
          </div>
          {error && <p className="text-sm text-(--color-expense)">{error}</p>}
        </div>
      )}
    </Drawer>
  );
}

// ═══════════════════════════════════════════════════════════
// Nazorat sahifasi
// ═══════════════════════════════════════════════════════════

export function ControlList() {
  /** Qisqa rejim: kichik grafik ustuni yashiriladi */
  const brief = useBrief();
  /** Umumiy «Davr» oyi: o'tgan oy bo'lsa — o'sha oy oxiridagi holat */
  const asOf = useAsOf();
  const result = useAsync(() => controlsApi.list(asOf).then((r) => r.data), [asOf]);
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const data = result.data;

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
        <LoadingState label="Nazorat hisoblanmoqda" />
      </Card>
    );
  }

  const active = data.filter((c) => c.isActive);
  const count = (f: Filter) =>
    f === 'all' ? data.length : f === 'paused' ? data.filter((c) => !c.isActive).length : active.filter((c) => c.status === f).length;
  const rows = data.filter((c) => (filter === 'all' ? true : filter === 'paused' ? !c.isActive : c.isActive && c.status === filter));
  const breach = count('breach');
  const risk = count('risk');
  const open = openId ? (data.find((c) => c.id === openId) ?? null) : null;

  const notes: string[] = [];
  if (active.length) {
    notes.push(`${active.length} ta modda nazoratda: ${count('ok')} tasi me'yorda, ${risk} tasi xavf ostida, ${breach} tasida chegara buzilgan.`);
    const worst = [...active].filter((c) => c.status === 'breach').sort((a, b) => b.breaches - a.breaches)[0];
    if (worst) notes.push(`Eng ko'p buzilgan — «${worst.label}»: ${worst.breaches} oy (${worst.checkedMonths} oydan).`);
    const riskList = active.filter((c) => c.status === 'risk').slice(0, 3);
    if (riskList.length)
      notes.push(`${asOf ? 'Prognozga ko‘ra' : "Joriy oy sur'ati bilan"} chegaradan chiqishi mumkin: ${riskList.map((c) => `«${c.label}»`).join(', ')}.`);
    const ahead = active.filter((c) => (c.outlook?.months[0]?.breachProbability ?? 0) >= 0.6);
    if (ahead.length) {
      notes.push(
        `Prognozga ko'ra keyingi oy chegaradan chiqishi ehtimoli yuqori (60%+): ${ahead
          .slice(0, 4)
          .map((c) => `«${c.label}» (${Math.round(c.outlook!.months[0]!.breachProbability * 100)}%)`)
          .join(', ')}${ahead.length > 4 ? ` va yana ${ahead.length - 4} ta` : ''}.`,
      );
    }
    const noOwner = active.filter((c) => c.assignees.length === 0).length;
    if (noOwner) notes.push(`${noOwner} ta nazoratga mas'ul biriktirilmagan.`);
  }

  return (
    <div className="space-y-4">
      {asOf && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-(--radius-card) border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm">
          <span className="rounded-md bg-amber-500 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">Tarixiy</span>
          <span className="text-heading">
            Holat <b>{formatPeriod(asOf)}</b> oxirida turgandek: oxirgi tekshirilgan oy — {formatPeriod(asOf)}, prognoz keyingi oydan.
          </span>
          <span className="text-xs text-(--color-text-muted)">Bugungi holat uchun yuqoridagi oyni joriy oyga qo&apos;ying.</span>
        </div>
      )}
      <KpiStrip
        items={[
          { label: 'Nazoratda', value: String(active.length), sub: `${data.length - active.length} ta to'xtatilgan` },
          { label: 'Chegara buzilgan', value: String(breach), valueClass: breach ? 'text-(--color-expense)' : undefined, sub: asOf ? `${formatPeriod(asOf)} natijasi bo'yicha` : "o'tgan oy natijasi bo'yicha" },
          { label: 'Xavf ostida', value: String(risk), valueClass: risk ? 'text-amber-700' : undefined, sub: asOf ? "keyingi oy prognozi bo'yicha" : "joriy oy sur'ati bo'yicha" },
          { label: "Me'yorda", value: String(count('ok')), valueClass: count('ok') ? 'text-(--color-income)' : undefined, sub: 'chegara ichida' },
        ]}
      />

      <Findings notes={notes} />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <div>
            <h3 className="text-sm font-semibold">Nazoratdagi moddalar</h3>
            <p className="mt-0.5 text-xs text-(--color-text-muted)">Har oy avtomatik hisoblanadi. Qatorni bosing — oylar, grafik va chegarani o&apos;zgartirish.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={filter}
              onChange={setFilter}
              size="sm"
              options={[
                { value: 'all', label: `Barchasi (${count('all')})` },
                { value: 'breach', label: `Buzilgan (${breach})` },
                { value: 'risk', label: `Xavf (${risk})` },
                { value: 'ok', label: `Me'yorda (${count('ok')})` },
                { value: 'paused', label: `To'xtatilgan (${count('paused')})` },
              ]}
            />
            <SmallButton onClick={() => setCreating(true)}>+ Yangi nazorat</SmallButton>
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title={data.length === 0 ? "Nazoratda modda yo'q" : "Bu ro'yxat bo'sh"}
            description="Munosabat sahifasida «Nazoratga o'tkazish»ni bosing yoki «+ Yangi nazorat» orqali moddani to'g'ridan-to'g'ri qo'shing."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-(--color-line) bg-(--color-surface-muted)">
                <tr>
                  <th className={cn(TH, 'pl-5 text-left')}>Modda</th>
                  <th className={cn(TH, 'text-right')}>Chegara / oy</th>
                  <th className={cn(TH, 'text-left')}>Joriy oy</th>
                  {!brief && <th className={cn(TH, 'text-left')}>12 oy</th>}
                  <th className={cn(TH, 'text-right')} title="Keyingi oy prognozi: chegarani buzish ehtimoli">
                    Keyingi oy
                  </th>
                  <th className={cn(TH, 'text-center')}>Buzilgan</th>
                  <th className={cn(TH, 'text-left')}>Mas&apos;ul</th>
                  <th className={cn(TH, 'pr-5 text-right')}>Holat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-line)">
                {rows.map((c) => {
                  const usage = c.usagePercent ?? 0;
                  const isMax = c.kind === 'EXPENSE';
                  const bad = isMax ? usage > 100 : usage < 100;
                  return (
                    <tr key={c.id} className={cn('cursor-pointer hover:bg-(--color-surface-muted)', !c.isActive && 'opacity-60')} onClick={() => setOpenId(c.id)}>
                      <td className="py-3 pl-5 pr-3">
                        <span className="flex items-center gap-2">
                          <KindBadge kind={c.kind} />
                          <span className="min-w-0">
                            <span className="block max-w-[20rem] truncate font-medium" title={c.label}>{c.label}</span>
                            <span className="block max-w-[20rem] truncate text-xs text-(--color-text-faint)">{c.reactionTitle ? `Munosabat: ${c.reactionTitle}` : c.title}</span>
                          </span>
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                        <span className="text-[11px] text-(--color-text-faint)">{isMax ? '≤ ' : '≥ '}</span>
                        {compact(c.limitTiyin)}
                      </td>
                      <td className="px-3 py-3">
                        <div className="w-40">
                          <div className="flex items-baseline justify-between text-xs tabular-nums">
                            <span className="font-medium">
                              {c.current ? <CalcValue calc={projectionCalc(c.current)}>{compact(c.current.projectedTiyin ?? c.current.valueTiyin)}</CalcValue> : '—'}
                            </span>
                            <span className={bad ? 'font-semibold text-(--color-expense)' : 'text-(--color-text-muted)'}>
                              {c.usagePercent === null ? '—' : <CalcValue calc={usageCalc(c)}>{`${Math.round(usage)}%`}</CalcValue>}
                            </span>
                          </div>
                          <div className="relative mt-1 h-1.5 bg-(--color-surface-sunken)">
                            <div className={cn('h-full', bad ? 'bg-(--color-expense)' : 'bg-(--color-income)')} style={{ width: `${Math.min(100, Math.max(0, (usage / 150) * 100))}%` }} />
                            <span className="absolute inset-y-[-2px] w-px bg-(--color-text)" style={{ left: `${(100 / 150) * 100}%` }} title="Chegara" />
                          </div>
                          <span className="text-[10px] text-(--color-text-faint)">oy oxirigacha taxmin</span>
                        </div>
                      </td>
                      {!brief && (
                      <td className="w-40 px-3 py-3">
                        <ControlChart control={c} height={44} compactMode />
                      </td>
                      )}
                      <td className="whitespace-nowrap px-3 py-3 text-right text-xs">
                        {c.outlook?.months[0] ? (
                          <span title={c.outlook.text}>
                            <ProbabilityBar value={c.outlook.months[0].breachProbability} />
                            <span className="block text-[10px] text-(--color-text-faint)">{compact(c.outlook.months[0].meanTiyin)} kutilmoqda</span>
                          </span>
                        ) : (
                          <span className="text-(--color-text-faint)">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-center text-xs tabular-nums">
                        <CalcValue calc={breachesCalc(c)}>
                          <span className={c.breaches ? 'font-semibold text-(--color-expense)' : 'text-(--color-text-muted)'}>{c.breaches}</span>
                          <span className="text-(--color-text-faint)"> / {c.checkedMonths} oy</span>
                        </CalcValue>
                      </td>
                      <td className="px-3 py-3 text-xs">
                        {c.assignees.length ? (
                          <span className="block max-w-[10rem] truncate" title={c.assignees.map((a) => a.fullName).join(', ')}>
                            {c.assignees[0]!.fullName}
                            {c.assignees.length > 1 ? ` +${c.assignees.length - 1}` : ''}
                          </span>
                        ) : (
                          <span className="text-(--color-expense)">yo&apos;q</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-3 pl-3 pr-5 text-right">
                        <CalcValue calc={controlStatusCalc(c)}>
                          <StatusPill control={c} />
                        </CalcValue>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-(--color-line) px-5 py-2.5 text-xs leading-relaxed text-(--color-text-muted)">
          Xarajat — chegaradan oshmasligi (≤), daromad va natija — chegaradan kam bo&apos;lmasligi (≥) kerak. «Chegara buzilgan» — o&apos;tgan to&apos;liq oy natijasi, «Xavf ostida» —
          joriy oyning hozirgi sur&apos;ati davom etsa, oy oxirida chegaradan chiqadi yoki prognozga ko&apos;ra keyingi oy chegarani buzish ehtimoli 65% dan yuqori.
          «Keyingi oy» — prognoz modeli bo&apos;yicha chegarani buzish ehtimoli.
        </p>
      </Card>

      <ControlDrawer control={open} onClose={() => setOpenId(null)} onChanged={result.reload} />
      <CreateControlDrawer open={creating} onClose={() => setCreating(false)} onCreated={result.reload} />
    </div>
  );
}