'use client';

import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';
import { download, exportUrl, hpApi, monthName, short, som, type PlanStatus, type RunMeta } from './api';
import { Banner, PlanPill } from './ui';

// Tasdiqlash oynasi va Excel eksport menyusi — Prognozlash, Hududlar, Xodimlar sahifalarida bir xil.

export interface ApproveRegion {
  code: number;
  name: string;
  forecastRev: number;
  unallocated: number | null;
  plan: PlanStatus;
}

export function ApproveDrawer({ open, run, regions, preselect, onClose, onDone }: { open: boolean; run: RunMeta | null; regions: ApproveRegion[]; preselect?: number[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setSel(new Set(preselect ?? regions.filter((r) => r.plan.status !== 'APPROVED').map((r) => r.code)));
      setNote('');
      setError(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!run || sel.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await hpApi.approve(run.id, [...sel], note.trim());
      onDone(`Tasdiqlandi: ${r.data.approved.map((a) => `${regions.find((x) => x.code === a.region)?.name ?? a.region} (v${a.version})`).join(', ')}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Tasdiqlab bo‘lmadi');
    } finally {
      setBusy(false);
    }
  };
  const total = regions.filter((r) => sel.has(r.code)).reduce((a, r) => a + r.forecastRev, 0);
  const allOn = regions.length > 0 && regions.every((r) => sel.has(r.code));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Rejani tasdiqlash"
      description={run ? `${monthName(run.targetPeriod)} · holat «Hisoblangan» → «Tasdiqlangan»` : undefined}
      width="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-(--color-text-muted)">
            {sel.size} hudud · <b className="money text-heading">{som(total)} so‘m</b>
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Bekor
            </Button>
            <Button loading={busy} disabled={sel.size === 0} onClick={submit}>
              Tasdiqlash
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <Banner tone="info">
          Har bir hudud uchun yangi versiya yaratiladi; oldingi tasdiqlangan versiya «Almashtirilgan» bo‘ladi va tarixda saqlanadi (keyin tiklash mumkin). Qayta hisoblash tasdiqlangan rejani o‘chirmaydi.
        </Banner>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(regions.map((r) => r.code)))} />
          Barcha hududlar
        </label>
        <div className="divide-y divide-(--color-border) rounded-lg border border-(--color-border)">
          {regions.map((r) => (
            <label key={r.code} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
              <input
                type="checkbox"
                checked={sel.has(r.code)}
                onChange={() =>
                  setSel((s) => {
                    const n = new Set(s);
                    if (n.has(r.code)) n.delete(r.code);
                    else n.add(r.code);
                    return n;
                  })
                }
              />
              <span className="min-w-0 flex-1 truncate font-medium text-heading">{r.name}</span>
              {r.unallocated ? <span className="text-xs text-amber-700">taqsimlanmagan {short(r.unallocated)}</span> : null}
              <span className="money w-24 text-right font-semibold">{short(r.forecastRev)}</span>
              <PlanPill plan={r.plan} />
            </label>
          ))}
        </div>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-heading">Izoh (ixtiyoriy)</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} className="w-full rounded-lg border border-(--color-border) px-3 py-2 text-sm" placeholder="Masalan: rahbariyat bilan kelishildi" />
        </label>
        {error && <Banner tone="bad">{error}</Banner>}
      </div>
    </Drawer>
  );
}

const EXPORTS: { kind: 'full' | 'regions' | 'services' | 'employees'; label: string; hint: string }[] = [
  { kind: 'full', label: 'To‘liq hisobot', hint: 'Barcha varaqlar: umumiy, hududlar, xizmatlar, xodimlar, aniqlik, sifat, parametrlar' },
  { kind: 'regions', label: 'Hududlar bo‘yicha prognoz', hint: 'A — har hudud: prognoz, oxirgi oy, o‘zgarish, model, aniqlik' },
  { kind: 'services', label: 'Xizmatlar bo‘yicha prognoz', hint: 'B — hudud × xizmat: soni, tarif, daromad, model, ishonchlilik' },
  { kind: 'employees', label: 'Xodimlar bo‘yicha reja', hint: 'C — xodim × xizmat: ulush, reja, ish kunlari' },
];

export function ExportMenu({ run, size = 'sm' }: { run: RunMeta | null; size?: 'sm' | 'md' }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  if (!run) return null;
  const go = async (kind: (typeof EXPORTS)[number]['kind']) => {
    setBusy(kind);
    setError(null);
    try {
      await download(exportUrl(run.id, kind), `hudud-reja-${run.targetPeriod}-${kind}.xlsx`);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eksport xatosi');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div ref={ref} className="relative">
      <Button variant="secondary" size={size} onClick={() => setOpen((o) => !o)}>
        Excel ▾
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-80 rounded-xl border border-(--color-border) bg-white p-1 shadow-xl">
          {EXPORTS.map((x) => (
            <button key={x.kind} type="button" disabled={busy !== null} onClick={() => go(x.kind)} className={cn('block w-full rounded-lg px-3 py-2 text-left hover:bg-brand-50 disabled:opacity-60')}>
              <span className="block text-sm font-semibold text-heading">
                {x.label}
                {busy === x.kind ? ' …' : ''}
              </span>
              <span className="block text-xs text-(--color-text-muted)">{x.hint}</span>
            </button>
          ))}
          {error && <p className="px-3 py-2 text-xs text-(--color-expense)">{error}</p>}
        </div>
      )}
    </div>
  );
}