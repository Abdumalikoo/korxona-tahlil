'use client';

import { SourceActions } from '@/components/shared/source-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconAlert, IconCheck, IconSearch, IconSpinner, IconUpload } from '@/components/ui/icons';
import { Money } from '@/components/ui/money';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { Table, TBody, Td, TFoot, Th, THead, Tr } from '@/components/ui/table';
import { Toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatDateTime, formatPeriod, formatTiyin } from '@/lib/format';
import { useMonthChange, usePeriod } from '@/lib/period';
import type { EntryUnit } from '@/lib/segments';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { MonthRangeCard, useMonthRange } from '@/features/units/month-range';
import {
  analyzeUnitFileMany,
  downloadUnitTemplate,
  unitPayrollApi,
  type UnitAnalyzeResult,
  type UnitManyResult,
  type UnitBatch,
  type UnitRowStatus,
  type UnitStaff,
  type UnitStaffList,
  type UnitSaved,
} from './api';
import { NdflSummaryCard } from '@/features/payroll/ndfl-summary';
import { TarkibCompareCard } from './tarkib-compare-card';
import { EMPTY_CHOICE, MOVE_UNITS, PlacePicker, choiceReady, useChoiceLabel, type MoveChoice } from './place-picker';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › <yo'nalish> › Ish haqi (masalan, Tax free).
// Avvalgi Ish haqi sahifasidek: Shablon → vedomostni yuklash → tahlil → saqlash → tarix.
// Farqi: shablonning 2-varag'ida FAQAT shu bo'lim xodimlari. Ro'yxatni tizim o'zi yuritadi:
// vedomostda yangi PINFL kelsa — saqlanganda ro'yxatga qo'shiladi va keyingi shablonda chiqadi.
// ═══════════════════════════════════════════════════════════

type ToastState = { message: string; tone?: 'success' | 'error' } | null;

const STATUS: Record<UnitRowStatus, { label: string; tone: 'neutral' | 'income' | 'warn' | 'brand' }> = {
  KNOWN: { label: "Ro'yxatda", tone: 'neutral' },
  RETURNING: { label: 'Qaytdi', tone: 'brand' },
  REGISTRY: { label: 'Yangi · bazadan', tone: 'income' },
  NEW: { label: 'Yangi', tone: 'warn' },
};

