'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { alertsApi, notifyAlertsChanged, RULES, type AlertRule, type AlertSettings } from '@/features/alerts/api';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════
// Sozlamalar › Ogohlantirishlar: «Muhokama talab qiladi» chegaralari.
// Har bir holatni yoqish/o'chirish va chegara (foiz, summa, kun) — administrator o'zgartiradi.
// ═══════════════════════════════════════════════════════════

const FIELD = 'h-9 w-32 rounded-(--radius-control) border border-(--color-line) bg-white px-2.5 text-right text-sm tabular-nums outline-none focus:border-brand-400 disabled:bg-(--color-surface-muted)';

type NumKey = Exclude<keyof AlertSettings, 'enabled' | 'byCounterparty' | 'byDistrict'>;

/** Har bir holat va unga tegishli chegaralar */
const GROUPS: { rule: AlertRule; fields: { key: NumKey; label: string; unit: string; step?: number }[] }[] = [
  {
    rule: 'expenseGrowth',
    fields: [
      { key: 'expenseGrowthPct', label: "O'sish kamida", unit: '%' },
      { key: 'expenseGrowthMinSom', label: 'va kamida', unit: "so'm", step: 1_000_000 },
    ],
  },
  {
    rule: 'incomeDrop',
    fields: [
      { key: 'incomeDropPct', label: 'Kamayish kamida', unit: '%' },
      { key: 'incomeDropMinSom', label: 'va kamida', unit: "so'm", step: 1_000_000 },
    ],
  },
  { rule: 'loss', fields: [{ key: 'lossMinSom', label: 'Zarar kamida', unit: "so'm", step: 1_000_000 }] },
  { rule: 'plan', fields: [{ key: 'planMinPct', label: 'Bajarilish shundan past', unit: '%' }] },
  {
    rule: 'outlier',
    fields: [
      { key: 'outlierFactor', label: 'Odatiy yozuvdan katta', unit: 'barobar', step: 0.5 },
      { key: 'outlierMinSom', label: 'va kamida', unit: "so'm", step: 1_000_000 },
    ],
  },
  {
    rule: 'debt',
    fields: [
      { key: 'debtDays', label: "To'lanmagan", unit: 'kundan ortiq' },
      { key: 'debtMinSom', label: 'va kamida', unit: "so'm", step: 1_000_000 },
    ],
  },
  { rule: 'control', fields: [] },
];

function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60', checked ? 'bg-brand-600' : 'bg-(--color-line-strong)')}
    >
      <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
    </button>
  );
}

function Row({ title, hint, right, children }: { title: string; hint?: string; right?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
      <div className="min-w-0 max-w-md">
        <p className="text-sm font-semibold text-heading">{title}</p>
        {hint && <p className="mt-0.5 text-xs text-(--color-text-muted)">{hint}</p>}
        {children}
      </div>
      {right}
    </div>
  );
}

