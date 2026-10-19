import { createHash } from 'node:crypto';
import type {
  Anomaly,
  CompareMode,
  DateRange,
  Driver,
  Insights,
  LevelKey,
  ModuleKey,
  ParetoItem,
  SectionFilter,
  StructureKind,
  StructureNode,
  StructureRecord,
} from './structure.types';

// ═══════════════════════════════════════════════════════════
// Tarkib dvigateli — bazaga bog'liq emas, sof hisob-kitob.
// Servis yozuvlarni yuklaydi, bu yerda guruhlanadi va tahlil qilinadi.
// ═══════════════════════════════════════════════════════════

const TASHKENT_MS = 5 * 3600_000;
const DAY_MS = 86_400_000;

/** Yozuv — xarajat yoki daromad, tahlil uchun kerakli maydonlar */
export interface Row {
  id: string;
  date: Date;
  period: string;
  amount: bigint;
  categoryCode: string;
  source: string;
  section: string;
  departmentId: string | null;
  regionCode: number | null;
  description: string | null;
  counterparty: string | null;
  documentNo: string | null;
}

export interface Lookups {
  categoryLabel: Map<string, string>;
  categoryParent: Map<string, string | null>;
  regionName: Map<number, string>;
  departmentName: Map<string, string>;
  /** Xarajat id → mashina (VEHICLE manbali yozuvlar uchun) */
  vehicleOf: Map<string, { id: string; label: string }>;
}

export interface Bucket {
  key: string;
  label: string;
  module: ModuleKey | null;
}

// ─────────── Sana va davrlar ───────────

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDay(value: string): number | null {
  const match = DATE_RE.exec(value ?? '');
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(ms).toISOString().slice(0, 10) === value ? ms : null;
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Toshkent kuni oralig'i → UTC chegaralar [start, end) */
export function bounds(range: DateRange): { start: Date; end: Date } {
  return {
    start: new Date(parseDay(range.from)! - TASHKENT_MS),
    end: new Date(parseDay(range.to)! + DAY_MS - TASHKENT_MS),
  };
}

/** Teng uzunlikdagi oldingi davr */
export function previousRange(range: DateRange): DateRange {
  const from = parseDay(range.from)!;
  const to = parseDay(range.to)!;
  const days = Math.round((to - from) / DAY_MS) + 1;
  const prevTo = from - DAY_MS;
  return { from: isoDay(prevTo - (days - 1) * DAY_MS), to: isoDay(prevTo) };
}

/** Bir yil oldingi xuddi shu davr (29-fevral → 28-fevral) */
export function yearAgoRange(range: DateRange): DateRange {
  const shift = (value: string): string => {
    const [y, m, d] = value.split('-').map(Number) as [number, number, number];
    const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
    return `${y - 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
  };
  return { from: shift(range.from), to: shift(range.to) };
}

/** Solishtiriladigan davr */
export function compareRange(range: DateRange, mode: CompareMode): DateRange {
  return mode === 'yoy' ? yearAgoRange(range) : previousRange(range);
}

/** Oraliq oxiridagi oy bilan tugaydigan oylar (standart — 24 oy) */
export function trendMonths(range: DateRange, count = 24): string[] {
  const [y, m] = range.to.split('-').map(Number) as [number, number];
  const result: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const index = y * 12 + (m - 1) - i;
    result.push(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`);
  }
  return result;
}

