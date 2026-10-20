'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconAlert, IconCheck, IconDownload, IconUpload } from '@/components/ui/icons';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth-context';
import { formatPeriod, formatPeriodShort, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  analyzeInternetFile,
  downloadInternetTemplate,
  internetApi,
  unitOf,
  unitText,
  unitValue,
  type Analysis,
  type Contract,
  type Lookups,
  type Overview,
} from './api';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › Internet
//   Fayl yuklanadi (bank ro'yxati: oy | summa | shartnoma yoki shablon) → shartnoma × oy tahlili,
//   o'zgarishlar (summa o'zgargan, to'lanmagan oy, bir martalik) → har shartnomaga: kimga to'lanadi,
//   nima uchun, qayerga biriktiriladi (Markaz / Markaz bo'limi / hudud) → «Xarajat sifatida saqlash».
//   Fayl bo'lmasa — ro'yxat va yozilgan to'lovlar.
// ═══════════════════════════════════════════════════════════

const TH = 'px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wider text-(--color-text-muted) whitespace-nowrap';
const INPUT = 'h-8 w-full rounded-(--radius-control) border border-(--color-line) bg-white px-2 text-sm outline-none placeholder:text-(--color-text-faint) focus:border-brand-400';

const short = (tiyin: string | number | bigint) => formatTiyin(tiyin.toString(), { decimals: 0 });

