'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { demoApi } from '@/features/regional-econ/api';
import { vehiclesApi } from '@/features/vehicles/api';
import { warehouseApi } from '@/features/warehouse/api';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Sozlamalar › Demo ma'lumotlar: barcha demolar bir joyda — holati, hammasini o'chirish va qayta qo'shish.
// Demolar: Ombor (buyumlar, hujjatlar, pochta), Mashinalar (13 mashina, 3 oy), Hududlar (katta demo — 30 oy, barcha modellar).
// Har bir demo o'z belgisi bilan yoziladi va o'chirilganda haqiqiy yozuvlarga tegilmaydi.
// ═══════════════════════════════════════════════════════════

const tabs = [
  { href: '/sozlamalar/xarajat', label: 'Xarajat' },
  { href: '/sozlamalar/komponentlar', label: 'Ish haqi komponentlari' },
  { href: '/sozlamalar/savat', label: 'Savat' },
  { href: '/sozlamalar/tarix', label: 'Tarix' },
  { href: '/sozlamalar/tekshiruv', label: 'Tekshiruv' },
  { href: '/sozlamalar/zaxira', label: 'Zaxira' },
  { href: '/sozlamalar/demo', label: 'Demo' },
];

type Key = 'warehouse' | 'vehicles' | 'regional';
type StepState = 'wait' | 'run' | 'ok' | 'skip' | 'fail';

interface DemoInfo {
  key: Key;
  title: string;
  what: string;
  exists: boolean;
  summary: string;
}

const ORDER_CREATE: Key[] = ['warehouse', 'vehicles', 'regional'];
const ORDER_REMOVE: Key[] = ['regional', 'vehicles', 'warehouse'];
const TITLES: Record<Key, string> = { warehouse: 'Ombor', vehicles: 'Mashinalar', regional: 'Hududlar (katta demo)' };

async function loadAll(): Promise<DemoInfo[]> {
  const [w, v, r] = await Promise.all([warehouseApi.demoStatus(), vehiclesApi.demoStatus(), demoApi.status()]);
  const wd = w.data;
  const vd = v.data;
  const rd = r.data;
  return [
    {
      key: 'warehouse',
      title: TITLES.warehouse,
      what: "35 ta buyum, oxirgi 3 oyning kirim/chiqim hujjatlari, asosiy vositalar va pochta to'lovlari (kirimlar Xarajatlarga ham yoziladi)",
      exists: wd.items > 0 || wd.docs > 0,
      summary: `${wd.items} buyum, ${wd.docs} hujjat, ${wd.assets} asosiy vosita, ${wd.postal} pochta · ${formatTiyin(wd.expenseTiyin)} so'm`,
    },
    {
      key: 'vehicles',
      title: TITLES.vehicles,
      what: "4 guruhga 13 ta mashina va oxirgi 3 oyning xarajatlari (yoqilg'i, moyka, ta'mir, texnik xizmat)",
      exists: vd.vehicles > 0,
      summary: `${vd.vehicles} mashina, ${vd.records} xarajat · ${formatTiyin(vd.totalTiyin)} so'm`,
    },
    {
      key: 'regional',
      title: TITLES.regional,
      what: "30 oy: hududlar va tumanlar daromadi (xizmatlar, sonlari), xodimlar va vedomostlar, Natijalar fayli, xarajatlar va reja, Markaz bo'limlari, tariflar, voqealar, KPI, prognoz versiyalari — Solishtirma va barcha modellar uchun",
      exists: rd.exists,
      summary: rd.exists ? `${rd.months} oy (${rd.from} – ${rd.to}) · ${rd.incomes.toLocaleString('ru-RU')} daromad, ${rd.expenses.toLocaleString('ru-RU')} xarajat, ${rd.employees} xodim` : '',
    },
  ];
}

const create = (k: Key, force = false) => (k === 'warehouse' ? warehouseApi.createDemo() : k === 'vehicles' ? vehiclesApi.createDemo() : demoApi.create(force));
const remove = (k: Key) => (k === 'warehouse' ? warehouseApi.removeDemo() : k === 'vehicles' ? vehiclesApi.removeDemo() : demoApi.remove());