/** Oylar oxirgi kuni oraliqqa tushadigan oylar (ish haqi oy oxiri sanasi bilan yoziladi) */
export function periodsEndingIn(range: DateRange): string[] {
  const from = parseDay(range.from)!;
  const to = parseDay(range.to)!;
  const result: string[] = [];
  const [y0, m0] = range.from.split('-').map(Number) as [number, number];
  for (let index = y0 * 12 + (m0 - 1); ; index += 1) {
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    const monthEnd = Date.UTC(y, m, 0);
    if (monthEnd > to) break;
    if (monthEnd >= from) result.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return result;
}

// ─────────── Darajalar ───────────

/** Tanlangan yo'l bo'yicha darajalar ketma-ketligi */
/**
 * Darajalar ketma-ketligi.
 * flat — «Doimiy / Boshqa» bosqichisiz: ikkala bo'lim birga; birinchi daraja darhol daromad turi yoki xarajat guruhi.
 * Qisqa ko'rinish shundan foydalanadi.
 */
export function levelsFor(kind: StructureKind, section: SectionFilter, pathKeys: string[], flat = false): LevelKey[] {
  const seq: LevelKey[] = section === 'ALL' && !flat ? ['section'] : [];
  // flat: daromad darhol turlari bo'yicha (manba bosqichisiz) — xarajatdagi guruhlar bilan bir xil ko'rinish
  if (kind === 'income') return flat ? [...seq, 'category', 'place', 'records'] : [...seq, 'source', 'category', 'place', 'records'];

  seq.push('group');
  const group = pathKeys[seq.length - 1];
  if (group === 'm:PAYROLL') return [...seq, 'place', 'employee'];
  if (group === 'm:LEASE') return [...seq, 'lease', 'records'];
  if (group === 'm:VEHICLE') return [...seq, 'vehicle', 'category', 'records'];
  return [...seq, 'category', 'place', 'records'];
}

const SECTION_LABELS: Record<string, string> = { DOIMIY: 'Doimiy', BOSHQA: 'Boshqa (bir martalik)' };

function cleanText(text: string | null): string {
  return (text ?? '').replace(/^\[DEMO\]\s*/, '').trim();
}

function shortHash(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 10);
}

/** Yozuv berilgan darajada qaysi tugunga tushadi */
export function classify(level: LevelKey, row: Row, kind: StructureKind, lk: Lookups): Bucket {
  switch (level) {
    case 'section':
      return { key: row.section, label: SECTION_LABELS[row.section] ?? row.section, module: null };

    case 'group': {
      if (row.source === 'PAYROLL') return { key: 'm:PAYROLL', label: 'Ish haqi (reestr)', module: 'PAYROLL' };
      if (row.source === 'LEASE') return { key: 'm:LEASE', label: 'Ijara shartnomalari', module: 'LEASE' };
      if (row.source === 'VEHICLE') return { key: 'm:VEHICLE', label: 'Mashinalar', module: 'VEHICLE' };
      const parent = lk.categoryParent.get(row.categoryCode) ?? null;
      const code = parent ?? row.categoryCode;
      return { key: `c:${code}`, label: lk.categoryLabel.get(code) ?? code, module: null };
    }

    case 'source':
      return row.source === 'IMPORT' && row.regionCode !== null
        ? { key: 'REGIONAL', label: 'Hududlar tushumi', module: 'REGIONAL' }
        : { key: 'LIST', label: 'Shartnomalar va boshqa tushumlar', module: null };

    case 'category':
      return { key: `k:${row.categoryCode}`, label: lk.categoryLabel.get(row.categoryCode) ?? row.categoryCode, module: null };

    case 'place': {
      if (kind === 'expense' && row.source === 'PAYROLL' && row.regionCode === null && row.departmentId === null) {
        return { key: 'shartnoma', label: 'Shartnoma asosidagi xodimlar', module: null };
      }
      if (row.departmentId) {
        return { key: `d:${row.departmentId}`, label: lk.departmentName.get(row.departmentId) ?? "Bo'lim", module: null };
      }
      if (row.regionCode === 0) return { key: 'r:0', label: 'Markaz', module: null };
      if (row.regionCode !== null) {
        return { key: `r:${row.regionCode}`, label: lk.regionName.get(row.regionCode) ?? `Hudud ${row.regionCode}`, module: null };
      }
      return { key: 'none', label: 'Umumkorxona', module: null };
    }

    case 'lease': {
      const title = cleanText(row.description).replace(/^Ijara:\s*/, '') || 'Ijara';
      return { key: `l:${row.documentNo ?? shortHash(title)}`, label: title, module: null };
    }

    case 'vehicle': {
      const vehicle = lk.vehicleOf.get(row.id);
      return vehicle
        ? { key: `v:${vehicle.id}`, label: vehicle.label, module: null }
        : { key: 'v:none', label: "Noma'lum mashina", module: null };
    }

    default:
      return { key: 'all', label: 'Hammasi', module: null };
  }
}

