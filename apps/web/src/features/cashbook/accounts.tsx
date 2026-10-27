'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ErrorState, TableSkeleton } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/error-message';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { cashApi, type CashAccount, type CashAccountInput } from './api';

// ═══════════════════════════════════════════════════════════
// Buxgalteriya › Hisobraqamlar: kunlik ma'lumotnoma qatorlari.
// Nomi, T/r, hisob raqami; yangi qator (bo'lim yoki hisobraqam ichiga); yashirish; tartib.
// Yashirilgan hisobraqam yangi kunlarda ko'rinmaydi, eski kunlardagi qiymatlari saqlanadi.
// ═══════════════════════════════════════════════════════════

const KIND_LABEL = (a: CashAccount): { label: string; tone: 'brand' | 'neutral' | 'warn' | 'income' } => {
  if (a.isHeader) return { label: "Bo'lim", tone: 'brand' };
  if (a.sums.length > 0) return { label: 'Jamlovchi', tone: 'income' };
  if (a.inputs.length === 1 && a.inputs[0] === 'balance') return { label: 'Faqat qoldiq', tone: 'warn' };
  if (!a.inputs.includes('balance')) return { label: 'Tushum qatori', tone: 'neutral' };
  return { label: 'Hisobraqam', tone: 'neutral' };
};

const RULE_LABEL: Record<string, string> = {
  ADD: 'Qoldiq + kunlik tushum',
  SUB: "Qoldiq − kunlik (fuqarolarga to'lanadi)",
  KEEP: "O'zgarmaydi (faqat qoldiq)",
};

interface Form {
  id: string | null;
  name: string;
  code: string;
  number: string;
  parentId: string;
  preset: 'ACCOUNT' | 'SUB' | 'BALANCE';
  rollup: boolean;
  balanceRule: string;
}

const EMPTY: Form = { id: null, name: '', code: '', number: '', parentId: '', preset: 'ACCOUNT', rollup: true, balanceRule: 'ADD' };

