'use client';

import { DiscussMenu } from '@/features/reactions/discuss';
import { districtMark, leaseMark } from '@/features/reactions/marks';
import {
    DOCUMENT_ACCEPT,
    DOCUMENT_LABELS,
    formatFileSize,
    FREQUENCY_LABELS,
    KIND_LABELS,
    leasesApi,
    openLeaseDocument,
    somToTiyin,
    STATUS_LABELS,
    uploadLeaseDocument,
    type LeaseDetail,
    type LeaseDocument,
    type LeaseDocumentType,
    type LeaseTerm,
} from '@/features/leases/api';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatDateTime, formatPercent, formatPeriod, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useRef, useState, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import {
    IconAlert,
    IconDownload,
    IconEdit,
    IconPlus,
    IconSpinner,
    IconTrash,
    IconUpload,
} from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Money } from '@/components/ui/money';
import { Select } from '@/components/ui/select';

interface Props {
  leaseId: string;
  /** Qaysi oy uchun holat va summa ko'rsatiladi */
  period: string;
  isAdmin: boolean;
  onClose: () => void;
  onEdit: (lease: LeaseDetail) => void;
  /** Ro'yxatni yangilash uchun; stalePeriods — qayta yopish kerak bo'lgan oylar */
  onChanged: (message: string, stalePeriods?: string[]) => void;
  onDeleted: (message: string) => void;
}

type Confirm =
  | { kind: 'lease' }
  | { kind: 'term'; term: LeaseTerm }
  | { kind: 'document'; doc: LeaseDocument }
  | null;

