'use client';

import { MoneyCell, NameCell, PillTabs, ReportCard, RTable, StatTiles, STICKY_NAME, STICKY_NO, TableNote, Td, Th, Tr, sum } from '@/components/report/report';
import { EmptyNote, LoadingCard } from '@/components/report/report-extra-c';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/error-message';
import { formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useState, type ReactNode } from 'react';
import { hisobApi, type Hisob3802, type HisobMonthDetail, type HisobSide } from './api';

// ═══════════════════════════════════════════════════════════
// 3802 › Qoplash va qoldiq — Qo'mita pullari: IKKI HISOB, ichma-ich:
//   Hisob (3802 hovuzi / Marksheyder) → Oy → Kelgan pullar (har to'lov) | Sarf → Bo'lim → Xodim.
//   • 3802 hovuzi — «Call markaz» deb kelgan pul (2026/1 shartnoma): butun 3802 tizimidagi hamma bo'limlar xodimlariniki.
//     Sarf — oylik «3802 dan olingan pullar» shablonining asosiy varag'i («Jami»).
//   • Marksheyder — «Marksheyder uchun» kelgan pul (2026/2 shartnoma). Sarf — shablonning Marksheyder varag'i.
//   Har qatorda: kelgan, sarflangan, qoldiq (oy qatorida — davr boshidan yig'ma). Xodimlar — oy ochilganda yuklanadi.
// ═══════════════════════════════════════════════════════════

type ToastFn = (t: { message: string; tone: 'success' | 'error' } | null) => void;
type SideKey = 'pool' | 'marksheyder';
const n = (s: string) => Number(s);
const SIDE_LABEL: Record<SideKey, { title: string; sub: string }> = {
  pool: { title: '3802 hovuzi', sub: "«Call markaz» deb kelgan pul — hamma bo'limlar xodimlariniki" },
  marksheyder: { title: 'Marksheyder', sub: "«Marksheyder uchun» kelgan pul — Marksheyder varag'i sarfi" },
};

export function HisobPanel({ from, to, isAdmin, onToast }: { from: string; to: string; isAdmin: boolean; onToast: ToastFn }) {
  const res = useAsync(() => hisobApi.ledger(from, to).then((r) => r.data), [from, to]);
  const d = res.data;
  if (!d) return <LoadingCard label="Qo'mita pullari hisoblanmoqda" error={res.error} onRetry={res.reload} />;
  return <Body d={d} loading={res.loading} reload={res.reload} isAdmin={isAdmin} onToast={onToast} />;
}

