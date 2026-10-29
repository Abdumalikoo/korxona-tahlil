'use client';

import { FilterBar, MoneyCell, NameCell, PillTabs, ReportCard, RTable, StatTiles, STICKY_NAME, STICKY_NO, TableNote, Td, Th, Tr, sum } from '@/components/report/report';
import { NotesList, StatusBadge } from '@/components/report/report-extra-b';
import { EmptyNote, LoadingCard } from '@/components/report/report-extra-c';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { FIELD } from '@/features/purchases/bits';
import { MonthPicker } from '@/features/regional-desk/bits';
import { compact } from '@/features/structure/api';
import { SmallButton } from '@/features/structure/parts';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { type Overhead, RANGE_OPTIONS, type RangeMode, type RuleList, type RuleUnit, reApi, share } from './api';

// ═══════════════════════════════════════════════════════════
// Katta modellar › Markaz xarajati (F): Markaz bo'limlari xarajatini hududlarga taqsimlash.
// Qoida (rol + drayver) har bo'lim uchun, «shu oydan boshlab» — tarix saqlanadi.
// Qoidalarni faqat administrator o'zgartiradi; qolganlar ko'radi.
// ═══════════════════════════════════════════════════════════

const ROLE_TONE: Record<string, 'blue' | 'green' | 'muted'> = {
  SUPPORT: 'blue',
  REVENUE: 'green',
  CORPORATE: 'muted',
};
const ROLE_SHORT: Record<string, string> = { SUPPORT: 'Yordamchi', REVENUE: 'Daromad keltiruvchi', CORPORATE: 'Umumkorporativ' };
const SENS_SHORT: Record<string, string> = { HEADCOUNT: 'Xodim', FTE: 'Stavka', PAYROLL_RECORDS: 'Ish haqi yoz.', REVENUE: 'Daromad', TRANSACTIONS: 'Hujjat', EQUAL: 'Teng' };
/** Kichik tugma — hisobot kartasi sarlavhasida (Hammasini ochish kabi) */
const HEAD_BTN = 'rounded-lg border border-brand-300 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50';

type Toaster = (t: { message: string; tone?: 'success' | 'error' }) => void;