/** Yo'l bo'yicha filtr: har bosqichda tanlangan tugunga tegishli yozuvlar qoladi */
export function filterByPath(rows: Row[], levels: LevelKey[], pathKeys: string[], kind: StructureKind, lk: Lookups): Row[] {
  let result = rows;
  pathKeys.forEach((key, i) => {
    const level = levels[i]!;
    result = result.filter((row) => classify(level, row, kind, lk).key === key);
  });
  return result;
}

// ─────────── Guruhlash ───────────

export interface Aggregate {
  bucket: Bucket;
  amount: bigint;
  previous: bigint;
  /** Joriy davrdagi Doimiy bo'lim qismi (qolgani — Boshqa) */
  doimiy: bigint;
  count: number;
  trend: bigint[];
}

export function percentChange(current: bigint, previous: bigint): number | null {
  if (previous === 0n) return null;
  return Math.round((Number(current - previous) / Math.abs(Number(previous))) * 1000) / 10;
}

export function aggregate(
  current: Row[],
  previous: Row[],
  trendRows: Row[],
  months: string[],
  classifyRow: (row: Row) => Bucket,
): Aggregate[] {
  const map = new Map<string, Aggregate>();
  const monthIndex = new Map(months.map((p, i) => [p, i]));
  const get = (bucket: Bucket) => {
    let item = map.get(bucket.key);
    if (!item) {
      item = { bucket, amount: 0n, previous: 0n, doimiy: 0n, count: 0, trend: months.map(() => 0n) };
      map.set(bucket.key, item);
    }
    return item;
  };

  for (const row of current) {
    const item = get(classifyRow(row));
    item.amount += row.amount;
    if (row.section === 'DOIMIY') item.doimiy += row.amount;
    item.count += 1;
  }
  for (const row of previous) get(classifyRow(row)).previous += row.amount;
  for (const row of trendRows) {
    const index = monthIndex.get(row.period);
    if (index !== undefined) get(classifyRow(row)).trend[index]! += row.amount;
  }

  return [...map.values()]
    .filter((item) => item.amount !== 0n || item.previous !== 0n)
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : Number(b.previous - a.previous)));
}

export function toNodes(items: Aggregate[], level: LevelKey, drillable: boolean): StructureNode[] {
  const total = items.reduce((sum, item) => sum + item.amount, 0n);
  return items.map((item) => ({
    key: item.bucket.key,
    label: item.bucket.label,
    level,
    amountTiyin: item.amount.toString(),
    previousTiyin: item.previous.toString(),
    changePercent: percentChange(item.amount, item.previous),
    sharePercent: total > 0n ? Math.round((Number(item.amount) / Number(total)) * 10000) / 100 : 0,
    count: item.count,
    doimiyTiyin: item.doimiy.toString(),
    boshqaTiyin: (item.amount - item.doimiy).toString(),
    trend: item.trend.map((v) => v.toString()),
    drillable: drillable && item.amount > 0n,
    module: item.bucket.module,
  }));
}

export function toRecords(rows: Row[], kind: StructureKind, lk: Lookups, limit = 300): StructureRecord[] {
  return [...rows]
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0))
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      date: new Date(row.date.getTime() + TASHKENT_MS).toISOString().slice(0, 10),
      label: cleanText(row.description) || (lk.categoryLabel.get(row.categoryCode) ?? row.categoryCode),
      detail: row.counterparty ?? row.documentNo ?? (lk.categoryLabel.get(row.categoryCode) ?? null),
      place: classify('place', row, kind, lk).label,
      amountTiyin: row.amount.toString(),
    }));
}

// ─────────── Modellar ───────────

