'use client';

import { ActionButton, ExcelButton, MoneyCell, NameCell, PillTabs, ReportCard, RTable, SearchInput, SelectBox, StatTiles, STICKY_NAME, STICKY_NO, TableNote, Td, Th, Tr, sum } from '@/components/report/report';
import { StatusBadge } from '@/components/report/report-extra-b';
import { EmptyNote, LoadingCard } from '@/components/report/report-extra-c';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Toast } from '@/components/ui/toast';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatPeriod } from '@/lib/format';
import { unitByCode } from '@/lib/segments';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useRef, useState, type ReactNode } from 'react';
import { xaridApi, type XaridAnalysis, type XaridKind, type XaridRow, type XaridStatus, type XaridView } from './api';

// ═══════════════════════════════════════════════════════════
// Umumiy manba › Xarajatlar › Asosiy vositalar › Xarid shabloni (1-bosqich — faqat reestr, raqamlarga ta'sir qilmaydi):
// «Моддий-техника эҳтиёжлари маълумотномаси» yuklanadi (umumiy shablon tizimi) va aniqlab oluvchi filtr har qatorni
// turga ajratadi: asosiy vosita / kam baholi buyum / sarf materiali / poligrafiya va sovg'a / xizmat; holat, birlik,
// platforma, summa xatolari. Tartib: kartalar → aniq jadval (reestr) → jamlanmalar → filtr qoidasi.
// ═══════════════════════════════════════════════════════════

const KIND_TONE: Record<XaridKind, 'green' | 'blue' | 'amber' | 'muted' | 'red'> = { ASSET: 'green', LOW_VALUE: 'blue', SUPPLY: 'muted', PRINT_GIFT: 'amber', SERVICE: 'muted' };
const STATUS_TONE: Record<XaridStatus, 'green' | 'blue' | 'amber' | 'muted' | 'red'> = { DONE: 'green', IN_PROGRESS: 'blue', PLANNED: 'muted', REJECTED: 'red' };
const STATUS_LABEL: Record<XaridStatus, string> = { DONE: 'Bajarildi', IN_PROGRESS: 'Ijroda', PLANNED: 'Rejada', REJECTED: 'Rad etildi' };
const n = (s: string | null | undefined) => (s ? Number(s) : 0);
const unitLabel = (code: string) => unitByCode(code)?.label ?? code;
const day = (d: string | null) => (d ? formatDate(d) : '');

