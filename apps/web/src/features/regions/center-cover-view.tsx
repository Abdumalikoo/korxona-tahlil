'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import { ExpandBox, nestHead, NestedRow } from '@/components/report/nested';
import { NameCell, PillTabs, RTable, STICKY_NAME, STICKY_NO, sum, Td, Th, Tr } from '@/components/report/report';
import { pct, TONE, type CompareMode, type SectionFilter } from '@/features/structure/api';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { Fragment, useState } from 'react';
import type { UnitStats } from './api';
import { centerCover, type CoverRow } from './center-cover';
import { drillApi, UNASSIGNED_KEY } from './drill-api';
import { PinflText } from './pinfl-text';

interface DrillCtx {
  range: DateRange;
  section: SectionFilter;
  compare: CompareMode;
}

const n = (t: string | number) => Number(t);
/** To'liq summa: «1 234 567 so'm» (matnda) */
const compact = (t: string | number) => `${sum(t)}\u00A0so'm`;
/** Jadvalda: «1 234 567» */
const cell = (t: string | number) => sum(t);
/** Ichki (ochiladigan) panel jadvali sarlavhasi (pog'ona bo'yicha) va katakchasi */
const inTh = (level: number) => cn(nestHead(level), 'text-center');
const IN_TD = 'border-b border-(--color-line) px-2 py-1.5 text-center text-[13px] tabular-nums';
const pctOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);

