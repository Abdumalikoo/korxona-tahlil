'use client';

import { MoneyCell, NameCell, PillTabs, ReportCard, RTable, StatTiles, STICKY_NAME, STICKY_NO, TableNote, Td, Th, Tr, sum } from '@/components/report/report';
import { EmptyNote, LoadingCard } from '@/components/report/report-extra-c';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/error-message';
import { formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { hisobApi, type HisobSide } from './api';

// ═══════════════════════════════════════════════════════════
// 3802 — Qo'mita pullari: IKKI HISOB (kirim → sarf → yig'ma qoldiq).
//   • 3802 hovuzi — «Call markaz» deb kelgan pul (2026/1 shartnoma): butun 3802 tizimidagi hamma bo'limlar xodimlariniki.
//     Sarf — oylik «3802 dan olingan pullar» shablonining asosiy varag'i.
//   • Marksheyder — «Marksheyder uchun» kelgan pul (2026/2 shartnoma). Sarf — shablonning Marksheyder varag'i.
//   Sarfi hisobga olinmaydigan oylar belgilanadi (shablon o'chirilmaydi).
// ═══════════════════════════════════════════════════════════

type ToastFn = (t: { message: string; tone: 'success' | 'error' } | null) => void;
const n = (s: string) => Number(s);

export function HisobPanel({ from, to, isAdmin, onToast }: { from: string; to: string; isAdmin: boolean; onToast: ToastFn }) {
  const res = useAsync(() => hisobApi.ledger(from, to).then((r) => r.data), [from, to]);
  const [side, setSide] = useState<'pool' | 'marksheyder'>('pool');
  const [busy, setBusy] = useState(false);
  const d = res.data;
  if (!d) return <LoadingCard label="Qo'mita pullari hisoblanmoqda" error={res.error} onRetry={res.reload} />;

  const pool = d.pool;
  const mar = d.marksheyder;
  const excluded = new Set(d.excluded);

  const toggleMonth = async (p: string) => {
    const next = excluded.has(p) ? d.excluded.filter((x) => x !== p) : [...d.excluded, p];
    setBusy(true);
    try {
      await hisobApi.setExcluded(next);
      onToast({ message: excluded.has(p) ? `${formatPeriod(p)} sarfi hisobga qaytarildi` : `${formatPeriod(p)} sarfi hisobga olinmaydi (shablon saqlanib qoladi)`, tone: 'success' });
      res.reload();
    } catch (e) {
      onToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const setContract = async () => {
    if (!d.contract) return;
    const v = window.prompt(`${d.contract.year}-yil 3802 shartnoma summasi (so'm)`, String(Math.round(n(d.contract.amountTiyin) / 100)));
    if (v === null) return;
    try {
      await hisobApi.setContract(d.contract.year, v);
      onToast({ message: 'Shartnoma summasi saqlandi', tone: 'success' });
      res.reload();
    } catch (e) {
      onToast({ message: errorMessage(e), tone: 'error' });
    }
  };

  const cur = side === 'pool' ? pool : mar;
  return (
    <div className={cn('space-y-4', res.loading && 'opacity-70')}>
      <StatTiles
        compareLabel="Avval"
        items={[
          { label: '3802 hovuzi — kelgan', value: n(pool.incomeTiyin), tone: 'green', note: d.contract ? `shartnoma ${d.contract.year}: ${sum(n(d.contract.amountTiyin))} so'm` : "«Call markaz» deb kelgan pul" },
          { label: '3802 hovuzi — sarflangan', value: n(pool.spendTiyin), tone: 'red', note: `hamma bo'limlar · ${pool.sections.length} bo'lim` },
          { label: n(pool.balanceTiyin) >= 0 ? '3802 hovuzi — qoldiq' : '3802 hovuzi — yetishmaydi', value: n(pool.balanceTiyin), signed: true, tone: 'blue', note: 'kelgan − sarflangan' },
          { label: 'Marksheyder — kelgan', value: n(mar.incomeTiyin), tone: 'green', note: "«Marksheyder uchun» kelgan pul" },
          { label: 'Marksheyder — sarflangan', value: n(mar.spendTiyin), tone: 'red', note: "shablonning Marksheyder varag'i" },
          { label: n(mar.balanceTiyin) >= 0 ? 'Marksheyder — qoldiq' : 'Marksheyder — yetishmaydi', value: n(mar.balanceTiyin), signed: true, tone: 'purple', note: 'kelgan − sarflangan' },
        ]}
      />

      <ReportCard
        title="Qo'mita pullari: ikki hisob, oyma-oy"
        badge={`${formatPeriod(d.from)} — ${formatPeriod(d.to)} · yig'ma qoldiq davr boshidan`}
        actions={
          isAdmin && d.contract ? (
            <Button size="sm" variant="secondary" onClick={() => void setContract()}>
              Shartnoma summasi
            </Button>
          ) : undefined
        }
      >
        <RTable minWidth={1100}>
          <thead>
            <tr>
              <Th rowSpan={2} className={cn(STICKY_NO, 'z-[2]')} />
              <Th rowSpan={2} className={cn(STICKY_NAME, 'z-[2] min-w-36 text-left')}>Oy</Th>
              <Th colSpan={3} className="border-b border-(--color-line)">3802 hovuzi (hamma bo&apos;limlar)</Th>
              <Th colSpan={3} className="border-b border-(--color-line)">Marksheyder</Th>
              <Th rowSpan={2}>Shablon (sarf)</Th>
            </tr>
            <tr>
              <Th>Kelgan</Th>
              <Th>Sarflangan</Th>
              <Th>Yig&apos;ma qoldiq</Th>
              <Th>Kelgan</Th>
              <Th>Sarflangan</Th>
              <Th>Yig&apos;ma qoldiq</Th>
            </tr>
          </thead>
          <tbody>
            {d.months.map((p, i) => {
              const a = pool.months[i]!;
              const b = mar.months[i]!;
              const st = a.vedomost;
              return (
                <Tr key={p} muted={st === 'EXCLUDED'}>
                  <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                  <NameCell sub={st === 'YES' ? `${a.employees + b.employees} xodim` : undefined}>{formatPeriod(p)}</NameCell>
                  <MoneyCell value={n(a.incomeTiyin)} className={cn(!n(a.incomeTiyin) && 'text-(--color-text-faint)')} />
                  <MoneyCell value={n(a.spendTiyin)} className={cn(!n(a.spendTiyin) && 'text-(--color-text-faint)')} />
                  <MoneyCell value={n(a.balanceTiyin)} strong signedColor />
                  <MoneyCell value={n(b.incomeTiyin)} className={cn(!n(b.incomeTiyin) && 'text-(--color-text-faint)')} />
                  <MoneyCell value={n(b.spendTiyin)} className={cn(!n(b.spendTiyin) && 'text-(--color-text-faint)')} />
                  <MoneyCell value={n(b.balanceTiyin)} strong signedColor />
                  <Td className="whitespace-nowrap text-xs">
                    {st === 'NONE' ? (
                      <span className="text-(--color-text-faint)">yuklanmagan</span>
                    ) : isAdmin ? (
                      <label className="inline-flex cursor-pointer items-center gap-1.5" title="Shu oy shablon sarfini hisobga olish / olmaslik (shablon o'chirilmaydi)">
                        <input type="checkbox" checked={st === 'YES'} disabled={busy} onChange={() => void toggleMonth(p)} className="size-3.5" />
                        {st === 'YES' ? 'hisobda' : 'hisobga olinmaydi'}
                      </label>
                    ) : st === 'YES' ? (
                      'hisobda'
                    ) : (
                      'hisobga olinmaydi'
                    )}
                  </Td>
                </Tr>
              );
            })}
            <Tr total>
              <Td className={STICKY_NO} />
              <NameCell>Jami</NameCell>
              <MoneyCell value={n(pool.incomeTiyin)} />
              <MoneyCell value={n(pool.spendTiyin)} />
              <MoneyCell value={n(pool.balanceTiyin)} signedColor />
              <MoneyCell value={n(mar.incomeTiyin)} />
              <MoneyCell value={n(mar.spendTiyin)} />
              <MoneyCell value={n(mar.balanceTiyin)} signedColor />
              <Td />
            </Tr>
          </tbody>
        </RTable>
        <TableNote>
          Kirim — Qo&apos;mita mablag&apos;lari (kassa 1.11 / 1.14 / 1.15 va yuklangan fayl — bitta pul, ikki marta sanalmaydi): «Call markaz» deb kelgani — 3802 hovuzi,
          butun tizimdagi hamma bo&apos;limlar xodimlariniki; «Marksheyder» deb kelgani — Marksheyder. Sarf — oylik «3802 dan olingan pullar» shablonining «Jami»
          ustuni: Marksheyder varag&apos;i (nomida «Маркшейдер» va oy) — Marksheyderga, qolgani — hovuzga.
          {d.contract && ` ${d.contract.year}-yil shartnoma: ${sum(n(d.contract.amountTiyin))} so'm — sarfdan keyin ${n(d.contract.leftTiyin) >= 0 ? `qoladi ${sum(n(d.contract.leftTiyin))}` : `oshib ketgan ${sum(-n(d.contract.leftTiyin))}`} so'm.`}
          {d.excluded.length > 0 && ` Sarfi hisobga olinmagan oylar: ${d.excluded.map(formatPeriod).join(', ')}.`}
        </TableNote>
      </ReportCard>

      <ReportCard
        title={side === 'pool' ? "3802 hovuzi: bo'limlar bo'yicha sarf" : "Marksheyder: sarf va kirimlar"}
        actions={
          <PillTabs
            value={side}
            onChange={setSide}
            options={[
              { value: 'pool', label: '3802 hovuzi' },
              { value: 'marksheyder', label: 'Marksheyder' },
            ]}
          />
        }
      >
        <SectionsTable side={cur} months={d.months} excluded={excluded} />
        <IncomesTable side={cur} />
      </ReportCard>
    </div>
  );
}

function SectionsTable({ side, months, excluded }: { side: HisobSide; months: string[]; excluded: Set<string> }) {
  const shown = months.filter((p) => side.sections.some((s) => s.months[p]));
  if (!side.sections.length) return <EmptyNote>Bu davrda shablon bo&apos;yicha sarf yo&apos;q</EmptyNote>;
  return (
    <RTable minWidth={Math.max(760, 360 + shown.length * 120)}>
      <thead>
        <tr>
          <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
          <Th className={cn(STICKY_NAME, 'z-[2] min-w-56 text-left')}>Bo&apos;lim (shablondagi nomi)</Th>
          {shown.map((p) => (
            <Th key={p} className={cn(excluded.has(p) && 'text-(--color-text-faint)')}>
              {formatPeriod(p)}
            </Th>
          ))}
          <Th>Jami</Th>
        </tr>
      </thead>
      <tbody>
        {side.sections.map((s, i) => (
          <Tr key={s.name}>
            <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
            <NameCell sub={`${s.employees} xodim`}>{s.name}</NameCell>
            {shown.map((p) => (
              <MoneyCell key={p} value={n(s.months[p] ?? '0')} className={cn(!s.months[p] && 'text-(--color-text-faint)')} />
            ))}
            <MoneyCell value={n(s.totalTiyin)} strong />
          </Tr>
        ))}
        <Tr total>
          <Td className={STICKY_NO} />
          <NameCell>Jami sarf</NameCell>
          {shown.map((p) => (
            <MoneyCell key={p} value={side.sections.reduce((t, s) => t + n(s.months[p] ?? '0'), 0)} />
          ))}
          <MoneyCell value={n(side.spendTiyin)} />
        </Tr>
      </tbody>
    </RTable>
  );
}

function IncomesTable({ side }: { side: HisobSide }) {
  if (!side.incomes.length) return <TableNote>Bu davrda kirim yo&apos;q.</TableNote>;
  return (
    <div className="border-t border-(--color-line) pt-3">
      <p className="px-5 pb-2 text-sm font-semibold text-heading">Kelgan pullar ({side.incomes.length} ta)</p>
      <RTable minWidth={700}>
        <thead>
          <tr>
            <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
            <Th className={cn(STICKY_NAME, 'z-[2] min-w-40 text-left')}>Sana</Th>
            <Th className="text-left">Modda</Th>
            <Th className="text-left">Manba</Th>
            <Th>Summa</Th>
          </tr>
        </thead>
        <tbody>
          {side.incomes.map((x, i) => (
            <Tr key={x.id}>
              <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
              <NameCell sub={formatPeriod(x.period)}>{x.date.split('-').reverse().join('.')}</NameCell>
              <Td className="text-left text-xs">{x.label}</Td>
              <Td className="text-left text-xs text-(--color-text-muted)">{x.source}</Td>
              <MoneyCell value={n(x.amountTiyin)} strong />
            </Tr>
          ))}
        </tbody>
      </RTable>
    </div>
  );
}
