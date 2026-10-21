'use client';

import { SourceActions } from '@/components/shared/source-actions';

import { PageHeader } from '@/components/layout/page-header';
import { MoneyInput } from '@/components/shared/money-input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Toast } from '@/components/ui/toast';
import { regionsApi } from '@/features/employees/api';
import { referencesApi } from '@/features/shared/references';
import { compact, pct } from '@/features/structure/api';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatPeriod, formatPeriodShort, todayInput } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { assetsApi, MODE_INFO, type AssetMode, type AssetPolicyView, type AssetStatus, type FixedAssetView } from './api';
import { AssetImportDialog } from './assets-import';
import { AdoptDialog } from './adopt-dialog';
import { BalanceReportView } from './assets-report';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › Asosiy vositalar.
//   Xarid xarajatga birdaniga yozilmaydi — balansda turadi; xarajatga har oy sarfi (eskirish) o'tadi:
//   qiymat ÷ xizmat muddati, xariddan keyingi oydan. Hisobdan chiqarilsa — qolgan qiymat o'sha oy sarfga.
//   Manba: Ombor › Kirim (asosiy vosita), siyosatda belgilangan moddadagi xarajatlar, qo'lda kiritilganlar.
//   Sarf — Markaz xarajatining 2-guruhi (Solishtirma, Markaz paneli, Xarajatlar siyosati).
// ═══════════════════════════════════════════════════════════

const AV_COLOR = '#b7791f';

const STATUS: Record<AssetStatus, { label: string; cls: string }> = {
  active: { label: 'Sarf ketmoqda', cls: 'bg-amber-50 text-amber-800' },
  done: { label: "To'liq sarflangan", cls: 'bg-(--color-surface-sunken) text-(--color-text-muted)' },
  disposed: { label: 'Hisobdan chiqarilgan', cls: 'bg-red-50 text-red-700' },
  expense: { label: "Xarajatga o'tkazilgan", cls: 'bg-sky-50 text-sky-800' },
  hold: { label: 'Balansda (xarajatsiz)', cls: 'bg-emerald-50 text-emerald-800' },
};

const MODE_ORDER: AssetMode[] = ['HOLD', 'EXPENSE', 'BALANCE'];

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'Hammasi' },
  { value: 'hold', label: 'Balansda (xarajatsiz)' },
  { value: 'active', label: 'Sarf ketmoqda' },
  { value: 'done', label: "To'liq sarflangan" },
  { value: 'disposed', label: 'Hisobdan chiqarilgan' },
  { value: 'expense', label: "Xarajatga o'tkazilgan" },
];

function monthEndIso(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  return end > today ? today : end;
}

const lifeText = (m: number) => (m % 12 === 0 ? `${m / 12} yil` : m > 12 ? `${Math.floor(m / 12)} yil ${m % 12} oy` : `${m} oy`);

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: ReactNode; color?: string }) {
  return (
    <Card className="p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-heading" style={color ? { color } : undefined}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-(--color-text-muted)">{sub}</p>}
    </Card>
  );
}

