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
} from './api';

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

export function UnitPayrollView({ unit }: { unit: EntryUnit }) {
  const { isAdmin } = useAuth();
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
  const staff = useAsync(() => unitPayrollApi.staff(unit.code), [unit.code]);
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
    if (!/\.xlsx$/i.test(file.name)) {
      setToast({ message: 'Faqat Excel (.xlsx) fayl yuklang', tone: 'error' });
      return;
    }
    setUploading(true);
    setMany(null);
    try {
      const result = await analyzeUnitFileMany(unit.code, period, file);
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
    try {
      for (const m of pickedMonths) {
        const rows = m.rows.map((r) => ({ pinfl: r.pinfl, amountTiyin: r.amountTiyin, fullName: r.fullName ? null : (names[r.pinfl] ?? '').trim() }));
        const res = (await unitPayrollApi.commit(unit.code, m.period, { rows, fileName: many.fileName }, replacePrevious && m.hasPrevious)).data;
        done.push(m.monthLabel);
        total += BigInt(res.totalTiyin);
        newStaff += res.newStaff;
      }
      setToast({
        tone: 'success',
        message: `${done.join(', ')} saqlandi · ${formatTiyin(total.toString())} so'm` + (newStaff ? ` · ${newStaff} yangi xodim ro'yxatga qo'shildi` : '') + (replacePrevious && previousMonths.length ? ` · ${previousMonths.length} oyda oldingisi almashtirildi` : ''),
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
      <MonthRangeCard range={range} />
      <SourceActions
        upload={
          isAdmin
            ? {
                label: 'Vedomostni yuklash',
                onClick: () => inputRef.current?.click(),
                loading: uploading,
                disabled: Boolean(analysis),
                hint: analysis ? 'Avval joriy tahlilni saqlang yoki bekor qiling' : `${unit.label} ish haqi vedomosti (Excel)`,
              }
            : undefined
        }
        template={{ label: range.error ? 'Shablon' : `Shablon · ${range.text}`, onClick: () => void handleTemplate(), loading: downloading, disabled: Boolean(range.error), hint: `Har oy — alohida ustun (PINFL, F.I.Sh., oylar) · 2-varaq: ${unit.label} xodimlari` }}
        note={
          <>
            Shablon tanlangan oylar uchun: har oy ustuniga summa yoziladi, <b className="text-heading">0 yoki bo&apos;sh — o&apos;sha oyda hisoblanmagan</b>. Yuklanganda fayldagi hamma oylar o&apos;qiladi. Tarix — yuqori paneldagi oy ({formatPeriod(period)}). Xodimlar — faqat {unit.label} xodimlari (
            <b className="text-heading">{activeCount}</b> ta) — Xodimlar bo&apos;limidan o&apos;zi olinadi: u yerda yangi xodim qo&apos;shilsa, keyingi shablonda chiqadi.
          </>
        }
      />

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
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
                  <p className="text-sm font-medium">{unit.label} ish haqi vedomostini shu yerga tashlang</p>
                  <p className="text-xs text-(--color-text-muted)">yoki bosib tanlang · PINFL va summa. Summa bo&apos;sh yoki 0 — «hisoblanmagan»</p>
                </>
              )}
            </div>
          </CardBody>
        </Card>
      )}

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

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
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

        <StaffCard unit={unit} list={staff.data?.data ?? null} loading={staff.loading} error={staff.error} onChanged={staff.reload} onToast={setToast} />
      </div>

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
}: {
  unit: EntryUnit;
  list: { active: number; total: number; items: UnitStaff[] } | null;
  loading: boolean;
  error: string | null;
  onChanged: () => void;
  onToast: (t: ToastState) => void;
}) {
  const { isAdmin } = useAuth();
  const [q, setQ] = useState('');
  const [showLeft, setShowLeft] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pinfl, setPinfl] = useState('');
  const [fullName, setFullName] = useState('');
  const [position, setPosition] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
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
      await unitPayrollApi.addStaff(unit.code, { pinfl, fullName: fullName.trim() || undefined, position: position.trim() || undefined });
      onToast({ message: `Xodim qo'shildi — keyingi shablonda chiqadi`, tone: 'success' });
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

  async function saveLink(body: { departmentIds?: string[] | null; byPosition?: boolean }) {
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
        description={`Shablonning 2-varag'i · faol: ${list?.active ?? 0} ta`}
        actions={
          isAdmin && !adding ? (
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              + Xodim
            </Button>
          ) : undefined
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
                  {s.position ? ` · ${s.position}` : ''} · {s.active ? (s.source === 'REGISTRY' ? 'Xodimlar bazasidan' : `${s.source === 'UPLOAD' ? 'vedomostdan' : "qo'lda"} ${formatDate(s.addedAt)}`) : `chiqarilgan ${s.leftAt ? formatDate(s.leftAt) : ''}`}
                </p>
              </div>
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