export default function DemoSettingsPage() {
  const { isAdmin, ready } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (ready && !isAdmin) router.replace('/');
  }, [ready, isAdmin, router]);

  const [tick, setTick] = useState(0);
  const status = useAsync(() => (isAdmin ? loadAll() : Promise.resolve(null)), [isAdmin, tick]);
  const [ask, setAsk] = useState<'removeAll' | 'resetAll' | null>(null);
  const [force, setForce] = useState<{ message: string; resolve: (ok: boolean) => void } | null>(null);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<{ key: string; label: string; state: StepState; note?: string }[]>([]);

  if (!ready || !isAdmin) return <LoadingState />;
  const list = status.data ?? [];
  const anyExists = list.some((d) => d.exists);

  const setStep = (key: string, state: StepState, note?: string) => setSteps((s) => s.map((x) => (x.key === key ? { ...x, state, note } : x)));

  /** Hududlar demosi haqiqiy ma'lumot ustiga qo'shilsa — tasdiq so'raladi */
  const confirmForce = (message: string) => new Promise<boolean>((resolve) => setForce({ message, resolve }));

  const runCreate = async (k: Key, stepKey: string) => {
    try {
      await create(k);
      setStep(stepKey, 'ok');
    } catch (e) {
      const msg = errorMessage(e);
      if (k === 'regional' && /haqiqiy daromad/.test(msg)) {
        const ok = await confirmForce(msg);
        if (!ok) return setStep(stepKey, 'skip', "bekor qilindi (haqiqiy ma'lumot bor)");
        try {
          await create(k, true);
          setStep(stepKey, 'ok', "haqiqiy ma'lumot ustiga qo'shildi, oylar yopilmadi");
        } catch (e2) {
          setStep(stepKey, 'fail', errorMessage(e2));
        }
      } else setStep(stepKey, 'fail', msg);
    }
  };

  const runAll = async (mode: 'removeAll' | 'resetAll') => {
    setAsk(null);
    setRunning(true);
    const existing = new Set(list.filter((d) => d.exists).map((d) => d.key));
    const plan = [
      ...ORDER_REMOVE.filter((k) => existing.has(k)).map((k) => ({ key: `rm-${k}`, label: `${TITLES[k]} — o'chirish`, state: 'wait' as StepState })),
      ...(mode === 'resetAll' ? ORDER_CREATE.map((k) => ({ key: `add-${k}`, label: `${TITLES[k]} — qo'shish`, state: 'wait' as StepState })) : []),
    ];
    setSteps(plan);
    for (const k of ORDER_REMOVE.filter((x) => existing.has(x))) {
      setStep(`rm-${k}`, 'run');
      try {
        await remove(k);
        setStep(`rm-${k}`, 'ok');
      } catch (e) {
        setStep(`rm-${k}`, 'fail', errorMessage(e));
      }
    }
    if (mode === 'resetAll') {
      for (const k of ORDER_CREATE) {
        setStep(`add-${k}`, 'run');
        await runCreate(k, `add-${k}`);
      }
    }
    setRunning(false);
    setTick((t) => t + 1);
  };

  const runOne = async (k: Key, action: 'add' | 'rm') => {
    setRunning(true);
    const key = `${action}-${k}`;
    setSteps([{ key, label: `${TITLES[k]} — ${action === 'add' ? "qo'shish" : "o'chirish"}`, state: 'run' }]);
    if (action === 'add') await runCreate(k, key);
    else
      try {
        await remove(k);
        setStep(key, 'ok');
      } catch (e) {
        setStep(key, 'fail', errorMessage(e));
      }
    setRunning(false);
    setTick((t) => t + 1);
  };

  return (
    <>
      <PageHeader
        title="Sozlamalar"
        description="Demo ma'lumotlar — dasturning to'liq imkoniyatini ko'rish uchun"
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="danger" disabled={running || !anyExists} onClick={() => setAsk('removeAll')}>
              Hamma demolarni o&apos;chirish
            </Button>
            <Button size="sm" disabled={running} onClick={() => setAsk('resetAll')}>
              {anyExists ? "Hammasini o'chirib, qayta qo'shish" : "Hamma demolarni qo'shish"}
            </Button>
          </div>
        }
      />
      <Tabs items={tabs} className="bg-white px-6" />
      <div className="space-y-4 p-6">
        <Card>
          <div className="px-5 py-4 text-sm text-(--color-text-muted)">
            Demo yozuvlari haqiqiy yozuvlar kabi barcha bo&apos;limlarga tushadi (Daromadlar, Xarajatlar, Xodimlar, Ombor, Mashinalar, Hududchi, Solishtirma, Modellar) va
            o&apos;z belgisi bilan ajralib turadi («[DEMO]», «DEMO 01» …). O&apos;chirishda faqat demo yozuvlari butunlay o&apos;chadi — haqiqiy ma&apos;lumotga tegilmaydi.
            Qayta qo&apos;shish — demo ma&apos;lumotni bugungi sanaga yangilaydi (oxirgi oylar bilan).
          </div>
        </Card>

        {status.error ? (
          <Card>
            <ErrorState message={status.error} onRetry={status.reload} />
          </Card>
        ) : !status.data ? (
          <Card>
            <LoadingState />
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {list.map((d) => (
              <Card key={d.key} className={cn('flex flex-col', d.exists && 'border-2 border-dashed border-amber-300')}>
                <div className="flex-1 space-y-2 px-5 py-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-heading">{d.title}</h3>
                    <span className={cn('rounded px-2 py-0.5 text-[11px] font-semibold', d.exists ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600')}>
                      {d.exists ? 'Yoqilgan' : "Yo'q"}
                    </span>
                  </div>
                  <p className="text-xs text-(--color-text-muted)">{d.what}</p>
                  {d.exists && <p className="text-xs font-medium text-amber-900">{d.summary}</p>}
                </div>
                <div className="flex justify-end gap-2 border-t border-(--color-line) px-5 py-3">
                  {d.exists ? (
                    <Button size="sm" variant="secondary" disabled={running} onClick={() => void runOne(d.key, 'rm')}>
                      O&apos;chirish
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" disabled={running} onClick={() => void runOne(d.key, 'add')}>
                      Qo&apos;shish
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}

        {steps.length > 0 && (
          <Card>
            <div className="px-5 py-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">{running ? 'Bajarilmoqda…' : 'Natija'}</h3>
              <ul className="mt-2 space-y-1.5 text-sm">
                {steps.map((s) => (
                  <li key={s.key} className="flex items-start gap-2">
                    <span className={cn('w-5 shrink-0 text-center font-bold', s.state === 'ok' ? 'text-(--color-income)' : s.state === 'fail' ? 'text-(--color-expense)' : s.state === 'run' ? 'text-brand-600' : 'text-(--color-text-faint)')}>
                      {s.state === 'ok' ? '✓' : s.state === 'fail' ? '✗' : s.state === 'run' ? '…' : s.state === 'skip' ? '–' : '·'}
                    </span>
                    <span className={cn(s.state === 'wait' && 'text-(--color-text-muted)')}>
                      {s.label}
                      {s.note && <span className="ml-1 text-xs text-(--color-text-muted)">— {s.note}</span>}
                    </span>
                  </li>
                ))}
              </ul>
              {running && <p className="mt-2 text-xs text-(--color-text-muted)">Hududlar demosi bir necha soniyadan bir daqiqagacha davom etishi mumkin — sahifani yopmang.</p>}
            </div>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={ask !== null}
        danger
        title={ask === 'removeAll' ? "Hamma demolarni o'chirish" : "Demolarni qayta qo'shish"}
        message={
          ask === 'removeAll'
            ? "Ombor, Mashinalar va Hududlar demolarining barcha yozuvlari butunlay o'chiriladi. Haqiqiy yozuvlarga tegilmaydi."
            : "Mavjud demolar o'chiriladi va uchala demo bugungi sana bilan qaytadan qo'shiladi (Ombor, Mashinalar, Hududlar — 30 oylik katta demo). Haqiqiy yozuvlarga tegilmaydi."
        }
        confirmLabel={ask === 'removeAll' ? "O'chirish" : "Qayta qo'shish"}
        cancelLabel="Yo'q"
        onConfirm={() => void runAll(ask!)}
        onCancel={() => setAsk(null)}
      />
      <ConfirmDialog
        open={force !== null}
        danger
        title="Haqiqiy hudud ma'lumoti bor"
        message={`${force?.message ?? ''} Demo oylari yopilmaydi (haqiqiy oylar bloklanmasligi uchun).`}
        confirmLabel="Baribir qo'shish"
        cancelLabel="Hududlar demosini o'tkazib yuborish"
        onConfirm={() => {
          force?.resolve(true);
          setForce(null);
        }}
        onCancel={() => {
          force?.resolve(false);
          setForce(null);
        }}
      />
    </>
  );
}