/** mode: vedomost — shablon (oylar ustunlari); ndfl — soliq hisobotining o'zi (4 va 5-ilova, tanlangan oy) */
export function UnitPayrollView({ unit, mode = 'vedomost' }: { unit: EntryUnit; mode?: 'vedomost' | 'ndfl' }) {
  const { isAdmin } = useAuth();
  const ndflMode = mode === 'ndfl';
  const { month: period } = usePeriod();
  const range = useMonthRange('month');
  const [many, setMany] = useState<UnitManyResult | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [activeMonth, setActiveMonth] = useState<string | null>(null);
  const analysis = many?.months.find((m) => m.period === activeMonth) ?? many?.months[0] ?? null;
  const [names, setNames] = useState<Record<string, string>>({});
  const [replacePrevious, setReplacePrevious] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<UnitBatch | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const batches = useAsync(() => unitPayrollApi.batches(unit.code, period), [unit.code, period]);
  const savedList = useAsync(() => unitPayrollApi.saved(unit.code, period), [unit.code, period, batches.data]);
  /** Xodimlar ro'yxati — qaysi oydagi tarkib (ko'chishlar bilan); standart — yuqori paneldagi oy */
  const [staffPeriod, setStaffPeriod] = useState<string>(period);
  const staff = useAsync(() => unitPayrollApi.staff(unit.code, staffPeriod), [unit.code, staffPeriod]);
  const activeCount = staff.data?.data.active ?? 0;

  function reset() {
    setMany(null);
    setPicked(new Set());
    setActiveMonth(null);
    setNames({});
    setReplacePrevious(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  useMonthChange(period, reset);

  async function handleTemplate() {
    setDownloading(true);
    try {
      if (range.error) throw new Error(range.error);
      await downloadUnitTemplate(unit.code, range.from, range.to);
    } catch (err) {
      setToast({ message: errorMessage(err, "Shablonni yuklab bo'lmadi"), tone: 'error' });
    } finally {
      setDownloading(false);
    }
  }

  async function handleFile(file: File) {
    if (!/\.(xlsx|xltx)$/i.test(file.name)) {
      setToast({ message: 'Faqat Excel (.xlsx yoki .xltx) fayl yuklang', tone: 'error' });
      return;
    }
    setUploading(true);
    setMany(null);
    try {
      const result = await analyzeUnitFileMany(unit.code, period, file, ndflMode ? 'ndfl' : 'auto');
      setMany(result);
      setNames({});
      // Hammasi 0 (to'ldirilmagan) oylar — standart belgilanmagan
      const filled = result.months.filter((m) => m.totalTiyin !== '0' || result.months.length === 1);
      setPicked(new Set((filled.length ? filled : result.months).map((m) => m.period)));
      setActiveMonth((filled[0] ?? result.months[0])?.period ?? null);
      setReplacePrevious(result.months.some((m) => m.hasPrevious));
    } catch (err) {
      setToast({ message: errorMessage(err, "Faylni o'qib bo'lmadi"), tone: 'error' });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const pickedMonths = (many?.months ?? []).filter((m) => picked.has(m.period));
  // Ismi noma'lum yangi xodimlar — belgilangan oylar bo'yicha (bir xodim — bir marta)
  const missingNames = new Set(pickedMonths.flatMap((m) => m.rows.filter((r) => !r.fullName && (names[r.pinfl] ?? '').trim().length < 3).map((r) => r.pinfl))).size;
  const previousMonths = pickedMonths.filter((m) => m.hasPrevious);

  async function handleSave() {
    if (!many || !pickedMonths.length || missingNames > 0) return;
    setSaving(true);
    const done: string[] = [];
    let total = 0n;
    let newStaff = 0;
    let movedIn = 0;
    let inGeneral = 0;
    try {
      for (const m of pickedMonths) {
        // Shu oy umumiy vedomostda bor xodimlar yuborilmaydi (server ham olmaydi)
        inGeneral += m.rows.filter((r) => r.inGeneral).length;
        const rows = m.rows.filter((r) => !r.inGeneral).map((r) => ({ pinfl: r.pinfl, amountTiyin: r.amountTiyin, fullName: r.fullName ? null : (names[r.pinfl] ?? '').trim() }));
        if (!rows.length) continue;
        const res = (await unitPayrollApi.commit(unit.code, m.period, { rows, fileName: many.fileName }, replacePrevious && m.hasPrevious)).data;
        done.push(m.monthLabel);
        total += BigInt(res.totalTiyin);
        newStaff += res.newStaff;
        movedIn += res.movedIn ?? 0;
      }
      setToast({
        tone: 'success',
        message: `${done.join(', ')} saqlandi · ${formatTiyin(total.toString())} so'm` + (newStaff ? ` · ${newStaff} yangi xodim ro'yxatga qo'shildi` : '') + (movedIn ? ` · ${movedIn} xodim boshqa bo'limdan shu bo'limga ko'chdi` : '') + (inGeneral ? ` · ${inGeneral} tasi umumiy vedomostda bor — olinmadi` : '') + (replacePrevious && previousMonths.length ? ` · ${previousMonths.length} oyda oldingisi almashtirildi` : ''),
      });
      reset();
    } catch (err) {
      setToast({ message: `${done.length ? `${done.join(', ')} saqlandi; ` : ''}${errorMessage(err, 'Saqlashda xatolik')}`, tone: 'error' });
    } finally {
      setSaving(false);
      batches.reload();
      staff.reload();
    }
  }

  async function handleCancelBatch() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await unitPayrollApi.cancel(unit.code, period, cancelTarget.id);
      setToast({ message: 'Yuklash bekor qilindi, xarajat savatga tushdi', tone: 'success' });
      batches.reload();
    } catch (err) {
      setToast({ message: errorMessage(err, 'Bekor qilishda xatolik'), tone: 'error' });
    } finally {
      setCancelling(false);
      setCancelTarget(null);
    }
  }

  return (
    <div className="space-y-4">
      {!ndflMode && <MonthRangeCard range={range} />}
      <SourceActions
        upload={
          isAdmin
            ? {
                label: ndflMode ? 'Soliq hisobotini yuklash' : 'Vedomostni yuklash',
                onClick: () => inputRef.current?.click(),
                loading: uploading,
                disabled: Boolean(analysis),
                hint: analysis ? 'Avval joriy tahlilni saqlang yoki bekor qiling' : ndflMode ? 'JShDS hisob-kitobi: 4-ilova (oylik) va 5-ilova (boshqa daromadlar)' : `${unit.label} ish haqi vedomosti (Excel)`,
              }
            : undefined
        }
        template={ndflMode ? undefined : { label: range.error ? 'Shablon' : `Shablon · ${range.text}`, onClick: () => void handleTemplate(), loading: downloading, disabled: Boolean(range.error), hint: `Har oy — alohida ustun (PINFL, F.I.Sh., oylar) · 2-varaq: ${unit.label} xodimlari` }}
        note={
          ndflMode ? (
            <>
              Oy: <b className="text-heading">{formatPeriod(period)}</b> (yuqori paneldagi «Davr»). Faqat «hisobot davrida hisoblangan» summa olinadi (yil boshidan «jami» — olinmaydi); 4 va 5-ilovadagi summa PINFL bo&apos;yicha qo&apos;shiladi.
              Hisobotdan faqat {unit.label} xodimlari (<b className="text-heading">{activeCount}</b> ta) va hech qayerda yo&apos;q yangi xodimlar olinadi.
            </>
          ) : <>
            Shablon tanlangan oylar uchun: har oy ustuniga summa yoziladi, <b className="text-heading">0 yoki bo&apos;sh — o&apos;sha oyda hisoblanmagan</b>. Yuklanganda fayldagi hamma oylar o&apos;qiladi. Tarix — yuqori paneldagi oy ({formatPeriod(period)}). Xodimlar — faqat {unit.label} xodimlari (
            <b className="text-heading">{activeCount}</b> ta) — Xodimlar bo&apos;limidan o&apos;zi olinadi: u yerda yangi xodim qo&apos;shilsa, keyingi shablonda chiqadi.
          </>
        }
      />

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xltx"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {isAdmin && !analysis && (
        <Card>
          <CardBody>
            <div
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files[0];
                if (file) void handleFile(file);
              }}
              onClick={() => inputRef.current?.click()}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-(--radius-card) border-2 border-dashed px-6 py-12 transition-colors',
                dragging ? 'border-brand-600 bg-brand-50' : 'border-(--color-line-strong) hover:border-brand-400 hover:bg-(--color-surface-muted)',
              )}
            >
              {uploading ? (
                <>
                  <IconSpinner className="size-8 animate-spin text-brand-700" />
                  <p className="text-sm text-(--color-text-muted)">O&apos;qilmoqda…</p>
                </>
              ) : (
                <>
                  <IconUpload className="size-8 text-(--color-text-faint)" strokeWidth={1.5} />
                  <p className="text-sm font-medium">{ndflMode ? `Soliq hisoboti faylini shu yerga tashlang (${unit.label})` : `${unit.label} ish haqi vedomostini shu yerga tashlang`}</p>
                  <p className="text-xs text-(--color-text-muted)">
                    {ndflMode
                      ? "yoki bosib tanlang · 4-ilova (oylik) va 5-ilova (ta'til puli va boshqa daromadlar) · faqat shu oy summasi"
                      : "yoki bosib tanlang · PINFL va summa (yoki soliq hisobotining o'zi). Summa bo'sh yoki 0 — «hisoblanmagan»"}
                  </p>
                </>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {many?.ndfl && <NdflSummaryCard ndfl={many.ndfl} period={period} />}

      {analysis && (
        <AnalysisView
          analysis={analysis}
          monthBar={
            many && many.months.length > 1 ? (
              <MonthBar months={many.months} picked={picked} active={analysis.period} onPick={setPicked} onActive={setActiveMonth} />
            ) : null
          }
          extraInvalid={many?.format === 'MONTHS' ? many.invalidRows : undefined}
          previousNote={previousMonths.length ? `${previousMonths.map((m) => m.monthLabel).join(', ')} uchun oldin vedomost saqlangan` : null}
          saveLabel={pickedMonths.length > 1 ? `Saqlash (${pickedMonths.length} oy)` : 'Saqlash'}
          canSave={pickedMonths.length > 0}
          names={names}
          onName={(pinfl, v) => setNames((s) => ({ ...s, [pinfl]: v }))}
          missingNames={missingNames}
          replacePrevious={replacePrevious}
          onReplaceChange={setReplacePrevious}
          saving={saving}
          onSave={() => void handleSave()}
          onCancel={reset}
        />
      )}

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <SavedCard
          unit={unit}
          period={period}
          data={savedList.data?.data ?? null}
          loading={savedList.loading}
          error={savedList.error}
          onChanged={() => {
            batches.reload();
            savedList.reload();
            staff.reload();
          }}
          onToast={setToast}
        />
        <StaffCard unit={unit} list={staff.data?.data ?? null} loading={staff.loading} error={staff.error} onChanged={staff.reload} onToast={setToast} period={staffPeriod} onPeriod={setStaffPeriod} />
      </div>

      {!ndflMode && (
        <TarkibCompareCard
          unitCode={unit.code}
          period={period}
          isAdmin={isAdmin}
          stamp={savedList.data}
          onChanged={() => {
            batches.reload();
            staff.reload();
          }}
          onToast={setToast}
        />
      )}

      {/* Yuklashlar tarixi — pastda */}
        <Card className="overflow-hidden">
          <CardHeader title="Yuklashlar tarixi" description={`${unit.label} · ${formatPeriod(period)}`} />
          {batches.loading ? (
            <LoadingState />
          ) : batches.error ? (
            <p className="px-5 py-6 text-sm text-(--color-expense)">{batches.error}</p>
          ) : (batches.data?.data.length ?? 0) === 0 ? (
            <EmptyState title="Bu oyda yuklash yo'q" />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Fayl</Th>
                  <Th className="w-28">Holat</Th>
                  <Th align="center" className="w-20">
                    Xodim
                  </Th>
                  <Th align="right" className="w-36">
                    Summa
                  </Th>
                  <Th className="w-24" />
                </Tr>
              </THead>
              <TBody>
                {batches.data?.data.map((b) => (
                  <Tr key={b.id} className={cn(b.status === 'CANCELLED' && 'opacity-50')}>
                    <Td>
                      <span className="block truncate">{b.fileName}</span>
                      <p className="text-xs text-(--color-text-muted)">
                        {formatDateTime(b.createdAt)}
                        {b.uploadedBy ? ` · ${b.uploadedBy}` : ''}
                        {b.newStaff ? ` · +${b.newStaff} yangi xodim` : ''}
                      </p>
                    </Td>
                    <Td>
                      <Badge tone={b.status === 'COMMITTED' ? 'income' : 'neutral'} className="whitespace-nowrap">{b.status === 'COMMITTED' ? 'Saqlangan' : 'Bekor qilingan'}</Badge>
                    </Td>
                    <Td align="center" className="money text-(--color-text-muted)">
                      {b.count}
                    </Td>
                    <Td money>
                      <Money tiyin={b.totalTiyin} tone="expense" />
                    </Td>
                    <Td>
                      {isAdmin && b.status === 'COMMITTED' && (
                        <Button variant="ghost" size="sm" onClick={() => setCancelTarget(b)} className="text-(--color-text-muted) hover:text-(--color-expense)">
                          Bekor qilish
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>


      <ConfirmDialog
        open={cancelTarget !== null}
        title="Yuklashni bekor qilish"
        message={`${cancelTarget?.fileName ?? ''} bekor qilinadi. Undan yaratilgan xarajat savatga tushadi. Xodimlar ro'yxati o'zgarmaydi.`}
        confirmLabel="Bekor qilish"
        danger
        loading={cancelling}
        onConfirm={() => void handleCancelBatch()}
        onCancel={() => setCancelTarget(null)}
      />

      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </div>
  );
}

// ─────────── Tahlil natijasi ───────────

function AnalysisView({
  analysis,
  monthBar,
  extraInvalid,
  previousNote,
  saveLabel,
  canSave,
  names,
  onName,
  missingNames,
  replacePrevious,
  onReplaceChange,
  saving,
  onSave,
  onCancel,
}: {
  analysis: UnitAnalyzeResult;
  /** Bir necha oy: oylar tanlovi (qaysilari saqlanadi, qaysi biri ko'rinadi) */
  monthBar?: ReactNode;
  /** Fayl bo'yicha o'qilmagan kataklar (oylar shablonida) */
  extraInvalid?: { rowIndex: number; reason: string }[];
  /** Oldin saqlangan oylar (null — yo'q) */
  previousNote: string | null;
  saveLabel: string;
  canSave: boolean;
  names: Record<string, string>;
  onName: (pinfl: string, value: string) => void;
  missingNames: number;
  replacePrevious: boolean;
  onReplaceChange: (v: boolean) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [onlyNew, setOnlyNew] = useState(analysis.newRows + analysis.returningRows > 0);
  const rows = onlyNew ? analysis.rows.filter((r) => r.status !== 'KNOWN') : analysis.rows;

  return (
    <Card className="overflow-hidden">
      <CardHeader title={`Tahlil: ${analysis.fileName}`} description={`${analysis.label} · ${formatPeriod(analysis.period)} — hali saqlanmagan`} />
      <CardBody className="space-y-4">
        {monthBar}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryBox label="Xodim" value={String(analysis.validRows)} />
          <SummaryBox label="Jami summa" value={formatTiyin(analysis.totalTiyin)} tone="expense" />
          <SummaryBox label="Hisoblanmagan" value={String(analysis.zeroRows)} tone={analysis.zeroRows ? 'warn' : 'neutral'} />
          <SummaryBox label="Yangi xodim" value={String(analysis.newRows)} tone={analysis.newRows ? 'income' : 'neutral'} />
          <SummaryBox label="Xato qator" value={String(analysis.invalidRows.length)} tone={analysis.invalidRows.length ? 'expense' : 'neutral'} />
        </div>

        {analysis.newRows + analysis.returningRows > 0 && (
          <Note tone="brand">
            {analysis.newRows ? `${analysis.newRows} ta yangi xodim` : ''}
            {analysis.newRows && analysis.returningRows ? ' va ' : ''}
            {analysis.returningRows ? `${analysis.returningRows} ta qaytgan xodim` : ''} saqlanganda {analysis.label} xodimlari ro&apos;yxatiga qo&apos;shiladi — keyingi shablonning
            2-varag&apos;ida chiqadi.
            {analysis.unnamedRows ? ` ${analysis.unnamedRows} tasining ismi bazada yo'q — jadvalda F.I.Sh. kiriting.` : ''}
          </Note>
        )}
        {(analysis.inGeneralRows ?? 0) > 0 && (
          <Note tone="warn">
            {analysis.inGeneralRows} ta xodimning shu oy ish haqisi umumiy vedomostda (Xarajatlar › Ish haqi) allaqachon bor —{' '}
            {formatTiyin(analysis.inGeneralTiyin ?? '0')} so&apos;m. Ular bu bo&apos;limga olinmaydi (ish haqi ikki marta sanalmasin). Bu bo&apos;limga o&apos;tkazmoqchi bo&apos;lsangiz — umumiy vedomostni qayta
            yuklab, ularni shu bo&apos;limga belgilang.
          </Note>
        )}
        {(analysis.movedRows ?? 0) > 0 && (
          <Note tone="warn">
            {analysis.movedRows} ta xodim bu oyda boshqa bo&apos;limda edi (ko&apos;chishlar tarixi bo&apos;yicha), lekin bu vedomostda summasi bor. Saqlansa — shu oydan {analysis.label}{' '}
            bo&apos;limiga ko&apos;chirilgan deb yoziladi (oldingi oylar o&apos;zgarmaydi). Noto&apos;g&apos;ri bo&apos;lsa — pastdagi «Ko&apos;chishlar»dan bekor qilinadi.
          </Note>
        )}
        {(extraInvalid ?? analysis.invalidRows).length > 0 && (
          <Note tone="expense">
            O&apos;qilmagan kataklar (o&apos;sha oyda shu xodim saqlanmaydi — tuzatib qayta yuklang): {(extraInvalid ?? analysis.invalidRows).slice(0, 12).map((r) => `${r.rowIndex}-qator (${r.reason})`).join(', ')}
            {(extraInvalid ?? analysis.invalidRows).length > 12 ? ` va yana ${(extraInvalid ?? analysis.invalidRows).length - 12} ta` : ''}.
          </Note>
        )}
        {analysis.duplicates.length > 0 && <Note tone="warn">Takror PINFL ({analysis.duplicates.length} ta) — summalari qo&apos;shildi: {analysis.duplicates.slice(0, 6).join(', ')}{analysis.duplicates.length > 6 ? ' …' : ''}</Note>}
        {analysis.notInFile.length > 0 && (
          <Note tone="neutral">
            Ro&apos;yxatdagi {analysis.notInFile.length} xodim faylda yo&apos;q: {analysis.notInFile.slice(0, 8).map((x) => x.fullName).join(', ')}
            {analysis.notInFile.length > 8 ? ' …' : ''}. Ishdan ketgan bo&apos;lsa — pastdagi ro&apos;yxatdan chiqaring.
          </Note>
        )}

        {previousNote && (
          <div className="rounded-(--radius-control) bg-(--color-surface-muted) p-3">
            <p className="mb-2 text-sm font-medium">{previousNote}</p>
            <div className="grid gap-2 md:grid-cols-2">
              <Choice checked={replacePrevious} onChange={() => onReplaceChange(true)} title="Almashtirish" description="Oldingisi bekor qilinadi, xarajati savatga tushadi" />
              <Choice checked={!replacePrevious} onChange={() => onReplaceChange(false)} title="Qo'shish" description="Oldingisi qoladi, bu vedomost alohida qo'shiladi" />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-brand-600" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />
            Faqat yangi va qaytganlar
          </label>
          <span className="text-xs text-(--color-text-muted)">
            {rows.length} / {analysis.rows.length} qator
          </span>
        </div>

        <div className="max-h-[440px] overflow-auto rounded-(--radius-control) border border-(--color-line)">
          <Table>
            <THead>
              <Tr>
                <Th className="w-16">Qator</Th>
                <Th className="w-40">PINFL</Th>
                <Th>F.I.Sh.</Th>
                <Th className="w-36">Holat</Th>
                <Th align="right" className="w-40">
                  Summa
                </Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.pinfl}>
                  <Td className="money text-(--color-text-muted)">{r.rowIndex}</Td>
                  <Td className="money">{r.pinfl}</Td>
                  <Td>
                    {r.fullName ? (
                      <span>{r.fullName}</span>
                    ) : (
                      <input
                        value={names[r.pinfl] ?? ''}
                        onChange={(e) => onName(r.pinfl, e.target.value)}
                        placeholder="F.I.Sh. kiriting"
                        maxLength={150}
                        aria-label={`${r.pinfl} — F.I.Sh.`}
                        className={cn(
                          'h-8 w-full rounded-(--radius-control) border bg-white px-2 text-sm',
                          (names[r.pinfl] ?? '').trim().length >= 3 ? 'border-(--color-line-strong)' : 'border-amber-400',
                        )}
                      />
                    )}
                  </Td>
                  <Td>
                    <Badge tone={STATUS[r.status].tone} className="whitespace-nowrap">{STATUS[r.status].label}</Badge>
                    {r.otherUnitLabel && (
                      <span className="mt-0.5 block text-[11px] whitespace-nowrap text-(--color-warn)" title="Bu oyda boshqa bo'limda edi — summa bilan saqlansa, shu oydan shu bo'limga ko'chadi">
                        bu oyda: {r.otherUnitLabel}
                        {r.amountTiyin !== '0' ? ' → ko‘chadi' : ''}
                      </span>
                    )}
                    {r.inGeneral && <span className="mt-0.5 block text-[11px] whitespace-nowrap text-(--color-expense)">umumiy vedomostda bor — olinmaydi</span>}
                  </Td>
                  <Td money>{r.amountTiyin === '0' ? <span className="text-(--color-text-muted)">hisoblanmagan</span> : <Money tiyin={r.amountTiyin} />}</Td>
                </Tr>
              ))}
            </TBody>
            <TFoot>
              <Tr>
                <Td colSpan={4} className="font-semibold">
                  Jami ({analysis.validRows} xodim)
                </Td>
                <Td money className="font-semibold">
                  <Money tiyin={analysis.totalTiyin} tone="expense" />
                </Td>
              </Tr>
            </TFoot>
          </Table>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {missingNames > 0 && (
            <span className="mr-auto flex items-center gap-1.5 text-xs text-amber-800">
              <IconAlert className="size-4" />
              {missingNames} ta yangi xodimning F.I.Sh. kiritilmagan
            </span>
          )}
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Bekor qilish
          </Button>
          <Button onClick={onSave} loading={saving} disabled={missingNames > 0 || !canSave}>
            <IconCheck className="size-4" />
            {saveLabel}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

// ─────────── Bo'lim xodimlari ro'yxati («miya») ───────────

function StaffCard({
  unit,
  list,
  loading,
  error,
  onChanged,
  onToast,
  period,
  onPeriod,
}: {
  unit: EntryUnit;
  list: UnitStaffList | null;
  loading: boolean;
  error: string | null;
  onChanged: () => void;
  onToast: (t: ToastState) => void;
  /** Ro'yxat qaysi oy uchun (ko'chishlar bilan) */
  period: string;
  onPeriod: (p: string) => void;
}) {
  const { isAdmin } = useAuth();
  const [q, setQ] = useState('');
  const [showLeft, setShowLeft] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pinfl, setPinfl] = useState('');
  const [fullName, setFullName] = useState('');
  const [position, setPosition] = useState('');
  /** Boshqa bo'limdan shu oydan boshlab o'tkazish (bo'sh — doimiy ro'yxatga qo'shish) */
  const [addFrom, setAddFrom] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  /** Ko'chirish shakli ochiq xodim */
  const [moving, setMoving] = useState<string | null>(null);
  const [moveUnit, setMoveUnit] = useState('');
  const [moveFrom, setMoveFrom] = useState(period);
  const [moveNote, setMoveNote] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const history = useAsync(() => (historyOpen ? unitPayrollApi.moves(unit.code) : Promise.resolve(null)), [unit.code, historyOpen, list?.total, list?.items.length]);
  const moveList = history.data?.data.items ?? [];
  const away = list?.away ?? [];

  async function submitMove(s: { pinfl: string; fullName: string }) {
    if (!moveUnit || !/^\d{4}-\d{2}$/.test(moveFrom)) return;
    setBusy(`m:${s.pinfl}`);
    try {
      await unitPayrollApi.addMove(unit.code, { pinfl: s.pinfl, unit: moveUnit, from: moveFrom, note: moveNote.trim() || undefined });
      onToast({ message: `${s.fullName}: ${formatPeriod(moveFrom)}dan «${MOVE_UNITS.find((u) => u.code === moveUnit)?.label ?? moveUnit}» bo'limida — oldingi oylar o'zgarmaydi`, tone: 'success' });
      setMoving(null);
      setMoveNote('');
      onChanged();
      history.reload();
    } catch (err) {
      onToast({ message: errorMessage(err, "Ko'chirib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function undoMove(id: string) {
    setBusy(`u:${id}`);
    try {
      await unitPayrollApi.removeMove(unit.code, id);
      onToast({ message: "Ko'chish bekor qilindi", tone: 'success' });
      onChanged();
      history.reload();
    } catch (err) {
      onToast({ message: errorMessage(err, "Bekor qilib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }
  const link = useAsync(() => unitPayrollApi.link(unit.code), [unit.code, list?.total]);
  const linkInfo = link.data?.data;
  const linkedDeps = (linkInfo?.departments ?? []).filter((d) => d.selected);

  const items = list?.items ?? [];
  const term = q.trim().toLowerCase();
  const shown = items.filter((s) => (showLeft || s.active) && (!term || s.fullName.toLowerCase().includes(term) || s.pinfl.includes(term)));
  const leftCount = items.filter((s) => !s.active).length;

  async function lookup(value: string) {
    const digits = value.replace(/\D/g, '');
    setPinfl(digits);
    setHint(null);
    if (digits.length !== 14) return;
    try {
      const res = (await unitPayrollApi.lookup(unit.code, digits)).data;
      if (res.inStaff && res.active) setHint("Bu xodim ro'yxatda allaqachon bor");
      else if (res.fullName) {
        setFullName((v) => v || res.fullName || '');
        setPosition((v) => v || res.position || '');
        setHint(res.inStaff ? 'Chiqarilganlar ro‘yxatida — qaytariladi' : 'Xodimlar bazasidan topildi');
      } else setHint("Bazada yo'q — F.I.Sh. kiriting");
    } catch {
      /* tekshiruv ixtiyoriy */
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy('add');
    try {
      if (addFrom) {
        // Boshqa bo'limdan ko'chib keldi — shu oydan (oldingi oylar o'sha bo'limda qoladi)
        await unitPayrollApi.addMove(unit.code, { pinfl, unit: unit.code, from: addFrom, fullName: fullName.trim() || undefined });
        onToast({ message: `${fullName || pinfl}: ${formatPeriod(addFrom)}dan ${unit.label} bo'limida`, tone: 'success' });
      } else {
        await unitPayrollApi.addStaff(unit.code, { pinfl, fullName: fullName.trim() || undefined, position: position.trim() || undefined });
        onToast({ message: `Xodim qo'shildi — keyingi shablonda chiqadi`, tone: 'success' });
      }
      setAddFrom('');
      setPinfl('');
      setFullName('');
      setPosition('');
      setHint(null);
      setAdding(false);
      onChanged();
    } catch (err) {
      onToast({ message: errorMessage(err, "Qo'shib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function toggle(s: UnitStaff) {
    setBusy(s.pinfl);
    try {
      await unitPayrollApi.updateStaff(unit.code, s.pinfl, { active: !s.active });
      onToast({ message: s.active ? `${s.fullName} ro'yxatdan chiqarildi — shablonda chiqmaydi` : `${s.fullName} ro'yxatga qaytarildi`, tone: 'success' });
      onChanged();
    } catch (err) {
      onToast({ message: errorMessage(err, "O'zgartirib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function saveLink(body: { departmentIds?: string[] | null; byPosition?: boolean; byHr?: boolean }) {
    setBusy('link');
    try {
      const r = (await unitPayrollApi.setLink(unit.code, body)).data;
      onToast({ message: `Xodimlar bazasidan: ${r.linkedCount} ta xodim bog'landi — shablonda o'zi chiqadi`, tone: 'success' });
      link.reload();
      onChanged();
    } catch (err) {
      onToast({ message: errorMessage(err, "Saqlab bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="flex flex-col overflow-hidden">
      <CardHeader
        title={`${unit.label} xodimlari`}
        description={`Shablonning 2-varag'i · ${formatPeriod(period)}: faol ${list?.active ?? 0} ta`}
        actions={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-(--color-text-muted)" title="Shu oydagi tarkib — bo'limlar o'rtasida ko'chishlar hisobga olinadi">
              Oy
              <input type="month" value={period} onChange={(e) => e.target.value && onPeriod(e.target.value)} className="h-8 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-xs" />
            </label>
            {isAdmin && !adding && (
              <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
                + Xodim
              </Button>
            )}
          </div>
        }
      />
      {/* Xodimlar bazasi bilan bog'lanish */}
      <div className="border-b border-(--color-line) bg-brand-50/40 px-5 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-(--color-text-muted)">Xodimlar bazasidan:</span>
          {link.loading && !linkInfo ? (
            <span className="text-(--color-text-faint)">…</span>
          ) : linkInfo ? (
            <>
              <b className="text-heading">{linkInfo.linkedCount} ta</b>
              <span className="text-(--color-text-muted)">
                {linkedDeps.length ? `· bo'lim: ${linkedDeps.map((d) => d.name).join(', ')}` : "· bo'lim tanlanmagan"}
                {linkInfo.byPosition ? ` · lavozimida «${unit.label}» bo'lganlar` : ''}
                {linkInfo.byHr ? ` · ma'lumotnomalardan ${linkInfo.hrCount ?? 0} ta` : ''}
                {linkInfo.auto ? ' (avtomatik)' : ''}
              </span>
            </>
          ) : null}
          {isAdmin && (
            <button type="button" onClick={() => setLinkOpen((v) => !v)} className="ml-auto rounded px-2 py-1 font-semibold text-brand-700 hover:bg-brand-50">
              {linkOpen ? 'Yopish' : "Bog'lash"}
            </button>
          )}
        </div>
        {linkOpen && linkInfo && (
          <div className="mt-2 space-y-2 rounded-(--radius-control) border border-(--color-line) bg-white p-3">
            <p className="text-(--color-text-muted)">
              Qaysi bo&apos;lim xodimlari {unit.label} xodimi hisoblanadi. Xodimlar bo&apos;limida shu bo&apos;limga yangi xodim qo&apos;shilsa — keyingi shablonda o&apos;zi chiqadi.
            </p>
            <div className="max-h-48 space-y-1 overflow-auto">
              {linkInfo.departments.map((d) => (
                <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-brand-50/50">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-brand-600"
                    checked={d.selected}
                    disabled={busy === 'link'}
                    onChange={() =>
                      void saveLink({
                        departmentIds: d.selected ? linkedDeps.filter((x) => x.id !== d.id).map((x) => x.id) : [...linkedDeps.map((x) => x.id), d.id],
                      })
                    }
                  />
                  <span className="flex-1 text-heading">{d.name}</span>
                  <span className="text-(--color-text-faint)">{d.employees} xodim</span>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-(--color-line) pt-2">
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" className="size-3.5 accent-brand-600" checked={linkInfo.byPosition} disabled={busy === 'link'} onChange={() => void saveLink({ byPosition: !linkInfo.byPosition })} />
                Lavozimida «{unit.label}» yozilganlar ham (hududdagi filiallar)
              </label>
              <label className="flex cursor-pointer items-center gap-2" title="Xodimlar › Ma'lumotnomalar: tuzilmasi shu yo'nalishga tegishli va ishlayotgan xodimlar">
                <input type="checkbox" className="size-3.5 accent-brand-600" checked={linkInfo.byHr !== false} disabled={busy === 'link'} onChange={() => void saveLink({ byHr: linkInfo.byHr === false })} />
                Ma&apos;lumotnomalardan (10/16/37/51-jadval, tuzilmasi bo&apos;yicha){typeof linkInfo.hrCount === 'number' ? ` — ${linkInfo.hrCount} ta` : ''}
              </label>
              {!linkInfo.auto && (
                <button type="button" disabled={busy === 'link'} onClick={() => void saveLink({ departmentIds: null })} className="ml-auto rounded px-2 py-1 font-semibold text-brand-700 hover:bg-brand-50">
                  Avtomatikka qaytarish
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {adding && (
        <form onSubmit={(e) => void submit(e)} className="space-y-2 border-b border-(--color-line) bg-(--color-surface-muted) px-5 py-3">
          <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_minmax(0,0.8fr)]">
            <input
              autoFocus
              inputMode="numeric"
              value={pinfl}
              onChange={(e) => void lookup(e.target.value)}
              placeholder="PINFL (14 raqam)"
              maxLength={20}
              className="h-9 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-sm"
            />
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="F.I.Sh." maxLength={150} className="h-9 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-sm" />
            <input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="Lavozim (ixtiyoriy)" maxLength={120} className="h-9 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-sm" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-(--color-text-muted)" title="Boshqa bo'limdan ko'chib kelgan bo'lsa — qaysi oydan. Bo'sh — doimiy ro'yxatga qo'shiladi">
              Boshqa bo&apos;limdan, shu oydan:
              <input type="month" value={addFrom} onChange={(e) => setAddFrom(e.target.value)} className="h-8 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-xs" />
            </label>
            {hint && <span className="text-xs text-(--color-text-muted)">{hint}</span>}
            <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => setAdding(false)}>
              Bekor
            </Button>
            <Button type="submit" size="sm" loading={busy === 'add'} disabled={pinfl.length !== 14}>
              Qo&apos;shish
            </Button>
          </div>
        </form>
      )}
      <div className="flex flex-wrap items-center gap-3 border-b border-(--color-line) px-5 py-2.5">
        <label className="relative min-w-[12rem] flex-1">
          <IconSearch className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-(--color-text-faint)" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ism yoki PINFL" className="h-8 w-full rounded-(--radius-control) border border-(--color-line) bg-white pr-2 pl-7 text-sm" />
        </label>
        {leftCount > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-(--color-text-muted)">
            <input type="checkbox" className="size-3.5 accent-brand-600" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} />
            Chiqarilganlar ({leftCount})
          </label>
        )}
      </div>
      {loading ? (
        <LoadingState />
      ) : error ? (
        <p className="px-5 py-6 text-sm text-(--color-expense)">{error}</p>
      ) : items.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm font-semibold text-heading">Hali xodim yo&apos;q</p>
          <p className="mt-1 text-xs text-(--color-text-muted)">Birinchi vedomost saqlanganda ro&apos;yxat o&apos;zi to&apos;ladi — yoki «+ Xodim» bilan qo&apos;shing.</p>
        </div>
      ) : (
        <ul className="max-h-[480px] overflow-auto">
          {shown.length === 0 && <li className="px-5 py-6 text-center text-xs text-(--color-text-muted)">Topilmadi</li>}
          {shown.map((s, i) => (
            <li key={s.pinfl} className={cn('flex items-center gap-3 border-b border-(--color-line) px-5 py-2', !s.active && 'opacity-55')}>
              <span className="w-6 shrink-0 text-right text-xs text-(--color-text-faint)">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-heading">{s.fullName}</p>
                <p className="truncate text-xs text-(--color-text-muted)">
                  <span className="money">{s.pinfl}</span>
                  {s.position ? ` · ${s.position}` : ''} ·{' '}
                  {s.active
                    ? s.source === 'REGISTRY'
                      ? 'Xodimlar bazasidan'
                      : s.source === 'MOVE'
                        ? "boshqa bo'limdan ko'chib kelgan"
                        : `${s.source === 'UPLOAD' ? 'vedomostdan' : "qo'lda"} ${formatDate(s.addedAt)}`
                    : `chiqarilgan ${s.leftAt ? formatDate(s.leftAt) : ''}`}
                </p>
                {(s.moves?.length ?? 0) > 0 && (
                  <p className="mt-0.5 flex flex-wrap gap-1">
                    {s.moves!.map((m) => (
                      <span key={m.id} className={cn('rounded-full px-1.5 py-0.5 text-[10.5px]', m.unit === unit.code ? 'bg-brand-50 text-brand-700' : 'bg-(--color-warn-soft) text-(--color-warn)')}>
                        {formatPeriod(m.from)}dan: {m.unitLabel}
                      </span>
                    ))}
                  </p>
                )}
                {moving === s.pinfl && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-(--radius-control) border border-(--color-line) bg-(--color-surface-muted) p-2">
                    <select value={moveUnit} onChange={(e) => setMoveUnit(e.target.value)} className="h-8 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-xs">
                      <option value="">Qaysi bo&apos;limga…</option>
                      {MOVE_UNITS.filter((u) => u.code !== unit.code).map((u) => (
                        <option key={u.code} value={u.code}>
                          {u.label}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1 text-xs text-(--color-text-muted)">
                      dan
                      <input type="month" value={moveFrom} onChange={(e) => setMoveFrom(e.target.value)} className="h-8 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-xs" />
                    </label>
                    <input value={moveNote} onChange={(e) => setMoveNote(e.target.value)} placeholder="Izoh (buyruq №)" maxLength={300} className="h-8 min-w-[8rem] flex-1 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-xs" />
                    <Button size="sm" loading={busy === `m:${s.pinfl}`} disabled={!moveUnit || !moveFrom} onClick={() => void submitMove(s)}>
                      Ko&apos;chirish
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setMoving(null)}>
                      Bekor
                    </Button>
                  </div>
                )}
              </div>
              {isAdmin && s.active && moving !== s.pinfl && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    setMoving(s.pinfl);
                    setMoveUnit('');
                    setMoveFrom(period);
                  }}
                  className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
                  title="Boshqa bo'limga o'tkazish — tanlangan oydan boshlab (oldingi oylar shu bo'limda qoladi)"
                >
                  Ko&apos;chirish
                </button>
              )}
              {isAdmin && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void toggle(s)}
                  className={cn(
                    'shrink-0 rounded-md px-2 py-1 text-xs font-medium',
                    s.active ? 'text-(--color-text-muted) hover:bg-(--color-expense-soft) hover:text-(--color-expense)' : 'text-brand-700 hover:bg-brand-50',
                  )}
                >
                  {busy === s.pinfl ? '…' : s.active ? 'Chiqarish' : 'Qaytarish'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {/* Shu oyda boshqa bo'limda bo'lganlar */}
      {away.length > 0 && (
        <div className="border-t border-(--color-line) bg-(--color-warn-soft)/40 px-5 py-2.5 text-xs">
          <p className="font-semibold text-heading">
            {formatPeriod(period)}da boshqa bo&apos;limda: {away.length} ta
          </p>
          <ul className="mt-1 space-y-0.5">
            {away.map((a) => (
              <li key={a.pinfl} className="flex flex-wrap items-center gap-x-2 text-(--color-text-muted)">
                <span className="text-heading">{a.fullName}</span>
                <span>→ {a.unitLabel}</span>
                <span className="text-(--color-text-faint)">{a.moves.map((m) => `${formatPeriod(m.from)}: ${m.unitLabel}`).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* Ko'chishlar tarixi («miya») */}
      <div className="border-t border-(--color-line) px-5 py-2.5 text-xs">
        <button type="button" onClick={() => setHistoryOpen((v) => !v)} className="font-semibold text-brand-700 hover:underline">
          {historyOpen ? '▾' : '▸'} Ko&apos;chishlar tarixi (bo&apos;limlar o&apos;rtasida)
        </button>
        {historyOpen &&
          (history.loading && !history.data ? (
            <p className="mt-2 text-(--color-text-faint)">…</p>
          ) : moveList.length === 0 ? (
            <p className="mt-2 text-(--color-text-muted)">Hali ko&apos;chish yo&apos;q. Xodim qatorida «Ko&apos;chirish» — tanlangan oydan boshqa bo&apos;limga o&apos;tkazadi.</p>
          ) : (
            <table className="mt-2 w-full">
              <tbody>
                {moveList.map((m) => (
                  <tr key={m.id} className="border-t border-(--color-line)/70">
                    <td className="py-1 pr-2 whitespace-nowrap text-(--color-text-muted)">{formatPeriod(m.from)}dan</td>
                    <td className="py-1 pr-2 text-heading">{m.fullName}</td>
                    <td className="py-1 pr-2 whitespace-nowrap">
                      {m.fromUnitLabel ?? '—'} → <b className="text-heading">{m.unitLabel}</b>
                    </td>
                    <td className="py-1 pr-2 text-(--color-text-faint)">{[m.source === 'UPLOAD' ? 'vedomostdan' : "qo'lda", m.note].filter(Boolean).join(' · ')}</td>
                    <td className="py-1 text-right">
                      {isAdmin && (
                        <button type="button" disabled={busy !== null} onClick={() => void undoMove(m.id)} className="rounded px-1.5 py-0.5 text-(--color-text-muted) hover:bg-(--color-expense-soft) hover:text-(--color-expense)">
                          {busy === `u:${m.id}` ? '…' : 'Bekor qilish'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </div>
    </Card>
  );
}

// ─────────── Kichik qismlar ───────────

function SummaryBox({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'income' | 'expense' | 'warn' }) {
  const colors = { neutral: 'text-(--color-text)', income: 'text-(--color-income)', expense: 'text-(--color-expense)', warn: 'text-(--color-warn)' };
  return (
    <div className="rounded-(--radius-card) border border-(--color-line) bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">{label}</p>
      <p className={cn('money mt-2 text-xl font-semibold', colors[tone])}>{value}</p>
    </div>
  );
}

function Note({ tone, children }: { tone: 'brand' | 'warn' | 'expense' | 'neutral'; children: React.ReactNode }) {
  const cls = {
    brand: 'border-brand-200 bg-brand-50 text-brand-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    expense: 'border-(--color-expense)/30 bg-(--color-expense-soft) text-(--color-expense)',
    neutral: 'border-(--color-line) bg-(--color-surface-muted) text-(--color-text-muted)',
  }[tone];
  return <p className={cn('rounded-(--radius-control) border px-3 py-2 text-xs', cls)}>{children}</p>;
}

function Choice({ checked, onChange, title, description }: { checked: boolean; onChange: () => void; title: string; description: string }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2.5 rounded-(--radius-control) border bg-white px-3 py-2.5', checked ? 'border-brand-600' : 'border-transparent')}>
      <input type="radio" checked={checked} onChange={onChange} className="mt-0.5 size-4" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-(--color-text-muted)">{description}</span>
      </span>
    </label>
  );
}

// ─────────── Oylar tanlovi (oylar oralig'i shabloni) ───────────

function MonthBar({
  months,
  picked,
  active,
  onPick,
  onActive,
}: {
  months: { period: string; monthLabel: string; totalTiyin: string; paidRows: number; zeroRows: number; hasPrevious: boolean }[];
  picked: Set<string>;
  active: string;
  onPick: (s: Set<string>) => void;
  onActive: (p: string) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-(--color-text-muted)">Fayldagi oylar — belgilanganlari saqlanadi; bosilgani pastda ko&apos;rinadi</p>
      <div className="flex flex-wrap gap-2">
        {months.map((m) => {
          const on = picked.has(m.period);
          return (
            <div
              key={m.period}
              className={cn('flex items-start gap-2 rounded-(--radius-control) border bg-white px-3 py-2', m.period === active ? 'border-brand-600 shadow-sm ring-1 ring-brand-200' : 'border-(--color-line)')}
            >
              <input
                type="checkbox"
                aria-label={`${m.monthLabel} — saqlash`}
                className="mt-0.5 size-4 accent-brand-600"
                checked={on}
                onChange={() => {
                  const x = new Set(picked);
                  if (x.has(m.period)) x.delete(m.period);
                  else x.add(m.period);
                  onPick(x);
                }}
              />
              <button type="button" onClick={() => onActive(m.period)} className="text-left">
                <span className="block text-sm font-semibold text-heading">{m.monthLabel}</span>
                <span className="money block text-xs text-(--color-text-muted)">
                  {m.totalTiyin === '0' ? 'hammasi 0 — hisoblanmagan' : `${formatTiyin(m.totalTiyin)} so'm · ${m.paidRows} xodim`}
                  {m.zeroRows && m.totalTiyin !== '0' ? ` · ${m.zeroRows} hisoblanmagan` : ''}
                </span>
                <span className={cn('block text-[11px]', m.hasPrevious ? 'text-amber-700' : 'text-emerald-700')}>{m.hasPrevious ? 'oldin saqlangan' : 'yangi'}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────── Saqlangan ish haqi — kim, qancha (shu oy) ───────────

/**
 * Shu oy saqlangan ish haqi: har xodim birma-bir (F.I.Sh., PINFL, summa, qaysi yuklashdan).
 * Belgilab: o'chirish (ish haqidan olib tashlash) yoki «shu oyda boshqa bo'limda ishlagan» — o'sha bo'limga o'tkazish
 * (summasi bilan va/yoki faqat shu oy). Ish haqi xarajati o'zi qayta hisoblanadi.
 */
function SavedCard({
  unit,
  period,
  data,
  loading,
  error,
  onChanged,
  onToast,
}: {
  unit: EntryUnit;
  period: string;
  data: UnitSaved | null;
  loading: boolean;
  error: string | null;
  onChanged: () => void;
  onToast: (t: ToastState) => void;
}) {
  const { isAdmin } = useAuth();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'move' | null>(null);
  const [choice, setChoice] = useState<MoveChoice>(EMPTY_CHOICE);
  const [onlyThisMonth, setOnlyThisMonth] = useState(true);
  const [withAmount, setWithAmount] = useState(true);
  const [confirmDel, setConfirmDel] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = data?.rows ?? [];
  const term = q.trim().toLowerCase();
  const shown = rows.filter((r) => !term || r.fullName.toLowerCase().includes(term) || r.pinfl.includes(term));
  const picked = rows.filter((r) => sel.has(r.pinfl));
  const pickedTotal = picked.reduce((s, r) => s + BigInt(r.amountTiyin), 0n);
  const shownTotal = shown.reduce((s, r) => s + BigInt(r.amountTiyin), 0n);
  const allShown = shown.length > 0 && shown.every((r) => sel.has(r.pinfl));
  const ready = choiceReady(choice);
  const targetLabel = useChoiceLabel(choice);

  async function remove(pinfls: string[]) {
    setBusy(true);
    try {
      const r = (await unitPayrollApi.removeRows(unit.code, period, pinfls)).data;
      onToast({ message: `${r.removed} xodim ${formatPeriod(period)} ish haqidan olib tashlandi · ${formatTiyin(r.totalTiyin)} so'm`, tone: 'success' });
      setSel(new Set());
      setConfirmDel(null);
      onChanged();
    } catch (err) {
      onToast({ message: errorMessage(err, "O'chirib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function move() {
    if (!ready || !picked.length) return;
    setBusy(true);
    try {
      const r = (await unitPayrollApi.moveRows(unit.code, period, { pinfls: picked.map((p) => p.pinfl), target: choice.target, place: choice.place, onlyThisMonth, withAmount })).data;
      onToast({
        message: `${r.moved} xodim ${formatPeriod(period)}da «${r.targetLabel}» bo'limida${withAmount ? ` · ${formatTiyin(r.totalTiyin)} so'm o'sha yerga o'tkazildi` : ''}${onlyThisMonth ? ' · keyingi oydan yana shu yerda' : ''}`,
        tone: 'success',
      });
      setSel(new Set());
      setMode(null);
      setChoice(EMPTY_CHOICE);
      onChanged();
    } catch (err) {
      onToast({ message: errorMessage(err, "O'tkazib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const toggle = (p: string) => setSel((x) => { const n = new Set(x); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  return (
    <Card className="flex flex-col overflow-hidden">
      <CardHeader
        title={`Saqlangan ish haqi · ${formatPeriod(period)}`}
        description={data ? `${data.count} xodim · ${data.paidCount} tasiga hisoblangan · jami ${formatTiyin(data.totalTiyin)} so'm${data.batches > 1 ? ` · ${data.batches} ta yuklashdan` : ''}` : `${unit.label}`}
      />
      {Number(data?.splitTiyin ?? 0) > 0 && (
        <p className="border-b border-(--color-line) bg-brand-50/40 px-5 py-2 text-xs text-(--color-text-muted)">
          Ish haqi qismlari siyosat bo&apos;yicha boshqa bo&apos;limga ajratilgan: <b className="text-heading">{formatTiyin(data!.splitTiyin)}</b> so&apos;m (xarajatda ayirilgan; bu jadvalda — to&apos;liq summa)
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3 border-b border-(--color-line) px-5 py-2.5">
        <label className="relative min-w-[12rem] flex-1">
          <IconSearch className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-(--color-text-faint)" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ism yoki PINFL" className="h-8 w-full rounded-(--radius-control) border border-(--color-line) bg-white pr-2 pl-7 text-sm" />
        </label>
        {term && <span className="text-xs text-(--color-text-muted)">{shown.length} ta · {formatTiyin(shownTotal.toString())} so&apos;m</span>}
      </div>
      {isAdmin && sel.size > 0 && (
        <div className="space-y-2 border-b border-(--color-line) bg-brand-50/60 px-5 py-2.5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-heading">{sel.size} ta belgilandi</b>
            <span className="text-xs text-(--color-text-muted)">· {formatTiyin(pickedTotal.toString())} so&apos;m</span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setMode(mode === 'move' ? null : 'move')}>
                Boshqa bo&apos;limda ishlagan…
              </Button>
              <Button size="sm" variant="danger" onClick={() => setConfirmDel(picked.map((p) => p.pinfl))}>
                O&apos;chirish
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>
                Bekor
              </Button>
            </div>
          </div>
          {mode === 'move' && (
            <div className="flex flex-wrap items-center gap-3 rounded-(--radius-control) border border-(--color-line) bg-white p-2.5 text-xs">
              <span className="text-(--color-text-muted)">{formatPeriod(period)}da qaysi bo&apos;limda ishlagan:</span>
              <PlacePicker value={choice} onChange={setChoice} exclude={unit.code} />
              <label className="flex items-center gap-1.5" title="Belgilansa — ish haqi summasi o'sha bo'limga o'tadi (yo'nalishda — uning vedomostiga; Markaz yoki hududda — ish haqi xarajati)">
                <input type="checkbox" className="size-3.5 accent-brand-600" checked={withAmount} onChange={(e) => setWithAmount(e.target.checked)} />
                Summasi bilan
              </label>
              <label className="flex items-center gap-1.5" title="Belgilansa — keyingi oydan yana shu bo'limda; aks holda — shu oydan boshlab o'sha bo'limda qoladi">
                <input type="checkbox" className="size-3.5 accent-brand-600" checked={onlyThisMonth} onChange={(e) => setOnlyThisMonth(e.target.checked)} />
                Faqat shu oy
              </label>
              <Button size="sm" className="ml-auto" loading={busy} disabled={!ready} onClick={() => void move()}>
                {ready ? `«${targetLabel}»ga o'tkazish` : "O'tkazish"}
              </Button>
            </div>
          )}
        </div>
      )}
      {loading && !data ? (
        <LoadingState />
      ) : error ? (
        <p className="px-5 py-6 text-sm text-(--color-expense)">{error}</p>
      ) : rows.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm font-semibold text-heading">{formatPeriod(period)} uchun ish haqi saqlanmagan</p>
          <p className="mt-1 text-xs text-(--color-text-muted)">Vedomost yuklab saqlangach, har bir xodim shu yerda ko&apos;rinadi.</p>
        </div>
      ) : (
        <div className="max-h-[540px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-[1] bg-(--color-surface-muted) text-[11px] uppercase tracking-wide text-(--color-text-muted)">
              <tr>
                <th className="w-9 px-3 py-2">
                  {isAdmin && <input type="checkbox" className="size-3.5 accent-brand-600" checked={allShown} onChange={() => setSel(allShown ? new Set() : new Set(shown.map((r) => r.pinfl)))} aria-label="Hammasini belgilash" />}
                </th>
                <th className="w-8 px-1 py-2 text-right font-semibold">№</th>
                <th className="px-2 py-2 text-left font-semibold">Xodim</th>
                <th className="w-36 px-2 py-2 text-right font-semibold">Summa</th>
                <th className="w-24 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r.pinfl} className={cn('border-t border-(--color-line)', sel.has(r.pinfl) ? 'bg-brand-50/60' : 'hover:bg-brand-50/30')}>
                  <td className="px-3 py-1.5">{isAdmin && <input type="checkbox" className="size-3.5 accent-brand-600" checked={sel.has(r.pinfl)} onChange={() => toggle(r.pinfl)} aria-label="Belgilash" />}</td>
                  <td className="px-1 py-1.5 text-right text-xs text-(--color-text-faint)">{i + 1}</td>
                  <td className="px-2 py-1.5">
                    <p className="text-heading">{r.fullName}</p>
                    <p className="text-xs text-(--color-text-muted)">
                      <span className="money">{r.pinfl}</span>
                      {r.position ? ` · ${r.position}` : ''}
                      {r.batches.length > 1 ? ` · ${r.batches.length} ta yuklashda` : ''}
                    </p>
                    {r.otherUnitLabel && (
                      <span className="mt-0.5 inline-block rounded-full bg-(--color-warn-soft) px-1.5 py-0.5 text-[10.5px] text-(--color-warn)" title="Ko'chishlar tarixi bo'yicha shu oyda boshqa bo'limda">
                        bu oyda: {r.otherUnitLabel}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right">{r.amountTiyin === '0' ? <span className="text-xs text-(--color-text-muted)">hisoblanmagan</span> : <Money tiyin={r.amountTiyin} />}</td>
                  <td className="px-2 py-1.5 text-right">
                    {isAdmin && (
                      <span className="inline-flex gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setSel(new Set([r.pinfl]));
                            setMode('move');
                            setChoice({ target: r.otherUnit && MOVE_UNITS.some((u) => u.code === r.otherUnit) ? r.otherUnit : '', place: {} });
                          }}
                          className="rounded px-1.5 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50"
                          title="Shu oyda boshqa bo'limda ishlagan — o'sha bo'limga o'tkazish"
                        >
                          Bo&apos;lim
                        </button>
                        <button type="button" onClick={() => setConfirmDel([r.pinfl])} className="rounded px-1.5 py-0.5 text-xs text-(--color-text-muted) hover:bg-(--color-expense-soft) hover:text-(--color-expense)" title="Shu oy ish haqidan olib tashlash">
                          O&apos;chirish
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 bg-(--color-surface-muted) text-sm font-semibold text-heading">
              <tr>
                <td colSpan={3} className="px-3 py-2">
                  Jami{term ? ' (topilganlar)' : ''}: {shown.length} xodim
                </td>
                <td className="px-2 py-2 text-right">
                  <Money tiyin={shownTotal.toString()} />
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={confirmDel !== null}
        title="Ish haqidan olib tashlash"
        message={`${confirmDel?.length ?? 0} xodim ${formatPeriod(period)} ish haqidan olib tashlanadi (${formatTiyin(rows.filter((r) => confirmDel?.includes(r.pinfl)).reduce((s, r) => s + BigInt(r.amountTiyin), 0n).toString())} so'm). Ish haqi xarajati kamayadi.`}
        confirmLabel="O'chirish"
        danger
        loading={busy}
        onConfirm={() => void remove(confirmDel ?? [])}
        onCancel={() => setConfirmDel(null)}
      />
    </Card>
  );
}