/** Summa katakchasi: 0 bo'lsa — «—» */
function MoneyOrDash({ tiyin, className, children }: { tiyin: string; className?: string; children?: ReactNode }) {
  return (
    <Td className={cn('whitespace-nowrap', className)}>
      {BigInt(tiyin) ? sum(tiyin) : <span className="text-(--color-text-faint)">—</span>}
      {children}
    </Td>
  );
}

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
    <FilterBar actions={<p className="text-xs text-(--color-text-muted)">{d ? `${d.range.label} · ` : ''}Markaz bo&apos;limlari xarajati hududlarga qanday bo&apos;linadi</p>}>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-(--color-text-muted)">Davr</span>
        <PillTabs value={mode} onChange={setMode} options={RANGE_OPTIONS} />
      </div>
    </FilterBar>
  );
  const toastEl = toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} duration={toast.tone === 'error' ? 6000 : 3000} />;

  if (res.error || !d) return <div className="space-y-4">{header}<LoadingCard label="Hisoblanmoqda" error={res.error} onRetry={res.reload} /></div>;

  const total = BigInt(d.totals.totalExpenseTiyin);
  const allocated = BigInt(d.totals.allocatedTiyin);
  const ruleUnit = (key: string) => rules.data?.units.find((u) => u.key === key) ?? null;
  const retainedText = d.totals.retainedByReason.length ? d.totals.retainedByReason.map((r) => `${r.label.split(' — ')[0]}: ${compact(r.amountTiyin)}`).join(' · ') : '—';

  return (
    <div className="space-y-4">
      {header}
      <StatTiles
        items={[
          {
            label: 'Markaz xarajati',
            value: Number(d.totals.centralExpenseTiyin),
            tone: 'blue',
            note: BigInt(d.totals.unassignedExpenseTiyin) ? `+ biriktirilmagan ${compact(d.totals.unassignedExpenseTiyin)}` : `Markaz daromadi ${compact(d.totals.centralIncomeTiyin)}`,
          },
          { label: 'Hududlarga taqsimlandi', value: Number(d.totals.allocatedTiyin), tone: 'green', note: `Jami xarajatning ${share(total ? Number(allocated) / Number(total) : null)} qismi` },
          { label: 'Markazda qoldi', value: Number(d.totals.retainedTiyin), tone: 'orange', note: retainedText },
          {
            label: 'Tekshiruv',
            value: 0,
            text: d.reconciliation.ok ? '✓ Mos' : '✗ Farq bor',
            tone: d.reconciliation.ok ? 'green' : 'red',
            note: d.reconciliation.ok ? 'Taqsimlangan + qolgan = xarajat (tiyingacha)' : `Farq ${compact(d.reconciliation.diffTiyin)}`,
          },
        ]}
      />

      {d.warnings.length > 0 && (
        <div className="rounded-2xl border-l-4 border-l-amber-400 bg-white shadow-card">
          <ul className="space-y-1.5 px-5 py-3 text-sm text-amber-900">
            {d.warnings.map((w) => (
              <li key={w}>• {w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Birliklar: rol, drayver, xarajat, taqsimlangan, qolgan */}
      <ReportCard
        title="Markaz bo'limlari"
        badge={d.range.label}
        actions={
          isAdmin && rules.data && rules.data.units.some((u) => !u.history.length && u.suggestion) ? (
            <AcceptAll period={d.range.from} onDone={(n) => { setToast({ message: `${n} ta qoida tavsiya bo'yicha qo'shildi` }); reload(); }} onError={(e) => setToast({ message: e, tone: 'error' })} />
          ) : undefined
        }
      >
        {d.units.length ? (
          <RTable minWidth={980}>
            <thead>
              <tr>
                <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
                <Th className={cn(STICKY_NAME, 'z-[2] min-w-44 text-left')}>Birlik</Th>
                <Th className="text-left">Qoida</Th>
                <Th>Xarajat</Th>
                <Th>Taqsimlandi</Th>
                <Th>Markazda qoldi</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {d.units.map((u, i) => {
                const ru = ruleUnit(u.key);
                return (
                  <Tr key={u.key} className={cn('align-top', u.kind === 'unassigned' && '[&>td]:bg-amber-50')}>
                    <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                    <NameCell className="font-medium text-heading" sub={BigInt(u.incomeTiyin) !== 0n ? `O'z daromadi: ${compact(u.incomeTiyin)}` : undefined}>
                      {u.name}
                    </NameCell>
                    <Td className="text-left">
                      {u.role ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge tone={ROLE_TONE[u.role] ?? 'muted'}>{ROLE_SHORT[u.role] ?? u.role}</StatusBadge>
                          {u.driverLabel && <span className="text-xs text-(--color-text-muted)">{u.driverLabel}</span>}
                          {u.ruleChanged && (
                            <span title="Davr ichida qoida o'zgargan — har oy o'z qoidasi bilan">
                              <StatusBadge tone="amber">davrda o&apos;zgargan</StatusBadge>
                            </span>
                          )}
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
                    </Td>
                    <MoneyCell value={Number(u.expenseTiyin)} />
                    <MoneyOrDash tiyin={u.allocatedTiyin} className="font-semibold text-brand-700" />
                    <MoneyOrDash tiyin={u.retainedTiyin}>
                      {u.retained.map((r) => (
                        <div key={r.reason} className="text-[11px] text-(--color-text-muted)">{r.label.split(' — ')[0]}</div>
                      ))}
                    </MoneyOrDash>
                    <Td>
                      <div className="flex justify-end gap-1.5">
                        {u.driver === 'MANUAL' && (
                          <SmallButton onClick={() => setManual({ unitKey: u.key, name: u.name })}>Qiymatlar</SmallButton>
                        )}
                        {isAdmin && ru && <SmallButton onClick={() => setEditing(ru)}>Qoida</SmallButton>}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </RTable>
        ) : (
          <EmptyNote>Bu davrda Markaz xarajati yozuvlari yo&apos;q</EmptyNote>
        )}
        <TableNote>
          Rol: yordamchi — hududlarga bo&apos;linadi; daromad keltiruvchi va umumkorporativ — Markazda qoladi. Summalar — so&apos;mda.
          {d.totals.retainedByReason.length > 0 && <> Markazda qoldi: {retainedText}.</>}
        </TableNote>
      </ReportCard>

      <RegionAllocation d={d} />

      {isAdmin && rules.data && <RulesCard data={rules.data} onEdit={setEditing} />}

      <ReportCard title="Qanday hisoblanadi">
        <NotesList notes={[...d.method, `${d.reconciliation.formula}.`]} />
      </ReportCard>

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
      <ReportCard title="Hududlar ulushi va drayverga sezgirlik">
        <EmptyNote>Hali hududlarga hech narsa taqsimlanmadi — bo&apos;limlar uchun qoida belgilang (yordamchi + drayver).</EmptyNote>
      </ReportCard>
    );
  }
  return (
    <ReportCard title="Hududlar ulushi va drayverga sezgirlik" badge={`${compact(d.totals.allocatedTiyin)} so'm`}>
      <RTable minWidth={900}>
        <thead>
          <tr>
            <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
            <Th className={cn(STICKY_NAME, 'z-[2] min-w-40 text-left')}>Hudud</Th>
            <Th>Taqsimlandi</Th>
            <Th>Ulush</Th>
            {sens.map((s) => (
              <Th key={s.driver} title={s.label}>
                {SENS_SHORT[s.driver] ?? s.driver}
              </Th>
            ))}
            <Th title="(eng ko'p − eng kam) ÷ hozirgi">Tebranish</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <Tr key={r.code}>
              <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
              <NameCell className="font-medium text-heading">{r.name}</NameCell>
              <MoneyCell value={Number(r.allocatedTiyin)} strong />
              <Td>{share(r.share)}</Td>
              {r.alts.map((v, j) => (
                <Td key={sens[j]!.driver} className={cn('whitespace-nowrap text-(--color-text-muted)', v === r.max && r.max !== r.min && 'text-(--color-expense)', v === r.min && r.max !== r.min && 'text-(--color-income)')}>
                  {sum(v)}
                </Td>
              ))}
              <Td className={cn('font-semibold', r.spread !== null && r.spread > 0.5 ? 'text-(--color-expense)' : 'text-heading')}>{share(r.spread)}</Td>
            </Tr>
          ))}
        </tbody>
      </RTable>
      <TableNote>
        O&apos;ngdagi ustunlar — xuddi shu {compact(d.totals.allocatedTiyin)} so&apos;mni boshqa drayver bilan bo&apos;lsak, hududga qancha tushardi. Farq katta bo&apos;lsa — natija drayver tanloviga sezgir.
      </TableNote>
    </ReportCard>
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
    <ReportCard
      title="Taqsimlash qoidalari (barcha bo'limlar)"
      badge={`${data.units.filter((u) => u.current).length} / ${data.units.length} birlikda qoida bor · tarix saqlanadi`}
      actions={
        <button type="button" onClick={() => setOpen((o) => !o)} className={HEAD_BTN}>
          {open ? 'Yopish' : 'Ochish'}
        </button>
      }
    >
      {open && (
        <RTable minWidth={760}>
          <thead>
            <tr>
              <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
              <Th className={cn(STICKY_NAME, 'z-[2] min-w-44 text-left')}>Birlik</Th>
              <Th className="text-left">Amaldagi qoida</Th>
              <Th className="text-left">Tarix</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.units.map((u, i) => (
              <Tr key={u.key} className="align-top">
                <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                <NameCell className="font-medium text-heading">{u.name}</NameCell>
                <Td className="text-left">
                  {u.current ? (
                    <>
                      <StatusBadge tone={ROLE_TONE[u.current.role] ?? 'muted'}>{ROLE_SHORT[u.current.role]}</StatusBadge>
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
                </Td>
                <Td className="text-left text-[11px] text-(--color-text-muted)">
                  {u.history.length > 1
                    ? u.history.slice(0, 4).map((r) => (
                        <div key={r.id}>
                          {r.validFrom}: {ROLE_SHORT[r.role]}
                          {r.driverLabel ? `, ${r.driverLabel}` : ''}
                        </div>
                      ))
                    : '—'}
                </Td>
                <Td className="text-right">
                  <SmallButton onClick={() => onEdit(u)}>O&apos;zgartirish</SmallButton>
                </Td>
              </Tr>
            ))}
          </tbody>
        </RTable>
      )}
    </ReportCard>
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
          <div className="-mx-4">
            <RTable minWidth={0}>
              <thead>
                <tr>
                  <Th className="w-10">№</Th>
                  <Th className="text-left">Hudud</Th>
                  <Th className="w-32">Qiymat</Th>
                  <Th className="w-16">Ulush</Th>
                </tr>
              </thead>
              <tbody>
                {data.data?.regions.map((r, i) => {
                  const v = Number((vals[r.code] ?? '').replace(',', '.')) || 0;
                  return (
                    <Tr key={r.code}>
                      <Td className="text-(--color-text-faint)">{i + 1}</Td>
                      <NameCell sticky={false}>{r.name}</NameCell>
                      <Td className="py-1">
                        <input value={vals[r.code] ?? ''} disabled={!canEdit} inputMode="decimal" onChange={(e) => setVals((s) => ({ ...s, [r.code]: e.target.value }))} className={cn(FIELD, 'h-9 text-right')} placeholder="0" />
                      </Td>
                      <Td className="text-xs text-(--color-text-muted)">{total ? share(v / total) : ''}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </RTable>
          </div>
        )}
      </div>
    </Drawer>
  );
}