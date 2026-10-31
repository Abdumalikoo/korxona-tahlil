'use client';

import { ActionButton, MoneyCell, NameCell, PillTabs, ReportCard, RTable, StatTiles, STICKY_NAME, STICKY_NO, TableNote, Td, Th, ToggleAllButton, Tr, sum } from '@/components/report/report';
import { ExpandBox, NestedRow, nestHead } from '@/components/report/nested';
import { EmptyNote, LoadingCard } from '@/components/report/report-extra-c';
import { errorMessage } from '@/lib/error-message';
import { formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useState, type ReactNode } from 'react';
import { hisobApi, type Hisob3802, type HisobMonthDetail, type HisobSide } from './api';

// ═══════════════════════════════════════════════════════════
// 3802 › Qoplash va qoldiq — Qo'mita pullari: IKKI HISOB, ichma-ich:
//   Hisob (3802 / Marksheyder) → Oy → Kelgan pullar (har to'lov) | Sarf → Bo'lim → Xodim.
//   • 3802 — «Call markaz» deb kelgan pul (2026/1 shartnoma): butun 3802 tizimidagi hamma bo'limlar xodimlariniki.
//     Sarf — oylik «3802 dan olingan pullar» shablonining asosiy varag'i («Jami»).
//   • Marksheyder — «Marksheyder uchun» kelgan pul (2026/2 shartnoma). Sarf — shablonning Marksheyder varag'i.
//   Har qatorda: kelgan, sarflangan, qoldiq (oy qatorida — davr boshidan yig'ma). Xodimlar — oy ochilganda yuklanadi.
// ═══════════════════════════════════════════════════════════