export default function AlertSettingsPage() {
  const { isAdmin } = useAuth();
  const [saved, setSaved] = useState<AlertSettings | null>(null);
  const [form, setForm] = useState<AlertSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    alertsApi
      .settings()
      .then((r) => {
        setSaved(r.data);
        setForm(r.data);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Sozlamalar yuklanmadi'));
  }, []);

  if (error && !form) {
    return (
      <div className="p-4 md:p-6">
        <Card>
          <ErrorState message={error} onRetry={() => window.location.reload()} />
        </Card>
      </div>
    );
  }
  if (!form || !saved) return <LoadingState />;

  const changed = JSON.stringify(form) !== JSON.stringify(saved);
  const setNum = (key: NumKey, value: string) => {
    setDone(false);
    setForm({ ...form, [key]: value === '' ? 0 : Number(value) });
  };
  const setRule = (rule: AlertRule, on: boolean) => {
    setDone(false);
    setForm({ ...form, enabled: { ...form.enabled, [rule]: on } });
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await alertsApi.saveSettings(form);
      setSaved(r.data);
      setForm(r.data);
      setDone(true);
      notifyAlertsChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Saqlanmadi');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Sozlamalar"
        description="Ogohlantirishlar — «Muhokama talab qiladi» chegaralari"
        actions={
          isAdmin ? (
            <Button size="sm" onClick={save} loading={busy} disabled={!changed}>
              Saqlash
            </Button>
          ) : null
        }
      />

      <div className="space-y-4 p-4 md:p-6">
        {!isAdmin && (
          <p className="rounded-(--radius-control) bg-(--color-warn-soft) px-4 py-2.5 text-sm text-(--color-warn)">Chegaralarni faqat administrator o&apos;zgartira oladi.</p>
        )}
        {error && <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-4 py-2.5 text-sm text-(--color-expense)">{error}</p>}
        {done && (
          <p className="rounded-(--radius-control) bg-(--color-income-soft) px-4 py-2.5 text-sm text-(--color-income)">
            Saqlandi. Ro&apos;yxat yangi chegaralar bo&apos;yicha qayta hisoblandi —{' '}
            <Link href="/munosabat/ogohlantirish" className="font-semibold underline">
              ko&apos;rish
            </Link>
            .
          </p>
        )}

        {/* Umumiy */}
        <Card className="divide-y divide-(--color-line)">
          <div className="px-5 py-3.5">
            <h3 className="text-[15px] font-bold text-heading">Umumiy</h3>
            <p className="text-xs text-(--color-text-muted)">Tekshiriladigan oy — oxirgi to&apos;liq oy; u oldingi oylar o&apos;rtachasi bilan solishtiriladi.</p>
          </div>
          <Row
            title="Solishtirish asosi"
            hint="Oxirgi oy oldingi necha oyning o'rtachasi bilan solishtirilsin (1 — faqat o'tgan oy bilan)"
            right={
              <span className="inline-flex items-center gap-2 text-sm">
                <input type="number" min={1} max={12} value={form.baseMonths} disabled={!isAdmin} onChange={(e) => setNum('baseMonths', e.target.value)} className={FIELD} />
                oy
              </span>
            }
          />
          <Row
            title="Kontragent va mijozlar bo'yicha"
            hint="Xarajat o'sishi va daromad kamayishini har bir kontragent va mijoz bo'yicha ham tekshirish"
            right={<Toggle checked={form.byCounterparty} disabled={!isAdmin} label="Kontragentlar" onChange={(v) => setForm({ ...form, byCounterparty: v })} />}
          />
          <Row
            title="Tumanlar bo'yicha"
            hint="Har bir viloyat tumanlari: xarajat o'sishi, daromad kamayishi, zarar (Solishtirma › tumanlar hisobi)"
            right={<Toggle checked={form.byDistrict} disabled={!isAdmin} label="Tumanlar" onChange={(v) => setForm({ ...form, byDistrict: v })} />}
          />
        </Card>

        {/* Holatlar */}
        <Card className="divide-y divide-(--color-line)">
          <div className="px-5 py-3.5">
            <h3 className="text-[15px] font-bold text-heading">Holatlar va chegaralar</h3>
            <p className="text-xs text-(--color-text-muted)">Ikkala shart (foiz VA summa) bajarilgandagina ogohlantiriladi — mayda o&apos;zgarishlar ro&apos;yxatni to&apos;ldirmaydi.</p>
          </div>
          {GROUPS.map((g) => {
            const meta = RULES.find((r) => r.rule === g.rule)!;
            const on = form.enabled[g.rule];
            return (
              <Row key={g.rule} title={meta.label} hint={meta.hint} right={<Toggle checked={on} disabled={!isAdmin} label={meta.label} onChange={(v) => setRule(g.rule, v)} />}>
                {g.fields.length > 0 && (
                  <div className={cn('mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm', !on && 'opacity-50')}>
                    {g.fields.map((f) => (
                      <label key={f.key} className="inline-flex items-center gap-2">
                        <span className="text-(--color-text-muted)">{f.label}</span>
                        <input
                          type="number"
                          step={f.step ?? 1}
                          min={0}
                          value={form[f.key]}
                          disabled={!isAdmin || !on}
                          onChange={(e) => setNum(f.key, e.target.value)}
                          className={FIELD}
                        />
                        <span className="text-(--color-text-muted)">{f.unit}</span>
                      </label>
                    ))}
                  </div>
                )}
              </Row>
            );
          })}
        </Card>
      </div>
    </>
  );
}