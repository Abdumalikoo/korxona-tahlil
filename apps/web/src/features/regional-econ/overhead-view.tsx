'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { FIELD } from '@/features/purchases/bits';
import { MonthPicker } from '@/features/regional-desk/bits';
import { compact } from '@/features/structure/api';
import { KpiStrip, PanelHeader, SmallButton } from '@/features/structure/parts';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useState } from 'react';
import { type Overhead, type RangeMode, type RuleList, type RuleUnit, reApi, share } from './api';
import { RangeBar } from './performance-view';

// ═══════════════════════════════════════════════════════════
// Katta modellar › Markaz xarajati (F): Markaz bo'limlari xarajatini hududlarga taqsimlash.
// Qoida (rol + drayver) har bo'lim uchun, «shu oydan boshlab» — tarix saqlanadi.
// Qoidalarni faqat administrator o'zgartiradi; qolganlar ko'radi.
// ═══════════════════════════════════════════════════════════

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)';
const ROLE_CLS: Record<string, string> = {
  SUPPORT: 'bg-brand-100 text-brand-800',
  REVENUE: 'bg-emerald-100 text-emerald-800',
  CORPORATE: 'bg-slate-200 text-slate-700',
};
const ROLE_SHORT: Record<string, string> = { SUPPORT: 'Yordamchi', REVENUE: 'Daromad keltiruvchi', CORPORATE: 'Umumkorporativ' };
const SENS_SHORT: Record<string, string> = { HEADCOUNT: 'Xodim', FTE: 'Stavka', PAYROLL_RECORDS: 'Ish haqi yoz.', REVENUE: 'Daromad', TRANSACTIONS: 'Hujjat', EQUAL: 'Teng' };

type Toaster = (t: { message: string; tone?: 'success' | 'error' }) => void;

