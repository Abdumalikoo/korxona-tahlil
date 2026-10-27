'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Field, FilterBar, GroupTh, MoneyCell, PillTabs, ReportCard, RTable, SelectBox, StatTiles, TableNote, Td, Th, Tr } from '@/components/report/report';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { analyzeQuarterReport, downloadQuarterTemplate, quarterlyApi, type QuarterAnalysis, type QuarterRow, type QuarterScale } from './api';
import { useVehicleBase } from './base';

// ═══════════════════════════════════════════════════════════
// Mashinalar › Choraklik hisobot («24-ilova», 1-chorakdagi shakl).
//  • Xarajatga faqat «Jihozlash xarajatlari» — mashinaning TA'MIRLASH xarajati (chorak oxirgi kuni,
//    mashina biriktirilgan bo'limga avtomatik).
//  • «Saqlash xarajatlari» — benzin bilan bir xil (benzin hisobotidan yozilgan) — hisobga olinmaydi.
//  • Qolgan ustunlar (balans qiymati, masofa, yili …) — statistika, manba sifatida saqlanadi.
// ═══════════════════════════════════════════════════════════

const INPUT = 'h-10 rounded-lg border border-(--color-line-strong) bg-white px-3 text-sm outline-none focus:border-brand-500';
const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 3 + i);
const km = (v: number | null) => (v === null ? '' : v.toLocaleString('ru-RU').replace(/,/g, ' '));

function RowsTable({ rows, preview }: { rows: QuarterRow[]; preview?: boolean }) {
  const t = rows.reduce(
    (a, r) => ({ value: a.value + Number(r.balanceValueTiyin), storage: a.storage + Number(r.storageTiyin), equip: a.equip + Number(r.equipTiyin), dist: a.dist + (r.distancePeriodKm ?? 0) }),
    { value: 0, storage: 0, equip: 0, dist: 0 },
  );
  return (
    <RTable minWidth={1150}>
      <thead>
        <tr>
          <Th rowSpan={2} className="w-10">№</Th>
          <Th rowSpan={2} className="sticky left-0 z-[3] min-w-36 text-left shadow-[1px_0_0_var(--color-line)]">Davlat raqami</Th>
          <Th rowSpan={2} className="min-w-36 text-left">Rusumi</Th>
          <Th rowSpan={2}>Ishlab chiqarilgan yili</Th>
          <Th rowSpan={2}>Balansga olingan</Th>
          <Th rowSpan={2}>Balans qiymati</Th>
          <GroupTh span={2}>Xarajatlar</GroupTh>
          <GroupTh span={2}>Harakatlangan masofa, km</GroupTh>
          {preview && <Th rowSpan={2} className="min-w-40">Tizimda</Th>}
        </tr>
        <tr>
          <Th className="first:border-l" title="Benzin hisobotidan allaqachon yozilgan — hisobga olinmaydi">
            Saqlash (benzin)
          </Th>
          <Th className="bg-[#fff3df]" title="Mashinaning ta'mirlash xarajati — Xarajatlarga yoziladi">
            Jihozlash → ta&apos;mirlash
          </Th>
          <Th>Hisobot davrida</Th>
          <Th>Jami</Th>
        </tr>
      </thead>
      <tbody>
        <Tr total>
          <Td />
          <Td className="sticky left-0 z-[1] text-left shadow-[1px_0_0_var(--color-line)]">Jami · {rows.length} ta</Td>
          <Td />
          <Td />
          <Td />
          <MoneyCell value={t.value} />
          <MoneyCell value={t.storage} className="text-(--color-text-faint) line-through decoration-1" />
          <MoneyCell value={t.equip} strong className="text-[#b45309]" />
          <Td>{km(t.dist)}</Td>
          <Td />
          {preview && <Td />}
        </Tr>
        {rows.map((r) => (
          <Tr key={r.plateKey}>
            <Td className="text-(--color-text-faint)">{r.n}</Td>
            <Td className="sticky left-0 z-[1] whitespace-nowrap text-left shadow-[1px_0_0_var(--color-line)]">
              <span className="rounded border border-(--color-line-strong) bg-white px-1.5 py-0.5 font-mono text-xs font-semibold">{r.plate}</span>
            </Td>
            <Td className="text-left">{r.model}</Td>
            <Td>{r.madeYear ?? ''}</Td>
            <Td>{r.balanceYear ?? ''}</Td>
            {Number(r.balanceValueTiyin) ? <MoneyCell value={Number(r.balanceValueTiyin)} /> : <Td />}
            {Number(r.storageTiyin) ? <MoneyCell value={Number(r.storageTiyin)} className="text-(--color-text-faint)" /> : <Td />}
            {Number(r.equipTiyin) ? <MoneyCell value={Number(r.equipTiyin)} strong className="bg-[#fffaf0] text-[#b45309]" /> : <Td />}
            <Td>{km(r.distancePeriodKm)}</Td>
            <Td>{km(r.distanceTotalKm)}</Td>
            {preview && (
              <Td className="text-left text-xs">
                {r.vehicleId ? <span className="font-semibold text-(--color-income)">✓ {r.vehicleLabel}</span> : <span className="font-semibold text-amber-700">yangi mashina qo&apos;shiladi</span>}
              </Td>
            )}
          </Tr>
        ))}
      </tbody>
    </RTable>
  );
}

