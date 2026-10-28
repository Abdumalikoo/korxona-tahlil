'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { SubTabs } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime, formatPeriod, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { Fragment, useRef, useState, type ReactNode } from 'react';
import { shtat3802Api, vedomost3802Api, type Coverage3802, type ShtatAnalysis, type ShtatKind, type ShtatMember, type ShtatSaved, type ShtatSectionView, type ShtatSheetView, type VedAnalysis, type VedPeriodBrief, type VedSavedPeriod } from './api';
import { NazoratSection } from './qomita-nazorat';

// ═══════════════════════════════════════════════════════════
// 3802 — Qo'mita qoplashi (alohida bo'lim): tizim tuzilmasi (bo'limlar birma-bir to'ldiriladi, shablonlar ulanadi).
//  • Shtatlar — ikki toifa alohida yuklanadi: oladigan (3802) va olmaydigan shtatlar; bo'limlar bog'lanadi, qoplash qoidasi,
//    pastda — shu toifaga ish haqi tarkibidan kimlar kirishi (bo'limi va lavozimi bo'yicha);
//  • Har oylik real bajarilgan ishlar — 3802 vedomosti: fayl to'liq o'qiladi (oylar — varaq nomi / sarlavha), qabul qilinadigan
//    oylar oralig'ini foydalanuvchi tanlaydi;
//  • Nazorat zanjiri — vedomost ↔ ish haqi tarkibi ↔ shtat ↔ 23106 ↔ Qo'mitadan kelgan pul.
// Qoplash qoidasi: 3802 ro'yxatidagi lavozimlar — Oklad va 40% ustama; to'liq qoplanadigan bo'limlar — hamma summa.
// Qo'mitadan «Depozit» bo'lib kelgan pul — 3802 qoplashiga kirmaydi (alohida ko'rsatiladi).
// ═══════════════════════════════════════════════════════════

export type Section3802 = 'QOPLASH' | 'SHTAT' | 'OYLIK' | 'NAZORAT';

export const SECTIONS_3802: { value: Section3802; label: string; hint: string }[] = [
  { value: 'QOPLASH', label: 'Qoplash va qoldiq', hint: "Qo'mitadan kelgan pul va u qoplaydigan bo'lim xarajatlari, qoplanadigan bo'limlar sozlamasi" },
  { value: 'SHTAT', label: 'Shtatlar', hint: "Oladigan (3802) va olmaydigan shtatlar — alohida yuklanadi; bo'limlar, qoplash qoidasi va kimlar kiradi" },
  { value: 'OYLIK', label: 'Har oylik real bajarilgan ishlar', hint: "3802 vedomosti: fayl to'liq o'qiladi, qabul qilinadigan oylar oralig'ini o'zingiz tanlaysiz" },
  { value: 'NAZORAT', label: 'Nazorat zanjiri', hint: "Vedomost, ish haqi tarkibi, shtat, 23106 va Qo'mitadan kelgan pul — o'zaro" },
];

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold tracking-wide text-(--color-text-muted) uppercase">{title}</p>
      <div className="text-sm text-heading">{children}</div>
    </div>
  );
}

// ─────────── Shtatlar ───────────

type ToastFn = (t: { message: string; tone: 'success' | 'error' } | null) => void;

const COVERAGE_LABEL: Record<Coverage3802, string> = { OKLAD_40: 'Oklad + 40%', FULL: "To'liq (hamma summa)", NONE: 'Qoplanmaydi' };
const KIND_TAB: { value: ShtatKind; label: string; hint: string }[] = [
  { value: 'OLADI', label: 'Oladigan shtatlar (3802)', hint: "Qo'mita hisobidan oladigan shtatlar — «3802» varag'i" },
  { value: 'OLMAYDI', label: 'Olmaydigan shtatlar', hint: "Qo'mita hisobidan olmaydigan shtatlar — «3802 олмайдиганлар» varag'i" },
];
const KIND_TEXT: Record<ShtatKind, { title: string; sheet: string }> = {
  OLADI: { title: 'Oladigan shtatlar (3802)', sheet: '«3802»' },
  OLMAYDI: { title: 'Olmaydigan shtatlar', sheet: '«3802 олмайдиганлар»' },
};
const SELECT = 'h-8 max-w-56 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-sm focus:border-brand-600 focus:outline-none disabled:bg-(--color-surface-muted)';
const units = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });

function ShtatSection({ isAdmin, onToast }: { isAdmin: boolean; onToast: ToastFn }) {
  const [kind, setKind] = useState<ShtatKind>('OLADI');
  const view = useAsync(() => shtat3802Api.view().then((r) => r.data), []);
  if (view.error) return <ErrorState message={view.error} onRetry={view.reload} />;
  if (!view.data) return <LoadingState label="Shtatlar yuklanmoqda" />;
  return (
    <div className="space-y-4">
      <SubTabs value={kind} options={KIND_TAB} onChange={setKind} />
      <ShtatKindPanel key={kind} kind={kind} saved={view.data[kind]} departments={view.data.departments} isAdmin={isAdmin} onToast={onToast} onChanged={view.reload} />
    </div>
  );
}

