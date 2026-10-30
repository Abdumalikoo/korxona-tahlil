'use client';

import { DiffCell, MoneyCell, NameCell, PctBadge, PctInline, RTable, STICKY_NAME, STICKY_NO, Td, Th, Tr, changeOf, sum } from '@/components/report/report';
import { CalcValue } from '@/components/ui/calc';
import { ErrorState, LoadingState } from '@/components/ui/states';
import type { MarkItem } from '@/features/reactions/api';
import { Mark } from '@/features/reactions/mark';
import { calcChange, calcShare, calcSum, Q, type Calc } from '@/lib/calc';
import { cn } from '@/lib/utils';
import { partDetailApi, partOpens, safarCostsApi, vehicleCostsApi, type PartDetailItem, type VehicleQuery } from '@/features/regions/api';
import { formatPeriodShort } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { Fragment, useState, type ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════
// Hisobot uslubi uchun qo'shimcha bo'laklar (Solishtirma ichkarisi):
// yuklanish oynasi, sanoq katakchalari, moddalar jadvali, muhokama paneli.
// ═══════════════════════════════════════════════════════════

/** Yuklanmoqda / xato — oq kartada */
export function LoadingCard({ label, error, onRetry }: { label: string; error: string | null; onRetry: () => void }) {
  return <div className="rounded-2xl bg-white shadow-card">{error ? <ErrorState message={error} onRetry={onRetry} /> : <LoadingState label={label} />}</div>;
}

/** Bo'sh holat (karta ichida) */
export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="px-5 pb-6 pt-2 text-center text-sm text-(--color-text-muted)">{children}</p>;
}

/** Sanoq: «1 234» (so'm emas) */
export function count(value: number): string {
  return Math.round(value).toLocaleString('ru-RU').replace(/,/g, ' ');
}

/** Sanoq katakchasi */
export function CountCell({ value, calc, className, dash = true }: { value: number; calc?: Calc | null; className?: string; dash?: boolean }) {
  return (
    <Td className={cn('whitespace-nowrap', className)}>
      {value === 0 && dash ? (
        <span className="text-(--color-text-faint)"></span>
      ) : (
        <CalcValue calc={calc} className="no-underline">
          {count(value)}
        </CalcValue>
      )}
    </Td>
  );
}

/** Sanoq farqi: +12 (foiz nishoni ostida) */
export function CountDiffCell({ current, previous, growthGood = true, className }: { current: number; previous: number; growthGood?: boolean; className?: string }) {
  const diff = Math.round(current - previous);
  const good = diff === 0 ? null : diff > 0 === growthGood;
  return (
    <Td className={cn('whitespace-nowrap font-semibold', good === null ? 'text-(--color-text-faint)' : good ? 'text-(--color-income)' : 'text-(--color-expense)', className)}>
      {good === null ? '' : good ? '+' : '−'}
      {count(Math.abs(diff))}
      {changeOf(current, previous) !== null && <PctInline value={changeOf(current, previous)} growthGood={growthGood} />}
    </Td>
  );
}

/** Summa + Munosabat belgisi */
export function MarkMoneyCell({ value, mark, calc, className, strong, signedColor }: { value: number; mark?: MarkItem | null; calc?: Calc | null; className?: string; strong?: boolean; signedColor?: boolean }) {
  if (!mark) return <MoneyCell value={value} calc={calc} className={className} strong={strong} signedColor={signedColor} />;
  return (
    <Td className={cn('whitespace-nowrap', strong && 'font-semibold', signedColor && (value < 0 ? 'text-(--color-expense)' : value > 0 ? 'text-(--color-income)' : ''), className)}>
      <span className="inline-flex items-center gap-1.5">
        <Mark item={mark} />
        <CalcValue calc={calc} className="no-underline">
          {sum(value)}
        </CalcValue>
      </span>
    </Td>
  );
}

/** Ulush nishoni (oddiy foiz) */
export function ShareCell({ part, total, calc }: { part: number; total: number; calc?: Calc | null }) {
  const share = total > 0 ? (part / total) * 100 : null;
  return (
    <Td>
      {share === null ? (
        <span className="text-(--color-text-faint)"></span>
      ) : (
        <CalcValue calc={calc} className="no-underline">
          <PctBadge value={share} plain />
        </CalcValue>
      )}
    </Td>
  );
}

/** Muhokama / Munosabat paneli (sahifa tepasida) */
export function DiscussBar({ children, action }: { children: ReactNode; action: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white px-4 py-2.5 shadow-card">
      <p className="text-xs text-(--color-text-muted)">{children}</p>
      {action}
    </div>
  );
}