export function VehicleQuarterlyPage() {
  const base = useVehicleBase();
  const { canWrite } = useAuth();
  const editable = canWrite(base) || canWrite('/mashinalar');
  const list = useAsync(() => quarterlyApi.list().then((r) => r.data), []);
  const [selected, setSelected] = useState<string | null>(null);
  const [tplYear, setTplYear] = useState(new Date().getFullYear());
  const [tplQuarter, setTplQuarter] = useState(Math.floor(new Date().getMonth() / 3) + 1);
  const [file, setFile] = useState<File | null>(null);
  const [scale, setScale] = useState<QuarterScale>('THOUSAND');
  const [analysis, setAnalysis] = useState<QuarterAnalysis | null>(null);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [quarter, setQuarter] = useState<number>(1);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<'save' | 'remove' | null>(null);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'error' } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const quarters = list.data ?? [];
  const current = quarters.find((x) => x.key === selected) ?? quarters[0] ?? null;

  const read = async (f: File, s: QuarterScale) => {
    setBusy(true);
    setFile(f);
    try {
      const a = await analyzeQuarterReport(f, s);
      setAnalysis(a);
      if (a.year) setYear(a.year);
      if (a.quarter) setQuarter(a.quarter);
    } catch (e) {
      setAnalysis(null);
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!analysis || !file) return;
    setBusy(true);
    try {
      const r = (await quarterlyApi.commit({ year, quarter, scale, fileName: file.name, rows: analysis.rows })).data;
      setToast({
        message: `${year}-yil ${quarter}-chorak saqlandi: ${r.vehicles} ta mashina, ta'mirlash ${r.records} ta yozuv${r.createdVehicles ? `, ${r.createdVehicles} ta yangi mashina qo'shildi` : ''}`,
      });
      setAnalysis(null);
      setFile(null);
      setSelected(r.key);
      list.reload();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(false);
      setAsk(null);
    }
  };

  const remove = async () => {
    if (!current) return;
    setBusy(true);
    try {
      const r = (await quarterlyApi.remove(current.key)).data;
      setToast({ message: `${current.year}-yil ${current.quarter}-chorak bekor qilindi: ${r.removed} ta ta'mirlash yozuvi o'chirildi` });
      setSelected(null);
      list.reload();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(false);
      setAsk(null);
    }
  };

  const exists = analysis ? quarters.some((x) => x.year === year && x.quarter === quarter) : false;

  return (
    <>
      <PageHeader title="Choraklik hisobot" description="24-ilova: jihozlash xarajati — mashinaning ta'mirlashi (bo'limiga avtomatik), qolgani — statistika" />
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href={`${base}/royxat`} className="rounded-lg border border-brand-300 bg-white px-3 py-1.5 font-semibold text-brand-700 hover:bg-brand-50">
            Mashinalar hisoboti
          </Link>
          <Link href={`${base}/bolimlar`} className="rounded-lg border border-brand-300 bg-white px-3 py-1.5 font-semibold text-brand-700 hover:bg-brand-50">
            Bo&apos;limlarga biriktirish
          </Link>
        </div>

        <FilterBar
          actions={
            editable ? (
              <>
                <input
                  ref={input}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void read(f, scale);
                  }}
                />
                <button type="button" disabled={busy} onClick={() => input.current?.click()} className="inline-flex h-10 items-center rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white shadow-pill hover:bg-brand-700 disabled:opacity-50">
                  {busy && !analysis ? "O'qilmoqda…" : 'Hisobotni yuklash'}
                </button>
              </>
            ) : null
          }
        >
          <Field label="Shablon: yil">
            <SelectBox value={String(tplYear)} options={YEARS.map((y) => ({ value: String(y), label: `${y}-yil` }))} onChange={(v) => setTplYear(Number(v))} />
          </Field>
          <Field label="Chorak">
            <SelectBox value={String(tplQuarter)} options={[1, 2, 3, 4].map((q) => ({ value: String(q), label: `${q}-chorak` }))} onChange={(v) => setTplQuarter(Number(v))} />
          </Field>
          <button
            type="button"
            onClick={() => void downloadQuarterTemplate(tplYear, tplQuarter).catch((e: unknown) => setToast({ message: errorMessage(e), tone: 'error' }))}
            className="inline-flex h-10 items-center rounded-lg border border-brand-300 bg-white px-4 text-sm font-semibold text-brand-700 hover:bg-brand-50"
          >
            Shablonni yuklab olish
          </button>
        </FilterBar>

        {analysis && (
          <ReportCard
            title={`Tekshirish: ${file?.name ?? ''}`}
            badge={`${analysis.rows.length} ta mashina`}
            actions={
              <>
                <button type="button" onClick={() => setAnalysis(null)} className="h-10 rounded-lg border border-(--color-line-strong) bg-white px-3 text-sm hover:bg-brand-50">
                  Bekor
                </button>
                <button type="button" disabled={busy} onClick={() => setAsk('save')} className="h-10 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white shadow-pill hover:bg-brand-700 disabled:opacity-50">
                  Saqlash
                </button>
              </>
            }
          >
            <div className="flex flex-wrap items-end gap-3 px-4 pb-3">
              <Field label="Yil">
                <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={INPUT}>
                  {YEARS.map((y) => (
                    <option key={y} value={y}>
                      {y}-yil
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Chorak">
                <select value={quarter} onChange={(e) => setQuarter(Number(e.target.value))} className={INPUT}>
                  {[1, 2, 3, 4].map((q) => (
                    <option key={q} value={q}>
                      {q}-chorak
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Fayldagi summalar">
                <select
                  value={scale}
                  onChange={(e) => {
                    const s = e.target.value as QuarterScale;
                    setScale(s);
                    if (file) void read(file, s);
                  }}
                  className={INPUT}
                >
                  <option value="THOUSAND">ming so&apos;mda (odatiy)</option>
                  <option value="SOM">so&apos;mda</option>
                </select>
              </Field>
              <div className="min-w-0 flex-1 space-y-1 text-xs">
                {exists && <p className="font-semibold text-amber-700">Bu chorak avval yuklangan — saqlansa almashtiriladi (ikki marta yozilmaydi).</p>}
                {analysis.warnings.map((w) => (
                  <p key={w} className="text-(--color-text-muted)">
                    {w}
                  </p>
                ))}
              </div>
            </div>
            <RowsTable rows={analysis.rows} preview />
            <TableNote>
              Xarajatga faqat to&apos;q sariq ustun — <b>Jihozlash</b> (ta&apos;mirlash) yoziladi: chorak oxirgi kuniga, mashina biriktirilgan bo&apos;limga. <b>Saqlash</b> — benzin xarajati bilan bir xil (benzin hisobotidan yozilgan), hisobga olinmaydi. Qolgan
              ustunlar — statistika.
            </TableNote>
          </ReportCard>
        )}

        {list.error ? (
          <Card>
            <ErrorState message={list.error} onRetry={list.reload} />
          </Card>
        ) : !list.data ? (
          <Card>
            <LoadingState label="Yuklanmoqda" />
          </Card>
        ) : !current ? (
          <Card className="p-8 text-center text-sm text-(--color-text-muted)">Hali choraklik hisobot yuklanmagan. Shablonni yuklab oling yoki to&apos;ldirilgan hisobotni yuklang.</Card>
        ) : (
          <>
            <PillTabs value={current.key} onChange={setSelected} options={quarters.map((x) => ({ value: x.key, label: `${x.year}-yil ${x.quarter}-chorak` }))} />
            <StatTiles
              items={[
                { label: 'Mashinalar', value: 0, text: `${current.rows.length} ta`, note: current.fileName || '', tone: 'blue' },
                { label: "Ta'mirlash (jihozlash)", value: Number(current.repairTiyin), note: `${current.records} ta yozuv — Xarajatlarda`, tone: 'orange' },
                { label: 'Saqlash (benzin, hisobga olinmagan)', value: current.rows.reduce((a, r) => a + Number(r.storageTiyin), 0), note: 'benzin hisobotidan yozilgan', tone: 'cyan' },
                { label: 'Harakatlangan masofa', value: 0, text: `${km(current.rows.reduce((a, r) => a + (r.distancePeriodKm ?? 0), 0))} km`, note: 'hisobot davrida', tone: 'green' },
              ]}
            />
            <ReportCard
              title={`${current.year}-yil ${current.quarter}-chorak · statistika`}
              badge={`Saqlangan: ${current.savedAt.slice(0, 10).split('-').reverse().join('.')}`}
              actions={
                editable ? (
                  <button type="button" onClick={() => setAsk('remove')} className={cn('h-10 rounded-lg border border-(--color-expense) bg-white px-3 text-sm font-semibold text-(--color-expense) hover:bg-(--color-expense-soft)')}>
                    Chorakni bekor qilish
                  </button>
                ) : null
              }
            >
              <RowsTable rows={current.rows} />
              <TableNote>Jihozlash summasi Xarajatlarda «Ta&apos;mirlash» bo&apos;lib turadi (Mashina yozuvlarida ham). Chorakni bekor qilsangiz — shu yozuvlar o&apos;chiriladi.</TableNote>
            </ReportCard>
          </>
        )}
      </div>
      <ConfirmDialog
        open={ask !== null}
        title={ask === 'remove' ? 'Chorakni bekor qilish' : 'Choraklik hisobotni saqlash'}
        message={
          ask === 'remove'
            ? `${current?.year}-yil ${current?.quarter}-chorak: ta'mirlash yozuvlari (${current?.records ?? 0} ta) va statistika o'chiriladi. Davom etilsinmi?`
            : `${year}-yil ${quarter}-chorak: jihozlash summalari ta'mirlash xarajati bo'lib yoziladi (mashina bo'limiga).${exists ? ' Avvalgi yuklash almashtiriladi.' : ''} Davom etilsinmi?`
        }
        confirmLabel={ask === 'remove' ? 'Ha, bekor qilish' : 'Ha, saqlash'}
        danger={ask === 'remove'}
        loading={busy}
        onConfirm={() => void (ask === 'remove' ? remove() : save())}
        onCancel={() => setAsk(null)}
      />
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} duration={6000} />}
    </>
  );
}

export default VehicleQuarterlyPage;