function ShtatKindPanel({ kind, saved, departments, isAdmin, onToast, onChanged }: { kind: ShtatKind; saved: ShtatSaved | null; departments: { id: string; name: string }[]; isAdmin: boolean; onToast: ToastFn; onChanged: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ShtatAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [rev, setRev] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const text = KIND_TEXT[kind];

  async function remove() {
    setBusy(true);
    try {
      await shtat3802Api.remove(kind);
      onToast({ message: `${text.title} o'chirildi`, tone: 'success' });
      setConfirmRemove(false);
      onChanged();
    } catch (err) {
      onToast({ message: errorMessage(err, "O'chirib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    try {
      setPreview(await shtat3802Api.analyze(kind, f));
      setFile(f);
    } catch (err) {
      onToast({ message: errorMessage(err, "Faylni o'qib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function save() {
    if (!file) return;
    setBusy(true);
    try {
      const r = await shtat3802Api.commit(kind, file);
      onToast({ message: `${text.title} saqlandi: ${r.sections} bo'lim, ${units(r.units)} birlik`, tone: 'success' });
      setPreview(null);
      setFile(null);
      setRev((x) => x + 1);
      onChanged();
    } catch (err) {
      onToast({ message: errorMessage(err, "Saqlab bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function template() {
    try {
      await shtat3802Api.template(kind);
    } catch (err) {
      onToast({ message: errorMessage(err, "Shablonni yuklab bo'lmadi"), tone: 'error' });
    }
  }

  const shown = preview ?? saved;
  const changed = () => {
    setRev((x) => x + 1);
    onChanged();
  };
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={text.title}
          description={
            preview
              ? `Ko'rish: ${preview.fileName} («${preview.sheet.sheet}» varag'i) — hali saqlanmagan`
              : saved
                ? `${saved.fileName} («${saved.sheet.sheet}» varag'i) · ${formatDateTime(saved.savedAt)}${saved.savedBy ? ` · ${saved.savedBy}` : ''}`
                : 'Shtat jadvali hali yuklanmagan'
          }
          actions={
            preview ? undefined : (
              <span className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => void template()}>
                  Shablon
                </Button>
                {isAdmin && (
                  <>
                    <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
                    <Button size="sm" variant={saved ? 'secondary' : 'primary'} loading={busy && !preview} onClick={() => input.current?.click()}>
                      {saved ? 'Qayta yuklash' : 'Yuklash'}
                    </Button>
                    {saved && (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmRemove(true)} title="Yuklangan shtat jadvalini o'chirish">
                        O&apos;chirish
                      </Button>
                    )}
                  </>
                )}
              </span>
            )
          }
        />
        {preview && (
          <CardBody className="flex flex-wrap items-center gap-2 border-t border-(--color-line)">
            <span className="text-sm text-(--color-text-muted)">Saqlansa, shu toifaning avvalgi jadvali almashtiriladi; bo&apos;limlar sozlamasi nomi bo&apos;yicha saqlanib qoladi.</span>
            <span className="ml-auto flex gap-2">
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setPreview(null); setFile(null); }}>
                Bekor qilish
              </Button>
              <Button size="sm" loading={busy} onClick={() => void save()}>
                Saqlash
              </Button>
            </span>
          </CardBody>
        )}
        {!shown && (
          <CardBody className="grid gap-5 border-t border-(--color-line) md:grid-cols-2">
            <Block title="Fayl">
              To&apos;liq shtat fayli («3802 bo&apos;yicha olish tartibi») — tizim {text.sheet} varag&apos;ini o&apos;zi topadi; yoki faqat shu jadval yozilgan alohida fayl («Shablon» bo&apos;yicha).
            </Block>
            <Block title="Keyin">
              {kind === 'OLADI' ? (
                <>
                  Bo&apos;limlar ilovadagi bo&apos;limlarga bog&apos;lanadi, har biriga qoplash qoidasi — <b>Oklad + 40%</b> yoki <b>to&apos;liq</b>. Pastda — shu shtatga ish haqi tarkibidan kimlar
                  kirishi.
                </>
              ) : (
                <>Bo&apos;limlar ilovadagi bo&apos;limlarga bog&apos;lanadi (Qo&apos;mita qoplamaydi). Pastda — shu shtatga ish haqi tarkibidan kimlar kirishi.</>
              )}
            </Block>
          </CardBody>
        )}
      </Card>
      {shown && <ShtatBody kind={kind} data={shown} departments={departments} editable={isAdmin && !preview} onToast={onToast} onChanged={changed} />}
      {saved && !preview && <MembersCard kind={kind} rev={rev} />}
      <ConfirmDialog
        open={confirmRemove}
        danger
        title={`${text.title} — o'chirish`}
        message={saved ? `«${saved.fileName}» shtat jadvali o'chiriladi. Bo'limlarni bog'lash va qoplash qoidalari saqlanib qoladi — qayta yuklasangiz, o'zi qo'llanadi.` : ''}
        confirmLabel="O'chirish"
        loading={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmRemove(false)}
      />
    </div>
  );
}

function ShtatBody({ kind, data, departments, editable, onToast, onChanged }: { kind: ShtatKind; data: { sheet: ShtatSheetView; summary: ShtatAnalysis['summary'] }; departments: { id: string; name: string }[]; editable: boolean; onToast: ToastFn; onChanged: () => void }) {
  const s = data.summary;
  const sheet = data.sheet;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Shtat" value={`${units(s.units)} birlik`} note={`${sheet.sections.length} bo'lim · oylik ${formatTiyin(s.totalTiyin)} so'm`} />
        {kind === 'OLADI' ? (
          <Tile label="Qo'mita qoplashi (oylik, shtat bo'yicha)" value={`${formatTiyin(s.coveredMonthlyTiyin)} so'm`} note={s.fullSections ? `to'liq qoplanadigan bo'lim: ${s.fullSections}` : 'hammasi — Oklad + 40%'} />
        ) : (
          <Tile label="Qo'mita qoplashi" value="Qoplanmaydi" note="olmaydigan shtatlar" />
        )}
        <Tile label="Bog'lash" value={s.unmapped ? `${s.unmapped} ta bog'lanmagan` : s.suggested ? `${s.suggested} ta taklif` : 'hammasi tasdiqlangan'} note="fayl bo'limi → ilovadagi bo'lim" warn={s.unmapped > 0 || s.suggested > 0} />
        <Tile label="Jami tekshiruvi" value={s.mismatched ? `${s.mismatched} ta bo'limda farq` : 'hammasi mos'} note="lavozimlar yig'indisi = bo'lim «Жами:»" warn={s.mismatched > 0} />
      </div>
      <Card className="overflow-hidden">
        <p className="border-b border-(--color-line) px-5 py-2.5 text-xs text-(--color-text-muted)">
          «{sheet.sheet}» varag&apos;i{sheet.subtitle ? ` · ${sheet.subtitle}` : ''} · {units(sheet.units)} birlik · oylik <span className="money">{formatTiyin(sheet.totalTiyin)}</span> so&apos;m
          {sheet.annualFundTiyin ? (
            <>
              {' '}
              · sarlavhadagi yillik fond <span className="money">{formatTiyin(sheet.annualFundTiyin)}</span> so&apos;m
            </>
          ) : null}
        </p>
        <SectionsTable kind={kind} sheet={sheet} departments={departments} editable={editable} onToast={onToast} onChanged={onChanged} />
      </Card>
    </>
  );
}

function Tile({ label, value, note, warn = false }: { label: string; value: string; note?: string; warn?: boolean }) {
  return (
    <div className={cn('rounded-xl border bg-white px-4 py-3 shadow-card', warn ? 'border-amber-300' : 'border-(--color-line)')}>
      <p className="text-xs text-(--color-text-muted)">{label}</p>
      <p className={cn('mt-1 text-lg font-semibold', warn ? 'text-amber-800' : 'text-heading')}>{value}</p>
      {note && <p className="mt-0.5 text-xs text-(--color-text-faint)">{note}</p>}
    </div>
  );
}

function SectionsTable({ kind, sheet, departments, editable, onToast, onChanged }: { kind: ShtatKind; sheet: ShtatSheetView; departments: { id: string; name: string }[]; editable: boolean; onToast: ToastFn; onChanged: () => void }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const oladi = kind === 'OLADI';

  async function setSection(sec: ShtatSectionView, departmentId: string | null, coverage: Coverage3802) {
    setBusyKey(sec.key);
    try {
      await shtat3802Api.section({ kind, section: sec.name, departmentId, coverage });
      onToast({ message: `«${sec.name.slice(0, 60)}» — saqlandi`, tone: 'success' });
      onChanged();
    } catch (err) {
      onToast({ message: errorMessage(err, "Saqlab bo'lmadi"), tone: 'error' });
    } finally {
      setBusyKey(null);
    }
  }

  const suggested = sheet.sections.filter((s) => s.mapping === 'SUGGESTED');
  /** Hamma takliflarni birdaniga tasdiqlash (nom bo'yicha topilgan bog'lash va qoida — saqlanadi) */
  async function confirmAll() {
    setBusyKey('*');
    try {
      for (const sec of suggested) await shtat3802Api.section({ kind, section: sec.name, departmentId: sec.departmentId, coverage: sec.coverage });
      onToast({ message: `${suggested.length} ta bo'lim bog'lashi tasdiqlandi`, tone: 'success' });
      onChanged();
    } catch (err) {
      onToast({ message: errorMessage(err, "Saqlab bo'lmadi"), tone: 'error' });
      onChanged();
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="overflow-x-auto">
      {editable && suggested.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-(--color-line) bg-(--color-warn-soft)/40 px-4 py-2 text-xs">
          <span className="text-heading">
            {suggested.length} ta bo&apos;lim nomi bo&apos;yicha taxmin qilingan — tekshirib, tasdiqlang.
          </span>
          <Button size="sm" className="ml-auto" loading={busyKey === '*'} disabled={busyKey !== null} onClick={() => void confirmAll()}>
            Hammasini tasdiqlash ({suggested.length})
          </Button>
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="bg-(--color-surface-muted) text-[11px] tracking-wide text-(--color-text-muted) uppercase">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Fayldagi bo&apos;lim</th>
            <th className="px-3 py-2 text-right font-semibold">Birlik</th>
            <th className="px-3 py-2 text-right font-semibold">Oylik (shtat)</th>
            <th className="px-3 py-2 text-left font-semibold">Ilovadagi bo&apos;lim</th>
            {oladi && <th className="px-3 py-2 text-left font-semibold">Qoplash</th>}
            {oladi && <th className="px-3 py-2 text-right font-semibold">Qo&apos;mita qoplashi</th>}
          </tr>
        </thead>
        <tbody>
          {sheet.sections.map((sec) => {
            const isOpen = open.has(sec.key);
            const busy = busyKey === sec.key || busyKey === '*';
            return (
              <Fragment key={sec.key}>
                <tr className="border-t border-(--color-line) align-top">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="text-left font-medium text-heading hover:text-brand-700"
                      onClick={() => setOpen((x) => { const n = new Set(x); if (n.has(sec.key)) n.delete(sec.key); else n.add(sec.key); return n; })}
                      aria-expanded={isOpen}
                    >
                      <span className="mr-1 text-(--color-text-faint)">{isOpen ? '▾' : '▸'}</span>
                      {sec.key}. {sec.name}
                    </button>
                    <span className="mt-0.5 flex flex-wrap gap-1 pl-4">
                      <span className="text-xs text-(--color-text-faint)">{sec.positions.length} lavozim</span>
                      {!sec.ok && (
                        <Badge tone="expense">
                          faylda «Жами»: {sec.fileUnits === null ? '—' : units(sec.fileUnits)} birlik{sec.fileTotalTiyin ? `, ${formatTiyin(sec.fileTotalTiyin)}` : ''}
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td className="money px-3 py-2 text-right">{units(sec.units)}</td>
                  <td className="money px-3 py-2 text-right">{formatTiyin(sec.totalTiyin)}</td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <select className={SELECT} value={sec.departmentId ?? ''} disabled={!editable || busy} onChange={(e) => void setSection(sec, e.target.value || null, sec.coverage)} aria-label="Ilovadagi bo'lim">
                        <option value="">— bog&apos;lanmagan —</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                      {sec.mapping === 'SUGGESTED' && (
                        <>
                          <Badge tone="warn">taklif</Badge>
                          {editable && (
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void setSection(sec, sec.departmentId, sec.coverage)}>
                              Tasdiqlash
                            </Button>
                          )}
                        </>
                      )}
                    </span>
                  </td>
                  {oladi && (
                    <td className="px-3 py-2">
                      <select className={SELECT} value={sec.coverage} disabled={!editable || busy} onChange={(e) => void setSection(sec, sec.departmentId, e.target.value as Coverage3802)} aria-label="Qoplash qoidasi">
                        {(['OKLAD_40', 'FULL', 'NONE'] as const).map((c) => (
                          <option key={c} value={c}>
                            {COVERAGE_LABEL[c]}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  {oladi && <td className="money px-3 py-2 text-right">{sec.coverage === 'NONE' ? '—' : formatTiyin(sec.coveredTiyin)}</td>}
                </tr>
                {isOpen && (
                  <tr className="bg-(--color-surface-muted)/50">
                    <td colSpan={oladi ? 6 : 4} className="px-3 pb-3">
                      <table className="mt-1 w-full text-xs">
                        <thead className="text-(--color-text-muted)">
                          <tr>
                            <th className="px-2 py-1 text-left font-semibold">Lavozim</th>
                            <th className="px-2 py-1 text-right font-semibold">Birlik</th>
                            <th className="px-2 py-1 text-left font-semibold">Razryad</th>
                            <th className="px-2 py-1 text-right font-semibold">Oklad (1 birlik)</th>
                            <th className="px-2 py-1 text-right font-semibold">40% ustama (1 birlik)</th>
                            <th className="px-2 py-1 text-right font-semibold">Jami (oylik)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sec.positions.map((p) => (
                            <tr key={p.row} className="border-t border-(--color-line)">
                              <td className="px-2 py-1 text-heading">{p.name}</td>
                              <td className="money px-2 py-1 text-right">{units(p.units)}</td>
                              <td className="px-2 py-1">{p.grade}</td>
                              <td className="money px-2 py-1 text-right">{formatTiyin(p.salaryTiyin)}</td>
                              <td className="money px-2 py-1 text-right">{formatTiyin(p.bonusTiyin)}</td>
                              <td className="money px-2 py-1 text-right">{formatTiyin(p.totalTiyin)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {!editable && <p className="px-5 py-2 text-xs text-(--color-text-faint)">Bog&apos;lash{oladi ? ' va qoplash qoidasi' : ''} — jadval saqlangandan keyin (faqat administrator).</p>}
    </div>
  );
}

/** Shu toifaga kimlar kiradi: ish haqi tarkibi (oy) → bo'lim va lavozim bo'yicha shtat lavozimiga */
function MembersCard({ kind, rev }: { kind: ShtatKind; rev: number }) {
  const [period, setPeriod] = useState<string | null>(null);
  const res = useAsync(() => shtat3802Api.members(kind, period).then((r) => r.data), [kind, period, rev]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const d = res.data;
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Bu toifaga kimlar kiradi"
        description="Ish haqi tarkibidagi xodimlar — bo'limi (xodimlar ro'yxati) va lavozimi (Kadrlar ma'lumotnomasi) bo'yicha shtatdagi lavozimga"
        actions={
          d && d.periods.length > 0 ? (
            <select className={SELECT} value={d.period ?? ''} onChange={(e) => setPeriod(e.target.value)} aria-label="Ish haqi tarkibi oyi">
              {d.periods.map((p) => (
                <option key={p} value={p}>
                  {formatPeriod(p)}
                </option>
              ))}
            </select>
          ) : undefined
        }
      />
      {res.error ? (
        <CardBody>
          <ErrorState message={res.error} onRetry={res.reload} />
        </CardBody>
      ) : !d ? (
        <LoadingState label="Xodimlar bog'lanmoqda" />
      ) : !d.periods.length ? (
        <CardBody className="text-sm text-(--color-text-muted)">Ish haqi tarkibi hali yuklanmagan («Xarajatlar › Ish haqi tarkibi»).</CardBody>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-(--color-line) px-5 py-2.5 text-xs text-(--color-text-muted)">
            <span>
              Shtat: <b className="text-heading">{units(d.totals.units)}</b> birlik
            </span>
            <span>
              Kiradi: <b className="text-heading">{d.totals.members}</b> xodim
            </span>
            {d.totals.others > 0 && (
              <span className="text-amber-800">
                Bo&apos;limda bor, lavozimi shtatda topilmagan: <b>{d.totals.others}</b>
              </span>
            )}
            {d.unmappedSections > 0 && <span className="text-amber-800">Bog&apos;lanmagan bo&apos;lim: {d.unmappedSections} (xodimlari ko&apos;rinmaydi)</span>}
            {d.noPosition > 0 && <span>Ma&apos;lumotnomada lavozimi yo&apos;q: {d.noPosition}</span>}
          </div>
          <div className="divide-y divide-(--color-line)">
            {d.sections.map((s) => {
              const isOpen = open.has(s.key);
              const extra = s.members - s.units;
              return (
                <div key={s.key}>
                  <button
                    type="button"
                    className={cn('flex w-full flex-wrap items-center gap-2 px-5 py-2 text-left text-sm hover:bg-(--color-surface-muted)', isOpen && 'bg-brand-50/50')}
                    onClick={() => setOpen((x) => { const n = new Set(x); if (n.has(s.key)) n.delete(s.key); else n.add(s.key); return n; })}
                    aria-expanded={isOpen}
                  >
                    <span className="text-(--color-text-faint)">{isOpen ? '▾' : '▸'}</span>
                    <span className="min-w-0 flex-1 font-medium text-heading">
                      {s.key}. {s.name}
                      <span className="ml-2 text-xs font-normal text-(--color-text-muted)">{s.departmentName ? `→ ${s.departmentName}` : 'bog‘lanmagan'}</span>
                    </span>
                    <span className="text-xs text-(--color-text-muted)">
                      {s.members} / {units(s.units)} birlik
                    </span>
                    {extra > 0 && <Badge tone="warn">+{units(extra)} ortiq</Badge>}
                    {s.others.length > 0 && <Badge tone="neutral">{s.others.length} ta boshqa lavozim</Badge>}
                  </button>
                  {isOpen && (
                    <div className="space-y-2 bg-(--color-surface-muted)/40 px-5 pb-3">
                      {!s.departmentId && <p className="pt-2 text-xs text-amber-800">Bo&apos;lim ilovadagi bo&apos;limga bog&apos;lanmagan — yuqoridagi jadvalda bog&apos;lang.</p>}
                      {s.positions.map((p, i) => (
                        <MemberTable key={i} title={p.name} note={`${p.filled} / ${units(p.units)} birlik${p.filled < p.units ? ` · bo'sh: ${units(p.units - p.filled)}` : p.filled > p.units ? ` · ortiq: ${units(p.filled - p.units)}` : ''}`} rows={p.members} />
                      ))}
                      {s.others.length > 0 && <MemberTable title="Bo'limda bor, lavozimi shtatda topilmagan" note="ko'rib chiqing: shtatda boshqa nom bilan yozilgan bo'lishi yoki shtatda yo'q bo'lishi mumkin" rows={s.others} warn />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}

function MemberTable({ title, note, rows, warn = false }: { title: string; note: string; rows: ShtatMember[]; warn?: boolean }) {
  return (
    <div className="pt-2">
      <p className={cn('text-xs font-semibold', warn ? 'text-amber-800' : 'text-heading')}>
        {title} <span className="font-normal text-(--color-text-muted)">· {note}</span>
      </p>
      {rows.length > 0 && (
        <table className="mt-1 w-full text-xs">
          <thead className="text-(--color-text-muted)">
            <tr>
              <th className="px-2 py-1 text-left font-semibold">F.I.Sh.</th>
              <th className="px-2 py-1 text-left font-semibold">Lavozimi (ma&apos;lumotnomada)</th>
              <th className="px-2 py-1 text-right font-semibold">Oklad</th>
              <th className="px-2 py-1 text-right font-semibold">40% ustama</th>
              <th className="px-2 py-1 text-right font-semibold">Tarkib jami</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.pinfl} className="border-t border-(--color-line)">
                <td className="px-2 py-1 text-heading">{m.fullName}</td>
                <td className="px-2 py-1">{m.position || '—'}</td>
                <td className="money px-2 py-1 text-right">{formatTiyin(m.okladTiyin)}</td>
                <td className="money px-2 py-1 text-right">{formatTiyin(m.ustamaTiyin)}</td>
                <td className="money px-2 py-1 text-right">{formatTiyin(m.totalTiyin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─────────── Har oylik real bajarilgan ishlar ───────────

const MONTH_NAMES = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];

/** Yil va oy tanlovi (faqat fayldagi yillar) */
function YearMonth({ label, value, years, onChange }: { label: string; value: string; years: number[]; onChange: (v: string) => void }) {
  const [y, m] = value.split('-').map(Number) as [number, number];
  return (
    <span className="flex items-center gap-1.5 text-sm">
      <span className="text-(--color-text-muted)">{label}</span>
      <select className={SELECT} value={y} onChange={(e) => onChange(`${e.target.value}-${String(m).padStart(2, '0')}`)} aria-label={`${label}: yil`}>
        {years.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
      <select className={SELECT} value={m} onChange={(e) => onChange(`${y}-${String(Number(e.target.value)).padStart(2, '0')}`)} aria-label={`${label}: oy`}>
        {MONTH_NAMES.map((name, i) => (
          <option key={name} value={i + 1}>
            {name}
          </option>
        ))}
      </select>
    </span>
  );
}

function OylikSection({ isAdmin, onToast }: { isAdmin: boolean; onToast: ToastFn }) {
  const list = useAsync(() => vedomost3802Api.list().then((r) => r.data.periods), []);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<VedAnalysis | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    try {
      const a = await vedomost3802Api.analyze(f);
      setPreview(a);
      setFile(f);
      setFrom(a.from);
      setTo(a.to);
    } catch (err) {
      onToast({ message: errorMessage(err, "Faylni o'qib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function accept() {
    if (!file) return;
    setBusy(true);
    try {
      const r = await vedomost3802Api.commit(file, from, to);
      onToast({ message: `Qabul qilindi: ${r.saved} oy (${formatPeriod(r.periods[0]!)} — ${formatPeriod(r.periods[r.periods.length - 1]!)})${r.replaced ? `, ${r.replaced} tasi almashtirildi` : ''}`, tone: 'success' });
      setPreview(null);
      setFile(null);
      list.reload();
    } catch (err) {
      onToast({ message: errorMessage(err, "Qabul qilib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const inRange = (p: string) => p >= from && p <= to;
  const chosen = preview ? preview.periods.filter((p) => inRange(p.period)) : [];
  const years = preview ? [...new Set(preview.periods.map((p) => Number(p.period.slice(0, 4))))].sort() : [];
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Har oylik real bajarilgan ishlar"
          description={
            preview
              ? `Fayl: ${preview.fileName} — ${preview.periods.length} oy (${formatPeriod(preview.from)} — ${formatPeriod(preview.to)}), hali qabul qilinmagan`
              : "3802 vedomosti («3802 dan olingan pullar»): har oy — xodimlarga hisoblangan ish haqi, bo'limlar bo'yicha. Fayl to'liq o'qiladi, qaysi oylarni qabul qilishni o'zingiz tanlaysiz"
          }
          actions={
            !preview && isAdmin ? (
              <>
                <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
                <Button size="sm" loading={busy} onClick={() => input.current?.click()}>
                  Fayl yuklash
                </Button>
              </>
            ) : undefined
          }
        />
        {preview && (
          <CardBody className="space-y-3 border-t border-(--color-line)">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-heading">Qaysi oylarni qabul qilay:</span>
              <YearMonth label="dan" value={from} years={years} onChange={setFrom} />
              <YearMonth label="gacha" value={to} years={years} onChange={setTo} />
              <span className="ml-auto flex gap-2">
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setPreview(null); setFile(null); }}>
                  Bekor qilish
                </Button>
                <Button size="sm" loading={busy} disabled={!chosen.length || from > to} onClick={() => void accept()}>
                  Tanlangan oraliqni qabul qilish ({chosen.length} oy)
                </Button>
              </span>
            </div>
            {from > to && <p className="text-xs text-(--color-expense)">«dan» oyi «gacha»dan keyin bo&apos;lmasin.</p>}
            <p className="text-xs text-(--color-text-muted)">
              Tanlangan: {chosen.length} oy · xodimlar (oylar bo&apos;yicha jami): {chosen.reduce((t, p) => t + p.employees, 0)} · Oklad <span className="money">{formatTiyin(chosen.reduce((t, p) => t + BigInt(p.okladTiyin), 0n).toString())}</span> · 40%{' '}
              <span className="money">{formatTiyin(chosen.reduce((t, p) => t + BigInt(p.ustamaTiyin), 0n).toString())}</span> · jami <span className="money">{formatTiyin(chosen.reduce((t, p) => t + BigInt(p.totalTiyin), 0n).toString())}</span>
              {chosen.some((p) => p.saved) && <> · {chosen.filter((p) => p.saved).length} oy avval qabul qilingan — almashtiriladi</>}
            </p>
            {preview.unknown.length > 0 && (
              <p className="text-xs text-amber-800">O&apos;qilmagan varaqlar: {preview.unknown.map((u) => `«${u.sheet}» — ${u.reason}`).join('; ')}</p>
            )}
          </CardBody>
        )}
      </Card>
      {preview && <PeriodsPreview periods={preview.periods} inRange={inRange} />}
      {!preview && (list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : !list.data ? <LoadingState label="Qabul qilingan oylar" /> : <SavedPeriods periods={list.data} isAdmin={isAdmin} onToast={onToast} onChanged={list.reload} />)}
    </div>
  );
}

function PeriodsPreview({ periods, inRange }: { periods: VedPeriodBrief[]; inRange: (p: string) => boolean }) {
  const years = [...new Set(periods.map((p) => p.period.slice(0, 4)))].sort().reverse();
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-(--color-surface-muted) text-[11px] tracking-wide text-(--color-text-muted) uppercase">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Oy</th>
              <th className="px-3 py-2 text-left font-semibold">Varaqlar (olinadi)</th>
              <th className="px-3 py-2 text-right font-semibold">Xodim</th>
              <th className="px-3 py-2 text-right font-semibold">Oklad</th>
              <th className="px-3 py-2 text-right font-semibold">40% ustama</th>
              <th className="px-3 py-2 text-right font-semibold">Jami</th>
              <th className="px-3 py-2 text-left font-semibold">Holat</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <Fragment key={y}>
                <tr className="bg-brand-50/40">
                  <td colSpan={7} className="px-3 py-1.5 text-xs font-semibold text-brand-800">
                    {y}-yil
                  </td>
                </tr>
                {periods
                  .filter((p) => p.period.startsWith(y))
                  .reverse()
                  .map((p) => {
                    const on = inRange(p.period);
                    return (
                      <tr key={p.period} className={cn('border-t border-(--color-line) align-top', !on && 'opacity-40')}>
                        <td className="px-3 py-2 font-medium whitespace-nowrap text-heading">{formatPeriod(p.period)}</td>
                        <td className="px-3 py-2 text-xs">
                          {p.used.map((s) => `«${s}»`).join(' + ')}
                          {p.skipped.length > 0 && <span className="block text-(--color-text-faint)">olinmadi: {p.skipped.map((s) => `«${s.sheet}» — ${s.reason}`).join('; ')}</span>}
                          {p.warnings.length > 0 && <span className="block text-amber-800">⚠ {p.warnings.join(' · ')}</span>}
                        </td>
                        <td className="money px-3 py-2 text-right">{p.employees}</td>
                        <td className="money px-3 py-2 text-right">{formatTiyin(p.okladTiyin)}</td>
                        <td className="money px-3 py-2 text-right">{formatTiyin(p.ustamaTiyin)}</td>
                        <td className="money px-3 py-2 text-right">{formatTiyin(p.totalTiyin)}</td>
                        <td className="px-3 py-2">{!on ? <Badge tone="neutral">tanlanmagan</Badge> : p.saved ? <Badge tone="warn">almashtiriladi</Badge> : <Badge tone="income">yangi</Badge>}</td>
                      </tr>
                    );
                  })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SavedPeriods({ periods, isAdmin, onToast, onChanged }: { periods: VedSavedPeriod[]; isAdmin: boolean; onToast: ToastFn; onChanged: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  /** O'chiriladigan oraliq (bitta oy — from = to) */
  const [removing, setRemoving] = useState<{ from: string; to: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      const r = (await vedomost3802Api.remove(removing.from, removing.to)).data;
      onToast({ message: `O'chirildi: ${r.removed} oy`, tone: 'success' });
      setRemoving(null);
      if (open && r.periods.includes(open)) setOpen(null);
      onChanged();
    } catch (err) {
      onToast({ message: errorMessage(err, "O'chirib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  const last = periods[0]?.period ?? '';
  const first = periods[periods.length - 1]?.period ?? '';
  if (!periods.length)
    return (
      <Card>
        <CardBody className="text-sm text-(--color-text-muted)">Hali hech qaysi oy qabul qilinmagan — «Fayl yuklash» bilan 3802 vedomostini yuklang.</CardBody>
      </Card>
    );
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Qabul qilingan oylar"
        description={`${periods.length} oy · oyni bosing — bo'limlar va xodimlar`}
        actions={
          isAdmin ? (
            <Button size="sm" variant="ghost" onClick={() => setRemoving({ from: first, to: last })} title="Hamma qabul qilingan oylarni o'chirish">
              Hammasini o&apos;chirish
            </Button>
          ) : undefined
        }
      />
      <div className="divide-y divide-(--color-line)">
        {periods.map((p) => (
          <div key={p.period}>
            <div className="flex items-center">
            <button
              type="button"
              className={cn('flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2 text-left text-sm hover:bg-(--color-surface-muted)', open === p.period && 'bg-brand-50/50')}
              onClick={() => setOpen(open === p.period ? null : p.period)}
              aria-expanded={open === p.period}
            >
              <span className="w-32 font-medium text-heading">
                <span className="mr-1 text-(--color-text-faint)">{open === p.period ? '▾' : '▸'}</span>
                {formatPeriod(p.period)}
              </span>
              <span className="text-xs text-(--color-text-muted)">{p.employees} xodim</span>
              <span className="text-xs">
                Oklad <span className="money">{formatTiyin(p.okladTiyin)}</span>
              </span>
              <span className="text-xs">
                40% <span className="money">{formatTiyin(p.ustamaTiyin)}</span>
              </span>
              <span className="text-xs">
                jami <span className="money font-semibold">{formatTiyin(p.totalTiyin)}</span>
              </span>
              {p.warnings.length > 0 && <Badge tone="warn">⚠ {p.warnings.length}</Badge>}
              <span className="ml-auto text-xs text-(--color-text-faint)">
                {p.sheets.map((s) => `«${s}»`).join(' + ')} · {formatDateTime(p.savedAt)}
              </span>
            </button>
            {isAdmin && (
              <button type="button" onClick={() => setRemoving({ from: p.period, to: p.period })} className="mr-3 shrink-0 rounded px-1.5 text-xs text-(--color-text-faint) hover:bg-red-50 hover:text-(--color-expense)" title={`${formatPeriod(p.period)} — o'chirish`} aria-label={`${formatPeriod(p.period)} — o'chirish`}>
                ✕
              </button>
            )}
            </div>
            {open === p.period && <PeriodDetail period={p.period} warnings={p.warnings} />}
          </div>
        ))}
      </div>
      <ConfirmDialog
        open={Boolean(removing)}
        danger
        title="Vedomostni o'chirish"
        message={removing ? (removing.from === removing.to ? `${formatPeriod(removing.from)} vedomosti o'chiriladi.` : `Hamma ${periods.length} oy (${formatPeriod(removing.from)} — ${formatPeriod(removing.to)}) o'chiriladi.`) + ' Faylni qayta yuklab tiklash mumkin.' : ''}
        confirmLabel="O'chirish"
        loading={busy}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </Card>
  );
}

function PeriodDetail({ period, warnings }: { period: string; warnings: string[] }) {
  const res = useAsync(() => vedomost3802Api.detail(period).then((r) => r.data), [period]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  if (res.error) return <p className="px-5 py-2 text-xs text-(--color-expense)">{res.error}</p>;
  const d = res.data;
  if (!d) return <p className="px-5 py-2 text-xs text-(--color-text-muted)">Yuklanmoqda…</p>;
  return (
    <div className="space-y-1 bg-(--color-surface-muted)/40 px-5 pb-3">
      {warnings.length > 0 && <p className="pt-2 text-xs text-amber-800">⚠ {warnings.join(' · ')}</p>}
      {d.sections.map((s, i) => {
        const key = `${i}`;
        const isOpen = open.has(key);
        return (
          <div key={key} className="rounded-(--radius-control) border border-(--color-line) bg-white">
            <button
              type="button"
              className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 text-left text-sm"
              onClick={() => setOpen((x) => { const n = new Set(x); if (n.has(key)) n.delete(key); else n.add(key); return n; })}
              aria-expanded={isOpen}
            >
              <span className="min-w-0 flex-1 font-medium text-heading">
                <span className="mr-1 text-(--color-text-faint)">{isOpen ? '▾' : '▸'}</span>
                {s.name}
              </span>
              <span className="text-xs text-(--color-text-muted)">{s.employees.length} xodim</span>
              <span className="text-xs">
                Oklad <span className="money">{formatTiyin(s.okladTiyin)}</span> · 40% <span className="money">{formatTiyin(s.ustamaTiyin)}</span> · jami <span className="money">{formatTiyin(s.totalTiyin)}</span>
              </span>
              {!s.ok && <Badge tone="expense">bo&apos;lim jamisi: {formatTiyin(s.fileTotalTiyin ?? '0')}</Badge>}
            </button>
            {isOpen && (
              <div className="overflow-x-auto border-t border-(--color-line)">
                <table className="w-full text-xs">
                  <thead className="text-(--color-text-muted)">
                    <tr>
                      <th className="px-2 py-1 text-left font-semibold">F.I.Sh.</th>
                      <th className="px-2 py-1 text-left font-semibold">Lavozimi</th>
                      {d.components.map((c) => (
                        <th key={c.code} className="px-2 py-1 text-right font-semibold whitespace-nowrap">
                          {c.label}
                        </th>
                      ))}
                      <th className="px-2 py-1 text-right font-semibold">Jami</th>
                      <th className="px-2 py-1 text-left font-semibold">Izoh</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.employees.map((e) => (
                      <tr key={e.row} className="border-t border-(--color-line)">
                        <td className="px-2 py-1 whitespace-nowrap text-heading">{e.fullName}</td>
                        <td className="px-2 py-1">{e.position || '—'}</td>
                        {d.components.map((c) => (
                          <td key={c.code} className="money px-2 py-1 text-right">
                            {e.amounts[c.code] ? formatTiyin(e.amounts[c.code]!) : ''}
                          </td>
                        ))}
                        <td className="money px-2 py-1 text-right font-semibold">{formatTiyin(e.totalTiyin)}</td>
                        <td className="px-2 py-1 text-(--color-text-muted)">{e.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** «Qoplash va qoldiq»dan boshqa bo'limlar */
export function Section3802View({ section, isAdmin, onToast }: { section: Exclude<Section3802, 'QOPLASH'>; isAdmin: boolean; onToast: ToastFn }) {
  if (section === 'SHTAT') return <ShtatSection isAdmin={isAdmin} onToast={onToast} />;
  if (section === 'OYLIK') return <OylikSection isAdmin={isAdmin} onToast={onToast} />;
  return <NazoratSection isAdmin={isAdmin} onToast={onToast} />;
}
