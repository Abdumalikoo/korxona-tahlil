'use client';

import { SourceActions } from '@/components/shared/source-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconAlert, IconSearch, IconSpinner, IconUpload } from '@/components/ui/icons';
import { Money } from '@/components/ui/money';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { downloadAcc23106Template } from '@/features/acc-23106/api';
import { MonthRangeCard, useMonthRange } from '@/features/units/month-range';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatCompact, formatDateTime, formatPeriod, formatPeriodShort, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useRef, useState } from 'react';
import { GroupDrawer, PostsHistory, PreviewGroups } from './bank-analysis-parts';
import { PivotReport } from './pivot-report';
import { SourceProvider, useSource, type AnalysisSource } from './source';
import { PATTERN_LABEL, type BankPattern, type BankAnalysis, type BankBatch, type BankDir, type BankGroup, type BankKind, type BankSeries, type BankView } from './api';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › Bank ko'chirmasi — tahlil maydoni.
// Bankdan olingan ko'chirma (23106 shabloni shakli) yuklanadi → chiqim va kirim o'qiladi → o'xshash to'lovlar
// (oluvchi + izoh mazmuni) bitta guruh, oyma-oy va o'sib boruvchi; tanlangan davr bo'yicha umumiy; turlar
// (soliq, kommunal, aloqa …); guruhni bossangiz — har to'lov izohi bilan.
// XARAJAT VA DAROMADGA YOZILMAYDI (faqat tahlil).
// ═══════════════════════════════════════════════════════════

type ToastState = { message: string; tone: 'success' | 'error' } | null;
type Mode = 'MONTH' | 'CUM';


export function BankAnalysisView({ source = 'bank', defaultDir = 'OUT' }: { source?: AnalysisSource; defaultDir?: BankDir }) {
  return (
    <SourceProvider source={source}>
      <AnalysisPage defaultDir={defaultDir} />
    </SourceProvider>
  );
}