export function XaridPanel() {
  const { isAdmin } = useAuth();
  const res = useAsync(() => xaridApi.view().then((r) => r.data), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<XaridAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'error' } | null>(null);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      setPreview(await xaridApi.analyze(f));
      setFile(f);
    } catch (e) {
      setToast({ message: errorMessage(e, "Faylni o'qib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const save = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await xaridApi.commit(file);
      setPreview(null);
      setFile(null);
      setToast({ message: `Saqlandi: ${r.rows} qator` });
      res.reload();
    } catch (e) {
      setToast({ message: errorMessage(e, "Saqlab bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await xaridApi.remove();
      setAsking(false);
      setToast({ message: "Xarid shabloni o'chirildi" });
      res.reload();
    } catch (e) {
      setToast({ message: errorMessage(e, "O'chirib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const upload = (label: string) =>
    isAdmin ? (
      <>
        <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
        <ActionButton onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? 'Tekshirilmoqda…' : label}
        </ActionButton>
      </>
    ) : null;
  const templateBtn = <ActionButton onClick={() => void xaridApi.template().catch((e: unknown) => setToast({ message: errorMessage(e, "Shablonni yuklab bo'lmadi"), tone: 'error' }))}>Shablon</ActionButton>;

  let body;
  if (preview) {
    body = (
      <div className="space-y-4">
        <ReportCard
          title={`Tekshiruv: ${preview.fileName}`}
          badge={`«${preview.sheet}» varag'i · sarlavha ${preview.headerRow}-qatorda · ${preview.summary.rows} qator`}
          actions={
            <>
              <Button variant="secondary" onClick={() => { setPreview(null); setFile(null); }} disabled={busy}>
                Bekor qilish
              </Button>
              <Button onClick={() => void save()} loading={busy}>
                Saqlash
              </Button>
            </>
          }
        >
          <TableNote>
            Hali hech narsa saqlanmadi — pastdagi natijani tekshiring va «Saqlash»ni bosing. Avvalgi yuklangan fayl almashtiriladi, qo&apos;lda belgilangan turlar
            saqlanib qoladi.
            {preview.skipped.length > 0 && ` O'qilmagan qatorlar: ${preview.skipped.map((s) => `${s.row} (${s.reason})`).join(', ')}.`}
            {preview.missing.length > 0 && ` Faylda yo'q ustunlar: ${preview.missing.join(', ')}.`}
          </TableNote>
        </ReportCard>
        <Registry d={preview} isAdmin={false} onChanged={() => {}} />
      </div>
    );
  } else if (!res.data) {
    body = <LoadingCard label="Xarid shabloni yuklanmoqda" error={res.error} onRetry={res.reload} />;
  } else if (!res.data.loaded) {
    body = (
      <ReportCard
        title="Xarid shabloni: moddiy-texnika ehtiyojlari ma'lumotnomasi"
        actions={
          <>
            {templateBtn}
            {upload('Fayl yuklash')}
          </>
        }
      >
        <EmptyNote>Hali yuklanmagan — «Shablon»ni yuklab oling yoki mavjud ma&apos;lumotnomani (talabnoma → shartnoma → schyot-faktura) yuklang.</EmptyNote>
        <TableNote>
          Tizim har qatorni aniqlaydi: asosiy vosita (uzoq ishlatiladigan, 1 donasi chegaradan qimmat), kam baholi buyum, sarf materiali, poligrafiya va sovg&apos;a,
          xizmat; holat (bajarildi, ijroda, rejada, rad etildi), birlik va platforma. Summa xatolari («soni × 1 lik ≠ jami») ko&apos;rsatiladi. Bu bosqichda raqamlarga
          ta&apos;sir qilmaydi.
        </TableNote>
      </ReportCard>
    );
  } else {
    const d = res.data;
    body = (
      <div className="space-y-4">
        <Registry
          d={d}
          isAdmin={isAdmin}
          onChanged={res.reload}
          onError={(m) => setToast({ message: m, tone: 'error' })}
          actions={
            <>
              {templateBtn}
              {upload('Qayta yuklash')}
              {isAdmin && <ActionButton onClick={() => setAsking(true)}>O&apos;chirish</ActionButton>}
            </>
          }
          meta={`${d.fileName} · ${d.savedAt ? formatDate(d.savedAt.slice(0, 10)) : ''}${d.savedBy ? ` · ${d.savedBy}` : ''}`}
        />
        <RuleCard d={d} isAdmin={isAdmin} onSaved={() => { setToast({ message: 'Chegara saqlandi' }); res.reload(); }} onError={(m) => setToast({ message: m, tone: 'error' })} />
      </div>
    );
  }

  return (
    <>
      {body}
      <ConfirmDialog open={asking} title="Xarid shablonini o'chirish" message="Yuklangan fayl o'chiriladi. Filtr qoidasi va qo'lda belgilangan turlar qoladi (qayta yuklanganda ishlatiladi)." confirmLabel="O'chirish" danger loading={busy} onConfirm={() => void remove()} onCancel={() => setAsking(false)} />
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </>
  );
}

/** Kartalar → aniq jadval (reestr) → jamlanmalar */
function Registry({ d, isAdmin, onChanged, onError, actions, meta }: { d: XaridView; isAdmin: boolean; onChanged: () => void; onError?: (m: string) => void; actions?: ReactNode; meta?: string }) {
  const [kind, setKind] = useState<'ALL' | XaridKind>('ALL');
  const [status, setStatus] = useState<'DONE' | 'ALL' | XaridStatus>('DONE');
  const [unit, setUnit] = useState('');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const rows = d.rows.filter(
    (r) =>
      (kind === 'ALL' || r.kind === kind) &&
      (status === 'ALL' || r.status === status) &&
      (!unit || r.unit === unit) &&
      (!q || `${r.name} ${r.purpose ?? ''} ${r.structure ?? ''} ${r.reqDept ?? ''} ${r.contractNo ?? ''} ${r.invoiceNo ?? ''}`.toLowerCase().includes(q)),
  );
  const total = rows.reduce((s, r) => s + n(r.totalTiyin), 0);
  const kindOf = (k: XaridKind) => d.summary.byKind.find((x) => x.key === k)!;
  const units = [...new Set(d.rows.map((r) => r.unit))];
  const kindLabel = (k: XaridKind) => d.kinds.find((x) => x.key === k)?.label ?? k;

  const setOverride = async (r: XaridRow, k: XaridKind) => {
    setSaving(r.key);
    try {
      await xaridApi.override(r.key, k === r.autoKind ? null : k);
      onChanged();
    } catch (e) {
      onError?.(errorMessage(e, "Saqlab bo'lmadi"));
    } finally {
      setSaving(null);
    }
  };
  const exportCsv = () =>
    downloadCsv(
      `asosiy-vositalar-xarid-${new Date().toISOString().slice(0, 10)}`,
      ['Qator', 'Tovar (ish, xizmat)', 'Turi (filtr)', 'Sababi', 'Holat', 'Tuzilma', 'Birlik', "Bo'lim", 'Talabnoma', 'Asoslash', 'Soni', "1 dona, so'm", "Jami, so'm", 'Taxminiy', 'Xarid usuli', 'Platforma', 'Shartnoma', 'Shartnoma sanasi', 'Schyot-faktura', 'Faktura sanasi', 'Ogohlantirish'],
      rows.map((r) => [r.row, r.name, kindLabel(r.kind), r.reason, STATUS_LABEL[r.status], r.structure ?? '', unitLabel(r.unit), r.reqDept ?? '', r.reqNo ?? '', r.purpose ?? '', r.qty ?? '', r.unitPriceTiyin ? csvSom(r.unitPriceTiyin) : '', r.totalTiyin ? csvSom(r.totalTiyin) : '', r.estimated ? 'ha' : '', r.method ?? '', r.platform ?? '', r.contractNo ?? '', r.contractDate ?? '', r.invoiceNo ?? '', r.invoiceDate ?? '', r.warnings.join('; ')]),
    );

  return (
    <div className="space-y-4">
      <StatTiles
        items={[
          { label: 'Bajarilgan xaridlar', value: n(d.summary.doneTotalTiyin), tone: 'blue', note: `${d.summary.done} ta · jami ${d.summary.rows} qator` },
          { label: 'Asosiy vositalar', value: n(kindOf('ASSET').totalTiyin), tone: 'green', note: `${kindOf('ASSET').count} ta bajarilgan · 1 dona ≥ ${sum(d.rule.assetMinTiyin)} so'm` },
          { label: 'Kam baholi buyumlar', value: n(kindOf('LOW_VALUE').totalTiyin), tone: 'cyan', note: `${kindOf('LOW_VALUE').count} ta — uzoq ishlatiladigan, arzonroq` },
          { label: "Sarf, poligrafiya, sovg'a", value: n(kindOf('SUPPLY').totalTiyin) + n(kindOf('PRINT_GIFT').totalTiyin), tone: 'orange', note: `${kindOf('SUPPLY').count + kindOf('PRINT_GIFT').count} ta` },
          { label: 'Xizmatlar', value: n(kindOf('SERVICE').totalTiyin), tone: 'purple', note: `${kindOf('SERVICE').count} ta · ogohlantirishli qatorlar: ${d.summary.warnings}` },
        ]}
      />

      <PillTabs
        value={kind}
        onChange={setKind}
        options={[{ value: 'ALL' as const, label: 'Hammasi', count: d.rows.length }, ...d.summary.byKind.map((k) => ({ value: k.key, label: k.label, count: k.all }))]}
      />

      <ReportCard
        title="Xaridlar reestri: aniqlab oluvchi filtr natijasi"
        badge={meta}
        actions={
          <>
            <SelectBox
              value={status}
              onChange={setStatus}
              options={[{ value: 'DONE' as const, label: `Bajarilgan (${d.statuses.find((s) => s.key === 'DONE')?.count ?? 0})` }, { value: 'ALL' as const, label: `Hammasi (${d.rows.length})` }, ...d.statuses.filter((s) => s.key !== 'DONE').map((s) => ({ value: s.key, label: `${s.label} (${s.count})` }))]}
            />
            <SelectBox value={unit} onChange={setUnit} options={[{ value: '', label: 'Hamma birliklar' }, ...units.map((u) => ({ value: u, label: unitLabel(u) }))]} />
            <SearchInput value={query} onChange={setQuery} placeholder="Tovar, talabnoma, shartnoma…" />
            <ExcelButton onClick={exportCsv} />
            {actions}
          </>
        }
      >
        {rows.length ? (
          <RTable minWidth={1500}>
            <thead>
              <tr>
                <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
                <Th className={cn(STICKY_NAME, 'z-[2] min-w-64 text-left')}>Tovar (ish, xizmat)</Th>
                <Th className="min-w-44">Turi (filtr)</Th>
                <Th>Holat</Th>
                <Th>Soni</Th>
                <Th>1 dona</Th>
                <Th>Jami</Th>
                <Th className="min-w-36">Xarid usuli</Th>
                <Th className="min-w-32">Shartnoma</Th>
                <Th className="min-w-32">Schyot-faktura</Th>
                <Th className="min-w-56 text-left">Tekshiruv</Th>
              </tr>
            </thead>
            <tbody>
              <Tr total>
                <Td className={STICKY_NO} />
                <NameCell>Jami · {rows.length} qator</NameCell>
                <Td />
                <Td />
                <Td />
                <Td />
                <MoneyCell value={total} strong />
                <Td />
                <Td />
                <Td />
                <Td />
              </Tr>
              {rows.map((r, i) => (
                <Tr key={r.key} muted={r.status === 'REJECTED'}>
                  <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                  <NameCell sub={[r.structure, r.reqDept, r.purpose].filter(Boolean).join(' · ')}>{r.name}</NameCell>
                  <Td className="text-left">
                    {isAdmin ? (
                      <select
                        value={r.kind}
                        disabled={saving === r.key}
                        onChange={(e) => void setOverride(r, e.target.value as XaridKind)}
                        title={r.reason}
                        className={cn('h-8 rounded-lg border bg-white px-2 text-xs font-semibold', r.overridden ? 'border-brand-400 text-brand-700' : 'border-(--color-line-strong) text-heading')}
                      >
                        {d.kinds.map((k) => (
                          <option key={k.key} value={k.key}>
                            {k.label}
                            {k.key === r.autoKind ? ' (filtr)' : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span title={r.reason}>
                        <StatusBadge tone={KIND_TONE[r.kind]}>{kindLabel(r.kind)}</StatusBadge>
                      </span>
                    )}
                    <span className="mt-0.5 block max-w-56 text-[11px] leading-snug text-(--color-text-muted)">{r.reason}</span>
                  </Td>
                  <Td>
                    <StatusBadge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusBadge>
                  </Td>
                  <Td className="whitespace-nowrap">{r.qty === null ? '' : `${r.qty.toLocaleString('ru')} ${r.measure ?? ''}`}</Td>
                  <MoneyCell value={n(r.unitPriceTiyin)} className="text-(--color-text-muted)" />
                  <Td className="whitespace-nowrap text-right">
                    {r.totalTiyin ? sum(r.totalTiyin) : ''}
                    {r.estimated && <span className="block text-[10px] text-amber-700">taxminiy</span>}
                  </Td>
                  <Td className="text-left text-xs">
                    {r.method}
                    {r.platform && (
                      <span className="block text-(--color-text-muted)">
                        {r.platformUrl ? (
                          <a href={r.platformUrl} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
                            {r.platform}
                          </a>
                        ) : (
                          r.platform
                        )}
                      </span>
                    )}
                  </Td>
                  <Td className="text-left text-xs">
                    {r.contractNo}
                    {r.contractDate && <span className="block text-(--color-text-muted)">{day(r.contractDate)}</span>}
                  </Td>
                  <Td className="text-left text-xs">
                    {r.invoiceNo}
                    {r.invoiceDate && <span className="block text-(--color-text-muted)">{day(r.invoiceDate)}</span>}
                  </Td>
                  <Td className={cn('text-left text-xs', r.warnings.length ? 'text-amber-800' : 'text-(--color-text-faint)')}>{r.warnings.length ? r.warnings.join('; ') : '✓'}</Td>
                </Tr>
              ))}
            </tbody>
          </RTable>
        ) : (
          <EmptyNote>Tanlangan filtr bo&apos;yicha qator yo&apos;q</EmptyNote>
        )}
        <TableNote>
          Turi — aniqlab oluvchi filtr (sababi ostida): xizmat → sovg&apos;a (asoslashda «эсдалик», «совға») → poligrafiya → sarf materiali → uzoq ishlatiladigan buyum (1
          dona ≥ chegara — asosiy vosita, aks holda kam baholi). {isAdmin && "Turni ro'yxatdan o'zgartirish mumkin — qayta yuklanganda saqlanadi. "}Jami — shartnoma
          summasi (bo&apos;lmasa — bozor taxminiy qiymati). Faylning «Жами» va imzo qatorlari o&apos;qilmaydi; mas&apos;ul xodim ustuni saqlanmaydi. Bu bosqichda Markaz
          xarajati va asosiy vositalar ro&apos;yxatiga ta&apos;sir qilmaydi.
        </TableNote>
      </ReportCard>

      <div className="grid gap-4 xl:grid-cols-3">
        <GroupCard title="Birliklar bo'yicha" rows={d.summary.byUnit.map((x) => ({ ...x, label: unitLabel(x.key) }))} />
        <GroupCard title="Xarid usuli / platforma" rows={d.summary.byPlatform.map((x) => ({ ...x, label: x.key }))} />
        <GroupCard title="Oylar bo'yicha (shartnoma sanasi)" rows={d.summary.byMonth.map((x) => ({ ...x, label: formatPeriod(x.key) }))} />
      </div>
    </div>
  );
}

function GroupCard({ title, rows }: { title: string; rows: { key: string; label: string; count: number; totalTiyin: string }[] }) {
  const total = rows.reduce((s, r) => s + n(r.totalTiyin), 0);
  return (
    <ReportCard title={title} badge="bajarilganlar">
      {rows.length ? (
        <RTable minWidth={360}>
          <thead>
            <tr>
              <Th className="text-left">Nomi</Th>
              <Th>Soni</Th>
              <Th>Summa</Th>
            </tr>
          </thead>
          <tbody>
            <Tr total>
              <NameCell sticky={false}>Jami</NameCell>
              <Td>{rows.reduce((s, r) => s + r.count, 0)}</Td>
              <MoneyCell value={total} strong />
            </Tr>
            {rows.map((r) => (
              <Tr key={r.key}>
                <NameCell sticky={false}>{r.label}</NameCell>
                <Td>{r.count}</Td>
                <MoneyCell value={n(r.totalTiyin)} />
              </Tr>
            ))}
          </tbody>
        </RTable>
      ) : (
        <EmptyNote>Yo&apos;q</EmptyNote>
      )}
    </ReportCard>
  );
}

/** Filtr qoidasi: asosiy vosita chegarasi (1 dona narxi) */
function RuleCard({ d, isAdmin, onSaved, onError }: { d: XaridView; isAdmin: boolean; onSaved: () => void; onError: (m: string) => void }) {
  const [value, setValue] = useState(String(Math.round(n(d.rule.assetMinTiyin) / 100)));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await xaridApi.rule(value);
      onSaved();
    } catch (e) {
      onError(errorMessage(e, "Saqlab bo'lmadi"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ReportCard title="Filtr qoidasi" badge={`asosiy vosita: 1 dona ≥ ${sum(d.rule.assetMinTiyin)} so'm${d.rule.overrides ? ` · qo'lda belgilangan: ${d.rule.overrides}` : ''}`}>
      <div className="flex flex-wrap items-end gap-3 px-5 pb-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-(--color-text-muted)">Asosiy vosita chegarasi (1 dona narxi, so&apos;m)</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={!isAdmin}
            inputMode="numeric"
            className="h-10 w-48 rounded-lg border border-(--color-line-strong) bg-white px-3 text-right text-sm tabular-nums outline-none focus:border-brand-500"
          />
        </label>
        {isAdmin && (
          <Button onClick={() => void save()} loading={busy}>
            Saqlash
          </Button>
        )}
      </div>
      <TableNote>
        Uzoq ishlatiladigan buyum (konditsioner, mebel, kompyuter, printer, kamera, qurilma …) 1 donasi shu chegaradan qimmat bo&apos;lsa — asosiy vosita, arzonroq bo&apos;lsa —
        kam baholi buyum. Nomdan aniqlanmagan tovar: chegaradan qimmat — asosiy vosita, aks holda sarf materiali. Chegara o&apos;zgarsa, butun reestr qayta aniqlanadi.
      </TableNote>
    </ReportCard>
  );
}
