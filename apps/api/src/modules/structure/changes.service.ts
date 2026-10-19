import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// ═══════════════════════════════════════════════════════════
// Solishtirma › O'zgarishlar — oy bo'yicha xodimlar harakati (ish haqi vedomostidan).
//
//   • Bu oy nechta xodimga oylik hisoblandi: hududlar va Markaz bo'yicha (soni va summasi — to'liq ish haqi).
//   • O'tgan oyga nisbatan:
//       – ishga olindi    — bu oy oylik bor, o'tgan oy yo'q, ishga kirgan sanasi shu oyda (yoki o'tgan oyda, kech qo'shilgan);
//       – qaytdi          — bu oy oylik bor, o'tgan oy yo'q, avvaldan ishlaydi (ta'til, dekretdan qaytgan …);
//       – bo'shatildi     — o'tgan oy oylik bor, bu oy yo'q, bo'shagan (sanasi yoki arxivda);
//       – ishlamadi       — o'tgan oy oylik bor, bu oy yo'q, lekin ishdan bo'shamagan (ta'til, kasallik, dekret …);
//       – ko'chdi         — ikki oyda ham oylik bor, lekin boshqa hudud/Markazga o'tgan;
//       – oyligi keskin o'zgardi — ±20% va undan ko'p.
//   • Birlik (hudud yoki Markaz) — shu oyning hudud tarixidan (natijalar fayli), bo'lmasa xodimlar reestridan.
// ═══════════════════════════════════════════════════════════

const CENTRAL = 0;
const TASHKENT_MS = 5 * 3600_000;
const CHANGE_PCT = 20;

export type ChangeKind = 'hired' | 'returned' | 'fired' | 'idle' | 'moved' | 'up' | 'down' | 'hiredUnpaid';

export interface ChangePerson {
  pinfl: string;
  fullName: string;
  position: string | null;
  kind: ChangeKind;
  unitKey: string;
  unitName: string;
  /** Ko'chganda — qayerdan */
  fromUnitKey: string | null;
  fromUnitName: string | null;
  previousTiyin: string;
  currentTiyin: string;
  hiredAt: string | null;
  firedAt: string | null;
}

export interface ChangeUnit {
  key: string;
  code: number;
  name: string;
  kind: 'center' | 'region';
  previousCount: number;
  currentCount: number;
  previousTiyin: string;
  currentTiyin: string;
  /** Markaz hisobiga o'tgan qism (bayram, choraklik) — hudud xodimlari */
  centerPartTiyin: string;
  hired: number;
  returned: number;
  fired: number;
  idle: number;
  movedIn: number;
  movedOut: number;
}

