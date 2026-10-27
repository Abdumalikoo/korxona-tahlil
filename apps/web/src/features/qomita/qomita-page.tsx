'use client';

import { PageHeader } from '@/components/layout/page-header';
import { MoneyCell, NameCell, ReportCard, RTable, StatTiles, STICKY_NAME, STICKY_NO, TableNote, Td, Th, Tr, sum } from '@/components/report/report';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { MonthRangeCard, useMonthRange } from '@/features/units/month-range';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatPeriod, formatPeriodShort } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { Fragment, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { qomitaApi, type QomitaDetail, type QomitaRowView } from './api';
import { QomitaBankCard, QomitaIncomeDrawer } from './qomita-income';
import { QomitaSettingsCard } from './qomita-settings';

// ═══════════════════════════════════════════════════════════
// Daromadlar › Qo'mita mablag'lari.
// Qo'mita ayrim bo'limlarimiz (masalan, Call-markaz) xarajatini qoplash uchun pul ajratadi:
//  • Ajratildi — Qo'mita daromadi (qo'lda yoki bank ko'chirmasidan), har bo'lim o'z daromad turi bilan;
//  • Qoplanishi kerak — bo'lim ish haqi qismlari (Oklad, 40% ustama …) + belgilangan boshqa moddalar;
//  • Qoldiq / kamomad — faqat ko'rsatiladi.
// Bo'lim qatorini bosing — joyida ochiladi: oyma-oy, ajratmalar, ish haqi qismlari → xodimlar, boshqa moddalar.
// ═══════════════════════════════════════════════════════════

type ToastState = { message: string; tone: 'success' | 'error' } | null;

const n = (s: string | null | undefined) => Number(s ?? 0);
const pctText = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '');

