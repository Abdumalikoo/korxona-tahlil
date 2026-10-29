'use client';

import { PageHeader } from '@/components/layout/page-header';
import { BarChart } from '@/components/shared/bar-chart';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { Dropzone, Notice, openDropzone, Stat, som } from '@/features/regional-desk/bits';
import { SourceActions } from '@/components/shared/source-actions';
import { errorMessage } from '@/lib/error-message';
import { formatCompact } from '@/lib/format';
import { referencesApi } from '@/features/shared/references';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { BriefNote, useBrief } from '@/lib/view-mode';
import { Mark } from '@/features/reactions/mark';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { centerIncomeApi, MODE_LABEL, OWNER_LABEL, type CenterMode, type CenterOwner, type CenterPreview, type CenterYear } from './center-api';

// ═══════════════════════════════════════════════════════════
// Markaz daromadlari (Buxgalteriya › Markaz daromadi, Daromadlar › Markaz tushumi, Tahlil › Markaz tushumi).
//   • Manba — «Kunlik tushum va qoldiq» ma'lumotnomasi: Buxgalter kiritadi yoki Excel yuklanadi.
//   • Oy daromadi faqat «Oy boshidan» ustunidan: oyning oxirgi ma'lumotnomasidagi qiymat − o'tgan oy oxiridagi qiymat
//     (yil ichida yig'ilib boradi; yanvar — o'zi). Qolgan ustunlar — hisobot uchun.
//   • «Markaz daromadi» va «Boshqa daromad» qatorlari — Daromadlarga Markaz daromadi bo'lib yoziladi
//     (Tahlil, Solishtirma, bosh sahifa). «Hududlar» — faqat hisobot uchun, tahlilga kirmaydi.
// ═══════════════════════════════════════════════════════════

const MODE_TONE: Record<CenterMode, string> = {
  DOIMIY: 'bg-emerald-50 text-emerald-700',
  BOSHQA: 'bg-sky-50 text-sky-700',
  REGION: 'bg-violet-50 text-violet-700',
  NONE: 'bg-slate-100 text-slate-500',
};
const MODES: CenterMode[] = ['DOIMIY', 'BOSHQA', 'REGION', 'NONE'];
const OWNERS: CenterOwner[] = ['CENTER', 'TAX_FREE', 'MARKSHEYDER', 'FERMER', 'BUXGALTERIYA', 'QOMITA'];
const SHORT = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'];
const dmy = (d: string | null) => (d ? d.split('-').reverse().join('.') : '—');

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

