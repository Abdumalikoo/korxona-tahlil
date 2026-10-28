import { toLatin } from '../acc-23106/acc23106.purpose';
import { lev } from '../source-chat/chat.parse';
import { matchPosition } from './shtat-3802.service';

// ═══════════════════════════════════════════════════════════
// 3802 › Nazorat zanjiri — sof hisob (baza yo'q, testlanadi). Bitta oy uchun halqalar:
//  1) Vedomost ↔ Ish haqi tarkibi — har xodim (ism-familiya bo'yicha moslanadi; qo'lda bog'lash ustun):
//     Oklad = OKLAD, 40% ustama = OKLAD_40. Teskari: tarkibda 40% ustama bor, vedomostda yo'q xodimlar.
//  2) Vedomost ↔ Shtat — vedomost bo'limi shtat bo'limiga (nom bo'yicha yoki qo'lda), xodim lavozimi shtat lavozimiga:
//     xodimlar soni ≤ shtat birligi (yuqoriga yaxlitlab), Oklad ≤ shtat maoshi; shtatda yo'q lavozim va bo'lim.
//  3) Vedomost ↔ 23106 — vedomostdagi ta'til puli (+kompensatsiya) va ta'til moddiy yordami shu xodimga 23106 dan
//     to'langanmi (to'lov sanasi oy ±1; JShShIR — tarkib orqali, bo'lmasa — ism). 23106 da qo'lga tegadigan summa: 80–100%.
//  4) Qoplanishi kerak ↔ Qo'mitadan kelgan — bo'lim kesimida: vedomost bo'yicha qoplanadigan summa (shtat qoidasi:
//     Oklad + 40% yoki to'liq; shtatda topilmagan bo'lim — Oklad + 40%) va kelgan ajratma; yil boshidan yig'ma qoldiq.
// Farq chegarasi (tolerance) — bundan kichik farq «mos». Izoh yozilgan farq — «tushuntirildi», ogohlantirishga kirmaydi.
// ═══════════════════════════════════════════════════════════

export type LinkCode = 'TARKIB' | 'SHTAT' | 'D23106' | 'QOPLASH' | 'AJRATISH';
export type LinkStatus = 'OK' | 'WARN' | 'NONE' | 'LATER';

export interface NzVedEmployee {
  section: string;
  fullName: string;
  position: string;
  amounts: Record<string, string>;
  totalTiyin: string;
}

export interface NzTarkibRow {
  pinfl: string;
  fullName: string;
  okladTiyin: bigint;
  ustamaTiyin: bigint;
  totalTiyin: bigint;
}

export interface NzShtatSection {
  kind: 'OLADI' | 'OLMAYDI';
  key: string;
  name: string;
  departmentId: string | null;
  coverage: 'OKLAD_40' | 'FULL' | 'NONE';
  positions: { row: number; name: string; units: number; salaryTiyin: string }[];
}

export interface NzInput {
  period: string;
  ved: NzVedEmployee[];
  /** null — shu oy ish haqi tarkibi yuklanmagan */
  tarkib: NzTarkibRow[] | null;
  shtat: NzShtatSection[];
  departments: { id: string; name: string }[];
  /** Qo'mita daromadi: bo'lim id → tiyin (shu oy); «-» — bo'lim ko'rsatilmagan */
  income: Map<string, bigint>;
  /** Qo'lda bog'lash: ism kaliti → JShShIR (null — «tarkibda yo'q» deb tasdiqlangan) */
  links: Record<string, string | null>;
  /** Vedomost bo'limi kaliti → shtat bo'limi kaliti (null — shtatda yo'q deb tasdiqlangan) */
  sectionMap: Record<string, string | null>;
  /** Izohlar: «<halqa>|<element>» → izoh */
  notes: Record<string, string>;
  toleranceTiyin: bigint;
  /** 23106 dagi ta'til puli va moddiy yordam to'lovlari (oy ±1, to'lov sanasi bo'yicha); null — shu oy 23106 yuklanmagan */
  pay23106?: Nz23106Row[] | null;
}

export interface Nz23106Row {
  pinfl: string | null;
  fullName: string;
  docDate: string;
  amountTiyin: bigint;
  /** ISH_HAQI — ish haqi o'tkazmasi (ta'til puli u bilan birga to'langan bo'lishi mumkin) */
  kind: 'TATIL' | 'MODDIY' | 'ISH_HAQI';
}