export function OverheadView() {
  const { month } = usePeriod();
  const { isAdmin } = useAuth();
  const [mode, setMode] = useState<RangeMode>('M');
  const [tick, setTick] = useState(0);
  const res = useAsync(() => reApi.overhead(month, mode).then((r) => r.data), [month, mode, tick]);
  const rules = useAsync(() => reApi.rules().then((r) => r.data), [tick]);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'error' } | null>(null);
  const [editing, setEditing] = useState<RuleUnit | null>(null);
  const [manual, setManual] = useState<{ unitKey: string; name: string } | null>(null);
  const d = res.data;
  const reload = () => setTick((t) => t + 1);

  const header = (
    <PanelHeader
      title="Markaz xarajati"
      description={d ? `${d.range.label} · Markaz bo'limlari xarajati hududlarga qanday bo'linadi` : "Markaz bo'limlari xarajati hududlarga qanday bo'linadi"}
      actions={<RangeBar mode={mode} onMode={setMode} />}
    />
  );
  const toastEl = toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} duration={toast.tone === 'error' ? 6000 : 3000} />;

  if (res.error) return <div className="space-y-4">{header}<Card><ErrorState message={res.error} onRetry={res.reload} /></Card></div>;
  if (!d) return <div className="space-y-4">{header}<Card><LoadingState label="Hisoblanmoqda" /></Card></div>;

  const total = BigInt(d.totals.totalExpenseTiyin);
  const allocated = BigInt(d.totals.allocatedTiyin);
  const ruleUnit = (key: string) => rules.data?.units.find((u) => u.key === key) ?? null;

  return (
    <div className="space-y-4">
      {header}
      <KpiStrip
        items={[
          { label: 'Markaz xarajati', value: `${compact(d.totals.centralExpenseTiyin)} so'm`, sub: BigInt(d.totals.unassignedExpenseTiyin) ? `+ biriktirilmagan ${compact(d.totals.unassignedExpenseTiyin)}` : `Markaz daromadi ${compact(d.totals.centralIncomeTiyin)}` },
          { label: 'Hududlarga taqsimlandi', value: `${compact(d.totals.allocatedTiyin)} so'm`, sub: `Jami xarajatning ${share(total ? Number(allocated) / Number(total) : null)} qismi` },
          {
            label: 'Markazda qoldi',
            value: `${compact(d.totals.retainedTiyin)} so'm`,
            sub: d.totals.retainedByReason.length ? d.totals.retainedByReason.map((r) => `${r.label.split(' — ')[0]}: ${compact(r.amountTiyin)}`).join(' · ') : '—',
          },
          {
            label: 'Tekshiruv',
            value: d.reconciliation.ok ? '✓ Mos' : '✗ Farq bor',
            valueClass: d.reconciliation.ok ? 'text-(--color-income)' : 'text-(--color-expense)',
            sub: d.reconciliation.ok ? 'Taqsimlangan + qolgan = xarajat (tiyingacha)' : `Farq ${compact(d.reconciliation.diffTiyin)}`,
          },
        ]}
      />

      {d.warnings.length > 0 && (
        <Card className="border-l-4 border-l-amber-400">
          <ul className="space-y-1.5 px-5 py-3 text-sm text-amber-900">
            {d.warnings.map((w) => (
              <li key={w}>• {w}</li>
            ))}
          </ul>
        </Card>
      )}

      {/* Birliklar: rol, drayver, xarajat, taqsimlangan, qolgan */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-(--color-line) px-5 py-3">
          <div>
            <h3 className="text-sm font-bold text-heading">Markaz bo&apos;limlari</h3>
            <p className="text-xs text-(--color-text-muted)">Rol: yordamchi — hududlarga bo&apos;linadi; daromad keltiruvchi va umumkorporativ — Markazda qoladi</p>
          </div>
          {isAdmin && rules.data && rules.data.units.some((u) => !u.history.length && u.suggestion) && (
            <AcceptAll period={d.range.from} onDone={(n) => { setToast({ message: `${n} ta qoida tavsiya bo'yicha qo'shildi` }); reload(); }} onError={(e) => setToast({ message: e, tone: 'error' })} />
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="bg-(--color-surface-muted) text-left">
              <tr>
                <th className={TH}>Birlik</th>
                <th className={TH}>Qoida</th>
                <th className={cn(TH, 'text-right')}>Xarajat</th>
                <th className={cn(TH, 'text-right')}>Taqsimlandi</th>
                <th className={cn(TH, 'text-right')}>Markazda qoldi</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {d.units.map((u) => {
                const ru = ruleUnit(u.key);
                return (
                  <tr key={u.key} className={cn('border-t border-(--color-line) align-top', u.kind === 'unassigned' && 'bg-amber-50/50')}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-heading">{u.name}</div>
                      {BigInt(u.incomeTiyin) !== 0n && <div className="text-[11px] text-(--color-text-muted)">O&apos;z daromadi: {compact(u.incomeTiyin)}</div>}
                    </td>
                    <td className="px-3 py-2">
                      {u.role ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold', ROLE_CLS[u.role])}>{ROLE_SHORT[u.role] ?? u.role}</span>
                          {u.driverLabel && <span className="text-xs text-(--color-text-muted)">{u.driverLabel}</span>}
                          {u.ruleChanged && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800" title="Davr ichida qoida o'zgargan — har oy o'z qoidasi bilan">davrda o&apos;zgargan</span>}
                        </div>
                      ) : (
                        <span className="text-xs font-medium text-amber-700">Qoida yo&apos;q</span>
                      )}
                      {u.suggestion && (
                        <div className="mt-1 text-[11px] text-(--color-text-muted)">
                          Tavsiya: <b>{ROLE_SHORT[u.suggestion.role]}</b>
                          {u.suggestion.driverLabel ? `, ${u.suggestion.driverLabel}` : ''} — {u.suggestion.reason}
                        </div>
                      )}
                    </td>
                    <td className="money px-3 py-2 text-right">{compact(u.expenseTiyin)}</td>
                    <td className="money px-3 py-2 text-right font-semibold text-brand-700">{BigInt(u.allocatedTiyin) ? compact(u.allocatedTiyin) : '—'}</td>
                    <td className="money px-3 py-2 text-right">
                      {BigInt(u.retainedTiyin) ? compact(u.retainedTiyin) : '—'}
                      {u.retained.map((r) => (
                        <div key={r.reason} className="text-[11px] text-(--color-text-muted)">{r.label.split(' — ')[0]}</div>
                      ))}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1.5">
                        {u.driver === 'MANUAL' && (
                          <SmallButton onClick={() => setManual({ unitKey: u.key, name: u.name })}>Qiymatlar</SmallButton>
                        )}
                        {isAdmin && ru && <SmallButton onClick={() => setEditing(ru)}>Qoida</SmallButton>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!d.units.length && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-(--color-text-muted)">Bu davrda Markaz xarajati yozuvlari yo&apos;q</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <RegionAllocation d={d} />

      {isAdmin && rules.data && <RulesCard data={rules.data} onEdit={setEditing} />}

      <Card>
        <div className="px-5 py-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">Qanday hisoblanadi</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {d.method.map((m) => (
              <li key={m}>{m}</li>
            ))}
            <li>{d.reconciliation.formula}.</li>
          </ul>
        </div>
      </Card>

      {editing && rules.data && (
        <RuleDrawer
          unit={editing}
          list={rules.data}
          defaultFrom={d.range.from}
          onClose={() => setEditing(null)}
          onSaved={(m) => { setToast({ message: m }); setEditing(null); reload(); }}
          toast={setToast}
        />
      )}
      {manual && <ManualDrawer unitKey={manual.unitKey} name={manual.name} initialPeriod={d.range.to} canEdit={isAdmin} onClose={() => setManual(null)} onSaved={() => { setToast({ message: 'Qiymatlar saqlandi' }); reload(); }} toast={setToast} />}
      {toastEl}
    </div>
  );
}

/** Hududlar ulushi va sezgirlik: shu pul boshqa drayver bilan bo'linsa */
function RegionAllocation({ d }: { d: Overhead }) {
  const sens = d.sensitivity;
  const rows = useMemo(
    () =>
      [...d.regions]
        .sort((a, b) => Number(b.allocatedTiyin) - Number(a.allocatedTiyin))
        .map((r) => {
          const alts = sens.map((s) => Number(s.byRegion[String(r.code)] ?? 0));
          const min = Math.min(...alts);
          const max = Math.max(...alts);
          const actual = Number(r.allocatedTiyin);
          return { ...r, alts, min, max, spread: actual ? (max - min) / actual : null };
        }),
    [d, sens],
  );
  if (BigInt(d.totals.allocatedTiyin) === 0n) {
    return (
      <Card>
        <p className="px-5 py-4 text-sm text-(--color-text-muted)">Hali hududlarga hech narsa taqsimlanmadi — bo&apos;limlar uchun qoida belgilang (yordamchi + drayver).</p>
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-(--color-line) px-5 py-3">
        <h3 className="text-sm font-bold text-heading">Hududlar ulushi va drayverga sezgirlik</h3>
        <p className="text-xs text-(--color-text-muted)">
          O&apos;ngdagi ustunlar — xuddi shu {compact(d.totals.allocatedTiyin)} so&apos;mni boshqa drayver bilan bo&apos;lsak, hududga qancha tushardi. Farq katta bo&apos;lsa — natija drayver tanloviga sezgir.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-(--color-surface-muted) text-left">
            <tr>
              <th className={TH}>Hudud</th>
              <th className={cn(TH, 'text-right')}>Taqsimlandi</th>
              <th className={cn(TH, 'text-right')}>Ulush</th>
              {sens.map((s) => (
                <th key={s.driver} className={cn(TH, 'text-right')} title={s.label}>
                  {SENS_SHORT[s.driver] ?? s.driver}
                </th>
              ))}
              <th className={cn(TH, 'text-right')} title="(eng ko'p − eng kam) ÷ hozirgi">Tebranish</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} className="border-t border-(--color-line)">
                <td className="px-3 py-2 font-medium text-heading">{r.name}</td>
                <td className="money px-3 py-2 text-right font-semibold">{compact(r.allocatedTiyin)}</td>
                <td className="money px-3 py-2 text-right">{share(r.share)}</td>
                {r.alts.map((v, i) => (
                  <td key={sens[i]!.driver} className={cn('money px-3 py-2 text-right text-(--color-text-muted)', v === r.max && r.max !== r.min && 'text-(--color-expense)', v === r.min && r.max !== r.min && 'text-(--color-income)')}>
                    {compact(String(v))}
                  </td>
                ))}
                <td className={cn('money px-3 py-2 text-right font-semibold', r.spread !== null && r.spread > 0.5 ? 'text-(--color-expense)' : 'text-heading')}>{share(r.spread)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function AcceptAll({ period, onDone, onError }: { period: string; onDone: (n: number) => void; onError: (e: string) => void }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(period);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-(--color-text-muted)">Qaysi oydan:</span>
      <MonthPicker value={from} onChange={setFrom} />
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Tavsiyalarni tasdiqlash
      </Button>
      <ConfirmDialog
        open={open}
        title="Tavsiya etilgan qoidalar"
        message={`Qoidasi umuman yo'q barcha bo'limlarga tavsiya etilgan rol va drayver ${from} oyidan boshlab qo'yiladi. Keyin har birini alohida o'zgartirish mumkin.`}
        confirmLabel="Tasdiqlash"
        loading={busy}
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            const r = await reApi.acceptSuggestions(from);
            onDone(r.data.created);
            setOpen(false);
          } catch (e) {
            onError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

/** Qoidalar ro'yxati (administrator): joriy, kelgusi, tarix */
function RulesCard({ data, onEdit }: { data: RuleList; onEdit: (u: RuleUnit) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-5 py-3 text-left">
        <div>
          <h3 className="text-sm font-bold text-heading">Taqsimlash qoidalari (barcha bo&apos;limlar)</h3>
          <p className="text-xs text-(--color-text-muted)">
            {data.units.filter((u) => u.current).length} / {data.units.length} birlikda qoida bor · tarix saqlanadi
          </p>
        </div>
        <span className="text-sm text-brand-700">{open ? 'Yopish' : 'Ochish'}</span>
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-(--color-line)">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-(--color-surface-muted) text-left">
              <tr>
                <th className={TH}>Birlik</th>
                <th className={TH}>Amaldagi qoida</th>
                <th className={TH}>Tarix</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {data.units.map((u) => (
                <tr key={u.key} className="border-t border-(--color-line) align-top">
                  <td className="px-3 py-2 font-medium text-heading">{u.name}</td>
                  <td className="px-3 py-2">
                    {u.current ? (
                      <>
                        <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold', ROLE_CLS[u.current.role])}>{ROLE_SHORT[u.current.role]}</span>
                        {u.current.driverLabel && <span className="ml-1.5 text-xs">{u.current.driverLabel}</span>}
                        <div className="text-[11px] text-(--color-text-muted)">{u.current.validFrom} dan{u.current.createdBy ? ` · ${u.current.createdBy}` : ''}</div>
                      </>
                    ) : (
                      <span className="text-xs text-amber-700">yo&apos;q</span>
                    )}
                    {u.upcoming.map((r) => (
                      <div key={r.id} className="mt-1 text-[11px] text-sky-800">
                        Kelgusi: {r.validFrom} dan — {ROLE_SHORT[r.role]}
                        {r.driverLabel ? `, ${r.driverLabel}` : ''}
                      </div>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-(--color-text-muted)">
                    {u.history.length > 1
                      ? u.history.slice(0, 4).map((r) => (
                          <div key={r.id}>
                            {r.validFrom}: {ROLE_SHORT[r.role]}
                            {r.driverLabel ? `, ${r.driverLabel}` : ''}
                          </div>
                        ))
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <SmallButton onClick={() => onEdit(u)}>O&apos;zgartirish</SmallButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function RuleDrawer({ unit, list, defaultFrom, onClose, onSaved, toast }: { unit: RuleUnit; list: RuleList; defaultFrom: string; onClose: () => void; onSaved: (m: string) => void; toast: Toaster }) {
  const base = unit.current ?? (unit.suggestion ? { role: unit.suggestion.role, driver: unit.suggestion.driver } : null);
  const [role, setRole] = useState(base?.role ?? 'SUPPORT');
  const [driver, setDriver] = useState<string>(base?.driver ?? 'HEADCOUNT');
  const [from, setFrom] = useState(defaultFrom);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    try {
      await reApi.setRule({ unitKey: unit.key, role, driver: role === 'SUPPORT' ? driver : null, validFrom: from, note: note.trim() || null });
      onSaved('Qoida saqlandi');
    } catch (e) {
      toast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      open
      onClose={onClose}
      title={`Qoida: ${unit.name}`}
      description="Yangi qoida tanlangan oydan boshlab amal qiladi; oldingi oylar eski qoida bilan qoladi"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Bekor
          </Button>
          <Button data-save onClick={() => void save()} loading={busy}>
            Saqlash
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {unit.suggestion && !unit.current && (
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
            Tavsiya: <b>{unit.suggestion.roleLabel}</b>
            {unit.suggestion.driverLabel ? ` · ${unit.suggestion.driverLabel}` : ''}
            <div className="text-xs">{unit.suggestion.reason}</div>
          </div>
        )}
        <div>
          <p className="mb-1.5 text-sm font-medium text-heading">Bo&apos;lim roli</p>
          <div className="space-y-1.5">
            {list.roles.map((r) => (
              <label key={r.value} className={cn('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm', role === r.value ? 'border-brand-400 bg-brand-50' : 'border-(--color-line)')}>
                <input type="radio" checked={role === r.value} onChange={() => setRole(r.value)} />
                {r.label}
              </label>
            ))}
          </div>
        </div>
        {role === 'SUPPORT' && (
          <div>
            <p className="mb-1.5 text-sm font-medium text-heading">Drayver — nimaga qarab bo&apos;linadi</p>
            <select value={driver} onChange={(e) => setDriver(e.target.value)} className={FIELD}>
              {list.drivers.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </select>
            {driver === 'MANUAL' && <p className="mt-1 text-xs text-amber-800">Har oy uchun hudud qiymatlarini «Qiymatlar» tugmasi orqali kiriting — kiritilmagan oy taqsimlanmaydi.</p>}
          </div>
        )}
        <div>
          <p className="mb-1.5 text-sm font-medium text-heading">Qaysi oydan</p>
          <MonthPicker value={from} onChange={setFrom} />
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-heading">Izoh (nega shunday)</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={cn(FIELD, 'h-auto py-2')} placeholder="Masalan: buxgalteriya ishi vedomostlar soniga bog'liq" />
        </div>
        {unit.history.length > 0 && (
          <div>
            <p className="mb-1.5 text-sm font-medium text-heading">Tarix</p>
            <ul className="divide-y divide-(--color-line) rounded-lg border border-(--color-line) text-sm">
              {unit.history.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-2 px-3 py-2">
                  <div>
                    <b>{r.validFrom}</b> — {r.roleLabel}
                    {r.driverLabel ? `, ${r.driverLabel}` : ''}
                    {r.note && <div className="text-xs text-(--color-text-muted)">{r.note}</div>}
                    {r.createdBy && <div className="text-[11px] text-(--color-text-faint)">{r.createdBy}</div>}
                  </div>
                  <SmallButton onClick={() => setDel(r.id)}>O&apos;chirish</SmallButton>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={del !== null}
        title="Qoidani o'chirish"
        message="Bu qoida o'chiriladi — shu oylar oldingi qoida bilan (yoki qoidasiz) qayta hisoblanadi."
        danger
        confirmLabel="O'chirish"
        onCancel={() => setDel(null)}
        onConfirm={async () => {
          try {
            await reApi.deleteRule(del!);
            setDel(null);
            onSaved("Qoida o'chirildi");
          } catch (e) {
            toast({ message: errorMessage(e), tone: 'error' });
          }
        }}
      />
    </Drawer>
  );
}

/** Qo'lda drayver qiymatlari (masalan, tekshiruvlar soni) — oy × hudud */
function ManualDrawer({ unitKey, name, initialPeriod, canEdit, onClose, onSaved, toast }: { unitKey: string; name: string; initialPeriod: string; canEdit: boolean; onClose: () => void; onSaved: () => void; toast: Toaster }) {
  const [period, setPeriod] = useState(initialPeriod);
  const data = useAsync(() => reApi.drivers(period, unitKey).then((r) => r.data), [period, unitKey]);
  const [vals, setVals] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data.data) setVals(Object.fromEntries(data.data.regions.map((r) => [r.code, r.value === null ? '' : String(r.value)])));
  }, [data.data]);
  const total = Object.values(vals).reduce((s, v) => s + (Number(v.replace(',', '.')) || 0), 0);
  const save = async () => {
    setBusy(true);
    try {
      await reApi.setDrivers(period, unitKey, Object.entries(vals).map(([k, v]) => ({ regionCode: Number(k), value: v.trim() === '' ? null : Number(v.replace(',', '.')) })));
      onSaved();
    } catch (e) {
      toast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      open
      onClose={onClose}
      title={`Qo'lda drayver: ${name}`}
      description="Har hudud uchun shu oy qiymati (masalan, tekshiruvlar yoki murojaatlar soni). Bo'sh — 0"
      footer={
        canEdit ? (
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Yopish
            </Button>
            <Button data-save onClick={() => void save()} loading={busy}>
              Saqlash
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-3">
        <MonthPicker value={period} onChange={setPeriod} />
        {data.loading && !data.data ? (
          <LoadingState />
        ) : data.error ? (
          <ErrorState message={data.error} onRetry={data.reload} />
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {data.data?.regions.map((r) => {
                const v = Number((vals[r.code] ?? '').replace(',', '.')) || 0;
                return (
                  <tr key={r.code} className="border-t border-(--color-line)">
                    <td className="py-1.5">{r.name}</td>
                    <td className="w-32 py-1">
                      <input value={vals[r.code] ?? ''} disabled={!canEdit} inputMode="decimal" onChange={(e) => setVals((s) => ({ ...s, [r.code]: e.target.value }))} className={cn(FIELD, 'h-9 text-right')} placeholder="0" />
                    </td>
                    <td className="w-16 py-1.5 text-right text-xs text-(--color-text-muted)">{total ? share(v / total) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Drawer>
  );
}