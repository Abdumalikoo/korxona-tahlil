'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Toast } from '@/components/ui/toast';
import { Dropzone, Notice, openDropzone, Stat, som } from '@/features/regional-desk/bits';
import { SourceActions } from '@/components/shared/source-actions';
import { errorMessage } from '@/lib/error-message';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { addPlanFactEmployees, analyzePlanFact, commitPlanFact, downloadPlanFactTemplate, type PlanFactAnalysis, type PlanFactMissing, type ReconcileLine } from './plan-fact-api';

// ═══════════════════════════════════════════════════════════
// Xodimlar reja / tushum fayli (Daromadlar › Reja va tushum, Hududchi › Reja va tushum).
//   • Fayl DAROMAD YARATMAYDI — ish haqi vedomosti kabi: Daromadlar bo'limida yuklangan daromadni
//     xodimlarga bo'lib beradi (Solishtirma › tuman › xodimlar, ustama).
//   • Har oy × viloyat (tuman): xodimlar tushumi yig'indisi ↔ yuklangan daromad; mos kelmasa — ogohlantirish.
// ═══════════════════════════════════════════════════════════

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`);
const signed = (t: string) => (t.startsWith('-') ? `−${som(t.slice(1))}` : t === '0' ? '0' : `+${som(t)}`);

function YearPicker({ value, onChange }: { value: number; onChange: (y: number) => void }) {
  const max = new Date().getFullYear() + 1;
  return (
    <div className="flex items-center gap-1 rounded-xl bg-white p-1 shadow-card">
      <button type="button" onClick={() => onChange(value - 1)} className="flex size-9 items-center justify-center rounded-lg text-xl hover:bg-brand-50" aria-label="Oldingi yil">
        ‹
      </button>
      <span className="min-w-20 text-center text-[15px] font-bold text-heading">{value}-yil</span>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} className="flex size-9 items-center justify-center rounded-lg text-xl hover:bg-brand-50 disabled:opacity-30" aria-label="Keyingi yil">
        ›
      </button>
    </div>
  );
}

function StatusPill({ line }: { line: ReconcileLine }) {
  if (line.status === 'ok') return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Mos</span>;
  if (line.status === 'no_income') return <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">Daromad yuklanmagan</span>;
  return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">Farq {pct(line.diffPercent)}</span>;
}

function Section({ title, hint, children, open: initial = true }: { title: ReactNode; hint?: ReactNode; children: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <div className="overflow-hidden rounded-(--radius-card) bg-white shadow-card">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 border-b border-(--color-line) px-4 py-3 text-left">
        <span className="font-semibold text-heading">{title}</span>
        {hint && <span className="text-xs text-(--color-text-muted)">{hint}</span>}
        <span className="ml-auto text-(--color-text-faint)">{open ? '▴' : '▾'}</span>
      </button>
      {open && children}
    </div>
  );
}

function ReconcileTable({ lines, district }: { lines: ReconcileLine[]; district?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
            <th className="px-4 py-2.5">Oy</th>
            <th className="px-3 py-2.5">{district ? 'Viloyat / tuman' : 'Viloyat'}</th>
            <th className="px-3 py-2.5 text-right">Xodimlar tushumi (fayl)</th>
            <th className="px-3 py-2.5 text-right">Yuklangan daromad</th>
            <th className="px-3 py-2.5 text-right">Farq</th>
            <th className="px-3 py-2.5 text-right">Holat</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-(--color-line)">
          {lines.map((l) => (
            <tr key={`${l.period}-${l.regionCode}-${l.districtId ?? ''}`} className={l.status === 'ok' ? '' : l.status === 'diff' ? 'bg-amber-50/40' : 'bg-red-50/40'}>
              <td className="whitespace-nowrap px-4 py-2 text-(--color-text-muted)">{l.label}</td>
              <td className="px-3 py-2 font-medium text-heading">
                {l.regionName}
                {l.districtName && <span className="font-normal text-(--color-text-muted)"> / {l.districtName}</span>}
              </td>
              <td className="money px-3 py-2 text-right">{som(l.factTiyin)}</td>
              <td className="money px-3 py-2 text-right">{som(l.incomeTiyin)}</td>
              <td className={cn('money px-3 py-2 text-right font-semibold', l.status === 'ok' ? 'text-(--color-text-muted)' : 'text-amber-700')}>{signed(l.diffTiyin)}</td>
              <td className="px-3 py-2 text-right">
                <StatusPill line={l} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NameList({ items }: { items: string[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 10);
  return (
    <>
      <ul className="mt-1 list-inside list-disc space-y-0.5">
        {shown.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
      {items.length > 10 && (
        <button type="button" onClick={() => setAll(!all)} className="mt-1 text-xs font-semibold underline">
          {all ? 'Kamroq' : `Yana ${items.length - 10} ta`}
        </button>
      )}
    </>
  );
}

const TYPE_LABEL: Record<string, string> = { SHTAT: 'Shtat', SHARTNOMA: 'Shartnoma' };

/**
 * Reestrda yo'q xodimlar: PINFL va hududi aniq bo'lganlari — shu yerning o'zidan Xodimlarga qo'shiladi
 * (belgilab «Xodimlarga qo'shish»), qolganlari — Xodimlar bo'limida qo'lda.
 */
function MissingPanel({ items, role, onAdded }: { items: PlanFactMissing[]; role: 'admin' | 'hududchi'; onAdded: (count: number) => void }) {
  const canAdd = (m: PlanFactMissing) => !!m.pinfl && m.regionCode !== null && (role === 'admin' || m.regionCode !== 0);
  const addable = items.filter(canAdd);
  const [picked, setPicked] = useState<Set<number>>(() => new Set(addable.map((m) => m.rowIndex)));
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const chosen = addable.filter((m) => picked.has(m.rowIndex));
  const toggle = (r: number) => setPicked((p) => { const n = new Set(p); if (n.has(r)) n.delete(r); else n.add(r); return n; });
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await addPlanFactEmployees(chosen.map((m) => ({ pinfl: m.pinfl!, fullName: m.fileName, regionCode: m.regionCode!, districtId: m.districtId, employmentType: m.employmentType })));
      setAsk(false);
      onAdded(res.created);
    } catch (e) {
      setErr(errorMessage(e));
      setAsk(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="overflow-hidden rounded-(--radius-card) border border-amber-200 bg-white shadow-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3">
        <span className="font-semibold text-amber-900">Reestrda yo&apos;q xodimlar ({items.length})</span>
        <span className="text-xs text-amber-800">saqlashda olinmaydi — avval Xodimlarga qo&apos;shing, keyin fayl qayta tekshiriladi</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {role === 'admin' && (
            <Link href="/xodimlar" className="inline-flex items-center rounded-lg border border-(--color-line) bg-white px-3 py-1.5 text-sm font-semibold text-heading hover:bg-brand-50">
              Xodimlar bo&apos;limi →
            </Link>
          )}
          {addable.length > 0 && (
            <Button size="sm" onClick={() => setAsk(true)} disabled={!chosen.length}>
              Xodimlarga qo&apos;shish ({chosen.length})
            </Button>
          )}
        </div>
      </div>
      {err && <p className="border-b border-(--color-line) bg-red-50 px-4 py-2 text-sm text-red-700">{err}</p>}
      <div className="max-h-80 overflow-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
              <th className="w-10 px-4 py-2">
                <input
                  type="checkbox"
                  aria-label="Hammasini belgilash"
                  checked={addable.length > 0 && chosen.length === addable.length}
                  onChange={(e) => setPicked(e.target.checked ? new Set(addable.map((m) => m.rowIndex)) : new Set())}
                  disabled={!addable.length}
                />
              </th>
              <th className="px-3 py-2">Qator</th>
              <th className="px-3 py-2">Xodim F.I.Sh</th>
              <th className="px-3 py-2">JShShIR</th>
              <th className="px-3 py-2">Shtat</th>
              <th className="px-3 py-2">Hudud</th>
              <th className="px-3 py-2">Holat</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-(--color-line)">
            {items.map((m) => {
              const ok = canAdd(m);
              return (
                <tr key={m.rowIndex} className={ok ? '' : 'bg-slate-50/60 text-(--color-text-muted)'}>
                  <td className="px-4 py-2">
                    <input type="checkbox" aria-label={m.fileName} checked={ok && picked.has(m.rowIndex)} onChange={() => toggle(m.rowIndex)} disabled={!ok} />
                  </td>
                  <td className="px-3 py-2 text-(--color-text-muted)">{m.rowIndex}</td>
                  <td className="px-3 py-2 font-medium text-heading">{m.fileName}</td>
                  <td className="money px-3 py-2">{m.pinfl ?? '—'}</td>
                  <td className="px-3 py-2">{m.employmentType ? TYPE_LABEL[m.employmentType] ?? m.employmentType : 'Shtat'}</td>
                  <td className="px-3 py-2">
                    {m.region || '—'}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {ok ? (
                      <span className="text-emerald-700">Qo&apos;shish mumkin</span>
                    ) : !m.pinfl ? (
                      role === 'admin' ? 'JShShIR yo\'q — faylga yozing yoki Xodimlar bo\'limida qo\'shing' : 'JShShIR yo\'q — faylga yozib qayta yuklang'
                    ) : m.regionCode === null ? (
                      'Hudud aniqlanmadi — «Hudud nomi»ni tekshiring'
                    ) : (
                      'Markaz xodimi — administrator qo\'shadi'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={ask}
        title="Xodimlarga qo'shish"
        message={`${chosen.length} ta xodim Xodimlar reestriga qo'shiladi (fayldagi JShShIR, F.I.Sh, hudud va shtat turi bilan): ${chosen.slice(0, 5).map((m) => m.fileName).join(', ')}${chosen.length > 5 ? ' …' : ''}. Keyin fayl qayta tekshiriladi.`}
        confirmLabel="Ha, qo'shish"
        loading={busy}
        onConfirm={() => void run()}
        onCancel={() => setAsk(false)}
      />
    </div>
  );
}

