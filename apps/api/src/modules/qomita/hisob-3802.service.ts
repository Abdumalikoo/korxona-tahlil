import { BadRequestException, Injectable } from '@nestjs/common';
import { runExclusive } from '../../common/locks';
import { monthsBetween } from '../../common/period';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { QOMITA_INCOME_PREFIX, QOMITA_SEGMENT } from './qomita.util';
import { MARKSH_RE, type VedSection } from './vedomost-3802.parse';

// ═══════════════════════════════════════════════════════════
// 3802 — Qo'mita pullari: IKKI HISOB.
//   • 3802 hovuzi — «Call markaz» deb kelgan pul (2026/1 shartnoma, kassa 1.11): butun 3802 tizimidagi hamma bo'limlar
//     xodimlariniki (faqat Call markazniki emas). Sarf — oylik «3802 dan olingan pullar» shablonining asosiy varag'i («Jami»).
//   • Marksheyder — «Marksheyder uchun» deb kelgan pul (2026/2 shartnoma, kassa 1.14 / 1.15). Sarf — shablonning
//     Marksheyder varag'i (nomida «Маркшейдер/Marksheyder» va oy) yoki Marksheyder bo'limi.
//   Kirim — Daromadlar jadvalidagi Qo'mita yozuvlari (segment QOMITA): moddasi nomida «Marksheyder» bo'lsa — Marksheyder,
//   qolgani — 3802 hovuzi. Kassa va yuklangan fayl ikki marta sanalmaydi (Markaz daromadlari › kassa ↔ Qo'mita).
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
  ) {}

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
