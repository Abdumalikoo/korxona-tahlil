'use client';

import { ActionButton, ExcelButton, MoneyCell, NameCell, ReportCard, RTable, SearchInput, SelectBox, StatTiles, STICKY_NAME, STICKY_NO, TableNote, Td, Th, ToggleAllButton, Tr, sum } from '@/components/report/report';
import { StatusBadge } from '@/components/report/report-extra-b';
import { EmptyNote, LoadingCard } from '@/components/report/report-extra-c';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Toast } from '@/components/ui/toast';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatPeriod, formatPeriodShort } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useRef, useState, type ReactNode } from 'react';
import { regionalRentApi, rentAction, type RentAction, type RentAnalysis, type RentRowView, type RentView } from './regional-api';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › Hudud ijaralari:
//  • Shablon — hududlar ketma-ketligida (Qoraqalpog'iston → … → Toshkent shahri → Markaz), har hudud ostida tumanlari,
//    joriy ijaralar bilan to'ldirilgan (faqat oylik summalarni yozish kifoya). Vazirlik «Ижара маълумот» fayli ham o'qiladi.
//  • Yuklangach — pastda tekshiruv: hudud → tuman → oylar; holat (yangi / o'zgaradi / bir xil / bo'sh), «Жами», tuman.
//  • Tasdiqlash — tanlangan oygacha: yangi ijaralar, oylik summalar (o'sha oydan), oylar qayta yopiladi (Ijara moduli).
// ═══════════════════════════════════════════════════════════

const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
const ACTION: Record<RentAction, { label: string; tone: 'green' | 'blue' | 'amber' | 'muted' | 'red' }> = {
  NEW: { label: 'Yangi', tone: 'green' },
  UPDATE: { label: "O'zgaradi", tone: 'amber' },
  SAME: { label: 'Bir xil', tone: 'blue' },
  EMPTY: { label: "Bo'sh", tone: 'muted' },
  ERROR: { label: 'Xato', tone: 'red' },
  MISSING: { label: "Faylda yo'q", tone: 'muted' },
  DB: { label: 'Bazada', tone: 'blue' },
};
const n = (s: string | null | undefined) => (s ? Number(s) : 0);