function fmtMln(tiyin: bigint): string {
  const som = Number(tiyin) / 100;
  const abs = Math.abs(som);
  const text =
    abs >= 1e9
      ? `${(som / 1e9).toFixed(2).replace('.', ',')} mlrd`
      : abs >= 1e6
        ? `${(som / 1e6).toFixed(1).replace('.', ',')} mln`
        : `${Math.round(som).toLocaleString('ru-RU').replace(/,/g, ' ')}`;
  return `${text} so'm`;
}

const MONTH_NAMES = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

function fmtPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return `${y}-yil ${MONTH_NAMES[m - 1] ?? m}`;
}

function fmtPct(value: number): string {
  return `${value.toFixed(1).replace('.', ',')}%`;
}

export function computeInsights(
  items: Aggregate[],
  months: string[],
  kind: StructureKind,
  sectionTrend: Insights['sectionTrend'],
  compareLabel = "o'tgan teng davr",
): Insights {
  const total = items.reduce((sum, item) => sum + item.amount, 0n);
  const previousTotal = items.reduce((sum, item) => sum + item.previous, 0n);
  const word = kind === 'expense' ? 'xarajat' : 'daromad';
  const notes: string[] = [];

  // 1) O'zgarish omillari
  const sortedByDelta = [...items].sort(
    (a, b) => Math.abs(Number(b.amount - b.previous)) - Math.abs(Number(a.amount - a.previous)),
  );
  const top = sortedByDelta.slice(0, 7);
  const restDelta = sortedByDelta.slice(7).reduce((sum, item) => sum + (item.amount - item.previous), 0n);
  const drivers: Driver[] = top.map((item) => ({
    key: item.bucket.key,
    label: item.bucket.label,
    deltaTiyin: (item.amount - item.previous).toString(),
  }));
  if (restDelta !== 0n) drivers.push({ key: 'rest', label: 'Boshqalar', deltaTiyin: restDelta.toString() });
  const totalDelta = total - previousTotal;

  // 2) Pareto 80/20
  let cumulative = 0;
  const pareto: ParetoItem[] = items
    .filter((item) => item.amount > 0n)
    .map((item) => {
      const share = total > 0n ? (Number(item.amount) / Number(total)) * 100 : 0;
      const before = cumulative;
      cumulative += share;
      return {
        key: item.bucket.key,
        label: item.bucket.label,
        sharePercent: Math.round(share * 100) / 100,
        cumulativePercent: Math.round(cumulative * 100) / 100,
        abc: before < 80 ? 'A' : before < 95 ? 'B' : 'C',
      };
    });
  const paretoCount = pareto.filter((p) => p.abc === 'A').length;

  // 3) Konsentratsiya (HHI)
  const hhi = Math.round(pareto.reduce((sum, p) => sum + p.sharePercent ** 2, 0));
  const effectiveCount = hhi > 0 ? Math.round((10000 / hhi) * 10) / 10 : 0;
  const concentration: Insights['concentration'] = hhi < 1500 ? 'tarqoq' : hhi <= 2500 ? "o'rtacha" : 'yuqori';

  // 4) G'ayrioddiy o'zgarish: so'nggi 3 oyning har biri o'zidan oldingi 12 oy bilan (z-ball)
  const anomalies: Anomaly[] = [];
  for (const item of items) {
    let best: Anomaly | null = null;
    const n = item.trend.length;
    for (let index = Math.max(1, n - 3); index < n; index += 1) {
      const last = Number(item.trend[index]);
      if (last <= 0) continue;
      // Oldingi 12 oy bilan solishtiriladi
      const history = item.trend.slice(Math.max(0, index - 12), index).map(Number).filter((v) => v > 0);
      if (history.length < 4) continue;
      const mean = history.reduce((a, b) => a + b, 0) / history.length;
      const std = Math.sqrt(history.reduce((a, b) => a + (b - mean) ** 2, 0) / (history.length - 1));
      if (std <= 0) continue;
      const z = (last - mean) / std;
      if (Math.abs(z) < 2 || Math.abs(last - mean) <= mean * 0.15) continue;
      if (!best || Math.abs(z) > Math.abs(best.z)) {
        best = {
          key: item.bucket.key,
          label: item.bucket.label,
          period: months[index]!,
          z: Math.round(z * 10) / 10,
          lastTiyin: BigInt(Math.round(last)).toString(),
          averageTiyin: BigInt(Math.round(mean)).toString(),
        };
      }
    }
    if (best) anomalies.push(best);
  }
  anomalies.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));

  // Oddiy tildagi xulosalar
  const leader = pareto[0];
  if (leader) {
    notes.push(`Eng katta ulush — «${leader.label}»: ${fmtPct(leader.sharePercent)} (${fmtMln(items[0]!.amount)}).`);
  }
  if (pareto.length >= 3) {
    notes.push(
      `${word[0]!.toUpperCase() + word.slice(1)}ning 80% i ${paretoCount} ta moddaga to'g'ri keladi (${pareto.length} tadan) — ` +
        (paretoCount <= Math.max(2, pareto.length * 0.3)
          ? "e'tiborni shu moddalarga qaratish kifoya."
          : 'tarkib keng tarqalgan.'),
    );
  }
  if (previousTotal > 0n) {
    const change = percentChange(total, previousTotal)!;
    const main = drivers.find((d) => d.key !== 'rest');
    notes.push(
      `${compareLabel[0]!.toUpperCase() + compareLabel.slice(1)}ga nisbatan ${word} ${change >= 0 ? "o'sgan" : 'kamaygan'}: ${change >= 0 ? '+' : ''}${fmtPct(change)} ` +
        `(${totalDelta >= 0n ? '+' : ''}${fmtMln(totalDelta)}).` +
        (main && BigInt(main.deltaTiyin) !== 0n
          ? ` Eng katta ta'sir — «${main.label}» (${BigInt(main.deltaTiyin) >= 0n ? '+' : ''}${fmtMln(BigInt(main.deltaTiyin))}).`
          : ''),
    );
  }
  if (pareto.length >= 3) {
    notes.push(
      concentration === 'yuqori'
        ? `Konsentratsiya yuqori (HHI ${hhi}): ${word} amalda ${String(effectiveCount).replace('.', ',')} ta moddaga bog'liq — bitta moddadagi o'zgarish umumiy natijaga kuchli ta'sir qiladi.`
        : concentration === "o'rtacha"
          ? `Konsentratsiya o'rtacha (HHI ${hhi}), samarali moddalar soni — ${String(effectiveCount).replace('.', ',')}.`
          : `Tarkib tarqoq (HHI ${hhi}) — ${word} ko'p moddalarga teng taqsimlangan.`,
    );
  }
  if (anomalies.length > 0) {
    const a = anomalies[0]!;
    notes.push(
      `Diqqat: «${a.label}» ${fmtPeriod(a.period)}da odatdagidan keskin ${a.z > 0 ? 'yuqori' : 'past'} ` +
        `(${fmtMln(BigInt(a.lastTiyin))}, o'rtacha ${fmtMln(BigInt(a.averageTiyin))}).`,
    );
  }
  if (sectionTrend && sectionTrend.length > 0) {
    const lastYear = sectionTrend.slice(-12);
    const doimiy = lastYear.reduce((s, r) => s + BigInt(r.doimiyTiyin), 0n);
    const boshqa = lastYear.reduce((s, r) => s + BigInt(r.boshqaTiyin), 0n);
    const all = doimiy + boshqa;
    if (all > 0n) {
      const share = (Number(boshqa) / Number(all)) * 100;
      notes.push(`So'nggi 12 oyda bir martalik (Boshqa) ${word}lar ulushi — ${fmtPct(share)}.`);
    }
  }

  return {
    drivers,
    totalDeltaTiyin: totalDelta.toString(),
    pareto,
    paretoCount,
    hhi,
    effectiveCount,
    concentration,
    anomalies: anomalies.slice(0, 6),
    sectionTrend,
    notes,
  };
}