const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];

/** Oy tanlash: «Fayldagi hammasi» yoki aniq oy(lar). Faylda bor oylar nuqta bilan belgilanadi */
function MonthChips({ value, onChange, inFile, single }: { value: number[]; onChange: (v: number[]) => void; inFile: number[]; single: boolean }) {
  const toggle = (m: number) => {
    if (single) return onChange(value.length === 1 && value[0] === m ? [] : [m]);
    onChange(value.includes(m) ? value.filter((x) => x !== m) : [...value, m].sort((a, b) => a - b));
  };
  const chip = 'relative rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors';
  return (
    <div className="flex flex-wrap gap-1.5 rounded-xl bg-white p-1.5 shadow-card">
      {!single && (
        <button type="button" onClick={() => onChange([])} className={cn(chip, value.length === 0 ? 'bg-brand-600 text-white' : 'text-(--color-text-muted) hover:bg-brand-50')}>
          Fayldagi hammasi
        </button>
      )}
      {MONTHS.map((label, i) => {
        const m = i + 1;
        const on = value.includes(m);
        return (
          <button key={m} type="button" onClick={() => toggle(m)} className={cn(chip, on ? 'bg-brand-600 text-white' : 'text-heading hover:bg-brand-50')} title={inFile.includes(m) ? 'Faylda bor' : undefined}>
            {label}
            {inFile.includes(m) && <span className={cn('absolute right-1 top-1 size-1.5 rounded-full', on ? 'bg-white' : 'bg-emerald-500')} />}
          </button>
        );
      })}
    </div>
  );
}

