'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { ErrorState, TableSkeleton } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { Dropzone, openDropzone } from '@/features/regional-desk/bits';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';
import { checkFile, download, hpApi, KIND_TEXT, som, templateUrl, type DataStatus, type ImportKind, type ImportSession, type Issue, type KindMeta } from './api';
import { Banner, Panel, tdCls, thCls } from './ui';

// ═══════════════════════════════════════════════════════════
// Ma'lumotlarni yuklash: shablonlar → fayl → tekshiruv (bazaga yozilmaydi) → natija → tasdiqlash.
// Har bir varaq alohida sessiya; xato qatorlar import qilinmaydi; NAMUNA qatorlari o'tkazib yuboriladi.
// ═══════════════════════════════════════════════════════════

const STATUS_LABEL: Record<ImportSession['status'], { label: string; cls: string }> = {
  CHECKED: { label: 'Tekshirildi — tasdiq kutilmoqda', cls: 'bg-amber-50 text-amber-700' },
  IMPORTED: { label: 'Import qilindi', cls: 'bg-(--color-income-soft) text-(--color-income)' },
  CANCELLED: { label: 'Bekor qilindi', cls: 'bg-(--color-surface-sunken) text-(--color-text-muted)' },
};

function dt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function HpUpload() {
  const { isAdmin } = useAuth();
  const [tick, setTick] = useState(0);
  const kinds = useAsync(() => hpApi.kinds().then((r) => r.data), []);
  const status = useAsync(() => hpApi.status().then((r) => r.data), [tick]);
  const history = useAsync(() => hpApi.imports().then((r) => r.data), [tick]);
  const [kind, setKind] = useState<ImportKind | 'ALL'>('ALL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<{ fileName: string; sessions: ImportSession[] } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'error' } | null>(null);
  const [dl, setDl] = useState<string | null>(null);

  const meta = useMemo(() => new Map((kinds.data ?? []).map((k) => [k.kind, k])), [kinds.data]);

  const onFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setChecked(null);
    try {
      setChecked(await checkFile(file, kind));
      setTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Faylni tekshirib bo‘lmadi');
    } finally {
      setBusy(false);
    }
  };

  const get = async (k: ImportKind | 'ALL', fill: boolean) => {
    const key = `${k}${fill ? '+' : ''}`;
    setDl(key);
    try {
      await download(templateUrl(k, fill), k === 'ALL' ? 'hudud-reja-shablonlar.xlsx' : `hudud-reja-${k}.xlsx`);
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : 'Yuklab bo‘lmadi', tone: 'error' });
    } finally {
      setDl(null);
    }
  };

  const updated = (s: ImportSession) => {
    setChecked((c) => (c ? { ...c, sessions: c.sessions.map((x) => (x.id === s.id ? { ...x, ...s } : x)) } : c));
    setTick((t) => t + 1);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ma’lumotlarni yuklash"
        description="Tarixiy daromad, xizmatlar soni, xodimlar va tariflar — Excel shablonlari orqali"
        actions={
          <>
            <Button size="sm" loading={dl === 'ALL'} onClick={() => get('ALL', false)}>
              Barcha shablonlar
            </Button>
            <Button size="sm" variant="secondary" loading={dl === 'ALL+'} onClick={() => get('ALL', true)} title="Yuklangan yozuvlar shablon ko‘rinishida — tuzatib qayta yuklash uchun">
              Mavjud ma’lumot bilan
            </Button>
          </>
        }
      />

      <Banner tone="info">
        Fayl avval <b>tekshiriladi</b> — bazaga hech narsa yozilmaydi. Natijani ko‘rib, <b>«Tasdiqlash»</b> bosilgandagina import qilinadi. Shablondagi kulrang <b>NAMUNA</b> qatorlari va xato qatorlar import qilinmaydi.
        Bo‘sh oy «ma’lumot yo‘q» deb olinadi (nol emas). Bir xil faylni qayta yuklash dublikat yaratmaydi.
      </Banner>

      {isAdmin ? (
        <Panel title="Fayl yuklash" description="Bitta faylda bir nechta varaq bo‘lishi mumkin — har biri alohida tekshiriladi">
          <div className="mb-4 flex flex-wrap gap-1.5">
            {(['ALL', 'STATS', 'EMP_MONTHS', 'EMP_SERVICES', 'FACTORS', 'SERVICES'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn('rounded-full border px-3 py-1.5 text-sm font-medium transition-colors', kind === k ? 'border-brand-600 bg-brand-600 text-white' : 'border-(--color-border) bg-white text-heading hover:bg-brand-50')}
              >
                {k === 'ALL' ? 'Avtomatik (varaq nomi bo‘yicha)' : KIND_TEXT[k]}
              </button>
            ))}
          </div>
          <Dropzone
            onFile={onFile}
            busy={busy}
            title="Excel faylni shu yerga tashlang yoki bosing"
            hint={
              <>
                Faqat .xlsx yoki .xltx, ko‘pi bilan 10 MB. {kind === 'ALL' ? 'Varaqlar nomi (Daromad_Tarixi, Xodimlar_Tarixi …) yoki sarlavhalari bo‘yicha aniqlanadi.' : `Fayl «${KIND_TEXT[kind]}» sifatida o‘qiladi.`}
              </>
            }
          />
          {error && (
            <div className="mt-4">
              <Banner tone="bad">{error}</Banner>
            </div>
          )}
        </Panel>
      ) : (
        <Banner tone="warn">Ma’lumot yuklash faqat administrator uchun. Siz shablonlarni yuklab olishingiz va holatni ko‘rishingiz mumkin.</Banner>
      )}

      {checked && (
        <div className="space-y-4">
          <p className="text-sm text-(--color-text-muted)">
            «{checked.fileName}» — {checked.sessions.length} ta varaq tekshirildi
          </p>
          {checked.sessions.map((s) => (
            <SessionCard key={s.id} session={s} meta={meta.get(s.kind)} canWrite={isAdmin} onChange={updated} onToast={setToast} />
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {kinds.error && <ErrorState message={kinds.error} />}
        {(kinds.data ?? []).map((k) => (
          <KindCard
            key={k.kind}
            meta={k}
            status={status.data ?? null}
            loading={dl}
            onTemplate={(fill) => get(k.kind, fill)}
            onUpload={
              isAdmin
                ? () => {
                    setKind(k.kind);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                    setTimeout(() => openDropzone(), 50);
                  }
                : undefined
            }
          />
        ))}
      </div>

      <Panel title="Yuklash tarixi" description="Har bir tekshiruv va import — kim, qachon, natija" flush>
        {history.error ? (
          <div className="p-5">
            <ErrorState message={history.error} />
          </div>
        ) : !history.data ? (
          <div className="p-5">
            <TableSkeleton rows={4} cols={6} />
          </div>
        ) : history.data.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-(--color-text-muted)">Hali hech narsa yuklanmagan</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--color-border)">
                  <th className={cn(thCls, 'text-left')}>Sana</th>
                  <th className={cn(thCls, 'text-left')}>Fayl</th>
                  <th className={cn(thCls, 'text-left')}>Turi</th>
                  <th className={cn(thCls, 'text-right')}>To‘g‘ri / xato</th>
                  <th className={cn(thCls, 'text-right')}>Natija</th>
                  <th className={cn(thCls, 'text-left')}>Holat</th>
                  <th className={cn(thCls, 'text-left')}>Kim</th>
                </tr>
              </thead>
              <tbody>
                {history.data.map((h) => (
                  <tr key={h.id} onClick={() => setOpenId(h.id)} className="cursor-pointer border-b border-(--color-border) last:border-0 hover:bg-slate-50">
                    <td className={cn(tdCls, 'whitespace-nowrap text-(--color-text-muted)')}>{dt(h.importedAt ?? h.createdAt)}</td>
                    <td className={cn(tdCls, 'max-w-64 truncate font-medium text-heading')} title={h.fileName}>
                      {h.fileName}
                    </td>
                    <td className={tdCls}>{KIND_TEXT[h.kind]}</td>
                    <td className={cn(tdCls, 'money whitespace-nowrap text-right')}>
                      {h.summary.valid} / <span className={h.summary.errorRows ? 'text-(--color-expense)' : ''}>{h.summary.errorRows}</span>
                    </td>
                    <td className={cn(tdCls, 'whitespace-nowrap text-right text-xs')}>
                      {h.summary.result ? `+${h.summary.result.created} yangi · ${h.summary.result.updated} yangilandi${h.summary.result.skipped ? ` · ${h.summary.result.skipped} o‘tkazildi` : ''}` : '—'}
                    </td>
                    <td className={tdCls}>
                      <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_LABEL[h.status].cls)}>{STATUS_LABEL[h.status].label}</span>
                    </td>
                    <td className={cn(tdCls, 'text-(--color-text-muted)')}>{h.importedBy ?? h.createdBy ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <SessionDrawer id={openId} meta={meta} canWrite={isAdmin} onClose={() => setOpenId(null)} onChange={() => setTick((t) => t + 1)} onToast={setToast} />
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </div>
  );
}

function KindCard({ meta, status, onTemplate, onUpload, loading }: { meta: KindMeta; status: DataStatus | null; onTemplate: (fill: boolean) => void; onUpload?: () => void; loading: string | null }) {
  const st = status?.[meta.kind] as (DataStatus['STATS'] & DataStatus['SERVICES']) | undefined;
  const rows = st?.rows ?? 0;
  return (
    <section className="flex flex-col rounded-(--radius-card) bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">Varaq: {meta.sheet}</p>
          <h3 className="text-base font-bold text-heading">{meta.title}</h3>
        </div>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', meta.mandatory ? 'bg-orange-50 text-orange-700' : 'bg-(--color-surface-sunken) text-(--color-text-muted)')}>{meta.mandatory ? 'Majburiy' : 'Ixtiyoriy'}</span>
      </div>
      <p className="mt-2 text-sm text-heading">{meta.what}</p>
      <p className="mt-1 text-xs text-(--color-text-muted)">
        <b>Nima uchun:</b> {meta.why}
      </p>
      <p className="mt-1 text-xs text-(--color-text-muted)">
        <b>Bir qator:</b> {meta.row}
      </p>
      <div className="mt-3 flex flex-wrap gap-1">
        {meta.cols.map((c) => (
          <span key={c.key} title={c.hint} className={cn('rounded-md px-1.5 py-0.5 font-mono text-[11px]', c.required ? 'bg-orange-50 text-orange-800' : 'bg-(--color-surface-sunken) text-(--color-text-muted)')}>
            {c.key}
            {c.required && '*'}
          </span>
        ))}
      </div>
      <div className="mt-3 rounded-lg bg-(--color-surface-sunken) px-3 py-2 text-xs">
        {!status ? (
          <span className="text-(--color-text-muted)">…</span>
        ) : meta.kind === 'SERVICES' ? (
          <span>
            Katalogda <b>{rows}</b> xizmat, tarifi bor: <b>{st?.withTariff ?? 0}</b>
          </span>
        ) : rows === 0 ? (
          <span className="text-(--color-text-muted)">Hali yuklanmagan</span>
        ) : (
          <span>
            Bazada <b>{som(rows)}</b> qator{st?.from ? `, ${st.from} — ${st.to}` : ''}
          </span>
        )}
        {meta.kind === 'STATS' && status && (
          <span className="block text-(--color-text-muted)">
            Dasturdagi Hududlar tushumi: {som(status.STATS.system.rows)} yozuv{status.STATS.system.from ? `, ${status.STATS.system.from} — ${status.STATS.system.to}` : ''} (avtomatik qo‘shiladi)
          </span>
        )}
        {st?.lastImport && <span className="block text-(--color-text-muted)">So‘nggi import: {dt(st.lastImport.importedAt)}</span>}
      </div>
      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        <Button size="sm" variant="secondary" loading={loading === meta.kind} onClick={() => onTemplate(false)}>
          Shablon
        </Button>
        {meta.kind !== 'SERVICES' && rows > 0 && (
          <Button size="sm" variant="ghost" loading={loading === `${meta.kind}+`} onClick={() => onTemplate(true)}>
            Mavjud bilan
          </Button>
        )}
        {meta.kind === 'SERVICES' && (
          <Button size="sm" variant="ghost" loading={loading === `${meta.kind}+`} onClick={() => onTemplate(true)}>
            Joriy katalog
          </Button>
        )}
        {onUpload && (
          <Button size="sm" className="ml-auto" onClick={onUpload}>
            Yuklash
          </Button>
        )}
      </div>
    </section>
  );
}

const LEVELS: { key: Issue['level']; label: string; cls: string }[] = [
  { key: 'error', label: 'Xatolar', cls: 'text-red-700' },
  { key: 'warning', label: 'Ogohlantirishlar', cls: 'text-amber-700' },
  { key: 'info', label: 'Ma’lumot', cls: 'text-sky-700' },
];

function Chip({ label, value, tone }: { label: string; value: number | string; tone?: 'ok' | 'bad' | 'warn' | 'brand' }) {
  return (
    <div className={cn('rounded-lg px-3 py-2', tone === 'bad' ? 'bg-red-50' : tone === 'warn' ? 'bg-amber-50' : tone === 'ok' ? 'bg-emerald-50' : tone === 'brand' ? 'bg-brand-50' : 'bg-(--color-surface-sunken)')}>
      <p className="text-[11px] text-(--color-text-muted)">{label}</p>
      <p className={cn('money truncate font-bold leading-tight', String(value).length > 9 ? 'text-sm leading-7' : 'text-lg', tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : tone === 'ok' ? 'text-emerald-700' : 'text-heading')}>{value}</p>
    </div>
  );
}

/** Bitta varaq tekshiruvi natijasi: hisob, xatolar, oldindan ko'rish, tasdiqlash */
export function SessionCard({ session, meta, canWrite, onChange, onToast, embedded }: { session: ImportSession; meta?: KindMeta; canWrite: boolean; onChange: (s: ImportSession) => void; onToast: (t: { message: string; tone?: 'success' | 'error' }) => void; embedded?: boolean }) {
  const s = session.summary;
  const issues = session.issues ?? [];
  const [level, setLevel] = useState<Issue['level']>(s.errors ? 'error' : s.warnings ? 'warning' : 'info');
  const [policy, setPolicy] = useState<'upsert' | 'insert'>('upsert');
  const [exclude, setExclude] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null);
  const [showAll, setShowAll] = useState(false);
  const shown = issues.filter((i) => i.level === level);
  const preview = session.preview ?? [];
  const cols = meta?.cols.filter((c) => preview.some((p) => p.values[c.key] !== null && p.values[c.key] !== undefined && p.values[c.key] !== '')) ?? [];
  const willWrite = s.new + (policy === 'upsert' ? s.update : 0) - [...exclude].filter((r) => preview.find((p) => p.row === r && (p.status === 'new' || (policy === 'upsert' && p.status === 'update')))).length;
  const pending = session.status === 'CHECKED';

  const confirm = async () => {
    setBusy('confirm');
    try {
      const r = await hpApi.confirm(session.id, policy, [...exclude]);
      onChange(r.data);
      const res = r.data.summary.result;
      onToast({ message: `Import qilindi: ${res?.created ?? 0} yangi, ${res?.updated ?? 0} yangilandi` });
    } catch (e) {
      onToast({ message: e instanceof Error ? e.message : 'Import xatosi', tone: 'error' });
    } finally {
      setBusy(null);
    }
  };
  const cancel = async () => {
    setBusy('cancel');
    try {
      await hpApi.cancel(session.id);
      onChange({ ...session, status: 'CANCELLED' });
    } catch (e) {
      onToast({ message: e instanceof Error ? e.message : 'Xato', tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const body = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <Chip label="Fayldagi qatorlar" value={s.dataRows} />
        <Chip label="NAMUNA (o‘tkazildi)" value={s.samples} />
        <Chip label="To‘g‘ri qatorlar" value={s.valid} tone="ok" />
        <Chip label="Xato qatorlar" value={s.errorRows} tone={s.errorRows ? 'bad' : undefined} />
        <Chip label="Yangi" value={s.new} tone="brand" />
        <Chip label="Yangilanadi" value={s.update} tone={s.update ? 'warn' : undefined} />
        <Chip label="O‘zgarmagan" value={s.same} />
        <Chip label="Davr" value={s.from ? (s.from === s.to ? s.from : `${s.from} — ${s.to}`) : '—'} />
      </div>

      {issues.length > 0 && (
        <div className="rounded-lg border border-(--color-border)">
          <div className="flex flex-wrap gap-1 border-b border-(--color-border) px-3 py-2">
            {LEVELS.map((l) => {
              const n = issues.filter((i) => i.level === l.key).length;
              return (
                <button key={l.key} type="button" disabled={!n} onClick={() => setLevel(l.key)} className={cn('rounded-md px-2.5 py-1 text-sm font-medium disabled:opacity-40', level === l.key ? 'bg-(--color-surface-sunken)' : 'hover:bg-slate-50', l.cls)}>
                  {l.label} ({n})
                </button>
              );
            })}
          </div>
          <div className={cn('overflow-auto', showAll ? 'max-h-[32rem]' : 'max-h-64')}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-(--color-border)">
                  <th className={cn(thCls, 'w-20 text-left')}>Qator</th>
                  <th className={cn(thCls, 'w-40 text-left')}>Ustun</th>
                  <th className={cn(thCls, 'text-left')}>Izoh</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i, k) => (
                  <tr key={k} className="border-b border-(--color-border) last:border-0">
                    <td className={cn(tdCls, 'py-1.5 font-mono text-xs')}>{i.row ?? '—'}</td>
                    <td className={cn(tdCls, 'py-1.5 font-mono text-xs text-(--color-text-muted)')}>{i.col ?? '—'}</td>
                    <td className={cn(tdCls, 'py-1.5')}>{i.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.length > 8 && (
            <button type="button" onClick={() => setShowAll((x) => !x)} className="w-full border-t border-(--color-border) py-1.5 text-xs font-medium text-brand-700 hover:bg-slate-50">
              {showAll ? 'Kamroq' : 'Kattaroq oynada'}
            </button>
          )}
        </div>
      )}

      {pending && preview.length > 0 && (
        <div className="rounded-lg border border-(--color-border)">
          <p className="border-b border-(--color-border) px-3 py-2 text-sm font-semibold text-heading">
            Import qilinadigan qatorlar{preview.length < s.valid ? ` (birinchi ${preview.length} tasi)` : ''} — keraksizini belgidan chiqaring
          </p>
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-(--color-border)">
                  <th className={cn(thCls, 'w-10')} />
                  <th className={cn(thCls, 'text-left')}>Qator</th>
                  <th className={cn(thCls, 'text-left')}>Holat</th>
                  {cols.map((c) => (
                    <th key={c.key} className={cn(thCls, 'text-left font-mono')}>
                      {c.key}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((p) => {
                  const off = exclude.has(p.row);
                  return (
                    <tr key={p.row} className={cn('border-b border-(--color-border) last:border-0', off && 'opacity-40')}>
                      <td className={cn(tdCls, 'py-1.5 text-center')}>
                        {p.status !== 'same' && (
                          <input
                            type="checkbox"
                            checked={!off}
                            onChange={() =>
                              setExclude((e) => {
                                const n = new Set(e);
                                if (n.has(p.row)) n.delete(p.row);
                                else n.add(p.row);
                                return n;
                              })
                            }
                            aria-label={`${p.row}-qator`}
                          />
                        )}
                      </td>
                      <td className={cn(tdCls, 'py-1.5 font-mono text-xs')}>{p.row}</td>
                      <td className={cn(tdCls, 'py-1.5 whitespace-nowrap text-xs font-semibold')}>
                        {p.status === 'new' ? <span className="text-brand-700">yangi</span> : p.status === 'update' ? <span className="text-amber-700">yangilanadi</span> : <span className="text-(--color-text-muted)">o‘zgarmagan</span>}
                      </td>
                      {cols.map((c) => (
                        <td key={c.key} className={cn(tdCls, 'py-1.5 whitespace-nowrap text-xs', p.changes?.includes(c.key) && 'bg-amber-50 font-semibold text-amber-900')}>
                          {fmtVal(p.values[c.key], c.type)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pending && canWrite && (
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg bg-(--color-surface-sunken) p-3">
          <div className="space-y-1.5 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={policy === 'upsert'} onChange={() => setPolicy('upsert')} />
              Yangilarini qo‘shish va o‘zgarganlarini yangilash
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={policy === 'insert'} onChange={() => setPolicy('insert')} />
              Faqat yangilarini qo‘shish (bazadagilar o‘zgarmaydi)
            </label>
            <p className="text-xs text-(--color-text-muted)">
              Yoziladi: <b>{Math.max(0, willWrite)}</b> qator{s.errorRows ? ` · ${s.errorRows} xato qator import qilinmaydi` : ''}
              {exclude.size ? ` · ${exclude.size} qator chiqarib tashlandi` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" loading={busy === 'cancel'} disabled={busy !== null} onClick={cancel}>
              Bekor qilish
            </Button>
            <Button loading={busy === 'confirm'} disabled={busy !== null || s.valid === 0 || willWrite <= 0} onClick={confirm}>
              Tasdiqlash va import qilish
            </Button>
          </div>
        </div>
      )}
      {session.status === 'IMPORTED' && s.result && (
        <Banner tone="ok">
          Import qilindi{session.importedAt ? ` (${dt(session.importedAt)})` : ''}: {s.result.created} yangi, {s.result.updated} yangilandi, {s.result.skipped} o‘tkazib yuborildi{s.result.excluded ? `, ${s.result.excluded} chiqarib tashlandi` : ''}.
        </Banner>
      )}
    </div>
  );

  if (embedded) return body;
  return (
    <Panel
      title={
        <span className="flex flex-wrap items-center gap-2">
          {s.title}
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_LABEL[session.status].cls)}>{STATUS_LABEL[session.status].label}</span>
        </span>
      }
      description={`Varaq «${s.sheet}» · ${session.fileName}${s.regions ? ` · ${s.regions} hudud` : ''}`}
    >
      {body}
    </Panel>
  );
}

function fmtVal(v: unknown, type?: string): string {
  if (v === null || v === undefined || v === '') return '';
  if (type === 'money' && typeof v === 'number') return som(v / 100);
  if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) >= 1000 ? som(v) : String(v).replace('.', ',');
  if (typeof v === 'boolean') return v ? 'ha' : 'yo‘q';
  return String(v);
}

function SessionDrawer({ id, meta, canWrite, onClose, onChange, onToast }: { id: string | null; meta: Map<ImportKind, KindMeta>; canWrite: boolean; onClose: () => void; onChange: () => void; onToast: (t: { message: string; tone?: 'success' | 'error' }) => void }) {
  const [tick, setTick] = useState(0);
  const q = useAsync(() => (id ? hpApi.importOne(id).then((r) => r.data) : Promise.resolve(null)), [id, tick]);
  const s = q.data;
  return (
    <Drawer open={id !== null} onClose={onClose} title={s ? s.summary.title : 'Import'} description={s ? `${s.fileName} · ${dt(s.createdAt)}${s.createdBy ? ` · ${s.createdBy}` : ''}` : undefined} width="xl">
      {q.error ? (
        <ErrorState message={q.error} />
      ) : !s ? (
        <TableSkeleton rows={4} cols={3} />
      ) : (
        <SessionCard
          embedded
          session={s}
          meta={meta.get(s.kind)}
          canWrite={canWrite}
          onToast={onToast}
          onChange={() => {
            setTick((t) => t + 1);
            onChange();
          }}
        />
      )}
    </Drawer>
  );
}