/** Shartnoma kartasi: ma'lumotlar, narx tarixi, hujjatlar, yozilgan oylar */
export function LeaseDrawer({ leaseId, period, isAdmin, onClose, onEdit, onChanged, onDeleted }: Props) {
  const detail = useAsync(() => leasesApi.getOne(leaseId, period), [leaseId, period]);
  const lease = detail.data?.data ?? null;

  const [stale, setStale] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [openingDoc, setOpeningDoc] = useState<string | null>(null);

  const [termOpen, setTermOpen] = useState(false);
  const [terminateOpen, setTerminateOpen] = useState(false);

  /** Amaldan keyin: kartani yangilash va ro'yxatga xabar berish */
  function applied(result: LeaseDetail, message: string) {
    const periods = result.stalePeriods ?? [];
    setStale(periods);
    detail.reload();
    onChanged(message, periods);
  }

  async function handleConfirm() {
    if (!confirm || !lease) return;
    setBusy(true);
    setError(null);
    try {
      if (confirm.kind === 'lease') {
        await leasesApi.remove(lease.id);
        onDeleted("Shartnoma o'chirildi");
        return;
      }
      if (confirm.kind === 'term') {
        const result = await leasesApi.removeTerm(lease.id, confirm.term.id);
        applied(result.data, "Narx o'zgarishi o'chirildi");
      }
      if (confirm.kind === 'document') {
        await leasesApi.removeDocument(confirm.doc.id);
        detail.reload();
        onChanged("Hujjat o'chirildi");
      }
      setConfirm(null);
    } catch (err) {
      setError(errorMessage(err, 'Amalni bajarib bo‘lmadi'));
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleOpen(doc: LeaseDocument, download = false) {
    setOpeningDoc(doc.id);
    setError(null);
    try {
      await openLeaseDocument(doc, download);
    } catch (err) {
      setError(errorMessage(err, 'Hujjatni ochib bo‘lmadi'));
    } finally {
      setOpeningDoc(null);
    }
  }

  async function handleRestore() {
    if (!lease) return;
    setBusy(true);
    setError(null);
    try {
      const result = await leasesApi.terminate(lease.id, { endPeriod: null });
      applied(result.data, 'Shartnoma qayta tiklandi');
    } catch (err) {
      setError(errorMessage(err, 'Qayta tiklab bo‘lmadi'));
    } finally {
      setBusy(false);
    }
  }

  const status = lease ? STATUS_LABELS[lease.status] : null;
  const perM2 =
    lease?.areaM2 && lease.areaM2 > 0 && lease.monthlyTiyin !== '0'
      ? (BigInt(lease.monthlyTiyin) * 100n) / BigInt(Math.round(lease.areaM2 * 100))
      : null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={lease ? lease.title : 'Ijara shartnomasi'}
      description={lease ? `№ ${lease.number} · ${lease.place.label}` : undefined}
      footer={
        lease && isAdmin ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirm({ kind: 'lease' })}>
                <IconTrash className="size-4" />
                O&rsquo;chirish
              </Button>
              <DiscussMenu
                label="Muhokama"
                align="left"
                direction="up"
                items={[
                  leaseMark(lease),
                  lease.place.districtId && lease.place.districtName
                    ? districtMark(lease.place.districtId, lease.place.districtName, 'EXPENSE', null, 'Ijara › tuman')
                    : null,
                ]}
              />
            </div>
            <div className="flex gap-2">
              {lease.endPeriod ? (
                <Button variant="secondary" size="sm" onClick={handleRestore} loading={busy}>
                  Qayta tiklash
                </Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => setTerminateOpen(true)}>
                  Tugatish
                </Button>
              )}
              <Button size="sm" onClick={() => onEdit(lease)}>
                <IconEdit className="size-4" />
                Tahrirlash
              </Button>
            </div>
          </div>
        ) : undefined
      }
    >
      {detail.loading && !lease ? (
        <div className="flex items-center gap-2 py-10 text-sm text-(--color-text-muted)">
          <IconSpinner className="size-4 animate-spin" />
          Yuklanmoqda&hellip;
        </div>
      ) : detail.error || !lease ? (
        <p className="py-10 text-sm text-(--color-expense)">{detail.error ?? 'Topilmadi'}</p>
      ) : (
        <div className="space-y-6">
          {error && <Alert tone="error">{error}</Alert>}

          {stale.length > 0 && (
            <Alert tone="warn">
              Bu o&rsquo;zgarish yopilgan oylarga ta&rsquo;sir qildi:{' '}
              <b>{stale.map(formatPeriod).join(', ')}</b>. O&rsquo;sha oylar hozircha eski summada
              qoladi &mdash; &laquo;Oyni yopish&raquo; bo&rsquo;limida qayta yoping.
            </Alert>
          )}

          {/* ── Asosiy raqamlar ── */}
          <div className="flex flex-wrap items-center gap-2">
            {status && <Badge tone={status.tone}>{status.label}</Badge>}
            <Badge tone="brand">{KIND_LABELS[lease.kind]}</Badge>
            {lease.vatIncluded ? <Badge>QQS bilan</Badge> : <Badge tone="warn">QQSsiz</Badge>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Stat label={`${formatPeriod(period)} uchun`}>
              <Money tiyin={lease.monthlyTiyin} />
            </Stat>
            <Stat label="Jami yozilgan (yopilgan oylar)">
              <Money tiyin={lease.accruedTotalTiyin} />
            </Stat>
            <Stat label="Maydon">
              {lease.areaM2 ? `${lease.areaM2.toLocaleString('ru-RU')} m²` : '—'}
            </Stat>
            <Stat label="1 m² uchun (oyiga)">{perM2 !== null ? <Money tiyin={perM2} /> : '—'}</Stat>
          </div>

          {lease.nextChange && (
            <Alert tone="info">
              {formatPeriod(lease.nextChange.validFrom)} dan narx{' '}
              <b>{formatTiyin(lease.nextChange.monthlyTiyin, { currency: true })}</b> bo&rsquo;ladi
            </Alert>
          )}

          {/* ── Ma'lumotlar ── */}
          <Section title="Ma'lumotlar">
            <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2 text-sm">
              <Field label="Joyi">{lease.place.label}</Field>
              <Field label="Manzil">{lease.address}</Field>
              <Field label="Maqsadi">{lease.purpose}</Field>
              <Field label="Shartnoma">
                № {lease.number}
                {lease.contractDate ? ` · ${formatDate(lease.contractDate)}` : ''}
              </Field>
              <Field label="Amal qilishi">
                {formatPeriod(lease.startPeriod)} &mdash;{' '}
                {lease.endPeriod ? formatPeriod(lease.endPeriod) : 'muddatsiz'}
              </Field>
              {lease.endReason && <Field label="Tugash sababi">{lease.endReason}</Field>}
              <Field label="To'lov">
                {FREQUENCY_LABELS[lease.paymentFrequency]}
                {lease.paymentDay ? `, har ${lease.paymentDay}-kuni` : ''}
              </Field>
              <Field label="Ijaraga beruvchi">{lease.lessorName}</Field>
              <Field label="STIR">{lease.lessorTin}</Field>
              <Field label="Telefon">{lease.lessorPhone}</Field>
              <Field label="Bank">{lease.lessorBank}</Field>
              <Field label="Izoh">{lease.note}</Field>
            </dl>
          </Section>

          {/* ── Tugatish formasi ── */}
          {terminateOpen && (
            <TerminateForm
              lease={lease}
              onCancel={() => setTerminateOpen(false)}
              onDone={(result) => {
                setTerminateOpen(false);
                applied(result, 'Shartnoma tugatildi');
              }}
            />
          )}

          {/* ── Narx tarixi ── */}
          <Section
            title="Narx tarixi"
            action={
              isAdmin && !termOpen ? (
                <Button variant="secondary" size="sm" onClick={() => setTermOpen(true)}>
                  <IconPlus className="size-4" />
                  Narx o&rsquo;zgarishi
                </Button>
              ) : null
            }
          >
            {termOpen && (
              <TermForm
                lease={lease}
                onCancel={() => setTermOpen(false)}
                onDone={(result, message) => {
                  setTermOpen(false);
                  applied(result, message);
                }}
              />
            )}

            <div className="divide-y divide-(--color-line) rounded-(--radius-control) border border-(--color-line)">
              {lease.terms.map((term, index) => {
                const previous = lease.terms[index + 1];
                const change =
                  previous && previous.monthlyTiyin !== '0'
                    ? (Number(BigInt(term.monthlyTiyin) - BigInt(previous.monthlyTiyin)) /
                        Number(BigInt(previous.monthlyTiyin))) *
                      100
                    : null;
                const isCurrent = term.validFrom <= period && (!term.validTo || term.validTo >= period);

                return (
                  <div key={term.id} className={cn('px-3 py-2.5', isCurrent && 'bg-brand-50')}>
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {formatPeriod(term.validFrom)}
                          {term.validTo ? ` — ${formatPeriod(term.validTo)}` : ' dan'}
                        </p>
                        {term.note && (
                          <p className="truncate text-xs text-(--color-text-muted)">{term.note}</p>
                        )}
                      </div>
                      {change !== null && (
                        <span
                          className={cn(
                            'money text-xs',
                            change > 0 ? 'text-(--color-expense)' : 'text-(--color-income)',
                          )}
                        >
                          {change > 0 ? '+' : ''}
                          {formatPercent(change)}
                        </span>
                      )}
                      <Money tiyin={term.monthlyTiyin} className="text-sm font-semibold" />
                      {isAdmin && index < lease.terms.length - 1 && (
                        <button
                          type="button"
                          className="text-(--color-text-faint) hover:text-(--color-expense)"
                          onClick={() => setConfirm({ kind: 'term', term })}
                          aria-label="O'chirish"
                        >
                          <IconTrash className="size-4" />
                        </button>
                      )}
                    </div>
                    {term.documents.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {term.documents.map((doc) => (
                          <button
                            key={doc.id}
                            type="button"
                            onClick={() => handleOpen(doc)}
                            className="rounded bg-white px-2 py-0.5 text-xs text-brand-800 ring-1 ring-(--color-line) hover:underline"
                          >
                            {openingDoc === doc.id ? '…' : doc.fileName}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>

          {/* ── Hujjatlar ── */}
          <Section title={`Hujjatlar (${lease.documents.length})`}>
            {isAdmin && <DocumentUpload leaseId={lease.id} onUploaded={() => { detail.reload(); onChanged('Hujjat yuklandi'); }} />}

            {lease.documents.length === 0 ? (
              <p className="rounded-(--radius-control) bg-(--color-warn-soft) px-3 py-2 text-sm text-(--color-warn)">
                Hujjat yuklanmagan &mdash; shartnoma nusxasini yuklang
              </p>
            ) : (
              <div className="divide-y divide-(--color-line) rounded-(--radius-control) border border-(--color-line)">
                {lease.documents.map((doc) => (
                  <div key={doc.id} className="flex items-center gap-3 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => handleOpen(doc)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-sm text-brand-800 hover:underline">
                        {openingDoc === doc.id ? 'Ochilmoqda…' : doc.fileName}
                      </span>
                      <span className="text-xs text-(--color-text-muted)">
                        {formatFileSize(doc.sizeBytes)} · {formatDateTime(doc.createdAt)}
                      </span>
                    </button>
                    <Badge tone={doc.type === 'SHARTNOMA' ? 'brand' : 'neutral'}>
                      {DOCUMENT_LABELS[doc.type]}
                    </Badge>
                    <button
                      type="button"
                      className="text-(--color-text-muted) hover:text-(--color-text)"
                      onClick={() => handleOpen(doc, true)}
                      aria-label="Yuklab olish"
                    >
                      <IconDownload className="size-4" />
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        className="text-(--color-text-faint) hover:text-(--color-expense)"
                        onClick={() => setConfirm({ kind: 'document', doc })}
                        aria-label="O'chirish"
                      >
                        <IconTrash className="size-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* ── Yozilgan oylar ── */}
          <Section title="Xarajatga yozilgan oylar">
            {lease.accruals.length === 0 ? (
              <p className="text-sm text-(--color-text-muted)">
                Hali birorta oy yopilmagan &mdash; oy yopilganda xarajat shu yerda ko&rsquo;rinadi
              </p>
            ) : (
              <div className="divide-y divide-(--color-line) rounded-(--radius-control) border border-(--color-line)">
                {lease.accruals.map((accrual) => (
                  <div key={accrual.period} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="flex-1">{formatPeriod(accrual.period)}</span>
                    {accrual.changed && (
                      <Badge tone="warn">
                        hozir: {formatTiyin(accrual.expectedTiyin)}
                      </Badge>
                    )}
                    <Money tiyin={accrual.accruedTiyin} />
                  </div>
                ))}
              </div>
            )}
          </Section>

          <p className="text-xs text-(--color-text-faint)">
            Kiritilgan: {formatDateTime(lease.createdAt)} · o&rsquo;zgartirilgan:{' '}
            {formatDateTime(lease.updatedAt)}
          </p>
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        danger
        loading={busy}
        title={
          confirm?.kind === 'lease'
            ? "Shartnomani o'chirish"
            : confirm?.kind === 'term'
              ? "Narx o'zgarishini o'chirish"
              : "Hujjatni o'chirish"
        }
        message={
          confirm?.kind === 'lease'
            ? "Faqat xarajatga yozilmagan shartnomani o'chirish mumkin. Amaldagi shartnomani to'xtatish uchun «Tugatish»dan foydalaning."
            : confirm?.kind === 'term'
              ? `${formatPeriod(confirm.term.validFrom)} dagi narx o'chiriladi — o'sha oylar oldingi narx bo'yicha hisoblanadi.`
              : confirm?.kind === 'document'
                ? `«${confirm.doc.fileName}» serverdan butunlay o'chiriladi.`
                : ''
        }
        confirmLabel="O'chirish"
        onConfirm={handleConfirm}
        onCancel={() => setConfirm(null)}
      />
    </Drawer>
  );
}

// ═══════════════════════════════════════════════════════════
// Narx o'zgarishi formasi
// ═══════════════════════════════════════════════════════════

function TermForm({
  lease,
  onCancel,
  onDone,
}: {
  lease: LeaseDetail;
  onCancel: () => void;
  onDone: (result: LeaseDetail, message: string) => void;
}) {
  const current = lease.terms[0];
  const [validFrom, setValidFrom] = useState('');
  const [som, setSom] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tiyin = som ? somToTiyin(som) : null;
  const diff =
    tiyin && current && current.monthlyTiyin !== '0'
      ? (Number(BigInt(tiyin) - BigInt(current.monthlyTiyin)) / Number(BigInt(current.monthlyTiyin))) * 100
      : null;

  async function submit() {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(validFrom)) return setError('Qaysi oydan — tanlang');
    if (!tiyin) return setError('Yangi oylik summani kiriting');
    if (validFrom < lease.startPeriod) {
      return setError(`Shartnoma ${formatPeriod(lease.startPeriod)} dan boshlangan`);
    }

    setSaving(true);
    setError(null);
    try {
      const result = await leasesApi.setTerm(lease.id, {
        validFrom,
        monthlyTiyin: tiyin,
        note: note.trim() || null,
      });
      let message = `${formatPeriod(validFrom)} dan yangi narx saqlandi`;
      if (file) {
        const term = result.data.terms.find((t) => t.validFrom === validFrom);
        try {
          await uploadLeaseDocument(lease.id, file, 'QOSHIMCHA_KELISHUV', term?.id);
        } catch (err) {
          message += `, lekin hujjat yuklanmadi: ${errorMessage(err, 'xato')}`;
        }
      }
      onDone(result.data, message);
    } catch (err) {
      setError(errorMessage(err, 'Saqlab bo‘lmadi'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-(--radius-control) border border-brand-600 bg-brand-50 p-3">
      <p className="text-sm font-medium">Yangi narx &mdash; tanlangan oydan boshlab</p>
      <p className="text-xs text-(--color-text-muted)">
        Oldingi oylar o&rsquo;zgarmaydi. Shu oy uchun narx allaqachon bo&rsquo;lsa &mdash; almashtiriladi.
      </p>
      {error && <p className="text-sm text-(--color-expense)">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Qaysi oydan"
          type="month"
          min={lease.startPeriod}
          max={lease.endPeriod ?? undefined}
          value={validFrom}
          onChange={(event) => setValidFrom(event.target.value)}
        />
        <Input
          label="Yangi oylik summa"
          money
          suffix="so'm"
          inputMode="decimal"
          value={som}
          onChange={(event) => setSom(event.target.value)}
          hint={
            tiyin
              ? `${formatTiyin(tiyin, { currency: true })}${diff !== null ? ` (${diff > 0 ? '+' : ''}${formatPercent(diff)})` : ''}`
              : current
                ? `Hozir: ${formatTiyin(current.monthlyTiyin, { currency: true })}`
                : undefined
          }
        />
      </div>
      <Input
        label="Asos / izoh"
        placeholder="Masalan: 2-son qo'shimcha kelishuv"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <FilePick file={file} onChange={setFile} label="Qo'shimcha kelishuv fayli (ixtiyoriy)" />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Bekor qilish
        </Button>
        <Button size="sm" onClick={submit} loading={saving}>
          Saqlash
        </Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Tugatish formasi
// ═══════════════════════════════════════════════════════════

function TerminateForm({
  lease,
  onCancel,
  onDone,
}: {
  lease: LeaseDetail;
  onCancel: () => void;
  onDone: (result: LeaseDetail) => void;
}) {
  const [endPeriod, setEndPeriod] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(endPeriod)) return setError('Oxirgi oyni tanlang');
    if (endPeriod < lease.startPeriod) return setError('Boshlanish oyidan oldin bo‘lishi mumkin emas');
    setSaving(true);
    setError(null);
    try {
      const result = await leasesApi.terminate(lease.id, {
        endPeriod,
        endReason: reason.trim() || null,
      });
      onDone(result.data);
    } catch (err) {
      setError(errorMessage(err, 'Saqlab bo‘lmadi'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-(--radius-control) border border-(--color-warn) bg-(--color-warn-soft) p-3">
      <p className="text-sm font-medium">Shartnomani tugatish</p>
      <p className="text-xs text-(--color-text-muted)">
        Tanlangan oy &mdash; xarajat yoziladigan oxirgi oy. Undan keyingi oylarga yozilmaydi.
      </p>
      {error && <p className="text-sm text-(--color-expense)">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Oxirgi oy"
          type="month"
          min={lease.startPeriod}
          value={endPeriod}
          onChange={(event) => setEndPeriod(event.target.value)}
        />
        <Input
          label="Sababi"
          placeholder="Muddati tugadi, bekor qilindi…"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Bekor qilish
        </Button>
        <Button variant="danger" size="sm" onClick={submit} loading={saving}>
          Tugatish
        </Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Hujjat yuklash
// ═══════════════════════════════════════════════════════════

function DocumentUpload({ leaseId, onUploaded }: { leaseId: string; onUploaded: () => void }) {
  const [type, setType] = useState<LeaseDocumentType>('SHARTNOMA');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(files: FileList | null) {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of list) {
        await uploadLeaseDocument(leaseId, file, type);
      }
      onUploaded();
    } catch (err) {
      setError(errorMessage(err, 'Yuklab bo‘lmadi'));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="w-48">
          <Select
            className="h-8"
            options={(Object.keys(DOCUMENT_LABELS) as LeaseDocumentType[]).map((value) => ({
              value,
              label: DOCUMENT_LABELS[value],
            }))}
            value={type}
            onChange={(event) => setType(event.target.value as LeaseDocumentType)}
          />
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={DOCUMENT_ACCEPT}
          className="hidden"
          onChange={(event) => upload(event.target.files)}
        />
        <Button
          variant="secondary"
          size="sm"
          loading={uploading}
          onClick={() => inputRef.current?.click()}
        >
          <IconUpload className="size-4" />
          Yuklash
        </Button>
      </div>
      <p className="mt-1 text-xs text-(--color-text-muted)">PDF, rasm, Word yoki Excel · 25 MB gacha</p>
      {error && <p className="mt-1 text-sm text-(--color-expense)">{error}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Kichik bo'laklar
// ═══════════════════════════════════════════════════════════

function FilePick({
  file,
  onChange,
  label,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  label: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-2 text-sm">
      <input
        ref={inputRef}
        type="file"
        accept={DOCUMENT_ACCEPT}
        className="hidden"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
      <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
        <IconUpload className="size-4" />
        {file ? 'Almashtirish' : label}
      </Button>
      {file && (
        <>
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <button
            type="button"
            className="text-xs text-(--color-text-muted) hover:text-(--color-expense)"
            onClick={() => {
              onChange(null);
              if (inputRef.current) inputRef.current.value = '';
            }}
          >
            olib tashlash
          </button>
        </>
      )}
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-(--color-text-muted)">{title}</p>
        {action}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-(--radius-control) border border-(--color-line) px-3 py-2">
      <p className="text-xs text-(--color-text-muted)">{label}</p>
      <p className="money mt-0.5 text-base font-semibold">{children}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const empty = children === null || children === undefined || children === '';
  return (
    <>
      <dt className="text-(--color-text-muted)">{label}</dt>
      <dd className={cn('min-w-0 break-words', empty && 'text-(--color-text-faint)')}>
        {empty ? '—' : children}
      </dd>
    </>
  );
}

function Alert({ tone, children }: { tone: 'error' | 'warn' | 'info'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex gap-2 rounded-(--radius-control) px-3 py-2 text-sm',
        tone === 'error' && 'bg-(--color-expense-soft) text-(--color-expense)',
        tone === 'warn' && 'bg-(--color-warn-soft) text-(--color-warn)',
        tone === 'info' && 'bg-brand-50 text-brand-800',
      )}
    >
      {tone !== 'info' && <IconAlert className="mt-0.5 size-4 shrink-0" />}
      <span>{children}</span>
    </div>
  );
}