export function RegionalRentPage({ year }: { year: number }) {
  const { isAdmin } = useAuth();
  const cur = useAsync(() => regionalRentApi.current(year).then((r) => r.data), [year]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<RentAnalysis | null>(null);
  const [until, setUntil] = useState(5);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'error' } | null>(null);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const a = await regionalRentApi.analyze(f, year);
      setPreview(a);
      setFile(f);
      // Standart: oxirgi yopilgan oy (bo'lmasa — fayldagi oxirgi summali oy)
      const lastClosed = a.closed.length ? Number(a.closed[a.closed.length - 1]!.slice(5, 7)) : 0;
      setUntil(lastClosed || a.untilDefault || 1);
    } catch (e) {
      setToast({ message: errorMessage(e, "Faylni o'qib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const commit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await regionalRentApi.commit(file, year, until);
      setAsking(false);
      setPreview(null);
      setFile(null);
      setToast({ message: `Yozildi: yangi ${r.created}, yangilandi ${r.updated}, bir xil ${r.same}; ${r.closes.length} oy yopildi` });
      cur.reload();
    } catch (e) {
      setToast({ message: errorMessage(e, "Saqlab bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const head = (
    <ReportCard
      title="Shablon va yuklash"
      badge={`${year}-yil`}
      actions={
        <>
          <ActionButton onClick={() => void regionalRentApi.template(year).catch((e: unknown) => setToast({ message: errorMessage(e, "Shablonni yuklab bo'lmadi"), tone: 'error' }))}>
            Shablon (hududlar va tumanlar bilan)
          </ActionButton>
          {isAdmin && (
            <>
              <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
              <ActionButton onClick={() => fileRef.current?.click()} disabled={busy}>
                {busy && !preview ? 'Tekshirilmoqda…' : 'Fayl yuklash'}
              </ActionButton>
            </>
          )}
        </>
      }
    >
      <TableNote>
        Shablon hududlar ketma-ketligida (Qoraqalpog&apos;iston → … → Toshkent shahri → Markaz), har hudud ostida tumanlari bilan — joriy ijaralar (manzil, shartnoma, oylik
        summa) bilan to&apos;ldirilgan: faqat oylar ustunlariga shu oy uchun <b>hisoblangan</b> ijarani yozing (to&apos;langan / to&apos;lanmagan kerak emas). Vazirlikning «Ижара
        маълумот» fayli (har viloyat — alohida varaq) ham to&apos;g&apos;ridan-to&apos;g&apos;ri yuklanadi. Yuklangach pastda tekshiruv chiqadi; tasdiqlansa — tanlangan oygacha
        xarajatga yoziladi. Shartnomalar va oylar —{' '}
        <Link href="/xarajatlar/ijara" className="font-medium text-brand-700 hover:underline">
          Xarajatlar › Ijara
        </Link>
        .
      </TableNote>
    </ReportCard>
  );

  let body: ReactNode;
  if (preview) {
    const acts = preview.regions.flatMap((r) => r.rows.map((x) => rentAction(x, until)));
    const c = (a: RentAction) => acts.filter((x) => x === a).length;
    const errors = c('ERROR');
    body = (
      <>
        <StatTiles
          items={[
            { label: 'Yangi ijara', value: 0, text: String(c('NEW')), tone: 'green', note: `${MONTHS[until - 1]}gacha summasi bor, bazada yo'q` },
            { label: "O'zgaradi", value: 0, text: String(c('UPDATE')), tone: 'orange', note: 'oylik summa bazadagidan farq qiladi' },
            { label: 'Bir xil', value: 0, text: String(c('SAME')), tone: 'blue', note: 'bazadagi bilan teng — o‘zgarmaydi' },
            { label: "Bo'sh / xato", value: 0, text: `${c('EMPTY')} / ${errors}`, tone: errors ? 'red' : 'purple', note: `${preview.summary.unmatchedDistricts} ta tuman tanilmadi · «Жами» xato ${preview.summary.totalBad}` },
          ]}
        />
        <RentTable d={preview} until={until} title={`Tekshiruv: ${preview.fileName}`} badge={`${preview.format === 'MINISTRY' ? `Vazirlik fayli · ${preview.sheets.length} varaq` : 'Shablon'} · ${preview.summary.rows} qator`} />
        <ReportCard title="Tasdiqlash" badge={preview.closed.length ? `yopilgan oylar: ${preview.closed.map(formatPeriodShort).join(', ')}` : "yopilgan oy yo'q"}>
          <div className="flex flex-wrap items-end gap-3 px-5 pb-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-(--color-text-muted)">Qaysi oygacha yozilsin</span>
              <SelectBox value={String(until)} onChange={(v) => setUntil(Number(v))} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: `${m}gacha (yanvar–${m.toLowerCase()})` }))} />
            </label>
            <Button variant="secondary" onClick={() => { setPreview(null); setFile(null); }} disabled={busy}>
              Bekor qilish
            </Button>
            <Button onClick={() => setAsking(true)} disabled={busy || errors > 0}>
              Tasdiqlash
            </Button>
          </div>
          <TableNote>
            Tasdiqlansa — {year} yanvar–{MONTHS[until - 1]!.toLowerCase()}: yangi ijaralar yaratiladi ({c('NEW')}), farq qilgan oylik summalar o&apos;sha oydan yangilanadi (
            {c('UPDATE')}), bir xillari o&apos;zgarmaydi; so&apos;ng shu oylar qayta yopiladi — har ijara uchun hudud va tumanga «Ijara» xarajati yoziladi. Faylda 0 yoki
            bo&apos;sh oy bazadagi summani o&apos;zgartirmaydi. {errors > 0 && 'Hududi aniqlanmagan qatorlar bor — avval faylni tuzating.'}
          </TableNote>
        </ReportCard>
      </>
    );
  } else if (!cur.data) {
    body = <LoadingCard label="Hudud ijaralari yuklanmoqda" error={cur.error} onRetry={cur.reload} />;
  } else {
    const d = cur.data;
    const lastClosed = d.closed.length ? Number(d.closed[d.closed.length - 1]!.slice(5, 7)) : 12;
    body = <RentTable d={d} until={lastClosed} title="Bazadagi hudud ijaralari" badge={d.closed.length ? `yopilgan oylar: ${d.closed.map(formatPeriodShort).join(', ')}` : "yopilgan oy yo'q"} />;
  }

  return (
    <div className="space-y-4">
      {head}
      {body}
      <ConfirmDialog
        open={asking}
        title="Hudud ijaralarini yozish"
        message={`${year} yanvar–${MONTHS[until - 1]!.toLowerCase()} oylari bo'yicha ijaralar yangilanadi va shu oylar qayta yopiladi (hudud va tumanlarga «Ijara» xarajati). Keyin «Ijara › Oylar»da bekor qilish mumkin.`}
        confirmLabel="Tasdiqlash"
        loading={busy}
        onConfirm={() => void commit()}
        onCancel={() => setAsking(false)}
      />
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </div>
  );
}

/** Hudud → tuman → oylar; tanlangan oydan keyingilari xira, farq qilgan oylar sariq (ustida — bazadagi summa) */
function RentTable({ d, until, title, badge }: { d: RentView; until: number; title: string; badge: string }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [onlyChanges, setOnlyChanges] = useState('all');
  const q = query.trim().toLowerCase();
  const keyOf = (code: number | null) => String(code);
  const fits = (r: RentRowView) => {
    const a = rentAction(r, until);
    if (onlyChanges === 'changes' && !['NEW', 'UPDATE', 'ERROR'].includes(a)) return false;
    if (onlyChanges === 'filled' && a === 'EMPTY') return false;
    return !q || `${r.district} ${r.districtName ?? ''} ${r.leaseTitle ?? ''}`.toLowerCase().includes(q);
  };
  const regions = d.regions.map((g) => ({ ...g, list: g.rows.filter(fits) })).filter((g) => g.list.length || (!q && onlyChanges === 'all'));
  const toggle = (k: string) =>
    setOpen((x) => {
      const nx = new Set(x);
      if (nx.has(k)) nx.delete(k);
      else nx.add(k);
      return nx;
    });
  const total = (ms: string[]) => ms.slice(0, until).reduce((s, x) => s + n(x), 0);
  const exportCsv = () =>
    downloadCsv(
      `hudud-ijaralari-${d.year}-${until}`,
      ['Hudud', "Tuman (fayl)", 'Tuman (ilova)', 'Ijara', 'Holat', ...MONTHS.map((m) => `${m}, so'm`), `Jami (${MONTHS[until - 1]}gacha), so'm`, 'Tekshiruv'],
      d.regions.flatMap((g) => g.rows.map((r) => [g.name, r.district, r.districtName ?? '', r.leaseTitle ?? '', ACTION[rentAction(r, until)].label, ...r.months.map((x) => csvSom(x)), csvSom(total(r.months)), r.warnings.join('; ')])),
    );
  const actionOf = (r: RentRowView) => rentAction(r, until);
  const lines: ReactNode[] = [];
  regions.forEach((g, gi) => {
    const k = keyOf(g.code);
    const isOpen = open.has(k) || q !== '' || onlyChanges !== 'all';
    const counts = (a: RentAction) => g.rows.filter((r) => actionOf(r) === a).length;
    const sub = [counts('NEW') && `yangi ${counts('NEW')}`, counts('UPDATE') && `o'zgaradi ${counts('UPDATE')}`, counts('SAME') && `bir xil ${counts('SAME')}`, counts('DB') && `${counts('DB')} ta ijara`, counts('EMPTY') && `bo'sh ${counts('EMPTY')}`, counts('ERROR') && `xato ${counts('ERROR')}`].filter(Boolean).join(' · ');
    lines.push(
      <Tr key={k} onClick={() => toggle(k)} className="bg-brand-50/50">
        <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{gi + 1}</Td>
        <NameCell className="font-semibold text-heading" sub={sub} before={<span className="inline-block w-3.5 text-center text-(--color-text-faint)">{isOpen ? '▾' : '▸'}</span>}>
          {g.name}
        </NameCell>
        <Td />
        {g.months.map((m, i) => (
          <MoneyCell key={i} value={n(m)} strong className={cn(i >= until && 'opacity-40')} />
        ))}
        <MoneyCell value={total(g.months)} strong />
        <Td />
      </Tr>,
    );
    if (!isOpen) return;
    for (const r of g.list) {
      const a = actionOf(r);
      lines.push(
        <Tr key={`${k}|${r.ref ?? r.leaseId}`} muted={a === 'EMPTY'}>
          <Td className={STICKY_NO} />
          <NameCell
            before={<span className="inline-block w-3.5" />}
            sub={[r.districtName && r.districtName !== r.district ? `ilovada: ${r.districtName}${r.approx ? ' (taxminiy)' : ''}` : null, r.leaseTitle && r.leaseTitle !== r.district ? `ijara: ${r.leaseTitle}` : null, r.ref].filter(Boolean).join(' · ') || undefined}
          >
            {r.district}
          </NameCell>
          <Td>
            <StatusBadge tone={ACTION[a].tone}>{ACTION[a].label}</StatusBadge>
          </Td>
          {r.months.map((m, i) => {
            const changed = r.diff.includes(i) && i < until && r.dbMonths;
            return (
              <Td key={i} className={cn('whitespace-nowrap text-right tabular-nums', i >= until && 'opacity-40', changed && 'bg-amber-50 font-semibold text-amber-800', !n(m) && 'text-(--color-text-faint)')}>
                <span title={changed ? `Bazada: ${sum(r.dbMonths![i]!)} so'm` : undefined}>{n(m) ? sum(m) : '—'}</span>
              </Td>
            );
          })}
          <MoneyCell value={total(r.months)} />
          <Td className={cn('text-left text-xs', r.warnings.length ? 'text-amber-800' : 'text-(--color-text-faint)')}>{r.warnings.length ? r.warnings.join('; ') : r.totalOk === true ? '«Жами» ✓' : '✓'}</Td>
        </Tr>,
      );
    }
  });

  return (
    <ReportCard
      title={title}
      badge={badge}
      actions={
        <>
          <SelectBox value={onlyChanges} onChange={setOnlyChanges} options={[{ value: 'all', label: 'Hammasi' }, { value: 'filled', label: "Summali (bo'shsiz)" }, { value: 'changes', label: "Faqat o'zgarishlar" }]} />
          <SearchInput value={query} onChange={setQuery} placeholder="Tuman…" />
          <ExcelButton onClick={exportCsv} />
          <ToggleAllButton open={open.size > 0} onClick={() => setOpen(open.size ? new Set() : new Set(d.regions.map((g) => keyOf(g.code))))} />
        </>
      }
    >
      {regions.length ? (
        <RTable minWidth={1700}>
          <thead>
            <tr>
              <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
              <Th className={cn(STICKY_NAME, 'z-[2] min-w-64 text-left')}>Hudud → tuman</Th>
              <Th>Holat</Th>
              {d.periods.map((p, i) => (
                <Th key={p} className={cn(i >= until && 'opacity-50')} title={d.closed.includes(p) ? 'Yopilgan oy' : undefined}>
                  {formatPeriodShort(p)}
                  {d.closed.includes(p) && <span className="block text-[10px] font-normal text-(--color-income)">yopilgan</span>}
                </Th>
              ))}
              <Th>Jami ({MONTHS[until - 1]!.toLowerCase()}gacha)</Th>
              <Th className="min-w-56 text-left">Tekshiruv</Th>
            </tr>
          </thead>
          <tbody>
            <Tr total>
              <Td className={STICKY_NO} />
              <NameCell>Jami · {d.regions.length} hudud</NameCell>
              <Td />
              {d.months.map((m, i) => (
                <MoneyCell key={i} value={n(m)} strong className={cn(i >= until && 'opacity-40')} />
              ))}
              <MoneyCell value={total(d.months)} strong />
              <Td />
            </Tr>
            {lines}
          </tbody>
        </RTable>
      ) : (
        <EmptyNote>Tanlangan filtr bo&apos;yicha qator yo&apos;q</EmptyNote>
      )}
      <TableNote>
        Hududni bosing — tumanlari ochiladi. Sariq katak — fayldagi summa bazadagidan farq qiladi (ustiga olib boring — bazadagi summa). {MONTHS[until - 1]}dan keyingi oylar
        xira — yozilmaydi. Jami — {formatPeriod(d.periods[0]!)} — {formatPeriod(d.periods[until - 1]!)}.
      </TableNote>
    </ReportCard>
  );
}