export function PlanFactUpload({ role }: { role: 'admin' | 'hududchi' }) {
  const [year, setYear] = useState(new Date().getFullYear());
  /** Tanlangan oylar: bo'sh — fayldagi hamma oylar */
  const [sel, setSel] = useState<number[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [a, setA] = useState<PlanFactAnalysis | null>(null);
  /** Oxirgi o'qilgan fayl tuzilmasi (oy nomisiz fayl — bitta oy tanlanadi) */
  const [single, setSingle] = useState(false);
  const [fileMonths, setFileMonths] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  /** Ustama ish haqi vedomostiga yozilsinmi (Solishtirmada «Ish haqi») */
  const [withPayroll, setWithPayroll] = useState(true);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'error' } | null>(null);

  const analyze = async (f: File, y: number, months: number[]) => {
    setBusy(true);
    setError(null);
    setFile(f);
    try {
      const res = await analyzePlanFact(f, y, months);
      setA(res);
      setSingle(res.single);
      setFileMonths(res.fileMonths);
    } catch (e) {
      const msg = errorMessage(e);
      setA(null);
      setError(msg);
      // Oy nomisiz fayl: bitta oy tanlash kerak
      if (/qaysi oy ekanini tanlang/.test(msg)) {
        setSingle(true);
        setFileMonths([]);
      }
    } finally {
      setBusy(false);
    }
  };

  const changeMonths = (months: number[]) => {
    setSel(months);
    if (file && (!single || months.length === 1)) void analyze(file, year, months);
    else if (file) {
      setA(null);
      setError('Bu faylda oy nomi yo\'q — bitta oyni tanlang');
    }
  };

  const reset = () => {
    setA(null);
    setFile(null);
    setError(null);
    setSingle(false);
    setFileMonths([]);
  };

  const issues = useMemo(() => (a ? a.reconcile.filter((l) => l.status !== 'ok') : []), [a]);

  const save = async () => {
    if (!a || !file || !a.months.length) return;
    setSaving(true);
    try {
      const r = await commitPlanFact(file, a.year, a.single ? sel : sel.length ? sel : a.months.map((m) => Number(m.period.slice(5))), withPayroll);
      setToast({
        message: `Saqlandi: ${r.saved.map((s) => `${s.label} — ${s.employees} xodim${s.payrollTiyin ? `, ish haqi ${som(s.payrollTiyin)} so'm` : ''}`).join('; ')}${r.saved.some((s) => s.replaced) ? ' (oldingisi almashtirildi)' : ''}${a.skippedRows ? ` · ${a.skippedRows} qator olinmadi` : ''}`,
      });
      reset();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setSaving(false);
      setConfirm(false);
    }
  };

  const totalFact = a ? a.months.reduce((s, m) => s + BigInt(m.factTiyin), 0n) : 0n;
  const reconOk = a ? a.reconcile.filter((l) => l.status === 'ok').length : 0;
  const selLabel = sel.length === 0 ? 'fayldagi hamma oylar' : sel.map((m) => MONTHS[m - 1]).join(', ');
  const infoCount = a ? a.unknownDistricts.length + a.partialNames.length + a.nameMismatches.length + a.invalidPinfl.length + a.registryRegion.length + a.typeChanges.length : 0;
  const payrollMonths = a ? a.months.filter((m) => m.payroll.fromFile) : [];
  /** Saqlanadigan xodimlar (kamida bitta oy qiymati bor) */
  const savable = a ? a.rows.filter((r) => Object.keys(r.months).length > 0).length : 0;
  const needConfirm = issues.length > 0 || (a?.skippedRows ?? 0) > 0;
  const confirmMessage = a
    ? [
        a.skippedRows ? `${a.skippedRows} ta qator olinmaydi (reestrda yo'q, PINFL/F.I.Sh topilmadi, takror yoki xato summa). «Ha» bosilsa — ular tashlab o'tiladi, qolgan ${savable} xodim saqlanadi.` : '',
        issues.length ? `${issues.length} ta viloyat-oyda xodimlar tushumi yuklangan daromadga mos kelmaydi (daromadning o'zi o'zgarmaydi).` : '',
        'Saqlansinmi?',
      ]
        .filter(Boolean)
        .join(' ')
    : '';

  return (
    <>
      <PageHeader
        title="Xodimlar reja va tushumi"
        description={role === 'hududchi' ? "Daromadni xodimlarga bo'lib berish: har oy reja va haqiqatda bajarilgani" : "Yuklangan daromadni xodimlarga bo'lib berish — Solishtirma va ustama uchun"}
      />
      <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
        <SourceActions
          upload={{ label: 'Reja / tushum faylini yuklash', onClick: () => void openDropzone(), loading: busy, disabled: Boolean(file), hint: 'Avval pastda yil va oyni tanlang' }}
          template={{ label: "Bo'sh shablon", onClick: () => void downloadPlanFactTemplate(year, sel.length === 1 ? sel : []).catch((e) => setToast({ message: errorMessage(e), tone: 'error' })) }}
          deleteData={{
            target: 'RESULTS',
            scope: role === 'hududchi' ? { regional: true } : undefined,
            month: sel.length === 1 ? `${year}-${String(sel[0]).padStart(2, '0')}` : undefined,
            place: 'Xodimlar reja va tushumi',
            onDone: ({ count }) => setToast({ message: `${count} ta natija o'chirildi` }),
          }}
        />
        <Notice tone="info">
          Bu fayl <b>yangi daromad yaratmaydi</b> — ish haqi vedomosti kabi ishlaydi. Daromad Daromadlar bo&apos;limida (xizmatlar hisoboti) allaqachon bor; bu fayl uni
          xodimlarga bo&apos;lib beradi. Xodim <b>PINFL</b> bo&apos;yicha aniq topiladi (PINFL bo&apos;sh bo&apos;lsa — F.I.Sh bo&apos;yicha) va natijasi fayldagi viloyat/tumanga
          — Solishtirmaga tushadi. Har oy va viloyat bo&apos;yicha xodimlar tushumi yuklangan daromad bilan solishtiriladi.
        </Notice>

        <div className="space-y-3 rounded-(--radius-card) bg-white/60 p-4 shadow-card">
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-14 text-sm font-semibold text-heading">Yil:</span>
            <YearPicker
              value={year}
              onChange={(y) => {
                setYear(y);
                if (file && (!single || sel.length === 1)) void analyze(file, y, sel);
              }}
            />
          </div>
          <div className="flex flex-wrap items-start gap-3">
            <span className="mt-2 w-14 text-sm font-semibold text-heading">Oy:</span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <MonthChips value={sel} onChange={changeMonths} inFile={fileMonths} single={single} />
              <p className="text-xs text-(--color-text-muted)">
                {single
                  ? "Bir oylik fayl (ustunlarda oy nomi yo'q) — natija tanlangan oyga yoziladi. Boshqa oy tanlansa — shu oyga."
                  : 'Oy tanlansa — fayldan faqat shu oy(lar) olinadi. Faylda oy nomi bo\'lmasa — bitta oyni tanlang. Yashil nuqta — faylda bor oy.'}
              </p>
            </div>
          </div>
        </div>

        {!a && (
          <>
            {file && error ? (
              <Notice tone="warn">
                <div className="flex flex-wrap items-center gap-3">
                  <span>
                    <b>{file.name}</b>: {error}
                  </span>
                  <button type="button" onClick={reset} className="ml-auto text-xs font-semibold underline">
                    Boshqa fayl
                  </button>
                </div>
              </Notice>
            ) : (
              <>
                <Dropzone
                  busy={busy}
                  onFile={(f) => void analyze(f, year, sel)}
                  title={`Reja / tushum faylini tashlang — ${selLabel}`}
                  hint={
                    <>
                      Ustunlar: <b>Xodim F.I.Sh · JShShIR · Shtat · Hudud nomi · Oylik reja · Reja bajarilishi (tushum) · Foizda · Ustama miqdori</b> — yuqorida oyni tanlang.
                      «Ustama miqdori» — xodimning shu oy ish haqi (Solishtirmada «Ish haqi»). Eski shakl (bir nechta oy ustunli) ham o&apos;qiladi.
                    </>
                  }
                />
                {error && <Notice tone="bad">{error}</Notice>}
              </>
            )}
          </>
        )}

        {a && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat tone="ok" label={`${a.months.map((m) => m.label).join(', ')}`} value={som(totalFact.toString())} hint={`so'm tushum · ${a.months.length} oy`} />
              <Stat label="Xodimlar topildi" value={`${a.matchedRows} / ${a.totalRows}`} hint={a.hasPinfl ? "PINFL bo'yicha (bo'sh — F.I.Sh)" : "F.I.Sh bo'yicha"} tone={a.matchedRows < a.totalRows ? 'warn' : 'plain'} />
              <Stat label="Daromad bilan mos" value={`${reconOk} / ${a.reconcile.length}`} hint="viloyat × oy" tone={a.reconcileIssues ? 'warn' : 'plain'} />
              <Stat label="Olinmaydigan qatorlar" value={a.skippedRows} hint="reestrda yo'q, takror, xato katak" tone={a.skippedRows ? 'warn' : 'plain'} />
            </div>

            {a.notInFile.length > 0 && (
              <Notice tone="warn">
                Tanlangan, lekin faylda yo&apos;q oy(lar): <b>{a.notInFile.join(', ')}</b>. Faqat faylda bor oylar olinadi.
              </Notice>
            )}
            {!a.single && sel.length > 0 && a.fileMonths.some((m) => !sel.includes(m)) && (
              <Notice tone="info">
                <div className="flex flex-wrap items-center gap-3">
                  <span>
                    Faylda yana bor: {a.fileMonths.filter((m) => !sel.includes(m)).map((m) => MONTHS[m - 1]).join(', ')} — ular olinmaydi.
                  </span>
                  <button type="button" onClick={() => changeMonths([])} className="ml-auto text-xs font-semibold underline">
                    Hammasini olish
                  </button>
                </div>
              </Notice>
            )}

            {a.reconcileIssues > 0 ? (
              <Notice tone="warn">
                <b>{a.reconcileIssues} ta viloyat-oyda</b> xodimlar tushumi yuklangan daromadga mos kelmaydi (yoki shu oy daromadi hali yuklanmagan). Saqlash mumkin, lekin
                Solishtirmada viloyat daromadi va xodimlar yig&apos;indisi farq qiladi — daromad faylini yoki shu faylni tekshiring.
              </Notice>
            ) : (
              a.reconcile.length > 0 && <Notice tone="ok">Hamma viloyat-oylarda xodimlar tushumi yuklangan daromadga mos keladi.</Notice>
            )}

            <Section title="Daromad bilan solishtirish" hint="fayldagi tushum yig'indisi ↔ Daromadlar bo'limi (0,5% gacha farq — mos)" open>
              <ReconcileTable lines={a.reconcile} />
            </Section>

            {a.reconcileDistricts.length > 0 && (
              <Section title={`Tumanlar kesimida farqlar (${a.reconcileDistricts.length})`} hint="daromad tuman bo'yicha yuklangan viloyatlarda" open={false}>
                <ReconcileTable lines={a.reconcileDistricts} district />
              </Section>
            )}

            <Section title="Oylar" hint="saqlanadigan oylar">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
                      <th className="px-4 py-2.5">Oy</th>
                      <th className="px-3 py-2.5 text-right">Xodim</th>
                      <th className="px-3 py-2.5 text-right">Reja</th>
                      <th className="px-3 py-2.5 text-right">Tushum</th>
                      <th className="px-3 py-2.5 text-right">Bajarilish</th>
                      <th className="px-3 py-2.5 text-right">{payrollMonths.length ? 'Ustama (ish haqi)' : 'Ustama'}</th>
                      <th className="px-3 py-2.5 text-right">Avval saqlangan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-(--color-line)">
                    {a.months.map((m) => (
                      <tr key={m.period}>
                        <td className="px-4 py-2 font-semibold text-heading">{m.label}</td>
                        <td className="px-3 py-2 text-right">{m.employees}</td>
                        <td className="money px-3 py-2 text-right">{som(m.planTiyin)}</td>
                        <td className="money px-3 py-2 text-right font-bold">{som(m.factTiyin)}</td>
                        <td className={cn('px-3 py-2 text-right', (m.percent ?? 0) >= 100 ? 'text-emerald-700' : 'text-amber-700')}>{pct(m.percent)}</td>
                        <td className="money px-3 py-2 text-right">{som(m.bonusTiyin)}</td>
                        <td className="px-3 py-2 text-right text-xs text-(--color-text-muted)">{m.previousRows ? `${m.previousRows} xodim — almashtiriladi` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {payrollMonths.length > 0 && (
                <div className="space-y-2 border-t border-(--color-line) px-4 py-3 text-sm">
                  <label className="flex items-start gap-2">
                    <input type="checkbox" className="mt-0.5" checked={withPayroll} onChange={(e) => setWithPayroll(e.target.checked)} />
                    <span>
                      <b className="text-heading">«Ustama miqdori» — hudud xodimlarining ish haqi.</b> Hududlar ish haqi vedomostiga yoziladi va Solishtirmada «Ish haqi» bo&apos;lib
                      ko&apos;rinadi (bonus bo&apos;lib takrorlanmaydi). Shu oy hudud vedomostidagi boshqa xodimlar saqlanadi, shu fayldagilar almashtiriladi.
                    </span>
                  </label>
                  {withPayroll &&
                    payrollMonths.map((m) => (
                      <p key={m.period} className="pl-6 text-xs text-(--color-text-muted)">
                        {m.label}: {m.payroll.employees} xodim, <b className="text-heading">{som(m.payroll.totalTiyin)} so&apos;m</b>
                        {m.payroll.previousTiyin !== '0' && <> · avval yozilgani {som(m.payroll.previousTiyin)} so&apos;m — almashtiriladi</>}
                        {m.payroll.inGeneral > 0 && (
                          <span className="text-amber-700"> · {m.payroll.inGeneral} xodimning ish haqi umumiy vedomostda bor — ularniki qayta yozilmaydi</span>
                        )}
                      </p>
                    ))}
                </div>
              )}
              {a.emptyMonths.length > 0 && <p className="border-t border-(--color-line) px-4 py-2 text-xs text-(--color-text-muted)">Tushumi bo&apos;sh — saqlanmaydi: {a.emptyMonths.join(', ')}</p>}
            </Section>

            {a.skippedRows > 0 && (
              <Notice tone="warn">
                <b>{a.skippedRows} ta qator olinmaydi</b> — quyida sababi bilan. Saqlashda ogohlantiriladi: «Ha» bosilsa, ular tashlab o&apos;tiladi va qolgan {savable} xodim
                saqlanadi.
              </Notice>
            )}
            {a.missing.length > 0 && (
              <MissingPanel
                key={a.missing.map((m) => m.rowIndex).join(',')}
                items={a.missing}
                role={role}
                onAdded={(n) => {
                  setToast({ message: `${n} ta xodim Xodimlarga qo'shildi — fayl qayta tekshirildi` });
                  if (file) void analyze(file, year, sel);
                }}
              />
            )}
            {a.ambiguous.length > 0 && (
              <Notice tone="warn">
                {a.ambiguous.length > 0 && (
                  <div>
                    <b>Bir nechta xodimga mos ({a.ambiguous.length})</b> — PINFL yozing:
                    <NameList items={a.ambiguous.map((m) => `${m.fileName} (${m.rowIndex}-qator): ${m.candidates.join(' · ')}`)} />
                  </div>
                )}
              </Notice>
            )}
            {(a.unknownRegions.length > 0 || a.duplicates.length > 0 || a.invalidCells.length > 0) && (
              <Notice tone="bad">
                {a.unknownRegions.length > 0 && (
                  <div>
                    <b>Viloyat topilmadi ({a.unknownRegions.length})</b>:
                    <NameList items={a.unknownRegions.map((m) => `${m.fileName} — «${m.value}» (${m.rowIndex}-qator)`)} />
                  </div>
                )}
                {a.duplicates.length > 0 && (
                  <div className="mt-2">
                    <b>Takrorlangan xodim ({a.duplicates.length})</b> — birinchisi olinadi:
                    <NameList items={a.duplicates.map((m) => `${m.fileName}: ${m.rowIndex}-qator (birinchisi ${m.firstRow}-qatorda)`)} />
                  </div>
                )}
                {a.invalidCells.length > 0 && (
                  <div className="mt-2">
                    <b>Noto&apos;g&apos;ri summa ({a.invalidCells.length})</b> — shu oy olinmaydi:
                    <NameList items={a.invalidCells.map((m) => `${m.fileName}, ${m.month}: «${m.value}» (${m.rowIndex}-qator)`)} />
                  </div>
                )}
              </Notice>
            )}
            {infoCount > 0 && (
              <Section title="Ma'lumot uchun" hint={`${infoCount} ta izoh: PINFL, ism, viloyat, tuman`} open={false}>
                <div className="space-y-3 px-4 py-3 text-sm text-(--color-text-muted)">
                  {a.typeChanges.length > 0 && (
                    <div>
                      <b className="text-heading">Shtat turi reestrdagidan farq qiladi</b> — shu oy uchun fayldagisi olinadi:
                      <NameList items={a.typeChanges.map((m) => `${m.fileName}: ${m.from} → ${m.to}`)} />
                    </div>
                  )}
                  {a.nameMismatches.length > 0 && (
                    <div>
                      <b className="text-heading">PINFL bo&apos;yicha topildi, ism farq qiladi</b> — reestrdagi xodim olinadi:
                      <NameList items={a.nameMismatches.map((m) => `${m.pinfl}: «${m.fileName}» → ${m.registryName}`)} />
                    </div>
                  )}
                  {a.registryRegion.length > 0 && (
                    <div>
                      <b className="text-heading">Viloyat bo&apos;sh yoki tanilmadi</b> — reestrdagi viloyati olindi:
                      <NameList items={a.registryRegion.map((m) => `${m.fileName}: ${m.value ? `«${m.value}»` : 'bo\'sh'} → ${m.region}`)} />
                    </div>
                  )}
                  {a.invalidPinfl.length > 0 && (
                    <div>
                      <b className="text-heading">PINFL noto&apos;g&apos;ri (14 raqam emas)</b> — F.I.Sh bo&apos;yicha qidirildi:
                      <NameList items={a.invalidPinfl.map((m) => `${m.fileName}: «${m.value}» (${m.rowIndex}-qator)`)} />
                    </div>
                  )}
                  {a.unknownDistricts.length > 0 && (
                    <div>
                      <b className="text-heading">Tuman topilmadi</b> — xodimning reestrdagi tumani olinadi:
                      <NameList items={a.unknownDistricts.map((m) => `${m.fileName} — ${m.region} / «${m.value}»`)} />
                    </div>
                  )}
                  {a.partialNames.length > 0 && (
                    <div>
                      <b className="text-heading">Familiya va ism bo&apos;yicha topildi</b> — otasining ismi farq qiladi:
                      <NameList items={a.partialNames.map((m) => `${m.fileName} → ${m.registryName}`)} />
                    </div>
                  )}
                </div>
              </Section>
            )}

            <Section title="Viloyatlar" hint="tanlangan oylar bo'yicha" open={false}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
                      <th className="px-4 py-2.5">Viloyat</th>
                      <th className="px-3 py-2.5 text-right">Xodim</th>
                      <th className="px-3 py-2.5 text-right">Reja</th>
                      <th className="px-3 py-2.5 text-right">Tushum</th>
                      <th className="px-3 py-2.5 text-right">Bajarilish</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-(--color-line)">
                    {a.regions.map((r) => (
                      <tr key={r.regionCode}>
                        <td className="px-4 py-2 font-medium text-heading">{r.name}</td>
                        <td className="px-3 py-2 text-right">{r.employees}</td>
                        <td className="money px-3 py-2 text-right">{som(r.planTiyin)}</td>
                        <td className="money px-3 py-2 text-right font-bold">{som(r.factTiyin)}</td>
                        <td className="px-3 py-2 text-right">{pct(r.percent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-3 border-t border-(--color-line) bg-white/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
              <span className="text-sm text-(--color-text-muted)">
                {a.fileName} · {savable} xodim saqlanadi{a.skippedRows ? ` · ${a.skippedRows} qator olinmaydi` : ''} · {a.months.map((m) => m.label).join(', ')}
              </span>
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" onClick={reset}>
                  Bekor qilish
                </Button>
                <Button size="lg" onClick={() => (needConfirm ? setConfirm(true) : void save())} loading={saving || busy} disabled={!a.months.length || !a.rows.length} className="min-w-[200px]">
                  Saqlash — {a.months.length === 1 ? a.months[0]!.label : `${a.months.length} oy`}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        title={a?.skippedRows ? "Ba'zi qatorlar olinmaydi" : 'Daromad bilan farq bor'}
        message={confirmMessage}
        confirmLabel={a?.skippedRows ? 'Ha, ularsiz saqlash' : 'Ha, saqlash'}
        cancelLabel="Tekshiraman"
        loading={saving}
        onConfirm={() => void save()}
        onCancel={() => setConfirm(false)}
      />
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} duration={toast.tone === 'error' ? 6000 : 5000} />}
    </>
  );
}