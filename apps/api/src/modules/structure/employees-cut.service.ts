import { Injectable } from '@nestjs/common';
import { monthsBetween } from '../../common/period';
import { readSafar, SAFAR_KEY } from '../acc-23106/acc23106.safar.service';
import { EmployeeChainService } from '../employees/employee-chain.service';
import { PrismaService } from '../prisma/prisma.service';
import { TAX_TYPES_KEY } from '../taxes/taxes.service';
import { UnitPayrollService } from '../unit-payroll/unit-payroll.service';
import { CenterService } from './center.service';
import { NO_DEPARTMENT } from './center.types';
import { RegionsService } from './regions.service';

// ═══════════════════════════════════════════════════════════
// Bosh sahifa › Xodimlar kesimida — birlik (Markaz bo'limi, viloyat, yo'nalish) › xodim › oy:
//  • xarajat — ish haqi (Bosh sahifadagi bilan bir xil: Markaz bo'limi xodimlari ro'yxatidan; hudud xodimi — vedomost,
//    joyi hisoblar tartibida; yo'nalish xodimi — o'z vedomosti), ijtimoiy soliq (ish haqidan, soliq turlaridagi foiz), xizmat safari (23106, xodim bo'yicha);
//  • daromad — birlikning shu oy daromadi (Bosh sahifadagi) xodimlarga ish haqi ulushiga qarab bo'linadi (tiyin aniq,
//    birlik jami o'zgarmaydi). Shu oy ish haqi yo'q birlik daromadi — «xodimga bo'linmagan».
// Hech narsa yozilmaydi (shaxsiy ma'lumot — faqat ko'rish).
// ═══════════════════════════════════════════════════════════

/** Ko'pi bilan shuncha oy (har oy — Markaz va hududlar hisobi) */
const MAX_MONTHS = 12;

export interface CutMonth {
  period: string;
  salaryTiyin: string;
  taxTiyin: string;
  safarTiyin: string;
  incomeTiyin: string;
}
interface Sums {
  salaryTiyin: string;
  taxTiyin: string;
  safarTiyin: string;
  costTiyin: string;
  incomeTiyin: string;
  resultTiyin: string;
}
export interface CutEmployee extends Sums {
  pinfl: string;
  fullName: string;
  position: string | null;
  months: CutMonth[];
}
export interface CutUnit extends Sums {
  key: string;
  name: string;
  group: 'center' | 'region' | 'segment' | 'none';
  /** Birlik daromadi (Bosh sahifadagi) */
  unitIncomeTiyin: string;
  /** Shu oylarda ish haqi yo'qligi sababli xodimlarga bo'linmagan daromad */
  unallocatedTiyin: string;
  headcount: number;
  employees: CutEmployee[];
}
export interface EmployeesCutResult {
  from: string;
  to: string;
  months: string[];
  /** Ijtimoiy soliq (ish haqidan) foizi */
  taxRate: number;
  units: CutUnit[];
  total: Sums & { headcount: number; unitIncomeTiyin: string; unallocatedTiyin: string };
  notes: string[];
}