function AnalysisPage({ defaultDir }: { defaultDir: BankDir }) {
  const { api, source, dirLabel } = useSource();
  const inv = source === 'invoice';
  const { isAdmin } = useAuth();
  const range = useMonthRange('year');
  const [account, setAccount] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<BankAnalysis | null>(null);
  const [accountName, setAccountName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<BankBatch | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const view = useAsync(() => (range.error ? Promise.resolve(null) : api.view(range.from, range.to, account).then((r) => r.data)), [range.from, range.to, range.error, account]);
  const batches = useAsync(() => api.batches().then((r) => r.data), []);
  const posts = useAsync(() => api.posts().then((r) => r.data), []);

  function reset() {
    setAnalysis(null);
    setPicked(new Set());
    setAccountName('');
    if (inputRef.current) inputRef.current.value = '';
  }

  async function handleFile(file: File) {
    if (!/\.(xlsx|xltx)$/i.test(file.name)) {
      setToast({ message: 'Faqat Excel (.xlsx yoki .xltx) fayl yuklang', tone: 'error' });
      return;
    }
    setUploading(true);
    setAnalysis(null);
    try {
      const a = await api.analyze(file);
      setAnalysis(a);
      setAccountName(a.account.suggested);
      setPicked(new Set(a.months.map((m) => m.period)));
    } catch (err) {
      setToast({ message: errorMessage(err, "Faylni o'qib bo'lmadi"), tone: 'error' });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleSave() {
    if (!analysis || !picked.size) return;
    setSaving(true);
    try {
      const months = [...picked];
      const rows = analysis.rows.filter((r) => picked.has(r.period ?? r.docDate.slice(0, 7)));
      const r = (
        await api.commit(
          inv
            ? { fileName: analysis.fileName, rows, months, allIds: analysis.allIds ?? [], org: analysis.org ? { inn: analysis.org.inn, name: analysis.org.name } : undefined }
            : { fileName: analysis.fileName, account: accountName.trim() || analysis.account.suggested, months, rows },
        )
      ).data;
      setToast({ message: `Saqlandi: ${inv ? `${r.invoices ?? 0} ta faktura (${r.saved} qator)${r.updatedInvoices ? ` · ${r.updatedInvoices} tasi yangilandi` : ''}` : `${r.saved} ta qator`} · ${dirLabel.OUT.toLowerCase()} ${formatTiyin(r.outTiyin)} · ${dirLabel.IN.toLowerCase()} ${formatTiyin(r.inTiyin)}${r.replacedMonths.length ? ` · ${r.replacedMonths.length} oy almashtirildi` : ''}${r.droppedPosts ? ` · yangi ko'chirmada yo'q ${r.droppedPosts} ta to'lovning yozuvi o'chirildi` : ''}`, tone: 'success' });
      posts.reload();
      range.include(months);
      reset();
      view.reload();
      batches.reload();
    } catch (err) {
      setToast({ message: errorMessage(err, 'Saqlashda xatolik'), tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      const r = (await api.cancel(cancelTarget.id)).data;
      setToast({ message: `${r.months.length ? `Bekor qilindi: ${r.months.map(formatPeriod).join(', ')}` : 'Bekor qilindi (oylari keyin almashtirilgan edi)'}${r.droppedPosts ? ` · ${r.droppedPosts} ta yo'naltirilgan yozuv o'chirildi` : ''}`, tone: 'success' });
      view.reload();
      batches.reload();
      posts.reload();
    } catch (err) {
      setToast({ message: errorMessage(err, 'Bekor qilishda xatolik'), tone: 'error' });
    } finally {
      setCancelling(false);
      setCancelTarget(null);
    }
  }

  // Tanlangan hisob uchun shu oylar avval saqlanganmi (almashtiriladi)
  const known = analysis?.account?.known?.find((k) => k.label.trim().toLowerCase() === accountName.trim().toLowerCase()) ?? null;
  const v = view.data;

  return (
    <>
      <SourceActions
        upload={isAdmin ? { label: inv ? 'Fakturalar reyestrini yuklash' : "Ko'chirmani yuklash", onClick: () => inputRef.current?.click(), loading: uploading, disabled: Boolean(analysis), hint: analysis ? 'Avval joriy tahlilni saqlang yoki bekor qiling' : inv ? 'Didox / soliq.uz «Счет-фактура» eksporti (katta fayl ham — 250 MB gacha)' : 'Bankdan olingan ko‘chirma (выписка), 23106 shabloni shaklida' } : undefined}
        template={inv ? undefined : {
          label: 'Shablon (23106)',
          onClick: () =>
            void (async () => {
              setDownloading(true);
              try {
                await downloadAcc23106Template();
              } catch (err) {
                setToast({ message: errorMessage(err, "Shablonni yuklab bo'lmadi"), tone: 'error' });
              } finally {
                setDownloading(false);
              }
            })(),
          loading: downloading,
          hint: "Ko'chirma ustunlari: №пп … Обороты по дебету, по кредиту, Назначение платежа",
        }}
        note={
          inv ? (
            <>
              Bu — <b className="text-heading">nazorat maydoni</b>: schyot-fakturalar o&apos;qiladi — faqat <b className="text-heading">«Подписан» va «Ожидает»</b>, summa <b className="text-heading">QQS bilan</b>.
              Biz xaridor — kiruvchi (xarajat), sotuvchi — chiquvchi (daromad). <b className="text-heading">Xarajat va daromadga o&apos;zi yozilmaydi</b> — xohlagan qatoringizni tanlab yo&apos;naltirasiz.
              Kontragent va xizmat (IKPU) bo&apos;yicha oyma-oy; oy — xizmat oyi («за август»). Qayta yuklansa, fayldagi fakturalar yangilanadi, boshqalariga tegilmaydi.
            </>
          ) : (
          <>
            Bu — <b className="text-heading">tahlil maydoni</b>: ko&apos;chirmadagi chiqim (debet) va kirim (kredit) o&apos;qiladi, <b className="text-heading">xarajat va daromadga yozilmaydi</b>.
            O&apos;xshash to&apos;lovlar (bir oluvchiga bir maqsadda — izohdagi sana, raqam, summa e&apos;tiborga olinmaydi) bitta guruhga yig&apos;iladi, oyma-oy va o&apos;sib boruvchi ko&apos;rinadi.
            Bir nechta hisob raqami bo&apos;lsa — har birini o&apos;z nomi bilan saqlang (oy qayta yuklansa, shu hisobning o&apos;sha oyi almashtiriladi).
          </>
          )
        }
      />
      <input ref={inputRef} type="file" accept=".xlsx,.xltx" className="hidden" onChange={(e) => e.target.files?.[0] && void handleFile(e.target.files[0])} />

      {isAdmin && !analysis && (
        <Card>
          <CardBody>
            <div
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files[0];
                if (f) void handleFile(f);
              }}
              onClick={() => inputRef.current?.click()}
              className={cn('flex cursor-pointer flex-col items-center justify-center gap-2 rounded-(--radius-card) border-2 border-dashed px-6 py-10 transition-colors', dragging ? 'border-brand-600 bg-brand-50' : 'border-(--color-line-strong) hover:border-brand-400 hover:bg-(--color-surface-muted)')}
            >
              {uploading ? (
                <>
                  <IconSpinner className="size-8 animate-spin text-brand-700" />
                  <p className="text-sm text-(--color-text-muted)">O&apos;qilmoqda…</p>
                </>
              ) : (
                <>
                  <IconUpload className="size-8 text-(--color-text-faint)" strokeWidth={1.5} />
                  <p className="text-sm font-medium">{inv ? 'Schyot-fakturalar reyestrini shu yerga tashlang' : 'Bank ko‘chirmasini shu yerga tashlang'}</p>
                  <p className="text-xs text-(--color-text-muted)">yoki bosib tanlang · {inv ? 'Didox / soliq.uz eksporti (.xlsx), katta fayl ham' : 'bankdan olingan Excel (.xlsx, .xltx)'}</p>
                </>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {analysis && (
        <div className="space-y-4">
          <Card>
            <CardHeader title={`${analysis.fileName} · ${analysis.sheetName}`} description={inv ? `${analysis.invoices?.included ?? 0} ta faktura (${analysis.rows.length} qator) olinadi — saqlanadigan oylarni tanlang` : `${analysis.rows.length} ta qator o'qildi — saqlanadigan oylarni va hisobni tanlang`} />
            <CardBody className="space-y-3">
              {inv && analysis.org && (
                <div className="space-y-2 text-xs">
                  <p>
                    Bizning korxona: <b className="text-heading">{analysis.org.name || '—'}</b> · INN <span className="money">{analysis.org.inn}</span>{' '}
                    <span className="text-(--color-text-faint)">({analysis.org.source === 'SAVED' ? 'saqlangan' : 'fayldan aniqlandi'})</span>
                  </p>
                  <p className="flex flex-wrap items-center gap-1.5">
                    Holatlar:
                    {(analysis.statuses ?? []).map((x) => (
                      <Badge key={x.status} tone={x.included ? 'income' : 'neutral'}>
                        {x.status} {x.count}
                        {x.included ? '' : ' — olinmaydi'}
                      </Badge>
                    ))}
                  </p>
                  {(analysis.invoices?.update ?? 0) > 0 && <p className="text-(--color-warn)">{analysis.invoices!.update} ta faktura avval saqlangan — yangilanadi (yo&apos;naltirishlari saqlanadi, qatori o&apos;zgarmagan bo&apos;lsa).</p>}
                  {(analysis.invoices?.other ?? 0) > 0 && <p className="text-(--color-text-muted)">{analysis.invoices!.other} ta fakturada bizning korxona yo&apos;q — olinmadi.</p>}
                  {analysis.truncated && <p className="text-(--color-expense)">Fayl juda katta — birinchi 60 000 qator o&apos;qildi.</p>}
                </div>
              )}
              {!inv && (
              <label className="block max-w-md text-xs font-medium text-(--color-text-muted)">
                Hisob nomi
                <input
                  list="bank-accounts"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  maxLength={60}
                  className="mt-1 block h-9 w-full rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-sm text-heading"
                />
                <datalist id="bank-accounts">
                  {analysis.account.known.map((k) => (
                    <option key={k.key} value={k.label} />
                  ))}
                </datalist>
                <span className="mt-1 block font-normal text-(--color-text-faint)">Masalan: «23106», «Asosiy hisob …12345». Hisob raqamining o&apos;zi saqlanmaydi.</span>
              </label>
              )}
              <div className="flex flex-wrap gap-2">
                {analysis.months.map((m) => {
                  const again = !inv && known?.months.includes(m.period);
                  return (
                    <label key={m.period} className={cn('flex cursor-pointer items-center gap-2 rounded-(--radius-control) border px-3 py-2 text-sm', picked.has(m.period) ? 'border-brand-600 bg-brand-50/50' : 'border-(--color-line)')}>
                      <input
                        type="checkbox"
                        className="size-4 accent-brand-600"
                        checked={picked.has(m.period)}
                        onChange={() =>
                          setPicked((s) => {
                            const n = new Set(s);
                            if (n.has(m.period)) n.delete(m.period);
                            else n.add(m.period);
                            return n;
                          })
                        }
                      />
                      <span className="font-medium text-heading">{m.label}</span>
                      <span className="text-xs text-(--color-text-muted)">
                        {m.count} ta · {dirLabel.OUT.toLowerCase()} <span className="money">{formatTiyin(m.outTiyin)}</span> · {dirLabel.IN.toLowerCase()} <span className="money">{formatTiyin(m.inTiyin)}</span>
                      </span>
                      {again && <Badge tone="warn">shu hisobda bor — almashtiriladi</Badge>}
                    </label>
                  );
                })}
              </div>
              {analysis.invalidCount > 0 && (
                <p className="flex items-center gap-1 text-xs text-(--color-expense)">
                  <IconAlert className="size-3.5" />
                  O&apos;qilmagan qatorlar {analysis.invalidCount} ta: {analysis.invalid.slice(0, 5).map((x) => `${x.rowIndex}-qator — ${x.reason}`).join('; ')}
                </p>
              )}
            </CardBody>
          </Card>
          <PreviewGroups analysis={analysis} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={reset} disabled={saving}>
              Boshqa fayl
            </Button>
            <Button onClick={() => void handleSave()} loading={saving} disabled={!picked.size || !accountName.trim()}>
              Saqlash
            </Button>
          </div>
        </div>
      )}

      {/* Saqlangan — tanlangan davr */}
      <MonthRangeCard range={range} />
      {v && v.accounts.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-(--color-text-muted)">Hisob:</span>
          <Chip active={!account} onClick={() => setAccount(null)}>
            Hammasi
          </Chip>
          {v.accounts.map((a) => (
            <Chip key={a.key} active={account === a.key} onClick={() => setAccount(a.key)}>
              {a.label}
            </Chip>
          ))}
        </div>
      )}
      {view.loading && !v ? (
        <LoadingState />
      ) : view.error ? (
        <ErrorState message={view.error} onRetry={view.reload} />
      ) : v && v.totals.rows > 0 ? (
        <Analysis v={v} defaultDir={defaultDir} rangeText={range.text} isAdmin={isAdmin} onToast={setToast} onChanged={() => { view.reload(); posts.reload(); }} />
      ) : (
        <EmptyState title={`${range.text || 'Tanlangan davr'} uchun ko'chirma saqlanmagan`} hint="upload" />
      )}

      {/* Yo'naltirishlar tarixi */}
      <PostsHistory list={posts.data ?? []} isAdmin={isAdmin} onToast={setToast} onChanged={() => { view.reload(); posts.reload(); }} />

      {/* Tarix */}
      {(batches.data?.length ?? 0) > 0 && (
        <Card className="overflow-hidden">
          <CardHeader title="Yuklashlar tarixi" />
          <ul className="divide-y divide-(--color-line) text-sm">
            {batches.data!.slice(0, 40).map((b) => (
              <li key={b.id} className={cn('flex flex-wrap items-center gap-3 px-5 py-2.5', b.state !== 'ACTIVE' && b.state !== 'PARTIAL' && 'opacity-50')}>
                <span className="min-w-0 flex-1 truncate font-medium">{b.fileName}</span>
                <Badge tone="neutral">{b.accountLabel}</Badge>
                <span className="text-xs text-(--color-text-muted)">{b.months.map(formatPeriod).join(', ')}</span>
                <span className="text-xs text-(--color-text-muted)">{b.rows} ta</span>
                <span className="text-xs">
                  <Money tiyin={b.outTiyin} tone="expense" /> / <Money tiyin={b.inTiyin} tone="income" />
                </span>
                <span className="text-xs text-(--color-text-muted)">
                  {formatDateTime(b.createdAt)} · {b.uploadedBy}
                </span>
                {b.state === 'CANCELLED' ? (
                  <Badge tone="neutral">bekor qilingan</Badge>
                ) : b.state === 'REPLACED' ? (
                  <Badge tone="neutral">keyin almashtirilgan</Badge>
                ) : (
                  <>
                    {b.state === 'PARTIAL' && <Badge tone="warn">qisman almashtirilgan</Badge>}
                    {isAdmin && (
                      <Button size="sm" variant="ghost" className="text-(--color-text-muted) hover:text-(--color-expense)" onClick={() => setCancelTarget(b)}>
                        Bekor qilish
                      </Button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ConfirmDialog
        open={cancelTarget !== null}
        title="Ko'chirmani bekor qilish"
        message={`${cancelTarget?.fileName ?? ''} (${cancelTarget?.accountLabel ?? ''}) bekor qilinadi — shu yuklashdan saqlangan oylar tahlildan o'chiriladi. Xarajat va daromadga ta'siri yo'q.`}
        confirmLabel="Bekor qilish"
        danger
        loading={cancelling}
        onConfirm={() => void handleCancel()}
        onCancel={() => setCancelTarget(null)}
      />
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </>
  );
}

// ═══════════ Tahlil ═══════════

function Analysis({ v, defaultDir, rangeText, isAdmin, onToast, onChanged }: { v: BankView; defaultDir: BankDir; rangeText: string; isAdmin: boolean; onToast: (t: ToastState) => void; onChanged: () => void }) {
  const { dirLabel: DIR_LABEL } = useSource();
  const [dir, setDir] = useState<BankDir>(defaultDir);
  const [kind, setKind] = useState<BankKind | null>(null);
  const [mode, setMode] = useState<Mode>('MONTH');
  // Ochilgan guruh — kaliti bo'yicha (ma'lumot yangilansa ham ochiq qoladi)
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [openMonth, setOpenMonth] = useState<string | null>(null);
  const [pattern, setPattern] = useState<BankPattern | null>(null);
  // «Tahlil» (grafik, turlar, guruhlar) yoki «Hisobot» (modda › kontragent › xizmat, oylar kesimida)
  const [tab, setTab] = useState<'ANALYSIS' | 'REPORT'>('ANALYSIS');
  const [rev, setRev] = useState(0);
  const changed = () => {
    setRev((x) => x + 1);
    onChanged();
  };
  const open = openKey ? (v.groups.find((g) => g.key === openKey) ?? null) : null;
  const missing = v.series.filter((m) => !m.count).map((m) => m.period);
  const kinds = v.kinds.filter((k) => k.dir === dir);

  const drawer = <GroupDrawer key={`${openKey ?? 'none'}|${openMonth ?? ''}`} month={openMonth} group={open} v={v} isAdmin={isAdmin} onToast={onToast} onChanged={changed} onClose={() => setOpenKey(null)} />;
  const tabs = (
    <div className="flex items-center gap-1 border-b border-(--color-line)">
      {(['ANALYSIS', 'REPORT'] as const).map((t) => (
        <button key={t} type="button" onClick={() => setTab(t)} className={cn('-mb-px border-b-2 px-4 py-2 text-sm font-medium', tab === t ? 'border-brand-600 text-brand-800' : 'border-transparent text-(--color-text-muted) hover:text-heading')}>
          {t === 'ANALYSIS' ? 'Tahlil' : 'Hisobot (modda › kontragent › xizmat)'}
        </button>
      ))}
    </div>
  );

  if (tab === 'REPORT')
    return (
      <div className="space-y-4">
        {tabs}
        <PivotReport from={v.from} to={v.to} account={v.account} defaultDir={dir} isAdmin={isAdmin} onToast={onToast} reloadKey={rev} onOpenGroup={(k) => { setOpenKey(k); setOpenMonth(null); }} />
        {drawer}
      </div>
    );

  return (
    <div className="space-y-4">
      {tabs}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Box label="Chiqim" value={formatTiyin(v.totals.outTiyin)} sub={`${rangeText} · ${v.groups.filter((g) => g.dir === 'OUT').length} guruh`} tone="expense" />
        <Box label="Kirim" value={formatTiyin(v.totals.inTiyin)} sub={`${v.groups.filter((g) => g.dir === 'IN').length} guruh`} tone="income" />
        <Box label="Kirim − chiqim" value={formatTiyin(v.totals.netTiyin)} sub="tanlangan davr bo‘yicha" tone={BigInt(v.totals.netTiyin) < 0n ? 'expense' : 'income'} />
        <PatternBox v={v} dir={dir} active={pattern} onPick={(p) => setPattern(pattern === p ? null : p)} />
      </div>
      {v.totals.posted.count > 0 && (
        <p className="text-xs text-(--color-text-muted)">
          Yo&apos;naltirilgan: <b className="text-heading">{v.totals.posted.count}</b> ta to&apos;lov · xarajatga <span className="money text-(--color-expense)">{formatTiyin(v.totals.posted.outTiyin)}</span> · daromadga{' '}
          <span className="money text-(--color-income)">{formatTiyin(v.totals.posted.inTiyin)}</span>
        </p>
      )}
      {missing.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-(--color-warn)">
          <IconAlert className="size-3.5" />
          Ko&apos;chirma yuklanmagan oylar: {missing.map(formatPeriod).join(', ')} — o&apos;sib boruvchi summalarda ular 0 deb olinadi.
        </p>
      )}

      <Card>
        <CardHeader
          title="Oyma-oy"
          description={mode === 'MONTH' ? 'Har oy chiqim va kirim' : "O'sib boruvchi (davr boshidan jamlanma)"}
          actions={<ModeSwitch mode={mode} onChange={setMode} />}
        />
        <CardBody>
          <FlowChart series={v.series} mode={mode} />
        </CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card className="overflow-hidden">
          <CardHeader title="Nimalar bor (turlar)" description={`${DIR_LABEL[dir]} · bosib guruhlarni saralang`} actions={<DirSwitch dir={dir} onChange={(d) => { setDir(d); setKind(null); }} />} />
          <ul className="divide-y divide-(--color-line) text-sm">
            {kinds.map((k) => (
              <li key={k.kind}>
                <button type="button" onClick={() => setKind(kind === k.kind ? null : k.kind)} className={cn('block w-full px-5 py-2 text-left hover:bg-(--color-surface-muted)', kind === k.kind && 'bg-brand-50')}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium text-heading">
                      {k.label} <span className="text-xs font-normal text-(--color-text-faint)">{k.groups} guruh · {k.count} ta</span>
                    </span>
                    <span className="money text-sm">{formatTiyin(k.totalTiyin)}</span>
                  </span>
                  <span className="mt-1 flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-(--color-surface-sunken)">
                      <span className={cn('block h-full rounded-full', dir === 'OUT' ? 'bg-(--color-expense)' : 'bg-(--color-income)')} style={{ width: `${Math.min(100, k.sharePct)}%` }} />
                    </span>
                    <span className="money w-12 text-right text-[11px] text-(--color-text-muted)">{k.sharePct.toFixed(1)}%</span>
                  </span>
                </button>
              </li>
            ))}
            {!kinds.length && <li className="px-5 py-4 text-sm text-(--color-text-muted)">Bu davrda {DIR_LABEL[dir].toLowerCase()} yo&apos;q</li>}
          </ul>
        </Card>
        <KindTrend kinds={kinds} months={v.months} active={kind} />
      </div>

      <GroupsTable v={v} dir={dir} onDir={(d) => { setDir(d); setKind(null); }} kind={kind} onKind={setKind} mode={mode} onMode={setMode} pattern={pattern} onPattern={setPattern} onOpen={(g, m) => { setOpenKey(g.key); setOpenMonth(m ?? null); }} />

      {drawer}
    </div>
  );
}

/** Turlar oyma-oy: eng kattalari, mini-grafik bilan */
function KindTrend({ kinds, months, active }: { kinds: BankView['kinds']; months: string[]; active: BankKind | null }) {
  const list = (active ? kinds.filter((k) => k.kind === active) : kinds).slice(0, 6);
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Turlar oyma-oy" description={active ? 'Tanlangan tur' : 'Eng katta 6 tur'} />
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-(--color-surface-muted) text-[10px] uppercase tracking-wide text-(--color-text-muted)">
            <tr>
              <th className="sticky left-0 bg-(--color-surface-muted) px-3 py-2 text-left font-semibold">Tur</th>
              {months.map((p) => (
                <th key={p} className="px-2 py-2 text-right font-semibold whitespace-nowrap">
                  {formatPeriodShort(p)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((k) => (
              <tr key={k.kind} className="border-t border-(--color-line)">
                <td className="sticky left-0 bg-white px-3 py-1.5 font-medium whitespace-nowrap text-heading">{k.label}</td>
                {months.map((p) => (
                  <td key={p} className="money px-2 py-1.5 text-right whitespace-nowrap">
                    {k.byMonth[p] && k.byMonth[p] !== '0' ? formatCompact(k.byMonth[p]!) : <span className="text-(--color-text-faint)">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const PAGE = 60;

function GroupsTable({ v, dir, onDir, kind, onKind, pattern, onPattern, mode, onMode, onOpen }: { v: BankView; dir: BankDir; onDir: (d: BankDir) => void; kind: BankKind | null; onKind: (k: BankKind | null) => void; pattern: BankPattern | null; onPattern: (p: BankPattern | null) => void; mode: Mode; onMode: (m: Mode) => void; onOpen: (g: BankGroup, month?: string) => void }) {
  const { dirLabel: DIR_LABEL, groupsTitle } = useSource();
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return v.groups.filter((g) => {
      if (g.dir !== dir) return false;
      if (kind && g.kind !== kind) return false;
      if (pattern && g.pattern !== pattern) return false;
      if (!t) return true;
      return g.counterparty.toLowerCase().includes(t) || (g.name ?? '').toLowerCase().includes(t) || (g.inn ?? '').includes(t) || g.samples.some((x) => x.toLowerCase().includes(t));
    });
  }, [v.groups, dir, kind, pattern, q]);
  const total = shown.reduce((s, g) => s + BigInt(g.totalTiyin), 0n);
  const colTotals = v.months.map((p, i) => shown.reduce((s, g) => s + BigInt(mode === 'MONTH' ? (g.byMonth[p] ?? '0') : (g.cumulative[i] ?? '0')), 0n));
  const tone = dir === 'OUT' ? 'expense' : 'income';

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={`${groupsTitle} · ${DIR_LABEL[dir].toLowerCase()}`}
        description={`${shown.length} guruh · ${formatTiyin(total.toString())} so'm · guruhni bossangiz — hamma to'lovlari, oy katagini bossangiz — shu oyniki (nomini o'zgartirish va yo'naltirish)`}
        actions={<ModeSwitch mode={mode} onChange={onMode} />}
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-(--color-line) px-5 py-2.5">
        <DirSwitch dir={dir} onChange={onDir} />
        <span className="mx-1 h-5 w-px bg-(--color-line)" />
        <Chip active={!pattern} onClick={() => onPattern(null)}>
          Hammasi
        </Chip>
        {(['REGULAR', 'IRREGULAR', 'ONCE'] as const).map((p) => {
          const n = v.groups.filter((g) => g.dir === dir && g.pattern === p && (!kind || g.kind === kind)).length;
          return (
            <Chip key={p} active={pattern === p} onClick={() => onPattern(pattern === p ? null : p)}>
              {PATTERN_LABEL[p]} <span className="money opacity-70">{n}</span>
            </Chip>
          );
        })}
        {kind && (
          <Chip active onClick={() => onKind(null)}>
            {v.kinds.find((k) => k.kind === kind && k.dir === dir)?.label ?? kind} ✕
          </Chip>
        )}
        <label className="relative ml-auto">
          <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-(--color-text-faint)" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLimit(PAGE);
            }}
            placeholder="Nom, oluvchi, ИНН, izoh"
            className="h-8 w-60 rounded-(--radius-control) border border-(--color-line-strong) bg-white pr-3 pl-8 text-sm focus:border-brand-600 focus:outline-none"
          />
        </label>
      </div>
      <div className="max-h-[680px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-[2] bg-(--color-surface-muted) text-[10px] uppercase tracking-wide text-(--color-text-muted)">
            <tr>
              <th className="sticky left-0 z-[3] min-w-72 bg-(--color-surface-muted) px-3 py-2 text-left font-semibold">Guruh</th>
              {v.months.map((p) => (
                <th key={p} className="px-2 py-2 text-right font-semibold whitespace-nowrap">
                  {formatPeriodShort(p)}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-semibold">Jami</th>
              <th className="px-3 py-2 text-right font-semibold">Ulush</th>
              <th className="px-3 py-2 text-right font-semibold whitespace-nowrap" title="Oxirgi faol oy oldingi faol oyga nisbatan">O‘zgarish</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((g) => (
              <tr key={g.key} className="cursor-pointer border-t border-(--color-line) align-top hover:bg-(--color-surface-muted)" onClick={() => onOpen(g)}>
                <td className="sticky left-0 z-[1] max-w-96 bg-white px-3 py-2">
                  <span className="block truncate font-medium text-heading" title={g.name ? `${g.name}\n${g.counterparty}` : g.counterparty}>
                    {g.name ?? g.counterparty}
                  </span>
                  <span className="block truncate text-[11px] text-(--color-text-muted)" title={g.samples.join('\n')}>
                    {g.name ? `${g.counterparty} · ` : ''}
                    {g.samples[0] ?? '—'}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1">
                    <Badge tone="brand" className="px-1.5 py-0 text-[10px]">
                      {g.kindLabel}
                    </Badge>
                    {g.postedCount > 0 && (
                      <Badge tone={g.postedCount === g.count ? 'income' : 'warn'} className="px-1.5 py-0 text-[10px]">
                        yo‘naltirilgan {g.postedCount}/{g.count}
                      </Badge>
                    )}
                    <Badge tone={g.pattern === 'ONCE' ? 'warn' : 'neutral'} className="px-1.5 py-0 text-[10px]">
                      {PATTERN_LABEL[g.pattern].toLowerCase()}
                      {g.pattern !== 'ONCE' ? ` · ${g.activeMonths} oy` : ''}
                    </Badge>
                    <span className="text-[10px] text-(--color-text-faint)">
                      {g.count} ta{g.inn ? ` · ИНН ${g.inn}` : ''}
                    </span>
                  </span>
                </td>
                {v.months.map((p, i) => {
                  const val = mode === 'MONTH' ? (g.byMonth[p] ?? '0') : (g.cumulative[i] ?? '0');
                  return (
                    <td key={p} className="money px-1 py-1.5 text-right text-xs whitespace-nowrap">
                      {g.byMonth[p] && g.byMonth[p] !== '0' ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpen(g, p);
                          }}
                          title={`${formatPeriod(p)}: ${g.countByMonth[p] ?? 0} ta to'lov — ochish`}
                          className="rounded px-1.5 py-0.5 underline decoration-(--color-line-strong) decoration-dotted underline-offset-2 hover:bg-brand-50 hover:text-brand-800"
                        >
                          {formatCompact(val)}
                        </button>
                      ) : val !== '0' ? (
                        <span className="px-1.5 text-(--color-text-faint)">{formatCompact(val)}</span>
                      ) : (
                        <span className="px-1.5 text-(--color-text-faint)">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="money px-3 py-2 text-right whitespace-nowrap">
                  <Money tiyin={g.totalTiyin} tone={tone} />
                </td>
                <td className="money px-3 py-2 text-right text-xs text-(--color-text-muted)">{g.sharePct.toFixed(1)}%</td>
                <td className={cn('money px-3 py-2 text-right text-xs', g.changePct === null ? 'text-(--color-text-faint)' : g.changePct > 0 ? (dir === 'OUT' ? 'text-(--color-expense)' : 'text-(--color-income)') : g.changePct < 0 ? (dir === 'OUT' ? 'text-(--color-income)' : 'text-(--color-expense)') : 'text-(--color-text-muted)')}>
                  {g.changePct === null ? '—' : `${g.changePct > 0 ? '+' : ''}${g.changePct.toFixed(0)}%`}
                </td>
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={v.months.length + 4} className="py-6 text-center text-sm text-(--color-text-muted)">
                  Bu tanlovda guruh yo&apos;q
                </td>
              </tr>
            )}
          </tbody>
          {shown.length > 0 && (
            <tfoot className="sticky bottom-0 z-[2] bg-(--color-surface-muted) text-xs font-semibold">
              <tr>
                <td className="sticky left-0 z-[3] bg-(--color-surface-muted) px-3 py-2">Jami ({shown.length} guruh)</td>
                {colTotals.map((t, i) => (
                  <td key={v.months[i]} className="money px-2 py-2 text-right whitespace-nowrap">
                    {t ? formatCompact(t.toString()) : '—'}
                  </td>
                ))}
                <td className="money px-3 py-2 text-right whitespace-nowrap">{formatTiyin(total.toString())}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {shown.length > limit && (
        <div className="border-t border-(--color-line) px-5 py-2 text-center">
          <Button size="sm" variant="ghost" onClick={() => setLimit((x) => x + PAGE)}>
            Yana {Math.min(PAGE, shown.length - limit)} ta ({shown.length - limit} qoldi)
          </Button>
        </div>
      )}
    </Card>
  );
}

// ═══════════ Grafik ═══════════

/** Oyma-oy: chiqim va kirim ustunlari; o'sib boruvchi rejimda — jamlanma chiziqlar */
function FlowChart({ series, mode }: { series: BankSeries[]; mode: Mode }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 900;
  const H = 240;
  const P = { t: 12, r: 12, b: 26, l: 64 };
  const out = series.map((m) => Number(BigInt(mode === 'MONTH' ? m.outTiyin : m.outCumTiyin) / 100n));
  const inn = series.map((m) => Number(BigInt(mode === 'MONTH' ? m.inTiyin : m.inCumTiyin) / 100n));
  const max = Math.max(1, ...out, ...inn);
  const n = series.length;
  const cw = (W - P.l - P.r) / Math.max(1, n);
  const y = (v: number) => P.t + (H - P.t - P.b) * (1 - v / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
  const line = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${P.l + cw * i + cw / 2},${y(v)}`).join(' ');
  const h = hover !== null ? series[hover] : null;
  return (
    <div className="relative">
      <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-60 w-full min-w-[640px]" role="img" aria-label="Oyma-oy chiqim va kirim">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeDasharray={t ? '3 3' : undefined} />
            <text x={P.l - 6} y={y(t) + 3} textAnchor="end" className="fill-(--color-text-faint) text-[10px]">
              {formatCompact(String(Math.round(t) * 100))}
            </text>
          </g>
        ))}
        {mode === 'MONTH' ? (
          series.map((m, i) => {
            const bw = Math.max(2, Math.min(18, cw / 3));
            const x0 = P.l + cw * i + cw / 2 - bw - 1;
            return (
              <g key={m.period}>
                <rect x={x0} y={y(out[i]!)} width={bw} height={Math.max(0, y(0) - y(out[i]!))} rx={2} fill="var(--color-expense)" opacity={hover === null || hover === i ? 0.9 : 0.4} />
                <rect x={x0 + bw + 2} y={y(inn[i]!)} width={bw} height={Math.max(0, y(0) - y(inn[i]!))} rx={2} fill="var(--color-income)" opacity={hover === null || hover === i ? 0.9 : 0.4} />
              </g>
            );
          })
        ) : (
          <>
            <path d={line(out)} fill="none" stroke="var(--color-expense)" strokeWidth={2.5} />
            <path d={line(inn)} fill="none" stroke="var(--color-income)" strokeWidth={2.5} />
            {series.map((m, i) => (
              <g key={m.period}>
                <circle cx={P.l + cw * i + cw / 2} cy={y(out[i]!)} r={hover === i ? 4.5 : 3} fill="var(--color-expense)" />
                <circle cx={P.l + cw * i + cw / 2} cy={y(inn[i]!)} r={hover === i ? 4.5 : 3} fill="var(--color-income)" />
              </g>
            ))}
          </>
        )}
        {series.map((m, i) => (
          <g key={`x${m.period}`}>
            <text x={P.l + cw * i + cw / 2} y={H - 8} textAnchor="middle" className={cn('text-[10px]', m.count ? 'fill-(--color-text-muted)' : 'fill-(--color-warn)')}>
              {formatPeriodShort(m.period)}
            </text>
            <rect x={P.l + cw * i} y={P.t} width={cw} height={H - P.t - P.b} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          </g>
        ))}
      </svg>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-(--color-text-muted)">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-(--color-expense)" /> Chiqim
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-(--color-income)" /> Kirim
        </span>
        {h && (
          <span className="ml-auto text-heading">
            <b>{formatPeriod(h.period)}</b>
            {h.count ? '' : ' (yuklanmagan)'}: chiqim <span className="money">{formatTiyin(mode === 'MONTH' ? h.outTiyin : h.outCumTiyin)}</span> · kirim <span className="money">{formatTiyin(mode === 'MONTH' ? h.inTiyin : h.inCumTiyin)}</span>
          </span>
        )}
      </div>
    </div>
  );
}

// ═══════════ Mayda ═══════════

function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <span className="inline-flex rounded-(--radius-control) border border-(--color-line) bg-white p-0.5 text-xs">
      {(['MONTH', 'CUM'] as const).map((m) => (
        <button key={m} type="button" onClick={() => onChange(m)} className={cn('rounded px-2.5 py-1 font-medium', mode === m ? 'bg-brand-600 text-white' : 'text-(--color-text-muted) hover:text-heading')}>
          {m === 'MONTH' ? 'Oyma-oy' : "O'sib boruvchi"}
        </button>
      ))}
    </span>
  );
}

function DirSwitch({ dir, onChange }: { dir: BankDir; onChange: (d: BankDir) => void }) {
  const { dirLabel: DIR_LABEL } = useSource();
  return (
    <span className="inline-flex rounded-(--radius-control) border border-(--color-line) bg-white p-0.5 text-xs">
      {(['OUT', 'IN'] as const).map((d) => (
        <button key={d} type="button" onClick={() => onChange(d)} className={cn('rounded px-2.5 py-1 font-medium', dir === d ? (d === 'OUT' ? 'bg-(--color-expense) text-white' : 'bg-(--color-income) text-white') : 'text-(--color-text-muted) hover:text-heading')}>
          {DIR_LABEL[d]}
        </button>
      ))}
    </span>
  );
}

/** Takrorlanishi bo'yicha: muntazam / vaqti-vaqti bilan / bir martalik — bosib guruhlarni saralash */
function PatternBox({ v, dir, active, onPick }: { v: BankView; dir: BankDir; active: BankPattern | null; onPick: (p: BankPattern) => void }) {
  const { dirLabel: DIR_LABEL } = useSource();
  const list = v.totals.patterns.filter((x) => x.dir === dir);
  return (
    <div className="rounded-(--radius-card) border border-(--color-line) bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">{DIR_LABEL[dir]} · takrorlanishi</p>
      <ul className="mt-1.5 space-y-0.5 text-xs">
        {list.map((x) => (
          <li key={x.pattern}>
            <button type="button" onClick={() => onPick(x.pattern)} className={cn('flex w-full justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-(--color-surface-muted)', active === x.pattern && 'bg-brand-50 text-brand-800')}>
              <span>
                {PATTERN_LABEL[x.pattern]} <span className="text-(--color-text-faint)">({x.groups})</span>
              </span>
              <span className="money">{formatTiyin(x.totalTiyin)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Box({ label, value, sub, tone = 'neutral' }: { label: string; value: string; sub: string; tone?: 'neutral' | 'income' | 'expense' | 'warn' }) {
  const c = { neutral: 'text-(--color-text)', income: 'text-(--color-income)', expense: 'text-(--color-expense)', warn: 'text-(--color-warn)' }[tone];
  return (
    <div className="rounded-(--radius-card) border border-(--color-line) bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">{label}</p>
      <p className={cn('money mt-1.5 text-xl font-semibold', c)}>{value}</p>
      <p className="mt-0.5 text-xs text-(--color-text-muted)">{sub}</p>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn('rounded-full border px-3 py-1 text-xs font-medium', active ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-(--color-line) bg-white text-(--color-text-muted) hover:text-heading')}>
      {children}
    </button>
  );
}