/** Ulush chizig'i (0–100%) */
function PctBar({ value, color = '#3b5bdb' }: { value: number | null; color?: string }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-(--color-surface-sunken)">
      <div className="h-1.5 rounded-full" style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%`, background: color }} />
    </div>
  );
}

// ─────────── Viloyat → tumanlar: viloyatning Markazga ulushi tumanlarga daromadi ulushiga qarab bo'linadi ───────────
function DistrictBreakdown({ code, regionName, regionShare, centerNet, ctx }: { code: number; regionName: string; regionShare: number; centerNet: number; ctx: DrillCtx }) {
  const res = useAsync(() => drillApi.region(code, ctx.range, ctx.section, ctx.compare).then((r) => r.data), [code, ctx.range.from, ctx.range.to, ctx.section, ctx.compare]);
  const [openId, setOpenId] = useState<string | null>(null);
  if (!res.data) return <p className="px-4 py-3 text-xs text-(--color-text-muted)">{res.error ? `Tumanlarni yuklab bo'lmadi: ${res.error}` : 'Tumanlar yuklanmoqda…'}</p>;
  const total = n(res.data.totals.incomeTiyin);
  const rows = [...res.data.districts].filter((d) => n(d.incomeTiyin) !== 0 || n(d.factTiyin) !== 0).sort((a, b) => n(b.incomeTiyin) - n(a.incomeTiyin));
  if (!rows.length || total <= 0) return <p className="px-4 py-3 text-xs text-(--color-text-muted)">{regionName}: tanlangan davrda tumanlar daromadi yo&apos;q.</p>;
  return (
    <div>
      {res.data.notes
        .filter((t) => /taqsimlandi|bo'lib bo'lmadi/.test(t))
        .map((t) => (
          <p key={t} className="mx-3 mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
            {t}
          </p>
        ))}
      <p className="px-3 py-2 text-xs text-(--color-text-muted)">
        <b className="text-heading">{regionName}</b> Markazga {compact(regionShare)} beradi — u tumanlarga <b>daromad ulushiga</b> qarab bo&apos;linadi (viloyat daromadi{' '}
        {compact(total)}). Tumanni bosing — xodimlar ulushi ochiladi.
      </p>
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className={cn(inTh(1), 'w-8')} />
            <th className={cn(inTh(1), 'w-9')}>№</th>
            <th className={cn(inTh(1), 'text-left')}>Tuman</th>
            <th className={inTh(1)}>Daromad</th>
            <th className={cn(inTh(1), 'w-44')}>Viloyat daromadidan</th>
            <th className={inTh(1)}>Markazga ulush</th>
            <th className={inTh(1)}>Markazni qoplash</th>
            <th className={inTh(1)}>Tuman natijasi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d, i) => {
            const inc = n(d.incomeTiyin);
            const p = pctOf(inc, total);
            const part = (regionShare * Math.max(0, inc)) / total;
            const open = openId === d.id;
            return (
              <Fragment key={d.id}>
                <tr className={cn('cursor-pointer hover:bg-brand-50/60', open && 'bg-brand-50/60')} onClick={() => setOpenId(open ? null : d.id)}>
                  <td className={IN_TD}>
                    <ExpandBox open={open} onClick={() => setOpenId(open ? null : d.id)} />
                  </td>
                  <td className={cn(IN_TD, 'text-(--color-text-faint)')}>{i + 1}</td>
                  <td className={cn(IN_TD, 'text-left font-medium text-heading')}>
                    {d.unassigned || d.id === UNASSIGNED_KEY ? 'Tumanga biriktirilmagan' : d.name}
                  </td>
                  <td className={cn(IN_TD, 'whitespace-nowrap')}>
                    {cell(inc)}
                    {n(d.allocatedIncomeTiyin ?? 0) !== 0 && <span className="block text-[11px] font-normal text-(--color-text-faint)">shundan taqsimlangan {compact(d.allocatedIncomeTiyin ?? 0)}</span>}
                  </td>
                  <td className={IN_TD}>
                    <div className="flex items-center gap-2">
                      <PctBar value={p} />
                      <span className="w-12 text-right text-xs font-semibold tabular-nums whitespace-nowrap">{pct(p)}</span>
                    </div>
                  </td>
                  <td className={cn(IN_TD, 'whitespace-nowrap font-semibold')}>{cell(part)}</td>
                  <td className={cn(IN_TD, 'whitespace-nowrap')}>{pct(pctOf(part, centerNet))}</td>
                  <td className={cn(IN_TD, 'whitespace-nowrap font-semibold', n(d.resultTiyin) < 0 ? 'text-(--color-expense)' : 'text-(--color-income)')}>{cell(d.resultTiyin)}</td>
                </tr>
                {open && (
                  <NestedRow colSpan={8} level={2}>
                    <EmployeeBreakdown id={d.id} code={code} districtName={d.unassigned ? 'Tumanga biriktirilmagan' : d.name} districtShare={part} regionShare={regionShare} centerNet={centerNet} ctx={ctx} />
                  </NestedRow>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────── Tuman → xodimlar: tumanning Markazga ulushi xodimlarga tushumi (fakt) ulushiga qarab bo'linadi ───────────
function EmployeeBreakdown({ id, code, districtName, districtShare, regionShare, centerNet, ctx }: { id: string; code: number; districtName: string; districtShare: number; regionShare: number; centerNet: number; ctx: DrillCtx }) {
  const res = useAsync(() => drillApi.district(id, code, ctx.range, ctx.section, ctx.compare).then((r) => r.data), [id, code, ctx.range.from, ctx.range.to, ctx.section, ctx.compare]);
  if (!res.data) return <p className="px-3 py-2 text-xs text-(--color-text-muted)">{res.error ? `Xodimlarni yuklab bo'lmadi: ${res.error}` : 'Xodimlar yuklanmoqda…'}</p>;
  const list = res.data.employees.filter((e) => n(e.factTiyin) > 0).sort((a, b) => n(b.factTiyin) - n(a.factTiyin));
  const factSum = list.reduce((a, e) => a + n(e.factTiyin), 0);
  const income = n(res.data.summary.incomeTiyin);
  if (!list.length)
    return (
      <p className="px-3 py-2 text-xs text-(--color-text-muted)">
        {districtName}: xodimlarning tushumi (Natijalar / Reja va tushum fayli) tanlangan davrda yo&apos;q — xodimlarga bo&apos;lib bo&apos;lmaydi.
      </p>
    );
  const coverage = pctOf(factSum, income);
  return (
    <div>
      <p className="px-3 py-2 text-xs text-(--color-text-muted)">
        <b className="text-heading">{districtName}</b> Markazga {compact(districtShare)} beradi — xodimlarga <b>tushumi (fakt) ulushiga</b> qarab bo&apos;linadi. Xodimlar tushumi{' '}
        {compact(factSum)}
        {income > 0 && <> — tuman daromadining {pct(coverage)}</>}
        {coverage !== null && Math.abs(coverage - 100) > 1 && <span className="text-amber-700"> (daromad bilan to&apos;liq mos emas)</span>}.
      </p>
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className={cn(inTh(2), 'w-9')}>№</th>
            <th className={cn(inTh(2), 'text-left')}>Xodim</th>
            <th className={inTh(2)}>Tushum (fakt)</th>
            <th className={cn(inTh(2), 'w-40')}>Tumandagi ulushi</th>
            <th className={inTh(2)}>Markazga ulush</th>
            <th className={inTh(2)} title="Viloyat ulushining necha foizi">
              Viloyatdan
            </th>
            <th className={inTh(2)}>Markazni qoplash</th>
          </tr>
        </thead>
        <tbody>
          {list.map((e, i) => {
            const f = n(e.factTiyin);
            const p = pctOf(f, factSum);
            const part = (districtShare * f) / factSum;
            return (
              <tr key={e.pinfl}>
                <td className={cn(IN_TD, 'text-(--color-text-faint)')}>{i + 1}</td>
                <td className={cn(IN_TD, 'text-left')}>
                  <span className="font-medium text-heading">{e.fullName}</span>
                  <span className="ml-1">
                    <PinflText pinfl={e.pinfl} />
                  </span>
                </td>
                <td className={cn(IN_TD, 'whitespace-nowrap text-(--color-income)')}>{cell(f)}</td>
                <td className={IN_TD}>
                  <div className="flex items-center gap-2">
                    <PctBar value={p} color={TONE.income} />
                    <span className="w-12 text-right text-xs font-semibold tabular-nums whitespace-nowrap">{pct(p)}</span>
                  </div>
                </td>
                <td className={cn(IN_TD, 'whitespace-nowrap font-semibold')}>{cell(part)}</td>
                <td className={cn(IN_TD, 'whitespace-nowrap text-(--color-text-muted)')}>{pct(pctOf(part, regionShare))}</td>
                <td className={cn(IN_TD, 'whitespace-nowrap')}>{pct(pctOf(part, centerNet))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Solishtirma › «Markazni qoplash»: hududlar foydasi Markaz sof xarajatini qanchaga qoplaydi va
// eng yaxshi (optimal) taqsimot: Markaz xarajati hamma hududga imkon qadar teng bo'linadi, foydasi
// yetmagan hudud zararga tushirilmaydi; ulushdan ortgan foyda — korxona foydasiga.
// ═══════════════════════════════════════════════════════════

const STATUS: Record<CoverRow['status'], { label: string; cls: string }> = {
  full: { label: "To'liq ulush", cls: 'bg-emerald-50 text-emerald-700' },
  partial: { label: 'Borini beradi', cls: 'bg-amber-50 text-amber-700' },
  none: { label: 'Zararda — bermaydi', cls: 'bg-red-50 text-red-700' },
};

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-xl border border-(--color-line) bg-white px-4 py-3">
      <p className="text-[13px] font-medium text-(--color-text-muted)">{label}</p>
      <p className={cn('mt-1 text-lg font-bold tabular-nums whitespace-nowrap', tone === 'good' ? 'text-(--color-income)' : tone === 'bad' ? 'text-(--color-expense)' : 'text-heading')}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-(--color-text-muted)">{sub}</p>}
    </div>
  );
}

/** Hudud foydasi: Markazga ketadigan qism (ko'k) + foydaga qoladigan qism (yashil); zarar — qizil */
function SplitBar({ row, max }: { row: CoverRow; max: number }) {
  if (row.profit <= 0) {
    return (
      <div className="h-2.5 w-full rounded-full bg-(--color-surface-sunken)">
        <div className="h-2.5 rounded-full" style={{ width: `${Math.min(100, (Math.abs(row.profit) / max) * 100)}%`, background: TONE.expense, opacity: 0.55 }} />
      </div>
    );
  }
  const w = (v: number) => `${Math.max(0, (v / max) * 100)}%`;
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-(--color-surface-sunken)">
      <div className="h-2.5" style={{ width: w(row.share), background: '#3b5bdb' }} title={`Markazga: ${compact(row.share)}`} />
      <div className="h-2.5" style={{ width: w(Math.max(0, row.rest)), background: TONE.income }} title={`Foydaga: ${compact(row.rest)}`} />
    </div>
  );
}

export function CenterCoverView({
  regions,
  center,
  onOpen,
  range,
  section,
  compare,
}: {
  regions: UnitStats[];
  center: UnitStats | null;
  onOpen: (key: string) => void;
  range?: DateRange;
  section?: SectionFilter;
  compare?: CompareMode;
}) {
  const [mode, setMode] = useState<'optimal' | 'equal'>('optimal');
  const [expanded, setExpanded] = useState<string | null>(null);
  const ctx: DrillCtx | null = range && section && compare ? { range, section, compare } : null;
  const [basisPick, setBasis] = useState<'net' | 'gross' | null>(null);
  const centerNetRaw = center ? center.expense - center.income : 0;
  /** Markaz o'z daromadi bilan xarajatini yopsa ham, hududlar Markaz xarajatini qanday qoplashini ko'rish mumkin (to'liq xarajat asosida) */
  const basis: 'net' | 'gross' = basisPick ?? (centerNetRaw > 0 ? 'net' : 'gross');
  const gross = basis === 'gross';
  const centerNet = center ? (gross ? center.expense : centerNetRaw) : 0;
  const r = centerCover(
    regions.map((s) => ({ key: s.unit.key, code: s.unit.code, name: s.unit.name, income: s.income, profit: s.profit })),
    centerNet,
  );
  /** Haqiqiy korxona natijasi (hududlar − Markaz sof xarajati) — asosdan qat'i nazar */
  const result = r.totalProfit - centerNetRaw;
  /** Yuqoridagi «Markazni qoplash» bilan bir xil: hududlar jami foydasi ÷ Markaz sof xarajati */
  const totalPct = r.centerNet > 0 ? (r.totalProfit / r.centerNet) * 100 : null;
  const max = Math.max(...r.rows.map((x) => Math.abs(x.profit)), 1);
  /** Xarajatlar siyosati: Markaz xarajati ichida hududlar uchun to'langan qism (bayram puli, komandirovka …) */
  const split = center?.unit.centerSplit;
  const paidFor = new Map((split?.byRegion ?? []).map((g) => [g.code, Number(g.amountTiyin)]));
  const hasPaid = paidFor.size > 0;

  const basisSwitch = center && center.expense > 0 && (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs font-semibold text-(--color-text-muted)">Qoplash asosi:</span>
      <PillTabs
        value={basis}
        onChange={setBasis}
        options={[
          { value: 'gross', label: `Markaz xarajati (${compact(center.expense)})` },
          { value: 'net', label: `Sof xarajat: xarajat − daromad (${compact(centerNetRaw)})` },
        ]}
      />
    </div>
  );

  if (!center || centerNet <= 0) {
    return (
      <div className="space-y-4 px-5 py-6">
        {basisSwitch}
        <div className="text-center text-sm text-(--color-text-muted)">
          {center && center.expense > 0 ? (
            <>
              Markaz daromadi ({compact(center.income)}) o&apos;z xarajatini ({compact(center.expense)}) to&apos;liq yopadi — sof xarajat yo&apos;q, qoplash kerak emas. Hududlar foydasi
              to&apos;liq korxona foydasiga qoladi: <b className="tabular-nums whitespace-nowrap text-heading">{compact(r.totalProfit)}</b>. Hududlar Markaz xarajatini qanday qoplashini
              ko&apos;rish uchun «Markaz xarajati» asosini tanlang.
            </>
          ) : (
            <>
              Tanlangan davrda Markaz xarajati yo&apos;q — qoplash kerak emas. Hududlar foydasi to&apos;liq korxona foydasiga qoladi:{' '}
              <b className="tabular-nums whitespace-nowrap text-heading">{compact(r.totalProfit)}</b>.
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-5 pb-1">
      {basisSwitch}
      {gross && (
        <div className="rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-2.5 text-xs leading-relaxed text-heading">
          Hisob <b>Markaz xarajati</b> asosida: Markaz daromadi ({compact(center.income)}) hisobga olinmaydi — u alohida korxona foydasiga qo&apos;shiladi.
          {centerNetRaw <= 0 ? ' Markaz o\'z daromadi bilan xarajatini yopadi, bu jadval «hududlar o\'zi qoplasa nima bo\'lardi» degan savolga javob beradi.' : ''}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Tile
          label={gross ? 'Markaz xarajati' : 'Markaz sof xarajati'}
          value={compact(r.centerNet)}
          sub={
            gross
              ? split && Number(split.assetsTiyin ?? 0) !== 0
                ? `joriy ${compact(Number(split.ownTiyin) + Number(split.regionalTiyin))} + asosiy vositalar sarfi ${compact(split.assetsTiyin ?? 0)} · daromad hisobga olinmagan`
                : `daromad ${compact(center.income)} hisobga olinmagan`
              : split && (Number(split.regionalTiyin) !== 0 || Number(split.assetsTiyin ?? 0) !== 0)
              ? `o'ziniki ${compact(split.ownTiyin)} + hududlar uchun ${compact(split.regionalTiyin)}${Number(split.assetsTiyin ?? 0) ? ` + asosiy vositalar sarfi ${compact(split.assetsTiyin ?? 0)}` : ''}${center.income ? ` − daromad ${compact(center.income)}` : ''}`
              : `xarajat ${compact(center.expense)} − daromad ${compact(center.income)}`
          }
        />
        <Tile label="Hududlar foydasi" value={compact(r.totalProfit)} sub={r.capacity !== r.totalProfit ? `foydadagilar ${compact(r.capacity)} — qoplashga shu ishlatiladi` : `${r.rows.length} ta hudud`} />
        <Tile
          label="Markazni qoplash"
          value={pct(totalPct)}
          tone={(totalPct ?? 0) >= 100 ? 'good' : 'bad'}
          sub={
            r.capacity !== r.totalProfit
              ? `hududlar foydasi ÷ Markaz · zarardagilarsiz ${pct(r.coverPct)}`
              : (totalPct ?? 0) >= 100
                ? `${pct((totalPct ?? 0) - 100)} ortiqcha`
                : `${compact(r.shortfall)} yetishmaydi`
          }
        />
        <Tile
          label={r.shortfall > 0 ? 'Yetishmovchilik' : 'Ortiqcha → foydaga'}
          value={r.shortfall > 0 ? compact(r.shortfall) : compact(r.surplus)}
          tone={r.shortfall > 0 ? 'bad' : 'good'}
          sub={
            r.capacity !== r.totalProfit
              ? `zarardagi hududlar ${compact(r.totalProfit - r.capacity)} → korxona natijasi ${compact(result)}`
              : `korxona natijasi (hududlar − Markaz sof xarajati): ${compact(result)}`
          }
        />
      </div>

      <div className="rounded-xl bg-(--color-surface-muted) px-4 py-3 text-sm leading-relaxed text-(--color-text-muted)">
        <b className="text-heading">Optimal qoplash qanday hisoblanadi.</b> {gross ? 'Markaz xarajati' : 'Markaz sof xarajati'} ({compact(r.centerNet)}) hamma hududga <b>teng</b> bo&apos;linadi — oddiy teng
        taqsimda har biriga {compact(r.equalShare)}. Lekin foydasi bundan kam hudud zararga tushib qoladi
        {r.equalLosers > 0 ? (
          <>
            {' '}
            (teng taqsimda <b className="text-(--color-expense)">{r.equalLosers} ta hudud zararga tushadi</b>)
          </>
        ) : null}
        . Shuning uchun optimal usulda bunday hudud faqat o&apos;z foydasini beradi, yetmagan qism qolgan hududlarga yana teng bo&apos;linadi:{' '}
        {r.shortfall > 0 ? (
          <>
            hududlar foydasi yetmaydi — har biri borini beradi, <b className="text-(--color-expense)">{compact(r.shortfall)}</b> qoplanmay qoladi.
          </>
        ) : (
          <>
            har hududning ulushi ko&apos;pi bilan <b className="text-heading">{compact(r.cap)}</b>. Ulushdan ortgan foyda — <b className="text-(--color-income)">{compact(r.surplus)}</b> —
            korxona foydasiga yo&apos;naltiriladi{gross ? <> (Markaz daromadi {compact(center.income)} ham korxona foydasiga qo&apos;shiladi)</> : null}.
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="font-semibold text-(--color-text-muted)">Taqsimot:</span>
        <PillTabs
          value={mode}
          onChange={setMode}
          options={[
            { value: 'optimal', label: 'Optimal (tavsiya)' },
            { value: 'equal', label: 'Teng taqsim (taqqoslash uchun)' },
          ]}
        />
        {ctx && <span className="text-(--color-text-muted)">hududni bosing — tumanlar, tumanni bosing — xodimlar ulushi</span>}
        <span className="ml-auto flex items-center gap-3 text-(--color-text-muted)">
          <span className="inline-flex items-center gap-1">
            <i className="inline-block size-2.5 rounded-sm" style={{ background: '#3b5bdb' }} /> Markazga
          </span>
          <span className="inline-flex items-center gap-1">
            <i className="inline-block size-2.5 rounded-sm" style={{ background: TONE.income }} /> foydaga
          </span>
        </span>
      </div>

      <div className="-mx-5">
        <RTable minWidth={1060}>
          <thead>
            <tr>
              <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
              <Th className={cn(STICKY_NAME, 'z-[2] min-w-36 text-left')}>Hudud</Th>
              <Th>Foyda</Th>
              {hasPaid && <Th title="Xarajatlar siyosati: shu hudud xodimlari uchun Markaz to'lagan (bayram puli, komandirovka, internet …)">Markaz to&apos;lagan</Th>}
              <Th>{mode === 'optimal' ? 'Markazga ulush' : 'Teng ulush'}</Th>
              <Th title="Markaz sof xarajatining necha foizini qoplaydi">Markazni qoplash</Th>
              <Th title="O'z foydasining necha foizi Markazga ketadi">Foydasidan</Th>
              <Th>Qolgan foyda</Th>
              <Th className="w-40">Taqsimot</Th>
              <Th>Holat</Th>
            </tr>
          </thead>
          <tbody>
            <Tr total>
              <Td className={STICKY_NO} />
              <NameCell>Jami · {r.rows.length} ta hudud</NameCell>
              <Td className={cn('whitespace-nowrap', r.totalProfit < 0 && 'text-(--color-expense)')}>{cell(r.totalProfit)}</Td>
              {hasPaid && <Td className="whitespace-nowrap">{cell(split?.regionalTiyin ?? 0)}</Td>}
              <Td className="whitespace-nowrap">{cell(mode === 'optimal' ? r.covered : r.centerNet)}</Td>
              <Td className="whitespace-nowrap">{pct(((mode === 'optimal' ? r.covered : r.centerNet) / r.centerNet) * 100)}</Td>
              <Td />
              <Td className={cn('whitespace-nowrap', r.totalProfit - r.centerNet < 0 ? 'text-(--color-expense)' : 'text-(--color-income)')}>{cell(r.totalProfit - r.centerNet + (mode === 'optimal' ? r.shortfall : 0))}</Td>
              <Td className="text-left text-[11px] font-normal text-(--color-text-muted)" colSpan={2}>
                {mode === 'optimal' && r.shortfall > 0 ? `qoplanmagan: ${compact(r.shortfall)}` : gross ? `qolgan foyda + Markaz daromadi ${compact(center.income)} = korxona foydasi ${compact(result)}` : 'qolgan foyda = korxona foydasi'}
              </Td>
            </Tr>
            {r.rows.map((row, i) => {
              const share = mode === 'optimal' ? row.share : row.equalShare;
              const rest = mode === 'optimal' ? row.rest : row.equalRest;
              const ofProfit = row.profit > 0 ? (share / row.profit) * 100 : null;
              const st = mode === 'optimal' ? STATUS[row.status] : row.equalRest < 0 ? { label: 'Zararga tushadi', cls: 'bg-red-50 text-red-700' } : STATUS.full;
              const canDrill = ctx !== null && row.code !== null && row.code !== undefined && share > 0;
              const isOpen = expanded === row.key;
              return (
                <Fragment key={row.key}>
                  <Tr onClick={() => (canDrill ? setExpanded(isOpen ? null : row.key) : onOpen(row.key))} className={cn(isOpen && 'bg-brand-50')}>
                    <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                    <NameCell
                      before={<ExpandBox open={isOpen} hidden={!canDrill} onClick={() => setExpanded(isOpen ? null : row.key)} />}
                      className="font-medium text-heading"
                    >
                      <span className="inline-flex items-center gap-1">
                        {row.name}
                        <button
                          type="button"
                          title="Hudud kartasi"
                          className="rounded px-1 text-xs text-(--color-text-faint) hover:bg-brand-100 hover:text-brand-700"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onOpen(row.key);
                          }}
                        >
                          ↗
                        </button>
                      </span>
                    </NameCell>
                    <Td className={cn('whitespace-nowrap', row.profit < 0 && 'text-(--color-expense)')}>{cell(row.profit)}</Td>
                    {hasPaid && <Td className="whitespace-nowrap text-(--color-text-muted)">{paidFor.get(row.code ?? null) ? cell(paidFor.get(row.code ?? null)!) : ''}</Td>}
                    <Td className="whitespace-nowrap font-semibold">{cell(share)}</Td>
                    <Td className="whitespace-nowrap">{pct((share / r.centerNet) * 100)}</Td>
                    <Td className="whitespace-nowrap text-(--color-text-muted)">{pct(ofProfit)}</Td>
                    <Td className={cn('whitespace-nowrap font-semibold', rest < 0 ? 'text-(--color-expense)' : 'text-(--color-income)')}>{cell(rest)}</Td>
                    <Td>
                      <SplitBar row={mode === 'optimal' ? row : { ...row, share: Math.min(Math.max(0, row.profit), row.equalShare), rest: row.equalRest }} max={max} />
                    </Td>
                    <Td>
                      <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', st.cls)}>{st.label}</span>
                    </Td>
                  </Tr>
                  {isOpen && ctx && row.code !== null && row.code !== undefined && (
                    <NestedRow colSpan={hasPaid ? 10 : 9} level={1}>
                      <DistrictBreakdown code={row.code} regionName={row.name} regionShare={share} centerNet={r.centerNet} ctx={ctx} />
                    </NestedRow>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </RTable>
      </div>
    </div>
  );
}