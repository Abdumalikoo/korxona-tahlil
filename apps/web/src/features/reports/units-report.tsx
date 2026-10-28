'use client';

import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { MonthRangeCard, useMonthRange } from '@/features/units/month-range';
import { errorMessage } from '@/lib/error-message';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { generateUnitReport, unitsReportApi, type ReportDoc, type UnitKind, type UnitReportPayload } from './api';
import { ReportView } from './report-view';

// ═══════════════════════════════════════════════════════════
// Hisobotlar › Bo'limlar bo'yicha: Markaz bo'limi, Hudud (va tuman) yoki Yo'nalish + davr → ekranda ko'rish,
// Excel yoki PDF. Faqat raqamlar va jadvallar: oyma-oy (o'sish sur'ati, o'zini qoplash), daromad qayerdan,
// xarajat nimaga, ish haqi, Qo'mita qoplashi, o'zgarishlar (ko'chishlar).
// ═══════════════════════════════════════════════════════════

const KINDS: { value: UnitKind; label: string }[] = [
  { value: 'DEPT', label: "Markaz bo'limi" },
  { value: 'REGION', label: 'Hudud' },
  { value: 'SEGMENT', label: "Yo'nalish" },
];
const SELECT = 'mt-1 block h-9 w-full rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-sm text-heading focus:border-brand-600 focus:outline-none';

export function UnitsReportPanel() {
  const opts = useAsync(() => unitsReportApi.options().then((r) => r.data), []);
  const range = useMonthRange('year');
  const [kind, setKind] = useState<UnitKind>('DEPT');
  const [id, setId] = useState('');
  const [district, setDistrict] = useState('');
  const [doc, setDoc] = useState<ReportDoc | null>(null);
  const [busy, setBusy] = useState<'view' | 'xlsx' | 'pdf' | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  if (opts.error) return <ErrorState message={opts.error} onRetry={opts.reload} />;
  if (!opts.data) return <LoadingState label="Ro'yxatlar yuklanmoqda" />;
  const o = opts.data;
  const list = kind === 'DEPT' ? o.departments.map((d) => ({ value: d.id, label: d.name })) : kind === 'REGION' ? o.regions.map((r) => ({ value: String(r.code), label: r.name })) : o.segments.map((s) => ({ value: s.code, label: s.name }));
  const chosen = list.some((x) => x.value === id) ? id : (list[0]?.value ?? '');
  const districts = kind === 'REGION' ? (o.regions.find((r) => String(r.code) === chosen)?.districts ?? []) : [];
  const payload: UnitReportPayload | null = chosen && !range.error ? { kind, id: chosen, ...(kind === 'REGION' && district ? { district } : {}), from: range.from, to: range.to } : null;

  async function view() {
    if (!payload) return;
    setBusy('view');
    try {
      setDoc((await unitsReportApi.preview(payload)).data);
    } catch (err) {
      setToast({ message: errorMessage(err, "Hisobotni tuzib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }
  async function download(format: 'xlsx' | 'pdf') {
    if (!payload) return;
    setBusy(format);
    try {
      const name = await generateUnitReport({ ...payload, format });
      setToast({ message: `Yuklab olindi: ${name}`, tone: 'success' });
    } catch (err) {
      setToast({ message: errorMessage(err, "Yuklab bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Bo'lim turi">
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                role="tab"
                aria-selected={kind === k.value}
                onClick={() => {
                  setKind(k.value);
                  setId('');
                  setDistrict('');
                  setDoc(null);
                }}
                className={cn('rounded-full border px-3.5 py-1.5 text-sm font-medium', kind === k.value ? 'border-brand-600 bg-brand-600 text-white' : 'border-(--color-line) bg-white text-heading hover:border-brand-300')}
              >
                {k.label}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs font-medium text-(--color-text-muted)">
              {kind === 'DEPT' ? "Bo'lim" : kind === 'REGION' ? 'Viloyat' : "Yo'nalish"}
              <select
                className={SELECT}
                value={chosen}
                onChange={(e) => {
                  setId(e.target.value);
                  setDistrict('');
                  setDoc(null);
                }}
              >
                {list.map((x) => (
                  <option key={x.value} value={x.value}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
            {kind === 'REGION' && (
              <label className="text-xs font-medium text-(--color-text-muted)">
                Tuman
                <select
                  className={SELECT}
                  value={district}
                  onChange={(e) => {
                    setDistrict(e.target.value);
                    setDoc(null);
                  }}
                >
                  <option value="">Butun viloyat</option>
                  {districts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </CardBody>
      </Card>
      <MonthRangeCard range={range} />
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void view()} loading={busy === 'view'} disabled={!payload || busy !== null}>
          Ekranda ko&apos;rish
        </Button>
        <Button variant="secondary" onClick={() => void download('xlsx')} loading={busy === 'xlsx'} disabled={!payload || busy !== null}>
          Excel
        </Button>
        <Button variant="secondary" onClick={() => void download('pdf')} loading={busy === 'pdf'} disabled={!payload || busy !== null}>
          PDF
        </Button>
        <span className="text-xs text-(--color-text-muted)">
          Faqat raqamlar va jadvallar: oyma-oy o&apos;sish, o&apos;zini qoplash, daromad qayerdan, xarajat nimaga, ish haqi, Qo&apos;mita qoplashi, o&apos;zgarishlar.
        </span>
      </div>
      {doc && <ReportView doc={doc} />}
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </div>
  );
}
