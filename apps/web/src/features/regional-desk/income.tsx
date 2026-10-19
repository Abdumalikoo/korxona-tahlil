'use client';

import { PageHeader } from '@/components/layout/page-header';
import { DeleteDataButton } from '@/components/shared/delete-data';
import { Button } from '@/components/ui/button';
import { Toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/error-message';
import { todayInput } from '@/lib/format';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useState } from 'react';
import { analyzeIncomeFile, dmy, downloadIncomeTemplate, monthLabel, rdApi, type RdIncomeAnalysis } from './api';
import { Dropzone, MonthPicker, Notice, Stat, som } from './bits';

// ═══════════════════════════════════════════════════════════
// Hududchi › Daromad yuklash: «Xizmatlar bo'yicha hisobot» (service_report) shabloni.
//  1) Faylni tashlang → o'qiladi (saqlanmaydi): oralig'i, viloyatlar, xizmatlar;
//  2) Yil boshidan hisobot bo'lsa — shu oyga faqat farq yoziladi (fayl − oldingi oylar);
//  3) Tekshirib «Saqlash» — shu oyning hududiy daromadi yangilanadi (qayta yuklash — almashtiradi).
// ═══════════════════════════════════════════════════════════

export function RegionalIncomeUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [a, setA] = useState<RdIncomeAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needPeriod, setNeedPeriod] = useState(false);
  const [period, setPeriod] = useState(todayInput().slice(0, 7));
  const [saved, setSaved] = useState<{ period: string; total: string; created: number } | null>(null);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'error' } | null>(null);
  const [showNeg, setShowNeg] = useState(false);

  const analyze = async (f: File, p?: string) => {
    setFile(f);
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const res = await analyzeIncomeFile(f, p);
      setA(res);
      setNeedPeriod(false);
    } catch (e) {
      const msg = errorMessage(e);
      setA(null);
      if (/oyni tanlang/i.test(msg)) setNeedPeriod(true);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const addServices = async () => {
    if (!a || !file) return;
    setBusy(true);
    try {
      const r = await rdApi.createServices(a.newServices);
      setToast({ message: `${r.data.created.length} ta xizmat turi qo'shildi` });
      await analyze(file, needPeriod ? period : undefined);
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
      setBusy(false);
    }
  };

  const save = async () => {
    if (!a) return;
    setSaving(true);
    try {
      const r = await rdApi.commitIncome(a.period, a.rows, a.fileName);
      setSaved({ period: a.period, total: r.data.totalTiyin, created: r.data.created });
      setA(null);
      setFile(null);
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const maxFile = a ? Math.max(1, ...a.regions.map((r) => Number(r.monthTiyin))) : 1;

  return (
    <>
      <PageHeader
        title="Daromad yuklash"
        description="«Xizmatlar bo'yicha hisobot» (service_report) — viloyatlar ustunlarda, xizmatlar qatorlarda (Soni / Summasi)"
        actions={
          <>
            <Button variant="secondary" onClick={() => void downloadIncomeTemplate(period).catch((e) => setToast({ message: errorMessage(e), tone: 'error' }))}>
              Bo&apos;sh shablon ({monthLabel(period)})
            </Button>
            <DeleteDataButton target="INCOME" scope={{ regional: true }} month={period} place="Hududlar daromadi" onDone={({ count }) => setToast({ message: `${count} ta daromad yozuvi savatga tushdi` })} />
          </>
        }
      />
      <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
        {saved && (
          <Notice tone="ok">
            <b>{monthLabel(saved.period)}</b> hududlar daromadi saqlandi: {saved.created} ta yozuv, <b className="money">{som(saved.total)}</b> so&apos;m.{' '}
            <Link href="/hudud/ish-stoli" className="font-semibold underline">
              Ish stoliga
            </Link>
          </Notice>
        )}

        {!a && (
          <>
            <Dropzone
              busy={busy}
              onFile={(f) => void analyze(f, needPeriod ? period : undefined)}
              title="Hisobot faylini shu yerga tashlang yoki tanlang"
              hint={
                <>
                  Manba tizimdan yuklab olingan <b>service_report_…xlsx</b> fayl — o&apos;zgartirmasdan. Bir oylik (01.09–30.09) yoki yil boshidan (01.01–bugun) bo&apos;lishi mumkin.
                </>
              }
            />
            {needPeriod && (
              <div className="flex flex-wrap items-center gap-3 rounded-(--radius-card) bg-white p-4 shadow-card">
                <span className="text-sm font-semibold text-heading">Faylda sana topilmadi — qaysi oy uchun?</span>
                <MonthPicker value={period} onChange={setPeriod} max={todayInput().slice(0, 7)} />
                {file && (
                  <Button onClick={() => void analyze(file, period)} loading={busy}>
                    Shu oy uchun o&apos;qish
                  </Button>
                )}
              </div>
            )}
            {error && <Notice tone="bad">{error}</Notice>}
            <div className="flex flex-wrap items-center gap-3 rounded-(--radius-card) bg-white p-4 shadow-card">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-heading">Shablon kerakmi?</p>
                <p className="text-sm text-(--color-text-muted)">
                  Odatda manba tizimdan yuklab olingan hisobot o&apos;zgartirmasdan tashlanadi. Qo&apos;lda to&apos;ldirish uchun — shu tuzilmadagi bo&apos;sh shablon: viloyatlar ustunlarda, har xizmat uchun «Soni» va «Summasi».
                </p>
              </div>
              <MonthPicker value={period} onChange={setPeriod} max={todayInput().slice(0, 7)} />
              <Button onClick={() => void downloadIncomeTemplate(period).catch((e) => setToast({ message: errorMessage(e), tone: 'error' }))}>Yuklab olish</Button>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {[
                ['1', 'Faylni tashlang', "Hech narsa saqlanmaydi — avval ko'rib chiqasiz"],
                ['2', 'Tekshiring', "Oy, viloyatlar bo'yicha summa, yangi xizmatlar"],
                ['3', '«Saqlash»', "Shu oyning hududiy daromadi yangilanadi (qayta yuklash — almashtiradi)"],
              ].map(([n, t, h]) => (
                <div key={n} className="flex gap-3 rounded-(--radius-card) bg-white p-4 shadow-card">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">{n}</span>
                  <div>
                    <p className="font-semibold text-heading">{t}</p>
                    <p className="text-xs text-(--color-text-muted)">{h}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {a && (
          <>
            <div className="flex flex-wrap items-center gap-3 rounded-(--radius-card) bg-white p-4 shadow-card">
              <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-100 text-lg font-bold text-emerald-700">xls</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-heading">{a.fileName}</p>
                <p className="text-sm text-(--color-text-muted)">
                  {a.range ? `Hisobot: ${dmy(a.range.from)} — ${dmy(a.range.to)}` : 'Sana faylda yo‘q'} · {a.regions.length} ta viloyat · {a.rows.length} ta yozuv
                </p>
              </div>
              <Button variant="ghost" onClick={() => setA(null)}>
                Boshqa fayl
              </Button>
            </div>

            <Notice tone={a.mode === 'CUMULATIVE' ? 'info' : 'ok'}>
              {a.mode === 'CUMULATIVE' ? (
                <>
                  <b>Yil boshidan hisobot.</b> {monthLabel(a.period)} uchun faqat farq yoziladi: fayldagi summa − {a.previousMonths.length ? `${monthLabel(a.previousMonths[0]!)} … ${monthLabel(a.previousMonths[a.previousMonths.length - 1]!)}` : ''} oylarida saqlangani.
                </>
              ) : (
                <>
                  <b>Oylik hisobot</b> — to&apos;liq {monthLabel(a.period)} oyiga yoziladi.
                </>
              )}{' '}
              {a.existingCount > 0 && (
                <>
                  Shu oy uchun avval saqlangan <b className="money">{som(a.existingTiyin)}</b> so&apos;m ({a.existingCount} yozuv) <b>almashtiriladi</b>.
                </>
              )}
            </Notice>

            {a.blocked && (
              <Notice tone="bad">
                <b>Saqlab bo&apos;lmaydi:</b> quyidagi oylarning hududiy daromadi bazada yo&apos;q — {a.missingMonths.map(monthLabel).join(', ')}. Ular bo&apos;lmasa, yil boshidan summa butunlay{' '}
                {monthLabel(a.period)}ga yozilib, noto&apos;g&apos;ri chiqadi. Manba tizimdan har oy uchun alohida hisobot oling (masalan 01.09.2026 — 30.09.2026) va avval o&apos;shalarni yuklang.
              </Notice>
            )}

            {a.newServices.length > 0 && (
              <div className="rounded-(--radius-card) border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900">Faylda bazada yo&apos;q {a.newServices.length} ta xizmat turi bor — ular hozir hisobga olinmadi:</p>
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-amber-900">
                  {a.newServices.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
                <Button className="mt-3" size="sm" onClick={() => void addServices()} loading={busy}>
                  Xizmat turlari ro&apos;yxatiga qo&apos;shish va qayta o&apos;qish
                </Button>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Stat label={a.mode === 'CUMULATIVE' ? 'Fayldagi summa (yil boshidan)' : 'Fayldagi summa'} value={som(a.fileTiyin)} hint="so'm" />
              <Stat label="Oldingi oylarda saqlangan" value={a.mode === 'CUMULATIVE' ? som(a.beforeTiyin) : '—'} hint={a.mode === 'CUMULATIVE' ? "so'm — ayiriladi" : 'oylik hisobot'} />
              <Stat tone="brand" label={`${monthLabel(a.period)} — yoziladi`} value={som(a.monthTiyin)} hint="so'm" />
            </div>

            {a.negatives.length > 0 && (
              <Notice tone="warn">
                <b>{a.negatives.length} ta qatorda</b> fayldagi yil boshidan summa avval saqlanganlardan kam — farq manfiy, shuning uchun bu qatorlar yozilmaydi. Oldingi oylar to&apos;g&apos;ri
                yuklanganini tekshiring.{' '}
                <button type="button" className="font-semibold underline" onClick={() => setShowNeg((v) => !v)}>
                  {showNeg ? 'Yashirish' : "Ro'yxat"}
                </button>
                {showNeg && (
                  <ul className="mt-2 max-h-48 space-y-0.5 overflow-auto text-xs">
                    {a.negatives.slice(0, 200).map((n, i) => (
                      <li key={i}>
                        {n.regionName} — {n.categoryLabel}: fayl {som(n.fileTiyin)}, saqlangan {som(n.storedTiyin)}
                      </li>
                    ))}
                  </ul>
                )}
              </Notice>
            )}
            {(a.unknownPlaces.length > 0 || a.unknownHeaders.length > 0 || a.invalidCells.length > 0) && (
              <Notice tone="warn">
                {a.unknownHeaders.length > 0 && <p>Tanilmagan ustunlar: {a.unknownHeaders.slice(0, 10).join(', ')}</p>}
                {a.unknownPlaces.length > 0 && <p>Tanilmagan joylar: {a.unknownPlaces.slice(0, 10).map((p) => p.value).join(', ')}</p>}
                {a.invalidCells.length > 0 && <p>{a.invalidCells.length} ta katakda son emas — o&apos;tkazib yuborildi</p>}
              </Notice>
            )}

            <div className="overflow-hidden rounded-(--radius-card) bg-white shadow-card">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
                      <th className="px-4 py-2.5">Viloyat</th>
                      <th className="px-3 py-2.5 text-right">Fayldagi</th>
                      {a.mode === 'CUMULATIVE' && <th className="px-3 py-2.5 text-right">Oldingi oylar</th>}
                      <th className="px-3 py-2.5 text-right">{monthLabel(a.period)}</th>
                      <th className="px-3 py-2.5 text-right">Xizmatlar soni</th>
                      <th className="w-48 px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-(--color-line)">
                    {a.regions.map((r) => (
                      <tr key={r.regionCode} className="hover:bg-slate-50">
                        <td className="px-4 py-2 font-medium text-heading">{r.name}</td>
                        <td className="money px-3 py-2 text-right text-(--color-text-muted)">{som(r.fileTiyin)}</td>
                        {a.mode === 'CUMULATIVE' && <td className="money px-3 py-2 text-right text-(--color-text-muted)">{som(r.beforeTiyin)}</td>}
                        <td className="money px-3 py-2 text-right font-bold text-heading">{som(r.monthTiyin)}</td>
                        <td className="money px-3 py-2 text-right">{r.quantity.toLocaleString('ru-RU')}</td>
                        <td className="px-3 py-2">
                          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-brand-500" style={{ width: `${(Number(r.monthTiyin) / maxFile) * 100}%` }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-brand-50 font-bold text-heading">
                      <td className="px-4 py-2.5">Jami</td>
                      <td className="money px-3 py-2.5 text-right">{som(a.fileTiyin)}</td>
                      {a.mode === 'CUMULATIVE' && <td className="money px-3 py-2.5 text-right">{som(a.beforeTiyin)}</td>}
                      <td className="money px-3 py-2.5 text-right">{som(a.monthTiyin)}</td>
                      <td className="money px-3 py-2.5 text-right">{a.regions.reduce((s, r) => s + r.quantity, 0).toLocaleString('ru-RU')}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-3 border-t border-(--color-line) bg-white/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
              <span className={cn('text-sm', a.blocked ? 'font-semibold text-(--color-expense)' : 'text-(--color-text-muted)')}>
                {a.blocked ? 'Oldingi oylar yetishmaydi — saqlab bo‘lmaydi' : `${monthLabel(a.period)}: ${a.rows.length} ta yozuv, ${som(a.monthTiyin)} so'm`}
              </span>
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" onClick={() => setA(null)}>
                  Bekor qilish
                </Button>
                <Button size="lg" onClick={() => void save()} loading={saving} disabled={a.blocked || a.rows.length === 0} className="min-w-[200px]">
                  Saqlash — {monthLabel(a.period)}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} duration={toast.tone === 'error' ? 6000 : 3000} />}
    </>
  );
}