/** 23106 — qo'lga tegadigan summa (soliq ushlangan): hisoblanganning 80–100% i — «to'langan» */
export const NET_MIN = 0.8;
const addMonthP = (p: string, k: number) => new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1 + k, 1)).toISOString().slice(0, 7);
export const NET_MAX = 1.0;

export interface D23106Item {
  key: string;
  section: string;
  fullName: string;
  regional: boolean;
  /** Vedomost: ta'til puli (TATIL + TATIL_KOMP) va ta'til moddiy yordami */
  vedTatilTiyin: string;
  vedModdiyTiyin: string;
  vedTiyin: string;
  paid: { docDate: string; amountTiyin: string; kind: 'TATIL' | 'MODDIY' | 'ISH_HAQI' }[];
  paidTiyin: string;
  /** To'langan / hisoblangan (%) */
  ratio: number | null;
  how: 'PINFL' | 'NAME' | null;
  /** WITH_SALARY — alohida ta'til to'lovi yo'q, lekin shu oylarda ish haqi o'tkazmasi bor (birga to'langan bo'lishi mumkin) */
  status: 'PAID' | 'DIFF' | 'WITH_SALARY' | 'NOT_PAID' | 'REGIONAL';
  note: string | null;
}

// ─────────── Ism va nom ───────────