function Section({ title, hint, children, open: initial = true, right }: { title: ReactNode; hint?: ReactNode; children: ReactNode; open?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(initial);
  return (
    <div className="overflow-hidden rounded-(--radius-card) bg-white shadow-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-(--color-line) px-4 py-3">
        <button type="button" onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="font-semibold text-heading">{title}</span>
          {hint && <span className="text-xs text-(--color-text-muted)">{hint}</span>}
        </button>
        {right}
        <button type="button" onClick={() => setOpen(!open)} className="text-(--color-text-faint)" aria-label={open ? "Yig'ish" : 'Ochish'}>
          {open ? '▴' : '▾'}
        </button>
      </div>
      {open && children}
    </div>
  );
}

function ModePill({ mode }: { mode: CenterMode }) {
  return <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', MODE_TONE[mode])}>{MODE_LABEL[mode]}</span>;
}

/** Yuklangan fayl — saqlashdan oldin ko'rinishi */
function PreviewPanel({ p, saving, onSave, onCancel }: { p: CenterPreview; saving: boolean; onSave: () => void; onCancel: () => void }) {
  const groups = MODES.map((m) => ({ mode: m, lines: p.lines.filter((l) => l.mode === m) })).filter((g) => g.lines.length);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat tone="ok" label={`Markaz daromadi · ${p.label}`} value={som(p.markazTiyin)} hint={`so'm · ${dmy(p.date)} holatiga («Oy boshidan» − o'tgan oy)`} />
        <Stat label="Shundan doimiy" value={som(p.doimiyTiyin)} hint="Markaz daromadi qatorlari" />
        <Stat label="Boshqa daromad" value={som(p.boshqaTiyin)} hint="depozit va h.k." />
        <Stat label="Hududlardan tushgan" value={som(p.regionsTiyin)} hint="faqat hisobot uchun — tahlilga kirmaydi" />
      </div>
      {p.exists && <Notice tone="warn">{dmy(p.date)} kunining ma&apos;lumotnomasi allaqachon bor — fayldagisi bilan almashtiriladi.</Notice>}
      {p.gap && (
        <Notice tone="info">
          Oxirgi saqlangan kun — {dmy(p.gap.prevDate)}; oraliq kunlar kiritilmagan ({p.gap.accounts} ta hisobraqamda «Oy boshidan» farq qiladi). Fayldagi «Yil boshidan» va «Oy
          boshidan» olinadi (shu kun tayanch bo&apos;ladi).
        </Notice>
      )}
      {p.laterInMonth && (
        <Notice tone="warn">
          Shu oyda keyingi kun ({dmy(p.laterInMonth)}) ham bor — {p.label} daromadi o&apos;sha kundan olinadi. Bu fayl kunlik ma&apos;lumotnoma sifatida saqlanadi.
        </Notice>
      )}
      {(p.invalid?.length ?? 0) > 0 && (
        <Notice tone="warn">
          Son sifatida o&apos;qilmagan kataklar ({p.invalid!.length}) — hisobga olinmaydi, faylda tuzating: <b>{p.invalid!.join('; ')}</b>
        </Notice>
      )}
      {p.unmatched.length > 0 && (
        <Notice tone="warn">
          Tanilmagan qatorlar ({p.unmatched.length}) — olinmaydi: <b>{p.unmatched.join(', ')}</b>. Kerak bo&apos;lsa, Buxgalteriya › Hisobraqamlar bo&apos;limida qo&apos;shing.
        </Notice>
      )}
      <div className="overflow-hidden rounded-(--radius-card) bg-white shadow-card">
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
                <th className="px-4 py-2">Hisobraqam</th>
                <th className="px-3 py-2">Turi</th>
                <th className="px-3 py-2 text-right">Oy daromadi («Oy boshidan» farqi), so&apos;m</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--color-line)">
              {groups.map((g) =>
                g.lines.map((l) => (
                  <tr key={l.id} className={g.mode === 'NONE' ? 'text-(--color-text-muted)' : ''}>
                    <td className="px-4 py-2">
                      {l.code && <span className="mr-1.5 text-(--color-text-faint)">{l.code}</span>}
                      {l.name}
                    </td>
                    <td className="px-3 py-2">
                      <ModePill mode={l.mode} />
                    </td>
                    <td className="money px-3 py-2 text-right font-semibold">{som(l.amountTiyin)}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-3 border-t border-(--color-line) bg-white/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <span className="text-sm text-(--color-text-muted)">
          {dmy(p.date)} · {p.matched} ta hisobraqam · {p.label} Markaz daromadi {som(p.markazTiyin)} so&apos;m
        </span>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Bekor qilish
          </Button>
          <Button size="lg" onClick={onSave} loading={saving} className="min-w-[200px]">
            Saqlash — {p.label}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CenterIncomePage({ mode }: { mode: 'manage' | 'analysis' }) {
  const manage = mode === 'manage';
  /** Tahlil › Markaz tushumi, qisqa rejim: faqat asosiy raqamlar va oylar (grafik, hisobraqamlar — To'liq rejimda) */
  const brief = useBrief() && !manage;
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<CenterYear | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CenterPreview | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileDate, setFileDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [edits, setEdits] = useState<Record<string, CenterMode>>({});
  /** Qator egasi o'zgarishlari (Markaz ↔ yo'nalish) */
  const [ownerEdits, setOwnerEdits] = useState<Record<string, CenterOwner>>({});
  /** Markaz qatori bo'limi o'zgarishlari ('' — «Markaz › Umumiy») */
  const [depEdits, setDepEdits] = useState<Record<string, string>>({});
  /** Qator → Qo'mita moddasi o'zgarishlari ('' — bog'lanmagan) */
  const [qomitaEdits, setQomitaEdits] = useState<Record<string, string>>({});
  const departments = useAsync(() => referencesApi.departments().then((r) => r.data.filter((d) => d.isActive)), []);
  const [askModes, setAskModes] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'error' } | null>(null);

  const load = useCallback(async (y: number) => {
    setLoading(true);
    setError(null);
    try {
      setData(await centerIncomeApi.year(y));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load(year);
  }, [year, load]);

  const read = async (f: File, date?: string) => {
    setBusy(true);
    setFile(f);
    setFileError(null);
    try {
      setPreview(await centerIncomeApi.preview(f, date));
    } catch (e) {
      setPreview(null);
      setFileError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    setFile(null);
    setPreview(null);
    setFileError(null);
    setFileDate('');
  };
  const save = async () => {
    if (!file || !preview) return;
    setSaving(true);
    try {
      const r = await centerIncomeApi.upload(file, fileDate || undefined);
      setToast({ message: `Saqlandi: ${dmy(r.date)} — ${r.label} Markaz daromadi ${som(r.markazTiyin)} so'm (Daromadlarga yozildi)` });
      cancel();
      if (r.year.year === year) setData(r.year);
      else setYear(r.year.year);
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };
  const resync = async (period?: string) => {
    setBusy(true);
    try {
      setData(await centerIncomeApi.sync(year, period));
      setToast({ message: period ? 'Shu oy Daromadlarga qayta yozildi' : 'Hamma oylar Daromadlarga qayta yozildi' });
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const saveModes = async () => {
    setSaving(true);
    try {
      setData(await centerIncomeApi.setModes(year, edits, ownerEdits, Object.fromEntries(Object.entries(depEdits).map(([k, v]) => [k, v || null])), qomitaEdits));
      setEdits({});
      setOwnerEdits({});
      setDepEdits({});
      setQomitaEdits({});
      setToast({ message: "Qator turlari, egalari va bo'limlari saqlandi — oylar Daromadlarga qayta yozildi" });
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setSaving(false);
      setAskModes(false);
    }
  };

  const months = useMemo(() => data?.months ?? [], [data]);
  const filled = months.filter((m) => m.reportDate);
  const chart = months.map((m) => ({ period: m.period, amountTiyin: m.reportDate ? m.markazTiyin : '0' }));
  const outOfSync = months.filter((m) => m.reportDate && !m.inSync).length + months.filter((m) => !m.reportDate && m.syncedTiyin !== '0').length;
  const doubled = months.filter((m) => m.otherCenterTiyin !== '0');
  const editCount = Object.keys(edits).length + Object.keys(ownerEdits).length + Object.keys(depEdits).length + Object.keys(qomitaEdits).length;
  const qomitaLabel = new Map((data?.qomitaCodes ?? []).map((c) => [c.code, c.label.replace(/^Qo'mita ajratmasi:\s*/, '')]));
  const qomitaMonths = months.filter((m) => (m.qomita ?? []).length > 0);
  const depName = new Map((departments.data ?? []).map((d) => [d.id, d.name]));

  return (
    <>
      <PageHeader
        title={manage ? 'Markaz daromadlari' : 'Markaz tushumi tahlili'}
        description="Kunlik ma'lumotnomadan oylik daromad"
      />
      <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
        {manage && (
          <SourceActions
            upload={{ label: 'Ma’lumotnomani yuklash', onClick: () => void openDropzone(), loading: busy && Boolean(file), disabled: Boolean(file) || Boolean(preview), hint: 'Kunlik tushum va qoldiq fayli (Excel)' }}
            template={{ label: "Bo'sh shablon", onClick: () => void centerIncomeApi.template().catch((e) => setToast({ message: errorMessage(e), tone: 'error' })) }}
            extra={
              <Button variant="secondary" size="sm" onClick={() => void resync()} loading={busy && !file} title="Hamma oylarning Markaz daromadi ma'lumotnomadan Daromadlarga qayta yoziladi">
                Daromadlarga qayta yozish
              </Button>
            }
            deleteData={{
              target: 'CASHBOOK',
              place: 'Daromadlar › Markaz tushumi',
              onDone: ({ count }) => {
                setToast({ message: `${count} kunlik ma'lumotnoma o'chirildi — Markaz daromadi qayta hisoblandi` });
                void load(year);
              },
            }}
          />
        )}
        <BriefNote shows="Markaz daromadi yil bo'yicha va oylar" hidden="oylik grafik, hisobraqamlar bo'yicha jadval, doimiy/boshqa bo'linishi" />
        {!brief && (
        <Notice tone="info">
          Oy daromadi faqat <b>«Oy boshidan»</b> ustunidan: oyning <b>oxirgi</b> ma&apos;lumotnomasidagi qiymat <b>minus o&apos;tgan oy</b> oxiridagi qiymat (yil ichida yig&apos;ilib
          boradi — masalan EHF yanvarda 2 mlrd, fevralda 3,5 mlrd bo&apos;lsa, fevral daromadi 1,5 mlrd; yanvar — o&apos;zi). «Kunlik tushum», «Yil boshidan», qaytarilgan va qoldiq —
          faqat hisobot uchun. «Markaz daromadi» va «Boshqa daromad» qatorlari Daromadlarga
          Markaz daromadi bo&apos;lib yoziladi va <b>Tahlil, Solishtirma</b>da ko&apos;rinadi. <b>Hududiy bo&apos;limlardan tushgan</b> mablag&apos; — faqat hisobot uchun (tahlilga Hududlar
          tushumidan kiradi, ikki marta sanalmaydi). Qaytarilgan, noto&apos;g&apos;ri tushgan va fuqarolarga to&apos;lanadigan pul — daromad emas.
        </Notice>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <YearPicker value={year} onChange={(y) => setYear(y)} />
          {data?.latestDate && <span className="text-sm text-(--color-text-muted)">Oxirgi ma&apos;lumotnoma: <b className="text-heading">{dmy(data.latestDate)}</b></span>}
        </div>

        {manage && !preview && (
          <>
            {file && fileError ? (
              <Notice tone="warn">
                <div className="flex flex-wrap items-center gap-3">
                  <span>
                    <b>{file.name}</b>: {fileError}
                  </span>
                  {/sana/i.test(fileError) && (
                    <span className="flex items-center gap-2">
                      <input type="date" value={fileDate} onChange={(e) => setFileDate(e.target.value)} className="rounded-lg border border-(--color-line) px-2 py-1 text-sm" aria-label="Sana" />
                      <Button size="sm" disabled={!fileDate} onClick={() => void read(file, fileDate)}>
                        O&apos;qish
                      </Button>
                    </span>
                  )}
                  <button type="button" onClick={cancel} className="ml-auto text-xs font-semibold underline">
                    Boshqa fayl
                  </button>
                </div>
              </Notice>
            ) : (
              <Dropzone
                busy={busy}
                onFile={(f) => void read(f)}
                title="Kunlik tushum va qoldiq faylini tashlang"
                hint={
                  <>
                    «Hisobraqamlar bo&apos;yicha kunlik tushum hamda qoldiq mablag&apos;lar to&apos;g&apos;risida ma&apos;lumot» shakli (ming so&apos;mda). Sana «… holatiga qoldiq» ustunidan
                    olinadi. Fayl shu kunning ma&apos;lumotnomasi bo&apos;lib saqlanadi va oy daromadi yangilanadi.
                  </>
                }
              />
            )}
          </>
        )}

        {manage && preview && <PreviewPanel p={preview} saving={saving} onSave={() => void save()} onCancel={cancel} />}

        {loading && !data ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load(year)} />
        ) : data && !preview ? (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat tone="ok" label={`Markaz daromadi · ${year}`} value={som(data.totals.markazTiyin)} hint={`so'm · ${filled.length} oy`} />
              {!brief && <Stat label="Shundan doimiy" value={som(data.totals.doimiyTiyin)} hint="Markaz hisobraqamlari" />}
              {!brief && <Stat label="Boshqa daromad" value={som(data.totals.boshqaTiyin)} hint="depozit va h.k." />}
              <Stat label="Hududlardan tushgan" value={som(data.totals.regionsTiyin)} hint="faqat hisobot uchun" tone="plain" />
            </div>

            {outOfSync > 0 && (
              <Notice tone="warn">
                <div className="flex flex-wrap items-center gap-3">
                  <span>
                    {outOfSync} ta oyda Daromadlardagi Markaz yozuvlari ma&apos;lumotnomaga mos emas (qo&apos;lda o&apos;chirilgan yoki o&apos;zgartirilgan).
                  </span>
                  {manage && (
                    <button type="button" onClick={() => void resync()} className="ml-auto text-xs font-semibold underline">
                      Qayta yozish
                    </button>
                  )}
                </div>
              </Notice>
            )}
            {doubled.length > 0 && (
              <Notice tone="warn">
                Markazga boshqa yo&apos;l bilan (qo&apos;lda yoki boshqa fayldan) ham daromad yozilgan: {doubled.map((m) => `${m.label} — ${som(m.otherCenterTiyin)} so'm`).join('; ')}. Ikki
                marta sanalmaganini tekshiring (Daromadlar › Doimiy / Boshqa).
              </Notice>
            )}

            <Section title="Oylar bo'yicha Markaz daromadi" hint="so'm">
              {!brief && (
                <div className="px-4 pt-4">
                  <BarChart data={chart} color="var(--color-income)" height={200} />
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
                      <th className="px-4 py-2.5">Oy</th>
                      <th className="px-3 py-2.5">Oxirgi kun</th>
                      <th className="px-3 py-2.5 text-right">Markaz daromadi</th>
                      {!brief && <th className="px-3 py-2.5 text-right" title="Tax free, Marksheyder va boshqa yo'nalishlarga yozilgani (Kimniki ustunida tanlangan)">shundan yo&apos;nalishlarga</th>}
                      {!brief && <th className="px-3 py-2.5 text-right" title="Kassadagi Qo'mita qatorlari (1.11, 1.14, 1.15) — Qo'mita mablag'lari bilan bitta pul: Markaz daromadiga kirmaydi">Qo&apos;mita (kassa)</th>}
                      {!brief && <th className="px-3 py-2.5 text-right">Doimiy</th>}
                      {!brief && <th className="px-3 py-2.5 text-right">Boshqa</th>}
                      <th className="px-3 py-2.5 text-right">Hududlardan tushgan</th>
                      {!brief && <th className="px-3 py-2.5 text-right">Hududlar tushumi (Daromadlar)</th>}
                      {!brief && <th className="px-3 py-2.5 text-right">Daromadlarda</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-(--color-line)">
                    {months.map((m) => (
                      <tr key={m.period} className={m.reportDate ? '' : 'text-(--color-text-faint)'}>
                        <td className="px-4 py-2 font-semibold text-heading">{m.label}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-(--color-text-muted)">
                          {m.reportDate ? (
                            <>
                              {dmy(m.reportDate)} <span className="text-xs">({m.reports} kun)</span>
                            </>
                          ) : (
                            'kiritilmagan'
                          )}
                        </td>
                        <td className="money px-3 py-2 text-right font-bold">{m.reportDate ? som(m.markazTiyin) : '—'}</td>
                        {!brief && <td className="money px-3 py-2 text-right text-amber-800">{m.segmentsTiyin !== '0' ? som(m.segmentsTiyin) : '—'}</td>}
                        {!brief && <td className="money px-3 py-2 text-right text-sky-800">{m.qomitaKassaTiyin && m.qomitaKassaTiyin !== '0' ? som(m.qomitaKassaTiyin) : '—'}</td>}
                        {!brief && <td className="money px-3 py-2 text-right">{m.reportDate ? som(m.doimiyTiyin) : '—'}</td>}
                        {!brief && <td className="money px-3 py-2 text-right">{m.reportDate && m.boshqaTiyin !== '0' ? som(m.boshqaTiyin) : '—'}</td>}
                        <td className="money px-3 py-2 text-right text-violet-700">{m.reportDate ? som(m.regionsTiyin) : '—'}</td>
                        {!brief && <td className="money px-3 py-2 text-right text-(--color-text-muted)">{m.regionIncomeTiyin !== '0' ? som(m.regionIncomeTiyin) : '—'}</td>}
                        {!brief && <td className="px-3 py-2 text-right text-xs">
                          {!m.reportDate && m.syncedTiyin === '0' ? (
                            '—'
                          ) : m.inSync && m.reportDate ? (
                            <span className="font-semibold text-emerald-700">✓ yozilgan</span>
                          ) : manage ? (
                            <button type="button" onClick={() => void resync(m.period)} className="font-semibold text-amber-700 underline">
                              Mos emas — qayta yozish
                            </button>
                          ) : (
                            <span className="font-semibold text-amber-700">mos emas</span>
                          )}
                        </td>}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-(--color-line) bg-slate-50 font-bold">
                      <td className="px-4 py-2.5" colSpan={2}>
                        Jami {year}
                      </td>
                      <td className="money px-3 py-2.5 text-right">{som(data.totals.markazTiyin)}</td>
                      {!brief && <td className="money px-3 py-2.5 text-right text-amber-800">{som(months.reduce((x, m) => x + BigInt(m.segmentsTiyin ?? '0'), 0n).toString())}</td>}
                      {!brief && <td className="money px-3 py-2.5 text-right text-sky-800">{som(months.reduce((x, m) => x + BigInt(m.qomitaKassaTiyin ?? '0'), 0n).toString())}</td>}
                      {!brief && <td className="money px-3 py-2.5 text-right">{som(data.totals.doimiyTiyin)}</td>}
                      {!brief && <td className="money px-3 py-2.5 text-right">{som(data.totals.boshqaTiyin)}</td>}
                      <td className="money px-3 py-2.5 text-right text-violet-700">{som(data.totals.regionsTiyin)}</td>
                      {!brief && <td className="money px-3 py-2.5 text-right text-(--color-text-muted)">{som(months.reduce((s, m) => s + BigInt(m.regionIncomeTiyin), 0n).toString())}</td>}
                      {!brief && <td className="money px-3 py-2.5 text-right text-xs">{som(data.totals.syncedTiyin)}</td>}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Section>

            {!brief && qomitaMonths.length > 0 && (
              <Section title="Qo'mita pullari: kassa ↔ Qo'mita mablag'lari" hint="bitta pul — daromadga bir marta, kassa summasi bo'yicha">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
                        <th className="px-4 py-2.5">Oy</th>
                        <th className="px-3 py-2.5">Qo&apos;mita moddasi</th>
                        <th className="px-3 py-2.5 text-right">Kassada</th>
                        <th className="px-3 py-2.5 text-right">Qo&apos;mita mablag&apos;larida</th>
                        <th className="px-3 py-2.5 text-right">Farq</th>
                        <th className="px-3 py-2.5 text-right">Daromadga kassadan qo&apos;shildi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-(--color-line)">
                      {qomitaMonths.flatMap((m) =>
                        m.qomita.map((q, i) => {
                          const diff = BigInt(q.diffTiyin);
                          const big = diff > 100_000n || diff < -100_000n;
                          return (
                            <tr key={`${m.period}-${q.code}`}>
                              <td className="px-4 py-2 font-semibold text-heading">{i === 0 ? m.label : ''}</td>
                              <td className="px-3 py-2">{qomitaLabel.get(q.code) ?? q.label}</td>
                              <td className="money px-3 py-2 text-right">{q.kassaTiyin !== '0' ? som(q.kassaTiyin) : '—'}</td>
                              <td className="money px-3 py-2 text-right">{q.qomitaTiyin !== '0' ? som(q.qomitaTiyin) : '—'}</td>
                              <td className={cn('money px-3 py-2 text-right', !big ? 'text-emerald-700' : diff > 0n ? 'text-amber-700' : 'text-(--color-expense)')}>
                                {!big ? 'teng' : `${diff > 0n ? '+' : '−'}${som((diff > 0n ? diff : -diff).toString())}`}
                              </td>
                              <td className="money px-3 py-2 text-right font-semibold">{q.extraTiyin !== '0' ? som(q.extraTiyin) : '—'}</td>
                            </tr>
                          );
                        }),
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="border-t border-(--color-line) px-4 py-2.5 text-xs text-(--color-text-muted)">
                  Kassadagi Qo&apos;mita qatorlari (1.11 — 3802, Call markaz; 1.14 va 1.15 — Marksheyder) Qo&apos;mita mablag&apos;lari sahifasidagi yozuvlar bilan bitta pul: daromadga
                  bir marta kiradi. Daromad — kassa summasi; Qo&apos;mita yozuvlari uni bo&apos;limlarga taqsimlaydi. Kassa ko&apos;p bo&apos;lsa — farq «Qo&apos;mita faylida ko&apos;rsatilmagan» qatori
                  bo&apos;lib shu Qo&apos;mita moddasiga yoziladi; Qo&apos;mita yozuvlari ko&apos;p bo&apos;lsa (qizil) — ular qoladi, kassani tekshiring. 1 000 so&apos;mgacha farq — yaxlitlash (teng).
                </p>
              </Section>
            )}

            {!brief && (
            <Section
              title="Hisobraqamlar bo'yicha"
              hint={manage ? "har qatorning turi (Markaz daromadi, Boshqa, Hududlar, Daromad emas) va kimniki — Markaz yoki yo'nalish (Tax free, Marksheyder …)" : "oy daromadi, so'm (qisqa)"}
              open={manage}
              right={
                manage && editCount > 0 ? (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEdits({});
                        setOwnerEdits({});
                        setDepEdits({});
                        setQomitaEdits({});
                      }}
                    >
                      Bekor
                    </Button>
                    <Button size="sm" onClick={() => setAskModes(true)}>
                      Saqlash ({editCount})
                    </Button>
                  </div>
                ) : null
              }
            >
              <div className="max-h-[640px] overflow-auto">
                <table className="w-full min-w-[1280px] text-[13px]">
                  <thead className="sticky top-0 z-10 bg-slate-50">
                    <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
                      <th className="sticky left-0 z-10 min-w-[300px] bg-slate-50 px-4 py-2">Hisobraqam</th>
                      <th className="px-2 py-2">Turi</th>
                      <th className="px-2 py-2" title="Daromad kimniki: Markaz yoki yo'nalish (Tax free, Marksheyder …) — yo'nalish daromadi o'z xarajatlari bilan Solishtirmada birga ko'rinadi">
                        Kimniki
                      </th>
                      {SHORT.map((s) => (
                        <th key={s} className="px-2 py-2 text-right">
                          {s}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right">Jami</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-(--color-line)">
                    {data.rows.map((r) => {
                      const m = r.mode ? (edits[r.id] ?? r.mode) : null;
                      const o = r.owner ? (ownerEdits[r.id] ?? r.owner) : null;
                      const q = r.mode ? (r.id in qomitaEdits ? qomitaEdits[r.id]! : (r.qomitaCode ?? '')) : '';
                      const income = (m === 'DOIMIY' || m === 'BOSHQA') && !q;
                      const head = r.mode === null;
                      return (
                        <tr key={r.id} className={cn(head ? 'bg-amber-50/50 font-semibold' : '', m === 'NONE' ? 'text-(--color-text-faint)' : '')}>
                          <td className={cn('sticky left-0 z-[1] px-4 py-1.5', head ? 'bg-amber-50' : 'bg-white')} style={{ paddingLeft: 16 + Math.max(0, r.level) * 14 }}>
                            {(r.mode === 'DOIMIY' || r.mode === 'BOSHQA') && (
                              <Mark
                                className="mr-1.5 align-middle"
                                item={{ kind: 'INCOME', label: `${o && o !== 'CENTER' ? OWNER_LABEL[o] : 'Markaz'} tushumi: ${r.name}`, filter: { unit: o && o !== 'CENTER' ? `s:${o}` : 'center', categoryCode: `KASSA-${r.key}`.slice(0, 60) }, origin: 'Markaz tushumi' }}
                              />
                            )}
                            {r.code && <span className="mr-1.5 text-(--color-text-faint)">{r.code}</span>}
                            {r.name}
                          </td>
                          <td className="px-2 py-1.5">
                            {m &&
                              (manage ? (
                                <select
                                  value={m}
                                  onChange={(e) => {
                                    const v = e.target.value as CenterMode;
                                    setEdits((x) => {
                                      const n = { ...x };
                                      if (v === r.mode) delete n[r.id];
                                      else n[r.id] = v;
                                      return n;
                                    });
                                  }}
                                  className={cn('rounded-lg border-0 px-2 py-1 text-[11px] font-semibold', MODE_TONE[m], edits[r.id] && 'ring-2 ring-brand-400')}
                                  aria-label={`${r.name} turi`}
                                >
                                  {MODES.map((x) => (
                                    <option key={x} value={x}>
                                      {MODE_LABEL[x]}
                                      {x === r.defaultMode ? ' (odatiy)' : ''}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <ModePill mode={m} />
                              ))}
                          </td>
                          <td className="px-2 py-1.5">
                            {/* Qo'mita qatori: Qo'mita mablag'lari bilan bitta pul (daromad — Qo'mita moddasi bo'yicha, bir marta) */}
                            {r.mode &&
                              (data.qomitaCodes ?? []).length > 0 &&
                              (manage ? (
                                <select
                                  value={q}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setQomitaEdits((x) => {
                                      const n = { ...x };
                                      if (v === (r.qomitaCode ?? '')) delete n[r.id];
                                      else n[r.id] = v;
                                      return n;
                                    });
                                  }}
                                  className={cn('mb-1 block max-w-52 rounded-lg border-0 px-2 py-1 text-[11px]', q ? 'bg-sky-50 font-semibold text-sky-800' : 'bg-transparent text-(--color-text-faint)', r.id in qomitaEdits && 'ring-2 ring-brand-400')}
                                  aria-label={`${r.name} — Qo'mita moddasi`}
                                  title="Shu qator puli Qo'mita mablag'lari bilan bitta pulmi (ikki marta sanalmasin)"
                                >
                                  <option value="">Qo&apos;mitaga bog&apos;lanmagan</option>
                                  {(data.qomitaCodes ?? []).map((c) => (
                                    <option key={c.code} value={c.code}>
                                      Qo&apos;mita: {qomitaLabel.get(c.code) ?? c.label}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                q && <span className="mb-1 inline-block whitespace-nowrap rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800">Qo&apos;mita: {qomitaLabel.get(q) ?? q}</span>
                              ))}
                            {o &&
                              income &&
                              (manage ? (
                                <select
                                  value={o}
                                  onChange={(e) => {
                                    const v = e.target.value as CenterOwner;
                                    setOwnerEdits((x) => {
                                      const n = { ...x };
                                      if (v === r.owner) delete n[r.id];
                                      else n[r.id] = v;
                                      return n;
                                    });
                                  }}
                                  className={cn(
                                    'rounded-lg border-0 px-2 py-1 text-[11px] font-semibold',
                                    o === 'CENTER' ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-800',
                                    ownerEdits[r.id] && 'ring-2 ring-brand-400',
                                  )}
                                  aria-label={`${r.name} kimniki`}
                                >
                                  {OWNERS.map((x) => (
                                    <option key={x} value={x}>
                                      {OWNER_LABEL[x]}
                                      {x === r.defaultOwner ? ' (odatiy)' : ''}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', o === 'CENTER' ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-800')}>
                                  {OWNER_LABEL[o]}
                                </span>
                              ))}
                            {/* Markaz qatori — qaysi Markaz bo'liminiki (daromad doim shu bo'limga yoziladi) */}
                            {o === 'CENTER' &&
                              income &&
                              (() => {
                                const dep = depEdits[r.id] ?? r.departmentId ?? '';
                                return manage ? (
                                  <select
                                    value={dep}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      setDepEdits((x) => {
                                        const n = { ...x };
                                        if (v === (r.departmentId ?? '')) delete n[r.id];
                                        else n[r.id] = v;
                                        return n;
                                      });
                                    }}
                                    className={cn('mt-1 block max-w-48 rounded-lg border-0 bg-slate-50 px-2 py-1 text-[11px]', depEdits[r.id] !== undefined && 'ring-2 ring-brand-400')}
                                    aria-label={`${r.name} — Markaz bo'limi`}
                                  >
                                    <option value="">Umumiy (bo&apos;limsiz)</option>
                                    {(departments.data ?? []).map((d) => (
                                      <option key={d.id} value={d.id}>
                                        {d.name}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  dep && <span className="mt-1 block text-[11px] text-(--color-text-muted)">› {depName.get(dep) ?? "bo'lim"}</span>
                                );
                              })()}
                          </td>
                          {months.map((mo) => {
                            const v = r.months[mo.period];
                            return (
                              <td key={mo.period} className="money whitespace-nowrap px-2 py-1.5 text-right" title={v ? som(v) : undefined}>
                                {v && v !== '0' ? formatCompact(v) : '—'}
                              </td>
                            );
                          })}
                          <td className="money whitespace-nowrap px-3 py-1.5 text-right font-semibold" title={som(r.totalTiyin)}>
                            {r.totalTiyin !== '0' ? formatCompact(r.totalTiyin) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
            )}
          </>
        ) : null}
      </div>
      <ConfirmDialog
        open={askModes}
        title="Qator turlarini saqlash"
        message={`${editCount} ta o'zgarish (hisobraqam turi yoki kimniki). Hamma oylarning daromadi Daromadlarga qayta yoziladi: Markaz yoki tanlangan yo'nalish nomiga. Davom etilsinmi?`}
        confirmLabel="Ha, saqlash"
        loading={saving}
        onConfirm={() => void saveModes()}
        onCancel={() => setAskModes(false)}
      />
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} duration={toast.tone === 'error' ? 6000 : 5000} />}
    </>
  );
}