function ChargeBars({ months, values }: { months: string[]; values: string[] }) {
  const max = Math.max(...values.map(Number), 1);
  return (
    <div className="flex h-32 items-end gap-1.5 px-5 pb-2 pt-4">
      {months.map((m, i) => {
        const v = Number(values[i] ?? 0);
        return (
          <div key={m} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${formatPeriodShort(m)}: sarf ${compact(v)}`}>
            <div className="w-full max-w-9 rounded-t" style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? 2 : 0, background: AV_COLOR }} />
            <span className="text-[10px] text-(--color-text-muted)">{formatPeriodShort(m)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Bitta vosita: ma'lumot, sarf jadvali, amallar */
function AssetDrawer({ id, onClose, onChanged, isAdmin }: { id: string | null; onClose: () => void; onChanged: (msg: string) => void; isAdmin: boolean }) {
  const res = useAsync(() => (id ? assetsApi.detail(id).then((r) => r.data) : Promise.resolve(null)), [id]);
  const [life, setLife] = useState('');
  const [offDate, setOffDate] = useState(todayInput());
  const [offReason, setOffReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'remove'>(null);
  const a = res.data?.asset ?? null;
  useEffect(() => {
    if (a) setLife(String(a.lifeMonths));
    setErr(null);
  }, [a]);

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onChanged(msg);
      res.reload();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <Drawer open={id !== null} onClose={onClose} title={a?.name ?? 'Asosiy vosita'} description={a ? `${a.categoryLabel} · ${a.place}` : undefined} width="lg">
      {!a ? (
        <p className="py-8 text-center text-sm text-(--color-text-muted)">{res.error ? `Yuklab bo'lmadi: ${res.error}` : 'Yuklanmoqda…'}</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {(
              [
                ['Boshlang\'ich qiymat', compact(a.costTiyin)],
                ['Qoldiq qiymat', compact(a.residualTiyin)],
                ["Yig'ilgan sarf", compact(a.accumulatedTiyin)],
                ['Oylik sarf', a.mode === 'BALANCE' ? compact(a.monthlyTiyin) : '—'],
                ['Sana', formatDate(a.acquiredAt)],
                ['Rejim', a.modeLabel],
                ...(a.mode === 'BALANCE'
                  ? [
                      ['Xizmat muddati', `${lifeText(a.lifeMonths)}${a.lifeOverridden ? ' (qo\'lda)' : ''}`],
                      ['Sarf tugaydi', formatPeriod(a.endPeriod)],
                    ]
                  : []),
                ['Manba', a.sourceLabel],
                ['Inventar raqami', a.inventoryNo ?? '—'],
                ...(a.holderName ? [['Qabul qiluvchi', a.holderName]] : []),
                ...(a.quantity > 1 ? [['Soni', `${a.quantity} dona`]] : []),
                ...(a.placeText ? [["Fayldagi bo'lim", a.placeText]] : []),
                ...(a.importBatch ? [['Partiya', a.importBatch]] : []),
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} className="rounded-lg bg-(--color-surface-muted) px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">{k}</p>
                <p className="mt-0.5 font-semibold tabular-nums text-heading">{v}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', STATUS[a.status].cls)}>{STATUS[a.status].label}</span>
            {a.disposedAt && (
              <span className="text-xs text-(--color-text-muted)">
                {formatDate(a.disposedAt)} · {a.disposeReason}
              </span>
            )}
            {a.source === 'WAREHOUSE' && (
              <Link href="/ombor/asosiy-vositalar" className="text-xs font-semibold text-brand-700 underline">
                Omborda ko&apos;rish
              </Link>
            )}
          </div>

          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

          {isAdmin && (
            <div className="space-y-2 rounded-xl border border-(--color-line) p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-(--color-text-muted)">Rejim</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {MODE_ORDER.map((m) => {
                  const disabled = m === 'EXPENSE' && a.source === 'WAREHOUSE';
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={busy || disabled || a.mode === m}
                      onClick={() => void run(() => assetsApi.mode(a.id, m), `Rejim: ${MODE_INFO[m].label}`)}
                      title={disabled ? "Ombor vositasi xarajatga o'tkazilmaydi" : MODE_INFO[m].hint}
                      className={cn(
                        'rounded-lg border px-3 py-2 text-left text-xs transition-colors disabled:cursor-default',
                        a.mode === m ? 'border-brand-700 bg-brand-50 font-semibold text-heading ring-1 ring-brand-700' : 'border-(--color-line) hover:bg-(--color-surface-muted)',
                        disabled && 'opacity-40',
                      )}
                    >
                      {MODE_INFO[m].label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-(--color-text-muted)">{(MODE_INFO[a.mode as AssetMode] ?? MODE_INFO.BALANCE).hint}</p>
            </div>
          )}

          {isAdmin && a.mode !== 'EXPENSE' && (
            <div className="space-y-3 rounded-xl border border-(--color-line) p-3">
              {a.mode === 'BALANCE' && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-40">
                  <Input label="Xizmat muddati, oy" type="number" min={1} max={600} value={life} onChange={(e) => setLife(e.target.value)} />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy}
                  disabled={!life || Number(life) === a.lifeMonths}
                  onClick={() => void run(() => assetsApi.update(a.id, { lifeMonths: Number(life) }), 'Xizmat muddati o\'zgartirildi — sarf qayta hisoblandi')}
                >
                  Muddatni saqlash
                </Button>
                {a.lifeOverridden && (
                  <Button variant="ghost" size="sm" loading={busy} onClick={() => void run(() => assetsApi.update(a.id, { lifeMonths: null }), 'Muddat siyosatdagidek qilindi')}>
                    Siyosatdagidek
                  </Button>
                )}
              </div>
              )}
              {a.source !== 'WAREHOUSE' &&
                (a.disposedAt ? (
                  <Button variant="secondary" size="sm" loading={busy} onClick={() => void run(() => assetsApi.dispose(a.id, { undo: true }), 'Hisobdan chiqarish bekor qilindi')}>
                    Hisobdan chiqarishni bekor qilish
                  </Button>
                ) : (
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="w-52">
                      <Input label="Hisobdan chiqarish sanasi" type="date" value={offDate} onChange={(e) => setOffDate(e.target.value)} />
                    </div>
                    <div className="min-w-48 flex-1">
                      <Input label="Sabab" placeholder="Yaroqsiz, sotildi, yo'qoldi…" value={offReason} onChange={(e) => setOffReason(e.target.value)} />
                    </div>
                    <Button variant="danger" size="sm" loading={busy} onClick={() => void run(() => assetsApi.dispose(a.id, { date: offDate, reason: offReason }), a.mode === 'HOLD' ? 'Hisobdan chiqarildi — balansdan olindi' : 'Hisobdan chiqarildi — qolgan qiymat shu oy sarfga o\'tdi')}>
                      Hisobdan chiqarish
                    </Button>
                  </div>
                ))}
              {a.source === 'WAREHOUSE' && <p className="text-xs text-(--color-text-muted)">Ombor vositasi Ombor › Hujjatlar › «Hisobdan chiqarish» hujjati bilan chiqariladi (dalolatnoma bilan) — bu yerda o&apos;zi yangilanadi.</p>}
            </div>
          )}
          {isAdmin && (a.source === 'MANUAL' || a.source === 'IMPORT') && (
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setConfirm('remove')}>
                O&apos;chirish
              </Button>
            </div>
          )}

          {res.data && res.data.schedule.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-(--color-line)">
              <p className="border-b border-(--color-line) bg-(--color-surface-muted) px-4 py-2 text-sm font-semibold text-heading">Sarf jadvali (oyma-oy)</p>
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white text-left text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">
                    <tr>
                      <th className="px-4 py-2">Oy</th>
                      <th className="px-4 py-2 text-right">Sarf</th>
                      <th className="px-4 py-2 text-right">Yig&apos;ilgan</th>
                      <th className="px-4 py-2 text-right">Qoldiq</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-(--color-line)">
                    {res.data.schedule.map((r) => (
                      <tr key={r.period} className={cn(!r.done && 'text-(--color-text-faint)')}>
                        <td className="px-4 py-1.5">{formatPeriod(r.period)}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums">{compact(r.amountTiyin)}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums">{compact(r.accumulatedTiyin)}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums">{compact(r.residualTiyin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-(--color-line) px-4 py-2 text-[11px] text-(--color-text-muted)">Kulrang — hali kelmagan oylar (oy kelganda xarajatga avtomatik yoziladi).</p>
            </div>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'remove' ? "Asosiy vositani o'chirish" : 'Xarajat qilib qoldirish'}
        message={
          confirm === 'remove'
            ? "Vosita va unga tegishli sarf / xarajat yozuvlari o'chadi."
            : 'Xarid summasi xarid oyi xarajatiga to\'liq qaytadi, oylik sarf yozuvlari olib tashlanadi. Keyin yana balansga olish mumkin.'
        }
        danger={confirm === 'remove'}
        loading={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() =>
          a &&
          void run(
            () => (confirm === 'remove' ? assetsApi.remove(a.id) : assetsApi.mode(a.id, 'EXPENSE')),
            confirm === 'remove' ? "O'chirildi" : 'Xarajat qilib qoldirildi',
          ).then(() => confirm === 'remove' && onClose())
        }
      />
    </Drawer>
  );
}

/** Qo'lda qo'shish: boshlang'ich qoldiq (bino, mashina …) */
function CreateDrawer({ open, onClose, onSaved, categories }: { open: boolean; onClose: () => void; onSaved: (msg: string) => void; categories: { value: string; label: string }[] }) {
  const regions = useAsync(() => (open ? regionsApi.list().then((r) => r.data) : Promise.resolve([])), [open]);
  const depts = useAsync(() => (open ? referencesApi.departments().then((r) => r.data) : Promise.resolve([])), [open]);
  const [name, setName] = useState('');
  const [cost, setCost] = useState<number | null>(null);
  const [date, setDate] = useState(todayInput());
  const [cat, setCat] = useState('');
  const [life, setLife] = useState('');
  const [region, setRegion] = useState('0');
  const [dept, setDept] = useState('');
  const [inv, setInv] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await assetsApi.create({
        name,
        costTiyin: String(Math.round((cost ?? 0) * 100)),
        acquiredAt: date,
        categoryCode: cat,
        lifeMonths: life ? Number(life) : null,
        regionCode: Number(region),
        departmentId: region === '0' && dept ? dept : null,
        inventoryNo: inv,
        note,
      });
      onSaved("Asosiy vosita qo'shildi — sarf hisoblandi");
      setName('');
      setCost(null);
      setInv('');
      setNote('');
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Asosiy vosita qo'shish"
      description="Boshlang'ich qoldiq yoki ombordan o'tmagan vosita (bino, mashina, uskuna)"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button data-save onClick={() => void save()} loading={busy} disabled={name.trim().length < 2 || !cost || !cat || !date}>
            Saqlash
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        <Input label="Nomi" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Masalan: Ofis binosi, Chevrolet Cobalt" />
        <div className="grid gap-3 sm:grid-cols-2">
          <MoneyInput label="Boshlang'ich qiymat, so'm" required value={cost} onChange={setCost} />
          <Input label="Xarid (qabul) sanasi" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <Select label="Modda" required options={categories} placeholder="Tanlang" value={cat} onChange={(e) => setCat(e.target.value)} />
        <Input label="Xizmat muddati, oy" type="number" min={1} max={600} value={life} onChange={(e) => setLife(e.target.value)} hint="Bo'sh — siyosatdagi muddat (moddaga qarab)" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Qayerda" options={(regions.data ?? []).map((r) => ({ value: String(r.code), label: r.code === 0 ? 'Markaz' : r.name }))} value={region} onChange={(e) => setRegion(e.target.value)} />
          {region === '0' && <Select label="Bo'lim" placeholder="—" options={(depts.data ?? []).map((d) => ({ value: d.id, label: d.name }))} value={dept} onChange={(e) => setDept(e.target.value)} />}
        </div>
        <Input label="Inventar raqami" value={inv} onChange={(e) => setInv(e.target.value)} />
        <Input label="Izoh" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Drawer>
  );
}

/** Siyosat: qaysi moddalar asosiy vosita, xizmat muddatlari */
function PolicyCard({ isAdmin, onSaved }: { isAdmin: boolean; onSaved: (msg: string) => void }) {
  const res = useAsync(() => assetsApi.policy().then((r) => r.data), []);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [life, setLife] = useState<Record<string, string>>({});
  const [def, setDef] = useState('60');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!res.data) return;
    setSel(new Set(res.data.capitalCategories));
    setLife(Object.fromEntries(Object.entries(res.data.life).map(([k, v]) => [k, String(v)])));
    setDef(String(res.data.defaultLife));
  }, [res.data]);
  const p: AssetPolicyView | null = res.data;
  const children = useMemo(() => {
    const m = new Map<string | null, AssetPolicyView['categories']>();
    const known = new Set((p?.categories ?? []).map((c) => c.code));
    for (const c of p?.categories ?? []) {
      const k = c.parentCode && known.has(c.parentCode) ? c.parentCode : null;
      const list = m.get(k) ?? [];
      list.push(c);
      m.set(k, list);
    }
    return m;
  }, [p]);
  const parentOf = useMemo(() => new Map((p?.categories ?? []).map((c) => [c.code, c.parentCode])), [p]);
  const inherited = (code: string) => {
    let x = parentOf.get(code) ?? null;
    for (let i = 0; x && i < 20; i += 1) {
      if (sel.has(x)) return true;
      x = parentOf.get(x) ?? null;
    }
    return false;
  };
  const q = query.trim().toLowerCase();
  const rows = (parent: string | null, depth: number): ReactNode[] =>
    (children.get(parent) ?? []).flatMap((c) => {
      const kids = rows(c.code, depth + 1);
      const show = !q || c.label.toLowerCase().includes(q) || kids.length > 0;
      if (!show) return [];
      const on = sel.has(c.code) || inherited(c.code);
      return [
        <div key={c.code} className={cn('flex items-center gap-3 px-5 py-1.5 text-sm', on && 'bg-amber-50/40')} style={{ paddingLeft: 20 + depth * 22 }}>
          <input
            type="checkbox"
            className="size-4 accent-brand-600"
            checked={on}
            disabled={!isAdmin || inherited(c.code)}
            onChange={() => {
              const next = new Set(sel);
              if (next.has(c.code)) next.delete(c.code);
              else next.add(c.code);
              setSel(next);
            }}
          />
          <span className={cn('flex-1', !c.isLeaf && 'font-semibold')}>{c.label}</span>
          <input
            className="w-20 rounded-md border border-(--color-line) px-2 py-1 text-right text-xs tabular-nums disabled:bg-transparent"
            placeholder={String(c.lifeMonths)}
            value={life[c.code] ?? ''}
            disabled={!isAdmin}
            onChange={(e) => setLife({ ...life, [c.code]: e.target.value.replace(/\D/g, '') })}
            title="Xizmat muddati, oy (bo'sh — ota modda yoki umumiy muddat)"
          />
          <span className="w-8 text-[11px] text-(--color-text-faint)">oy</span>
        </div>,
        ...kids,
      ];
    });
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const lifeNum = Object.fromEntries(Object.entries(life).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]));
      const r = await assetsApi.savePolicy({ capitalCategories: [...sel], life: lifeNum, defaultLife: Number(def) });
      onSaved(r.data.report.captured ? `Saqlandi — ${r.data.report.captured} ta xarid balansga olindi` : 'Siyosat saqlandi — sarf qayta hisoblandi');
      res.reload();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-(--color-line) px-5 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-heading">Qaysi xarajatlar asosiy vosita</p>
          <p className="text-xs text-(--color-text-muted)">
            Ombor › Kirimda «asosiy vosita» deb kiritilganlar — har doim. Bu yerda belgilangan moddadagi xarajatlar ham (qayerda kiritilsa ham) balansga olinadi. O&apos;ngda — xizmat
            muddati (oy).
          </p>
        </div>
        <div className="w-44">
          <Input placeholder="Modda qidirish…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      {err && <p className="border-b border-(--color-line) bg-red-50 px-5 py-2 text-sm text-red-700">{err}</p>}
      {!p ? <p className="px-5 py-6 text-center text-sm text-(--color-text-muted)">{res.error ?? 'Yuklanmoqda…'}</p> : <div className="max-h-[460px] divide-y divide-(--color-line) overflow-y-auto">{rows(null, 0)}</div>}
      <div className="flex flex-wrap items-center gap-3 border-t border-(--color-line) bg-(--color-surface-muted) px-5 py-3">
        <label className="flex items-center gap-2 text-xs text-(--color-text-muted)">
          Umumiy xizmat muddati
          <input className="w-16 rounded-md border border-(--color-line) px-2 py-1 text-right text-xs tabular-nums" value={def} disabled={!isAdmin} onChange={(e) => setDef(e.target.value.replace(/\D/g, ''))} />
          oy
        </label>
        <span className="text-xs text-(--color-text-muted)">{sel.size} ta modda belgilangan</span>
        {isAdmin && (
          <Button className="ml-auto" onClick={() => void save()} loading={busy}>
            Saqlash
          </Button>
        )}
      </div>
    </Card>
  );
}

export function FixedAssetsPage() {
  const { isAdmin } = useAuth();
  const { month } = usePeriod();
  const [scope, setScope] = useState<'month' | 'ytd'>('ytd');
  const from = scope === 'month' ? `${month}-01` : `${month.slice(0, 4)}-01-01`;
  const to = monthEndIso(month);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'list' | 'report' | 'policy'>('list');
  const [batch, setBatch] = useState('');
  const [importing, setImporting] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const summary = useAsync(() => assetsApi.summary(from, to).then((r) => r.data), [from, to]);
  const list = useAsync(() => assetsApi.list({ status, batch: batch || undefined }).then((r) => r.data), [status, batch]);
  const batches = useAsync(() => assetsApi.batches().then((r) => r.data), []);
  const cats = useAsync(() => referencesApi.expenseLeaves().then((r) => r.data), []);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'error' } | null>(null);
  const reloadAll = (msg: string) => {
    setToast({ message: msg });
    summary.reload();
    list.reload();
    batches.reload();
  };
  /** Tanlanganlar yoki butun partiya rejimi */
  const bulkMode = async (mode: AssetMode, scope: 'checked' | 'batch') => {
    setBusy(true);
    try {
      const r = await assetsApi.modeMany(scope === 'batch' ? { batch, mode } : { ids: [...checked], mode });
      setChecked(new Set());
      reloadAll(
        `${r.data.changed} ta vosita: ${MODE_INFO[mode].label}${r.data.skipped.length ? ` · ${r.data.skipped.length} tasi o'zgarmadi (${r.data.skipped[0]!.reason})` : ''}`,
      );
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const syncNow = async () => {
    setBusy(true);
    try {
      const r = await assetsApi.sync();
      reloadAll(r.data.captured ? `${r.data.captured} ta yangi xarid balansga olindi` : 'Hisob yangilandi — yangi xarid yo\'q');
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const s = summary.data;
  const q = search.trim().toLowerCase();
  const rows = (list.data ?? []).filter((a) => !q || `${a.name} ${a.inventoryNo ?? ''} ${a.categoryLabel} ${a.place}`.toLowerCase().includes(q));
  const allChecked = rows.length > 0 && rows.every((a) => checked.has(a.id));
  const totals = rows.reduce((t, a) => ({ cost: t.cost + Number(a.costTiyin), acc: t.acc + Number(a.accumulatedTiyin), res: t.res + Number(a.residualTiyin), mon: t.mon + (a.status === 'active' ? Number(a.monthlyTiyin) : 0) }), { cost: 0, acc: 0, res: 0, mon: 0 });

  return (
    <>
      <PageHeader title="Asosiy vositalar" description="Balansda turadi: xarajatsiz yoki har oy eskirish bilan; kerak bo'lsa xarajatga o'tkaziladi (Markaz)" />
      <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
        {/* Amallar — hamma Manba sahifasida bir xil joyda */}
        <SourceActions
          add={{ label: 'Yangi asosiy vosita', onClick: () => setCreating(true) }}
          upload={{ label: "Excel'dan yuklash", onClick: () => setImporting(true) }}
          extra={
            isAdmin ? (
              <Button variant="secondary" size="sm" onClick={() => void syncNow()} loading={busy} title="Hamma vositalarning oylik sarfi (eskirish) qayta hisoblanadi">
                Sarfni hozir hisoblash
              </Button>
            ) : undefined
          }
          deleteData={{ target: 'ASSET', month, place: 'Xarajatlar › Asosiy vositalar', onDone: ({ count }) => reloadAll(`${count} ta asosiy vosita o'chirildi — sarf qayta hisoblandi`) }}
        />

        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-bold text-heading">Balans va sarf</h2>
          <span className="text-xs text-(--color-text-muted)">
            {formatDate(from)} — {formatDate(to)}
          </span>
          <div className="ml-auto flex gap-1 rounded-lg bg-white p-1 shadow-card">
            {(
              [
                ['month', 'Tanlangan oy'],
                ['ytd', 'Yil boshidan'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setScope(k)} className={cn('rounded-md px-3 py-1.5 text-xs font-semibold', scope === k ? 'bg-brand-600 text-white' : 'text-heading hover:bg-brand-50')}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {!s ? (
          <Card className="p-6 text-center text-sm text-(--color-text-muted)">{summary.error ? `Yuklab bo'lmadi: ${summary.error}` : 'Yuklanmoqda…'}</Card>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label="Davr sarfi (xarajatga)" value={compact(s.chargeTiyin)} color={AV_COLOR} sub="Markaz xarajatining 2-guruhi" />
              <Kpi
                label="Qoldiq qiymat (balans)"
                value={compact(s.residualTiyin)}
                sub={`${s.count} ta vosita · boshlang'ich ${compact(s.costTiyin)}${s.holdCount ? ` · xarajatsiz ${s.holdCount} ta (${compact(s.holdTiyin)})` : ''}${s.expensedCount ? ` · xarajatga o'tkazilgan ${s.expensedCount} ta (${compact(s.expensedTiyin)})` : ''}`}
              />
              <Kpi label="Davrda xarid (balansga)" value={compact(s.acquiredTiyin)} sub={`${s.acquiredCount} ta — xarajatga birdaniga yozilmadi`} />
              <Kpi
                label="Eskirish darajasi"
                value={pct(Number(s.costTiyin) > 0 ? (Number(s.accumulatedTiyin) / Number(s.costTiyin)) * 100 : null)}
                sub={`yig'ilgan sarf ${compact(s.accumulatedTiyin)}${Number(s.disposedTiyin) ? ` · chiqarilgan ${compact(s.disposedTiyin)}` : ''}`}
              />
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="overflow-hidden lg:col-span-2">
                <p className="border-b border-(--color-line) px-5 py-3 text-sm font-semibold text-heading">Oylik sarf</p>
                <ChargeBars months={s.months} values={s.chargeTrend} />
              </Card>
              <Card className="overflow-hidden">
                <p className="border-b border-(--color-line) px-5 py-3 text-sm font-semibold text-heading">Moddalar bo&apos;yicha</p>
                {s.byCategory.length ? (
                  <ul className="divide-y divide-(--color-line)">
                    {s.byCategory.slice(0, 8).map((c) => (
                      <li key={c.code} className="flex items-center justify-between gap-3 px-5 py-2 text-sm">
                        <span className="truncate text-heading">
                          {c.label} <span className="text-xs text-(--color-text-muted)">· {c.count} ta</span>
                        </span>
                        <span className="whitespace-nowrap text-right tabular-nums">
                          <b>{compact(c.residualTiyin)}</b>
                          <span className="block text-[11px] text-(--color-text-muted)">sarf {compact(c.chargeTiyin)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-5 py-6 text-center text-sm text-(--color-text-muted)">Hali asosiy vosita yo&apos;q</p>
                )}
              </Card>
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['list', "Ro'yxat"],
              ['report', 'Balans hisoboti'],
              ['policy', 'Moddalar va muddatlar'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={cn('rounded-lg px-3.5 py-2 text-sm font-semibold', tab === k ? 'bg-brand-600 text-white' : 'bg-white text-heading shadow-card hover:bg-brand-50')}>
              {label}
            </button>
          ))}
          <Link href="/xarajatlar/siyosat" className="ml-auto text-xs font-semibold text-brand-700 underline">
            Xarajatlar siyosati (Markaz xarajati guruhlari)
          </Link>
        </div>

        {tab === 'policy' ? (
          <PolicyCard isAdmin={isAdmin} onSaved={reloadAll} />
        ) : tab === 'report' ? (
          <BalanceReportView batches={batches.data ?? []} />
        ) : (
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-(--color-line) px-5 py-3">
              {STATUS_FILTERS.map((f) => (
                <button key={f.value} type="button" onClick={() => setStatus(f.value)} className={cn('rounded-full px-3 py-1 text-xs font-semibold', status === f.value ? 'bg-heading text-white' : 'bg-(--color-surface-sunken) text-heading hover:bg-brand-50')}>
                  {f.label}
                </button>
              ))}
              {(batches.data?.length ?? 0) > 0 && (
                <select
                  value={batch}
                  onChange={(e) => {
                    setBatch(e.target.value);
                    setChecked(new Set());
                  }}
                  className="ml-auto h-9 max-w-[16rem] rounded-lg border border-(--color-line) bg-white px-2 text-sm"
                  title="Excel'dan yuklangan partiya"
                >
                  <option value="">Barcha partiyalar</option>
                  {batches.data!.map((b) => (
                    <option key={b.batch} value={b.batch}>
                      {b.batch} ({b.count})
                    </option>
                  ))}
                </select>
              )}
              <div className={cn('w-56', !(batches.data?.length ?? 0) && 'ml-auto')}>
                <Input placeholder="Nomi, inventar, joyi, xodim…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
            {isAdmin && (checked.size > 0 || batch) && (
              <div className="flex flex-wrap items-center gap-2 border-b border-(--color-line) bg-brand-50/60 px-5 py-2 text-sm">
                <span className="font-semibold text-heading">{checked.size > 0 ? `${checked.size} ta tanlandi` : `Partiya: ${batch}`}</span>
                <span className="text-xs text-(--color-text-muted)">rejimini o&apos;zgartirish:</span>
                {MODE_ORDER.map((m) => (
                  <Button key={m} variant="secondary" size="sm" loading={busy} onClick={() => void bulkMode(m, checked.size > 0 ? 'checked' : 'batch')} title={MODE_INFO[m].hint}>
                    {MODE_INFO[m].label}
                  </Button>
                ))}
                {checked.size > 0 && (
                  <button type="button" onClick={() => setChecked(new Set())} className="text-xs text-(--color-text-muted) hover:underline">
                    bekor qilish
                  </button>
                )}
                {checked.size === 0 && batch && (
                  <Button size="sm" className="ml-auto" onClick={() => setAdopting(true)} title="Ombor ro'yxatiga, xodim nomida — qaytarish va o'tkazish dalolatnoma bilan">
                    Omborga ulash
                  </Button>
                )}
              </div>
            )}
            {!list.data ? (
              <p className="px-5 py-8 text-center text-sm text-(--color-text-muted)">{list.error ? `Yuklab bo'lmadi: ${list.error}` : 'Yuklanmoqda…'}</p>
            ) : rows.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-(--color-text-muted)">
                <p>Asosiy vosita topilmadi.</p>
                <p className="mt-1 text-xs">
                  Ombor › Kirimda «asosiy vosita» turidagi buyum kiriting yoki «Moddalar va muddatlar»da asosiy vosita moddasini belgilang (masalan «Asosiy vositalar xaridi»).
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-sm">
                  <thead className="border-b border-(--color-line) bg-(--color-surface-muted) text-left text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">
                    <tr>
                      {isAdmin && (
                        <th className="w-10 px-4 py-2">
                          <input type="checkbox" aria-label="Hammasini tanlash" className="size-4 accent-brand-600" checked={allChecked} onChange={(e) => setChecked(e.target.checked ? new Set(rows.map((a) => a.id)) : new Set())} />
                        </th>
                      )}
                      <th className="min-w-[260px] px-4 py-2">Vosita</th>
                      <th className="px-4 py-2">Joyi</th>
                      <th className="px-4 py-2">Xarid</th>
                      <th className="px-4 py-2 text-right">Qiymat</th>
                      <th className="px-4 py-2 text-right">Muddat</th>
                      <th className="px-4 py-2 text-right">Oylik sarf</th>
                      <th className="px-4 py-2 text-right">Yig&apos;ilgan</th>
                      <th className="px-4 py-2 text-right">Qoldiq</th>
                      <th className="px-4 py-2 text-right">Holat</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-(--color-line)">
                    {rows.map((a: FixedAssetView) => {
                      const done = Number(a.costTiyin) > 0 ? Number(a.accumulatedTiyin) / Number(a.costTiyin) : 0;
                      return (
                        <tr key={a.id} className={cn('cursor-pointer hover:bg-brand-50/50', checked.has(a.id) && 'bg-brand-50/70')} onClick={() => setOpenId(a.id)}>
                          {isAdmin && (
                            <td className="w-10 px-4 py-2" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                aria-label={`Tanlash: ${a.name}`}
                                className="size-4 accent-brand-600"
                                checked={checked.has(a.id)}
                                onChange={() =>
                                  setChecked((prev) => {
                                    const n = new Set(prev);
                                    if (n.has(a.id)) n.delete(a.id);
                                    else n.add(a.id);
                                    return n;
                                  })
                                }
                              />
                            </td>
                          )}
                          <td className="px-4 py-2">
                            <span className="font-medium text-heading">{a.name}</span>
                            <span className="block text-[11px] text-(--color-text-muted)">
                              {a.inventoryNo ? `${a.inventoryNo} · ` : ''}
                              {a.quantity > 1 ? `${a.quantity} dona · ` : ''}
                              {a.categoryLabel} · {a.sourceLabel}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-(--color-text-muted)">
                            {a.place}
                            {a.holderName && <span className="block text-[11px] text-heading">{a.holderName}</span>}
                            {a.placeText && a.placeText !== a.place && <span className="block max-w-[16rem] truncate text-[11px] text-(--color-text-faint)" title={a.placeText}>{a.placeText}</span>}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2 tabular-nums">{formatDate(a.acquiredAt)}</td>
                          <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{compact(a.costTiyin)}</td>
                          <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{a.mode === 'BALANCE' ? lifeText(a.lifeMonths) : '—'}</td>
                          <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{a.status === 'active' ? compact(a.monthlyTiyin) : '—'}</td>
                          <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                            {compact(a.accumulatedTiyin)}
                            <div className="ml-auto mt-1 h-1 w-20 rounded-full bg-(--color-surface-sunken)">
                              <div className="h-1 rounded-full" style={{ width: `${Math.min(100, done * 100)}%`, background: AV_COLOR }} />
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-2 text-right font-semibold tabular-nums">{compact(a.residualTiyin)}</td>
                          <td className="px-4 py-2 text-right">
                            <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold', STATUS[a.status].cls)}>{STATUS[a.status].label}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t-2 border-(--color-line) bg-(--color-surface-muted) font-semibold">
                    <tr>
                      <td className="px-4 py-2 text-heading" colSpan={isAdmin ? 4 : 3}>
                        Jami · {rows.length} ta
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{compact(totals.cost)}</td>
                      <td />
                      <td className="px-4 py-2 text-right tabular-nums">{compact(totals.mon)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{compact(totals.acc)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{compact(totals.res)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>
      {importing && (
        <AssetImportDialog
          onClose={() => setImporting(false)}
          onImported={(m) => {
            setImporting(false);
            setStatus('all');
            reloadAll(m);
          }}
        />
      )}
      {adopting && batch && (
        <AdoptDialog
          batch={batch}
          onClose={() => setAdopting(false)}
          onDone={(msg) => {
            setAdopting(false);
            reloadAll(msg);
          }}
        />
      )}
      <AssetDrawer id={openId} onClose={() => setOpenId(null)} onChanged={reloadAll} isAdmin={isAdmin} />
      <CreateDrawer
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(m) => {
          setCreating(false);
          reloadAll(m);
        }}
        categories={(cats.data ?? []).filter((c) => c.code !== 'AV_SARF').map((c) => ({ value: c.code, label: c.label }))}
      />
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} duration={toast.tone === 'error' ? 6000 : 4000} />}
    </>
  );
}