export interface ChangesResult {
  period: string;
  previousPeriod: string;
  /** Ish haqi yuklangan oylar (tanlash uchun, yangisi birinchi) */
  periods: string[];
  hasCurrent: boolean;
  hasPrevious: boolean;
  totals: {
    currentCount: number;
    previousCount: number;
    currentTiyin: string;
    previousTiyin: string;
    regionsCount: number;
    regionsTiyin: string;
    centerCount: number;
    centerTiyin: string;
    previousRegionsCount: number;
    previousCenterCount: number;
    previousRegionsTiyin: string;
    previousCenterTiyin: string;
    centerPartTiyin: string;
  };
  counts: Record<ChangeKind, number>;
  units: ChangeUnit[];
  people: ChangePerson[];
  notes: string[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const prevPeriod = (p: string) => {
  const y = Number(p.slice(0, 4));
  const m = Number(p.slice(5));
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
};
const periodOf = (d: Date) => new Date(d.getTime() + TASHKENT_MS).toISOString().slice(0, 7);
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const monthName = (p: string) => `${MONTHS[Number(p.slice(5)) - 1]}`;
const fmtSom = (t: bigint) => {
  const som = Number(t) / 100;
  const a = Math.abs(som);
  const s = a >= 1e9 ? `${(som / 1e9).toFixed(2)} mlrd` : a >= 1e6 ? `${(som / 1e6).toFixed(1)} mln` : `${Math.round(som).toLocaleString('ru-RU')}`;
  return `${s.replace('.', ',')} so'm`;
};

@Injectable()
export class ChangesService {
  constructor(private readonly prisma: PrismaService) {}

  /** ?month=YYYY-MM yoki ?to=YYYY-MM-DD (davr oxiri) — bo'lmasa oxirgi ish haqi oyi */
  async month(query: { month?: string; to?: string }): Promise<ChangesResult> {
    const batches = await this.prisma.payrollBatch.findMany({ where: { status: 'COMMITTED' }, select: { id: true, period: true } });
    const periods = [...new Set(batches.map((b) => b.period))].sort().reverse();
    let period = query.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month) ? query.month : null;
    if (!period) {
      const limit = query.to && /^\d{4}-\d{2}-\d{2}$/.test(query.to) ? query.to.slice(0, 7) : null;
      period = (limit ? periods.find((p) => p <= limit) : periods[0]) ?? limit ?? new Date(Date.now() + TASHKENT_MS).toISOString().slice(0, 7);
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new BadRequestException("Oy noto'g'ri (YYYY-MM)");
    const previous = prevPeriod(period);
    const ids = batches.filter((b) => b.period === period || b.period === previous).map((b) => b.id);

    const [entries, locations, regions] = await Promise.all([
      ids.length
        ? this.prisma.payrollEntry.findMany({
            where: { batchId: { in: ids }, deletedAt: null },
            select: { employeePinfl: true, period: true, baseTiyin: true, bonusTiyin: true, totalTiyin: true },
          })
        : Promise.resolve([]),
      this.prisma.employeeLocation.findMany({ where: { period: { in: [period, previous] } }, select: { employeePinfl: true, period: true, regionCode: true } }),
      this.prisma.region.findMany({ select: { code: true, name: true, isActive: true } }),
    ]);
    // Shu oy ishga kirgan yoki bo'shagan (oyligi bo'lmasa ham ko'rinsin)
    const [y, m] = period.split('-').map(Number) as [number, number];
    const start = new Date(Date.UTC(y, m - 1, 1) - TASHKENT_MS);
    const end = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1) - TASHKENT_MS);
    const pins = [...new Set(entries.map((e) => e.employeePinfl))];
    const registry = await this.prisma.employee.findMany({
      where: { OR: [{ pinfl: { in: pins } }, { hiredAt: { gte: start, lt: end } }, { firedAt: { gte: start, lt: end } }] },
      select: { pinfl: true, fullName: true, position: true, regionCode: true, hiredAt: true, firedAt: true, isActive: true },
    });
    const person = new Map(registry.map((e) => [e.pinfl, e]));
    const locOf = new Map(locations.map((l) => [`${l.employeePinfl}|${l.period}`, l.regionCode]));
    const regionName = new Map(regions.map((r) => [r.code, r.name]));
    const unitOf = (pinfl: string, p: string): { key: string; code: number; name: string } => {
      const code = locOf.get(`${pinfl}|${p}`) ?? person.get(pinfl)?.regionCode ?? CENTRAL;
      return code === CENTRAL ? { key: 'center', code: CENTRAL, name: 'Markaz' } : { key: `r:${code}`, code, name: regionName.get(code) ?? `Hudud ${code}` };
    };
    const fullOf = (e: { baseTiyin: bigint; bonusTiyin: bigint; totalTiyin: bigint }) => (e.baseTiyin === 0n ? e.totalTiyin + e.bonusTiyin : e.baseTiyin);

    const pay = (p: string) => {
      const out = new Map<string, { amount: bigint; center: bigint }>();
      for (const e of entries) {
        if (e.period !== p) continue;
        const x = out.get(e.employeePinfl) ?? { amount: 0n, center: 0n };
        x.amount += fullOf(e);
        x.center += e.bonusTiyin;
        out.set(e.employeePinfl, x);
      }
      return out;
    };
    const cur = pay(period);
    const prev = pay(previous);

    // ── Birliklar ──
    const units = new Map<string, ChangeUnit>();
    const unit = (u: { key: string; code: number; name: string }) => {
      let x = units.get(u.key);
      if (!x) {
        x = { key: u.key, code: u.code, name: u.name, kind: u.key === 'center' ? 'center' : 'region', previousCount: 0, currentCount: 0, previousTiyin: '0', currentTiyin: '0', centerPartTiyin: '0', hired: 0, returned: 0, fired: 0, idle: 0, movedIn: 0, movedOut: 0 };
        units.set(u.key, x);
      }
      return x;
    };
    unit({ key: 'center', code: CENTRAL, name: 'Markaz' });
    for (const r of regions) if (r.code !== CENTRAL && r.isActive) unit({ key: `r:${r.code}`, code: r.code, name: r.name });
    const add = (u: ChangeUnit, k: 'previousTiyin' | 'currentTiyin' | 'centerPartTiyin', v: bigint) => {
      u[k] = (BigInt(u[k]) + v).toString();
    };
    for (const [pin, v] of cur) {
      const u = unit(unitOf(pin, period));
      u.currentCount += 1;
      add(u, 'currentTiyin', v.amount);
      add(u, 'centerPartTiyin', v.center);
    }
    for (const [pin, v] of prev) {
      const u = unit(unitOf(pin, previous));
      u.previousCount += 1;
      add(u, 'previousTiyin', v.amount);
    }

    // ── Odamlar ──
    const people: ChangePerson[] = [];
    const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
    const mk = (pin: string, kind: ChangeKind, u: { key: string; name: string }, from: { key: string; name: string } | null): ChangePerson => {
      const e = person.get(pin);
      return {
        pinfl: pin,
        fullName: e?.fullName ?? pin,
        position: e?.position ?? null,
        kind,
        unitKey: u.key,
        unitName: u.name,
        fromUnitKey: from?.key ?? null,
        fromUnitName: from?.name ?? null,
        previousTiyin: (prev.get(pin)?.amount ?? 0n).toString(),
        currentTiyin: (cur.get(pin)?.amount ?? 0n).toString(),
        hiredAt: iso(e?.hiredAt),
        firedAt: iso(e?.firedAt),
      };
    };
    const hasPrevious = prev.size > 0;
    if (hasPrevious) {
      for (const [pin] of cur) {
        const now = unitOf(pin, period);
        if (!prev.has(pin)) {
          const e = person.get(pin);
          const hiredP = e?.hiredAt ? periodOf(e.hiredAt) : null;
          const kind: ChangeKind = hiredP && hiredP >= previous ? 'hired' : 'returned';
          people.push(mk(pin, kind, now, null));
          unit(now)[kind === 'hired' ? 'hired' : 'returned'] += 1;
        } else {
          const was = unitOf(pin, previous);
          if (was.key !== now.key) {
            people.push(mk(pin, 'moved', now, was));
            unit(now).movedIn += 1;
            unit(was).movedOut += 1;
          } else {
            const a = prev.get(pin)!.amount;
            const b = cur.get(pin)!.amount;
            if (a > 0n) {
              const pct = (Number(b - a) / Number(a)) * 100;
              if (Math.abs(pct) >= CHANGE_PCT) people.push(mk(pin, pct > 0 ? 'up' : 'down', now, null));
            }
          }
        }
      }
      for (const [pin] of prev) {
        if (cur.has(pin)) continue;
        const was = unitOf(pin, previous);
        const e = person.get(pin);
        const fired = Boolean(e && ((e.firedAt && e.firedAt < end) || !e.isActive));
        people.push(mk(pin, fired ? 'fired' : 'idle', was, null));
        unit(was)[fired ? 'fired' : 'idle'] += 1;
      }
    }
    // Shu oy ishga olingan, lekin oyligi hali yo'q
    for (const e of registry) {
      if (!e.hiredAt || e.hiredAt < start || e.hiredAt >= end || cur.has(e.pinfl)) continue;
      people.push(mk(e.pinfl, 'hiredUnpaid', unitOf(e.pinfl, period), null));
    }
    // Shu oy bo'shagan, lekin o'tgan oy oyligi yo'q edi (ro'yxatda ko'rinsin)
    for (const e of registry) {
      if (!e.firedAt || e.firedAt < start || e.firedAt >= end || prev.has(e.pinfl) || cur.has(e.pinfl)) continue;
      people.push(mk(e.pinfl, 'fired', unitOf(e.pinfl, period), null));
      unit(unitOf(e.pinfl, period)).fired += 1;
    }

    const counts: Record<ChangeKind, number> = { hired: 0, returned: 0, fired: 0, idle: 0, moved: 0, up: 0, down: 0, hiredUnpaid: 0 };
    for (const p of people) counts[p.kind] += 1;
    const order: Record<ChangeKind, number> = { hired: 0, hiredUnpaid: 1, returned: 2, fired: 3, idle: 4, moved: 5, up: 6, down: 7 };
    people.sort((a, b) => order[a.kind] - order[b.kind] || a.unitName.localeCompare(b.unitName) || a.fullName.localeCompare(b.fullName));

    const list = [...units.values()].filter((u) => u.kind === 'center' || u.currentCount || u.previousCount || u.hired || u.fired || u.idle || u.movedIn || u.movedOut);
    list.sort((a, b) => (a.kind !== b.kind ? (a.kind === 'center' ? -1 : 1) : b.currentCount - a.currentCount || a.name.localeCompare(b.name)));
    const sumU = (f: (u: ChangeUnit) => bigint | number, kind?: 'center' | 'region') => list.filter((u) => !kind || u.kind === kind).reduce((s, u) => s + BigInt(f(u)), 0n);
    const center = units.get('center')!;
    const totals = {
      currentCount: cur.size,
      previousCount: prev.size,
      currentTiyin: sumU((u) => BigInt(u.currentTiyin)).toString(),
      previousTiyin: sumU((u) => BigInt(u.previousTiyin)).toString(),
      regionsCount: Number(sumU((u) => u.currentCount, 'region')),
      regionsTiyin: sumU((u) => BigInt(u.currentTiyin), 'region').toString(),
      centerCount: center.currentCount,
      centerTiyin: center.currentTiyin,
      previousRegionsCount: Number(sumU((u) => u.previousCount, 'region')),
      previousCenterCount: center.previousCount,
      previousRegionsTiyin: sumU((u) => BigInt(u.previousTiyin), 'region').toString(),
      previousCenterTiyin: center.previousTiyin,
      centerPartTiyin: sumU((u) => BigInt(u.centerPartTiyin), 'region').toString(),
    };

    // ── Xulosa ──
    const notes: string[] = [];
    if (!cur.size) notes.push(`${monthName(period)} oyi uchun ish haqi vedomosti yuklanmagan.`);
    else {
      const d = cur.size - prev.size;
      notes.push(
        `${monthName(period).replace(/^./, (c) => c.toUpperCase())} oyida ${cur.size} xodimga oylik hisoblandi (${fmtSom(BigInt(totals.currentTiyin))}): hududlardan ${totals.regionsCount} ta, Markazdan ${totals.centerCount} ta.` +
          (hasPrevious ? ` O'tgan oyga nisbatan ${d === 0 ? "soni o'zgarmadi" : `${d > 0 ? '+' : ''}${d} ta`}.` : ''),
      );
      if (BigInt(totals.centerPartTiyin) > 0n) notes.push(`Hudud xodimlarining bayram va choraklik pullari — ${fmtSom(BigInt(totals.centerPartTiyin))} — Markaz hisobiga o'tdi.`);
      if (hasPrevious) {
        const parts = [
          counts.hired ? `${counts.hired} ta ishga olindi` : '',
          counts.returned ? `${counts.returned} ta qaytdi (o'tgan oy oyligi yo'q edi)` : '',
          counts.fired ? `${counts.fired} ta bo'shatildi` : '',
          counts.idle ? `${counts.idle} tasi bu oy ishlamadi (oylik yo'q, lekin bo'shamagan)` : '',
          counts.moved ? `${counts.moved} ta boshqa hudud/Markazga o'tdi` : '',
        ].filter(Boolean);
        notes.push(parts.length ? `${parts.join(', ')}.` : "Xodimlar tarkibida o'zgarish yo'q.");
        const grown = list.filter((u) => u.previousCount > 0).map((u) => ({ u, d: u.currentCount - u.previousCount })).sort((a, b) => b.d - a.d);
        if (grown[0] && grown[0].d > 0) notes.push(`Eng ko'p ko'paygan: ${grown[0].u.name} (+${grown[0].d}).`);
        const fell = grown[grown.length - 1];
        if (fell && fell.d < 0) notes.push(`Eng ko'p kamaygan: ${fell.u.name} (${fell.d}).`);
        if (counts.up || counts.down) notes.push(`Oyligi ${CHANGE_PCT}% dan ko'p o'zgargan: ${counts.up} ta oshdi, ${counts.down} ta kamaydi.`);
      } else notes.push(`O'tgan oy (${monthName(previous)}) ish haqi yuklanmagan — taqqoslab bo'lmaydi.`);
      if (counts.hiredUnpaid) notes.push(`${counts.hiredUnpaid} ta xodim shu oy ishga olingan, lekin oyligi hali yo'q.`);
    }

    return { period, previousPeriod: previous, periods, hasCurrent: cur.size > 0, hasPrevious, totals, counts, units: list, people, notes };
  }
}