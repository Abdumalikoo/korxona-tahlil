import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { runExclusive } from '../../common/locks';
import { monthsBetween } from '../../common/period';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { QOMITA_INCOME_PREFIX, QOMITA_SEGMENT } from './qomita.util';
import { MARKSH_RE, VED_COMPONENT_LABEL, type VedSection } from './vedomost-3802.parse';
import { matchPerson, nameKey, type NzTarkibRow } from './nazorat-3802.compute';
import { Nazorat3802Service } from './nazorat-3802.service';

/** Qo'mita › Solishtirma: xodim — to'liq oylik (ish haqi tarkibi) va undan Qo'mita qoplagani / korxona to'lagani */
export interface CompareEmployee {
  fullName: string;
  position: string;
  /** Ism bog'lanishi: qo'lda (LINK), to'liq ism, familiya+ism, yaqin yozilish; NONE — tarkibda topilmadi */
  how: 'LINK' | 'EXACT' | 'FIRST2' | 'FUZZY' | 'NONE' | 'CONFIRMED_NONE';
  /** To'liq oylik manbai: ish haqi tarkibi; tarkibda yo'q (hudud xodimlari) — reestr (ism bo'yicha yagona) + shu oy vedomosti */
  source: 'TARKIB' | 'VEDOMOST' | null;
  /** To'liq hisoblangan oylik (ish haqi tarkibi «Jami»); null — tarkibda topilmadi */
  fullTiyin: string | null;
  /** Qo'mita qoplagani (oylik shablon «Jami») */
  qomitaTiyin: string;
  /** Korxona to'lagani = to'liq − Qo'mita; null — tarkibda topilmadi */
  companyTiyin: string | null;
  /** Qismlar: nimaga qancha — to'liq oylikda, Qo'mita qoplagani, korxona to'lagani */
  parts: ComparePart[];
}

export interface ComparePart {
  key: string;
  label: string;
  /** null — to'liq oylikda bu qism alohida ko'rinmaydi */
  fullTiyin: string | null;
  qomitaTiyin: string;
  companyTiyin: string | null;
}

/** Shablon qismi → ish haqi tarkibi komponenti (bir xil to'lov) */
const VED_TO_TARKIB: Record<string, string> = {
  OKLAD: 'OKLAD',
  USTAMA_40: 'OKLAD_40',
  TATIL: 'TATIL',
  TATIL_KOMP: 'TATIL_KOMP',
  TATIL_MODDIY: 'MODDIY',
  KASALLIK: 'KASALLIK',
  DEKRET: 'DEKRET',
  OVQAT: 'OVQAT',
  YOLKIRA: 'TRANSPORT',
  TUMAN: 'TUMAN_KOEF',
  MUKOFOT: 'MUKOFOT_OKLAD',
  MODDIY_RAGBAT: 'FRONT',
  BOSHQA: 'BOSHQA',
};
/** Vedomost (hudud xodimlari) — tarkib yo'q: asosiy / mukofot va ustamalar / ta'til / boshqa */
const VED_TO_PAYROLL: Record<string, string> = { OKLAD: 'OKLAD', USTAMA_40: '__bonus', MUKOFOT: '__bonus', MODDIY_RAGBAT: '__bonus', OKLAD_USTAMA: '__bonus', TATIL: 'TATIL', TATIL_KOMP: 'TATIL', TATIL_MODDIY: 'TATIL' };
const PAYROLL_LABEL: Record<string, string> = { OKLAD: 'Asosiy (oklad)', __bonus: 'Mukofot va ustamalar', TATIL: "Ta'til", __other: 'Boshqa', __total: "Jami (qismlarga ajratilmagan)" };