export const nameKey = (s: string) =>
  toLatin(String(s ?? ''))
    .replace(/[ʻʼ‘’`'"«»]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const abs = (v: bigint) => (v < 0n ? -v : v);
const big = (s: string | undefined) => {
  try {
    return BigInt(s ?? '0');
  } catch {
    return 0n;
  }
};

/** Hudud bo'limi (vedomostda viloyatlar alohida) */
export const isRegional = (section: string) => /viloyat|respublika|toshkent shahar|вилоят|республика/.test(nameKey(section)) || /вилоят|республика/i.test(section);

/** Ism → tarkib qatori: qo'lda bog'lash → to'liq ism → familiya + ism → familiya + ism (≤2 harf farq) */
export function matchPerson(fullName: string, rows: NzTarkibRow[], links: Record<string, string | null>, index?: Map<string, NzTarkibRow[]>): { row: NzTarkibRow | null; how: 'LINK' | 'EXACT' | 'FIRST2' | 'FUZZY' | 'NONE' | 'CONFIRMED_NONE' } {
  const key = nameKey(fullName);
  if (key in links) {
    const p = links[key];
    if (p === null) return { row: null, how: 'CONFIRMED_NONE' };
    const r = rows.find((x) => x.pinfl === p);
    if (r) return { row: r, how: 'LINK' };
  }
  const exact = rows.filter((r) => nameKey(r.fullName) === key);
  if (exact.length === 1) return { row: exact[0]!, how: 'EXACT' };
  const two = (s: string) => nameKey(s).split(' ').slice(0, 2).join(' ');
  const k2 = two(fullName);
  const idx = index ?? new Map<string, NzTarkibRow[]>();
  if (!index) for (const r of rows) idx.set(two(r.fullName), [...(idx.get(two(r.fullName)) ?? []), r]);
  const f2 = idx.get(k2) ?? [];
  if (f2.length === 1) return { row: f2[0]!, how: 'FIRST2' };
  if (f2.length > 1) return { row: null, how: 'NONE' };
  if (k2.length >= 8) {
    const near = [...idx.entries()].filter(([k]) => Math.abs(k.length - k2.length) <= 2 && lev(k, k2, 2) <= 2);
    if (near.length === 1 && near[0]![1].length === 1) return { row: near[0]![1][0]!, how: 'FUZZY' };
  }
  return { row: null, how: 'NONE' };
}

/** Tarkib qatorlaridan — o'xshash ismlar (qo'lda bog'lash uchun taklif) */
export function candidates(fullName: string, rows: NzTarkibRow[], n = 5): NzTarkibRow[] {
  const k = nameKey(fullName).split(' ').slice(0, 2).join(' ');
  const sur = k.split(' ')[0] ?? '';
  return rows
    .map((r) => ({ r, k: nameKey(r.fullName).split(' ').slice(0, 2).join(' ') }))
    .map((x) => ({ ...x, d: x.k.startsWith(sur.slice(0, 4)) ? lev(x.k, k, 6) : 99 }))
    .filter((x) => x.d <= 6)
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((x) => x.r);
}

const STOP = new Set(['bolim', 'bolimi', 'boyicha', 'buyicha', 'bilan', 'va', 'xizmati', 'xizmat', 'xizmatlari', 'korsatish', 'ishlash', 'shobasi', 'shoba', 'sho', 'basi', 'markazi', 'markaz', 'bosh', 'mutaxassis']);
const stems = (s: string) => [
  ...new Set(
    nameKey(s.replace(/[сС](?=[A-Za-z])/g, 'c'))
      .split(' ')
      .filter((w) => w.length >= 4 && !STOP.has(w))
      .map((w) => w.slice(0, 5)),
  ),
];

/** Vedomost bo'limi → shtat bo'limi (taklif): viloyatlar — hududiy bo'linmalar; boshqalar — nomdagi so'zlar */
export function suggestShtatSection(vedSection: string, shtat: NzShtatSection[]): NzShtatSection | null {
  if (isRegional(vedSection)) return shtat.find((s) => s.kind === 'OLADI' && /viloyat/.test(nameKey(s.name))) ?? null;
  const a = stems(vedSection);
  if (!a.length) return null;
  // Tanlov: ko'proq mos so'z → yuqoriroq ulush → qisqaroq (aniqroq) shtat nomi
  let best: { s: NzShtatSection; common: number; score: number; size: number } | null = null;
  for (const s of shtat) {
    const b = stems(s.name);
    if (!b.length) continue;
    const common = a.filter((x) => b.includes(x)).length;
    const score = common / Math.min(a.length, b.length);
    if (!common || score < 0.5) continue;
    if (!best || common > best.common || (common === best.common && (score > best.score || (score === best.score && b.length < best.size)))) best = { s, common, score, size: b.length };
  }
  return best?.s ?? null;
}

/** Vedomost bo'limi → ilovadagi bo'lim (Qo'mita daromadi bilan solishtirish uchun) */
export function suggestDept(vedSection: string, deps: { id: string; name: string }[]): string | null {
  const a = stems(vedSection);
  let best: { id: string; common: number; score: number } | null = null;
  for (const d of deps) {
    const b = stems(d.name);
    if (!b.length) continue;
    const common = a.filter((x) => b.includes(x)).length;
    const score = common / Math.min(a.length || 1, b.length);
    if (common && score >= 0.5 && (!best || common > best.common || (common === best.common && score > best.score))) best = { id: d.id, common, score };
  }
  return best?.id ?? null;
}

/** Qo'mita qoplaydigan summa: Oklad + 40% ustama yoki to'liq (jami daromad); olmaydiganlar — 0 */
export function coveredOf(e: NzVedEmployee, coverage: 'OKLAD_40' | 'FULL' | 'NONE'): bigint {
  return coverage === 'FULL' ? big(e.totalTiyin) : coverage === 'OKLAD_40' ? big(e.amounts.OKLAD) + big(e.amounts.USTAMA_40) : 0n;
}

/**
 * Vedomost xodimlari → Qo'mita qoplashi (Nazorat zanjiri 4-halqasi bilan bir xil qoida): vedomost bo'limi → shtat bo'limi
 * (qo'lda tanlangan yoki nom bo'yicha), qoida (shtatda topilmagan — Oklad + 40%), ilovadagi bo'lim.
 */
export function vedCoverage(ved: NzVedEmployee[], shtat: NzShtatSection[], departments: { id: string; name: string }[], sectionMap: Record<string, string | null>) {
  const secs = new Map<string, { sh: NzShtatSection | null; dep: string | null; coverage: 'OKLAD_40' | 'FULL' | 'NONE' }>();
  for (const s of new Set(ved.map((e) => e.section))) {
    const k = nameKey(s);
    const sh = k in sectionMap ? (sectionMap[k] ? (shtat.find((x) => x.key === sectionMap[k]) ?? null) : null) : suggestShtatSection(s, shtat);
    secs.set(s, { sh, dep: sh?.departmentId ?? suggestDept(s, departments), coverage: sh ? (sh.kind === 'OLMAYDI' ? 'NONE' : sh.coverage) : 'OKLAD_40' });
  }
  return ved.map((e) => {
    const x = secs.get(e.section)!;
    return { e, departmentId: x.dep, coverage: x.coverage, rule: x.sh ? ('SHTAT' as const) : ('DEFAULT' as const), coveredTiyin: coveredOf(e, x.coverage) };
  });
}

// ─────────── Natija turlari ───────────

export interface TarkibItem {
  key: string;
  section: string;
  fullName: string;
  position: string;
  regional: boolean;
  how: ReturnType<typeof matchPerson>['how'];
  pinfl: string | null;
  tarkibName: string | null;
  vedOklad: string;
  vedUstama: string;
  tarkibOklad: string | null;
  tarkibUstama: string | null;
  diffTiyin: string;
  status: 'OK' | 'DIFF' | 'NOT_FOUND' | 'CONFIRMED_NONE';
  note: string | null;
}

export interface ShtatPosItem {
  key: string;
  shtatKey: string;
  position: string;
  units: number;
  heads: number;
  salaryTiyin: string;
  maxOkladTiyin: string;
  people: { fullName: string; section: string; okladTiyin: string; over: boolean }[];
  status: 'OK' | 'OVER_UNITS' | 'OVER_SALARY' | 'BOTH';
  note: string | null;
}

export interface QoplashItem {
  key: string;
  departmentId: string | null;
  label: string;
  sections: { name: string; coverage: 'OKLAD_40' | 'FULL' | 'NONE'; rule: 'SHTAT' | 'DEFAULT'; neededTiyin: string; employees: number }[];
  neededTiyin: string;
  incomeTiyin: string;
  diffTiyin: string;
  /** 3802 qoplashiga kiradi (shtat qoidasi bo'yicha qoplanadigan bo'lim); yo'q bo'lsa — kelgan pul boshqa maqsadda (xizmat haqi …) */
  in3802: boolean;
}

export interface NzLink {
  code: LinkCode;
  title: string;
  status: LinkStatus;
  summary: string;
  warn: number;
  explained: number;
}

const som = (t: bigint) => `${(Number(t) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 0 }).replace(/,/g, ' ')} so'm`;

export function computeMonth(inp: NzInput) {
  const tol = inp.toleranceTiyin;
  const note = (link: LinkCode, key: string) => inp.notes[`${link}|${key}`] ?? null;

  // ═══ 1) Vedomost ↔ Tarkib ═══
  const tarkibItems: TarkibItem[] = [];
  const matched = new Set<string>();
  if (inp.tarkib) {
    const idx = new Map<string, NzTarkibRow[]>();
    const two = (s: string) => nameKey(s).split(' ').slice(0, 2).join(' ');
    for (const r of inp.tarkib) idx.set(two(r.fullName), [...(idx.get(two(r.fullName)) ?? []), r]);
    for (const e of inp.ved) {
      const m = matchPerson(e.fullName, inp.tarkib, inp.links, idx);
      const vedOklad = big(e.amounts.OKLAD);
      const vedUstama = big(e.amounts.USTAMA_40);
      const key = nameKey(e.fullName);
      let status: TarkibItem['status'] = m.how === 'CONFIRMED_NONE' ? 'CONFIRMED_NONE' : 'NOT_FOUND';
      let diff = 0n;
      if (m.row) {
        matched.add(m.row.pinfl);
        diff = abs(vedOklad - m.row.okladTiyin) + abs(vedUstama - m.row.ustamaTiyin);
        status = abs(vedOklad - m.row.okladTiyin) > tol || abs(vedUstama - m.row.ustamaTiyin) > tol ? 'DIFF' : 'OK';
      }
      tarkibItems.push({
        key,
        section: e.section,
        fullName: e.fullName,
        position: e.position,
        regional: isRegional(e.section),
        how: m.how,
        pinfl: m.row?.pinfl ?? null,
        tarkibName: m.row?.fullName ?? null,
        vedOklad: vedOklad.toString(),
        vedUstama: vedUstama.toString(),
        tarkibOklad: m.row ? m.row.okladTiyin.toString() : null,
        tarkibUstama: m.row ? m.row.ustamaTiyin.toString() : null,
        diffTiyin: diff.toString(),
        status,
        note: note('TARKIB', key),
      });
    }
  }
  /** Tarkibda 40% ustama bor, vedomostda yo'q */
  const tarkibOnly = (inp.tarkib ?? [])
    .filter((r) => r.ustamaTiyin > 0n && !matched.has(r.pinfl))
    .map((r) => ({ key: `p:${r.pinfl}`, pinfl: r.pinfl, fullName: r.fullName, okladTiyin: r.okladTiyin.toString(), ustamaTiyin: r.ustamaTiyin.toString(), note: note('TARKIB', `p:${r.pinfl}`) }));

  // ═══ 3) Vedomost ↔ 23106 ═══
  const d23106: D23106Item[] = [];
  if (inp.pay23106) {
    const pinflOf = new Map(tarkibItems.filter((x) => x.pinfl).map((x) => [`${x.section}|${x.key}`, x.pinfl!]));
    const two = (s: string) => nameKey(s).split(' ').slice(0, 2).join(' ');
    for (const e of inp.ved) {
      const tatil = big(e.amounts.TATIL) + big(e.amounts.TATIL_KOMP);
      const moddiy = big(e.amounts.TATIL_MODDIY);
      const ved = tatil + moddiy;
      if (ved <= 0n) continue;
      const key = nameKey(e.fullName);
      const pinfl = pinflOf.get(`${e.section}|${key}`) ?? null;
      let how: D23106Item['how'] = null;
      const all = pinfl ? inp.pay23106.filter((r) => r.pinfl === pinfl) : [];
      const mine = all.length ? all : inp.pay23106.filter((r) => two(r.fullName) === two(e.fullName));
      if (mine.length) how = all.length ? 'PINFL' : 'NAME';
      const salary = mine.filter((r) => r.kind === 'ISH_HAQI');
      let rows = mine.filter((r) => r.kind !== 'ISH_HAQI');
      // Oynada bir nechta ta'til to'lovi bo'lishi mumkin: avval shu oy, keyin oldingi, keyingi, hammasi — birinchi mos kelgani
      const fits = (x: bigint) => {
        const k = Number(x) / Number(ved);
        return (k >= NET_MIN && k <= NET_MAX) || abs(x - ved) <= tol;
      };
      const month = (r: Nz23106Row) => r.docDate.slice(0, 7);
      const prev = addMonthP(inp.period, -1);
      const next = addMonthP(inp.period, 1);
      const sets = [rows.filter((r) => month(r) === inp.period), rows.filter((r) => month(r) === prev || month(r) === inp.period), rows.filter((r) => month(r) === inp.period || month(r) === next), rows];
      const sumOf = (l: Nz23106Row[]) => l.reduce((t, r) => t + r.amountTiyin, 0n);
      const pick = sets.find((l) => l.length && fits(sumOf(l))) ?? (sets.find((l) => l.length) ?? []);
      rows = pick;
      const paid = sumOf(rows);
      const ratio = paid > 0n ? Number(paid) / Number(ved) : null;
      const regional = isRegional(e.section);
      const status: D23106Item['status'] = rows.length ? (fits(paid) ? 'PAID' : 'DIFF') : salary.length && !(regional && how === 'NAME') ? 'WITH_SALARY' : regional ? 'REGIONAL' : 'NOT_PAID';
      if (status === 'WITH_SALARY') rows = salary.filter((r) => r.docDate.slice(0, 7) >= prev && r.docDate.slice(0, 7) <= next);
      d23106.push({
        key,
        section: e.section,
        fullName: e.fullName,
        regional,
        vedTatilTiyin: tatil.toString(),
        vedModdiyTiyin: moddiy.toString(),
        vedTiyin: ved.toString(),
        paid: rows.map((r) => ({ docDate: r.docDate, amountTiyin: r.amountTiyin.toString(), kind: r.kind })).sort((a, b) => a.docDate.localeCompare(b.docDate)),
        paidTiyin: status === 'WITH_SALARY' ? '0' : paid.toString(),
        ratio: status === 'WITH_SALARY' || ratio === null ? null : Math.round(ratio * 1000) / 10,
        how,
        status,
        note: note('D23106', key),
      });
    }
  }

  // ═══ 2) Vedomost ↔ Shtat ═══
  const vedSections = [...new Set(inp.ved.map((e) => e.section))];
  const secOf = new Map<string, { shtat: NzShtatSection | null; mode: 'SAVED' | 'SUGGESTED' | 'NONE' }>();
  for (const s of vedSections) {
    const k = nameKey(s);
    if (k in inp.sectionMap) {
      const sk = inp.sectionMap[k];
      secOf.set(s, { shtat: sk ? (inp.shtat.find((x) => x.key === sk) ?? null) : null, mode: 'SAVED' });
    } else {
      const sug = suggestShtatSection(s, inp.shtat);
      secOf.set(s, { shtat: sug, mode: sug ? 'SUGGESTED' : 'NONE' });
    }
  }
  const posAcc = new Map<string, ShtatPosItem>();
  const noPosition: { key: string; fullName: string; section: string; position: string; shtatName: string; note: string | null }[] = [];
  for (const e of inp.ved) {
    const sh = secOf.get(e.section)?.shtat;
    if (!sh) continue;
    const i = matchPosition(e.position, sh.positions.map((p) => p.name));
    if (i === null) {
      const key = `pos:${nameKey(e.fullName)}`;
      noPosition.push({ key, fullName: e.fullName, section: e.section, position: e.position, shtatName: sh.name, note: note('SHTAT', key) });
      continue;
    }
    const p = sh.positions[i]!;
    const k = `${sh.key}:${p.row}`;
    const x = posAcc.get(k) ?? { key: k, shtatKey: sh.key, position: p.name, units: p.units, heads: 0, salaryTiyin: p.salaryTiyin, maxOkladTiyin: '0', people: [], status: 'OK' as const, note: note('SHTAT', k) };
    const oklad = big(e.amounts.OKLAD);
    const over = oklad > big(p.salaryTiyin) + tol && big(p.salaryTiyin) > 0n;
    x.heads += 1;
    if (oklad > big(x.maxOkladTiyin)) x.maxOkladTiyin = oklad.toString();
    x.people.push({ fullName: e.fullName, section: e.section, okladTiyin: oklad.toString(), over });
    posAcc.set(k, x);
  }
  const positions = [...posAcc.values()].map((x) => {
    const overUnits = x.heads > Math.ceil(x.units - 1e-9);
    const overSalary = x.people.some((p) => p.over);
    return { ...x, status: (overUnits && overSalary ? 'BOTH' : overUnits ? 'OVER_UNITS' : overSalary ? 'OVER_SALARY' : 'OK') as ShtatPosItem['status'] };
  });
  const sectionLinks = vedSections.map((s) => {
    const m = secOf.get(s)!;
    return { key: nameKey(s), name: s, employees: inp.ved.filter((e) => e.section === s).length, shtatKey: m.shtat?.key ?? null, shtatName: m.shtat?.name ?? null, shtatKind: m.shtat?.kind ?? null, mode: m.mode, note: note('SHTAT', `sec:${nameKey(s)}`) };
  });

  // ═══ 4) Qoplash ↔ Qo'mita ═══
  const qAcc = new Map<string, QoplashItem>();
  const depName = new Map(inp.departments.map((d) => [d.id, d.name]));
  for (const s of vedSections) {
    const sh = secOf.get(s)!.shtat;
    const coverage = sh ? (sh.kind === 'OLMAYDI' ? 'NONE' : sh.coverage) : 'OKLAD_40';
    const emps = inp.ved.filter((e) => e.section === s);
    const needed = emps.reduce((t, e) => t + coveredOf(e, coverage), 0n);
    const dep = sh?.departmentId ?? suggestDept(s, inp.departments);
    const k = dep ?? `-:${isRegional(s) ? 'hudud' : 'boshqa'}`;
    const x = qAcc.get(k) ?? { key: k, departmentId: dep, label: dep ? (depName.get(dep) ?? "Bo'lim (o'chirilgan)") : isRegional(s) ? 'Hududlar' : "Bo'lim aniqlanmagan", sections: [], neededTiyin: '0', incomeTiyin: '0', diffTiyin: '0', in3802: false };
    x.sections.push({ name: s, coverage, rule: sh ? 'SHTAT' : 'DEFAULT', neededTiyin: needed.toString(), employees: emps.length });
    if (coverage !== 'NONE') x.in3802 = true;
    x.neededTiyin = (big(x.neededTiyin) + needed).toString();
    qAcc.set(k, x);
  }
  for (const [dep, v] of inp.income) {
    const k = dep === '-' ? '-:kelgan' : dep;
    const x = qAcc.get(k) ?? { key: k, departmentId: dep === '-' ? null : dep, label: dep === '-' ? "Bo'lim ko'rsatilmagan ajratma" : (depName.get(dep) ?? "Bo'lim (o'chirilgan)"), sections: [], neededTiyin: '0', incomeTiyin: '0', diffTiyin: '0', in3802: false };
    x.incomeTiyin = (big(x.incomeTiyin) + v).toString();
    qAcc.set(k, x);
  }
  const qoplash = [...qAcc.values()].map((x) => ({ ...x, diffTiyin: (big(x.incomeTiyin) - big(x.neededTiyin)).toString() })).sort((a, b) => Number(b.in3802) - Number(a.in3802) || Number(big(b.neededTiyin) - big(a.neededTiyin)));
  const neededTotal = qoplash.reduce((t, x) => t + big(x.neededTiyin), 0n);
  const incomeTotal = qoplash.filter((x) => x.in3802).reduce((t, x) => t + big(x.incomeTiyin), 0n);
  /** 3802 ga kirmaydigan bo'limlarga kelgan pul (masalan, Marksheyder xizmat haqi) — solishtirishga qo'shilmaydi */
  const otherIncome = qoplash.filter((x) => !x.in3802).reduce((t, x) => t + big(x.incomeTiyin), 0n);

  // ═══ Halqalar holati ═══
  const tWarn = tarkibItems.filter((x) => (x.status === 'DIFF' || (x.status === 'NOT_FOUND' && !x.regional)) && !x.note);
  const tExpl = tarkibItems.filter((x) => (x.status === 'DIFF' || x.status === 'NOT_FOUND') && x.note).length + tarkibOnly.filter((x) => x.note).length;
  const tOnly = tarkibOnly.filter((x) => !x.note);
  const regionalMissing = tarkibItems.filter((x) => x.status === 'NOT_FOUND' && x.regional && !x.note).length;
  const sWarnPos = positions.filter((p) => p.status !== 'OK' && !p.note);
  const sWarnNoPos = noPosition.filter((p) => !p.note);
  const sWarnSec = sectionLinks.filter((s) => !s.shtatKey && !s.note);
  const sExpl = positions.filter((p) => p.status !== 'OK' && p.note).length + noPosition.filter((p) => p.note).length + sectionLinks.filter((s) => !s.shtatKey && s.note).length;
  const qNote = note('QOPLASH', 'oy');
  const dWarn = d23106.filter((x) => (x.status === 'DIFF' || x.status === 'NOT_PAID') && !x.note);
  const qDiff = incomeTotal - neededTotal;

  const links: NzLink[] = [
    inp.tarkib === null
      ? { code: 'TARKIB', title: 'Vedomost ↔ Ish haqi tarkibi', status: 'NONE', summary: "Shu oy ish haqi tarkibi yuklanmagan (Xarajatlar › Ish haqi tarkibi)", warn: 0, explained: 0 }
      : {
          code: 'TARKIB',
          title: 'Vedomost ↔ Ish haqi tarkibi',
          status: tWarn.length || tOnly.length ? 'WARN' : 'OK',
          summary: [
            `${tarkibItems.filter((x) => x.status === 'OK').length} xodim mos`,
            tarkibItems.some((x) => x.status === 'DIFF') ? `${tarkibItems.filter((x) => x.status === 'DIFF').length} tasida summa farqi` : '',
            tarkibItems.some((x) => x.status === 'NOT_FOUND' && !x.regional) ? `${tarkibItems.filter((x) => x.status === 'NOT_FOUND' && !x.regional).length} tasi tarkibda topilmadi` : '',
            regionalMissing ? `hudud xodimlari tarkibda yo'q: ${regionalMissing} (Markaz tarkibiga kirmaydi)` : '',
            tarkibOnly.length ? `tarkibda 40% bor, vedomostda yo'q: ${tarkibOnly.length}` : '',
          ]
            .filter(Boolean)
            .join(' · '),
          warn: tWarn.length + tOnly.length,
          explained: tExpl,
        },
    !inp.shtat.length
      ? { code: 'SHTAT', title: 'Vedomost ↔ Shtat', status: 'NONE', summary: 'Shtat jadvali yuklanmagan (3802 › Shtatlar)', warn: 0, explained: 0 }
      : {
          code: 'SHTAT',
          title: 'Vedomost ↔ Shtat',
          status: sWarnPos.length || sWarnNoPos.length || sWarnSec.length ? 'WARN' : 'OK',
          summary: [
            `${positions.filter((p) => p.status === 'OK').length} lavozim mos`,
            positions.some((p) => p.status === 'OVER_UNITS' || p.status === 'BOTH') ? `birlikdan ortiq: ${positions.filter((p) => p.status === 'OVER_UNITS' || p.status === 'BOTH').length}` : '',
            positions.some((p) => p.status === 'OVER_SALARY' || p.status === 'BOTH') ? `maoshdan ortiq: ${positions.filter((p) => p.status === 'OVER_SALARY' || p.status === 'BOTH').length}` : '',
            noPosition.length ? `shtatda yo'q lavozim: ${noPosition.length} xodim` : '',
            sectionLinks.some((s) => !s.shtatKey) ? `shtatda topilmagan bo'lim: ${sectionLinks.filter((s) => !s.shtatKey).length}` : '',
          ]
            .filter(Boolean)
            .join(' · '),
          warn: sWarnPos.length + sWarnNoPos.length + sWarnSec.length,
          explained: sExpl,
        },
    !inp.pay23106
      ? { code: 'D23106', title: 'Vedomost ↔ 23106', status: 'NONE', summary: "Shu oy 23106 ko'chirmasi yuklanmagan (Xarajatlar › 23106)", warn: 0, explained: 0 }
      : {
          code: 'D23106',
          title: 'Vedomost ↔ 23106',
          status: dWarn.length ? 'WARN' : 'OK',
          summary: d23106.length
            ? [
                `ta'til / moddiy yordam: ${d23106.length} xodim`,
                `to'langan: ${d23106.filter((x) => x.status === 'PAID').length}`,
                d23106.some((x) => x.status === 'DIFF') ? `summa farqi: ${d23106.filter((x) => x.status === 'DIFF').length}` : '',
                d23106.some((x) => x.status === 'WITH_SALARY') ? `alohida to'lov yo'q, ish haqi bilan birga: ${d23106.filter((x) => x.status === 'WITH_SALARY').length}` : '',
                d23106.some((x) => x.status === 'NOT_PAID') ? `23106 da hech narsa topilmadi: ${d23106.filter((x) => x.status === 'NOT_PAID').length}` : '',
                d23106.some((x) => x.status === 'REGIONAL') ? `hudud xodimlari: ${d23106.filter((x) => x.status === 'REGIONAL').length} (markaziy 23106 dan o'tmaydi)` : '',
              ]
                .filter(Boolean)
                .join(' · ')
            : "Vedomostda shu oy ta'til puli va moddiy yordam yo'q",
          warn: dWarn.length,
          explained: d23106.filter((x) => (x.status === 'DIFF' || x.status === 'NOT_PAID') && x.note).length,
        },
    incomeTotal === 0n
      ? { code: 'QOPLASH', title: "Qoplanishi kerak ↔ Qo'mitadan kelgan", status: qNote ? 'OK' : 'NONE', summary: `Qoplanishi kerak: ${som(neededTotal)} · Qo'mitadan shu oy uchun 3802 ajratmasi kiritilmagan (Daromadlar › Qo'mita mablag'lari)${otherIncome ? ` · boshqa maqsadda kelgan: ${som(otherIncome)}` : ''}`, warn: 0, explained: qNote ? 1 : 0 }
      : {
          code: 'QOPLASH',
          title: "Qoplanishi kerak ↔ Qo'mitadan kelgan",
          status: abs(qDiff) <= tol || qNote ? 'OK' : 'WARN',
          summary: `kerak ${som(neededTotal)} · kelgan ${som(incomeTotal)} · ${qDiff >= 0n ? 'ortiqcha' : 'kamomad'} ${som(abs(qDiff))}${otherIncome ? ` · boshqa maqsadda kelgan: ${som(otherIncome)}` : ''}`,
          warn: abs(qDiff) <= tol || qNote ? 0 : 1,
          explained: qNote && abs(qDiff) > tol ? 1 : 0,
        },
    { code: 'AJRATISH', title: 'Markaz xarajatidan ajratish', status: 'LATER', summary: 'Faqat ko‘rsatish — alohida reja va ruxsatdan keyin', warn: 0, explained: 0 },
  ];

  return {
    period: inp.period,
    links,
    tarkib: { items: tarkibItems, tarkibOnly, loaded: inp.tarkib !== null },
    d23106: { items: d23106, loaded: Boolean(inp.pay23106) },
    shtat: { positions, noPosition, sections: sectionLinks },
    qoplash: { items: qoplash, neededTiyin: neededTotal.toString(), incomeTiyin: incomeTotal.toString(), otherIncomeTiyin: otherIncome.toString(), note: qNote },
  };
}

export type NzMonth = ReturnType<typeof computeMonth>;