function Body({ d, loading, reload, isAdmin, onToast }: { d: Hisob3802; loading: boolean; reload: () => void; isAdmin: boolean; onToast: ToastFn }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(['pool', 'marksheyder']));
  const [details, setDetails] = useState<Record<string, HisobMonthDetail | 'loading' | { error: string }>>({});
  const [busy, setBusy] = useState(false);
  const [matrix, setMatrix] = useState<SideKey>('pool');
  const pool = d.pool;
  const mar = d.marksheyder;
  const excluded = new Set(d.excluded);

  const loadMonth = async (p: string) => {
    if (details[p] && details[p] !== 'loading' && !('error' in (details[p] as object))) return;
    setDetails((x) => ({ ...x, [p]: 'loading' }));
    try {
      const r = (await hisobApi.month(p)).data;
      setDetails((x) => ({ ...x, [p]: r }));
    } catch (e) {
      setDetails((x) => ({ ...x, [p]: { error: errorMessage(e) } }));
    }
  };
  const toggle = (k: string, period?: string) => {
    setOpen((s) => {
      const nx = new Set(s);
      if (nx.has(k)) nx.delete(k);
      else nx.add(k);
      return nx;
    });
    if (period) void loadMonth(period);
  };
  const expandAll = () => {
    const keys = new Set<string>(['pool', 'marksheyder']);
    for (const sk of ['pool', 'marksheyder'] as const)
      for (const m of d[sk].months) {
        keys.add(`${sk}:${m.period}`);
        keys.add(`${sk}:${m.period}:in`);
        keys.add(`${sk}:${m.period}:out`);
      }
    setOpen(keys);
    for (const p of d.vedomostMonths) void loadMonth(p);
  };

  const toggleMonth = async (p: string) => {
    const next = excluded.has(p) ? d.excluded.filter((x) => x !== p) : [...d.excluded, p];
    setBusy(true);
    try {
      await hisobApi.setExcluded(next);
      onToast({ message: excluded.has(p) ? `${formatPeriod(p)} sarfi hisobga qaytarildi` : `${formatPeriod(p)} sarfi hisobga olinmaydi (shablon saqlanib qoladi)`, tone: 'success' });
      reload();
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
      reload();
    } catch (e) {
      onToast({ message: errorMessage(e), tone: 'error' });
    }
  };

  // ─────────── Daraxt qatorlari ───────────
  const rows: ReactNode[] = [];
  const line = (
    id: string,
    label: ReactNode,
    depth: number,
    v: { inc?: number | null; out?: number | null; bal?: number | null },
    opts: { openKey?: string; period?: string; sub?: ReactNode; strong?: boolean; tone?: string; muted?: boolean; extra?: ReactNode } = {},
  ) => {
    const isOpen = opts.openKey ? open.has(opts.openKey) : false;
    rows.push(
      <Tr key={id} muted={opts.muted} onClick={opts.openKey ? () => toggle(opts.openKey!, opts.period) : undefined} className={cn(depth === 0 && 'bg-brand-50/60', depth >= 3 && 'bg-(--color-surface-muted)/40')}>
        <Td className={STICKY_NO} />
        <NameCell
          sub={opts.sub}
          className={cn((opts.strong || depth === 0) && 'font-semibold text-heading', opts.tone)}
          before={
            <span className="flex shrink-0 items-center" style={{ paddingLeft: depth * 18 }}>
              <span className={cn('inline-block w-3.5 text-center text-(--color-text-faint)', !opts.openKey && 'invisible')}>{isOpen ? '▾' : '▸'}</span>
            </span>
          }
        >
          {label}
        </NameCell>
        {v.inc === null || v.inc === undefined ? <Td /> : <MoneyCell value={v.inc} className={cn(!v.inc && 'text-(--color-text-faint)')} strong={depth === 0} />}
        {v.out === null || v.out === undefined ? <Td /> : <MoneyCell value={v.out} className={cn(!v.out && 'text-(--color-text-faint)')} strong={depth === 0} />}
        {v.bal === null || v.bal === undefined ? <Td /> : <MoneyCell value={v.bal} strong signedColor />}
        <Td className="whitespace-nowrap text-left text-xs" onClick={(e) => e.stopPropagation()}>
          {opts.extra}
        </Td>
      </Tr>,
    );
    return isOpen;
  };

  for (const sk of ['pool', 'marksheyder'] as const) {
    const s: HisobSide = d[sk];
    if (!line(sk, SIDE_LABEL[sk].title, 0, { inc: n(s.incomeTiyin), out: n(s.spendTiyin), bal: n(s.balanceTiyin) }, { openKey: sk, sub: SIDE_LABEL[sk].sub })) continue;
    const months = s.months.filter((m) => m.incomeTiyin !== '0' || m.spendTiyin !== '0' || m.vedomost !== 'NONE');
    if (!months.length) line(`${sk}:none`, <span className="text-(--color-text-faint)">Bu davrda harakat yo&apos;q</span>, 1, {});
    for (const m of months) {
      const p = m.period;
      const incs = s.incomes.filter((x) => x.period === p);
      const secs = s.sections.filter((x) => x.months[p]);
      const det = details[p];
      const ready = det && det !== 'loading' && !('error' in det) ? (det as HisobMonthDetail) : null;
      const exSecs = ready ? ready[sk] : [];
      const status =
        m.vedomost === 'NONE' ? (
          <span className="text-(--color-text-faint)">shablon yuklanmagan</span>
        ) : isAdmin && sk === 'pool' ? (
          <label className="inline-flex cursor-pointer items-center gap-1.5" title="Shu oy shablon sarfini hisobga olish / olmaslik (ikkala hisob uchun; shablon o'chirilmaydi)">
            <input type="checkbox" checked={m.vedomost === 'YES'} disabled={busy} onChange={() => void toggleMonth(p)} className="size-3.5" />
            {m.vedomost === 'YES' ? 'sarf hisobda' : 'sarf hisobga olinmaydi'}
          </label>
        ) : m.vedomost === 'YES' ? (
          'sarf hisobda'
        ) : (
          <span className="text-amber-700">sarf hisobga olinmaydi</span>
        );
      if (!line(`${sk}:${p}`, formatPeriod(p), 1, { inc: n(m.incomeTiyin), out: n(m.spendTiyin), bal: n(m.balanceTiyin) }, { openKey: `${sk}:${p}`, period: m.vedomost === 'NONE' ? undefined : p, sub: m.employees ? `${m.employees} xodim` : undefined, muted: m.vedomost === 'EXCLUDED', extra: status })) continue;

      // Kelgan pullar
      if (line(`${sk}:${p}:in`, `Kelgan pullar (${incs.length} ta)`, 2, { inc: n(m.incomeTiyin) }, { openKey: incs.length ? `${sk}:${p}:in` : undefined, tone: 'text-(--color-income)' }))
        for (const x of incs) line(`${sk}:${p}:in:${x.id}`, x.date.split('-').reverse().join('.'), 3, { inc: n(x.amountTiyin) }, { sub: `${x.label} · ${x.source}` });

      // Sarf: bo'limlar → xodimlar
      const excl = m.vedomost === 'EXCLUDED';
      const sarfLabel = excl ? "Sarf — shablonda bor, hisobga olinmaydi" : `Sarf: bo'limlar (${secs.length} ta)`;
      if (m.vedomost === 'NONE') {
        line(`${sk}:${p}:out`, <span className="text-(--color-text-faint)">Sarf: shablon yuklanmagan</span>, 2, {});
        continue;
      }
      if (!line(`${sk}:${p}:out`, sarfLabel, 2, { out: excl ? null : n(m.spendTiyin) }, { openKey: `${sk}:${p}:out`, period: p, tone: excl ? 'text-amber-700' : 'text-(--color-expense)' })) continue;
      if (det === 'loading' || !det) {
        line(`${sk}:${p}:out:wait`, <span className="text-(--color-text-faint)">Yuklanmoqda…</span>, 3, {});
        continue;
      }
      if ('error' in det) {
        line(`${sk}:${p}:out:err`, <span className="text-(--color-expense)">{(det as { error: string }).error}</span>, 3, {});
        continue;
      }
      if (!exSecs.length) line(`${sk}:${p}:out:none`, <span className="text-(--color-text-faint)">Bu hisob bo&apos;yicha sarf yo&apos;q</span>, 3, {});
      for (const sec of exSecs) {
        const sid = `${sk}:${p}:out:${sec.name}`;
        if (!line(sid, sec.name, 3, { out: n(sec.totalTiyin) }, { openKey: sid, sub: `${sec.employees.length} xodim`, muted: excl })) continue;
        sec.employees.forEach((e, i) =>
          line(`${sid}:${i}`, e.fullName, 4, { out: n(e.totalTiyin) }, { sub: [e.position, e.note].filter(Boolean).join(' · ') || undefined, muted: excl }),
        );
      }
    }
  }

  return (
    <div className={cn('space-y-4', loading && 'opacity-70')}>
      <StatTiles
        compareLabel="Avval"
        items={[
          { label: '3802 hovuzi — kelgan', value: n(pool.incomeTiyin), tone: 'green', note: d.contract ? `shartnoma ${d.contract.year}: ${sum(n(d.contract.amountTiyin))} so'm` : "«Call markaz» deb kelgan pul" },
          { label: '3802 hovuzi — sarflangan', value: n(pool.spendTiyin), tone: 'red', note: `hamma bo'limlar · ${pool.sections.length} bo'lim` },
          { label: n(pool.balanceTiyin) >= 0 ? '3802 hovuzi — qoldiq' : '3802 hovuzi — yetishmaydi', value: n(pool.balanceTiyin), signed: true, tone: 'blue', note: d.contract ? `shartnomadan sarfdan keyin: ${sum(n(d.contract.leftTiyin))}` : 'kelgan − sarflangan' },
          { label: 'Marksheyder — kelgan', value: n(mar.incomeTiyin), tone: 'green', note: "«Marksheyder uchun» kelgan pul" },
          { label: 'Marksheyder — sarflangan', value: n(mar.spendTiyin), tone: 'red', note: "shablonning Marksheyder varag'i" },
          { label: n(mar.balanceTiyin) >= 0 ? 'Marksheyder — qoldiq' : 'Marksheyder — yetishmaydi', value: n(mar.balanceTiyin), signed: true, tone: 'purple', note: 'kelgan − sarflangan' },
        ]}
      />

      <ReportCard
        title="Qo'mita pullari: kelgan → sarflangan → qoldiq"
        badge={`${formatPeriod(d.from)} — ${formatPeriod(d.to)} · oy qatorida qoldiq — davr boshidan yig'ma`}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={expandAll}>
              Hammasini ochish
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(new Set())}>
              Yopish
            </Button>
            {isAdmin && d.contract && (
              <Button size="sm" variant="secondary" onClick={() => void setContract()}>
                Shartnoma summasi
              </Button>
            )}
          </div>
        }
      >
        <RTable minWidth={980}>
          <thead>
            <tr>
              <Th className={cn(STICKY_NO, 'z-[2]')} />
              <Th className={cn(STICKY_NAME, 'z-[2] min-w-80 text-left')}>Hisob → oy → kelgan / sarf → bo&apos;lim → xodim</Th>
              <Th>Kelgan</Th>
              <Th>Sarflangan</Th>
              <Th>Qoldiq</Th>
              <Th className="text-left">Shablon</Th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </RTable>
        <TableNote>
          Qatorni bosing — ichi ochiladi. Kelgan — Qo&apos;mita mablag&apos;lari (kassa 1.11 / 1.14 / 1.15 va yuklangan fayl — bitta pul, ikki marta sanalmaydi):
          «Call markaz» deb kelgani — 3802 hovuzi (butun tizimdagi hamma bo&apos;limlar), «Marksheyder» deb kelgani — Marksheyder. Sarf — oylik «3802 dan olingan
          pullar» shablonining «Jami» ustuni: Marksheyder varag&apos;i — Marksheyderga, qolgani — hovuzga.
          {d.contract && ` ${d.contract.year}-yil shartnoma: ${sum(n(d.contract.amountTiyin))} so'm — sarfdan keyin ${n(d.contract.leftTiyin) >= 0 ? `qoladi ${sum(n(d.contract.leftTiyin))}` : `oshib ketgan ${sum(-n(d.contract.leftTiyin))}`} so'm.`}
          {d.excluded.length > 0 && ` Sarfi hisobga olinmagan oylar: ${d.excluded.map(formatPeriod).join(', ')} (shablon saqlangan, belgini bosib qaytarish mumkin).`}
        </TableNote>
      </ReportCard>

      <ReportCard
        title="Bo'limlar × oylar: sarf"
        actions={
          <PillTabs
            value={matrix}
            onChange={setMatrix}
            options={[
              { value: 'pool', label: '3802 hovuzi' },
              { value: 'marksheyder', label: 'Marksheyder' },
            ]}
          />
        }
      >
        <SectionsTable side={d[matrix]} months={d.months} excluded={excluded} />
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