/** Xodim qismlari: to'liq oylik qismi, undan Qo'mita qoplagani, korxona to'lagani (mos qism topilmasa — to'liq «—») */
function partsOf(fullBy: Map<string, bigint> | null, ved: Record<string, string>, source: 'TARKIB' | 'VEDOMOST' | null, compName: Map<string, string>, qTotal: bigint): ComparePart[] {
  const map = source === 'VEDOMOST' ? VED_TO_PAYROLL : VED_TO_TARKIB;
  const lines = new Map<string, { label: string; full: bigint | null; q: bigint }>();
  for (const [code, v] of fullBy ?? []) lines.set(code, { label: PAYROLL_LABEL[code] ?? compName.get(code) ?? code, full: v, q: 0n });
  const place = (code: string, label: string, v: bigint) => {
    const target = map[code] && lines.has(map[code]!) ? map[code]! : lines.has('__total') ? '__total' : source === 'VEDOMOST' && lines.has('__other') ? '__other' : null;
    if (target) return void (lines.get(target)!.q += v);
    const x = lines.get(`ved:${code}`) ?? { label, full: null, q: 0n };
    x.q += v;
    lines.set(`ved:${code}`, x);
  };
  let rest = qTotal;
  for (const [code, raw] of Object.entries(ved ?? {})) {
    const v = BigInt(raw || '0');
    if (!v) continue;
    place(code, VED_COMPONENT_LABEL[code as keyof typeof VED_COMPONENT_LABEL] ?? code, v);
    rest -= v;
  }
  // Shablonda qismlarga ajratilmagan qoldiq — qismlar yig'indisi doim Qo'mita jamiga teng
  if (rest !== 0n) place('__rest', "Qismlarga ajratilmagan", rest);
  const cmp = (a: bigint, b: bigint) => (a < b ? 1 : a > b ? -1 : 0);
  return [...lines.entries()]
    .filter(([, x]) => x.full !== 0n || x.q !== 0n)
    .sort(([, a], [, b]) => cmp(a.q, b.q) || cmp(a.full ?? 0n, b.full ?? 0n))
    .map(([key, x]) => ({ key, label: x.label, fullTiyin: x.full === null ? null : x.full.toString(), qomitaTiyin: x.q.toString(), companyTiyin: x.full === null ? null : (x.full - x.q).toString() }));
}

interface CompareSum {
  fullTiyin: string;
  qomitaTiyin: string;
  companyTiyin: string;
  employees: number;
  /** Tarkibda topilmagan xodimlar (to'liq oylik noma'lum) va ularning Qo'mita qismi */
  unmatched: number;
  unmatchedQomitaTiyin: string;
}

const sumOf = (list: CompareEmployee[]): CompareSum => {
  let full = 0n;
  let q = 0n;
  let comp = 0n;
  let un = 0;
  let unQ = 0n;
  for (const e of list) {
    if (e.fullTiyin === null) {
      un += 1;
      unQ += BigInt(e.qomitaTiyin);
      continue;
    }
    full += BigInt(e.fullTiyin);
    q += BigInt(e.qomitaTiyin);
    comp += BigInt(e.companyTiyin!);
  }
  return { fullTiyin: full.toString(), qomitaTiyin: q.toString(), companyTiyin: comp.toString(), employees: list.length, unmatched: un, unmatchedQomitaTiyin: unQ.toString() };
};

// ═══════════════════════════════════════════════════════════
// 3802 — Qo'mita pullari: IKKI HISOB.
//   • 3802 — «Call markaz» deb kelgan pul (2026/1 shartnoma, kassa 1.11): butun 3802 tizimidagi hamma bo'limlar
//     xodimlariniki (faqat Call markazniki emas). Sarf — oylik «3802 dan olingan pullar» shablonining asosiy varag'i («Jami»).
//   • Marksheyder — «Marksheyder uchun» deb kelgan pul (2026/2 shartnoma, kassa 1.14 / 1.15). Sarf — shablonning
//     Marksheyder varag'i (nomida «Маркшейдер/Marksheyder» va oy) yoki Marksheyder bo'limi.
//   Kirim — Daromadlar jadvalidagi Qo'mita yozuvlari (segment QOMITA): moddasi nomida «Marksheyder» bo'lsa — Marksheyder,
//   qolgani — 3802. Kassa va yuklangan fayl ikki marta sanalmaydi (Markaz daromadlari › kassa ↔ Qo'mita).
//   Sozlamalar (migratsiyasiz): 3802.hisob.contract — yil → shartnoma summasi (tiyin); 3802.hisob.excluded — sarfi
//   hisobga olinmaydigan oylar (shablon o'chirilmaydi, qaytarish mumkin).
// ═══════════════════════════════════════════════════════════

export const CONTRACT_KEY = '3802.hisob.contract';
export const EXCLUDED_KEY = '3802.hisob.excluded';
/** Standart shartnoma summasi (2026/1): 7,2 mlrd so'm */
const DEFAULT_CONTRACT: Record<string, string> = { '2026': (7_200_000_000n * 100n).toString() };

type Kind = 'POOL' | 'MARKSHEYDER';