export function CashAccounts() {
  const list = useAsync(() => cashApi.accounts(), []);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'error' } | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const all = list.data?.data ?? [];
  const rows = showHidden ? all : all.filter((a) => a.isActive);
  const hiddenCount = all.filter((a) => !a.isActive).length;
  const parents = all.filter((a) => a.isHeader || a.sums.length > 0 || (a.level <= 1 && a.isActive));

  const submit = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const payload: CashAccountInput = { name: form.name, code: form.code || null, number: form.number || null, balanceRule: form.balanceRule };
      if (form.id) {
        await cashApi.updateAccount(form.id, payload);
        setToast({ message: "O'zgartirildi" });
      } else {
        await cashApi.createAccount({ ...payload, parentId: form.parentId || null, preset: form.preset, rollup: form.rollup });
        setToast({ message: "Qo'shildi — kunlik jadvalda ko'rinadi" });
      }
      setForm(null);
      list.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const act = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      setToast({ message });
      list.reload();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    }
  };

  return (
    <>
      <PageHeader
        title="Hisobraqamlar"
        description="Kunlik ma'lumotnoma qatorlari: nomi, raqami, tartibi. O'zgarish keyingi kunlardan kuchga kiradi"
        actions={<Button onClick={() => setForm({ ...EMPTY, parentId: all.find((a) => a.key === 'I')?.id ?? '' })}>+ Hisobraqam qo&apos;shish</Button>}
      />
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-3 rounded-(--radius-card) bg-white px-4 py-3 text-sm shadow-card">
          <span className="text-(--color-text-muted)">
            Jami <b className="text-heading">{all.filter((a) => a.isActive && !a.isHeader).length}</b> ta faol qator
          </span>
          {hiddenCount > 0 && (
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-(--color-text-muted)">
              <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} className="size-4 accent-brand-600" />
              Yashirilganlarni ko&apos;rsatish ({hiddenCount})
            </label>
          )}
        </div>

        <div className="overflow-hidden rounded-(--radius-card) bg-white shadow-card">
          {list.loading && !list.data ? (
            <TableSkeleton rows={10} cols={5} />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
                    <th className="w-14 px-3 py-2.5 text-center">T/r</th>
                    <th className="px-3 py-2.5">Nomi</th>
                    <th className="px-3 py-2.5">Hisob raqami</th>
                    <th className="px-3 py-2.5">Turi</th>
                    <th className="px-3 py-2.5 text-right">Amallar</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => {
                    const kind = KIND_LABEL(a);
                    return (
                      <tr key={a.id} className={cn('border-t border-(--color-line)', a.isHeader ? 'bg-brand-50/60' : 'hover:bg-slate-50', !a.isActive && 'opacity-50')}>
                        <td className={cn('px-3 py-2 text-center text-xs', a.isHeader ? 'font-bold text-brand-700' : 'font-semibold text-(--color-text-muted)')}>{a.code}</td>
                        <td className="px-3 py-2">
                          <div style={{ paddingLeft: Math.max(0, a.level - (a.isHeader ? 0 : 1)) * 18 }} className={cn(a.isHeader || a.sums.length ? 'font-bold text-heading' : 'text-heading')}>
                            {a.level >= 2 && <span className="mr-1 text-slate-300">└</span>}
                            {a.name}
                            {!a.isActive && <span className="ml-2 text-xs font-normal text-(--color-text-muted)">(yashirilgan)</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-(--color-text-muted)">{a.number ?? '—'}</td>
                        <td className="px-3 py-2">
                          <Badge tone={kind.tone} className="whitespace-nowrap">{kind.label}</Badge>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1 whitespace-nowrap text-xs font-semibold">
                            <button type="button" title="Yuqoriga" onClick={() => void act(() => cashApi.move(a.id, 'up'), "Tartib o'zgardi")} className="rounded-md px-2 py-1 text-(--color-text-muted) hover:bg-slate-100">
                              ↑
                            </button>
                            <button type="button" title="Pastga" onClick={() => void act(() => cashApi.move(a.id, 'down'), "Tartib o'zgardi")} className="rounded-md px-2 py-1 text-(--color-text-muted) hover:bg-slate-100">
                              ↓
                            </button>
                            {(a.isHeader || a.sums.length > 0 || a.level <= 1) && a.isActive && (
                              <button type="button" onClick={() => setForm({ ...EMPTY, parentId: a.id, preset: a.isHeader ? 'ACCOUNT' : 'SUB' })} className="rounded-md px-2 py-1 text-emerald-700 hover:bg-emerald-50">
                                + ichiga
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setForm({ id: a.id, name: a.name, code: a.code ?? '', number: a.number ?? '', parentId: a.parentId ?? '', preset: 'ACCOUNT', rollup: true, balanceRule: a.balanceRule })}
                              className="rounded-md px-2 py-1 text-brand-700 hover:bg-brand-50"
                            >
                              Tahrirlash
                            </button>
                            {!a.isHeader && (
                              <button
                                type="button"
                                onClick={() => void act(() => cashApi.updateAccount(a.id, { isActive: !a.isActive }), a.isActive ? 'Yashirildi' : 'Qaytarildi')}
                                className={cn('rounded-md px-2 py-1', a.isActive ? 'text-(--color-expense) hover:bg-red-50' : 'text-emerald-700 hover:bg-emerald-50')}
                              >
                                {a.isActive ? 'Yashirish' : 'Qaytarish'}
                              </button>
                            )}
                            {!a.isHeader && (
                              <button
                                type="button"
                                title="Butunlay o'chirish — faqat hech bir kunda summa kiritilmagan bo'lsa"
                                onClick={() => {
                                  if (window.confirm(`«${a.name}» butunlay o'chirilsinmi? Summa kiritilgan bo'lsa, o'chirilmaydi — «Yashirish»dan foydalaning.`)) void act(() => cashApi.removeAccount(a.id), "O'chirildi");
                                }}
                                className="rounded-md px-2 py-1 text-(--color-expense) hover:bg-red-50"
                              >
                                O&apos;chirish
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Drawer
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? 'Hisobraqamni tahrirlash' : "Yangi qator qo'shish"}
        description={form?.id ? "Nomi, T/r va raqami. Qiymatlar o'zgarmaydi" : 'Kunlik jadvalda tanlangan joyga qo‘shiladi'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setForm(null)}>
              Bekor qilish
            </Button>
            <Button onClick={() => void submit()} loading={saving}>
              Saqlash
            </Button>
          </div>
        }
      >
        {form && (
          <div className="space-y-4">
            {!form.id && (
              <Select
                label="Qayerga (yuqori qator)"
                value={form.parentId}
                onChange={(e) => setForm({ ...form, parentId: e.target.value })}
                options={[{ value: '', label: '— eng yuqori daraja (yangi bo‘lim emas)' }, ...parents.map((p) => ({ value: p.id, label: `${'   '.repeat(p.level)}${p.code ? `${p.code}. ` : ''}${p.name}` }))]}
              />
            )}
            <Input label="Nomi" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Masalan: Uzum bank" autoFocus />
            <div className="grid grid-cols-3 gap-3">
              <Input label="T/r" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="1.17" />
              <div className="col-span-2">
                <Input label="Hisob raqami" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="20210000…" inputMode="numeric" />
              </div>
            </div>
            {!form.id && (
              <div>
                <p className="mb-1.5 text-sm font-medium">Qaysi ustunlar kiritiladi</p>
                <div className="grid gap-2">
                  {(
                    [
                      ['ACCOUNT', 'Hisobraqam', "Yil/oy boshidan, qaytarilgan, kunlik tushum, qoldiq"],
                      ['SUB', 'Tushum qatori', 'Yil/oy boshidan va kunlik tushum (hisobraqam ichidagi manba)'],
                      ['BALANCE', 'Faqat qoldiq', 'Platforma, karta — faqat qoldiq'],
                    ] as const
                  ).map(([value, title, hint]) => (
                    <label key={value} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-3', form.preset === value ? 'border-brand-400 bg-brand-50' : 'border-(--color-line) hover:border-brand-200')}>
                      <input type="radio" checked={form.preset === value} onChange={() => setForm({ ...form, preset: value, balanceRule: value === 'BALANCE' ? 'KEEP' : 'ADD' })} className="mt-1 accent-brand-600" />
                      <span>
                        <span className="block text-sm font-semibold text-heading">{title}</span>
                        <span className="block text-xs text-(--color-text-muted)">{hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {!form.id && form.parentId && (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={form.rollup} onChange={(e) => setForm({ ...form, rollup: e.target.checked })} className="size-4 accent-brand-600" />
                Yuqori qatorning jamisiga qo&apos;shilsin
              </label>
            )}
            <Select label="Ertangi qoldiq qanday hisoblanadi" value={form.balanceRule} onChange={(e) => setForm({ ...form, balanceRule: e.target.value })} options={Object.entries(RULE_LABEL).map(([value, label]) => ({ value, label }))} />
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          </div>
        )}
      </Drawer>
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </>
  );
}