/** initialAnalysis — ko'rib chiqish (preview) uchun: fayl yuklangandek ochiladi */
export function InternetPage({ initialAnalysis = null }: { initialAnalysis?: Analysis | null } = {}) {
  const { isAdmin } = useAuth();
  const overview = useAsync(() => internetApi.overview().then((r) => r.data), []);
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(initialAnalysis);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy('Fayl o‘qilmoqda');
    try {
      const a = await analyzeInternetFile(f);
      setFile(f);
      setAnalysis(a);
    } catch (e) {
      setToast({ text: (e as Error).message, tone: 'error' });
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  };

  const template = async (withFile: boolean) => {
    setBusy('Shablon tayyorlanmoqda');
    try {
      await downloadInternetTemplate(withFile ? (file ?? undefined) : undefined);
    } catch (e) {
      setToast({ text: (e as Error).message, tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Internet"
        description="Shartnomalar: kimga to'lanadi, qayerga biriktiriladi — oylik to'lovlar xarajat sifatida"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => template(false)} disabled={!!busy}>
              <IconDownload className="size-4" />
              Shablon
            </Button>
            {isAdmin && (
              <>
                <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
                <Button size="sm" onClick={() => input.current?.click()} loading={busy === 'Fayl o‘qilmoqda'}>
                  <IconUpload className="size-4" />
                  To&apos;lovlar faylini yuklash
                </Button>
              </>
            )}
          </div>
        }
      />
      <div className="space-y-4 p-4 md:p-6">
        {overview.error ? (
          <Card>
            <ErrorState message={overview.error} onRetry={overview.reload} />
          </Card>
        ) : !overview.data ? (
          <Card>
            <LoadingState label="Yuklanmoqda" />
          </Card>
        ) : analysis ? (
          <AnalysisView
            key={analysis.fileName + analysis.totalTiyin}
            analysis={analysis}
            overview={overview.data}
            canSave={isAdmin}
            onClose={() => {
              setAnalysis(null);
              setFile(null);
            }}
            onTemplate={() => template(true)}
            onSaved={(text) => {
              setToast({ text, tone: 'success' });
              setAnalysis(null);
              setFile(null);
              overview.reload();
            }}
            onError={(text) => setToast({ text, tone: 'error' })}
          />
        ) : (
          <RegistryView
            overview={overview.data}
            canSave={isAdmin}
            onUpload={() => input.current?.click()}
            onSaved={(text) => {
              setToast({ text, tone: 'success' });
              overview.reload();
            }}
            onError={(text) => setToast({ text, tone: 'error' })}
          />
        )}
      </div>
      {toast && <Toast message={toast.text} tone={toast.tone} onClose={() => setToast(null)} duration={toast.tone === 'error' ? 6000 : 4000} />}
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// Shartnoma qatori: kimga to'lanadi, nima uchun, qayerga biriktiriladi
// ═══════════════════════════════════════════════════════════

function UnitSelect({ value, onChange, lookups, disabled }: { value: Contract['unit']; onChange: (u: Contract['unit']) => void; lookups: Lookups; disabled?: boolean }) {
  return (
    <select
      value={unitValue(value)}
      disabled={disabled}
      onChange={(e) => onChange(unitOf(e.target.value))}
      className={cn(INPUT, 'min-w-[11rem] pr-6', !value && 'border-amber-300 bg-amber-50 text-amber-900')}
    >
      <option value="">— biriktirilmagan —</option>
      <option value="center">Markaz (umumiy)</option>
      {lookups.departments.length > 0 && (
        <optgroup label="Markaz bo'limi">
          {lookups.departments.map((d) => (
            <option key={d.id} value={`dep:${d.id}`}>
              Markaz › {d.name}
            </option>
          ))}
        </optgroup>
      )}
      {lookups.regions.length > 0 && (
        <optgroup label="Hudud">
          {lookups.regions.map((r) => (
            <option key={r.code} value={`reg:${r.code}`}>
              {r.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

function ContractFields({ c, onChange, lookups, disabled }: { c: Contract; onChange: (c: Contract) => void; lookups: Lookups; disabled?: boolean }) {
  return (
    <>
      <td className="px-2 py-1.5">
        <div className="flex min-w-[15rem] flex-col gap-1">
          <input className={INPUT} value={c.provider ?? ''} placeholder="Kimga: Uztelecom, …" title="Kimga to'lanadi (provayder)" disabled={disabled} onChange={(e) => onChange({ ...c, provider: e.target.value || null })} />
          <input className={INPUT} value={c.purpose ?? ''} placeholder="Nima uchun: bino, xona, xizmat…" title="Nima uchun (izoh)" disabled={disabled} onChange={(e) => onChange({ ...c, purpose: e.target.value || null })} />
        </div>
      </td>
      <td className="px-2 py-1.5">
        <UnitSelect value={c.unit} onChange={(unit) => onChange({ ...c, unit })} lookups={lookups} disabled={disabled} />
      </td>
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// Fayl tahlili
// ═══════════════════════════════════════════════════════════

function AnalysisView({
  analysis,
  overview,
  canSave,
  onClose,
  onTemplate,
  onSaved,
  onError,
}: {
  analysis: Analysis;
  overview: Overview;
  canSave: boolean;
  onClose: () => void;
  onTemplate: () => void;
  onSaved: (text: string) => void;
  onError: (text: string) => void;
}) {
  const lookups = overview.lookups;
  // Shartnoma ma'lumoti: ro'yxatdagi → fayldagi (shablon) → bo'sh
  const [contracts, setContracts] = useState<Contract[]>(() =>
    analysis.contracts
      .filter((c) => c.contractNo !== '—')
      .map((s) => {
        const reg = overview.registry.contracts.find((x) => x.contractNo === s.contractNo);
        const fromFile = analysis.registryFromFile.find((x) => x.contractNo === s.contractNo);
        const base = reg ?? fromFile ?? null;
        // Shablonda to'ldirilgan maydon ro'yxatdagidan ustun
        return {
          contractNo: s.contractNo,
          contractDate: fromFile?.contractDate ?? reg?.contractDate ?? s.contractDate,
          provider: fromFile?.provider ?? base?.provider ?? null,
          purpose: fromFile?.purpose ?? base?.purpose ?? null,
          unit: fromFile?.unit ?? base?.unit ?? null,
        };
      }),
  );
  const [category, setCategory] = useState<string>(overview.registry.categoryCode ?? (overview.category.exists ? overview.category.code : ''));
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const months = analysis.months;
  const fresh = analysis.payments.filter((p) => !p.posted);
  const freshTotal = fresh.reduce((a, p) => a + BigInt(p.amountTiyin), 0n);
  const unassigned = contracts.filter((c) => !c.unit);
  const unassignedPay = fresh.filter((p) => p.contractNo && unassigned.some((c) => c.contractNo === p.contractNo)).length + fresh.filter((p) => !p.contractNo).length;
  const newContracts = analysis.contracts.filter((c) => !c.inRegistry && c.contractNo !== '—').length;
  const maxMonth = Math.max(1, ...analysis.byMonth.map((m) => Number(m.totalTiyin)));
  const set = (c: Contract) => setContracts((list) => list.map((x) => (x.contractNo === c.contractNo ? c : x)));

  // Biriktirish bo'yicha jami (saqlanadigan)
  const byUnit = useMemo(() => {
    const acc = new Map<string, { total: bigint; count: number }>();
    for (const p of analysis.payments) {
      const c = contracts.find((x) => x.contractNo === p.contractNo) ?? null;
      const label = unitText(c?.unit ?? null, lookups);
      const g = acc.get(label) ?? { total: 0n, count: 0 };
      g.total += BigInt(p.amountTiyin);
      g.count += 1;
      acc.set(label, g);
    }
    return [...acc.entries()].sort((a, b) => (b[1].total > a[1].total ? 1 : -1));
  }, [analysis, contracts, lookups]);

  const save = async () => {
    if (unassignedPay > 0 && !confirm) {
      setConfirm(true);
      return;
    }
    setSaving(true);
    try {
      const r = (await internetApi.commit(analysis.fileName, fresh, contracts, category || null)).data;
      onSaved(
        r.created === 0
          ? `Yangi to'lov yo'q — ${r.skipped} tasi avval yozilgan`
          : `${r.created} ta to'lov xarajatga yozildi (${short(r.totalTiyin)} so'm)${r.skipped ? `, ${r.skipped} tasi avval yozilgan` : ''}${r.unassigned ? ` · ${r.unassigned} tasi biriktirilmagan` : ''}`,
      );
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
      setConfirm(false);
    }
  };

  return (
    <>
      {/* Sarlavha va jami */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 bg-gradient-to-br from-[#16294a] to-[#23426a] px-5 py-4 text-white">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/60">Fayl tahlili · hali saqlanmagan</p>
            <p className="mt-1 truncate text-lg font-semibold">{analysis.fileName}</p>
            <p className="text-sm text-white/70">
              {months.length} oy ({formatPeriod(months[0] ?? '')} — {formatPeriod(months[months.length - 1] ?? '')}) · {analysis.payments.length} ta to&apos;lov · {analysis.contracts.length} ta shartnoma
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wider text-white/60">Jami</p>
            <p className="text-3xl font-bold tabular-nums tracking-tight">{short(analysis.totalTiyin)}</p>
            <p className="text-xs text-white/60">so&apos;m</p>
          </div>
        </div>
        <div className="grid divide-y divide-(--color-line) sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          {analysis.byMonth.map((m) => (
            <div key={m.period} className="px-5 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">{formatPeriod(m.period)}</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-heading">{short(m.totalTiyin)}</p>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-(--color-surface-muted)">
                <span className="block h-full rounded-full bg-brand-500" style={{ width: `${(Number(m.totalTiyin) / maxMonth) * 100}%` }} />
              </div>
              <p className="mt-1 text-xs text-(--color-text-muted)">{m.count} ta to&apos;lov</p>
            </div>
          ))}
        </div>
      </Card>

      {(analysis.warnings.length > 0 || analysis.noContract > 0 || analysis.registryUnresolved.length > 0) && (
        <Card className="border-l-4 border-l-amber-400 px-5 py-3 text-sm">
          {analysis.noContract > 0 && <p>{analysis.noContract} ta to&apos;lovda shartnoma raqami topilmadi — ular biriktirilmagan bo&apos;lib yoziladi.</p>}
          {analysis.registryUnresolved.map((u) => (
            <p key={u.contractNo}>
              {u.contractNo}: shablondagi «{u.unitName}» bo&apos;lim yoki hudud ro&apos;yxatida topilmadi — quyida tanlang.
            </p>
          ))}
          {analysis.warnings.map((w) => (
            <p key={w} className="text-(--color-text-muted)">
              {w}
            </p>
          ))}
        </Card>
      )}

      {/* Shartnoma × oy */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4">
          <div>
            <h3 className="text-sm font-bold text-heading">Qaysi shartnomaga qancha to&apos;lanmoqda</h3>
            <p className="mt-0.5 text-xs text-(--color-text-muted)">
              Har shartnoma uchun: kimga to&apos;lanadi, nima uchun va qayerga biriktiriladi. Sariq — biriktirilmagan.
              {newContracts > 0 && ` ${newContracts} ta shartnoma ro'yxatda yo'q (yangi).`}
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={onTemplate}>
            <IconDownload className="size-4" />
            Shu fayldan shablon
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] border-collapse text-[13px]">
            <thead>
              <tr className="border-y border-(--color-line) bg-(--color-surface-muted)">
                <th className={TH}>Shartnoma</th>
                {months.map((m) => (
                  <th key={m} className={cn(TH, 'text-right')}>
                    {formatPeriodShort(m)}
                  </th>
                ))}
                <th className={cn(TH, 'text-right')}>Jami</th>
                <th className={TH}>Kimga va nima uchun</th>
                <th className={TH}>Qayerga biriktiriladi</th>
              </tr>
            </thead>
            <tbody>
              {analysis.contracts.map((s) => {
                const c = contracts.find((x) => x.contractNo === s.contractNo);
                return (
                  <tr key={s.contractNo} className="border-b border-(--color-line) align-top">
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5 font-semibold tabular-nums">
                        {s.contractNo}
                        {!s.inRegistry && s.contractNo !== '—' && <span className="rounded bg-brand-600 px-1.5 py-0.5 text-[9.5px] font-bold uppercase text-white">yangi</span>}
                        {s.prepaid && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[9.5px] font-semibold text-slate-700" title="Oldindan to'lov (предоплата)">oldindan</span>}
                      </span>
                      {s.contractDate && <span className="block text-[11px] text-(--color-text-faint)">{s.contractDate} dagi</span>}
                      {s.notes.map((n) => (
                        <span key={n} className="mt-0.5 block max-w-[13rem] text-[11px] leading-snug text-amber-700">
                          {n}
                        </span>
                      ))}
                    </td>
                    {months.map((m, i) => {
                      const v = s.months[m];
                      const prev = months.slice(0, i).reverse().find((p) => s.months[p]);
                      const pv = prev ? s.months[prev] : undefined;
                      const change = v && pv && v !== pv ? (BigInt(v) > BigInt(pv) ? 'up' : 'down') : null;
                      const gap = !v && Object.keys(s.months).some((p) => p < m) && Object.keys(s.months).some((p) => p > m);
                      return (
                        <td
                          key={m}
                          className={cn(
                            'whitespace-nowrap px-3 py-2 text-right tabular-nums',
                            change === 'up' && 'bg-red-50 text-red-700',
                            change === 'down' && 'bg-emerald-50 text-emerald-700',
                            gap && 'bg-amber-50',
                          )}
                          title={change ? `Oldingi to'lov: ${short(pv!)}` : gap ? "Bu oyda to'lov yo'q" : undefined}
                        >
                          {v ? short(v) : <span className="text-(--color-text-faint)">{gap ? "yo'q" : '—'}</span>}
                          {change && <span className="ml-1 text-[10px]">{change === 'up' ? '▲' : '▼'}</span>}
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{short(s.totalTiyin)}</td>
                    {c ? <ContractFields c={c} onChange={set} lookups={lookups} disabled={!canSave} /> : <td colSpan={2} className="px-3 py-2 text-xs text-(--color-text-muted)">Shartnoma raqami yo&apos;q — biriktirilmagan bo&apos;lib yoziladi</td>}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-(--color-surface-muted) font-semibold">
                <td className="px-3 py-2">Jami</td>
                {months.map((m) => (
                  <td key={m} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {short(analysis.byMonth.find((b) => b.period === m)?.totalTiyin ?? '0')}
                  </td>
                ))}
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{short(analysis.totalTiyin)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* Biriktirish bo'yicha va saqlash */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="px-5 py-4">
          <h3 className="text-sm font-bold text-heading">Qayerga qancha tushadi</h3>
          <ul className="mt-2 space-y-1.5">
            {byUnit.map(([label, g]) => (
              <li key={label} className={cn('flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm', label === 'Biriktirilmagan' ? 'bg-amber-50 text-amber-900' : 'bg-(--color-surface-muted)')}>
                <span className="min-w-0 truncate">{label}</span>
                <span className="shrink-0 tabular-nums">
                  <b>{short(g.total.toString())}</b> <span className="text-xs text-(--color-text-muted)">· {g.count} ta</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="px-5 py-4">
          <h3 className="text-sm font-bold text-heading">Xarajat sifatida saqlash</h3>
          <p className="mt-1 text-xs text-(--color-text-muted)">
            Har to&apos;lov — bitta xarajat: oy oxiri sanasi bilan, kontragent — provayder, hujjat № — shartnoma, izoh — «Internet: nima uchun — shartnoma, oy».
            Qayta yuklansa — avval yozilganlar ikki marta yozilmaydi.
          </p>
          <label className="mt-3 block text-xs font-medium text-(--color-text-muted)">Xarajat moddasi</label>
          <select className={cn(INPUT, 'mt-1')} value={category} onChange={(e) => setCategory(e.target.value)} disabled={!canSave}>
            {!overview.category.exists && <option value="">«Internet to&apos;lovlari» (yangi modda yaratiladi)</option>}
            {lookups.categories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-(--color-surface-muted) px-3 py-1">
              Yangi: <b className="tabular-nums">{fresh.length}</b> ta · <b className="tabular-nums">{short(freshTotal.toString())}</b>
            </span>
            {analysis.payments.length - fresh.length > 0 && <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-800">Avval yozilgan: {analysis.payments.length - fresh.length} ta</span>}
          </div>
          {confirm && (
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <IconAlert className="mt-0.5 size-4 shrink-0" />
              {unassignedPay} ta to&apos;lov biriktirilmagan — ular «Hududga biriktirilmagan» bo&apos;lib yoziladi. Keyin ro&apos;yxatda biriktirsangiz, o&apos;zi ko&apos;chadi. Davom etamizmi?
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {canSave && (
              <Button onClick={save} loading={saving} disabled={fresh.length === 0}>
                <IconCheck className="size-4" />
                {confirm ? 'Ha, saqlash' : `Xarajat sifatida saqlash (${fresh.length})`}
              </Button>
            )}
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Bekor qilish
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// Ro'yxat va yozilgan to'lovlar (fayl yuklanmaganda)
// ═══════════════════════════════════════════════════════════

function RegistryView({ overview, canSave, onUpload, onSaved, onError }: { overview: Overview; canSave: boolean; onUpload: () => void; onSaved: (t: string) => void; onError: (t: string) => void }) {
  const lookups = overview.lookups;
  const [contracts, setContracts] = useState<Contract[]>(overview.registry.contracts);
  const [apply, setApply] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => setContracts(overview.registry.contracts), [overview]);
  const dirty = JSON.stringify(contracts) !== JSON.stringify(overview.registry.contracts);
  const posted = overview.posted;
  const set = (c: Contract) => setContracts((list) => list.map((x) => (x.contractNo === c.contractNo ? c : x)));
  const rowOf = (no: string) => posted.rows.find((r) => r.contractNo === no);
  const extra = posted.rows.filter((r) => !contracts.some((c) => c.contractNo === r.contractNo));

  const save = async () => {
    setSaving(true);
    try {
      const r = (await internetApi.saveRegistry(contracts, overview.registry.categoryCode, apply)).data;
      onSaved(`Ro'yxat saqlandi${r.updated ? ` · ${r.updated} ta yozilgan xarajat yangi biriktirishga o'tdi` : ''}`);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (contracts.length === 0 && posted.count === 0) {
    return (
      <Card className="px-6 py-12 text-center">
        <p className="text-lg font-semibold text-heading">Internet shartnomalari hali yo&apos;q</p>
        <p className="mx-auto mt-1 max-w-xl text-sm text-(--color-text-muted)">
          Bank ro&apos;yxatini yuklang (har oy: summa | shartnoma ustunlari) yoki shablonni to&apos;ldiring. Dastur shartnoma raqamini to&apos;lov izohidan o&apos;zi ajratadi,
          oylar bo&apos;yicha tahlil qiladi va har shartnomani biriktirishga taklif qiladi.
        </p>
        {canSave && (
          <div className="mt-4">
            <Button onClick={onUpload}>
              <IconUpload className="size-4" />
              To&apos;lovlar faylini yuklash
            </Button>
          </div>
        )}
      </Card>
    );
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">Yozilgan internet xarajati</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-heading">{short(posted.totalTiyin)}</p>
          <p className="text-xs text-(--color-text-muted)">
            {posted.count} ta to&apos;lov · {posted.months.length ? `${formatPeriod(posted.months[0]!)} — ${formatPeriod(posted.months[posted.months.length - 1]!)}` : '—'}
          </p>
        </Card>
        <Card className="px-5 py-4 sm:col-span-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">Qayerga biriktirilgan</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {posted.byUnit.map((u) => (
              <span key={u.label} className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs', u.label === 'Biriktirilmagan' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-(--color-line)')}>
                {u.label} <b className="tabular-nums">{short(u.totalTiyin)}</b> <span className="text-(--color-text-faint)">· {u.count}</span>
              </span>
            ))}
            {posted.byUnit.length === 0 && <span className="text-sm text-(--color-text-muted)">Hali xarajat yozilmagan</span>}
          </div>
          <p className="mt-2 text-xs text-(--color-text-muted)">Modda: {overview.category.label}</p>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 pb-3 pt-4">
          <h3 className="text-sm font-bold text-heading">Shartnomalar ro&apos;yxati</h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">Kimga to&apos;lanadi, nima uchun va qayerga biriktiriladi. Oylar — yozilgan xarajatlar. Qizil belgi — yozilgani ro&apos;yxatdagi biriktirishdan farq qiladi.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-[13px]">
            <thead>
              <tr className="border-y border-(--color-line) bg-(--color-surface-muted)">
                <th className={TH}>Shartnoma</th>
                {posted.months.map((m) => (
                  <th key={m} className={cn(TH, 'text-right')}>
                    {formatPeriodShort(m)}
                  </th>
                ))}
                <th className={cn(TH, 'text-right')}>Jami</th>
                <th className={TH}>Kimga va nima uchun</th>
                <th className={TH}>Qayerga biriktiriladi</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => {
                const r = rowOf(c.contractNo);
                return (
                  <tr key={c.contractNo} className="border-b border-(--color-line) align-top">
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5 font-semibold tabular-nums">
                        {c.contractNo}
                        {r?.mismatch && <span className="rounded bg-red-600 px-1.5 py-0.5 text-[9.5px] font-bold text-white" title={`Yozilgan: ${r.unitLabel}`}>farq</span>}
                      </span>
                      {c.contractDate && <span className="block text-[11px] text-(--color-text-faint)">{c.contractDate} dagi</span>}
                    </td>
                    {posted.months.map((m) => (
                      <td key={m} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {r?.months[m] ? short(r.months[m]!) : <span className="text-(--color-text-faint)">—</span>}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{r ? short(r.totalTiyin) : '—'}</td>
                    <ContractFields c={c} onChange={set} lookups={lookups} disabled={!canSave} />
                  </tr>
                );
              })}
              {extra.map((r) => (
                <tr key={r.contractNo} className="border-b border-(--color-line) bg-amber-50/40 align-top">
                  <td className="px-3 py-2 font-semibold">{r.contractNo}</td>
                  {posted.months.map((m) => (
                    <td key={m} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {r.months[m] ? short(r.months[m]!) : '—'}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{short(r.totalTiyin)}</td>
                  <td colSpan={2} className="px-3 py-2 text-xs text-(--color-text-muted)">
                    Ro&apos;yxatda yo&apos;q · yozilgan: {r.unitLabel}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canSave && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--color-line) px-5 py-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} />
              Yozilgan xarajatlarni ham yangi biriktirishga o&apos;tkazish
            </label>
            <Button onClick={save} loading={saving} disabled={!dirty && !posted.rows.some((r) => r.mismatch)}>
              <IconCheck className="size-4" />
              Ro&apos;yxatni saqlash
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}