type ToastFn = (t: { message: string; tone: 'success' | 'error' } | null) => void;
type SideKey = 'pool' | 'marksheyder';
const n = (s: string) => Number(s);
const SIDE_LABEL: Record<SideKey, { title: string; sub: string }> = {
  pool: { title: '3802', sub: "«Call markaz» deb kelgan pul — hamma bo'limlar xodimlariniki" },
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

  // ─────────── Daraxt: har pog'ona — alohida panel (o'z sarlavhasi va raqamlashi bilan) ───────────
  type Col = 'inc' | 'out' | 'bal' | 'extra';
  type Opts = { openKey?: string; period?: string; sub?: ReactNode; strong?: boolean; tone?: string; muted?: boolean; extra?: ReactNode; plain?: boolean };
  type Line = { id: string; label: ReactNode; v: { inc?: number | null; out?: number | null; bal?: number | null }; opts: Opts; kids?: () => Line[]; kidsLabel?: string; kidsCols?: Col[] };
  const ALL: Col[] = ['inc', 'out', 'bal', 'extra'];
  const COL_HEAD: Record<Col, string> = { inc: 'Kelgan', out: 'Sarflangan', bal: 'Qoldiq', extra: 'Shablon' };
  /** plain — guruh / izoh qatori (raqamsiz) */
  const line = (id: string, label: ReactNode, v: Line['v'], opts: Opts = {}, more: Pick<Line, 'kids' | 'kidsLabel' | 'kidsCols'> = {}): Line => ({ id, label, v, opts, ...more });
  const money = (x: number | null | undefined, depth: number) => (x === null || x === undefined ? <Td /> : <MoneyCell value={x} className={cn(!x && 'text-(--color-text-faint)')} strong={depth === 0} />);
  const level = (list: Line[], depth: number, cols: Col[]): ReactNode[] => {
    const out: ReactNode[] = [];
    let no = 0;
    for (const x of list) {
      const { opts, v } = x;
      const isOpen = opts.openKey ? open.has(opts.openKey) : false;
      if (!opts.plain) no += 1;
      out.push(
        <Tr key={x.id} muted={opts.muted} onClick={opts.openKey ? () => toggle(opts.openKey!, opts.period) : undefined} className={cn(depth === 0 && 'bg-brand-50/60')}>
          <Td className={cn(depth === 0 && STICKY_NO, 'w-12 text-center text-(--color-text-faint)')}>{opts.plain ? '' : no}</Td>
          <NameCell
            sticky={depth === 0}
            sub={opts.sub}
            className={cn((opts.strong || depth === 0) && 'font-semibold text-heading', opts.tone)}
            before={<ExpandBox open={isOpen} hidden={!opts.openKey} onClick={() => toggle(opts.openKey!, opts.period)} />}
          >
            {x.label}
          </NameCell>
          {cols.includes('inc') && money(v.inc, depth)}
          {cols.includes('out') && money(v.out, depth)}
          {cols.includes('bal') && (v.bal === null || v.bal === undefined ? <Td /> : <MoneyCell value={v.bal} strong signedColor />)}
          {cols.includes('extra') && (
            <Td className="whitespace-nowrap text-left text-xs" onClick={(e) => e.stopPropagation()}>
              {opts.extra}
            </Td>
          )}
        </Tr>,
      );
      if (isOpen && x.kids) {
        const kc = x.kidsCols ?? ALL;
        const h = nestHead(depth + 1);
        out.push(
          <NestedRow key={`${x.id}|panel`} colSpan={2 + cols.length} level={depth + 1}>
            <table className="w-full">
              <thead>
                <tr>
                  <th className={cn(h, 'w-12 text-center')}>№</th>
                  <th className={cn(h, 'min-w-72 text-left')}>{x.kidsLabel}</th>
                  {kc.map((c) => (
                    <th key={c} className={cn(h, c === 'extra' ? 'text-left' : 'text-right')}>
                      {COL_HEAD[c]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>{level(x.kids(), depth + 1, kc)}</tbody>
            </table>
          </NestedRow>,
        );
      }
    }
    return out;
  };

  const tree: Line[] = (['pool', 'marksheyder'] as const).map((sk) => {
    const s: HisobSide = d[sk];
    const months = s.months.filter((m) => m.incomeTiyin !== '0' || m.spendTiyin !== '0' || m.vedomost !== 'NONE');
    const monthLine = (m: HisobSide['months'][number]): Line => {
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

      // Kelgan pullar
      const inLine = line(
        `${sk}:${p}:in`,
        `Kelgan pullar (${incs.length} ta)`,
        { inc: n(m.incomeTiyin) },
        { openKey: incs.length ? `${sk}:${p}:in` : undefined, tone: 'text-(--color-income)', plain: true },
        { kidsLabel: 'Sana', kidsCols: ['inc'], kids: () => incs.map((x) => line(`${sk}:${p}:in:${x.id}`, x.date.split('-').reverse().join('.'), { inc: n(x.amountTiyin) }, { sub: `${x.label} · ${x.source}` })) },
      );

      // Sarf: bo'limlar → xodimlar
      const excl = m.vedomost === 'EXCLUDED';
      const sarfLabel = excl ? "Sarf — shablonda bor, hisobga olinmaydi" : `Sarf: bo'limlar (${secs.length} ta)`;
      const outKids = (): Line[] => {
        if (det === 'loading' || !det) return [line(`${sk}:${p}:out:wait`, <span className="text-(--color-text-faint)">Yuklanmoqda…</span>, {}, { plain: true })];
        if ('error' in det) return [line(`${sk}:${p}:out:err`, <span className="text-(--color-expense)">{(det as { error: string }).error}</span>, {}, { plain: true })];
        if (!exSecs.length) return [line(`${sk}:${p}:out:none`, <span className="text-(--color-text-faint)">Bu hisob bo&apos;yicha sarf yo&apos;q</span>, {}, { plain: true })];
        return exSecs.map((sec) => {
          const sid = `${sk}:${p}:out:${sec.name}`;
          const empKids = (): Line[] =>
            sec.employees.map((e, i) => {
              const eid = `${sid}:${i}`;
              // Xodim → nimaga qancha: shablondagi qismlar (oklad, ustama, mukofot, ta'til …)
              const parts = (ready?.components ?? []).filter((c) => e.amounts[c.code] && e.amounts[c.code] !== '0');
              const partKids = (): Line[] => {
                const r = parts.map((c) => line(`${eid}:${c.code}`, c.label, { out: n(e.amounts[c.code]!) }, { muted: excl }));
                const rest = n(e.totalTiyin) - parts.reduce((t, c) => t + n(e.amounts[c.code]!), 0);
                if (parts.length && Math.abs(rest) >= 100) r.push(line(`${eid}:rest`, 'Jami ustunidagi farq (qismlarga ajratilmagan)', { out: rest }, { muted: excl }));
                if (e.note) r.push(line(`${eid}:note`, <span className="text-(--color-text-muted)">Izoh: {e.note}</span>, {}, { muted: excl, plain: true }));
                return r;
              };
              return line(eid, e.fullName, { out: n(e.totalTiyin) }, { openKey: parts.length || e.note ? eid : undefined, sub: e.position || undefined, muted: excl }, { kidsLabel: 'Nimaga', kidsCols: ['out'], kids: partKids });
            });
          return line(sid, sec.name, { out: n(sec.totalTiyin) }, { openKey: sid, sub: `${sec.employees.length} xodim`, muted: excl }, { kidsLabel: 'Xodim', kidsCols: ['out'], kids: empKids });
        });
      };
      const outLine =
        m.vedomost === 'NONE'
          ? line(`${sk}:${p}:out`, <span className="text-(--color-text-faint)">Sarf: shablon yuklanmagan</span>, {}, { plain: true })
          : line(`${sk}:${p}:out`, sarfLabel, { out: excl ? null : n(m.spendTiyin) }, { openKey: `${sk}:${p}:out`, period: p, tone: excl ? 'text-amber-700' : 'text-(--color-expense)', plain: true }, { kidsLabel: "Bo'lim", kidsCols: ['out'], kids: outKids });

      return line(
        `${sk}:${p}`,
        formatPeriod(p),
        { inc: n(m.incomeTiyin), out: n(m.spendTiyin), bal: n(m.balanceTiyin) },
        { openKey: `${sk}:${p}`, period: m.vedomost === 'NONE' ? undefined : p, sub: m.employees ? `${m.employees} xodim` : undefined, muted: m.vedomost === 'EXCLUDED', extra: status },
        { kidsLabel: 'Kelgan / sarf', kidsCols: ['inc', 'out'], kids: () => [inLine, outLine] },
      );
    };
    return line(
      sk,
      SIDE_LABEL[sk].title,
      { inc: n(s.incomeTiyin), out: n(s.spendTiyin), bal: n(s.balanceTiyin) },
      { openKey: sk, sub: SIDE_LABEL[sk].sub },
      { kidsLabel: 'Oy', kids: () => (months.length ? months.map(monthLine) : [line(`${sk}:none`, <span className="text-(--color-text-faint)">Bu davrda harakat yo&apos;q</span>, {}, { plain: true })]) },
    );
  });
  const rows = level(tree, 0, ALL);

  return (
    <div className={cn('space-y-4', loading && 'opacity-70')}>
      <StatTiles
        compareLabel="Avval"
        items={[
          { label: '3802 — kelgan', value: n(pool.incomeTiyin), tone: 'green', note: d.contract ? `shartnoma ${d.contract.year}: ${sum(n(d.contract.amountTiyin))} so'm` : "«Call markaz» deb kelgan pul" },
          { label: '3802 — sarflangan', value: n(pool.spendTiyin), tone: 'red', note: `hamma bo'limlar · ${pool.sections.length} bo'lim` },
          { label: n(pool.balanceTiyin) >= 0 ? '3802 — qoldiq' : '3802 — yetishmaydi', value: n(pool.balanceTiyin), signed: true, tone: 'blue', note: d.contract ? `shartnomadan sarfdan keyin: ${sum(n(d.contract.leftTiyin))}` : 'kelgan − sarflangan' },
          { label: 'Marksheyder — kelgan', value: n(mar.incomeTiyin), tone: 'green', note: "«Marksheyder uchun» kelgan pul" },
          { label: 'Marksheyder — sarflangan', value: n(mar.spendTiyin), tone: 'red', note: "shablonning Marksheyder varag'i" },
          { label: n(mar.balanceTiyin) >= 0 ? 'Marksheyder — qoldiq' : 'Marksheyder — yetishmaydi', value: n(mar.balanceTiyin), signed: true, tone: 'purple', note: 'kelgan − sarflangan' },
        ]}
      />

      <ReportCard
        title="Qo'mita pullari: kelgan → sarflangan → qoldiq"
        badge={`${formatPeriod(d.from)} — ${formatPeriod(d.to)} · oy qatorida qoldiq — davr boshidan yig'ma`}
        actions={
          <>
            {isAdmin && d.contract && <ActionButton onClick={() => void setContract()}>Shartnoma summasi</ActionButton>}
            {/* Ichki darajalar ochiq bo'lsa — yopish (3802 va Marksheyder qatorlari ochiq qoladi) */}
            <ToggleAllButton open={[...open].some((k) => k.includes(':'))} onClick={() => ([...open].some((k) => k.includes(':')) ? setOpen(new Set(['pool', 'marksheyder'])) : expandAll())} />
          </>
        }
      >
        <RTable minWidth={980}>
          <thead>
            <tr>
              <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
              <Th className={cn(STICKY_NAME, 'z-[2] min-w-80 text-left')}>Hisob</Th>
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
          «Call markaz» deb kelgani — 3802 (butun tizimdagi hamma bo&apos;limlar), «Marksheyder» deb kelgani — Marksheyder. Sarf — oylik «3802 dan olingan
          pullar» shablonining «Jami» ustuni: Marksheyder varag&apos;i — Marksheyderga, qolgani — 3802 ga.
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
              { value: 'pool', label: '3802' },
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
