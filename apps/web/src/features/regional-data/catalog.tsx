'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { FIELD, Label, SumInput } from '@/features/purchases/bits';
import { dmy, monthLabel, rdApi } from '@/features/regional-desk/api';
import { Notice, som } from '@/features/regional-desk/bits';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { sumToTiyin, todayInput } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { rdData, type EventRow, type TariffService } from './api';

// ═══════════════════════════════════════════════════════════
// Hududchi › Ma'lumotnomalar:
//   • Tariflar — 39 xizmat narxi: amaldagi (tasdiqlangan), takliflar, haqiqiy o'rtacha narx;
//     Hududchi taklif qiladi, administrator tasdiqlaydi (tasdiq — voqealar jurnaliga ham yoziladi).
//   • Voqealar jurnali — prognoz va salohiyat uchun «uzilish» nuqtalari.
// ═══════════════════════════════════════════════════════════

export function TariffsPage() {
  const { isAdmin } = useAuth();
  const [tick, setTick] = useState(0);
  const list = useAsync(() => rdData.tariffs(), [tick]);
  const items = list.data?.data ?? [];
  const [form, setForm] = useState<{ svc: TariffService; price: number | null; validFrom: string; note: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'error' } | null>(null);
  const pending = items.reduce((s, x) => s + x.pending.length, 0);

  const run = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      setToast({ message });
      setTick((t) => t + 1);
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    }
  };

  return (
    <>
      <PageHeader title="Xizmat tariflari" description="Tasdiqlangan narx va kuchga kirgan sanasi. Yonida — yuklangan ma'lumotdan haqiqiy o'rtacha narx (summa ÷ soni)" />
      <div className="space-y-4 p-4 md:p-6">
        <Notice tone="info">
          Tarif o&apos;zgarsa — yangi narxni <b>taklif</b> qiling, administrator tasdiqlaydi. Tasdiqlangan tarif sanasi prognozda <b>uzilish nuqtasi</b> bo&apos;ladi: model eski narxdagi oylarni yangi
          davr bilan aralashtirmaydi.{pending > 0 && <b> Tasdiq kutayotgan takliflar: {pending} ta.</b>}
        </Notice>
        <div className="overflow-hidden rounded-(--radius-card) bg-white shadow-card">
          {list.loading && !list.data ? (
            <TableSkeleton rows={10} cols={5} />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
                    <th className="w-14 px-3 py-2.5">№</th>
                    <th className="px-3 py-2.5">Xizmat</th>
                    <th className="px-3 py-2.5 text-right">Tasdiqlangan tarif</th>
                    <th className="px-3 py-2.5 text-right">Haqiqiy o&apos;rtacha narx</th>
                    <th className="px-3 py-2.5">Takliflar</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-(--color-line)">
                  {items.map((s) => {
                    const cur = s.current ? Number(s.current.priceTiyin) : null;
                    const act = s.actual ? Number(s.actual.priceTiyin) : null;
                    const gap = cur && act ? (act - cur) / cur : null;
                    return (
                      <tr key={s.code} className="align-top hover:bg-slate-50">
                        <td className="px-3 py-2.5 text-xs font-semibold text-(--color-text-muted)">{Number(s.code.slice(4))}</td>
                        <td className="px-3 py-2.5 text-heading">{s.label}</td>
                        <td className="px-3 py-2.5 text-right">
                          {s.current ? (
                            <>
                              <p className="money font-bold">{som(s.current.priceTiyin)}</p>
                              <p className="text-[11px] text-(--color-text-muted)">{dmy(s.current.validFrom)} dan</p>
                              {isAdmin && (
                                <button
                                  type="button"
                                  className="text-[11px] text-(--color-text-muted) hover:text-(--color-expense) hover:underline"
                                  onClick={() => {
                                    const t = s.current!;
                                    if (window.confirm(`«${s.label}» — ${dmy(t.validFrom)} dan amaldagi tarif o'chirilsinmi? Oldingi tasdiqlangan tarif (bo'lsa) yana amalga kiradi.`)) void run(() => rdData.deleteTariff(t.id), "Tarif o'chirildi");
                                  }}
                                >
                                  o&apos;chirish
                                </button>
                              )}
                            </>
                          ) : (
                            <span className="text-xs text-(--color-text-faint)">kiritilmagan</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {s.actual ? (
                            <>
                              <p className="money">{som(s.actual.priceTiyin)}</p>
                              <p className={cn('text-[11px]', gap !== null && Math.abs(gap) > 0.05 ? 'font-semibold text-amber-600' : 'text-(--color-text-muted)')}>
                                {monthLabel(s.actual.period)} · {s.actual.quantity.toLocaleString('ru-RU')} ta{gap !== null ? ` · ${gap > 0 ? '+' : ''}${Math.round(gap * 100)}%` : ''}
                              </p>
                            </>
                          ) : (
                            <span className="text-xs text-(--color-text-faint)">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {s.pending.map((p) => (
                            <div key={p.id} className="mb-1 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-2 py-1 text-xs">
                              <span className="money font-semibold">{som(p.priceTiyin)}</span>
                              <span>{dmy(p.validFrom)} dan</span>
                              {p.regionCode !== null && <span>({p.regionName})</span>}
                              <span className="text-(--color-text-muted)">{p.by}</span>
                              {isAdmin && (
                                <>
                                  <button type="button" className="font-bold text-emerald-700 hover:underline" onClick={() => void run(() => rdData.decideTariff(p.id, true), 'Tasdiqlandi')}>
                                    tasdiqlash
                                  </button>
                                  <button type="button" className="font-bold text-red-600 hover:underline" onClick={() => void run(() => rdData.decideTariff(p.id, false), 'Rad etildi')}>
                                    rad
                                  </button>
                                </>
                              )}
                              <button type="button" className="text-(--color-text-muted) hover:underline" onClick={() => void run(() => rdData.deleteTariff(p.id), "O'chirildi")}>
                                ✕
                              </button>
                            </div>
                          ))}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => setForm({ svc: s, price: s.actual ? Number(BigInt(s.actual.priceTiyin) / 100n) : null, validFrom: todayInput(), note: '' })}
                            className="whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50"
                          >
                            + Taklif
                          </button>
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
        title="Tarif taklifi"
        description={form?.svc.label}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setForm(null)}>
              Bekor qilish
            </Button>
            <Button
              loading={saving}
              disabled={!form?.price}
              onClick={() => {
                if (!form?.price) return;
                setSaving(true);
                void rdData
                  .proposeTariff({ categoryCode: form.svc.code, regionCode: null, priceTiyin: String(sumToTiyin(form.price)), validFrom: form.validFrom, note: form.note.trim() || null })
                  .then(() => {
                    setToast({ message: 'Taklif yuborildi — administrator tasdiqlaydi' });
                    setForm(null);
                    setTick((t) => t + 1);
                  })
                  .catch((e) => setToast({ message: errorMessage(e), tone: 'error' }))
                  .finally(() => setSaving(false));
              }}
            >
              Yuborish
            </Button>
          </div>
        }
      >
        {form && (
          <div className="space-y-4">
            <div>
              <Label hint="bir xizmat uchun">Narx (so&apos;m)</Label>
              <SumInput value={form.price} onChange={(v) => setForm({ ...form, price: v })} placeholder="0" />
            </div>
            <div>
              <Label>Kuchga kirish sanasi</Label>
              <input type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} className={FIELD} />
            </div>
            <div>
              <Label hint="ixtiyoriy">Asos (buyruq, qaror)</Label>
              <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={FIELD} maxLength={300} />
            </div>
          </div>
        )}
      </Drawer>
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} duration={toast.tone === 'error' ? 6000 : 3000} />}
    </>
  );
}

const EMPTY_EVENT = { id: null as string | null, date: todayInput(), kind: 'OTHER', regionCode: '' as string, categoryCode: '' as string, title: '', description: '', isBreak: true };

export function EventsPage() {
  const [tick, setTick] = useState(0);
  const list = useAsync(() => rdData.events(), [tick]);
  const lk = useAsync(() => rdApi.lookups(), []);
  const tf = useAsync(() => rdData.tariffs(), []);
  const kinds = list.data?.data.kinds ?? {};
  const items = list.data?.data.items ?? [];
  const [form, setForm] = useState<typeof EMPTY_EVENT | null>(null);
  const [del, setDel] = useState<EventRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const submit = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const input = { date: form.date, kind: form.kind, regionCode: form.regionCode ? Number(form.regionCode) : null, categoryCode: form.categoryCode || null, title: form.title, description: form.description.trim() || null, isBreak: form.isBreak };
      if (form.id) await rdData.updateEvent(form.id, input);
      else await rdData.createEvent(input);
      setToast('Saqlandi');
      setForm(null);
      setTick((t) => t + 1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="Voqealar jurnali" description="Tarif o'zgarishi, qayta tuzilish, yangi xizmat… — prognoz va salohiyat shu sanalarda «uzilish»ni hisobga oladi" actions={<Button onClick={() => setForm({ ...EMPTY_EVENT, date: todayInput() })}>+ Voqea qo&apos;shish</Button>} />
      <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
        <Notice tone="info">
          «Uzilish» belgilangan voqea — model shu sanadan oldingi oylarni o&apos;rtacha va o&apos;sish hisobiga olmaydi (masalan, tarif 2 baravar oshgan bo&apos;lsa, eski oylar yangi davrga
          o&apos;xshamaydi). Kichik voqealarni belgisiz yozing — ular faqat izoh sifatida ko&apos;rinadi.
        </Notice>
        <div className="overflow-hidden rounded-(--radius-card) bg-white shadow-card">
          {list.loading && !list.data ? (
            <TableSkeleton rows={5} cols={4} />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : items.length === 0 ? (
            <EmptyState title="Voqea yo'q" description="Tarif o'zgarsa yoki filial qayta tuzilsa — shu yerga yozing" />
          ) : (
            <ul className="divide-y divide-(--color-line)">
              {items.map((e) => (
                <li key={e.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <span className="w-24 shrink-0 font-semibold text-heading">{dmy(e.date)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-heading">
                      {e.title}
                      {e.isBreak && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-red-700">uzilish</span>}
                    </p>
                    <p className="text-xs text-(--color-text-muted)">
                      {e.kindLabel} · {e.regionName} · {e.categoryLabel}
                      {e.by ? ` · ${e.by}` : ''}
                    </p>
                    {e.description && <p className="mt-1 text-sm">{e.description}</p>}
                  </div>
                  <button type="button" className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => setForm({ id: e.id, date: e.date, kind: e.kind, regionCode: e.regionCode === null ? '' : String(e.regionCode), categoryCode: e.categoryCode ?? '', title: e.title, description: e.description ?? '', isBreak: e.isBreak })}>
                    Tahrirlash
                  </button>
                  <button type="button" className="text-xs font-semibold text-(--color-expense) hover:underline" onClick={() => setDel(e)}>
                    O&apos;chirish
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <Drawer
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? 'Voqeani tahrirlash' : 'Yangi voqea'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setForm(null)}>
              Bekor qilish
            </Button>
            <Button loading={saving} onClick={() => void submit()}>
              Saqlash
            </Button>
          </div>
        }
      >
        {form && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Sana</Label>
                <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={FIELD} />
              </div>
              <div>
                <Label>Turi</Label>
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={FIELD}>
                  {Object.entries(kinds).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <Label>Qisqacha</Label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={FIELD} maxLength={200} placeholder="Masalan: Nusxa olish tarifi 2 baravar oshdi" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Hudud</Label>
                <select value={form.regionCode} onChange={(e) => setForm({ ...form, regionCode: e.target.value })} className={FIELD}>
                  <option value="">Barcha hududlar</option>
                  {(lk.data?.data.regions ?? []).map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Xizmat</Label>
                <select value={form.categoryCode} onChange={(e) => setForm({ ...form, categoryCode: e.target.value })} className={FIELD}>
                  <option value="">Barcha xizmatlar</option>
                  {(tf.data?.data ?? []).map((s) => (
                    <option key={s.code} value={s.code}>
                      {Number(s.code.slice(4))}. {s.label.slice(0, 60)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <Label hint="ixtiyoriy">Batafsil</Label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} maxLength={1000} className={cn(FIELD, 'h-auto py-2')} />
            </div>
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-(--color-line) p-3 text-sm">
              <input type="checkbox" checked={form.isBreak} onChange={(e) => setForm({ ...form, isBreak: e.target.checked })} className="mt-0.5 size-4 accent-brand-600" />
              <span>
                <b>Uzilish nuqtasi</b> — prognoz va salohiyat bu sanadan oldingi oylarni hisobga olmasin
              </span>
            </label>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          </div>
        )}
      </Drawer>
      <ConfirmDialog
        open={del !== null}
        title="Voqeani o'chirish"
        message={del?.title ?? ''}
        confirmLabel="O'chirish"
        danger
        onConfirm={() => {
          if (!del) return;
          void rdData.deleteEvent(del.id).then(() => {
            setToast("O'chirildi");
            setTick((t) => t + 1);
          });
          setDel(null);
        }}
        onCancel={() => setDel(null)}
      />
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </>
  );
}