interface Acc {
  salary: bigint;
  tax: bigint;
  safar: bigint;
  income: bigint;
}
const zero = (): Acc => ({ salary: 0n, tax: 0n, safar: 0n, income: 0n });
const lastDay = (p: string) => {
  const [y, m] = p.split('-').map(Number) as [number, number];
  return `${p}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

/** Summani og'irliklar bo'yicha bo'lish — tiyin aniq (qoldiq eng katta og'irlikka), yig'indi o'zgarmaydi */
export function allocate(amount: bigint, weights: bigint[]): bigint[] {
  const total = weights.reduce((s, w) => s + w, 0n);
  if (total <= 0n || amount === 0n) return weights.map(() => 0n);
  const out = weights.map((w) => (amount * w) / total);
  const rest = amount - out.reduce((s, x) => s + x, 0n);
  let best = 0;
  weights.forEach((w, i) => {
    if (w > weights[best]!) best = i;
  });
  out[best]! += rest;
  return out;
}

@Injectable()
export class EmployeesCutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly center: CenterService,
    private readonly regions: RegionsService,
    private readonly chain: EmployeeChainService,
    private readonly unitPayroll: UnitPayrollService,
  ) {}

  /** Ish haqidan foiz soliqlar (faol, «PAYROLL_PERCENT») yig'indisi — standart ijtimoiy soliq 12% */
  private async payrollTaxRate(): Promise<number> {
    const row = await this.prisma.setting.findUnique({ where: { key: TAX_TYPES_KEY } });
    const list = Array.isArray(row?.value) ? (row.value as { method?: string; rate?: unknown; active?: boolean }[]) : null;
    if (!list) return 12;
    return list.filter((t) => t?.active !== false && t?.method === 'PAYROLL_PERCENT' && typeof t.rate === 'number').reduce((s, t) => s + (t.rate as number), 0);
  }

  async view(query: { from?: string; to?: string }): Promise<EmployeesCutResult> {
    const all = monthsBetween(String(query.from ?? '').slice(0, 7), String(query.to ?? '').slice(0, 7));
    // Oxirgi MAX_MONTHS oy (davr uzun bo'lsa)
    const months = all.slice(-MAX_MONTHS);
    const notes: string[] = [];
    if (all.length > months.length) notes.push(`Davr uzun — oxirgi ${MAX_MONTHS} oy ko'rsatildi (${months[0]} — ${months[months.length - 1]})`);
    const rate = await this.payrollTaxRate();
    const rateBp = BigInt(Math.round(rate * 100));

    const [places, entries, safarRow] = await Promise.all([
      this.chain.effectivePlaces(months),
      this.prisma.payrollEntry.findMany({ where: { period: { in: months }, deletedAt: null, batch: { status: 'COMMITTED' } }, select: { employeePinfl: true, period: true, totalTiyin: true } }),
      this.prisma.setting.findUnique({ where: { key: SAFAR_KEY } }),
    ]);
    const paid = new Map<string, bigint>();
    for (const e of entries) paid.set(`${e.employeePinfl}|${e.period}`, (paid.get(`${e.employeePinfl}|${e.period}`) ?? 0n) + e.totalTiyin);
    const safar = new Map<string, bigint>();
    for (const post of readSafar(safarRow?.value ?? null).posts)
      if (post.status === 'POSTED')
        for (const it of post.items) if (it.pinfl && months.includes(it.period)) safar.set(`${it.pinfl}|${it.period}`, (safar.get(`${it.pinfl}|${it.period}`) ?? 0n) + BigInt(it.amountTiyin || '0'));

    const units = new Map<string, { key: string; name: string; group: CutUnit['group']; order: number; income: bigint; unallocated: bigint; people: Map<string, Map<string, Acc>> }>();
    const unitOf = (key: string, name: string, group: CutUnit['group'], order: number) => {
      let u = units.get(key);
      if (!u) {
        u = { key, name, group, order, income: 0n, unallocated: 0n, people: new Map() };
        units.set(key, u);
      }
      return u;
    };
    const names = new Map<string, { fullName: string; position: string | null }>();

    for (const p of months) {
      const range = { from: `${p}-01`, to: lastDay(p) };
      const [c, r] = await Promise.all([this.center.full(range), this.regions.compare(range)]);
      /** Shu oy birlikka joylangan xodimlar: birlik kaliti → [pinfl, ish haqi] */
      const members = new Map<string, [string, bigint][]>();
      const seen = new Set<string>();
      const add = (key: string, pinfl: string, salary: bigint) => {
        const list = members.get(key) ?? [];
        list.push([pinfl, salary]);
        members.set(key, list);
        seen.add(pinfl);
      };
      // Markaz bo'limlari — Bosh sahifadagi xodimlar ro'yxati va ish haqi
      c.details.forEach((d, i) => {
        const key = `dep:${d.department.id}`;
        const u = unitOf(key, d.department.id === NO_DEPARTMENT ? "Markaz — bo'limga biriktirilmagan" : d.department.name, 'center', i);
        u.income += BigInt(d.summary.incomeTiyin);
        for (const e of d.employees) {
          names.set(e.pinfl, { fullName: e.fullName, position: e.position });
          const s = BigInt(e.salaryTiyin);
          if (s > 0n || safar.has(`${e.pinfl}|${p}`)) add(key, e.pinfl, s);
        }
      });
      // Hududlar — viloyat daromadi; xodimlari — shu oy joyi shu viloyat (Markaz ro'yxatida bo'lmaganlar)
      for (const x of r.units) {
        if (x.kind !== 'region' || x.code === null) continue;
        unitOf(`r:${x.code}`, x.name, 'region', 1000 + x.code).income += BigInt(x.incomeTiyin);
      }
      for (const [k, salary] of paid) {
        const [pinfl, period] = k.split('|') as [string, string];
        if (period !== p || seen.has(pinfl)) continue;
        const place = places.get(k);
        const code = place?.unit.startsWith('R:') ? Number(place.unit.slice(2)) : null;
        const key = code !== null && units.has(`r:${code}`) ? `r:${code}` : 'none';
        if (key === 'none') unitOf('none', 'Joyi aniqlanmagan xodimlar', 'none', 99_999);
        add(key, pinfl, salary);
      }
      // Yo'nalishlar (Tax free, Marksheyder …) — daromadi Bosh sahifadagi; xodimlari va ish haqi — o'z vedomostidan
      for (const x of r.units) {
        if (x.kind !== 'segment' || !x.segment) continue;
        const key = `s:${x.segment}`;
        unitOf(key, x.name, 'segment', 2000 + r.units.indexOf(x)).income += BigInt(x.incomeTiyin);
        const map = await this.unitPayroll.payrollMap(x.segment, p).catch(() => null);
        for (const [pinfl, salary] of map ?? []) if (salary > 0n) add(key, pinfl, salary);
      }
      // Faqat safar olgan (shu oy ish haqi yo'q) — joyi bo'yicha
      for (const [k] of safar) {
        const [pinfl, period] = k.split('|') as [string, string];
        if (period !== p || seen.has(pinfl)) continue;
        const place = places.get(k);
        const code = place?.unit.startsWith('R:') ? Number(place.unit.slice(2)) : null;
        const key = code !== null && units.has(`r:${code}`) ? `r:${code}` : 'none';
        if (key === 'none') unitOf('none', 'Joyi aniqlanmagan xodimlar', 'none', 99_999);
        add(key, pinfl, 0n);
      }
      // Daromadni ish haqi ulushiga qarab bo'lish (shu oy, shu birlik)
      const monthIncome = new Map<string, bigint>();
      c.details.forEach((d) => monthIncome.set(`dep:${d.department.id}`, (monthIncome.get(`dep:${d.department.id}`) ?? 0n) + BigInt(d.summary.incomeTiyin)));
      for (const x of r.units) {
        if (x.kind === 'region' && x.code !== null) monthIncome.set(`r:${x.code}`, BigInt(x.incomeTiyin));
        if (x.kind === 'segment' && x.segment) monthIncome.set(`s:${x.segment}`, BigInt(x.incomeTiyin));
      }
      for (const [key, inc] of monthIncome) {
        const u = units.get(key)!;
        const list = members.get(key) ?? [];
        const shares = allocate(inc, list.map(([, s]) => s));
        const given = shares.reduce((s, x) => s + x, 0n);
        u.unallocated += inc - given;
        list.forEach(([pinfl, salary], i) => {
          const person = u.people.get(pinfl) ?? new Map<string, Acc>();
          const a = person.get(p) ?? zero();
          a.salary += salary;
          a.tax += (salary * rateBp) / 10_000n;
          a.safar += safar.get(`${pinfl}|${p}`) ?? 0n;
          a.income += shares[i]!;
          person.set(p, a);
          u.people.set(pinfl, person);
        });
      }
      for (const [key, list] of members) {
        if (monthIncome.has(key)) continue; // daromadli birliklar yuqorida
        const u = units.get(key)!;
        for (const [pinfl, salary] of list) {
          const person = u.people.get(pinfl) ?? new Map<string, Acc>();
          const a = person.get(p) ?? zero();
          a.salary += salary;
          a.tax += (salary * rateBp) / 10_000n;
          a.safar += safar.get(`${pinfl}|${p}`) ?? 0n;
          person.set(p, a);
          u.people.set(pinfl, person);
        }
      }
    }

    // Ism: Markaz ro'yxatida bo'lmaganlar — reestrdan
    const missing = [...new Set([...units.values()].flatMap((u) => [...u.people.keys()]))].filter((x) => !names.has(x));
    if (missing.length)
      for (const e of await this.prisma.employee.findMany({ where: { pinfl: { in: missing } }, select: { pinfl: true, fullName: true, position: true } })) names.set(e.pinfl, { fullName: e.fullName, position: e.position });

    const sums = (a: Acc): Sums => {
      const cost = a.salary + a.tax + a.safar;
      return { salaryTiyin: a.salary.toString(), taxTiyin: a.tax.toString(), safarTiyin: a.safar.toString(), costTiyin: cost.toString(), incomeTiyin: a.income.toString(), resultTiyin: (a.income - cost).toString() };
    };
    const plus = (t: Acc, a: Acc) => {
      t.salary += a.salary;
      t.tax += a.tax;
      t.safar += a.safar;
      t.income += a.income;
    };
    const grand = zero();
    let grandIncome = 0n;
    let grandUnallocated = 0n;
    let grandHead = 0;
    const out: CutUnit[] = [...units.values()]
      .filter((u) => u.people.size > 0 || u.income !== 0n)
      .sort((a, b) => a.order - b.order)
      .map((u) => {
        const ut = zero();
        const employees: CutEmployee[] = [...u.people.entries()]
          .map(([pinfl, byMonth]) => {
            const t = zero();
            const ms = months.map((p) => {
              const a = byMonth.get(p) ?? zero();
              plus(t, a);
              return { period: p, salaryTiyin: a.salary.toString(), taxTiyin: a.tax.toString(), safarTiyin: a.safar.toString(), incomeTiyin: a.income.toString() };
            });
            plus(ut, t);
            const n = names.get(pinfl);
            return { pinfl, fullName: n?.fullName ?? pinfl, position: n?.position ?? null, months: ms, ...sums(t) };
          })
          .sort((a, b) => (BigInt(b.costTiyin) > BigInt(a.costTiyin) ? 1 : BigInt(b.costTiyin) < BigInt(a.costTiyin) ? -1 : a.fullName.localeCompare(b.fullName, 'uz')));
        plus(grand, ut);
        grandIncome += u.income;
        grandUnallocated += u.unallocated;
        grandHead += employees.length;
        return { key: u.key, name: u.name, group: u.group, unitIncomeTiyin: u.income.toString(), unallocatedTiyin: u.unallocated.toString(), headcount: employees.length, employees, ...sums(ut) };
      });
    if (grandUnallocated !== 0n) notes.push("Ba'zi birliklarda shu oy ish haqi yo'q — o'sha oy daromadi xodimlarga bo'linmadi («xodimga bo'linmagan»)");
    if (units.has('none')) notes.push("«Joyi aniqlanmagan xodimlar» — ish haqi bor, lekin shu oy qayerda ishlagani aniqlanmagan (O'zgarishlar › Xodimlar harakati, Xodimlar › Nazorat)");
    return { from: months[0]!, to: months[months.length - 1]!, months, taxRate: rate, units: out, total: { ...sums(grand), headcount: grandHead, unitIncomeTiyin: grandIncome.toString(), unallocatedTiyin: grandUnallocated.toString() }, notes };
  }
}