export interface HisobMonth {
  period: string;
  incomeTiyin: string;
  spendTiyin: string;
  /** Yig'ma qoldiq (davr boshidan): kirim − sarf */
  balanceTiyin: string;
  employees: number;
  /** Shablon yuklanganmi va hisobga olinadimi */
  vedomost: 'YES' | 'EXCLUDED' | 'NONE';
}

export interface HisobSide {
  months: HisobMonth[];
  incomeTiyin: string;
  spendTiyin: string;
  balanceTiyin: string;
  /** Bo'limlar (shablondagi nomi bilan): oy → summa */
  sections: { name: string; months: Record<string, string>; totalTiyin: string; employees: number }[];
  incomes: { id: string; date: string; period: string; amountTiyin: string; label: string; source: string }[];
}

@Injectable()
export class Hisob3802Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly nz?: Nazorat3802Service,
  ) {}

  /**
   * Qo'mita › Solishtirma (shaxsiy ma'lumot): Qo'mitadan pul oladigan xodimlar (oylik shablon) — har birining to'liq
   * oyligi (ish haqi tarkibi), shundan Qo'mita qoplagani (shablon «Jami») va korxona to'lagani (ayirma).
   * Ism → tarkib: 3802 «Nazorat zanjiri» bilan bir xil (qo'lda bog'lash → to'liq ism → familiya+ism → yaqin yozilish).
   * Sarfi hisobga olinmaydigan oylar — kirmaydi (Umumiy bilan bir xil). Daraxt: hisob → oy → bo'lim → xodim.
   */
  async compare(from: string, to: string) {
    const months = monthsBetween(String(from ?? ''), String(to ?? ''));
    if (!months.length) throw new BadRequestException("Davr noto'g'ri (YYYY-MM)");
    if (!this.nz) throw new BadRequestException('3802 nazorat moduli ulanmagan');
    const excluded = new Set(await this.excluded());
    const used = months.filter((p) => !excluded.has(p));
    const [{ tarkib, links }, ved, registry, payroll, batches, components] = await Promise.all([
      this.nz.tarkibAndLinks(used),
      this.prisma.setting.findMany({ where: { key: { in: used.map((p) => `3802.ved.${p}`) } }, select: { key: true, value: true } }),
      this.prisma.employee.findMany({ select: { pinfl: true, fullName: true } }),
      this.prisma.payrollEntry.findMany({ where: { period: { in: used }, deletedAt: null }, select: { employeePinfl: true, period: true, totalTiyin: true, baseTiyin: true, bonusTiyin: true, vacationTiyin: true } }),
      this.prisma.salaryCompositionBatch.findMany({ where: { period: { in: used }, cancelledAt: null }, select: { id: true, period: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.salaryComponent.findMany({ select: { code: true, name: true, sign: true } }),
    ]);
    const vedBy = new Map(ved.map((v) => [v.key.slice('3802.ved.'.length), v.value as { sections?: VedSection[] } | null]));
    // Zaxira (hudud xodimlari ish haqi tarkibida bo'lmaydi): reestrdan ism bo'yicha — faqat yagona bo'lsa; oylik — shu oy vedomosti
    const byName = new Map<string, string[]>();
    for (const e of registry) byName.set(nameKey(e.fullName), [...(byName.get(nameKey(e.fullName)) ?? []), e.pinfl]);
    const pay = new Map<string, (typeof payroll)[number]>();
    for (const x of payroll) pay.set(`${x.employeePinfl}|${x.period}`, x);
    const fallback = (fullName: string, period: string) => {
      const linked = links[nameKey(fullName)];
      const pins = typeof linked === 'string' ? [linked] : (byName.get(nameKey(fullName)) ?? []);
      return pins.length === 1 ? (pay.get(`${pins[0]}|${period}`) ?? null) : null;
    };
    // To'liq oylik qismlari (ish haqi tarkibi): oyning oxirgi yuklashi → xodim → komponent
    const latest = new Map<string, string>();
    for (const b of batches) if (!latest.has(b.period)) latest.set(b.period, b.id);
    const compRows = latest.size ? await this.prisma.salaryCompositionRow.findMany({ where: { batchId: { in: [...latest.values()] } }, select: { id: true, period: true, employeePinfl: true } }) : [];
    const items = compRows.length ? await this.prisma.salaryCompositionItem.findMany({ where: { rowId: { in: compRows.map((r) => r.id) } }, select: { rowId: true, componentCode: true, amountTiyin: true } }) : [];
    const rowKey = new Map(compRows.map((r) => [r.id, `${r.employeePinfl}|${r.period}`]));
    const sign = new Map(components.map((c) => [c.code, c.sign]));
    const fullParts = new Map<string, Map<string, bigint>>();
    for (const it of items) {
      const k = rowKey.get(it.rowId)!;
      const m = fullParts.get(k) ?? new Map<string, bigint>();
      m.set(it.componentCode, (m.get(it.componentCode) ?? 0n) + (sign.get(it.componentCode) === -1 ? -it.amountTiyin : it.amountTiyin));
      fullParts.set(k, m);
    }
    const compName = new Map(components.map((c) => [c.code, c.name]));

    const side = (marksheyder: boolean) => {
      const monthsOut = used
        .filter((p) => vedBy.get(p)?.sections)
        .map((p) => {
          const rows: NzTarkibRow[] = tarkib.get(p) ?? [];
          const sections = (vedBy.get(p)!.sections ?? [])
            .filter((s) => (s.marksheyder ?? MARKSH_RE.test(s.name)) === marksheyder)
            .map((s) => {
              const employees: CompareEmployee[] = s.employees.map((e) => {
                const m = matchPerson(e.fullName, rows, links);
                const q = BigInt(e.totalTiyin);
                const fb = m.row || m.how === 'CONFIRMED_NONE' ? null : fallback(e.fullName, p);
                const full = m.row ? m.row.totalTiyin : fb ? fb.totalTiyin : null;
                const source = m.row ? ('TARKIB' as const) : fb ? ('VEDOMOST' as const) : null;
                // Qismlar: to'liq oylik (tarkib komponentlari yoki vedomost: asosiy / mukofot / ta'til / boshqa) va Qo'mita qismlari (shablon)
                let fullBy: Map<string, bigint> | null = null;
                if (m.row) fullBy = fullParts.get(`${m.row.pinfl}|${p}`) ?? new Map([['__total', m.row.totalTiyin]]);
                else if (fb) {
                  const rest = fb.totalTiyin - fb.baseTiyin - fb.bonusTiyin - fb.vacationTiyin;
                  fullBy = new Map(([['OKLAD', fb.baseTiyin], ['__bonus', fb.bonusTiyin], ['TATIL', fb.vacationTiyin], ['__other', rest]] as [string, bigint][]).filter(([, v]) => v !== 0n));
                }
                const parts = partsOf(fullBy, e.amounts as Record<string, string>, source, compName, q);
                return { fullName: e.fullName, position: e.position, how: m.row ? m.how : fb ? ('EXACT' as const) : m.how, source, fullTiyin: full === null ? null : full.toString(), qomitaTiyin: q.toString(), companyTiyin: full === null ? null : (full - q).toString(), parts };
              });
              return { name: s.name.trim(), ...sumOf(employees), list: employees.sort((a, b) => (BigInt(b.qomitaTiyin) > BigInt(a.qomitaTiyin) ? 1 : -1)) };
            })
            .filter((s) => s.employees > 0);
          const all = sections.flatMap((s) => s.list);
          return { period: p, tarkib: rows.length > 0, ...sumOf(all), sections };
        });
      return { ...sumOf(monthsOut.flatMap((m) => m.sections.flatMap((s) => s.list))), months: monthsOut };
    };
    return { from: months[0]!, to: months[months.length - 1]!, excluded: months.filter((p) => excluded.has(p)), pool: side(false), marksheyder: side(true) };
  }

  private async read<T>(key: string, fallback: T): Promise<T> {
    const v = (await this.prisma.setting.findUnique({ where: { key } }))?.value;
    return (v ?? fallback) as T;
  }

  async contracts(): Promise<Record<string, string>> {
    const v = await this.read<Record<string, unknown>>(CONTRACT_KEY, {});
    const out: Record<string, string> = { ...DEFAULT_CONTRACT };
    for (const [y, t] of Object.entries(v ?? {})) if (/^\d{4}$/.test(y) && typeof t === 'string' && /^\d+$/.test(t)) out[y] = t;
    return out;
  }

  async excluded(): Promise<string[]> {
    const v = await this.read<unknown>(EXCLUDED_KEY, []);
    return Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string' && /^\d{4}-\d{2}$/.test(p)).sort() : [];
  }

  /** Ikki hisob: davr (YYYY-MM … YYYY-MM) bo'yicha oyma-oy kirim, sarf, yig'ma qoldiq; bo'limlar va kirim yozuvlari */
  async ledger(from: string, to: string) {
    const months = monthsBetween(String(from ?? ''), String(to ?? ''));
    if (!months.length) throw new BadRequestException("Davr noto'g'ri (YYYY-MM)");
    const [excluded, contracts, cats, incomes, ved] = await Promise.all([
      this.excluded(),
      this.contracts(),
      this.prisma.incomeCategory.findMany({ where: { code: { startsWith: QOMITA_INCOME_PREFIX } }, select: { code: true, label: true } }),
      this.prisma.income.findMany({
        where: { segment: QOMITA_SEGMENT, deletedAt: null, period: { in: months } },
        select: { id: true, date: true, period: true, amountTiyin: true, categoryCode: true, source: true, importBatchId: true },
        orderBy: [{ date: 'asc' }],
      }),
      this.prisma.setting.findMany({ where: { key: { in: months.map((p) => `3802.ved.${p}`) } }, select: { key: true, value: true } }),
    ]);
    const label = new Map(cats.map((c) => [c.code, c.label]));
    const kindOfIncome = (code: string): Kind => (MARKSH_RE.test(label.get(code) ?? code) ? 'MARKSHEYDER' : 'POOL');
    const sourceOf = (x: { source: string; importBatchId: string | null }) =>
      x.importBatchId?.startsWith('kassa:') ? "kunlik ma'lumotnoma (kassa)" : x.importBatchId?.startsWith('qomita-bank:') ? "ko'chirma fayli" : x.source === 'MANUAL' ? "qo'lda" : 'bank tahlili';
    const vedBy = new Map(ved.map((v) => [v.key.slice('3802.ved.'.length), v.value as { sections?: VedSection[] } | null]));
    const excl = new Set(excluded);

    const side = (kind: Kind): HisobSide => {
      const sec = new Map<string, { name: string; months: Record<string, bigint>; employees: Set<string> }>();
      let inc = 0n;
      let sp = 0n;
      let bal = 0n;
      const rows: HisobMonth[] = months.map((p) => {
        const mi = incomes.filter((x) => x.period === p && kindOfIncome(x.categoryCode) === kind).reduce((s, x) => s + x.amountTiyin, 0n);
        const v = vedBy.get(p);
        let ms = 0n;
        let emp = 0;
        if (v?.sections && !excl.has(p))
          for (const s of v.sections) {
            const isM = s.marksheyder ?? MARKSH_RE.test(s.name);
            if ((kind === 'MARKSHEYDER') !== isM) continue;
            const t = BigInt(s.totalTiyin);
            ms += t;
            emp += s.employees.length;
            const key = s.name.trim().toLowerCase();
            const x = sec.get(key) ?? { name: s.name.trim(), months: {}, employees: new Set<string>() };
            x.months[p] = (x.months[p] ?? 0n) + t;
            for (const e of s.employees) x.employees.add(e.fullName.trim().toLowerCase());
            sec.set(key, x);
          }
        inc += mi;
        sp += ms;
        bal += mi - ms;
        return { period: p, incomeTiyin: mi.toString(), spendTiyin: ms.toString(), balanceTiyin: bal.toString(), employees: emp, vedomost: !v?.sections ? 'NONE' : excl.has(p) ? 'EXCLUDED' : 'YES' };
      });
      return {
        months: rows,
        incomeTiyin: inc.toString(),
        spendTiyin: sp.toString(),
        balanceTiyin: (inc - sp).toString(),
        sections: [...sec.values()]
          .map((x) => {
            const total = Object.values(x.months).reduce((s, v) => s + v, 0n);
            return { name: x.name, months: Object.fromEntries(Object.entries(x.months).map(([k, v]) => [k, v.toString()])), totalTiyin: total.toString(), employees: x.employees.size };
          })
          .sort((a, b) => (BigInt(b.totalTiyin) > BigInt(a.totalTiyin) ? 1 : BigInt(b.totalTiyin) < BigInt(a.totalTiyin) ? -1 : 0)),
        incomes: incomes
          .filter((x) => kindOfIncome(x.categoryCode) === kind)
          .map((x) => ({ id: x.id, date: x.date.toISOString().slice(0, 10), period: x.period, amountTiyin: x.amountTiyin.toString(), label: label.get(x.categoryCode) ?? x.categoryCode, source: sourceOf(x) })),
      };
    };

    const pool = side('POOL');
    const marksheyder = side('MARKSHEYDER');
    const year = months[months.length - 1]!.slice(0, 4);
    const contract = contracts[year] ?? null;
    return {
      from: months[0]!,
      to: months[months.length - 1]!,
      months,
      excluded: excluded.filter((p) => months.includes(p)),
      /** Shablon yuklangan oylar (davr ichida) */
      vedomostMonths: months.filter((p) => vedBy.get(p)?.sections),
      contract: contract ? { year, amountTiyin: contract, leftTiyin: (BigInt(contract) - BigInt(pool.spendTiyin)).toString() } : null,
      pool,
      marksheyder,
    };
  }

  /**
   * Bir oy tafsiloti (shaxsiy ma'lumot): shablon bo'limlari va xodimlari — 3802 va Marksheyder alohida.
   * Xodim: F.I.Sh, lavozim, qismlar (oklad, ustama …) va «Jami».
   */
  async monthDetail(period: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(period ?? ''))) throw new BadRequestException("Oy noto'g'ri (YYYY-MM)");
    const v = await this.read<{ sections?: VedSection[]; fileName?: string } | null>(`3802.ved.${period}`, null);
    const excluded = (await this.excluded()).includes(period);
    const pick = (m: boolean) =>
      (v?.sections ?? [])
        .filter((s) => (s.marksheyder ?? MARKSH_RE.test(s.name)) === m)
        .map((s) => ({
          name: s.name.trim(),
          totalTiyin: s.totalTiyin,
          employees: s.employees.map((e) => ({ fullName: e.fullName, position: e.position, totalTiyin: e.totalTiyin, amounts: e.amounts, note: e.note })),
        }));
    // Qismlar nomi (oklad, ustama, mukofot …) — xodim ichida «nimaga qancha»
    const components = Object.entries(VED_COMPONENT_LABEL).map(([code, label]) => ({ code, label }));
    return { period, excluded, fileName: v?.fileName ?? null, components, pool: pick(false), marksheyder: pick(true) };
  }

  /** Sarfi hisobga olinmaydigan oylar (shablon o'chirilmaydi) */
  async setExcluded(body: { periods?: unknown }, userId: string) {
    const list = Array.isArray(body?.periods) ? [...new Set(body.periods.map(String))].filter((p) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p)).sort() : null;
    if (!list) throw new BadRequestException("Oylar ro'yxati kerak");
    await runExclusive(`setting:${EXCLUDED_KEY}`, () => this.prisma.setting.upsert({ where: { key: EXCLUDED_KEY }, create: { key: EXCLUDED_KEY, value: list }, update: { value: list } }));
    await this.audit.log({ userId, action: 'UPDATE', entity: '3802_hisob', entityId: EXCLUDED_KEY, summary: `3802 hisobi — sarfi hisobga olinmaydigan oylar: ${list.join(', ') || "yo'q"}` });
    return { excluded: list };
  }

  /** Yillik shartnoma summasi (so'm): { year, amount } */
  async setContract(body: { year?: unknown; amount?: unknown }, userId: string) {
    const year = String(body?.year ?? '');
    if (!/^\d{4}$/.test(year)) throw new BadRequestException("Yil noto'g'ri");
    const raw = String(body?.amount ?? '').replace(/[\s ]/g, '').replace(',', '.');
    if (!/^\d{1,15}(\.\d{1,2})?$/.test(raw)) throw new BadRequestException("Summa noto'g'ri (so'mda)");
    const [w, f = ''] = raw.split('.');
    const tiyin = (BigInt(w!) * 100n + BigInt((f + '00').slice(0, 2))).toString();
    await runExclusive(`setting:${CONTRACT_KEY}`, async () => {
      const cur = await this.read<Record<string, string>>(CONTRACT_KEY, {});
      const next = { ...(cur && typeof cur === 'object' ? cur : {}), [year]: tiyin };
      await this.prisma.setting.upsert({ where: { key: CONTRACT_KEY }, create: { key: CONTRACT_KEY, value: next }, update: { value: next } });
    });
    await this.audit.log({ userId, action: 'UPDATE', entity: '3802_hisob', entityId: CONTRACT_KEY, summary: `3802 shartnoma summasi ${year}: ${(Number(tiyin) / 100).toLocaleString('uz-UZ')} so'm` });
    return { year, amountTiyin: tiyin };
  }
}