export function QomitaPage() {
  const { isAdmin } = useAuth();
  const range = useMonthRange('year');
  const cfg = useAsync(() => qomitaApi.config().then((r) => r.data), []);
  const rep = useAsync(() => (range.error ? Promise.resolve(null) : qomitaApi.report(range.from, range.to).then((r) => r.data)), [range.from, range.to, range.error]);
  const [incomeOpen, setIncomeOpen] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const reloadAll = () => {
    rep.reload();
    cfg.reload();
  };

  const t = rep.data?.totals;
  const items = cfg.data?.items ?? [];
  return (
    <>
      <PageHeader
        title="Qo'mita mablag'lari"
        description="Qo'mita ajratgan pullar (daromad) va ular qoplaydigan xarajatlar: bo'limlar bo'yicha, oyma-oy"
        actions={
          isAdmin && items.length > 0 ? (
            <Button size="sm" onClick={() => setIncomeOpen(items[0]!.departmentId)}>
              + Ajratma kiritish
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-4 p-4 md:p-6">
        <MonthRangeCard range={range} />
        {rep.error ? (
          <ErrorState message={rep.error} onRetry={rep.reload} />
        ) : !rep.data || !t ? (
          <LoadingState label="Qo'mita mablag'lari hisoblanmoqda" />
        ) : (
          <>
            <StatTiles
              items={[
                { label: 'Ajratildi (daromad)', value: n(t.allocatedTiyin), tone: 'green' },
                { label: 'Qoplanishi kerak', value: n(t.coveredTiyin), tone: 'red', note: `ish haqi ${sum(n(t.payrollTiyin))} · boshqa ${sum(n(t.otherTiyin))}` },
                {
                  label: n(t.balanceTiyin) < 0 ? 'Kamomad (yetmadi)' : 'Qoldiq (ortib qoldi)',
                  value: n(t.balanceTiyin),
                  tone: n(t.balanceTiyin) < 0 ? 'orange' : 'blue',
                  signed: true,
                  note: n(t.coveredTiyin) > 0 ? `qoplandi: ${pctText(n(t.allocatedTiyin), n(t.coveredTiyin))}` : undefined,
                },
                { label: "Qoplanadigan bo'limlar", value: 0, text: String(items.length), tone: 'purple', note: items.map((i) => i.departmentName).join(', ') || "hali belgilanmagan" },
              ]}
            />
            {rep.data.tarkibMissing.length > 0 && (
              <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
                {rep.data.tarkibMissing.map(formatPeriod).join(', ')} — ish haqi tarkibi yuklanmagan: Oklad va ustama qismlari ajratilmagan («Xarajatlar › Ish haqi tarkibi»ga
                yuklang — o&apos;zi hisoblanadi).
              </p>
            )}
            <ReportTable rows={rep.data.rows} from={rep.data.from} to={rep.data.to} isAdmin={isAdmin} onChanged={reloadAll} setToast={setToast} onAddIncome={setIncomeOpen} />
          </>
        )}
        {cfg.error ? <ErrorState message={cfg.error} onRetry={cfg.reload} /> : cfg.data ? <QomitaBankCard config={cfg.data} isAdmin={isAdmin} onRouted={reloadAll} setToast={setToast} /> : null}
        {cfg.data && <QomitaSettingsCard config={cfg.data} isAdmin={isAdmin} onSaved={reloadAll} setToast={setToast} />}
      </div>
      {cfg.data && incomeOpen !== null && (
        <QomitaIncomeDrawer
          config={cfg.data}
          departmentId={incomeOpen}
          defaultPeriod={rep.data?.to ?? range.to}
          onClose={() => setIncomeOpen(null)}
          onSaved={(msg) => {
            setIncomeOpen(null);
            setToast({ message: msg, tone: 'success' });
            reloadAll();
          }}
        />
      )}
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </>
  );
}

// ─────────── Asosiy jadval ───────────

function ReportTable({
  rows,
  from,
  to,
  isAdmin,
  onChanged,
  setToast,
  onAddIncome,
}: {
  rows: QomitaRowView[];
  from: string;
  to: string;
  isAdmin: boolean;
  onChanged: () => void;
  setToast: (t: ToastState) => void;
  onAddIncome: (departmentId: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (k: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const tot = (f: (r: QomitaRowView) => string) => rows.reduce((s, r) => s + n(f(r)), 0);
  if (!rows.length)
    return (
      <ReportCard title="Bo'limlar bo'yicha">
        <p className="px-5 pb-6 pt-2 text-center text-sm text-(--color-text-muted)">
          Hali qoplanadigan bo&apos;lim belgilanmagan. Pastdagi «Qoplanadigan bo&apos;limlar» kartasida bo&apos;lim qo&apos;shing (masalan, Call-markaz: Oklad va 40% ustama).
        </p>
      </ReportCard>
    );
  const totalCovered = tot((r) => r.coveredTiyin);
  return (
    <ReportCard title="Bo'limlar bo'yicha: ajratildi va qoplanishi kerak" badge={`${formatPeriodShort(from)} — ${formatPeriodShort(to)}`}>
      <div className="p-4">
        <RTable minWidth={1080}>
          <thead>
            <tr>
              <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
              <Th className={cn(STICKY_NAME, 'z-[2] min-w-60 text-left')}>Bo&apos;lim</Th>
              <Th>Ajratildi</Th>
              <Th>Ish haqi qismlari</Th>
              <Th>Boshqa moddalar</Th>
              <Th>Qoplanishi kerak</Th>
              <Th>Qoldiq / kamomad</Th>
              <Th>Qoplandi</Th>
            </tr>
          </thead>
          <tbody>
            <Tr total>
              <Td className={STICKY_NO} />
              <NameCell>Jami</NameCell>
              <MoneyCell value={tot((r) => r.allocatedTiyin)} strong />
              <MoneyCell value={tot((r) => r.payrollTiyin)} />
              <MoneyCell value={tot((r) => r.otherTiyin)} />
              <MoneyCell value={totalCovered} strong />
              <MoneyCell value={tot((r) => r.balanceTiyin)} strong signedColor />
              <Td className="font-semibold">{pctText(tot((r) => r.allocatedTiyin), totalCovered)}</Td>
            </Tr>
            {rows.map((r, i) => {
              const isOpen = open.has(r.key);
              const what = [...r.components.map((c) => c.name), ...r.categories.map((c) => c.label)];
              return (
                <Fragment key={r.key}>
                  <Tr onClick={() => toggle(r.key)} className={cn(isOpen && 'bg-brand-50/60')}>
                    <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                    <NameCell
                      drill
                      before={<span className={cn('inline-block w-3 text-xs text-(--color-text-faint) transition-transform', isOpen && 'rotate-90')}>▸</span>}
                      sub={r.key === '-' ? 'daromad turi bo‘limga bog‘lanmagan' : what.length ? `qoplaydi: ${what.join(', ')}` : undefined}
                    >
                      {r.label}
                    </NameCell>
                    <MoneyCell value={n(r.allocatedTiyin)} className={n(r.allocatedTiyin) ? 'text-(--color-income)' : 'text-(--color-text-faint)'} />
                    <MoneyCell value={n(r.payrollTiyin)} className={n(r.payrollTiyin) ? '' : 'text-(--color-text-faint)'} />
                    <MoneyCell value={n(r.otherTiyin)} className={n(r.otherTiyin) ? '' : 'text-(--color-text-faint)'} />
                    <MoneyCell value={n(r.coveredTiyin)} strong />
                    <MoneyCell value={n(r.balanceTiyin)} strong signedColor />
                    <Td className={cn('text-xs font-semibold', n(r.balanceTiyin) < 0 ? 'text-(--color-expense)' : 'text-(--color-text-muted)')}>{pctText(n(r.allocatedTiyin), n(r.coveredTiyin))}</Td>
                  </Tr>
                  {isOpen && <RowDetail row={r} from={from} to={to} isAdmin={isAdmin} onChanged={onChanged} setToast={setToast} onAddIncome={onAddIncome} />}
                </Fragment>
              );
            })}
          </tbody>
        </RTable>
        <TableNote>
          Bo&apos;limni bosing — ichi ochiladi: oyma-oy, ajratmalar (qaysi yozuvdan), ish haqi qismlari va xodimlar, boshqa moddalar. Ish haqi qismlari bo&apos;lim ish haqidan
          ajratilib Qo&apos;mita hisobiga o&apos;tadi (Solishtirmada bo&apos;lim xarajati shuncha kamayadi, jami o&apos;zgarmaydi). Qoldiq / kamomad faqat ko&apos;rsatiladi.
        </TableNote>
      </div>
    </ReportCard>
  );
}

// ─────────── Ichma-ich: bo'lim ichi ───────────

const TONES = ['bg-[#f7f9fc]', 'bg-[#f0f5fc]', 'bg-[#e9f0fa]'];

/** Ichki qator: summalar kerakli ustunlarda (null — bo'sh) */
function SubRow({
  depth,
  label,
  sub,
  allocated = null,
  payroll = null,
  other = null,
  covered = null,
  balance = null,
  open,
  onClick,
  action,
  group,
}: {
  depth: number;
  label: ReactNode;
  sub?: ReactNode;
  allocated?: number | null;
  payroll?: number | null;
  other?: number | null;
  covered?: number | null;
  balance?: number | null;
  /** undefined — ochilmaydi */
  open?: boolean;
  onClick?: () => void;
  action?: ReactNode;
  group?: boolean;
}) {
  const cell = (v: number | null, cls?: string) => (v === null ? <Td /> : <MoneyCell value={v} className={cn('text-[12.5px]', v ? cls : 'text-(--color-text-faint)')} />);
  return (
    <tr className={cn(TONES[Math.min(depth - 1, TONES.length - 1)], '[&>td]:bg-inherit', onClick && 'cursor-pointer hover:brightness-[0.98]')} onClick={onClick}>
      <Td className={STICKY_NO} />
      <td className={cn('border-b border-l border-(--color-line) px-1.5 py-2 text-left text-[12.5px]', STICKY_NAME)}>
        <span className="flex items-start gap-1" style={{ paddingLeft: depth * 14 }}>
          <span className="w-3 shrink-0 text-[10px] leading-5 text-(--color-text-faint)">{open === undefined ? '·' : open ? '▾' : '▸'}</span>
          <span className="min-w-0 flex-1">
            <span className={cn('block text-heading', group && 'font-semibold')}>{label}</span>
            {sub && <span className="block text-[11px] text-(--color-text-muted)">{sub}</span>}
          </span>
          {action}
        </span>
      </td>
      {cell(allocated, 'text-(--color-income)')}
      {cell(payroll)}
      {cell(other)}
      {cell(covered, 'font-semibold')}
      {balance === null ? <Td /> : <MoneyCell value={balance} signedColor className="text-[12.5px] font-semibold" />}
      <Td className="text-[11px] text-(--color-text-muted)">{allocated !== null && covered ? pctText(allocated, covered) : ''}</Td>
    </tr>
  );
}

const ORIGIN_LABEL: Record<QomitaDetail['incomes'][number]['origin'], string> = { BANK: 'bankdan', MANUAL: "qo'lda", OTHER: 'boshqa manba' };

function RowDetail({
  row,
  from,
  to,
  isAdmin,
  onChanged,
  setToast,
  onAddIncome,
}: {
  row: QomitaRowView;
  from: string;
  to: string;
  isAdmin: boolean;
  onChanged: () => void;
  setToast: (t: ToastState) => void;
  onAddIncome: (departmentId: string) => void;
}) {
  const res = useAsync(() => qomitaApi.detail(row.key, from, to).then((r) => r.data), [row.key, from, to, row.allocatedTiyin]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(['months']));
  const [removing, setRemoving] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (k: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const note = (text: string, tone = 'text-(--color-text-muted)') => (
    <tr>
      <td colSpan={8} className={cn('border-b border-(--color-line) bg-[#f7f9fc] px-4 py-2 text-xs', tone)}>
        <span className="pl-6">{text}</span>
      </td>
    </tr>
  );
  if (res.error) return note(res.error, 'text-(--color-expense)');
  const d = res.data;
  if (!d) return note('Yuklanmoqda…');

  const months = Object.entries(row.months).sort(([a], [b]) => a.localeCompare(b));
  const payrollTotal = n(row.payrollTiyin);
  const otherTotal = n(row.otherTiyin);
  const allocTotal = n(row.allocatedTiyin);
  const partName = new Map(d.payrollParts.map((p) => [p.code, p.name]));

  async function removeIncome() {
    if (!removing) return;
    setBusy(true);
    try {
      await qomitaApi.removeIncome(removing.id);
      setToast({ message: "Ajratma o'chirildi", tone: 'success' });
      setRemoving(null);
      onChanged();
    } catch (err) {
      setToast({ message: errorMessage(err, "O'chirib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Oyma-oy */}
      <SubRow depth={1} group label="Oyma-oy" sub={`${months.length} oy`} open={open.has('months')} onClick={() => toggle('months')} />
      {open.has('months') &&
        (months.length ? (
          months.map(([p, m]) => {
            const a = n(m.allocated);
            const pr = n(m.payroll);
            const o = n(m.other);
            return <SubRow key={p} depth={2} label={formatPeriod(p)} allocated={a} payroll={pr} other={o} covered={pr + o} balance={a - pr - o} />;
          })
        ) : (
          <SubRow depth={2} label="Bu davrda harakat yo'q" />
        ))}

      {/* Ajratmalar */}
      <SubRow
        depth={1}
        group
        label="Ajratmalar (Qo'mita daromadi)"
        sub={`${d.incomes.length} ta yozuv`}
        allocated={allocTotal}
        open={open.has('inc')}
        onClick={() => toggle('inc')}
        action={
          isAdmin && row.key !== '-' ? (
            <button
              type="button"
              className="shrink-0 rounded-md border border-brand-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-brand-700 hover:bg-brand-50"
              onClick={(e) => {
                e.stopPropagation();
                onAddIncome(row.key);
              }}
            >
              + Kiritish
            </button>
          ) : undefined
        }
      />
      {open.has('inc') &&
        (d.incomes.length ? (
          d.incomes.map((x) => (
            <SubRow
              key={x.id}
              depth={2}
              label={`${x.date.split('-').reverse().join('.')} · ${formatPeriod(x.period)} uchun`}
              sub={[ORIGIN_LABEL[x.origin], x.clientName, x.documentNo ? `№ ${x.documentNo}` : '', x.description].filter(Boolean).join(' · ')}
              allocated={n(x.amountTiyin)}
              action={
                isAdmin && x.origin === 'MANUAL' ? (
                  <button
                    type="button"
                    title="O'chirish"
                    className="shrink-0 rounded px-1.5 text-xs text-(--color-text-faint) hover:bg-red-50 hover:text-(--color-expense)"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRemoving({ id: x.id, text: `${sum(n(x.amountTiyin))} so'm · ${formatPeriod(x.period)}` });
                    }}
                  >
                    ✕
                  </button>
                ) : undefined
              }
            />
          ))
        ) : (
          <SubRow depth={2} label="Ajratma kiritilmagan" sub={isAdmin ? "«+ Kiritish» yoki pastdagi «Bankdan» kartasi orqali" : undefined} />
        ))}

      {/* Ish haqi qismlari → xodimlar */}
      {(row.components.length > 0 || payrollTotal !== 0) && (
        <>
          <SubRow
            depth={1}
            group
            label="Ish haqi qismlari (bo'lim ish haqidan)"
            sub={d.tarkibMissing.length ? `ish haqi tarkibi yuklanmagan: ${d.tarkibMissing.map(formatPeriodShort).join(', ')}` : row.components.map((c) => c.name).join(', ')}
            payroll={payrollTotal}
            covered={payrollTotal}
            open={open.has('pay')}
            onClick={() => toggle('pay')}
          />
          {open.has('pay') && (
            <>
              {d.payrollParts.map((p) => (
                <SubRow
                  key={p.code}
                  depth={2}
                  label={p.name}
                  sub={Object.entries(p.months)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([m, v]) => `${formatPeriodShort(m)}: ${sum(n(v))}`)
                    .join(' · ')}
                  payroll={n(p.totalTiyin)}
                  covered={n(p.totalTiyin)}
                />
              ))}
              {!d.payrollParts.length && <SubRow depth={2} label="Bu davrda ajratilgan ish haqi qismi yo'q" />}
              {d.employees.length > 0 && (
                <SubRow depth={2} group label={`Xodimlar (${d.employees.length})`} payroll={payrollTotal} open={open.has('emp')} onClick={() => toggle('emp')} />
              )}
              {open.has('emp') &&
                d.employees.map((e) => (
                  <SubRow
                    key={e.pinfl}
                    depth={3}
                    label={e.fullName}
                    sub={Object.entries(e.parts)
                      .map(([c, v]) => `${partName.get(c) ?? c}: ${sum(n(v))}`)
                      .join(' · ')}
                    payroll={n(e.totalTiyin)}
                  />
                ))}
            </>
          )}
        </>
      )}

      {/* Boshqa moddalar */}
      {(row.categories.length > 0 || otherTotal !== 0) && (
        <>
          <SubRow
            depth={1}
            group
            label="Boshqa moddalar (siyosat bo'yicha)"
            sub={row.categories.map((c) => c.label).join(', ')}
            other={otherTotal}
            covered={otherTotal}
            open={open.has('oth')}
            onClick={() => toggle('oth')}
          />
          {open.has('oth') &&
            (d.categories.length ? (
              d.categories.map((c) => (
                <SubRow
                  key={c.code}
                  depth={2}
                  label={c.label}
                  sub={[
                    Object.entries(c.months)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([m, v]) => `${formatPeriodShort(m)}: ${sum(n(v))}`)
                      .join(' · '),
                    c.sub ? `💬 ${c.sub}` : '',
                  ]
                    .filter(Boolean)
                    .join(' — ')}
                  other={n(c.totalTiyin)}
                  covered={n(c.totalTiyin)}
                />
              ))
            ) : (
              <SubRow depth={2} label="Bu davrda shu moddalarda xarajat yo'q" />
            ))}
        </>
      )}
      {removing !== null &&
        createPortal(
      <ConfirmDialog
        open
        title="Ajratmani o'chirish"
        message={`Qo'lda kiritilgan ajratma o'chiriladi: ${removing?.text ?? ''}. Davom etasizmi?`}
        confirmLabel="O'chirish"
        danger
        loading={busy}
        onConfirm={() => void removeIncome()}
        onCancel={() => setRemoving(null)}
      />,
          document.body,
        )}
    </>
  );
}