// ─────────── Moddalar jadvali: № · Nomi · O'tgan · Joriy · Farqi · Ulush ───────────

export interface PartLike {
  key: string;
  label: string;
  amountTiyin: string;
  previousTiyin: string;
}

export function PartsTable({
  parts,
  title,
  compareLabel,
  growthGood,
  markOf,
  nameHead = 'Modda',
  totalLabel = 'Jami',
  empty,
  minWidth = 760,
  vehicles,
  safar,
}: {
  /** Berilsa — «Mashina xarajatlari» qatori ochiladi: qaysi mashinaga qancha, turlari, izoh */
  vehicles?: VehicleQuery;
  /** Berilsa — «Xizmat safari» qatori ochiladi: kimga qancha, oyma-oy (unit — shu jadval birligi) */
  safar?: VehicleQuery;
  parts: PartLike[];
  /** «Qanday hisoblandi?» sarlavhasi uchun */
  title: string;
  compareLabel: string;
  growthGood: boolean;
  markOf?: (p: PartLike) => MarkItem | null;
  nameHead?: string;
  totalLabel?: string;
  empty: string;
  minWidth?: number;
}) {
  const [openVehicles, setOpenVehicles] = useState(false);
  const [openSafar, setOpenSafar] = useState(false);
  const [openParts, setOpenParts] = useState<Set<string>>(() => new Set());
  const ctx = vehicles ?? safar;
  const togglePart = (key: string) =>
    setOpenParts((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  if (parts.length === 0) return <EmptyNote>{empty}</EmptyNote>;
  const total = parts.reduce((s, p) => s + Number(p.amountTiyin), 0);
  const prevTotal = parts.reduce((s, p) => s + Number(p.previousTiyin), 0);
  const label = compareLabel.charAt(0).toUpperCase() + compareLabel.slice(1);
  return (
    <RTable minWidth={minWidth}>
      <thead>
        <tr>
          <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
          <Th className={cn(STICKY_NAME, 'z-[2] min-w-36 text-left')}>{nameHead}</Th>
          <Th>{label}</Th>
          <Th>Joriy davr</Th>
          <Th>Farqi, foizda</Th>
          <Th>Ulushi</Th>
        </tr>
      </thead>
      <tbody>
        <Tr total>
          <Td className={STICKY_NO} />
          <NameCell>{totalLabel}</NameCell>
          <MoneyCell value={prevTotal} />
          <MoneyCell value={total} calc={calcSum(title, parts.map((p) => Q.money(p.label, p.amountTiyin)))} />
          <DiffCell value={total - prevTotal} pct={changeOf(total, prevTotal)} growthGood={growthGood} />
          <Td>
            <PctBadge value={100} plain />
          </Td>
        </Tr>
        {parts.map((p, i) => {
          const amount = Number(p.amountTiyin);
          const previous = Number(p.previousTiyin);
          const mark = markOf?.(p) ?? null;
          const isVehicle = Boolean(vehicles) && p.key === 'VEHICLE';
          const isSafar = Boolean(safar) && p.key === 'SAFAR';
          const isPart = Boolean(ctx) && !isVehicle && !isSafar && partOpens(ctx!.unit, p.key);
          const partOpen = isPart && openParts.has(p.key);
          return (
            <Fragment key={p.key}>
            <Tr onClick={isVehicle ? () => setOpenVehicles((x) => !x) : isSafar ? () => setOpenSafar((x) => !x) : isPart ? () => togglePart(p.key) : undefined}>
              <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
              <NameCell
                drill={isVehicle || isSafar || isPart}
                sub={isVehicle ? (openVehicles ? 'mashinalar bo‘yicha — yopish' : 'bosing — qaysi mashinaga qancha') : isSafar ? (openSafar ? 'xodimlar bo‘yicha — yopish' : 'bosing — kimga qancha, oyma-oy') : isPart ? (partOpen ? 'ichi ochiq — yopish' : 'bosing — ichida nimalar bor') : undefined}
                before={mark ? <Mark item={mark} /> : undefined}
              >
                <span title={p.label}>{p.label}</span>
              </NameCell>
              <MoneyCell value={previous} />
              <MoneyCell value={amount} />
              <DiffCell
                value={amount - previous}
                pct={changeOf(amount, previous)}
                growthGood={growthGood}
                calc={calcChange(`${p.label}: o'zgarish`, Q.money('Joriy davr', amount), Q.money(label, previous), { growthGood })}
              />
              <ShareCell part={amount} total={total} calc={calcShare(`${p.label}: ulush`, Q.money(p.label, amount), Q.money(totalLabel, total))} />
            </Tr>
            {isVehicle && openVehicles && <VehicleRows query={vehicles!} partTotal={amount} growthGood={growthGood} />}
            {isSafar && openSafar && <SafarRows query={safar!} partTotal={amount} growthGood={growthGood} />}
            {partOpen && <PartRows query={ctx!} partKey={p.key} partTotal={amount} growthGood={growthGood} depth={1} />}
            </Fragment>
          );
        })}
      </tbody>
    </RTable>
  );
}

/** «Mashina xarajatlari» ichi: har mashina (raqami · rusumi, izoh, turlari) — o'tgan / joriy / farq / moddadagi ulushi */
function VehicleRows({ query, partTotal, growthGood }: { query: VehicleQuery; partTotal: number; growthGood: boolean }) {
  const res = useAsync(() => vehicleCostsApi.costs(query).then((r) => r.data), [query.unit, query.range.from, query.range.to, query.compare, query.section]);
  if (res.error)
    return (
      <tr>
        <td colSpan={6} className="border-b border-(--color-line) bg-[#fffaf0] px-4 py-2 text-xs text-(--color-expense)">
          {res.error}
        </td>
      </tr>
    );
  if (!res.data)
    return (
      <tr>
        <td colSpan={6} className="border-b border-(--color-line) bg-[#fffaf0] px-4 py-2 text-xs text-(--color-text-muted)">
          Mashinalar yuklanmoqda…
        </td>
      </tr>
    );
  if (!res.data.items.length)
    return (
      <tr>
        <td colSpan={6} className="border-b border-(--color-line) bg-[#fffaf0] px-4 py-2 text-xs text-(--color-text-muted)">
          Bu birlikda mashinaga bog&apos;langan xarajat topilmadi
        </td>
      </tr>
    );
  return (
    <>
      {res.data.items.map((v) => {
        const cur = Number(v.amountTiyin);
        const prev = Number(v.previousTiyin);
        return (
          <tr key={v.vehicleId ?? '-'} className="bg-[#fffaf0] [&>td]:bg-inherit">
            <Td className={STICKY_NO} />
            <td className={cn('border-b border-l border-(--color-line) px-1.5 py-2 text-left text-[12.5px]', STICKY_NAME)}>
              <span className="block pl-4">
                <span className="mr-1.5 rounded border border-(--color-line-strong) bg-white px-1 py-px font-mono text-[11px] font-semibold">{v.plateNumber}</span>
                <span className="text-heading">{v.model}</span>
              </span>
              <span className="block pl-4 text-[11px] text-(--color-text-muted)">{v.kinds.map((k) => `${k.label} ${sum(Number(k.amountTiyin))}`).join(' · ')}</span>
              {v.comment && <span className="block pl-4 text-[11px] text-amber-800">💬 {v.comment}</span>}
            </td>
            <MoneyCell value={prev} className="text-(--color-text-muted)" />
            <MoneyCell value={cur} />
            <DiffCell value={cur - prev} pct={changeOf(cur, prev)} growthGood={growthGood} />
            <Td className="text-xs text-(--color-text-muted)">{partTotal > 0 ? `${((cur / partTotal) * 100).toFixed(1).replace('.', ',')}%` : ''}</Td>
          </tr>
        );
      })}
    </>
  );
}

/** «Xizmat safari» ichi: har xodim (F.I.Sh., ishlagan joyi, oylar) — o'tgan / joriy / farq / moddadagi ulushi */
function SafarRows({ query, partTotal, growthGood }: { query: VehicleQuery; partTotal: number; growthGood: boolean }) {
  const res = useAsync(() => safarCostsApi.costs(query).then((r) => r.data), [query.unit, query.range.from, query.range.to, query.compare, query.section]);
  const note = (text: string, tone = 'text-(--color-text-muted)') => (
    <tr>
      <td colSpan={6} className={cn('border-b border-(--color-line) bg-[#f5f8ff] px-4 py-2 text-xs', tone)}>
        {text}
      </td>
    </tr>
  );
  if (res.error) return note(res.error, 'text-(--color-expense)');
  if (!res.data) return note('Xodimlar yuklanmoqda…');
  if (!res.data.items.length) return note("Bu birlikda 23106 dan o'tkazilgan xizmat safari topilmadi (qo'lda yozilganlari — umumiy summada)");
  return (
    <>
      {res.data.items.map((v) => {
        const cur = Number(v.amountTiyin);
        const prev = Number(v.previousTiyin);
        const months = Object.entries(v.months);
        return (
          <tr key={v.key} className="bg-[#f5f8ff] [&>td]:bg-inherit">
            <Td className={STICKY_NO} />
            <td className={cn('border-b border-l border-(--color-line) px-1.5 py-2 text-left text-[12.5px]', STICKY_NAME)}>
              <span className="block pl-4 text-heading">{v.fullName}</span>
              {v.placeLabel && <span className="block pl-4 text-[11px] text-(--color-text-muted)">{v.placeLabel}</span>}
              {months.length > 0 && (
                <span className="block pl-4 text-[11px] text-(--color-text-faint)">
                  {months.map(([m, t]) => `${formatPeriodShort(m)}: ${sum(Number(t))}`).join(' · ')}
                  {v.count > 1 ? ` · ${v.count} ta to'lov` : ''}
                </span>
              )}
            </td>
            <MoneyCell value={prev} className="text-(--color-text-muted)" />
            <MoneyCell value={cur} />
            <DiffCell value={cur - prev} pct={changeOf(cur, prev)} growthGood={growthGood} />
            <Td className="text-xs text-(--color-text-muted)">{partTotal > 0 ? `${((cur / partTotal) * 100).toFixed(1).replace('.', ',')}%` : ''}</Td>
          </tr>
        );
      })}
    </>
  );
}

const PART_TONE = ['bg-[#f7f9fc]', 'bg-[#f1f5fb]', 'bg-[#ebf1f9]', 'bg-[#e5edf7]'];

/** Boshqa moddalar ichi — ichma-ich: guruh → moddalar → kontragent / joy. Kalitli qator yana ochiladi. */
function PartRows({ query, partKey, partTotal, growthGood, depth }: { query: VehicleQuery; partKey: string; partTotal: number; growthGood: boolean; depth: number }) {
  const res = useAsync(() => partDetailApi.detail({ ...query, key: partKey }).then((r) => r.data), [query.unit, partKey, query.range.from, query.range.to, query.compare, query.section]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const tone = PART_TONE[Math.min(depth - 1, PART_TONE.length - 1)];
  const pad = { paddingLeft: `${depth * 14}px` };
  const note = (text: string, color = 'text-(--color-text-muted)') => (
    <tr>
      <td colSpan={6} className={cn('border-b border-(--color-line) px-4 py-2 text-xs', tone, color)}>
        <span style={pad}>{text}</span>
      </td>
    </tr>
  );
  if (res.error) return note(res.error, 'text-(--color-expense)');
  if (!res.data) return note('Yuklanmoqda…');
  if (!res.data.items.length) return note('Bu qismda yozuv topilmadi');
  const toggle = (k: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  return (
    <>
      {res.data.items.map((v: PartDetailItem, idx) => {
        const cur = Number(v.amountTiyin);
        const prev = Number(v.previousTiyin);
        const k = v.key;
        const isOpen = k !== null && open.has(k);
        return (
          <Fragment key={k ?? `${idx}:${v.label}`}>
            <tr className={cn(tone, '[&>td]:bg-inherit', k && 'cursor-pointer hover:brightness-[0.98]')} onClick={k ? () => toggle(k) : undefined}>
              <Td className={STICKY_NO} />
              <td className={cn('border-b border-l border-(--color-line) px-1.5 py-2 text-left text-[12.5px]', STICKY_NAME)}>
                <span className="flex items-start gap-1" style={pad}>
                  <span className="w-3 shrink-0 text-[10px] leading-5 text-(--color-text-faint)">{k ? (isOpen ? '▾' : '▸') : '·'}</span>
                  <span className="min-w-0">
                    <span className="block text-heading" title={v.label}>
                      {v.label}
                    </span>
                    {v.count > 0 && <span className="block text-[11px] text-(--color-text-muted)">{count(v.count)} ta yozuv</span>}
                    {v.sub && <span className="block truncate text-[11px] text-(--color-text-faint)" title={v.sub}>💬 {v.sub}</span>}
                  </span>
                </span>
              </td>
              <MoneyCell value={prev} className="text-(--color-text-muted)" />
              <MoneyCell value={cur} />
              <DiffCell value={cur - prev} pct={changeOf(cur, prev)} growthGood={growthGood} />
              <Td className="text-xs text-(--color-text-muted)">{partTotal > 0 ? `${((cur / partTotal) * 100).toFixed(1).replace('.', ',')}%` : ''}</Td>
            </tr>
            {isOpen && <PartRows query={query} partKey={k!} partTotal={partTotal} growthGood={growthGood} depth={depth + 1} />}
          </Fragment>
        );
      })}
    </>
  );
}
